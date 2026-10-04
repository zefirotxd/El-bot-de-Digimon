/**
 * Importador del bestiario de referencia.
 *
 * Se ejecuta a mano, NO en tiempo de ejecución:
 *
 *     npx tsx tools/import-dex.ts
 *
 * Lee `src/game/species.ts`, consulta la API de MediaWiki de Digimon Fandom para
 * cada especie, extrae los campos del `{{Digimon Infobox}}` y escribe
 * `src/data/dex.json`.
 *
 * El bot NUNCA hace fetch. Eso no es solo una optimisation: si el Digivice
 * dependiera de que Fandom esté disponible cada vez que alguien abre una
 * pantalla, un rate-limit o una caída de la wiki dejaría el juego sin bestiario
 * entero. El JSON va compilado dentro del bot y se regenera cuando quieras.
 *
 * Sobre las fuentes: se usa la API de MediaWiki, no un scrape del HTML. La
 * diferencia importa — el infobox tiene parámetros con nombre (`|level=`,
 * `|type=`) y eso se puede leer de forma fiable; el HTML renderizado no.
 */

/** API de MediaWiki de Digimon Fandom. */
const API = 'https://digimon.fandom.com/api.php';
const SITIO = 'https://digimon.fandom.com';

/**
 * Fandom rechaza el user-agent por defecto con 403. Hay que identificarse.
 */
const USER_AGENT =
  'DigimonMMO/0.1 (importador de catalogo; uso no comercial; bot de Discord)';

/** Espera entre peticiones. Fandom no perdona. */
const PAUSA_MS = 400;

/** Parámetros del infobox que se leen. */
const CAMPOS = [
  'level',
  'type',
  'attribute',
  'attribute2',
  'family',
  'family2',
  'family3',
  'family4',
  'family5',
  'image',
] as const;

/**
 * Los niveles que la fuente escribe y este bestiario acepta.
 *
 * `Fresh` estaba fuera y por eso Pabumon salía como "level fuera de la
 * taxonomía". No es un dato raro: es el nivel que la fuente le da, y el nivel más
 * bajo del canon.
 *
 * Lo que se hace con un valor que NO está en esta lista es dejarlo a `null` y
 * reportarlo, no encajarlo en el más parecido. Un bestiario de referencia que
 * necesita un valor para cada cosa que encuentra acaba guardando el equivocado sin
 * que nadie lo note.
 *
 * `Hybrid`, `Jogress`, `Burst Mode` y `Armor` no están y no deben estar: son
 * clases de forma, no etapas evolutivas. El catálogo grande (`catalogo.ts`) las
 * distingue y las muestra aparte.
 */
const NIVELES = new Set([
  'Fresh',
  'In-Training',
  'Rookie',
  'Champion',
  'Ultimate',
  'Mega',
  'Ultra',
]);

const ATRIBUTOS = new Set([
  'Vaccine',
  'Virus',
  'Data',
  'Free',
  'Variable',
  'Unknown',
  'None',
]);

/**
 * Nombres que no coinciden, y páginas de desambiguación.
 *
 * Cada entrada está justificada y es editable: son las únicas decisiones que
 * toma un humano, y están aquí a la vista en vez de enterradas en el código.
 * Un alias equivocado mete datos de otra especie, y eso no se detecta solo.
 */
const ALIAS: Record<string, { pagina: string; motivo: string }> = {
  // El catálogo usa nombres del doblaje español; el wiki, los canonicos.
  paulmon: {
    pagina: 'Palmon',
    motivo: 'El canonico es Palmon. El proyecto usa la grafia del doblaje.',
  },
  valemon: {
    pagina: 'Veemon',
    motivo:
      'Valemon no existe en el canonico. El proyecto probablemente queria Veemon (Kunemon/Veemon, Rookie). REVISAR: puede ser otra especie.',
  },

  // Paginas de desambiguacion: hay que elegir la variante canonica.
  metalgreymon: {
    pagina: 'MetalGreymon (Vaccine)',
    motivo: 'La pagina base es {{disambig}}. Se elige la variante Vaccine, que es la canonica.',
  },
  cherubimon: {
    pagina: 'Cherubimon (Good)',
    motivo: 'La pagina base es {{disambig}}. Se elige Good, que corresponde a atributo Vacuna del proyecto.',
  },
};

