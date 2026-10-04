import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

/**
 * El catálogo de referencia de Digimon.
 *
 * Va en su propio módulo y no dentro de `species.ts` porque son dos cosas
 * distintas con esquemas distintos:
 *
 *   - `species.ts` son las especies JUGABLES: tienen estadísticas, golpes,
 *    .elementos y rutas de evolución del juego. Son pocas y están afinadas.
 *   - `catalogo.ts` es el universo DOCUMENTADO: lo que dice la wiki, con su
 *     procedencia y su estado de verificación por campo. Son muchas y no se
 *     afinan: se registran tal cual.
 *
 * Confundirlas era el error de diseño más caro posible aquí. Un Digimon con
 * estadísticas inventadas y una cita de la wiki son cosas diferentes, y meterlas
 * en la misma tabla acabaría poniendo números inventados donde el jugador espera
 * datos reales, o al revés: corrigiendo datos oficiales para que cuadren con el
 * balance del juego.
 *
 * LO QUE NUNCA SE HACE AQUÍ
 *
 * No se rellena un campo que la fuente no declara. Cada campo lleva su estado, y
 * un `pendiente` con motivo vale más que un valor plausible: el primero se puede
 * buscar, el segundo no se puede ni detectar.
 */

/** Estado de verificación de un campo. */
export type EstadoCampo = 'verificado' | 'pendiente' | 'difiere';

export interface CampoCatalogo {
  valor: string;
  estado: EstadoCampo;
  /** Por qué está pendiente. Es lo que permite priorizar el trabajo pendiente. */
  motivo?: string;
}

/**
 * Una imagen de referencia.
 *
 * Se guardan URL y metadatos. NO se guarda ningún binario: el arte de Digimon es
 * material de Bandai y Toei, y el proyecto no lo redistribuye.
 */
export interface ImagenCatalogo {
  url: string | null;
  miniatura: string | null;
  /** La página de descripción del fichero: donde está la procedencia real. */
  pagina: string | null;
  /** Nombre del fichero. Sin esto no se puede comprobar la correspondencia. */
  fichero: string | null;
  /** Lo que dice la página del fichero: "Official Bandai image of…". */
  origen: string | null;
  categoria: string | null;
  /**
   * Clasificación conservadora de la licencia.
   *
   * Se deriva del texto y las categorías del fichero. Lo que no se ha podido
   * verificar se marca como tal en vez de asumir lo más cómodo para el proyecto.
   */
  licencia: string;
  licenciaUrl: string | null;
  ancho: number | null;
  alto: number | null;
  mime: string | null;
  /**
   * Si la imagen corresponde a esta especie.
   *
   * `difiere` no significa que esté mal: significa que el `ObjectName` del
   * fichero no encaja con el nombre de la especie y hay que mirarlo a mano.
   */
  correspondencia: EstadoCampo;
  detalleCorrespondencia: string;
}

export interface EntradaCatalogo {
  /** Clave estable: sin acentos, sin espacios, con el matiz de la variante. */
  key: string;
  nombre: string;
  /** Título de la página. Puede llevar matiz: `Agimon (2006 anime)`. */
  pagina: string;
  /** El nombre sin el matiz. Sirve para agrupar variantes. */
  nombreBase: string;

  nivel: CampoCatalogo;
  tipo: CampoCatalogo;
  atributo: CampoCatalogo;
  atributo2: CampoCatalogo;
  familias: CampoCatalogo;
  nombresAlternativos: CampoCatalogo;

  /** Formas anteriores documentadas. */
  desde: string[];
  /** Formas posteriores documentadas. Vacío = forma final según la fuente. */
  hacia: string[];
  esFormaFinal: boolean;

  ataques: { nombre: string; alias: string[] }[];
  descripcion: string | null;

  imagen: ImagenCatalogo;
  categorias: string[];

  procedencia: { sitio: string; pagina: string; url: string; descargado: string };

  /** Nombres de campo sin verificar. Se priorizan en el informe de auditoría. */
  pendientes: string[];

  /**
   * Si la especie está activada en el juego.
   *
   * El catálogo es el universo entero; el juego usa un subconjunto. La marca la
   * pone el operador, no la fuente: que una especie exista en la wiki no significa
   * que esté balanceada para pelearse.
   */
  activable: boolean;
}

interface Documento {
  meta: {
    generado: string;
    fuente: string;
    sitio: string;
    categoria: string;
    aviso: string;
    comoLeerLaLicencia: string;
    reglas: Record<string, string>;
    descartadas: number;
  };
  entradas: EntradaCatalogo[];
}

