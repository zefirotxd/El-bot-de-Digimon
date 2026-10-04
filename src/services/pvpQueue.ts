import {
  findTrainer,
  getTrainerById,
  listParty,
  updateUsername,
} from '../game/repository.js';
import { canMatch, MATCH_WINDOW, powerRatio, teamPower, type PowerBreakdown } from '../game/power.js';
import { Rng } from '../game/random.js';
import { MATCH_WARNING_RATIO, MAX_PVP_TEAM, QUEUE_TIMEOUT_MS } from '../game/pvpConfig.js';

/**
 * Cola de emparejamiento PvP.
 *
 * Vive en memoria a propósito: la cola es efímera y un reinicio del bot debe
 * vaciarla (nadie quiere quedar emparejado con el fantasma de una partida de
 * hace tres horas). Lo que SÍ persiste es el resultado, el rating y el
 * enfriamiento anti-revancha, que viven en SQLite.
 */

const rng = new Rng();

export interface QueueEntry {
  trainerId: number;
  username: string;
  channelId: string;
  power: PowerBreakdown;
  joinedAt: number;
  /** Username en Discord, para poder avisar por DM si hace falta. */
  displayName: string;
}

export interface Match {
  id: string;
  a: QueueEntry;
  b: QueueEntry;
  createdAt: number;
}

const queue = new Map<number, QueueEntry>();
const matches = new Map<string, Match>();

/** Trainer que está jugando ahora mismo, para impedir partidas solapadas. */
const inMatch = new Set<number>();

export function isQueued(trainerId: number): boolean {
  return queue.has(trainerId);
}

export function isInMatch(trainerId: number): boolean {
  return inMatch.has(trainerId);
}

export function queueSize(): number {
  return queue.size;
}

export function getQueueEntry(trainerId: number): QueueEntry | undefined {
  return queue.get(trainerId);
}

/** Los_WAITING (en espera) cuya espera se pasó. */
export function expiredEntries(now = Date.now()): QueueEntry[] {
  const out: QueueEntry[] = [];
  for (const entry of queue.values()) {
    if (now - entry.joinedAt > QUEUE_TIMEOUT_MS) out.push(entry);
  }
  return out;
}

export function leaveQueue(trainerId: number): boolean {
  return queue.delete(trainerId);
}

export interface EnqueueResult {
  ok: boolean;
  reason?: 'sin-equipo' | 'ya-en-cola' | 'en-partida' | 'equipo-grande';
  entry?: QueueEntry;
}

export function enqueue(
  discordId: string,
  channelId: string,
  displayName: string,
): EnqueueResult {
  const trainer = findTrainer(discordId);
  if (!trainer) return { ok: false, reason: 'sin-equipo' };

  if (inMatch.has(trainer.id)) return { ok: false, reason: 'en-partida' };
  if (queue.has(trainer.id)) return { ok: false, reason: 'ya-en-cola' };

  const party = listParty(trainer.id);
  if (party.length < 2) return { ok: false, reason: 'sin-equipo' };
  if (party.length > MAX_PVP_TEAM) return { ok: false, reason: 'equipo-grande' };

  const entry: QueueEntry = {
    trainerId: trainer.id,
    username: trainer.username,
    channelId,
    power: teamPower(party),
    joinedAt: Date.now(),
    displayName,
  };

  queue.set(trainer.id, entry);
  return { ok: true, entry };
}

/**
 * Busca rival para `trainerId` dentro de la ventana de poder.
 *
 * Devuelve el rival de mejor encaje (el de poder más cercano), no el primero
 * que aparece: si hay tres en cola, emparejar con el más dissimilar produce
 * partidas que la gente percibe como injustas.
 */
export function findOpponent(trainerId: number): QueueEntry | null {
  const me = queue.get(trainerId);
  if (!me) return null;

  let best: QueueEntry | null = null;
  let bestGap = Infinity;

  for (const other of queue.values()) {
    if (other.trainerId === me.trainerId) continue;
    // Anti-abuso: nunca contra alguien con el mismo Discord ID aunque fueran
    // cuentas distintas en la misma fila (no debería pasar, pero el coste de
    // comprobarlo es cero).
    if (other.displayName === me.displayName) continue;
    if (!canMatch(me.power.total, other.power.total)) continue;

    const gap = Math.abs(me.power.total - other.power.total);
    if (gap < bestGap) {
      bestGap = gap;
      best = other;
    }
  }

  return best;
}

export interface PairedMatch {
  match: Match;
  /** Aviso de que el emparejamiento no era perfecto. */
  warning: string | null;
}

export function tryPair(trainerId: number): PairedMatch | null {
  const opponent = findOpponent(trainerId);
  if (!opponent) return null;

  const me = queue.get(trainerId)!;

  const ratio = powerRatio(me.power.total, opponent.power.total);
  // A partir de 1.35x de diferencia la partida sigue siendo válida pero hay
  // que decirlo, o la gente asume que el emparejamiento fue aleatorio.
  const warning =
    ratio >= MATCH_WARNING_RATIO
      ? `⚠️ Desajuste de poder **×${ratio.toFixed(2)}**. Puede ser poco equilibrado.`
      : null;

  const match: Match = {
    id: `pvp-${Date.now()}-${rng.int(1000, 9999)}`,
    a: me,
    b: opponent,
    createdAt: Date.now(),
  };

  matches.set(match.id, match);
  queue.delete(me.trainerId);
  queue.delete(opponent.trainerId);
  inMatch.add(me.trainerId);
  inMatch.add(opponent.trainerId);

  return { match, warning };
}

/** Libera a los dos jugadores y quita la partida del registro en memoria. */
export function closeMatch(matchId: string): Match | null {
  const match = matches.get(matchId);
  if (!match) return null;

  matches.delete(matchId);
  inMatch.delete(match.a.trainerId);
  inMatch.delete(match.b.trainerId);
  return match;
}

export function getMatch(matchId: string): Match | undefined {
  return matches.get(matchId);
}

export function activeMatchOf(trainerId: number): Match | undefined {
  for (const match of matches.values()) {
    if (match.a.trainerId === trainerId || match.b.trainerId === trainerId) return match;
  }
  return undefined;
}

/** Vacía la cola. Solo para arranque y tests. */
export function resetQueue(): void {
  queue.clear();
  matches.clear();
  inMatch.clear();
}

/** Cuánto lleva alguien esperando, en segundos. */
export function waitingSeconds(trainerId: number, now = Date.now()): number {
  const entry = queue.get(trainerId);
  if (!entry) return 0;
  return Math.floor((now - entry.joinedAt) / 1000);
}


