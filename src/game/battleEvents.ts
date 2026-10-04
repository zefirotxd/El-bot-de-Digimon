import type { Element, StatusEffect, StatusKind } from './types.js';

/**
 * Eventos de combate.
 *
 * El motor hasta ahora solo dejaba un `log: string[]` con doce líneas y un
 * texto ya formateado. Eso vale para un embed, pero no para dos cosas que se
 * pidieron:
 *
 * 1. **El desglose del daño.** El motor ya lo calcula —base, atributo, elemento,
 *    STAB, equipo— y luego lo aplasta en un string. Quien pinte la pantalla no
 *    puede reconstruirlo, y si lo intentara tendría que duplicar la fórmula, que
 *    es exactamente lo que no debe pasar.
 * 2. **Los estados con turnos restantes.** `Fighter.status` es un enum sin
 *    contador, así que "⏱️ 2 turnos" no existía en ninguna parte.
 *
 * La solución es que el motor EMITA eventos mientras juega, y que la interfaz los
 * pinte. Nada se recalcula fuera: los números del panel de "SUPER EFFECTIVE"
 * salen de las mismas variables que aplicaron el daño.
 *
 * El `log: string[]` se conserva. Nadie lo quita, pero deja de ser la única
 * fuente: pasa a ser una proyección de texto de estos eventos para el embed
 * clásico.
 */

export type BattleMode =
  | 'salvaje'
  | 'entrenador'
  | 'jefe'
  | 'mazmorra'
  | 'raid'
  | 'pvp';

/**
 * Estado explícito del combate.
 *
 * Antes el motor tenía `finished` y `awaitingSwitch`, dos banderas sueltas que
 * había que combinar mentalmente para saber qué se podía hacer. Con la máquina
 * explícita, la interfaz puede preguntar "¿qué botonesenseñó?" y obtener una
 * respuesta, en vez de deducirla.
 */
export type BattleStatus =
  /** Se espera una acción del jugador. */
  | 'esperando'
  /** Se ha elegido acción y el motor está resolviendo. */
  | 'resolviendo'
  | 'efectos'
  /** Se comprueba si alguien ha caído. */
  | 'comprobando_caidas'
  /** El jugador debe cambiar de Digimon antes de continuar. */
  | 'cambio_obligatorio'
  | 'terminado';

/**
 * Etiqueta del efecto del multiplicador de interacción.
 *
 * Es lo que decide si el panel dice SUPER EFFECTIVE o RESISTED. La tabla está en
 * el motor y no en la interfaz para que el texto y el cálculo no se separen.
 */
export type Efectividad = 'supereficaz' | 'eficaz' | 'neutro' | 'ineficaz' | 'inmune' | null;

/**
 * Una instancia de daño con su cuenta completa.
 *
 * `base` es el daño bruto de la fórmula antes de cualquier multiplicador, y
 * `final` es lo que se.restó de verdad. Todo lo de en medio son los factores que
 * explican por qué no coinciden.
 */
export interface DamageBreakdown {
  /** Daño bruto de la fórmula de nivel/potencia/ATQ/DEF. */
  base: number;
  /** Multiplicador del triángulo de atributo. 1 = neutro. */
  attribute: number;
  /** Multiplicador de afinidad elemental del objetivo. 1 = neutro. */
  element: number;
  /** Ventaja propia (STAB). 1 = sin ventaja. */
  stab: number;
  /** Escala global del juego. */
  scale: number;
  /** Variación aleatoria del turno. */
  roll: number;
  /** Multiplicador de crítico, o 1 si no critizó. */
  crit: number;
  /** Daño final, ya redondeado y con el mínimo de 1 aplicado. */
  final: number;
  /** PV que tenía el objetivo antes. */
  targetHpBefore: number;
  /** PV que le quedan. */
  targetHpAfter: number;
  /** Qué pasó con el golpe según los multiplicadores. */
  effectiveness: Efectividad;
  critico: boolean;
}