// -------------------------------------------------------------- carga -------

const aqui = dirname(fileURLToPath(import.meta.url));

let documento: Documento | null = null;

function cargar(): Documento {
  if (documento) return documento;

  const ruta = resolve(aqui, '../data/catalogo.json');

  // El catálogo puede faltar en una instalación recién clonada si alguien no ha
  // ejecutado el importador. Es un fallo recuperable y el mensaje lo dice, porque
  // la alternativa —un `readFileSync` que revienta al importar— tumba el bot
  // entero por un fichero de datos.
  let crudo: string;

  try {
    crudo = readFileSync(ruta, 'utf8');
  } catch {
    throw new Error(
      `Falta src/data/catalogo.json.\n` +
        `Se genera con:  npx tsx tools/import-catalogo.ts\n` +
        `Sin él no hay bestiario de referencia, aunque el juego funcione.`,
    );
  }

  documento = JSON.parse(crudo) as Documento;
  return documento;
}

let indice: Map<string, EntradaCatalogo> | null = null;

/**
 * Las especies activadas en el juego.
 *
 * Viene de `catalogo-activables.json`, que escribe `tools/marca-activables.ts` al
 * cruzar `species.ts` con el catálogo.
 *
 * ESTÁ SEPARADO DEL CATÁLOGO A PROPÓSITO. Que una especie esté activada en el
 * juego no es un dato de la wiki: es una decisión de diseño que depende del
 * balance. Dentro de `catalogo.json` un `import-catalogo.ts` la borraría, porque
 * el importador no sabe nada del juego.
 *
 * Las claves de la wiki que quedan activadas se pasan a las claves JUGABLES, que
 * no siempre coinciden: el juego llama `kimeramon` a una especie que la wiki llama
 * `Meramon`. El cruce guarda las dos, y aquí se guarda el de la ficha.
 */
let activablesPorClave: Set<string> | null = null;

function activablesDeJuego(): Set<string> {
  if (activablesPorClave) return activablesPorClave;

  const ruta = resolve(aqui, '../data/catalogo-activables.json');

  activablesPorClave = new Set();

  if (existsSync(ruta)) {
    try {
      const datos = JSON.parse(readFileSync(ruta, 'utf8')) as {
        especies?: { catalogo?: string }[];
      };

      for (const e of datos.especies ?? []) {
        if (e.catalogo) activablesPorClave.add(e.catalogo);
      }
    } catch {
      // Un fichero de cruce ilegible deja el catálogo sin especies activables, que
      // es un estado visible y recuperable. Se avisa en vez de fallar al importar
      // el módulo, que dejaría el bot entero sin bestiario.
      console.warn(
        '[catalogo] src/data/catalogo-activables.json no se pudo leer. ' +
          'Ninguna especie queda marcada como jugable. ' +
          'Se regenera con: npx tsx tools/marca-activables.ts',
      );
    }
  }

  return activablesPorClave;
}

/** La clave del catálogo de una especie jugable del juego. */
export function claveCatalogoDe(claveJuego: string): string | null {
  const ruta = resolve(aqui, '../data/catalogo-activables.json');
  if (!existsSync(ruta)) return null;

  try {
    const datos = JSON.parse(readFileSync(ruta, 'utf8')) as {
      especies?: { juego: string; catalogo: string }[];
    };

    return datos.especies?.find((e) => e.juego === claveJuego)?.catalogo ?? null;
  } catch {
    return null;
  }
}

function mapa(): Map<string, EntradaCatalogo> {
  if (indice) return indice;

  indice = new Map();
  const activables = activablesDeJuego();

  for (const e of cargar().entradas) {
    // La marca se aplica AL CARGAR, no la escribe el importador. Así una
    // reimportación del catálogo no borra la decisión de qué especies están en el
    // juego, que es lo que pasó cuando se buscó guardar aquí.
    e.activable = activables.has(e.key);

    // Una clave repetida sería un duplicado real. La auditoría lo señala, pero
    // aquí se conserva la primera para que el resto del bot no se rompa: es
    // preferible servir un dato duplicado que dejar el bestiario entero vacío.
    if (!indice.has(e.key)) indice.set(e.key, e);
  }

  return indice;
}

// -------------------------------------------------------------- consulta ----

export function metaCatalogo(): Documento['meta'] {
  return cargar().meta;
}

export function totalEspecies(): number {
  return mapa().size;
}

export function entradaDe(key: string): EntradaCatalogo | null {
  return mapa().get(key) ?? null;
}

