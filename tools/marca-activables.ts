/**
 * Marca qué especies del catálogo están activadas en el juego.
 *
 *     npx tsx tools/marca-activables.ts
 *
 * El catálogo es el universo documentado: 1300 y pico especies. El juego usa un
 * subconjunto. Este script hace el cruce y escribe
 * `src/data/catalogo-activables.json`, que es lo que `catalogo.ts` lee.
 *
 * POR QUÉ UN FICHERO Y NO UN CAMPO EN EL CATÁLOGO
 *
 * Que una especie esté activada en el juego NO es un dato de la wiki: es una
 * decisión de diseño, y depende del balance. Si estuviera dentro de
 * `catalogo.json`, un `import-catalogo.ts` la borraría, porque el importador no
 * sabe nada del juego. Separarlo hace que las dos cosas puedan cambiar por
 * separado y que el cruce sea auditable: aquí se ve exactamente qué clave del
 * juego corresponde a qué ficha.
 *
 * POR QUÉ EL CRUCE ES POR NOMBRE Y NO POR CLAVE
 *
 * La clave del juego es `agumon` y la de la wiki también, pero en cuanto entra
 * una variante la cosa se rompe: `kimeramon` en el juego es `Meramon` en la wiki,
 * y hay `kimeramon` en la wiki que es OTRO Digimon. Cruzar por nombre y dejar
 * constancia del cruce es lo único que no miente.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

// Las especies jugables se leen del propio `species.ts` para que el cruce no se
// quede viejo si se añade una especie nueva.
const fuenteSpecies = readFileSync(`${RAIZ}src/game/species.ts`, 'utf8');

const clavesJuego = [...fuenteSpecies.matchAll(/^ {2}([a-z_0-9]+): \{$/gm)].map((m) => m[1]!);

// Los nombres no se leen del JSON de la wiki, sino del propio `species.ts`: es el
// nombre que el juego muestra, y el que hay que buscar.
const nombresJuego = new Map<string, string>();

{
  // Cada bloque empieza con `key: 'x'` y `name: 'X'`, en este orden.
  const bloques = fuenteSpecies.split(/^ {2}[a-z_0-9]+: \{$/m).slice(1);

  for (const bloque of bloques) {
    const key = /key: '([a-z_0-9]+)'/.exec(bloque)?.[1];
    const name = /name: '([^']+)'/.exec(bloque)?.[1];

    if (key && name) nombresJuego.set(key, name);
  }
}

if (!existsSync(`${RAIZ}src/data/catalogo.json`)) {
  console.error('Falta src/data/catalogo.json. Ejecuta antes: npx tsx tools/import-catalogo.ts');
  process.exit(1);
}

const catalogo = JSON.parse(readFileSync(`${RAIZ}src/data/catalogo.json`, 'utf8')) as {
  entradas: { key: string; nombre: string; pagina: string; nombreBase: string }[];
};

const porNombre = new Map<string, string>();

for (const e of catalogo.entradas) {
  // Se indexa por nombre exacto y por nombre sin matiz. El nombre sin matiz es el
  // que permite encontrar `Meramon` para el `kimeramon` del juego, cuya página
  // puede llamarse `Meramon` o `Meramon (Adventure)`.
  porNombre.set(e.nombre.toLowerCase(), e.key);

  const base = e.nombreBase.toLowerCase();
  if (!porNombre.has(base)) porNombre.set(base, e.key);
}

interface EspeciePropia {
  clave: string;
  nombre: string;
  inspiradoEn: string | null;
  motivo: string;
  atributoOficial: string | null;
  imagen: string | null;
}

/**
 * Las especies que el juego se ha inventado, y lo que dice cada una de ellas.
 *
 * Sin esto, «esta especie no tiene ficha de referencia» mezcla dos cosas que hay
 * que separar: un hueco del catálogo —que se arregla importando— y un Digimon que
 * no existe en el canon —que no se arregla importando nada—. Lo segundo es una
 * decisión del proyecto y por eso tiene que estar escrita, no deducida.
 */
function leerPropias(): Map<string, EspeciePropia> {
  const salida = new Map<string, EspeciePropia>();
  const ruta = `${RAIZ}src/data/catalogo-propias.json`;

  if (!existsSync(ruta)) return salida;

  try {
    const datos = JSON.parse(readFileSync(ruta, 'utf8')) as { especies?: EspeciePropia[] };
    for (const e of datos.especies ?? []) salida.set(e.clave, e);
  } catch (error) {
    console.error(`No se pudo leer catalogo-propias.json: ${(error as Error).message}`);
    console.error('Las especies propias se verán como huecos del catálogo hasta arreglarlo.');
  }

  return salida;
}

