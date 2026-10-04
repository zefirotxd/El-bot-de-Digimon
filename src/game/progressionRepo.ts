import { db, transaction } from '../db/index.js';
import {
  ACHIEVEMENTS,
  MISSIONS,
  SNAPSHOT_METRICS,
  type AchievementDef,
  type Metric,
  type MissionDef,
  type Reward,
} from './missions.js';

/**
 * Misiones y logros.
 *
 * Tres garantías, y ninguna negociable:
 *
 * 1. **Una recompensa se reclama una vez.** Vive en `claimed_at`, con clave por
 *    periodo, así que ni un reinicio del bot ni mil clics devuelven el botón.
 * 2. **Pagar y marcar es una transacción.** Marcar antes de pagar deja al
 *    jugador sin nada si el pago falla; pagar antes de marcar deja el botón
 *    vivo para siempre. Aquí no existe ninguna de las dos ventanas.
 * 3. **El progreso con periodo se mide en el periodo.** Sale de `trainer_daily`,
 *    una fila por día y métrica: la diaria lee hoy y la semanal suma los siete
 *    días de la semana ISO. No hay "línea base" que capturar al abrir la lista,
 *    así que el progreso no depende de cuándo se le ocurra al jugador mirar.
 *
 * Los logros, en cambio, son de por vida y leen el total absoluto: un hito de
 * "25 evoluciones" tiene que seguir contando las de la semana pasada.
 */

// ============================================================== periodos ====

function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Clave de periodo: el día exacto, o el lunes de la semana ISO. */
export function periodKey(period: 'diaria' | 'semanal', now = new Date()): string {
  if (period === 'diaria') return todayKey(now);

  // La semana ISO empieza en lunes: un domingo pertenece a la semana del lunes
  // ANTERIOR, no a la del lunes siguiente.
  const day = now.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now.getTime() + offset * 86_400_000);
  return todayKey(monday);
}

/** Rango de días que cubre un periodo: `[desde, hasta]`, ambos inclusive. */
function periodDays(period: 'diaria' | 'semanal', now: Date): [string, string] {
  if (period === 'diaria') {
    const key = todayKey(now);
    return [key, key];
  }

  const day = now.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now.getTime() + offset * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);

  return [todayKey(monday), todayKey(sunday)];
}

/** Cuándo expira el periodo actual, para el embed. */
export function periodResetsIn(period: 'diaria' | 'semanal', now = new Date()): string {
  if (period === 'diaria') return todayKey(new Date(now.getTime() + 86_400_000));

  const [from] = periodDays(period, now);
  const monday = new Date(`${from}T00:00:00Z`);
  return todayKey(new Date(monday.getTime() + 7 * 86_400_000));
}

// ============================================================ contadores ====

const upsertStat = db.prepare(
  `INSERT INTO trainer_stats (trainer_id, key, value) VALUES (?, ?, ?)
   ON CONFLICT(trainer_id, key) DO UPDATE SET value = value + excluded.value`,
);

const upsertDaily = db.prepare(
  `INSERT INTO trainer_daily (trainer_id, day, key, value) VALUES (?, ?, ?, ?)
   ON CONFLICT(trainer_id, day, key) DO UPDATE SET value = value + excluded.value`,
);

const selectStat = db.prepare<[number, string], { value: number }>(
  'SELECT value FROM trainer_stats WHERE trainer_id = ? AND key = ?',
);

const selectAllStats = db.prepare<[number], { key: string; value: number }>(
  'SELECT key, value FROM trainer_stats WHERE trainer_id = ?',
);

const sumDailyRange = db.prepare<[number, string, string, string], { n: number }>(
  `SELECT COALESCE(SUM(value), 0) AS n FROM trainer_daily
    WHERE trainer_id = ? AND key = ? AND day >= ? AND day <= ?`,
);

const markActive = db.prepare(
  'INSERT INTO trainer_activity (trainer_id, day) VALUES (?, ?) ON CONFLICT DO NOTHING',
);