/**
 * Especies sin pagina en la wiki.
 *
 * No se inventan datos ni se borra la especie: se deja el hueco y se reporta.
 * Que alguien decida si el nombre está mal o si la wiki no lo tiene.
 */
const SIN_PAGINA = new Set(['veldmon']);

// ------------------------------------------------------------------ red ----

interface RespuestaParse {
  parse?: { title: string; wikitext: string };
  error?: { code: string; info: string };
}

interface RespuestaImagen {
  query?: {
    pages?: {
      title: string;
      missing?: boolean;
      original?: { source: string; width: number; height: number };
      thumbnail?: { source: string; width: number; height: number };
    }[];
  };
}

async function pedir<T>(url: string, intentos = 4): Promise<T | null> {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(25_000),
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      });

      // 429 y 5xx son transitorios; el resto no.
      if (r.status === 429 || r.status >= 500) {
        await dormir(1200 * (i + 1));
        continue;
      }

      if (!r.ok) return null;
      return (await r.json()) as T;
    } catch {
      await dormir(1200 * (i + 1));
    }
  }
  return null;
}

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ------------------------------------------------------------ extracción ---

/**
 * Saca un parámetro del infobox.
 *
 * Limpia lo que ensucia: comentarios `<!--codigo-->` que son referencias
 * internas de la wiki, `<ref>` de las notas al pie, y el formato `[[A|B]]` de
 * los enlaces, del que solo interesa el texto visible.
 */
