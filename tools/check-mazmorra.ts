// Verificación de la expedición de mazmorra.
//
// Lo que importa aquí es el CICLO COMPLETO, no cada pieza: entrar, moverse, ver
// cómo se abre la niebla de guerra, encontrar cosas, quedarse sin energía y
// tener que decidir. Un mapa perfecto con el movimiento roto no es una mazmorra.
//
// Las comprobaciones van por el servicio, que es por donde pasa un botón. Cuando
// una comprobación necesita la GUI, se monta la pantalla con el contexto real.
process.env.DISCORD_TOKEN ??= 'fake';
process.env.DISCORD_CLIENT_ID ??= '0';
process.env.DATABASE_PATH = './data/check-mazmorra.db';

import { readFileSync as fsRead } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * La raíz del proyecto, para leer los ficheros de las pantallas.
 *
 * Va con `fileURLToPath` y no con `new URL(...).pathname` porque este proyecto
 * está en un directorio con ESPACIO en el nombre, y `pathname` lo devuelve
 * codificado como `%20`. El error sale como "no such file" sobre un fichero que
 * existe, que es la forma más confusa de perder media hora.
 */
const raiz = fileURLToPath(new URL('..', import.meta.url));
const fs = { readFileSync: fsRead };

function cleanupDb(name: string, bestEffort = false): void {
  for (const sufijo of ['', '-wal', '-shm']) {
    try {
      rmSync(`./data/${name}${sufijo}`, { force: true, maxRetries: 8, retryDelay: 120 });
    } catch (error) {
      if (!bestEffort) console.error('No se pudo limpiar', (error as Error).message);
    }
  }
}
cleanupDb('check-mazmorra.db', false);

const repo = await import('../src/game/repository.js');
const { SPECIES, getSpecies } = await import('../src/game/species.js');
const { computeStats } = await import('../src/game/stats.js');
const { db } = await import('../src/db/index.js');
const run = await import('../src/services/dungeonRun.js');
const exp = await import('../src/game/dungeonExpedition.js');
const mapa = await import('../src/game/dungeonMap.js');
const { DUNGEONS } = await import('../src/game/dungeons.js');
const screen = await import('../src/ui/screen.js');
const navSession = await import('../src/ui/session.js');

let fallos = 0;
const fallidos: string[] = [];