const countActiveDays = db.prepare<[number], { n: number }>(
  'SELECT COUNT(*) AS n FROM trainer_activity WHERE trainer_id = ?',
);

const countBattles = db.prepare(
  'INSERT INTO trainer_activity (trainer_id, day, battles) VALUES (?, ?, 1) ON CONFLICT(trainer_id, day) DO UPDATE SET battles = battles + 1',
);

const countOwnedDigimon = db.prepare<[number], { n: number }>(
  'SELECT COUNT(*) AS n FROM digimon WHERE trainer_id = ?',
);

const maxLevel = db.prepare<[number], { n: number | null }>(
  'SELECT MAX(level) AS n FROM digimon WHERE trainer_id = ?',
);

const countUnlocks = db.prepare<[number], { n: number }>(
  'SELECT COUNT(*) AS n FROM evolution_unlocks WHERE trainer_id = ?',
);

/**
 * Suma a un contador. Es la ÚNICA puerta de entrada para progresar en
 * misiones y logros, y se llama desde los sitios donde pasa algo: capturar,
 * ganar, evolucionar, entrar en una mazmorra. Un sistema con contadores que
 * nadie incrementa es un catálogo muerto.
 */
export function bump(trainerId: number, metric: Metric, amount = 1): void {
  if (amount <= 0) return;
  // En las dos tablas a la vez: la de por vida para los logros, la del día para
  // las misiones con periodo.
  upsertStat.run(trainerId, metric, amount);
  upsertDaily.run(trainerId, todayKey(), metric, amount);
}

/** Marca que el entrenador ha jugado hoy. Idempotente por día. */
export function markTodayActive(trainerId: number): void {
  markActive.run(trainerId, todayKey());
}

/** Registra un combate y el día activo. */
export function recordBattlePlayed(trainerId: number): void {
  countBattles.run(trainerId, todayKey());
  bump(trainerId, 'partidas');
}

/**
 * Métrica de por vida.
 *
 * Las de tipo SNAPSHOT se calculan con una consulta en vez de leerse del
 * contador: "nivel máximo" o "Digimon capturados" pueden bajar, y un contador
 * que solo sube miente.
 */
export function statOf(trainerId: number, metric: Metric): number {
  switch (metric) {
    case 'nivel_maximo':
      return maxLevel.get(trainerId)?.n ?? 0;
    case 'digimon_capturados':
      return countOwnedDigimon.get(trainerId)?.n ?? 0;
    case 'formas_desbloqueadas':
      // El primer Digimon no pasa por ninguna evolución, pero cuenta como forma
      // conocida: si no, el logro de "10 formas" exigiría 10 evoluciones.
      return (countUnlocks.get(trainerId)?.n ?? 0) + 1;
    case 'dias_activos':
      return countActiveDays.get(trainerId)?.n ?? 0;
    default:
      return selectStat.get(trainerId, metric)?.value ?? 0;
  }
}

/** Todas las métricas de golpe, para pintar los listados. */
export function allStats(trainerId: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of selectAllStats.all(trainerId)) out[row.key] = row.value;
  for (const metric of SNAPSHOT_METRICS) out[metric] = statOf(trainerId, metric);
  return out;
}

/**
 * Cuánto lleva el jugador DENTRO de un periodo.
 *
 * Sale de `trainer_daily`, así que es exacto y no depende de nada más.
 */
export function periodStatOf(
  trainerId: number,
  metric: Metric,
  period: 'diaria' | 'semanal',
  now = new Date(),
): number {
  const [from, to] = periodDays(period, now);
  return sumDailyRange.get(trainerId, metric, from, to)?.n ?? 0;
}

// ============================================================== misiones ====

interface ProgressRow {
  progress: number;
  completed_at: string | null;
  claimed_at: string | null;
}

const selectProgress = db.prepare<[number, string, string], ProgressRow>(
  `SELECT progress, completed_at, claimed_at
     FROM mission_progress
    WHERE trainer_id = ? AND mission_id = ? AND period_key = ?`,
);

