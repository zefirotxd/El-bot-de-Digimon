-- ============================================================
-- Esquema de Digimon MMO
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------- PvP ----------------
CREATE TABLE IF NOT EXISTS pvp_state (
  trainer_id     INTEGER PRIMARY KEY REFERENCES trainers(id) ON DELETE CASCADE,
  points         INTEGER NOT NULL DEFAULT 0,   -- puntos de la temporada
  wins           INTEGER NOT NULL DEFAULT 0,
  losses         INTEGER NOT NULL DEFAULT 0,
  draws          INTEGER NOT NULL DEFAULT 0,
  disconnects    INTEGER NOT NULL DEFAULT 0,   -- veces que abandono la partida
  streak         INTEGER NOT NULL DEFAULT 0,   -- racha diaria
  last_daily     TEXT,                          -- YYYY-MM-DD de la última recompensa
  season         INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Historial de partidas. Necesario para el enfriamiento anti-revancha y para
-- que el jugador pueda ver su récord.
CREATE TABLE IF NOT EXISTS pvp_matches (
  id           TEXT    PRIMARY KEY,
  trainer_a    INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  trainer_b    INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  winner_id    INTEGER REFERENCES trainers(id) ON DELETE SET NULL, -- NULL = empate
  loser_id     INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
  reason       TEXT    NOT NULL DEFAULT 'jugado', -- jugado | desconexion | abandono
  rounds_won_a INTEGER NOT NULL DEFAULT 0,
  rounds_won_b INTEGER NOT NULL DEFAULT 0,
  played_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Un rival no se puede volver a desafiar enseguida.
CREATE INDEX IF NOT EXISTS idx_pvp_pair ON pvp_matches(trainer_a, trainer_b, played_at);

-- ---------------- Evolución ----------------
-- La evolución es MANUAL: el nivel solo desbloquea rutas. Este registro es el
-- que permite auditar "este Digimon pasó por aquí" sin llevar la cuenta en el
-- objeto de juego, que se reconstruye desde el árbol.
CREATE TABLE IF NOT EXISTS digimon_evolution (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  digimon_id    INTEGER NOT NULL REFERENCES digimon(id) ON DELETE CASCADE,
  trainer_id    INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  from_species  TEXT    NOT NULL,
  to_species    TEXT    NOT NULL,
  route_index   INTEGER NOT NULL DEFAULT 0,
  -- 'evolucion' = ruta normal | 'regresion' = devolucion con material
  kind          TEXT    NOT NULL DEFAULT 'evolucion',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_evolution_digimon ON digimon_evolution(digimon_id);
CREATE INDEX IF NOT EXISTS idx_evolution_trainer ON digimon_evolution(trainer_id);

-- Formas que el entrenador ha desbloqueado alguna vez. Es lo que el Digivice
-- muestra como colección, y lo que impide reevolucionar a una forma que ya
-- Xerox gastó recursos: volver a ella debe pasar por la regresión.
CREATE TABLE IF NOT EXISTS evolution_unlocks (
  trainer_id   INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  species_key  TEXT    NOT NULL,
  unlocked_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (trainer_id, species_key)
);

-- ---------------- Mazmorras ----------------
-- El progreso se guarda SALA A SALA. Si abandonas en la tercera de cinco,
-- vuelves a la tercera con lo que ya te llevaste: eso es lo que hace que sea
-- una mazmorra y no tres combates seguidos con un nombre encima.
CREATE TABLE IF NOT EXISTS dungeon_run (
  trainer_id     INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  dungeon_key    TEXT    NOT NULL,
  /** Indice de la siguiente sala a jugar. 0 = empezar desde el principio. */
  room_index     INTEGER NOT NULL DEFAULT 0,
  /** Fecha del intento: YYYY-MM-DD. Un intento por día y por mazmorra. */
  run_date       TEXT    NOT NULL,
  started_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  /** Rooms superadas en ESTE intento. */
  rooms_cleared  INTEGER NOT NULL DEFAULT 0,
  finished       INTEGER NOT NULL DEFAULT 0,
  /** Cuantas veces ha entrado HOY. El tope sale de daily_attempts. */
  entries        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (trainer_id, dungeon_key, run_date)
);

CREATE INDEX IF NOT EXISTS idx_dungeon_run_date ON dungeon_run(run_date);

-- Energía diaria: se reinicia por fecha, no por contador. Un contador que se
-- reinicia a las 00:00 es lo mismo, pero guardarlo hace que se pueda auditar
-- y que un reinicio del bot no devuelva energía.
CREATE TABLE IF NOT EXISTS trainer_energy (
  trainer_id   INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  day          TEXT    NOT NULL,   -- YYYY-MM-DD
  energy       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (trainer_id, day)
);

-- Primera pasada de cada mazmorra, para la recompensa de una sola vez.
CREATE TABLE IF NOT EXISTS dungeon_clear (
  trainer_id    INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  dungeon_key   TEXT    NOT NULL,
  first_cleared TEXT    NOT NULL DEFAULT (datetime('now')),
  clears        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (trainer_id, dungeon_key)
);

-- ---------------- Jefe global ----------------
-- Un solo jefe activo para todo el bot, con la vida COMPARTIDA. El daño se
-- persiste entre reinicios: si no, "global" sería una mentira (cada jugador
-- estaría golpeando su propia copia).
CREATE TABLE IF NOT EXISTS world_boss (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  boss_key      TEXT    NOT NULL,
  started_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  ends_at       TEXT    NOT NULL,
  max_hp        INTEGER NOT NULL,
  current_hp    INTEGER NOT NULL,
  total_damage  INTEGER NOT NULL DEFAULT 0,
  defeated_by   INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
  defeated_at   TEXT
);

-- Contribución por jugador. Es lo que alimenta la clasificación y lo que
-- decide los premios.
CREATE TABLE IF NOT EXISTS world_boss_contrib (
  boss_id      INTEGER NOT NULL,
  trainer_id   INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  damage       INTEGER NOT NULL DEFAULT 0,
  hits         INTEGER NOT NULL DEFAULT 0,
  best_damage  INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (boss_id, trainer_id)
);

-- ---------------- Misiones y logros ----------------
-- Lo que se cuenta, de por vida. Un contador por clave en vez de columnas: los
-- logros llegan solos cuando se añade una métrica nueva, sin migración.
-- Bestiario: qué ha visto el entrenador, no solo qué posee.
--
-- Se registra al ENCONTRAR y no solo al capturar: un rival que te huye
-- tambien cuenta. Al reves seria mas obvio, pero obligaria a capturar para
-- que el bestiario sirviera de algo, y sirve precisamente para saber a que
-- volver.
CREATE TABLE IF NOT EXISTS species_dex (
  trainer_id  INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  species_key TEXT    NOT NULL,
  captures    INTEGER NOT NULL DEFAULT 0,
  seen_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  caught_at   TEXT,
  PRIMARY KEY (trainer_id, species_key)
);

CREATE INDEX IF NOT EXISTS idx_dex_species ON species_dex(species_key);

CREATE TABLE IF NOT EXISTS trainer_stats (
  trainer_id INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  key        TEXT    NOT NULL,
  value      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (trainer_id, key)
);

-- Progreso de UNA misión en UN periodo.
--
-- La clave primaria incluye el periodo, así que la caducidad es gratis: la
-- misión diaria del lunes vive bajo '2026-10-06' y la del martes bajo otra
-- clave. No hay ningún proceso que limpie nada, y el cambio de periodo no
-- reinicia el progreso de nadie.
--
-- `claimed_at` es lo que hace imposible farmear: sin él, un botón que paga
-- vuelve a pagar cada vez que se pulsa.
CREATE TABLE IF NOT EXISTS mission_progress (
  trainer_id    INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  mission_id    TEXT    NOT NULL,
  -- '2026-10-06' para diarias, '2026-W41' para semanales.
  period_key    TEXT    NOT NULL,
  progress      INTEGER NOT NULL DEFAULT 0,
  completed_at  TEXT,
  claimed_at    TEXT,
  PRIMARY KEY (trainer_id, mission_id, period_key)
);

CREATE INDEX IF NOT EXISTS idx_mission_period ON mission_progress(period_key);

-- Días en los que el entrenador ha jugado. Se cuenta por día, no por sesión:
-- si no, abrir y cerrar el bot 50 veces valdría por 50 días activos.
-- Contadores POR DÍA. Es lo que hacen exactas las misiones con periodo: la
-- diaria lee la fila de hoy y la semanal suma los siete días de la semana
-- ISO. No hay "línea base" que capturar al abrir la lista, así que el
-- progreso no depende de cuándo el jugador se le ocurra mirar.
CREATE TABLE IF NOT EXISTS trainer_daily (
  trainer_id INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  day        TEXT    NOT NULL,   -- YYYY-MM-DD
  key        TEXT    NOT NULL,   -- misma métrica que trainer_stats
  value      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (trainer_id, day, key)
);

CREATE INDEX IF NOT EXISTS idx_daily_day ON trainer_daily(day);

CREATE TABLE IF NOT EXISTS trainer_activity (
  trainer_id INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  day        TEXT    NOT NULL,
  battles    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (trainer_id, day)
);

-- Logros: sin periodo, porque son hitos de por vida y no se repiten.
CREATE TABLE IF NOT EXISTS achievement_progress (
  trainer_id   INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  achievement_id TEXT   NOT NULL,
  progress     INTEGER NOT NULL DEFAULT 0,
  unlocked_at  TEXT,
  claimed_at   TEXT,
  PRIMARY KEY (trainer_id, achievement_id)
);

-- Títulos exclusivos otorgados por logros. Separar la CONCESIÓN de la ficha
-- permite mostrarlos sin volver a mirar la definición del logro.
CREATE TABLE IF NOT EXISTS trainer_titles (
  trainer_id  INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  title_key   TEXT    NOT NULL,
  title_name  TEXT    NOT NULL,
  title_emoji TEXT    NOT NULL,
  unlocked_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (trainer_id, title_key)
);

-- ---------------- Equipo ----------------
-- Dos piezas: lo que posee el entrenador (con su nivel de mejora) y lo que
-- tiene equipado cada Digimon. El equipo NUNCA toca base_*: solo suma encima
-- al calcular las estadísticas efectivas.
CREATE TABLE IF NOT EXISTS gear_owned (
  trainer_id  INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  item_key    TEXT    NOT NULL,
  upgrade     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (trainer_id, item_key)
);

CREATE TABLE IF NOT EXISTS digimon_gear (
  digimon_id  INTEGER NOT NULL REFERENCES digimon(id) ON DELETE CASCADE,
  slot        TEXT    NOT NULL,
  item_key    TEXT    NOT NULL,
  upgrade     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (digimon_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_gear_owned ON gear_owned(trainer_id);

-- ---------------- Entrenadores ----------------
CREATE TABLE IF NOT EXISTS trainers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id   TEXT    NOT NULL UNIQUE,
  username     TEXT    NOT NULL,
  digibytes    INTEGER NOT NULL DEFAULT 500,
  battles_won  INTEGER NOT NULL DEFAULT 0,
  battles_lost INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------- Progreso ----------------
-- Una fila por entrenador: zona actual y jefes ya derrotados.
CREATE TABLE IF NOT EXISTS progress (
  trainer_id    INTEGER PRIMARY KEY REFERENCES trainers(id) ON DELETE CASCADE,
  current_zone  TEXT    NOT NULL DEFAULT 'isla_inicial',
  bosses_beaten TEXT    NOT NULL DEFAULT '[]',  -- JSON array de claves de jefe
  bosses_found  INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------- Criaturas capturadas ----------------
-- `storage` decide si el Digimon esta en el equipo activo ('party') o
-- depositado en el PC ('pc'). Solo los de 'party' pelan.
--
-- Las estadísticas base NO se guardan: se derivan de `species_key` + `level`
-- con `computeStats()`. Duplicarlas aquí era una trampa: al insertar se
-- escribían ya escaladas por nivel y al releerse se escalaban otra vez
-- (crecimiento cuadrático). El catálogo de especies es la única fuente.
CREATE TABLE IF NOT EXISTS digimon (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  trainer_id    INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  species_key   TEXT    NOT NULL,               -- clave en species.ts
  nickname      TEXT,                           -- NULL = usa el nombre de la especie
  level         INTEGER NOT NULL DEFAULT 1,
  exp           INTEGER NOT NULL DEFAULT 0,     -- exp dentro del nivel actual
  moves         TEXT    NOT NULL DEFAULT '[]',  -- JSON: array de move keys
  status        TEXT    NOT NULL DEFAULT 'ok',  -- ok | quemadura | veneno | ...
  storage       TEXT    NOT NULL DEFAULT 'party', -- party | pc
  is_lead       INTEGER NOT NULL DEFAULT 0,     -- 1 = sale primero en el Digivice
  caught_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (trainer_id) REFERENCES trainers(id) ON DELETE CASCADE
);

-- Las columnas base_* se elimination en migraciones; ver db/index.ts.

CREATE INDEX IF NOT EXISTS idx_digimon_trainer ON digimon(trainer_id);
CREATE INDEX IF NOT EXISTS idx_digimon_species  ON digimon(species_key);
CREATE INDEX IF NOT EXISTS idx_digimon_storage  ON digimon(trainer_id, storage);

-- La clasificacion agrupa por entrenador y ordena por victorias o dinero.
CREATE INDEX IF NOT EXISTS idx_trainers_rank ON trainers(battles_won DESC, digibytes DESC);

-- ---------------- Inventario ----------------
-- Un objeto por fila. La cantidad es lo que posee el entrenador; el tope por
-- combate vive en items.ts (perBattleCap).
CREATE TABLE IF NOT EXISTS inventory (
  trainer_id  INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  item_key    TEXT    NOT NULL,
  quantity    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (trainer_id, item_key),
  FOREIGN KEY (trainer_id) REFERENCES trainers(id) ON DELETE CASCADE
);

-- ==========================================================================
-- EXPEDICIÓN DE MAZMORRA
-- ==========================================================================
--
-- Esto NO reemplaza a `dungeon_run`. Aquella guardaba "qué salas has hecho de
-- tres, y cuántas veces has entrado hoy"; ésta guarda un mapa entero con posición,
-- niebla de guerra y recursos. Son dos cosas distintas y conviene que las dos
-- estén:
--
--   dungeon_run       = límites diarios.-energy, intentos, recompensa de primera.
--   dungeon_expedition = dónde estás ahora y qué has visto.
--
-- Un jugador puede tener las dos a la vez: haber agotado los intentos del día y
-- tener una expedición a medias que empezó ayer. Por eso la expedición lleva su
-- propia fecha de inicio y no comparte la de `dungeon_run`.
CREATE TABLE IF NOT EXISTS dungeon_expedition (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  trainer_id    INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  dungeon_key   TEXT    NOT NULL,

  -- 'activa' | 'completada' | 'retirada'
  status        TEXT    NOT NULL DEFAULT 'activa',

  /**
   * La semilla de TODA la expedición.
   *
   * Una sola semilla para todos los pisos, no una por piso. Con una por piso, dos
   * pisos seguidos no tendrían por qué parecerse, y el jugador cruzaría de una zona
   * a otra sin ninguna relación. Regenerar un piso desde esta semilla tiene que
   * dar SIEMPRE el mismo mapa: es lo que permite recargar el guardado y volver
   * a poner al jugador donde estaba.
   */
  seed          INTEGER NOT NULL,

  piso_actual   INTEGER NOT NULL DEFAULT 1,
  pos_x         INTEGER NOT NULL DEFAULT 0,
  pos_y         INTEGER NOT NULL DEFAULT 0,

  /**
   * Casillas descubiertas, por piso, como JSON: `{"1": ["3,4", "3,5"], ...}`.
   *
   * Se guarda el STRING y no un índice en base de datos porque el mapa es pequeño
   * y se lee entero de una vez al pintar la pantalla. Con una tabla aparte habría
   * doscientas filas por expedición y una consulta por casilla para pintar un
   * mapa que cabe en pantalla.
   */
  descubiertas  TEXT    NOT NULL DEFAULT '{}',

  /** Casillas ya resueltas, con el mismo formato. */
  resueltas     TEXT    NOT NULL DEFAULT '{}',

  /** Casillas cerradas que el jugador ya sabe que existen. */
  bloqueadas    TEXT    NOT NULL DEFAULT '{}',

  -- --- recursos de la expedición ------------------------------------------
  /** Energía que le queda. Es lo que hace decidir si sigue o se retira. */
  energia       INTEGER NOT NULL DEFAULT 0,
  /** Pocas curaciones. Se gastan aquí y en el santuario. */
  pociones      INTEGER NOT NULL DEFAULT 2,
  /** Segundos jugados. Es lo que hace que la expedición se alargue. */
  duracion_seg  INTEGER NOT NULL DEFAULT 0,
  /** Piso donde se guardó el último punto de reanudación. 0 = ninguno. */
  checkpoint_piso INTEGER NOT NULL DEFAULT 0,
  checkpoint_x  INTEGER NOT NULL DEFAULT 0,
  checkpoint_y  INTEGER NOT NULL DEFAULT 0,

  started_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT
);

-- Solo puede haber UNA expedición activa por jugador. Una expedición abandonada a
-- medias y otra nueva se solaparían y el jugador no sabría cuál estaba viendo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_expedicion_activa
  ON dungeon_expedition(trainer_id)
  WHERE status = 'activa';

CREATE INDEX IF NOT EXISTS idx_expedicion_dungeon ON dungeon_expedition(trainer_id, dungeon_key);

-- Historial de expedición terminadas, para el registro y las recompensas.
CREATE TABLE IF NOT EXISTS dungeon_expedition_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  trainer_id    INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  dungeon_key   TEXT    NOT NULL,
  status        TEXT    NOT NULL,
  pisos_alcanzados INTEGER NOT NULL DEFAULT 1,
  casillas_visitadas INTEGER NOT NULL DEFAULT 0,
  casillas_totales   INTEGER NOT NULL DEFAULT 0,
  combates      INTEGER NOT NULL DEFAULT 0,
  minijefes     INTEGER NOT NULL DEFAULT 0,
  cofres        INTEGER NOT NULL DEFAULT 0,
  eventos       INTEGER NOT NULL DEFAULT 0,
  duracion_seg  INTEGER NOT NULL DEFAULT 0,
  /** Recompensas aseguradas. Lo pendiente no se guarda: se pierde al retirarse. */
  digibytes     INTEGER NOT NULL DEFAULT 0,
  botin         TEXT    NOT NULL DEFAULT '[]',
  finished_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_expedicion_log ON dungeon_expedition_log(trainer_id, dungeon_key);
