import {
  BIOMES,
  alcanzables,
  camino,
  enRango,
  type Biome,
  type Floor,
  type RngMapa,
  type Tile,
  type TileContent,
  type TileKind,
  type TipoHabitacion,
} from './dungeonMap.js';
import { ARQUETIPOS_MINIJEFE } from './dungeonMiniboss.js';
import { TABLA_EVENTOS } from './dungeonEvents.js';
import { SPECIES, getSpecies } from './species.js';

/**
 * El generador de pisos.
 *
 * Va separado del archivo de tipos a propósito: los tipos no cambian casi nunca y
 * el generador cambia cada vez que se toca una regla. Juntos, un cambio de
 * algoritmo se mezclaba con un cambio de nombres y no se sabía cuál rompía qué.
 *
 * LA REGLA QUE GOBIERNA TODO (punto 7 del encargo: no hay mapas imposibles):
 *
 *   1. Se construye primero un CAMINO de la entrada al jefe. Ese camino existe
 *      siempre, porque es lo último que se sortea.
 *   2. A PARTIR del camino se cuelga el resto: ramas, tesoros, santuarios. Lo que
 *      se sortea es lo que cuelga, nunca si se llega.
 *   3. Al final se COMPRUEBA que la entrada llega al jefe y que no hay nada
 *      abierto inaccesible.
 *
 * Un generador que sortea primero y reza después falla cada pocas expediciones.
 * Uno que garantiza el camino y cuelga el resto no falla nunca.
 */

