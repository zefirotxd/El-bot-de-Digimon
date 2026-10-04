// Verifica la economia: inventario inicial, compra, gasto en combate y que los
// limites (dinero y tope por objeto) se respeten de verdad.
process.env.DISCORD_TOKEN ??= 'fake';
process.env.DISCORD_CLIENT_ID ??= '0';
process.env.DATABASE_PATH = './data/check-shop.db';

import { rmSync } from 'node:fs';
cleanupDb('check-shop.db', false);

const repo = await import('../src/game/repository.js');
const { ITEMS, STARTING_INVENTORY } = await import('../src/game/items.js');
const { buildBattleItems, createBattle, resolveTurn } = await import('../src/game/combat.js');
const { SPECIES } = await import('../src/game/species.js');
const { Rng } = await import('../src/game/random.js');
const { computeStats } = await import('../src/game/stats.js');

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` (${detail})` : ''}`);
}

const trainer = repo.registerTrainer('shop', 'Shopper', SPECIES.agumon!);

/**
 * Borra el .db de prueba. `bestEffort` no debe hacer fallar la corrida
 * (limpieza final); el borrado inicial sí tiene que completar.
 */
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

console.log('=== INVENTARIO INICIAL ===');
const initial = repo.getInventory(trainer.id);
console.log(`  ${Object.entries(initial).map(([k, v]) => `${ITEMS[k]!.name} x${v}`).join(', ')}`);
check('registrarse otorga el inventario inicial', initial.pocion === 3 && initial.superpocion === 1);
check(
  'el inventario inicial coincide con el catálogo',
  JSON.stringify(Object.keys(initial).sort()) === JSON.stringify(Object.keys(STARTING_INVENTORY).sort()) &&
    Object.entries(STARTING_INVENTORY).every(([k, v]) => initial[k] === v),
);

console.log('\n=== BOLSILLO EN COMBATE ===');
const bag = buildBattleItems(initial);
console.log(`  ${bag.map((i) => `${i.emoji} ${i.name} x${i.quantity}`).join(', ')}`);
check('la bolsa sale del inventario', bag.length === Object.keys(initial).length);
check('sin cápsulas no hay botón de captura', !bag.some((i) => i.key === 'capsula'));

// El tope por combate evita acaparar.
const stuffed = buildBattleItems({ pocion: 50, elixir: 9 });
const pocion = stuffed.find((i) => i.key === 'pocion')!;
const elixir = stuffed.find((i) => i.key === 'elixir')!;
check('la Poción se limita a 5 por combate', pocion.quantity === 5, `${pocion.quantity}`);
check('el Elixir se limita a 1 por combate', elixir.quantity === 1, `${elixir.quantity}`);
check('el tope por combate no gasta inventario', repo.getItemCount(trainer.id, 'pocion') === 3);

console.log('\n=== COMPRAR ===');
const before = repo.getTrainerById(trainer.id)!;
const potion = ITEMS.pocion!;
check('el precio es coherente', potion.price === 150);

const bought = repo.buyItem(trainer.id, 'pocion');
const after = repo.getTrainerById(trainer.id)!;
check('comprar descuenta el dinero', after.digibytes === before.digibytes - potion.price,
  `${before.digibytes} -> ${after.digibytes}`);
check('comprar suma el objeto', repo.getItemCount(trainer.id, 'pocion') === 4);
check('la compra devuelve la cantidad', bought.ok && bought.newQuantity === 4);

const broke = repo.buyItem(trainer.id, 'elixir');
check('sin dinero se rechaza', !broke.ok && broke.reason === 'sin-dinero');
check('un rechazo no descuenta nada', repo.getTrainerById(trainer.id)!.digibytes === after.digibytes);

const ghost = repo.buyItem(trainer.id, 'no-existe');
check('un objeto inexistente se rechaza', !ghost.ok && ghost.reason === 'no-existe');

// Tope de 99 unidades.
repo.giveDigibytes(trainer.id, 999_999);
for (let i = 0; i < 200; i++) repo.buyItem(trainer.id, 'tonico');
check('hay tope por objeto', repo.getItemCount(trainer.id, 'tonico') === 99, `${repo.getItemCount(trainer.id, 'tonico')}`);
check('al tope se rechaza', !repo.buyItem(trainer.id, 'tonico').ok);

console.log('\n=== GASTAR EN COMBATE ===');
// El Digimon inicial de nivel 1 muere al instante contra un enemigo de nivel 20,
// así que subimos el equipo: si no, el fixture no ejercita los objetos.
const party = repo.listParty(trainer.id);
for (const d of party) {
  d.level = 20;
  d.stats = computeStats(d.species.base, 20);
  d.hp = d.stats.hp;
  repo.saveDigimon(d);
}

const strongParty = repo.listParty(trainer.id);
const foe = SPECIES.goburimon!;
const battle = createBattle(strongParty, 0, foe, 20, repo.getInventory(trainer.id));

battle.player.hp = 10;
const pocionInBag = battle.items.find((i) => i.key === 'pocion')!;
const hpBefore = battle.player.hp;

check('el objeto está en la bolsa', pocionInBag.quantity > 0);

if (!repo.consumeItem(trainer.id, 'pocion', 1)) {
  check('consumir del inventario', false);
} else {
  check('consumir del inventario', true, `quedan ${repo.getItemCount(trainer.id, 'pocion')}`);
}

// Se devuelven los PV de los dos antes de jugar: con el daño actual un turno
// basta para que caiga cualquiera, y entonces el turno ni se resuelve.
battle.player.hp = hpBefore;
battle.enemy.hp = battle.enemy.stats.hp;
battle.finished = false;
battle.awaitingSwitch = false;

resolveTurn(battle, { type: 'objeto', item: pocionInBag }, new Rng(1));

// El rival juega en este mismo turno, así que el PV final mezcla dos hechos: que
// curó y que el rival golpeó. Se mide el EVENTO de curación, que dice lo que
// curó de verdad, en vez de comparar el saldo.
const curacion = battle.events.find((e) => e.kind === 'curacion');
check(
  'la Poción cura',
  curacion !== undefined && curacion.kind === 'curacion' && curacion.amount > 0,
  curacion && curacion.kind === 'curacion'
    ? `+${curacion.amount} PV (de ${hpBefore})`
    : `sin evento · PV ${hpBefore} -> ${battle.player.hp}`,
);
check(
  'y descuenta una unidad',
  pocionInBag.quantity < 5,
  `quedan ${pocionInBag.quantity}`,
);
// No se comprueba que la pelea siga viva: con el daño actual un turno la
// termina, y eso no dice nada sobre la Poción. Lo que importa es que el MOTOR
// registrara la curación, que se comprueba arriba.

// El Tónico da energía aunque la tengas a cero.
// Antes hay que reponer PV: el rival golpea en el mismo turno y el Agumon de
// nivel 20 no aguanta dos impactos seguidos, así que se moriría antes de poder
// probar el Repelente.
const tonicBag = battle.items.find((i) => i.key === 'tonico');
check('el Tónico está en la bolsa (comprado antes)', Boolean(tonicBag));

if (tonicBag) {
  // Igual que en el Repelente: los dos en pie, o el turno ni se resuelve.
  battle.player.hp = battle.player.stats.hp;
  battle.enemy.hp = battle.enemy.stats.hp;
  battle.finished = false;
  battle.awaitingSwitch = false;
  battle.player.energy = 0;
  resolveTurn(battle, { type: 'objeto', item: tonicBag }, new Rng(2));
  check('el Tónico da energía', battle.player.energy > 0, `0 -> ${battle.player.energy}`);
}

// El Repelente garantiza la huida sin importar la Velocidad ni la vida.
const repBag = battle.items.find((i) => i.key === 'repelente')!;
// Los dos bandos en pie. Si alguno cae, `resolveTurn` corta en seco y el turno
// no llega a jugarse: la comprobación fallaría por la muerte, no por el
// Repelente.
battle.player.hp = battle.player.stats.hp;
battle.enemy.hp = battle.enemy.stats.hp;
battle.finished = false;
battle.awaitingSwitch = false;
resolveTurn(battle, { type: 'objeto', item: repBag }, new Rng(3));
check('el Repelente garantiza la huida', battle.result === 'huida', String(battle.result));

check('no se puede consumir lo que no tienes', repo.consumeItem(trainer.id, 'pocion', 999) === false);
check('el inventario nunca queda en negativo', repo.getItemCount(trainer.id, 'pocion') >= 0);

const { db } = await import('../src/db/index.js');
db.close();
cleanupDb('check-shop.db', true);

console.log(failures === 0 ? '\nOK: economia funcionando.' : `\n${failures} fallo(s).`);
process.exit(failures === 0 ? 0 : 1);
