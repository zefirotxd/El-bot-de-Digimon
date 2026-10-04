import type { Element, Fighter, MoveDef } from './types.js';

/**
 * Combos.
 *
 * Encadenar dos acciones concretas da un bonus. La idea es buena y el riesgo es
 * evidente: si el combo fuera LA estrategia óptima, el combate se reduce a
 * "apila el combo y ya". Por eso estáCAPADO de tres maneras, y las tres son
 * deliberadas.
 *
 * 1. **La ventana es de DOS turnos.** Se puede perder: si el rival se
 *    inmoviliza, se cambia o el combo no cuadra, la ventana se cierra.
 * 2. **El bonus es pequeño** (10-18% según el combo) y **no se acumula** por
 *    repetir el mismo.
 * 3. **Cada Digimon tiene sus propios combos**, no una tabla global. Es lo que
 *    hace que dos Agumon se juguen distinto: el mismo golpe encadena distinto
 *    con cada uno.
 *
 * Un combo que no se puede perder ni repetir no es una decisión.
 */

/** Un combo: dos movimientos, en cualquier orden. */
export interface ComboDef {
  key: string;
  name: string;
  emoji: string;
  /** Los dos movimientos que lo forman. En cualquier orden. */
  moves: [string, string];
  /** Multiplicador de daño: 0.12 = +12%. */
  bonus: number;
  /** Turnos que dura la ventana una vez se han dado los dos golpes. */
  ventana: number;
  desc: string;
}

/**
 * Los combos del juego.
 *
 * La clave es `a>b` y la orden no cuenta: `pepper>claw` salta tanto si hiciste
 * Pepper Breath y luego Claw Attack como al revés. Obligar a un orden concreto
 * convertiría el combo en un guion, y un guion no es una decisión del jugador.
 */
export const COMBOS: ComboDef[] = [
  {
    key: 'fuego_lanza',
    name: 'Llamarada',
    emoji: '🔥',
    moves: ['lanza_llamas', 'mega_llama'],
    bonus: 0.18,
    ventana: 2,
    desc: 'Dos ataques de fuego seguidos.',
  },
  {
    key: 'fuego_garra',
    name: 'Aplastamiento',
    emoji: '🔥',
    moves: ['lanza_llamas', 'garra'],
    bonus: 0.12,
    ventana: 2,
    desc: 'Fuego y después garra.',
  },
  {
    key: 'rayo_rayo',
    name: 'Sobrecarga',
    emoji: '⚡',
    moves: ['chispa', 'trueno'],
    bonus: 0.15,
    ventana: 2,
    desc: 'Chispa y Trueno encadenados.',
  },
  {
    key: 'agua_acido',
    name: 'Corrosión',
    emoji: '💧',
    moves: ['chorro_agua', 'acido_corrosivo'],
    bonus: 0.16,
    ventana: 2,
    desc: 'Agua y ácido seguidos.',
  },
  {
    key: 'acido_espina',
    name: 'Envenenamiento',
    emoji: '☠️',
    moves: ['acido_corrosivo', 'aguja_venenosa'],
    bonus: 0.14,
    ventana: 2,
    desc: 'Ácido y aguja venenosa.',
  },
  {
    key: 'sombra_golpe',
    name: 'Emboscada',
    emoji: '🌑',
    moves: ['darkness_ball', 'garrote'],
    bonus: 0.17,
    ventana: 2,
    desc: 'Oscuridad y golpe físico.',
  },
  {
    key: 'rayo_juicio',
    name: 'Castigo',
    emoji: '⚖️',
    moves: ['juicio_divino', 'rayo'],
    bonus: 0.2,
    ventana: 2,
    desc: 'Juicio Divino tras un Rayo.',
  },
  {
    key: 'aliento_rugido',
    name: 'Grito Dragón',
    emoji: '🐉',
    moves: ['aliento_dragon', 'rugido_dragon'],
    bonus: 0.16,
    ventana: 2,
    desc: 'Aliento y rugido de dragón.',
  },
  {
    key: 'combo_sismico',
    name: 'Fisura',
    emoji: '🌋',
    moves: ['combo_terrestre', 'rugido_sismico'],
    bonus: 0.15,
    ventana: 2,
    desc: 'Golpe terrestre y rugido sísmico.',
  },
  {
    key: 'magnetico_corte',
    name: 'Cuchilla',
    emoji: '⚙️',
    moves: ['bala_acero', 'cortador'],
    bonus: 0.14,
    ventana: 2,
    desc: 'Bala de acero y cortador.',
  },
  {
    key: 'mental_descarga',
    name: 'Colapso',
    emoji: '🧠',
    moves: ['pulso_mental', 'descarga_mental'],
    bonus: 0.18,
    ventana: 2,
    desc: 'Pulso y descarga mental.',
  },
  {
    key: 'carambano_agua',
    name: 'Hielo',
    emoji: '❄️',
    moves: ['carambano', 'chorro_agua'],
    bonus: 0.13,
    ventana: 2,
    desc: 'Carámbano y chorro de agua.',
  },
];

