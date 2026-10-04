import { ENCOUNTER_TABLES, getSpecies } from './species.js';
import type { TrainerTemplate } from './trainers.js';

/**
 * Zonas del Mundo Digital.
 *
 * Antes `/explorar` era un tiro de dados sin contexto: no había ni idea de qué
 * te podía salir ni de qué te tocaba. Una zona le da al jugador un objetivo
 * ("necesito nivel 15 para el Bosque") y da sentido al farmer.
 */

export interface ZoneDef {
  key: string;
  name: string;
  emoji: string;
  /** Nivel recomendado para entrar cómodamente. */
  minLevel: number;
  /** Nivel a partir del cual la zona se queda corta. */
  maxLevel: number;
  /** Boss de la zona, o null si no tiene. */
  boss: string | null;
  /** Plantillas de rival que aparecen aquí. */
  trainers: string[];
  description: string;
  /** Bonus de DigByte específico de la zona (se suma al multiplicador). */
  bonus: number;
}

export const ZONES: ZoneDef[] = [
  {
    key: 'isla_inicial',
    name: 'Isla del Despertar',
    emoji: '🏝️',
    minLevel: 1,
    maxLevel: 11,
    boss: 'jefe_voltaje',
    trainers: ['patrulla_inicial', 'cazador_rookie'],
    description: 'El punto de entrada al Mundo Digital. Rookie tras Rookie.',
    bonus: 1,
  },
  {
    key: 'bosque_hielo',
    name: 'Bosque Gelido',
    emoji: '🌲',
    minLevel: 12,
    maxLevel: 24,
    boss: 'jefe_voltaje',
    trainers: ['domador_hielo', 'estratega_luz'],
    description: 'El frío castiga a quien no lleve preparación.',
    bonus: 1.3,
  },
  {
    key: 'ruta_volcan',
    name: 'Ruta del Volcán',
    emoji: '🌋',
    minLevel: 15,
    maxLevel: 26,
    boss: 'jefe_crepúsculo',
    trainers: ['guerrero_greymon', 'guerrero_viento'],
    description: 'Lava y Estoico. Aquí te esperan los que ya han evolucionado.',
    bonus: 1.5,
  },
  {
    key: 'ciudad_ruinas',
    name: 'Ciudad en Ruinas',
    emoji: '🏙️',
    minLevel: 27,
    maxLevel: 45,
    boss: 'jefe_crepúsculo',
    trainers: ['veterano_ultimate', 'veterano_hielo'],
    description: 'Los Ultimate deambulan entre escombros y cables muertos.',
    bonus: 1.8,
  },
  {
    key: 'abismo',
    name: 'Abismo Sin Nombre',
    emoji: '🕳️',
    minLevel: 46,
    maxLevel: 100,
    boss: 'leyenda',
    trainers: ['veterano_ultimate', 'veterano_hielo'],
    description: 'Aquí solo entran los que llegan hasta Mega. Y casi nadie sale.',
    bonus: 2.5,
  },
];

export function getZone(key: string): ZoneDef | undefined {
  return ZONES.find((z) => z.key === key);
}

export function defaultZone(): ZoneDef {
  return ZONES[0]!;
}

/** La zona que le toca a un jugador según su nivel. */
export function zoneForLevel(level: number): ZoneDef {
  // La primera cuyo máximo cubre el nivel; si es muy alto, la última.
  return ZONES.find((z) => level <= z.maxLevel) ?? ZONES[ZONES.length - 1]!;
}

/**
 * Bandas de aparición dentro de una zona.
 *
 * Se recalculan a partir de la zona en vez de estar fijas, para que cambiar el
 * rango de una zona no obligue a tocar el bestiario a mano.
 */
export function encounterKeysFor(zone: ZoneDef): string[] {
  const band =
    ENCOUNTER_TABLES.find((t) => zone.minLevel >= t.minLevel && zone.minLevel <= t.maxLevel) ??
    ENCOUNTER_TABLES[0]!;

  const keys = new Set(band.keys);

  // Se añade la banda siguiente al final de la zona para que la zona "tope"
  // siga teniendo algo nuevo que salida.
  const nextIndex = ENCOUNTER_TABLES.indexOf(band) + 1;
  const next = ENCOUNTER_TABLES[nextIndex];
  if (next && zone.maxLevel >= next.minLevel) {
    for (const key of next.keys) keys.add(key);
  }

  return [...keys];
}

/** Digimon que te puedes encontrar en una zona, con su nombre. */
export function zoneRoster(zone: ZoneDef): { key: string; name: string; emoji: string }[] {
  return encounterKeysFor(zone)
    .map((key) => getSpecies(key))
    .filter(Boolean)
    .map((s) => ({ key: s!.key, name: s!.name, emoji: s!.emoji }));
}

/** Si un jugador tiene el nivel para Patton una zona. */
export function canEnter(zone: ZoneDef, level: number): 'ok' | 'bajo' | 'fácil' {
  if (level < zone.minLevel) return 'bajo';
  if (level > zone.maxLevel) return 'fácil';
  return 'ok';
}

export const ENTRY_MESSAGES: Record<'ok' | 'bajo' | 'fácil', string> = {
  ok: '',
  bajo: '⚠️ Vas muy por debajo de tu nivel. Es posible que pierdas.',
  fácil: 'Esta zona se te queda corta, pero la recompensa sigue siendo buena.',
};

/** Plantillas de rival de una zona, filtrando las que existen. */
export function trainersInZone(
  zone: ZoneDef,
  templates: TrainerTemplate[],
): TrainerTemplate[] {
  return zone.trainers
    .map((key) => templates.find((t) => t.key === key))
    .filter((t): t is TrainerTemplate => Boolean(t));
}
