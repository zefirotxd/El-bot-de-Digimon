// Corre todos los verificadores en orden y resume.
//
// Existe porque con doce scripts sueltos es facil dar uno por bueno sin ejecutar
// el de al lado, y un fallo en uno se descubre tarde. Aqui se ve de un vistazo
// que la suite entera pasa.
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// El nombre del proyecto lleva un espacio, y `import.meta.url` viene codificado
// en porcentajes: sin `fileURLToPath` la ruta es `E:\digimon%20mmo` y no existe.
const raiz = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(`${raiz}/package.json`, 'utf8'));

const nombres = Object.keys(pkg.scripts)
  .filter((k) => k.startsWith('check:'))
  // `check:todo` es este mismo script: si se listara a si mismo, se repetiria.
  .filter((k) => k !== 'check:todo');

const anchos = Math.max(...nombres.map((n) => n.length));
let fallos = 0;

for (const nombre of nombres) {
  const codigo = ejecutar(nombre);
  const ok = codigo === 0;
  if (!ok) fallos++;

  console.log(`${nombre.padEnd(anchos)}  ${ok ? 'OK' : `FALLO (${codigo})`}`);
}

console.log('');
console.log(
  fallos === 0
    ? `${nombres.length} verificadores en verde.`
    : `${fallos} de ${nombres.length} verificadores fallan.`,
);

process.exit(fallos === 0 ? 0 : 1);

/**
 * Ejecuta un verificador y devuelve su codigo de salida.
 *
 * Se usa `execFileSync` con la salida capturada en un buffer y no
 * `spawnSync` con `shell: true`: el heredado de PowerShell devuelve las lineas
 * en UTF-16 entre Null, y al imprimirlas desde aqui salian como
 * "c h e c k : u i" y "F A L L O". Nada de eso era informacion real.
 *
 * `stdio: 'pipe'` deja que npm escriba normal, y `npm run` ya imprime el
 * banner de cada script.
 */
function ejecutar(nombre) {
  try {
    execFileSync('npm', ['run', nombre], {
      cwd: raiz,
      stdio: 'pipe',
      shell: true,
      windowsHide: true,
    });
    return 0;
  } catch (error) {
    const salida = String(error.stdout ?? '');
    const codigo = typeof error.status === 'number' ? error.status : 1;

    // Solo se enseña la salida del que falla: repetir los doscientos lineas de
    // cada uno esconde el problema en medio del ruido.
    const utiles = salida.split(/\r?\n/).filter((l) => l.trim().length > 0);
    for (const linea of utiles.slice(-22)) {
      console.log(`    ${linea}`);
    }

    return codigo === 0 ? 1 : codigo;
  }
}
