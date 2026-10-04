// Informe de balance: simula muchos combates para ver duración, tasa de victoria
// y recompensa por nivel.
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN ?? 'fake';
process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? '0';
process.env.DATABASE_PATH = './data/balance.db';

import { rmSync } from 'node:fs';
for (const s of ['', '-wal', '-shm']) rmSync(`./data/balance.db${s}`, { force: true });

const { SPECIES, movesForLevel } = await import('../src/game/species.js');
const { createBattle, resolveTurn, chooseEnemyAction } = await import('../src/game/combat.js');
const { computeStats, expToNextLevel } = await import('../src/game/stats.js');
const { resolveMoves } = await import('../src/game/moves.js');
const { rollEncounter, rollRewards } = await import('../src/game/progression.js');
const { Rng } = await import('../src/game/random.js');
const { analyzeMatchup, ALL_ELEMENTS, ELEMENT_EMOJI } = await import('../src/game/elements.js');
const { attributeMultiplier } = await import('../src/game/attributes.js');

function owned(speciesKey: string, level: number, id: number) {
  const species = SPECIES[speciesKey]!;
  const stats = computeStats(species.base, level);
  return {
    id, trainerId: 1, species, nickname: null, level, exp: 0, stats,
    hp: stats.hp, moves: resolveMoves(movesForLevel(species, level)),
    status: 'ok' as const, caughtAt: '',
  };
}

/**
 * El "jugador" simulado juega con la MISMA política que la IA rival.
 *
 * Antes usaba "el movimiento de mayor daño pagable" y daba ~22% de victorias
 * en nivel 25, cuando el juego real da ~45%. Medía a un maniquí, no al juego.
 * Para balancear hay que medir la IA contra sí misma.
 */
function play(
  partyLevel: number,
  speciesKey: string,
  foe: ReturnType<typeof rollEncounter>,
  seed: number,
) {
  const party = [owned(speciesKey, partyLevel, 1)];
  const state = createBattle(party, 0, foe.species, foe.level);
  const rng = new Rng(seed);
  let turns = 0;

  while (!state.finished && !state.awaitingSwitch && turns < 200) {
    // Invertimos los bandos para que chooseEnemyAction decida por el jugador.
    const asEnemy = { ...state, player: state.enemy, enemy: state.player } as typeof state;
    resolveTurn(state, chooseEnemyAction(asEnemy, rng), rng);
    turns++;
  }

  return {
    turns,
    result: state.result,
    playerHp: state.player.hp,
    maxHp: state.player.stats.hp,
    log: state.log,
  };
}

console.log('=== Duración de combate vs un enemigo de nivel equivalente ===');
console.log('El equipo del jugador usa una especie YA EVOLUCIONADA acorde a su nivel,');
console.log('que es lo que tendría alguien jugando de forma normal.');
console.log('');
console.log('nivel | turnos (med | prom | min | max) | victorias | %PV');

/**
 * Especie que tendría el jugador en cada nivel empezando de `startKey`,
 * teniendo en cuenta la evolución automática. Sustituye a decir "metalgreymon"
 * a mano: si la simulación no refleja la progresión real, miente.
 */
function evolvedFor(startKey: string, level: number): string {
  let current = SPECIES[startKey]!;
  let guard = 0;
  while (current.evolution && level >= current.evolution.level && guard++ < 10) {
    current = SPECIES[current.evolution.to]!;
  }
  return current.key;
}

const STARTERS = ['agumon', 'gabumon', 'biyomon', 'paulmon', 'gatomon', 'guilmon'];

