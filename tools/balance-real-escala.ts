// Barrido de DAMAGE_SCALE sobre PELEAS REALES (contra salvajes de zona).
//
// Complementa a `balance-escala`, que mide espejos. Los dos hacen falta, y
// verlos juntos evita el error de ajustar el daño solo con el espejo: un espejo
// es una pelea que nunca ocurre, y da una conclusión bastante más lenta que la
// realidad. El jugador se pelea con salvajes de su nivel, y ahí la ventaja de
// atributo (x1.25) y la afinidad elemental (x1.8 o x0.6) ya están actuando.
//
//   npm run balance:real
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

const raiz = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');

const CASOS = [
  [8, 'agumon'],
  [20, 'greymon'],
  [40, 'metalgreymon'],
  [60, 'wargreymon'],
];

const escalas = (process.argv[2] ?? '0.42,0.8,1.0,1.2,1.5').split(',').map(Number);

const titulo = (n: number, s: string) => `${s.slice(0, 6)}@${n}`.padStart(9);

console.log('escala |' + CASOS.map(([n, s]) => titulo(n, s)).join('|'));
console.log('-------+' + CASOS.map(() => '---------').join('+'));

for (const escala of escalas) {
  // Las DOS variables: `DAMAGE_SCALE_AUTOTUNE` la lee el motor y `ESCALA`
  // nombra la base de datos. Poner solo una produce una tabla de filas
  // idénticas, que es lo que pasó la primera vez.
  const r = spawnSync(
    `"${process.execPath}" node_modules/tsx/dist/cli.mjs tools/balance-real.ts`,
    {
      cwd: raiz,
      shell: true,
      encoding: 'utf8',
      env: { ...process.env, ESCALA: String(escala), DAMAGE_SCALE_AUTOTUNE: String(escala) },
    },
  );

  const salida = (r.stdout ?? '').trim();

  if (r.status !== 0 || !salida.includes('|')) {
    console.log(`${String(escala).padStart(7)} | ERROR`);
    console.log('      ' + (r.stderr ?? '').split(/\r?\n/).slice(-3).join('\n      '));
  } else {
    console.log(salida);
  }

  for (const sufijo of ['', '-wal', '-shm']) {
    try {
      rmSync(`${raiz}/data/dbg-real-${escala}.db${sufijo}`, { force: true });
    } catch {
      // Lock de SQLite en Windows: no motivo para abortar el barrido.
    }
  }
}

console.log('');
console.log('Ventana razonable: 4-14 turnos. Menos de 4 es una decisión que no llega');
console.log('a plantearse; más de 14 en Discord son más de diez minutos de peleas.');