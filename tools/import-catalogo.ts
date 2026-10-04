/**
 * Importador del catálogo de referencia de Digimon.
 *
 *     npx tsx tools/import-catalogo.ts [--limite N] [--categoría NOMBRE]
 *
 * Lee `Category:Digimon species` de Digimon Fandom, consulta la API de MediaWiki
 * y escribe `src/data/catalogo.json`.
 *
 * POR QUÉ UN IMPORTADOR Y NO UNA BÚSQUEDA EN TIEMPO DE EJECUCIÓN
 *
 * El bot NUNCA hace fetch. Si el Digivice dependiera de que Fandom esté
 * disponible cada vez que alguien abre una pantalla, un rate-limit o una caída de
 * la wiki dejaría el juego sin bestiario entero. El JSON va compilado dentro del
 * bot y se regenera cuando quieras.
 *
 * POR QUÉ LA API Y NO UN SCRAPE
 *
 * El infobox tiene parámetros con nombre (`|level=`, `|type=`) y eso se lee de
 * forma fiable. El HTML renderizado no: los campos vacíos desaparecen, las
 * referencias se mezclan con el texto y los enlaces se rompen. Además la API
 * permite pedir 50 páginas por llamada, y un scrape de 1587 páginas tardaría una
 * hora.
 *
 * LO QUE NO HACE
 *
 * No inventa nada. Un campo que no está en la fuente queda como `pendiente` con
 * su motivo, no con un valor inventado. Y no decide nada sobre el juego: este
 * fichero no sabe qué es una estadística ni unaevolution de nuestro motor. Solo
 * traduce la wiki a un formato que se pueda auditar.
 *
 * LA LICENCIA DE LAS IMÁGENES
 *
 * La wiki marca su material como `non-free` porque es material oficial de Bandai
 * y Toei. La API no lo dice en `extmetadata`: está en el texto de la página del
 * fichero y en sus categorías ("Official Bandai image of…"). Aquí se guarda ESO,
 * el texto y la categoría tal cual, y se deriva una clasificación conservadora.
 *
 * No se copia nada aquí. Lo que se guarda son URL y metadatos; si en algún
 * momento se decide mostrar las imágenes, eso lo decide quien opera el bot.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const SALIDA = `${RAIZ}src/data/catalogo.json`;

const API = 'https://digimon.fandom.com/api.php';
const SITIO = 'https://digimon.fandom.com';

// ---------------------------------------------------------------- opciones --

const args = process.argv.slice(2);

function opcion(nombre: string, porDefecto: number): number {
  const i = args.indexOf(`--${nombre}`);
  if (i === -1) return porDefecto;
  const v = Number(args[i + 1]);
  return Number.isFinite(v) ? v : porDefecto;
}

const LIMITE = opcion('limite', 0); // 0 = todas
const CATEGORIA = (() => {
  const i = args.indexOf('--categoria');
  return i === -1 ? 'Digimon species' : (args[i + 1] ?? 'Digimon species');
})();

/** Espera entre peticiones. La API de Fandom no perdona el parallelism. */
const PAUSA_MS = 180;
/** MediaWiki acepta 50 títulos por llamada para usuarios anónimos. */
const LOTE = 50;

// ------------------------------------------------------------------ http ---

const cache = new Map<string, unknown>();

async function pedir<T>(params: Record<string, string>): Promise<T> {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;

  if (cache.has(url)) return cache.get(url) as T;

  for (let intento = 0; intento < 4; intento++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'digimon-mmo-catalogo/1.0' } });

      if (res.status === 429 || res.status >= 500) {
        // Backoff: reintentar rápido es lo que agota el límite y lo convierte en
        // un bloqueo largo.
        await dormir(PAUSA_MS * Math.pow(3, intento));
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const datos = (await res.json()) as T;
      cache.set(url, datos);
      await dormir(PAUSA_MS);
      return datos;
    } catch (error) {
      if (intento === 3) {
        console.warn(`  ! ${params.action ?? '?'} falló: ${(error as Error).message}`);
        return {} as T;
      }
      await dormir(PAUSA_MS * Math.pow(3, intento));
    }
  }

  return {} as T;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ tipos locales --

type Estado = 'verificado' | 'pendiente' | 'difiere';

/** Un campo que puede no existir. Guardar el motivo es lo que permite priorizar. */
interface Campo {
  valor: string;
  estado: Estado;
  /** Por qué está pendiente, si lo está. */
  motivo?: string;
}

interface ImagenCatalogo {
  url: string | null;
  miniatura: string | null;
  /** Página de descripción del fichero: donde está la procedencia real. */
  pagina: string | null;
  /** Nombre del fichero tal cual. Sin esto no se puede comprobar la correspondencia. */
  fichero: string | null;
  /** Lo que dice la página del fichero. */
  origen: string | null;
  categoria: string | null;
  licencia: string;
  licenciaUrl: string | null;
  ancho: number | null;
  alto: number | null;
  mime: string | null;
  /**
   * `verificada` = el `ObjectName` del fichero coincide con el nombre de la
   * especie. `sospechosa` = no coincide. `sin-comprobar` = la wiki no lo declara.
   */
  correspondencia: Estado;
  detalleCorrespondencia: string;
}

interface EntradaCatalogo {
  /** Clave estable y sin acentos, derivada del nombre oficial. */
  key: string;
  /** Nombre oficial tal cual lo escribe la wiki. */
  nombre: string;
  /** Título de la página en la wiki. Puede llevar matiz: `Agumon (2006 anime)`. */
  pagina: string;
  /** El nombre sin el matiz entre paréntesis, para detectar variantes. */
  nombreBase: string;

