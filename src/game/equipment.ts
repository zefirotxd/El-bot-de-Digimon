import type { Stats } from './types.js';

/**
 * Equipo permanente.
 *
 * REGLA DURA: el equipo **nunca** sobrescribe las estadísticas base. Solo suma
 * sobre ellas dentro de `applyGear()`. Si el equipo escribiera en
 * `digimon.base_*`, equipar y desequipar sería irreversible y cualquier bug
 * corrompería el progreso de un Digimon para siempre. Las estadísticas
 * efectivas se calculan al vuelo; a la base no se toca.
 */

export type Slot = 'arma' | 'armadura' | 'chip' | 'accesorio';

export type Rarity = 'comun' | 'raro' | 'epico' | 'leyenda';

/** Efectos que se ejecutan dentro del motor de combate. */
export type GearEffect =
  | { kind: 'drenar'; ratio: number }
  | { kind: 'primera_sangre'; ratio: number }
  | { kind: 'escudo'; ratio: number }
  | { kind: 'contraataque'; ratio: number }
  | { kind: 'lento'; turns: number };

export interface EquipmentDef {
  key: string;
  name: string;
  emoji: string;
  slot: Slot;
  rarity: Rarity;
  price: number;
  /** Bonificación plana, ya incluyendo el nivel de mejora 0. */
  bonus: Partial<Stats>;
  /** Probabilidad de crítico adicional (fracción). */
  critRate?: number;
  /** Precisión adicional (fracción). */
  accuracy?: number;
  effect?: GearEffect;
  /** Nivel mínimo para poder comprarlo. */
  requiredLevel: number;
  description: string;
}

export const SLOTS: Slot[] = ['arma', 'armadura', 'chip', 'accesorio'];

export const SLOT_NAMES: Record<Slot, string> = {
  arma: 'Arma',
  armadura: 'Armadura',
  chip: 'Chip',
  accesorio: 'Accesorio',
};

export const RARITY_NAMES: Record<Rarity, string> = {
  comun: 'Común',
  raro: 'Raro',
  epico: 'Épico',
  leyenda: 'Leyenda',
};

export const RARITY_COLORS: Record<Rarity, number> = {
  comun: 0x718096,
  raro: 0x3182ce,
  epico: 0x805ad5,
  leyenda: 0xd69e2e,
};

/** Cada nivel de mejora suma este porcentaje del bonus base. */
export const UPGRADE_STEP = 0.12;
export const MAX_UPGRADE = 5;

/** Coste de DigiBytes para subir un nivel de mejora. */
export function upgradeCost(def: EquipmentDef, currentUpgrade: number): number {
  return Math.round(def.price * 0.5 * Math.pow(1.7, currentUpgrade));
}

/** Unidades de material que exige la mejora. */
export function upgradeMaterialCost(currentUpgrade: number): number {
  return 1 + currentUpgrade;
}

