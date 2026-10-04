import type { Fighter, MoveDef, SpeciesDef, StatKey, StatusKind } from './types.js';
import { analyzeMatchup } from './elements.js';
import { hasStatus, STATUS_INFO } from './statuses.js';

/**
 * Personalidad de combate de un rival.
 *
 * Antes había una sola función que puntuaba movimientos por potencia y poco
 * más. Todos los rivales jugaban igual, así que ver la misma especie con dos
 * nombres distintos no significaba nada: el rival era un conjunto de
 * estadísticas con un nombre.
 *
 * Ahora cada rival puntúa con SU criterio. Y son dificultad distinta, sino
 * distinta forma de jugar: un agresivo y un táctico con los mismos números
 * toman decisiones opuestas.
 *
 * Dos cosas que esta IA NO hace, y por qué:
 *
 * 1. **No ve nada oculto.** Todo lo que suma sale de lo que el jugador también
 *    ve en la pantalla: atributos, PV, estados. Si supiera que el siguiente
 *    golpe va a ser crítico, el combate dejaría de ser un duelo.
 * 2. **No importa el motor.** `especieDe` se le INYECTA en vez de importarse,
 *    porque el motor necesita esta IA y si este módulo importara el motor
 *    tendríamos un círculo. La función que resuelve la especie la pasa quien
 *    llama, y solo ella sabe de Transformaciones y fases de jefe.
 */

/** Cómo puntúa un rival. */
export type Personalidad = 'agresivo' | 'tactico' | 'equilibrado' | 'cazador' | 'guardián';

export interface DecisionIA {
  action:
    | { type: 'movimiento'; move: MoveDef }
    | { type: 'defender' }
    | { type: 'huir'; success: boolean };
  /** Por qué lo ha hecho. Va al registro: el jugador tiene que poder leerlo. */
  motivo: string;
}

/**
 * Resuelve la especie efectiva de un combatiente.
 *
 * La inyecta el motor, que es quien sabe de fases de jefe y Transformaciones.
 */
export type ResolverEspecie = (fighter: Fighter) => SpeciesDef;

/** Lo que la IA sabe de la situación. */
export interface ContextoIA {
  /** El que decide. */
  actor: Fighter;
  /** El rival. */
  rival: Fighter;
  /** Personalidad del rival. */
  personalidad: Personalidad;
  /** Fase del jefe, si lo es. Solo lo mira `guardián`. */
  fase?: number;
  /** Aleatoriedad. Se inyecta para poder testear sinazar real. */
  azar: { chance(p: number): boolean; next(): number };
}

/** Ponderaciones de cada estilo. Todas en la misma escala: 1 = normal. */
interface Perfil {
  desc: string;
  emoji: string;
  /** Potencia bruta. */
  potencia: number;
  /** Ventaja de atributo y elemento. */
  ventaja: number;
  /** Poner un buff propio. */
  buff: number;
  /** Poner un debuff o inmovilizar. */
  debuff: number;
  /** Curarse de verdad. */
  cura: number;
  /** Buscar el remate. */
  remate: number;
  /** Castigar a un rival ya roto. */
  castigo: number;
  /** Defenderse cuando va perdiendo. */
  defensa: number;
}

export const PERFILES: Record<Personalidad, Perfil> = {
  agresivo: {
    desc: 'Prioriza ventajas de atributo, remates y buffs ofensivos.',
    emoji: '🔥',
    potencia: 1, ventaja: 1.4, buff: 0.8, debuff: 0.4,
    cura: 0.3, remate: 1.6, castigo: 1.2, defensa: 0.2,
  },
  tactico: {
    desc: 'Prioriza cambios, debuffs y protección.',
    emoji: '🧠',
    potencia: 0.7, ventaja: 0.8, buff: 0.5, debuff: 1.6,
    cura: 0.9, remate: 0.6, castigo: 1.0, defensa: 1.2,
  },
  equilibrado: {
    desc: 'Juega según lo que toque, sin obsesionarse con nada.',
    emoji: '⚖️',
    potencia: 1, ventaja: 1, buff: 0.7, debuff: 0.7,
    cura: 0.6, remate: 0.8, castigo: 0.8, defensa: 0.7,
  },
  cazador: {
    desc: 'Guarda energía y espera el momento del remate.',
    emoji: '🎯',
    potencia: 0.6, ventaja: 0.7, buff: 0.6, debuff: 0.6,
    cura: 0.5, remate: 2.2, castigo: 1.6, defensa: 0.9,
  },
  guardián: {
    desc: 'Cambia de plan en cada fase de la pelea.',
    emoji: '👑',
    potencia: 1.2, ventaja: 1.1, buff: 1, debuff: 0.8,
    cura: 0.4, remate: 1.2, castigo: 1, defensa: 0.6,
  },
};

