import { db, transaction } from '../db/index.js';
import { bump, markTodayActive, recordBattlePlayed } from './progressionRepo.js';
import { resolveMoves } from './moves.js';
import { getItem, STARTING_INVENTORY } from './items.js';
import { withEffectiveStats } from './gearRepo.js';
import { getSpecies } from './species.js';
import { computeStats, MAX_LEVEL } from './stats.js';
import type { OwnedDigimon, SpeciesDef, StatusEffect, Storage } from './types.js';
import { config } from '../config.js';

export interface Trainer {
  id: number;
  discordId: string;
  username: string;
  digibytes: number;
  battlesWon: number;
  battlesLost: number;
  createdAt: string;
}

interface TrainerRow {
  id: number;
  discord_id: string;
  username: string;
  digibytes: number;
  battles_won: number;
  battles_lost: number;
  created_at: string;
}

interface DigimonRow {
  id: number;
  trainer_id: number;
  species_key: string;
  nickname: string | null;
  level: number;
  exp: number;

  moves: string;
  status: string;
  storage: string;
  is_lead: number;
  caught_at: string;
}

// ------------------------------------------------------------- trainers ----

const selectTrainer = db.prepare<[string], TrainerRow>('SELECT * FROM trainers WHERE discord_id = ?');
const insertTrainer = db.prepare(
  'INSERT INTO trainers (discord_id, username) VALUES (?, ?) RETURNING *',
);
const insertStarter = db.prepare(
  `INSERT INTO digimon (trainer_id, species_key, level, exp, moves, storage, is_lead)
   VALUES (@trainerId, @speciesKey, 1, 0, @moves, 'party', 1)`,
);
const addDigibytes = db.prepare('UPDATE trainers SET digibytes = digibytes + ? WHERE id = ?');
const spendDigibytes = db.prepare(
  'UPDATE trainers SET digibytes = digibytes - ? WHERE id = ? AND digibytes >= ?',
);
const recordBattle = db.prepare(
  'UPDATE trainers SET battles_won = battles_won + ?, battles_lost = battles_lost + ? WHERE id = ?',
);

export function getOrCreateTrainer(discordId: string, username: string): Trainer {
  const existing = selectTrainer.get(discordId);
  if (existing) return mapTrainer(existing);
  return transaction(() => {
    const created = insertTrainer.get(discordId, username);
    return mapTrainer(created as TrainerRow);
  });
}

export function findTrainer(discordId: string): Trainer | null {
  const row = selectTrainer.get(discordId);
  return row ? mapTrainer(row) : null;
}

export function getTrainerById(id: number): Trainer | null {
  const row = db.prepare<[number], TrainerRow>('SELECT * FROM trainers WHERE id = ?').get(id);
  return row ? mapTrainer(row) : null;
}

export function updateUsername(trainerId: number, username: string): void {
  db.prepare('UPDATE trainers SET username = ? WHERE id = ?').run(username, trainerId);
}

export function giveDigibytes(trainerId: number, amount: number): void {
  addDigibytes.run(amount, trainerId);
}

export function trySpendDigibytes(trainerId: number, amount: number): boolean {
  const result = spendDigibytes.run(amount, trainerId, amount);
  return result.changes === 1;
}

export function saveBattleResult(trainerId: number, won: boolean): void {
  recordBattle.run(won ? 1 : 0, won ? 0 : 1, trainerId);

  // Misiones y logros se alimentan de aqui. Es el punto ÚNICO por el que pasan
  // todas las victorias, así que no hace falta tocar cada comando por separado.
  bump(trainerId, 'victorias', won ? 1 : 0);
  bump(trainerId, 'exploraciones');
  recordBattlePlayed(trainerId);
  markTodayActive(trainerId);
}

// ------------------------------------------------------------- digimon -----

