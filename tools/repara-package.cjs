// Repara el package.json si alguien lo ha aplanado.
//
// QUÉ PASÓ, para que conste y no se repita.
//
// Añadir un script haciendo esto:
//     const salida = {}; for (const [k,v] of Object.entries(j.scripts)) salida[k]=v;
//     fs.writeFileSync(p, JSON.stringify(salida))
// escribe el objeto de scripts en la RAÍZ del fichero. El `package.json` se
// queda sin `scripts`, sin `name`, sin `version`, sin `type` y sin
// `dependencies`, y npm deja de encontrar cualquier script.
//
// La forma correcta es MUTAR `j.scripts` y escribir `j` entero:
//     j.scripts[nuevo] = valor;
//     fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n')
//
// Aun así, `tools/anade-script.cjs` de este repositorio hace la comprobación
// antes de escribir, porque el error es de un segundo y cuesta diez minutos.
//
// ESTA HERRAMIENTA EXISTE POR ESO.
//
//   node tools/repara-package.cjs            repara si hace falta
//   node tools/repara-package.cjs --check    solo informa
const fs = require('node:fs');

const raiz = __dirname.replace(/[\\/]tools$/, '');
const p = `${raiz}/package.json`;

const soloComprobar = process.argv.includes('--check');

const j = JSON.parse(fs.readFileSync(p, 'utf8'));

// Las claves que un script de este proyecto puede tener. Si aparecen en la raíz,
// el fichero está aplanado.
const CLAVES = [
  'dev', 'start', 'build', 'typecheck', 'register', 'test', 'balance',
  'balance:turnos', 'import:dex', 'accept:dex',
  'check:ui', 'check:db', 'check:shop', 'check:rival', 'check:gear',
  'check:pvp', 'check:evolution', 'check:dungeon', 'check:missions',
  'check:pantallas', 'check:dex', 'check:combate', 'check:caracteres',
  'check:todo',
];

const aplanado = j.scripts === undefined && CLAVES.some((k) => typeof j[k] === 'string');

if (!aplanado) {
  console.log('package.json correcto: ' + Object.keys(j.scripts ?? {}).length + ' scripts');
  if (j.dependencies === undefined) {
    console.error('AVISO: no hay `dependencies`. Si el fichero está bien, el aplanado');
    console.error('se comió más de lo que se ve aquí.');
    process.exit(1);
  }
  process.exit(0);
}

console.log('REPARANDO: el package.json está aplanado (sin `scripts`)');

const scripts = {};
for (const k of CLAVES) {
  if (typeof j[k] === 'string') {
    scripts[k] = j[k];
    delete j[k];
  }
}

// Lo que se perdió se recupera del lockfile, que guarda exactamente lo que había
// instalado en la raíz del proyecto.
const lock = JSON.parse(fs.readFileSync(`${raiz}/package-lock.json`, 'utf8'));
const raizLock = lock.packages[''];

const salida = {
  name: raizLock.name ?? 'digimon-mmo',
  version: raizLock.version ?? '0.1.0',
  // El proyecto es ESM de punta a punta: `NodeNext` en el tsconfig y todos los
  // imports con extensión `.js`. Sin esta línea, tsx compila los `.ts` como
  // CommonJS y los verificadores —que usan `await` en el nivel superior— fallan
  // con "Top-level await is currently not supported with the cjs output format".
  type: 'module',
  scripts,
  ...(raizLock.engines ? { engines: raizLock.engines } : {}),
  dependencies: raizLock.dependencies ?? {},
  devDependencies: raizLock.devDependencies ?? {},
};

if (soloComprobar) {
  console.log('  (solo comprobación: no se escribe)');
} else {
  fs.writeFileSync(p, JSON.stringify(salida, null, 2) + '\n');
  console.log('  scripts recuperados: ' + Object.keys(scripts).length);
  console.log('  dependencias: ' + Object.keys(salida.dependencies).length);
  console.log('  devDependencies: ' + Object.keys(salida.devDependencies).length);
}