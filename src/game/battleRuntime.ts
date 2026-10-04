import type { BattleState } from './combat.js';
import type { Rng } from './random.js';
import { MAX_EVENTS, TURN_SECONDS, type BattleEvent, type BattleMode, type BattleStatus, type TurnGuard } from './battleEvents.js';

/**
 * Runtime de combate para la interfaz.
 *
 * Va en su propio módulo y no dentro de `combat.ts` a propósito. Lo que hace es
 * coser alrededor del motor: identificadores, reloj de turno, guardia de doble
 * clic y construcción de estado inicial. La RESOLUCIÓN sigue siendo
 * `resolveTurn` del motor, sin tocar.
 *
 * El reparto es deliberado:
 *
 * - `combat.ts`  = reglas. Damage, turnos, estados. No sabe nada de Discord.
 * - este archivo = ciclo de vida. Identificadores, tiempo, idempotencia.
 * - `ui/`        = pintura. No calcula nada.
 *
 * Así el motor se puede testear sin reloj ni Discord, y la interfaz no puede
 * inventarse reglas aunque quiera.
 */


// `attachRuntime` vive en `combat.ts`: recibe el `BattleCore` y devuelve un
// `BattleState` con su propio runtime. Aquí solo vive el ciclo de vida:
// reloj de turno y guardia de doble clic.

/**
 * Añade un evento al registro.
 *
 * El recorte es por el PRINCIPIO, no por el final: un registro de combate se
 * lee del principio, y perder los últimos eventos (los que explican cómo
 * acabaste) hace la pantalla inútil. `MAX_EVENTS` está muy por encima de la
 * duración de cualquier combate real, así que en la práctica no recorta.
 */
export function emit(state: BattleState, event: BattleEvent): void {
  state.events.push(event);

  if (state.events.length > MAX_EVENTS) {
    state.events.splice(0, state.events.length - MAX_EVENTS);
  }

  // Las cifras del resultado se llevan aquí, en el punto donde ocurre el daño.
  // Recalcularlas al final exigiría volver a recorrer el registro con la misma
  // lógica, que es la forma segura de que las dos cosas se desincronicen.
  if (event.kind === 'ataque' && event.actor === state.player.name) {
    state.stats.dealt += event.damage.final;
  }
  if (event.kind === 'ataque' && event.target === state.player.name) {
    state.stats.taken += event.damage.final;
  }
  if (event.kind === 'caida' && event.target === state.player.name) {
    // El daño que mata al jugador cuenta como recibido aunque fuera residual.
    state.stats.taken = Math.max(state.stats.taken, state.stats.taken);
  }
}

// --------------------------------------------------------------- estado ----

/** Qué se puede hacer ahora mismo. La interfaz pregunta, no deduce. */
export interface AllowedActions {
  atacar: boolean;
  defender: boolean;
  objetos: boolean;
  cambiar: boolean;
  capturar: boolean;
  huir: boolean;
  /** Por qué no se puede actuar, si no se puede. */
  motivo: string | null;
}

export function allowedActions(state: BattleState): AllowedActions {
  if (state.finished) {
    return {
      atacar: false, defender: false, objetos: false, cambiar: false,
      capturar: false, huir: false,
      motivo: 'El combate ha terminado.',
    };
  }

  if (state.awaitingSwitch) {
    return {
      atacar: false, defender: false, objetos: false,
      cambiar: true, capturar: false, huir: false,
      motivo: 'Tu Digimon ha caído: tienes que cambiar antes de continuar.',
    };
  }

  const jugador = state.player;

  // Un Digimon dormido, congelado o paralizado no puede actuar, y la interfaz
  // tiene que saberlo para no ofrecer botones que el motor va a rechazar.
  const inmovilizado =
    jugador.status === 'dormir' ||
    jugador.status === 'congelado' ||
    jugador.status === 'paralisis';

  const algunaHabilidad = jugador.moves.some((m) => m.energyCost <= jugador.energy);
  const tieneObjetos = state.items.some((i) => i.quantity > 0);

  return {
    atacar: algunaHabilidad,
    defender: !inmovilizado,
    objetos: tieneObjetos && !inmovilizado,
    cambiar: state.party.filter((d) => d.hp > 0).length > 1,
    capturar: !state.isBoss && state.enemy.hp > 0 && !state.enemy.boss,
    huir: !state.isBoss,
    motivo: inmovilizado
      ? `${jugador.name} está ${jugador.status} y no puede actuar.`
      : !algunaHabilidad && !tieneObjetos
        ? 'Sin energía ni objetos: solo puedes defender.'
        : null,
  };
}

