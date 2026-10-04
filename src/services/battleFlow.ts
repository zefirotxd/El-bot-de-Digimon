import {
  attachRuntime,
  emit,
  isFainted,
  newBattleId,
  resolveTurn,
  switchCandidates,
  switchTo,
  type BattleState,
} from '../game/combat.js';
import {
  allowedActions,
  beginTurn,
  canSubmit,
  claimTurn,
  turnExpired,
  turnRemainingMs,
  type AllowedActions,
} from '../game/battleRuntime.js';
import { TURN_SECONDS, type BattleMode } from '../game/battleEvents.js';
import type { Action, Fighter, ItemUse, MoveDef, OwnedDigimon } from '../game/types.js';
import { enEspera } from '../game/statuses.js';
import { rng } from '../game/random.js';

/**
 * Servicio de combate para la interfaz.
 *
 * ES LA FRONTERA. Todo lo que la GUI hace con un combate pasa por aquí, y nada
 * de lo que hay dentro calcula reglas: llama al motor, comprueba la validez del
 * turno y devuelve.
 *
 * El reparto es lo que evita duplicar lógica:
 *
 *   combat.ts          reglas: daño, turnos, estados, equipo
 *   battleRuntime.ts   ciclo de vida: reloj, guardia de doble clic
 *   battleFlow.ts      ESTE FICHERO: la(transaction de una acción)
 *   ui/                pintura: lee, no piensa
 *
 * Por qué existe `battleFlow` y no llamar al motor desde los botones: un botón
 * que decide cuándo se puede actuar es un botón que se puede equivocar. Aquí se
 * comprueba UNA vez, y todos los caminos (botón, comando, tiempo agotado) pasan
 * por la misma puerta.
 */

export type ActionResult =
  | {
      ok: true;
      /** Cambió algo: hay que repintar el mensaje de combate. */
      changed: boolean;
      state: BattleState;
      /** Si el combate se acabó con esta acción. */
      finished: boolean;
    }
  | {
      ok: false;
      reason: 'turno-ya-resuelto' | 'combate-terminado' | 'cambio-pendiente' | 'combate-desconocido' | 'turno-agotado' | 'movimiento-enfriando';
      message: string;
      state: BattleState | null;
    };

/**
 * El texto que ve el jugador cuando la acción no se acepta.
 *
 * Vive aquí y no en la interfaz porque el servicio es quien sabe POR QUÉ se
 * rechaza, y un mensaje distinto en cada sitio acabaría siendo tres.
 */
export function mensajeDe(
  reason: 'turno-ya-resuelto' | 'combate-terminado' | 'cambio-pendiente' | 'combate-desconocido' | 'turno-agotado' | 'movimiento-enfriando',
): string {
  switch (reason) {
    case 'turno-ya-resuelto':
      return '⚠️ Este turno ya fue procesado.';
    case 'combate-terminado':
      return '⚠️ El combate ya ha terminado.';
    case 'cambio-pendiente':
      return '⚠️ Tu Digimon ha caído: tienes que cambiar antes de actuar.';
    case 'turno-agotado':
      return '⏰ Se agotó el tiempo de este turno.';
    case 'movimiento-enfriando':
      return '⏳ Ese movimiento se está enfriando. Mira el contador en su botón.';
    default:
      return '⚠️ Este combate ya no existe.';
  }
}

/**
 * Comprueba que una acción sea legal ANTES de gastarla.
 *
 * Vive aquí y no en la interfaz porque hay tres caminos que acaban en el motor:
 * un botón, un comando y el reloj. Si solo la interfaz comprobara el cooldown, el
 * comando `/atacar` dejaría saltárselo —que es como se exploita un botón que
 * debería estar apagado— y la comprobación del reloj tampoco.
 *
 * El turno ya lo comprueba `canSubmit`, que es otra pregunta: "este turno ya se
 * jugó" no es "este movimiento está frío".
 */
export function accionValida(
  state: { finished: boolean; awaitingSwitch: boolean },
  action: { type: string; move?: { key: string; name?: string } },
  fighter: Fighter,
): { ok: true } | { ok: false; motivo: string; reason: SubmitMotivo } {
  if (state.finished) {
    return { ok: false, motivo: 'El combate ya ha terminado.', reason: 'combate-terminado' };
  }

  if (state.awaitingSwitch) {
    return {
      ok: false,
      motivo: 'Tu Digimon ha caído: tienes que cambiar antes de continuar.',
      reason: 'cambio-pendiente',
    };
  }

  if (action.type !== 'movimiento' || !action.move) return { ok: true };

  const espera = enEspera(fighter, action.move.key);
  if (espera > 0) {
    return {
      ok: false,
      motivo:
        `**${action.move.name ?? action.move.key}** se está enfriando: ${espera} turno(s).`,
      reason: 'movimiento-enfriando',
    };
  }

  return { ok: true };
}