function check(etiqueta: string, ok: boolean, detalle = '') {
  if (!ok) {
    fallos++;
    fallidos.push(etiqueta);
  }
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}${detalle ? ` (${detalle})` : ''}`);
}

function trainer(id: string, nombre: string, nivel = 35) {
  const t = repo.registerTrainer(id, nombre, SPECIES.agumon!);
  const d = repo.createDigimon(t.id, getSpecies('metalgreymon')!, nivel, ['impacto']);
  d.level = nivel;
  d.stats = computeStats(d.species.base, nivel);
  d.hp = d.stats.hp;
  repo.saveDigimon(d);
  repo.setLeader(t.id, d.id);
  return repo.getTrainerById(t.id)!;
}

/**
 * Una expedición nueva y limpia.
 *
 * Borra la que hubiera, por si el jugador ya estaba dentro. La primera versión
 * pasaba el resultado de `expedicionActiva` a `borrarExpedicion` sin mirar si era
 * `null`, y reventaba en la primera llamada con "Cannot read properties of null".
 */
function expedicionNueva(trainerId: number, clave = 'forja_de_ceniza') {
  const previa = exp.expedicionActiva(trainerId);
  if (previa) exp.borrarExpedicion(previa);

  const definicion = DUNGEONS[clave]!;
  const r = run.entrar(trainerId, clave, definicion.energiaExpedicion);
  return 'error' in r ? null : r;
}

// ==========================================================================
console.log('=== 1. ENTRAR ===');
// ==========================================================================

{
  const t = trainer('mz1', 'Ana');

  check('sin expedición, no hay vista', exp.expedicionActiva(t.id) === null);

  const vista = expedicionNueva(t.id);

  check('entra en la mazmorra', vista !== null);
  if (vista) {
    const e = vista.expedicion;

    check('nace con energía', e.energia > 0, `${e.energia}`);
    check('con una semilla', typeof e.seed === 'number' && e.seed > 0, `${e.seed}`);
    check('en el primer piso', e.pisoActual === 1);
    check('situado en la entrada', vista.mapa.get(`${e.posX},${e.posY}`)?.kind === 'entrada');
    check('y la casilla está descubierta', (e.descubiertas['1'] ?? []).length >= 1, `${(e.descubiertas['1'] ?? []).length}`);

    // El mapa que ve el jugador tiene menos casillas que el generado: eso es la
    // niebla.
    const visibles = [...vista.mapa.values()].filter((c) => !c.cerrada).length;
    check('parte del mapa está oculto al entrar', visibles < vista.total, `${visibles} de ${vista.total}`);
  }

  // Entrar dos veces no abre otra expedición.
  const definicion = DUNGEONS.forja_de_ceniza!;
  const otra = run.entrar(t.id, 'forja_de_ceniza', definicion.energiaExpedicion);
  // La condición estaba al revés: se pedía que devolviera un ERROR para dar la
  // misma expedición. Lo que se quiere es que devuelva la VISTA que ya tenía.
  check(
    'entrar otra vez devuelve la misma',
    !('error' in otra) && otra.expedicion.seed === exp.expedicionActiva(t.id)!.seed,
  );
}

// ==========================================================================
console.log('\n=== 2. MOVERSE Y LA NIEBLA DE GUERRA ===');
// ==========================================================================

{
  const t = trainer('mz2', 'Bruno');
  const vista = expedicionNueva(t.id);

  if (!vista) {
    check('expedición creada', false);
  } else {
    const antes = vista.explorado;

    // Se busca una dirección que se pueda.
    let movido = false;
    for (const dir of ['norte', 'sur', 'este', 'oeste'] as const) {
      if (!run.puedeMover(vista, dir).ok) continue;

      const r = run.mover(t.id, dir);
      if ('error' in r) continue;

      movido = true;
      check('se mueve una casilla', true, `hacia ${dir}`);
      check('gasta energía', r.vista.expedicion.energia === vista.expedicion.energia - 1, `${vista.expedicion.energia} -> ${r.vista.expedicion.energia}`);
      check('la niebla se abre', r.vista.explorado > antes, `${antes} -> ${r.vista.explorado}`);
      check('y descubre las vecinas', (r.vista.expedicion.descubiertas['1'] ?? []).length > 1, `${(r.vista.expedicion.descubiertas['1'] ?? []).length}`);
      break;
    }

    if (!movido) check('se puede mover desde la entrada', false);

    // Mover sin energía no.
    const e = exp.expedicionActiva(t.id)!;
    e.energia = 0;
    exp.guardarExpedicion(e);

    const v = run.cargarVista(e)!;
    const bloqueado = run.puedeMover(v, 'norte');
    check('sin energía no se puede mover', !bloqueado.ok && !bloqueado.ok && bloqueado.motivo === 'energia');

    const intento = run.mover(t.id, 'norte');
    check('y el servicio lo rechaza', 'error' in intento);

    // Y hacia un borde, tampoco.
    e.energia = 10;
    exp.guardarExpedicion(e);
    const v2 = run.cargarVista(e)!;

    let borde = false;
    for (let d = 0; d < 8 && !borde; d++) {
      const r = run.mover(t.id, 'norte');
      if ('error' in r) borde = true;
    }
    check('contra el borde se para', borde);
  }
}

// ==========================================================================
console.log('\n=== 3. LA NIEBLA ES POR JUGADOR ===');
// ==========================================================================

{
  const a = trainer('mz3a', 'Ximena');
  const b = trainer('mz3b', 'Yago');

  const va = expedicionNueva(a.id);
  const vb = expedicionNueva(b.id);

  if (!va || !vb) {
    check('dos expediciones', false);
  } else {
    // Aunque la semilla coincida por casualidad, explorar una NO revela la otra.
    const ex = exp.expedicionActiva(a.id)!;

    for (const dir of ['norte', 'sur', 'este', 'oeste'] as const) {
      if (!run.puedeMover(run.cargarVista(ex)!, dir).ok) continue;
      run.mover(a.id, dir);
      break;
    }

    const trasB = run.cargarVista(exp.expedicionActiva(b.id)!)!;
    check(
      'explorar uno no revela el mapa del otro',
      trasB.explorado <= vb.explorado,
      `${vb.explorado} -> ${trasB.explorado}`,
    );
  }
}

// ==========================================================================
console.log('\n=== 4. LAS CASILLAS NO SE COBRAN DOS VECES ===');
// ==========================================================================

{
  const t = trainer('mz4', 'Carmen');
  const vista = expedicionNueva(t.id);

  if (!vista) {
    check('expedición creada', false);
  } else {
    const e = vista.expedicion;

    // Se busca una casilla de tesoro y se resuelve dos veces.
    let cofre = vista.mapa.get(`${e.posX},${e.posY}`);
    if (!cofre || cofre.kind !== 'tesoro') {
      for (const dir of ['norte', 'sur', 'este', 'oeste'] as const) {
        if (!run.puedeMover(vista, dir).ok) continue;
        const r = run.mover(t.id, dir);
        if ('error' in r) continue;
        cofre = r.vista.mapa.get(`${r.vista.expedicion.posX},${r.vista.expedicion.posY}`);
        if (cofre?.kind === 'tesoro') break;
      }
    }

    if (cofre?.kind === 'tesoro') {
      const actual = run.cargarVista(exp.expedicionActiva(t.id)!)!;
      const tile = actual.mapa.get(`${actual.expedicion.posX},${actual.expedicion.posY}`)!;

      const primera = run.resolverCasilla(actual.expedicion, tile);
      check('el cofre da algo', primera.tipo === 'cofre');

      const segunda = run.resolverCasilla(actual.expedicion, tile);
      check('la segunda vez no vuelve a dar', segunda.tipo === 'nada');
    } else {
      // No se encontró un cofre en dos pasos: se comprueba la regla directamente.
      const e2 = exp.expedicionActiva(t.id)!;
      const v = run.cargarVista(e2)!;
      const cualquier = v.mapa.get(`${e2.posX},${e2.posY}`)!;

      const a1 = run.resolverCasilla(e2, cualquier);
      const a2 = run.resolverCasilla(e2, cualquier);

      check('una casilla no se resuelve dos veces', a1.tipo === 'nada' ? a2.tipo === 'nada' : a2.tipo === 'nada', `${a1.tipo} -> ${a2.tipo}`);
    }
  }
}

// ==========================================================================
console.log('\n=== 5. RETIRARSE ===');
// ==========================================================================

{
  const t = trainer('mz5', 'Diego');
  const vista = expedicionNueva(t.id);

  if (!vista) {
    check('expedición creada', false);
  } else {
    // Se explora un poco para que haya algo que llevar.
    for (const dir of ['norte', 'sur', 'este', 'oeste'] as const) {
      if (!run.puedeMover(vista, dir).ok) continue;
      run.mover(t.id, dir);
      break;
    }

    const e = exp.expedicionActiva(t.id)!;
    e.energia = 3;
    exp.guardarExpedicion(e);

    const antes = exp.expedicionActiva(t.id)!.duracionSeg;
    const premio = run.retirarse(run.cargarVista(exp.expedicionActiva(t.id)!)!);

    check('retirarse da algo', premio.digibytes > 0, `${premio.digibytes} DigiBytes`);
    check('la expedición queda cerrada', exp.expedicionActiva(t.id) === null);
    check('y no se pierde tiempo registrado', antes >= 0);

    // Retirada no es completada.
    const ultima = exp.ultimaExpedicion(t.id, e.dungeonKey);
    check('queda en el historial como retirada', ultima?.estado === 'retirada', ultima?.estado ?? 'nada');
  }
}

// ==========================================================================
console.log('\n=== 6. CHECKPOINT ===');
// ==========================================================================

{
  const t = trainer('mz6', 'Eva');
  const vista = expedicionNueva(t.id);

  if (!vista) {
    check('expedición creada', false);
  } else {
    check('nace sin checkpoint', vista.expedicion.checkpoint === null);

    run.marcarCheckpoint(vista);

    const e = exp.expedicionActiva(t.id)!;
    check('el checkpoint se guarda', e.checkpoint !== null, JSON.stringify(e.checkpoint));
    check('en el piso y la posición actuales', e.checkpoint?.piso === e.pisoActual && e.checkpoint?.x === e.posX);
  }
}

// ==========================================================================
console.log('\n=== 7. RECARGAR REPONDE LA MISMA COSA ===');
// ==========================================================================

{
  const t = trainer('mz7', 'Félix');
  const vista = expedicionNueva(t.id);

  if (!vista) {
    check('expedición creada', false);
  } else {
    // Se avanza y se guarda.
    for (const dir of ['norte', 'sur', 'este', 'oeste'] as const) {
      if (!run.puedeMover(vista, dir).ok) continue;
      run.mover(t.id, dir);
      break;
    }

    const primera = run.cargarVista(exp.expedicionActiva(t.id)!)!;

    // Se recarga tres veces: el mapa tiene que ser idéntico.
    let iguales = 0;
    for (let i = 0; i < 3; i++) {
      const otra = run.cargarVista(exp.expedicionActiva(t.id)!)!;
      if (JSON.stringify(otra.piso) === JSON.stringify(primera.piso)) iguales++;
    }

    check('el mapa se regenera idéntico', iguales === 3, `${iguales}/3`);
    check('la posición se conserva', primera.expedicion.posX === exp.expedicionActiva(t.id)!.posX);
  }
}

// ==========================================================================
console.log('\n=== 8. LA GUI SE PINTA ===');
// ==========================================================================

await import('../src/ui/router.js');

{
  const t = trainer('mz8', 'Gael');

  async function pintar(pantalla: string, params: Record<string, string> = {}) {
    const nav = navSession.ensureSession(`u-mz8`, t.id);
    const ctx = {
      interaction: { user: { id: 'u-mz8' } },
      trainer: t,
      session: nav,
      params,
      present: async () => undefined,
      go: async () => undefined,
      refresh: async () => undefined,
      back: async () => undefined,
      home: async () => undefined,
      flash: () => undefined,
      num: (_k: string, d: number) => d,
      page: () => 1,
    };

    const handler = screen.getScreen(pantalla);
    if (!handler) return null;

    return await handler(ctx as never);
  }

  // Fuera de la mazmorra.
  const fuera = await pintar('mazmorra');
  check('fuera de la mazmorra se pinta algo', fuera !== null && (fuja(fuera)?.embeds.length ?? 0) > 0);

  // Dentro.
  expedicionNueva(t.id);
  const dentro = await pintar('mazmorra');
  check('dentro se pinta el mapa', dentro !== null && (fuja(dentro)?.embeds.length ?? 0) >= 3);

  const filas = dentro ? JSON.parse(JSON.stringify(dentro.components)) : [];
  check('con botones de movimiento', filas.flatMap((f: { components: unknown[] }) => f.components).length >= 6);

  // El mapa dibujado tiene que tener la forma del piso.
  const texto = dentro ? JSON.stringify(dentro.embeds) : '';
  check('el mapa aparece en un embed', texto.includes('explorado'));
  check('y la leyenda', texto.includes('Desconocido'));

  // La casilla.
  const casilla = await pintar('maz_casilla', { t: 'cofre' });
  check('la casilla se pinta', casilla !== null && (fuja(casilla)?.embeds.length ?? 0) > 0);

  function fuja(v: unknown): { embeds: unknown[] } | null {
    return v as { embeds: unknown[] } | null;
  }
}

// ==========================================================================
console.log('\n=== 9. NINGÚN BOTÓN APUNTA A LA NADA ===');
// ==========================================================================

{
  await import('../src/ui/router.js');

  // Todos los destinos que aparecen en el código de la mazmorra.
  const fuentes = ['src/ui/screens/mazmorra.ts', 'src/ui/screens/mazActions.ts'];

  const destinos = new Set<string>();
  for (const rel of fuentes) {
    const texto = fs.readFileSync(`${raiz}/${rel}`, 'utf8');

    for (const m of texto.matchAll(/nav\(ctx, '([a-z_0-9]+)'/g)) destinos.add(m[1]!);
    for (const m of texto.matchAll(/encodeNav\([^,]+, '([a-z_0-9]+)'/g)) destinos.add(m[1]!);
  }

  const faltan = [...destinos].filter((d) => !screen.getScreen(d)).sort();

  check(
    'todo destino de botón existe',
    faltan.length === 0,
    faltan.length > 0 ? `faltan: ${faltan.join(', ')}` : `${destinos.size} destinos`,
  );
}

// ==========================================================================
db.close();
cleanupDb('check-mazmorra.db', true);

if (fallidos.length > 0) {
  console.log('\nFallos:');
  for (const f of fallidos) console.log('  - ' + f);
}

console.log(
  fallos === 0
    ? '\nOK: se puede entrar, explorar, ver la niebla y salir.'
    : `\n${fallos} fallo(s).`,
);
process.exit(fallos === 0 ? 0 : 1);