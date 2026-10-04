import ARCHIVO from '../data/dex.json' with { type: 'json' };
import ACEPTADAS from '../data/dex-accepted.json' with { type: 'json' };
import { SPECIES } from './species.js';
import type { Attribute, Tier } from './types.js';
import {
  DEX_ATTRIBUTES,
  DEX_LEVELS,
  REQUIRED_FIELDS,
  type AcceptedDivergence,
  type DexAttribute,
  type DexEntry,
  type DexFile,
  type DexLevel,
} from './dexTypes.js';

/**
 * Bestiario de referencia, leído del JSON local.
 *
 * El JSON lo genera `tools/import-dex.ts` y va compilado dentro del bot: aquí no
 * hay ninguna llamada de red, ni al importar ni al pintar una pantalla. Abrir el
 * Digivice no depende de que Fandom esté en pie.
 *
 * Lo que este módulo hace, y es lo importante, es COMPARAR el bestiario con el
 * catálogo del juego y decir dónde discrepan. No corrige en silencio: si el wiki
 * dice que MetalGreymon es Vaccine y el juego lo tiene como Virus, eso sale en
 * el informe y decide alguien, porque cambiarlo toca el equilibrio del combate.
 */

const datos = ARCHIVO as unknown as DexFile;

/**
 * Divergencias ya revisadas y aceptadas.
 *
 * El juego NO es el canon de la wiki, y no por descuido: Agumon es `virus` aqui y
 * `Vaccine` en la wiki, y hay 30 diferencias entre los dos catalogos. Eso es diseno.
 *
 * Por eso hay un baseline. Un informe que falle en cada importacion no informa de nada:
 * el dia que aparezca una diferencia de verdad, con treinta avisos de fondo nadie la ve.
 * Las aceptadas se anotan una vez con su motivo; a partir de ahi solo se senalan las nuevas.
 */
const aceptadas = new Map<string, string>();
for (const d of (ACEPTADAS as unknown as { divergencias: AcceptedDivergence[] }).divergencias) {
  aceptadas.set(`${d.speciesKey}:${d.kind}`, d.motivo);
}

/** Motivo por el que una divergencia esta aceptada, si lo esta. */
function motivoAceptado(speciesKey: string, kind: string): string | null {
  return aceptadas.get(`${speciesKey}:${kind}`) ?? null;
}

const POR_CLAVE = new Map<string, DexEntry>();
for (const entrada of datos.entries) {
  POR_CLAVE.set(entrada.speciesKey, entrada);
}

// ------------------------------------------------- correspondencia de taxonomías

/**
 * Nivel de la wiki -> `tier` del juego.
 *
 * El mapa NO es uno a uno, y no debería serlo. El canon tiene seis etapas y Fresh
 * abajo de In-Training; el juego tiene `inicial` para los starters, que es un
 * conjunto más pequeño que Fresh. Se mapea Fresh a `inicial` porque es la única
 * banda por debajo de `diminuto` que existe, y la diferencia de alcance la acepta
 * `dex-accepted.json` cuando la hay.
 *
 * `Ultra` se mapea a `mega` porque el juego no tiene Super Ultimate: es una
 * diferencia de alcance de contenido, no un error de traducción.
 */
const NIVEL_A_TIER: Record<DexLevel, Tier> = {
  Fresh: 'inicial',
  'In-Training': 'diminuto',
  Rookie: 'inicial',
  Champion: 'campeon',
  Ultimate: 'ultimate',
  Mega: 'mega',
  Ultra: 'mega',
};

/** Atributo de la wiki -> atributo del juego. */
const ATRIBUTO_A_ATTRIBUTE: Record<DexAttribute, Attribute> = {
  Vaccine: 'vacuna',
  Virus: 'virus',
  Data: 'datos',
  Free: 'free',
  Variable: 'variable',
  Unknown: 'unknown',
  None: 'sin_datos',
};

export const LEVEL_NAMES_ES: Record<DexLevel, string> = {
  Fresh: 'Fresh',
  'In-Training': 'In-Training',
  Rookie: 'Rookie',
  Champion: 'Champion',
  Ultimate: 'Ultimate',
  Mega: 'Mega',
  Ultra: 'Super Ultimate',
};

// ------------------------------------------------------------------ acceso --

/** Ficha de referencia de una especie, o `null` si no se pudo importar. */
export function dexOf(speciesKey: string): DexEntry | null {
  return POR_CLAVE.get(speciesKey) ?? null;
}

export function hasDex(speciesKey: string): boolean {
  return POR_CLAVE.has(speciesKey);
}

/** Familias de una especie. Vacío si no hay ficha o la wiki no las traía. */
export function familiesOf(speciesKey: string): string[] {
  return POR_CLAVE.get(speciesKey)?.families ?? [];
}

/** Families que comparten al menos una especie: vista de grupo del bestiario. */
export function familyIndex(): Map<string, string[]> {
  const indice = new Map<string, string[]>();
  for (const entrada of datos.entries) {
    for (const familia of entrada.families) {
      const lista = indice.get(familia) ?? [];
      lista.push(entrada.speciesKey);
      indice.set(familia, lista);
    }
  }
  return indice;
}

