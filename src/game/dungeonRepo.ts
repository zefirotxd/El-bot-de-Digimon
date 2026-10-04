import { db, transaction } from '../db/index.js';
import { BOSSES, getBoss } from './bosses.js';
import { bump } from './progressionRepo.js';
import {
  contribution,
  DUNGEONS,
  getDungeon,
  roomBonus,
  tierFor,
  type ContributionTier,
  type DungeonDef,
  type RoomDef,
} from './dungeons.js';

/**
 * Persistencia de mazmorras y del jefe global.
 *
 * Lo que vive aquí y NO en memoria, y por qué:
 *
 * - **Energía y energía diaria**: si estuvieran en memoria, reiniciar el bot
 *   devolvería la energía a todo el mundo.
 * - **Progreso por sala**: es el contrato con el jugador. Si pierde la sala 3,
 *   la pierde.
 * - **Vida del jefe global**: es la ÚNICA parte que de verdad es de todos. Si no
 *   persistiera, cada jugador estaría pegándole a su propia copia y el
 *   "jefe global" sería un meme.
 */

/** Energía diaria base. Se puede subir desde la configuración. */
export const DAILY_ENERGY = 12;

// --------------------------------------------------------------- consultas ---

const selectEnergy = db.prepare<[number, string], { energy: number }>(
  'SELECT energy FROM trainer_energy WHERE trainer_id = ? AND day = ?',
);

const upsertEnergy = db.prepare(
  `INSERT INTO trainer_energy (trainer_id, day, energy) VALUES (?, ?, ?)
   ON CONFLICT(trainer_id, day) DO UPDATE SET energy = excluded.energy`,
);

const selectRun = db.prepare<
  [number, string, string],
  { room_index: number; rooms_cleared: number; finished: number; entries: number }
>(
  `SELECT room_index, rooms_cleared, finished, entries
     FROM dungeon_run WHERE trainer_id = ? AND dungeon_key = ? AND run_date = ?`,
);

const insertRun = db.prepare(
  `INSERT INTO dungeon_run
     (trainer_id, dungeon_key, room_index, run_date, rooms_cleared, entries)
   VALUES (?, ?, 0, ?, 0, 1)`,
);

/** Una entrada mas: cuenta el intento sin tocar el progreso de las salas. */
const countEntry = db.prepare(
  `UPDATE dungeon_run SET entries = entries + 1
    WHERE trainer_id = ? AND dungeon_key = ? AND run_date = ?`,
);

const advanceRun = db.prepare(
  `UPDATE dungeon_run SET room_index = ?, rooms_cleared = ?, finished = ?`,
);

/**
 * Igual que `advanceRun`, pero crea la fila si no existe.
 *
 * Con un UPDATE a secas, registrar una sala sin haber llamado antes a
 * `startRun` no hacia nada en silencio: room_index se quedaba en 0, la
 * mazmorra nunca llegaba a completarse y el jugador perdía la recompensa.
 *
 * Aquí se llama siempre a esta versión desde `clearRoom`, porque el estado de
 * la partida no tiene por qué haber pasado por el flujo de entrada.
 */
const upsertRun = db.prepare(
  `INSERT INTO dungeon_run (trainer_id, dungeon_key, run_date, room_index, rooms_cleared, finished)
   VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(trainer_id, dungeon_key, run_date) DO UPDATE SET
     room_index = excluded.room_index,
     rooms_cleared = excluded.rooms_cleared,
     finished = excluded.finished`,
);

const selectClear = db.prepare<[number, string], { first_cleared: string; clears: number }>(
  'SELECT first_cleared, clears FROM dungeon_clear WHERE trainer_id = ? AND dungeon_key = ?',
);

const upsertClear = db.prepare(
  `INSERT INTO dungeon_clear (trainer_id, dungeon_key, clears) VALUES (?, ?, 1)
   ON CONFLICT(trainer_id, dungeon_key) DO UPDATE SET clears = clears + 1`,
);

// ---------------------------------------------------------------- energía ----

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface EnergyStatus {
  energy: number;
  max: number;
  /** Se reinició hoy (es decir, es el primer uso del día). */
  fresh: boolean;
}

