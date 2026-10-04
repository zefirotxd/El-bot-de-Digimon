import type { BattleState } from '../game/combat.js';
import { randomBytes } from 'node:crypto';

/**
 * Sesión de navegación, UNA POR USUARIO.
 *
 * El requisito era explícito: "si dos jugadores están navegando
 * simultáneamente, sus botones, pantallas y estado no pueden mezclarse". Discord
 * no da estado por mensaje, así que el estado vive aquí, en memoria, indexado
 * por `userId`.
 *
 * Tres decisiones que importan:
 *
 * 1. **La clave es el usuario de Discord, no el entrenador.** Son lo mismo en la
 *    práctica, pero si el jugador se desregistra y vuelve a entrar, la sesión
 *    sigue siendo suya y no se cruza con la de nadie.
 * 2. **Cada sesión tiene un `nonce`.** Va dentro de todos los `custom_id`. Un
 *    mensaje viejo (de hace media hora, abierto en otro canal) trae un nonce que
 *    ya no cuadra y se rechaza, en vez de ejecutar una acción con datos rancios.
 * 3. **La pila guarda pantalla Y parámetros.** Si no, "atrás" desde la página 4
 *    de una lista devolvería a la página 1, que es como se comporta un menú que
 *    no recuerda dónde estabas.
 *
 * Nada de esto se persiste en base de datos a propósito: una sesión de
 * navegación caducada solo cuesta pulsar `/digivice` otra vez, y guardarla
 * añadiría filas que nadie benefitaría.
 */

export interface NavEntry {
  screen: string;
  params: Record<string, string>;
}

export interface NavSession {
  userId: string;
  trainerId: number;
  /** Se mete en cada `custom_id`. Corto porque Discord limita a 100 caracteres. */
  nonce: string;
  stack: NavEntry[];
  lastSeen: number;
  /**
   * Mensaje pendiente de mostrar en la siguiente pantalla.
   *
   * Vive en la sesión y no en el mensaje porque el resultado de una acción
   * (comprar, evolucionar, evolucionar) tiene que sobrevivir al salto de
   * pantalla. Sin esto el jugador pulsa "evolucionar", aterriza en la ficha y no
   * tiene forma de saber si funcionó.
   */
  flash?: { message: string; kind: 'ok' | 'aviso' | 'error' };

  /**
   * Combate en marcha, si lo hay.
   *
   * Vive aquí y no en un almacén aparte porque la sesión ya está indexada
   * por `userId`: dos jugadores peleando a la vez ya están aislados, y
   * guardarlo en el mismo sitio evita tener dos verdades.
   *
   * Es la MISMA referencia que usa el servicio de combate, así que un clic
   * por la interfaz y un comando se ven el mismo estado.
   */
  battle: BattleState | null;
}

/** Una sesión caduca después de esto. Es tiempo de sobra para una partida. */
export const SESSION_TTL_MS = 30 * 60_000;

const sessions = new Map<string, NavSession>();

function newNonce(): string {
  return randomBytes(3).toString('hex');
}

/** Sesión del usuario, sin crearla. */
export function getSession(userId: string): NavSession | undefined {
  const session = sessions.get(userId);
  if (!session) return undefined;
  if (Date.now() - session.lastSeen > SESSION_TTL_MS) {
    sessions.delete(userId);
    return undefined;
  }
  return session;
}

/**
 * Sesión del usuario, creándola si hace falta.
 *
 * Reutiliza la pila anterior si la sesión sigue viva: volver al Digivice con
 * `/digivice` debe devolver al jugador a donde estaba, no al principio de todo.
 */
export function ensureSession(userId: string, trainerId: number): NavSession {
  const existing = getSession(userId);
  if (existing) {
    existing.trainerId = trainerId;
    existing.lastSeen = Date.now();
    return existing;
  }

  const session: NavSession = {
    userId,
    trainerId,
    nonce: newNonce(),
    stack: [],
    battle: null,
    lastSeen: Date.now(),
  };
  sessions.set(userId, session);
  return session;
}

/** True si el mensaje se renderizó con la sesión actual. */
export function nonceMatches(session: NavSession, nonce: string | undefined): boolean {
  return typeof nonce === 'string' && nonce.length > 0 && nonce === session.nonce;
}

/**
 * Empuja un destino y devuelve la entrada actual.
 *
 * No apila si el destino es el mismo sitio en el que ya se está: refrescar una
 * lista no debería hacer que "atrás" necesite dos pulsaciones para volver.
 */
export function push(session: NavSession, screen: string, params: Record<string, string> = {}): NavEntry {
  const current = session.stack[session.stack.length - 1];
  if (!current || current.screen !== screen || !sameParams(current.params, params)) {
    session.stack.push({ screen, params: { ...params } });
  }
  session.lastSeen = Date.now();
  return current ?? { screen, params };
}

/** Cambia la pantalla actual sin apilar. Para refrescos y resultados. */
export function replace(session: NavSession, screen: string, params: Record<string, string> = {}): void {
  if (session.stack.length === 0) {
    session.stack.push({ screen, params: { ...params } });
  } else {
    session.stack[session.stack.length - 1] = { screen, params: { ...params } };
  }
  session.lastSeen = Date.now();
}

/** Vuelve un paso atrás. Devuelve `null` si ya está en la raíz. */
export function pop(session: NavSession): NavEntry | null {
  if (session.stack.length <= 1) return null;
  session.stack.pop();
  session.lastSeen = Date.now();
  return session.stack[session.stack.length - 1]!;
}

/** Vuelve a la pantalla actual del hub, vaciando el historial. */
export function toRoot(session: NavSession, screen: string, params: Record<string, string> = {}): void {
  session.stack = [{ screen, params: { ...params } }];
  session.lastSeen = Date.now();
}

/** Entry actual. */
export function current(session: NavSession): NavEntry | undefined {
  return session.stack[session.stack.length - 1];
}

/** ¿Se puede volver atrás? */
export function canGoBack(session: NavSession): boolean {
  return session.stack.length > 1;
}

export function sameParams(a: Record<string, string>, b: Record<string, string>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => a[key] === b[key]);
}

/**
 * Cada mensaje nuevo invalida los botones del anterior.
 *
 * Es lo que hace que un mensaje abierto desde hace una hora no pueda gastar
 * DigiBytes: su nonce ya no es el de la sesión y el router lo rechaza.
 */
export function rotateNonce(session: NavSession): string {
  session.nonce = newNonce();
  session.lastSeen = Date.now();
  return session.nonce;
}

/** Limpia sesiones caducadas. Lo llama el router de vez en cuando. */
export function pruneSessions(now = Date.now()): number {
  let removed = 0;
  for (const [userId, session] of sessions) {
    if (now - session.lastSeen > SESSION_TTL_MS) {
      sessions.delete(userId);
      removed++;
    }
  }
  return removed;
}

/** Número de sesiones vivas. Para el verificador. */
export function sessionCount(): number {
  return sessions.size;
}

/** Vacía todas las sesiones. Solo para pruebas. */
export function resetSessions(): void {
  sessions.clear();
}