for (const level of [3, 8, 15, 25, 35, 50, 70]) {
  const turns: number[] = [];
  let wins = 0;
  const hpLeft: number[] = [];
  const winPerStarter: Record<string, string> = {};

  for (const start of STARTERS) {
    const playerSpecies = evolvedFor(start, level);
    let starterWins = 0;

    for (let i = 0; i < 30; i++) {
      const foe = rollEncounter(level, new Rng(1000 + i));
      const result = play(level, playerSpecies, foe, 2000 + i);
      turns.push(result.turns);
      if (result.result === 'victoria') {
        wins++;
        starterWins++;
        hpLeft.push(result.playerHp / result.maxHp);
      }
    }

    winPerStarter[start] = `${playerSpecies} ${starterWins}/30`;
  }

  turns.sort((a, b) => a - b);
  const median = turns[Math.floor(turns.length / 2)]!;
  const avg = (turns.reduce((a, b) => a + b, 0) / turns.length).toFixed(1);
  const pct = Math.round((wins / turns.length) * 100);
  const avgHp = hpLeft.length ? Math.round((hpLeft.reduce((a, b) => a + b, 0) / hpLeft.length) * 100) : 0;

  console.log(
    `${String(level).padStart(5)} | ${String(median).padStart(4)} | ${avg.padStart(4)} | ` +
      `${String(turns[0]).padStart(3)} | ${String(turns[turns.length - 1]).padStart(3)} | ` +
      `${String(wins).padStart(3)}/${turns.length} (${String(pct).padStart(3)}%) | ${String(avgHp).padStart(3)}%`,
  );
  console.log(
    `      | por inicial: ${STARTERS.map((s) => `${s}=${winPerStarter[s]}`).join('  ')}`,
  );
}

console.log('\n=== Un starter SIN evolucionar contra enemigos de su nivel ===');
console.log('nivel | victorias | turnos (med)');
for (const level of [8, 12, 15, 20]) {
  let wins = 0;
  const turns: number[] = [];
  for (let i = 0; i < 40; i++) {
    const foe = rollEncounter(level, new Rng(3000 + i));
    const result = play(level, 'agumon', foe, 4000 + i);
    turns.push(result.turns);
    if (result.result === 'victoria') wins++;
  }
  turns.sort((a, b) => a - b);
  console.log(
    `${String(level).padStart(5)} | ${String(wins).padStart(2)}/40 (${String(Math.round((wins / 40) * 100)).padStart(3)}%) | ${turns[Math.floor(turns.length / 2)]}`,
  );
}

console.log('\n=== Ritmo de progresión (combates por nivel) ===');
let totalBattles = 0;
let level = 1;
for (let i = 0; i < 40; i++) {
  const foe = rollEncounter(Math.min(45, level + 2), new Rng(500 + i));
  const rewards = rollRewards(foe.species, foe.level, new Rng(700 + i));
  totalBattles += rewards.exp;
  if (level < 100 && totalBattles >= expToNextLevel(level)) {
    totalBattles -= expToNextLevel(level);
    level++;
    i -= 1;
  }
}
console.log(`Al nivel ${level} tras unos 40 combates seguidos.`);

console.log('\n=== CAPA 1: triangulo de atributos ===');
for (const a of ['vacuna', 'virus', 'datos'] as const) {
  const row = ['vacuna', 'virus', 'datos'] as const;
  const cells = row.map((b) => {
    const m = attributeMultiplier(a, b);
    return `${b}: ${m > 1 ? 'ventaja' : m < 1 ? 'contra  ' : 'neutral '}`;
  });
  console.log(`  ${a.padEnd(8)} ${cells.join('  ')}`);
}

console.log('\n=== CAPA 2: afinidades elementales (ejemplos) ===');
for (const key of ['agumon', 'gabumon', 'wargreymon']) {
  const species = SPECIES[key]!;
  const weak = species.weakTo.map((e) => `${ELEMENT_EMOJI[e]}${e}`).join(' ');
  const resists = species.resists.map((e) => `${ELEMENT_EMOJI[e]}${e}`).join(' ');
  console.log(`  ${species.name.padEnd(15)} [${species.attribute}]  debil a ${weak}  |  resiste ${resists}`);
}

console.log('\n=== Rango del multiplicador total (las dos capas) ===');
let min = Infinity;
let max = -Infinity;
const speciesList = Object.values(SPECIES);
for (const a of speciesList) {
  for (const b of speciesList) {
    for (const element of ALL_ELEMENTS) {
      const m = analyzeMatchup(
        { attribute: a.attribute, species: a },
        element,
        { attribute: b.attribute, species: b },
      ).total;
      min = Math.min(min, m);
      max = Math.max(max, m);
    }
  }
}
console.log(`  minimo ${min.toFixed(2)}x   maximo ${max.toFixed(2)}x`);

const { db } = await import('../src/db/index.js');
db.close();
for (const s of ['', '-wal', '-shm']) rmSync(`./data/balance.db${s}`, { force: true });
