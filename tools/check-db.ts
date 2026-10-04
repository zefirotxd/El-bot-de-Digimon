// Prueba de humo del repositorio: registro, captura, progresión, party y PC.
// No necesita token de Discord: usa una base de datos temporal.
process.env.DISCORD_TOKEN ??= 'fake';
process.env.DISCORD_CLIENT_ID ??= '0';
process.env.DATABASE_PATH = './data/check-db.db';

import { rmSync } from 'node:fs';
cleanupDb('check-db.db', false);

const repo = await import('../src/game/repository.js');
const { SPECIES } = await import('../src/game/species.js');
const { rollEncounter, rollRewards } = await import('../src/game/progression.js');
const { grantExp, createBattle, resolveTurn, switchTo } = await import('../src/game/combat.js');
const { Rng } = await import('../src/game/random.js');
const { expToNextLevel, computeStats } = await import('../src/game/stats.js');
const { evolveOwned } = await import('../src/game/evolutionRepo.js');
const { config } = await import('../src/config.js');

let failures = 0;
function check(label: string, condition: boolean, detail = '') {
  const mark = condition ? '✓' : '✗';
  console.log(`  ${mark} ${label}${detail ? ` (${detail})` : ''}`);
  if (!condition) failures++;
}

// ---------------------------------------------------------------- registro --
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

console.log('=== REGISTRO Y CAPTURA ===');
const trainer = repo.registerTrainer('user-1', 'TestUser', SPECIES.agumon!);
console.log(`entrenador #${trainer.id} con ${trainer.digibytes} DigiBytes`);

const roster0 = repo.listParty(trainer.id);
check('el inicial entra en el equipo', roster0.length === 1, roster0[0]!.species.name);
check('el inicial es el líder', repo.getLeaderId(trainer.id) === roster0[0]!.id);
check('el PC empieza vacío', repo.countPCSlots(trainer.id) === 0);

const captured = repo.createDigimon(trainer.id, SPECIES.greymon!, 12, ['impacto', 'lanza_llamas']);
check('capturar añade al equipo', repo.countPartySlots(trainer.id) === 2);

// --------------------------------------------------------------- progresión --
console.log('\n=== PROGRESIÓN Y EVOLUCIÓN ===');
const ag = repo.listParty(trainer.id).find((d) => d.species.key === 'agumon')!;
const needed = Array.from({ length: 11 }, (_, i) => expToNextLevel(i + 1)).reduce((a, b) => a + b, 0);
const up = grantExp(ag, needed, repo.makePersister());

console.log(`  Agumon Nv.${up!.fromLevel} -> Nv.${up!.toLevel}`);
check('el nivel sube', up!.toLevel === 12, `Nv.${up!.toLevel}`);
check('subir de nivel NO evoluciona', up!.evolvedTo === null);
check('la especie no cambia sola', repo.getDigimon(ag.id)!.species.key === 'agumon');
check('los stats se escalan con el nivel', repo.getDigimon(ag.id)!.stats.hp === ag.stats.hp);

// La evolución ahora es explícita: se pide la ruta y se cobra.
const result = evolveOwned(ag, 0, repo.getTrainerById(trainer.id)!, repo.getInventory(trainer.id));
check('la evolución explícita funciona', result.ok, result.ok ? result.to : result.message);

const reread = repo.getDigimon(ag.id)!;
check('la evolución se persiste', reread.species.key === 'greymon', `Nv.${reread.level}`);
check('los stats son los de la nueva especie',
  reread.stats.hp === computeStats(SPECIES.greymon!.base, reread.level).hp);
check('el atributo sigue a la nueva especie', reread.species.attribute === 'virus');

// -------------------------------------------------------------- party / PC --
console.log('\n=== PARTY Y PC ===');
for (const key of ['angemon', 'ogremon', 'kunemon', 'betamon']) {
  const d = repo.createDigimon(trainer.id, SPECIES[key]!, 15, ['impacto']);
  repo.depositToPC(trainer.id, d.id);
}
const spare = repo.createDigimon(trainer.id, SPECIES.goburimon!, 5, ['impacto'], 'pc');