// ------------------------------------------------------ vista para la UI ---

export interface SpeciesRef {
  key: string;
  name: string;
  /** Nombre canónico de la wiki, si es distinto. */
  canonicalName: string | null;
  level: DexLevel | null;
  type: string | null;
  attribute: DexAttribute | null;
  attribute2: DexAttribute | null;
  families: string[];
  imageUrl: string | null;
  thumbnailUrl: string | null;
  sourceUrl: string | null;
  /** `true` si la imagen es de uso justo: enlazable, no redistribuible. */
  imageNonFree: boolean;
  imported: boolean;
}

/**
 * Datos de referencia listos para pintar.
 *
 * Devuelve `null` si la especie no se pudo importar: las pantallas tienen que
 * poder trabajar con una especie a la que le falte media ficha, no reventar.
 */
export function refOf(speciesKey: string): SpeciesRef | null {
  const entrada = dexOf(speciesKey);
  if (!entrada) return null;

  return {
    key: speciesKey,
    name: entrada.name,
    canonicalName: entrada.name === SPECIES[speciesKey]?.name ? null : entrada.name,
    level: entrada.level,
    type: entrada.type,
    attribute: entrada.attribute,
    attribute2: entrada.attribute2,
    families: entrada.families,
    imageUrl: entrada.image?.url ?? null,
    thumbnailUrl: entrada.image?.thumbnail ?? null,
    sourceUrl: entrada.provenance.url,
    imageNonFree: entrada.image?.license === 'non-free',
    imported: true,
  };
}

/**
 * Una ficha de referencia siempre, aunque esté vacía.
 *
 * Para el bestiario: una especie sin importar tiene que aparecer como hueco
 * conocido, no desaparecer del índice.
 */
export function refOrEmpty(speciesKey: string): SpeciesRef {
  return (
    refOf(speciesKey) ?? {
      key: speciesKey,
      name: SPECIES[speciesKey]?.name ?? speciesKey,
      canonicalName: null,
      level: null,
      type: null,
      attribute: null,
      attribute2: null,
      families: [],
      imageUrl: null,
      thumbnailUrl: null,
      sourceUrl: null,
      imageNonFree: false,
      imported: false,
    }
  );
}

// ------------------------------------------------------------ validación ---

export interface DexProblem {
  speciesKey: string;
  name: string;
  kind:
    | 'sin-ficha'
    | 'campo-vacio'
    | 'atributo-difiere'
    | 'nivel-difiere'
    | 'tipo-distinto'
    | 'segundo-atributo'
    | 'alias'
    | 'imagen-no-libre'
    | 'valor-fuera-de-taxonomia';
  detail: string;
  /**
   * Si esta diferencia está en el baseline de aceptadas.
   *
   * Un problema aceptado NO es un fallo: está documentado y tiene su motivo. Uno
   * sin aceptar es nuevo y necesita que alguien decida.
   */
  aceptada: boolean;
  /** Por qué se acepta, si se acepta. */
  motivo: string | null;
}

export interface DexReport {
  total: number;
  imported: number;
  /** Cobertura por campo obligatorio. */
  coverage: Record<string, number>;
  problems: DexProblem[];
  generatedAt: string;
  source: DexFile['source'];
}

/**
 * Compara el bestiario con el catálogo y devuelve el informe.
 *
 * Esto es lo que ejecuta `npm run check:dex`. Clasifica porque las diferencias
 * no son todas iguales:
 *
 * - `atributo-difiere` y `nivel-difiere` son serias: son los dos datos que el
 *   juego usa en combate y en matchmaking.
 * - `tipo-distinto` es ESPERADA y no es un error: son dos taxonomías.
 * - `segundo-atributo` es información que el modelo no representa, no un fallo.
 * - `valor-fuera-de-taxonomia` es que la fuente se sale de su propia lista.
 */