const selectDigimonByTrainer = db.prepare<[number], DigimonRow>(
  'SELECT * FROM digimon WHERE trainer_id = ? ORDER BY is_lead DESC, id ASC',
);
const selectParty = db.prepare<[number], DigimonRow>(
  "SELECT * FROM digimon WHERE trainer_id = ? AND storage = 'party' ORDER BY is_lead DESC, id ASC",
);
const selectPC = db.prepare<[number], DigimonRow>(
  "SELECT * FROM digimon WHERE trainer_id = ? AND storage = 'pc' ORDER BY id ASC",
);
const selectDigimonById = db.prepare<[number], DigimonRow>('SELECT * FROM digimon WHERE id = ?');
const insertDigimon = db.prepare(
  `INSERT INTO digimon (trainer_id, species_key, level, exp, moves, storage, is_lead)
   VALUES (@trainerId, @speciesKey, @level, @exp, @moves, @storage, @isLead)`,
);
const lastInsertedId = db.prepare<[], { id: number }>('SELECT last_insert_rowid() AS id');
const updateDigimonProgress = db.prepare(
  `UPDATE digimon SET
     level = ?, exp = ?, moves = ?, status = ?, species_key = ?
   WHERE id = ?`,
);
const clearLead = db.prepare('UPDATE digimon SET is_lead = 0 WHERE trainer_id = ?');
const setLeadFlag = db.prepare(
  "UPDATE digimon SET is_lead = 1 WHERE id = ? AND trainer_id = ? AND storage = 'party'",
);
const setStorage = db.prepare(
  'UPDATE digimon SET storage = ?, is_lead = 0 WHERE id = ? AND trainer_id = ?',
);
const countDigimon = db.prepare<[number], { total: number }>(
  'SELECT COUNT(*) AS total FROM digimon WHERE trainer_id = ?',
);
const countParty = db.prepare<[number], { total: number }>(
  "SELECT COUNT(*) AS total FROM digimon WHERE trainer_id = ? AND storage = 'party'",
);
const countPC = db.prepare<[number], { total: number }>(
  "SELECT COUNT(*) AS total FROM digimon WHERE trainer_id = ? AND storage = 'pc'",
);
const firstPartyId = db.prepare<[number], { id: number | null }>(
  "SELECT MIN(id) AS id FROM digimon WHERE trainer_id = ? AND storage = 'party'",
);

export function listDigimon(trainerId: number): OwnedDigimon[] {
  return selectDigimonByTrainer.all(trainerId).map(mapDigimon);
}

/** Digimon del equipo activo. Es lo único que pelan en combate. */
export function listParty(trainerId: number): OwnedDigimon[] {
  return selectParty.all(trainerId).map(mapDigimon);
}

/** Digimon depositados en el PC, esperando a salir. */
export function listPC(trainerId: number): OwnedDigimon[] {
  return selectPC.all(trainerId).map(mapDigimon);
}

/** El Digimon que sale primero en el Digivice. */
export function getLeader(trainerId: number): OwnedDigimon | null {
  return listParty(trainerId)[0] ?? null;
}

export function countPartySlots(trainerId: number): number {
  return countParty.get(trainerId)?.total ?? 0;
}

export function countPCSlots(trainerId: number): number {
  return countPC.get(trainerId)?.total ?? 0;
}

export function getDigimon(id: number): OwnedDigimon | null {
  const row = selectDigimonById.get(id);
  return row ? mapDigimon(row) : null;
}

export function getDigimonOwnedBy(trainerId: number, digimonId: number): OwnedDigimon | null {
  const row = db
    .prepare<[number, number], DigimonRow>('SELECT * FROM digimon WHERE id = ? AND trainer_id = ?')
    .get(digimonId, trainerId);
  return row ? mapDigimon(row) : null;
}

export function countTeam(trainerId: number): number {
  return countDigimon.get(trainerId)?.total ?? 0;
}

/** Crea una nueva instancia de una especie, con stats derivados del nivel. */
export function createDigimon(
  trainerId: number,
  species: SpeciesDef,
  level = 1,
  moves: string[] = [],
  storage: Storage = 'party',
): OwnedDigimon {
  return transaction(() => {
    insertDigimon.run({
      trainerId,
      speciesKey: species.key,
      level,
      exp: 0,
      moves: JSON.stringify(moves),
      storage,
      isLead: storage === 'party' && countPartySlots(trainerId) === 0 ? 1 : 0,
    });

    const id = lastInsertedId.get()!.id;
    const digimon = getDigimon(id);
    if (!digimon) throw new Error('No se pudo recuperar el Digimon recién creado.');
    return digimon;
  });
}

// ------------------------------------------------------- party y PC -------

export type MoveResult =
  | { ok: true }
  | { ok: false; reason: 'no-existe' | 'lleno' | 'vacio' | 'ya-ahi' | 'ultimo' };

/**
 * Saca un Digimon del PC al equipo activo.
 *
 * Reglas: no se puede superar `MAX_PARTY_SIZE`, y el líder nunca puede quedarse
 * sin equipo, así que no se puede enviar al PC el único miembro del partido.
 */
