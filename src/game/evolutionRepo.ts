import { db, transaction } from '../db/index.js';
import { applyEvolution } from './combat.js';
import { getItem } from './items.js';
import { getSpecies, SPECIES } from './species.js';
import { bump } from './progressionRepo.js';
import type { EvolutionRoute, OwnedDigimon } from './types.js';

/**
 * Evolución manual.
 *
 * REGLA que manda sobre todo lo demás: **cobrar y evolucionar es una sola
 * operación**. Si se cobrase antes de comprobar y luego fallara el cambio de
 * especie, el jugador perdía los materiales. Si se comprobase antes de cobrar y
 * luego fallara el cobro, evolucionabas gratis. Aquí va dentro de una
 * transacción de SQLite: o entran las dos cosas, o no entra ninguna.
 */

// --------------------------------------------------------------- consultas ---

const selectInventoryCount = db.prepare<[number, string], { quantity: number }>(
  'SELECT quantity FROM inventory WHERE trainer_id = ? AND item_key = ?',
);

const decrementInventory = db.prepare(
  'UPDATE inventory SET quantity = quantity - ? WHERE trainer_id = ? AND item_key = ?',
);

const selectTrainerMoney = db.prepare<[number], { digibytes: number }>(
  'SELECT digibytes FROM trainers WHERE id = ?',
);

const decrementMoney = db.prepare('UPDATE trainers SET digibytes = digibytes - ? WHERE id = ?');

const incrementWins = db.prepare(
  'UPDATE trainers SET battles_won = battles_won + ? WHERE id = ?',
);

const selectOwnedDigimon = db.prepare<[number], { trainer_id: number }>(
  'SELECT trainer_id FROM digimon WHERE id = ?',
);

const updateSpecies = db.prepare(
  'UPDATE digimon SET species_key = ?, moves = ? WHERE id = ?',
);

const updateStatsAndSpecies = db.prepare(
  'UPDATE digimon SET species_key = ?, moves = ? WHERE id = ?',
);

const insertEvolution = db.prepare(
  `INSERT INTO digimon_evolution
     (digimon_id, trainer_id, from_species, to_species, route_index, kind)
   VALUES (?, ?, ?, ?, ?, ?)`,
);

const selectEvolutionHistory = db.prepare<
  [number],
  { from_species: string; to_species: string; kind: string; created_at: string }
>('SELECT from_species, to_species, kind, created_at FROM digimon_evolution WHERE digimon_id = ? ORDER BY id ASC');

const selectUnlocks = db.prepare<[number], { species_key: string }>(
  'SELECT species_key FROM evolution_unlocks WHERE trainer_id = ?',
);

const insertUnlock = db.prepare(
  'INSERT INTO evolution_unlocks (trainer_id, species_key) VALUES (?, ?) ON CONFLICT DO NOTHING',
);

const selectAllUnlocks = db.prepare<[], { trainer_id: number; species_key: string }>(
  'SELECT trainer_id, species_key FROM evolution_unlocks',
);

// -------------------------------------------------------------- evaluación ---

/** Un requisito y si el entrenador lo cumple. */
export interface Requirement {
  kind: 'nivel' | 'victorias' | 'digibytes' | 'material';
  label: string;
  needed: number;
  have: number;
  met: boolean;
}

export interface RouteStatus {
  /** Índice dentro de `SpeciesDef.evolutions`. Es el id que acepta `/evolucion`. */
  index: number;
  route: EvolutionRoute;
  to: { key: string; name: string; emoji: string; tier: string; attribute: string };
  /** Requisitos que faltan. Vacío = evolucionable ahora mismo. */
  missing: Requirement[];
  /** Requisitos cumplidos, para mostrarlos tachados. */
  met: Requirement[];
  /** La rama ya está cerrada porque el jugador tomó la otra forma. */
  lockedByBranch: string | null;
  /** `true` si se puede evolucionar en este preciso instante. */
  ready: boolean;
}

/**
 * Evalúa todas las rutas de un Digimon contra el estado del entrenador.
 *
 * Es una función PURA de lectura: no cobra, no escribe. `/evolucion` la usa para
 * pintar el árbol, y `evolveInto` la vuelve a llamar antes de actuar, porque
 * entre que se pintó y se pulsó el botón el estado pudo cambiar.
 */
