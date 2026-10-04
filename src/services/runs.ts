import {
  buildBossFighter,
  createTrainerBattle,
  grantExp,
  type BattleState,
  type OpponentSpec,
} from '../game/combat.js';

import { getBoss } from '../game/bosses.js';
import { getDungeon, type RoomDef } from '../game/dungeons.js';
import {
  clearRoom,
  damageWorldBossBy,
  dungeonReward,
  energyOf,
  runOf,
  startRun,
  worldBossState,
} from '../game/dungeonRepo.js';
import {
  addItem,
  findTrainer,
  getInventory,
  giveDigibytes,
  listParty,
  makePersister,
  restTeam,
  saveBattleResult,
} from '../game/repository.js';
import { getItem } from '../game/items.js';
import { getTutorTemplate, templateLevel } from '../game/trainers.js';
import { rollEncounter } from '../game/progression.js';
import { getSpecies } from '../game/species.js';
import { rng } from '../game/random.js';
import { COLORS } from '../views/embeds.js';
import { EmbedBuilder } from 'discord.js';

/**
 * Cierre de mazmorra e incursión.
 *
 * Lo que se hace aquí es TODO lo que las diferencia de un combate normal. El
 * combate en sí usa el mismo motor, los mismos botones y los mismos
 * telegrafiados: si la mazmorra se jugara con otros controles, nadie la
 * descubriría.
 */

/** Resuelve el estado de una sala y calcula qué se lleva el jugador. */
export function settleRun(
  session: {
    state: BattleState;
    run: { kind: 'mazmorra' | 'incursion'; key: string; bossMaxHp: number } | null;
  },
  trainerId: number,
  won: boolean,
): { digibytes: number; materials: Record<string, number>; finished: boolean; ratio: number; label: string } {
  const { state, run } = session;
  const damage = state.enemy.boss?.damageTaken ?? 0;

  if (!run) {
    return { digibytes: 0, materials: {}, finished: false, ratio: 0, label: '' };
  }

  if (run.kind === 'incursion') {
    if (!won || damage <= 0) {
      return { digibytes: 0, materials: {}, finished: false, ratio: 0, label: '' };
    }

    const boss = worldBossState();
    const result = damageWorldBossBy(trainerId, damage);

    // Paga por daño hecho: contra un jefe global lo que vale es lo que quitas.
    const digibytes = Math.round(damage * 0.4);
    const label = result.defeated
      ? `🏆 **¡Has abatido a ${boss.name}!**`
      : `🌐 **${damage}** de daño a la vida global (${Math.round(result.contribution * 100)}% del total).`;

    return {
      digibytes,
      materials: {},
      finished: result.defeated,
      ratio: result.contribution,
      label,
    };
  }

  if (!won) {
    // Derrota: NO se toca el progreso de las salas ya superadas. Es el
    // contrato con el jugador y por eso vive en el repositorio, no aquí.
    saveBattleResult(trainerId, false);
    return { digibytes: 0, materials: {}, finished: false, ratio: 0, label: '💀 Derrota.' };
  }

  saveBattleResult(trainerId, true);
  const outcome = clearRoom(trainerId, run.key, damage, run.bossMaxHp);

  // EXP por las salas normales: la mazmorra no puede ser solo el jefe.
  if (!outcome.finished) {
    for (const digimon of state.party) {
      grantExp(digimon, Math.round(40 + damage * 0.2), makePersister());
    }
  }

  if (!outcome.finished) {
    return {
      digibytes: 0,
      materials: {},
      finished: false,
      ratio: outcome.ratio,
      label: `✅ Sala superada. Va **${outcome.run.dungeon.rooms.length - outcome.run.roomIndex}** por delante.`,
    };
  }

  const reward = dungeonReward(
    trainerId,
    getDungeon(run.key)!,
    outcome.run.roomsCleared,
    damage,
    run.bossMaxHp,
  );

  const materials: Record<string, number> = {};
  for (const [key, quantity] of Object.entries(reward.materials)) materials[key] = quantity;

  const bonus = reward.firstClear ? ' · **primera pasada**' : '';
  return {
    digibytes: reward.digibytes,
    materials,
    finished: true,
    ratio: reward.ratio,
    label:
      `🏁 **Mazmorra completada** — ${reward.tier.emoji} ${reward.tier.name} ` +
      `(${Math.round(reward.ratio * 100)}% del jefe)${bonus}.`,
  };
}