export function withdrawFromPC(trainerId: number, digimonId: number): MoveResult {
  const digimon = getDigimonOwnedBy(trainerId, digimonId);
  if (!digimon) return { ok: false, reason: 'no-existe' };
  if (digimon.storage === 'party') return { ok: false, reason: 'ya-ahi' };
  if (countPartySlots(trainerId) >= config.maxPartySize) return { ok: false, reason: 'lleno' };

  return transaction(() => {
    setStorage.run('party', digimonId, trainerId);
    if (!getLeaderId(trainerId)) setLeadFlag.run(digimonId, trainerId);
    return { ok: true };
  });
}

/** Manda un Digimon del equipo al PC. */
export function depositToPC(trainerId: number, digimonId: number): MoveResult {
  const digimon = getDigimonOwnedBy(trainerId, digimonId);
  if (!digimon) return { ok: false, reason: 'no-existe' };
  if (digimon.storage === 'pc') return { ok: false, reason: 'ya-ahi' };
  if (countPartySlots(trainerId) <= 1) return { ok: false, reason: 'ultimo' };
  if (countPCSlots(trainerId) >= config.pcCapacity) return { ok: false, reason: 'lleno' };

  return transaction(() => {
    setStorage.run('pc', digimonId, trainerId);
    // Si nos llevamos al lider, el lider pasa a ser otro del equipo.
    if (countPartySlots(trainerId) > 0) {
      const next = firstPartyId.get(trainerId)!.id;
      if (next) setLeadFlag.run(next, trainerId);
    }
    return { ok: true };
  });
}

/** Marca un Digimon del equipo como líder del Digivice. */
export function setLeader(trainerId: number, digimonId: number): MoveResult {
  const digimon = getDigimonOwnedBy(trainerId, digimonId);
  if (!digimon) return { ok: false, reason: 'no-existe' };
  if (digimon.storage === 'pc') return { ok: false, reason: 'no-existe' };

  return transaction(() => {
    clearLead.run(trainerId);
    setLeadFlag.run(digimonId, trainerId);
    return { ok: true };
  });
}

/** ID del lider actual, o null si el equipo esta vacio. */
export function getLeaderId(trainerId: number): number | null {
  const row = db
    .prepare<[number], { id: number | null }>(
      "SELECT id FROM digimon WHERE trainer_id = ? AND is_lead = 1 AND storage = 'party'",
    )
    .get(trainerId);
  return row?.id ?? null;
}

// ------------------------------------------------------------ progreso -----

const selectProgress = db.prepare<[number], { current_zone: string; bosses_beaten: string; bosses_found: number }>(
  'SELECT current_zone, bosses_beaten, bosses_found FROM progress WHERE trainer_id = ?',
);
const upsertProgress = db.prepare(
  `INSERT INTO progress (trainer_id, current_zone, bosses_beaten, bosses_found)
   VALUES (@trainerId, @zone, @bosses, @found)
   ON CONFLICT(trainer_id) DO UPDATE SET
     current_zone = excluded.current_zone,
     bosses_beaten = excluded.bosses_beaten,
     bosses_found = excluded.bosses_found,
     updated_at = datetime('now')`,
);

export interface Progress {
  currentZone: string;
  bossesBeaten: string[];
  bossesFound: number;
}

export function getProgress(trainerId: number): Progress {
  const row = selectProgress.get(trainerId);
  if (!row) {
    return { currentZone: 'isla_inicial', bossesBeaten: [], bossesFound: 0 };
  }

  let bosses: string[] = [];
  try {
    const parsed = JSON.parse(row.bosses_beaten);
    if (Array.isArray(parsed)) bosses = parsed.filter((b) => typeof b === 'string');
  } catch {
    bosses = [];
  }

  return { currentZone: row.current_zone, bossesBeaten: bosses, bossesFound: row.bosses_found };
}

export function saveProgress(trainerId: number, progress: Progress): void {
  upsertProgress.run({
    trainerId,
    zone: progress.currentZone,
    bosses: JSON.stringify(progress.bossesBeaten),
    found: progress.bossesFound,
  });
}

export function setCurrentZone(trainerId: number, zoneKey: string): void {
  const current = getProgress(trainerId);
  saveProgress(trainerId, { ...current, currentZone: zoneKey });
}

/** Registra un jefe derrotado. Devuelve true si era la primera vez. */
export function markBossBeaten(trainerId: number, bossKey: string): boolean {
  const progress = getProgress(trainerId);
  if (progress.bossesBeaten.includes(bossKey)) return false;

  saveProgress(trainerId, {
    ...progress,
    bossesBeaten: [...progress.bossesBeaten, bossKey],
    bossesFound: progress.bossesFound + 1,
  });

  // Solo la PRIMERA vez cuenta. Rezar al mismo guardián cincuenta veces no son
  // cincuenta victorias contra jefes, y si contara así el logro de 25 jefes
  // sería trivial para quien tenga mucho tiempo.
  bump(trainerId, 'jefes');

  return true;
}