/**
 * Energía disponible hoy.
 *
 * El día se guarda en la propia fila, así que "hoy" se decide por la fecha y no
 * por un contador en memoria: reiniciar el bot no devuelve energía.
 */
export function energyOf(trainerId: number): EnergyStatus {
  const day = today();
  const row = selectEnergy.get(trainerId, day);
  return { energy: row?.energy ?? DAILY_ENERGY, max: DAILY_ENERGY, fresh: !row };
}

export function spendEnergy(trainerId: number, amount: number): boolean {
  return transaction(() => {
    const status = energyOf(trainerId);
    if (status.energy < amount) return false;

    upsertEnergy.run(trainerId, today(), status.energy - amount);
    return true;
  });
}

export function refundEnergy(trainerId: number, amount: number): void {
  const status = energyOf(trainerId);
  upsertEnergy.run(trainerId, today(), Math.min(status.max, status.energy + amount));
}

// -------------------------------------------------------------- mazmorras ----

export interface RunStatus {
  dungeon: DungeonDef;
  roomIndex: number;
  roomsCleared: number;
  finished: boolean;
  attemptsLeft: number;
  /** Entradas consumidas hoy. */
  attemptsUsed: number;
  /** La sala que toca ahora mismo. */
  nextRoom: RoomDef | null;
}

export function runOf(trainerId: number, dungeonKey: string): RunStatus | null {
  const dungeon = getDungeon(dungeonKey);
  if (!dungeon) return null;

  const row = selectRun.get(trainerId, dungeonKey, today());
  const used = row?.entries ?? 0;

  if (!row) {
    return {
      dungeon,
      roomIndex: 0,
      roomsCleared: 0,
      finished: false,
      attemptsLeft: Math.max(0, dungeon.dailyAttempts - used),
      attemptsUsed: used,
      nextRoom: dungeon.rooms[0]!,
    };
  }

  const finished = row.finished === 1;
  return {
    dungeon,
    roomIndex: row.room_index,
    roomsCleared: row.rooms_cleared,
    finished,
    attemptsLeft: Math.max(0, dungeon.dailyAttempts - used),
    attemptsUsed: used,
    // Una partida terminada no tiene "siguiente sala": se empieza de cero.
    nextRoom: finished ? null : (dungeon.rooms[row.room_index] ?? null),
  };
}

/**
 * Empieza (o continúa) una mazmorra.
 *
 * Devuelve un código de error en vez de lanzar: el comando lo traduce a un
 * mensaje y el jugador ve qué le falta, no un error 500.
 */
export type StartResult =
  | { ok: true; run: RunStatus }
  | {
      ok: false;
      reason: 'no-existe' | 'nivel' | 'energia' | 'intentos' | 'terminada';
      message: string;
    };

export function startRun(trainerId: number, dungeonKey: string): StartResult {
  const dungeon = getDungeon(dungeonKey);
  if (!dungeon) {
    return { ok: false, reason: 'no-existe', message: 'Esa mazmorra no existe.' };
  }

  return transaction(() => {
    const row = selectRun.get(trainerId, dungeonKey, today());
    // `entries` cuenta ENTRADAS, no filas: entrar cinco veces a la sala 1
    // son cinco intentos. Con un contador de filas el tope diario era
    // infinito mientras no se completara la mazmorra.
    const attemptsLeft = dungeon.dailyAttempts - (row?.entries ?? 0);

    if (attemptsLeft <= 0) {
      return {
        ok: false as const,
        reason: 'intentos' as const,
        message: `Hoy has hecho los ${dungeon.dailyAttempts} intentos de ${dungeon.name}. Vuelve mañana.`,
      };
    }

    if (row && row.finished === 1) {
      return {
        ok: false as const,
        reason: 'terminada' as const,
        message: `Ya completaste ${dungeon.name} hoy. Mañana hay otra vuelta.`,
      };
    }

    // Un intento nuevo solo cuenta si la partida anterior no llegó a la
    // primera sala: si hay progreso, se continúa sin gastar otro intento.
    if (!row) {
      const energy = energyOf(trainerId);
      if (energy.energy < dungeon.energyCost) {
        return {
          ok: false as const,
          reason: 'energia' as const,
          message: `Te faltan energía: tienes ${energy.energy} y hacen falta ${dungeon.energyCost}.`,
        };
      }
      upsertEnergy.run(trainerId, today(), energy.energy - dungeon.energyCost);
      insertRun.run(trainerId, dungeonKey, today());
    } else {
      // Continuar NO es gratis: cada combate que juegas es un intento.
      countEntry.run(trainerId, dungeonKey, today());
    }

    return { ok: true as const, run: runOf(trainerId, dungeonKey)! };
  });
}