/** El rótulo que sale en la ficha del rival. */
export const ESTILO: Record<Personalidad, string> = {
  agresivo: '🔥 AGRESIVO',
  tactico: '🧠 TÁCTICO',
  equilibrado: '⚖️ EQUILIBRADO',
  cazador: '🎯 CAZADOR',
  guardián: '👑 GUARDIÁN',
};

/**
 * Los tres planes del guardián, uno por fase.
 *
 * El jefe no cambia de personalidad a mitad de pelea: cambia de PLAN. Eso es lo
 * que convierte su barra de vida en una cuenta atrás, y no en una cifra que baja.
 */
export interface PlanGuardián {
  nombre: string;
  potencia: number;
  ventaja: number;
  buff: number;
  debuff: number;
}

const PLANES: PlanGuardián[] = [
  { nombre: 'Presión', potencia: 1.2, ventaja: 1.1, buff: 1, debuff: 0.8 },
  { nombre: 'Ofensiva', potencia: 1.4, ventaja: 1.3, buff: 0.7, debuff: 1 },
  { nombre: 'Todo o nada', potencia: 1.6, ventaja: 1.4, buff: 0.4, debuff: 0.6 },
];

/** El plan de una fase. Se queda en el último si le pasas un número mayor. */
export function planDeFase(fase: number): PlanGuardián {
  const i = Math.max(0, Math.min(PLANES.length - 1, Math.floor(fase) - 1));
  return PLANES[i]!;
}

/** Las estadísticas que modifica un buff o debuff. */
const ESTADO_DE: Record<string, StatusKind> = {
  attack_up: 'atk_up',
  attack_down: 'atk_down',
  defense_up: 'def_up',
  defense_down: 'def_down',
  speed_up: 'vel_up',
  speed_down: 'vel_down',
};

/** El estado que representa tocar `stat` en la dirección indicada. */
function estadoDeStat(stat: string, sube: boolean): StatusKind {
  const base = stat === 'defense' ? 'defense' : stat === 'speed' ? 'speed' : 'attack';
  return ESTADO_DE[`${base}_${sube ? 'up' : 'down'}`]!;
}

/**
 * Cuánto vale este movimiento para este rival.
 *
 * Devuelve `-1` si no se puede usar. Todo lo que suma sale de información que el
 * jugador también ve; si algún día hay un número aquí que no aparece en
 * pantalla, es un número que la IA no debería tener.
 */
/**
 * Pesos con los que se puntúa un movimiento.
 *
 * Son los seis criterios en los que un estilo se diferencia de otro. Los cuatro
 * primeros llegan al cálculo del daño; `cura`, `remate` y `castigo` se aplican
 * aquí dentro, al puntuar.
 */
export interface PesosPuntuacion {
  potencia: number;
  ventaja: number;
  buff: number;
  debuff: number;
  cura: number;
  remate: number;
  castigo: number;
}