// ---------------------------------------------------------- reloj de turno --

/** Milisegundos que quedan del turno. */
export function turnRemainingMs(state: BattleState, now = Date.now()): number {
  if (state.finished) return 0;

  const elapsed = now - state.turnGuard.startedAt;
  return Math.max(0, state.turnSeconds * 1000 - elapsed);
}

export function turnExpired(state: BattleState, now = Date.now()): boolean {
  return state.finished ? false : turnRemainingMs(state, now) <= 0;
}

// ------------------------------------------------------ guardia de turno ----

export type SubmitResult =
  | { ok: true; alreadyResolved: false }
  | { ok: false; reason: 'turno-ya-resuelto'; turn: number }
  | { ok: false; reason: 'combate-terminado' }
  | { ok: false; reason: 'cambio-pendiente' }
  | { ok: false; reason: 'combate-desconocido' };

/**
 * ¿Se puede resolver ESTE turno?
 *
 * El giro es lo que convierte un doble clic en un turno fantasma: Discord
 * entrega dos interacciones y la segunda llegaría con el turno ya resuelto.
 *
 * No es un cierre del handler de Discord. Si lo fuera, un collector antiguo o
 * un comando podrían saltárselo, y el fallo aparecería solo en desarrollo.
 */
export function canSubmit(state: BattleState, turnoEsperado?: number): SubmitResult {
  if (state.finished) {
    return { ok: false, reason: 'combate-terminado' };
  }

  if (state.awaitingSwitch) {
    return { ok: false, reason: 'cambio-pendiente' };
  }

  // Igualdad, NO mayor-igual: se envió si `resolved` ES el turno actual.
  // El turno que trae el botón es la única forma de saber si este clic es
  // nuevo o es un clic tarde o un doble clic. Sin él, un botón que quedó en
  // pantalla desde hace tres turnos sería indistinguible de uno recién pintado.
  if (turnoEsperado !== undefined && state.turn !== turnoEsperado) {
    return { ok: false, reason: 'turno-ya-resuelto', turn: state.turn };
  }

  return { ok: true, alreadyResolved: false };
}

/**
 * Marca el turno como resuelto ANTES de llamar al motor.
 *
 * El orden importa. Si se marcara después, dos clics simultáneos pasarían
 * los dos la comprobación y ambos entrarían en `resolveTurn`. Marcando antes,
 * el segundo llega, ve que el turno ya está resuelto y se va.
 *
 * Si el motor lanzara una excepción, el turno quedaría marcado como resuelto
 * sin haberse jugado. Eso es preferible a que un turno se juegue dos veces: lo
 * primero se recupera recargando el mensaje, lo segundo no.
 */
export function claimTurn(state: BattleState, turnoEsperado?: number): boolean {
  // Sin turno esperado (una llamada interna o un comando) se acepta: en ese
  // caso quien llama ES la fuente de verdad del turno.
  if (turnoEsperado !== undefined && state.turn !== turnoEsperado) return false;
  state.turnGuard.resolved = state.turn;
  state.turnGuard.requests += 1;
  return true;
}

/** Prepara el siguiente turno: pone el reloj a cero y reabre la máquina. */
export function beginTurn(state: BattleState, now = Date.now()): void {
  state.turnGuard.startedAt = now;
  state.status = 'esperando';
  state.stats.turns = state.turn;
}

export { TURN_SECONDS, MAX_EVENTS };
export type { BattleEvent, BattleMode, BattleStatus, TurnGuard };