/** Embed de resumen al terminar una sala. */
export function runSummaryEmbed(
  run: { kind: 'mazmorra' | 'incursion'; key: string; roomName: string },
  reward: { digibytes: number; materials: Record<string, number>; label: string },
  nextRoomName: string | null,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(COLORS.legendary)
    .setTitle(reward.label || 'Sala terminada')
    .setDescription(reward.label ? '' : run.roomName);

  const lines: string[] = [];
  if (reward.digibytes > 0) lines.push(`💰 **+${reward.digibytes}** DigiBytes`);

  for (const [key, quantity] of Object.entries(reward.materials)) {
    const item = getItem(key);
    lines.push(`${item?.emoji ?? '📦'} **+${quantity}** ${item?.name ?? key}`);
  }

  if (lines.length > 0) embed.addFields({ name: 'Recompensa', value: lines.join('\n') });

  if (nextRoomName) {
    embed.addFields({
      name: 'Siguiente sala',
      value: `**${nextRoomName}**\nUsa \`/mazmorra entrar\` para continuar.`,
    });
  }

  return embed;
}

// ------------------------------------------------------- construcción salas ---

export interface BuiltRoom {
  state: BattleState;
  bossMaxHp: number;
  isFinalRoom: boolean;
}

/**
 * Monta el combate de una sala.
 *
 * El nivel del rival se ancla al equipo del jugador con un margen del 5%: una
 * sala tiene que ser un reto, ni un paseo ni una matanza.
 */
export function buildRoomState(party: ReturnType<typeof listParty>, room: RoomDef): BuiltRoom | { error: string } {
  const lead = party[0]!;
  const level = Math.max(6, Math.round(lead.level * 0.95));

  if (room.kind === 'jefe') {
    if (!room.boss) return { error: `La sala "${room.name}" no declara jefe` };

    const def = getBoss(room.boss);
    if (!def) return { error: `Jefe no encontrado: ${room.boss}` };

    // El jefe se escala con el equipo: un jugador de 40 y otro de 70 no deben
    // enfrentarse al mismo numero exacto de PV.
    const scaled = { ...def, level: Math.max(def.level, level + 2) };

    const state = createTrainerBattle(party, 0, {
      trainerName: room.name,
      intro: def.lore,
      team: [],
      bossDef: scaled,
      boss: true,
      inventory: {},
    });

    state.isBoss = true;
    state.enemyIntro = def.lore;
    state.rewardMultiplier = 3;

    // El jefe lo construye la propia fábrica a partir de `bossDef`, así que se
    // lee de aquí en vez de construirse otra vez: si se hiciera por separado,
    // el PV del jefe de la mazmorra y el del combate serian dos objetos
    // distintos y la contribución se contaría sobre el equivocado.
    const jefe = state.enemy;

    state.log = [
      `🕯️ **${room.name}**`,
      `${jefe.emoji} **${jefe.name}** bloquea el paso.`,
      `*"${def.lore}"*`,
    ];

    return { state, bossMaxHp: jefe.stats.hp, isFinalRoom: true };
  }

  // Las salas referencian plantillas por CLAVE (`veterano_hielo`), no por
  // nombre. Buscar por nombre devolvia undefined y la sala no se podia jugar.
  const template = room.trainer ? getTutorTemplate(room.trainer) : undefined;
  if (room.trainer && !template) return { error: `Entrenador no encontrado: ${room.trainer}` };

  let opponent: OpponentSpec;
  let rewardBonus: number;

  if (template) {
    const scale = Math.max(0.5, Math.min(1.6, lead.level / Math.max(1, templateLevel(template))));
    opponent = {
      team: template.team.map((member) => ({
        species: getSpecies(member.speciesKey)!,
        level: Math.max(1, Math.round(member.level * scale)),
      })),
      trainerName: template.name,
      intro: template.intro,
      boss: false,
      inventory: getInventory(0),
    };
    rewardBonus = template.rewardBonus;
  } else {
    const wild = rollEncounter(level, rng);
    if (!wild.species) return { error: 'No se encontraron salvajes para esta sala' };
    opponent = {
      team: [{ species: wild.species, level }],
      trainerName: null,
      intro: null,
      boss: false,
      inventory: getInventory(0),
    };
    rewardBonus = 1.4;
  }

  const state = createTrainerBattle(party, 0, opponent);
  state.rewardMultiplier = rewardBonus;
  state.log.unshift(`🕯️ **${room.name}** — ${room.description}`);

  return { state, bossMaxHp: state.enemy.stats.hp, isFinalRoom: false };
}