export function tieneEntry(key: string): boolean {
  return mapa().has(key);
}

export function todasEntradas(): EntradaCatalogo[] {
  // Pasa por `mapa()` y no por `cargar()` a propósito: es `mapa()` quien aplica la
  // marca de `activable`. Leer el documento crudo devolvía entradas con
  // `activable: false` siempre, y el filtro de "solo jugables" devolvía una lista
  // vacía sin ningún error visible.
  return [...mapa().values()];
}

export function activables(): EntradaCatalogo[] {
  return todasEntradas().filter((e) => e.activable);
}

// ------------------------------------------------------- texto legible ------

/**
 * Traduce el `Attribute` oficial a las tres capas del juego.
 *
 * SOLO para MOSTRAR. El `Attribute` oficial y el triángulo del juego son campos
 * distintos, y este no lo sobrescribe: traduce para que un jugador vea
 * "Vaccine" y debajo "Vacuna (en el juego)" si difieren. La divergencia es
 * información, no un error.
 */
export const ATRIBUTOS_ES: Record<string, string> = {
  Vaccine: 'Vacuna',
  Data: 'Datos',
  Virus: 'Virus',
  Free: 'Libre',
  Unknown: 'Desconocido',
  Variable: 'Variable',
};

/**
 * Traduce el nivel oficial a las bandas del juego.
 *
 * Igual que arriba: el nivel oficial NO se pisa. `Champion` oficial y
 * `campeón` en el juego son la misma banda, pero si algún día el juego
 * reagrupa algo, el catálogo tiene que seguir diciendo lo que dice la wiki.
 */
export const NIVELES_ES: Record<string, string> = {
  'Baby II': 'In-Training',
  'Baby I': 'Fresh',
  Rookie: 'Rookie',
  Champion: 'Champion',
  Ultimate: 'Ultimate',
  Mega: 'Mega',
  'Ultra': 'Super Ultimate',
  'Super Ultimate': 'Super Ultimate',
  Hybrid: 'Híbrido',
};

/** Cómo se escribe un nivel en el juego. */
export function nivelEnJuego(oficial: string): string {
  const limpio = oficial.trim();

  switch (limpio) {
    case 'Fresh':
    case 'Baby I':
      return 'Fresh';
    case 'In-Training':
    case 'Baby II':
      return 'In-Training';
    case 'Rookie':
      return 'Rookie';
    case 'Champion':
      return 'Champion';
    case 'Ultimate':
      return 'Ultimate';
    case 'Mega':
      return 'Mega';
    case 'Ultra':
    case 'Super Ultimate':
      return 'Super Ultimate';
    default:
      // Un nivel que el juego no tiene se muestra tal cual, marcado. No se
      // encaja en la banda más parecida: "no sé dónde va esto" es la respuesta
      // honesta y además queda a la vista.
      return `${limpio} (fuera de las bandas del juego)`;
  }
}

/** Cómo se escribe un atributo en el juego, o `null` si no se sabe. */
export function atributoEnJuego(oficial: string): string | null {
  const limpio = oficial.trim().toLowerCase();

  switch (limpio) {
    case 'vaccine':
      return 'vacuna';
    case 'data':
      return 'datos';
    case 'virus':
      return 'virus';
    case 'free':
      return 'free';
    default:
      return null;
  }
}

/** Si el atributo oficial y el del juego coinciden. */
export function atributoCoincide(oficial: string, juego: string): boolean {
  const trad = atributoEnJuego(oficial);
  return trad === null ? true : trad === juego.toLowerCase();
}

/** El nombre de una familia, sin diferencias. */
export function listaDeFamilias(e: EntradaCatalogo): string[] {
  if (e.familias.estado !== 'verificado' || e.familias.valor === '') return [];

  return e.familias.valor
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f !== '' && f !== 'Unknown');
}

/** La línea evolutiva completa, en las dos direcciones. */
export function lineaDe(key: string): {
  anterior: EntradaCatalogo[];
  posterior: EntradaCatalogo[];
} {
  const e = entradaDe(key);
  if (!e) return { anterior: [], posterior: [] };

  // Se resuelve por NOMBRE, no por clave. La wiki da nombres en `from`/`to`, y
  // la clave se deriva del nombre, así que la conversión tiene que pasar por el
  // nombre. Las páginas que no están en el catálogo se devuelven como
  // `null` en la lista, para que la interfaz pueda decir "esto existe pero no lo
  // he importado" en vez de callarse.
  const resolver = (nombres: string[]): EntradaCatalogo[] =>
    nombres.map((n) => entradaPorNombreOCaja(n)).filter((x): x is EntradaCatalogo => x !== null);

  return { anterior: resolver(e.desde), posterior: resolver(e.hacia) };
}