// ------------------------------------------------------------ inventario ---

const selectInventory = db.prepare<[number], { item_key: string; quantity: number }>(
  'SELECT item_key, quantity FROM inventory WHERE trainer_id = ? AND quantity > 0',
);
const upsertInventory = db.prepare(
  `INSERT INTO inventory (trainer_id, item_key, quantity) VALUES (?, ?, ?)
   ON CONFLICT(trainer_id, item_key) DO UPDATE SET quantity = excluded.quantity`,
);

/** Devuelve `{ itemKey: cantidad }` con todo lo que posee el entrenador. */
export function getInventory(trainerId: number): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of selectInventory.all(trainerId)) {
    result[row.item_key] = row.quantity;
  }
  return result;
}

export function getItemCount(trainerId: number, itemKey: string): number {
  return getInventory(trainerId)[itemKey] ?? 0;
}

/** Escribe el inventario completo (usado al registrar y al comprar). */
export function setInventory(
  trainerId: number,
  inventory: Record<string, number>,
): void {
  transaction(() => {
    for (const [key, quantity] of Object.entries(inventory)) {
      upsertInventory.run(trainerId, key, Math.max(0, quantity));
    }
  });
}

/**
 * Suma (o resta) unidades de un objeto.
 *
 * Usa upsert y no UPDATE a secas: si el entrenador nunca tuvo ese objeto no
 * existe fila, y un UPDATE no crearía nada. Ese bug hacía que comprar un objeto
 * por primera vez cobrase el dinero pero no guardara el objeto.
 */
export function addItem(trainerId: number, itemKey: string, delta: number): number {
  const inventory = getInventory(trainerId);
  const next = Math.max(0, (inventory[itemKey] ?? 0) + delta);
  upsertInventory.run(trainerId, itemKey, next);
  return next;
}

export type PurchaseResult =
  | { ok: true; newQuantity: number }
  | { ok: false; reason: 'sin-dinero' | 'no-existe' | 'sin-espacio' };

/**
 * Compra un objeto. Cobra y guarda en la misma transacción: si algo falla al
 * escribir, no se ha descontado el dinero (SQLite no tiene transacciones
 * implicadas y `transaction()` las agrupa).
 */
export function buyItem(trainerId: number, itemKey: string): PurchaseResult {
  const item = getItem(itemKey);
  if (!item) return { ok: false, reason: 'no-existe' };

  const trainer = getTrainerById(trainerId);
  if (!trainer) return { ok: false, reason: 'no-existe' };

  // Tope de seguridad para que nadie acumule 9999 pociones.
  if (getItemCount(trainerId, itemKey) >= 99) {
    return { ok: false, reason: 'sin-espacio' };
  }

  if (!trySpendDigibytes(trainerId, item.price)) {
    return { ok: false, reason: 'sin-dinero' };
  }

  const newQuantity = addItem(trainerId, itemKey, 1);
  return { ok: true, newQuantity };
}

/** Quema unidades del inventario al usarlas en combate. */
export function consumeItem(trainerId: number, itemKey: string, amount = 1): boolean {
  const owned = getItemCount(trainerId, itemKey);
  if (owned < amount) return false;
  addItem(trainerId, itemKey, -amount);
  return true;
}

/** Registra al entrenador y le entrega su primer Digimon, todo en una transacción. */
export function registerTrainer(
  discordId: string,
  username: string,
  starter: SpeciesDef,
): Trainer {
  return transaction(() => {
    const created = insertTrainer.get(discordId, username) as TrainerRow;
    const starterMoves = starter.learnset.slice(0, 2);
    insertStarter.run({
      trainerId: created.id,
      speciesKey: starter.key,
      moves: JSON.stringify(starterMoves),
    });

    for (const [key, quantity] of Object.entries(STARTING_INVENTORY)) {
      upsertInventory.run(created.id, key, quantity);
    }

    return mapTrainer(created);
  });
}

/**
 * Guarda nivel, exp, moveset, estado y especie de un Digimon.
 * La especie se persiste porque puede cambiar al evolucionar.
 */
const setNickname = db.prepare(
  'UPDATE digimon SET nickname = ? WHERE id = ? AND trainer_id = ?',
);

