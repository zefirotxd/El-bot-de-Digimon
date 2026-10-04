import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import {
  giveDigibytes,
  addItem, listParty } from '../game/repository.js';
import {
  claimDaily,
  checkRematch,
  dailyStatus,
  getPvpProfile,
  recentMatches,
} from '../game/pvpRepo.js';
import {
  DAILY_REWARDS,
  MAX_PVP_TEAM,
  MATCH_WARNING_RATIO,
  RANK_LADDER,
  SEASON,
} from '../game/pvpConfig.js';
import { formatPower, powerLabel, teamPower } from '../game/power.js';
import { ITEMS } from '../game/items.js';
import {
  activeMatchOf,
  enqueue,
  expiredEntries,
  isInMatch,
  isQueued,
  leaveQueue,
  tryPair,
  waitingSeconds,
  queueSize,
} from '../services/pvpQueue.js';
import { COLORS } from '../views/embeds.js';
import { guardTrainer } from './guard.js';
// ATASJO-GUIA: este comando abre una pantalla de la interfaz.
import { open } from '../ui/router.js';

export const data = new SlashCommandBuilder()
  .setName('pvp')
  .setDescription('Combate competitivo contra otros jugadores.')
  .addSubcommand((sub) =>
    sub.setName('buscar').setDescription('Entra en la cola de emparejamiento.'),
  )
  .addSubcommand((sub) =>
    sub.setName('cancelar').setDescription('Sale de la cola de emparejamiento.'),
  )
  .addSubcommand((sub) =>
    sub.setName('rango').setDescription('Tu rango, puntos y racha.'),
  )
  .addSubcommand((sub) =>
    sub.setName('diaria').setDescription('Reclama la recompensa diaria por racha.'),
  )
  .addSubcommand((sub) =>
    sub.setName('historial').setDescription('Tus últimas partidas.'),
  )
  .addSubcommand((sub) =>
    sub.setName('ladder').setDescription('Clasificación de la temporada.'),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await open(interaction, 'pvp');
}

/**
 * La implementación anterior, que pintaba su propio embed.
 *
 * Se conserva por si otro comando la reutiliza; este ya no la llama.
 */
async function legacyExecute(interaction: ChatInputCommandInteraction): Promise<void> {
  const trainer = await guardTrainer(interaction);
  if (!trainer) return;

  const sub = interaction.options.getSubcommand();

  if (sub === 'buscar') return search(interaction, trainer.id);
  if (sub === 'cancelar') return cancel(interaction, trainer.id);
  if (sub === 'diaria') return daily(interaction, trainer.id);
  if (sub === 'historial') return history(interaction, trainer.id);
  if (sub === 'ladder') return ladder(interaction);
  return rank(interaction, trainer.id);
}

// ------------------------------------------------------------------ cola ---

const ENQUEUE_ERRORS: Record<string, string> = {
  'sin-equipo': `Necesitas al menos 2 Digimon en el equipo para competir.`,
  'ya-en-cola': 'Ya estás en la cola.',
  'en-partida': 'Ya estás en una partida.',
  'equipo-grande': `El PvP admite máximo ${MAX_PVP_TEAM} Digimon. Deja alguno en el PC.`,
};