  nivel: Campo;
  tipo: Campo;
  atributo: Campo;
  /** El segundo atributo, cuando la especie es Dual. */
  atributo2: Campo;
  familias: Campo;
  /** Nombres alternativos y de otros idiomas. */
  nombresAlternativos: Campo;

  /** Formas anteriores, según `|from=`. */
  desde: string[];
  /** Formas posteriores, según `|to=`. */
  hacia: string[];
  /** Si no hay `|to=`, la especie es forma final documentada. */
  esFormaFinal: boolean;

  /** Ataques documentados, extraídos del cuerpo del artículo. */
  ataques: { nombre: string; alias: string[] }[];

  descripcion: string | null;

  imagen: ImagenCatalogo;

  /** Categorías de la wiki: sirven de contraste contra el infobox. */
  categorias: string[];

  procedencia: {
    sitio: string;
    pagina: string;
    url: string;
    descargado: string;
  };

  /** Campos que no se han podido verificar. Se priorizan en el informe. */
  pendientes: string[];
}

function campo(valor: string | undefined | null, porDefecto?: string): Campo {
  const limpio = (valor ?? '').trim();

  if (limpio === '') {
    return porDefecto === undefined
      ? { valor: '', estado: 'pendiente', motivo: 'la fuente no lo declara' }
      : { valor: porDefecto, estado: 'verificado' };
  }

  return { valor: limpio, estado: 'verificado' };
}

// ------------------------------------------------------------- wikitextt -----

/**
 * Saca el contenido de `{{Plantilla|...}}` del principio del artículo.
 *
 * Se busca el primer `{{` y se empareja contando llaves, en vez de usar una
 * expresión regular: el infobox contiene plantillas anidadas como `{{card|...}}`
 * y `{{c|...}}`, y una regex que se parase en el primer `}}` se comería media
 * ficha.
 */
function extraerPlantilla(wikitextt: string, nombre: string): string | null {
  const marca = `{{${nombre}`;
  const inicio = wikitextt.indexOf(marca);
  if (inicio === -1) return null;

  let profundidad = 0;

  for (let i = inicio; i < wikitextt.length - 1; i++) {
    if (wikitextt[i] === '{' && wikitextt[i + 1] === '{') {
      profundidad++;
      i++;
      continue;
    }

    if (wikitextt[i] === '}' && wikitextt[i + 1] === '}') {
      profundidad--;
      i++;

      if (profundidad === 0) return wikitextt.slice(inicio, i + 1);
    }
  }

  return null;
}

/**
 * Los parámetros `|clave=valor` de una plantilla.
 *
 * Se ignoran las líneas que son enlaces internos al final (`|y=`, `|seealso=`,
 * `|s1=`, `|s2=`…), que en esta wiki son listas de enlaces y no campos del
 * infobox. Si no se ignoraran, `s1` acabaría en la descripción y `y` en el
 * tamaño.
 */
const CLAVES_NO_CAMPO = /^(?:s\d+|y|y2|see|seealso|trivia|nav|main|extra|partner|java|java[nv]|env[a-z0-9]*|jacards|encards|de|es|zh|ja|n\d+|g\d+|k1|k2)\b/i;

function parametros(plantilla: string): Record<string, string> {
  const salida: Record<string, string> = {};

  // Se va al final de la cabecera de la plantilla.
  const inicio = plantilla.indexOf('|') + 1;
  const cuerpo = plantilla.slice(inicio, plantilla.lastIndexOf('}}'));

  // Una clave empieza en principio de línea, que es como los escribe esta wiki.
  //
  // La primera parte llega sin su `|` porque el corte de arriba se lo llevó. Se
  // repone: si no, `|name=Greymon` no casaría con el patrón y la especie perdería
  // su nombre oficial. Perderlo no era solo un dato menos —el nombre se
  // reconstruía desde el título, y para las variantes el título lleva un matiz
  // entre paréntesis que al quitarlo las hacía compartir clave con la especie
  // base.
  const partes = cuerpo.split(/\r?\n(?=\s*\|)/).map((p, i) => (i === 0 && !p.trimStart().startsWith('|') ? `|${p}` : p));

  for (const parte of partes) {
    const m = /^\s*\|\s*([a-zA-Z0-9_]+)\s*=(.*)$/s.exec(parte);
    if (!m) continue;

    const clave = m[1]!.toLowerCase();

    if (CLAVES_NO_CAMPO.test(clave)) continue;

    // CRUDO, a propósito. Ver la nota de la función.
    salida[clave] = m[2] ?? '';
  }

  return salida;
}

/**
 * Quita referencias y comentarios, y deja los enlaces.
 *
 * Es el paso previo de `enlaces()`. `limpiar()` no sirve aquí porque también
 * deshace los enlaces: se viene a buscar precisamente eso.
 *
 * Sin este paso, los enlaces de las fuentes dentro de los `<ref>` se contarían
 * como evoluciones. Una especie quedaría con 'Sale en Adventure' como forma
 * posterior, que es un enlace a un artículo y no un Digimon.
 */
function sinRefs(valor: string): string {
  return valor
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
}

/**
 * Limpia un valor de wiki.
 *
 * Quita las referencias `<ref>`, los comentarios `<!-- -->`, las plantillas de
 * formato y los enlaces. Deja el texto legible, que es lo que va al catálogo: un
 * jugador que lee `Agent Orange<ref>St-2</ref>` aprende menos que uno que lee
 * `Agent Orange`.
 */
