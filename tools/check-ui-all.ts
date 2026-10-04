// Recorre TODAS las pantallas registradas y las pinta con datos reales.
//
// El verificador anterior solo miraba hub, mapa y zona, que es donde se
// concentra el uso. Pero el fallo real de una GUI no está en las pantallas que
// se miran todos los días: está en la de "historial de PvP" o la de "regresión",
// que nadie abre hasta que ya la necesita y entonces se rompe.
//
// Aquí se pintan todas, con los datos de apoyo que haría un jugador de verdad.
process.env.DISCORD_TOKEN ??= 'fake';
process.env.DISCORD_CLIENT_ID ??= '0';
process.env.DATABASE_PATH = './data/check-ui-all.db';

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
cleanupDb('check-ui-all.db', false);

const repo = await import('../src/game/repository.js');
const { SPECIES, getSpecies } = await import('../src/game/species.js');
const { computeStats } = await import('../src/game/stats.js');
const { db } = await import('../src/db/index.js');
const session = await import('../src/ui/session.js');
const screen = await import('../src/ui/screen.js');

// El router importa el índice de pantallas, y eso es lo que llena el registro.
// Sin esta línea el mapa está vacío y todas las pantallas "no existen".
await import('../src/ui/router.js');

let failures = 0;
const failed: string[] = [];