export function routeStatuses(
  digimon: OwnedDigimon,
  trainer: { id: number; digibytes: number; battlesWon: number },
  inventory: Record<string, number>,
  unlocked: Set<string>,
): RouteStatus[] {
  return digimon.species.evolutions.map((route, index) => {
    const species = getSpecies(route.to);
    const to = {
      key: route.to,
      name: species?.name ?? route.to,
      emoji: species?.emoji ?? '❓',
      tier: species?.tier ?? 'desconocido',
      attribute: species?.attribute ?? 'desconocido',
    };

    const checks: Requirement[] = [];

    checks.push({
      kind: 'nivel',
      label: `Nivel ${route.level}`,
      needed: route.level,
      have: digimon.level,
      met: digimon.level >= route.level,
    });

    if (route.wins !== undefined) {
      checks.push({
        kind: 'victorias',
        label: `${route.wins} victorias`,
        needed: route.wins,
        have: trainer.battlesWon,
        met: trainer.battlesWon >= route.wins,
      });
    }

    if (route.digibytes !== undefined) {
      checks.push({
        kind: 'digibytes',
        label: `${route.digibytes} DigiBytes`,
        needed: route.digibytes,
        have: trainer.digibytes,
        met: trainer.digibytes >= route.digibytes,
      });
    }

    for (const [itemKey, quantity] of Object.entries(route.items ?? {})) {
      const held = inventory[itemKey] ?? 0;
      checks.push({
        kind: 'material',
        label: `${quantity}x ${getItem(itemKey)?.name ?? itemKey}`,
        needed: quantity,
        have: held,
        met: held >= quantity,
      });
    }

    // Una rama se cierra si el jugador ya tiene esa especie desbloqueada. Sin
    // esto se podría volver atrás por la puerta de atrás y volver a elegir.
    const lockedByBranch =
      route.exclusiveWith && unlocked.has(route.exclusiveWith) ? route.exclusiveWith : null;

    const missing = checks.filter((c) => !c.met);

    return {
      index,
      route,
      to,
      missing,
      met: checks.filter((c) => c.met),
      lockedByBranch,
      ready: missing.length === 0 && lockedByBranch === null,
    };
  });
}

// ------------------------------------------------------------------- cobro ---

export type EvolveFailure =
  | 'no-existe'
  | 'no-poses'
  | 'ruta-invalida'
  | 'requisitos'
  | 'rama-cerrada'
  | 'misma-especie'
  | 'ya-desbloqueada';

export type EvolveResult =
  | { ok: true; from: string; to: string; emoji: string; spent: { digibytes: number; items: Record<string, number> } }
  | { ok: false; reason: EvolveFailure; missing?: Requirement[]; need?: string };

/**
 * Evoluciona un Digimon por una ruta concreta.
 *
 * Idempotencia: si la ruta ya está cerrada por rama, o la especie destino ya
 * está en `unlocked`, falla. Eso es lo que hace que pulsar dos veces el botón no
 * cobre dos veces: la segunda vez ya no hay nada que hacer.
 */
export function evolveInto(
  digimon: OwnedDigimon,
  routeIndex: number,
  context: {
    trainer: { id: number; digibytes: number; battlesWon: number };
    inventory: Record<string, number>;
    unlocked: Set<string>;
  },
): EvolveResult {
  const route = digimon.species.evolutions[routeIndex];
  if (!route) return { ok: false, reason: 'ruta-invalida' };

  const owner = selectOwnedDigimon.get(digimon.id);
  if (!owner || owner.trainer_id !== context.trainer.id) {
    return { ok: false, reason: 'no-poses' };
  }

  const statuses = routeStatuses(digimon, context.trainer, context.inventory, context.unlocked);
  const status = statuses[routeIndex];
  if (!status) return { ok: false, reason: 'ruta-invalida' };

  if (status.lockedByBranch) return { ok: false, reason: 'rama-cerrada' };
  if (status.missing.length > 0) return { ok: false, reason: 'requisitos', missing: status.missing };

  const target = getSpecies(route.to);
  if (!target) return { ok: false, reason: 'ruta-invalida' };

  const from = digimon.species.name;
  const fromKey = digimon.species.key;

  // Todo el cobro y el cambio ocurren aquí dentro. Fuera no se puede quedar a
  // medias: si el `UPDATE` de la especie fallara, el `ROLLBACK` devuelve los
  // materiales.
  transaction(() => {
    if (route.digibytes !== undefined) decrementMoney.run(route.digibytes, context.trainer.id);
    for (const [itemKey, quantity] of Object.entries(route.items ?? {})) {
      decrementInventory.run(quantity, context.trainer.id, itemKey);
    }

    const name = applyEvolution(digimon, route.to);
    if (!name) throw new Error(`especie destino inexistente: ${route.to}`);

    // `applyEvolution` ya toco `digimon` en memoria; el UPDATE persiste lo que
    // resulto. Las estadisticas NO se guardan: se derivan de especie + nivel.
    updateStatsAndSpecies.run(
      digimon.species.key,
      JSON.stringify(digimon.moves.map((m) => m.key)),
      digimon.id,
    );

    insertEvolution.run(
      digimon.id,
      context.trainer.id,
      fromKey,
      route.to,
      routeIndex,
      'evolucion',
    );

    insertUnlock.run(context.trainer.id, route.to);
    bump(context.trainer.id, 'evoluciones');
  });

  return {
    ok: true,
    from,
    to: target.name,
    emoji: target.emoji,
    spent: {
      digibytes: route.digibytes ?? 0,
      items: { ...(route.items ?? {}) },
    },
  };
}

