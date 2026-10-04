import { db, transaction } from '../db/index.js';
import {
  applyGear,
  getEquipment,
  MAX_UPGRADE,
  SLOTS,
  upgradeCost,
  upgradeMaterialCost,
  type EquipmentDef,
  type EquippedGear,
  type Slot,
} from './equipment.js';
import { getItem } from './items.js';
import { computeStats } from './stats.js';
import { bump } from './progressionRepo.js';
import type { OwnedDigimon } from './types.js';

// -------------------------------------------------------------- consultas ---

const selectOwnedGear = db.prepare<[number], { item_key: string; upgrade: number }>(
  'SELECT item_key, upgrade FROM gear_owned WHERE trainer_id = ?',
);
const upsertOwnedGear = db.prepare(
  `INSERT INTO gear_owned (trainer_id, item_key, upgrade) VALUES (?, ?, ?)
   ON CONFLICT(trainer_id, item_key) DO UPDATE SET upgrade = excluded.upgrade`,
);

const selectDigimonGear = db.prepare<[number], { slot: string; item_key: string; upgrade: number }>(
  'SELECT slot, item_key, upgrade FROM digimon_gear WHERE digimon_id = ?',
);
const upsertDigimonGear = db.prepare(
  `INSERT INTO digimon_gear (digimon_id, slot, item_key, upgrade) VALUES (?, ?, ?, ?)
   ON CONFLICT(digimon_id, slot) DO UPDATE SET
     item_key = excluded.item_key, upgrade = excluded.upgrade`,
);
const clearDigimonGear = db.prepare('DELETE FROM digimon_gear WHERE digimon_id = ?');
const clearDigimonSlot = db.prepare('DELETE FROM digimon_gear WHERE digimon_id = ? AND slot = ?');

// El trainer que es dueño del Digimon: imprescindible para no dejar equipar
// piezas de otra cuenta.
const digimonOwner = db.prepare<[number], { trainer_id: number }>(
  'SELECT trainer_id FROM digimon WHERE id = ?',
);

// ---------------------------------------------------------------- lectura ---

/** Piezas que posee el entrenador, con su nivel de mejora. */
export function ownedGear(trainerId: number): EquippedGear[] {
  return selectOwnedGear.all(trainerId).map((row) => ({
    itemKey: row.item_key,
    upgrade: row.upgrade,
  }));
}

export function ownsGear(trainerId: number, itemKey: string): boolean {
  return selectOwnedGear.all(trainerId).some((row) => row.item_key === itemKey);
}

/** Piezas equipadas en un Digimon concreto. */
export function equippedGear(digimonId: number): EquippedGear[] {
  return selectDigimonGear.all(digimonId).map((row) => ({
    itemKey: row.item_key,
    upgrade: row.upgrade,
  }));
}

// ---------------------------------------------------------- estadisticas ---

/**
 * Estadísticas **efectivas**: base por nivel + equipo.
 *
 * Este es el único sitio donde se suma el equipo. `base_*` en la tabla nunca
 * se modifica, así que desequipar devuelve exactamente las mismas cifras.
 */
export function effectiveStats(digimon: OwnedDigimon): OwnedDigimon['stats'] {
  const base = computeStats(digimon.species.base, digimon.level);
  const gear = equippedGear(digimon.id);
  return applyGear(base, gear);
}

/** Devuelve una copia del Digimon con las estadísticas ya resueltas. */
export function withEffectiveStats(digimon: OwnedDigimon): OwnedDigimon {
  return { ...digimon, stats: effectiveStats(digimon) };
}

// ------------------------------------------------------------------ CRUD ---

export type GearResult =
  | { ok: true }
  | { ok: false; reason: 'no-existe' | 'no-posee' | 'ya-puesto' | 'ranura-ocupada' | 'nivel' };

/** Equipa una pieza. Devuelve la pieza anterior si había algo en la ranura. */
export function equipItem(
  trainerId: number,
  digimonId: number,
  itemKey: string,
): { result: GearResult; replaced: EquipmentDef | null } {
  const def = getEquipment(itemKey);
  if (!def) return { result: { ok: false, reason: 'no-existe' }, replaced: null };

  const owner = digimonOwner.get(digimonId);
  if (!owner || owner.trainer_id !== trainerId) {
    return { result: { ok: false, reason: 'no-existe' }, replaced: null };
  }

  if (!ownsGear(trainerId, itemKey)) {
    return { result: { ok: false, reason: 'no-posee' }, replaced: null };
  }

  return transaction(() => {
    const current = selectDigimonGear.all(digimonId).find((row) => row.slot === def.slot);
    if (current?.item_key === itemKey) {
      return { result: { ok: false, reason: 'ya-puesto' }, replaced: null };
    }

    const replaced = current ? getEquipment(current.item_key) ?? null : null;
    const upgrade = selectOwnedGear
      .all(trainerId)
      .find((row) => row.item_key === itemKey)?.upgrade ?? 0;

    upsertDigimonGear.run(digimonId, def.slot, itemKey, upgrade);
    return { result: { ok: true }, replaced };
  });
}

