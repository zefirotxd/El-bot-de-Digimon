import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Message,
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
} from 'discord.js';
import {
  countPCSlots,
  countPartySlots,
  depositToPC,
  getDigimonOwnedBy,
  getLeader,
  listPC,
  listParty,
  setLeader,
  withdrawFromPC,
} from '../game/repository.js';
import { config } from '../config.js';
import { hasActiveSession } from '../services/battleSession.js';
import { digiviceEmbed, pcLine, setupEmbed } from '../views/digivice.js';
import { COLORS } from '../views/embeds.js';
import { guardTrainer } from './guard.js';

export const data = new SlashCommandBuilder()
  .setName('digivice')
  .setDescription('Abre tu Digivice: mira tu Digimon líder y gestiona el equipo.');

// ------------------------------------------------------------- /digivice --

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // El Digivice es ahora el hub de la interfaz, no una ficha aparte. El comando
  // sigue existiendo como atajo, pero abre exactamente la misma pantalla que si
  // el jugador hubiera llegado desde el principio.
  const { open } = await import('../ui/router.js');
  await open(interaction, 'hub');
  return;
}

/** @deprecated El hub vive en `ui/screens/hub.ts`. Esto queda por si acaso. */
async function legacyExecute(interaction: ChatInputCommandInteraction): Promise<void> {
  const trainer = await guardTrainer(interaction);
  if (!trainer) return;

  const party = listParty(trainer.id);
  const leader = party[0] ?? null;
  const pcCount = countPCSlots(trainer.id);

  const response = await interaction.reply({
    embeds: [digiviceEmbed(leader, party, pcCount)],
    components: party.length > 0 ? [partyRow(trainer.id, party)] : [pcRow(trainer.id)],
    flags: MessageFlags.Ephemeral,
  });

  const message: Message = 'message' in response
    ? (response.message as Message)
    : await interaction.fetchReply();

  attachDigiviceHandlers(message, interaction.user.id, trainer.id);
}

function partyRow(trainerId: number, party: ReturnType<typeof listParty>): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const digimon of party.slice(0, 4)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`dv:ficha:${trainerId}:${digimon.id}`)
        .setLabel(digimon.nickname ?? digimon.species.name)
        .setEmoji(digimon.species.emoji)
        .setStyle(
          party[0]!.id === digimon.id ? ButtonStyle.Success : ButtonStyle.Secondary,
        )
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`dv:pc:${trainerId}`)
      .setLabel('PC')
      .setEmoji('🗄️')
      .setStyle(ButtonStyle.Primary),
  );
  return row;
}

function pcRow(trainerId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`dv:pc:${trainerId}`)
      .setLabel('Abrir PC')
      .setEmoji('🗄️')
      .setStyle(ButtonStyle.Primary),
  );
}

function attachDigiviceHandlers(
  message: Message,
  userId: string,
  trainerId: number,
): void {
  const collector = message.createMessageComponentCollector({
    filter: (i) => i.isButton() && i.user.id === userId,
    time: 120_000,
  });

  collector.on('collect', async (i) => {
    const button = i as ButtonInteraction;
    if (!button.customId.startsWith('dv:')) return;

    try {
      const action = button.customId.split(':')[1];
      // "ficha" y "pc" se responden desde aqui; el resto va al manejador comun,
      // que tambien lo usan las acciones disparadas desde /equipo.
      if (action === 'ficha') {
        await button.deferUpdate();
        await showSetup(button, trainerId, Number(button.customId.split(':')[3]));
      } else if (action === 'pc') {
        await button.deferUpdate();
        await showPC(button, trainerId);
      } else {
        await handleDigiviceAction(button, trainerId);
      }
    } catch (error) {
      console.error('[digivice] error:', error);
      await button
        .reply({ content: '❌ Algo salió mal.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  });
}

async function showSetup(
  button: ButtonInteraction,
  trainerId: number,
  digimonId: number,
): Promise<void> {
  const digimon = getDigimonOwnedBy(trainerId, digimonId);
  if (!digimon) {
    await button.followUp({
      content: '❌ Ya no tienes ese Digimon.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const party = listParty(trainerId);
  await button.editReply({
    embeds: [setupEmbed(digimon, party[0]?.id === digimon.id)],
    components: [setupRow(trainerId, digimonId, digimon.storage)],
  });
}

function setupRow(trainerId: number, digimonId: number, storage: string): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`dv:inicio:${trainerId}`)
      .setLabel('Volver')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary),
  );

  if (storage === 'party') {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`dv:lider:${trainerId}:${digimonId}`)
        .setLabel('Poner de líder')
        .setEmoji('⭐')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`dv:pc:${trainerId}`)
        .setLabel('PC')
        .setEmoji('🗄️')
        .setStyle(ButtonStyle.Primary),
    );
  } else {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`dv:sacar:${trainerId}:${digimonId}`)
        .setLabel('Sacar al equipo')
        .setEmoji('📤')
        .setStyle(ButtonStyle.Success),
    );
  }

  return row;
}

