// Reescribe `check:dex` para separar divergencias aceptadas de nuevas.
//
// La diferencia es el punto entero del informe: si `check:dex` falla en cada
// importación por treinta diferencias conocidas, deja de ser una verificación y
// pasa a ser ruido. El baseline convierte treinta fallos permanentes en un
// número y deja el informe sensible a lo que de verdad cambia.

process.env.DISCORD_TOKEN ??= 'fake';
process.env.DISCORD_CLIENT_ID ??= '0';

import { dexReport, dexCoverage, familiesOf } from '../src/game/dex.js';
import { SPECIES } from '../src/game/species.js';

const informe = dexReport();

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

// ------------------------------------------------------- lo que NO falla ----

// Un campo obligatorio vacío, un valor fuera de la taxonomía de la fuente y una
// divergencia nueva son lo único que debería romper la verificación.
const nuevas = informe.problems.filter((p) => !p.aceptada);
const nuevosAtributos = nuevas.filter((p) => p.kind === 'atributo-difiere');
const nuevosNiveles = nuevas.filter((p) => p.kind === 'nivel-difiere');
const sinFichaNuevas = nuevas.filter((p) => p.kind === 'sin-ficha');
const camposVacios = nuevas.filter((p) => p.kind === 'campo-vacio');

// Lista COMPLETA: para decidir si la fuente habló de un campo, da igual que la
// rareza esté o no documentada. Si puso un valor inservible, el campo está vacío
// y seguirá estándolo.
const fueraTaxonomia = informe.problems.filter((p) => p.kind === 'valor-fuera-de-taxonomia');

// Lista NUEVA: para fallar. Una rareza ya documentada no rompe el informe, o
// se rompería para siempre por algo que la fuente tiene mal.
const fueraTaxonomiaNuevas = nuevas.filter((p) => p.kind === 'valor-fuera-de-taxonomia');

// Un campo obligatorio vacío solo es un fallo si la fuente no puso NADA.
const vaciosReales = camposVacios.filter(
  (p) => !fueraTaxonomia.some((f) => f.speciesKey === p.speciesKey),
);

console.log('=== BESTIARIO DE REFERENCIA ===\n');
console.log(`Fuente:    ${informe.source.name}`);
console.log(`Importado: ${informe.generatedAt}`);
console.log(`\n${informe.source.notice}\n`);

// ------------------------------------------------------------ cobertura ----

console.log('Cobertura de campos obligatorios:\n');

const ETIQUETA: Record<string, string> = {
  level: 'Level     ',
  type: 'Type      ',
  attribute: 'Attribute ',
  families: 'Family    ',
  image: 'Image     ',
};

for (const campo of dexCoverage()) {
  const etiqueta = ETIQUETA[campo.key] ?? campo.key.padEnd(10);
  const ratio = campo.total > 0 ? campo.have / campo.total : 0;
  const barra = `${'█'.repeat(Math.round(ratio * 20))}${'░'.repeat(20 - Math.round(ratio * 20))}`;
  console.log(
    `  ${etiqueta} ${String(campo.have).padStart(2)}/${campo.total}  \`${barra}\`${ratio === 1 ? '' : '  ← incompleto'}`,
  );
}

console.log('');

// -------------------------------------------------------------- fallos -----

console.log('Lo que hay que mirar:\n');

if (nuevas.length === 0) {
  console.log('  (nada pendiente)');
} else {
  for (const p of nuevas) {
    const etiqueta =
      p.kind === 'campo-vacio' ? 'campo vacío'
      : p.kind === 'sin-ficha' ? 'sin ficha'
      : p.kind === 'atributo-difiere' ? 'atributo nuevo'
      : p.kind === 'nivel-difiere' ? 'nivel nuevo'
      : p.kind;
    console.log(`  - ${p.name} → ${etiqueta}: ${p.detail}`);
  }
}

console.log('');

// --------------------------------------------------------------- checks ----

check(
  vaciosReales.length === 0,
  'todos los campos obligatorios están rellenos',
  vaciosReales.map((p) => `${p.name} (${p.detail})`).join(', '),
);

check(
  sinFichaNuevas.length === 0,
  'toda especie del catálogo tiene ficha',
  sinFichaNuevas.map((p) => p.name).join(', '),
);

check(
  fueraTaxonomiaNuevas.length === 0,
  'ningún valor nuevo se sale de la taxonomía de la fuente',
  fueraTaxonomiaNuevas.map((p) => `${p.name} (${p.detail})`).join(', '),
);