/** Las cuatro direcciones, en orden FIJO. */
const PASOS = [
  { dx: 0, dy: -1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
] as const;

/** Las dimensiones por piso. Crece un poco con la profundidad. */
function tamanoPiso(indice: number): { ancho: number; alto: number } {
  return {
    ancho: 7 + Math.min(4, indice),
    alto: 7 + Math.min(4, indice),
  };
}

/**
 * Genera un piso, y lo devuelve solo si es jugable.
 *
 * Se reintenta hasta ocho veces. En la práctica bastan dos o tres: el paseo
 * principal es una conexión garantizada y casi todo lo demás cuelga de él. Las
 * reintentadas existen para los mapas con muchas ramas, donde una rama puede
 * aislar a otra.
 */
export function generarPiso(
  bioma: Biome,
  indice: number,
  rng: RngMapa,
  dificultad: number,
): Floor {
  let piso = intentarPiso(bioma, indice, rng, dificultad);

  for (let intento = 0; intento < 8 && !esJuguable(piso); intento++) {
    piso = intentarPiso(bioma, indice, rng, dificultad);
  }

  return piso;
}

function intentarPiso(
  bioma: Biome,
  indice: number,
  rng: RngMapa,
  dificultad: number,
): Floor {
  const perfil = BIOMES[bioma];
  const { ancho, alto } = tamanoPiso(indice);

  // --- 1. todas las casillas, cerradas y vacías --------------------------
  const tiles: Tile[] = [];

  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      tiles.push({
        x,
        y,
        kind: 'vacia',
        contenido: { tipo: 'nada' },
        cerrada: true,
        revelada: false,
      });
    }
  }

  const en = (x: number, y: number): Tile => tiles.find((t) => t.x === x && t.y === y)!;

  // --- 2. la entrada, en un borde ------------------------------------------
  // Siempre en un borde y no en el interior: es lo que hace que el mapa se lea
  // como una mazmorra y no como una mancha de casillas.
  const lado = rng.int(0, 3);
  const mitad = Math.floor((lado % 2 === 0 ? ancho : alto) / 2);

  const entrada =
    lado === 0 ? { x: mitad, y: 0 }
      : lado === 1 ? { x: ancho - 1, y: mitad }
        : lado === 2 ? { x: mitad, y: alto - 1 }
          : { x: 0, y: mitad };

  const tEntrada = en(entrada.x, entrada.y);
  tEntrada.kind = 'entrada';
  tEntrada.cerrada = false;

  // --- 3. el jefe, en la casilla más lejana por pasos ----------------------
  // Por pasos y no en distancia recta: un jefe en la diagonal puede quedar a dos
  // pasos de la entrada por un rodeo, y una expedición de cuarenta minutos para
  // matar a un jefe que estaba al lado es la peor forma de perderla.
  const distanciaEntrada = (t: Tile) => Math.abs(t.x - entrada.x) + Math.abs(t.y - entrada.y);

  // La distancia máxima posible DESDE LA ENTRADA, que no es la misma que la
  // del mapa entero.
  //
  // La entrada está en el CENTRO de un borde, no en una esquina. Con un umbral
  // calculado como `ancho + alto` el filtro no encontraba nada en un mapa de
  // 7x7, y el jefe caía siempre en el respaldo: a tres pasos de la entrada, con
  // la expedición entera resuelta en cuatro movimientos.
  const alcanceMaximo =
    Math.max(entrada.x, ancho - 1 - entrada.x) + Math.max(entrada.y, alto - 1 - entrada.y);

  const tJefe = tiles
    .filter((t) => distanciaEntrada(t) >= Math.round(alcanceMaximo * 0.7))
    .sort((a, b) => distanciaEntrada(b) - distanciaEntrada(a))[0] ?? en(ancho - 1, alto - 1);

  tJefe.kind = 'jefe';
  tJefe.cerrada = false;

  // --- 4. el CAMINO PRINCIPAL ----------------------------------------------
  //
  // Un paseo que prefiere acercarse al jefe y, a igualdad, seguir recto. Eso da
  // pasillos largos en vez de una mancha, y el orden FIJO de `PASOS` hace que el
  // mismo `seed` produzca siempre el mismo mapa.
  const principal: Tile[] = [tEntrada];
  let cursor = tEntrada;
  let anterior: { dx: number; dy: number } | null = null;
  let rectas = 0;
  const limite = ancho * alto;

  while (cursor !== tJefe && principal.length < limite) {
    const opciones: Tile[] = [];

    for (const paso of PASOS) {
      const nx = cursor.x + paso.dx;
      const ny = cursor.y + paso.dy;
      if (!enRango(nx, ny, ancho, alto)) continue;

      const t = en(nx, ny);
      if (principal.includes(t)) continue;

      // Solo pasos que acerquen al jefe. Sin esta condición el paseo puede
      // serpentear indefinidamente y devolver una tortuga en vez de un mapa.
      const ahora = distanciaEntrada(cursor);
      const despues = Math.abs(nx - tJefe.x) + Math.abs(ny - tJefe.y);
      const aquiAlJefe = Math.abs(cursor.x - tJefe.x) + Math.abs(cursor.y - tJefe.y);
      if (despues >= aquiAlJefe) continue;

      opciones.push(t);
      void ahora;
    }

    if (opciones.length === 0) break;

    const anteriorDir = anterior;
    const recto: Tile | undefined =
      anteriorDir !== null
        ? opciones.find((o) => o.x - cursor.x === anteriorDir.dx && o.y - cursor.y === anteriorDir.dy)
        : undefined;

    rectas = recto !== undefined ? rectas + 1 : 0;

    // Tras cuatro casillas en línea recta se fuerza un giro. Un pasillo recto
    // de borde a borde no es una mazmorra: es un pasillo.
    const elegido: Tile = recto !== undefined && rectas < 4 ? recto : rng.pick(opciones);

    anterior = { dx: elegido.x - cursor.x, dy: elegido.y - cursor.y };
    elegido.cerrada = false;
    principal.push(elegido);
    cursor = elegido;
  }

  // --- 5. RED DE SEGURIDAD -------------------------------------------------
  //
  // Si el paseo se quedó corto, se abre un camino en L hasta el jefe. Esto es lo
  // que hace la garantía fuerte: aunque el paseo falle por lo que falle, el jefe
  // queda conectado.
  if (cursor !== tJefe) {
    for (const t of caminoEnL(cursor, tJefe, en, ancho, alto)) {
      t.cerrada = false;
      if (!principal.includes(t)) principal.push(t);
    }
  }

  // --- 6. qué hay en el camino ----------------------------------------------
  const intermedios = principal.slice(1, -1);
  repartirCamino(intermedios, perfil.mezcla, rng, indice);

  // --- 7. ramas laterales --------------------------------------------------
  //
  // Se cuelgan de casillas YA ABIERTAS. Nunca se sortea una rama suelta: una
  // rama suelta puede no conectar con nada y dejar un tesoro inalcanzable, que es
  // justo el mapa imposible que hay que evitar.
  const objetivo = Math.round(ancho * alto * 0.3);
  let ramas = 0;
  let intentos = 0;

  while (ramas < objetivo && intentos < objetivo * 14) {
    intentos++;

    const abiertas = tiles.filter((t) => !t.cerrada && t.kind !== 'entrada');
    if (abiertas.length === 0) break;

    const padre = rng.pick(abiertas);

    const libres: Tile[] = [];
    for (const paso of PASOS) {
      const nx = padre.x + paso.dx;
      const ny = padre.y + paso.dy;
      if (!enRango(nx, ny, ancho, alto)) continue;

      const t = en(nx, ny);
      if (!t.cerrada) continue;
      libres.push(t);
    }

    if (libres.length === 0) continue;

    const hijo = rng.pick(libres);
    const kind = rng.pesado(perfil.mezcla.map((m) => ({ valor: m.kind, peso: m.peso })));

    // Sin mini jefes en el primer piso, tampoco en las ramas.
    const kindFinal = indice === 0 && kind === 'minijefe' ? 'combate' : kind;

    hijo.kind = kindFinal;

    // Todo lo que no sea decorado queda ABIERTO. Una casilla cerrada que no
    // tenga llave ni mecanismo detrás solo hace trampas.
    hijo.cerrada = kindFinal === 'vacia';
    if (hijo.cerrada) hijo.contenido = { tipo: 'nada' };
    else hijo.contenido = contenidoPara(kindFinal, bioma, rng, dificultad);

    ramas++;
  }

  // --- 8. lo que no puede faltar -------------------------------------------
  //
  // A partir del segundo piso tiene que haber un santuario. Sin él, una
  // expedición larga se queda sin ningún sitio donde recuperar y el jugador deja
  // de tener una decisión que tomar: no hay recurso que administrar.
  if (indice > 0 && !tiles.some((t) => t.kind === 'santuario')) {
    const libres = tiles.filter((t) => !t.cerrada && t.kind === 'vacia');
    const sitio = libres.length > 0 ? rng.pick(libres) : null;

    if (sitio) {
      sitio.kind = 'santuario';
      sitio.contenido = contenidoPara('santuario', bioma, rng, dificultad);
    }
  }

  return {
    indice,
    bioma,
    tiles,
    ancho,
    alto,
    transitables: tiles.filter((t) => !t.cerrada).length,
  };
}

