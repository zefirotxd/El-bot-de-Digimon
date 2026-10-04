import { db } from '../db/index.js';
import { SPECIES } from './species.js';

/**
 * Bestiario del entrenador.
 *
 * Hasta ahora no existía: el comando `/pokedex` describía especies del catálogo,
 * pero nada guardaba cuáles había visto el jugador. Sin eso, "12 Digimon en esta
 * zona" no significa nada — no hay forma de convertirlo en "te faltan 5", que
 * es lo que da un motivo para volver.
 *
 * Se registra al ENCONTRAR, no solo al capturar: un rival salvaje que te huye
 * también cuenta como visto. Al revés sería más obvio, pero obligaría a
 * capturar para que el bestiario sirviera de algo, y el bestiario existe
 * justamente para saber a qué volver.
 */

export interface DexEntry {
  speciesKey: string;
  /** Visto al menos una vez. */
  seen: boolean;
  /** Capturado alguna vez. */
  caught: boolean;
  /** Cuántas veces has capturado esta especie. */
  captures: number;
  firstSeen: string;
  firstCatch: string | null;
}

export interface DexProgress {
  seen: number;
  caught: number;
  total: number;
  byTier: Record<string, { seen: number; caught: number; total: number }>;
}

const upsertSeen = db.prepare(
  `INSERT INTO species_dex (trainer_id, species_key, captures, caught_at)
   VALUES (?, ?, 0, NULL)
   ON CONFLICT(trainer_id, species_key) DO NOTHING`,
);

const upsertCaught = db.prepare(
  `INSERT INTO species_dex (trainer_id, species_key, captures, caught_at)
   VALUES (?, ?, 1, datetime('now'))
   ON CONFLICT(trainer_id, species_key) DO UPDATE SET
     captures = species_dex.captures + 1,
     caught_at = COALESCE(species_dex.caught_at, excluded.caught_at)`,
);

const selectDex = db.prepare<[number], { species_key: string; captures: number; caught_at: string | null }>(
  'SELECT species_key, captures, caught_at FROM species_dex WHERE trainer_id = ?',
);

/** Registra que el jugador ha visto una especie. */
export function markSeen(trainerId: number, speciesKey: string): void {
  if (!SPECIES[speciesKey]) return;
  upsertSeen.run(trainerId, speciesKey);
}

/** Registra una captura. Suma al contador de esa especie. */
export function markCaught(trainerId: number, speciesKey: string): void {
  if (!SPECIES[speciesKey]) return;
  upsertCaught.run(trainerId, speciesKey);
}

export function dexOf(trainerId: number): Map<string, DexEntry> {
  const out = new Map<string, DexEntry>();

  for (const row of selectDex.all(trainerId)) {
    out.set(row.species_key, {
      speciesKey: row.species_key,
      seen: true,
      caught: row.caught_at !== null,
      captures: row.captures,
      firstSeen: '',
      firstCatch: row.caught_at,
    });
  }

  return out;
}

/** ¿Ha visto el jugador esta especie? */
export function hasSeen(trainerId: number, speciesKey: string): boolean {
  return dexOf(trainerId).has(speciesKey);
}

export function dexProgress(trainerId: number): DexProgress {
  const entries = dexOf(trainerId);
  const byTier: DexProgress['byTier'] = {};

  let seen = 0;
  let caught = 0;

  for (const species of Object.values(SPECIES)) {
    const entry = entries.get(species.key);
    const bucket = (byTier[species.tier] ??= { seen: 0, caught: 0, total: 0 });
    bucket.total++;

    if (entry) {
      bucket.seen++;
      seen++;
      if (entry.caught) {
        bucket.caught++;
        caught++;
      }
    }
  }

  return { seen, caught, total: Object.keys(SPECIES).length, byTier };
}