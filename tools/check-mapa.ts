// Verificación del GENERADOR de mazmorras.
//
// Lo que importa aquí no es que el mapa quede bonito, es que no se generen mapas
// imposibles. El encargo lo pide de forma explícita y es el fallo que arruinaría
// una expedición de cuarenta minutos: una entrada sin salida, un jefe
// inalcanzable, un tesoro en una isla.
//
// Se generan CIENTOS de mapas con semillas distintas y se comprueban las tres
// garantías sobre cada uno. Con una sola semilla el generador puede parecer
// correcto y fallar el Tuesday.
process.env.DISCORD_TOKEN ??= 'fake';
process.env.DISCORD_CLIENT_ID ??= '0';
import { rmSync } from 'node:fs';

function cleanupDb(name: string): void {
  for (const sufijo of ['', '-wal', '-shm']) {
    try {
      rmSync(`./data/${name}${sufijo}`, { force: true, maxRetries: 8, retryDelay: 120 });
    } catch {
      // Lock de SQLite en Windows: no motivo para abortar la comprobación.
    }
  }
}
cleanupDb('check-mapa.db');

const mapa = await import('../src/game/dungeonMap.js');
const gen = await import('../src/game/dungeonGen.js');
const eventos = await import('../src/game/dungeonEvents.js');
const minijefes = await import('../src/game/dungeonMiniboss.js');
const { SPECIES } = await import('../src/game/species.js');

let fallos = 0;
const fallidos: string[] = [];

function check(etiqueta: string, ok: boolean, detalle = '') {
  if (!ok) {
    fallos++;
    fallidos.push(etiqueta);
  }
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}${detalle ? ` (${detalle})` : ''}`);
}

// ==========================================================================
console.log('=== 1. LOS MAPAS SIEMPRE SON JUGABLES ===');
// ==========================================================================

{
  const biomas = Object.keys(mapa.BIOMES) as mapa.Biome[];
  const SEMILLAS = 60;

  let problemas = 0;
  let entradaJefe = 0;
  let islas = 0;
  let sinJefe = 0;
  const tiposPorMapa: Record<string, number> = {};

  for (const bioma of biomas) {
    for (let piso = 0; piso < 5; piso++) {
      for (let s = 0; s < SEMILLAS; s++) {
        const rng = mapa.rngDe(s * 7919 + piso * 104729 + bioma.length);
        const generado = gen.generarPiso(bioma, piso, rng, 10 + piso * 8);

        // --- 1. entrada presente y única --------------------------------
        const entradas = generado.tiles.filter((t) => t.kind === 'entrada');
        if (entradas.length !== 1) {
          problemas++;
          console.log(`    ${bioma} p${piso} s${s}: ${entradas.length} entradas`);
          continue;
        }

        // --- 2. jefe presente -------------------------------------------
        const jefes = generado.tiles.filter((t) => t.kind === 'jefe');
        if (jefes.length !== 1) {
          sinJefe++;
          problemas++;
          continue;
        }

        // --- 3. la entrada llega al jefe --------------------------------
        const ruta = mapa.camino(
          generado,
          { x: entradas[0]!.x, y: entradas[0]!.y },
          { x: jefes[0]!.x, y: jefes[0]!.y },
          true,
        );
        if (!ruta) {
          problemas++;
          console.log(`    ${bioma} p${piso} s${s}: jefe INALCANZABLE`);
          continue;
        }
        entradaJefe++;

        // --- 4. nada abierto queda aislado ------------------------------
        const alcanzados = mapa.alcanzables(
          generado,
          { x: entradas[0]!.x, y: entradas[0]!.y },
          true,
        );

        for (const t of generado.tiles) {
          if (t.cerrada) continue;
          if (!alcanzados.has(`${t.x},${t.y}`)) {
            islas++;
            problemas++;
            console.log(`    ${bioma} p${piso} s${s}: ${t.kind} en isla (${t.x},${t.y})`);
            break;
          }
        }

        // --- 5. la cuenta de casillas por tipo --------------------------
        for (const t of generado.tiles) {
          const n = (tiposPorMapa[t.kind] ?? 0) + 1;
          tiposPorMapa[t.kind] = n;
        }
      }
    }
  }

  const total = biomas.length * 5 * SEMILLAS;
  check(`la entrada llega al jefe en los ${total} mapas`, entradaJefe === total, `${entradaJefe}/${total}`);
  check('nunca hay casillas abiertas aisladas', islas === 0, `${islas} islas`);
  check('siempre hay un jefe', sinJefe === 0, `${sinJefe} sin jefe`);
  check('ningún mapa imposible', problemas === 0, `${problemas} problemas`);

  console.log('    tipos que aparecen:');
  for (const [kind, n] of Object.entries(tiposPorMapa).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${kind.padEnd(14)} ${n}`);
  }

  // El jefe tiene que estar lejos de la entrada. Un jefe pegado a la entrada es
  // un mapa vacío de contenido.
  let juntos = 0;
  let medidos = 0;
  for (let s = 0; s < 40; s++) {
    const rng = mapa.rngDe(s * 31 + 5);
    const p = gen.generarPiso('ruinas', 0, rng, 10);
    const e = p.tiles.find((t) => t.kind === 'entrada');
    const j = p.tiles.find((t) => t.kind === 'jefe');
    if (!e || !j) continue;

    const d = Math.abs(e.x - j.x) + Math.abs(e.y - j.y);
    medidos++;
    if (d < 4) juntos++;
  }
  check('el jefe nunca está pegado a la entrada', juntos === 0, `${juntos} de ${medidos} a menos de 4 pasos`);
}