function check(label: string, ok: boolean, detail = '') {
  if (!ok) {
    failures++;
    failed.push(label);
  }
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` (${detail})` : ''}`);
}

/** Una interacción falsa con lo justo para que una pantalla se pueda pintar. */
function fakeInteraction(userId: string) {
  const respuestas: unknown[] = [];
  return {
    user: { id: userId },
    message: { id: 'msg', channelId: 'chan' },
    channelId: 'chan',
    deferred: false,
    replied: false,
    isRepliable: () => true,
    reply: async (p: unknown) => {
      respuestas.push(p);
      return { resource: { message: { id: 'nuevo' } } };
    },
    editReply: async (p: unknown) => {
      respuestas.push(p);
      return { resource: { message: { id: 'nuevo' } } };
    },
    deferReply: async () => undefined,
    deferUpdate: async () => undefined,
    followUp: async () => undefined,
    respuestas,
  };
}

function ctxPara(trainerId: number, s: session.NavSession, params: Record<string, string>) {
  return {
    interaction: fakeInteraction('ui-all'),
    trainer: { id: trainerId } as never,
    session: s,
    params,
    present: async () => undefined,
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
}

// ==========================================================================
console.log('=== RECORRIDO DE TODAS LAS PANTALLAS ===');
// ==========================================================================

{
  const t = repo.registerTrainer('ui-all', 'Recorredor', SPECIES.agumon!);

  // Un equipo varied: distintos niveles, uno en el PC, uno con equipo puesto.
  const equipo = [
    { key: 'agumon', nivel: 25 },
    { key: 'gabumon', nivel: 22 },
    { key: 'paulmon', nivel: 20 },
  ];

  for (const [i, e] of equipo.entries()) {
    const d = repo.createDigimon(t.id, getSpecies(e.key)!, e.nivel, ['impacto']);
    d.level = e.nivel;
    d.stats = computeStats(d.species.base, e.nivel);
    repo.saveDigimon(d);
    repo.setLeader(t.id, d.id);
    void i;
  }

  const lider = repo.getLeader(t.id)!;
  repo.giveDigibytes(t.id, 40_000);
  for (const k of ['pocion', 'tonico', 'capsula', 'nucleo_datos', 'cromonizador', 'espectro_digimon']) {
    repo.addItem(t.id, k, 12);
  }

  // Un Digimon en el PC, para que `pc` y `mover` tengan algo que hacer.
  const enPc = repo.createDigimon(t.id, getSpecies('betamon')!, 15, ['impacto']);
  enPc.level = 15;
  enPc.stats = computeStats(enPc.species.base, 15);
  repo.saveDigimon(enPc);
  repo.depositToPC(t.id, enPc.id);

  // Piezas de equipo, para que `equipo`, `forja` y `ficha_gear` no estén vacías.
  const { buyGear } = await import('../src/game/gearRepo.js');
  for (const key of ['hoja_rustica', 'chaleco_roto', 'chip_datos']) {
    buyGear(t.id, key);
  }
  const { equipItem } = await import('../src/game/gearRepo.js');
  equipItem(t.id, lider.id, 'hoja_rustica');

  // Bestiario: un par de especies vistas, para que no todo salga como `???`.
  const { markSeen, markCaught } = await import('../src/game/dexRepo.js');
  markSeen(t.id, 'gabumon');
  markCaught(t.id, 'agumon');
  markSeen(t.id, 'greymon');

  // Progreso: que haya misiones y logros en curso.
  for (let i = 0; i < 3; i++) repo.saveBattleResult(t.id, true);
  repo.markBossBeaten(t.id, 'jefe_voltaje');

  // PvP: un rival más, para el matchmaking.
  const rival = repo.registerTrainer('ui-all-rival', 'Rival', SPECIES.gabumon!);
  const rd = repo.createDigimon(rival.id, getSpecies('gabumon')!, 20, ['impacto']);
  rd.level = 20;
  rd.stats = computeStats(rd.species.base, 20);
  repo.saveDigimon(rd);
  repo.setLeader(rival.id, rd.id);

  const { recordMatch } = await import('../src/game/pvpRepo.js');
  recordMatch({
    matchId: 'ui-pm-1',
    trainerA: t.id,
    trainerB: rival.id,
    winnerId: t.id,
    loserId: rival.id,
    reason: 'jugado',
    roundsA: 2,
    roundsB: 0,
  });

  const s = session.ensureSession('ui-all', t.id);

  // Casos: cada pantalla con los parámetros que necesitaría en uso real.
  const CASOS: { screen: string; params: Record<string, string> }[] = [
    { screen: 'hub', params: {} },
    { screen: 'mapa', params: {} },
    { screen: 'mapa', params: { page: '2' } },
    { screen: 'mapa', params: { page: '99' } },
    { screen: 'zona', params: { z: 'isla_inicial' } },
    { screen: 'zona', params: { z: 'abismo' } },
    { screen: 'zona', params: { z: 'no_existe' } },
    { screen: 'zona', params: {} },
    { screen: 'digimon', params: {} },
    { screen: 'ficha', params: { id: String(lider.id) } },
    { screen: 'ficha', params: { id: '99999' } },
    { screen: 'ficha', params: { id: String(enPc.id) } },
    { screen: 'ficha', params: {} },
    { screen: 'pc', params: {} },
    { screen: 'pc', params: { page: '2' } },
    { screen: 'evolucion', params: {} },
    { screen: 'evo_rutas', params: { id: String(lider.id) } },
    { screen: 'evo_confirmar', params: { id: String(lider.id), ruta: '0' } },
    { screen: 'evo_confirmar', params: { id: String(lider.id), ruta: '99' } },
    { screen: 'evo_revertir', params: { id: String(lider.id) } },
    { screen: 'ficha_gear', params: { id: String(lider.id) } },
    { screen: 'ficha_gear', params: { id: String(lider.id), slot: 'arma' } },
    { screen: 'ficha_gear', params: {} },
    { screen: 'equipo', params: {} },
    { screen: 'forja', params: {} },
    { screen: 'mejorar', params: { key: 'hoja_rustica' } },
    { screen: 'mejorar', params: { key: 'no_existe' } },
    { screen: 'ciudad', params: {} },
    { screen: 'tienda', params: {} },
    { screen: 'tienda', params: { page: '2' } },
    { screen: 'tienda', params: { page: '500' } },
    { screen: 'comprar', params: { key: 'pocion' } },
    { screen: 'comprar', params: { key: 'no_existe' } },
    { screen: 'inventario', params: {} },
    { screen: 'combate', params: {} },
    { screen: 'pve', params: {} },
    { screen: 'pvp', params: {} },
    { screen: 'pvp_historial', params: {} },
    { screen: 'dungeon', params: {} },
    { screen: 'social', params: {} },
    { screen: 'perfil', params: {} },
    { screen: 'entrenadores', params: {} },
    { screen: 'entrenadores', params: { page: '2' } },
    { screen: 'lb', params: {} },
    { screen: 'registro', params: {} },
    { screen: 'bestiario', params: {} },
    { screen: 'bestiario', params: { page: '3' } },
    { screen: 'bestiario', params: { zone: 'isla_inicial' } },
    { screen: 'dex', params: { species: 'agumon' } },
    { screen: 'dex', params: { species: 'no_existe' } },
    { screen: 'misiones', params: {} },
    { screen: 'misiones', params: { which: 'semanal' } },
    { screen: 'logros', params: {} },
    { screen: 'logros', params: { hidden: '1' } },
    { screen: 'logros', params: { page: '4' } },
    { screen: 'titulos', params: {} },
    { screen: 'lider', params: { id: String(lider.id) } },
    { screen: 'mover', params: { id: String(lider.id) } },
  ];

  let pintadas = 0;
  let cedieron = 0;
  let fallaron = 0;

  for (const { screen: id, params } of CASOS) {
    const handler = screen.getScreen(id);
    if (!handler) {
      check(`${id} está registrada`, false);
      fallaron++;
      continue;
    }

    session.toRoot(s, 'hub', {});
    session.push(s, id, params);

    let vista: { embeds: unknown[]; components: { components: { toJSON(): { custom_id?: string } }[] }[] } | undefined;

    const ctx = ctxPara(t.id, s, params);

    try {
      vista = (await handler(ctx as never)) as typeof vista;
    } catch (e) {
      check(`${id} ${JSON.stringify(params)}`, false, (e as Error).message);
      fallaron++;
      continue;
    }

    // Una pantalla que devuelve `void` ha cedido el mensaje (combate). Es
    // válido, pero conviene contarlo para saber que se está probando.
    if (!vista) {
      cedieron++;
      continue;
    }

    pintadas++;

    const etiqueta = `${id} ${JSON.stringify(params)}`;

    // Ni un embed vacío.
    for (const [i, raw] of vista.embeds.entries()) {
      const data = (raw as { toJSON(): Record<string, unknown> }).toJSON();
      const tiene = data.title || data.description || (data.fields as unknown[])?.length > 0;
      check(`${etiqueta} · embed ${i} tiene contenido`, Boolean(tiene));
    }

    // Los botones van con un id que el router pueda leer.
    const ids: string[] = [];
    for (const row of vista.components) {
      for (const b of row.components) ids.push(b.toJSON().custom_id ?? '');
    }

    // Un botón de enlace abre una URL y no lleva `custom_id`: no lo despacha el
    // router, lo abre el cliente. Solo los que llevan destino tienen que cumplir
    // el formato.
    const botones = vista.components.flatMap((r) => r.components.map((b) => b.toJSON()));
    const navegables = botones.filter((b) => b.style !== 5);
    const enlaces = botones.filter((b) => b.style === 5);

    check(
      `${etiqueta} · botones navegables con destino`,
      navegables.every((b) => (b.custom_id ?? '').length > 0),
    );
    check(
      `${etiqueta} · botones de enlace con URL`,
      enlaces.every((b) => (b.url ?? '').startsWith('http')),
      `${enlaces.length} enlace(s)`,
    );
    check(
      `${etiqueta} · destinos válidos`,
      // `n:` para botones de navegación, `sel:` para selects de menú.
      navegables.every((b) => /^(n|sel):/.test(b.custom_id ?? '')),
      navegables
        .map((b) => b.custom_id ?? '')
        .filter((i) => i && !i.startsWith('n:'))
        .slice(0, 2)
        .join(', '),
    );
  }

  console.log('');
  check('todas las pantallas pintan', fallaron === 0, `${pintadas} pintadas, ${cedieron} cedieron el mensaje`);
  check('hubo pantallas pintadas', pintadas > 40, `${pintadas}`);
}

// ==========================================================================
console.log('\n=== DESTINOS: TODOS EXISTEN ===');
// ==========================================================================

{
  // Un botón que apunta a una pantalla inexistente es un callejón sin salida:
  // el jugador pulsa y no pasa nada.
  const ids = screen.screenIds();

  // Extraer todos los destinos de los custom_id del recorrido anterior.
  const destinos = new Set<string>();
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');

  for (const file of readdirSync('src/ui/screens').filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(join('src/ui/screens', file), 'utf8');
    for (const m of source.matchAll(/encodeNav\(session,\s*'([a-z_]+)'/g)) destinos.add(m[1]!);
    for (const m of source.matchAll(/screen:\s*'([a-z_]+)'/g)) destinos.add(m[1]!);
  }

  const faltan = [...destinos].filter((d) => !ids.includes(d));
  check('ningún botón apunta a una pantalla inexistente', faltan.length === 0, faltan.join(', '));
  check('hay destinos que comprobar', destinos.size > 25, `${destinos.size}`);

  // Y las áreas del hub abren pantallas que existen.
  const theme = await import('../src/ui/theme.js');
  for (const area of theme.AREAS) {
    check(`el área ${area.key} abre una pantalla real`, ids.includes(theme.AREA_HOME[area.key]), theme.AREA_HOME[area.key]);
  }
}

// ==========================================================================
db.close();
cleanupDb('check-ui-all.db', true);

if (failed.length > 0) {
  console.log('\nFallos:');
  for (const label of failed) console.log(`  - ${label}`);
}

console.log(
  failures === 0 ? '\nOK: todas las pantallas funcionan.' : `\n${failures} fallo(s).`,
);
process.exit(failures === 0 ? 0 : 1);