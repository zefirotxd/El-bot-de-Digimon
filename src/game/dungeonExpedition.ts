import { db, transaction } from '../db/index.js';

/**
 * Expediciones de mazmorra.
 *
 * Va en su propio fichero y no en `repository.ts` porque `repository.ts` es ya
 * enorme y esto es un mundo aparte: tiene su tabla, su forma de serializar el mapa
 * y sus propias reglas de guardado. Meterlo ahí era la forma de que nadie lo
 * encontrara.
 *
 * LO QUE SE GUARDA Y POR QUÉ:
 *
 * - La SEMILLA de la expedición, no el mapa entero. Regenerar desde la semilla da
 *   siempre el mismo mapa, así que guardar 200 casillas por expedición sería
 *   guardar una copia de algo que ya se sabe derivar.
 * - El mapa está en el estado, la niebla de guerra en la base de datos. El estado
 *   es lo que se está jugando y se regenera en cada vuelta; la base de datos es
 *   lo que sobrevive a un reinicio del bot.
 */

/** El estado de una expedición. */
export type EstadoExpedicion = 'activa' | 'completada' | 'retirada';

export interface Expedicion {
  id: number;
  trainerId: number;
  dungeonKey: string;
  status: EstadoExpedicion;
  seed: number;
  pisoActual: number;
  posX: number;
  posY: number;
  /** `{ piso: ["x,y", ...] }` */
  descubiertas: Record<string, string[]>;
  resueltas: Record<string, string[]>;
  bloqueadas: Record<string, string[]>;
  energia: number;
  pociones: number;
  duracionSeg: number;
  checkpoint: { piso: number; x: number; y: number } | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

/** Una fila de `dungeon_expedition`. */
interface Fila {
  id: number;
  trainer_id: number;
  dungeon_key: string;
  status: string;
  seed: number;
  piso_actual: number;
  pos_x: number;
  pos_y: number;
  descubiertas: string;
  resueltas: string;
  bloqueadas: string;
  energia: number;
  pociones: number;
  duracion_seg: number;
  checkpoint_piso: number;
  checkpoint_x: number;
  checkpoint_y: number;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
}

function aExpedicion(f: Fila): Expedicion {
  return {
    id: f.id,
    trainerId: f.trainer_id,
    dungeonKey: f.dungeon_key,
    status: f.status as EstadoExpedicion,
    seed: f.seed,
    pisoActual: f.piso_actual,
    posX: f.pos_x,
    posY: f.pos_y,
    descubiertas: parseConjunto(f.descubiertas),
    resueltas: parseConjunto(f.resueltas),
    bloqueadas: parseConjunto(f.bloqueadas),
    energia: f.energia,
    pociones: f.pociones,
    duracionSeg: f.duracion_seg,
    checkpoint:
      f.checkpoint_piso > 0 ? { piso: f.checkpoint_piso, x: f.checkpoint_x, y: f.checkpoint_y } : null,
    startedAt: f.started_at,
    updatedAt: f.updated_at,
    finishedAt: f.finished_at,
  };
}

/**
 * El mapa de celdas se guarda como JSON: `{ "1": ["3,4", "3,5"] }`.
 *
 * Se lee y se escribe entero, sin mezclar. La alternativa —una tabla por celda—
 * daría doscientas filas por expedición y una consulta por casilla para pintar un
 * mapa que cabe en pantalla. El mapa es pequeño y se usa completo.
 */
function parseConjunto(texto: string): Record<string, string[]> {
  try {
    const dato = JSON.parse(texto) as Record<string, string[]>;
    return typeof dato === 'object' && dato !== null ? dato : {};
  } catch {
    // Un JSON roto no puede dejar la expedición ilegible: se empieza de cero y el
    // jugador pierde la niebla, no la partida entera.
    return {};
  }
}

function serializa(conjunto: Record<string, string[]>): string {
  return JSON.stringify(conjunto);
}

const clave = (x: number, y: number) => `${x},${y}`;

/**
 * Abre una expedición.
 *
 * Si el jugador ya tiene una activa, la devuelve en vez de abrir otra. Perdería el
 * mapa que estaba explorando, y abrirla en silencio es peor que negarse.
 */
export function abrirExpedicion(
  trainerId: number,
  dungeonKey: string,
  seed: number,
  entrada: { x: number; y: number },
  energia: number,
  pociones = 2,
): Expedicion {
  const actual = expedicionActiva(trainerId);
  if (actual) return actual;

  return transaction(() => {
    const info = db
      .prepare<[number, string, number, number, number, number, number]>(
        `INSERT INTO dungeon_expedition
           (trainer_id, dungeon_key, seed, pos_x, pos_y, energia, pociones)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(trainerId, dungeonKey, seed, entrada.x, entrada.y, energia, pociones);

    const nuevoId = Number(info.lastInsertRowid);

    // La casilla en la que se entra está descubierta y resuelta a la vez: el
    // jugador sabe que está ahí y ya no tiene nada que hacer en ella.
    const piso = '1';
    const c = clave(entrada.x, entrada.y);

    db.prepare<[string, string, string, number], void>(
      `UPDATE dungeon_expedition
          SET descubiertas = ?, resueltas = ?, bloqueadas = ?
        WHERE id = ?`,
    ).run(
      serializa({ [piso]: [c] }),
      serializa({ [piso]: [c] }),
      '{}',
      nuevoId,
    );

    return expedicionPorId(nuevoId)!;
  });
}

/** La expedición activa del jugador, o `null`. */
export function expedicionActiva(trainerId: number): Expedicion | null {
  const fila = db
    .prepare<[number], Fila>(
      `SELECT * FROM dungeon_expedition
        WHERE trainer_id = ? AND status = 'activa'
        ORDER BY id DESC LIMIT 1`,
    )
    .get(trainerId);

  return fila ? aExpedicion(fila) : null;
}

export function expedicionPorId(id: number): Expedicion | null {
  const fila = db.prepare<[number], Fila>('SELECT * FROM dungeon_expedition WHERE id = ?').get(id);
  return fila ? aExpedicion(fila) : null;
}

/** Guarda la expedición entera. Es lo más simple y lo que menos puede desincronizarse. */
/** Guarda la expedición entera. Es lo más simple y lo que menos puede desincronizarse. */
export function guardarExpedicion(e: Expedicion): void {
  db.prepare(
    `UPDATE dungeon_expedition
        SET dungeon_key = ?, status = ?, piso_actual = ?, pos_x = ?, pos_y = ?,
            descubiertas = ?, resueltas = ?, bloqueadas = ?,
            energia = ?, pociones = ?, duracion_seg = ?,
            checkpoint_piso = ?, checkpoint_x = ?, checkpoint_y = ?,
            updated_at = datetime('now'), finished_at = ?
      WHERE id = ?`,
  ).run(
    e.dungeonKey,
    e.status,
    e.pisoActual,
    e.posX,
    e.posY,
    serializa(e.descubiertas),
    serializa(e.resueltas),
    serializa(e.bloqueadas),
    e.energia,
    e.pociones,
    e.duracionSeg,
    e.checkpoint?.piso ?? 0,
    e.checkpoint?.x ?? 0,
    e.checkpoint?.y ?? 0,
    e.finishedAt,
    e.id,
  );
}

/** Mueve al jugador. */
export function moverA(e: Expedicion, x: number, y: number): void {
  e.posX = x;
  e.posY = y;
  guardarExpedicion(e);
}

/** Suma segundos a la duración. Se llama al cerrar cada turno. */
export function sumarTiempo(e: Expedicion, segundos: number): void {
  e.duracionSeg += segundos;
}

/** Añade energía o curaciones. */
export function cambiarRecursos(e: Expedicion, delta: { energia?: number; pociones?: number }): void {
  if (delta.energia !== undefined) e.energia = Math.max(0, e.energia + delta.energia);
  if (delta.pociones !== undefined) e.pociones = Math.max(0, e.pociones + delta.pociones);
}

/** Marca una casilla como descubierta, si no lo estaba. */
export function descubrir(e: Expedicion, piso: number, x: number, y: number): boolean {
  const c = clave(x, y);
  const lista = (e.descubiertas[String(piso)] ??= []);

  if (lista.includes(c)) return false;

  lista.push(c);
  return true;
}

/** Marca una casilla como resuelta. */
export function resolver(e: Expedicion, piso: number, x: number, y: number): void {
  const c = clave(x, y);
  const lista = (e.resueltas[String(piso)] ??= []);

  if (!lista.includes(c)) lista.push(c);
}

/** Marca una casilla como cerrada. */
export function cerrar(e: Expedicion, piso: number, x: number, y: number): void {
  const c = clave(x, y);
  const lista = (e.bloqueadas[String(piso)] ??= []);

  if (!lista.includes(c)) lista.push(c);
}

/** Quita una casilla de las cerradas. Es lo que hace abrir una puerta. */
export function abrir(e: Expedicion, piso: number, x: number, y: number): void {
  const c = clave(x, y);
  const lista = e.bloqueadas[String(piso)];

  if (!lista) return;

  const i = lista.indexOf(c);
  if (i !== -1) lista.splice(i, 1);
}

/** Guarda un punto de reanudación. */
export function guardarCheckpoint(e: Expedicion, piso: number, x: number, y: number): void {
  e.checkpoint = { piso, x, y };
  guardarExpedicion(e);
}

/** Cierra la expedición con un estado final. */
export function cerrarExpedicion(e: Expedicion, estado: EstadoExpedicion): void {
  e.status = estado;
  e.finishedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  guardarExpedicion(e);
}

/** Borra la expedición activa. Para el comando de abandonar. */
export function borrarExpedicion(e: Expedicion): void {
  db.prepare('DELETE FROM dungeon_expedition WHERE id = ?').run(e.id);
}

// ------------------------------------------------------------- historial ---

export interface ResumenExpedicion {
  estado: EstadoExpedicion;
  pisosAlcanzados: number;
  casillasVisitadas: number;
  casillasTotales: number;
  duracionSeg: number;
  digibytes: number;
}

const SELECT_LOG = db.prepare<[number, string], { finished_at: string; status: string }>(
  `SELECT finished_at, status FROM dungeon_expedition_log
    WHERE trainer_id = ? AND dungeon_key = ?
    ORDER BY id DESC LIMIT 1`,
);

/** La última expedición terminada de esa mazmorra. */
export function ultimaExpedicion(
  trainerId: number,
  dungeonKey: string,
): { estado: EstadoExpedicion; finishedAt: string } | null {
  const fila = SELECT_LOG.get(trainerId, dungeonKey);
  if (!fila) return null;

  return { estado: fila.status as EstadoExpedicion, finishedAt: fila.finished_at };
}

/** Escribe el historial. Se llama al cerrar. */
export function registrarExpedicion(
  trainerId: number,
  resumen: {
    dungeonKey: string;
    estado: EstadoExpedicion;
    pisosAlcanzados: number;
    casillasVisitadas: number;
    casillasTotales: number;
    combates: number;
    minijefes: number;
    cofres: number;
    eventos: number;
    duracionSeg: number;
    digibytes: number;
    botin: { key: string; cantidad: number }[];
  },
): void {
  db.prepare(
    `INSERT INTO dungeon_expedition_log
       (trainer_id, dungeon_key, status, pisos_alcanzados, casillas_visitadas,
        casillas_totales, combates, minijefes, cofres, eventos, duracion_seg,
        digibytes, botin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    trainerId,
    resumen.dungeonKey,
    resumen.estado,
    resumen.pisosAlcanzados,
    resumen.casillasVisitadas,
    resumen.casillasTotales,
    resumen.combates,
    resumen.minijefes,
    resumen.cofres,
    resumen.eventos,
    resumen.duracionSeg,
    resumen.digibytes,
    JSON.stringify(resumen.botin),
  );
}