import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { DUNGEONS, getDungeon } from '../game/dungeons.js';
import {
  DAILY_ENERGY,
  energyOf,
  runOf,
  myContribution,
  worldBossLeaderboard,
  worldBossState,
  clearCount,
} from '../game/dungeonRepo.js';
import { getBoss } from '../game/bosses.js';
import { findTrainer, listParty } from '../game/repository.js';
import { getItem } from '../game/items.js';
import { COLORS } from '../views/embeds.js';
import { startDungeon, startRaid } from '../services/battleSession.js';
import { guardTrainer } from './guard.js';

/**
 * `/mazmorra` — salas encadenadas con jefe al final.
 * `/incursion` — un jefe global con la vida compartida.
 *
 * La recompensa de las dos se escala por daño hecho, no por participar. Es la
 * diferencia entre "un sistema de contenido" y "un sistema que se puede farmear
 * muriendo en la primera sala".
 */

export const mazmorra = new SlashCommandBuilder()
  .setName('mazmorra')
  .setDescription('Mazmorras con salas encadenadas y jefe final.')
  .addSubcommand((sub) => sub.setName('ver').setDescription('Mazmorras disponibles y tu energía.'))
  .addSubcommand((sub) =>
    sub
      .setName('entrar')
      .setDescription('Empieza o continúa la mazmorra.')
      .addStringOption((opt) =>
        opt.setName('mazmorra').setDescription('Cuál quieres hacer.').setRequired(true),
      )
      .addBooleanOption((opt) =>
        opt
          .setName('informacion')
          .setDescription('Solo mira lo que falta, sin entrar.')
          .setRequired(false),
      ),
  );

export const incursion = new SlashCommandBuilder()
  .setName('incursion')
  .setDescription('Incursión global: un jefe con la vida compartida.')
  .addSubcommand((sub) => sub.setName('ver').setDescription('Estado del jefe global.'))
  .addSubcommand((sub) => sub.setName('atacar').setDescription('Golpea al jefe global.'))
  .addSubcommand((sub) =>
    sub.setName('ranking').setDescription('Quién más ha pegado.'),
  )
  .addSubcommand((sub) =>
    sub.setName('mio').setDescription('Tu contribución a la incursión.'),
  );

// --------------------------------------------------------------- mazmorra ---

