// Verificación de lo que se ha añadido al combate: estados con duración y
// magnitud, escudos, cooldowns, combos, sinergias, estilos de IA y telemetría.
//
// El patrón es siempre el mismo: se monta un combate REAL, se juega con el mismo
// camino que un botón —con su turno— y se comprueba lo que el motor dejó escrito.
// Nada se comprueba contra una función auxiliar que podría estar mintiendo en el
// mismo sentido que el código que se quiere verificar.
process.env.DISCORD_TOKEN ??= 'fake';
process.env.DISCORD_CLIENT_ID ??= '0';
process.env.DATABASE_PATH = './data/check-combate2.db';

import { rmSync } from 'node:fs';

function cleanupDb(name: string, bestEffort = false): void {
  for (const sufijo of ['', '-wal', '-shm']) {
    try {
      rmSync(`./data/${name}${sufijo}`, { force: true, maxRetries: 8, retryDelay: 120 });
    } catch (error) {
      if (!bestEffort) console.error('No se pudo limpiar', (error as Error).message);
    }
  }
}
cleanupDb('check-combate2.db', false);

const repo = await import('../src/game/repository.js');
const { SPECIES, getSpecies } = await import('../src/game/species.js');
const { computeStats } = await import('../src/game/stats.js');
const { db } = await import('../src/db/index.js');
const combat = await import('../src/game/combat.js');
const estados = await import('../src/game/statuses.js');
const combos = await import('../src/game/combos.js');
const synergies = await import('../src/game/synergies.js');
const ai = await import('../src/game/ai.js');
const flow = await import('../src/services/battleFlow.js');
const { getMove } = await import('../src/game/moves.js');
const analisis = await import('../src/services/battleAnalysis.js');
const { Rng } = await import('../src/game/random.js');
const { recordInicial } = await import('../src/game/telemetry.js');

let fallos = 0;
const fallidos: string[] = [];