/** Por qué se rechaza una acción. */
export type SubmitMotivo =
  | 'turno-ya-resuelto'
  | 'combate-terminado'
  | 'cambio-pendiente'
  | 'combate-desconocido'
  | 'turno-agotado'
  | 'movimiento-enfriando';

/** Combate terminado, con sus cifras. */
export interface BattleSummary {
  outcome: 'victoria' | 'derrota' | 'huida';
  turns: number;
  dealt: number;
  taken: number;
  /** Especie capturada, si hubo captura. */
  captured: string | null;
  /** Daño hecho al jefe, para la contribución. */
  bossDamage: number;
}

/**
 * Envía una acción al motor, una sola vez por turno.
 *
 * La guardia va ANTES de tocar nada. Si el turno ya se resolvió —porque llegó un
 * segundo clic, o porque el reloj se agotó y el timeout ya lo jogó— la acción se
 * rechaza con un mensaje y el estado no se toca.
 *
 * El reloj se comprueba aquí y no con un temporizador de Discord porque el
 * resultado tiene que estar en el ESTADO: si se resolviera desde un `setTimeout`
 * externo, un reinicio del bot dejaría el turno colgado.
 */
export function submitAction(
  state: BattleState,
  action: Action,
  /**
   * Turno para el que se pinto el boton.
   *
   * OBLIGATORIO a proposito. El estado por si solo no puede saber si un clic
   * es nuevo o es un doble: al resolver, `turn` avanza y los dos casos
   * comparten numero. El turno del boton es lo que los distingue, asi que
   * dejarlo opcional era abrir un agujero silencioso.
   */
  turno: number,
  now = Date.now(),
  /**
   * Saltarse el reloj.
   *
   * Solo lo usa `timeoutTurn`, que es justo el camino que actua cuando el
   * reloj ya sono. Sin esto, el aviso de caducidad impediria resolver el turno
   * y el combate se quedaria colgado para siempre.
   */
  opciones: { allowExpired?: boolean } = {},
): ActionResult {
  // El combate puede haber terminado mientras el mensaje seguía en pantalla.
  if (!state) {
    return {
      ok: false,
      reason: 'combate-desconocido',
      message: '⚠️ Este combate ya no existe.',
      state: null,
    };
  }

  // El cooldown se comprueba AQUÍ y no solo en la pantalla.
  //
  // Hay tres caminos que acaban en el motor: un botón, un comando y el reloj.
  // Si solo la interfaz lo comprobara, un comando dejaria saltarselo, que es
  // justo como se explota un boton que deberia estar apagado.
  const frialdad = accionValida(state, action, state.player);
  if (!frialdad.ok) {
    return {
      ok: false,
      reason: frialdad.reason,
      message: frialdad.motivo,
      state,
    };
  }

const permiso = canSubmit(state, turno);

  // El reloj va aparte: "este turno ya se jugó" y "llegó el reloj" son
  // preguntas distintas, y mezclarlas hacía que el timeout no pudiera dispararse.
  if (!opciones.allowExpired && turnExpired(state, now)) {
    return {
      ok: false,
      reason: 'turno-agotado',
      message: mensajeDe('turno-agotado'),
      state,
    };
  }
  if (!permiso.ok) {
    return {
      ok: false,
      reason: permiso.reason,
      message: mensajeDe(permiso.reason),
      state,
    };
  }

  // Se marca ANTES de resolver. Dos clics simultáneos pasan los dos la
  // comprobación si se marcara después, y jugarían dos turnos.
if (!claimTurn(state, turno)) {
    return {
      ok: false,
      reason: 'turno-ya-resuelto',
      message: mensajeDe('turno-ya-resuelto'),
      state,
    };
  }

  state.status = 'resolviendo';

  const antes = state.log.length;
  resolveTurn(state, action, rng);

  // Turno nuevo: el reloj vuelve a cero y la máquina se reabre.
  beginTurn(state, now);
  if (state.finished) {
    state.status = 'terminado';
    emit(state, { kind: 'resultado', outcome: state.result ?? 'derrota' });
  } else if (state.awaitingSwitch) {
    state.status = 'cambio_obligatorio';
  }

  return {
    ok: true,
    changed: state.log.length !== antes || state.finished || state.awaitingSwitch,
    state,
    finished: state.finished,
  };
}