// -------------------------------------------------------------- regresión ----

export type DevolveResult =
  | { ok: true; from: string; to: string; emoji: string }
  | { ok: false; reason: 'no-existe' | 'no-poses' | 'no-regresion' | 'sin-material' | 'material-invalido'; need?: Requirement[] };

/**
 * Deshace una evolución.
 *
 * Es lo que evita que la elección sea irreversible: si tomaste la rama que no
 * querías, gastas material y vuelves. Sin esto, evolving es una apuesta con la
 * temporada y la gente simplemente no evoluciona.
 */
export function devolveInto(
  digimon: OwnedDigimon,
  trainerId: number,
  inventory: Record<string, number>,
): DevolveResult {
  const route = digimon.species.devolution;
  if (!route) return { ok: false, reason: 'no-regresion' };

  const target = getSpecies(route.to);
  if (!target) return { ok: false, reason: 'no-regresion' };

  const owner = selectOwnedDigimon.get(digimon.id);
  if (!owner || owner.trainer_id !== trainerId) return { ok: false, reason: 'no-poses' };

  // Se comprueba TODO antes de tocar nada: un material que no existe en el
  // catálogo invalida la ruta en vez de cobrarla a medias.
  const missing: Requirement[] = [];
  for (const [itemKey, quantity] of Object.entries(route.items)) {
    if (!getItem(itemKey)) return { ok: false, reason: 'material-invalido', need: [{ kind: 'material', label: itemKey, needed: quantity, have: 0, met: false }] };
    const held = inventory[itemKey] ?? 0;
    if (held < quantity) {
      missing.push({
        kind: 'material',
        label: `${quantity}x ${getItem(itemKey)!.name}`,
        needed: quantity,
        have: held,
        met: false,
      });
    }
  }
  if (missing.length > 0) return { ok: false, reason: 'sin-material', need: missing };

  const from = digimon.species.name;
  const fromKey = digimon.species.key;

  transaction(() => {
    for (const [itemKey, quantity] of Object.entries(route.items)) {
      decrementInventory.run(quantity, trainerId, itemKey);
    }

    const name = applyEvolution(digimon, route.to);
    if (!name) throw new Error(`especie destino inexistente: ${route.to}`);

    updateStatsAndSpecies.run(
      digimon.species.key,
      JSON.stringify(digimon.moves.map((m) => m.key)),
      digimon.id,
    );

    insertEvolution.run(digimon.id, trainerId, fromKey, route.to, 0, 'regresion');
    bump(trainerId, 'regresiones');
  });

  return { ok: true, from, to: target.name, emoji: target.emoji };
}

// ---------------------------------------------------------------- fachada ----

/**
 * Estado del entrenador tal y como lo necesitan las rutas.
 *
 * Se lee JUNTO con el Digimon y en el mismo instante que se va a usar. Si se
 * leyera por separado, entre la lectura y la evolución otro comando podría
 * haber gastado los mismos materiales y la cuenta no quadraría.
 */
export interface EvolutionContext {
  trainer: { id: number; digibytes: number; battlesWon: number };
  inventory: Record<string, number>;
  unlocked: Set<string>;
}

export function contextFor(
  trainer: { id: number; digibytes: number; battlesWon: number },
  inventory: Record<string, number>,
): EvolutionContext {
  return { trainer, inventory, unlocked: unlocksOf(trainer.id) };
}

