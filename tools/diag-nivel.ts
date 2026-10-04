// ¿La duración depende del NIVEL o de la ESPECIE?
//
// Los dos barridos anteriores confundían las dos cosas: comparaban Agumon@5 con
// Greymon@18 y con MetalGreymon@35. Si la curva de estadísticas fuera plana, la
// duración no debería depender del nivel, y sin embargo va de 11 a 71 turnos.
// O el nivel estira la pelea, o son las especies.
//
// Aquí se mide UNA sola especie a muchos niveles. Es el diagnóstico que
// separa las dos causas, y decidir sin él sería adivinar qué ajustar.
process.env.DISCORD_TOKEN ??= 'fake';
process.env.DISCORD_CLIENT_ID ??= '0';
process.env.DATABASE_PATH = './data/dbg-nivel.db';

const combat = await import('../src/game/combat.js');
const { getSpecies } = await import('../src/game/species.js');
const { Rng } = await import('../src/game/random.js');
const { computeStats, DAMAGE_SCALE } = await import('../src/game/stats.js');

const ESPECIE = process.env.ESPECIE ?? 'agumon';
const NIVELES = (process.env.NIVELES ?? '5,20,40,60,80,100').split(',').map(Number);
const RUNS = Number(process.env.RUNS ?? 60);

function makeDigimon(species, level) {
  const stats = computeStats(species.base, level);
  return {
    id: 1, trainerId: 1, species, nickname: null, level, exp: 0, stats,
    hp: stats.hp,
    moves: species.learnset.map((k) => ({ key: k })),
    status: 'ok', storage: 'party', caughtAt: '2024-01-01',
  };
}

function espejo(nivel: number): number {
  const turnos: number[] = [];
  const sp = getSpecies(ESPECIE)!;

  for (let i = 0; i < RUNS; i++) {
    const state = combat.createBattle([makeDigimon(sp, nivel)], 0, sp, nivel);
    const rng = new Rng(70_000 + i);
    let t = 0;
    while (!state.finished && t < 400) {
      const espejo = { ...state, player: state.enemy, enemy: state.player };
      combat.resolveTurn(state, combat.chooseEnemyAction(espejo, rng), rng);
      t++;
    }
    turnos.push(t);
  }

  turnos.sort((a, b) => a - b);
  return turnos[turnos.length >> 1]!;
}

console.log(`especie: ${ESPECIE}   escala: ${DAMAGE_SCALE}`);
console.log('nivel |  PV    | ATK   | DEF  | turnos');
console.log('------+--------+-------+------+-------');

for (const nivel of NIVELES) {
  const st = computeStats(getSpecies(ESPECIE)!.base, nivel);
  console.log(
    `${String(nivel).padStart(5)} | ${String(st.hp).padStart(6)} | ${String(st.attack).padStart(5)} | ` +
      `${String(st.defense).padStart(4)} | ${String(espejo(nivel)).padStart(6)}`,
  );
}

const { db } = await import('../src/db/index.js');
db.close();