export async function mazmorraExecute(interaction: ChatInputCommandInteraction): Promise<void> {
  const trainer = await guardTrainer(interaction);
  if (!trainer) return;

  const sub = interaction.options.getSubcommand();
  if (sub === 'ver') return listDungeons(interaction, trainer.id);

  const dungeonKey = interaction.options.getString('mazmorra', true);
  const dungeon = getDungeon(dungeonKey);
  if (!dungeon) {
    await interaction.reply({ content: '❌ Esa mazmorra no existe.', flags: MessageFlags.Ephemeral });
    return;
  }

  const party = listParty(trainer.id);
  const best = party.reduce((max, d) => Math.max(max, d.level), 1);

  if (interaction.options.getBoolean('informacion')) {
    await interaction.reply({
      embeds: [dungeonEmbed(dungeon, trainer.id, best, true)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Aviso previo si no cumple algo: mejor que entrar y que falle con un error.
  const blocker = whyBlocked(trainer.id, dungeon, best);
  if (blocker) {
    await interaction.reply({
      embeds: [dungeonEmbed(dungeon, trainer.id, best, true)],
      content: `⚠️ ${blocker}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await startDungeon(interaction, dungeonKey);
}

/** Motivo por el que no se puede entrar, o null si se puede. */
function whyBlocked(
  trainerId: number,
  dungeon: { key: string; name: string; minLevel: number; energyCost: number },
  bestLevel: number,
): string | null {
  if (bestLevel < dungeon.minLevel) {
    return `Necesitas nivel ${dungeon.minLevel}. Tu Digimon más fuerte es de nivel ${bestLevel}.`;
  }

  const energy = energyOf(trainerId);
  if (energy.energy < dungeon.energyCost) {
    return `Te falta energía: tienes ${energy.energy} y hacen falta ${dungeon.energyCost}.`;
  }

  const run = runOf(trainerId, dungeon.key);
  if (run?.attemptsLeft !== undefined && run.attemptsLeft <= 0) {
    return `Hoy has gastado los ${dungeon.name === '' ? '' : ''}intentos de hoy.`;
  }

  return null;
}

async function listDungeons(interaction: ChatInputCommandInteraction, trainerId: number): Promise<void> {
  const party = listParty(trainerId);
  const best = party.reduce((max, d) => Math.max(max, d.level), 1);
  const energy = energyOf(trainerId);

  const embed = new EmbedBuilder()
    .setColor(COLORS.legendary)
    .setTitle('🗺️ Mazmorras')
    .setDescription(
      `⚡ **${energy.energy}/${energy.max}** energía · se recarga cada día\n` +
        `Tu Digimon más fuerte: **Nv.${best}**\n\n` +
        Object.values(DUNGEONS)
          .map((d) => {
            const run = runOf(trainerId, d.key);
            const done = run?.finished ? ' ✅' : '';
            const locked = best < d.minLevel ? '🔒' : '';
            const progress = run && !run.finished && run.roomsCleared > 0
              ? ` · *sala ${run.roomIndex + 1}/${d.rooms.length}*`
              : '';
            return `${locked} ${d.emoji} **${d.name}**${done}${progress}\n` +
              `   Nv.${d.minLevel}+ · ⚡${d.energyCost} · ${d.dailyAttempts} intentos/día · ${d.rooms.length} salas`;
          })
          .join('\n\n'),
    )
    .setFooter({ text: '/mazmorra entrar mazmorra:<nombre> para empezar' });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/** Ficha de una mazmorra: salas, recompensas y requisitos. */
function dungeonEmbed(
  dungeon: NonNullable<ReturnType<typeof getDungeon>>,
  trainerId: number,
  bestLevel: number,
  showRooms: boolean,
): EmbedBuilder {
  const energy = energyOf(trainerId);
  const run = runOf(trainerId, dungeon.key);

  const embed = new EmbedBuilder()
    .setColor(COLORS.legendary)
    .setTitle(`${dungeon.emoji} ${dungeon.name}`)
    .setDescription(dungeon.lore)
    .addFields(
      {
        name: 'Requisitos',
        value: [
          `Nv.${dungeon.minLevel}+ ${bestLevel >= dungeon.minLevel ? '✅' : `❌ (tú: ${bestLevel})`}`,
          `⚡ ${dungeon.energyCost} energía ${energy.energy >= dungeon.energyCost ? '✅' : `❌ (tú: ${energy.energy})`}`,
          `🎟️ ${dungeon.dailyAttempts} intentos al día`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Recompensa',
        value: [
          `💰 ${dungeon.firstClearDigibytes.toLocaleString('es-ES')} DB (primera pasada)`,
          ...Object.entries(dungeon.materials).map(
            ([key, n]) => `${getItem(key)?.emoji ?? '📦'} ${n}x ${getItem(key)?.name ?? key}`,
          ),
          `*Escala según el daño que hagas al jefe.*`,
        ].join('\n'),
        inline: true,
      },
    );

  if (showRooms) {
    embed.addFields({
      name: `Salas (${dungeon.rooms.length})`,
      value: dungeon.rooms
        .map((room, i) => {
          const done = run && !run.finished && i < run.roomIndex ? '✅' : i === run?.roomIndex && !run.finished ? '▶️' : '　';
          return `${done} **${i + 1}.** ${room.emoji} ${room.name}` +
            (room.kind === 'jefe' ? ' 👑' : room.kind === 'elite' ? '💀' : '');
        })
        .join('\n'),
    });
  }

  if (run?.finished) {
    embed.setFooter({ text: `Completada ${clearCount(trainerId, dungeon.key)} vez(es). Mañana hay otra vuelta.` });
  } else if (run && run.roomsCleared > 0) {
    embed.setFooter({ text: `Tienes la sala ${run.roomIndex + 1} a medias. Continúa con /mazmorra entrar.` });
  }

  return embed;
}

// --------------------------------------------------------------- incursión ---

export async function incursionExecute(interaction: ChatInputCommandInteraction): Promise<void> {
  const trainer = await guardTrainer(interaction);
  if (!trainer) return;

  const sub = interaction.options.getSubcommand();

  if (sub === 'atacar') return startRaid(interaction);
  if (sub === 'ranking') return showRanking(interaction);
  if (sub === 'mio') return showMine(interaction, trainer.id);
  return showBoss(interaction, trainer.id);
}

async function showBoss(interaction: ChatInputCommandInteraction, trainerId: number): Promise<void> {
  const boss = worldBossState();
  const def = getBoss(boss.bossKey);
  if (!def) {
    await interaction.reply({ content: 'No hay incursión activa.', flags: MessageFlags.Ephemeral });
    return;
  }

  const dead = boss.currentHp <= 0 || boss.defeatedBy !== null;
  const mine = myContribution(trainerId);

  const embed = new EmbedBuilder()
    .setColor(dead ? COLORS.neutral : COLORS.legendary)
    .setTitle(`${boss.emoji} ${boss.name} — Incursión global`)
    .setDescription(
      dead
        ? `**Abatido.** ${boss.totalDamage.toLocaleString('es-ES')} de daño acumulado por ${boss.participants} participante(s).`
        : `*"${def.lore}"*\n\n` +
          `**Vida global: ${Math.round(boss.remaining * 100)}%**\n` +
          `\`${boss.currentHp.toLocaleString('es-ES')}\` / \`${boss.maxHp.toLocaleString('es-ES')}\``,
    )
    .addFields(
      {
        name: 'El jefe',
        value: [
          `Nv.${def.level} · ${def.attribute} · hp ×${def.hpScale}`,
          `${def.phases.length} fases: ${def.phases.map((p) => p.name).join(' → ')}`,
          def.telegraph
            ? `⚠️ Ataque anunciado: **${def.telegraph.moveKey}** cada ${def.telegraph.every} turnos`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
        inline: true,
      },
      {
        name: 'Tu participación',
        value: mine
          ? `💥 **${mine.damage.toLocaleString('es-ES')}** de daño\n` +
            `${Math.round((mine.damage / boss.maxHp) * 100)}% de su vida máxima\n` +
            `${mine.hits} golpe(s) · mejor tirada ${mine.bestDamage.toLocaleString('es-ES')}`
          : 'Todavía no has pegado ni un golpe.',
        inline: true,
      },
    )
    .setFooter({
      text: dead
        ? 'La siguiente incursión empieza pronto.'
        : `Termina ${boss.endsAt.slice(0, 10)} · se paga por daño hecho`,
    });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function showRanking(interaction: ChatInputCommandInteraction): Promise<void> {
  const rows = worldBossLeaderboard(10);

  if (rows.length === 0) {
    await interaction.reply({
      content: 'Nadie ha pegado todavía a la incursión.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const body = rows
    .map(
      (row, i) =>
        `${medals[i] ?? `${i + 1}.`} **${row.username}** — ` +
        `${row.damage.toLocaleString('es-ES')} (${Math.round(row.share * 100)}%)`,
    )
    .join('\n');

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.legendary)
        .setTitle('🌐 Contribución a la incursión')
        .setDescription(body),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function showMine(
  interaction: ChatInputCommandInteraction,
  trainerId: number,
): Promise<void> {
  const boss = worldBossState();
  const mine = myContribution(trainerId);

  if (!mine) {
    await interaction.reply({
      content: 'Todavía no has pegado a la incursión. Usa `/incursion atacar`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const share = boss.maxHp > 0 ? Math.min(1, mine.damage / boss.maxHp) : 0;
  const tier =
    share >= 1 ? '🏆 Derribador' : share >= 0.1 ? '💪 Contribuyente' : share > 0 ? '🤝 Participante' : '👀';

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle(`${tier} Tu contribución`)
        .setDescription(
          `💥 **${mine.damage.toLocaleString('es-ES')}** de daño\n` +
            `${Math.round(share * 100)}% de la vida máxima del jefe\n\n` +
            `Premia: **${Math.round(mine.damage * 0.4).toLocaleString('es-ES')}** DigiBytes.`,
        )
        .addFields({
          name: 'Detalle',
          value: `${mine.hits} golpe(s) registrado(s)\nMejor tirada: ${mine.bestDamage.toLocaleString('es-ES')} PV`,
        }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

export { DAILY_ENERGY, findTrainer };
