import { EmbedBuilder } from 'discord.js';
import { COLORS } from '../views/embeds.js';

/**
 * Rate limiting en memoria.
 *
 * Hoy no había ningún límite y cada `/explorar` abría 2 collectors persistentes
 * en Discord: un usuario haciendo spam agota los límites de interacción del bot
 * en minutos. Este módulo frena eso antes de que llegue a la API.
 *
 * Es deliberadamente en memoria y no en SQLite: si el bot reinicia, los contadores
 * se ponen a cero, y eso es aceptable para un freno de emergencia.
 */

interface Rule {
  /** Segundos que hay que esperar entre usos. */
  cooldownSec: number;
  label: string;
}

/** Cooldown por comando. Los que abren collectors o escriben mucho van primero. */
const COMMAND_RULES: Record<string, Rule> = {
  explorar: { cooldownSec: 6, label: '/explorar' },
  atacar: { cooldownSec: 6, label: '/atacar' },
  digivice: { cooldownSec: 3, label: '/digivice' },
  pc: { cooldownSec: 3, label: '/pc' },
  pokedex: { cooldownSec: 3, label: '/pokedex' },
};

/** Tope global de comandos por minuto y usuario. */
const GLOBAL_LIMIT = 20;

/** Ventana global en milisegundos. */
const GLOBAL_WINDOW_MS = 60_000;

const lastUse = new Map<string, number>();
const globalHits = new Map<string, number[]>();

export interface RateVerdict {
  allowed: boolean;
  /** Segundos que faltan, si está bloqueado. */
  retryAfter: number;
  reason?: 'cooldown' | 'global';
  label?: string;
}

/** Comprueba (y consume) el cupo de un comando para un usuario. */
export function checkCommand(userId: string, commandName: string, now = Date.now()): RateVerdict {
  // 1. Tope global.
  if (!consumeGlobal(userId, now)) {
    return { allowed: false, retryAfter: globalRetryAfter(userId, now), reason: 'global' };
  }

  // 2. Cooldown especifico.
  const rule = COMMAND_RULES[commandName];
  if (!rule) return { allowed: true, retryAfter: 0 };

  const key = `${userId}:${commandName}`;
  const previous = lastUse.get(key) ?? 0;
  const elapsedSec = (now - previous) / 1000;

  if (previous !== 0 && elapsedSec < rule.cooldownSec) {
    return {
      allowed: false,
      retryAfter: Math.ceil(rule.cooldownSec - elapsedSec),
      reason: 'cooldown',
      label: rule.label,
    };
  }

  lastUse.set(key, now);
  return { allowed: true, retryAfter: 0 };
}

/** Registra el uso y dice si el usuario se pasó del tope global. */
function consumeGlobal(userId: string, now: number): boolean {
  pruneGlobal(userId, now);

  const hits = globalHits.get(userId) ?? [];
  if (hits.length >= GLOBAL_LIMIT) {
    globalHits.set(userId, hits);
    return false;
  }

  hits.push(now);
  globalHits.set(userId, hits);
  return true;
}

function pruneGlobal(userId: string, now: number): void {
  const hits = globalHits.get(userId);
  if (!hits) return;
  const fresh = hits.filter((t) => now - t < GLOBAL_WINDOW_MS);
  if (fresh.length === 0) globalHits.delete(userId);
  else globalHits.set(userId, fresh);
}

function globalRetryAfter(userId: string, now: number): number {
  const hits = globalHits.get(userId) ?? [];
  if (hits.length === 0) return 1;
  const oldest = hits[0]!;
  return Math.max(1, Math.ceil((oldest + GLOBAL_WINDOW_MS - now) / 1000));
}

/** Libera los contadores de un usuario. Útil en tests. */
export function resetRateLimit(userId?: string): void {
  if (userId) {
    globalHits.delete(userId);
    for (const key of [...lastUse.keys()]) {
      if (key.startsWith(`${userId}:`)) lastUse.delete(key);
    }
    return;
  }
  lastUse.clear();
  globalHits.clear();
}

/** Texto listo para responder cuando el comando está bloqueado. */
export function rateLimitMessage(verdict: RateVerdict): EmbedBuilder {
  if (verdict.reason === 'global') {
    return new EmbedBuilder()
      .setColor(COLORS.warning)
      .setTitle('⏳ Demasiado rápido')
      .setDescription(
        `Has superado el límite de ${GLOBAL_LIMIT} comandos por minuto.\n` +
          `Vuelve a intentarlo en **${verdict.retryAfter} s**.`,
      );
  }

  return new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle('⏳ Aún no')
    .setDescription(
      `\`${verdict.label ?? 'Este comando'}\` está en enfriamiento.\n` +
        `Espera **${verdict.retryAfter} s** para volver a usarlo.`,
    );
}

/** Descripción para la ayuda. */
export const RATE_LIMIT_INFO =
  `Cada comando tiene un enfriamiento y un máximo de ${GLOBAL_LIMIT} usos por minuto.`;