// ==========================================================================
console.log('\n=== 2. LA MISMA SEMILLA DA EL MISMO MAPA ===');
// ==========================================================================

{
  // Sin esto, volver a cargar un guardado pondría al jugador en un mapa
  // distinto del que estaba explorando, y su posición no significaría nada.
  let iguales = 0;
  const PARES = 20;

  for (let s = 0; s < PARES; s++) {
    const a = gen.generarPiso('ruinas', 2, mapa.rngDe(1234 + s), 30);
    const b = gen.generarPiso('ruinas', 2, mapa.rngDe(1234 + s), 30);

    const igual = JSON.stringify(a) === JSON.stringify(b);
    if (igual) iguales++;
  }

  check('la generación es determinista', iguales === PARES, `${iguales}/${PARES}`);

  // Y semillas distintas dan mapas distintos.
  const uno = JSON.stringify(gen.generarPiso('ruinas', 2, mapa.rngDe(1), 30));
  const otro = JSON.stringify(gen.generarPiso('ruinas', 2, mapa.rngDe(2), 30));
  check('semillas distintas dan mapas distintos', uno !== otro);
}

// ==========================================================================
console.log('\n=== 3. LOS TIPOS DE CASILLA ===');
// ==========================================================================

{
  // Un piso debe tener una mezcla VARIADA. Si todo sale del mismo tipo, el
  // jugador no tiene nada que elegir y la mazmorra es un pasillo.
  const tiposVistos = new Set<string>();
  let miniJefes = 0;
  let santuarios = 0;

  for (let s = 0; s < 80; s++) {
    const p = gen.generarPiso('ruinas', 1, mapa.rngDe(s * 131 + 3), 20);
    for (const t of p.tiles) {
      if (!t.cerrada) tiposVistos.add(t.kind);
      if (t.kind === 'minijefe') miniJefes++;
      if (t.kind === 'santuario') santuarios++;
    }
  }

  check('aparecen muchos tipos distintos', tiposVistos.size >= 5, `${tiposVistos.size} tipos: ${[...tiposVistos].join(', ')}`);
  check('hay mini jefes', miniJefes > 0, `${miniJefes} en 80 pisos`);
  check('hay santuarios', santuarios > 0, `${santuarios} en 80 pisos`);

  // El piso 1 no puede tener minijefes; el 3 sí debería.
  const piso0 = gen.generarPiso('ruinas', 0, mapa.rngDe(99), 15);
  check('el primer piso no tiene mini jefes', piso0.tiles.every((t) => t.kind !== 'minijefe'));
}

// ==========================================================================
console.log('\n=== 4. LOS BIOMAS SON DISTINTOS ===');
// ==========================================================================

{
  // Un bioma que se comporta igual que otro es un cambio de color.
  const cuenta = (bioma: mapa.Biome) => {
    const c: Record<string, number> = {};
    for (let s = 0; s < 40; s++) {
      const p = gen.generarPiso(bioma, 2, mapa.rngDe(s * 71 + 11), 25);
      for (const t of p.tiles) if (!t.cerrada) c[t.kind] = (c[t.kind] ?? 0) + 1;
    }
    return c;
  };

  const volcano = cuenta('volcan');
  const bosque = cuenta('bosque');
  const vacio = cuenta('vacio_digital');

  check(
    'el volcán tiene menos santuarios que el bosque',
    (volcano.santuario ?? 0) < (bosque.santuario ?? 0),
    `${volcano.santuario ?? 0} vs ${bosque.santuario ?? 0}`,
  );

  check(
    'el vacío digital tiene más eventos que el bosque',
    (vacio.evento ?? 0) > (bosque.evento ?? 0),
    `${vacio.evento ?? 0} vs ${bosque.evento ?? 0}`,
  );

  check('el volcán tiene su peligro declarado', Boolean(mapa.BIOMES.volcan.peligros));
  check('la zona congelada congela', mapa.BIOMES.congelada.peligros?.estado === 'congelado');
}

// ==========================================================================
console.log('\n=== 5. LAS ESPECIES SON REALES ===');
// ==========================================================================