check(
  nuevosAtributos.length === 0,
  'ningún atributo nuevo sin revisar',
  nuevosAtributos.map((p) => p.name).join(', '),
);

check(
  nuevosNiveles.length === 0,
  'ningún nivel nuevo sin revisar',
  nuevosNiveles.map((p) => p.name).join(', '),
);

// --------------------------------------------------- diferencias conocidas --

console.log('\nDiferencias conocidas y aceptadas:\n');

const ACEPTADAS_POR_TIPO = [
  ['atributo-difiere', 'Atributo distinto del canon'],
  ['nivel-difiere', 'Nivel distinto del canon'],
  ['sin-ficha', 'Especie sin página en la fuente'],
  ['segundo-atributo', 'Segundo atributo (el modelo admite uno)'],
  ['tipo-distinto', 'Tipo (dos taxonomías distintas)'],
  ['imagen-no-libre', 'Imagen de uso justo'],
  ['alias', 'Nombre distinto en la fuente'],
] as const;

for (const [kind, titulo] of ACEPTADAS_POR_TIPO) {
  const lista = informe.problems.filter((p) => p.kind === kind && p.aceptada);
  if (lista.length === 0) continue;
  console.log(`  ${titulo}: ${lista.length}`);
}

// El motivo de cada diferencia, agrupado: son la explicación de por qué el
// juego no coincide con el canon, y sin esto el número no significa nada.
const motivos = new Map<string, number>();
for (const p of informe.problems) {
  if (!p.motivo) continue;
  motivos.set(p.motivo, (motivos.get(p.motivo) ?? 0) + 1);
}

console.log('\nPor qué difieren (agrupado):\n');
for (const [motivo, n] of motivos) {
  console.log(`  [${n}] ${motivo}\n`);
}

// --------------------------------------------------------------- alias -----

console.log('Decisiones de nombre:\n');
const alias = informe.problems.filter((p) => p.kind === 'alias');
if (alias.length === 0) {
  console.log('  (ninguna)');
} else {
  for (const p of alias) {
    console.log(`  ${p.name}`);
    console.log(`    → ${p.detail.split('—')[0]!.trim()}`);
    console.log(`    ${p.detail.split('—')[1]?.trim() ?? ''}`);
  }
}

// --------------------------------------------------------------- tipo ------

console.log('\nTipo biológico:\n');
const tipos = new Set<string>();
for (const p of informe.problems) {
  if (p.kind !== 'tipo-distinto') continue;
  const wiki = p.detail.split('wiki=[')[1]?.replace(']', '');
  if (wiki) for (const t of wiki.split(' / ')) tipos.add(t.trim());
}
console.log(`  ${tipos.size} tipos canónicos distintos: ${[...tipos].sort().join(', ')}`);
console.log('  NO se comparan con `elements`. Son taxonomías diferentes: la wiki');
console.log('  clasifica por biología y el juego por elemento de combate. Sobrescribir');
console.log('  una con la otra dejaría el combate sin STAB ni resistencias.');

// ------------------------------------------------------------ imágenes -----

console.log('\nImágenes:\n');
console.log(`  ${informe.coverage.image ?? 0} con imagen.`);
console.log('  Se guarda la REFERENCIA y la interfaz enlaza. No se descarga nada al');
console.log('  repositorio: el material de uso justo del wiki no es redistribuible.');

// ------------------------------------------------------------ familias -----

console.log('\nFamilias:\n');
const indice = new Map<string, string[]>();
for (const key of Object.keys(SPECIES)) {
  for (const familia of familiesOf(key)) {
    const lista = indice.get(familia) ?? [];
    lista.push(SPECIES[key]!.name);
    indice.set(familia, lista);
  }
}
console.log(`  ${indice.size} familias distintas. Las más pobladas:`);
for (const [familia, miembros] of [...indice.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6)) {
  console.log(`    ${familia.padEnd(22)} ${miembros.length}  ${miembros.slice(0, 5).join(', ')}`);
}

// ------------------------------------------------------------ resultado ----

console.log('');
if (failures === 0) {
  console.log(
    `OK: bestiario completo (${informe.imported}/${informe.total}). ` +
      `${informe.problems.filter((p) => p.aceptada).length} diferencias conocidas y aceptadas.`,
  );
} else {
  console.log(`${failures} comprobacion(es) sin pasar.`);
}

process.exit(failures === 0 ? 0 : 1);