/** Registra que una sala está superada y devuelve el estado actualizado. */
export function clearRoom(
  trainerId: number,
  dungeonKey: string,
  damageToBoss: number,
  bossMaxHp: number,
): { run: RunStatus; finished: boolean; ratio: number } {
  return transaction(() => {
    const dungeon = getDungeon(dungeonKey)!;
    const row = selectRun.get(trainerId, dungeonKey, today());
    const from = row?.room_index ?? 0;

    // Avanza UNA sala, no hasta el final: así un fallo en la sala 4 no borra
    // las tres anteriores.
    const nextIndex = from + 1;
    const finished = nextIndex >= dungeon.rooms.length;

    upsertRun.run(
      trainerId,
      dungeonKey,
      today(),
      nextIndex,
      (row?.rooms_cleared ?? 0) + 1,
      finished ? 1 : 0,
    );

    // Cada sala cuenta, y la mazmorra completa una vez mas.
    bump(trainerId, 'salas');
    if (finished) {
      upsertClear.run(trainerId, dungeonKey);
      bump(trainerId, 'mazmorras');
    }

    const ratio = contribution(damageToBoss, bossMaxHp);
    return { run: runOf(trainerId, dungeonKey)!, finished, ratio };
  });
}

/** Abandona la partida: el progreso de las salas ya superadas se conserva. */
export function abandonRun(trainerId: number, dungeonKey: string): void {
  advanceRun.run(0, 0, 0, trainerId, dungeonKey, today());
}

export function hasCleared(trainerId: number, dungeonKey: string): boolean {
  return Boolean(selectClear.get(trainerId, dungeonKey));
}

export function clearCount(trainerId: number, dungeonKey: string): number {
  return selectClear.get(trainerId, dungeonKey)?.clears ?? 0;
}

// ----------------------------------------------------------------ognitive --- 

/** Qué te falta para entrar hoy. */
export type DungeonAccess =
  | { ok: true }
  | { ok: false; reason: 'nivel' | 'energia' | 'intentos'; message: string; detail: string };

export function canEnterDungeon(
  trainerId: number,
  dungeon: DungeonDef,
  level: number,
): DungeonAccess {
  if (level < dungeon.minLevel) {
    return {
      ok: false,
      reason: 'nivel',
      message: `Necesitas nivel ${dungeon.minLevel}.`,
      detail: `Tu nivel más alto es ${level}.`,
    };
  }

  const energy = energyOf(trainerId);
  if (energy.energy < dungeon.energyCost) {
    return {
      ok: false,
      reason: 'energia',
      message: `Te falta energía (${energy.energy}/${dungeon.energyCost}).`,
      detail: `Empiezas cada día con ${DAILY_ENERGY}.`,
    };
  }

  const used = runOf(trainerId, dungeon.key)?.attemptsUsed ?? 0;
  if (used >= dungeon.dailyAttempts) {
    return {
      ok: false,
      reason: 'intentos',
      message: `Intentos agotados (${used}/${dungeon.dailyAttempts}).`,
      detail: 'Cada día se reinician.',
    };
  }

  return { ok: true };
}

// ------------------------------------------------------------- Cognitive -----

export interface DungeonReward {
  tier: ContributionTier;
  ratio: number;
  digibytes: number;
  materials: Record<string, number>;
  /** Bonificador por lo lejos que llegó: la última sala vale más. */
  roomFactor: number;
  firstClear: boolean;
}

/**
 * Calcula lo que te llevas.
 *
 * La contribución manda sobre la primera pasada: completar la mazmorra da el
 * bonus de la primera vez, pero si te quedas a medias no hay bonus aunque
 * estés en la última sala. Terminar es lo que se paga.
 */
