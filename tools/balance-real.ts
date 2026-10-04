// Duración de las PELEAS REALES, no de los espejos.
//
// El barrido de `balance-escala` mide un espejo: misma especie contra sí misma.
// Es el caso más duro (sin ventaja de atributo y con la afinidad elemental
// contra uno mismo), pero no es una pelea que ocurra nunca. Antes de aceptar un
// cambio de daño de ×2.86 hay que ver cuánto dura lo que se juega de verdad:
// un Agumon de nivel 12 contra los salvajes que se encuentran por la zona.
//
// Sale por stdout una sola línea con la mediana por nivel.
process.env.DISCORD_TOKEN ??= 'fake';
process.env.DISCORD_CLIENT_ID ??= '0';
process.env.DATABASE_PATH = `./data/dbg-real-${process.env.ESCALA ?? 'x'}.db`;

const combat = await import('../src/game/combat.js');
const { getSpecies, SPECIES } = await import('../src/game/species.js');
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

const RUNS = Number(process.env.RUNS ?? 80);

/**
 * Rival "de zona": una especie de nivel parecido, la que el jugador se
 * encontraría de verdad. No es un espejo ni un jefe.
 */
function medirContraZona(nivel: number, especieJugador: string): number {
  const turnos: number[] = [];

  // Se coge una especie distinta y de nivel parecido para cada carrera.
  const rivales = Object.values(SPECIES).filter(
    (s) => s.key !== especieJugador && s.base.hp < 4000,
  );

  for (let i = 0; i < RUNS; i++) {
    const rival = rivales[i % rivales.length]!;
    const nivelRival = Math.max(1, nivel + ((i % 5) - 2));

    const state = combat.createBattle(
      [makeDigimon(getSpecies(especieJugador)!, nivel)],
      0,
      rival,
      nivelRival,
    );

    const rng = new Rng(90_000 + i);
    let t = 0;
    while (!state.finished && t < 300) {
      const espejo = { ...state, player: state.enemy, enemy: state.player };
      combat.resolveTurn(state, combat.chooseEnemyAction(espejo, rng), rng);
      t++;
    }
    turnos.push(t);
  }

  turnos.sort((a, b) => a - b);
  return turnos[turnos.length >> 1]!;
}

const CASOS: [number, string][] = [
  [8, 'agumon'],
  [20, 'greymon'],
  [40, 'metalgreymon'],
  [60, 'wargreymon'],
];

const celdas = CASOS.map(([nivel, especie]) =>
  String(medirContraZona(nivel, especie)).padStart(8),
);

console.log(`${DAMAGE_SCALE} | ${celdas.join(' | ')}`);

const { db } = await import('../src/db/index.js');
db.close();