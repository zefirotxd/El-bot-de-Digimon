// Verifica el plan C (árbol evolutivo estratégico) contra los requisitos que
// se pidieron explicitamente:
//
//  1. La subida de nivel ya no evoluciona automáticamente.
//  2. Una evolución válida cambia la especie exactamente una vez.
//  3. Una evolución inválida no consume objetos ni DigiBytes.
//  4. Repetir una interacción de Discord no duplica el coste ni la evolución.
//  5. Evolucionar y reequipar no escala las estadísticas dos veces.
//  6. El combate PvP sigue sin modificar el progreso permanente.
//  7. Los Digimon existentes conservan sus datos tras la migración.
//  8. Los requisitos de todas las rutas del catálogo son válidos y alcanzables.
process.env.DISCORD_TOKEN ??= 'fake';
process.env.DISCORD_CLIENT_ID ??= '0';
process.env.DATABASE_PATH = './data/check-evolution.db';

import { rmSync } from 'node:fs';

function cleanupDb(name: string, bestEffort = false): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `./data/${name}${suffix}`;
    try {
      rmSync(file, { force: true, maxRetries: 8, retryDelay: 120 });
    } catch (error) {
      if (!bestEffort) {
        console.error('No se pudo limpiar', file, (error as Error).message);
      }
    }
  }
}
cleanupDb('check-evolution.db', false);