/**
 * Listo para `/evolucion elegir`: carga el Digimon, monta el contexto y
 * evoluciona.
 *
 * Devuelve el error ya en texto, para que el comando no tenga que traducir
 * códigos. Los nombres en el mensaje son en español porque el usuario los lee.
 */
export type EvolveCommandResult =
  | { ok: true; from: string; to: string; emoji: string; spent: { digibytes: number; items: Record<string, number> }; digibytesLeft: number }
  | { ok: false; message: string };

export function evolveOwned(
  digimon: OwnedDigimon,
  routeIndex: number,
  trainer: { id: number; digibytes: number; battlesWon: number },
  inventory: Record<string, number>,
): EvolveCommandResult {
  const context = contextFor(trainer, inventory);
  const result = evolveInto(digimon, routeIndex, context);

  if (!result.ok) {
    const messages: Record<EvolveFailure, string> = {
      'no-existe': 'Ese Digimon ya no existe.',
      'no-poses': 'Ese Digimon no es tuyo.',
      'ruta-invalida': 'Esa ruta de evolución no existe. Usa `/evolucion` para ver las tuyas.',
      'requisitos': 'Todavía no cumples los requisitos.',
      'rama-cerrada': `Ya tomaste la rama hacia ${getSpecies(result.need ?? '')?.name ?? result.need}. Elige la otra forma.`,
      'misma-especie': 'Ya tienes esa forma.',
      'ya-desbloqueada': 'Ya desbloqueaste esa forma antes.',
    };

    const base = messages[result.reason];
    if (result.reason === 'requisitos' && result.missing) {
      const list = result.missing
        .map((m) => `· ${m.label} (te faltan ${m.needed - m.have})`)
        .join('\n');
      return { ok: false, message: `${base}\n${list}` };
    }

    return { ok: false, message: base };
  }

  const after = selectTrainerMoney.get(trainer.id)?.digibytes ?? 0;
  return { ...result, digibytesLeft: after };
}

// --------------------------------------------------------------- historial ---
export interface EvolutionRecord {
  from: string;
  to: string;
  fromName: string;
  toName: string;
  fromEmoji: string;
  toEmoji: string;
  kind: 'evolucion' | 'regresion';
  createdAt: string;
}

export function historyOf(digimonId: number): EvolutionRecord[] {
  return selectEvolutionHistory.all(digimonId).map((row) => ({
    from: row.from_species,
    to: row.to_species,
    fromName: getSpecies(row.from_species)?.name ?? row.from_species,
    toName: getSpecies(row.to_species)?.name ?? row.to_species,
    fromEmoji: getSpecies(row.from_species)?.emoji ?? '❓',
    toEmoji: getSpecies(row.to_species)?.emoji ?? '❓',
    kind: row.kind === 'regresion' ? 'regresion' : 'evolucion',
    createdAt: row.created_at,
  }));
}

export function unlocksOf(trainerId: number): Set<string> {
  return new Set(selectUnlocks.all(trainerId).map((row) => row.species_key));
}

/** Formas desbloqueadas, ordenadas por tier para el Digivice. */
export function unlockedList(trainerId: number): { key: string; name: string; emoji: string; tier: string }[] {
  return [...unlocksOf(trainerId)]
    .map((key) => {
      const species = getSpecies(key);
      return species
        ? { key, name: species.name, emoji: species.emoji, tier: species.tier }
        : { key, name: key, emoji: '❓', tier: 'desconocido' };
    })
    .sort((a, b) => SPECIES_ORDER.indexOf(a.tier) - SPECIES_ORDER.indexOf(b.tier) || a.name.localeCompare(b.name));
}

const SPECIES_ORDER = ['inicial', 'novato', 'campeon', 'ultimate', 'mega'];

/** Cuántas formas de cada tier hay desbloqueadas, para la vista de colección. */
export function collectionProgress(trainerId: number): { unlocked: number; total: number; byTier: Record<string, [number, number]> } {
  const unlocked = unlocksOf(trainerId);
  const byTier: Record<string, [number, number]> = {};

  for (const species of Object.values(SPECIES)) {
    const entry = byTier[species.tier] ?? [0, 0];
    entry[1] += 1;
    if (unlocked.has(species.key)) entry[0] += 1;
    byTier[species.tier] = entry;
  }

  return { unlocked: unlocked.size, total: Object.keys(SPECIES).length, byTier };
}

export { selectInventoryCount, selectTrainerMoney, incrementWins, updateSpecies, selectAllUnlocks };
