import type { Attribute } from './types.js';

/**
 * Capa 1 del sistema de combate: el atributo (piedra, papel o tijeras).
 *
 * En Digimon Story: Time Stranger solo Vacuna, Virus y Datos forman el triángulo
 * (Vacuna > Virus, Virus > Datos, Datos > Vacuna). Los otros cuatro
 * (Free, Variable, Unknown, No Data) no tienen ventaja ni desventaja: hacen
 * 1.0x siempre.
 */
export const ATTRIBUTE_STRONG = 1.25;
export const ATTRIBUTE_WEAK = 0.85;

/** Triángulo: cada atributo vence a este y pierde contra el siguiente. */
const BEATS: Record<Attribute, Attribute | null> = {
  vacuna: 'virus',
  virus: 'datos',
  datos: 'vacuna',

  // Sin ventaja ni desventaja.
  free: null,
  variable: null,
  unknown: null,
  sin_datos: null,
};

export const ATTRIBUTE_NAMES: Record<Attribute, string> = {
  vacuna: 'Vacuna',
  virus: 'Virus',
  datos: 'Datos',
  free: 'Free',
  variable: 'Variable',
  unknown: 'Unknown',
  sin_datos: 'Sin Datos',
};

export const ATTRIBUTE_EMOJI: Record<Attribute, string> = {
  vacuna: '💉',
  virus: '☣️',
  datos: '📊',
  free: '🕊️',
  variable: '🌀',
  unknown: '❓',
  sin_datos: '🚫',
};

/** Código corto para el Digivice. */
export const ATTRIBUTE_CODES: Record<Attribute, string> = {
  vacuna: 'VAC',
  virus: 'VIR',
  datos: 'DAT',
  free: 'FRE',
  variable: 'VAR',
  unknown: 'UNK',
  sin_datos: 'N/D',
};

/** Atributos que participan en el triángulo. */
export const TRIANGLE_ATTRIBUTES: Attribute[] = ['vacuna', 'virus', 'datos'];

export const ALL_ATTRIBUTES = Object.keys(BEATS) as Attribute[];

/** `true` si el atributo forma parte del triángulo RPS. */
export function isTriangular(attribute: Attribute): boolean {
  return BEATS[attribute] !== undefined && BEATS[attribute] !== null;
}

/**
 * Multiplicador de daño por atributo.
 *
 * `Variable` es un caso especial del canon: copia el atributo del rival, así que
 * nunca tiene ventaja ni desventaja. Se resuelve en `resolvedAttribute`.
 */
export function attributeMultiplier(attacker: Attribute, defender: Attribute): number {
  const a = resolveAttribute(attacker, defender);
  const d = resolveAttribute(defender, attacker);

  // `resolveAttribute` solo devuelve null si el atributo es nulo, lo cual no
  // ocurre con el union type real; el null esta ahi por seguridad.
  if (!a || !d) return 1;
  if (BEATS[a] === d) return ATTRIBUTE_STRONG;
  if (BEATS[d] === a) return ATTRIBUTE_WEAK;
  return 1;
}

/** Variable adopta el atributo del rival; el resto se queda como es. */
export function resolveAttribute(attribute: Attribute, opponent: Attribute): Attribute {
  return attribute === 'variable' ? opponent : attribute;
}

/**
 * Para el Digivice: contra qué atributos conviene bringar.
 * Devuelve los que te favorecen y los que te castigan.
 */
export function attributeMatchups(attribute: Attribute): {
  strong: Attribute[];
  weak: Attribute[];
  neutral: Attribute[];
} {
  const strong: Attribute[] = [];
  const weak: Attribute[] = [];
  const neutral: Attribute[] = [];

  for (const other of ALL_ATTRIBUTES) {
    const m = attributeMultiplier(attribute, other);
    if (m > 1) strong.push(other);
    else if (m < 1) weak.push(other);
    else neutral.push(other);
  }

  return { strong, weak, neutral };
}
