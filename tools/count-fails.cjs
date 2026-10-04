// Localiza los fallos por el punto de codigo del marcador, sin depender de
// como se imprima en la consola de Windows.
const fs = require('node:fs');

const raw = fs.readFileSync('E:/digimon mmo/data/mis-out.txt');
const text = raw.toString('utf8').replace(/^\uFEFF/, '');
const lines = text.split('\n');

let ok = 0;
let bad = 0;

for (const line of lines) {
  const t = line.trim();
  if (!t.startsWith('✓') && !t.startsWith('✗')) continue;
  if (t.startsWith('✓')) ok++;
  else {
    bad++;
    console.log('FALLO:', t);
  }
}

console.log(`\nok=${ok} fallos=${bad}`);
