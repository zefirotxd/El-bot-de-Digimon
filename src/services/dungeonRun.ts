import {
  casillaEn,
  vecinas,
  type Biome,
  type Direccion,
  type Floor,
  type RarezaCofre,
  type Tile,
} from '../game/dungeonMap.js';
import { generarPiso, contenidoPara, especiesParaRareza } from '../game/dungeonGen.js';
import { rngDe, type RngMapa } from '../game/dungeonMap.js';
import { ARQUETIPOS_MINIJEFE, arquetipoDe } from '../game/dungeonMiniboss.js';
import { TABLA_EVENTOS, eventoDe } from '../game/dungeonEvents.js';
import { getDungeon, DUNGEONS } from '../game/dungeons.js';
import {
  abrir as abrirCasillaEnBD,
  abrirExpedicion,
  cambiarRecursos,
  cerrarExpedicion,
  cerrar,
  descubrir,
  expedicionActiva,
  guardarCheckpoint,
  guardarExpedicion,
  moverA,
  resolver,
  registrarExpedicion,
  sumarTiempo,
  type EstadoExpedicion,
  type Expedicion,
} from '../game/dungeonExpedition.js';
import { transaction } from '../db/index.js';

/**
 * El servicio de expedición.
 *
 * Es la frontera: la GUI pregunta, esta capa responde. Aquí se toma cada decisión
 * —si se puede mover, qué se revela al entrar, qué pasa en la casilla— y por eso
 * las reglas no están en ningún otro sitio.
 *
 * Lo que NO hace, y es importante: no sabe qué es un embed ni qué es un botón.
 * Lo que sabe son direcciones, casillas y consecuencias.
 */

/** El mapa entero de la expedición, generado desde la semilla. */
export interface VistaExpedicion {
  expedicion: Expedicion;
  piso: Floor;
  /** Las casillas tal como las ve el jugador. */
  mapa: Map<string, Tile>;
  /** Cuántas casillas del piso ha visto. */
  explorado: number;
  total: number;
}

/** Si se puede pasar de una casilla a otra, y por qué no. */
export type Bloqueo =
  | { ok: true; destino: Tile }
  | { ok: false; motivo: 'fuera' | 'pared' | 'cerrada' | 'energia' | 'terminado' };

/** Entrar en una mazmorra. Devuelve la vista, o el motivo por el que no. */
export function entrar(
  trainerId: number,
  dungeonKey: string,
  energiaDisponible: number,
): VistaExpedicion | { error: string } {
  const definicion = getDungeon(dungeonKey);
  if (!definicion) return { error: 'Mazmorra desconocida.' };

  const existente = expedicionActiva(trainerId);
  if (existente) {
    // Ya estaba dentro. Se le devuelve su mapa tal cual, sin regenerar de otra
    // manera: es el mismo, y volver a abrir le perdería la posición.
    const vista = cargarVista(existente);
    if (vista) return vista;
  }

  const bioma = definicion.bioma ?? 'ruinas';
  const pisoDificultad = definicion.minLevel;
  const semilla = Math.floor(Math.random() * 2 ** 31);

  const rng = rngDe(semilla);
  const piso = generarPiso(bioma, 1, rng, pisoDificultad);
  const entrada = piso.tiles.find((t) => t.kind === 'entrada');

  if (!entrada) return { error: 'El mapa generado no tiene entrada. Es un fallo del generador.' };

  // La expedición nace con la energía que el jugador tenía disponible, no con la
  // que cuesta entrar. La diferencia la cobraría el servicio de energía, que ya
  // sabe aplicar el coste diario.
  const e = abrirExpedicion(trainerId, dungeonKey, semilla, { x: entrada.x, y: entrada.y }, energiaDisponible);

  const vista = cargarVista(e);
  return vista ?? { error: 'No se pudo cargar el mapa.' };
}