function limpiar(valor: string | undefined | null): string {
  // Acepta `undefined` a propósito. Se llama con `p.campo` de una plantilla leída
  // del wikitextt, y un campo ausente llega como `undefined`. Que la función
  // tolerarlo evita un `?? ''` en cada uno de los treinta puntos donde se usa,
  // y un solo punto donde se olvide es un fallo en tiempo de ejecución.
  let s = valor ?? '';

  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<ref[^>]*\/>/gi, '');
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  s = s.replace(/\{\{[Cc]\|([^|}]*)\}\}/g, '$1');
  s = s.replace(/\{\{card\|([^|}]*)\}\}/g, '$1');
  s = s.replace(/\{\{w\|([^|}]*)\}\}/g, '$1');
  s = s.replace(/\{\{c\|([^|}]*)\}\}/g, '$1');

  // Enlaces: `[[Agumon|texto]]` -> `texto`, `[[Agumon]]` -> `Agumon`.
  s = s.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2');
  s = s.replace(/\[\[([^\]]*)\]\]/g, '$1');

  s = s.replace(/'''?/g, '');
  s = s.replace(/<br\s*\/?>/gi, ', ');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/^\s*,\s*|\s*,\s*$/g, '');

  return s.trim();
}

/** Los títulos de wiki de todos los `[[...]]` de un valor. */
function enlaces(valor: string): string[] {
  const salida: string[] = [];

  for (const m of valor.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    const titulo = m[1]!.trim();
    if (titulo !== '' && !salida.includes(titulo)) salida.push(titulo);
  }

  return salida;
}

/**
 * Clave estable a partir del nombre oficial.
 *
 * Se quitan los acentos, los espacios y los signos, porque la clave va en URLs,
 * en botones y en el `custom_id` de Discord, donde un `(` o un `´` estorban.
 *
 * El matiz entre paréntesis NO se quita: `Agumon` y `Agumon (2006 anime)` son
 * páginas distintas y son fichas distintas. Quitarlo haría que dos especies
 * distintas compartieran clave.
 */
function claveDe(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** El nombre sin el matiz entre paréntesis. */
function baseDe(nombre: string): string {
  return nombre.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

// -------------------------------------------------------------- ataques -----

/**
 * Los ataques documentados, del cuerpo del artículo.
 *
 * Vienen en un `<u>'''Attacks'''</u>` seguido de líneas de la forma
 * `*'''Nova Blast''' (''Mega Flame''): descripción`. Se extraen el nombre y los
 * alias entre paréntesis enredoja.
 *
 * No se guarda la descripción del ataque: la wiki la cambia según el juego y
 * mezclarla haría que un ataque tuviera cinco descripciones contradictorias. Lo
 * que se guarda es el nombre, que es lo estable y lo que el jugador reconoce.
 */
function extraerAtaques(wikitextt: string): { nombre: string; alias: string[] }[] {
  const seccion = /<u>'''Attacks'''<\/u>([\s\S]*?)(?:\{\{TOClimit|==\s*Design|\n==)/i.exec(wikitextt);
  if (!seccion) return [];

  const cuerpo = seccion[1]!;
  const salida: { nombre: string; alias: string[] }[] = [];
  const vistos = new Set<string>();

  for (const m of cuerpo.matchAll(/\*'''\s*([^'<]+?)\s*'''([\s\S]*?)(?:\n\*'''|\n\*\{\{|$)/g)) {
    const nombre = limpiar(m[1]!);
    if (nombre === '' || vistos.has(nombre.toLowerCase())) continue;

    vistos.add(nombre.toLowerCase());

    const alias: string[] = [];
    for (const a of m[2]!.matchAll(/\(\s*''([^']+)''\s*\)/g)) {
      const limpio = limpiar(a[1]!);
      if (limpio !== '' && limpio !== nombre) alias.push(limpio);
    }

    salida.push({ nombre, alias });
  }

  return salida;
}

// -------------------------------------------------------------- licencia ----

/**
 * Clasifica la licencia de una imagen a partir de lo que dice su página.
 *
 * LA REGLA ES CONSERVADORA POR PRINCIPIO. Si no hay una declaración explícita de
 * licencia libre, se clasifica como material protegido y se deja constancia de
 * que no se ha podido verificar. La razón es que un arte de Digimon es
 * normalmente de Bandai o Toei, y darlo por libre porque no decía nada sería
 * exactamente el error que el encargo pide evitar.
 */
function licenciaDe(origen: string | null, categoria: string | null): { licencia: string; licenciaUrl: string | null } {
  const texto = `${origen ?? ''} ${categoria ?? ''}`.toLowerCase();

  if (/public domain|cc0|cc-zero/.test(texto)) {
    return { licencia: 'dominio-publico', licenciaUrl: null };
  }

  if (/cc[\s-]?by[\s-]?sa/.test(texto)) {
    return { licencia: 'cc-by-sa', licenciaUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' };
  }

  if (/cc[\s-]?by(?![\s-]?sa)/.test(texto)) {
    return { licencia: 'cc-by', licenciaUrl: 'https://creativecommons.org/licenses/by/4.0/' };
  }

  if (/\bcc\b/.test(texto)) {
    return { licencia: 'cc-por-determinar', licenciaUrl: null };
  }

  if (/fan ?art|fanart/.test(texto)) {
    return { licencia: 'arte-de-fan-sin-declarar', licenciaUrl: null };
  }

  if (/bandai|toei|official/.test(texto)) {
    return { licencia: 'oficial-bandai-toei-protegido', licenciaUrl: null };
  }

  // Sin nada que verificar: se dice que no se ha podido verificar, en vez de
  // asumir lo más cómodo para el proyecto.
  return { licencia: 'sin-declarar-no-verificable', licenciaUrl: null };
}

// ---------------------------------------------------------- correspondencia --

/**
 * Normaliza el nombre que declara un fichero de imagen.
 *
 * Quita el matiz entre paréntesis y el sufijo de arte. La wiki llama a las
 * ilustraciones `Agumon b.jpg`, `Jesmon b.jpg`, `Greymon (2006) render.jpg`: la `b`
 * de "base" no es parte del nombre de la especie, y sin quitarla `jesmon_b` no
 * coincide con ninguna especie y la comparación falla sin que se note.
 *
 * Se usa en LOS DOS SITIOS donde se compara un nombre de fichero con un nombre de
 * especie. Cuando solo se usaba en uno de ellos, la otra mitad de la comprobación
 * parecía no encontrar nada: el mismo nombre daba «verificada» en un sitio y «no
 * coincide» en el siguiente.
 */
function normalizaArte(nombre: string): string {
  const sinMatiz = baseDe(nombre);

  return claveDe(sinMatiz.replace(/[\s_-]+(b|vb)$/i, '').trim());
}

/**
 * ¿La imagen corresponde a esta especie?
 *
 * Se compara el `ObjectName` que declara el propio fichero con el nombre de la
 * especie, normalizado a minúsculas sin acentos ni signos.
 *
 * SE ACEPTA EN LOS TRES CASOS, y los tres son legítimos:
 *
 *   1. Coinciden: `Greymon b` para `Greymon`.
 *   2. El fichero tiene un añadido: `Greymon (2006 anime) render` para `Greymon`.
 *   3. La ESPECIE tiene el añadido: `BanchoLeomon` para `BanchoLeomon Burst Mode`.
 *      Es la forma base, y la imagen de una variante es la de su base.
 *
 * El caso 3 se descartaba antes como «imagen de otra especie», y era un error:
 * se tiraban imágenes que eran exactamente la correcta.
 *
 * Hay un cuarto caso que parece igual y NO se acepta: que el fichero nombre a otra
 * especie que comparta la raíz, como `Dark Trailmon` con una imagen de `Trailmon`.
 * Ahí no se sabe si es un recolor legítimo o la imagen equivocada, así que queda
 * pendiente y se mira a mano.
 *
 * Marcar `difiere` es la señal de que hay que mirar. Nunca significa que la imagen
 * sea mala: significa que el nombre no lo demuestra.
 */
function correspondenciaDe(nombreEspecie: string, objectName: string | null): { estado: Estado; detalle: string } {
  if (!objectName) {
    return {
      estado: 'pendiente',
      detalle: 'el fichero no declara ObjectName, así que no se puede comprobar',
    };
  }

  const a = claveDe(baseDe(nombreEspecie));
  const b = normalizaArte(objectName);

  if (a === b) return { estado: 'verificado', detalle: 'ObjectName coincide con el nombre de la especie' };

  // El fichero suele llevar sufijos: "Agumon b", "Greymon (2006) render".
  if (b.startsWith(`${a}_`) || b.startsWith(a)) {
    return { estado: 'verificado', detalle: `ObjectName "${objectName}" deriva de "${nombreEspecie}"` };
  }

  // La especie es una variante de la que nombra el fichero.
  if (a.startsWith(`${b}_`)) {
    return {
      estado: 'verificado',
      detalle: `ObjectName "${objectName}" es la forma base de "${nombreEspecie}"`,
    };
  }

  return {
    estado: 'difiere',
    detalle: `el fichero declara "${objectName}" pero la especie es "${nombreEspecie}"`,
  };
}

// ================================================================ descarga ===

interface PaginaCategoria {
  title: string;
  pageid: number;
}

async function listarCategoria(nombre: string): Promise<PaginaCategoria[]> {
  const salida: PaginaCategoria[] = [];
  let continuar: string | undefined;

  do {
    const params: Record<string, string> = {
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Category:${nombre}`,
      cmlimit: '500',
      cmtype: 'page',
    };

    if (continuar) params.cmcontinue = continuar;

    const datos = await pedir<{
      query?: { categorymembers?: PaginaCategoria[] };
      continue?: { cmcontinue?: string };
    }>(params);

    const miembros = datos.query?.categorymembers ?? [];
    salida.push(...miembros);

    console.log(`  categoría ${nombre}: ${salida.length} páginas`);

    continuar = datos.continue?.cmcontinue;
  } while (continuar);

  return salida;
}

/** Trocea un array en trozos de `n`. */
function lotes<T>(items: T[], n: number): T[][] {
  const salida: T[][] = [];

  for (let i = 0; i < items.length; i += n) salida.push(items.slice(i, i + n));

  return salida;
}

interface RespuestaPaginas {
  query?: {
    pages?: {
      pageid?: number;
      title?: string;
      missing?: boolean;
      revisions?: { slots?: { main?: { content?: string } } }[];
      categories?: { title: string }[];
    }[];
  };
  continue?: Record<string, string>;
}

/**
 * El wikitextt y las categorías de un lote de páginas.
 *
 * Se piden juntas porque van en la misma llamada: son 32 peticiones en vez de 64,
 * y contra una API pública cada petición cuenta.
 */
async function wikitexttDe(titulos: string[]): Promise<Map<string, { texto: string; categorias: string[] }>> {
  const salida = new Map<string, { texto: string; categorias: string[] }>();
  let continuar: string | undefined;

  do {
    const params: Record<string, string> = {
      action: 'query',
      prop: 'revisions|categories',
      rvprop: 'content',
      rvslots: 'main',
      cllimit: 'max',
      titles: titulos.join('|'),
    };

    if (continuar) params.clcontinue = continuar;

    const datos = await pedir<RespuestaPaginas>(params);

    for (const pagina of datos.query?.pages ?? []) {
      if (pagina.missing || !pagina.title) continue;

      salida.set(pagina.title, {
        texto: pagina.revisions?.[0]?.slots?.main?.content ?? '',
        categorias: (pagina.categories ?? []).map((c) => c.title.replace(/^Category:/, '')),
      });
    }

    // `clcontinue` solo aparece si hay más categorías; si no, la siguiente
    // llamada repetiría la primera página indefinidamente.
    if (datos.continue?.clcontinue) {
      params.clcontinue = datos.continue.clcontinue;
      continuar = datos.continue.clcontinue;
    } else {
      continuar = undefined;
    }
  } while (continuar);

  return salida;
}

interface InfoFichero {
  titulo: string;
  url: string | null;
  miniatura: string | null;
  pagina: string | null;
  ancho: number | null;
  alto: number | null;
  mime: string | null;
  objectName: string | null;
  /** La descripción de la página del fichero. Dice de quién es la imagen. */
  texto: string;
  categorias: string[];
}

async function infoDeFicheros(nombres: string[]): Promise<Map<string, InfoFichero>> {
  const salida = new Map<string, InfoFichero>();
  if (nombres.length === 0) return salida;

  const unicos = [...new Set(nombres)];

  for (const lote of lotes(unicos, LOTE)) {
    const titulos = lote.map((n) => `File:${n}`).join('|');

    const datos = await pedir<RespuestaPaginas & { query?: { pages?: any[] } }>({
      action: 'query',
      prop: 'imageinfo|categories|revisions',
      iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: '320',
      rvprop: 'content',
      rvslots: 'main',
      cllimit: 'max',
      titles: titulos,
    });

    for (const pagina of datos.query?.pages ?? []) {
      if (!pagina?.title) continue;

      const info = pagina.imageinfo?.[0];
      const wikitext = pagina.revisions?.[0]?.slots?.main?.content ?? '';

      salida.set(pagina.title.replace(/^File:/, ''), {
        titulo: pagina.title,
        url: info?.url ?? null,
        miniatura: info?.thumburl ?? null,
        pagina: info?.descriptionurl ?? null,
        ancho: info?.width ?? null,
        alto: info?.height ?? null,
        mime: info?.mime ?? null,
        objectName: info?.extmetadata?.ObjectName?.value ?? null,
        texto: descripcionDeFichero(wikitext),
        categorias: (pagina.categories ?? []).map((c: { title: string }) =>
          c.title.replace(/^Category:/, ''),
        ),
      });
    }
  }

  return salida;
}

/**
 * La descripción de la página de un fichero.
 *
 * Es texto libre escrito por quien subió la imagen, y es lo único que dice de
 * quién es: "Official Bandai image of Agumon from Digimon Web". Se limpian los
 * comentarios HTML y las plantillas de formato, y se quitan las categorías del
 * final, que no son parte de la descripción.
 */
function descripcionDeFichero(wikitext: string): string {
  const texto = wikitext
    .replace(/\[\[(?:Category|File|Image):[^\]]*\]\]/g, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .trim();

  const limpio = limpiar(texto);
  if (limpio === '') return '';

  // No se recorta por palabras clave. Se intentó cortar por "Official"/"Bandai"
  // para quitar el ruido del final y el resultado fue peor que el problema: la
  // procedencia empieza justamente por "Official Bandai image of…", así que
  // quedaba reducida a la palabra "Official".
  return limpio.slice(0, 240);
}

// ================================================================ proceso ===

/**
 * La descripción de la especie.
 *
 * La wiki la pone como la primera frase del artículo, y va PEGADA al nombre:
 *
 *     '''Greymon''' is a Dinosaur Digimon. Greymon's cranial skin has hardened…
 *
 * La primera versión pedía un salto de línea entre el nombre y el texto, así que
 * no casaba con casi nada: salía un 2% de especies con descripción sobre un
 * catálogo en el que la wiki describe prácticamente todas. El dato no faltaba.
 *
 * Y eso es lo peligroso: un informe que miente sobre la fuente hace que un hueco
 * real de la wiki pase por un problema de importación, o al revés. Un 2% de
 * cobertura en descripciones invita a ir a buscarlas, y no hay nada que buscar.
 *
 * Se corta en el primer salto en blanco, plantilla o encabezado, y se descarta si
 * es demasiado corta: eso suele ser un resto de navegación, no una descripción.
 */
function descripcionDe(wikitext: string): string | null {
  const m = /'''[^']{1,60}'''\s*([^\n]+(?:\n(?![\n{}={])[^\n]+)*)/.exec(wikitext);
  if (!m) return null;

  const texto = limpiar(m[1]!);
  if (texto.length < 40) return null;

  return texto.slice(0, 600);
}

/** Los nombres alternativos declarados: japonés, chino, otros idiomas. */
function nombresAlternativosDe(p: Record<string, string>): string[] {
  const salida = new Set<string>();

  for (const clave of ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'zh', 'ja', 'de', 'es']) {
    const valor = p[clave];
    if (!valor) continue;

    // `n1` viene con el idioma delante, entre paréntesis y en negrita, y el
    // nombre japonés va dentro de un `<ref>` que se quiere quitar. El ejemplo
    // literal no se pone aquí a propósito: el escáner de caracteres corruptos
    // contaría el japonés citado como una corrupción, y un dato real
    // legitimamente citado no debe hacer que la comprobación se queje.
    const antes = valor.split('<ref')[0]!.trim();
    const sinEtiqueta = antes.replace(/^\(\s*'''[A-Za-z]{2}:'''\s*\)/, '').trim();

    if (sinEtiqueta !== '' && !/^[A-Za-z]{2}:$/.test(sinEtiqueta)) salida.add(sinEtiqueta);
  }

  return [...salida];
}

console.log('=== IMPORTADOR DEL CATÁLOGO DE DIGIMON ===\n');
console.log(`Fuente: ${SITIO}`);
console.log(`Categoría: ${CATEGORIA}`);
console.log(`Destino: src/data/catalogo.json`);
if (LIMITE > 0) console.log(`Límite: ${LIMITE} páginas (para pruebas)`);
console.log('');

const miembros = await listarCategoria(CATEGORIA);

const paginas = LIMITE > 0 ? miembros.slice(0, LIMITE) : miembros;
console.log(`\nA importar: ${paginas.length} páginas\n`);

// --- 1. wikitextt + categorías -------------------------------------------
console.log('1/3 · descargando artículos...');

const articulos = new Map<string, { texto: string; categorias: string[] }>();

const lotesArticulos = lotes(paginas.map((p) => p.title), LOTE);

for (const [i, lote] of lotesArticulos.entries()) {
  const datos = await wikitexttDe(lote);
  for (const [k, v] of datos) articulos.set(k, v);

  if ((i + 1) % 5 === 0 || i === lotesArticulos.length - 1) {
    console.log(`  ${articulos.size}/${paginas.length}`);
  }
}

// --- 2. qué es una especie y cuál es su imagen ----------------------------
console.log('\n2/3 · identificando especies y sus imágenes...');

interface Preliminar {
  titulo: string;
  nombre: string;
  parametros: Record<string, string>;
  categorias: string[];
}

const preliminares: Preliminar[] = [];
const ficheros: string[] = [];
const descartadas: { titulo: string; motivo: string }[] = [];

for (const p of paginas) {
  const art = articulos.get(p.title);
  if (!art) {
    descartadas.push({ titulo: p.title, motivo: 'no se pudo descargar el artículo' });
    continue;
  }

  const plantilla = extraerPlantilla(art.texto, 'Digimon Infobox');
  if (!plantilla) {
    // Sin infobox no hay nivel ni tipo, y sin ellos no se puede saber si esto es
    // una especie o un artículo de otra cosa. La categoría de la wiki incluye
    // algunabage; esto es lo que lo separa.
    descartadas.push({ titulo: p.title, motivo: 'sin infobox de especie' });
    continue;
  }

  const params = parametros(plantilla);

  // La comparación va sobre el valor LIMPIO: el nivel puede venir con
  // referencias o plantillas que no deben impedir reconocerlo.
  const nivelLimpio = limpiar(params.level ?? '');
  const tipoLimpio = limpiar(params.type ?? '');

  if (nivelLimpio === '' || tipoLimpio === '') {
    descartadas.push({ titulo: p.title, motivo: 'sin nivel o sin tipo en el infobox' });
    continue;
  }

  // La imagen se busca en el valor CRUDO: es un enlace a fichero, y limpiar()
  // le quita los corchetes.
  const imagen = /^\s*\[\[\s*File:([^\]|]+)/i.exec(params.image ?? '');
  if (imagen) ficheros.push(imagen[1]!.trim());

  preliminares.push({
    titulo: p.title,
    nombre: limpiar(params.name ?? "") || baseDe(p.title),
    parametros: params,
    categorias: art.categorias,
  });
}

console.log(`  especies con nivel y tipo: ${preliminares.length}`);
console.log(`  descartadas: ${descartadas.length}`);
console.log(`  ficheros de imagen distintos: ${new Set(ficheros).size}`);

// --- 3. metadatos de las imágenes ----------------------------------------
console.log('\n3/3 · descargando metadatos de imagen...');

const infoImagenes = await infoDeFicheros(ficheros);
console.log(`  resueltos: ${infoImagenes.size}/${new Set(ficheros).size}`);

// --- 4. construir las entradas -------------------------------------------
console.log('\n4/4 · construyendo el catálogo...');

/** Especies cuya fuente las declara evolucionadas a sí mismas. */
const autoEvolucion = new Set<string>();

const entradas: EntradaCatalogo[] = [];

for (const pre of preliminares) {
  const p = pre.parametros;
  const nombre = pre.nombre;

  const imagenRaw = /^\s*\[\[File:([^\]|]+)/i.exec(p.image ?? '');
  const nombreFichero = imagenRaw?.[1]?.trim() ?? null;
  const info = nombreFichero ? infoImagenes.get(nombreFichero) : undefined;

  const licencia = licenciaDe(info?.texto ?? null, info?.categorias[0] ?? null);
  const correspondencia = correspondenciaDe(nombre, info?.objectName ?? null);

  const nivel = campo(limpiar(p.level));
  const tipo = campo(limpiar(p.type));
  const atributo = campo(limpiar(p.attribute));
  const atributo2 = campo(limpiar(p.attribute2));

  // Los enlaces se leen del valor CRUDO y sin referencias. Sin quitar los
  // `<ref>` primero, los enlaces a las fuentes —'Sale en Digimon Adventure'—
  // entrarían como evoluciones, que es un artículo y no un Digimon.
  const desdeOriginal = enlaces(sinRefs(p.from ?? ''));

  // Una especie que "evoluciona a sí misma" se quita. Pasa en la fuente: Fukamon
  // lista a Fukamon entre sus formas posteriores.
  //
  // No es cosmético. `lineaDe()` resuelve el nombre contra el catálogo, así que
  // un enlace a sí mismo produce un botón que lleva a la misma ficha: el jugador
  // pulsa «evoluciona a» y no pasa nada, sin ninguna explicación. Quitarlo aquí y
  // dejarlo anotado en `pendientes` es mejor que dejar un botón roto.
  const haciaCruda = enlaces(sinRefs(p.to ?? ''));
  const haciaOriginal = haciaCruda.filter((h) => h !== pre.titulo && h !== nombre);
  if (haciaCruda.length !== haciaOriginal.length) autoEvolucion.add(nombre);



  const familias: string[] = [];
  for (const [clave, valor] of Object.entries(p)) {
    if (!/^family\d*$/.test(clave) || !valor) continue;
    for (const f of limpiar(valor).split(',')) {
      const limpio = f.trim();
      if (limpio !== '' && limpio !== 'Unknown' && !familias.includes(limpio)) familias.push(limpio);
    }
  }

  const nombresAlternativos = nombresAlternativosDe(p);

  const imagen: ImagenCatalogo = {
    url: info?.url ?? null,
    miniatura: info?.miniatura ?? null,
    pagina: info?.pagina ?? null,
    fichero: nombreFichero,
    origen: info?.texto ?? null,
    categoria: info?.categorias[0] ?? null,
    licencia: licencia.licencia,
    licenciaUrl: licencia.licenciaUrl,
    ancho: info?.ancho ?? null,
    alto: info?.alto ?? null,
    mime: info?.mime ?? null,
    correspondencia: correspondencia.estado,
    detalleCorrespondencia: correspondencia.detalle,
  };

  const pendientes: string[] = [];
  for (const [nombreCampo, c] of [
    ['nivel', nivel],
    ['tipo', tipo],
    ['atributo', atributo],
    ['familias', { valor: familias.join(', '), estado: familias.length > 0 ? 'verificado' : 'pendiente' } as Campo],
  ] as [string, Campo][]) {
    if (c.estado !== 'verificado') pendientes.push(nombreCampo);
  }

  if (!imagen.url) pendientes.push('imagen');
  if (imagen.correspondencia !== 'verificado') pendientes.push('imagen-correspondencia');
  if (nombresAlternativos.length === 0) pendientes.push('nombres-alternativos');
  if (autoEvolucion.has(nombre)) {
    // La fuente lista a la especie entre sus propias formas posteriores. Se quita
    // el enlace y se deja constancia: el motivo está en el comentario de arriba.
    pendientes.push('auto-evolucion-en-fuente');
  }

  entradas.push({
    key: claveDe(nombre),
    nombre,
    pagina: pre.titulo,
    nombreBase: baseDe(nombre),

    nivel,
    tipo,
    atributo,
    atributo2,
    familias: campo(familias.join(', ')),
    nombresAlternativos: campo(nombresAlternativos.join(' | ')),

    desde: desdeOriginal,
    hacia: haciaOriginal,
    esFormaFinal: haciaOriginal.length === 0,

    ataques: extraerAtaques(articulos.get(pre.titulo)?.texto ?? ''),

    descripcion: descripcionDe(articulos.get(pre.titulo)?.texto ?? ''),

    imagen,
    categorias: pre.categorias,

    procedencia: {
      sitio: 'Digimon Fandom',
      pagina: pre.titulo,
      url: `${SITIO}/wiki/${encodeURIComponent(pre.titulo.replace(/ /g, '_'))}`,
      descargado: new Date().toISOString(),
    },

    pendientes,
  });
}

// Ordenar por nombre: el catálogo se lee y se audita mucho mejor ordenado.
entradas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

/**
 * Segunda pasada sobre las imágenes sospechosas.
 *
 * La comprobación por nombre marca como `difiere` cualquier fichero cuyo
 * `ObjectName` no encaja. Eso mezcla DOS cosas muy distintas:
 *
 *   - ERROR REAL: el fichero dice pertenecer a OTRA especie que sí existe en el
 *     catálogo. Amon venía con el arte de una carta de Goddramon; At, con el de
 *     Jesmon. La imagen no es de esta especie y hay que descartarla.
 *
 *   - NOMBRE DUDOSO: el fichero no corresponde a ninguna especie. Un escaneo de
 *     carta (`N-12 10 1.jpg`), una captura de Twitter (`Digimon Twitter
 *     2019-12-24 b.jpg`). Puede ser la imagen correcta con un nombre que no dice
 *     nada, y eso hay que mirarlo a mano.
 *
 * Tratarlos igual servía de poco en los dos sentidos: se descartaban imágenes
 * buenas, y se dejaban pasar imágenes claramente de otra especie. Con los nombres
 * del catálogo ya conocidos, la diferencia se puede hacer de verdad.
 *
 * Solo se DESCARTA la imagen cuando hay otra especie que se le puede señalar.
 * Ante la duda se mantiene y se marca para revisión manual: tirar una imagen
 * válida no se puede deshacer, y una imagen dudosa solo ocupa un sitio.
 */
{
  // Solo se comparan NOMBRES COMPLETOS de especie, no palabras sueltas.
  //
  // Se probó con palabras sueltas y tiraba imágenes correctas: la palabra `Ultimate`
  // dentro de «Daemon (Super Ultimate)» se tomaba por el nombre de una especie, y
  // `BanchoLeomon Burst Mode` acababa con la imagen de `BanchoLeomon`, que es
  // justamente la suya. Una heurística que tira lo bueno no es prudente: es ruido.
  const conocida = new Set<string>();

  for (const e of entradas) {
    conocida.add(claveDe(baseDe(e.nombre)));
    conocida.add(claveDe(e.nombre));
  }

  let descartadas = 0;
  let aRevisar = 0;

  for (const e of entradas) {
    if (e.imagen.correspondencia !== 'difiere') continue;

    // El `detalle` lleva el nombre que declara el fichero entre comillas. Se saca
    // de ahí porque es el único sitio donde quedó, pero se NORMALIZA igual que en
    // la primera pasada: sin quitar el sufijo de arte, `Jesmon b` daba `jesmon_b`
    // y no coincidía con ninguna especie, y todas las detecciones de imagen
    // equivocada desaparecían sin dar error.
    const objectName = e.imagen.detalleCorrespondencia.match(/"([^"]+)"/)?.[1] ?? '';
    const deQuien = normalizaArte(objectName);
    const propio = claveDe(baseDe(e.nombre));

    // ¿El fichero pertenece a una OTRA especie que existe en el catálogo?
    const esDeOtra = deQuien !== '' && deQuien !== propio && esEspecie(conocida, deQuien);

    if (esDeOtra) {
      e.imagen.detalleCorrespondencia =
        `el fichero es de "${objectName}", que es otra especie del catálogo. ` +
        `Se descarta: no es la imagen de ${e.nombre}.`;

      // Se vacían las URLs para que la ficha muestre "sin imagen verificada" en
      // lugar de un enlace a la ilustración de otro Digimon. Es lo que pediste:
      // no sustituir una imagen por otra parecida.
      e.imagen.url = null;
      e.imagen.miniatura = null;

      e.pendientes = e.pendientes.filter((p) => p !== 'imagen');
      e.pendientes.push('imagen-equivocada');
      descartadas++;
    } else {
      e.imagen.correspondencia = 'pendiente';
      e.imagen.detalleCorrespondencia =
        `el fichero se llama "${e.imagen.fichero}" y no se sabe de qué especie es. ` +
        `Hay que mirarlo a mano; no se descarta porque un nombre que no dice nada ` +
        `no significa que la imagen sea de otro.`;
      e.pendientes = e.pendientes.filter((p) => p !== 'imagen-correspondencia');
      e.pendientes.push('imagen-revisar');
      aRevisar++;
    }
  }

  console.log(`  imágenes descartadas por ser de otra especie: ${descartadas}`);
  console.log(`  imágenes con nombre dudoso, a revisar:         ${aRevisar}`);
}

/** Si un identificador corresponde a alguna especie del catálogo. */
function esEspecie(conocida: Set<string>, clave: string): boolean {
  if (clave === '') return false;
  if (conocida.has(clave)) return true;

  // Las variantes llevan sufijo: `cherrymon_mega` existe junto a `cherrymon`.
  for (const n of conocida) {
    if (n.startsWith(`${clave}_`)) return true;
  }

  return false;
}

/**
 * Rompe las claves repetidas.
 *
 * Hay páginas distintas que declaran el MISMO `|name=`. El caso real:
 * `Cherrymon` y `Cherrymon (Mega)` ponen las dos `|name=Cherrymon`, y son
 * Digimons distintos — la una es Ultimate y la otra Mega. Con la clave derivada
 * solo del nombre, una pisaba a la otra y el catálogo perdía una especie sin
 * avisar: `entradaDe('cherrymon')` devolvía siempre la misma.
 *
 * La clave sale del nombre, pero cuando dos la comparten se le añade el matiz
 * del TÍTULO de la página, que es lo que las distingue. El título es la única
 * fuente que no se repite aquí.
 *
 * No se descarta ninguna entrada. Descartar una sería tapar el problema: el
 * Megamon existe, y que la wiki no lo nombre bien es un dato sobre la wiki, no
 * una razón para borrarlo del catálogo.
 */
{
  const cuenta = new Map<string, number>();

  for (const e of entradas) cuenta.set(e.key, (cuenta.get(e.key) ?? 0) + 1);

  const repetidas = new Set([...cuenta.entries()].filter(([, n]) => n > 1).map(([k]) => k));

  for (const e of entradas) {
    if (!repetidas.has(e.key)) continue;

    // El matiz del título: lo que hay entre paréntesis, si lo hay.
    const matiz = /^(.+?)\s*\(([^)]+)\)\s*$/.exec(e.pagina);
    const nuevo = matiz ? `${claveDe(matiz[1]!)}_${claveDe(matiz[2]!)}` : null;

    if (nuevo && nuevo !== e.key && !cuenta.has(nuevo)) {
      e.key = nuevo;
      cuenta.set(nuevo, 1);
      continue;
    }

    // Sin matiz utilizable: se numeran. Es peor que un matiz, pero mantiene la
    // entrada viva y marca en `pendientes` que el nombre es ambiguo.
    let i = 2;
    while (cuenta.has(`${e.key}_${i}`)) i++;
    e.key = `${e.key}_${i}`;
    cuenta.set(e.key, 1);
    e.pendientes.push('nombre-ambiguo');
  }
}

const documento = {
  meta: {
    generado: new Date().toISOString(),
    fuente: 'Digimon Fandom (API de MediaWiki)',
    sitio: SITIO,
    categoria: `Category:${CATEGORIA}`,
    aviso:
      'Las ilustraciones son material oficial de Bandai/Toei y la wiki las marca como no libre. ' +
      'Aquí solo se guardan URL y metadatos; no se copia ninguna imagen. Muestra las ' +
      'URLs y la procedencia, y decide tú si enlazas o no.',
    comoLeerLaLicencia:
      'La API no expone la licencia en `extmetadata`: sale del texto y las categorías de la ' +
      'página del fichero. Aquí se guarda ese texto tal cual y se deriva una clasificación ' +
      'conservadora. Lo que no se ha podido verificar se marca como tal.',
    reglas: {
      soloConNivelYTipo:
        'Una página sin `|level=` o sin `|type=` no entra. La categoría de la wiki mezcla ' +
        'especies con objetos y artículos de otro tipo, y esa es la regla que las separa.',
      correspondenciaDeImagen:
        'Se compara el `ObjectName` del fichero con el nombre de la especie. Si no coincide ' +
        'se marca `difiere` y no se da por buena: es la señal de que hay que mirar a mano.',
    },
    descartadas: descartadas.length,
  },

  entradas,
};

mkdirSync(dirname(SALIDA), { recursive: true });
writeFileSync(SALIDA, `${JSON.stringify(documento, null, 1)}\n`);

console.log('');
console.log(`Escrito: src/data/catalogo.json`);
console.log(`  especies: ${entradas.length}`);
console.log(`  con imagen: ${entradas.filter((e) => e.imagen.url !== null).length}`);
console.log(`  con ataques: ${entradas.filter((e) => e.ataques.length > 0).length}`);
console.log(`  forma final documentada: ${entradas.filter((e) => e.esFormaFinal).length}`);
console.log(`  con alguna forma anterior: ${entradas.filter((e) => e.desde.length > 0).length}`);