/**
 * Un combo que está a punto de completarse.
 *
 * `falta` es el movimiento que dispara. Se guarda para poder avisar al jugador
 * de que tiene la ventana abierta: sin eso, un combo es un efecto invisible que
 * aparece o no, y el jugador no puede tomar la decisión que lo activa.
 */
export interface ComboPendiente {
  combo: ComboDef;
  /** Clave del movimiento que se usó primero. */
  primero: string;
  /** Turnos que le quedan de ventana. */
  turnos: number;
  /** El movimiento que lo cierra. */
  falta: string;
}

/** Ventana abierta para este jugador. Vive en el estado del combate. */
export interface ComboState {
  pendiente: ComboPendiente | null;
  /** Combo ya desbloqueado este turno, para que la GUI lo pinte. */
  activo: ComboDef | null;
}

/** Estado inicial. */
export function comboInicial(): ComboState {
  return { pendiente: null, activo: null };
}

/**
 * Registra una acción y devuelve el combo que se ha desbloqueado, si alguno.
 *
 * NO aplica el bonus: eso lo hace el motor al calcular el daño, leyendo
 * `activo`. Aquí solo se decide SI lo hay. Separarlo es lo que permite que la
 * interfaz muestre "¡COMBO!" sin decidir cuánto suma.
 */
export function registrarAccion(state: ComboState, moveKey: string): ComboDef | null {
  // Un combo no se repite dentro de sí mismo: con el bonus ya aplicado, la
  // ventana se cierra para que no sea un multiplicador infinito.
  state.activo = null;

  // ¿Se completa un combo pendiente?
  if (state.pendiente && state.pendiente.falta === moveKey) {
    const combo = state.pendiente.combo;
    state.pendiente = null;
    state.activo = combo;
    return combo;
  }

  // ¿Se abre una ventana nueva?
  const abierto = COMBOS.find((c) => c.moves.includes(moveKey));
  if (!abierto) {
    state.pendiente = null;
    return null;
  }

  const otro = abierto.moves.find((m) => m !== moveKey)!;
  state.pendiente = {
    combo: abierto,
    primero: moveKey,
    turnos: abierto.ventana,
    falta: otro,
  };

  return null;
}

/** Cierra la ventana al pasar el turno. */
export function tickCombo(state: ComboState): void {
  if (!state.pendiente) return;

  state.pendiente.turnos -= 1;
  if (state.pendiente.turnos <= 0) state.pendiente = null;
}

/** El bonus que hay que aplicar al daño. */
export function bonusCombo(state: ComboState): number {
  return state.activo?.bonus ?? 0;
}

/**
 * Todos los combos que un Digimon puede llegar a hacer con SU kit.
 *
 * Lo usa la pantalla de habilidades para mostrar "🔗 se encadena con Claw
 * Attack", que es lo que convierte el combo en una decisión informada en vez de
 * una sorpresa.
 */
export function combosDe(moves: MoveDef[]): { combo: ComboDef; con: string[] }[] {
  const claves = new Set(moves.map((m) => m.key));
  const vistos = new Set<string>();

  const salida: { combo: ComboDef; con: string[] }[] = [];

  for (const combo of COMBOS) {
    if (vistos.has(combo.key)) continue;
    if (!claves.has(combo.moves[0]) && !claves.has(combo.moves[1])) continue;

    vistos.add(combo.key);
    salida.push({
      combo,
      con: combo.moves.filter((m) => claves.has(m)),
    });
  }

  return salida;
}

/** Etiqueta corta para el panel. */
export function resumenCombo(state: ComboState): string {
  if (state.activo) return `🔥 COMBO x2 · +${Math.round(state.activo.bonus * 100)}% daño`;
  if (state.pendiente) {
    return `🔗 ${state.pendiente.combo.name}: usa ${state.pendiente.falta} (⏱️ ${state.pendiente.turnos})`;
  }
  return '';
}

export type { Element, Fighter };