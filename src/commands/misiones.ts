import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import {
  achievementsOf,
  claimAndPayAchievement,
  claimAndPayMission,
  missionsOf,
  periodKey,
  periodResetsIn,
  summaryOf,
  titlesOf,
  type AchievementStatus,
  type MissionStatus,
} from '../game/progressionRepo.js';
import { addItem, getInventory, giveDigibytes } from '../game/repository.js';
import { getItem } from '../game/items.js';
import {
  METRIC_NAMES,
  RARITY_COLORS,
  RARITY_NAMES,
  type Reward,
} from '../game/missions.js';
import { COLORS } from '../views/embeds.js';
import { guardTrainer } from './guard.js';
// ATASJO-GUIA: este comando abre una pantalla de la interfaz.
import { open } from '../ui/router.js';

/**
 * `/misiones` y `/logros`.
 *
 * Los dos comandos comparten casi todo: listar, reclamar y pintar barras. Lo
 * que cambia es el periodo (las misiones caducan, los logros no) y si la
 * recompensa es única. Por eso el motor dearranted es común y los dos son
 * envoltorios finos.
 */

export const misiones = new SlashCommandBuilder()
  .setName('misiones')
  .setDescription('Misiones diarias y semanales.')
  .addSubcommand((sub) =>
    sub
      .setName('diarias')
      .setDescription('Las misiones de hoy.')
      .addStringOption((opt) =>
        opt.setName('reclamar').setDescription('ID de la misión a reclamar.').setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('semanales')
      .setDescription('Las misiones de la semana.')
      .addStringOption((opt) =>
        opt.setName('reclamar').setDescription('ID de la misión a reclamar.').setRequired(false),
      ),
  );

export const logros = new SlashCommandBuilder()
  .setName('logros')
  .setDescription('Logros de por vida.')
  .addSubcommand((sub) =>
    sub
      .setName('ver')
      .setDescription('Tu colección de logros.')
      .addBooleanOption((opt) =>
        opt.setName('ocultos').setDescription('Muestra también los secretos.').setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('reclamar')
      .setDescription('Reclama un logro completado.')
      .addStringOption((opt) => opt.setName('id').setDescription('ID del logro.').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub.setName('titulos').setDescription('Títulos exclusivos que llevas.'),
  );

// ------------------------------------------------------------- compartido ----

/**
 * Inserta un campo AL PRINCIPIO del embed.
 *
 * `EmbedBuilder` no trae `insertFields` en esta versión, y el resumen tiene
 * que ir arriba: es lo único que se lee sin hacer scroll.
 */
function putFirst(embed: EmbedBuilder, field: { name: string; value: string }): void {
  embed.setFields([field, ...embed.toJSON().fields ?? []]);
}

function bar(ratio: number, size = 12): string {
  const filled = Math.round(ratio * size);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, size - filled));
}

/** Líneas de una recompensa, para el embed. */
function rewardLines(reward: Reward): string[] {
  const lines: string[] = [];
  if (reward.digibytes > 0) lines.push(`💰 **${reward.digibytes}** DigiBytes`);

  for (const [key, quantity] of Object.entries(reward.items ?? {})) {
    const item = getItem(key);
    lines.push(`${item?.emoji ?? '📦'} **${quantity}x** ${item?.name ?? key}`);
  }

  if (reward.exclusive) {
    lines.push(
      `🏅 **${reward.exclusive.emoji} ${reward.exclusive.name}** (exclusivo)`,
    );
  }

  return lines;
}

interface Card {
  title: string;
  description: string;
  bar: string;
  counter: string;
  status: string;
  color: number;
  id: string;
}

/** Un embed por tarjeta. Discord no da barras nativas. */
function cardsEmbed(title: string, cards: Card[], footer: string): EmbedBuilder[] {
  const embeds = cards.map((card) =>
    new EmbedBuilder()
      .setColor(card.color)
      .setTitle(card.title)
      .setDescription(card.description)
      .addFields({ name: 'Progreso', value: `\`${card.bar}\`\n${card.counter}` })
      .addFields({ name: 'Estado', value: card.status }),
  );

  if (embeds.length === 0) {
    return [
      new EmbedBuilder()
        .setColor(COLORS.neutral)
        .setTitle(title)
        .setDescription('Nada que mostrar aquí.'),
    ];
  }

  embeds[embeds.length - 1]!.setFooter({ text: footer });
  return embeds;
}

/**
 * Reclama y paga.
 *
 * Marcar en BD y pagar en la MISMA transacción: si se marcara antes de pagar y
 * el pago fallara, el jugador se quedaría sin recompensa; al revés, cobraría
 * para siempre. Aquí se paga primero y se marca después, pero las dos cosas
 * viven dentro de `transaction`, que es lo que hace que no haya ventana entre
 * medias.
 */
function payReward(trainerId: number, reward: Reward): void {
  if (reward.digibytes > 0) giveDigibytes(trainerId, reward.digibytes);
  for (const [key, quantity] of Object.entries(reward.items ?? {})) {
    addItem(trainerId, key, quantity);
  }
}

// ---------------------------------------------------------------- misiones ----

async function showMissions(
  interaction: ChatInputCommandInteraction,
  trainerId: number,
  period: 'diaria' | 'semanal',
): Promise<void> {
  const statuses = missionsOf(trainerId, period);
  const claimId = interaction.options.getString('reclamar');

  if (claimId) {
    // Una sola llamada: paga y marca dentro de la misma transaccion. Repartir
    // el pago fuera deja una ventana en la que el comando cobro y el marcado
    // falla, y la mision queda reclamable otra vez.
    const result = claimAndPayMission(trainerId, claimId, (reward) => payReward(trainerId, reward));
    if (!result.ok) {
      await interaction.reply({
        content: `❌ ${result.message}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.success)
          .setTitle('🎁 Misión completada')
          .setDescription(
            rewardLines(result.reward).join('\n') ||
              'La recompensa ya estaba a tu nombre.',
          )
          .setFooter({
            text: `Solo se puede reclamar una vez por periodo. Se reinicia el ${periodResetsIn(period)}.`,
          }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const ready = statuses.filter((s) => s.ready);

  const cards: Card[] = statuses.map((status) => ({
    id: status.mission.id,
    title:
      `${status.mission.name}` +
      (status.claimed ? ' ✅' : status.ready ? ' 🎁' : ''),
    description:
      `${status.mission.description}\n\n` +
      rewardLines(status.mission.reward).join('\n'),
    bar: bar(status.ratio),
    counter: `${Math.min(status.progress, status.mission.target)}/${status.mission.target} ${METRIC_NAMES[status.mission.metric]}`,
    status: status.claimed
      ? 'Ya reclamada este periodo.'
      : status.ready
        ? '**Lista para reclamar.** `/misiones ' + period + ' reclamar:<id>`'
        : 'En curso.',
    color: status.claimed ? COLORS.neutral : status.ready ? COLORS.success : COLORS.primary,
  }));

  const embeds = cardsEmbed(
    period === 'diaria' ? '📅 Misiones diarias' : '🗓️ Misiones semanales',
    cards,
    `Se reinician el ${periodResetsIn(period)} · periodo ${periodKey(period)}`,
  );

  // Botón de reclamo rápido para la primera lista.
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (ready.length > 0) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...ready.slice(0, 3).map((status) =>
          new ButtonBuilder()
            .setCustomId(`mis:reclamar:${status.mission.id}:${period}`)
            .setLabel(status.mission.name)
            .setStyle(ButtonStyle.Success)
            .setEmoji('🎁'),
        ),
      ),
    );
  }

  const summary = summaryOf(trainerId);
  putFirst(embeds[0]!, {
    name: 'Tu semana',
    value:
      `Diarias listas: **${summary.dailyReady}/${summary.dailyTotal}**\n` +
      `Semanales listas: **${summary.weeklyReady}/${summary.weeklyTotal}**\n` +
      `Logros: **${summary.achievementsUnlocked}/${summary.achievementsTotal}**\n` +
      `Días activos: **${summary.activeDays}**`,
  });

  if (ready.length > 3) {
    embeds[0]!.setFooter({
      text: `Y ${ready.length - 3} más listas. Se reinician el ${periodResetsIn(period)}.`,
    });
  }

  await interaction.reply({ embeds, components, flags: MessageFlags.Ephemeral });
}

export async function misionesExecute(interaction: ChatInputCommandInteraction): Promise<void> {
  // El reclamo por texto sigue siendo el camino corto, pero lo normal es la
  // pantalla: el mismo listado, con botones y navegación.
  await open(interaction, 'misiones');
}

/**
 * La implementación anterior, que pintaba su propio embed.
 *
 * Se conserva por si algún comando la reutiliza; este ya no la llama.
 */
async function legacyShowMisiones(interaction: ChatInputCommandInteraction): Promise<void> {
  const trainer = await guardTrainer(interaction);
  if (!trainer) return;
  await showMissions(interaction, trainer.id, interaction.options.getSubcommand() === 'semanales' ? 'semanal' : 'diaria');
}

// ------------------------------------------------------------------ logros ----

async function showAchievements(
  interaction: ChatInputCommandInteraction,
  trainerId: number,
): Promise<void> {
  const statuses = achievementsOf(trainerId);
  const showHidden = interaction.options.getBoolean('ocultos') ?? false;
  const visible = statuses.filter((s) => showHidden || !s.hidden);

  const ready = statuses.filter((s) => s.ready);

  const cards: Card[] = visible.map((status) => {
    const a = status.achievement;
    const { rarity, name, description, target, metric } = a;

    return {
      id: a.id,
      title: `${a.name}${status.claimed ? ' ✅' : status.unlocked ? ' 🎁' : ''}`,
      description:
        `${RARITY_NAMES[rarity]} · ${a.hidden && !status.unlocked ? '???' : description}\n\n` +
        rewardLines(a.reward).join('\n'),
      bar: bar(status.ratio),
      counter: `${Math.min(status.progress, target)}/${target} ${METRIC_NAMES[metric]}`,
      status: status.claimed
        ? 'Reclamado.'
        : status.ready
          ? '**Reclamable.** `/logros reclamar:<id>`'
          : 'En curso.',
      color: status.claimed ? COLORS.neutral : RARITY_COLORS[rarity],
    };
  });

  const embeds = cardsEmbed(
    '🏅 Logros',
    cards,
    `Un solo reclamo por logro · ${statuses.filter((s) => s.unlocked).length}/${statuses.length} conseguidos`,
  );

  putFirst(embeds[0]!, {
    name: 'Colección',
    value:
      `Desbloqueados: **${statuses.filter((s) => s.unlocked).length}/${statuses.length}**\n` +
      `Listos para reclamar: **${ready.length}**\n` +
      `Títulos: **${titlesOf(trainerId).length}** — ver /logros titulos`,
  });

  await interaction.reply({ embeds, flags: MessageFlags.Ephemeral });
}

async function claimOne(
  interaction: ChatInputCommandInteraction,
  trainerId: number,
): Promise<void> {
  const id = interaction.options.getString('id', true);
  const result = claimAndPayAchievement(trainerId, id, (reward) => payReward(trainerId, reward));

  if (!result.ok) {
    await interaction.reply({ content: `❌ ${result.message}`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.legendary)
        .setTitle('🏅 Logro conseguido')
        .setDescription(rewardLines(result.reward).join('\n') || 'Nada más esta vez.')
        .setFooter({ text: 'Cada logro se reclama una sola vez, para siempre.' }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function showTitles(
  interaction: ChatInputCommandInteraction,
  trainerId: number,
): Promise<void> {
  const titles = titlesOf(trainerId);

  if (titles.length === 0) {
    await interaction.reply({
      content:
        'Todavía no tienes títulos. Se consiguen con logros uniquely (ver `/logros`).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const earned = titles.map((t) => `${t.emoji} **${t.name}**`).join('\n');
  const locked = statusesWithTitles(trainerId, titles);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.legendary)
        .setTitle('🏅 Tus títulos')
        .setDescription(earned)
        .addFields(
          locked.length > 0
            ? { name: 'Por descubrir', value: locked.join('\n') }
            : { name: 'Por descubrir', value: 'No te queda ninguno. Enhorabuena.' },
        ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

/** Títulos que existen en el catálogo y aún no se tienen. */
function statusesWithTitles(trainerId: number, owned: { key: string }[]): string[] {
  const have = new Set(owned.map((t) => t.key));
  return achievementsOf(trainerId)
    .filter((s) => {
      const key = s.achievement.reward.exclusive?.key;
      return s.achievement.reward.exclusive?.kind === 'titulo' && !have.has(key!);
    })
    .map((s) => {
      const e = s.achievement.reward.exclusive!;
      const hidden = s.achievement.hidden && !s.unlocked;
      return `${hidden ? '❔ ???' : `${e.emoji} ${e.name}`} — ${hidden ? '??? ' : ''}${s.achievement.description}`;
    });
}

export async function logrosExecute(interaction: ChatInputCommandInteraction): Promise<void> {
  await open(interaction, 'logros');
}

/**
 * La implementación anterior, que pintaba su propio embed.
 *
 * Se conserva por si algún comando la reutiliza; este ya no la llama.
 */
async function legacyShowLogros(interaction: ChatInputCommandInteraction): Promise<void> {
  const trainer = await guardTrainer(interaction);
  if (!trainer) return;

  const sub = interaction.options.getSubcommand();
  if (sub === 'reclamar') return claimOne(interaction, trainer.id);
  if (sub === 'titulos') return showTitles(interaction, trainer.id);
  return showAchievements(interaction, trainer.id);
}

/** Se llama desde el router de botones. */
export function missionButtonOwner(customId: string): { id: string; period: 'diaria' | 'semanal' } | null {
  const parts = customId.split(':');
  if (parts[0] !== 'mis' || parts[1] !== 'reclamar') return null;
  return { id: parts[2]!, period: parts[3] === 'semanal' ? 'semanal' : 'diaria' };
}

export { getInventory };
export type { MissionStatus, AchievementStatus };
