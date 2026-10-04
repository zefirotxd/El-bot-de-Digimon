const { spawnSync } = require('node:child_process');

// Imprime los fallos de un verificador leyéndolo con Node.
//
// PowerShell convierte el ✓ y la ✗ a UTF-16 con espacios entre letras cuando
// captura la salida, así que filtrar por el símbolo desde ahí no funciona:
// "c h e c k" no es "check". Leyéndolo con Node se ve el texto real.
const nombre = process.argv[2] ?? 'check:ui';

const r = spawnSync('npm', ['run', nombre], {
  cwd: 'E:/digimon mmo',
  shell: true,
  encoding: 'utf8',
  stdio: 'pipe',
});

const salida = `${r.stdout ?? ''}`;
const lineas = salida.split(/\r?\n/);

const i = lineas.findIndex((l) => /Fallos:/.test(l));

if (i === -1) {
  console.log(`${nombre}: sin fallos`);
  console.log(lineas.slice(-5).join('\n'));
} else {
  console.log(lineas.slice(i, i + 10).join('\n'));
}