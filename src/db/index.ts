import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// En el primer arranque ./data todavia no existe.
mkdirSync(dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);

// Aplica el esquema en cada arranque. Todas las sentencias son idempotentes.
db.exec(readFileSync(resolve(__dirname, 'schema.sql'), 'utf8'));

/**
 * Migraciones ligeras.
 *
 * `CREATE TABLE IF NOT EXISTS` no añade columnas nuevas a una base ya
 * existente, así que quien actualice el bot se quedaría sin `storage` ni
 * `is_lead` y el código reventaría. Aquí se añaden solo las que falten.
 */
function tableHasColumn(table: string, column: string): boolean {
  return db.prepare<[], { name: string }>(`PRAGMA table_info(${table})`).all()
    .some((c) => c.name === column);
}

function addColumnIfMissing(table: string, column: string, definition: string): void {
  if (tableHasColumn(table, column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`[db] migración aplicada: ${table}.${column}`);
}

addColumnIfMissing('digimon', 'storage', "TEXT NOT NULL DEFAULT 'party'");
addColumnIfMissing('digimon', 'is_lead', 'INTEGER NOT NULL DEFAULT 0');

/**
 * Índice PARCIAL: solo una expedición activa por jugador.
 *
 * Va aparte de `schema.sql` a propósito. `CREATE UNIQUE INDEX ... WHERE` es
 * un índice parcial, soportado desde SQLite 3.8; si un `exec` con varias
 * sentencias fallara por él, se perderían también las tablas que lo
 * preceden en el mismo lote.
 *
 * Sin esto, un jugador podría abrir una expedición nueva sin cerrar la
 * anterior y ver un mapa que no era el suyo.
 */
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_expedicion_activa ON dungeon_expedition(trainer_id) WHERE status = 'activa'");

db.exec('CREATE INDEX IF NOT EXISTS idx_expedicion_dungeon ON dungeon_expedition(trainer_id, dungeon_key)');
db.exec('CREATE INDEX IF NOT EXISTS idx_expedicion_log ON dungeon_expedition_log(trainer_id, dungeon_key)');

/**
 * Las columnas `base_*` de `digimon` están obsoletas.
 *
 * Guardaban las estadísticas ya escaladas por nivel, mientras que
 * `computeStats()` las volvía a escalar al leerlas: crecimiento cuadrático. La
 * tabla es legacy; SQLite (antes de 3.35) no tiene `DROP COLUMN` y todos los
 * clientes ya usan `foreign_keys = ON`, así que no se puede simplemente
 * eliminar. Para bases nuevas la tabla ya no las crea (ver schema.sql); para
 * las antiguas se vacían y la lectura las ignora.
 */
if (tableHasColumn('digimon', 'base_hp')) {
  db.exec('UPDATE digimon SET base_hp = 0, base_attack = 0, base_defense = 0, base_speed = 0');
}

/** Encola el índice nuevo (requiere que la columna storage ya exista). */
db.exec('CREATE INDEX IF NOT EXISTS idx_digimon_storage ON digimon(trainer_id, storage)');

/**
 * Garantiza que cada entrenador tenga exactamente un líder en su party.
 * Se ejecuta al arrancar por si una migración dejó el estado inconsistente.
 */
db.exec(`
  UPDATE digimon
     SET is_lead = 0
   WHERE id IN (
     SELECT id FROM (
       SELECT id, ROW_NUMBER() OVER (PARTITION BY trainer_id ORDER BY id) AS rn
         FROM digimon WHERE storage = 'party'
     ) WHERE rn > 1
   )
`);

db.exec(`
  UPDATE digimon
     SET is_lead = 1
   WHERE id = (
     SELECT MIN(id) FROM digimon WHERE storage = 'party' GROUP BY trainer_id
   )
`);

/** Envuelve un callback en una transacción de SQLite. */
export function transaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}