const insertProgress = db.prepare(
  `INSERT INTO mission_progress (trainer_id, mission_id, period_key, progress)
   VALUES (?, ?, ?, 0)
   ON CONFLICT DO NOTHING`,
);

const setProgress = db.prepare(
  'UPDATE mission_progress SET progress = ? WHERE trainer_id = ? AND mission_id = ? AND period_key = ?',
);

const setCompleted = db.prepare(
  `UPDATE mission_progress
      SET completed_at = COALESCE(completed_at, datetime('now'))
    WHERE trainer_id = ? AND mission_id = ? AND period_key = ?`,
);

/**
 * Marca la misión como reclamada, CREANDO la fila si no existe.
 *
 * Con un UPDATE a secas, reclamar sin haber mirado la lista antes no escribía
 * nada y el mismo botón pagaba cada vez que se pulsaba. Ese es exactamente el
 * vector de farm que el plan pedía cerrar.
 */
const markClaimed = db.prepare(
  `INSERT INTO mission_progress
     (trainer_id, mission_id, period_key, progress, completed_at, claimed_at)
   VALUES (?, ?, ?, 0, ?, ?)
   ON CONFLICT(trainer_id, mission_id, period_key) DO UPDATE SET
     completed_at = COALESCE(mission_progress.completed_at, excluded.completed_at),
     claimed_at = excluded.claimed_at`,
);

export interface MissionStatus {
  mission: MissionDef;
  progress: number;
  completed: boolean;
  claimed: boolean;
  ready: boolean;
  /** 0-1, para la barra. */
  ratio: number;
}

export function missionsOf(
  trainerId: number,
  period: 'diaria' | 'semanal',
  now = new Date(),
): MissionStatus[] {
  const key = periodKey(period, now);

  return MISSIONS.filter((m) => m.period === period).map((mission) => {
    const row = selectProgress.get(trainerId, mission.id, key);
    if (!row) insertProgress.run(trainerId, mission.id, key);

    // El progreso viene del contador DEL PERIODO: hoy para la diaria, los siete
    // días de la semana para la semanal.
    const gained = periodStatOf(trainerId, mission.metric, period, now);
    const completed = row?.completed_at != null;
    const claimed = row?.claimed_at != null;

    // Congelado: una vez completada, el progreso no vuelve atrás aunque la
    // métrica baje (por ejemplo, una captura que se libera al PC).
    const progress = completed ? Math.max(row!.progress, mission.target) : gained;

    if (!completed && progress >= mission.target) {
      setProgress.run(mission.target, trainerId, mission.id, key);
      setCompleted.run(trainerId, mission.id, key);
    }

    return {
      mission,
      progress: progress >= mission.target ? mission.target : Math.min(progress, mission.target),
      completed: completed || progress >= mission.target,
      claimed,
      ready: progress >= mission.target && !claimed,
      ratio: Math.min(1, progress / mission.target),
    };
  });
}

// ================================================================ logros ====

interface AchievementRow {
  progress: number;
  unlocked_at: string | null;
  claimed_at: string | null;
}

const selectAchievement = db.prepare<[number, string], AchievementRow>(
  'SELECT progress, unlocked_at, claimed_at FROM achievement_progress WHERE trainer_id = ? AND achievement_id = ?',
);

const insertAchievement = db.prepare(
  `INSERT INTO achievement_progress (trainer_id, achievement_id, progress)
   VALUES (?, ?, 0)
   ON CONFLICT DO NOTHING`,
);

const setAchievementProgress = db.prepare(
  'UPDATE achievement_progress SET progress = ? WHERE trainer_id = ? AND achievement_id = ?',
);

const markAchievementUnlocked = db.prepare(
  `UPDATE achievement_progress
      SET unlocked_at = COALESCE(unlocked_at, datetime('now'))
    WHERE trainer_id = ? AND achievement_id = ?`,
);

