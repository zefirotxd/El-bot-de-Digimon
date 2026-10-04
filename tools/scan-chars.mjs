import fs from 'node:fs';
import path from 'node:path';

// Escanea en busca de caracteres que se colaron de otras escrituras.
//
// El hangul y el CJK aparecen cuando una escritura se entrelaza con otra, y
// pasan el typecheck porque son identificadores perfectamente válidos: una
// palabra contaminada dentro de un identificador compila igual de bien que una
// limpia. Solo se ven leyendo.
//
// Se permite un puñado de simbolos: son los de la carta de afinidades del
// proyecto, no basura.
const permitidos = new Set([
  ...'◎△▲〇ー×', // Simbolos de la carta de afinidades del proyecto.
]);

const raices = ['E:/digimon mmo/src', 'E:/digimon mmo/tools'];
const malos = [];
let total = 0;

/**
 * Ficheros donde el japonés y el chino son DATO, no corrupción.
 *
 * El catálogo importa los nombres oficiales de cada especie en su idioma de
 * origen: el nombre japonés de Greymon y el de Shenwumon, entre otros mil. Son el
 * contenido del fichero, no una escritura colada.
 *
 * Los ejemplos van descritos y no citados a propósito: el escáner recorre también
 * `tools/`, así que escribir el japonés aquí lo marcaría a él mismo. Se comprobó.
 *
 * Sin esta lista el escáner marca esos nombres como corrupción, y la reacción
 * natural sería borrarlos del catálogo. Eso sería peor que el problema que
 * resolvió la herramienta: se perdería un dato real para tapar un falso positivo.
 *
 * La lista se limita a ficheros GENERADOS por el importador. Un fichero escrito a
 * mano sigue pidiendo revisión aunque el escáner lo perdone.
 *
 * La lista se limita a ficheros GENERADOS por el importador. Un fichero escrito a
 * mano sigue pidiendo revisión aunque el escáner lo perdone.
 */
const conDatosNoLatinos = new Set([
  'src/data/catalogo.json',
  'src/data/catalogo-activables.json',
]);

function permitidoEn(archivo) {
  const relativo = archivo.replace(/\\/g, '/').replace(/^.*digimon mmo\//, '');
  return conDatosNoLatinos.has(relativo);
}

function recorrer(dir) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      recorrer(completo);
      continue;
    }
    if (!/\.(ts|js|cjs|mjs|json|sql|md)$/.test(entrada.name)) continue;

    total++;
    const texto = fs.readFileSync(completo, 'utf8');
    const esGenerado = permitidoEn(completo);

    const raro = texto.match(
      /[\uac00-\ud7af\u4e00-\u9fff\u3040-\u30ff\ufffd]+/g,
    );
    if (raro) {
      for (const r of raro) {
        if ([...r].every((c) => permitidos.has(c))) continue;

        // En un fichero de datos, el japonés y el chino son legítimos. El
        // SUSTITUITO U+FFFD sigue siendo válido en cualquiera: eso sí es un
        // fichero roto, generado o no.
        if (esGenerado && !r.includes('\ufffd')) continue;

        const linea = texto.slice(0, texto.indexOf(r)).split('\n').length;
        malos.push({ archivo: completo, linea, trozo: r });
      }
    }
  }
}

for (const r of raices) recorrer(r);

console.log(`ficheros revisados: ${total}`);
console.log(
  malos.length === 0
    ? 'sin caracteres corruptos'
    : `CARACTERES RAROS: ${malos.length}`,
);
for (const m of malos) console.log(`  ${m.archivo}:${m.linea}  ${m.trozo}`);

process.exit(malos.length === 0 ? 0 : 1);