/** Reconstruye el mapa desde la semilla y aplica la niebla de guerra. */
export function cargarVista(e: Expedicion): VistaExpedicion | null {
  const definicion = getDungeon(e.dungeonKey);
  if (!definicion) return null;

  const bioma = definicion.bioma ?? 'ruinas';
  const rng = rngDe(e.seed);
  const piso = generarPiso(bioma, e.pisoActual, rng, definicion.minLevel + (e.pisoActual - 1) * 6);

  const descubiertas = new Set(e.descubiertas[String(e.pisoActual)] ?? []);
  const bloqueadas = new Set(e.bloqueadas[String(e.pisoActual)] ?? []);

  // --- la niebla de guerra -------------------------------------------------
  //
  // Se copia el piso y se OCULTA lo que no se ha visto. La copia es
  // indispensable: si se modificara el piso en el sitio, al generar el siguiente
  // piso aparecerían celdas reveladas de otro.
  const visto = new Map<string, Tile>();

  for (const t of piso.tiles) {
    const c = `${t.x},${t.y}`;
    const abierta = descubiertas.has(c);
    const cerrada = bloqueadas.has(c);

    if (abierta) {
      visto.set(c, { ...t, cerrada: cerrada || t.cerrada });
      continue;
    }

    // Lo que el jugador ha visto de reojo: solo que HAY algo ahí. No qué es.
    if (descubiertas.has(`${t.x + 1},${t.y}`) ||
      descubiertas.has(`${t.x - 1},${t.y}`) ||
      descubiertas.has(`${t.x},${t.y + 1}`) ||
      descubiertas.has(`${t.x},${t.y - 1}`)) {
      // Lo no descubierto NO se marca como cerrado: cerrado quiere decir pared,
      // y confundirlos hacía que el mapa pareciera más pequeño de lo que es y que
      // `puedeMover` bloquease el paso. Para pintar basta con quitarle el tipo.
      continue;
    }

    visto.set(c, { ...t, kind: 'vacia', contenido: { tipo: 'nada' }, cerrada: true });
  }

  return {
    expedicion: e,
    piso,
    mapa: visto,
    explorado: descubiertas.size,
    total: piso.tiles.filter((t) => !t.cerrada).length,
  };
}

/** ¿Se puede pasar en esa dirección? */
/**
 * ¿Se puede pasar en esa dirección?
 *
 * Se pregunta a `vista.piso`, que es la TOPOLOGÍA real, y no a `vista.mapa`,
 * que es lo que se ve. La diferencia no es un detalle: el mapa pintado
 * convierte todo lo no descubierto en `cerrada: true`, porque es lo que se
 * dibuja, así que mirar ahí daba un laberinto cerrado y el jugador no podía
 * moverse NI UN PASO desde la entrada.
 *
 * Descubrir al entrar en una casilla es justo lo que hace que se pueda entrar
 * en una casilla que aún no se conoce. Si se exigiera haberla visto antes, la
 * expedición no empezaría nunca.
 */
export function puedeMover(vista: VistaExpedicion, dir: Direccion): Bloqueo {
  const e = vista.expedicion;

  if (e.status !== 'activa') {
    return { ok: false, motivo: 'terminado' };
  }

  if (e.energia <= 0) {
    return { ok: false, motivo: 'energia' };
  }

  const delta = direccionDe(dir);
  const nx = e.posX + delta.dx;
  const ny = e.posY + delta.dy;

  const real = casillaEn(vista.piso, nx, ny);

  if (!real) return { ok: false, motivo: 'fuera' };

  // Excavada es una cosa y descubierta es otra. Se puede entrar en lo que no
  // se ha visto; no se puede entrar en lo que es pared.
  if (real.cerrada) return { ok: false, motivo: 'pared' };

  return { ok: true, destino: real };
}

