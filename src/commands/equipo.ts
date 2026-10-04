import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import {
  countPartySlots,
  countPCSlots,
  depositToPC,
  getDigimonOwnedBy,
  getLeader,
  listParty,
  listPC,
  restTeam,
  setLeader,
} from '../game/repository.js';
import { config } from '../config.js';
import { hasActiveSession } from '../services/battleSession.js';
import { digiviceEmbed, setupEmbed } from '../views/digivice.js';
import { guardTrainer } from './guard.js';
// ATASJO-GUIA: este comando abre una pantalla de la interfaz.
import { open } from '../ui/router.js';

export const data = new SlashCommandBuilder()
  .setName('equipo')
  .setDescription('Gestiona tu plantilla de Digimon.')
  .addSubcommand((sub) =>
    sub
      .setName('ver')
      .setDescription('Muestra tu plantilla y el contenido del PC.')
      .addIntegerOption((opt) =>
        opt
          .setName('id')
          .setDescription('ID del Digimon. Si lo omites verás la lista.')
          .setMinValue(1)
          .setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('lider').setDescription('Elige qué Digimon sale primero en el Digivice.'),
  )
  .addSubcommand((sub) =>
    sub.setName('guardar').setDescription('Manda un Digimon del equipo al PC.'),
  )
  .addSubcommand((sub) =>
    sub.setName('descansar').setDescription('Descansa en la base: todos recuperan sus PV.'),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await open(interaction, 'equipo');
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
  if (sub === 'ver') return showTeam(interaction, trainer.id);
  if (sub === 'lider') return chooseLeader(interaction, trainer.id);
  if (sub === 'guardar') return sendToPC(interaction, trainer.id);
  if (sub === 'descansar') return rest(interaction, trainer.id);
}

async function showTeam(interaction: ChatInputCommandInteraction, trainerId: number): Promise<void> {
  const party = listParty(trainerId);
  const stored = listPC(trainerId);

  if (party.length === 0 && stored.length === 0) {
    await interaction.reply({
      content: 'No tienes ningún Digimon todavía. Usa `/perfil` para empezar.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const id = interaction.options.getInteger('id', false);

  if (id !== null) {
    const digimon = getDigimonOwnedBy(trainerId, id);
    if (!digimon) {
      await interaction.reply({
        content: `No tienes ningún Digimon con el ID \`${id}\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [setupEmbed(digimon, party[0]?.id === digimon.id)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const partyList = party
    .map((d, i) => `${i === 0 ? '⭐' : '　'} ${compact(d)}`)
    .join('\n');
  const pcList = stored
    .slice(0, 15)
    .map((d) => `🗄️ ${compact(d)}`)
    .join('\n');

  await interaction.reply({
    content: [
      `**EQUIPO ACTIVO** · ${party.length}/${config.maxPartySize}  ·  **PC** ${stored.length}/${config.pcCapacity}`,
      partyList || '_Equipo vacío._',
      stored.length > 0 ? `\n**PC**\n${pcList}` : '',
      stored.length > 15 ? `\n_…y ${stored.length - 15} más en el PC._` : '',
      '\n`/equipo ver id:<n>` para la ficha · `/pc guardar|sacar <id>` para moverlos',
    ]
      .filter(Boolean)
      .join('\n'),
    flags: MessageFlags.Ephemeral,
  });

}

function compact(d: ReturnType<typeof listParty>[number]): string {
  return `#${d.id} ${d.species.emoji} **${d.nickname ?? d.species.name}** Nv.${d.level}`;
}

async function chooseLeader(interaction: ChatInputCommandInteraction, trainerId: number): Promise<void> {
  if (hasActiveSession(trainerId)) {
    await interaction.reply({
      content: 'No puedes cambiar el líder con una batalla en curso.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const party = listParty(trainerId);
  const current = getLeader(trainerId);

  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const digimon of party.slice(0, 4)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`dv:lider:${trainerId}:${digimon.id}`)
        .setLabel(digimon.nickname ?? digimon.species.name)
        .setEmoji(digimon.species.emoji)
        .setStyle(
          current?.id === digimon.id ? ButtonStyle.Success : ButtonStyle.Secondary,
        )
        .setDisabled(current?.id === digimon.id)
    );
  }

  await interaction.reply({
    content: 'Elige el **Digimon líder**: es el que sale primero en el Digivice y en combate.',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });

  // Los botones `dv:lider:` los atiende el router global de index.ts.
}

async function sendToPC(interaction: ChatInputCommandInteraction, trainerId: number): Promise<void> {
  const party = listParty(trainerId);

  if (party.length <= 1) {
    await interaction.reply({
      content: '⚠️ Necesitas al menos 2 Digimon en el equipo para guardar alguno.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const digimon of party.slice(0, 4)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`dv:guardar:${trainerId}:${digimon.id}`)
        .setLabel(digimon.nickname ?? digimon.species.name)
        .setEmoji(digimon.species.emoji)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(party[0]!.id === digimon.id)
    );
  }

  await interaction.reply({
    content: 'Elige el Digimon que quieres **guardar en el PC**:',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

async function rest(interaction: ChatInputCommandInteraction, trainerId: number): Promise<void> {
  if (hasActiveSession(trainerId)) {
    await interaction.reply({
      content: 'No puedes descansar con una batalla en curso.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  restTeam(trainerId);

  await interaction.reply({
    embeds: [
      digiviceEmbed(listParty(trainerId)[0] ?? null, listParty(trainerId), countPCSlots(trainerId))
        .setFooter({ text: '🛏️ Tu equipo ha descansado: todos a tope de PV y sin estados.' }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}