/** Un evento del combate. La interfaz los pinta; no los interpreta. */
export type BattleEvent =
  | {
      kind: 'turno';
      turn: number;
      /** Índice de turno dentro de la ronda, para PvP. */
      round: number;
    }
  | {
      kind: 'ataque';
      actor: string;
      actorEmoji: string;
      move: string;
      element: Element;
      target: string;
      damage: DamageBreakdown;
      /**
       * Combo que se desbloqueó con este golpe, si desbloqueó alguno.
       *
       * Va dentro del evento y no aparte porque el bonus YA está aplicado dentro
       * de `damage.final`. Si la interfaz lo sumara otra vez al pintar, mostraría
       * un 12% más del que el combate aplicó, y el jugador vería que su crítico
       * hace más daño del que dice la pantalla.
       */
      combo?: { name: string; emoji: string; bonus: number } | null;
      /** Cuánto se llevó el escudo, si este golpe dio contra un escudo. */
      escudo?: number | null;
    }
  | { kind: 'fallo'; actor: string; move: string }
  | {
      kind: 'estado';
      target: string;
      targetEmoji: string;
      /** Estado de control principal. Es el resumen. */
      status: StatusEffect;
      /**
       * Qué estado es realmente.
       *
       * `status` no alcanza: un Digimon puede llevar a la vez una quemadura y un
       * +15% de Ataque, y el enum de control solo guarda uno. El panel de
       * efectos necesita saber cuál es cuál.
       */
      statusKind?: StatusKind;
      /**
       * Turnos que quedan. 0 = no caduca.
       *
       * Es lo que permite pintar "⏱️ 2 turnos" en lugar de un icono sin más, que
       * no deja decidir si merece la pena gastarse un turno en curarse.
       */
      turns: number;
      /**
       * Potencia: daño por turno, PV de escudo, o el multiplicador del buff.
       *
       * Sale del motor. Si la interfaz lo calculara, mostraría el número que ella
       * cree y no el que el combate aplica de verdad.
       */
      magnitude?: number;
      text: string;
    }
  | { kind: 'curacion'; target: string; amount: number; origen: string }
  | { kind: 'caida'; target: string; targetEmoji: string }
  | { kind: 'entrada'; target: string; trainer: string | null }
  | { kind: 'objeto'; target: string; item: string; texto: string }
  | { kind: 'defensa'; target: string }
  | { kind: 'fase'; boss: string; phase: number; nombre: string }
  | { kind: 'telegrafiado'; boss: string; move: string; turnos: number }
  | { kind: 'contraataque'; target: string; damage: number }
  | {
      kind: 'combo';
      nombre: string;
      emoji: string;
      bonus: number;
      actor: string;
    }
  | { kind: 'resultado'; outcome: 'victoria' | 'derrota' | 'huida' }
  | { kind: 'mensaje'; text: string };

/** Cifras del combate, para la pantalla de resultado. */
export interface BattleStats {
  /** Daño total infligido por el jugador. */
  dealt: number;
  /** Daño total recibido por el jugador. */
  taken: number;
  /** Turnos jugados. */
  turns: number;
  /** Daño que hizo el jefe, si lo hubo. Es lo que se usa para la contribución. */
  bossDamage: number;
}

/**
 * Un turno del registro, agrupado.
 *
 * El historial se muestra por turnos, no evento a evento: "Turno 3: Agumon →
 * Claw Attack, Greymon -31 PV" se lee mejor que cinco líneas sueltas, y es lo
 * que un jugador recuerda de una pelea.
 */
export interface LogTurn {
  turn: number;
  round: number;
  events: BattleEvent[];
}

/**
 * El combate no admite dos acciones para el mismo turno.
 *
 * Discord entrega dos interacciones si alguien pulsa dos veces, y la segunda
 * llegaría cuando el turno ya está resuelto. Sin este marca, el segundo clic
 * jugaría un turno entero de más.
 *
 * Va en el ESTADO y no en un cierre del handler de Discord: así funciona
 * igual si el clic viene de un botón, de un comando o de un collector antiguo.
 */
export interface TurnGuard {
  /** Último turno resuelto por el motor. */
  resolved: number;
  /** Cuándo empezó el turno actual. */
  startedAt: number;
  /** Cuántas veces se ha pedido resolver este turno. Se usa para diagnostics. */
  requests: number;
}

/** Segundos que tiene el jugador para actuar antes de que se agote. */
export const TURN_SECONDS = 45;

/** Cuántos eventos se guardan antes de empezar a recortar por el principio. */
export const MAX_EVENTS = 400;