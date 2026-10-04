import type { Attribute, Element } from './types.js';

/**
 * Jefes de mazmorra y de incursión.
 *
 * Un jefe NO es "un enemigo con más PV". Cada uno tiene:
 *
 * - **Fases**: al cruzar umbrales de PV cambia de atributo, de resistencias y
 *   de dureza. Eso obliga a releer el emparejamiento a mitad de combate en vez
 *   de calcularlo una vez al principio.
 * - **Ataque telegrafiado**: avisa con varios turnos de antelación y hay una
 *   forma concreta de responded. Es lo que convierte la cola de turnos en una
 *   decisión en vez de una carrera.
 * - **Pasivas**:-curricular al PV, curación por turno, daño amplificado.
 *
 * Regla de diseño: cada fase tiene que cambiar ALGO que el jugador pueda ver en
 * el panel de análisis. Si una fase solo sube el PV, no es una fase.
 */

/** Cómo se responde a un ataque telegrafiado. */
export type TelegraphCounter =
  /** Defenderse: recorta mucho, pero gastas el turno. */
  | 'defender'
  /** Cambiar de Digimon: el nuevo entra fresco y aguanta parte. */
  | 'cambiar'
  /** Curarte: recorta y además repone. */
  | 'curar'
  /** Solo lo detiene un Digimon con ese elemento resistido. */
  | 'elemento';

export interface TelegraphDef {
  /** Movimiento que va a usar. Tiene que existir en el catálogo de movimientos. */
  moveKey: string;
  /** Cada cuántos turnos se anuncia uno nuevo. */
  every: number;
  /** Con cuántos turnos de aviso. 2 da tiempo a una reacción real. */
  lead: number;
  /** Multiplicador de daño sobre el poder del movimiento. */
  power: number;
  /** Qué lo mitiga. */
  counter: TelegraphCounter;
  /** Texto para el embed: qué tiene que hacer el jugador. */
  hint: string;
}

export interface BossPhase {
  /** La fase está activa desde esta fracción de PV (inclusive), de arriba abajo. */
  from: number;
  name: string;
  /** Atributo mientras dura la fase. Si se omite, mantiene el de la anterior. */
  attribute?: Attribute;
  /** Elementos a los que la fase es muy débil. */
  weakTo?: Element[];
  /** Elementos que la fase resiste. */
  resists?: Element[];
  /** Inmunidad temporal de la fase. */
  immuneTo?: Element[];
  /** Multiplicador del daño recibido. >1 = fase más dura. */
  damageTaken?: number;
  /** Curación por turno, como fracción del PV máximo. */
  regen?: number;
  /** Frase al entrar en la fase. */
  announce: string;
}

export interface BossDef {
  key: string;
  name: string;
  emoji: string;
  /** Especie base: aporta aspecto y estadísticas de partida. */
  speciesKey: string;
  level: number;
  attribute: Attribute;
  /** Multiplicador de PV sobre el de su especie. */
  hpScale: number;
  phases: BossPhase[];
  telegraph?: TelegraphDef;
  /** Si es el jefe global, este es su nombre público. */
  global?: boolean;
  lore: string;
}

/**
 * Los jefes, de menos a más duro.
 *
 * Los niveles están calibrados para un entrenador solo con equipo de nivel
 * equivalente o ligeramente superior: un jefe es exigente, no imposible.
 */
