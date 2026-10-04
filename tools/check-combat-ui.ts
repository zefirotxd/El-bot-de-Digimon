// Verificación de la Battle GUI: idempotencia, seguridad y ciclo de vida.
//
// Son los escenarios que importan cuando el combate se juega con botones en
// lugar de con collectors. La diferencia de fondo es que el input ya no es
// lineal: Discord puede entregar dos clics, otro jugador puede tocar un
// mensaje ajeno, y un mensaje viejo puede pulsar cuando el combate terminó.
//
// Cada comprobación manda una acción de verdad, por el mismo camino que un
// botón: con el turno para el que se pintó.
process.env.DISCORD_TOKEN ??= 'fake';
process.env.DISCORD_CLIENT_ID ??= '0';
process.env.DATABASE_PATH = './data/check-combat-ui.db';

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
cleanupDb('check-combat-ui.db', false);

const repo = await import('../src/game/repository.js');
const { SPECIES, getSpecies } = await import('../src/game/species.js');
const { computeStats } = await import('../src/game/stats.js');
const { db } = await import('../src/db/index.js');
const combat = await import('../src/game/combat.js');
const flow = await import('../src/services/battleFlow.js');
const runtime = await import('../src/game/battleRuntime.js');
const navSession = await import('../src/ui/session.js');
const screen = await import('../src/ui/screen.js');

let failures = 0;
const failed: string[] = [];

