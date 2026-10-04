import { Rng } from './random.js';
import { digibyteReward, expReward } from './stats.js';
import { ENCOUNTER_TABLES, getSpecies, TIER_NAMES } from './species.js';
import type { SpeciesDef, Tier } from './types.js';

export interface Encounter {
  species: SpeciesDef;
  level: number;
}

/**
 * Genera un encuentro salvaje adecuado al nivel del jugador.
 *
 * El 90% de las veces sale de la banda que corresponde a su nivel y el 10% de
 * la banda siguiente, como "rival fuerte" ocasional. Ese 10% importa mucho:
 * con un 20% el jugador perdía un quinto de los combates sin remedio, porque
 * un Rookie no puede ganar a un Champion de su mismo nivel (sus stats base son
 * un 50% mayores). Medido con el simulador, 10% deja la tasa de victoria cerca
 * del 50%, que es lo razonable para un encuentro aleatorio.
 */
export function rollEncounter(playerLevel: number, rng: Rng): Encounter {
  const tables = ENCOUNTER_TABLES;
  const currentIndex = clampIndex(
    tables.findIndex((t) => playerLevel >= t.minLevel && playerLevel <= t.maxLevel),
    tables.length,
  );
  const nextIndex = Math.min(currentIndex + 1, tables.length - 1);

  const useNextBand = currentIndex !== nextIndex && rng.chance(0.1);
  const keys = useNextBand ? tables[nextIndex]!.keys : tables[currentIndex]!.keys;

  const speciesKey = rng.pick(keys);
  const species = getSpecies(speciesKey)!;
  const level = Math.max(1, Math.min(100, playerLevel + rng.int(-1, 2)));

  return { species, level };
}

function clampIndex(index: number, length: number): number {
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

const TIER_EXP_BONUS: Record<Tier, number> = {
  inicial: 1,
  diminuto: 1,
  novato: 1,
  campeon: 1.6,
  ultimate: 2.4,
  mega: 3.2,
};

const TIER_DIGIBYTES: Record<Tier, number> = {
  inicial: 1,
  diminuto: 1,
  novato: 1,
  campeon: 2.5,
  ultimate: 5,
  mega: 12,
};

export interface Rewards {
  exp: number;
  digibytes: number;
  tier: Tier;
}

/**
 * Recompensa por vencer. `bonus` lo fija el tipo de rival: 1 para un salvaje
 * suelto, hasta 6 para un jefe de zona.
 */
export function rollRewards(
  species: SpeciesDef,
  level: number,
  rng: Rng,
  bonus = 1,
): Rewards {
  const tierBonus = TIER_EXP_BONUS[species.tier];
  const jitter = 0.9 + rng.next() * 0.25;
  const multiplier = Math.max(1, bonus);

  return {
    exp: Math.max(1, Math.floor(expReward(level, tierBonus) * multiplier * jitter)),
    digibytes: Math.max(
      1,
      Math.floor(digibyteReward(level) * TIER_DIGIBYTES[species.tier] * multiplier * jitter),
    ),
    tier: species.tier,
  };
}

/** Formatea un número grande: 1234 -> 1.234 */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat('es-ES').format(Math.round(n));
}

/** Barra de progreso con bloques, para mostrar EXP en los embeds. */
export function progressBar(current: number, max: number, width = 10): string {
  const ratio = max <= 0 ? 0 : Math.max(0, Math.min(1, current / max));
  const filled = Math.round(ratio * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

export { TIER_NAMES };