/**
 * Busca una entrada por el nombre exacto de la wiki.
 *
 * Existe porque `from` y `to` guardan TÍTULOS de página (`MetalGreymon (Vaccine)`),
 * no claves. Sin esta búsqueda, la línea evolutiva importada no se cruzaría con
 * el catálogo y el bestiario mostraría cero evoluciones.
 */
export function entradaPorNombreOCaja(nombre: string): EntradaCatalogo | null {
  const objetivo = nombre.trim().toLowerCase();

  for (const e of cargar().entradas) {
    if (e.pagina.toLowerCase() === objetivo) return e;
    if (e.nombre.toLowerCase() === objetivo) return e;
  }

  return null;
}

// ------------------------------------------------------ política de imagen --

/**
 * Qué se hace con una imagen en la interfaz.
 *
 * ESTA ES LA DECISIÓN QUE MARCA LA DIFERENCIA ENTRE EL PROYECTO Y UN PORTAPAPELES.
 *
 * El arte de Digimon es copyright de Bandai y Toei, y la wiki que lo cataloga lo
 * marca como no libre. Mostrarlo embebido en Discord es mostrar material
 * protegido, y enlazarlo en caliente va además contra las condiciones de esa
 * wiki. Ninguna de las dos cosas se puede arreglar con una línea de código: es un
 * problema de derechos, y por eso la decisión es de quien opera el bot y no del
 * código.
 *
 * El valor por defecto es NO mostrar. La ficha lleva el enlace a la página de
 * origen, que es lo que un catálogo puede hacer sin problemas: decir de dónde
 * viene la referencia y dejar que el jugador la mire.
 *
 * `IMAGENES_EMBED=1` lo cambia. Quien lo activa asume la responsabilidad.
 */
export function politicaImagen(): 'enlazar' | 'embebida' {
  return config.imagenesEmbed ? 'embebida' : 'enlazar';
}

/** Si se permite mostrar las imágenes dentro de los embeds. */
export function imagenesEmbebidas(): boolean {
  return config.imagenesEmbed === true;
}

/**
 * Cómo se representa una imagen en una pantalla.
 *
 * Devuelve lo que la GUI tiene que hacer, no la URL pelada. La decisión de
 * embebir o enlazar está aquí, y no repartida por veinte pantallas donde alguien
 * acabaría llamando a `setImage` por su cuenta.
 */
export interface PresentacionImagen {
  /** URL para `setImage`/`setThumbnail`, o `null` si no se debe embebir. */
  embebir: string | null;
  /** URL de la página de origen, para el botón de enlace. */
  pagina: string | null;
  /** Texto del botón. */
  etiqueta: string;
  /** Lo que dice la página del fichero: de quién es la imagen. */
  origen: string | null;
  /** Aviso de licencia que hay que mostrar. */
  aviso: string | null;
  /** Si la imagen es dudosa y hay que decirlo. */
  advertencia: string | null;
}

/** Las licencias que NO permiten embeber sin que quien opera lo asuma. */
const LICENCIAS_PROTEGIDAS = new Set([
  'oficial-bandai-toei-protegido',
  'arte-de-fan-sin-declarar',
  'sin-declarar-no-verificable',
  'cc-por-determinar',
]);

export function presentarImagen(e: EntradaCatalogo): PresentacionImagen {
  const img = e.imagen;

  const hayImagen = img.url !== null || img.miniatura !== null;

  const aviso =
    img.licencia === 'oficial-bandai-toei-protegido'
      ? 'Material oficial de Bandai/Toei. Enlace a la fuente, sin copia.'
      : img.licencia === 'cc-por-determinar' || img.licencia === 'sin-declarar-no-verificable'
        ? 'Licencia no verificada. Enlace a la fuente.'
        : null;

  const advertencia =
    img.correspondencia === 'difiere'
      ? `⚠️ La imagen podría no ser de esta especie: ${img.detalleCorrespondencia}`
      : img.correspondencia === 'pendiente' && hayImagen
        ? `La imagen no se ha podido comprobar: ${img.detalleCorrespondencia}`
        : null;

  if (!hayImagen) {
    // Sin imagen no se cae la pantalla: se enlaza a la página de la especie, que
    // es donde se puede leer de dónde sale todo lo demás. Una ficha sin ilustración
    // y sin ningún enlace es un callejón, y el jugador no puede hacer nada con ella.
    return {
      embebir: null,
      pagina: e.procedencia.url,
      etiqueta: '🔗 Ver la ficha',
      origen: null,
      aviso: 'La fuente no tiene ilustración para esta especie.',
      advertencia: null,
    };
  }

  // El opt-in del operador solo se respeta si la licencia no está protegida. Con
  // `IMAGENES_EMBED=1` y una imagen de fan sin licencia declarada, no se embebe:
  // una bandera general no puede pasar por encima de un dato que dice "no lo sé".
  const puede = imagenesEmbebidas() && !LICENCIAS_PROTEGIDAS.has(img.licencia);

  return {
    embebir: puede ? (img.miniatura ?? img.url) : null,
    pagina: img.pagina ?? e.procedencia.url,
    etiqueta: puede ? 'Ver en la fuente' : '🔗 Ver imagen en la fuente',
    origen: img.origen,
    aviso,
    advertencia,
  };
}

