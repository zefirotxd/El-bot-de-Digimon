/**
 * Ajustes del PvP, en un solo sitio.
 *
 * Todos los números que controlan el sistema están aquí para que ajustar el
 * matchmaking sea cambiar un valor y no buscarlo por el código.
 */

/** Digimon máximo por equipo en PvP. */
export const MAX_PVP_TEAM = 3;

/**
 * Ventana de poder para considerar válidas dos partidas.
 * 0.12 = 12% de diferencia entre el más fuerte y el más débil.
 */
export const MATCH_WINDOW = 0.12;

/** Por encima de este ratio se avisa de que el emparejamiento fue desigual. */
export const MATCH_WARNING_RATIO = 1.35;

/** Ventana de matchmaking (ms). */
export const QUEUE_TIMEOUT_MS = 90_000;

/** Minutos de enfriamiento anti-revancha contra el mismo rival. */
export const REMATCH_COOLDOWN_MIN = 30;

/** Cuánto se puede esperar en la cola antes de que caduque la entrada. */
export const QUEUE_LIFETIME_MS = QUEUE_TIMEOUT_MS;

/**
 * Puntos por resultado.
 *
 * El empate da menos que ganar a propósito: en un juego por turnos, quedar
 * empatado suele ser porque nadie se TonightNyikan, no porque estén igual.
 */
export const POINTS = {
  victoria: 30,
  empate: 10,
  derrota: 5,
  desconexion: 40, // quien desconecta pierde, y además el que gana cobra más
} as const;

/** Racha diaria: multiplicador por días consecutivos reclamados. */
export const DAILY_REWARDS = [
  { day: 1, digibytes: 200, item: 'pocion', quantity: 2 },
  { day: 2, digibytes: 300, item: 'superpocion', quantity: 1 },
  { day: 3, digibytes: 450, item: 'tonico', quantity: 2 },
  { day: 4, digibytes: 600, item: 'capsula', quantity: 2 },
  { day: 5, digibytes: 900, item: 'elixir', quantity: 1 },
  { day: 7, digibytes: 2000, item: 'repelente', quantity: 3 },
] as DailyReward[];

export { DAILY_REWARDS as DAILY_REWARD_TABLE };

/** Días como máximo que cuenta la racha antes de reiniciarse. */
export const MAX_STREAK = 7;

export interface Rank {
  name: string;
  points: number;
  emoji: string;
}

export interface DailyReward {
  day: number;
  digibytes: number;
  item: string;
  quantity: number;
}

/**
 * Temporada actual. Cuando se cambia el número, los puntos bajan de golpe
 * (`keepRatio` de ellos sobreviven) y empieza un contador nuevo.
 */
export const SEASON = {
  id: 1,
  name: 'Temporada 1 · El Despertar',
  /** Proporción de puntos que se conserva al reiniciar la temporada. */
  keepRatio: 0.25,
  /** Puntos necesarios para cada rango. */
  ranks: [
    { name: 'Bronce', points: 0, emoji: '🥉' },
    { name: 'Plata', points: 300, emoji: '🥈' },
    { name: 'Oro', points: 800, emoji: '🥇' },
    { name: 'Diamante', points: 1600, emoji: '💎' },
    { name: 'Leyenda', points: 3000, emoji: '👑' },
  ] as Rank[],
} as const;

export const RANK_LADDER: Rank[] = SEASON.ranks;

export function rankFor(points: number): { name: string; emoji: string; next: number | null } {
  let current: Rank = RANK_LADDER[0]!;
  for (const rank of RANK_LADDER) {
    if (points >= rank.points) current = rank;
  }
  const index = RANK_LADDER.indexOf(current);
  return {
    name: current.name,
    emoji: current.emoji,
    next: index + 1 < RANK_LADDER.length ? RANK_LADDER[index + 1]!.points : null,
  };
}