export function dexReport(): DexReport {
  const claves = Object.keys(SPECIES);
  const problemas: DexProblem[] = [];
  const coverage: Record<string, number> = {};

  for (const campo of REQUIRED_FIELDS) coverage[campo] = 0;

  const anotar = (
    speciesKey: string,
    name: string,
    kind: DexProblem['kind'],
    detail: string,
    aceptada: boolean,
    motivo: string | null,
  ) => {
    problemas.push({ speciesKey, name, kind, detail, aceptada, motivo });
  };

  for (const key of claves) {
    const species = SPECIES[key]!;
    const entrada = dexOf(key);

    // ---------------------------------------------------- sin ficha ---------
    if (!entrada) {
      anotar(
        key,
        species.name,
        'sin-ficha',
        'no se pudo importar',
        motivoAceptado(key, 'sin-ficha') !== null,
        motivoAceptado(key, 'sin-ficha'),
      );
      continue;
    }

    // ------------------------------------------------------ alias ------------
    if (entrada.provenance.viaAlias) {
      // Un alias SIEMPRE es decisión de alguien, así que va aceptado por
      // definición: lo que hay que revisar es el motivo, que se imprime.
      anotar(
        key,
        species.name,
        'alias',
        `"${entrada.name}" — ${entrada.provenance.viaAlias}`,
        true,
        entrada.provenance.viaAlias,
      );
    }

    // ------------------------------------------------- cobertura ------------
    if (entrada.level) coverage.level!++;
    if (entrada.type) coverage.type!++;
    if (entrada.attribute) coverage.attribute!++;
    if (entrada.families.length > 0) coverage.families!++;
    if (entrada.image) coverage.image!++;

    // Un campo obligatorio vacío nunca se "acepta": o se importó, o no.
    const vacios: string[] = [];
    if (!entrada.level) vacios.push('Level');
    if (!entrada.type) vacios.push('Type');
    if (!entrada.attribute) vacios.push('Attribute');
    if (entrada.families.length === 0) vacios.push('Family');
    if (!entrada.image) vacios.push('Image');

    if (vacios.length > 0) {
      anotar(key, species.name, 'campo-vacio', vacios.join(' + '), false, null);
    }

    // ------------------------------------ valor fuera de la taxonomía --------
    //
    // Diaboromon trae `attribute=Unidentified`, que no es uno de los siete
    // valores de la wiki. Si se descarta en silencio, el informe dice "falta
    // Attribute" sin decir que la fuente SÍ puso algo.
    for (const campo of ['level', 'attribute', 'attribute2'] as const) {
      if (!entrada[campo] && entrada.raw[campo]) {
        anotar(
          key,
          species.name,
          'valor-fuera-de-taxonomia',
          `${campo}="${entrada.raw[campo]}" no es un valor válido de la fuente`,
          motivoAceptado(key, 'valor-fuera-de-taxonomia') !== null,
          motivoAceptado(key, 'valor-fuera-de-taxonomia'),
        );
      }
    }

    // ------------------------------------------- atributo ------------------
    if (entrada.attribute) {
      const delJuego = ATRIBUTO_A_ATTRIBUTE[entrada.attribute];
      if (delJuego !== species.attribute) {
        anotar(
          key,
          species.name,
          'atributo-difiere',
          `juego=${species.attribute}  wiki=${entrada.attribute}`,
          motivoAceptado(key, 'atributo-difiere') !== null,
          motivoAceptado(key, 'atributo-difiere'),
        );
      }
    }

    if (entrada.attribute2) {
      anotar(
        key,
        species.name,
        'segundo-atributo',
        `${entrada.attribute}/${entrada.attribute2}`,
        true,
        'El triángulo del juego admite un solo atributo y la wiki da dos. Se guarda y se muestra; no se usa en combate.',
      );
    }

    // ----------------------------------------------- nivel -----------------
    if (entrada.level) {
      const delJuego = NIVEL_A_TIER[entrada.level];
      if (delJuego !== species.tier) {
        anotar(
          key,
          species.name,
          'nivel-difiere',
          `juego=${species.tier}  wiki=${entrada.level}`,
          motivoAceptado(key, 'nivel-difiere') !== null,
          motivoAceptado(key, 'nivel-difiere'),
        );
      }
    }

    // ------------------------------------------------- tipo -----------------
    //
    // El tipo NO se compara: son taxonomías distintas (la wiki clasifica por
    // biología, el juego por elemento de combate). Sobrescribir una con la otra
    // dejaría el combate sin afinidades. Solo se deja constancia.
    if (entrada.type) {
      anotar(
        key,
        species.name,
        'tipo-distinto',
        `juego=[${species.elements.join(', ')}]  wiki=[${entrada.type}]`,
        true,
        null,
      );
    }

    // ------------------------------------------------ imagen ----------------
    if (entrada.image && entrada.image.license === 'non-free') {
      anotar(
        key,
        species.name,
        'imagen-no-libre',
        'uso justo: se enlaza, no se redistribuye',
        true,
        null,
      );
    }
  }

  return {
    total: claves.length,
    imported: claves.filter((k) => POR_CLAVE.has(k)).length,
    coverage,
    problems: problemas,
    generatedAt: datos.generatedAt,
    source: datos.source,
  };
}

export function dexCoverage(): { key: string; label: string; have: number; total: number }[] {
  const informe = dexReport();
  const etiquetas: Record<string, string> = {
    level: 'Level',
    type: 'Type',
    attribute: 'Attribute',
    families: 'Family',
    image: 'Image',
  };

  return REQUIRED_FIELDS.map((campo) => ({
    key: campo,
    label: etiquetas[campo] ?? campo,
    have: informe.coverage[campo] ?? 0,
    total: informe.imported,
  }));
}

export const DEX_SOURCE = datos.source;
export const DEX_GENERATED_AT = datos.generatedAt;
export { DEX_LEVELS, DEX_ATTRIBUTES, NIVEL_A_TIER, ATRIBUTO_A_ATTRIBUTE };
export type { DexEntry, DexLevel, DexAttribute };