export function puntuarMovimiento(
  move: MoveDef,
  ctx: ContextoIA,
  especieDe: ResolverEspecie,
  pesos: PesosPuntuacion,
): number {
  const { actor, rival } = ctx;

  if (move.energyCost > actor.energy) return -1;

  let puntos = move.power * pesos.potencia;

  if (move.power > 0) {
    const matchup = analyzeMatchup(
      { attribute: actor.attribute, species: especieDe(actor) },
      move.element,
      { attribute: rival.attribute, species: especieDe(rival) },
    );
    puntos *= matchup.total * pesos.ventaja;
  }

  // Un golpe de mucha potencia que falla la mitad no vale su potencia.
  puntos *= move.accuracy;

  const efecto = move.effect;
  const ratioRival = rival.hp / rival.stats.hp;

  if (efecto?.target === 'self' && efecto.statChange) {
    // Un buff que ya se tiene vale menos: renovarlo no aporta nada.
    const repetido = (Object.keys(efecto.statChange) as StatKey[]).some((s) =>
      hasStatus(actor, estadoDeStat(s, (efecto.statChange![s] ?? 1) >= 1)),
    );
    puntos *= pesos.buff * (repetido ? 0.15 : 1);
  }

  if (efecto?.target === 'enemy') {
    // Un debuff sobre alguien que ya lo tiene se desperdicia.
    const yaLoTiene = efecto.status ? hasStatus(rival, efecto.status) : false;
    puntos *= pesos.debuff * (yaLoTiene ? 0.2 : 1);

    // Romper al rival vale más cuando ya está roto.
    if (ratioRival < 0.5) puntos *= 1 + pesos.debuff * 0.15;
  }

  // Curar: solo cuenta si de verdad le falta algo. Sin esto, un Digimon con la
  // vida llena se curaría "por si acaso" y tiraría el turno.
  if (move.heal && move.heal > 0) {
    const falta = actor.stats.hp - actor.hp;
    const util = falta > actor.stats.hp * 0.15;
    puntos = util ? (falta / Math.max(1, actor.stats.hp)) * 900 * pesos.cura : 0.05;
  }

  // Inmovilizar a alguien que no lo está vale más que repetirlo.
  if (efecto?.status && STATUS_INFO[efecto.status].control && !hasStatus(rival, efecto.status)) {
    puntos *= 1.25;
  }

  // Remate: por debajo del 25% de PV, el golpe que lo acaba vale más.
  if (move.power > 0 && ratioRival < 0.25) puntos *= 1 + pesos.remate * 0.25;

  return puntos;
}

/**
 * Qué hace el rival este turno.
 *
 * El orden de las comprobaciones es el orden de la decisión, y está escrito a
 * propósito:
 *
 * 1. Huir, pero no antes de tiempo. Un aggressive wounded sale corriendo; un
 *    táctico se queda, porque Cree que puede remontar.
 * 2. Si solo queda defenderse, defenderse.
 * 3. Y si no, puntuar con SU personalidad.
 *
 * Un remate o una curación NO tienen atajo: se puntúan como cualquier otro
 * movimiento pero con su ponderación, así que un agresivo cura poco, un táctico
 * remata poco, y ninguno de los dos se convierte en una máquina de una sola
 * pieza.
 */
export function decidir(ctx: ContextoIA, especieDe: ResolverEspecie): DecisionIA {
  const { actor, rival, azar, personalidad } = ctx;
  const perfil = PERFILES[personalidad];

  const pesos: PesosPuntuacion =
    personalidad === 'guardián'
      ? {
          ...planDeFase(ctx.fase ?? 1),
          // El guardián no cura ni busca remates: su plan cambia de phase, no
          // de personalidad. Se deja en 1, que es "sin bonificación".
          cura: 1,
          remate: 1,
          castigo: 1,
        }
      : {
          potencia: perfil.potencia,
          ventaja: perfil.ventaja,
          buff: perfil.buff,
          debuff: perfil.debuff,
          cura: perfil.cura,
          remate: perfil.remate,
          castigo: perfil.castigo,
        };

  // --- 1. Huir, pero no antes de tiempo ---------------------------------
  const ratio = actor.hp / actor.stats.hp;
  if (!actor.boss && ratio < 0.15 && personalidad === 'agresivo' && azar.chance(0.15)) {
    return {
      action: { type: 'huir', success: azar.chance(0.4) },
      motivo: 'Intenta huir',
    };
  }

  // --- 2. Movimientos ---------------------------------------------------
  const puntuados = actor.moves
    .map((move) => ({ move, puntos: puntuarMovimiento(move, ctx, especieDe, pesos) }))
    .filter((x) => x.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos);

  const mejor = puntuados[0];

  if (!mejor) {
    // Sin nada que hacer, un táctico se protege y un agresivo se lanza con lo
    // que tenga. La diferencia es el perfil, no el número.
    return {
      action: { type: 'defender' },
      motivo: perfil.defensa > 0.9 ? 'Se protege' : 'No le queda nada',
    };
  }

  return {
    action: { type: 'movimiento', move: mejor.move },
    motivo: mejor.move.name,
  };
}

/** La ficha corta de un rival, para pintar su estilo junto al nombre. */
export function fichaRival(nombre: string, personalidad: Personalidad) {
  return {
    nombre,
    estilo: ESTILO[personalidad],
    emoji: PERFILES[personalidad].emoji,
    desc: PERFILES[personalidad].desc,
  };
}