/** Monta el combate contra el jefe global. */
export function buildRaidState(
  party: ReturnType<typeof listParty>,
  trainerId: number,
): { state: BattleState; bossMaxHp: number } | { error: string } {
  const boss = worldBossState();
  const def = getBoss(boss.bossKey);
  if (!def) return { error: 'No hay incursión activa' };

  // Contra el jefe global el nivel se TOPA: un solo mega no puede acaparar la
  // vida compartida, y el punto de la incursión es que todos peleen al mismo
  // enemigo al mismo nivel.
  const lead = party[0]!;
  const capped = Math.min(lead.level, 60);
  const scaled = { ...def, level: Math.max(def.level, capped) };

  const state = createTrainerBattle(party, 0, {
    trainerName: 'Incursión global',
    intro: def.lore,
    team: [],
    bossDef: scaled,
    boss: true,
    inventory: getInventory(trainerId),
  });

  state.isBoss = true;
  state.rewardMultiplier = 1;
  state.log = [
    `🌐 **Incursión global** — ${def.emoji} ${def.name}`,
    `*"${def.lore}"*`,
    'Cada golpe que metas va a la misma vida que la de todos los demás.',
  ];

  return { state, bossMaxHp: state.enemy.stats.hp };
}

// ------------------------------------------------------------- validación ----

/**
 * Comprueba si un entrenador puede entrar hoy, y por qué no.
 *
 * La energía se mira con el precio de la mazmorra, no con la del jugador: el
 * mensaje tiene que decir el número que falta, no "no tienes energía".
 */
export function entryBlocker(
  trainerId: number,
  dungeonKey: string,
  level: number,
): { ok: true } | { ok: false; reason: 'no-existe' | 'nivel' | 'energia' | 'intentos'; message: string } {
  const dungeon = getDungeon(dungeonKey);
  if (!dungeon) return { ok: false, reason: 'no-existe', message: 'Esa mazmorra no existe.' };

  if (level < dungeon.minLevel) {
    return {
      ok: false,
      reason: 'nivel',
      message: `${dungeon.name} pide nivel ${dungeon.minLevel} y tu máximo es ${level}.`,
    };
  }

  const energy = energyOf(trainerId);
  if (energy.energy < dungeon.energyCost) {
    return {
      ok: false,
      reason: 'energia',
      message: `Te falta energía: tienes ${energy.energy} y ${dungeon.name} cuesta ${dungeon.energyCost}.`,
    };
  }

  const started = startRun(trainerId, dungeonKey);
  if (!started.ok) {
    if (started.reason === 'terminada') return { ok: true };
    return { ok: false, reason: started.reason, message: started.message };
  }

  const run = runOf(trainerId, dungeonKey);
  if (!run) return { ok: false, reason: 'no-existe', message: 'No se pudo leer la partida.' };

  return { ok: true };
}

