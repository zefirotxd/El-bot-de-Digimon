// Verifica el equipo permanente: que SUME y no sobrescriba, que desequipar
// devuelva exactamente las cifras originales, y que los efectos activos
// respondan dentro del motor de combate.
process.env.DISCORD_TOKEN ??= 'fake';
process.env.DISCORD_CLIENT_ID ??= '0';
process.env.DATABASE_PATH = './data/check-gear.db';

import { rmSync } from 'node:fs';
cleanupDb('check-gear.db', false);

const repo = await import('../src/game/repository.js');
const gear = await import('../src/game/gearRepo.js');
const { EQUIPMENT, applyGear, MAX_UPGRADE, upgradeCost } = await import('../src/game/equipment.js');
const { SPECIES } = await import('../src/game/species.js');
const { computeStats } = await import('../src/game/stats.js');
const { createBattle, fighterFromOwned, resolveTurn } = await import('../src/game/combat.js');
const { db } = await import('../src/db/index.js');
const { Rng } = await import('../src/game/random.js');

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` (${detail})` : ''}`);
}

const trainer = repo.registerTrainer('gear', 'GearUser', SPECIES.greymon!);
repo.giveDigibytes(trainer.id, 999_999);

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

console.log('=== SUMAR, NUNCA SOBRESCRIBIR ===');

const agumon = repo.createDigimon(trainer.id, SPECIES.agumon!, 20, ['impacto', 'lanza_llamas']);
const naked = repo.getDigimon(agumon.id)!;
const baseOnly = computeStats(SPECIES.agumon.base, 20);

check('sin equipo las stats son las de la especie por nivel',
  naked.stats.hp === baseOnly.hp && naked.stats.attack === baseOnly.attack,
  `pv ${naked.stats.hp}/${baseOnly.hp}`);

// Equipamos algo.
const sword = EQUIPMENT.espada_digital!;
const bought = gear.buyGear(trainer.id, sword.key);
check('comprar equipo funciona', bought.ok, bought.ok ? '' : bought.reason);

const equipped = gear.equipItem(trainer.id, agumon.id, sword.key);
check('equipar funciona', equipped.result.ok, equipped.result.ok ? '' : equipped.result.reason);

const armed = repo.getDigimon(agumon.id)!;
check('el arma suma ATQ', armed.stats.attack === baseOnly.attack + sword.bonus.attack,
  `${baseOnly.attack} -> ${armed.stats.attack} (+${sword.bonus.attack})`);
check('el arma NO toca el PV', armed.stats.hp === baseOnly.hp, `${armed.stats.hp}`);
check('las stats nunca bajan', armed.stats.defense === baseOnly.defense);

console.log('\n=== DESEQUIPAR DEVUELVE LAS CIFRAS EXACTAS ===');
const before = { ...armed.stats };
gear.unequip(trainer.id, agumon.id);
const bare = repo.getDigimon(agumon.id)!;
check('al quitar queda igual que al principio',
  bare.stats.hp === before.hp - 0 && bare.stats.attack === before.attack - sword.bonus.attack,
  `atq ${bare.stats.attack}`);
check('vuelve a las stats base exactas',
  bare.stats.hp === baseOnly.hp && bare.stats.attack === baseOnly.attack &&
  bare.stats.defense === baseOnly.defense && bare.stats.speed === baseOnly.speed);

// Volvemos a equipar.
gear.equipItem(trainer.id, agumon.id, sword.key);

console.log('\n=== LAS STATS VIENEN DE LA ESPECIE, NO DE UNA COPIA ===');
// Antes había columnas base_* con las estadísticas ya escaladas, y al releer
// se escalaban otra vez (crecimiento cuadrático). Ahora solo hay una fuente:
// la especie + el nivel.
const columns = db
  .prepare<[], { name: string }>('PRAGMA table_info(digimon)')
  .all()
  .map((c) => c.name);

check('no queda ninguna columna base_* en la tabla',
  !columns.some((c) => c.startsWith('base_')),
  columns.filter((c) => c.startsWith('base_')).join(', ') || 'ninguna');

const atLevel10 = repo.createDigimon(trainer.id, SPECIES.agumon!, 10, ['impacto']);
const atLevel30 = repo.createDigimon(trainer.id, SPECIES.agumon!, 30, ['impacto']);
const s10 = repo.getDigimon(atLevel10.id)!;
const s30 = repo.getDigimon(atLevel30.id)!;

check('el nivel manda en las stats',
  s30.stats.attack > s10.stats.attack * 2,
  `nv10 atq ${s10.stats.attack} vs nv30 atq ${s30.stats.attack}`);
check('las stats coinciden con computeStats(especie, nivel)',
  s30.stats.attack === computeStats(SPECIES.agumon.base, 30).attack,
  `${s30.stats.attack}`);

console.log('\n=== RANURAS ===');
const chest = EQUIPMENT.placas_hielo!;
gear.buyGear(trainer.id, chest.key);
gear.equipItem(trainer.id, agumon.id, chest.key);
const withChest = repo.getDigimon(agumon.id)!;
check('armadura suma DEF y PV',
  withChest.stats.defense === baseOnly.defense + chest.bonus.defense! &&
  withChest.stats.hp === baseOnly.hp + chest.bonus.hp!);

// Dos piezas de la misma ranura: la segunda reemplaza a la primera.
const armors = Object.values(EQUIPMENT).filter((e) => e.slot === 'armadura' && e.key !== chest.key);
const swap = armors[0]!;
gear.buyGear(trainer.id, swap.key);
const replaced = gear.equipItem(trainer.id, agumon.id, swap.key);
check('la segunda armadura reemplaza a la primera', replaced.replaced?.key === chest.key,
  `${replaced.replaced?.key} -> ${swap.key}`);
const afterSwap = repo.getDigimon(agumon.id)!;
check('ya no cuenta la armadura anterior',
  afterSwap.stats.defense === baseOnly.defense + (swap.bonus.defense ?? 0));

// Dos Digimon no pueden compartir la misma pieza.
const other = repo.createDigimon(trainer.id, SPECIES.gabumon!, 20, ['impacto']);
gear.buyGear(trainer.id, sword.key);
const shared = gear.equipItem(trainer.id, other.id, sword.key);
check('se puede equipar la misma clave en otro Digimon', shared.result.ok);

console.log('\n=== AISLAMIENTO ===');
const stolen = gear.equipItem(trainer.id, 999999, sword.key);
check('no se puede equipar sobre un Digimon ajeno', !stolen.result.ok);
const otherTrainer = repo.registerTrainer('gear2', 'Otro', SPECIES.paulmon!);
const steal2 = gear.equipItem(otherTrainer.id, other.id, sword.key);
check('otro entrenador no toca mi Digimon', !steal2.result.ok);

console.log('\n=== MEJORAS ===');
// La mejora exige material: hay que comprarlo primero.
for (let i = 0; i < 20; i++) repo.buyItem(trainer.id, 'tonico');
check('hay material para mejorar', repo.getItemCount(trainer.id, 'tonico') > 0,
  `${repo.getItemCount(trainer.id, 'tonico')} tónicos`);

const up = gear.upgradeGear(trainer.id, sword.key);
check('mejorar sube de nivel', up.ok && (up as { upgrade: number }).upgrade === 1,
  up.ok ? `+${(up as { upgrade: number }).upgrade}` : up.reason);
const upStats = repo.getDigimon(agumon.id)!;
const expectedBonus = Math.round(sword.bonus.attack! * (1 + 0.12 * 1));
check('el arma equipada sube con la mejora',
  upStats.stats.attack === baseOnly.attack + expectedBonus,
  `${upStats.stats.attack}`);

for (let i = 0; i < 20; i++) {
  const r = gear.upgradeGear(trainer.id, sword.key);
  if (!r.ok) break;
}
const maxed = gear.upgradeGear(trainer.id, sword.key);
check('hay tope de mejora', !maxed.ok && maxed.reason === 'maximo', maxed.reason);
check('mejorar cuesta DigiBytes', upgradeCost(sword, 0) > 0, `${upgradeCost(sword, 0)} DB`);

console.log('\n=== CATÁLOGO ===');
const slots = new Set(Object.values(EQUIPMENT).map((e) => e.slot));
check('hay piezas en las 4 ranuras', slots.size === 4, [...slots].join(', '));
check('cada rareza tiene al menos una pieza',
  ['comun', 'raro', 'epico', 'leyenda'].every((r) =>
    Object.values(EQUIPMENT).some((e) => e.rarity === r)));

for (const def of Object.values(EQUIPMENT)) {
  if (def.bonus.accuracy || def.bonus.critRate) {
    check(`${def.key} no mete stats inventadas`, false, 'accuracy/critRate van aparte');
  }
}

console.log('\n=== EFECTOS EN COMBATE ===');
/**
 * Mide el daño del primer golpe contra un Digimon, con y sin escudo.
 *
 * Se mide sobre el RIVAL (state.enemy), no sobre el jugador: el escudo vive
 * en el que recibe, y antes esto Was midiendo al atacante.
 */
// Placas de Hielo necesita nivel 12 (el Manto del Vacío pediría 46) y trae
// escudo al 15%.
const shieldPiece = EQUIPMENT.placas_hielo;
const shieldD = repo.createDigimon(trainer.id, SPECIES.weregarurumon!, 30, ['impacto', 'carambano']);
const plain = repo.createDigimon(trainer.id, SPECIES.weregarurumon!, 30, ['impacto', 'carambano']);

const boughtShield = gear.buyGear(trainer.id, shieldPiece.key);
check('se compra el escudo', boughtShield.ok, boughtShield.ok ? '' : boughtShield.reason);

const fitted = gear.equipItem(trainer.id, shieldD.id, shieldPiece.key);
check('se equipa el escudo', fitted.result.ok, fitted.result.ok ? '' : fitted.result.reason);
check('el Digimon con escudo tiene más PV',
  repo.getDigimon(shieldD.id)!.stats.hp > repo.getDigimon(plain.id)!.stats.hp,
  `${repo.getDigimon(shieldD.id)!.stats.hp} vs ${repo.getDigimon(plain.id)!.stats.hp}`);

function damageVs(defenderId: number, seed: number): number {
  const attacker = repo.createDigimon(trainer.id, SPECIES.metalgreymon!, 35, [
    'impacto', 'lanza_llamas', 'mega_llama',
  ]);
  const defender = repo.getDigimon(defenderId)!;

  const state = createBattle([attacker], 0, SPECIES.greymon!, 35, {});
  // El rival pasa a ser el Digimon bajo prueba, con SU equipo.
  const fighter = fighterFromOwned(defender, 'rival');
  state.enemy = fighter;
  state.enemyTeam = [fighter];
  state.enemyIndex = 0;
  state.turn = 1;

  // Se le quitan los movimientos al defensor. Es lo que hace falta para que la
  // medida sea del ESCUDO y no de quién golpea primero: sin esto, el resultado
  // depende del orden de velocidad, que es justo lo que el comparador está
  // cambiando al cambiar el equipo.
  fighter.moves = [];

  const before = state.enemy.hp;
  const move = state.player.moves.find((m) => m.energyCost <= state.player.energy)!;
  resolveTurn(state, { type: 'movimiento', move }, new Rng(seed));

  const quitado = before - state.enemy.hp;

  // Si el golpe no entró, la medida no vale: sería 0 en ambos brazos y el
  // comparador daría la razón sin comprobar nada.
  if (quitado <= 0) return -1;

  return quitado;
}

const withShield = damageVs(shieldD.id, 11);
const withoutShield = damageVs(plain.id, 11);

console.log(`  con escudo: ${withShield} PV | sin escudo: ${withoutShield} PV`);
check(
  'el golpe entra en los dos brazos',
  withShield > 0 && withoutShield > 0,
  `con escudo ${withShield} · sin escudo ${withoutShield}`,
);
check(
  'el escudo reduce el daño del primer golpe',
  withShield > 0 && withShield < withoutShield,
  `${withShield} < ${withoutShield}`,
);

const shieldDef = repo.getDigimon(shieldD.id)!;
console.log(`  pv: escudo ${withShield} vs plano ${withoutShield}`);
void shieldDef;

db.close();
cleanupDb('check-gear.db', true);

console.log(failures === 0 ? '\nOK: equipo permanente funcionando.' : `\n${failures} fallo(s).`);
process.exit(failures === 0 ? 0 : 1);