function parametro(wikitext: string, campo: string): string | null {
  const m = wikitext.match(new RegExp(`^\\s*\\|\\s*${campo}\\s*=\\s*(.+)$`, 'im'));
  if (!m) return null;

  let v = m[1]!.trim();
  v = v.replace(/<!--[\s\S]*?-->/g, '');
  v = v.replace(/<ref[\s\S]*?<\/ref>/gi, '');
  v = v.replace(/<ref[^>]*\/>/gi, '');
  v = v.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2');
  v = v.replace(/'''/g, '').trim();

  return v === '' ? null : v;
}

function limpiar(wikitext: string, campo: string): string | null {
  const bruto = parametro(wikitext, campo);
  if (!bruto) return null;

  // El tipo puede venir como lista separada por comas o barras.
  if (campo === 'type') {
    return bruto
      .split(/[,/]|\bor\b/i)
      .map((t) => t.trim())
      .filter(Boolean)
      .join(' / ') || null;
  }

  return bruto;
}

async function fichaDe(pagina: string): Promise<{ titulo: string; wikitext: string } | null> {
  const datos = await pedir<RespuestaParse>(
    `${API}?action=parse&page=${encodeURIComponent(pagina)}&prop=wikitext&format=json&formatversion=2&redirects=1`,
  );

  if (!datos || datos.error || !datos.parse) return null;
  return { titulo: datos.parse.title, wikitext: datos.parse.wikitext };
}

async function imagenDe(pagina: string) {
  const datos = await pedir<RespuestaImagen>(
    `${API}?action=query&titles=${encodeURIComponent(pagina)}&prop=pageimages&piprop=original|thumbnail&pithumbsize=320&format=json&formatversion=2&redirects=1`,
  );

  const p = datos?.query?.pages?.[0];
  if (!p || p.missing || !p.original) return null;

  // Lo que hay en el infobox de Fandom es, casi siempre, material de uso justo:
  // enlazable y citable, no redistribuible. Se marca como tal para que nadie
  // lo guarde en el repo por error.
  return {
    url: p.original.source,
    thumbnail: p.thumbnail?.source ?? null,
    width: p.original.width,
    height: p.original.height,
    file: null,
    license: 'non-free' as const,
  };
}

// ------------------------------------------------------------------- main --

async function main(): Promise<void> {
  const repo = await import('../src/game/repository.js');
  void repo;
  const { SPECIES } = await import('../src/game/species.js');
  const { writeFileSync, mkdirSync } = await import('node:fs');

  const claves = Object.keys(SPECIES);
  console.log(`Importando ${claves.length} especies...\n`);

  const entradas = [];
  const fallos: { key: string; nombre: string; motivo: string }[] = [];
  let resueltos = 0;

  for (const key of claves) {
    const nombre = SPECIES[key]!.name;
    const alias = ALIAS[key];

    if (SIN_PAGINA.has(key)) {
      fallos.push({ key, nombre, motivo: 'sin pagina en la wiki con ningun nombre' });
      console.log(`  · ${nombre.padEnd(20)} sin pagina en la wiki`);
      continue;
    }

    const pagina = alias?.pagina ?? nombre;
    const ficha = await fichaDe(pagina);
    await dormir(PAUSA_MS);

    if (!ficha) {
      fallos.push({ key, nombre, motivo: `no se pudo leer "${pagina}"` });
      console.log(`  ✗ ${nombre.padEnd(20)} no se pudo leer "${pagina}"`);
      continue;
    }

    // La pagina de desambiguacion llega con 0 campos: se avisa, no se inventa.
    if (parametro(ficha.wikitext, 'level') === null) {
      fallos.push({
        key,
        nombre,
        motivo: `"${pagina}" existe pero no tiene infobox (¿es una desambiguación?)`,
      });
      console.log(`  ✗ ${nombre.padEnd(20)} "${pagina}" no tiene infobox`);
      continue;
    }

    const levelBruto = limpiar(ficha.wikitext, 'level');
    const attrBruto = limpiar(ficha.wikitext, 'attribute');
    const attr2Bruto = limpiar(ficha.wikitext, 'attribute2');

    // Se guarda lo que puso la wiki, aunque no sea válido en su propia
    // taxonomía. Diaboromon trae `attribute=Unidentified`, que no es uno de los
    // siete: si se descarta sin más, el informe dice "falta Attribute" y no dice
    // que la fuente puso algo.
    const raw: Record<string, string> = {};
    for (const campo of ['level', 'type', 'attribute', 'attribute2'] as const) {
      const valor = limpiar(ficha.wikitext, campo);
      if (valor) raw[campo] = valor;
    }

    const familias = ['family', 'family2', 'family3', 'family4', 'family5']
      .map((c) => limpiar(ficha.wikitext, c))
      .filter((f): f is string => Boolean(f));

    const imagen = await imagenDe(ficha.titulo);
    await dormir(PAUSA_MS);

    const entrada = {
      speciesKey: key,
      name: ficha.titulo,
      level: levelBruto && NIVELES.has(levelBruto) ? (levelBruto as never) : null,
      type: limpiar(ficha.wikitext, 'type'),
      attribute: attrBruto && ATRIBUTOS.has(attrBruto) ? (attrBruto as never) : null,
      attribute2: attr2Bruto && ATRIBUTOS.has(attr2Bruto) ? (attr2Bruto as never) : null,
      raw,
      families: familias,
      image: imagen,
      provenance: {
        page: ficha.titulo,
        url: `${SITIO}/wiki/${encodeURIComponent(ficha.titulo)}`,
        fetchedAt: new Date().toISOString(),
        ...(alias ? { viaAlias: alias.motivo } : {}),
      },
    };

    entradas.push(entrada);
    resueltos++;

    const partes = [
      entrada.level ?? 'nivel?',
      entrada.type ? 'tipo' : 'tipo?',
      entrada.attribute ?? 'attr?',
      familias.length > 0 ? `${familias.length}f` : 'fam?',
      imagen ? 'img' : 'img?',
    ];
    console.log(`  ✓ ${nombre.padEnd(20)} ${partes.join(' · ')}`);
  }

  const salida = {
    source: {
      name: 'Digimon Fandom (MediaWiki API)',
      api: API,
      notice:
        'Contenido bajo CC BY-SA. Las imágenes del infobox son material de uso justo del wiki: ' +
        'se guardan como REFERENCIA y no se redistribuyen. El bot enlaza, no rehostea.',
    },
    generatedAt: new Date().toISOString(),
    entries: entradas,
  };

  mkdirSync('src/data', { recursive: true });
  writeFileSync('src/data/dex.json', JSON.stringify(salida, null, 2) + '\n', 'utf8');

  console.log(`\n${resueltos}/${claves.length} resueltas -> src/data/dex.json`);

  if (fallos.length > 0) {
    console.log('\nSin completar:');
    for (const f of fallos) console.log(`  - ${f.nombre} (${f.key}): ${f.motivo}`);
  }

  if (aliasAvisos()) {
    console.log('\n--- Decisiones tomadas por una persona ---');
    for (const [key, a] of Object.entries(ALIAS)) {
      console.log(`  ${SPECIES[key]!.name} -> "${a.pagina}"`);
      console.log(`    ${a.motivo}`);
    }
  }
}

function aliasAvisos(): boolean {
  return Object.keys(ALIAS).length > 0;
}

await main();