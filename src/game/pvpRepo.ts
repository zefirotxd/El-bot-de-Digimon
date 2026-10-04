import { db, transaction } from '../db/index.js';
import { bump } from './progressionRepo.js';
import {
  DAILY_REWARDS,
  MAX_STREAK,
  type DailyReward,
  POINTS,
  rankFor,
  REMATCH_COOLDOWN_MIN,
  SEASON,
} from './pvpConfig.js';

/**
 * Persistencia del PvP.
 *
 * Lo que NO vive aquí: la cola de espera. Eso es efímero y va en memoria
 * (`services/pvpQueue.ts`). Lo que SÍ persiste es todo lo que no puedes
 * perder: puntos, historial y el enfriamiento anti-revancha.
 */

interface PvpRow {
  trainer_id: number;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  disconnects: number;
  streak: number;
  last_daily: string | null;
  season: number;
}

export interface PvpProfile {
  points: number;
  wins: number;
  losses: number;
  draws: number;
  disconnects: number;
  streak: number;
  season: number;
  rank: string;
  rankEmoji: string;
  nextRankPoints: number | null;
}

const selectPvp = db.prepare<[number], PvpRow>('SELECT * FROM pvp_state WHERE trainer_id = ?');
const upsertPvp = db.prepare(
  `INSERT INTO pvp_state (trainer_id, points, wins, losses, draws, disconnects, streak, last_daily, season)
   VALUES (@trainerId, @points, @wins, @losses, @draws, @disconnects, @streak, @lastDaily, @season)
   ON CONFLICT(trainer_id) DO UPDATE SET
     points = excluded.points, wins = excluded.wins, losses = excluded.losses,
     draws = excluded.draws, disconnects = excluded.disconnects,
     streak = excluded.streak, last_daily = excluded.last_daily,
     season = excluded.season, updated_at = datetime('now')`,
);

const insertMatch = db.prepare(
  `INSERT INTO pvp_matches (id, trainer_a, trainer_b, winner_id, loser_id, reason, rounds_won_a, rounds_won_b)
   VALUES (@id, @a, @b, @winnerId, @loserId, @reason, @roundsA, @roundsB)`,
);

const lastPairPlayed = db.prepare<[number, number, number, number], { played_at: string | null }>(
  `SELECT played_at FROM pvp_matches
    WHERE (trainer_a = ? AND trainer_b = ?)
       OR (trainer_a = ? AND trainer_b = ?)
    ORDER BY played_at DESC LIMIT 1`,
);

export function getPvpProfile(trainerId: number): PvpProfile {
  const row = selectPvp.get(trainerId);
  const points = row?.points ?? 0;
  const rank = rankFor(points);

  return {
    points,
    wins: row?.wins ?? 0,
    losses: row?.losses ?? 0,
    draws: row?.draws ?? 0,
    disconnects: row?.disconnects ?? 0,
    streak: row?.streak ?? 0,
    season: row?.season ?? SEASON.id,
    rank: rank.name,
    rankEmoji: rank.emoji,
    nextRankPoints: rank.next,
  };
}

/**
 * Registra el resultado de una partida y actualiza los puntos.
 *
 * Todo dentro de una transacción: o se guardan las dos filas (estado + historial)
 * o no se guarda ninguna. A medio registrar, un jugador podía tener puntos sin
 * partida que lo justifica y el ranking mentía.
 */
export function recordMatch(input: {
  matchId: string;
  trainerA: number;
  trainerB: number;
  winnerId: number | null;
  loserId: number | null;
  reason: 'jugado' | 'desconexion' | 'abandono';
  roundsA: number;
  roundsB: number;
}): void {
  transaction(() => {
    /**
     * Quien desconecta pierde, y el que gana cobra más (`POINTS.desconexion`).
     * Abandonar una partida es la forma más fácil de farmear puntos, así que
     * tiene que costar más que ganar jugando.
     */
    const award = (trainerId: number, outcome: 'victoria' | 'empate' | 'derrota') => {
      const profile = getPvpProfile(trainerId);

      const points =
        outcome === 'victoria'
          ? input.reason === 'desconexion'
            ? POINTS.desconexion
            : POINTS.victoria
          : outcome === 'empate'
            ? POINTS.empate
            : POINTS.derrota;

      upsertPvp.run({
        trainerId,
        points: profile.points + points,
        wins: profile.wins + (outcome === 'victoria' ? 1 : 0),
        losses: profile.losses + (outcome === 'derrota' ? 1 : 0),
        draws: profile.draws + (outcome === 'empate' ? 1 : 0),
        disconnects: profile.disconnects + (input.reason === 'desconexion' ? 1 : 0),
        streak: profile.streak,
        lastDaily: null,
        season: SEASON.id,
      });
    };

    if (input.winnerId !== null && input.loserId !== null) {
      award(input.winnerId, 'victoria');
      award(input.loserId, 'derrota');
      // una mision de PvP se completaria jugando en solitario.
      bump(input.winnerId, 'pvp_victorias');
      bump(input.loserId, 'partidas');
    } else {
      award(input.trainerA, 'empate');
      award(input.trainerB, 'empate');
    }

    insertMatch.run({
      id: input.matchId,
      a: input.trainerA,
      b: input.trainerB,
      winnerId: input.winnerId,
      loserId: input.loserId,
      reason: input.reason,
      roundsA: input.roundsA,
      roundsB: input.roundsB,
    });
  });
}