const pares: { juego: string; catalogo: string; nombre: string }[] = [];
const sinCruce: { juego: string; nombre: string }[] = [];

// Las especies propias del juego NO tienen ficha en el catálogo, y no es un fallo:
// lo declaran ellas mismas en `catalogo-propias.json`. Se leen aquí para que la
// lista de "sin cruce" diga la verdad: si no, seguiría marcando cuatro especies
// inventadas como si fueran un problema de importación, que es justo el error que
// esta lista viene a evitar.
const propias = leerPropias();

for (const key of clavesJuego) {
  const nombre = nombresJuego.get(key) ?? key;
  const destino = porNombre.get(nombre.toLowerCase()) ?? porNombre.get(key.toLowerCase());

  if (destino) {
    pares.push({ juego: key, catalogo: destino, nombre });
    continue;
  }

  const propia = propias.get(key);

  // El campo se llama `juego` y no `key` en los dos sitios. Antes esta lista usaba
  // `key` y la de los cruces `juego`, y el verificador leía `s.juego` sobre una
  // entrada que solo tenía `key`: un fallo al imprimir el informe, que es justo la
  // parte que hay que leer.
  sinCruce.push({
    juego: key,
    nombre,
    ...(propia
      ? {
          propia: true,
          inspiradoEn: propia.inspiradoEn,
          motivo: propia.motivo,
        }
      : {}),
  });
}

const documento = {
  generado: new Date().toISOString(),
  nota:
    'Cruce entre las claves jugables de `species.ts` y las fichas de `catalogo.json`. ' +
    'Lo escribe `tools/marca-activables.ts`; no se edita a mano.',
  comoLeerlo:
    'Una especie del juego es activable si su clave aparece en `especies`. El resto del ' +
    'catálogo existe y se muestra, pero no se puede capturar ni pelear.',
  especies: pares,
  sinCruce,
};

writeFileSync(`${RAIZ}src/data/catalogo-activables.json`, `${JSON.stringify(documento, null, 1)}\n`);

// El informe separa las tres situaciones, porque tienen atributos distintos y
// confundirlas es lo que hace que un dato inventado parezca un hueco de importación.
const declaradas = sinCruce.filter((s) => 'propia' in s);
const pendientes = sinCruce.filter((s) => !('propia' in s));

console.log('=== MARCADO DE ESPECIES ACTIVABLES ===\n');
console.log(`especies del juego:  ${clavesJuego.length}`);
console.log(`con ficha de referencia: ${pares.length}`);
console.log(`contenido propio declarado: ${declaradas.length}`);
console.log(`sin cruce sin explicación:  ${pendientes.length}`);
console.log('');

if (declaradas.length > 0) {
  console.log('=== CONTENIDO PROPIO DEL JUEGO ===');
  console.log('');
  console.log('No existen en el canon y el juego lo dice. Cada una declara de qué Digimon');
  console.log('real salió, y `catalogo-propias.json` guarda el motivo.');
  console.log('');

  for (const s of declaradas) {
    const propia = s as { propia: true; inspiradoEn: string | null; motivo: string };
    const de = propia.inspiradoEn ? `en raíz a ${propia.inspiradoEn}` : 'sin antecesor oficial';
    console.log(`  ${s.juego.padEnd(16)} ${de}`);
  }

  console.log('');
}

if (pendientes.length > 0) {
  console.log('=== ESPECIES SIN FICHA Y SIN EXPLICACIÓN ===');
  console.log('');
  console.log('Estas SÍ son un problema. No tienen ficha en el catálogo y tampoco están');
  console.log('declaradas como contenido propio, así que o el nombre está mal escrito o');
  console.log('alguien se inventó un Digimon sin decirlo. Hay que decidir una por una.');
  console.log('');

  for (const s of pendientes) console.log(`  ${s.juego.padEnd(16)} (${s.nombre})`);

  console.log('');
  console.log('  Para aceptar una como contenido propio, añádela a src/data/catalogo-propias.json');
  console.log('  con su `inspiradoEn` y su `motivo`.');
  console.log('');
}

console.log('Escrito: src/data/catalogo-activables.json');

process.exit(pendientes.length === 0 ? 0 : 1);