function check(label: string, ok: boolean, detail = '') {
  if (!ok) {
    failures++;
    failed.push(label);
  }
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` (${detail})` : ''}`);
}

// ---------------------------------------------------------------- auxiliares --

function trainerWith(discordId: string, name: string, claves = ['agumon', 'gabumon']) {
  const t = repo.registerTrainer(discordId, name, SPECIES.agumon!);
  for (const [i, key] of claves.entries()) {
    const nivel = 30 - i;
    const d = repo.createDigimon(t.id, getSpecies(key)!, nivel, ['impacto']);
    d.level = nivel;
    d.stats = computeStats(d.species.base, nivel);
    d.hp = d.stats.hp;
    repo.saveDigimon(d);
    repo.setLeader(t.id, d.id);
  }
  repo.giveDigibytes(t.id, 20_000);
  for (const k of ['pocion', 'superpocion', 'elixir']) repo.addItem(t.id, k, 3);
  return repo.getTrainerById(t.id)!;
}

function combateDe(trainerId: number) {
  const party = repo.listParty(trainerId);
  return combat.createTrainerBattle(party, 0, {
    team: [
      { species: getSpecies('gabumon')!, level: 5 },
      { species: getSpecies('kunemon')!, level: 5 },
    ],
    trainerName: 'Rival de prueba',
    intro: 'Vamos.',
    boss: false,
    inventory: repo.getInventory(trainerId),
  });
}

type State = ReturnType<typeof combateDe>;
const primerMovimiento = (s: State) => s.player.moves[0]!;

/**
 * Juega un turno como lo haría un botón: se pasa el turno ACTUAL, que es lo
 * que lleva el `custom_id`.
 */
function jugar(s: State, accion: Parameters<typeof flow.submitAction>[1]) {
  return flow.submitAction(s, accion, s.turn);
}

/**
 * Juega un turno PELANDO COMO UN JUGADOR.
 *
 * El motor puede dejar el combate pidiendo un cambio, y entonces no admite
 * acciones: hay que cambiar primero. Un bucle de test que ignorase eso se
 * quedaria dando turnos sin que pasara nada y fallaria por el azar del rival en
 * lugar de por lo que comprueba.
 *
 * Los bucles largos usan esta, no `jugar`.
 */
function jugarConCambio(s: State, accion: Parameters<typeof flow.submitAction>[1]) {
  if (s.finished) return { ok: false as const, reason: 'combate-terminado' as const, message: '', state: s };

  if (s.awaitingSwitch) {
    const siguiente = flow.candidates(s).find((d) => d.hp > 0);
    if (!siguiente) {
      return { ok: false as const, reason: 'cambio-pendiente' as const, message: 'sin reemplazos', state: s };
    }
    flow.requestSwitch(s, siguiente.id);
  }

  return flow.submitAction(s, accion, s.turn);
}

// ==========================================================================
console.log('=== 1. DOBLE CLIC NO EJECUTA DOS ATAQUES ===');
// ==========================================================================

{
  const t = trainerWith('cb1', 'Doble');
  const s = combateDe(t.id);
  const move = primerMovimiento(s);

  // Los tres clics llevan el turno para el que se pinto el boton, que es lo
  // que pasa de verdad: los tres leen el mismo mensaje.
  const turnoDelBoton = s.turn;
  const click = () =>
    flow.submitAction(s, { type: 'movimiento', move }, turnoDelBoton, Date.now());

  const primer = click();
  const pvTrasElPrimero = s.enemy.hp;
  const turnoTrasElPrimero = s.turn;

  const segundo = click();
  const tercero = click();

  check('el primer clic se acepta', primer.ok, primer.ok ? '' : primer.message);
  check(
    'el segundo clic se rechaza',
    !segundo.ok && segundo.reason === 'turno-ya-resuelto',
    segundo.ok ? 'aceptado' : segundo.reason,
  );
  check('y el tercero tambien', !tercero.ok);

  check(
    'el mensaje es el que se pidio',
    !segundo.ok && segundo.message.includes('ya fue procesado'),
    segundo.ok ? '' : segundo.message,
  );

  check('el PV del rival no cambia en el segundo', s.enemy.hp === pvTrasElPrimero);
  check('no se juega un turno extra', s.turn === turnoTrasElPrimero, `${turnoTrasElPrimero} -> ${s.turn}`);
  check(
    'el motor solo lo pidio una vez',
    s.turnGuard.requests === 1,
    `${s.turnGuard.requests} peticiones`,
  );
}

// ==========================================================================
console.log('\n=== 2. UNA INTERACCIÓN DE OTRO JUGADOR SE RECHAZA ===');
// ==========================================================================

{
  const a = trainerWith('cb-a', 'Ana');
  const b = trainerWith('cb-b', 'Bruno');

  const sA = combateDe(a.id);
  const sB = combateDe(b.id);

  // Las sesiones son distintas y el estado de una no aparece en la otra.
  const navA = navSession.ensureSession('u-a', a.id);
  const navB = navSession.ensureSession('u-b', b.id);

  navA.battle = sA;
  navB.battle = sB;

  check('cada uno ve SU combate', navA.battle !== navB.battle);
  check('el de Ana no es el de Bruno', navA.battle!.id !== navB.battle!.id);

  const antes = sB.enemy.hp;
  jugar(sA, { type: 'movimiento', move: primerMovimiento(sA) });

  check('el combate de Bruno no se toca', sB.enemy.hp === antes);
  check('ni avanza de turno', sB.turn === 1);
  check('y su guardia sigue en cero', sB.turnGuard.requests === 0);
}

// ==========================================================================
console.log('\n=== 3. UN BOTÓN DE UN COMBATE TERMINADO NO FUNCIONA ===');
// ==========================================================================

{
  const t = trainerWith('cb3', 'Terminado');
  const s = combateDe(t.id);

  let golpes = 0;
  while (!s.finished && golpes < 400) {
    jugarConCambio(s, { type: 'movimiento', move: primerMovimiento(s) });
    golpes++;
  }

  check('el combate termina', s.finished, `tras ${golpes} turnos`);
  check('con victoria', s.result === 'victoria', s.result ?? '');

  const turnoFinal = s.turn;
  const resultado = jugar(s, { type: 'movimiento', move: primerMovimiento(s) });

  check('una accion posterior se rechaza', !resultado.ok);
  check(
    'y el motivo es que termino',
    !resultado.ok && resultado.reason === 'combate-terminado',
    resultado.ok ? '' : resultado.reason,
  );

  jugar(s, { type: 'defender' });
  check('el estado no cambia', s.turn === turnoFinal, `${turnoFinal} -> ${s.turn}`);

  // Y aunque el boton lleve el turno correcto, un combate acabado no se toca.
  const conTurno = flow.submitAction(s, { type: 'defender' }, turnoFinal, Date.now());
  check('ni aunque el turno coincida', !conTurno.ok && conTurno.reason === 'combate-terminado');
}

// ==========================================================================
console.log('\n=== 4. UN BOTÓN DE UN TURNO ANTERIOR NO FUNCIONA ===');
// ==========================================================================

{
  const t = trainerWith('cb4', 'Turnos');
  const s = combateDe(t.id);

  const turnoPintado = s.turn;
  jugar(s, { type: 'movimiento', move: primerMovimiento(s) });

  const tras = s.turn;
  check('el turno avanza', tras > 1, `turno ${tras}`);
  check('la guardia recuerda el envio', s.turnGuard.resolved === turnoPintado, `${s.turnGuard.resolved}`);

  // Ese mismo boton, pulsado cuando el combate ya va por otro turno.
  const tarde = flow.submitAction(
    s,
    { type: 'movimiento', move: primerMovimiento(s) },
    turnoPintado,
    Date.now(),
  );

  check('un turno viejo se rechaza', !tarde.ok && tarde.reason === 'turno-ya-resuelto');
  check('el turno no avanza otra vez', s.turn === tras, `${tras} -> ${s.turn}`);

  // Un boton de un turno que aun no existe tampoco.
  const futuro = flow.submitAction(s, { type: 'defender' }, turnoPintado + 99, Date.now());
  check('un turno futuro se rechaza', !futuro.ok && futuro.reason === 'turno-ya-resuelto');
}

// ==========================================================================
console.log('\n=== 5. NO SE PUEDE ATACAR SIENDO OBLIGADO A CAMBIAR ===');
// ==========================================================================

{
  const t = trainerWith('cb5', 'Caidos');
  const s = combateDe(t.id);

  s.player.hp = 0;
  s.awaitingSwitch = true;

  const permitido = runtime.allowedActions(s);

  check('atacar queda bloqueado', permitido.atacar === false);
  check('defender tambien', permitido.defender === false);
  check('objetos tambien', permitido.objetos === false);
  check('capturar tambien', permitido.capturar === false);
  check('cambiar es lo unico', permitido.cambiar === true);
  check('y hay un motivo', permitido.motivo !== null, permitido.motivo ?? '');

  const intento = jugar(s, { type: 'movimiento', move: primerMovimiento(s) });
  check(
    'el motor rechaza atacar',
    !intento.ok && intento.reason === 'cambio-pendiente',
    intento.ok ? '' : intento.reason,
  );

  const conTurno = flow.submitAction(s, { type: 'defender' }, s.turn);
  check('tampoco aunque el turno coincida', !conTurno.ok && conTurno.reason === 'cambio-pendiente');
}

// ==========================================================================
console.log('\n=== 6. NO SE PUEDE ELEGIR UN DIGIMON MUERTO ===');
// ==========================================================================

{
  const t = trainerWith('cb6', 'Cambio');
  const party = repo.listParty(t.id);
  const s = combateDe(t.id);

  // El combate trabaja sobre una COPIA del equipo, asi que poner el 0 PV en la
  // base de datos no le llega. Se pone en la copia, que es el caso real de un
  // Digimon que una pelea anterior dejo sin fuerzas.
  const segundo = party[1]!;
  s.party[1]!.hp = 0;

  const candidatos = flow.candidates(s);
  check('los candidatos excluyen al caido', !candidatos.some((d) => d.id === segundo.id));
  check('y excluyen al activo', !candidatos.some((d) => d.id === party[0]!.id));

  // Aunque la interfaz se saltara el filtro, el motor lo dice.
  const intento = flow.requestSwitch(s, segundo.id);
  check('el motor rechaza cambiar a un caido', !intento.switched, intento.message);
  check('el activo sigue siendo el mismo', s.player.name === party[0]!.species.name);

  // Y cambiar a uno vivo si funciona.
  if (candidatos.length > 0) {
    const ok = flow.requestSwitch(s, candidatos[0]!.id);
    check('cambiar a uno vivo funciona', ok.switched);
    check('y el activo cambia', s.player.name === candidatos[0]!.species.name, s.player.name);
    check('el cambio obligatorio se limpia', s.awaitingSwitch === false);
  }

  // Un id que no existe tampoco.
  check('un id inexistente se rechaza', !flow.requestSwitch(s, 999_999).switched);
}

// ==========================================================================
console.log('\n=== 7-8. OBJETOS: INVENTARIO REAL Y CONSUMO UNA VEZ ===');
// ==========================================================================

{
  const t = trainerWith('cb7', 'Objetos');
  const s = combateDe(t.id);

  const items = flow.itemsOf(s);
  check('el inventario del combate viene del real', items.length > 0, `${items.length} tipos`);
  check(
    'las cantidades coinciden con el almacen',
    items.every((i) => (repo.getInventory(t.id)[i.key] ?? 0) >= i.quantity),
  );

  check('un objeto inexistente no se encuentra', flow.itemOf(s, 'objeto_que_no_existe') === null);

  const pocion = flow.itemOf(s, 'pocion');
  if (pocion) {
    const cantidadAntes = pocion.quantity;

    // Se baja el PV para que la pocion sirva de algo. Se mide la CURACION, no
    // el PV final: despues juega el rival, y su golpe lo baja otra vez, asi que
    // el saldo del turno no dice nada sobre si la pocion funciono.
    s.player.hp = Math.max(1, Math.floor(s.player.stats.hp / 2));
    const pvHerido = s.player.hp;

    const turnoDelBoton = s.turn;
    const resultado = flow.submitAction(
      s,
      { type: 'objeto', item: pocion },
      turnoDelBoton,
      Date.now(),
    );

    check('usar el objeto se acepta', resultado.ok, resultado.ok ? '' : resultado.message);
    check('la cantidad baja UNO', pocion.quantity === cantidadAntes - 1, `${cantidadAntes} -> ${pocion.quantity}`);

    const curacion = s.events.find((e) => e.kind === 'curacion');
    check('el motor registro la curacion', Boolean(curacion));
    check(
      'y el PV subio en el momento de la curacion',
      curacion !== undefined && curacion.kind === 'curacion' && curacion.amount > 0,
      curacion && curacion.kind === 'curacion' ? `+${curacion.amount}` : '',
    );
    check('el PV estaba por debajo del maximo', pvHerido < s.player.stats.hp);

    // Un segundo uso del MISMO boton: mismo turno, se rechaza.
    const segundo = flow.submitAction(
      s,
      { type: 'objeto', item: pocion },
      turnoDelBoton,
      Date.now(),
    );
    check('un segundo uso en el mismo turno se rechaza', !segundo.ok);
    check('y no se consume dos veces', pocion.quantity === cantidadAntes - 1, `-> ${pocion.quantity}`);

    // Y en un turno nuevo, uno mas.
    jugarConCambio(s, { type: 'defender' });

    // Se devuelven los dos a PV completos antes de seguir.
    //
    // El rival, porque por debajo del 18% de PV la IA intenta huir con un 8% de
    // probabilidad y el combate terminaria antes de tiempo.
    //
    // El jugador, por una razon mas sutil: si cae ANTES de que le toque actuar,
    // el motor se salta su turno y no se gasta nada. El turno se acepta igual,
    // asi que "accion aceptada" y "objeto consumido" no son lo mismo, y el test
    // tiene que distinguirlo en vez de dar por hecho que coinciden.
    s.enemy.hp = s.enemy.stats.hp;
    s.player.hp = s.player.stats.hp;

    const siguiente = flow.itemOf(s, 'pocion');
    if (siguiente) {
      const antes = siguiente.quantity;
      const otro = jugarConCambio(s, { type: 'objeto', item: siguiente });
      check('el uso en el turno siguiente se acepta', otro.ok, otro.ok ? '' : otro.message);
      check(
        'y consume exactamente uno',
        siguiente.quantity === antes - 1,
        `${antes} -> ${siguiente.quantity}`,
      );
    }
  }
}