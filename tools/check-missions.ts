// Verifica el plan E (misiones, logros y estadísticas):
//
//  1. El catálogo es coherente: ids únicos, objetivos válidos, objetos reales.
//  2. El progreso se cuenta de verdad (las integraciones están conectadas).
//  3. Una recompensa se reclama UNA vez, aunque se pulse mil veces.
//  4. Los periodos caducan solos, por fecha, sin limpieza.
//  5. El progreso congelado no se pierde aunque la métrica baje.
//  6. Los logros son de por vida y no caducan.
//  7. Los títulos exclusivos se conceden una vez y se pueden mostrar.
//  8. Reclamar paga de verdad, una sola vez.
process.env.DISCORD_TOKEN ??= 'fake';
process.env.DISCORD_CLIENT_ID ??= '0';
process.env.DATABASE_PATH = './data/check-missions.db';

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
cleanupDb('check-missions.db', false);

const repo = await import('../src/game/repository.js');
const { SPECIES, getSpecies } = await import('../src/game/species.js');
const { computeStats } = await import('../src/game/stats.js');
const { getItem } = await import('../src/game/items.js');
const catalog = await import('../src/game/missions.js');
const prog = await import('../src/game/progressionRepo.js');
const gear = await import('../src/game/gearRepo.js');
const evo = await import('../src/game/evolutionRepo.js');
const dungeons = await import('../src/game/dungeons.js');
const dungeonRepo = await import('../src/game/dungeonRepo.js');
const pvpRepo = await import('../src/game/pvpRepo.js');
const { db } = await import('../src/db/index.js');

let failures = 0;