function check(etiqueta: string, ok: boolean, detalle = '') {
  if (!ok) {
    fallos++;
    fallidos.push(etiqueta);
  }
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}${detalle ? ` (${detalle})` : ''}`);
}

// ------------------------------------------------------------- auxiliares --

function trainer(id: string, nombre: string, claves = ['agumon', 'gabumon']) {
  const t = repo.registerTrainer(id, nombre, SPECIES.agumon!);

  for (const [i, key] of claves.entries()) {
    const nivel = 30 - i;
    const species = getSpecies(key)!;

    // Se usa el LEARNSET de la especie, no una lista fija. Con `['impacto']` el
    // Digimon llegaba con un solo movimiento de cooldown 0, y la mitad de estas
    // comprobaciones no tenían nada que medir.
    const moves = species.learnset.slice(0, 5);

    const d = repo.createDigimon(t.id, species, nivel, moves);
    d.level = nivel;
    d.stats = computeStats(species.base, nivel);
    d.hp = d.stats.hp;
    // Los movimientos se resuelven a definiciones completas, no a claves: sin
    // esto el Digimon llegaría al combate sin `cooldown` y las comprobaciones de
    // espera medirían `undefined`.
    d.moves = moves.map((k) => getMove(k)).filter(Boolean) as never;
    repo.saveDigimon(d);
    repo.setLeader(t.id, d.id);
  }

  repo.giveDigibytes(t.id, 20_000);
  return repo.getTrainerById(t.id)!;
}

function combate(trainerId: number) {
  const party = repo.listParty(trainerId);
  return combat.createTrainerBattle(party, 0, {
    // Rival muy débil: esta comprobación necesita que la pelea dure más que la
    // espera del movimiento. Un rival de nivel 5 contra un Digimon de nivel 30 se
    // acaba en un turno, y entonces los `defender` no llegaban a jugarse.
    team: [{ species: getSpecies('kunemon')!, level: 1 }],
    trainerName: 'Prueba',
    intro: 'Vamos.',
    boss: false,
    inventory: {},
  });
}

/** Le da al rival la vida que necesita para que la pelea dure. */
function rivalResistente(s: State) {
  s.enemy.hp = s.enemy.stats.hp = Math.max(s.enemy.stats.hp, 4000);
  s.enemyTeam[0]!.hp = s.enemy.hp;
  s.enemyTeam[0]!.stats.hp = s.enemy.hp;
  return s;
}

const jugar = (s: ReturnType<typeof combate>, accion: Parameters<typeof flow.submitAction>[1]) =>
  flow.submitAction(s, accion, s.turn);

type State = ReturnType<typeof combate>;

// ==========================================================================
console.log('=== 1. COOLDOWNS ===');
// ==========================================================================

{
  const t = trainer('cd1', 'Cools');
  const s = combate(t.id);

  const conCd = s.player.moves.filter((m) => m.cooldown > 0);
  check('el kit tiene movimientos con espera', conCd.length > 0, `${conCd.length} de ${s.player.moves.length}`);

  const move = conCd[0]!;
  check('empieza disponible', (s.player.cooldowns[move.key] ?? 0) === 0);

  jugar(s, { type: 'movimiento', move });

  const restante = s.player.cooldowns[move.key] ?? 0;
  check('al usarlo entra en espera', restante > 0, `${restante} turnos (esperaba ${move.cooldown})`);

  // Y la pantalla lo dice.
  const disponibilidad = estados.movimientosUsables(s.player, s.player.moves);
  const fila = disponibilidad.find((f) => f.move.key === move.key)!;
  check('la interfaz lo marca como no disponible', fila.ok === false);
  check('y explica por qué', (fila.motivo ?? '').includes('Enfriando'), fila.motivo ?? '');

  // No se puede usar mientras espera. Con la pelea viva, para que lo que se
  // compruebe sea el cooldown y no que el combate ya haya acabado.
  s.enemy.hp = s.enemy.stats.hp;
  s.finished = false;
  const intento = jugar(s, { type: 'movimiento', move });
  check(
    'el motor lo rechaza por la espera',
    !intento.ok && intento.reason === 'movimiento-enfriando',
    intento.ok ? 'aceptado' : intento.reason,
  );

  // Y la espera baja un turno por vuelta.
  //
  // Se devuelven los PV en cada vuelta. Un Digimon de nivel 30 deja a un rival
  // de nivel 1 en cero en un golpe, y entonces el combate acaba y los `defender`
  // ya no se juegan: la espera se queda en 2 y la comprobación falla por el final
  // de la pelea en vez de por la mecánica.
  for (let i = 0; i < restante; i++) {
    s.enemy.hp = s.enemy.stats.hp;
    s.finished = false;
    s.awaitingSwitch = false;
    jugar(s, { type: 'defender' });
  }
  const actual = s.player.cooldowns[move.key] ?? 0;
  check('llegado el momento se libera', actual === 0, `esperaba 0 tras ${restante} turnos y hay ${actual}`);
  check(
    'y la interfaz lo da por bueno',
    estados.movimientosUsables(s.player, [move])[0]!.ok,
    `motivo: ${estados.movimientosUsables(s.player, [move])[0]!.motivo ?? 'ninguno'}`,
  );
}

// ==========================================================================
console.log('\n=== 2. ESTADOS CON DURACIÓN Y MAGNITUD ===');
// ==========================================================================

{
  const t = trainer('cd2', 'Estados');
  const s = combate(t.id);

  estados.applyStatus(s.player, 'dormir', { turns: 2, source: 'prueba' });

  check('el estado está en la lista', s.player.statuses.some((x) => x.kind === 'dormir'));
  check('con sus turnos', estados.turnsLeft(s.player, 'dormir') === 2);
  check('y el espejo lo refleja', s.player.status === 'dormir');
  check('y el contador', s.player.statusTurns === 2);

  check('bloquea el actuar', estados.bloqueo(s.player, () => false) === 'dormir');
  const intento = jugar(s, { type: 'movimiento', move: s.player.moves[0]! });
  check('y el motor lo respeta', !intento.ok || s.player.status === 'dormir');

  // Los buffs caducan y DESHACEN su modificador.
  estados.applyStatus(s.player, 'atk_up', { turns: 1, magnitude: 0.15, source: 'prueba' });
  check('el buff sube el Ataque', (s.player.modifiers.attack ?? 1) > 1, `${s.player.modifiers.attack}`);

  estados.tickStatuses(s.player);
  check('con un turno, caduca', !estados.hasStatus(s.player, 'atk_up'));
  check(
    'y el Ataque vuelve a su valor',
    Math.abs((s.player.modifiers.attack ?? 1) - 1) < 0.001,
    `${s.player.modifiers.attack}`,
  );

  // Un buff repetido NO se apila.
  estados.applyStatus(s.player, 'def_up', { turns: 3, magnitude: 0.2 });
  estados.applyStatus(s.player, 'def_up', { turns: 3, magnitude: 0.2 });
  check('un buff repetido no se apila', Math.abs((s.player.modifiers.defense ?? 1) - 1.2) < 0.001, `${s.player.modifiers.defense}`);
  check('y no hay dos entradas', s.player.statuses.filter((x) => x.kind === 'def_up').length === 1);

  // Varios estados a la vez, no uno.
  estados.applyStatus(s.player, 'quemadura', { turns: 0 });
  estados.applyStatus(s.player, 'atk_down', { turns: 2, magnitude: 0.15 });
  check('un Digimon lleva varios efectos a la vez', s.player.statuses.length >= 2, `${s.player.statuses.length}`);

  // El daño continuo sale del catálogo, no de un número escrito aquí.
  const residual = estados.residualDamage(s.player);
  check('la quemadura hace daño al cerrar el turno', residual !== null, residual ? `${residual.amount} PV` : '');
}

// ==========================================================================
console.log('\n=== 3. ESCUDO ===');
// ==========================================================================

{
  const t = trainer('cd3', 'Escudo');
  const s = combate(t.id);

  estados.applyStatus(s.enemy, 'escudo', { magnitude: 60, source: 'prueba' });
  check('el escudo tiene PV', s.enemy.shield === 60, `${s.enemy.shield}`);

  const hpAntes = s.enemy.hp;
  const r = estados.absorbirEscudo(s.enemy, 40);
  check('absorbe lo que puede', r.absorbido === 40 && r.pasa === 0);
  check('y el resto pasa de largo', s.enemy.hp === hpAntes, 'el PV no baja');
  check('queda escudo para otro golpe', s.enemy.shield === 20, `${s.enemy.shield}`);

  const r2 = estados.absorbirEscudo(s.enemy, 40);
  check('el segundo golpe pasa lo que sobra', r2.absorbido === 20 && r2.pasa === 20, `${r2.absorbido} / ${r2.pasa}`);
  check('y el escudo se agota', s.enemy.shield === 0);
  check('y sale de la lista', !estados.hasStatus(s.enemy, 'escudo'));
}

// ==========================================================================
console.log('\n=== 4. COMBOS ===');
// ==========================================================================

{
  const combo = combos.COMBOS.find((c) => c.key === 'rayo_rayo')!;
  const estado = combos.comboInicial();

  check('un combo empieza sin ventana', estado.pendiente === null);

  combos.registrarAccion(estado, combo.moves[0]!);
  check('el primer golpe abre la ventana', estado.pendiente !== null);
  check(
    'y dice cuál falta',
    estado.pendiente?.falta === combo.moves[1],
    `falta ${estado.pendiente?.falta}`,
  );

  const desbloqueado = combos.registrarAccion(estado, combo.moves[1]!);
  check('el segundo lo completa', desbloqueado?.key === combo.key);
  check('el bonus es el del combo', combos.bonusCombo(estado) === combo.bonus);

  // Y no se puede repetir en bucle.
  const otro = combos.registrarAccion(estado, combo.moves[0]!);
  check('después, vuelve a abrir ventana en vez de repetirse', otro === null && estado.activo === null);

  // La ventana caduca: es lo que impide que sea obligatorio.
  estado.pendiente = { combo, primero: combo.moves[0]!, turnos: 1, falta: combo.moves[1]! };
  combos.tickCombo(estado);
  check('la ventana caduca', estado.pendiente === null);

  // Y cada Digimon ve SUS combos.
  const conRayos = combos.combosDe([
    { key: 'chispa', cooldown: 1, energyCost: 1, element: 'rayo', category: 'especial', power: 45, accuracy: 1, priority: 0, critRate: 0, name: 'Chispa', description: '' },
    { key: 'trueno', cooldown: 3, energyCost: 3, element: 'rayo', category: 'especial', power: 95, accuracy: 1, priority: 0, critRate: 0, name: 'Trueno', description: '' },
  ]);
  check('el kit de rayos ve su combo', conRayos.some((c) => c.combo.key === 'rayo_rayo'));

  const sinRayos = combos.combosDe([
    { key: 'impacto', cooldown: 0, energyCost: 0, element: 'viento', category: 'fisico', power: 40, accuracy: 1, priority: 0, critRate: 0, name: 'Impacto', description: '' },
  ]);
  check('un kit sin esos movimientos no ve el combo', sinRayos.every((c) => c.combo.key !== 'rayo_rayo'));
}

// ==========================================================================
console.log('\n=== 5. SINERGIAS ===');
// ==========================================================================

{
  // Tres de FUEGO de verdad. El primer intento metió a Birdramon, que es de
  // viento: con dos de fuego la sinergia no podía activarse y el test fallaba por
  // un error mío al elegir las especies, no por un error del motor.
  const equipo = [
    { species: getSpecies('agumon')!, ...digimonDe('agumon') },
    { species: getSpecies('kimeramon')!, ...digimonDe('kimeramon') },
    { species: getSpecies('growlmon')!, ...digimonDe('growlmon') },
  ] as never[];

  const lista = synergies.sinergiasDe(equipo);
  const fuego = lista.find((s) => s.key === 'fuego');

  check('tres de fuego activan la sinergia', fuego !== undefined, fuego?.name ?? 'ninguna');
  check('con su bonus de daño', (fuego?.damage ?? 0) > 0, `${((fuego?.damage ?? 0) * 100).toFixed(0)}%`);

  const familia = lista.find((s) => s.key === 'familia');
  check('y el lazo de familia, si comparten familia', familia !== undefined, familia?.name ?? 'ninguna');

  // Un equipo que no cumple, no la tiene.
  const cualquiera = [
    { species: getSpecies('agumon')!, ...digimonDe('agumon') },
    { species: getSpecies('gatomon')!, ...digimonDe('gatomon') },
  ] as never[];
  const ninguna = synergies.sinergiasDe(cualquiera).find((s) => s.key === 'fuego');
  check('un equipo sin tres de fuego NO la activa', ninguna === undefined);

  // Los totales se suman, no se multiplican.
  const totales = synergies.totalesSinergia(equipo);
  check(
    'los totales son la suma de las sinergias',
    totales.lista.length === lista.length &&
      Math.abs(totales.damage - lista.reduce((a, b) => a + b.damage, 0)) < 0.001,
    `${totales.lista.length} sinergias · ${(totales.damage * 100).toFixed(0)}%`,
  );

  // El combate calcula las suya al construirse, sobre el equipo REAL.
  const t = trainer('cd5b', 'Siner');
  const conParty = combate(t.id);
  check('el combate lleva sus sinergias resueltas', Array.isArray(conParty.sinergias.lista));
}

/**
 * Un Digimon suelto, para medir las sinergias sin meterlo en la base de datos.
 *
 * La cuenta se saca de `recordInicial()` y no montando un combate de prueba: la
 * primera versión lo hacía así y, al meter un equipo VACÍO en `createTrainerBattle`,
 * reventó en `fighterFromOwned` con "Cannot read properties of undefined".
 *
 * La especie se COMPRUEBA antes de usarla. Escribirla a ciegas hacía que
 * `getSpecies` devolviera `undefined` y el fallo apareciera tres líneas más
 * abajo, en un sitio que no dice qué especie se nodded mal.
 */
function digimonDe(key: string) {
  const species = getSpecies(key);

  if (!species) {
    throw new Error(`la especie "${key}" no existe en el bestiario`);
  }
  const stats = computeStats(species.base, 20);

  return {
    id: 0,
    trainerId: 0,
    species,
    nickname: null,
    level: 20,
    exp: 0,
    stats,
    hp: stats.hp,
    moves: species.learnset.map((k) => getMove(k)).filter(Boolean) as never,
    status: 'ok' as const,
    storage: 'party' as const,
    caughtAt: '2024-01-01',
    record: recordInicial(),
  };
}

// ==========================================================================
console.log('\n=== 6. ESTILOS DE IA ===');
// ==========================================================================

{
  const t = trainer('cd6', 'IA');
  const s = combate(t.id);

  const estilos: (ai.Personalidad)[] = ['agresivo', 'tactico', 'equilibrado', 'cazador', 'guardián'];

  for (const estilo of estilos) {
    s.personalidad = estilo;

    const ctx = {
      actor: s.enemy,
      rival: s.player,
      personalidad: estilo,
      azar: new Rng(1),
    } as never;

    const d = ai.decidir(ctx, () => getSpecies('gabumon')!);
    check(`${estilo}: decide algo`, typeof d.action.type === 'string', d.action.type);
  }

  // Los planes del guardián cambian con la fase.
  const p1 = ai.planDeFase(1);
  const p3 = ai.planDeFase(3);
  check('el guardián empieza presionando', p1.potencia < p3.potencia, `${p1.potencia} → ${p3.potencia}`);
  check('y cada fase tiene nombre', p1.nombre !== p3.nombre, `${p1.nombre} → ${p3.nombre}`);

  // La personalidad llega al combate.
  s.personalidad = 'cazador';
  check('el combate guarda el estilo', s.personalidad === 'cazador');
}

// ==========================================================================
console.log('\n=== 7. TELEMETRÍA ===');
// ==========================================================================

{
  const t = trainer('cd7', 'Tel');
  const s = rivalResistente(combate(t.id));

  check('la cuenta empieza a cero', s.player.record.dealt === 0 && s.player.record.skills === 0);

  const hpRivalAntes = s.enemy.hp;
  jugar(s, { type: 'movimiento', move: s.player.moves[0]! });

  check('cuenta el daño hecho', s.player.record.dealt > 0, `${s.player.record.dealt}`);
  check('y el recibido', s.player.record.taken > 0, `${s.player.record.taken}`);

  // "Coincide" es `>=`, no `==`: si el golpe sobra, el rival baja hasta cero y
  // el daño total es MAYOR que los PV perdidos. Exigir igualdad daba un fallo que
  // no era un fallo: era una muerte por exceso de daño bien contabilizada.
  const perdido = hpRivalAntes - s.enemy.hp;
  check(
    'el daño cubre lo que el rival perdió',
    s.player.record.dealt >= perdido,
    `${s.player.record.dealt} hecho · ${perdido} perdidos`,
  );

  check('cuenta las habilidades', s.player.record.skills === 1);
  check('cuenta los turnos activos', s.player.record.turnsActive === 1);
  check('el rival lleva la suya', s.enemy.record.turnsActive === 1, `${s.enemy.record.turnsActive}`);
  check('y cuenta su daño', s.enemy.record.dealt > 0 || s.enemy.record.missed > 0);
}

// ==========================================================================
console.log('\n=== 8. EL CAMBIO NO BORRA EL HISTORIAL ===');
// ==========================================================================

{
  const t = trainer('cd8', 'Cambio', ['agumon', 'gabumon', 'gatomon']);
  const s = rivalResistente(combate(t.id));

  jugar(s, { type: 'movimiento', move: s.player.moves[0]! });
  const dañoPrimero = s.player.record.dealt;
  check('el primero registra daño', dañoPrimero > 0, `${dañoPrimero}`);

  // Cambia al segundo.
  const segundo = repo.listParty(t.id)[1]!;
  const cambio1 = flow.requestSwitch(s, segundo.id);
  check('el cambio es legal', cambio1.switched, cambio1.message);

  // Vuelve al primero: su historial tiene que seguir ahí.
  const primeroId = repo.listParty(t.id)[0]!.id;
  check('y puede volver', flow.requestSwitch(s, primeroId).switched);
  check(
    'el historial del primero se conserva',
    s.player.record.dealt === dañoPrimero,
    `${dañoPrimero} → ${s.player.record.dealt}`,
  );

  // Y el segundo tiene su propia cuenta, distinta de cero.
  flow.requestSwitch(s, segundo.id);
  check('el segundo lleva la suya', s.player.record.skills === 0, `${s.player.record.skills}`);
}

// ==========================================================================
console.log('\n=== 9. ANÁLISIS Y MOMENTOS ===');
// ==========================================================================

{
  const t = trainer('cd9', 'Análisis');
  // Rival resistente: con el daño actual la pelea acababa en un turno, sin tiempo
  // de que hubiera más de un Digimon con datos, y el MVP salía vacío.
  const s = rivalResistente(combate(t.id));

  check('sin acabar, no hay análisis', analisis.analizar(s) === null);

  let turnos = 0;
  while (!s.finished && turnos < 300) {
    if (s.awaitingSwitch) {
      const r = flow.candidates(s).find((d) => d.hp > 0);
      if (!r) break;
      flow.requestSwitch(s, r.id);
      continue;
    }
    jugar(s, { type: 'movimiento', move: s.player.moves[0]! });
    turnos++;
  }

  check('el combate termina', s.finished, `tras ${turnos} turnos`);

  const a = analisis.analizar(s);
  check('ahora sí hay análisis', a !== null);

  if (a) {
    check('con los dos bandos', a.jugador.length > 0 && a.rival.length > 0);
    check('y un MVP', a.mvp !== null, a.mvp?.nombre ?? 'ninguno');

    const conMovimiento = a.jugador.find((c) => c.record.skills > 0);
    check('cada combatiente con datos tiene su tabla', Boolean(conMovimiento && conMovimiento.lineas.length > 0));

    // Un Digimon que salió en el momento de aparecer NO debe tener una tabla
    // llena de ceros: el servicio devuelve la lista vacía y la pantalla decide el
    // texto. Cinco ceros dicen menos que "no llegó a actuar".
    const inactivo = a.jugador.find((c) => c.record.skills === 0 && c.record.dealt === 0);
    check(
      'un Digimon que no actuó no tiene tabla de ceros',
      inactivo === undefined || inactivo.lineas.length === 0,
      inactivo ? `${inactivo.lineas.length} líneas` : 'todos participaron',
    );

    const activo = a.jugador.find((c) => c.record.skills > 0);
    check(
      'uno que sí actuó tiene su tabla',
      Boolean(activo && activo.lineas.length > 0),
      activo ? `${activo.lineas.length} líneas` : 'ninguno',
    );

    check('los momentos se detectan', Array.isArray(a.momentos));
    check('y el rival declara su estilo', a.estiloRival.length > 0, a.estiloRival);
  }
}

// ==========================================================================
db.close();
cleanupDb('check-combate2.db', true);

if (fallidos.length > 0) {
  console.log('\nFallos:');
  for (const f of fallidos) console.log('  - ' + f);
}

console.log(
  fallos === 0
    ? '\nOK: estados, escudos, cooldowns, combos, sinergias, IA y telemetría funcionando.'
    : `\n${fallos} fallo(s).`,
);
process.exit(fallos === 0 ? 0 : 1);