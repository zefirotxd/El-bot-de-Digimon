import type { ChatInputCommandInteraction } from 'discord.js';
import { findTrainer, type Trainer } from '../game/repository.js';

/**
 * Devuelve el entrenador del usuario o responde con un aviso y devuelve null.
 * Úsalo al principio de cada comando para no repetir el mismo chequeo.
 */
export async function guardTrainer(
  interaction: ChatInputCommandInteraction,
): Promise<Trainer | null> {
  const trainer = findTrainer(interaction.user.id);
  if (!trainer) {
    await interaction.reply({
      content: 'No estás registrado todavía. Usa `/perfil` para elegir tu primer Digimon.',
      ephemeral: true,
    });
    return null;
  }
  return trainer;
}
