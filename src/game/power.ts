import { equippedGear } from './gearRepo.js';
import { applyGear, EQUIPMENT } from './equipment.js';
import { computeStats } from './stats.js';
import { getSpecies, TIER_NAMES } from './species.js';
import type { OwnedDigimon, Stats } from './types.js';

/**
 * Rating de poder para el matchmaking.
 *
 * Se calcula con lasestadísticas **reales y efectivas** (con equipo), no con
 * una fórmula aparte. Si el rating no saliera de las mismas cifras que usa el
 * combate, dos Digimon con el mismo "poder"|BEL se pelearían de forma
 * distinta y el emparejamiento mentiría.
 *
 * Los pesos reflejan qué pesa más de verdad: atacar más que defender, y la
 * velocidad poco (en estos combates casi no decide turnos).
 */
const WEIGHTS: Stats = { hp: 0.5, attack: 1.0, defense: 0.8, speed: 0.35 };

export interface PowerBreakdown {
  /** Rating total del equipo. */
  total: number;
  /** Nivel medio del equipo. */
  averageLevel: number;
  /** Cuántos Digimon hay en el equipo. */
  size: number;
  /** Atributos distintos cubiertos. */
  attributeCoverage: number;
  /** Potencia que aporta el equipo por sí solo. */
  basePower: number;
  /** Potencia que aporta el equipo puesto. */
  gearPower: number;
  /** Bonus por llevar los cuatro slots cubiertos. */
  coverageBonus: number;
}

export function statsPower(stats: Stats): number {
  return (
    stats.hp * WEIGHTS.hp +
    stats.attack * WEIGHTS.attack +
    stats.defense * WEIGHTS.defense +
    stats.speed * WEIGHTS.speed
  );
}

/** Bonus por tener las ranuras cubiertas: premia la build, no el nivel. */
const SLOT_COVERAGE_BONUS = 0.04;
const MAX_COVERAGE_BONUS = 0.16;

/** Bonus por diversity de atributos: un equipo mono-atributo es predecible. */
const ATTRIBUTE_BONUS_PER_EXTRA = 0.03;
const MAX_ATTRIBUTE_BONUS = 0.09;

/** Ranura de cada pieza, indexada por clave. */
const EQUIPMENT_SLOT: Record<string, string> = Object.fromEntries(
  Object.values(EQUIPMENT).map((def) => [def.key, def.slot]),
);

/**
 * Rating de un Digimon suelto.
 */
export function digimonPower(digimon: OwnedDigimon): {
  power: number;
  base: number;
  gear: number;
} {
  const statsBase = computeStats(digimon.species.base, digimon.level);
  const statsGear = applyGear(statsBase, equippedGear(digimon.id));

  const base = statsPower(statsBase);
  const withGear = statsPower(statsGear);

  return { power: withGear, base, gear: withGear - base };
}

/**
 * Rating del equipo entero. Es lo que compara el matchmaking.
 */
export function teamPower(party: OwnedDigimon[]): PowerBreakdown {
  if (party.length === 0) {
    return {
      total: 0,
      averageLevel: 0,
      size: 0,
      attributeCoverage: 0,
      basePower: 0,
      gearPower: 0,
      coverageBonus: 0,
    };
  }

  let basePower = 0;
  let gearPower = 0;
  let coveredSlots = 0;
  let slotCap = 0;
  const attributes = new Set<string>();

  for (const digimon of party) {
    const single = digimonPower(digimon);
    basePower += single.base;
    gearPower += single.gear;

    attributes.add(digimon.species.attribute);

    const gear = equippedGear(digimon.id);
    coveredSlots += new Set(gear.map((g) => EQUIPMENT_SLOT[g.itemKey] ?? 'x')).size;
    slotCap += 4;
  }

  const total = basePower + gearPower;

  // Ojo: los bonus se calculan primero como PORCENTAJE y luego se aplican.
  // Mezclarlos (usar el valor absoluto dentro del `1 + ...`) inflaba el rating
  // más de 40 veces y hacía que nadie Findsould emparejar.
  const coverageRatio = slotCap > 0 ? coveredSlots / slotCap : 0;
  const coverageRate = Math.min(MAX_COVERAGE_BONUS, coverageRatio * SLOT_COVERAGE_BONUS * 4);

  const attributeCoverage = attributes.size;
  const attributeRate = Math.min(
    MAX_ATTRIBUTE_BONUS,
    (attributeCoverage - 1) * ATTRIBUTE_BONUS_PER_EXTRA,
  );

  const totalRate = coverageRate + attributeRate;

  return {
    total: Math.round(total * (1 + totalRate)),
    averageLevel: Math.round(party.reduce((a, d) => a + d.level, 0) / party.length),
    size: party.length,
    attributeCoverage,
    basePower: Math.round(basePower),
    gearPower: Math.round(gearPower),
    coverageBonus: Math.round(total * totalRate),
  };
}

/**
 * Ventana de matchmaking aceptable.
 *
 * Los dos pueden tener un poder radicalmente distinto por el equipo, así que
 * emparejar solo por nivel metería a un jugador de nivel 40 contra otro de 40
 * con el triple de poder. Se exige que el poder esté dentro de esta ventana.
 */
export const MATCH_WINDOW = 0.12; // 12%
export const MATCH_ABSOLUTE_FLOOR = 0.04; // 4% del total

export function canMatch(a: number, b: number): boolean {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (hi <= 0) return false;

  const relative = (hi - lo) / hi;
  // La ventana se ensancha con equipos más grandes: con 3 Digimon hay más
  // suerte de partida y menos sensación de emparejamiento trucho.
  return relative <= MATCH_WINDOW;
}

export function powerRatio(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 1;
  return Math.max(a, b) / Math.min(a, b);
}

/** Texto corto para los embeds: "Nv.30 · 12.4k de poder · 3 atributos". */
export function powerLabel(breakdown: PowerBreakdown): string {
  return (
    `Nv.${breakdown.averageLevel} · ${formatPower(breakdown.total)} de poder · ` +
    `${breakdown.size} Digimon · ${breakdown.attributeCoverage} atributo` +
    `${breakdown.attributeCoverage > 1 ? 's' : ''}`
  );
}

export function formatPower(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

/** Desglose legible para el embed de "mi poder". */
export function powerBreakdownLines(digimon: OwnedDigimon): string[] {
  const single = digimonPower(digimon);
  const gear = equippedGear(digimon.id);

  const lines = [
    `${TIER_NAMES[digimon.species.tier]} · ${getSpecies(digimon.species.key)!.attribute}`,
    `Base: ${formatPower(single.base)} + Equipo: ${formatPower(single.gear)} = **${formatPower(single.power)}**`,
  ];

  if (gear.length === 0) {
    lines.push('*Sin equipo equipado.*');
  } else {
    lines.push(
      gear
        .map((piece) => {
          const def = EQUIPMENT[piece.itemKey];
          if (!def) return '';
          return `${def.emoji} ${def.name}${piece.upgrade > 0 ? ` +${piece.upgrade}` : ''}`;
        })
        .filter(Boolean)
        .join(' · '),
    );
  }

  return lines;
}

