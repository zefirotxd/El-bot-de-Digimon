import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getDigimonOwnedBy, listDigimon, saveNickname } from '../game/repository.js';
import { hasActiveSession } from '../services/battleSession.js';
import { guardTrainer } from './guard.js';

export const data = new SlashCommandBuilder()
  .setName('apodo')
  .setDescription('Pónle o quítale el apodo a un Digimon.')
  .addIntegerOption((opt) =>
    opt
      .setName('id')
      .setDescription('ID del Digimon (lo ves en /equipo ver).')
      .setMinValue(1)
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName('nombre')
      .setDescription('Nuevo apodo. Usa "—" para quitárselo.')
      .setMaxLength(24)
      .setRequired(true),
  );

/** Caracteres que rompen el embed o confunden al leer. */
const FORBIDDEN = /[*_`~|>#@[\]\\]/g;

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const trainer = await guardTrainer(interaction);
  if (!trainer) return;

  if (hasActiveSession(trainer.id)) {
    await interaction.reply({
      content: 'No puedes cambiar apodos con una batalla en curso.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const digimonId = interaction.options.getInteger('id', true);
  const raw = interaction.options.getString('nombre', true);

  const digimon = getDigimonOwnedBy(trainer.id, digimonId);
  if (!digimon) {
    await interaction.reply({
      content: `No tienes ningún Digimon con el ID \`${digimonId}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const previous = digimon.nickname ?? digimon.species.name;

  // Quitar apodo.
  if (raw === '—' || raw === '-' || raw === 'ninguno') {
    saveNickname(trainer.id, digimonId, null);
    await interaction.reply({
      content: `**${digimon.species.emoji} ${previous}** vuelve a llamarse ${digimon.species.name}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const nickname = raw.replace(FORBIDDEN, '').trim();

  if (nickname.length === 0) {
    await interaction.reply({
      content: '❌ Ese apodo se queda sin letras tras quitar los símbolos.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (nickname.length < 2) {
    await interaction.reply({
      content: '❌ El apodo necesita al menos 2 letras.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Que no se repitan: si dos se llaman igual, los botones del Digivice
  // dejan de distinguir cuál es cuál.
  const clash = listDigimon(trainer.id).some(
    (d) => d.id !== digimonId && d.nickname?.toLowerCase() === nickname.toLowerCase(),
  );

  if (clash) {
    await interaction.reply({
      content: '❌ Ya tienes otro Digimon con ese apodo. Elige otro para no liar los botones.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  saveNickname(trainer.id, digimonId, nickname);

  await interaction.reply({
    content: `✨ **${previous}** ahora se llama **${digimon.species.emoji} ${nickname}**.`,
    flags: MessageFlags.Ephemeral,
  });
}
