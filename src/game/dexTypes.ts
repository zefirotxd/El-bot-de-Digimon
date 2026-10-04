/**
 * Datos de referencia de especie, importados de una fuente externa.
 *
 * ESTO NO ES LO MISMO QUE `SpeciesDef`.
 *
 * El catálogo del juego es la fuente de verdad del COMBATE: define atributos,
 * afinidades elementales y estadísticas base, y están afinados para que el
 * combate funcione. Los datos de referencia de la wiki describen la ESPECIE
 * BIOLÓGICA dentro del canon, y no tienen por qué encajar.
 *
 * Concretamente hay una trampa en `Type`:
 *
 *   - La wiki usa Type como clasificación biológica: Reptile, Bird, Demon,
 *     Angel, Dragon, Larva, Holy Beast... Veinticuatro tipos distintos.
 *   - El juego usa `elements` como sistema de combate: fuego, hielo, viento,
 *     rayo, agua, tierra, planta, luz, oscuridad, metal, nulo.
 *
 * Son taxonomías DIFERENTES con un nombre parecido. Sobrescribir `elements` con
 * el Type de la wiki dejaría el combate sin STAB ni resistencias. Por eso `type`
 * vive aquí, aparte, y el verificador reporta la divergencia en vez de
 * resolverla por su cuenta.
 *
 * Lo mismo con el atributo: 12 de las 32 especies resueltas tienen DOS
 * atributos en la wiki (`attribute` y `attribute2`), y el triángulo del juego es
 * de uno solo. Se guardan los dos y se reporta el segundo; no se descarta ni se
 * elige el que "suene mejor".
 */

/**
 * Nivel canónico de la wiki. El juego lo llama `tier`.
 *
 * Incluye los valores que la fuente escribe HOY y no solo los de la saga clásica.
 *
 * Se.Checking need the `Fresh` de Pabumon: sin él, `check:dex` lo daba por un nivel
 * «fuera de la taxonomía», que es un error del catálogo de referencia, no un dato
 * raro de la wiki. Un catálogo de referencia que no puede nombrar un valor que la
 * fuente publica tiene un problema de diseño: acaba treating lo legítimo como
 * sospechoso, y a partir de ahí su informe deja de ser creíble.
 *
 * `Hybrid`, `Jogress`, `Burst Mode` y `Armor` NO están aquí a propósito: son clases
 * de FORMA, no etapas evolutivas, y meterlas en la misma lista haría que una
 * pregunta distinta pareciera la misma. El catálogo grande (`catalogo.ts`) los
 * distingue explícitamente.
 */
export type DexLevel =
  | 'Fresh'
  | 'In-Training'
  | 'Rookie'
  | 'Champion'
  | 'Ultimate'
  | 'Mega'
  | 'Ultra';

export const DEX_LEVELS: DexLevel[] = [
  'Fresh',
  'In-Training',
  'Rookie',
  'Champion',
  'Ultimate',
  'Mega',
  'Ultra',
];

/** Atributo canónico, tal cual lo escribe la wiki. */
export type DexAttribute =
  | 'Vaccine'
  | 'Virus'
  | 'Data'
  | 'Free'
  | 'Variable'
  | 'Unknown'
  | 'None';

export const DEX_ATTRIBUTES: DexAttribute[] = [
  'Vaccine',
  'Virus',
  'Data',
  'Free',
  'Variable',
  'Unknown',
  'None',
];

/**
 * Una imagen de la wiki.
 *
 * `license` importa. Casi todo lo que hay en el infobox de Fandom es material
 * de uso justo (*non-free*) para el propio wiki, no para un tercero: se puede
 * enlazar y citar, pero no redistribuir ni rehostar. Por eso el importador
 * guarda la REFERENCIA y no descarga nada, y la interfaz la enseña como enlace.
 */
export interface DexImage {
  /** URL de la imagen en su tamaño completo. */
  url: string;
  /** URL de la miniatura, para listados. */
  thumbnail: string | null;
  width: number | null;
  height: number | null;
  /** Nombre del fichero en la wiki, sin carpeta. */
  file: string | null;
  /**
   * `non-free` = uso justo para el wiki; enlazable y citable, no redistribuible.
   * `libre` = licencia que permitiría guardarla en el repo.
   */
  license: 'non-free' | 'libre' | 'desconocida';
}

/** Cómo se obtuvo cada dato, para poder auditarlo o repetirlo. */
export interface DexProvenance {
  /** Página de la que salió. Puede no ser el nombre del catálogo. */
  page: string;
  url: string;
  /** ISO-8601. */
  fetchedAt: string;
  /** Alias usado, si el nombre del catálogo no era el de la wiki. */
  viaAlias?: string;
}

export interface DexEntry {
  /** Clave del catálogo del juego. Es la que une las dos taxonomías. */
  speciesKey: string;
  /** Nombre canónico en la wiki. Puede no coincidir con el del juego. */
  name: string;

  /** Nivel canónico. `null` si la ficha no lo traía. */
  level: DexLevel | null;
  /** Tipo biológico. Taxononomía distinta a `elements`. */
  type: string | null;
  /** Atributo principal. */
  attribute: DexAttribute | null;
  /**
   * Segundo atributo, cuando existe.
   *
   * El triángulo del juego es de uno solo, así que esto no se usa en combate:
   * se guarda y se reporta. Descartarlo sería perder información real.
   */
  attribute2: DexAttribute | null;
  /**
   * Lo que la wiki puso, aunque no sea un valor válido de su propia taxonomía.
   *
   * Existe por un caso real: Diaboromon trae `attribute=Unidentified`, que no es
   * uno de los siete valores del wiki. Descartarlo en silencio perdía el dato y
   * el informe decía "falta Attribute" sin decir por qué. Con esto el informe
   * puede decir "la wiki puso Unidentified, fuera de su propia taxonomía".
   */
  raw: Partial<Record<RequiredField | 'attribute2', string>>;

  /**
   * Familias, hasta cinco.
   *
   * Campo genuinamente nuevo para el proyecto: no hay nada equivalente en
   * `SpeciesDef` y no interviene en el combate. Sirve para el bestiario y para
   * agrupaciones narrativas.
   */
  families: string[];

  image: DexImage | null;
  provenance: DexProvenance;
}

/** Una divergencia entre el catálogo del juego y el canon, aceptada a mano. */
export interface AcceptedDivergence {
  speciesKey: string;
  kind: 'atributo-difiere' | 'nivel-difiere' | 'sin-ficha';
  /** Lo que dice el juego. */
  game: string;
  /** Lo que dice la fuente. */
  source: string;
  /** Por qué se acepta. */
  motivo: string;
}

export interface DexFile {
  /** Fuente de la que sale todo. */
  source: {
    name: string;
    api: string;
    /** Aviso de licencia, para tener a mano cuando alguien pregunte. */
    notice: string;
  };
  /** ISO-8601 de la última importación. */
  generatedAt: string;
  entries: DexEntry[];
}

/** Los cinco campos que el informe de cobertura mira. */
export const REQUIRED_FIELDS = ['level', 'type', 'attribute', 'families', 'image'] as const;

export type RequiredField = (typeof REQUIRED_FIELDS)[number];