/**
 * Marca un logro como reclamado, CREANDO la fila si no existe.
 *
 * Con un UPDATE a secas, un logro que el jugador nunca ha mirado en la
 * lista se podia reclamar infinitas veces: el UPDATE no encontraba fila,
 * `claimed_at` se quedaba a null y el siguiente intento volvia a pagar.
 */
const setAchievementClaimed = db.prepare(
  `INSERT INTO achievement_progress
     (trainer_id, achievement_id, progress, unlocked_at, claimed_at)
   VALUES (?, ?, ?, datetime('now'), datetime('now'))
   ON CONFLICT(trainer_id, achievement_id) DO UPDATE SET
     unlocked_at = COALESCE(achievement_progress.unlocked_at, excluded.unlocked_at),
     claimed_at = excluded.claimed_at`,
);

const insertTitle = db.prepare(
  `INSERT INTO trainer_titles (trainer_id, title_key, title_name, title_emoji)
   VALUES (?, ?, ?, ?)
   ON CONFLICT DO NOTHING`,
);

const selectTitles = db.prepare<
  [number],
  { title_key: string; title_name: string; title_emoji: string }
>('SELECT title_key, title_name, title_emoji FROM trainer_titles WHERE trainer_id = ? ORDER BY unlocked_at ASC');

export interface AchievementStatus {
  achievement: AchievementDef;
  progress: number;
  unlocked: boolean;
  claimed: boolean;
  ready: boolean;
  ratio: number;
  /** Los ocultos no se muestran hasta que se cumplen. */
  hidden: boolean;
}

/**
 * Logros de por vida: sin periodo, porque un hito no caduca.
 *
 * El progreso SÍ es el total absoluto, a diferencia de las misiones: un logro de
 * "25 evoluciones" tiene que seguir contando las de la semana pasada.
 */
export function achievementsOf(trainerId: number): AchievementStatus[] {
  const stats = allStats(trainerId);

  return ACHIEVEMENTS.map((achievement) => {
    const row = selectAchievement.get(trainerId, achievement.id);
    if (!row) insertAchievement.run(trainerId, achievement.id);

    const unlocked = row?.unlocked_at != null;
    const total = stats[achievement.metric] ?? 0;

    // Un logro desbloqueado mantiene su progreso aunque la métrica baje.
    const progress = unlocked ? Math.max(row!.progress, achievement.target) : total;

    if (!unlocked && progress >= achievement.target) {
      setAchievementProgress.run(achievement.target, trainerId, achievement.id);
      markAchievementUnlocked.run(trainerId, achievement.id);
    }

    const isUnlocked = unlocked || progress >= achievement.target;

    return {
      achievement,
      progress: isUnlocked ? achievement.target : Math.min(progress, achievement.target),
      unlocked: isUnlocked,
      claimed: row?.claimed_at != null,
      ready: isUnlocked && row?.claimed_at == null,
      ratio: Math.min(1, progress / achievement.target),
      hidden: achievement.hidden === true && !isUnlocked,
    };
  });
}

// ============================================================ títulos ======

export interface Title {
  key: string;
  name: string;
  emoji: string;
}

/** Títulos que el entrenador puede llevar a la vez. */
export const MAX_TITLES = 3;

export function titlesOf(trainerId: number): Title[] {
  return selectTitles.all(trainerId).map((row) => ({
    key: row.title_key,
    name: row.title_name,
    emoji: row.title_emoji,
  }));
}

/**
 * Concede un título. Idempotente: el `ON CONFLICT DO NOTHING` hace que
 * reclamar el mismo logro dos veces no duplique el título.
 */
export function grantTitle(trainerId: number, exclusive: NonNullable<Reward['exclusive']>): void {
  if (exclusive.kind !== 'titulo') return;
  insertTitle.run(trainerId, exclusive.key, exclusive.name, exclusive.emoji);
}

// ============================================================= reclamos =====

