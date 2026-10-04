// Mide la duración de los combates con una escala de daño concreta.
//
// Un solo valor por ejecución, y quien lo lanza en bucle es `balance-escala.ts`.
//
// La primera versión пробbabavar varios valores en el mismo proceso recargando
// `combat.js?e=N`. No funcionaba, y conviene saber por qué: `DAMAGE_SCALE` se lee
// en `stats.js`, y Node resuelve `./stats.js` a la misma clave de caché pase lo
// que pase el `?` de quien lo importa. El primer valor se quedaba fijado para
// todos los demás y la tabla salía con seis filas idénticas, que es exactamente
// el aspecto de un balance "ya medido" sin haber medido nada.
//
// Por eso cada escala corre en su propio proceso: es la forma de que la variable
// de entorno se aplique antes de que se lea el módulo.
process.env.DISCORD_TOKEN ??= 'fake';
process.env.DISCORD_CLIENT_ID ??= '0';
process.env.DATABASE_PATH = `./data/dbg-scale-${process.env.ESCALA ?? 'x'}.db`;

const combat = await import('../src/game/combat.js');
const { getSpecies } = await import('../src/game/species.js');
const { Rng } = await import('../src/game/random.js');
const { computeStats, DAMAGE_SCALE } = await import('../src/game/stats.js');

function makeDigimon(species, level) {
  const stats = computeStats(species.base, level);
  return {
    id: 1, trainerId: 1, species, nickname: null, level, exp: 0, stats,
    hp: stats.hp,
    moves: species.learnset.map((k) => ({ key: k })),
    status: 'ok', storage: 'party', caughtAt: '2024-01-01',
  };
}

const NIVELES: [number, string][] = [
  [5, 'agumon'],
  [18, 'greymon'],
  [35, 'metalgreymon'],
  [55, 'wargreymon'],
];

const RUNS = Number(process.env.RUNS ?? 60);

function medir(level: number, species: string): number[] {
  const turnos: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const state = combat.createBattle(
      [makeDigimon(getSpecies(species)!, level)],
      0,
      getSpecies(species)!,
      level,
    );
    const rng = new Rng(60_000 + i);
    let t = 0;
    while (!state.finished && t < 300) {
      const espejo = { ...state, player: state.enemy, enemy: state.player };
      combat.resolveTurn(state, combat.chooseEnemyAction(espejo, rng), rng);
      t++;
    }
    turnos.push(t);
  }
  return turnos.sort((a, b) => a - b);
}

const celdas: string[] = [];
for (const [level, species] of NIVELES) {
  const turnos = medir(level, species);
  celdas.push(String(turnos[turnos.length >> 1]!).padStart(8));
}

console.log(`${DAMAGE_SCALE} | ${celdas.join(' | ')}`);

const { db } = await import('../src/db/index.js');
db.close();