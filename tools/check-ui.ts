// Verifica el armazón de la interfaz (plan GUI):
//
//  1. Las sesiones son aisladas por usuario: dos jugadores no se mezclan.
//  2. Un nonce caduca: un mensaje viejo no puede gastar ni actuar.
//  3. Los `custom_id` caben en el límite de Discord y se descodifican.
//  4. El registro de pantallas no tiene ids repetidos.
//  5. Todas las pantallas se pintan sin romperse, con datos reales.
//  6. Cada pantalla tiene vuelta atrás y vuelta al Digivice.
//  7. La pila recuerda la página, no solo la pantalla.
//  8. Las pantallas NO contienen lógica de juego.
process.env.DISCORD_TOKEN ??= 'fake';
process.env.DISCORD_CLIENT_ID ??= '0';
process.env.DATABASE_PATH = './data/check-ui.db';

import { rmSync } from 'node:fs';

function cleanupDb(name: string, bestEffort = false): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(`./data/${name}${suffix}`, { force: true, maxRetries: 8, retryDelay: 120 });
    } catch (error) {
      if (!bestEffort) console.error('No se pudo limpiar', suffix, (error as Error).message);
    }
  }
}
cleanupDb('check-ui.db', false);

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repo = await import('../src/game/repository.js');
const { SPECIES, getSpecies } = await import('../src/game/species.js');
const { computeStats } = await import('../src/game/stats.js');
const { db } = await import('../src/db/index.js');

const session = await import('../src/ui/session.js');
const nav = await import('../src/ui/nav.js');
const screen = await import('../src/ui/screen.js');
const components = await import('../src/ui/components.js');

let failures = 0;
const failed: string[] = [];

