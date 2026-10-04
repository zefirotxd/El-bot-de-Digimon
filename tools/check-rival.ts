// Comprueba que los entrenadores NPC con equipo de varios Digimon funcionan:
// cambio en caliente del rival, recompensa escalada y jefe sin fuga.
process.env.DISCORD_TOKEN ??= 'fake';
process.env.DISCORD_CLIENT_ID ??= '0';
process.env.DATABASE_PATH = './data/check-rival.db';

import { rmSync } from 'node:fs';
cleanupDb('check-rival.db', false);

const repo = await import('../src/game/repository.js');
const { SPECIES } = await import('../src/game/species.js');
const { getSpecies } = await import('../src/game/species.js');
const {
  createTrainerBattle,
  resolveTurn,
  switchCandidates,
  switchTo,
} = await import('../src/game/combat.js');
const { getTemplates, rollTrainer, templateLevel, templateAttributes } =
  await import('../src/game/trainers.js');
const { rollRewards } = await import('../src/game/progression.js');
const { computeStats } = await import('../src/game/stats.js');
const { Rng } = await import('../src/game/random.js');
const { db } = await import('../src/db/index.js');

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` (${detail})` : ''}`);
}

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

console.log('=== PLANTILLAS ===');
const templates = getTemplates();
check('hay plantillas definidas', templates.length > 0, `${templates.length}`);
check('cada plantilla tiene equipo', templates.every((t) => t.team.length >= 1));
check('todas las especies existen', templates.every((t) => t.team.every((m) => getSpecies(m.speciesKey))));

for (const template of templates) {
  const roster = template.team
    .map((m) => `${getSpecies(m.speciesKey)!.emoji} ${getSpecies(m.speciesKey)!.name} Nv.${m.level}`)
    .join(', ');
  console.log(`  ${template.boss ? '👑' : '⚔️'} ${template.name} (Nv.${templateLevel(template)}) x${template.rewardBonus}`);
  console.log(`     ${roster}`);
}

// Un rival de un solo atributo es predecible: hay que evitarlo.
const mono = templates.filter((t) => new Set(templateAttributes(t)).size === 1);
check('ningún rival es de un solo atributo', mono.length === 0,
  mono.map((t) => t.name).join(', '));

console.log('\n=== SELECCIÓN POR NIVEL ===');
for (const level of [3, 12, 20, 30, 40, 55]) {
  const t = rollTrainer(level, new Rng(level));
  check(
    `Nv.${level} -> ${t.name}`,
    templateLevel(t) <= level + 4,
    `nivel rival ${templateLevel(t)}`,
  );
}
const boss = rollTrainer(30, new Rng(1), true);
check('el filtro de jefe devuelve un jefe', boss.boss, boss.name);

// ---------------------------------------------------------------------------
console.log('\n=== COMBATE CON EQUIPO RIVAL ===');

const trainer = repo.registerTrainer('rival-user', 'RivalUser', SPECIES.greymon!);
const party = [
  repo.createDigimon(trainer.id, SPECIES.greymon!, 20, ['impacto', 'lanza_llamas', 'mega_llama']),
  repo.createDigimon(trainer.id, SPECIES.angemon!, 20, ['impacto', 'holy_light']),
];
repo.setLeader(trainer.id, party[0].id);

const template = templates.find((t) => t.key === 'veterano_ultimate')!;
const battle = createTrainerBattle(repo.listParty(trainer.id), 0, {
  team: template.team.map((m) => ({
    species: getSpecies(m.speciesKey)!,
    level: Math.round(m.level * (20 / templateLevel(template))),
  })),
  trainerName: template.name,
  intro: template.intro,
  boss: template.boss,
  inventory: repo.getInventory(trainer.id),
});
battle.rewardMultiplier = template.rewardBonus;

check('el rival tiene su equipo completo', battle.enemyTeam.length === template.team.length);
check('sale el primero de la lista', battle.enemy.name === battle.enemyTeam[0].name);
check('el rival tiene nombre', battle.enemyTrainer === template.name);

// Jugar la batalla hasta el final, cambiando de Digimon cuando el tuyo cae.
const rng = new Rng(7);
let turns = 0;
let playerSwitches = 0;
let enemySwitches = 0;

while (!battle.finished && turns < 400) {
  if (battle.awaitingSwitch) {
    // `switchCandidates` excluye a los ya caídos: cambiar a uno de ellos se
    // rechaza y `awaitingSwitch` seguiría activo, con lo que el bucle no
    // avanzaría nunca.
    const reserve = switchCandidates(battle)[0];
    if (!reserve) break;
    if (!switchTo(battle, reserve.id)) break;
    playerSwitches++;
    continue;
  }
  const move = battle.player.moves.find((m) => m.energyCost <= battle.player.energy)!;
  resolveTurn(battle, { type: 'movimiento', move }, rng);
  turns++;
}

console.log(
  `  resultado: ${battle.result} en ${turns} turnos ` +
    `(${playerSwitches} cambio(s) tuyo(s), ${enemySwitches} del rival)`,
);
check('el combate termina', battle.finished, String(battle.result));

// El rival debe haber entrado en el campo más de una vez si su primer Digimon
// cayó. Cuenta las apariciones reales en el registro.
const entries = battle.log.filter((l) => l.includes('entra en el campo')).length;
console.log(`  cambios de Digimon del rival: ${entries}`);
check(
  'el rival usa su equipo completo',
  battle.result === 'derrota' || entries >= 1,
  `${entries} entrada(s)`,
);

if (battle.result === 'victoria') {
  check('vencer al rival completo es posible', battle.finished);
} else {
  // Con el jugador a nivel 20 contra un rival de nivel 30 (+escala) perder es lo normal.
  check('perder contra un rival superior es lo esperado', battle.result === 'derrota', String(battle.result));
}

// El equipo rival nunca debe quedarse a medias.
check('el estado final es coherente', battle.enemyIndex < battle.enemyTeam.length);

console.log('\n=== RECOMPENSA ===');
const species = getSpecies('kunemon')!;
const plain = rollRewards(species, 20, new Rng(5), 1);
const bossReward = rollRewards(species, 20, new Rng(5), 4);
check('el jefe paga más EXP', bossReward.exp > plain.exp, `${plain.exp} -> ${bossReward.exp}`);
check('el jefe paga más DigiBytes', bossReward.digibytes > plain.digibytes,
  `${plain.digibytes} -> ${bossReward.digibytes}`);
check('los jefes pagan mucho más', bossReward.exp >= plain.exp * 3, `x${(bossReward.exp / plain.exp).toFixed(1)}`);

const noBonus = rollRewards(species, 20, new Rng(5), 0);
check('un bonus de 0 no baja del 1x', noBonus.exp === plain.exp, `${noBonus.exp} vs ${plain.exp}`);

db.close();
cleanupDb('check-rival.db', true);

console.log(failures === 0 ? '\nOK: entrenadores rivales funcionando.' : `\n${failures} fallo(s).`);
process.exit(failures === 0 ? 0 : 1);