/**
 * Guarda solo el apodo. `saveDigimon` no lo incluye a propósito: es un campo
 * que cambia por comando, no por progresión, y mezclarlo ahí haría que un
 * guardado de nivel pudiera pisar un apodo puesto a mano.
 */
export function saveNickname(trainerId: number, digimonId: number, nickname: string | null): void {
  setNickname.run(nickname, digimonId, trainerId);
}

export function saveDigimon(digimon: OwnedDigimon): void {
  updateDigimonProgress.run(
    digimon.level,
    digimon.exp,
    JSON.stringify(digimon.moves.map((m) => m.key)),
    digimon.status,
    digimon.species.key,
    digimon.id,
  );
}

/**
 * Callback de persistencia para `grantExp`.
 *
 * Recibe el objeto ya modificado en memoria: releerlo de la base devolvería
 * una copia con el nivel anterior y machacaría la subida.
 */
export function makePersister() {
  return (digimon: OwnedDigimon) => saveDigimon(digimon);
}

/** Al terminar una batalla todos vuelven a la base: PV a tope y sin estados. */
export function restTeam(trainerId: number): void {
  const roster = listDigimon(trainerId);
  for (const digimon of roster) {
    // listDigimon ya devuelve las estadísticas efectivas (con equipo).
    digimon.hp = digimon.stats.hp;
    digimon.status = 'ok';
  }
  transaction(() => {
    for (const digimon of roster) saveDigimon(digimon);
  });
}

// -------------------------------------------------------------- mappers ----

function mapTrainer(row: TrainerRow): Trainer {
  return {
    id: row.id,
    discordId: row.discord_id,
    username: row.username,
    digibytes: row.digibytes,
    battlesWon: row.battles_won,
    battlesLost: row.battles_lost,
    createdAt: row.created_at,
  };
}

function mapDigimon(row: DigimonRow): OwnedDigimon {
  const species = getSpecies(row.species_key);
  if (!species) {
    throw new Error(
      `Especie desconocida en la base de datos: "${row.species_key}". Revisa species.ts.`,
    );
  }

  const level = Math.min(row.level, MAX_LEVEL);

  // Las estadísticas se derivan de la especie y el nivel. No hay copia en la
  // base de datos a propósito: duplicarlas era la fuente de un crecimiento
  // cuadrático silencioso. El equipo se suma aparte en `effectiveStats()`.
  const baseStats = computeStats(species.base, level);

  let moveKeys: string[] = [];
  try {
    moveKeys = JSON.parse(row.moves);
  } catch {
    moveKeys = species.learnset.slice(0, 2);
  }
  if (!Array.isArray(moveKeys) || moveKeys.length === 0) {
    moveKeys = species.learnset.slice(0, 2);
  }

  const digimon: OwnedDigimon = {
    id: row.id,
    trainerId: row.trainer_id,
    species,
    nickname: row.nickname,
    level,
    exp: row.exp,
    stats: baseStats,
    hp: baseStats.hp,
    moves: resolveMoves(moveKeys),
    status: (row.status as StatusEffect) ?? 'ok',
    storage: (row.storage as Storage) ?? 'party',
    caughtAt: row.caught_at,
  };

  // Se resuelve con el equipo puesto para que todo el que lee un Digimon vea
  // siempre las cifras con las que va a pelear.
  return withEffectiveStats(digimon);
}


// ------------------------------------------------------- clasificación ---

export interface RankingEntry {
  trainerId: number;
  username: string;
  battlesWon: number;
  battlesLost: number;
  digibytes: number;
  /** Puntos de la temporada de PvP, para ordenar por partida y no por nivel. */
  pvpPoints: number;
}

const selectRanking = db.prepare<[number], RankingEntry>(
  `SELECT t.id AS trainerId,
         t.username AS username,
         t.battles_won AS battlesWon,
         t.battles_lost AS battlesLost,
         t.digibytes AS digibytes,
         COALESCE(p.points, 0) AS pvpPoints
    FROM trainers t
    LEFT JOIN pvp_state p ON p.trainer_id = t.id
    ORDER BY t.battles_won DESC, t.digibytes DESC
    LIMIT ?`
);

/**
 * Los mejores entrenadores.
 *
 * Vive aquí y no en el comando por una razón práctica: la pantalla de
 * clasificación y el comando piden exactamente lo mismo, y duplicar la
 * consulta es la forma segura de que las dos se desincronicen.
 */
export function topTrainers(limit = 10): RankingEntry[] {
  return selectRanking.all(limit);
}