// ------------------------------------------------------------ anti-abuso ---

export interface RematchStatus {
  allowed: boolean;
  /** Minutos que quedan, si está bloqueado. */
  minutesLeft: number;
}

/**
 * Enfriamiento anti-revancha.
 *
 * Sin esto, dos jugadores pueden retarse 50 veces seguidas y farmear
 * puntos decidiendo el resultado a propósito.
 */
export function checkRematch(trainerA: number, trainerB: number): RematchStatus {
  const row = lastPairPlayed.get(trainerA, trainerB, trainerB, trainerA);
  if (!row?.played_at) return { allowed: true, minutesLeft: 0 };

  const last = new Date(`${row.played_at.replace(' ', 'T')}Z`).getTime();
  const elapsedMin = (Date.now() - last) / 60_000;

  if (elapsedMin >= REMATCH_COOLDOWN_MIN) return { allowed: true, minutesLeft: 0 };
  return { allowed: false, minutesLeft: Math.ceil(REMATCH_COOLDOWN_MIN - elapsedMin) };
}

// -------------------------------------------------------- racha diaria ----

export interface DailyStatus {
  claimed: boolean;
  streak: number;
  reward: DailyReward | null;
  /** Texto de lo que te toca manana, o null si ya esta reclamado. */
  nextIn: string | null;
}

/** Fecha local en formato YYYY-MM-DD, para comparar días. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function dailyStatus(trainerId: number): DailyStatus {
  const row = selectPvp.get(trainerId);
  if (!row) return { claimed: false, streak: 0, reward: DAILY_REWARDS[0]!, nextIn: null };

  const claimed = row.last_daily === today();
  const reward = DAILY_REWARDS[Math.min(row.streak, MAX_STREAK - 1)] ?? DAILY_REWARDS[0]!;

  return {
    claimed,
    streak: row.streak,
    reward,
    nextIn: row.last_daily === today() ? null : 'Dia ' + reward.day,
  };
}

/**
 * Registra la compra diaria. Devuelve null si ya se reclamó hoy.
 *
 * Racha: si el último reclamo fue anteayer o más, vuelve a 1. Saltarse un día
 * rompe la racha a propósito: si no, no había castigo por dejarlo.
 */
export function claimDaily(trainerId: number): DailyReward | null {
  const row = selectPvp.get(trainerId);
  const now = today();

  if (row?.last_daily === now) return null;

  let streak = 1;
  if (row?.last_daily) {
    const last = new Date(`${row.last_daily}T00:00:00Z`).getTime();
    const nowMs = new Date(`${now}T00:00:00Z`).getTime();
    const dayDiff = Math.round((nowMs - last) / 86_400_000);

    if (dayDiff === 1) streak = Math.min(row.streak + 1, MAX_STREAK);
    // dayDiff > 1 => streak vuelve a 1 (rota)
  }

  const reward = DAILY_REWARDS[Math.min(streak - 1, DAILY_REWARDS.length - 1)]!;

  upsertPvp.run({
    trainerId,
    points: row?.points ?? 0,
    wins: row?.wins ?? 0,
    losses: row?.losses ?? 0,
    draws: row?.draws ?? 0,
    disconnects: row?.disconnects ?? 0,
    streak,
    lastDaily: now,
    season: SEASON.id,
  });

  return reward;
}

/** Historial reciente de un jugador, para `/pvp historial`. */
export function recentMatches(trainerId: number, limit = 10) {
  return db
    .prepare<[number, number, number, number, number, number], {
      id: string;
      opponent: string;
      outcome: 'victoria' | 'derrota' | 'empate';
      reason: string;
      played_at: string;
    }>(
      `SELECT m.id,
              CASE WHEN m.trainer_a = ? THEN t2.username ELSE t1.username END AS opponent,
              CASE
                WHEN m.winner_id = ? THEN 'victoria'
                WHEN m.loser_id  = ? THEN 'derrota'
                ELSE 'empate'
              END AS outcome,
              m.reason,
              m.played_at
         FROM pvp_matches m
         JOIN trainers t1 ON t1.id = m.trainer_a
         JOIN trainers t2 ON t2.id = m.trainer_b
        WHERE m.trainer_a = ? OR m.trainer_b = ?
        ORDER BY m.played_at DESC
        LIMIT ?`,
    )
    .all(trainerId, trainerId, trainerId, trainerId, trainerId, limit);
}
