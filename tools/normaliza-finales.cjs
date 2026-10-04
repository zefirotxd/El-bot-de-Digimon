const fs = require('node:fs');
const path = require('node:path');

/**
 * Normaliza los finales de línea y AVISA de ficheros con finales mezclados.
 *
 * POR QUÉ EXISTE ESTA HERRAMIENTA
 *
 * Los scripts de edición de este proyecto leen con `split('\n')` y escriben con
 * `join('\n')`. Eso deja un `\r` pegado al final de cada línea que ya traía CRLF, y
 * el fichero acaba con finales MIXTOS: unas líneas con `\r\n` y otras solo con
 * `\n`.
 *
 * El síntoma es desconcertante y fue el que costó una hora: una plantilla
 * multilínea que contenía un `\r` no compilaba, y better-sqlite3 devolvía
 * "no such table: dungeon_expedition" para un `UPDATE` sobre una tabla que
 * existía y que se acababa de leer sin problema. El error no tenía nada que ver
 * con la causa, y por eso queda escrito aquí.
 *
 * Lo dangerous no es el fallo, es que sea INTERMITENTE: depende de si la línea con
 * `\r` cae dentro de la plantilla multilínea. La misma función funcionaba en un
 * fichero y no en otro.
 *
 * Por eso se normaliza TODO a LF y se informa de lo que estaba mezclado.
 */

const raiz = 'E:/digimon mmo';
const carpetas = ['src', 'tools'];

let cambiados = 0;
let yaEstaban = 0;
const mezcladosAntes = [];

function recorrer(dir) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);

    if (entrada.isDirectory()) {
      recorrer(completo);
      continue;
    }

    if (!/\.(ts|sql|json|md|cjs|mjs)$/.test(entrada.name)) continue;

    const antes = fs.readFileSync(completo, 'utf8');
    if (!antes.includes('\r')) {
      yaEstaban++;
      continue;
    }

    const soloCRLF = !/(?<!\r)\n/.test(antes);
    const soloCR = !antes.includes('\n');

    const despues = antes.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    fs.writeFileSync(completo, despues);
    cambiados++;

    const etiqueta = soloCRLF ? 'CRLF' : soloCR ? 'CR' : 'MIXTOS';
    mezcladosAntes.push(`${path.relative(raiz, completo)} (${etiqueta})`);
  }
}

for (const c of carpetas) {
  const dir = path.join(raiz, c);
  if (fs.existsSync(dir)) recorrer(dir);
}

console.log(`normalizados a LF: ${cambiados}`);
console.log(`ya estaban en LF: ${yaEstaban}`);

if (mezcladosAntes.length > 0) {
  console.log('\nficheros con \\r (la causa del UPDATE roto):');
  for (const m of mezcladosAntes) console.log('  ' + m);
}

if (process.argv[2] === '--check') {
  process.exit(mezcladosAntes.length === 0 ? 0 : 1);
}