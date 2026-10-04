// Añade un script al package.json.
//
// ÚNICA forma sancionada de hacerlo, y existe porque añadir scripts a mano ha
// aplanado el `package.json` cuatro veces. El error es siempre el mismo:
//
//     const salida = {};                        // <-- esto
//     for (const [k, v] of Object.entries(j.scripts)) salida[k] = v;
//     salida[nuevo] = valor;
//     fs.writeFileSync(p, JSON.stringify(salida));
//
// escribe el objeto de scripts en la RAÍZ del fichero. Se pierden `name`,
// `version`, `type` y `dependencies`, y npm deja de encontrar cualquier script.
//
// Aquí se muta `j.scripts` y se escribe `j` entero. Y antes de nada se comprueba
// la forma del fichero, porque un `package.json` ya aplanado debe repararse con
// `repara-package.cjs` y no volver a "arreglarse" aquí.
//
//   node tools/anade-script.cjs <nombre> <comando>
const fs = require('node:fs');

const raiz = __dirname.replace(/[\\/]tools$/, '');
const p = `${raiz}/package.json`;

const [nombre, comando] = process.argv.slice(2);

if (!nombre || !comando) {
  console.error('uso: node tools/anade-script.cjs <nombre> <comando>');
  console.error('ej.: node tools/anade-script.cjs check:algo "tsx tools/check-algo.ts"');
  process.exit(1);
}

const j = JSON.parse(fs.readFileSync(p, 'utf8'));

// Si está aplanado, aquí no se arregla: se repara y se vuelve a intentar.
if (j.scripts === undefined) {
  console.error('el package.json está aplanado (sin `scripts`).');
  console.error('ejecuta:  node tools/repara-package.cjs');
  process.exit(1);
}

if (j.scripts[nombre]) {
  console.log(`"${nombre}" ya existe: ${j.scripts[nombre]}`);
  process.exit(0);
}

j.scripts[nombre] = comando;

fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');

console.log(`"${nombre}" añadido · ${Object.keys(j.scripts).length} scripts`);
console.log('claves del fichero: ' + Object.keys(j).join(', '));