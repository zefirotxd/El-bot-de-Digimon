import type { Attribute, Element } from './types.js';
import { getSpecies } from './species.js';

/**
 * Generación de mazmorras por casillas.
 *
 * Módulo PURO: no sabe nada de la base de datos, de Discord ni del jugador. Toma
 * una semilla y devuelve un mapa. Eso es lo que hace que una expedición sea
 * reproducible —el mismo `seed` da el mismo mapa— y que el mapa se pueda testear
 * sin montar una expedición entera.
 *
 * La regla que gobierna todo lo demás es la del punto 7 del encargo: **no hay
 * mapas imposibles**. Ni la entrada inalcanzable, ni el jefe inalcanzable, ni
 * una recompensa importante detrás de un mini jefe que no se puede derrotar, ni
 * una llave que caiga en una isla sin salida. Un mapa generationndo al azar
 * convierte esos casos en ocurrencias de vez en cuando, y una expedición de cuarenta
 * minutos que se pierde por un detalle del generador es la peor forma de
 * perder cuarenta minutos.
 *
 * Por eso el generador NO tira al azar y ya: construye primero un CAMINO
 * garantizado de la entrada al jefe, y luego cuelga el resto del mapa de ese
 * camino. Lo que se sortea es lo que CUERGA, nunca si se llega.
 */

/** Los tipos de casilla. Cada uno decide qué pasa al entrar. */
export type TileKind =
  /** Punto de entrada. También sirve como punto de vuelta. */
  | 'entrada'
  /** Encuentro normal. */
  | 'combate'
  /** Evento aleatorio de la tabla. */
  | 'evento'
  /** Enemigo especial con arquetipo propio. */
  | 'minijefe'
  /** El jefe. normalmente al final del piso. */
  | 'jefe'
  /** Cofre. A veces trampa. */
  | 'tesoro'
  /** Punto de descanso y curarte. */
  | 'santuario'
  /** NPC con inventario propio de esta expedición. */
  | 'comerciante'
  /** Nada. Puede esconder algo. */
  | 'vacia'
  /** Puerta a una habitación con su propia pantalla. */
  | 'habitacion';

/** Lo que hay DENTRO de una casilla. Lo decide la semilla. */
export type TileContent =
  | { tipo: 'combate'; especie: string; nivel: number; Rareza: RarezaEncuentro }
  | { tipo: 'grupo'; especies: string[]; nivel: number }
  | { tipo: 'evento'; eventoId: string }
  | { tipo: 'cofre'; rareza: RarezaCofre; trampa: boolean }
  | { tipo: 'santuario'; Bendicion: string }
  | { tipo: 'comerciante'; mercader: string }
  | { tipo: 'habitacion'; habitacion: TipoHabitacion }
  | { tipo: 'nada' };

export type RarezaEncuentro = 'comun' | 'poco_comun' | 'raro' | 'mitico';
export type RarezaCofre = 'normal' | 'bueno' | 'raro';
export type TipoHabitacion =
  | 'tesoro'
  | 'santuario'
  | 'arena'
  | 'puzzle'
  | 'npc'
  | 'jefe';

/**
 * Un arquetipo de mini jefe.
 *
 * No es "un Digimon con más vida". Cada arquetipo cambia CÓMO se pelea, que es lo
 * que hace que el jugador tenga que COMPRENDERLO y no solo aguantarlo. Y usa el
 * motor de las fases que ya existe, así que no es contenido nuevo sino contenido
 * con forma.
 */
export interface ArquetipoMinijefe {
  key: string;
  nombre: string;
  descripcion: string;
  emoji: string;
  /** PV extra sobre la especie base. */
  vidaExtra: number;
  /** Atributo al que se inclina, para que el jugador tenga que pensar. */
  atributo: Attribute | 'variable';
  /** Fase 2: se protege. */
  escudoFase2?: boolean;
  /** Fase 3: invoca un auxiliar. */
  invocaAuxiliar?: boolean;
  /** Cambia de atributo cada N turnos. */
  rotaAtributo?: number;
/**
 * Las mecánicas que este arquetipo usa, por nombre.
 *
 * Antes solo estaban en el `descripcion`, y dos arquetipos —el Devorador y
 * el Reflejo— describían algo que el dato NO PUEDÍA expresar. El motor no tenía
 * forma de saber que aquel enemigo se curaba con cada golpe, así que el texto
 * prometía una mecánica que nadie había implementado.
 *
 * Con la lista, cada mecánica es un dato comprobable: si el motor no sabe
 * aplicar una, se ve en el tipo en vez de descubrirse en la pelea.
 */
mecanicas: string[];

  /** Golpes cargados: se anuncia y hay que responder. */
  telegrafiado?: boolean;
}

