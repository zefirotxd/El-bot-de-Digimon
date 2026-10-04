const fs = require('node:fs');

function readLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}
function writeLines(file, lines) {
  fs.writeFileSync(file, lines.join('\n'));
}

const p = 'E:/digimon mmo/src/ui/screens/batalla2.ts';
const lines = readLines(p);

// --- imports que no existen -------------------------------------------------
{
  const i = lines.findIndex((l) => l.includes("from '../../services/battleFlow.js';"));
  if (i !== -1) {
    // `combatPreview` y `opcionesDeMovimiento` los inventé al escribir el
    // fichero. El preview real lo exporta el motor como `previewDamage`, y las
    // opciones de disponibilidad las da `movimientosUsables`.
    lines[i] = "import { previewDamage } from '../../game/combat.js';";
  }
}

// --- COLORS.accent no existe ----------------------------------------------
{
  let s = lines.join('\n');
  s = s.split('COLORS.accent').join('COLORS.rare');
  fs.writeFileSync(p, s);
}

// --- paginate devuelve `items` con la forma del elemento -------------------
const texto = fs.readFileSync(p, 'utf8').replace(/COLORS\.accent/g, 'COLORS.rare');
{
  const lines2 = texto.split('\n');

  const i = lines2.findIndex((l) => l.includes('const turnos = turnosDelReplay(state);'));
  if (i !== -1) {
    lines2.splice(
      i + 1,
      0,
      '',
      '  // `paginate` devuelve el elemento entero de cada página, así que el título se',
      '  // saca de `items[0]`. Con grupos de turnos, `items` es una lista de grupos y',
      '  // no una lista de números: mezclar las dos cosas daba un error de tipos que',
      '  // además habría Fallado en pantalla si no se hubiera visto en el typecheck.',
    );
  }

  fs.writeFileSync(p, lines2.join('\n'));
}

console.log('batalla2.ts: imports y paginación corregidos');
void readLines; void writeLines;