let party = repo.listParty(trainer.id);
let pc = repo.listPC(trainer.id);
console.log(`  equipo ${party.length}/${config.maxPartySize} · PC ${pc.length}/${config.pcCapacity}`);
console.log(`  equipo: ${party.map((d) => `#${d.id}${d.id === repo.getLeaderId(trainer.id) ? '*' : ''} ${d.species.name}`).join(', ')}`);
console.log(`  PC: ${pc.map((d) => `#${d.id} ${d.species.name}`).join(', ')} (* = líder)`);

check('el PC no cuenta como equipo activo', party.every((d) => d.storage === 'party'));
check('los depositados están en el PC', pc.every((d) => d.storage === 'pc'));
check('createDigimon respeta el storage pedido', spare.storage === 'pc');

// Llenar el equipo hasta el límite de verdad, para poder probar el rechazo.
while (repo.countPartySlots(trainer.id) < config.maxPartySize) {
  const d = repo.createDigimon(trainer.id, SPECIES.goburimon!, 5, ['impacto']);
  check(`relleno: ${d.species.name} entra al equipo (${repo.countPartySlots(trainer.id)}/${config.maxPartySize})`, true);
}

const overLimit = repo.withdrawFromPC(trainer.id, pc[0]!.id);
check('con el equipo lleno no se deja sacar otro', !overLimit.ok, overLimit.ok ? '' : overLimit.reason);

const movable = party.find((d) => d.id !== repo.getLeaderId(trainer.id))!;
const stored = repo.depositToPC(trainer.id, movable.id);
check('guardar en el PC funciona', stored.ok);
check('el líder no cambia al guardar a otro', repo.getLeaderId(trainer.id) === party[0]!.id);

// Con un hueco libre ahora sí debe dejar sacar.
const pulled = repo.withdrawFromPC(trainer.id, pc[0]!.id);
check('sacar del PC funciona cuando hay sitio', pulled.ok);
check('el equipo vuelve a estar lleno', repo.countPartySlots(trainer.id) === config.maxPartySize);

// Al llevar al líder al PC, otro debe asumir el liderazgo.
const leaderId = repo.getLeaderId(trainer.id)!;
repo.depositToPC(trainer.id, leaderId);
check('el líder cambia si el anterior va al PC', repo.getLeaderId(trainer.id) !== leaderId);
check('el equipo nunca queda vacío', repo.countPartySlots(trainer.id) >= 1);

for (const d of repo.listParty(trainer.id)) repo.depositToPC(trainer.id, d.id);
check('nunca se puede vaciar el equipo', repo.countPartySlots(trainer.id) >= 1);

const ghost = repo.withdrawFromPC(trainer.id, 99999);
check('un id inexistente se rechaza', !ghost.ok, ghost.ok ? '' : ghost.reason);

const crossUser = repo.withdrawFromPC(repo.registerTrainer('user-2', 'Otro', SPECIES.paulmon!).id, captured.id);
check('no se puede tocar el Digimon de otro usuario', !crossUser.ok);

// Reponer para las pruebas siguientes.
repo.withdrawFromPC(trainer.id, roster0[0]!.id);
repo.setLeader(trainer.id, roster0[0]!.id);

// ------------------------------------------------------------- encuentros ---
console.log('\n=== ENCUENTROS Y RECOMPENSAS ===');
for (const level of [3, 10, 20, 35, 60]) {
  const e = rollEncounter(level, new Rng(level));
  const r = rollRewards(e.species, e.level, new Rng(level + 1));
  console.log(`  Nv.${level}: ${e.species.emoji} ${e.species.name} Nv.${e.level} -> ${r.exp} EXP, ${r.digibytes} DB`);
}

// ---------------------------------------------------------------- combate ---
console.log('\n=== COMBATE ===');
// El equipo debe estar al mismo nivel que el rival para que el combate sea
// equilibrado; si el líder cae, hay que cambiar (como en el juego real).
for (const d of repo.listParty(trainer.id)) {
  d.level = 20;
  d.stats = computeStats(d.species.base, 20);
  repo.saveDigimon(d);
}

const foe = rollEncounter(20, new Rng(77));
const battle = createBattle(repo.listParty(trainer.id), 0, foe.species, foe.level);
const rng = new Rng(1);
let turns = 0;
let switches = 0;

while (!battle.finished && turns < 200) {
  if (battle.awaitingSwitch) {
    const reserve = battle.party.findIndex((d, i) => i !== battle.activeIndex);
    if (reserve === -1) break;
    switchTo(battle, battle.party[reserve]!.id);
    switches++;
    continue;
  }
  const move = battle.player.moves.find((m) => m.energyCost <= battle.player.energy)!;
  resolveTurn(battle, { type: 'movimiento', move }, rng);
  turns++;
}

console.log(
  `  ${battle.player.name} Nv.${battle.player.level} vs ${foe.species.name} Nv.${foe.level}: ` +
    `${battle.result} en ${turns} turnos${switches ? ` y ${switches} cambio(s)` : ''}`,
);
check('el combate termina', battle.finished);
check('el resultado es coherente', ['victoria', 'derrota', 'huida'].includes(battle.result!));
check(
  'el atributo del luchador viene de su especie',
  battle.player.attribute === SPECIES[battle.player.speciesKey]!.attribute,
);
console.log(`  log: ${battle.log.slice(-2).join(' | ')}`);

// ---------------------------------------------------------------- descanso --
repo.restTeam(trainer.id);
check('descansar cura a todos', repo.listDigimon(trainer.id).every((d) => d.hp === d.stats.hp));

const { db } = await import('../src/db/index.js');
db.close();
cleanupDb('check-db.db', true);

console.log(
  failures === 0
    ? '\nOK: base de datos, progresión y party/PC funcionan.'
    : `\n${failures} comprobación(es) fallida(s).`,
);
process.exit(failures === 0 ? 0 : 1);