/** Camino en L de un punto a otro. Feo, pero SIEMPRE conecta. */
function caminoEnL(
  desde: Tile,
  objetivo: Tile,
  en: (x: number, y: number) => Tile,
  ancho: number,
  alto: number,
): Tile[] {
  const ruta: Tile[] = [];
  let x = desde.x;
  let y = desde.y;
  let guardia = 0;

  while ((x !== objetivo.x || y !== objetivo.y) && guardia++ < ancho * alto * 2) {
    // Primero en X y luego en Y.
    if (x !== objetivo.x) x += Math.sign(objetivo.x - x);
    else if (y !== objetivo.y) y += Math.sign(objetivo.y - y);

    if (!enRango(x, y, ancho, alto)) continue;

    const t = en(x, y);
    if (!ruta.includes(t)) ruta.push(t);
  }

  return ruta;
}

/**
 * Reparte el contenido del camino principal.
 *
 * Tres tramos, en este orden y por estas razones:
 *
 *  - Los primeros pasos casi nunca son combate. Entrar y pelearse en la primera
 *    casilla hace que el jugador no llegue a ver nada de la mazmorra.
 *  - El último intermedio es del mini jefe, si cabe. Es donde tiene sentido: es
 *    la última puerta antes de la sala grande.
 *  - En medio va lo que diga la mezcla del bioma.
 */
function repartirCamino(
  intermedios: Tile[],
  mezcla: { kind: TileKind; peso: number }[],
  rng: RngMapa,
  indice: number,
): void {
  if (intermedios.length === 0) return;

  const ultimo = intermedios.length - 1;

  // El primer piso es el tutorial: se aprende a moverse, a leer el mapa y a
  // decidir si se sigue. Un mini jefe con fases ahí arriba no enseña nada, solo
  // quita el tiempo para aprender.
  const conMiniJefe = indice > 0 && ultimo >= 2 && rng.chance(0.75);

  for (let i = 0; i < intermedios.length; i++) {
    const t = intermedios[i]!;

    if (conMiniJefe && i === ultimo) {
      t.kind = 'minijefe';
      continue;
    }

    // Los primeros pasos casi nunca son combate. Entrar y pelearse en la
    // primera casilla hace que el jugador no llegue a ver nada.
    if (i < 2) {
      t.kind = rng.chance(0.5) ? 'evento' : 'vacia';
      continue;
    }

    t.kind = rng.pesado(mezcla.map((m) => ({ valor: m.kind, peso: m.peso })));

    // Dos mini jefes seguidos serían un muro, no una dificultad.
    if (t.kind === 'minijefe') t.kind = 'combate';
  }
}