/** Una casilla. */
export interface Tile {
  x: number;
  y: number;
  kind: TileKind;
  contenido: TileContent;
  /**
   * Si es `true`, hay un bloqueo entre esta casilla y sus vecinas.
   *
   * Se usa para las puertas con llave y para lo que se abre al derrotar a un
   * mini jefe. Vive en la casilla DESTINO, y no en un objeto aparte, porque
   * "esto está cerrado" es una propiedad de la casilla y no del mundo.
   */
  cerrada: boolean;
  /** Si la casilla se ve desde una vecina ya visitada. Para la niebla de guerra. */
  revelada: boolean;
}

/** Un piso entero. */
export interface Floor {
  indice: number;
  /** Bioma de este piso. Cambia la tabla de encuentros y los peligros. */
  bioma: Biome;
  tiles: Tile[];
  /** Dimensiones del piso. */
  ancho: number;
  alto: number;
  /** Casillas por las que se puede andar. */
  transitables: number;
}

/** Los tipos de mazmorra. Cada uno cambia cómo se juega, no solo el decorado. */
export type Biome =
  | 'ruinas'
  | 'bosque'
  | 'volcan'
  | 'congelada'
  | 'vacio_digital'
  | 'raid';

/** Qué mezcla cada bioma. */
export interface PerfilBiome {
  key: Biome;
  nombre: string;
  emoji: string;
  /** Cuántos enemy's salvajes por casilla de combate. */
  encontrarse: number;
  /** Tipos de casilla que pone, con su peso. */
  mezcla: { kind: TileKind; peso: number }[];
  /** Rarezas y su peso. */
  rarezas: { rareza: RarezaEncuentro; peso: number }[];
  /** Daño por turno alDigimon mientras está en el bioma. 0 = ninguno. */
  peligros?: { etiqueta: string; porTurno: number; estado?: 'quemadura' | 'congelado' | 'veneno' };
  /** Qué bendiciones dan los santuarios. */
  santuarios: string[];
}

export const BIOMES: Record<Biome, PerfilBiome> = {
  ruinas: {
    key: 'ruinas',
    nombre: 'Ruinas',
    emoji: '🏰',
    encontrarse: 1,
    mezcla: [
      { kind: 'combate', peso: 34 },
      { kind: 'vacia', peso: 20 },
      { kind: 'tesoro', peso: 12 },
      { kind: 'evento', peso: 12 },
      { kind: 'santuario', peso: 8 },
      { kind: 'habitacion', peso: 8 },
      { kind: 'minijefe', peso: 3 },
      { kind: 'comerciante', peso: 3 },
    ],
    rarezas: [
      { rareza: 'comun', peso: 70 },
      { rareza: 'poco_comun', peso: 24 },
      { rareza: 'raro', peso: 5 },
      { rareza: 'mitico', peso: 1 },
    ],
    santuarios: ['descanso', 'vendaje', 'limpieza', 'rescoldo'],
  },
  bosque: {
    key: 'bosque',
    nombre: 'Bosque',
    emoji: '🌲',
    encontrarse: 1,
    mezcla: [
      { kind: 'combate', peso: 38 },
      { kind: 'vacia', peso: 24 },
      { kind: 'evento', peso: 14 },
      { kind: 'tesoro', peso: 10 },
      { kind: 'santuario', peso: 8 },
      { kind: 'habitacion', peso: 6 },
      { kind: 'minijefe', peso: 2 },
      { kind: 'comerciante', peso: 2 },
    ],
    rarezas: [
      { rareza: 'comun', peso: 76 },
      { rareza: 'poco_comun', peso: 19 },
      { rareza: 'raro', peso: 4 },
      { rareza: 'mitico', peso: 1 },
    ],
    santuarios: ['descanso', 'bebida', 'vendaje'],
  },
  volcan: {
    key: 'volcan',
    nombre: 'Volcán',
    emoji: '🌋',
    encontrarse: 2,
    // Pocos santuarios y muchas trampas: la recarga es el recurso escaso.
    mezcla: [
      { kind: 'combate', peso: 42 },
      { kind: 'vacia', peso: 22 },
      { kind: 'tesoro', peso: 12 },
      { kind: 'evento', peso: 12 },
      { kind: 'habitacion', peso: 6 },
      { kind: 'santuario', peso: 4 },
      { kind: 'minijefe', peso: 3 },
      { kind: 'comerciante', peso: 2 },
    ],
    rarezas: [
      { rareza: 'comun', peso: 68 },
      { rareza: 'poco_comun', peso: 26 },
      { rareza: 'raro', peso: 5 },
      { rareza: 'mitico', peso: 1 },
    ],
    peligros: { etiqueta: 'Lava', porTurno: 8, estado: 'quemadura' },
    santuarios: ['descanso', 'frescura', 'vendaje', 'limpieza'],
  },
  congelada: {
    key: 'congelada',
    nombre: 'Zona congelada',
    emoji: '❄️',
    encontrarse: 1,
    mezcla: [
      { kind: 'combate', peso: 36 },
      { kind: 'vacia', peso: 22 },
      { kind: 'tesoro', peso: 12 },
      { kind: 'evento', peso: 14 },
      { kind: 'habitacion', peso: 8 },
      { kind: 'santuario', peso: 6 },
      { kind: 'minijefe', peso: 3 },
      { kind: 'comerciante', peso: 2 },
    ],
    rarezas: [
      { rareza: 'comun', peso: 72 },
      { rareza: 'poco_comun', peso: 22 },
      { rareza: 'raro', peso: 5 },
      { rareza: 'mitico', peso: 1 },
    ],
    peligros: { etiqueta: 'Hipotermia', porTurno: 6, estado: 'congelado' },
    santuarios: ['descanso', 'calor', 'vendaje', 'limpieza'],
  },
  vacio_digital: {
    key: 'vacio_digital',
    nombre: 'Vacío digital',
    emoji: '🌌',
    encontrarse: 2,
    // Impredecible: muchos eventos, muchas habitaciones, muchos raros.
    mezcla: [
      { kind: 'combate', peso: 28 },
      { kind: 'evento', peso: 22 },
      { kind: 'vacia', peso: 16 },
      { kind: 'habitacion', peso: 14 },
      { kind: 'tesoro', peso: 10 },
      { kind: 'santuario', peso: 5 },
      { kind: 'minijefe', peso: 4 },
      { kind: 'comerciante', peso: 1 },
    ],
    rarezas: [
      { rareza: 'comun', peso: 56 },
      { rareza: 'poco_comun', peso: 29 },
      { rareza: 'raro', peso: 12 },
      { rareza: 'mitico', peso: 3 },
    ],
    santuarios: ['descanso', 'vendaje', 'limpieza', 'fase'],
  },
  raid: {
    key: 'raid',
    nombre: 'Incursión',
    emoji: '👑',
    encontrarse: 3,
    mezcla: [
      { kind: 'combate', peso: 40 },
      { kind: 'evento', peso: 18 },
      { kind: 'tesoro', peso: 16 },
      { kind: 'vacia', peso: 12 },
      { kind: 'santuario', peso: 6 },
      { kind: 'habitacion', peso: 6 },
      { kind: 'minijefe', peso: 2 },
    ],
    rarezas: [
      { rareza: 'comun', peso: 60 },
      { rareza: 'poco_comun', peso: 28 },
      { rareza: 'raro', peso: 10 },
      { rareza: 'mitico', peso: 2 },
    ],
    santuarios: ['descanso', 'vendaje', 'fase'],
  },
};