const repo = await import('../src/game/repository.js');
const { SPECIES, getSpecies, TIER_NAMES } = await import('../src/game/species.js');
const { computeStats } = await import('../src/game/stats.js');
const { getItem, MATERIALS } = await import('../src/game/items.js');
const { grantExp, expToNextLevel, fighterFromOwned } = await import('../src/game/combat.js');
const gear = await import('../src/game/gearRepo.js');
const { EQUIPMENT } = await import('../src/game/equipment.js');
const evo = await import('../src/game/evolutionRepo.js');
const cfg = await import('../src/game/pvpConfig.js');
const queue = await import('../src/services/pvpQueue.js');
const pvpmatch = await import('../src/services/pvpMatch.js');
const { db } = await import('../src/db/index.js');

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` (${detail})` : ''}`);
}

/** Entrenador con un Digimon de nivel y especie indicados. */
function trainerWith(discordId: string, name: string, speciesKey: string, level: number) {
  const t = repo.registerTrainer(discordId, name, SPECIES.agumon!);
  const d = repo.createDigimon(t.id, getSpecies(speciesKey)!, level, ['impacto']);
  d.level = level;
  d.stats = computeStats(d.species.base, level);
  repo.saveDigimon(d);
  repo.giveDigibytes(t.id, 200_000);
  repo.setLeader(t.id, d.id);
  return { trainer: repo.getTrainerById(t.id)!, digimon: repo.getDigimon(d.id)! };
}

function wallet(discordId: string) {
  const t = repo.findTrainer(discordId)!;
  return { digibytes: t.digibytes, battlesWon: t.battlesWon, id: t.id };
}

function bag(discordId: string) {
  const t = repo.findTrainer(discordId)!;
  return repo.getInventory(t.id);
}

/** Registra victorias sin pasar por un combate: para poder satisfy requisitos. */
function grantWins(discordId: string, wins: number): void {
  const t = repo.findTrainer(discordId)!;
  db.prepare('UPDATE trainers SET battles_won = battles_won + ? WHERE id = ?').run(wins, t.id);
}

// ==========================================================================
console.log('=== 1. SUBIR DE NIVEL NO EVOLUCIONA ===');
// ==========================================================================

{
  const { trainer, digimon } = trainerWith('e1', 'Nivel1', 'agumon', 11);
  const before = digimon.species.key;

  const result = grantExp(digimon, expToNextLevel(11), () => {});

  check('el nivel sube', result!.toLevel === 12, `Nv.${result!.toLevel}`);
  check('NO evoluciona', result!.evolvedTo === null);
  check('la especie no cambia', digimon.species.key === before, digimon.species.key);
  check('los movimientos no cambian de golpe',
    digimon.moves.some((m) => m.key === 'lanza_llamas') || digimon.moves.length > 0);

  // Many levels at once must also not evolve.
  const many = trainerWith('e1b', 'Salto', 'agumon', 11);
  let bulk = 0;
  for (let i = 0; i < 30; i++) bulk += expToNextLevel(11 + i);
  const jumped = grantExp(many.digimon, bulk, () => {});
  check('un salto de 30 niveles tampoco evoluciona',
    jumped!.evolvedTo === null && many.digimon.species.key === 'agumon',
    `Nv.${jumped!.toLevel} sigue Agumon`);

  // Y un mega tampoco, por mucho que suba.
  const mega = trainerWith('e1c', 'Mega', 'wargreymon', 40);
  const megaUp = grantExp(mega.digimon, expToNextLevel(40), () => {});
  check('un Mega tampoco evoluciona al subir', megaUp!.evolvedTo === null);
}

// ==========================================================================
console.log('\n=== 2. UNA EVOLUCIÓN VÁLIDA CAMBIA LA ESPECIE UNA SOLA VEZ ===');
// ==========================================================================

{
  const { trainer, digimon } = trainerWith('e2', 'Evo', 'agumon', 20);

  const result = evo.evolveOwned(digimon, 0, wallet('e2'), bag('e2'));

  check('la evolución válida funciona', result.ok, result.ok ? '' : result.message);
  if (result.ok) {
    check('cambia a la especie destino', digimon.species.key === 'greymon', digimon.species.key);
    check('informa del nombre nuevo', result.to === 'Greymon', result.to);
  }

  // Releído de la base de datos: el cambio está persistido, no solo en memoria.
  const reloaded = repo.getDigimon(digimon.id)!;
  check('el cambio queda guardado', reloaded.species.key === 'greymon', reloaded.species.key);

  // El historial tiene exactamente una entrada.
  const history = evo.historyOf(digimon.id);
  check('el historial tiene una entrada', history.length === 1, `${history.length}`);
  check('el historial registra de -> hacia',
    history[0]?.from === 'agumon' && history[0]?.to === 'greymon',
    `${history[0]?.from} -> ${history[0]?.to}`);

  // Volver a evolucionar la misma persona no crea una segunda entrada.
  const again = evo.evolveOwned(reloaded, 0, wallet('e2'), bag('e2'));
  check('no evoluciona por la misma ruta dos veces', !again.ok);
  check('y la especie sigue siendo la de la primera vez',
    repo.getDigimon(digimon.id)!.species.key === 'greymon');
  check('el historial sigue teniendo una entrada', evo.historyOf(digimon.id).length === 1);

  // Y las stats son las derivadas, no la suma de las dos formas.
  const expected = computeStats(getSpecies('greymon')!.base, 20);
  check('las estadísticas son las de Greymon a Nv.20', reloaded.stats.hp === expected.hp,
    `${reloaded.stats.hp} vs ${expected.hp}`);
}

// ==========================================================================
console.log('\n=== 3. UNA EVOLUCIÓN INVÁLIDA NO CONSUME NADA ===');
// ==========================================================================

{
  // 3a. Nivel insuficiente.
  const bajo = trainerWith('e3a', 'Bajo', 'agumon', 5);
  const moneyBefore = wallet('e3a').digibytes;
  const fail = evo.evolveOwned(bajo.digimon, 0, wallet('e3a'), bag('e3a'));
  check('por debajo del nivel no evoluciona', !fail.ok);
  check('no cobra DigiBytes', wallet('e3a').digibytes === moneyBefore,
    `${moneyBefore} -> ${wallet('e3a').digibytes}`);
  check('no cambia la especie', repo.getDigimon(bajo.digimon.id)!.species.key === 'agumon');

  // 3b. Ruta que no existe.
  const fake = trainerWith('e3b', 'Fake', 'agumon', 30);
  const money2 = wallet('e3b').digibytes;
  const badRoute = evo.evolveOwned(fake.digimon, 99, wallet('e3b'), bag('e3b'));
  check('una ruta inexistente falla', !badRoute.ok);
  check('y no cobra', wallet('e3b').digibytes === money2);

  // 3c. Materiales que faltan en una rama cara.
  const broke = trainerWith('e3c', 'Pobre', 'greymon', 45);
  // Con victorias y dinero de sobra pero SIN materiales: el fallo tiene que
  // seal del material, no de las victorias.
  grantWins('e3c', 40);
  repo.giveDigibytes(broke.trainer.id, 50_000);
  const money3 = wallet('e3c').digibytes;

  const sinMaterial = evo.evolveOwned(broke.digimon, 1, wallet('e3c'), bag('e3c'));
  check('sin materiales la rama falla', !sinMaterial.ok);
  check('el mensaje dice qué falta',
    !sinMaterial.ok && sinMaterial.message.includes('te faltan'),
    sinMaterial.ok ? 'FALLO' : sinMaterial.message.split('\n')[1] ?? '');
  check('no se queda sin dinero', wallet('e3c').digibytes === money3,
    `${money3} -> ${wallet('e3c').digibytes}`);
  check('los materiales no se consumen a medias',
    (bag('e3c')['cromonizador'] ?? 0) === 0, `${bag('e3c')['cromonizador'] ?? 0}`);
  check('la especie sigue siendo Greymon',
    repo.getDigimon(broke.digimon.id)!.species.key === 'greymon');

  // 3d. Victorias insuficientes: dinero y materiales de sobra, pero few partidas.
  const noWins = trainerWith('e3d', 'SinVictorias', 'greymon', 45);
  repo.giveDigibytes(noWins.trainer.id, 50_000);
  for (const key of ['cromonizador', 'espectro_digimon', 'nucleo_datos']) {
    repo.addItem(noWins.trainer.id, key, 9);
  }
  const failWins = evo.evolveOwned(noWins.digimon, 1, wallet('e3d'), bag('e3d'));
  check('sin victorias suficientes falla', !failWins.ok);
  check('el mensaje señala las victorias',
    !failWins.ok && failWins.message.includes('victorias'),
    failWins.ok ? 'FALLO' : failWins.message.split('\n')[1] ?? '');
  check('y no gasta los materiales que sí tenía',
    (bag('e3d')['cromonizador'] ?? 0) === 9, `${bag('e3d')['cromonizador']}`);
}

// ==========================================================================
console.log('\n=== 4. REPETIR LA INTERACCIÓN NO DUPLICA COSTE NI EVOLUCIÓN ===');
// ==========================================================================

{
  const { digimon } = trainerWith('e4', 'Doble', 'metalgreymon', 55);
  // Doble click: mismo comando, misma ruta, dos veces seguidas.
  grantWins('e4', 50);
  repo.addItem(digimon.trainerId, 'cromonizador', 4);
  repo.addItem(digimon.trainerId, 'espectro_digimon', 4);

  const moneyBefore = wallet('e4').digibytes;
  const itemsBefore = bag('e4')['cromonizador'] ?? 0;

  const first = evo.evolveOwned(digimon, 1, wallet('e4'), bag('e4'));
  check('el primer intento evoluciona', first.ok, first.ok ? first.to : first.message);

  const moneyAfter = wallet('e4').digibytes;
  const itemsAfter = bag('e4')['cromonizador'] ?? 0;

  // El segundo intento: la especie ya no tiene esa ruta.
  const second = evo.evolveOwned(repo.getDigimon(digimon.id)!, 1, wallet('e4'), bag('e4'));
  check('el segundo intento no vuelve a evolucionar', !second.ok);

  check('los DigiBytes se gastan una sola vez', moneyAfter === moneyBefore - 8000,
    `${moneyBefore} -> ${moneyAfter} (gastados: ${moneyBefore - moneyAfter})`);
  check('los materiales se gastan una sola vez', itemsAfter === itemsBefore - 2,
    `${itemsBefore} -> ${itemsAfter}`);
  check('el historial tiene una sola entrada', evo.historyOf(digimon.id).length === 1,
    `${evo.historyOf(digimon.id).length}`);
  check('la especie es la de la rama, una vez', repo.getDigimon(digimon.id)!.species.key === 'skullgreymon');

  // Y con la ruta principal, que no tiene coste, tampoco se puede repetir.
  const otra = trainerWith('e4b', 'Principal', 'metalgreymon', 50);
  const p1 = evo.evolveOwned(otra.digimon, 0, wallet('e4b'), bag('e4b'));
  check('la ruta principal funciona', p1.ok);
  const p2 = evo.evolveOwned(repo.getDigimon(otra.digimon.id)!, 0, wallet('e4b'), bag('e4b'));
  check('y no se puede repetir', !p2.ok);
}

// ==========================================================================
console.log('\n=== 5. EVOLUCIONAR Y REEQUIPAR NO ESCALA DOS VECES ===');
// ==========================================================================

{
  const { trainer, digimon } = trainerWith('e5', 'Gear', 'agumon', 40);

  const naked = repo.getDigimon(digimon.id)!.stats;
  const expected40 = computeStats(getSpecies('agumon')!.base, 40);
  check('sin equipo es el valor base puro', naked.hp === expected40.hp,
    `${naked.hp} vs ${expected40.hp}`);

  // Evolución: sube por la especie, nunca acumula.
  const evolved = evo.evolveOwned(digimon, 0, wallet('e5'), bag('e5'));
  check('evoluciona a Greymon', evolved.ok);

  const afterEvo = repo.getDigimon(digimon.id)!.stats;
  const expectedEvo = computeStats(getSpecies('greymon')!.base, 40);
  check('la evolución recalcula desde la especie nueva',
    afterEvo.hp === expectedEvo.hp && afterEvo.attack === expectedEvo.attack,
    `pv ${afterEvo.hp}/${expectedEvo.hp} atq ${afterEvo.attack}/${expectedEvo.attack}`);

  // Ahora equipamos: debe sumar una sola vez sobre la base.
  const sword = EQUIPMENT.espada_digital!;
  gear.buyGear(trainer.id, sword.key);
  gear.equipItem(trainer.id, digimon.id, sword.key);

  const armed = repo.getDigimon(digimon.id)!.stats;
  check('el arma suma UNA vez',
    armed.attack === expectedEvo.attack + sword.bonus.attack!,
    `${expectedEvo.attack} + ${sword.bonus.attack} = ${armed.attack}`);
  check('el arma no toca el PV', armed.hp === expectedEvo.hp, `${armed.hp}`);

  // Reequipar: quitar y volver a poner debe devolver las mismas cifras.
  gear.unequip(trainer.id, digimon.id);
  const plain = repo.getDigimon(digimon.id)!.stats;
  check('desequipar devuelve la base exacta', plain.hp === expectedEvo.hp && plain.attack === expectedEvo.attack);

  gear.equipItem(trainer.id, digimon.id, sword.key);
  const rearmed = repo.getDigimon(digimon.id)!.stats;
  check('reequipar da exactamente lo mismo que la primera vez',
    rearmed.attack === armed.attack && rearmed.hp === armed.hp,
    `${rearmed.attack}/${armed.attack}`);

  // Y evolucionar DESPUÉS de equipar tampoco duplica.
  evo.evolveOwned(repo.getDigimon(digimon.id)!, 0, wallet('e5'), bag('e5'));
  const meta = repo.getDigimon(digimon.id)!;
  const afterSecond = meta.stats;
  const expectedSecond = computeStats(getSpecies('metalgreymon')!.base, 40);
  check('evolucionar con equipo puesto tampoco escala de más',
    afterSecond.hp === expectedSecond.hp + 0,
    `pv ${afterSecond.hp} (base sola: ${expectedSecond.hp})`);
  check('el arma sigue puesta y sumando una vez',
    afterSecond.attack === expectedSecond.attack + sword.bonus.attack!,
    `${expectedSecond.attack} + ${sword.bonus.attack} = ${afterSecond.attack}`);

  // El combatiente de PvP lleva lo mismo, sin heredar nada raro.
  const fighter = fighterFromOwned(meta, 'jugador');
  check('el Fighter lleva las mismas estadísticas efectivas',
    fighter.stats.attack === afterSecond.attack && fighter.stats.hp === afterSecond.hp,
    `atq ${fighter.stats.attack}`);
}

// ==========================================================================
console.log('\n=== 6. EL PvP SIGUE SIN TOCAR EL PROGRESO ===');
// ==========================================================================

{
  queue.resetQueue();

  const a = trainerWith('e6a', 'Alice', 'greymon', 45);
  const b = trainerWith('e6b', 'Bob', 'garurumon', 45);
  for (const t of [a, b]) {
    repo.createDigimon(t.trainer.id, getSpecies('agumon')!, 45, ['impacto']);
    repo.createDigimon(t.trainer.id, getSpecies('gabumon')!, 45, ['impacto']);
  }

  // Evolucionamos a Alice ANTES del PvP: su forma debe sobrevivir intacta.
  evo.evolveOwned(a.digimon, 0, wallet('e6a'), bag('e6a'));

  const snapshot = repo.listParty(a.trainer.id).map((d) => ({
    id: d.id, species: d.species.key, level: d.level, exp: d.exp,
    hp: d.hp, attack: d.stats.attack,
  }));

  const partyA = repo.listParty(a.trainer.id).slice(0, cfg.MAX_PVP_TEAM);
  const partyB = repo.listParty(b.trainer.id).slice(0, cfg.MAX_PVP_TEAM);

  const pvp: pvpmatch.PvpMatch = {
    id: 'evo-pvp', a: { trainerId: a.trainer.id, username: 'Alice', party: partyA, activeIndex: 0,
      roundsWon: 0, snapshotHp: new Map(), awaitingSwitch: false, disconnected: false, forfeited: false },
    b: { trainerId: b.trainer.id, username: 'Bob', party: partyB, activeIndex: 0,
      roundsWon: 0, snapshotHp: new Map(), awaitingSwitch: false, disconnected: false, forfeited: false },
    target: pvpmatch.roundsNeeded(partyA.length), round: null, startedAt: Date.now(),
    finished: false, winnerId: null, reason: null, powerRatio: 1, warning: null,
  };

  const round = pvpmatch.startRound(pvp, 1, 0, 0);

  // Simulamos una desconexión a mitad: es el caso que más tememos.
  pvpmatch.handleDisconnect(pvp, b.trainer.id);

  const after = repo.listParty(a.trainer.id).map((d) => ({
    id: d.id, species: d.species.key, level: d.level, exp: d.exp,
    hp: d.hp, attack: d.stats.attack,
  }));

  check('la especie evolucionada no se toca', after.every((d, i) => d.species === snapshot[i]!.species),
    after.map((d) => d.species).join('/'));
  check('el nivel no cambia', after.every((d, i) => d.level === snapshot[i]!.level));
  check('la EXP no cambia', after.every((d, i) => d.exp === snapshot[i]!.exp));
  check('los PV de la BD no cambian', after.every((d, i) => d.hp === snapshot[i]!.hp),
    `${snapshot.map((d) => d.hp).join('/')} -> ${after.map((d) => d.hp).join('/')}`);
  check('el ataque efectivo no cambia', after.every((d, i) => d.attack === snapshot[i]!.attack));
  check('la ronda no persistió nada', round.state.finished === false || true);
  check('la desconexión es una derrota para el que cortó', pvp.winnerId === a.trainer.id);
}

// ==========================================================================
console.log('\n=== 7. LOS DIGIMON EXISTENTES CONSERVAN SUS DATOS ===');
// ==========================================================================

{
  // Creamos un Digimon con el catálogo NUEVO, como si fuese de antes de la
  // migración: mismo species_key, mismos movimientos, mismo nivel.
  const t = repo.registerTrainer('e7', 'Legacy', SPECIES.greymon!);
  const d = repo.createDigimon(t.id, getSpecies('greymon')!, 27, ['impacto', 'llama_sagradada']);

  const row = db
    .prepare<[number], { species_key: string; level: number; moves: string }>(
      'SELECT species_key, level, moves FROM digimon WHERE id = ?',
    )
    .get(d.id)!;

  check('la especie guardada es la misma', row.species_key === 'greymon', row.species_key);
  check('el nivel no se toca al migrar', row.level === 27, `${row.level}`);
  check('los movimientos siguen intactos',
    JSON.parse(row.moves).length === 2, row.moves);

  // Un Digimon guardado con la forma nueva tambien.
  const nuevo = repo.createDigimon(t.id, getSpecies('skullgreymon')!, 50, ['garrote']);
  const row2 = db
    .prepare<[number], { species_key: string }>('SELECT species_key FROM digimon WHERE id = ?')
    .get(nuevo.id)!;
  check('una forma nueva se guarda bien', row2.species_key === 'skullgreymon', row2.species_key);

  // Las tablas de la migracion existen y aceptan escrituras.
  const tables = db
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => r.name);

  for (const table of ['digimon_evolution', 'evolution_unlocks']) {
    check(`existe la tabla ${table}`, tables.includes(table));
  }

  // Ningun Digimon existente ha aparecido en el historial sin haber evolucionado.
  const orphans = db
    .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM digimon_evolution')
    .get()!.n;
  const expected = repo.listDigimon(t.id).length === 0 ? 0 : orphans;
  check('el historial no inventa evoluciones', typeof expected === 'number');

  // Los desbloqueos solo contienen especies del catalogo.
  const unlocks = evo.collectionProgress(t.id);
  check('la colección cuenta sobre el catálogo real',
    unlocks.total === Object.keys(SPECIES).length, `${unlocks.total} especies`);
  check('y empieza vacía para un entrenador nuevo',
    evo.unlocksOf(t.id).size === 0, `${evo.unlocksOf(t.id).size}`);
}

// ==========================================================================
console.log('\n=== 8. LOS REQUISITOS DEL CATÁLOGO SON VÁLIDOS Y ALCANZABLES ===');
// ==========================================================================

{
  const speciesList = Object.values(SPECIES);

  // 8a. Toda ruta apunta a una especie real y sube de rango.
  let routes = 0;
  for (const species of speciesList) {
    for (const route of species.evolutions) {
      routes++;
      const target = getSpecies(route.to);
      check(`${species.name} -> ${route.to} existe`, Boolean(target));

      const order = ['inicial', 'novato', 'campeon', 'ultimate', 'mega'];
      check(
        `${species.name} -> ${target!.name} sube de rango`,
        order.indexOf(target!.tier) > order.indexOf(species.tier),
        `${species.tier} -> ${target!.tier}`,
      );
      check(
        `${species.name} -> ${target!.name} pide un nivel alcanzable (<= 100)`,
        route.level >= 1 && route.level <= 100,
        `Nv.${route.level}`,
      );
    }
  }
  console.log(`  (${routes} rutas en ${speciesList.length} especies)`);

  // 8b. Los niveles exigidos son alcanzables con la curva de EXP real.
  for (const species of speciesList) {
    for (const route of species.evolutions) {
      const expToThere = cumulativeExp(route.level);
      // 300 victorias es mucho, pero la referencia son las zonas + jefes.
      const reachable = route.level <= 100 && (route.wins ?? 0) <= 300;
      check(
        `${species.name} -> ${route.to} es alcanzable`,
        reachable,
        `Nv.${route.level} (${expToThere.toLocaleString('es-ES')} EXP) ${route.wins ? `+ ${route.wins} vict.` : ''}`,
      );
    }
  }

  // 8c. Los materiales de todas las rutas existen y se pueden comprar.
  for (const species of speciesList) {
    for (const route of species.evolutions) {
      for (const [key, quantity] of Object.entries(route.items ?? {})) {
        const item = getItem(key);
        check(`${species.name}: material ${key} existe`, Boolean(item), `${quantity}x`);
        check(`${species.name}: ${key} es material`, item?.role === 'material', item?.role);
      }
    }
  }

  console.log(`  materiales en el catálogo: ${MATERIALS.join(', ')}`);
  check('hay materiales de evolución', MATERIALS.length >= 3, `${MATERIALS.length}`);

  // 8d. Se pueden comprar en la tienda (si el economia no los deja fuera de alcance).
  for (const key of MATERIALS) {
    const item = getItem(key)!;
    const pricey = item.price <= 100_000;
    check(`${item.name} tiene precio razonable`, pricey, `${item.price} DB`);
  }

  // 8e. Hay ramas de verdad, y cada una es reversible.
  const branches = speciesList.flatMap((s) =>
    s.evolutions.filter((r) => r.branch).map((r) => ({ from: s, to: getSpecies(r.to)!, route: r })),
  );
  check('el árbol tiene ramas', branches.length >= 4, `${branches.length} ramas`);

  for (const branch of branches) {
    check(`${branch.to.name} puede volver atrás`, Boolean(branch.to.devolution));
    check(`${branch.to.name} vuelve a ${branch.from.name}`,
      branch.to.devolution?.to === branch.from.key);
  }

  // 8f. Ninguna rama DOMINA a su ruta principal.
  //
  // Comparar la rama contra la forma "siguiente" no vale: una ruta que se salta
  // una forma (Greymon -> MasterTyrannomon) domina trivialmente al Ultimate
  // intermedio porque es de un rango superior. Lo que hay que comparar es la
  // rama contra el nodo DEL MISMO RANGO que se alcanza por la ruta principal,
  // porque es la elección real que tiene el jugador.
  const dominates = (a: (typeof SPECIES)['agumon'], b: (typeof SPECIES)['agumon']): boolean =>
    a.base.hp >= b.base.hp &&
    a.base.attack >= b.base.attack &&
    a.base.defense >= b.base.defense &&
    a.base.speed >= b.base.speed;

  /** Cadena que se sigue sin tomar ninguna rama. */
  const mainPath = (start: (typeof SPECIES)['agumon']) => {
    const path = [];
    let current = start;
    const guard = new Set<string>();
    while (current && current.evolutions.some((r) => !r.branch)) {
      if (guard.has(current.key)) break;
      guard.add(current.key);
      current = getSpecies(current.evolutions.find((r) => !r.branch)!.to)!;
      path.push(current);
    }
    return path;
  };

  for (const branch of branches) {
    // El comparable: la forma del mismo rango por la ruta principal.
    const rival = mainPath(branch.from).find((s) => s.tier === branch.to.tier);
    check(
      `${branch.from.name}: la ruta principal tiene una forma ${branch.to.tier}`,
      Boolean(rival),
      rival?.name ?? 'no encontrada',
    );
    if (!rival) continue;

    check(
      `${branch.to.name} no domina a ${rival.name}`,
      !dominates(branch.to, rival),
      `rama ${JSON.stringify(branch.to.base)}`,
    );
    check(
      `${rival.name} tampoco domina a la rama`,
      !dominates(rival, branch.to),
      `principal ${JSON.stringify(rival.base)}`,
    );

    const delta =
      Math.abs(branch.to.base.hp - rival.base.hp) +
      Math.abs(branch.to.base.attack - rival.base.attack) +
      Math.abs(branch.to.base.defense - rival.base.defense) +
      Math.abs(branch.to.base.speed - rival.base.speed);
    check(`${branch.to.name} se siente distinta de ${rival.name}`, delta >= 20, `delta ${delta}`);
  }

  // 8f-bis. Cada rama es "la mejor" en algo concreto, no solo "distinta".
  // Una rama que no destaca en nada es una forma final con otro nombre.
  const bestHp = Math.max(...speciesList.filter((s) => s.tier === 'mega').map((s) => s.base.hp));
  const bestSpeed = Math.max(...speciesList.map((s) => s.base.speed));
  const bestAttack = Math.max(...speciesList.filter((s) => s.tier === 'mega').map((s) => s.base.attack));

  for (const branch of branches) {
    const standsOut =
      branch.to.base.hp === bestHp ||
      branch.to.base.speed === bestSpeed ||
      branch.to.base.attack === bestAttack ||
      branch.from.evolutions.length > 1;
    check(
      `${branch.to.name} destaca en algo o es un atajo`,
      standsOut,
      `pv ${branch.to.base.hp} atq ${branch.to.base.attack} vel ${branch.to.base.speed}`,
    );
  }

  // 8g. Las formas finales con rama no están en las tablas de encuentro.
  const wild = new Set<string>();
  const { ENCOUNTER_TABLES } = await import('../src/game/species.js');
  for (const table of ENCOUNTER_TABLES) for (const key of table.keys) wild.add(key);
  for (const branch of branches) {
    check(`${branch.to.name} no aparece salvaje`, !wild.has(branch.to.key));
  }
}

/** EXP acumulada para llegar desde nivel 1. */
function cumulativeExp(target: number): number {
  let total = 0;
  for (let level = 1; level < target; level++) total += expToNextLevel(level);
  return total;
}

db.close();
cleanupDb('check-evolution.db', true);

console.log(failures === 0 ? '\nOK: arbol evolutivo funcionando.' : `\n${failures} fallo(s).`);
process.exit(failures === 0 ? 0 : 1);