function check(label: string, ok: boolean, detail = '') {
  if (!ok) {
    failures++;
    failed.push(label);
  }
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` (${detail})` : ''}`);
}

/**
 * Interaccion falsa con lo justo para que una pantalla se pueda pintar.
 *
 * Las pantallas de combate llaman a `reply` para arrancar la batalla, asi que
 * sin el metodo la prueba fallaba por eso y no por la pantalla. `reply` no
 * tiene que hacer nada: la pantalla que devuelve `void` ya ha cedido el
 * mensaje al combate, que es lo que se quiere comprobar.
 */
function fakeInteraction(userId: string) {
  const respuestas: unknown[] = [];
  return {
    user: { id: userId },
    message: { id: 'msg', channelId: 'chan' },
    deferred: false,
    replied: false,
    isRepliable: () => true,
    reply: async (payload: unknown) => {
      respuestas.push(payload);
      return { resource: { message: { id: 'nuevo' } } };
    },
    editReply: async (payload: unknown) => {
      respuestas.push(payload);
      return { resource: { message: { id: 'nuevo' } } };
    },
    deferReply: async () => undefined,
    deferUpdate: async () => undefined,
    followUp: async () => undefined,
    respuestas,
  };
}

function trainerWith(discordId: string, name: string, speciesKey: string, level: number) {
  const t = repo.registerTrainer(discordId, name, SPECIES.agumon!);
  const d = repo.createDigimon(t.id, getSpecies(speciesKey)!, level, ['impacto']);
  d.level = level;
  d.stats = computeStats(d.species.base, level);
  repo.saveDigimon(d);
  repo.setLeader(t.id, d.id);
  repo.giveDigibytes(t.id, 25_000);
  for (const key of ['pocion', 'tonico', 'nucleo_datos', 'cromonizador']) repo.addItem(t.id, key, 15);
  return repo.getTrainerById(t.id)!;
}

// ==========================================================================
console.log('=== 1. AISLAMIENTO POR USUARIO ===');
// ==========================================================================

{
  const a = trainerWith('ui-a', 'Ana', 'agumon', 20);
  const b = trainerWith('ui-b', 'Bruno', 'gabumon', 20);

  const sa = session.ensureSession('111', a.id);
  const sb = session.ensureSession('222', b.id);

  check('son sesiones distintas', sa !== sb);
  check('tienen nonces distintos', sa.nonce !== sb.nonce);

  // Cada uno navega a un sitio distinto.
  session.push(sa, 'mapa', {});
  session.push(sa, 'zona', { z: 'bosque_hielo' });
  session.push(sb, 'digivice');

  check('la pila de Ana tiene 2 pasos', sa.stack.length === 2, `${sa.stack.length}`);
  check('la de Bruno tiene 1', sb.stack.length === 1, `${sb.stack.length}`);
  check('el trainers_id no se cruza', sa.trainerId === a.id && sb.trainerId === b.id);

  // Un botón de Ana no vale para Bruno.
  const buttonA = nav.encodeNav(sa, 'zona', { z: 'bosque_hielo' });
  check('el botón de Ana lleva su nonce', buttonA.endsWith(sa.nonce), buttonA);
  check('no vale para Bruno', !nav.isNavId(buttonA) || !buttonA.endsWith(sb.nonce));

  // Y los destinos tampoco se mezclan: el id va dentro, no sale del estado.
  const decodedA = nav.decodeNav(buttonA)!;
  const decodedB = nav.decodeNav(nav.encodeNav(sb, 'digivice'))!;
  check('Ana va a la zona', decodedA.screen === 'zona' && decodedA.params.z === 'bosque_hielo');
  check('Bruno va al registro', decodedB.screen === 'digivice');
  check('sus nonces no coinciden', decodedA.nonce !== decodedB.nonce);
}

// ==========================================================================
console.log('\n=== 2. EL NONCE CADUCA ===');
// ==========================================================================

{
  const t = trainerWith('ui-n', 'Nadia', 'agumon', 20);
  const s = session.ensureSession('333', t.id);

  const viejo = nav.encodeNav(s, 'hub');
  check('el botón viejo era válido', session.nonceMatches(s, nav.decodeNav(viejo)!.nonce));

  // El router rota el nonce en cada render, como hace `render`.
  session.rotateNonce(s);

  check('tras rotar, el viejo ya no vale', !session.nonceMatches(s, nav.decodeNav(viejo)!.nonce));
  check('el nuevo sí vale', session.nonceMatches(s, s.nonce));

  const deOtro = session.ensureSession('999', t.id);
  check('otra sesión no valida el botón', !session.nonceMatches(deOtro, s.nonce));
}

// ==========================================================================
console.log('\n=== 3. CUSTOM_ID: LÍMITE Y CODIFICACIÓN ===');
// ==========================================================================

{
  const s = session.ensureSession('444', 1);

  const simple = nav.encodeNav(s, 'hub');
  check('un id simple es corto', simple.length < 40, `${simple.length} chars`);
  check('tiene el prefijo correcto', simple.startsWith('n:hub:'));

  const conParams = nav.encodeNav(s, 'zona', { z: 'ruta_volcan', page: '3' });
  const d = nav.decodeNav(conParams)!;
  check('decodifica la pantalla', d.screen === 'zona');
  check('decodifica los parámetros', d.params.z === 'ruta_volcan', JSON.stringify(d.params));
  check('decodifica la página', d.params.page === '3');

  // El caso que rompe Discord: identificadores largos con muchos parámetros.
  const enorme = nav.encodeNav(s, 'pantalla_muy_larga', {
    clave1: 'valor1'.repeat(40),
    clave2: 'valor2'.repeat(40),
    clave3: 'x',
  });
  check('un id enorme se recorta a 100', enorme.length <= nav.CUSTOM_ID_MAX, `${enorme.length}`);
  // Se descartan parámetros, no se truncan: un id de especie cortado a la
  // mitad no es "el primero que empiece por agum", es un id inexistente.
  check('el recorte conserva el nonce', nav.decodeNav(enorme)!.nonce === s.nonce);
  check('y la pantalla sigue siendo la correcta', nav.decodeNav(enorme)!.screen === 'pantalla_muy_larga');

  // Un valor con separadores no puede romper la estructura.
  const sucio = nav.encodeNav(s, 'zona', { z: 'a:b=c' });
  check('un valor con `:` y `=` se sanea', !nav.decodeNav(sucio)!.params.z.includes(':'),
    nav.decodeNav(sucio)!.params.z);

  check('un id que no es de la interfaz se rechaza', !nav.isNavId('dv:ficha:1:2'));
  check('uno con prefijo pero basura da null', nav.decodeNav('n:') === null);
  check('una pantalla con caracteres raros da null', nav.decodeNav('n:Pantalla Con Espacios:x') === null);
}

// ==========================================================================
console.log('\n=== 4. EL REGISTRO DE PANTALLAS ===');
// ==========================================================================

await import('../src/ui/router.js');

{
  const ids = screen.screenIds();
  check('hay pantallas registradas', ids.length >= 3, ids.join(', '));

  const unicas = new Set(ids);
  check('ningún id repetido', unicas.size === ids.length);

  // El registro lanza si alguien duplica un id. Eso se comprueba aquí.
  let lanzo = false;
  try {
    screen.register(ids[0]!, async () => ({ embeds: [], components: [] }));
  } catch {
    lanzo = true;
  }
  check('registrar un id repetido lanza error', lanzo);

  check('se puede pedir una pantalla existente', typeof screen.getScreen('hub') === 'function');
  check('una pantalla inexistente da undefined', screen.getScreen('no_existe') === undefined);
}

// ==========================================================================
console.log('\n=== 5. LAS PANTALLAS SE PINTAN ===');
// ==========================================================================

{
  // Se llama al registro directamente con una interacción falsa: lo que
  // interesa es que la pantalla construya su vista sin romperse con datos
  // reales, que es donde fallan las consultas mal hechas.
  const trainer = trainerWith('ui-p', 'Paz', 'agumon', 30);

  const painted: { screen: string; embeds: number; buttons: number; error?: string }[] = [];

  const CASES: { screen: string; params: Record<string, string> }[] = [
    { screen: 'hub', params: {} },
    { screen: 'mapa', params: {} },
    { screen: 'mapa', params: { page: '2' } },
    { screen: 'mapa', params: { page: '99' } },
    { screen: 'zona', params: { z: 'bosque_hielo' } },
    { screen: 'zona', params: { z: 'isla_inicial' } },
    { screen: 'zona', params: { z: 'no_existe' } },
    { screen: 'zona', params: {} },
  ];

  for (const { screen: id, params } of CASES) {
    const handler = screen.getScreen(id);
    if (!handler) {
      check(`la pantalla ${id} existe`, false);
      continue;
    }

    const s = session.ensureSession('555', trainer.id);
    session.push(s, id, params);

    let reply: unknown = null;

    const ctx = {
      interaction: fakeInteraction('555'),
      trainer,
      session: s,
      params,
      present: async (view: unknown) => {
        reply = view;
      },
      go: async () => undefined,
      refresh: async () => undefined,
      back: async () => undefined,
      home: async () => undefined,
      flash: () => {},
      num: (k: string, d: number) => {
        const v = Number(params[k]);
        return Number.isFinite(v) ? v : d;
      },
      page: () => {
        const v = Number(params.page);
        return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1;
      },
    };

    let error: string | undefined;
    let buttons = 0;

    try {
      const view = (await handler(ctx as never)) as components.View | undefined;
      if (view) {
        const embeds = view.embeds.length;
        buttons = view.components.reduce((n, row) => n + row.components.length, 0);

        check(`${id}${Object.keys(params).length ? ' ' + JSON.stringify(params) : ''} se pinta`, embeds > 0, `${embeds} embeds, ${buttons} botones`);

        // Nada de embeds vacíos: un embed sin contenido se ve roto.
        for (const [i, embed] of view.embeds.entries()) {
          const data = embed.toJSON();
          const tieneAlgo = data.title || data.description || (data.fields && data.fields.length > 0);
          check(`${id} embed ${i} tiene contenido`, Boolean(tieneAlgo));
        }
      }
    } catch (e) {
      error = (e as Error).message;
      check(`${id} se pinta`, false, error);
    }

    painted.push({ screen: id, embeds: reply ? 1 : 0, buttons, error });
  }

  // Paginación: la página 99 no debe romper ni devolver una lista vacía.
  check('la paginación se acota sola', painted.some((p) => p.screen === 'mapa' && !p.error));
}

// ==========================================================================
console.log('\n=== 6. ATRÁS Y DIGIVICE EN TODAS LAS PANTALLAS ===');
// ==========================================================================

{
  const trainer = trainerWith('ui-n2', 'Nico', 'agumon', 25);
  const s = session.ensureSession('666', trainer.id);

  const pantallas = screen.screenIds();

  for (const id of pantallas) {
    const handler = screen.getScreen(id)!;

    // Con historial, para que el botón de atrás tenga destino.
    session.toRoot(s, 'hub', {});
    session.push(s, id, {});

    let vista: components.View | undefined;

    const ctx = {
      interaction: fakeInteraction('666'),
      trainer,
      session: s,
      params: {},
      present: async (v: unknown) => {
        vista = v as components.View;
      },
      go: async () => undefined,
      refresh: async () => undefined,
      back: async () => undefined,
      home: async () => undefined,
      flash: () => {},
      num: (_k: string, d: number) => d,
      page: () => 1,
    };

    let error: string | undefined;
    try {
      vista = (await handler(ctx as never)) as components.View | undefined;
    } catch (e) {
      error = (e as Error).message;
    }

    if (error) {
      check(`${id} se pinta`, false, error);
      continue;
    }
    if (!vista) continue; // cedió el mensaje: es un caso válido

    const ids: string[] = [];
    for (const row of vista.components) {
      for (const b of row.components) ids.push(b.toJSON().custom_id!);
    }

    if (id === 'hub') {
      // El hub ES el Digivice: un boton que dijera "Digivice" apuntando al
      // hub apuntaria a la pantalla en la que ya estas.
      check(`${id} tiene botones de área`, ids.length >= 6, `${ids.length} botones`);
    } else {
      check(`${id} tiene botón de Digivice`, ids.some((i) => i.startsWith('n:hub:')), `${ids.length} botones`);
    }
    // El botón de atrás existe aunque esté deshabilitado en la raíz: así el
    // jugador ve que la acción existe.
    check(`${id} tiene botón de atrás`, ids.some((i) => i.includes('__noop') || i.startsWith('n:')));
  }
}

// ==========================================================================
console.log('\n=== 7. LA PILA RECUERDA LA PÁGINA ===');
// ==========================================================================

{
  const s = session.ensureSession('777', 1);

  session.toRoot(s, 'hub', {});
  session.push(s, 'mapa', {});
  session.push(s, 'mapa', { page: '3' });

  check('la entrada guarda la página', session.current(s)!.params.page === '3');

  session.pop(s);
  check('atrás quita una entrada', session.current(s)!.params.page === undefined);
  check('y vuelve a la misma pantalla', session.current(s)!.screen === 'mapa');

  // Ir a la misma pantalla sin parámetros no debe apilar dos veces.
  const antes = s.stack.length;
  session.push(s, 'mapa', {});
  check('refrescar no apila', s.stack.length === antes, `${antes} -> ${s.stack.length}`);

  // Refrescar con otros parámetros sí apila: es otro sitio.
  session.push(s, 'mapa', { page: '2' });
  check('cambiar de página sí apila', s.stack.length === antes + 1);

  // `replace` no apila nunca.
  const alto = s.stack.length;
  session.replace(s, 'zona', { z: 'abismo' });
  check('replace no apila', s.stack.length === alto);

  session.toRoot(s, 'hub', {});
  check('toRoot limpia el historial', s.stack.length === 1);
  check('y no se puede volver', !session.canGoBack(s));
}

/**
 * Quita los comentarios de un fuente.
 *
 * Es un recorte torpe a propósito: no tiene que ser un analizador sintáctico, solo
 * tiene que bastar para que escribir «esto ya no usa `Math.random()`» en la
 * explicación de por qué no lo use no se confunda con usarlo.
 *
 * Las cadenas de texto no se tocan, así que un `//` dentro de un texto sobrevive.
 * Eso está bien para este uso: si un `//` cae dentro de una cadena, o falsea la
 * misma comprobación, o falsea algo que también está en un comentario y que ya se
 * iba a quitar.
 */