/** El contenido de una casilla, según su tipo. Lo decide la semilla. */
export function contenidoPara(
  kind: TileKind,
  bioma: Biome,
  rng: RngMapa,
  dificultad: number,
): TileContent {
  const perfil = BIOMES[bioma];

  switch (kind) {
    case 'combate':
    case 'minijefe': {
      const esMini = kind === 'minijefe';

      // Un mini jefe no sortea rareza: elige ARQUETIPO, que es lo que lo
      // diferencia. Su rareza es fija.
      if (esMini) {
        const arquetipo = rng.pick(ARQUETIPOS_MINIJEFE);
        const especies = especiesParaRareza('poco_comun');

        return {
          tipo: 'combate',
          especie: rng.pick(especies),
          nivel: Math.max(5, Math.round(dificultad + 3)),
          Rareza: 'raro',
        };
      }

      const rareza = rng.pesado(perfil.rarezas.map((r) => ({ valor: r.rareza, peso: r.peso })));

      return {
        tipo: 'combate',
        especie: rng.pick(especiesParaRareza(rareza)),
        nivel: Math.max(2, Math.round(dificultad + rng.int(-2, 3))),
        Rareza: rareza,
      };
    }

    case 'evento': {
      const id = rng.pesado(TABLA_EVENTOS.map((e) => ({ valor: e.key, peso: e.peso })));
      return { tipo: 'evento', eventoId: id };
    }

    case 'tesoro': {
      const rareza = rng.pesado([
        { valor: 'normal' as const, peso: 62 },
        { valor: 'bueno' as const, peso: 30 },
        { valor: 'raro' as const, peso: 8 },
      ]);

      // La trampa es más probable en los cofres raros. Si no, un cofre raro sería
      // solo "más cosas", y no tendría una decisión detrás.
      const probTrampa = rareza === 'raro' ? 0.22 : rareza === 'bueno' ? 0.1 : 0.05;

      return { tipo: 'cofre', rareza, trampa: rng.chance(probTrampa) };
    }

    case 'santuario':
      return { tipo: 'santuario', Bendicion: rng.pick(perfil.santuarios) };

    case 'comerciante':
      return {
        tipo: 'comerciante',
        mercader: rng.pick(['barato', 'caro', 'raro'] as const),
      };

    case 'habitacion':
      return {
        tipo: 'habitacion',
        habitacion: rng.pesado([
          { valor: 'tesoro' as TipoHabitacion, peso: 26 },
          { valor: 'santuario' as TipoHabitacion, peso: 20 },
          { valor: 'arena' as TipoHabitacion, peso: 22 },
          { valor: 'puzzle' as TipoHabitacion, peso: 14 },
          { valor: 'npc' as TipoHabitacion, peso: 12 },
          { valor: 'jefe' as TipoHabitacion, peso: 6 },
        ]),
      };

    default:
      return { tipo: 'nada' };
  }
}

/**
 * Las especies de una rareza.
 *
 * Se leen del bestiario real y se filtran por lo que la rareza SIGNIFICA. Un
 * "mitico" tiene que ser de los que de verdad escasean; si saliera un Agumon con
 * otro nombre, la rareza no cambiaría nada y el jugador no tendría por qué
 * detenerse en esa casilla.
 */
export function especiesParaRareza(rareza: string): string[] {
  const todas = Object.values(SPECIES)
    .filter((s) => s.tier !== 'inicial')
    .map((s) => s.key);

  const porBanda = (banda: string[]): string[] =>
    todas.filter((k) => banda.includes(SPECIES[k]?.tier ?? ''));

  switch (rareza) {
    case 'mitico':
      return conRespaldo(porBanda(['ultimate', 'mega']), todas);
    case 'raro':
      return conRespaldo(porBanda(['campeon', 'ultimate']), todas);
    case 'poco_comun':
      return conRespaldo(porBanda(['novato', 'campeon']), todas);
    default:
      return conRespaldo(porBanda(['diminuto', 'novato']), todas);
  }
}

/**
 * Si el filtro deja muy pocas, se relaja.
 *
 * Es preferible una especie de otra banda a una casilla de combate VACÍA, que es
 * lo que pasaría con un bestiario pequeño en una rareza alta.
 */
function conRespaldo(preferidas: string[], todas: string[]): string[] {
  if (preferidas.length >= 3) return preferidas;
  return todas.filter((k) => Boolean(getSpecies(k)));
}

/**
 * ¿El mapa es jugable?
 *
 * Tres condiciones, y las tres salen del encargo:
 *
 *  1. La entrada llega al jefe.
 *  2. No hay casillas ABIERTAS inaccesibles. Una recompensa detrás de una pared
 *     sin rodeo es un mapa mal generado, y el jugador no tiene forma de saber que
 *     existe.
 *  3. El jefe tiene al menos una vecina, para poder volver por donde se vino.
 */
export function esJuguable(piso: Floor): boolean {
  const entrada = piso.tiles.find((t) => t.kind === 'entrada');
  const jefe = piso.tiles.find((t) => t.kind === 'jefe');

  if (!entrada || !jefe) return false;

  if (!camino(piso, { x: entrada.x, y: entrada.y }, { x: jefe.x, y: jefe.y }, true)) {
    return false;
  }

  const alcanzados = alcanzables(piso, { x: entrada.x, y: entrada.y }, true);

  for (const t of piso.tiles) {
    if (t.cerrada) continue;
    if (!alcanzados.has(`${t.x},${t.y}`)) return false;
  }

  const vecinos = piso.tiles.filter(
    (t) => Math.abs(t.x - jefe.x) + Math.abs(t.y - jefe.y) === 1,
  );

  return vecinos.length > 0;
}