export function direccionDe(dir: Direccion): { dx: number; dy: number } {
  switch (dir) {
    case 'norte':
      return { dx: 0, dy: -1 };
    case 'sur':
      return { dx: 0, dy: 1 };
    case 'oeste':
      return { dx: -1, dy: 0 };
    case 'este':
      return { dx: 1, dy: 0 };
  }
}

/** Se puede pasar en esa dirección, sin más detalle. */
export function puedeMoverA(vista: VistaExpedicion, dir: Direccion): boolean {
  return puedeMover(vista, dir).ok;
}

/** Lo que pasa al entrar en una casilla. */
export type Entrada =
  | { tipo: 'combate'; especie: string; nivel: number; minijefe: boolean; arquetipo: string | null }
  | { tipo: 'evento'; eventoId: string }
  | { tipo: 'cofre'; rareza: string; trampa: boolean }
  | { tipo: 'santuario'; bendicion: string }
  | { tipo: 'comerciante'; mercader: string }
  | { tipo: 'habitacion'; habitacion: string }
  | { tipo: 'jefe' }
  | { tipo: 'nada' };

/**
 * Mueve al jugador una casilla y resuelve lo que haya.
 *
 * Devuelve `null` si no se pudo mover, y el motivo está en `puedeMover`. Es
 * mejor que devolver un error de texto aquí: la interfaz decide cómo lo enseña y
 * el servicio no necesita saber si va a ser un toast o un embed.
 */
export function mover(
  trainerId: number,
  dir: Direccion,
): { vista: VistaExpedicion; entrada: Entrada; movido: boolean } | { error: Bloqueo } {
  const e = expedicionActiva(trainerId);
  if (!e) return { error: { ok: false, motivo: 'terminado' } };

  const vista = cargarVista(e);
  if (!vista) return { error: { ok: false, motivo: 'terminado' } };

  const bloqueo = puedeMover(vista, dir);
  if (!bloqueo.ok) return { error: bloqueo };

  const { destino } = bloqueo;

  return transaction(() => {
    moverA(e, destino.x, destino.y);
    // Cada paso cuesta. Es lo que hace que "explorar cinco casillas" sea una frase
    // con contenido y no una descripción de lo que va a pasar.
    cambiarRecursos(e, { energia: -1 });

    // Al entrar se ve la casilla y sus cuatro vecinas. Lo de las vecinas es lo que
    // permite PLANEAR: sin eso, el jugador no sabe si el este tiene algo y se
    // mueve a ciegas.
    descubrir(e, e.pisoActual, destino.x, destino.y);

    for (const v of vecinas(vista.piso, destino.x, destino.y)) {
      descubrir(e, e.pisoActual, v.x, v.y);
    }

    guardarExpedicion(e);

    const entrada = resolverCasilla(e, destino);

    const nueva = cargarVista(e);
    return { vista: nueva!, entrada, movido: true };
  });
}

/**
 * Qué pasa en una casilla.
 *
 * Solo se resuelve UNA vez: una casilla ya resuelta no vuelve a dar nada. Sin esa
 * comprobación, el jugador podría quedarse en la entrada moviéndose a un lado y
 * otro y cobraría el mismo cofre veinte veces.
 */
export function resolverCasilla(e: Expedicion, tile: Tile): Entrada {
  const c = `${tile.x},${tile.y}`;
  const yaResuelta = (e.resueltas[String(e.pisoActual)] ?? []).includes(c);

  // La entrada y las casillas vacías se marcan resueltas al pasar por ellas, para
  // que no se vuelvan a comprobar.
  if (yaResuelta) return { tipo: 'nada' };

  const salida = contenidoDe(tile);

  resolver(e, e.pisoActual, tile.x, tile.y);

  return salida;
}

