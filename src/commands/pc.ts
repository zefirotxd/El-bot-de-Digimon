import {
  ChatInputCommandInteraction,
  EmbedBuilder,
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
  withdrawFromPC,
} from '../game/repository.js';
import { config } from '../config.js';
import { hasActiveSession } from '../services/battleSession.js';
import { pcLine } from '../views/digivice.js';
import { COLORS } from '../views/embeds.js';
import { guardTrainer } from './guard.js';
// ATASJO-GUIA: este comando abre una pantalla de la interfaz.
import { open } from '../ui/router.js';

export const data = new SlashCommandBuilder()
  .setName('pc')
  .setDescription('Gestiona el PC: guarda y saca Digimon del equipo activo.')
  .addSubcommand((sub) =>
    sub.setName('ver').setDescription('Muestra qué hay en el equipo y en el PC.'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('guardar')
      .setDescription('Manda un Digimon de tu equipo al PC.')
      .addIntegerOption((opt) =>
        opt.setName('id').setDescription('ID del Digimon (lo ves en /equipo ver).').setMinValue(1).setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('sacar')
      .setDescription('Saca un Digimon del PC al equipo activo.')
      .addIntegerOption((opt) =>
        opt.setName('id').setDescription('ID del Digimon depositado.').setMinValue(1).setRequired(true),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await open(interaction, 'pc');
}

/**
 * La implementación anterior, que pintaba su propio embed.
 *
 * Se conserva por si otro comando la reutiliza; este ya no la llama.
 */
async function legacyExecute(interaction: ChatInputCommandInteraction): Promise<void> {
  const trainer = await guardTrainer(interaction);
  if (!trainer) return;

  if (hasActiveSession(trainer.id)) {
    await interaction.reply({
      content: '⚠️ No puedes mover Digimon con una batalla en curso.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'ver') return showBoth(interaction, trainer.id);
  if (sub === 'guardar') return store(interaction, trainer.id);
  if (sub === 'sacar') return retrieve(interaction, trainer.id);
}

function capacityEmbed(trainerId: number): EmbedBuilder {
  const party = countPartySlots(trainerId);
  const pc = countPCSlots(trainerId);

  return new EmbedBuilder().setColor(0x4a5568).setTitle('🗄️ PC · Depósito').setDescription(
    '```' +
      `EQUIPO  ${party}/${config.maxPartySize}  ${'█'.repeat(party)}${'░'.repeat(Math.max(0, config.maxPartySize - party))}` +
      `\nPC      ${pc}/${config.pcCapacity}  ${'█'.repeat(Math.min(20, Math.floor(pc / 10)))}${'░'.repeat(Math.max(0, 20 - Math.floor(pc / 10)))}` +
      '```',
  );
}

async function showBoth(interaction: ChatInputCommandInteraction, trainerId: number): Promise<void> {
  const party = listParty(trainerId);
  const stored = listPC(trainerId);
  const leader = getLeader(trainerId);

  const embed = capacityEmbed(trainerId)
    .addFields({
      name: `Equipo activo (${party.length})`,
      value:
        party
          .map((d, i) => `${i === 0 ? '⭐' : '　'} ${pcLine(d, i)}`)
          .join('\n') || '_Vacío._',
    })
    .addFields({
      name: `En el PC (${stored.length})`,
      value:
        stored
          .slice(0, 25)
          .map((d, i) => `🗄️ ${pcLine(d, i)}`)
          .join('\n') || '_El PC está vacío._',
    })
    .setFooter({
      text: leader
        ? `Líder: ${leader.species.emoji} ${leader.nickname ?? leader.species.name} · /digivice para gestionarlo`
        : '/digivice para gestionar tu equipo',
    });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function store(interaction: ChatInputCommandInteraction, trainerId: number): Promise<void> {
  const digimonId = interaction.options.getInteger('id', true);
  const digimon = getDigimonOwnedBy(trainerId, digimonId);

  if (!digimon) {
    await interaction.reply({
      content: `❌ No tienes ningún Digimon con el ID \`${digimonId}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = depositToPC(trainerId, digimonId);
  const name = digimon.nickname ?? digimon.species.name;

  if (!result.ok) {
    const reason =
      result.reason === 'ultimo'
        ? `⚠️ **${name}** es el último del equipo. No puedes dejarlo sin ningún Digimon activo.`
        : result.reason === 'lleno'
          ? `⚠️ El PC está lleno (${config.pcCapacity}).`
          : `⚠️ **${name}** ya está en el PC.`;

    await interaction.reply({ content: reason, flags: MessageFlags.Ephemeral });
    return;
  }

  const newLeader = getLeader(trainerId);
  const promoted =
    digimonId === 0 || !newLeader ? '' : `\nNuevo líder: **${newLeader.nickname ?? newLeader.species.name}**`;

  await interaction.reply({
    embeds: [
      capacityEmbed(trainerId).setColor(COLORS.success).setDescription(
        `🗄️ **${name}** guardado en el PC.${promoted}`,
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function retrieve(interaction: ChatInputCommandInteraction, trainerId: number): Promise<void> {
  const digimonId = interaction.options.getInteger('id', true);
  const digimon = getDigimonOwnedBy(trainerId, digimonId);

  if (!digimon) {
    await interaction.reply({
      content: `❌ No tienes ningún Digimon con el ID \`${digimonId}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = withdrawFromPC(trainerId, digimonId);
  const name = digimon.nickname ?? digimon.species.name;

  if (!result.ok) {
    const reason =
      result.reason === 'lleno'
        ? `⚠️ El equipo está lleno (${config.maxPartySize}/${config.maxPartySize}). Manda alguno al PC con \`/pc guardar <id>\`.`
        : result.reason === 'ya-ahi'
          ? `⚠️ **${name}** ya está en el equipo activo.`
          : `⚠️ No se pudo sacar **${name}**.`;

    await interaction.reply({ content: reason, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    embeds: [
      capacityEmbed(trainerId).setColor(COLORS.success).setDescription(
        `📤 **${name}** salió del PC y entró en tu equipo.`,
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}