export const EQUIPMENT: Record<string, EquipmentDef> = {
  // ---------------- armas ----------------
  hoja_rustica: {
    key: 'hoja_rustica',
    name: 'Hoja Rústica',
    emoji: '🗡️',
    slot: 'arma',
    rarity: 'comun',
    price: 400,
    bonus: { attack: 6 },
    requiredLevel: 3,
    description: 'Una hoja de las que salen de los databases. Mejor que nada.',
  },
  espada_digital: {
    key: 'espada_digital',
    name: 'Espada Digital',
    emoji: '⚔️',
    slot: 'arma',
    rarity: 'raro',
    price: 1400,
    bonus: { attack: 14 },
    critRate: 0.05,
    requiredLevel: 12,
    description: 'Hocha de datos. +5% de crítico.',
  },
  garra_omega: {
    key: 'garra_omega',
    name: 'Garra Omega',
    emoji: '🐾',
    slot: 'arma',
    rarity: 'epico',
    price: 4200,
    bonus: { attack: 24 },
    critRate: 0.08,
    effect: { kind: 'drenar', ratio: 0.35 },
    requiredLevel: 28,
    description: 'Drena un 35% del daño como PV.',
  },
  lanza_del_crepúsculo: {
    key: 'lanza_del_crepúsculo',
    name: 'Lanza del Crepúsculo',
    emoji: '🔱',
    slot: 'arma',
    rarity: 'leyenda',
    price: 12000,
    bonus: { attack: 38 },
    critRate: 0.12,
    effect: { kind: 'primera_sangre', ratio: 1.5 },
    requiredLevel: 46,
    description: 'El primer golpe contra un rival sano hace un 50% más.',
  },

  // ---------------- armaduras ----------------
  chaleco_datos: {
    key: 'chaleco_datos',
    name: 'Chaleco de Datos',
    emoji: '🥋',
    slot: 'armadura',
    rarity: 'comun',
    price: 380,
    bonus: { defense: 5, hp: 12 },
    requiredLevel: 3,
    description: 'Ropa reforzada del Archivo.',
  },
  placas_hielo: {
    key: 'placas_hielo',
    name: 'Placas de Hielo',
    emoji: '🛡️',
    slot: 'armadura',
    rarity: 'raro',
    price: 1350,
    bonus: { defense: 12, hp: 30 },
    requiredLevel: 12,
    description: 'Absorbe el primer golpe de cada combate.',
    effect: { kind: 'escudo', ratio: 0.15 },
  },
  coraza_titanio: {
    key: 'coraza_titanio',
    name: 'Coraza de Titanio',
    emoji: '🧱',
    slot: 'armadura',
    rarity: 'epico',
    price: 4000,
    bonus: { defense: 22, hp: 55 },
    requiredLevel: 28,
    description: 'Pesada, y por eso ninguna.',
  },
  manto_vacio: {
    key: 'manto_vacio',
    name: 'Manto del Vacío',
    emoji: '🌌',
    slot: 'armadura',
    rarity: 'leyenda',
    price: 11500,
    bonus: { defense: 34, hp: 90 },
    effect: { kind: 'escudo', ratio: 0.3 },
    requiredLevel: 46,
    description: 'Absorbe un 30% del daño en los tres primeros turnos.',
  },

  // ---------------- chips ----------------
  chip_fuerza: {
    key: 'chip_fuerza',
    name: 'Chip de Fuerza',
    emoji: '🔴',
    slot: 'chip',
    rarity: 'comun',
    price: 500,
    bonus: { attack: 4, speed: 3 },
    requiredLevel: 5,
    description: 'Aumento pequeño y GENERAL.',
  },
  chip_vitalidad: {
    key: 'chip_vitalidad',
    name: 'Chip de Vitalidad',
    emoji: '🟢',
    slot: 'chip',
    rarity: 'comun',
    price: 500,
    bonus: { hp: 45, defense: 2 },
    requiredLevel: 5,
    description: 'Más aguante para combates largos.',
  },
  chip_precisao: {
    key: 'chip_precisao',
    name: 'Chip de Precisión',
    emoji: '🟡',
    slot: 'chip',
    rarity: 'raro',
    price: 1600,
    bonus: {},
    accuracy: 0.1,
    requiredLevel: 14,
    description: '+10% de precisión a todos los movimientos.',
  },
  chip_reflejos: {
    key: 'chip_reflejos',
    name: 'Chip de Reflejos',
    emoji: '🔵',
    slot: 'chip',
    rarity: 'epico',
    price: 4400,
    bonus: { speed: 18 },
    effect: { kind: 'contraataque', ratio: 0.3 },
    requiredLevel: 30,
    description: 'Contaataca el 30% del daño recibido.',
  },

  // ---------------- accesorios ----------------
  anillo_prisa: {
    key: 'anillo_prisa',
    name: 'Anillo de Prisa',
    emoji: '💍',
    slot: 'accesorio',
    rarity: 'comun',
    price: 350,
    bonus: { speed: 5 },
    requiredLevel: 2,
    description: 'Adelanta al resto.',
  },
  amuleto_agua: {
    key: 'amuleto_agua',
    name: 'Amuleto del Agua',
    emoji: '📿',
    slot: 'accesorio',
    rarity: 'raro',
    price: 1500,
    bonus: { hp: 40 },
    requiredLevel: 10,
    description: 'Protege de los elementos de agua.',
  },
  amuleto_fuego: {
    key: 'amuleto_fuego',
    name: 'Amuleto del Fuego',
    emoji: '🔮',
    slot: 'accesorio',
    rarity: 'raro',
    price: 1500,
    bonus: { attack: 10, hp: 20 },
    requiredLevel: 10,
    description: 'Para quienes quisieron jugar con fuego.',
  },
};

export function getEquipment(key: string): EquipmentDef | undefined {
  return EQUIPMENT[key];
}

/** Bonificación total de una lista de piezas ya con su nivel de mejora. */
export function gearBonus(equipped: EquippedGear[]): Partial<Stats> {
  const total: Partial<Stats> = { hp: 0, attack: 0, defense: 0, speed: 0 };

  for (const piece of equipped) {
    const def = EQUIPMENT[piece.itemKey];
    if (!def) continue;

    const multiplier = 1 + UPGRADE_STEP * piece.upgrade;
    for (const stat of ['hp', 'attack', 'defense', 'speed'] as const) {
      total[stat] = (total[stat] ?? 0) + Math.round((def.bonus[stat] ?? 0) * multiplier);
    }
  }

  return total;
}

/** Suma el equipo sobre las estadísticas base. Nunca las reemplaza. */
export function applyGear(base: Stats, equipped: EquippedGear[]): Stats {
  const bonus = gearBonus(equipped);
  return {
    hp: base.hp + (bonus.hp ?? 0),
    attack: base.attack + (bonus.attack ?? 0),
    defense: base.defense + (bonus.defense ?? 0),
    speed: base.speed + (bonus.speed ?? 0),
  };
}

export interface EquippedGear {
  itemKey: string;
  upgrade: number;
}

/** Efectos activos de todas las piezas equipadas. */
export function gearEffects(equipped: EquippedGear[]): { effect: GearEffect; def: EquipmentDef }[] {
  return equipped
    .map((piece) => {
      const def = EQUIPMENT[piece.itemKey];
      return def?.effect ? { effect: def.effect, def } : null;
    })
    .filter((x): x is { effect: GearEffect; def: EquipmentDef } => x !== null);
}

/** Bonus de crítico y precisión acumulados. */
export function gearExtras(equipped: EquippedGear[]): { critRate: number; accuracy: number } {
  let critRate = 0;
  let accuracy = 0;

  for (const piece of equipped) {
    const def = EQUIPMENT[piece.itemKey];
    if (!def) continue;
    critRate += def.critRate ?? 0;
    accuracy += def.accuracy ?? 0;
  }

  return { critRate, accuracy };
}