export function dungeonReward(
  trainerId: number,
  dungeon: DungeonDef,
  roomsCleared: number,
  bossDamage: number,
  bossMaxHp: number,
): DungeonReward {
  const ratio = contribution(bossDamage, bossMaxHp);
  const tier = tierFor(ratio);
  const roomFactor = roomBonus(roomsCleared, dungeon.rooms.length);
  const firstClear = !hasCleared(trainerId, dungeon.key);

  const base = Math.round(
    (firstClear ? dungeon.firstClearDigibytes : Math.round(dungeon.firstClearDigibytes * 0.35)) *
      roomFactor *
      tier.digibyteFactor,
  );

  const materials: Record<string, number> = {};
  for (const [key, quantity] of Object.entries(dungeon.materials)) {
    const scaled = Math.floor(quantity * tier.materialFactor * roomFactor);
    if (scaled > 0) materials[key] = scaled;
  }

  return { tier, ratio, digibytes: base, materials, roomFactor, firstClear };
}

// ------------------------------------------------------------ jefe global ----

interface WorldBossRow {
  boss_key: string;
  ends_at: string;
  max_hp: number;
  current_hp: number;
  total_damage: number;
  defeated_by: number | null;
}

const selectWorldBoss = db.prepare<[], WorldBossRow>('SELECT * FROM world_boss WHERE id = 1');
const upsertWorldBoss = db.prepare(
  `INSERT INTO world_boss (id, boss_key, ends_at, max_hp, current_hp)
   VALUES (1, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET
     boss_key = excluded.boss_key, ends_at = excluded.ends_at,
     max_hp = excluded.max_hp, current_hp = excluded.current_hp,
     total_damage = 0, defeated_by = NULL, defeated_at = NULL, started_at = datetime('now')`,
);
const damageWorldBoss = db.prepare(
  'UPDATE world_boss SET current_hp = MAX(0, current_hp - ?), total_damage = total_damage + ? WHERE id = 1',
);
const defeatWorldBoss = db.prepare(
  'UPDATE world_boss SET defeated_by = ?, defeated_at = datetime(\'now\') WHERE id = 1',
);
const upsertContrib = db.prepare(
  `INSERT INTO world_boss_contrib (boss_id, trainer_id, damage, hits, best_damage)
   VALUES (1, ?, ?, 1, ?)
   ON CONFLICT(boss_id, trainer_id) DO UPDATE SET
     damage = damage + excluded.damage,
     hits = hits + 1,
     best_damage = MAX(best_damage, excluded.best_damage),
     updated_at = datetime('now')`,
);

/** Duração de una incursión: 3 días. */
export const WORLD_BOSS_DAYS = 3;

export interface WorldBossState {
  bossKey: string;
  name: string;
  emoji: string;
  maxHp: number;
  currentHp: number;
  totalDamage: number;
  endsAt: string;
  defeatedBy: number | null;
  participants: number;
  /** Fracción de vida restante, 0-1. */
  remaining: number;
  expired: boolean;
}

/**
 * Estado del jefe global, creando uno nuevo si no hay o si el anterior expiró.
 *
 * La rotación es determinista por día de la incursión, así todo el bot ve el
 * mismo jefe sin necesidad de guardarlo en un sitio de coordinación.
 */
export function worldBossState(now = new Date()): WorldBossState {
  const row = selectWorldBoss.get();
  const expired = row ? new Date(`${row.ends_at.replace(' ', 'T')}Z`) <= now : true;

  if (!row || expired) {
    const key = rotateBoss(row?.boss_key);
    const def = getBoss(key)!;

    // La vida sale de la del jefe en solitario, multiplicada: contra un jefe
    // global hace falta aguante de sobra porque son muchos, pero el daño
    // individual tiene que seguir siendo significativo.
    const maxHp = Math.round(def.hpScale * 60_000);

    const ends = new Date(now.getTime() + WORLD_BOSS_DAYS * 86_400_000);
    upsertWorldBoss.run(key, ends.toISOString().slice(0, 19).replace('T', ' '), maxHp, maxHp);
    return describe(key, maxHp, maxHp, 0, ends.toISOString(), null, 0);
  }

  const participants =
    db
      .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM world_boss_contrib WHERE boss_id = 1')
      .get()?.n ?? 0;

  return describe(
    row.boss_key,
    row.max_hp,
    row.current_hp,
    row.total_damage,
    row.ends_at,
    row.defeated_by,
    participants,
  );
}