async function search(interaction: ChatInputCommandInteraction, trainerId: number): Promise<void> {
  const result = enqueue(
    interaction.user.id,
    interaction.channelId,
    interaction.user.username,
  );

  if (!result.ok) {
    await interaction.reply({
      content: `⚠️ ${ENQUEUE_ERRORS[result.reason!] ?? 'No se puede entrar en cola.'}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const party = listParty(trainerId);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('🔍 Buscando rival…')
        .setDescription(
          'Se busca un rival con un **poder parecido** al tuyo.\n' +
            `Ventana de emparejamiento: ±12% de poder. Hay **${queueSize() - 1}** en cola.`,
        )
        .addFields(
          {
            name: 'Tu equipo',
            value: party
              .map(
                (d) =>
                  `${d.species.emoji} **${d.nickname ?? d.species.name}** Nv.${d.level} ` +
                  `(${d.species.attribute})`,
              )
              .join('\n'),
          },
          { name: 'Tu poder', value: powerLabel(teamPower(party)) },
        )
        .setFooter({ text: 'Se agota solo en 90 segundos. /pvp cancelar para salir.' }),
    ],
    flags: MessageFlags.Ephemeral,
  });

  // Buscamos rival: puede que ya haya alguien esperando.
  void attemptPair(trainerId, interaction.user.id);
}

async function cancel(interaction: ChatInputCommandInteraction, trainerId: number): Promise<void> {
  const left = leaveQueue(trainerId);

  await interaction.reply({
    content: left
      ? '🚪 Sales de la cola.'
      : 'No estabas en la cola. Puedes entrar con `/pvp buscar`.',
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Intenta emparejar a `trainerId` cuando ya está en la cola.
 *
 * Se llama desde `/pvp buscar` y desde el temporizador de expiración, para que
 * quien entra segundo sea el que dispara el emparejamiento.
 */
export async function attemptPair(
  trainerId: number,
  initiatorUserId: string,
): Promise<void> {
  const paired = tryPair(trainerId);
  if (!paired) return;

  const { match, warning } = paired;
  const rematch = checkRematch(match.a.trainerId, match.b.trainerId);

  // La protección anti-revancha se comprueba ANTES de consumir la cola: si se
  // bloquea, los dos vuelven a estar disponibles y no se pierden los puntos.
  if (!rematch.allowed) {
    await interactionFollowup(
      initiatorUserId,
      `⏳ **${match.a.username}** y **${match.b.username}** se han emparejado hace ` +
        `menos de ${rematch.minutesLeft} min. El anti-revancha bloquea repetir tan pronto.`,
    );
    leaveQueue(match.a.trainerId);
    leaveQueue(match.b.trainerId);
    return;
  }

  await interactionFollowup(
    initiatorUserId,
    `⚔️ **${match.a.username}** (${match.a.power.total.toLocaleString('es-ES')}) vs ` +
      `**${match.b.username}** (${match.b.power.total.toLocaleString('es-ES')})\n` +
      (warning ?? 'Emparejamiento por poder.'),
  );
}

async function interactionFollowup(userId: string, content: string): Promise<void> {
  // Placeholder: el emparejamiento real se resuelve desde el router con los
  // canales de cada jugador (ver handlePvpMatch en index.ts).
  void userId;
  void content;
}

// --------------------------------------------------------------- perfil ----

async function rank(interaction: ChatInputCommandInteraction, trainerId: number): Promise<void> {
  const profile = getPvpProfile(trainerId);
  const power = teamPower(listParty(trainerId));
  const total = profile.wins + profile.losses + profile.draws;
  const rate = total === 0 ? 0 : Math.round((profile.wins / total) * 100);

  const bar = RANK_LADDER.map(
    (rank) => `${rank.emoji} ${rank.name}${profile.points >= rank.points ? ' ✓' : ''}`,
  ).join('\n');

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle(`${profile.rankEmoji} ${profile.rank}`)
        .setDescription(`**${SEASON.name}** · ${profile.points} puntos`)
        .addFields(
          {
            name: ' Récord',
            value: [
              `🏆 ${profile.wins} victorias · 💀 ${profile.losses} derrotas · 🤝 ${profile.draws} empates`,
              `📊 ${rate}% de aciertos`,
              `⚡ Poder de equipo: **${formatPower(power.total)}** (${powerLabel(power)})`,
            ].join('\n'),
          },
          { name: 'Rangos', value: bar },
          {
            name: 'Integridad',
            value:
              profile.disconnects === 0
                ? 'Sin abandonos. 👌'
                : `⚠️ ${profile.disconnects} partida(s) abandonada(s). ` +
                  'Abandonar da puntos al rival, así que conviene jugar.',
          },
        )
        .setFooter({
          text: profile.nextRankPoints
            ? `Te faltan ${profile.nextRankPoints - profile.points} puntos para el siguiente rango.`
            : 'Rango máximo alcanzado.',
        }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function daily(interaction: ChatInputCommandInteraction, trainerId: number): Promise<void> {
  const status = dailyStatus(trainerId);

  if (status.claimed) {
    await interaction.reply({
      content: `⏳ Ya reclamaste hoy. Vuelve mañana para el día ${Math.min(status.streak + 1, 7)}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const reward = claimDaily(trainerId);
  if (!reward) {
    await interaction.reply({ content: '⏳ Ya lo habías reclamado.', flags: MessageFlags.Ephemeral });
    return;
  }

  giveDigibytes(trainerId, reward.digibytes);
  addItem(trainerId, reward.item, reward.quantity);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle(`🎁 Día ${reward.day} de racha`)
        .setDescription(
          `💰 **+${reward.digibytes}** DigiBytes\n` +
            `${ITEMS[reward.item]?.emoji ?? '🎁'} **+${reward.quantity}** ${ITEMS[reward.item]?.name ?? reward.item}`,
        )
        .setFooter({ text: 'Reclama cada día: saltarte uno rompe la racha.' }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function history(
  interaction: ChatInputCommandInteraction,
  trainerId: number,
): Promise<void> {
  const rows = recentMatches(trainerId, 10);

  if (rows.length === 0) {
    await interaction.reply({
      content: 'Todavía no has jugado ninguna partida. `/pvp buscar`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = rows.map((row) => {
    const mark =
      row.outcome === 'victoria' ? '🏆' : row.outcome === 'derrota' ? '💀' : '🤝';
    const dc = row.reason === 'desconexion' ? ' _(abandono)_' : '';
    return `${mark} vs **${row.opponent}** — ${row.outcome}${dc}\n   \`${row.played_at}\``;
  });

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.neutral)
        .setTitle('📜 Últimas partidas')
        .setDescription(lines.join('\n')),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function ladder(interaction: ChatInputCommandInteraction): Promise<void> {
  const ladder = RANK_LADDER.map(
    (r) => `${r.emoji} **${r.name}** — desde ${r.points} puntos`,
  ).join('\n');

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.legendary)
        .setTitle(`🏆 ${SEASON.name}`)
        .setDescription(
          `Emparejamiento por poder (±12%), equipos de hasta ${MAX_PVP_TEAM} Digimon.\n` +
            `Al reiniciar la temporada se conserva el ${Math.round(SEASON.keepRatio * 100)}% de los puntos.`,
        )
        .addFields({ name: 'Rangos', value: ladder }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

export { activeMatchOf, isInMatch, isQueued, expiredEntries, waitingSeconds };