{
  let falsas = 0;
  const vistas = new Set<string>();

  for (let s = 0; s < 60; s++) {
    const rng = mapa.rngDe(s * 977 + 5);
    const p = gen.generarPiso('vacio_digital', 3, rng, 40);

    for (const t of p.tiles) {
      if (t.contenido.tipo !== 'combate') continue;
      vistas.add(t.contenido.especie);
      if (!SPECIES[t.contenido.especie]) falsas++;
    }
  }

  check('ninguna especie inventada', falsas === 0, `${falsas} de ${vistas.size}`);
  check('hay variedad de especies', vistas.size >= 5, `${vistas.size} distintas`);

  // Y la rareza significa algo: un mitico no puede ser un Agumon.
  const miticas = gen.especiesParaRareza('mitico');
  const comunes = gen.especiesParaRareza('comun');
  check('las especies míticas no son las comunes', miticas.every((k) => !comunes.includes(k)), `${miticas.length} míticas`);
}

// ==========================================================================
console.log('\n=== 6. MINI JEFES Y EVENTOS ===');
// ==========================================================================

{
  check('hay arquetipos de mini jefe', minijefes.TOTAL_ARQUETIPOS >= 5, `${minijefes.TOTAL_ARQUETIPOS}`);
  check(
    'todos tienen descripción',
    minijefes.ARQUETIPOS_MINIJEFE.every((a) => a.descripcion.length > 20),
  );
  // Que declaren una mecánica CON NOMBRO. Antes la comprobación miraba cuatro
  // Flags concretos, así que los cuatro arquetipos cuya mecánica no cabía en
  // ningún Flag —Devorador, Reflejo, Coloso y Acechador— pasaban por no hacerlo
  // nada más que tener más vida, que es justo lo que no deben ser.
  check(
    'todos declaran al menos una mecánica',
    minijefes.ARQUETIPOS_MINIJEFE.every((a) => (a.mecanicas ?? []).length > 0),
    minijefes.ARQUETIPOS_MINIJEFE
      .map((a) => `${a.key}:${a.mecanicas.length}`)
      .join(' '),
  );

  check(
    'y ninguna mecánica está repetida entre arquetipos',
    new Set(minijefes.ARQUETIPOS_MINIJEFE.flatMap((a) => a.mecanicas)).size ===
      minijefes.ARQUETIPOS_MINIJEFE.reduce((n, a) => n + a.mecanicas.length, 0),
  );
  check('las claves son únicas', new Set(minijefes.ARQUETIPOS_MINIJEFE.map((a) => a.key)).size === minijefes.TOTAL_ARQUETIPOS);

  check('hay eventos en la tabla', eventos.TOTAL_EVENTOS >= 10, `${eventos.TOTAL_EVENTOS}`);
  check(
    'todos tienen sus dos opciones',
    eventos.TABLA_EVENTOS.every((e) => e.opciones.length === 2 && e.opciones.every((o) => o.length > 1)),
  );
  check('todos tienen peso positivo', eventos.TABLA_EVENTOS.every((e) => e.peso > 0));
  check(
    'las claves son únicas',
    new Set(eventos.TABLA_EVENTOS.map((e) => e.key)).size === eventos.TOTAL_EVENTOS,
  );
  check(
    'todo grupo tiene al menos un evento',
    (Object.keys(eventos.GRUPOS_EVENTO) as string[]).every((g) =>
      eventos.TABLA_EVENTOS.some((e) => e.grupo === g),
    ),
  );

  // Y elegir uno siempre devuelve uno.
  const rng = mapa.rngDe(42);
  const gordos = new Set<string>();
  for (let i = 0; i < 400; i++) gordos.add(eventos.elegirEvento(rng).key);
  check('elegir evento devuelve algo válido', gordos.size >= 5, `${gordos.size} eventos distintos vistos`);
}

// ==========================================================================
console.log('\n=== 7. LOS PISOS CRECEN ===');
// ==========================================================================

{
  const tamanos: string[] = [];
  for (let piso = 0; piso < 5; piso++) {
    const p = gen.generarPiso('ruinas', piso, mapa.rngDe(7), 10 + piso * 5);
    tamanos.push(`${p.ancho}x${p.alto}`);
  }
  console.log(`    tamaños: ${tamanos.join(', ')}`);
  check('el mapa crece con la profundidad', new Set(tamanos).size >= 3, tamanos.join(' '));
}

for (const sufijo of ['', '-wal', '-shm']) {
  try {
    rmSync(`./data/check-mapa.db${sufijo}`, { force: true });
  } catch {
    // Lock de SQLite: no motivo para abortar.
  }
}

if (fallidos.length > 0) {
  console.log('\nFallos:');
  for (const f of fallidos) console.log('  - ' + f);
}

console.log(
  fallos === 0
    ? '\nOK: el generador no produce mapas imposibles.'
    : `\n${fallos} fallo(s).`,
);

process.exit(fallos === 0 ? 0 : 1);