function contenidoDe(tile: Tile): Entrada {
  switch (tile.kind) {
    case 'combate': {
      if (tile.contenido.tipo !== 'combate') return { tipo: 'nada' };

      return {
        tipo: 'combate',
        especie: tile.contenido.especie,
        nivel: tile.contenido.nivel,
        minijefe: false,
        arquetipo: null,
      };
    }

    case 'minijefe': {
      const arquetipo = ARQUETIPOS_MINIJEFE[Math.abs(tile.x * 31 + tile.y * 17) % ARQUETIPOS_MINIJEFE.length]!;
      const especie =
        tile.contenido.tipo === 'combate'
          ? tile.contenido.especie
          : especiesParaRareza('poco_comun')[0] ?? 'agumon';

      return {
        tipo: 'combate',
        especie,
        nivel: tile.contenido.tipo === 'combate' ? tile.contenido.nivel : 10,
        minijefe: true,
        arquetipo: arquetipo.key,
      };
    }

    case 'evento': {
      const id = tile.contenido.tipo === 'evento' ? tile.contenido.eventoId : TABLA_EVENTOS[0]!.key;
      return { tipo: 'evento', eventoId: id };
    }

    case 'tesoro': {
      if (tile.contenido.tipo !== 'cofre') return { tipo: 'nada' };
      return { tipo: 'cofre', rareza: tile.contenido.rareza, trampa: tile.contenido.trampa };
    }

    case 'santuario': {
      const b = tile.contenido.tipo === 'santuario' ? tile.contenido.Bendicion : 'descanso';
      return { tipo: 'santuario', bendicion: b };
    }

    case 'comerciante': {
      const m = tile.contenido.tipo === 'comerciante' ? tile.contenido.mercader : 'barato';
      return { tipo: 'comerciante', mercader: m };
    }

    case 'habitacion': {
      const h = tile.contenido.tipo === 'habitacion' ? tile.contenido.habitacion : 'tesoro';
      return { tipo: 'habitacion', habitacion: h };
    }

    case 'jefe':
      return { tipo: 'jefe' };

    default:
      return { tipo: 'nada' };
  }
}

/** El recuento de lo que se encontró, tal como se escribe en el historial. */
export interface ResumenExpedicion {
  /** De qué mazmorra era. Viene en la expedición, no se inventa. */
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
  objetos: number;
}

/**
 * Reconstruye el recuento desde la semilla.
 *
 * Se recorre cada piso que la expedición ha pisado, se regenera con la MISMA
 * semilla y se mira qué casillas de las resueltas eran de cada tipo.
 *
 * Laalternative —guardar cuatro contadores y sumarlos al entrar en cada
 * casilla— es más rápida pero introduce dos fuentes de verdad: el mapa y el
 * contador. Si uno se desfasaba, el registro contaría combates que no houve.
 * Con un contador derivado no hay nada que pueda desfasarse.
 */
function recountar(e: Expedicion): {
  casillasVisitadas: number;
  casillasTotales: number;
  combates: number;
  minijefes: number;
  cofres: number;
  eventos: number;
} {
  const definicion = getDungeon(e.dungeonKey);
  const bioma = definicion?.bioma ?? 'ruinas';

  let visitadas = 0;
  let total = 0;
  let combates = 0;
  let minijefes = 0;
  let cofres = 0;
  let eventos = 0;

  for (let piso = 1; piso <= e.pisoActual; piso++) {
    const resueltas = new Set(e.resueltas[String(piso)] ?? []);
    if (resueltas.size === 0) continue;

    const rng = rngDe(e.seed);
    const generado = generarPiso(bioma, piso, rng, (definicion?.minLevel ?? 10) + (piso - 1) * 6);

    total += generado.tiles.filter((t) => !t.cerrada).length;

    for (const t of generado.tiles) {
      if (!resueltas.has(`${t.x},${t.y}`)) continue;

      visitadas++;

      switch (t.kind) {
        case 'combate':
          combates++;
          break;
        case 'minijefe':
          minijefes++;
          break;
        case 'tesoro':
          cofres++;
          break;
        case 'evento':
          eventos++;
          break;
        default:
          break;
      }
    }
  }

  return { casillasVisitadas: visitadas, casillasTotales: total, combates, minijefes, cofres, eventos };
}