// ------------------------------------------------------------ generador ----

/** Azar con estado, para que un `seed` dé siempre lo mismo. */
export interface RngMapa {
  next(): number;
  int(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: T[]): T;
  /** Elige según pesos. */
  pesado<T>(items: { valor: T; peso: number }[]): T;
}

/**
 * Un LCG. No es criptográfico y no pretende: solo tiene que ser determinista y
 * repartido, porque el mapa se regenera desde la semilla y tiene que coincidir.
 *
 * Se usa el mismo que el del combate (`game/random.ts`) a propósito: una sola
 * implementación de "azar con semilla" en todo el proyecto. Dos son dos, y el día
 * que se cambie uno el otro se queda atrás sin avisar.
 */
export function rngDe(seed: number): RngMapa {
  let estado = (seed >>> 0) || 1;

  const next = (): number => {
    estado = (estado * 1664525 + 1013904223) >>> 0;
    return estado / 4294967296;
  };

  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)]!,
    pesado: (items) => {
      const total = items.reduce((a, b) => a + b.peso, 0);
      let n = next() * total;
      for (const item of items) {
        n -= item.peso;
        if (n <= 0) return item.valor;
      }
      return items[items.length - 1]!.valor;
    },
  };
}

/** Las cuatro direcciones, en orden fijo para que el mapa sea estable. */
export const DIRECCIONES = [
  { dx: 0, dy: -1, nombre: 'norte' },
  { dx: -1, dy: 0, nombre: 'oeste' },
  { dx: 1, dy: 0, nombre: 'este' },
  { dx: 0, dy: 1, nombre: 'sur' },
] as const;

export type Direccion = (typeof DIRECCIONES)[number]['nombre'];

export function enRango(x: number, y: number, ancho: number, alto: number): boolean {
  return x >= 0 && y >= 0 && x < ancho && y < alto;
}

/** La casilla en esas coordenadas, si existe. */
export function casillaEn(piso: Floor, x: number, y: number): Tile | null {
  return piso.tiles.find((t) => t.x === x && t.y === y) ?? null;
}