// --------------------------------------------------------------- auditoría --

export interface ResumenAuditoria {
  total: number;
  activables: number;
  conImagen: number;
  conImagenVerificada: number;
  imagenesSospechosas: number;
  sinNivel: number;
  sinTipo: number;
  sinFamilias: number;
  sinDescripcion: number;
  sinAtaques: number;
  formasFinales: number;
  sinEvolucionConocida: number;
  lineasIncompletas: string[];
  clavesDuplicadas: string[];
  variantesSinSeparar: string[];
}

/**
 * Un resumen del estado del catálogo.
 *
 * Lo calcula sobre el documento entero y sin filtrar. Es lo que responde a la
 * pregunta que el encargo hace explícita: no se declara el catálogo completo
 * mientras queden cosas sin revisar.
 */
export function auditarCatalogo(): ResumenAuditoria {
  const entradas = todasEntradas();

  // --- claves repetidas -------------------------------------------------
  // Dos páginas con la misma clave son dos especies que el catálogo no puede
  // distinguir. Se cuentan antes de nada porque, si hay una, el resto de
  // consultas por clave ya están contaminadas.
  const veces = new Map<string, number>();
  for (const e of entradas) veces.set(e.key, (veces.get(e.key) ?? 0) + 1);

  const clavesDuplicadas = [...veces.entries()]
    .filter(([, n]) => n > 1)
    .map(([k]) => k)
    .sort();

  // --- líneas evolutivas cortadas ----------------------------------------
  // Una forma anterior declarada que no está en el catálogo deja la línea a medias:
  // el jugador ve de dónde viene, pero no hacia dónde va, y no puede saber si es
  // que la ruta no existe o si a este catálogo le falta una página.
  const lineasIncompletas: string[] = [];

  for (const e of entradas) {
    if (e.desde.length === 0) continue;
    if (lineaDe(e.key).anterior.length === 0) lineasIncompletas.push(e.key);
  }

  // --- variantes sin matiz ----------------------------------------------
  // Variantes documentadas como páginas separadas que comparten nombre base sin
  // llevar matiz: `Agumon` y `Agumon` de dos juegos. Si no llevan matiz en el
  // título, la clave no las distingue y una pisaría a la otra.
  const variantesSinSeparar: string[] = [];

  for (const e of entradas) {
    if (e.pagina === e.nombre && e.pagina.includes('(')) variantesSinSeparar.push(e.key);
  }

  return {
    total: entradas.length,
    activables: entradas.filter((e) => e.activable).length,
    conImagen: entradas.filter((e) => e.imagen.url !== null).length,
    conImagenVerificada: entradas.filter((e) => e.imagen.correspondencia === 'verificado').length,
    imagenesSospechosas: entradas.filter((e) => e.imagen.correspondencia === 'difiere').length,
    sinNivel: entradas.filter((e) => e.nivel.estado !== 'verificado').length,
    sinTipo: entradas.filter((e) => e.tipo.estado !== 'verificado').length,
    sinFamilias: entradas.filter((e) => listaDeFamilias(e).length === 0).length,
    sinDescripcion: entradas.filter((e) => e.descripcion === null).length,
    sinAtaques: entradas.filter((e) => e.ataques.length === 0).length,
    formasFinales: entradas.filter((e) => e.esFormaFinal).length,
    sinEvolucionConocida: entradas.filter((e) => e.desde.length === 0 && e.hacia.length === 0).length,
    lineasIncompletas,
    clavesDuplicadas,
    variantesSinSeparar,
  };
}