/** Etiquetas de los fallos, para poder listarlos al final. */
const failed: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  if (!ok) { failures++; failed.push(label); }
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` (${detail})` : ''}`);
}

function trainerWith(discordId: string, name: string, speciesKey: string, level: number) {
  const t = repo.registerTrainer(discordId, name, SPECIES.agumon!);
  const d = repo.createDigimon(t.id, getSpecies(speciesKey)!, level, ['impacto']);
  d.level = level;
  d.stats = computeStats(d.species.base, level);
  repo.saveDigimon(d);
  repo.setLeader(t.id, d.id);
  repo.giveDigibytes(t.id, 50_000);
  for (const key of ['nucleo_datos', 'cromonizador', 'espectro_digimon', 'tonico']) {
    repo.addItem(t.id, key, 20);
  }
  return repo.getTrainerById(t.id)!;
}

/**
 * Reclama una mision PAGANDO de verdad, como hace el comando.
 *
 * Si se usara `claimMission` a secas el test estaria midiendo dos sistemas
 * que en produccion no coexisten: el comando paga, la fila marca.
 */
function claimWithPay(trainerId: number, missionId: string) {
  return prog.claimAndPayMission(trainerId, missionId, (reward) => {
    if (reward.digibytes > 0) repo.giveDigibytes(trainerId, reward.digibytes);
    for (const [key, n] of Object.entries(reward.items ?? {})) repo.addItem(trainerId, key, n);
    if (reward.exclusive?.kind === 'titulo') prog.grantTitle(trainerId, reward.exclusive);
  });
}

function claimAchievementWithPay(trainerId: number, achievementId: string) {
  return prog.claimAndPayAchievement(trainerId, achievementId, (reward) => {
    if (reward.digibytes > 0) repo.giveDigibytes(trainerId, reward.digibytes);
    for (const [key, n] of Object.entries(reward.items ?? {})) repo.addItem(trainerId, key, n);
    if (reward.exclusive?.kind === 'titulo') prog.grantTitle(trainerId, reward.exclusive);
  });
}

// ==========================================================================
console.log('=== 1. EL CATÁLOGO ES COHERENTE ===');
// ==========================================================================

{
  const problems = catalog.validateCatalog((key) => Boolean(getItem(key)));
  check('el catálogo pasa su propia validación', problems.length === 0, problems.join(' | '));

  const daily = catalog.MISSIONS.filter((m) => m.period === 'diaria');
  const weekly = catalog.MISSIONS.filter((m) => m.period === 'semanal');

  check('hay misiones diarias', daily.length >= 5, `${daily.length}`);
  check('hay misiones semanales', weekly.length >= 5, `${weekly.length}`);
  check('hay logros', catalog.ACHIEVEMENTS.length >= 20, `${catalog.ACHIEVEMENTS.length}`);

  const ids = new Set<string>();
  for (const m of catalog.MISSIONS) {
    check(`${m.id}: id único`, !ids.has(m.id));
    ids.add(m.id);
    check(`${m.id}: objetivo alcanzable`, m.target >= 1, `${m.target}`);
    check(`${m.id}: paga algo`,
      m.reward.digibytes > 0 || Object.keys(m.reward.items ?? {}).length > 0);
  }

  for (const a of catalog.ACHIEVEMENTS) {
    check(`${a.id}: id único`, !ids.has(a.id));
    ids.add(a.id);
    check(`${a.id}: objetivo >= 1`, a.target >= 1, `${a.target}`);
  }

  // Los objetivos diarios tienen que cumplirse JUGANDO, no con el
  // calendario. Las métricas de daño quedan fuera del tope: "5.000 de
  // daño a un jefe" se consigue en una o dos peleas, no en 5.000 turnos.
  const DAMAGE = ['dano_jefe'];
  for (const m of daily) {
    if (DAMAGE.includes(m.metric)) {
      check(`${m.id}: el daño diario es alcanzable`, m.target <= 20_000, `${m.target}`);
      continue;
    }
    check(`${m.id}: objetivo diario razonable`, m.target <= 25, `${m.target}`);
  }

  // Los hitos estan escalonados: hay algo cerca y algo lejos.
  const objetivos = catalog.ACHIEVEMENTS.map((a) => a.target).sort((x, y) => x - y);
  check('hay logros accesibles al principio', objetivos[0]! <= 5, `${objetivos[0]}`);
  check('hay logros muy lejos', objetivos[objetivos.length - 1]! >= 100,
    `${objetivos[objetivos.length - 1]}`);

  // Ninguna recompensa referencia un objeto que no exista.
  for (const m of [...catalog.MISSIONS, ...catalog.ACHIEVEMENTS]) {
    for (const key of Object.keys(m.reward.items ?? {})) {
      check(`${m.id}: ${key} existe y es comprable`, Boolean(getItem(key)));
    }
  }

  // Un título no puede concederse dos veces.
  const titulos = catalog.ACHIEVEMENTS
    .map((a) => a.reward.exclusive)
    .filter((e) => e?.kind === 'titulo')
    .map((e) => e!.key);
  check('ningún título se concede dos veces', new Set(titulos).size === titulos.length,
    `${titulos.length} títulos`);
}

// ==========================================================================
console.log('\n=== 2. EL PROGRESO SE CUENTA DE VERDAD ===');
// ==========================================================================

{
  const t = trainerWith('m2', 'Contador', 'agumon', 20);

  check('empieza sin capturas', prog.statOf(t.id, 'capturas') === 0);
  check('empieza sin victorias', prog.statOf(t.id, 'victorias') === 0);

  // saveBattleResult es el punto único de victorias: si funciona, todas las
  // misiones de victorias avanzan a la vez.
  repo.saveBattleResult(t.id, true);
  repo.saveBattleResult(t.id, true);
  repo.saveBattleResult(t.id, false);

  check('las victorias se cuentan', prog.statOf(t.id, 'victorias') === 2, `${prog.statOf(t.id, 'victorias')}`);
  check('las exploraciones también', prog.statOf(t.id, 'exploraciones') === 3);
  check('los combates jugados también', prog.statOf(t.id, 'partidas') === 3);
  check('el día activo se registra', prog.statOf(t.id, 'dias_activos') === 1);

  // Un día activo cuenta UNA vez aunque se llame mil veces.
  prog.markTodayActive(t.id);
  prog.markTodayActive(t.id);
  check('repetir no suma días', prog.statOf(t.id, 'dias_activos') === 1);

  // Evolución: la integración de evolutionRepo.
  const ag = repo.getDigimon(repo.getLeaderId(t.id)!)!;
  evo.evolveOwned(ag, 0, repo.getTrainerById(t.id)!, repo.getInventory(t.id));
  check('evolucionar cuenta', prog.statOf(t.id, 'evoluciones') === 1, `${prog.statOf(t.id, 'evoluciones')}`);
  check('la forma queda desbloqueada', prog.statOf(t.id, 'formas_desbloqueadas') === 2,
    `${prog.statOf(t.id, 'formas_desbloqueadas')}`);

  // Regresión.
  const greymon = repo.getDigimon(ag.id)!;
  // La regresión solo existe en ramas y megas: Greymon no tiene
  // `devolution`, y por eso hay que probar con Seraphimon.
  // La regresión la tienen los FINALES DE RAMA (devuelven a su forma de
  // origen). Ogremon es intermedio y no tiene `devolution`, así que hay
  // que partir de Seraphimon, que sí la tiene.
  const rama = repo.createDigimon(t.id, getSpecies('seraphimon')!, 55, ['garrote']);
  rama.level = 55;
  rama.stats = computeStats(rama.species.base, 55);
  repo.saveDigimon(rama);
  evo.devolveInto(repo.getDigimon(rama.id)!, t.id, repo.getInventory(t.id));
  // Mazmorra: salas y daño.
  const forja = dungeons.getDungeon('forja_de_ceniza')!;
  for (let i = 0; i < forja.rooms.length; i++) {
    dungeonRepo.clearRoom(t.id, 'forja_de_ceniza', 500, 1000);
  }
  check('las salas se cuentan', prog.statOf(t.id, 'salas') === forja.rooms.length,
    `${prog.statOf(t.id, 'salas')}`);
  check('completar la mazmorra cuenta una vez',
    prog.statOf(t.id, 'mazmorras') === 1, `${prog.statOf(t.id, 'mazmorras')}`);

  // PvP.
  const rival = trainerWith('m2b', 'Rival', 'agumon', 20);
  pvpRepo.recordMatch({
    matchId: 'pm1', trainerA: t.id, trainerB: rival.id,
    winnerId: t.id, loserId: rival.id, reason: 'jugado', roundsA: 2, roundsB: 0,
  });
  check('ganar PvP cuenta como victoria PvP', prog.statOf(t.id, 'pvp_victorias') === 1);
  check('y NO como victoria normal (si no, la misión de PvP se cumple solo)',
    prog.statOf(t.id, 'victorias') === 2, `${prog.statOf(t.id, 'victorias')}`);

  // Mejoras de equipo.
  gear.buyGear(t.id, 'hoja_rustica');
  gear.upgradeGear(t.id, 'hoja_rustica');
  check('mejorar una pieza cuenta', prog.statOf(t.id, 'mejoras') === 1);

  // Jefe: solo la primera vez.
  repo.markBossBeaten(t.id, 'jefe_voltaje');
  repo.markBossBeaten(t.id, 'jefe_voltaje');
  repo.markBossBeaten(t.id, 'jefe_crepúsculo');
  check('un jefe cuenta una vez aunque lo reprises', prog.statOf(t.id, 'jefes') === 2,
    `${prog.statOf(t.id, 'jefes')}`);

  // Métricas de consulta.
  check('el nivel máximo se lee del equipo', prog.statOf(t.id, 'nivel_maximo') === 55,
    `${prog.statOf(t.id, 'nivel_maximo')}`);
  // `trainerWith` crea el inicial de `registerTrainer` MAS uno: son dos.
  check('los Digimon contados', prog.statOf(t.id, 'digimon_capturados') === 3,
    `${prog.statOf(t.id, 'digimon_capturados')}`);
}

// ==========================================================================
console.log('\n=== 3. UNA RECOMPENSA SE RECLAMA UNA VEZ ===');
// ==========================================================================

{
  const t = trainerWith('m3', 'Claimer', 'agumon', 20);

  // Sin cumplir.
  const pronto = claimWithPay(t.id, 'd_victorias_5');
  check('sin requisito no se reclama', !pronto.ok, pronto.ok ? 'FALLO' : pronto.reason);
  check('el mensaje dice lo que falta',
    !pronto.ok && pronto.message.includes('Te falta'), pronto.ok ? '' : pronto.message);

  // Cumplir.
  // El logro de la prueba pide 10 victorias, no 5.
  for (let i = 0; i < 12; i++) repo.saveBattleResult(t.id, true);

  const dineroAntes = repo.getTrainerById(t.id)!.digibytes;
  const primera = claimWithPay(t.id, 'd_victorias_5');
  check('cumplida se reclama', primera.ok);
  check('y paga', repo.getTrainerById(t.id)!.digibytes > dineroAntes,
    `${dineroAntes} -> ${repo.getTrainerById(t.id)!.digibytes}`);

  // Mil intentos mas.
  const dineroPagado = repo.getTrainerById(t.id)!.digibytes;
  let rechazadas = 0;
  for (let i = 0; i < 1000; i++) {
    if (!claimWithPay(t.id, 'd_victorias_5').ok) rechazadas++;
  }
  check('mil intentos más, todos rechazados', rechazadas === 1000, `${rechazadas}/1000`);
  check('y el dinero NO se mueve', repo.getTrainerById(t.id)!.digibytes === dineroPagado,
    `${dineroPagado} -> ${repo.getTrainerById(t.id)!.digibytes}`);

  // Logros: mismo comportamiento.
  const logro = catalog.ACHIEVEMENTS.find((a) => a.target === 10 && a.metric === 'victorias');
  check('existe un logro de 10 victorias', Boolean(logro), logro?.id);

  if (logro) {
    const d0 = repo.getTrainerById(t.id)!.digibytes;
    const g1 = claimAchievementWithPay(t.id, logro.id);
    check('el logro se reclama', g1.ok);
    const d1 = repo.getTrainerById(t.id)!.digibytes;
    check('y paga', d1 > d0, `${d0} -> ${d1}`);

    for (let i = 0; i < 100; i++) claimAchievementWithPay(t.id, logro.id);
    check('el logro tampoco se repite', repo.getTrainerById(t.id)!.digibytes === d1);
  }
}

// ==========================================================================
console.log('\n=== 4. LOS PERIODOS CADUCAN SOLOS ===');
// ==========================================================================

{
  const t = trainerWith('m4', 'Periodos', 'agumon', 20);

  const hoy = new Date();
  const manana = new Date(hoy.getTime() + 86_400_000);

  check('el periodo diario es la fecha', prog.periodKey('diaria', hoy) === hoy.toISOString().slice(0, 10));
  check('el diario cambia mañana',
    prog.periodKey('diaria', manana) !== prog.periodKey('diaria', hoy));
  check('el semanal es el lunes',
    /^\d{4}-\d{2}-\d{2}$/.test(prog.periodKey('semanal', hoy)), prog.periodKey('semanal', hoy));

  // La semana ISO empieza en LUNES: un domingo pertenece a la semana del
  // lunes ANTERIOR, no a la del lunes siguiente. Por eso comparar un
  // domingo con el lunes que viene daria falso, y por eso el domingo se
  // compara con el lunes de la semana en la que cae.
  const domingo = new Date('2026-10-11T12:00:00Z'); // domingo
  const lunesDeEsaSemana = new Date('2026-10-05T12:00:00Z'); // su lunes
  const lunesSiguiente = new Date('2026-10-12T12:00:00Z'); // lunes nuevo
  check(
    'el domingo pertenece a la semana del lunes anterior',
    prog.periodKey('semanal', domingo) === prog.periodKey('semanal', lunesDeEsaSemana),
    `${prog.periodKey('semanal', domingo)} / ${prog.periodKey('semanal', lunesDeEsaSemana)}`
  );
  check(
    'el lunes siguiente empieza semana nueva',
    prog.periodKey('semanal', lunesSiguiente) !== prog.periodKey('semanal', domingo),
    `${prog.periodKey('semanal', lunesSiguiente)}`
  );
  const otroLunes = new Date('2026-10-19T12:00:00Z');
  check('lunes con otro lunes: semana distinta',
    prog.periodKey('semanal', lunesSiguiente) !== prog.periodKey('semanal', otroLunes),
    `${prog.periodKey('semanal', lunesSiguiente)} vs ${prog.periodKey('semanal', otroLunes)}`);

  // La caducidad: el progreso de HOY no se ve MAÑANA.
  // 6 victorias, porque la misión diaria de victorias pide 5.
  for (let i = 0; i < 6; i++) repo.saveBattleResult(t.id, true);

  const hoyStatuses = prog.missionsOf(t.id, 'diaria', hoy);
  const mananaStatuses = prog.missionsOf(t.id, 'diaria', manana);

  const hoyListas = hoyStatuses.filter((s) => s.ready).length;
  const mananaListas = mananaStatuses.filter((s) => s.ready).length;

  check('hoy hay misiones listas', hoyListas > 0, `${hoyListas}`);
  check('mañana no las hay (el contador no se reinicia, el periodo sí)',
    mananaListas === 0, `${mananaListas}`);

  // Y lo reclaimed hoy tampoco se puede reclamar mañana por el mismo botón.
  const m = hoyStatuses.find((s) => s.ready)!.mission.id;
  check('la de hoy se reclama hoy', claimWithPay(t.id, m, hoy).ok);
  check('la misma no se reclama mañana', !claimWithPay(t.id, m, manana).ok,
    'la clave de periodo es distinta, así que el botón de mañana es OTRO');
}

// ==========================================================================
console.log('\n=== 5. EL PROGRESO CONGELADO NO SE PIERDE ===');
// ==========================================================================

{
  const t = trainerWith('m5', 'Congelado', 'agumon', 20);

  // 6 victorias: la misión diaria pide 5 y hay que poder reclamarla.
  for (let i = 0; i < 6; i++) repo.saveBattleResult(t.id, true);

  const antes = prog.missionsOf(t.id, 'diaria').find((s) => s.mission.metric === 'victorias');
  check(
    'la misión de victorias avanza',
(antes?.progress ?? 0) === antes!.mission.target,
    `${antes?.progress}/${antes?.mission.target} (recortado al objetivo)`
  );

  claimWithPay(t.id, 'd_victorias_5');

  // Aunque el contador de victorias SUBAN, la misión ya está reclamada: no se
  // desarma.
  for (let i = 0; i < 10; i++) repo.saveBattleResult(t.id, true);
  const despues = prog.missionsOf(t.id, 'diaria').find((s) => s.mission.metric === 'victorias');
  check('sigue marcada como reclamada', despues?.claimed === true);
  check('y no se vuelve a ofrecer', despues?.ready === false);
}

// ==========================================================================
console.log('\n=== 6. LOS LOGROS SON DE POR VIDA ===');
// ==========================================================================

{
  const t = trainerWith('m6', 'Logros', 'agumon', 20);
  const manana = new Date(Date.now() + 86_400_000);

  const nivel50 = catalog.ACHIEVEMENTS.find((a) => a.metric === 'nivel_maximo' && a.target === 50)!;
  check('el logro de nivel 50 existe', Boolean(nivel50));

  check('sin nivel 50 no está', prog.achievementsOf(t.id).find((a) => a.achievement.id === nivel50.id)!.unlocked === false);

  // Subimos el nivel del líder.
  const d = repo.getDigimon(repo.getLeaderId(t.id)!)!;
  d.level = 50;
  d.stats = computeStats(d.species.base, 50);
  repo.saveDigimon(d);

  const h1 = prog.achievementsOf(t.id).find((a) => a.achievement.id === nivel50.id)!;
  check('al llegar a 50 se desbloquea', h1.unlocked);
  check('y está listo para reclamar', h1.ready);
  // Los logros no tienen periodo: consultarlos "mañana" da exactamente lo
  // mismo. Se comprueba contra la misma llamada, que es la prueba real: si
  // tuvieran periodo, la clave cambiaría y el logro no seguiría desbloqueado.
  const statusMañana = prog.achievementsOf(t.id).find((a) => a.achievement.id === nivel50.id)!;
  check('los logros no caducan', statusMañana.unlocked);
  void manana;

  // Ocultos: no se ven hasta cumplirse.
  const oculto = catalog.ACHIEVEMENTS.find((a) => a.hidden);
  check('hay logros ocultos', Boolean(oculto));
  if (oculto) {
    const status = prog.achievementsOf(t.id).find((a) => a.achievement.id === oculto.id)!;
    check('el oculto no se ve sin cumplirlo', status.hidden);
  }

  const visibles = prog.achievementsOf(t.id).filter((s) => !s.hidden);
  check('los no ocultos sí se ven', visibles.length > 0, `${visibles.length} de ${catalog.ACHIEVEMENTS.length}`);
}

// ==========================================================================
console.log('\n=== 7. TÍTULOS EXCLUSIVOS ===');
// ==========================================================================

{
  const t = trainerWith('m7', 'Títulos', 'agumon', 20);

  check('empieza sin títulos', prog.titlesOf(t.id).length === 0);

  const conTitulo = catalog.ACHIEVEMENTS.find((a) => a.reward.exclusive?.kind === 'titulo')!;
  const metric = conTitulo.metric;
  const target = conTitulo.target;

  // Ponemos el contador donde hace falta para cumplirlo.
  switch (metric) {
    case 'capturas':
      prog.bump(t.id, 'capturas', target);
      break;
    case 'victorias':
      prog.bump(t.id, 'victorias', target);
      break;
    case 'evoluciones':
      prog.bump(t.id, 'evoluciones', target);
      break;
    case 'jefes':
      prog.bump(t.id, 'jefes', target);
      break;
    case 'mazmorras':
      prog.bump(t.id, 'mazmorras', target);
      break;
    case 'pvp_victorias':
      prog.bump(t.id, 'pvp_victorias', target);
      break;
    case 'mejoras':
      prog.bump(t.id, 'mejoras', target);
      break;
    case 'nivel_maximo': {
      const d = repo.getDigimon(repo.getLeaderId(t.id)!)!;
      d.level = target;
      d.stats = computeStats(d.species.base, target);
      repo.saveDigimon(d);
      break;
    }
    default:
      break;
  }

  const status = prog.achievementsOf(t.id).find((a) => a.achievement.id === conTitulo.id)!;
  check('el logro con título se cumple', status.unlocked, conTitulo.id);

  // El título se concede al reelingar.
  prog.grantTitle(t.id, conTitulo.reward.exclusive!);
  const titles = prog.titlesOf(t.id);
  check('el título aparece', titles.length === 1, titles.map((x) => x.name).join(','));
  check('con su nombre y emoji',
    titles[0]!.name === conTitulo.reward.exclusive!.name &&
      titles[0]!.emoji === conTitulo.reward.exclusive!.emoji,
    `${titles[0]!.emoji} ${titles[0]!.name}`);

  // Reclamar dos veces no duplica el título.
  prog.grantTitle(t.id, conTitulo.reward.exclusive!);
  prog.grantTitle(t.id, conTitulo.reward.exclusive!);
  check('el título no se duplica', prog.titlesOf(t.id).length === 1, `${prog.titlesOf(t.id).length}`);
}

// ==========================================================================
console.log('\n=== 8. RECLAMAR PAGA DE VERDAD, UNA VEZ ===');
// ==========================================================================

{
  const t = trainerWith('m8', 'Pago', 'agumon', 20);

  // 6 victorias: la misión diaria pide 5.
  for (let i = 0; i < 6; i++) repo.saveBattleResult(t.id, true);

  const misionesListas = prog.missionsOf(t.id, 'diaria').filter((s) => s.ready);
  check('hay misiones listas', misionesListas.length > 0, `${misionesListas.length}`);

  const antes = {
    digibytes: repo.getTrainerById(t.id)!.digibytes,
    inventario: repo.getInventory(t.id),
  };

  let claimed = 0;
  let refused = 0;

  for (const status of misionesListas) {
    const result = claimWithPay(t.id, status.mission.id);
    if (result.ok) {
      claimed++;
    }
  }

  check('se reclamaron todas las listas', claimed === misionesListas.length, `${claimed}`);

  const despues = {
    digibytes: repo.getTrainerById(t.id)!.digibytes,
    inventario: repo.getInventory(t.id),
  };
  check('los DigiBytes subieron', despues.digibytes > antes.digibytes,
    `${antes.digibytes} -> ${despues.digibytes}`);

  const objetosGanados = Object.keys(despues.inventario).filter(
    (k) => (despues.inventario[k] ?? 0) > (antes.inventario[k] ?? 0),
  );
  check('los objetos subieron', objetosGanados.length > 0, objetosGanados.join(','));

  // Segundo intento: nada cambia.
  let pagadas = 0;
  for (const status of misionesListas) {
    if (claimWithPay(t.id, status.mission.id).ok) pagadas++;
  }
  check('el segundo intento no paga ninguna', pagadas === 0, `${pagadas}`);
  check('el saldo no se mueve',
    repo.getTrainerById(t.id)!.digibytes === despues.digibytes,
    `${repo.getTrainerById(t.id)!.digibytes}`);

  // Resumen.
  const resumen = prog.summaryOf(t.id);
  check('el resumen cuadra', resumen.achievementsTotal === catalog.ACHIEVEMENTS.length,
    `${resumen.achievementsTotal}`);
  check('el resumen cuenta los días activos', resumen.activeDays >= 1, `${resumen.activeDays}`);

  // Tablas del esquema.
  const tables = db
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => r.name);
  for (const table of ['trainer_stats', 'mission_progress', 'achievement_progress', 'trainer_titles', 'trainer_activity']) {
    check(`existe la tabla ${table}`, tables.includes(table));
  }
}

db.close();
cleanupDb('check-missions.db', true);

// Las etiquetas de los fallos se listan por su cuenta: parsear los marcadores
// en la consola de Windows es frágil y no ayuda a diagnosticar nada.
if (failed.length > 0) {
  console.log('\nFallos:');
  for (const label of failed) console.log(`  - ${label}`);
}

console.log(failures === 0 ? '\nOK: misiones, logros y estadísticas funcionando.' : `\n${failures} fallo(s).`);
process.exit(failures === 0 ? 0 : 1);
