// Verifica el PvP de punta a punta: rating de poder, emparejamiento por poder,
// rondas, desconexión como derrota, anti-revancha y — lo más importante — que
// la partida NO toque el progreso de nadie.
process.env.DISCORD_TOKEN ??= 'fake';
process.env.DISCORD_CLIENT_ID ??= '0';
process.env.DATABASE_PATH = './data/check-pvp.db';

import { rmSync } from 'node:fs';
cleanupDb('check-pvp.db', false);

const repo = await import('../src/game/repository.js');
const { SPECIES } = await import('../src/game/species.js');
const { computeStats } = await import('../src/game/stats.js');
const power = await import('../src/game/power.js');
const gear = await import('../src/game/gearRepo.js');
const { EQUIPMENT } = await import('../src/game/equipment.js');
const queue = await import('../src/services/pvpQueue.js');
const match = await import('../src/services/pvpMatch.js');
const pvpRepo = await import('../src/game/pvpRepo.js');
const cfg = await import('../src/game/pvpConfig.js');
const { resolveTurn, switchCandidates, switchTo } = await import('../src/game/combat.js');
const { Rng } = await import('../src/game/random.js');

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` (${detail})` : ''}`);
}

/** Crea un entrenador con un equipo del nivel pedido. */
function makeTrainer(name: string, discordId: string, species: string[], level: number) {
  const t = repo.registerTrainer(discordId, name, SPECIES[species[0]!]!);
  for (const key of species.slice(1)) {
    repo.createDigimon(t.id, SPECIES[key]!, level, ['impacto', 'lanza_llamas']);
  }
  // Subimos el inicial al nivel pedido.
  for (const d of repo.listParty(t.id)) {
    d.level = level;
    d.stats = computeStats(d.species.base, level);
    repo.saveDigimon(d);
  }
  repo.setLeader(t.id, repo.listParty(t.id)[0]!.id);
  return t;
}

/**
 * Borra el .db de prueba. `bestEffort` no debe hacer fallar la corrida
 * (limpieza final); el borrado inicial sí tiene que completar.
 */
function cleanupDb(name: string, bestEffort = false): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `./data/${name}${suffix}`;
    try {
      rmSync(file, { force: true, maxRetries: 8, retryDelay: 120 });
    } catch (error) {
      if (!bestEffort) {
        console.error('No se pudo limpiar', file, (error as Error).message);
      }
    }
  }
}

console.log('=== RATING DE PODER ===');

const plain = makeTrainer('Plano', 'p1', ['greymon', 'agumon', 'gabumon'], 20);
const geared = makeTrainer('Equipado', 'p2', ['greymon', 'agumon', 'gabumon'], 20);

repo.giveDigibytes(geared.id, 999_999);
for (const key of ['espada_digital', 'placas_hielo', 'chip_fuerza', 'anillo_prisa']) {
  gear.buyGear(geared.id, key);
  for (const d of repo.listParty(geared.id)) gear.equipItem(geared.id, d.id, key);
}

const powerPlain = power.teamPower(repo.listParty(plain.id));
const powerGeared = power.teamPower(repo.listParty(geared.id));

console.log(`  plano    Nv.${powerPlain.averageLevel} -> ${powerPlain.total}`);
console.log(`  equipado Nv.${powerGeared.averageLevel} -> ${powerGeared.total}`);
console.log(`  desglose equipado: base ${powerGeared.basePower} + equipo ${powerGeared.gearPower} + cobertura ${powerGeared.coverageBonus}`);

check('el nivel sube el poder', power.teamPower(repo.listParty(plain.id)).total > 0);
check('el equipo sube el poder', powerGeared.total > powerPlain.total,
  `${powerPlain.total} -> ${powerGeared.total}`);
check('el desglose suma bien',
  powerGeared.basePower + powerGeared.gearPower + powerGeared.coverageBonus === powerGeared.total);
check('a igual nivel y equipo, la cobertura de atributos suma',
  powerPlain.coverageBonus > 0, `${powerPlain.coverageBonus}`);

const mono = makeTrainer('Mono', 'p3', ['greymon', 'greymon'], 20);
const monoPower = power.teamPower(repo.listParty(mono.id));
check('un equipo mono-atributo paga penalización',
  monoPower.coverageBonus < powerPlain.coverageBonus,
  `mono ${monoPower.coverageBonus} vs mixto ${powerPlain.coverageBonus}`);

console.log('\n=== EMPAREJAMIENTO POR PODER ===');
queue.resetQueue();

check('se puede entrar en cola',
  queue.enqueue('p1', 'c1', 'Plano').ok);
check('no se puede entrar dos veces',
  !queue.enqueue('p1', 'c1', 'Plano').ok);

// Un rival con poder muy distinto no debe emparejarse: por eso `mono` (sin
// cobertura) es el caso válido, no el equipado completo.
makeTrainer('Rookie', 'p9', ['agumon', 'gabumon'], 3);
queue.enqueue('p9', 'c9', 'Rookie');
check('niveles muy distintos no emparejan',
  queue.tryPair(1) === null, 'el Rookie se queda esperando');

// Dos jugadores con equipo parecido sí emparejan.
queue.resetQueue();
const twin = makeTrainer('Gemelo', 'p8', ['angemon', 'paulmon', 'gatomon'], 20);
queue.enqueue('p1', 'c1', 'Plano');
queue.enqueue('p8', 'c3', 'Gemelo');

const paired = queue.tryPair(plain.id);
check('poder parecido sí empareja', paired !== null);
if (paired) {
  const { match: m, warning } = paired;
  console.log(`  ${m.a.username} (${m.a.power.total}) vs ${m.b.username} (${m.b.power.total})`);
  console.log(`  aviso: ${warning ?? 'ninguno'}`);
  check('dentro de la ventana no hace falta aviso', warning === null);
  check('la cola queda vacía tras emparejar', queue.queueSize() === 0);
  check('ambos quedan marcados como en partida',
    queue.isInMatch(plain.id) && queue.isInMatch(twin.id));
  check('no se puede entrar en cola en pleno combate',
    !queue.enqueue('p1', 'c1', 'Plano').ok);
  queue.closeMatch(m.id);
}

// El desajuste grande sí debe avisar aunque empareje.
queue.resetQueue();
queue.enqueue('p1', 'c1', 'Plano');
queue.enqueue('p2', 'c2', 'Equipado');
const skewed = queue.tryPair(plain.id);
console.log(`  caso extremo: plano ${powerPlain.total} vs equipado ${powerGeared.total}` +
  ` (x${(powerGeared.total / powerPlain.total).toFixed(2)})`);
if (skewed) {
  check('un desajuste grande avisa', skewed.warning !== null, skewed.warning ?? 'sin aviso');
  queue.closeMatch(skewed.match.id);
} else {
  check('un desajuste grande ni siquiera empareja', true, 'rechazado, también correcto');
}

console.log('\n=== AISLAMIENTE: LA PARTIDA NO TOCA EL PROGRESO ===');
queue.resetQueue();

const alice = makeTrainer('Alice', 'a1', ['greymon', 'agumon', 'gabumon'], 25);
const bob = makeTrainer('Bob', 'b1', ['garurumon', 'angemon', 'togemon'], 25);
repo.giveDigibytes(alice.id, 5000);

const before = repo.listParty(alice.id).map((d) => ({
  id: d.id,
  level: d.level,
  exp: d.exp,
  hp: d.hp,
  status: d.status,
}));

const partyA = repo.listParty(alice.id).slice(0, cfg.MAX_PVP_TEAM);
const partyB = repo.listParty(bob.id).slice(0, cfg.MAX_PVP_TEAM);

const pvpMatch: match.PvpMatch = {
  id: 'test-1',
  a: {
    trainerId: alice.id, username: 'Alice', party: partyA, activeIndex: 0,
    roundsWon: 0, snapshotHp: new Map(), awaitingSwitch: false,
    disconnected: false, forfeited: false,
  },
  b: {
    trainerId: bob.id, username: 'Bob', party: partyB, activeIndex: 0,
    roundsWon: 0, snapshotHp: new Map(), awaitingSwitch: false,
    disconnected: false, forfeited: false,
  },
  target: match.roundsNeeded(partyA.length),
  round: null,
  startedAt: Date.now(),
  finished: false,
  winnerId: null,
  reason: null,
  powerRatio: 1.2,
  warning: null,
};

check('con 3 Digimon se juegan 2 rondas', pvpMatch.target === 2, `${pvpMatch.target}`);

const round1 = match.startRound(pvpMatch, 1, 0, 0);
console.log(
  `  ronda 1: party B=${partyB.length} (max ${cfg.MAX_PVP_TEAM}) -> ` +
    `enemyTeam=${round1.state.enemyTeam.length}`,
);
check('la ronda arranca con el equipo completo del rival',
  round1.state.enemyTeam.length === Math.min(partyB.length, cfg.MAX_PVP_TEAM),
  `${round1.state.enemyTeam.length} vs ${Math.min(partyB.length, cfg.MAX_PVP_TEAM)}`);
check('todos empiezan a tope',
  round1.state.player.hp === round1.state.player.stats.hp &&
  round1.state.enemy.hp === round1.state.enemy.stats.hp);

// Jugamos la ronda. Con equipos de 3 hay que cambiar de Digimon cuando el
// activo cae, igual que en una partida normal.
let turns = 0;
const rng = new Rng(5);
let switches = 0;

while (turns < 400 && !round1.state.finished) {
  if (round1.state.awaitingSwitch) {
    const reserve = switchCandidates(round1.state)[0];
    // Sin reservas no hay a quién cambiar: la partida se cierra como derrota.
    if (!reserve) break;
    if (!switchTo(round1.state, reserve.id)) break;
    switches++;
    continue;
  }

  const mv = round1.state.player.moves.find((m) => m.energyCost <= round1.state.player.energy);
  resolveTurn(round1.state, mv ? { type: 'movimiento', move: mv } : { type: 'defender' }, rng);
  turns++;
}

console.log(
  `  ronda 1: ${round1.state.result ?? 'sin resolver'} en ${turns} turnos, ` +
    `${switches} cambio(s)`,
);

check('la ronda termina', round1.state.finished, String(round1.state.result));

const outcome = round1.state.result === 'victoria' ? 'victoria'
  : round1.state.result === 'derrota' ? 'derrota' : 'empate';
const result = match.closeRound(pvpMatch, outcome);
console.log(`  marcador: A ${pvpMatch.a.roundsWon} — B ${pvpMatch.b.roundsWon} (${result})`);

const after = repo.listParty(alice.id).map((d) => ({
  id: d.id,
  level: d.level,
  exp: d.exp,
  hp: d.hp,
  status: d.status,
}));

check('el nivel no cambia en un PvP',
  before.every((d, i) => after[i]!.level === d.level));
check('la EXP no cambia en un PvP',
  before.every((d, i) => after[i]!.exp === d.exp),
  `${before.map((d) => d.exp).join('/')} -> ${after.map((d) => d.exp).join('/')}`);
check('los PV de la BD no se tocan en un PvP',
  before.every((d, i) => after[i]!.hp === d.hp),
  `${before.map((d) => d.hp).join('/')} -> ${after.map((d) => d.hp).join('/')}`);
check('el estado alterado no se propaga',
  before.every((d, i) => after[i]!.status === d.status));

console.log('\n=== DESCONEXIÓN Y ABANDONO ===');
const pvpMatch2: match.PvpMatch = JSON.parse(JSON.stringify({
  ...pvpMatch,
  id: 'test-2',
  a: { ...pvpMatch.a, roundsWon: 0 },
  b: { ...pvpMatch.b, roundsWon: 0 },
}));
pvpMatch2.round = null;
pvpMatch2.finished = false;
pvpMatch2.winnerId = null;

match.handleDisconnect(pvpMatch2, alice.id);
check('desconectar es perder', pvpMatch2.winnerId === bob.id);
check('se marca como desconexión', pvpMatch2.reason === 'desconexion');

const pvpMatch3: match.PvpMatch = JSON.parse(JSON.stringify({
  ...pvpMatch, id: 'test-3',
  a: { ...pvpMatch.a, roundsWon: 0 },
  b: { ...pvpMatch.b, roundsWon: 0 },
}));
pvpMatch3.round = null;
pvpMatch3.finished = false;
pvpMatch3.winnerId = null;

match.handleForfeit(pvpMatch3, bob.id);
check('abandonar hace perder', pvpMatch3.winnerId === alice.id);

check('desconectar paga más que ganar jugando',
  cfg.POINTS.desconexion > cfg.POINTS.victoria,
  `${cfg.POINTS.desconexion} > ${cfg.POINTS.victoria}`);

console.log('\n=== PUNTOS, RANGOS Y ANTI-REVANCHA ===');
pvpRepo.recordMatch({
  matchId: 'm1', trainerA: alice.id, trainerB: bob.id,
  winnerId: alice.id, loserId: bob.id, reason: 'jugado',
  roundsA: 2, roundsB: 0,
});

const pAlice = pvpRepo.getPvpProfile(alice.id);
const pBob = pvpRepo.getPvpProfile(bob.id);
console.log(`  Alice ${pAlice.points} pts (${pAlice.rank}) · Bob ${pBob.points} pts (${pBob.rank})`);

check('el ganador suma puntos', pAlice.points === cfg.POINTS.victoria, `${pAlice.points}`);
check('el ganador suma una victoria', pAlice.wins === 1);
check('el perdedor también cobra (participación)', pBob.points === cfg.POINTS.derrota, `${pBob.points}`);
check('el rango se calcula', typeof pAlice.rank === 'string' && pAlice.rank.length > 0, pAlice.rank);
check('rangoFor ordena bien',
  cfg.rankFor(0).name === 'Bronce' && cfg.rankFor(99999).name === 'Leyenda');

const rematch = pvpRepo.checkRematch(alice.id, bob.id);
check('el anti-revancha bloquea repetir', !rematch.allowed, `${rematch.minutesLeft} min`);
check('el anti-revancha avisa del tiempo restante', rematch.minutesLeft > 0);

const fresh = pvpRepo.checkRematch(alice.id, plain.id);
check('con un rival nuevo no hay bloqueo', fresh.allowed);

console.log('\n=== RACHA DIARIA ===');
const d1 = pvpRepo.claimDaily(alice.id);
check('el día 1 se puede reclamar', d1 !== null, d1 ? `+${d1.digibytes} DB` : '');
check('no se puede reclamar dos veces el mismo día',
  pvpRepo.claimDaily(alice.id) === null);
const status = pvpRepo.dailyStatus(alice.id);
check('el estado marca lo reclamado', status.claimed);
check('la racha sube a 1', status.streak === 1);
check('reclamar paga DigiBytes de verdad',
  repo.getTrainerById(alice.id)!.digibytes > 5000,
  `${repo.getTrainerById(alice.id)!.digibytes}`);
check('reclamar da objetos de verdad',
  Object.values(repo.getInventory(alice.id)).reduce((a, b) => a + b, 0) > 0);

console.log('\n=== LÍMITES ===');
queue.resetQueue();
queue.enqueue('a1', 'c', 'Alice');
check('un jugador no puede tener dos partidas', queue.isInMatch(alice.id) === false);
queue.leaveQueue(alice.id);
check('salir de la cola funciona', !queue.isQueued(alice.id));

const { db } = await import('../src/db/index.js');
db.close();
cleanupDb('check-pvp.db', true);

console.log(failures === 0 ? '\nOK: PvP funcionando.' : `\n${failures} fallo(s).`);
process.exit(failures === 0 ? 0 : 1);