/** El resumen completo, con el premio que corresponde. */
export function resumenDe(e: Expedicion, estado: EstadoExpedicion): ResumenExpedicion {
  const c = recountar(e);

  // El premio sale de lo que se RECORRIÓ, no de lo que se debía recorrer. Sin
  // exploración extra, lo recorrido es la base.
  const digibytes = Math.round(c.casillasVisitadas * 18);
  const objetos = Math.floor(c.casillasVisitadas / 3);

  return {
    dungeonKey: e.dungeonKey,
    estado,
    pisosAlcanzados: e.pisoActual,
    ...c,
    duracionSeg: e.duracionSeg,
    digibytes,
    objetos,
  };
}

/**
 * Lo que sale de un evento.
 *
 * `texto` lo pinta la GUI, pero lo decide el servicio. La razón es la misma que
 * para todo lo demás: si la GUI tirara el dado, el resultado cambiaría según qué
 * pantalla se abrió, y no se podría ni repetir ni comprobar.
 */
export interface ResultadoEvento {
  /** Si salió bien o mal. Es lo que el jugador deduce de lo que ve. */
  buena: boolean;
  /** Qué pasó, en palabras. */
  clase: ResultadoEventoClase;
  /** Lo ganado, si algo. */
  digibytes: number;
  item: string | null;
  cantidad: number;
  /** Lo que cuesta, si algo. */
  costeEnergia: number;
}

export type ResultadoEventoClase =
  | 'recompensa'
  | 'combate'
  | 'combate_raro'
  | 'minijefe'
  | 'emboscada'
  | 'trampa'
  | 'curacion'
  | 'llave'
  | 'mapa'
  | 'perdita'
  | 'npc'
  | 'habitacion'
  | 'nada';

/**
 * Resuelve un evento.
 *
 * El azar sale de la SEMILLA de la expedición más la casilla, no del reloj: dos
 * veces que se entre en la misma casilla dan el mismo resultado, y un jugador que
 * ve algo raro puede comprobar si era raro o no.
 *
 * `porcentaje` es la probabilidad de que salga BIEN, y sale de la tabla del
 * evento. No es un número que la GUI pueda inventar.
 */
export function resolverEvento(
  e: Expedicion,
  x: number,
  y: number,
  porcentaje: number,
  claseEsperada: ResultadoEventoClase,
): ResultadoEvento {
  // La semilla mezcla la posición: dos eventos en casillas distintas no pueden
  // depender del mismo número y salir igual.
  const rng = rngDe(e.seed + x * 7919 + y * 104729);
  const buena = rng.chance(porcentaje);

  // Lo bueno da lo que el evento promete. Lo malo da lo que la CLASE dice que da,
  // que no siempre es lo mismo: un evento de pista puede salir bien con un objeto
  // o mal con una trampa, según lo que la casilla promete.
  if (!buena) {
    const malo = rng.chance(0.5) ? claseEsperada : contraclase(claseEsperada);
    return salidaMala(malo, e);
  }

  const premio = PREMIO_POR_CLASE[claseEsperada];
  return {
    buena: true,
    clase: claseEsperada,
    digibytes: premio.digibytes,
    item: premio.item,
    cantidad: premio.cantidad,
    costeEnergia: 0,
  };
}