/** Las vecinas transitables de una casilla. */
export function vecinas(piso: Floor, x: number, y: number): Tile[] {
  const salida: Tile[] = [];

  for (const d of DIRECCIONES) {
    const t = casillaEn(piso, x + d.dx, y + d.dy);
    if (t) salida.push(t);
  }

  return salida;
}

/**
 * El camino más corto entre dos casillas, andando.
 *
 * Devuelve `null` si no hay camino. Es la función que garantiza el punto 7 del
 * encargo, y se usa DESPUÉS de generar para comprobar que el mapa es jugable, no
 * para generarlo: así el generador puede meter lo que quiera en el mapa y aun
 * así se sabe que la entrada y el jefe conectan.
 */
export function camino(
  piso: Floor,
  desde: { x: number; y: number },
  hasta: { x: number; y: number },
  ignorarCerradas = false,
): { x: number; y: number }[] | null {
  const clave = (x: number, y: number) => `${x},${y}`;

  const cola: { x: number; y: number }[] = [desde];
  const vistos = new Set([clave(desde.x, desde.y)]);
  const previo = new Map<string, string | null>();
  previo.set(clave(desde.x, desde.y), null);

  while (cola.length > 0) {
    const actual = cola.shift()!;

    if (actual.x === hasta.x && actual.y === hasta.y) {
      const ruta: { x: number; y: number }[] = [];
      let k: string | null = clave(actual.x, actual.y);
      while (k !== null) {
        const [a, b] = k.split(',').map(Number);
        ruta.push({ x: a!, y: b! });
        k = previo.get(k) ?? null;
      }
      return ruta.reverse();
    }

    for (const v of vecinas(piso, actual.x, actual.y)) {
      const c = clave(v.x, v.y);
      if (vistos.has(c)) continue;
      // Se puede atravesar la entrada, el santuario y las ya abiertas. El resto
      // solo si no estamos respetando las cerraduras.
      const transitable =
        ignorarCerradas ||
        !v.cerrada ||
        v.kind === 'entrada' ||
        v.kind === 'santuario' ||
        v.kind === 'jefe';

      if (!transitable) continue;

      vistos.add(c);
      previo.set(c, clave(actual.x, actual.y));
      cola.push({ x: v.x, y: v.y });
    }
  }

  return null;
}

/** Todas las casillas alcanzables desde un punto. */
export function alcanzables(
  piso: Floor,
  desde: { x: number; y: number },
  ignorarCerradas = false,
): Set<string> {
  const clave = (x: number, y: number) => `${x},${y}`;
  const vistos = new Set([clave(desde.x, desde.y)]);
  const cola = [desde];

  while (cola.length > 0) {
    const a = cola.shift()!;

    for (const v of vecinas(piso, a.x, a.y)) {
      const c = clave(v.x, v.y);
      if (vistos.has(c)) continue;

      const transitable =
        ignorarCerradas || !v.cerrada || v.kind === 'entrada' || v.kind === 'santuario' || v.kind === 'jefe';

      if (!transitable) continue;

      vistos.add(c);
      cola.push({ x: v.x, y: v.y });
    }
  }

  return vistos;
}

/** Etiqueta corta de cada tipo, para el mapa. */
export const TILE_EMOJI: Record<TileKind, string> = {
  entrada: '🟢',
  combate: '🟨',
  evento: '🟦',
  minijefe: '🟥',
  jefe: '🟪',
  tesoro: '🟫',
  santuario: '⛩️',
  comerciante: '🧧',
  vacia: '⬜',
  habitacion: '🚪',
};

export const TILE_NOMBRE: Record<TileKind, string> = {
  entrada: 'Entrada',
  combate: 'Combate',
  evento: 'Evento',
  minijefe: 'Mini jefe',
  jefe: 'Jefe',
  tesoro: 'Tesoro',
  santuario: 'Santuario',
  comerciante: 'Comerciante',
  vacia: 'Vacía',
  habitacion: 'Habitación',
};

/**
 * Traduce un color de la carta de afinidades.
 *
 * Solo para el texto: la organización real del bioma la fija el equipo y no se
 * sorts. Va aquí porque la GUI necesita el nombre del elemento y no tiene por
 * qué importar el catálogo entero.
 */
export function elementoLegible(e: Element): string {
  const nombres: Record<Element, string> = {
    fuego: 'Fuego',
    hielo: 'Hielo',
    planta: 'Planta',
    agua: 'Agua',
    rayo: 'Rayo',
    metal: 'Metal',
    viento: 'Viento',
    tierra: 'Tierra',
    luz: 'Luz',
    oscuridad: 'Oscuridad',
    nulo: 'Neutro',
  };
  return nombres[e] ?? 'Neutro';
}

export { getSpecies };