export const BOSSES: Record<string, BossDef> = {
  // ------------------------------------------------------------ mazmorras ---
  ceniza_viva: {
    key: 'ceniza_viva',
    name: 'Ceniza Viva',
    emoji: '🌋',
    speciesKey: 'ogremon',
    level: 28,
    attribute: 'datos',
    hpScale: 1.9,
    phases: [
      {
        from: 1,
        name: 'Forma de lava',
        announce: 'La roca se agrieta y algo respira dentro.',
        weakTo: ['agua', 'hielo'],
        resists: ['fuego', 'tierra'],
      },
      {
        from: 0.45,
        name: 'Furia ígnea',
        attribute: 'virus',
        announce: '¡Deja de contenerlo! La lava encuentra por dónde salir.',
        weakTo: ['agua', 'rayo'],
        resists: ['fuego', 'planta'],
        // Contrario a lo esperable: la fase "de fuego" resiste fuego.
        damageTaken: 1.25,
        regen: 0.05,
      },
      {
        from: 0,
        name: 'Colapso',
        announce: 'Se le acaban las fuerzas... y se lleva por delante lo que hay alrededor.',
        weakTo: ['agua', 'rayo'],
        damageTaken: 0.85,
      },
    ],
    telegraph: {
      moveKey: 'rugido_sismico',
      every: 5,
      lead: 2,
      power: 1.8,
      counter: 'defender',
      hint: 'Defiéndete: el rugido se lleva la mitad de la defensa.',
    },
    lore: 'Un geólogo convirtió una montaña en un condicionador.',
  },

  guardiana_luz: {
    key: 'guardiana_luz',
    name: 'Guardiana de la Luz',
    emoji: '🕊️',
    speciesKey: 'holyangemon',
    level: 34,
    attribute: 'vacuna',
    hpScale: 2.1,
    phases: [
      {
        from: 1,
        name: 'Voto',
        announce: 'Mantiene el juicio sobre ti.',
        weakTo: ['oscuridad'],
        resists: ['rayo', 'metal'],
        regen: 0.04,
      },
      {
        from: 0.4,
        name: 'Caída',
        attribute: 'virus',
        announce: 'La luz se apaga dentro de ella. Ahora es lo contrario de lo que era.',
        // Aquí está el giro: se vuelve INTOLERANTE a la luz. Si has dejado todo
        // tu daño en el elemento luz, te has quedado sin respuesta.
        immuneTo: ['luz'],
        weakTo: ['oscuridad', 'agua'],
        resists: ['viento'],
        damageTaken: 1.3,
      },
    ],
    telegraph: {
      moveKey: 'juicio_divino',
      every: 4,
      lead: 2,
      power: 2,
      counter: 'elemento',
      hint: 'Con un Digimon que resista luz el golpe se pierde casi entero.',
    },
    lore: 'Defendió la entrada del bosque tanto tiempo que confundió la fe con el odio.',
  },

  // --------------------------------------------------------------- global ---
  titanramon: {
    key: 'titanramon',
    name: 'Titanramon',
    emoji: '🗿',
    speciesKey: 'groundramon',
    level: 55,
    attribute: 'datos',
    hpScale: 3.4,
    global: true,
    phases: [
      {
        from: 1,
        name: 'Despertar',
        announce: 'La piedra lleva mil años quieta. Acaba de moverse.',
        weakTo: ['rayo'],
        resists: ['tierra', 'agua'],
      },
      {
        from: 0.75,
        name: 'Grieta',
        attribute: 'virus',
        announce: 'Se le abre una grieta y por dentro hay algo más joven.',
        weakTo: ['fuego', 'hielo'],
        resists: ['tierra', 'viento'],
        regen: 0.03,
      },
      {
        from: 0.4,
        name: 'Fractura',
        attribute: 'vacuna',
        announce: 'Las grietas se unen y ahora es tres cosas a la vez.',
        weakTo: ['oscuridad'],
        resists: ['fuego', 'rayo'],
        damageTaken: 1.4,
        regen: 0.05,
      },
      {
        from: 0,
        name: 'Último aliento',
        announce: 'No le queda piedra, pero todavía tiene fuerza.',
        weakTo: ['agua', 'oscuridad'],
        // Última fase más blanda a propósito: una pelea de 30 turnos contra un
        // jefe que se cura es una pelea lost, no una épica.
        damageTaken: 1.1,
      },
    ],
    telegraph: {
      moveKey: 'combo_terrestre',
      every: 4,
      lead: 2,
      power: 2.2,
      counter: 'cambiar',
      hint: 'Cambia de Digimon: el nuevo entra con la vida llena.',
    },
    lore: 'No es un Digimon: es el esqueleto de la montaña que alguien encontró y despertó.',
  },
};

export function getBoss(key: string): BossDef | undefined {
  return BOSSES[key];
}

/**
 * Fase que le corresponde a una fracción de PV dada.
 *
 * Recorre los umbrales de arriba abajo y se queda con el último que el jefe
 * todavía NO ha cruzado. Los umbrales son `above`: la fase 1 aguanta mientras
 * esté por encima de 1 (siempre), la fase 2 mientras esté por encima de 0.75,
 * etc.
 */
export function phaseAt(boss: BossDef, hpRatio: number): number {
  // La fase i sigue activa mientras el jefe esté POR ENCIMA del umbral de la
  // fase i+1. Al revés que contar cuántos umbrales ha cruzado, que es lo que
  // devolvía la fase equivocada a casi cualquier porcentaje.
  for (let i = 0; i < boss.phases.length - 1; i++) {
    if (hpRatio > boss.phases[i + 1]!.from) return i;
  }
  return boss.phases.length - 1;
}

/**
 * Fase a la que avanza el jefe con este PV, o null si ya está en la que le toca.
 *
 * Devuelve un indice, no un salto de uno en uno: si un golpe enorme lo baja de
 * 90% a 40%, tiene que quedarse en la fase 3, no en la 2 aunque no haya pasado
 * por ella.
 */
export function nextPhaseAt(boss: BossDef, hpRatio: number): number | null {
  const target = phaseAt(boss, hpRatio);
  return target;
}

/**
 * Cuánto recorta la respuesta del jugador un ataque telegrafiado.
 *
 * Los valores están elegidos para que ninguna respuesta sea gratis: defender es
 * la más segura pero te deja sin turno de ataque, y frenar con un Digimon del
 * elemento correcto es lo mejor pero exige haberlo SENDIDO en el equipo.
 */
export const COUNTER_REDUCTION = {
  defender: 0.6,
  cambiar: 0.5,
  curar: 0.4,
  /**
   * Depende del Digimon que tengas puesto. Es el mejor de los cuatro y a
   * cambio obliga a haber enviado el elemento correcto: no se improvisa.
   */
  elemento: 0.95,
  /** Sin la respuesta adecuada no se recorta nada. */
  ninguna: 0,
} as const;

/**
 * Qué tal lo para el jugador un Digimon concreto contra el telegrafiado.
 * Devuelve la fracción de daño que se lleva.
 */
export function telegraphExposure(
  resists: Element[],
  weakTo: Element[],
  element: Element,
): number {
  if (weakTo.includes(element)) return 2;
  if (resists.includes(element)) return 0.4;
  return 1;
}