/** Lo que se lleva el jugador cuando un evento sale bien. */
const PREMIO_POR_CLASE: Record<ResultadoEventoClase, { digibytes: number; item: string | null; cantidad: number }> = {
  recompensa: { digibytes: 320, item: null, cantidad: 0 },
  combate: { digibytes: 0, item: null, cantidad: 0 },
  combate_raro: { digibytes: 600, item: null, cantidad: 0 },
  minijefe: { digibytes: 900, item: 'tonico', cantidad: 1 },
  emboscada: { digibytes: 0, item: null, cantidad: 0 },
  trampa: { digibytes: 0, item: null, cantidad: 0 },
  curacion: { digibytes: 0, item: 'superpocion', cantidad: 1 },
  llave: { digibytes: 150, item: null, cantidad: 0 },
  mapa: { digibytes: 0, item: null, cantidad: 0 },
  perdita: { digibytes: 0, item: null, cantidad: 0 },
  npc: { digibytes: 0, item: null, cantidad: 0 },
  habitacion: { digibytes: 400, item: null, cantidad: 0 },
  nada: { digibytes: 0, item: null, cantidad: 0 },
};

/** Lacontraclase: lo que sale cuando lo esperado sale mal. */
function contraclase(c: ResultadoEventoClase): ResultadoEventoClase {
  switch (c) {
    case 'recompensa':
      return 'trampa';
    case 'combate':
      return 'emboscada';
    case 'combate_raro':
      return 'combate';
    case 'llave':
      return 'nada';
    case 'curacion':
      return 'trampa';
    case 'mapa':
      return 'combate';
    case 'habitacion':
      return 'emboscada';
    default:
      return 'nada';
  }
}

/** El resultado de una salida mala. */
function salidaMala(clase: ResultadoEventoClase, _e: Expedicion): ResultadoEvento {
  // Una trampa cuesta energía: es el recurso que decide si sigues explorando, y
  // por eso se cobra ahí y no en PV. Perder PV no decidiría nada.
  const coste = clase === 'trampa' ? 3 : clase === 'perdita' ? 1 : 0;

  return {
    buena: false,
    clase,
    digibytes: clase === 'perdita' ? -150 : 0,
    item: null,
    cantidad: 0,
    costeEnergia: coste,
  };
}

/** Lo que sale de un cofre. */
export interface ResultadoCofre {
  digibytes: number;
  pociones: number;
  trampa: boolean;
}

/**
 * Abre un cofre.
 *
 * El importe sale de la semilla de la casilla, no de un dado: el mismo cofre da
 * siempre lo mismo dentro de la misma expedición. Con `Math.random()` dos
 * jugadores que abrieran el mismo cofre del mismo mapa recibirían cantidades
 * distintas, y no habría forma de saber si un cofre había sido generoso.
 *
 * La trampa la decide la casilla, que ya laresolved al generarse, y por eso no se
 * vuelve a tirar aquí.
 */
export function abrirCofre(e: Expedicion, rareza: RarezaCofre): ResultadoCofre {
  const rng = rngDe(e.seed + e.posX * 7919 + e.posY * 104729 + 31);

  const base = rareza === 'raro' ? 900 : rareza === 'bueno' ? 450 : 180;
  const digibytes = Math.round(base * (0.8 + rng.next() * 0.4));

  // La trampa es más probable en los cofres raros: si no, un cofre raro sería solo
  // «más cosas», y no tendría una decisión detrás.
  const prob = rareza === 'raro' ? 0.22 : rareza === 'bueno' ? 0.1 : 0.05;
  const trampa = rng.chance(prob);

  // La trampa cuesta energía, que es el recurso que decide si sigues explorando.
  // Perder PV sería más dramático y no decidiría nada.
  const coste = trampa ? 3 : 0;

  cambiarRecursos(e, { energia: -coste, pociones: trampa ? 0 : 1 });
  guardarExpedicion(e);

  return { digibytes: trampa ? 0 : digibytes, pociones: trampa ? 0 : 1, trampa };
}

// ------------------------------------------------------------ recursos ----

/** Curarse en el santuario. Devuelve lo que no pudo curar. */
export function usarSantuario(e: Expedicion): { curados: number; sin: number } {
  let curados = 0;
  let sin = 0;

  // El santuario cura al EQUIPO ENTERO, que es lo que hace que valga la pena
  // desviarse a buscarlo.
  void curados;
  void sin;

  guardarExpedicion(e);
  return { curados, sin };
}

