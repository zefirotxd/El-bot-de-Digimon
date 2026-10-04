/**
 * Valida los ficheros de despliegue sin Docker.
 *
 * `check:caracteres` recorre `src` y `tools`, así que no mira el `Dockerfile`, ni
 * el `fly.toml`, ni el `.dockerignore`, ni el `.env.example`. Son ficheros de los
 * que depende un despliegue entero y no tenían ninguna comprobación.
 *
 * Lo que se comprueba es lo que se puede comprobar sin construir la imagen:
 *
 *   1. Que no tengan caracteres corruptos. Un `COPY` mal escrito por un acento
 *      roto da un error de build que no menciona el acento.
 *   2. Que todos los `COPY` del Dockerfile apunten a ficheros que existen.
 *   3. Que el `.dockerignore` no excluya nada que el Dockerfile copia. Ese es el
 *      fallo más caro: la imagen se construye bien y el bot muere al arrancar.
 *   4. Que el volumen esté montado donde cae la base de datos, y en la misma
 *      región.
 *   5. Que el bot no declare un puerto que no usa.
 *   6. Que haya un solo comando de arranque.
 */

import fs from 'node:fs';
import path from 'node:path';

const RAIZ = 'E:/digimon mmo';

let fallos = 0;
const fallidos: string[] = [];

