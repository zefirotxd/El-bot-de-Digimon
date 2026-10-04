import type { Element } from './types.js';

/**
 * Catálogo de objetos.
 *
 * Los objetos que se usan en combate (Poción, Superpoción, Repelente) salen del
 * inventario del entrenador, no de una bolsa mágica por batalla. Así comprar
 * importa: cada Poción que compras es un uso extra en cada combate futuro.
 */
export interface ItemDef {
  key: string;
  name: string;
  emoji: string;
  /** Precio en DigiBytes. */
  price: number;
  /**
   * Qué hace al usarlo en combate. `null` = material: no se usa en combate, solo
   * para evolucionar o fabricar.
   */
  effect:
    | { kind: 'curar'; amount: number }
    | { kind: 'capturar' }
    | { kind: 'huir' }
    | { kind: 'energia'; amount: number }
    | null;
  /** Cuántos se pueden llevar a un mismo combate como máximo. */
  perBattleCap: number;
  /** Descripción para la tienda. */
  description: string;
  /** Rol que ocupa, para explicar la estrategia. */
  role: 'ofensivo' | 'defensivo' | 'utilidad' | 'material';
}

export const ITEMS: Record<string, ItemDef> = {
  pocion: {
    key: 'pocion',
    name: 'Poción',
    emoji: '🧪',
    price: 150,
    effect: { kind: 'curar', amount: 40 },
    perBattleCap: 5,
    description: 'Recupera 40 PV al instante.',
    role: 'defensivo',
  },
  superpocion: {
    key: 'superpocion',
    name: 'Superpoción',
    emoji: '⚗️',
    price: 450,
    effect: { kind: 'curar', amount: 120 },
    perBattleCap: 3,
    description: 'Recupera 120 PV al instante.',
    role: 'defensivo',
  },
  elixir: {
    key: 'elixir',
    name: 'Elixir',
    emoji: '💠',
    price: 1400,
    effect: { kind: 'curar', amount: 9999 },
    perBattleCap: 1,
    description: 'Restaura todos los PV. Un uso por combate, y da igual.',
    role: 'defensivo',
  },
  repelente: {
    key: 'repelente',
    name: 'Repelente',
    emoji: '💨',
    price: 220,
    effect: { kind: 'huir' },
    perBattleCap: 1,
    description: 'Garantiza la huida sin importar la Velocidad.',
    role: 'utilidad',
  },
  capsula: {
    key: 'capsula',
    name: 'DigiCápsula',
    emoji: '📦',
    price: 380,
    effect: { kind: 'capturar' },
    perBattleCap: 3,
    description: 'Un intento de captura adicional por combate.',
    role: 'ofensivo',
  },
  tonico: {
    key: 'tonico',
    name: 'Tónico',
    emoji: '⚡',
    price: 260,
    effect: { kind: 'energia', amount: 2 },
    perBattleCap: 3,
    description: 'Recupera 2 puntos de energía para usar un movimiento caro ya mismo.',
    role: 'ofensivo',
  },

  // ---------------- materiales ----------------
  // No se usan en combate: son el peaje de las ramas de evolución. Existen para
  // que elegir forma cueste algo. Si evolucionar solo costara nivel, la
  // decisión sería trivial (subes siempre) y el árbol no sería una decisión.
  nucleo_datos: {
    key: 'nucleo_datos',
    name: 'Núcleo de Datos',
    emoji: '💠',
    price: 900,
    effect: null,
    perBattleCap: 0,
    description: 'Material de evolución. Se usa en rutas que saltan una forma intermedia.',
    role: 'material',
  },
  cromonizador: {
    key: 'cromonizador',
    name: 'Cromonizador',
    emoji: '⚙️',
    price: 1800,
    effect: null,
    perBattleCap: 0,
    description: 'Material de evolución. Da acceso a las ramas Mega alternativas.',
    role: 'material',
  },
  espectro_digimon: {
    key: 'espectro_digimon',
    name: 'Espectro Digimon',
    emoji: '👻',
    price: 2600,
    effect: null,
    perBattleCap: 0,
    description: 'Material de evolución y de regresión. Permite deshacer una rama mal elegida.',
    role: 'material',
  },
};

export function getItem(key: string): ItemDef | undefined {
  return ITEMS[key];
}

/** Inventario con el que arranca un entrenador nuevo. */
export const STARTING_INVENTORY: Record<string, number> = {
  pocion: 3,
  superpocion: 1,
  repelente: 1,
};

/** Elemento asociado a cada objeto, para el emoji en los menús. */
export const ITEM_ELEMENT: Record<string, Element> = {
  pocion: 'planta',
  superpocion: 'planta',
  elixir: 'luz',
  repelente: 'viento',
  capsula: 'metal',
  tonico: 'rayo',
};

/** Materiales: no entran en el cartucho de combate. */
export const MATERIALS = Object.values(ITEMS)
  .filter((item) => item.role === 'material')
  .map((item) => item.key);

export function isMaterial(key: string): boolean {
  return ITEMS[key]?.role === 'material';
}