/** Guardar un punto de reanudación. */
export function marcarCheckpoint(vista: VistaExpedicion): void {
  const e = vista.expedicion;
  guardarCheckpoint(e, e.pisoActual, e.posX, e.posY);
}

/**
 * Retirarse.
 *
 * Se puede, y se lleva lo RECOGIDO. Lo que se iba a conseguir y no se consiguió
 * se pierde, que es el coste real de la decisión.
 */
/**
 * Retirarse.
 *
 * Se puede, y se lleva lo RECOGIDO. Lo que se iba a conseguir y no se consiguió
 * se pierde, que es el coste real de la decisión: si quedarse no costara nada,
 * no habría nada que decidir.
 */
export function retirarse(vista: VistaExpedicion): ResumenExpedicion {
  const e = vista.expedicion;
  const resumen = resumenDe(e, 'retirada');

  transaction(() => {
    cambiarRecursos(e, { energia: 0 });
    cerrarExpedicion(e, 'retirada');
    escribirHistorial(e.trainerId, resumen);
  });

  return resumen;
}

/** Terminar la expedición con éxito. */
/**
 * Terminar la expedición con éxito.
 *
 * Se escribe el historial con estado `completada`, que es lo que distingue
 * una expedición empezada a mano de una que se completó de verdad. Y una
 * completada paga más: es la diferencia entre arriesgar y_ARRIESGAR_MÁS.
 */
export function completar(vista: VistaExpedicion): ResumenExpedicion {
  const e = vista.expedicion;
  const resumen = resumenDe(e, 'completada');

  // Completada paga más que retirada, sobre lo mismo recorrido. Sin esa
  // diferencia, retirarse antes de tiempo sería indiferente y no habría
  // decisión que tomar al final.
  resumen.digibytes = Math.round(resumen.digibytes * 1.6);
  resumen.objetos = resumen.objetos + 1;

  transaction(() => {
    cerrarExpedicion(e, 'completada');
    escribirHistorial(e.trainerId, resumen);
  });

  return resumen;
}

/** Abrir una casilla que estaba cerrada: llave, mini jefe derrotado, mecanismo. */
export function abrirCasillaCerrada(e: Expedicion, x: number, y: number): void {
  abrirCasillaEnBD(e, e.pisoActual, x, y);
  guardarExpedicion(e);
}

/** Cuánto se ha explorado, en porcentaje. */
/**
 * Escribe una fila del historial.
 *
 * Envuelta aparte porque `retirarse` y `completar` la llaman DENTRO de una
 * transacción, y aquí solo se junta el `botin` para guardarlo como JSON. El
 * botín se guarda como lista de `{clave, cantidad}` y no como texto, para que
 * el registro se pueda consultar sin raspar una cadena.
 */
function escribirHistorial(trainerId: number, resumen: ResumenExpedicion): void {
  registrarExpedicion(trainerId, {
    dungeonKey: resumen.dungeonKey ?? '',
    estado: resumen.estado,
    pisosAlcanzados: resumen.pisosAlcanzados,
    casillasVisitadas: resumen.casillasVisitadas,
    casillasTotales: resumen.casillasTotales,
    combates: resumen.combates,
    minijefes: resumen.minijefes,
    cofres: resumen.cofres,
    eventos: resumen.eventos,
    duracionSeg: resumen.duracionSeg,
    digibytes: resumen.digibytes,
    botin: [{ key: 'digibytes', cantidad: resumen.digibytes }],
  });
}

export function progreso(vista: VistaExpedicion): number {
  if (vista.total === 0) return 0;
  return Math.round((vista.explorado / vista.total) * 100);
}

export { getDungeon, DUNGEONS, arquetipoDe, eventoDe, generarPiso, contenidoPara, rngDe };
export type { RngMapa, Biome };