async function showPC(button: ButtonInteraction, trainerId: number): Promise<void> {
  const stored = listPC(trainerId);
  const party = listParty(trainerId);

  const embed = new EmbedBuilder()
    .setColor(0x4a5568)
    .setTitle('🗄️ PC · Depósito')
    .setDescription(
      '```' +
        `EQUIPO  ${party.length}/${config.maxPartySize}   █${'█'.repeat(party.length)}${'░'.repeat(Math.max(0, config.maxPartySize - party.length))}` +
        `\nPC      ${stored.length}/${config.pcCapacity}` +
        '```',
    )
    .addFields({
      name: `Depositados (${stored.length})`,
      value:
        stored
          .slice(0, 25)
          .map((d, i) => pcLine(d, i))
          .join('\n') || '_El PC está vacío._',
    })
    .setFooter({ text: 'Usa /pc guardar <id> o /pc sacar <id> para mover Digimon.' });

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  if (stored.length > 0) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const digimon of stored.slice(0, 4)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`dv:sacar:${trainerId}:${digimon.id}`)
          .setLabel(digimon.nickname ?? digimon.species.name)
          .setEmoji('📤')
          .setStyle(ButtonStyle.Success)
      );
    }
    rows.push(row);
  }

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`dv:inicio:${trainerId}`)
        .setLabel('Volver')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  await button.editReply({ embeds: [embed], components: rows });
}

/** Reacciona a los botones globales del Digivice desde el router. */
export async function handleDigiviceAction(
  interaction: ButtonInteraction,
  trainerId: number,
): Promise<void> {
  const [, action, , extra] = interaction.customId.split(':');

  if (action === 'inicio') {
    const party = listParty(trainerId);
    await interaction.update({
      embeds: [digiviceEmbed(party[0] ?? null, party, countPCSlots(trainerId))],
      components: [party.length > 0 ? partyRow(trainerId, party) : pcRow(trainerId)],
    });
    return;
  }

  if (action === 'lider') {
    const result = setLeader(trainerId, Number(extra));
    const party = listParty(trainerId);
    const leader = getLeader(trainerId);
    const notice = result.ok
      ? new EmbedBuilder()
          .setColor(COLORS.success)
          .setDescription(`⭐ **${leader?.nickname ?? leader?.species.name}** ahora lidera tu Digivice.`)
      : new EmbedBuilder()
          .setColor(COLORS.warning)
          .setDescription('⚠️ No se pudo cambiar el líder.');

    await interaction.update({
      embeds: [digiviceEmbed(party[0] ?? null, party, countPCSlots(trainerId)), notice],
      components: [partyRow(trainerId, party)],
    });
    return;
  }

  if (action === 'sacar') {
    const result = withdrawFromPC(trainerId, Number(extra));
    const party = listParty(trainerId);

    if (result.ok) {
      const digimon = getDigimonOwnedBy(trainerId, Number(extra));
      await interaction.update({
        embeds: [
          digiviceEmbed(party[0] ?? null, party, countPCSlots(trainerId)),
          new EmbedBuilder()
            .setColor(COLORS.success)
            .setDescription(`📤 **${digimon?.nickname ?? digimon?.species.name}** salió del PC.`),
        ],
        components: [partyRow(trainerId, party)],
      });
    } else {
      await interaction.update({
        embeds: [
          digiviceEmbed(party[0] ?? null, party, countPCSlots(trainerId)),
          new EmbedBuilder()
            .setColor(COLORS.warning)
            .setDescription(
              result.reason === 'lleno'
                ? `⚠️ El equipo está lleno (${config.maxPartySize}). Saca alguno al PC primero.`
                : '⚠️ No se pudo sacar ese Digimon.',
            ),
        ],
        components: [partyRow(trainerId, party)],
      });
    }
    return;
  }

  if (action === 'guardar') {
    const result = depositToPC(trainerId, Number(extra));
    const party = listParty(trainerId);

    const text = result.ok
      ? `🗄️ Guardado en el PC. Quedan ${countPartySlots(trainerId)} en el equipo.`
      : result.reason === 'ultimo'
        ? '⚠️ No puedes guardar al último Digimon del equipo.'
        : '⚠️ No se pudo guardar.';

    await interaction.update({
      embeds: [
        digiviceEmbed(party[0] ?? null, party, countPCSlots(trainerId)),
        new EmbedBuilder()
          .setColor(result.ok ? COLORS.success : COLORS.warning)
          .setDescription(text),
      ],
      components: [party.length > 0 ? partyRow(trainerId, party) : pcRow(trainerId)],
    });
  }
}
