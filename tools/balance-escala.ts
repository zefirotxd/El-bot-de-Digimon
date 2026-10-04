// Barrido de DAMAGE_SCALE.
//
// Lanza `balance-fila.ts` en un proceso por valor y pone los resultados en tabla.
// La tabla sale de medir, no de suponer, y por eso se ejecuta cada valor aparte:
// `DAMAGE_SCALE` se lee al importar `stats.js`, y dentro de un mismo proceso
// Node no hay forma de cambiarlo de verdad.
//
//   npm run balance:turnos
//   npx tsx tools/balance-escala.ts 0.42,0.8,1.2,1.6,2.0
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

const raiz = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const fila = `${raiz}/tools/balance-fila.ts`;

const NIVELES = [
  [5, 'agumon'],
  [18, 'greymon'],
  [35, 'metalgreymon'],
  [55, 'wargreymon'],
];

const escalas = (process.argv[2] ?? '0.42,0.8,1.2,1.6,2.0,2.5')
  .split(',')
  .map(Number);

const etiqueta = (n: number) => String(n).padStart(8);

console.log('escala |' + NIVELES.map(([l, s]) => `${s.slice(0, 6)}@${l}`.padStart(9)).join('|'));
console.log('-------+' + NIVELES.map(() => '---------').join('+'));

for (const escala of escalas) {
  // El ejecutable va COMILLADO. La carpeta del proyecto tiene un espacio
  // ("digimon mmo"), y con `shell: true` un `C:\Program Files\...` sin comillas se
  // parte en dos palabras y el fallo es "no se reconoce como un comando", que
  // dice menos que el problema real.
  const r = spawnSync(
    `"${process.execPath}" node_modules/tsx/dist/cli.mjs tools/balance-fila.ts`,
    {
      cwd: raiz,
      shell: true,
      encoding: 'utf8',
      // Las DOS variables. `DAMAGE_SCALE_AUTOTUNE` es la que lee el motor;
      // `ESCALA` solo identifica la base de datos de este barrido. Poner una y
      // no la otra produce una tabla de seis filas idénticas con el valor por
      // defecto, que es lo que pasó la primera vez.
      env: { ...process.env, ESCALA: String(escala), DAMAGE_SCALE_AUTOTUNE: String(escala) },
    },
  );

  const salida = (r.stdout ?? '').trim();

  if (r.status !== 0 || !salida.includes('|')) {
    console.log(`${String(escala).padStart(7)} | ERROR`);
    const err = (r.stderr ?? '').split(/\r?\n/).slice(-4).join('\n      ');
    console.log('      ' + err);
  } else {
    console.log(salida);
  }

  for (const sufijo of ['', '-wal', '-shm']) {
    try {
      rmSync(`${raiz}/data/dbg-scale-${escala}.db${sufijo}`, { force: true });
    } catch {
      // Lock de SQLite en Windows: no es motivo para fallar el barrido.
    }
  }
}

console.log('');
console.log('El umbral del test es mediana <= 25 turnos. Valores por debajo de ~6 son');
console.log('combates tan cortos que la decisión no llega a plantearse.');