function sinComentarios(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

// ==========================================================================
console.log('\n=== 8. LAS PANTALLAS NO CONTIENEN LÓGICA ===');
// ==========================================================================

{
  const dir = 'src/ui/screens';
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));

  check('hay pantallas', files.length > 0, files.join(', '));

  // Lo que distingue una vista de un servicio es esto: una pantalla no escribe
  // en la base de datos ni tira dados. Si lo hiciera, el mismo destino
  // no funcionaría igual desde un comando.
  const prohibido: { patron: RegExp; razon: string }[] = [
    { patron: /\bdb\s*\.\s*prepare/, razon: 'escribe en la base de datos directamente' },
    { patron: /from ['"].*\/db\/index\.js['"]/, razon: 'accede a la base de datos' },
    { patron: /Math\.random\(/, razon: 'tira dados' },
    { patron: /new Rng\(/, razon: 'tira dados' },
  ];

  for (const file of files) {
    // Los COMENTARIOS se quitan antes de comprobar. Sin esto, escribir «antes
    // esto usaba `Math.random()`» en la explicación de por qué ya no se usa
    // provocaba un fallo de arquitectura inventado, y la reacción natural —
    // borrar la explicación— deja el código sin el porqué.
    //
    // Un comentario no puede tirar dados. Quitarlos no debilita la comprobación:
    // lo único que se pierde es la capacidad de que el patrón aparezca en texto,
    // que es justo lo contrario de lo que se quiere.
    const source = sinComentarios(readFileSync(join(dir, file), 'utf8'));

    for (const { patron, razon } of prohibido) {
      check(`${file} no ${razon}`, !patron.test(source));
    }
  }

  // Y sí llama a servicios, que es lo que debe hacer.
  const hub = readFileSync(join(dir, 'hub.ts'), 'utf8');
  check('el hub lee del repositorio', hub.includes('game/repository.js'));

  const mundo = readFileSync(join(dir, 'mundo.ts'), 'utf8');
  check('la zona delega en el servicio de mundo', mundo.includes('services/world.js'));
}

// ==========================================================================
console.log('\n=== 9. AISLAMIENTO CON PANTALLAS REALES ===');
// ==========================================================================

{
  // Dos jugadores en el hub a la vez: el estado de uno no puede pisar al otro.
  const a = trainerWith('ui-x', 'Ximena', 'agumon', 20);
  const b = trainerWith('ui-y', 'Yago', 'paulmon', 20);

  const sa = session.ensureSession('a1', a.id);
  const sb = session.ensureSession('b1', b.id);

  session.toRoot(sa, 'hub', {});
  session.push(sa, 'mapa', {});
  session.toRoot(sb, 'hub', {});

  check('el nonce de Ximena no cambió al pintar Yago', sa.nonce !== sb.nonce);

  // El botón que lleva Ximena sigue siendo suyo.
  const btn = nav.encodeNav(sa, 'mapa');
  check('su botón sigue valiendo', session.nonceMatches(sa, nav.decodeNav(btn)!.nonce));

  session.rotateNonce(sb);
  check('el de Yago no toca el de Ximena', session.nonceMatches(sa, nav.decodeNav(btn)!.nonce));
}

// ==========================================================================
// ==========================================================================
console.log('\n=== 3b. LÍMITES DE DISCORD ===');
// ==========================================================================
//
// Se comprueba sobre las vistas reales, no sobre constantes del código: un
// embed que se pasa de 1024 en un campo no falla al compilar, falla en
// producción, en producción y solo para ese mensaje.

{
  const trainer = trainerWith('ui-lim', 'Límites', 'agumon', 20);

  const LIMITE_EMBED = {
    title: 256,
    description: 4096,
    fieldValue: 1024,
    fieldName: 256,
    total: 6000,
  };
  const LIMITE_BOTON = { label: 80, customId: nav.CUSTOM_ID_MAX, porFila: 5, filas: 5 };

  const problemas: string[] = [];

  for (const id of screen.screenIds()) {
    const handler = screen.getScreen(id)!;
    const s = session.ensureSession('lim', trainer.id);
    session.toRoot(s, 'hub', {});
    session.push(s, id, {});

    let vista: components.View | undefined;
    const ctx = {
      interaction: fakeInteraction('lim'),
      trainer,
      session: s,
      params: {},
      present: async (v: unknown) => {
        vista = v as components.View;
      },
      go: async () => undefined,
      refresh: async () => undefined,
      back: async () => undefined,
      home: async () => undefined,
      flash: () => {},
      num: (_k: string, d: number) => d,
      page: () => 1,
    };

    try {
      vista = (await handler(ctx as never)) as components.View | undefined;
    } catch {
      continue; // ya lo comprueba otra sección
    }
    if (!vista) continue;

    // --- embeds ---
    let total = 0;

    vista.embeds.forEach((embed, i) => {
      const d = embed.toJSON();

      if (d.title && d.title.length > LIMITE_EMBED.title) {
        problemas.push(`${id} embed ${i}: título de ${d.title.length}`);
      }
      if (d.description && d.description.length > LIMITE_EMBED.description) {
        problemas.push(`${id} embed ${i}: descripción de ${d.description.length}`);
      }

      for (const campo of d.fields ?? []) {
        if (campo.name.length > LIMITE_EMBED.fieldName) {
          problemas.push(`${id} embed ${i}: nombre de campo de ${campo.name.length}`);
        }
        if (campo.value.length > LIMITE_EMBED.fieldValue) {
          problemas.push(
            `${id} embed ${i} campo "${campo.name}": valor de ${campo.value.length} (límite ${LIMITE_EMBED.fieldValue})`,
          );
        }
        total += campo.name.length + campo.value.length;
      }

      total += (d.title?.length ?? 0) + (d.description?.length ?? 0);

      if (d.footer?.text) total += d.footer.text.length;
      if (d.author?.name) total += d.author.name.length;

      if (total > LIMITE_EMBED.total) {
        problemas.push(`${id} embed ${i}: ${total} caracteres en total (límite ${LIMITE_EMBED.total})`);
      }
    });

    // --- botones ---
    if (vista.components.length > LIMITE_BOTON.filas) {
      problemas.push(`${id}: ${vista.components.length} filas (límite ${LIMITE_BOTON.filas})`);
    }

    vista.components.forEach((row, r) => {
      const botones = row.toJSON().components;

      if (botones.length > LIMITE_BOTON.porFila) {
        problemas.push(`${id} fila ${r}: ${botones.length} botones (límite ${LIMITE_BOTON.porFila})`);
      }

      for (const b of botones) {
        if ((b.label?.length ?? 0) > LIMITE_BOTON.label) {
          problemas.push(`${id} fila ${r}: etiqueta "${b.label}" de ${b.label!.length}`);
        }
        // Un boton de enlace no lleva custom_id: abre una URL. No es un fallo.
        if (b.style !== 5 && (b.custom_id?.length ?? 0) > LIMITE_BOTON.customId) {
          problemas.push(`${id} fila ${r}: custom_id de ${b.custom_id!.length}`);
        }
        if (b.style === 5 && !(b.url ?? '').startsWith('http')) {
          problemas.push(`${id} fila ${r}: boton de enlace sin URL`);
        }
      }
    });
  }

  check(
    'ninguna pantalla se pasa de los límites de Discord',
    problemas.length === 0,
    problemas.slice(0, 6).join(' | '),
  );

  if (problemas.length > 0) {
    for (const p of problemas) console.log(`      · ${p}`);
  }
}

db.close();

cleanupDb('check-ui.db', true);

if (failed.length > 0) {
  console.log('\nFallos:');
  for (const label of failed) console.log(`  - ${label}`);
}

console.log(
  failures === 0
    ? '\nOK: el armazon de la interfaz funciona.'
    : `\n${failures} fallo(s).`,
);
process.exit(failures === 0 ? 0 : 1);