export type ClaimResult =
  | { ok: true; reward: Reward; alreadyClaimed: false }
  | { ok: false; reason: 'no-existe' | 'no-completada' | 'ya-reclamada'; message: string };

/**
 * Reclama una misión Y PAGA, en la misma transacción.
 *
 * `pay` va inyectado para que esta capa no dependa de la economía: quien sabe
 * cómo escribir en el inventario es el comando.
 */
export function claimAndPayMission(
  trainerId: number,
  missionId: string,
  pay: (reward: Reward) => void,
  now = new Date(),
): ClaimResult {
  return transaction(() => {
    const mission = MISSIONS.find((m) => m.id === missionId);
    if (!mission) {
      return { ok: false as const, reason: 'no-existe' as const, message: 'Esa misión no existe.' };
    }

    const key = periodKey(mission.period, now);
    const row = selectProgress.get(trainerId, mission.id, key);
    const gained = periodStatOf(trainerId, mission.metric, mission.period, now);

    const reached = row?.completed_at != null || gained >= mission.target;
    if (!reached) {
      return {
        ok: false as const,
        reason: 'no-completada' as const,
        message: `Te falta ${mission.target - gained} (llevas ${gained}/${mission.target}).`,
      };
    }

    if (row?.claimed_at != null) {
      return {
        ok: false as const,
        reason: 'ya-reclamada' as const,
        message: 'Ya la has reclamado este periodo.',
      };
    }

    // PAGO antes que MARCA. Las dos cosas viven en la transacción de esta
    // llamada, así que si el pago falla se deshace todo y el botón sigue vivo.
    pay(mission.reward);

    const stamp = new Date().toISOString();
    markClaimed.run(trainerId, mission.id, key, stamp, stamp);

    return { ok: true as const, reward: mission.reward, alreadyClaimed: false as const };
  });
}

/** Reclama un logro Y PAGA, con el mismo orden. */
export function claimAndPayAchievement(
  trainerId: number,
  achievementId: string,
  pay: (reward: Reward) => void,
): ClaimResult {
  return transaction(() => {
    const achievement = ACHIEVEMENTS.find((a) => a.id === achievementId);
    if (!achievement) {
      return { ok: false as const, reason: 'no-existe' as const, message: 'Ese logro no existe.' };
    }

    const row = selectAchievement.get(trainerId, achievementId);
    const total = allStats(trainerId)[achievement.metric] ?? 0;

    if (row?.unlocked_at == null && total < achievement.target) {
      return {
        ok: false as const,
        reason: 'no-completada' as const,
        message: `Te falta ${achievement.target - total} (llevas ${total}/${achievement.target}).`,
      };
    }

    if (row?.claimed_at != null) {
      return {
        ok: false as const,
        reason: 'ya-reclamada' as const,
        message: 'Ya has reclamado este logro.',
      };
    }

    pay(achievement.reward);
    setAchievementClaimed.run(trainerId, achievementId, achievement.target);

    return { ok: true as const, reward: achievement.reward, alreadyClaimed: false as const };
  });
}

// ================================================================ resumen =====

export interface ProgressSummary {
  dailyReady: number;
  dailyTotal: number;
  weeklyReady: number;
  weeklyTotal: number;
  achievementsUnlocked: number;
  achievementsTotal: number;
  activeDays: number;
}

export function summaryOf(trainerId: number, now = new Date()): ProgressSummary {
  const daily = missionsOf(trainerId, 'diaria', now);
  const weekly = missionsOf(trainerId, 'semanal', now);
  const achievements = achievementsOf(trainerId);

  return {
    dailyReady: daily.filter((m) => m.ready).length,
    dailyTotal: daily.length,
    weeklyReady: weekly.filter((m) => m.ready).length,
    weeklyTotal: weekly.length,
    achievementsUnlocked: achievements.filter((a) => a.unlocked).length,
    achievementsTotal: achievements.length,
    activeDays: statOf(trainerId, 'dias_activos'),
  };
}

export type { Metric, MissionDef, AchievementDef, Reward };
