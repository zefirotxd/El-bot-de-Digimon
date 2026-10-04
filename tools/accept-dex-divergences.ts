// Genera el baseline de divergencias aceptadas.
//
// El catálogo del juego NO es el canon de la wiki, y no por error: Agumon es
// `virus` aquí y `Vaccine` en la wiki, y hay 17 atributos y 13 niveles que
// difieren. Eso es diseño, casi seguro para el triángulo r-o-c de las primeras
// cuatro evoluciones y para que el matchmaking no sea trivial.
//
// El problema de un informe que falla siempre es que deja de informar: si cada
// importación levanta 30 avisos, el día que aparezca uno de verdad nadie lo ve.
// Así que las divergencias se aceptan una vez, con su motivo, y a partir de ahí
// el informe solo señala las NUEVAS.
//
//   npx tsx tools/accept-dex-divergences.ts

process.env.DISCORD_TOKEN ??= 'fake';
process.env.DISCORD_CLIENT_ID ??= '0';

import { readFileSync, writeFileSync } from 'node:fs';
import { dexReport } from '../src/game/dex.js';
import { SPECIES } from '../src/game/species.js';
import type { AcceptedDivergence } from '../src/game/dexTypes.js';

/**
 * El patrón es claro al ver la lista: la línea clásica de Adventure
 * (Koromon → Agumon → Greymon) es Virus en el juego y Vaccine en la wiki.
 *
 * Es una decisión de diseño, no un descuido: invertir el triángulo hace que
 * conocer el canon no sirva de nada, de modo que el juego no premia
 * memorizar el triángulo real. Además el combate está afinado sobre estos
 * valores, así que cambiarlos no sería corregir datos: sería reequilibrar.
 */
const MOTIVOS: Record<string, string> = {
  atributo: [
    'La línea clásica de Adventure es Virus en el juego y Vaccine en el canon.',
    'Es una decisión de diseño: invertir el triángulo hace que conocer el canon no dé ventaja,',
    'de modo que el juego no premia memorizar el triángulo real. El combate está afinado sobre',
    'estos valores, así que cambiarlos no es corregir datos: es reequilibrar.',
  ].join(' '),
};

function motivoPara(kind: string, speciesKey: string, game: string): string {
  if (kind === 'nivel-difiere') {
    // El motivo cambia según la DIRECCIÓN de la diferencia: subir un Digimon en
    // el juego o bajarlo son decisiones distintas.
    const delJuego = SPECIES[speciesKey]!.tier;

    if (game === 'novato') {
      return (
        'El juego tiene una banda `novato` entre In-Training y Rookie que el canon no tiene. ' +
        'Es una decisión de progresión propia: agrupa a los Digimon más jóvenes en una sola ' +
        'pantalla de mapa.'
      );
    }
    if (delJuego === 'mega') {
      return (
        'Megadigimon en el juego y Ultimate en el canon. Decisión de progresión: en el juego son ' +
        'el final de su rama, y bajarlos los dejaría sin destino y sin recompensa.'
      );
    }
    if (delJuego === 'ultimate') {
      return (
        'El juego lo cuenta como megadigimon y el canon como Champion: es alcance de contenido, ' +
        'no un error. El árbol evolutivo del juego tiene una rama más corta de la que tiene el canon.'
      );
    }
    return (
      'Diferencia de escalonado. El juego agrupa algunos Rookie con los Champion para que las ' +
      'primeras zonas no se acaben en el primer nivel.'
    );
  }

  if (kind === 'sin-ficha') {
    return (
      'No existe página con este nombre en la wiki, ni con las grafías cercanas que se buscaron ' +
      '(Veldirimon, Velimon, Vermilimon, Vademon: ninguna). Puede ser un nombre inventado para el ' +
      'juego o una errata; no se adivina un mapeo porque meter los datos de otra especie es peor ' +
      'que dejar el hueco. Requiere decidir: renombrar la especie o mantenerla sin ficha.'
    );
  }

  return MOTIVOS.atributo;
}

const informe = dexReport();

const aceptadas: AcceptedDivergence[] = [];

for (const p of informe.problems) {
  if (p.kind === 'atributo-difiere' || p.kind === 'nivel-difiere' || p.kind === 'sin-ficha') {
    // `detail` viene como `juego=virus  wiki=Vaccine`. Se separa por el doble
    // espacio y se quita la etiqueta de la primera parte.
    const [ladoJuego = '', ladoFuente = ''] = p.detail.split(/\s{2,}/);
    const game = ladoJuego.replace(/^juego=/, '');
    const source = ladoFuente.replace(/^wiki=/, '');

    aceptadas.push({
      speciesKey: p.speciesKey,
      kind: p.kind as AcceptedDivergence['kind'],
      game,
      source,
      motivo: motivoPara(p.kind, p.speciesKey, game),
    });
  }
}

// Las entradas que el script NO sabe generar se conservan de la versión
// anterior del baseline. `valor-fuera-de-taxonomia` es de las que se declaran a
// mano: no sale de comparar dos catálogos, sino de que la fuente se sale de su
// propia lista de valores.
{
  const anterior = readFileSync('src/data/dex-accepted.json', 'utf8');
  const previas = JSON.parse(anterior).divergencias ?? [];
  const declaradasAMano = previas.filter(
    (d: { kind: string }) => d.kind === 'valor-fuera-de-taxonomia',
  );

  for (const d of declaradasAMano) {
    const yaEsta = aceptadas.some(
      (a) => a.speciesKey === d.speciesKey && a.kind === d.kind,
    );
    if (!yaEsta) {
      aceptadas.push(d as AcceptedDivergence);
      console.log(`  conservada a mano: ${d.speciesKey} (${d.kind})`);
    }
  }
}

const salida = {
  generado: new Date().toISOString(),
  nota:
    'Divergencias entre el catálogo del juego y el canon de la wiki que se han revisado y ' +
    'aceptado a mano. `check:dex` las da por conocidas y solo señala las nuevas. ' +
    'Bórralas si el cambio de una de las dos partes tiene que volver a revisarse.',
  divergencias: aceptadas,
};

writeFileSync('src/data/dex-accepted.json', JSON.stringify(salida, null, 2) + '\n', 'utf8');

console.log(`${aceptadas.length} divergencias aceptadas -> src/data/dex-accepted.json\n`);

const porTipo = new Map<string, AcceptedDivergence[]>();
for (const a of aceptadas) {
  const lista = porTipo.get(a.kind) ?? [];
  lista.push(a);
  porTipo.set(a.kind, lista);
}

for (const [kind, lista] of porTipo) {
  console.log(`--- ${kind} (${lista.length}) ---`);
  for (const a of lista) {
    console.log(`  ${SPECIES[a.speciesKey]!.name.padEnd(20)} juego=${a.game.padEnd(12)} fuente=${a.source}`);
  }
  console.log(`  motivo: ${lista[0]!.motivo}\n`);
}