/** Quita una ranura (o todo el equipo si no se indica ranura). */
export function unequip(
  trainerId: number,
  digimonId: number,
  slot?: Slot,
): GearResult {
  const owner = digimonOwner.get(digimonId);
  if (!owner || owner.trainer_id !== trainerId) {
    return { ok: false, reason: 'no-existe' };
  }

  return transaction(() => {
    if (slot) clearDigimonSlot.run(digimonId, slot);
    else clearDigimonGear.run(digimonId);
    return { ok: true };
  });
}

export type BuyGearResult =
  | { ok: true }
  | { ok: false; reason: 'no-existe' | 'sin-dinero' | 'nivel' };

/** Compra una pieza y la añade al inventario del entrenador. */
export function buyGear(trainerId: number, itemKey: string): BuyGearResult {
  const def = getEquipment(itemKey);
  if (!def) return { ok: false, reason: 'no-existe' };

  return transaction(() => {
    const trainer = db
      .prepare<[number], { digibytes: number }>('SELECT digibytes FROM trainers WHERE id = ?')
      .get(trainerId);

    if (!trainer) return { ok: false, reason: 'no-existe' } as const;
    if (trainer.digibytes < def.price) return { ok: false, reason: 'sin-dinero' } as const;

    // Nivel mínimo: se comprueba contra el Digimon más alto del jugador, que es
    // lo que de verdad va a usar la pieza.
    const bestLevel =
      db
        .prepare<[number], { best: number | null }>(
          'SELECT MAX(level) AS best FROM digimon WHERE trainer_id = ?',
        )
        .get(trainerId)?.best ?? 1;

    if (bestLevel < def.requiredLevel) return { ok: false, reason: 'nivel' } as const;

    db.prepare('UPDATE trainers SET digibytes = digibytes - ? WHERE id = ?').run(
      def.price,
      trainerId,
    );
    upsertOwnedGear.run(trainerId, itemKey, 0);

    return { ok: true } as const;
  });
}

export type UpgradeResult =
  | { ok: true; upgrade: number }
  | { ok: false; reason: 'no-existe' | 'no-posee' | 'maximo' | 'sin-dinero' | 'sin-material' };

/**
 * Mejora una pieza un nivel.
 *
 * Exige DigiBytes y un material. El material se gasta de verdad: es lo que
 * impide que la mejora infinita vacíe la economía sin abrir Mazmorras.
 */
export function upgradeGear(
  trainerId: number,
  itemKey: string,
  materialItemKey = 'tonico',
): UpgradeResult {
  const def = getEquipment(itemKey);
  if (!def) return { ok: false, reason: 'no-existe' };

  return transaction(() => {
    const owned = selectOwnedGear.all(trainerId).find((row) => row.item_key === itemKey);
    if (!owned) return { ok: false, reason: 'no-posee' } as const;
    if (owned.upgrade >= MAX_UPGRADE) return { ok: false, reason: 'maximo' } as const;

    const cost = upgradeCost(def, owned.upgrade);

    const trainer = db
      .prepare<[number], { digibytes: number }>('SELECT digibytes FROM trainers WHERE id = ?')
      .get(trainerId);

    if (!trainer || trainer.digibytes < cost) return { ok: false, reason: 'sin-dinero' } as const;

    const material = getItem(materialItemKey);
    const needed = upgradeMaterialCost(owned.upgrade);

    if (material) {
      const held =
        db
          .prepare<[number, string], { quantity: number }>(
            'SELECT quantity FROM inventory WHERE trainer_id = ? AND item_key = ?',
          )
          .get(trainerId, materialItemKey)?.quantity ?? 0;

      if (held < needed) return { ok: false, reason: 'sin-material' } as const;

      db.prepare(
        'UPDATE inventory SET quantity = quantity - ? WHERE trainer_id = ? AND item_key = ?',
      ).run(needed, trainerId, materialItemKey);
    }

    db.prepare('UPDATE trainers SET digibytes = digibytes - ? WHERE id = ?').run(cost, trainerId);

    const next = owned.upgrade + 1;
    upsertOwnedGear.run(trainerId, itemKey, next);

    // La pieza equipada conserva la mejora: si no, mejorarla sería inútil.
    db.prepare(
      'UPDATE digimon_gear SET upgrade = ? WHERE digimon_id IN (SELECT id FROM digimon WHERE trainer_id = ?) AND item_key = ?',
    ).run(next, trainerId, itemKey);

    // El logro de forja cuenta cada nivel de mejora, no cada pieza: por eso
    // está aquí y no en `equipItem`.
    bump(trainerId, 'mejoras');

    return { ok: true, upgrade: next } as const;
  });
}

/** Resumen del equipo para los embeds. */
export interface GearSlotView {
  slot: Slot;
  def: EquipmentDef;
  upgrade: number;
}

export function gearSlots(digimonId: number): Record<Slot, GearSlotView | null> {
  const rows = selectDigimonGear.all(digimonId);
  const view = {} as Record<Slot, GearSlotView | null>;

  for (const slot of SLOTS) {
    const row = rows.find((r) => r.slot === slot);
    const def = row ? getEquipment(row.item_key) : undefined;
    view[slot] = def && row ? { slot, def, upgrade: row.upgrade } : null;
  }

  return view;
}
