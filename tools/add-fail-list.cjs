const fs = require('node:fs');

function readLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}
function writeLines(file, lines) {
  fs.writeFileSync(file, lines.join('\n'));
}

const p = 'E:/digimon mmo/tools/check-missions.ts';
const lines = readLines(p);
let changes = 0;

// Recoger los fallos por nombre: parsear marcas en la consola de Windows es
// frágil, y un resumen legible vale más.
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('let failures = 0;')) {
    lines.splice(
      i,
      2,
      'let failures = 0;',
      '/** Etiquetas de los fallos, para poder listarlos al final. */',
      'const failed: string[] = [];',
    );
    changes++;
  }

  if (lines[i].includes("  if (!ok) failures++;")) {
    lines.splice(i, 1, '  if (!ok) { failures++; failed.push(label); }');
    changes++;
  }

  const last = lines.findIndex((l) => l.startsWith("console.log(failures === 0 ? '"));
  if (last !== -1 && !lines.some((l) => l.includes('failed.forEach'))) {
    lines.splice(
      last,
      1,
      'if (failed.length > 0) {',
      "  console.log('\\nFallos:');",
      '  for (const label of failed) console.log(`  - ${label}`);',
      '}',
      "console.log(failures === 0 ? '\\nOK: misiones, logros y estadísticas funcionando.' : `\\n${failures} fallo(s).`);",
    );
    changes++;
  }
}

writeLines(p, lines);
console.log(`correcciones: ${changes}`);