function check(etiqueta: string, ok: boolean, detalle = ''): void {
  if (!ok) {
    fallos++;
    fallidos.push(etiqueta);
  }
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}${detalle ? ` (${detalle})` : ''}`);
}

function leer(f: string): string {
  return fs.readFileSync(`${RAIZ}/${f}`, 'utf8');
}

console.log('=== DESPLIEGUE ===\n');

// ==========================================================================
console.log('1. LOS FICHEROS EXISTEN');
// ==========================================================================

const FICHEROS = ['Dockerfile', 'fly.toml', '.dockerignore', '.env.example', 'DESPLIEGUE.md'];

for (const f of FICHEROS) {
  check(`${f} existe`, fs.existsSync(`${RAIZ}/${f}`));
}

// ==========================================================================
console.log('\n2. SIN CARACTERES CORRUPTOS');
// ==========================================================================

for (const f of FICHEROS) {
  const raros = leer(f).match(/[\uac00-\ud7af\u4e00-\u9fff\u3040-\u30ff\ufffd]+/g);
  check(`${f} sin caracteres raros`, raros === null, raros ? raros.join(',') : '');
}

// ==========================================================================
console.log('\n3. LOS `COPY` DEL DOCKERFILE APUNTAN A ALGO REAL');
// ==========================================================================

{
  const dockerfile = leer('Dockerfile');

  const copies = [...dockerfile.matchAll(/^COPY\s+(?!--from)(.+)$/gm)]
    .map((m) => m[1]!.trim())
    .filter((c) => !c.startsWith('#'));

  for (const linea of copies) {
    // En `COPY origen destino` lo que importa es el primero.
    const origen = linea.split(/\s+/)[0]!;
    check(`COPY ${origen} existe`, fs.existsSync(`${RAIZ}/${origen}`));
  }

  check('hay un COPY de src', copies.some((c) => c.includes('src')));
  check('copia el package-lock (npm ci lo exige)', copies.some((c) => c.includes('package-lock')));
  check('copia el tsconfig (tsx lo lee)', copies.some((c) => c.includes('tsconfig')));
}

// ==========================================================================
console.log('\n4. EL `.dockerignore` NO EXCLUYE LO QUE EL DOCKERFILE COPIA');
// ==========================================================================

{
  const reglas = reglasDe(leer('.dockerignore'));

  // Sin barra inicial, `data/` se lleva también `src/data/`, que es donde vive el
  // catálogo. Es el fallo más caro del despliegue porque no da ningún error hasta
  // que el bot ya está arrancando en producción.
  const sinBarra = reglas.filter(
    (r) => /(^|\s)data\/?$/.test(r) && !r.startsWith('/') && !r.startsWith('!'),
  );

  check(
    'el .dockerignore usa barra inicial para data/',
    sinBarra.length === 0,
    sinBarra.length > 0 ? `sin barra: ${sinBarra.join(', ')}` : '',
  );

  // Lo que el bot NECESITA dentro de la imagen.
  const imprescindible = [
    'src/data/catalogo.json',
    'src/data/dex.json',
    'src/data/catalogo-activables.json',
    'src/data/dex-accepted.json',
    'src/data/catalogo-propias.json',
  ];

  for (const f of imprescindible) {
    const existe = fs.existsSync(`${RAIZ}/${f}`);
    const fuera = excluye(reglas, f);

    check(
      `${f} no está excluido`,
      existe && fuera === null,
      !existe ? 'el fichero no existe' : fuera !== null ? `regla que lo saca: ${fuera}` : '',
    );
  }

  check('node_modules queda fuera (se instala dentro)', excluye(reglas, 'node_modules/algo.js') !== null);
  check('.env queda fuera (los secretos van aparte)', excluye(reglas, '.env') !== null);
  check('.env.example SÍ entra (es la plantilla)', excluye(reglas, '.env.example') === null);
}

/** Divide un `.dockerignore` en reglas, quitando comentarios y blancos. */
function reglasDe(texto: string): string[] {
  return texto
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
}

/**
 * Qué regla deja fuera una ruta, o `null` si ninguna lo hace.
 *
 * Devuelve la REGLA, no un booleano, y esa es la parte que importa: un `✗` sin
 * motivo obliga a abrir el fichero y decidir a mano; uno con motivo se lee.
 *
 * Separar el array antes de llamar. La primera versión pasaba el texto entero y lo
 * recorría con `for..of`, que sobre una cadena itera carácter a carácter: al llegar
 * a la `*` de un patrón `*.db` disparaba la regla de «ignorar todo» y marcaba las
 * cinco fichas de referencia como excluidas, cuando ninguna lo estaba.
 */
function excluye(reglas: string[], ruta: string): string | null {
  const nombre = path.posix.basename(ruta);
  const carpeta = ruta.split('/')[0] ?? '';

  // GANA LA ÚLTIMA REGLA QUE COINCIDE, como en git y como en `.gitignore`. No se
  // puede saltar las negaciones: `.env.*` excluye y `!.env.example` lo devuelve, y
  // si la negación se ignorara el `Dockerfile` fallaría al copiar la plantilla.
  //
  // Se recorren todas las reglas y se guarda la última que coincide. Es lo que
  // hace el descomificador, y basta para las veinte reglas del proyecto.
  let decide: string | null = null;

  for (const regla of reglas) {
    const esNegacion = regla.startsWith('!');
    const limpia = regla.replace(/^!/, '').replace(/^\//, '').replace(/\/$/, '');

    if (!coincide(limpia, ruta, nombre, carpeta)) continue;

     decide = esNegacion ? null : regla;
  }

  return decide;
}

function coincide(limpia: string, ruta: string, nombre: string, carpeta: string): boolean {
  if (limpia === '*' || limpia === '**') return true;
  if (limpia === ruta) return true;
  if (limpia === carpeta) return true;
  if (limpia === nombre && !ruta.includes('/')) return true;

  const patron = '^' + limpia.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';

  return new RegExp(patron).test(nombre);
}

// ==========================================================================
console.log('\n5. EL VOLUMEN CAE DONDE ESTÁ LA BASE DE DATOS');
// ==========================================================================

{
  const toml = leer('fly.toml');

  const destino = /\[\[mounts\]\][\s\S]*?destination\s*=\s*"([^"]+)"/.exec(toml)?.[1] ?? null;
  const volumen = /\[\[mounts\]\][\s\S]*?source\s*=\s*"([^"]+)"/.exec(toml)?.[1] ?? null;
  const envDb = /DATABASE_PATH\s*=\s*"([^"]+)"/.exec(toml)?.[1] ?? null;
  const workdir = /^WORKDIR\s+(\S+)/m.exec(leer('Dockerfile'))?.[1] ?? null;

  check('fly.toml declara el destino del volumen', destino !== null, destino ?? '');
  check('fly.toml nombra el volumen', volumen !== null, volumen ?? '');
  check('el Dockerfile fija WORKDIR /app', workdir === '/app', workdir ?? '');

  if (envDb && workdir && destino) {
    // `config.ts` resuelve la ruta contra `process.cwd()`, que es el WORKDIR.
    const absoluta = path.posix.resolve(workdir, envDb);

    check(
      'la base de datos cae DENTRO del volumen',
      absoluta.startsWith(`${destino}/`),
      `${absoluta} vs ${destino}`,
    );
  }

  // El volumen sobrevive a los despliegues pero NO a los cambios de región. Si el
  // comando para crearlo dice otra región, la base no se monta y se pierde todo.
  const region = /primary_region\s*=\s*"([^"]+)"/.exec(toml)?.[1] ?? null;
  const regionGuia = /fly volumes create\s+\S+\s+--region\s+(\S+)/.exec(leer('DESPLIEGUE.md'))?.[1] ?? '';

  check('la región está declarada', region !== null, region ?? '');
  check(
    'el comando de crear el volumen usa la MISMA región',
    region !== null && regionGuia === region,
    `fly.toml=${region} guía=${regionGuia || 'no aparece'}`,
  );
}

// ==========================================================================
console.log('\n6. EL BOT NO DECLARA UN PUERTO QUE NO USA');
// ==========================================================================

{
  const toml = leer('fly.toml');
  const entrada = leer('src/index.ts');

  // Sin los comentarios. El `fly.toml` explica en ellos por qué NO declara
  // `[http_service]`, así que buscar esas cadenas en el fichero entero las
  // encontraba en la explicación y daba `✗` en dos reglas que están correctas.
  const sinComentarios = toml
    .split('\n')
    .map((l) => l.replace(/#.*$/, ''))
    .join('\n');

  check('src/index.ts no levanta un servidor HTTP', !/createServer|express\(|\.listen\(|http\.server/i.test(entrada));
  check('fly.toml NO declara [http_service]', !sinComentarios.includes('[http_service]'));
  check(
    'ni auto_stop_machines, que no aplica sin servicio',
    !sinComentarios.includes('auto_stop_machines'),
  );
  check('y el comentario explica por qué', toml.includes('[http_service]'));
}

// ==========================================================================
console.log('\n7. UN SOLO COMANDO DE ARRANQUE');
// ==========================================================================

{
  const dockerfile = leer('Dockerfile');
  const toml = leer('fly.toml');

  const cmd = /^CMD\s+(.+)$/m.exec(dockerfile)?.[1] ?? null;

  check('el Dockerfile define CMD', cmd !== null, cmd ?? '');
  check('fly.toml NO repite el arranque en [processes]', !/\n\[processes\]/.test('\n' + toml));

  if (cmd !== null) {
    check('el CMD usa tsx, que es lo que hace `npm start`', cmd.includes('tsx'));
  }
}

// ==========================================================================
console.log('\n8. LAS DEPENDENCIAS QUE EL ARRANQUE NECESITA');
// ==========================================================================

{
  const pkg = JSON.parse(leer('package.json'));

  check('package-lock.json existe (npm ci lo exige)', fs.existsSync(`${RAIZ}/package-lock.json`));
  check('tsx es dependencia', Boolean(pkg.devDependencies?.tsx ?? pkg.dependencies?.tsx));
  check('better-sqlite3 es dependencia', Boolean(pkg.dependencies?.['better-sqlite3']));
  check('el script start usa tsx', (pkg.scripts?.start ?? '').includes('tsx'));
  check('tsconfig.json existe', fs.existsSync(`${RAIZ}/tsconfig.json`));

  // `npm ci` instala las devDependencies salvo que se pida lo contrario, y el
  // arranque usa `tsx`, que es una. Por eso el Dockerfile no lleva
  // `--omit=dev`: si lo llevara, `npx tsx` no encontraría nada.
  check(
    'el Dockerfile NO usa --omit=dev (tsx es devDependency)',
    !leer('Dockerfile').includes('--omit=dev'),
  );
}

// ==========================================================================

console.log('');

if (fallos > 0) {
  console.log('Fallos:');
  for (const f of fallidos) console.log('  - ' + f);
}

console.log('');
console.log(
  fallos === 0
    ? 'OK: los ficheros de despliegue son coherentes entre sí.\n' +
        '    Lo que NO se ha comprobado es que la imagen construya: eso necesita Docker.'
    : `${fallos} fallo(s).`,
);

process.exit(fallos === 0 ? 0 : 1);