/**
 * Agota el turno con una acción automática.
 *
 * Se usa cuando el reloj se agota. DEFENDER es la choice menos mala: no gasta
 * energía ni objetos y no puede fallar.
 *
 * Devuelve `null` si el turno ya estaba resuelto, que es lo que pasa cuando el
 * reloj salta y el jugador ha pulsado a la vez. Sin esa comprobación, un timeout
 * podría jugar un turno que ya se había jugado.
 */
export function timeoutTurn(state: BattleState, now = Date.now()): ActionResult | null {
  if (!turnExpired(state, now)) return null;
  if (!canSubmit(state, state.turn).ok) return null;

  emit(state, { kind: 'mensaje', text: '⏰ Tiempo agotado: se aplica DEFENDER.' });
  return submitAction(state, { type: 'defender' }, state.turn, now, { allowExpired: true });
}

/**
 * Cambia de Digimon.
 *
 * No es una acción de turno: se permite aunque el combate esté esperando, porque
 * es la única cosa que se puede hacer cuando `awaitingSwitch` está activo. La
 * validación de "¿está vivo?" la hace `switchTo` del MOTOR, no esta capa: la
 * interfaz ya filtra los caídos, pero el filtro es una comodidad y el motor
 * sigue siendo quien dice que no.
 */
export function requestSwitch(
  state: BattleState,
  digimonId: number,
): { ok: boolean; message: string; switched: boolean } {
  if (state.finished) {
    return { ok: false, message: 'El combate ya ha terminado.', switched: false };
  }

  const ok = switchTo(state, digimonId);

  if (!ok) {
    return {
      ok: false,
      message: '⚠️ No puedes cambiar a ese Digimon.',
      switched: false,
    };
  }

  state.awaitingSwitch = false;
  state.status = 'esperando';
  emit(state, { kind: 'entrada', target: state.player.name, trainer: null });

  return { ok: true, message: '', switched: true };
}

// ------------------------------------------------------------- lectura ----

export function actionsNow(state: BattleState): AllowedActions {
  return allowedActions(state);
}

export function clock(state: BattleState, now = Date.now()): {
  seconds: number;
  expired: boolean;
  total: number;
} {
  return {
    seconds: Math.ceil(turnRemainingMs(state, now) / 1000),
    expired: turnExpired(state, now),
    total: state.turnSeconds || TURN_SECONDS,
  };
}

/**
 * Digimon a los que se puede cambiar.
 *
 * Sale del motor (`switchCandidates`), que ya excluye a los caídos y al activo.
 * La interfaz lo pinta; no lo recalcula.
 */
export function candidates(state: BattleState): OwnedDigimon[] {
  return switchCandidates(state);
}

/** Digimon caídos, para la columna del equipo. */
export function faintedIn(state: BattleState, index: number): boolean {
  return isFainted(state, index);
}

export function summary(state: BattleState): BattleSummary {
  return {
    outcome: state.result ?? (state.finished ? 'derrota' : 'victoria'),
    turns: state.turn,
    dealt: state.stats.dealt,
    taken: state.stats.taken,
    captured: state.capturedSpeciesKey,
    bossDamage: state.enemy.boss?.damageTaken ?? 0,
  };
}

/** Movimientos del Digimon activo, para la pantalla de habilidades. */
export function movesOf(state: BattleState): MoveDef[] {
  return state.player.moves;
}

/** Objetos disponibles en este combate, tal cual los lleva el motor. */
export function itemsOf(state: BattleState): ItemUse[] {
  return state.items.filter((i) => i.quantity > 0);
}

/**
 * Encuentra el objeto por clave.
 *
 * Devuelve `null` si no está o si no queda ninguno. La interfaz no debe poder
 * construir una acción con un objeto que el motor no tiene: por eso el objeto
 * se busca aquí y no se pasa por parameter suelto.
 */
export function itemOf(state: BattleState, key: string): ItemUse | null {
  return state.items.find((i) => i.key === key && i.quantity > 0) ?? null;
}

/** Movimiento por clave. `null` si el Digimon no lo conoce. */
export function moveOf(state: BattleState, moveKey: string): MoveDef | null {
  return state.player.moves.find((m) => m.key === moveKey) ?? null;
}

/** Un combate nuevo, con su runtime. Para pruebas y para el PvP. */
export function newBattle(core: Parameters<typeof attachRuntime>[0], mode: BattleMode): BattleState {
  return attachRuntime(core, mode);
}

export { newBattleId, attachRuntime };
export type { BattleState };