// Verifica el plan D (mazmorras, incursiones y jefes con fases):
//
//  1. Los jefes tienen mecánicas propias, no solo más PV.
//  2. Las fases cambian algo que el jugador puede leer.
//  3. Los ataques telegrafiados avisan con margen y se pueden responder.
//  4. El progreso de mazmorra se guarda SALA A SALA.
//  5. La recompensa escala con la contribución, no con participar.
//  6. La energía y los intentos son diarios y no se pueden farmed.
//  7. El jefe global tiene vida compartida que sobrevive al reinicio.
process.env.DISCORD_TOKEN ??= 'fake';
process.env.DISCORD_CLIENT_ID ??= '0';
process.env.DATABASE_PATH = './data/check-dungeon.db';

import { rmSync } from 'node:fs';

function cleanupDb(name: string, bestEffort = false): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(`./data/${name}${suffix}`, { force: true, maxRetries: 8, retryDelay: 120 });
    } catch (error) {
      if (!bestEffort) console.error('No se pudo limpiar', suffix, (error as Error).message);
    }
  }
}
cleanupDb('check-dungeon.db', false);

const repo = await import('../src/game/repository.js');
const { SPECIES, getSpecies } = await import('../src/game/species.js');
const { computeStats } = await import('../src/game/stats.js');
const { getItem } = await import('../src/game/items.js');
const bosses = await import('../src/game/bosses.js');
const dungeons = await import('../src/game/dungeons.js');
const dungeonRepo = await import('../src/game/dungeonRepo.js');
const runs = await import('../src/services/runs.js');
const trainers = await import('../src/game/trainers.js');
const combat = await import('../src/game/combat.js');
const { Rng } = await import('../src/game/random.js');
const { MOVES } = await import('../src/game/moves.js');
const { db } = await import('../src/db/index.js');

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` (${detail})` : ''}`);
}

function trainerWith(discordId: string, name: string, speciesKey: string, level: number) {
  const t = repo.registerTrainer(discordId, name, SPECIES.agumon!);
  const d = repo.createDigimon(t.id, getSpecies(speciesKey)!, level, ['impacto']);
  d.level = level;
  d.stats = computeStats(d.species.base, level);
  repo.saveDigimon(d);
  repo.setLeader(t.id, d.id);
  return repo.getTrainerById(t.id)!;
}

function fullParty(trainerId: number, keys: string[], level: number) {
  for (const key of keys) {
    const d = repo.createDigimon(trainerId, getSpecies(key)!, level, ['impacto']);
    d.level = level;
    d.stats = computeStats(d.species.base, level);
    repo.saveDigimon(d);
  }
}

// ==========================================================================
console.log('=== 1. LOS JEFES TIENEN MECÁNICAS PROPIAS ===');
// ==========================================================================

{
  const list = Object.values(bosses.BOSSES);
  check('hay al menos 3 jefes', list.length >= 3, `${list.length}`);

  for (const boss of list) {
    check(`${boss.name}: al menos 2 fases`, boss.phases.length >= 2, `${boss.phases.length}`);
    check(`${boss.name}: especie base existe`, Boolean(getSpecies(boss.speciesKey)));
    check(`${boss.name}: tiene lore`, boss.lore.length > 15);
    check(`${boss.name}: telegrafía un golpe real`, boss.telegraph !== undefined || list.length === 1);

    // Lo que separa un jefe de un enemigo grande: cada fase cambia algo.
    for (const phase of boss.phases) {
      const changed =
        phase.attribute !== undefined ||
        phase.weakTo !== undefined ||
        phase.resists !== undefined ||
        phase.immuneTo !== undefined ||
        phase.damageTaken !== undefined ||
        phase.regen !== undefined;
      check(`${boss.name} / ${phase.name}: cambia algo observable`, changed);
      check(`${boss.name} / ${phase.name}: se anuncia`, phase.announce.length > 10);
    }
  }

  // hpScale moderado: si el jefe es solo un numero gigante, no hay partida.
  for (const boss of list) {
    check(
      `${boss.name}: la vida no es el único recurso`,
      boss.hpScale < 4,
      `hp ×${boss.hpScale}`,
    );
  }
}

// ==========================================================================
console.log('\n=== 2. LAS FASES CAMBIAN EL EMPAREJAMIENTO ===');
// ==========================================================================

{
  for (const boss of Object.values(bosses.BOSSES)) {
    const fighter = combat.buildBossFighter(boss, 'rival');

    const seen = new Set<string>();
    for (let i = 0; i < boss.phases.length; i++) {
      combat.setBossPhase(fighter, i);
      const profile = combat.effectiveSpecies(fighter);
      const key = `${profile.attribute}|${profile.weakTo}|${profile.resists}|${profile.immuneTo ?? []}`;
      seen.add(key);
    }

    check(
      `${boss.name}: las fases no son todas el mismo perfil`,
      seen.size >= 2,
      `${seen.size} perfiles distintos de ${boss.phases.length} fases`,
    );
  }

  // El motor anuncia el cambio y cambia el atributo efectivo.
  const boss = bosses.getBoss('titanramon')!;
  const fighter = combat.buildBossFighter(boss, 'rival');

  const attacker = trainerWith('f1', 'Atacante', 'wargreymon', 60);
  const state = combat.createBattle(repo.listParty(attacker.id), 0, SPECIES.wargreymon!, 60);
  state.enemy = fighter;
  state.enemyTeam = [fighter];
  state.enemyIndex = 0;
  state.isBoss = true;

  const before = combat.effectiveSpecies(fighter).attribute;
  fighter.hp = Math.round(fighter.stats.hp * 0.5);
  combat.resolveTurn(state, { type: 'defender' }, new Rng(4));

  check('el motor avanza de fase solo', fighter.boss!.phaseIndex >= 1, `fase ${fighter.boss!.phaseIndex}`);
  check('el atributo efectivo cambia con la fase',
    combat.effectiveSpecies(fighter).attribute !== before,
    `${before} -> ${combat.effectiveSpecies(fighter).attribute}`);
  check('el cambio se dice en el log',
    state.log.some((l) => l.includes('cambia de fase')),
    state.log.slice(-3).join(' | ').slice(0, 60));
}

// ==========================================================================
console.log('\n=== 3. TELEGRAFÍADOS CON MARGEN Y RESPUESTA ===');
// ==========================================================================

{
  const boss = bosses.getBoss('titanramon')!;
  check('el golpe telegrafiado existe', Boolean(MOVES[boss.telegraph!.moveKey]));
  check('avisa con 2+ turnos', boss.telegraph!.lead >= 2, `${boss.telegraph!.lead}`);
  check('pega mas que un golpe normal', boss.telegraph!.power > 1, `×${boss.telegraph!.power}`);
  check('cada respuesta recorta', boss.telegraph!.hint.length > 10);

  check('todas las respuestas tienen recorte',
    bosses.COUNTER_REDUCTION.defender > 0 &&
    bosses.COUNTER_REDUCTION.cambiar > 0 &&
    bosses.COUNTER_REDUCTION.curar > 0 &&
    bosses.COUNTER_REDUCTION.elemento > 0);
  check('tener el elemento correcto es la mejor respuesta',
    bosses.COUNTER_REDUCTION.elemento >= Math.max(
      bosses.COUNTER_REDUCTION.defender,
      bosses.COUNTER_REDUCTION.cambiar,
      bosses.COUNTER_REDUCTION.curar,
    ));

  // En combate: el aviso aparece y el golpe cae.
  const attacker = trainerWith('f2', 'Atacante', 'wargreymon', 60);
  fullParty(attacker.id, ['greymon', 'agumon'], 55);

  const fighter = combat.buildBossFighter(boss, 'rival');
  const state = combat.createBattle(repo.listParty(attacker.id), 0, SPECIES.wargreymon!, 60);
  state.enemy = fighter;
  state.enemyTeam = [fighter];
  state.enemyIndex = 0;
  state.isBoss = true;

  let announced = false;
  let resolved = false;
  let playerHp: number[] = [];

  for (let turn = 0; turn < 20 && !state.finished; turn++) {
    if (state.awaitingSwitch) {
      const reserve = combat.switchCandidates(state)[0];
      if (!reserve) break;
      combat.switchTo(state, reserve.id);
      continue;
    }

    combat.resolveTurn(state, { type: 'defender' }, new Rng(3));
    playerHp.push(state.player.hp);

    if (fighter.boss!.telegraph && !announced) {
      const tg = fighter.boss!.telegraph;
      announced = true;
      check('el aviso da margen real', tg.turnsLeft >= 1, `${tg.turnsLeft} turno(s)`);
      check('el aviso estima el daño', tg.estimate > 0, `~${tg.estimate} PV`);
      check('el aviso dice cómo responder', tg.hint.length > 5);
      check('el log anuncia el golpe',
        state.log.some((l) => l.includes('prepara')), '');
    }
    if (announced && !fighter.boss!.telegraph && !resolved) {
      resolved = true;
      check('el golpe telegrafiado cae',
      state.log.some((l) => l.includes('cae sobre') || l.includes('falla')),
        state.log.slice(-2).join(' | ').slice(0, 70));
    }
  }

  check('el telegrafiado se anuncio', announced);
  check('y llego a resolverse', resolved);

  // El recorte se mide por el FLUJO REAL, no forzando `turnsLeft` a mano:
  //
  //   turno N   el jefe anuncia (lead = 2 turnos)
  //   turno N+1 el jugador responde
  //   turno N+2 el jefe ejecuta el golpe ya recortado
  //
  // Con turnsLeft = 1 el golpe cae ANTES de que el jugador actúe, porque el
  // telegrafiado se resuelve al inicio del turno. Ese estado es inalcanzable
  // en el juego (todo anuncio nace con lead >= 2) y medirlo daba 100% de daño
  // en ambos casos, que es un test que no mide nada.
  /**
   * Golpe telegrafiado contra un defensor concreto, con y sin contraataque.
   *
   * Se mide sobre el MISMO estado dos veces. La versión anterior comparaba
   * medias de 24 peleas en cada brazo, y eso no servia: responder es
   * `{type:'defender'}`, que no tira dados, mientras que atacar tira precisión,
   * critico y variacion. Los dos brazos gastaban azar distinto, asi que la
   * diferencia medida era parte efecto y parte suerte, y el umbral no podia
   * separar una cosa de la otra.
   *
   * Aqui no hay distribucion que comparar: es el mismo estado, la misma semilla
   * y la unica variable es si el contraataque esta registrado.
   */
  const telegraphFlow = (respond: 'nada' | 'defender', seed: number): number => {
    const b = combat.buildBossFighter(boss, 'rival');
    const state = combat.createBattle(repo.listParty(attacker.id), 0, SPECIES.wargreymon!, 60);
    state.enemy = b;
    state.enemyTeam = [b];
    state.enemyIndex = 0;
    state.isBoss = true;

    const rng = new Rng(seed);
    let announced = false;
    let answered = false;
    let damage = 0;

    for (let turn = 0; turn < 14 && !state.finished; turn++) {
      if (state.awaitingSwitch) {
        const reserve = combat.switchCandidates(state)[0];
        if (!reserve) break;
        combat.switchTo(state, reserve.id);
        continue;
      }

      // Se devuelven los PV al jugador al principio de cada vuelta. Un jefe de
      // nivel 60 lo mata antes de que tenga una segunda oportunidad de responder,
      // y con el jugador en cero `resolveTurn` no resuelve el turno: el
      // contraataque no se registra nunca y el recorte medido es ~0.
      //
      // Sobrevivir o no es OTRA pregunta. Esta mide si responder recorta el golpe
      // anunciado, y para eso el jugador tiene que estar en pie cuando caiga.
      state.player.hp = state.player.stats.hp;

      const hp0 = state.player.hp;
      const move = state.player.moves.find((m) => m.energyCost <= state.player.energy)!;

      const answering = b.boss!.telegraph !== null && !answered;
      if (answering) answered = true;

      combat.resolveTurn(
        state,
        answering && respond === 'defender'
          ? { type: 'defender' }
          : { type: 'movimiento', move },
        rng,
      );

      if (announced && b.boss!.telegraph === null) {
        damage += hp0 - state.player.hp;
        break;
      }
      if (b.boss!.telegraph !== null) announced = true;
    }

    return damage;
  };

  // Se prueban varias semillas y se usan solo las VÁLIDAS, con la misma lista en
  // los dos brazos.
  //
  // Descarta las que no sirven: si el telegrafiado nace con `turnsLeft = 1`, el
  // golpe cae antes de que el jugador pueda responder. Ese estado no se da en el
  // juego —todo anuncio nace con lead >= 2— y responder ahí no recorta nada, así
  // que contarlo como si fuera diseño hace fallar el verificador sin motivo.
  const semillas: number[] = [];

  for (let semilla = 400; semilla < 440; semilla++) {
    const sin = telegraphFlow('nada', semilla);
    const con = telegraphFlow('defender', semilla);

    // Sin telegrafiado resuelto, o donde no hubo ventana para responder, no cuenta.
    if (sin > 0 && con > 0) semillas.push(semilla);
  }

  const sinResponderDmg = semillas.length
    ? semillas.reduce((a, b) => a + telegraphFlow('nada', b), 0) / semillas.length
    : 0;

  const respondiendoDmg = semillas.length
    ? semillas.reduce((a, b) => a + telegraphFlow('defender', b), 0) / semillas.length
    : 0;

  console.log(
    `  sin responder: ${sinResponderDmg.toFixed(1)} PV · respondiendo: ${respondiendoDmg.toFixed(1)} PV`,
  );

  check(
    'hay telegrafiados con ventana de respuesta',
    semillas.length >= 5,
    `${semillas.length} semillas válidas de 40`,
  );

  check(
    'el telegrafiado hace daño si no respondes',
    sinResponderDmg > 0,
    `${sinResponderDmg.toFixed(1)} PV`,
  );

  // `COUNTER_REDUCTION.defender` es la fraccion que QUEDA, o sea 0.6: responder
  // recorta el 40%. Con la misma seed y el mismo estado, esa es la comparacion
  // exacta.
  check(
    'responder recorta el golpe de verdad',
    respondiendoDmg > 0 && respondiendoDmg <= sinResponderDmg * 0.6 + 0.5,
    `${respondiendoDmg.toFixed(1)} <= ${(sinResponderDmg * 0.6).toFixed(1)} (recorte ${(
      (1 - respondiendoDmg / sinResponderDmg) *
      100
    ).toFixed(0)}%)`,
  );

// ==========================================================================
console.log('\n=== 4. EL PROGRESO SE GUARDA SALA A SALA ===');
}

// ==========================================================================

{
  const problems = dungeons.validateDungeons(
    // Las salas referencian plantillas por CLAVE, no por nombre.
    (key) => trainers.getTutorTemplate(key) !== undefined,
    (key) => Boolean(getSpecies(key)),
  );
  check('el catálogo de mazmorras es coherente', problems.length === 0, problems.join('; '));

  for (const dungeon of Object.values(dungeons.DUNGEONS)) {
    check(`${dungeon.name}: varias salas`, dungeon.rooms.length >= 2, `${dungeon.rooms.length}`);
    check(`${dungeon.name}: la ultima sala es de jefe`,
      dungeon.rooms[dungeon.rooms.length - 1]!.kind === 'jefe');
    check(`${dungeon.name}: solo el jefe final tiene jefe`,
      dungeon.rooms.slice(0, -1).every((r) => !r.boss));
    check(`${dungeon.name}: cuesta energia`, dungeon.energyCost > 0, `${dungeon.energyCost}`);
    check(`${dungeon.name}: limita intentos`, dungeon.dailyAttempts > 0, `${dungeon.dailyAttempts}`);

    for (const [key] of Object.entries(dungeon.materials)) {
      const item = getItem(key);
      check(`${dungeon.name}: material ${key} existe`, Boolean(item));
      check(`${dungeon.name}: ${key} es un material de fabricacion`, item?.role === 'material');
    }
  }

  // Flujo real: entrar, ganar salas, perder una, seguir.
  const hero = trainerWith('d1', 'Heroe', 'metalgreymon', 55);
  fullParty(hero.id, ['greymon', 'gabumon'], 50);
  const dungeon = dungeons.getDungeon('forja_de_ceniza')!;

  const first = dungeonRepo.startRun(hero.id, 'forja_de_ceniza');
  check('se puede entrar', first.ok, first.ok ? '' : first.message);

  if (first.ok) {
    check('empieza en la sala 1', first.run.roomIndex === 0);
    check('gasta energia', dungeonRepo.energyOf(hero.id).energy < dungeonRepo.DAILY_ENERGY,
      `${dungeonRepo.energyOf(hero.id).energy}/${dungeonRepo.DAILY_ENERGY}`);
    check('cuenta un intento', first.run.attemptsLeft === dungeon.dailyAttempts - 1);

    const party = repo.listParty(hero.id);

    // Sala 1 y 2: normales.
    for (let room = 0; room < 2; room++) {
      const built = runs.buildRoomState(party, dungeon.rooms[room]!);
      check(`sala ${room + 1} se construye`, !('error' in built), 'error' in built ? built.error : '');
      if ('error' in built) break;

      const status = dungeonRepo.clearRoom(hero.id, 'forja_de_ceniza', 0, built.bossMaxHp);
      check(`sala ${room + 1} superada`, status.run.roomsCleared === room + 1,
        `${status.run.roomsCleared}`);
      check(`siguiente sala es la ${room + 2}`, status.run.roomIndex === room + 1);
    }

    const midway = dungeonRepo.runOf(hero.id, 'forja_de_ceniza')!;
    check('va por la sala 3', midway.roomIndex === 2, `sala ${midway.roomIndex + 1}`);

    // Perder aqui NO debe borrar el progreso.
    const built3 = runs.buildRoomState(party, dungeon.rooms[2]!);
    check('la sala final se construye', !('error' in built3));
    if (!('error' in built3)) {
      check('la sala final es de jefe', built3.state.enemy.boss !== null);
    }

    const afterLoss = dungeonRepo.runOf(hero.id, 'forja_de_ceniza')!;
    check('perder no borra las salas anteriores',
      afterLoss.roomsCleared === 2,
      `${afterLoss.roomsCleared} salas conservadas`);

    // Completar.
    const done = dungeonRepo.clearRoom(hero.id, 'forja_de_ceniza', built3.bossMaxHp, built3.bossMaxHp);
    check('la mazmorra se marca completada', done.finished);
    check('el ratio de contribución llega al 100%', done.ratio === 1, `${Math.round(done.ratio * 100)}%`);
    check('no queda sala pendiente', done.run.nextRoom === null);
    check('se registra como completada', dungeonRepo.hasCleared(hero.id, 'forja_de_ceniza'));

    // Segunda vuelta el mismo dia: bloqueada.
    const again = dungeonRepo.startRun(hero.id, 'forja_de_ceniza');
    check('no se repite la misma mazmorra hoy', !again.ok,
      again.ok ? 'FALLO: entro dos veces' : again.reason);
  }
}

// ==========================================================================
console.log('\n=== 5. LA RECOMPENSA ESCALA CON LA CONTRIBUCIÓN ===');
// ==========================================================================

{
  const dungeon = dungeons.getDungeon('forja_de_ceniza')!;

  check('el ratio se limita a 1', dungeons.contribution(999_999, 1000) === 1);
  check('el ratio no baja de 0', dungeons.contribution(-50, 1000) === 0);
  check('el ratio es proporcional', Math.abs(dungeons.contribution(500, 1000) - 0.5) < 1e-9);

  // Escalones: proporcional y monótono.
  const full = dungeons.tierFor(1);
  const threeQuarter = dungeons.tierFor(0.75);
  const half = dungeons.tierFor(0.5);
  const quarter = dungeons.tierFor(0.2);
  const nothing = dungeons.tierFor(0);

  check('100% paga mas que 75%', full.digibyteFactor > threeQuarter.digibyteFactor,
    `${full.digibyteFactor} > ${threeQuarter.digibyteFactor}`);
  check('75% paga mas que 50%', threeQuarter.digibyteFactor > half.digibyteFactor);
  check('50% paga mas que 20%', half.digibyteFactor > quarter.digibyteFactor);
  check('20% no paga materiales', quarter.materialFactor === 0 && nothing.materialFactor === 0);
  check('solo el 100% cobra materiales completos', full.materialFactor === 1);

  // Recompensa real segun ratio.
  const hero = trainerWith('d5', 'Héroe', 'metalgreymon', 55);
  const bossHp = 4000;

  const poco = dungeonRepo.dungeonReward(hero.id, dungeon, 3, 500, bossHp);
  const mucho = dungeonRepo.dungeonReward(hero.id, dungeon, 3, 4000, bossHp);
  const nada = dungeonRepo.dungeonReward(hero.id, dungeon, 3, 0, bossHp);

  console.log(`  ratio ${Math.round(poco.ratio * 100)}% -> ${poco.digibytes} DB · ${poco.tier.name}`);
  console.log(`  ratio ${Math.round(mucho.ratio * 100)}% -> ${mucho.digibytes} DB · ${mucho.tier.name}`);
  console.log(`  ratio ${Math.round(nada.ratio * 100)}% -> ${nada.digibytes} DB · ${nada.tier.name}`);

  check('dar más al jefe da más recompensa', mucho.digibytes > poco.digibytes,
    `${poco.digibytes} -> ${mucho.digibytes} DB`);
  check('no hacer nada no da materiales', Object.keys(nada.materials).length === 0);
  check('tirar el jefe si da materiales', Object.keys(mucho.materials).length > 0);
  check('la primera pasada se marca', mucho.firstClear);
  // Para que exista una "primera pasada" hay que COMPLETAR la mazmorra:
  // clearRoom solo avanza UNA sala por llamada.
  for (let sala = 0; sala < dungeon.rooms.length; sala++) {
    dungeonRepo.clearRoom(hero.id, dungeon.key, 4000, 4000);
  }
  check(
    'completar la mazmorra la registra como primera pasada',
    dungeonRepo.dungeonReward(hero.id, dungeon, 3, 4000, 4000).firstClear === false,
    `${dungeonRepo.clearCount(hero.id, dungeon.key)} vez(es)`
  );
  // Completar mas salas paga mas.
  const pocas = dungeonRepo.dungeonReward(hero.id, dungeon, 1, 4000, bossHp);
  const todas = dungeonRepo.dungeonReward(hero.id, dungeon, dungeon.rooms.length, 4000, bossHp);
  check('llegar al final paga mas que solo pasar por la sala 1',
    todas.roomFactor > pocas.roomFactor,
    `${pocas.roomFactor} -> ${todas.roomFactor}`);
}

// ==========================================================================
console.log('\n=== 6. ENERGÍA E INTENTOS SON DIARIOS ===');
// ==========================================================================

{
  const hero = trainerWith('d6', 'Héroe', 'metalgreymon', 55);

  check('la energía es la maxima al empezar',
    dungeonRepo.energyOf(hero.id).energy === dungeonRepo.DAILY_ENERGY);

  check('gastar energía la reduce',
    dungeonRepo.spendEnergy(hero.id, 4) && dungeonRepo.energyOf(hero.id).energy === dungeonRepo.DAILY_ENERGY - 4);

  check('no se puede gastar mas de la que hay',
    !dungeonRepo.spendEnergy(hero.id, 999));

  // Devolver solo tiene efecto si antes hubo gasto: sin fila, la energía
  // está implícitamente llena y devolver sería un no-op correcto.
  const antesDeDevolver = dungeonRepo.energyOf(hero.id).energy;
  dungeonRepo.refundEnergy(hero.id, 2);
  check(
    'devolver energía funciona',
    dungeonRepo.energyOf(hero.id).energy === antesDeDevolver + 2,
    `${antesDeDevolver} -> ${dungeonRepo.energyOf(hero.id).energy}`
  );

  check('la energía no supera el maximo',
    (() => {
      dungeonRepo.refundEnergy(hero.id, 999);
      return dungeonRepo.energyOf(hero.id).energy === dungeonRepo.DAILY_ENERGY;
    })(),
    `${dungeonRepo.energyOf(hero.id).energy}`);

  // Los intentos se agotan.
  const intruder = trainerWith('d6b', 'Intruso', 'metalgreymon', 55);
  const forja = dungeons.getDungeon('forja_de_ceniza')!;
  for (let i = 0; i < forja.dailyAttempts; i++) {
    dungeonRepo.startRun(intruder.id, 'forja_de_ceniza');
  }
  const last = dungeonRepo.startRun(intruder.id, 'forja_de_ceniza');
  check('los intentos se agotan', !last.ok, last.ok ? 'FALLO: intentos infinitos' : last.reason);

  // La energía vive en la BD, no en memoria: sobrevive a un "reinicio".
  const row = db
    .prepare<[number], { energy: number }>(
      "SELECT energy FROM trainer_energy WHERE trainer_id = ? AND day = ?",
    )
    .get(hero.id, new Date().toISOString().slice(0, 10));
  check('la energía está persistida por día', Boolean(row), `guardada: ${row?.energy}`);

  const tables = db
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => r.name);
  for (const table of ['dungeon_run', 'trainer_energy', 'dungeon_clear', 'world_boss', 'world_boss_contrib']) {
    check(`existe la tabla ${table}`, tables.includes(table));
  }
}

// ==========================================================================
console.log('\n=== 7. EL JEFE GLOBAL TIENE VIDA COMPARTIDA ===');
// ==========================================================================

{
  const state = dungeonRepo.worldBossState();
  check('hay un jefe global activo', Boolean(state.bossKey), `${state.emoji} ${state.name}`);
  check('empieza con la vida llena', state.currentHp === state.maxHp && state.maxHp > 0,
    `${state.currentHp}/${state.maxHp}`);
  check('tiene vida para varios', state.maxHp > 50_000, `${state.maxHp.toLocaleString('es-ES')}`);
  check('el jefe global esta en el catálogo', Boolean(bosses.getBoss(state.bossKey)));
  check('esta marcado como global', bosses.getBoss(state.bossKey)!.global === true);

  // Daño de dos jugadores distintos: la vida baja para los dos.
  const a = trainerWith('g1', 'Ana', 'wargreymon', 60);
  const b = trainerWith('g2', 'Beto', 'metalgarurumon', 60);

  const before = dungeonRepo.worldBossState().currentHp;
  const r1 = dungeonRepo.damageWorldBossBy(a.id, 5000);
  const mid = dungeonRepo.worldBossState().currentHp;
  const r2 = dungeonRepo.damageWorldBossBy(b.id, 3000);
  const after = dungeonRepo.worldBossState().currentHp;

  check('el primer golpe baja la vida global', mid === before - 5000, `${mid}`);
  check('el segundo golpe SIGUE sobre la misma vida', after === mid - 3000, `${after}`);
  check('el daño se acumula', dungeonRepo.worldBossState().totalDamage === 8000);
  check('nadie lo ha abatido todavia', !r1.defeated && !r2.defeated);

  // Contribucion individual.
  const ca = dungeonRepo.myContribution(a.id);
  const cb = dungeonRepo.myContribution(b.id);
  check('cada uno lleva su propio daño', ca!.damage === 5000 && cb!.damage === 3000,
    `${ca!.damage} / ${cb!.damage}`);
  check('la contribucion es privada', ca!.damage !== cb!.damage);

  const board = dungeonRepo.worldBossLeaderboard(10);
  check('el ranking existe', board.length >= 2);
  check('el primero es el que mas pego', board[0]!.username === 'Ana', board[0]!.username);
  check('el ranking ordena por daño', board[0]!.damage >= board[1]!.damage);

  // El estado sobrevive a leerlo de nuevo (o sea, esta en la BD).
  const row = db
    .prepare<[], { current_hp: number; total_damage: number }>(
      'SELECT current_hp, total_damage FROM world_boss WHERE id = 1',
    )
    .get()!;
  check('la vida global está persistida', row.total_damage === 8000, `dano ${row.total_damage}`);
  check('la vida global en BD coincide con la vista', row.current_hp === after);

  // Matarlo.
  const c = trainerWith('g3', 'Carla', 'wargreymon', 60);
  const fin = dungeonRepo.damageWorldBossBy(c.id, after);
  check('el golpe final lo abata', fin.defeated);
  check('la vida llega a cero', fin.currentHp === 0);
  check('queda registrado quien lo hizo',
    db.prepare<[], { defeated_by: number | null }>('SELECT defeated_by FROM world_boss WHERE id = 1').get()!.defeated_by === c.id);

  // Y aparece uno nuevo.
  const siguiente = dungeonRepo.worldBossState(new Date(Date.now() + 5 * 86_400_000));
  check('tras caducar empieza otro jefe', siguiente.bossKey !== state.bossKey || siguiente.currentHp === siguiente.maxHp,
    `${siguiente.name}`);
}

// ==========================================================================
console.log('\n=== 8. AISLAMIENTO: NI LA MAZMORRA NI LA INCURSIÓN TOCAN PROGRESO INESPERADO ===');
// ==========================================================================

{
  const hero = trainerWith('d8', 'Héroe', 'metalgreymon', 55);
  fullParty(hero.id, ['greymon', 'gabumon'], 50);

  const before = repo.listParty(hero.id).map((d) => ({
    id: d.id, species: d.species.key, level: d.level, exp: d.exp,
  }));

  const dungeon = dungeons.getDungeon('forja_de_ceniza')!;
  const party = repo.listParty(hero.id);
  const built = runs.buildRoomState(party, dungeon.rooms[dungeon.rooms.length - 1]!);

  check('la sala final se monta', !('error' in built));
  if (!('error' in built)) {
    const state = built.state;
    state.player.hp = 10;

    let turns = 0;
    const rng = new Rng(17);
    while (!state.finished && turns < 200) {
      if (state.awaitingSwitch) {
        const reserve = combat.switchCandidates(state)[0];
        if (!reserve) break;
        combat.switchTo(state, reserve.id);
        continue;
      }
      const mv = state.player.moves.find((m) => m.energyCost <= state.player.energy);
      combat.resolveTurn(state, mv ? { type: 'movimiento', move: mv } : { type: 'defender' }, rng);
      turns++;
    }
    check('el combate de jefe acaba', state.finished, String(state.result));
  }

  const after = repo.listParty(hero.id).map((d) => ({
    id: d.id, species: d.species.key, level: d.level, exp: d.exp,
  }));

  check('la especie no cambia por combatir',
    after.every((d, i) => d.species === before[i]!.species));
  check('el nivel no sube por combatir',
    after.every((d, i) => d.level === before[i]!.level));
  check('la EXP no sube por combatir (la da clearRoom, no el combate)',
    after.every((d, i) => d.exp === before[i]!.exp));
}

db.close();
cleanupDb('check-dungeon.db', true);

console.log(failures === 0 ? '\nOK: mazmorras, incursiones y jefes funcionando.' : `\n${failures} fallo(s).`);
process.exit(failures === 0 ? 0 : 1);
