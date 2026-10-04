import type { Attribute, Element, SpeciesDef } from './types.js';
import { getSpecies } from './species.js';

/**
 * Entrenadores rivales NPC.
 *
 * Hasta ahora cada combate era 1 contra 1, así que el sistema de cambio en
 * caliente (que ya existía) no lo usaba nadie y una batalla no era una
 * batalla. Un rival con 3-4 Digimon obliga a decidir a quién sacar.
 */

export interface TrainerTemplate {
  key: string;
  name: string;
  /** Frase corta que sale al empezar el combate. */
  intro: string;
  /** Especies de su equipo, con el nivel que lleva. */
  team: { speciesKey: string; level: number }[];
  /** Multiplicador de recompensa por ganarle. */
  rewardBonus: number;
  /** Si es un jefe de zona, no se puede huir. */
  boss: boolean;
}

/**
 * Plantillas por banda de nivel. El `level` de cada miembro está algo por
 * debajo del jugador para que un buen equipo suyo se gane, pero no de lejos.
 */
const TEMPLATES: TrainerTemplate[] = [
  {
    key: 'patrulla_inicial',
    name: 'Kaito',
    intro: '¡Esa zona es mía!',
    team: [
      { speciesKey: 'goburimon', level: 2 },
      { speciesKey: 'kunemon', level: 3 },
    ],
    rewardBonus: 1.4,
    boss: false,
  },
  {
    key: 'cazador_rookie',
    name: 'Rina',
    intro: 'Mis Digimon no han descansado en semanas.',
    team: [
      { speciesKey: 'betamon', level: 5 },
      { speciesKey: 'veldmon', level: 6 },
      { speciesKey: 'goburimon', level: 6 },
    ],
    rewardBonus: 1.5,
    boss: false,
  },
  {
    key: 'domador_hielo',
    name: 'Shiro',
    intro: 'El frío no se negocia.',
    // Mezcla de atributos a propósito: un rival de un solo atributo es
    // predecible y el jugador lo lee en dos turnos.
    team: [
      { speciesKey: 'garurumon', level: 15 },
      { speciesKey: 'greymon', level: 14 },
      { speciesKey: 'kunemon', level: 16 },
    ],
    rewardBonus: 1.6,
    boss: false,
  },
  {
    key: 'estratega_luz',
    name: 'Hikari',
    intro: 'Sé cuál es tu debilidad antes que tú.',
    team: [
      { speciesKey: 'angemon', level: 16 },
      { speciesKey: 'gatomon', level: 15 },
      { speciesKey: 'paulmon', level: 16 },
    ],
    rewardBonus: 1.6,
    boss: false,
  },
  {
    key: 'guerrero_greymon',
    name: 'Daigo',
    intro: 'Vengo de la Ruta del Volcán.',
    team: [
      { speciesKey: 'greymon', level: 18 },
      { speciesKey: 'growlmon', level: 17 },
      { speciesKey: 'togemon', level: 19 },
    ],
    rewardBonus: 1.7,
    boss: false,
  },
  {
    key: 'guerrero_viento',
    name: 'Sora',
    intro: 'Mis alas ya están listas.',
    team: [
      { speciesKey: 'birdramon', level: 19 },
      { speciesKey: 'biyomon', level: 17 },
      { speciesKey: 'kunemon', level: 20 },
    ],
    rewardBonus: 1.7,
    boss: false,
  },
  {
    key: 'veterano_ultimate',
    name: 'Mirei',
    intro: 'He visto caer a más Dover de los que puedes imaginar.',
    team: [
      { speciesKey: 'metalgreymon', level: 30 },
      { speciesKey: 'garudamon', level: 29 },
      { speciesKey: 'wargrowlmon', level: 31 },
      { speciesKey: 'kunemon', level: 28 },
    ],
    rewardBonus: 2.0,
    boss: false,
  },
  {
    key: 'veterano_hielo',
    name: 'Torge',
    intro: 'Tu Digimon va a necesitar una esterilla.',
    team: [
      { speciesKey: 'weregarurumon', level: 32 },
      { speciesKey: 'metalgreymon', level: 30 },
      { speciesKey: 'kunemon', level: 31 },
    ],
    rewardBonus: 2.0,
    boss: false,
  },
  {
    key: 'jefe_voltaje',
    name: 'Guardián del Voltaje',
    intro: 'NINGÚN Digimon cruza mi territorio.',
    team: [
      { speciesKey: 'metalgreymon', level: 38 },
      { speciesKey: 'garudamon', level: 38 },
      { speciesKey: 'weregarurumon', level: 38 },
    ],
    rewardBonus: 3.5,
    boss: true,
  },
  {
    key: 'jefe_crepúsculo',
    name: 'Guardián del Crepúsculo',
    intro: 'Lo que ves aquí no vuelve a su mundo.',
    team: [
      { speciesKey: 'wargrowlmon', level: 40 },
      { speciesKey: 'metalgreymon', level: 40 },
      { speciesKey: 'garudamon', level: 39 },
      { speciesKey: 'wargrowlmon', level: 40 },
    ],
    rewardBonus: 4.0,
    boss: true,
  },
  {
    key: 'leyenda',
    name: 'Guardián del Archivo',
    intro: 'Entonces has llegado hasta aquí.',
    team: [
      { speciesKey: 'wargreymon', level: 50 },
      { speciesKey: 'metalgarurumon', level: 50 },
      { speciesKey: 'magnadramon', level: 50 },
      { speciesKey: 'kimeramon', level: 50 },
    ],
    rewardBonus: 6.0,
    boss: true,
  },
];

export function getTemplates(): TrainerTemplate[] {
  return TEMPLATES;
}

/** Busca una plantilla por su clave. Lo usan las zonas para sus jefes. */
export function getTutorTemplate(key: string): TrainerTemplate | undefined {
  return TEMPLATES.find((t) => t.key === key);
}

/** Busca por nombre visible, para casar con `battleState.enemyTrainer`. */
export function getTutorTemplateByName(name: string): TrainerTemplate | undefined {
  return TEMPLATES.find((t) => t.name === name);
}

/** Nivel recomendado para una plantilla concreta. */
export function templateLevel(template: TrainerTemplate): number {
  const levels = template.team.map((m) => m.level);
  return Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
}

/**
 * Elige la plantilla que corresponde a un nivel de jugador, con margen para que
 * un jugador bien equipado se encuentre rivales más duros.
 */
export function rollTrainer(
  playerLevel: number,
  rng: { next(): number; int(a: number, b: number): number; pick<T>(items: readonly T[]): T },
  boss = false,
): TrainerTemplate {
  const candidates = TEMPLATES.filter(
    (t) => t.boss === boss && templateLevel(t) <= playerLevel + 4,
  );

  if (candidates.length === 0) {
    return boss ? TEMPLATES[TEMPLATES.length - 1]! : TEMPLATES[0]!;
  }

  // 60% la más cercana por encima, 40% cualquiera de las válidas.
  const sorted = [...candidates].sort((a, b) => templateLevel(b) - templateLevel(a));
  return rng.next() < 0.6 ? sorted[0]! : rng.pick(candidates);
}

/** Atributos que cubre el equipo de una plantilla (para verificar el reparto). */
export function templateAttributes(template: TrainerTemplate): Attribute[] {
  return template.team
    .map((m) => getSpecies(m.speciesKey)?.attribute)
    .filter((a): a is Attribute => Boolean(a));
}

/** Nota informativa: si el equipo del rival es de un solo atributo. */
export function monoAttribute(template: TrainerTemplate): boolean {
  return new Set(templateAttributes(template)).size === 1;
}

export type { SpeciesDef, Element };