function describe(
  bossKey: string,
  maxHp: number,
  currentHp: number,
  totalDamage: number,
  endsAt: string,
  defeatedBy: number | null,
  participants: number,
): WorldBossState {
  const def = getBoss(bossKey);
  return {
    bossKey,
    name: def?.name ?? bossKey,
    emoji: def?.emoji ?? '❓',
    maxHp,
    currentHp,
    totalDamage,
    endsAt,
    defeatedBy,
    participants,
    remaining: maxHp > 0 ? currentHp / maxHp : 0,
    expired: false,
  };
}

/** Rotación de jefes globales. El siguiente es determinista. */
function rotateBoss(current: string | undefined): string {
  const order = Object.values(BOSSES)
    .filter((b) => b.global)
    .map((b) => b.key);
  if (order.length === 0) return Object.keys(BOSSES)[0]!;

  const index = current ? order.indexOf(current) : -1;
  return order[(index + 1) % order.length]!;
}

/**
 * Registra daño al jefe global.
 *
 * Devuelve cuántos PV quedan y si este golpe lo ha abatido. El daño se guarda
 * aunque esté muerto, para que el histórico de contribución cuadre con lo que
 * la gente hizo.
 */
export function damageWorldBossBy(
  trainerId: number,
  damage: number,
): { currentHp: number; defeated: boolean; contribution: number } {
  return transaction(() => {
    const state = worldBossState();
    const dealt = Math.max(0, Math.min(damage, state.currentHp));

    damageWorldBoss.run(dealt, dealt);
    bump(trainerId, 'dano_jefe', dealt);
    upsertContrib.run(trainerId, dealt, dealt);

    const currentHp = Math.max(0, state.currentHp - dealt);
    let defeated = false;

    if (currentHp === 0 && state.defeatedBy === null) {
      defeatWorldBoss.run(trainerId);
      defeated = true;
    }

    return {
      currentHp,
      defeated,
      contribution: state.maxHp > 0 ? dealt / state.maxHp : 0,
    };
  });
}

export interface ContribRow {
  trainerId: number;
  username: string;
  damage: number;
  hits: number;
  bestDamage: number;
  share: number;
  rank: number;
}

export function worldBossLeaderboard(limit = 10): ContribRow[] {
  const total =
    db.prepare<[], { n: number }>('SELECT COALESCE(SUM(damage), 0) AS n FROM world_boss_contrib WHERE boss_id = 1')
      .get()?.n ?? 0;

  const rows = db
    .prepare<[number], { trainer_id: number; username: string; damage: number; hits: number; best_damage: number }>(
      `SELECT c.trainer_id, t.username, c.damage, c.hits, c.best_damage
         FROM world_boss_contrib c
         JOIN trainers t ON t.id = c.trainer_id
        WHERE c.boss_id = 1
        ORDER BY c.damage DESC
        LIMIT ?`,
    )
    .all(limit);

  return rows.map((row, index) => ({
    trainerId: row.trainer_id,
    username: row.username,
    damage: row.damage,
    hits: row.hits,
    bestDamage: row.best_damage,
    share: total > 0 ? row.damage / total : 0,
    rank: index + 1,
  }));
}

export function myContribution(trainerId: number): { damage: number; hits: number; bestDamage: number } | null {
  const row = db
    .prepare<[number], { damage: number; hits: number; best_damage: number }>(
      'SELECT damage, hits, best_damage FROM world_boss_contrib WHERE boss_id = 1 AND trainer_id = ?',
    )
    .get(trainerId);
  return row ? { damage: row.damage, hits: row.hits, bestDamage: row.best_damage } : null;
}

/** Máximas marcas de un jugador contra el jefe global. */
export { DUNGEONS };
