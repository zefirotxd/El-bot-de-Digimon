import type { Attribute, Element, SpeciesDef } from './types.js';
import { attributeMultiplier, ATTRIBUTE_NAMES } from './attributes.js';

/**
 * Capa 2 del sistema de combate: afinidades elementales.
 *
 * A diferencia de un chart global tipo Pokémon, en Digimon Story: Time Stranger
 * cada Digimon tiene sus propias resistencias y debilidades (los símbolos
 * ◎ 2x / 〇 1.5x / △ 0.5x / X 0x de la pantalla de stats). Por eso aquí no hay
 * una tabla global: la afinidad vive en cada especie, en `resists` y `weakTo`.
 *
 * Los 11 elementos son: Fuego, Hielo, Planta, Agua, Rayo, Metal, Viento, Tierra,
 * Luz, Oscuridad y Nulo.
 */

/** Escala del juego, suavizada para que un doble counter no sea instantáneo. */
export const ELEMENT_WEAK = 1.8; // ◎ el objetivo es muy débil a esto
export const ELEMENT_RESIST = 0.6; // △ el objetivo resiste esto
export const ELEMENT_IGNORE = 0; // X inmune

export const ELEMENT_NAMES: Record<Element, string> = {
  fuego: 'Fuego',
  hielo: 'Hielo',
  planta: 'Planta',
  agua: 'Agua',
  rayo: 'Rayo',
  metal: 'Metal',
  viento: 'Viento',
  tierra: 'Tierra',
  luz: 'Luz',
  oscuridad: 'Oscuridad',
  nulo: 'Nulo',
};

export const ELEMENT_EMOJI: Record<Element, string> = {
  fuego: '🔥',
  hielo: '❄️',
  planta: '🌿',
  agua: '💧',
  rayo: '⚡',
  metal: '⚙️',
  viento: '🌪️',
  tierra: '⛰️',
  luz: '✨',
  oscuridad: '🌑',
  nulo: '⭕',
};

export const ELEMENT_CODES: Record<Element, string> = {
  fuego: 'FUE',
  hielo: 'HIE',
  planta: 'PLA',
  agua: 'AGU',
  rayo: 'RAY',
  metal: 'MET',
  viento: 'VIE',
  tierra: 'TIE',
  luz: 'LUZ',
  oscuridad: 'OSC',
  nulo: 'NUL',
};

export const ALL_ELEMENTS = Object.keys(ELEMENT_NAMES) as Element[];

/** Elementos que este Digimon usa para sus golpes con ventaja propia (STAB). */
export function ownElements(species: SpeciesDef): Element[] {
  return species.elements;
}

/** Símbolo del juego para mostrar afinidad en el Digivice. */
export function affinitySymbol(multiplier: number): string {
  if (multiplier >= 1.8) return '◎'; // muy débil
  if (multiplier >= 1.2) return '〇'; // ventaja
  if (multiplier > 0.01) return '△'; // resiste
  return 'X'; // inmune
}

/**
 * Multiplicador elemental de un movimiento contra una especie concreta.
 * Se apoya en las afinidades declaradas por el Digimon, no en un chart global.
 */
export function elementMultiplierAgainst(moveElement: Element, target: SpeciesDef): number {
  if (moveElement === 'nulo') return 1;
  if (target.immuneTo?.includes(moveElement)) return ELEMENT_IGNORE;
  if (target.weakTo.includes(moveElement)) return ELEMENT_WEAK;
  if (target.resists.includes(moveElement)) return ELEMENT_RESIST;
  return 1;
}

/** Ventaja por usar un movimiento del mismo tipo que el Digimon (STAB). */
export const STAB_BONUS = 1.2;

/**
 * Multiplicador total de un golpe: las dos capas multiplican entre sí.
 *
 * Es la idea central de Time Stranger: un Ataque de tipo Vacuna (fuerte contra
 * Virus) que además es Fuego contra un rival débil a Fuego pega el doble de
 * fuerte, mientras que ese mismo Ataque contra un rival que resiste Fuego deja
 * al Virus ganar solo por el atributo.
 */
export function totalMultiplier(
  attacker: { attribute: Attribute; species: SpeciesDef },
  moveElement: Element,
  defender: { attribute: Attribute; species: SpeciesDef },
): number {
  const byAttribute = attributeMultiplier(attacker.attribute, defender.attribute);
  const byElement = elementMultiplierAgainst(moveElement, defender.species);
  const stab = attacker.species.elements.includes(moveElement) ? STAB_BONUS : 1;

  return byAttribute * byElement * stab;
}

/** Desglose legible para el log y para el panel de "análisis" del Digivice. */
export interface MatchupBreakdown {
  attribute: number;
  element: number;
  stab: number;
  total: number;
}

export function analyzeMatchup(
  attacker: { attribute: Attribute; species: SpeciesDef },
  moveElement: Element,
  defender: { attribute: Attribute; species: SpeciesDef },
): MatchupBreakdown {
  const attribute = attributeMultiplier(attacker.attribute, defender.attribute);
  const element = elementMultiplierAgainst(moveElement, defender.species);
  const stab = attacker.species.elements.includes(moveElement) ? STAB_BONUS : 1;
  return { attribute, element, stab, total: attribute * element * stab };
}

/** 1.0 -> "neutral" para el texto del combate. */
export function effectivenessText(multiplier: number): string | null {
  if (multiplier >= 1.5) return '¡Devastador!';
  if (multiplier > 1.08) return '¡Es supereficaz!';
  if (multiplier <= 0.01) return '¡No le afecta!';
  if (multiplier < 0.92) return 'No es muy eficaz...';
  return null;
}

/** Resumen de debilidades para la ficha del Digivice. */
export function affinityReport(target: SpeciesDef): {
  weak: Element[];
  resists: Element[];
  immune: Element[];
} {
  const weak = ALL_ELEMENTS.filter((e) => target.weakTo.includes(e));
  const immune = target.immuneTo ?? [];
  const resists = ALL_ELEMENTS.filter((e) => target.resists.includes(e) && !immune.includes(e));
  return { weak, resists, immune };
}

/** Texto corto para una fila de la tabla de afinidades del Digivice. */
export function elementLabel(element: Element): string {
  return `${ELEMENT_EMOJI[element]} ${ELEMENT_NAMES[element]}`;
}

export function attributeLabel(attribute: Attribute): string {
  return ATTRIBUTE_NAMES[attribute];
}
