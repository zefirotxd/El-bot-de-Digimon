import {
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
} from 'discord.js';
import { claimAndPayMission, periodResetsIn } from '../game/progressionRepo.js';
import { addItem, findTrainer, giveDigibytes } from '../game/repository.js';
import { getItem } from '../game/items.js';
import { COLORS } from '../views/embeds.js';

/**
 * Botón de reclamo rápido de una misión.
 *
 * Va aparte del comando a propósito: es la única vía por la que se paga con un
 * clic, y por eso necesita su propia comprobación de trainer y su propia
 * respuesta efímera. Si reutilizara el handler del comando, un clic de otra
 * persona podría reclamar en su nombre.
 */
export async function handleMissionClaim(interaction: ButtonInteraction): Promise<void> {
  const trainer = findTrainer(interaction.user.id);
  if (!trainer) {
    await interaction.reply({
      content: 'Usa `/perfil` para registrarte.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const parts = interaction.customId.split(':');
  const missionId = parts[2];
  const period = parts[3] === 'semanal' ? 'semanal' : 'diaria';

  if (!missionId) {
    await interaction.reply({
      content: '❌ Botón de misión no reconocido.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Quitar el botón ANTES de reclamar: si el pago falla, el jugador no quiere
  // un botón que le vuelva a fallar cada vez que lo pulse.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const lines: string[] = [];

  // Pagar y marcar en la MISMA transacción. Aquí es donde importa: un botón se
  // puede pulsar dos veces seguidas por accidente, y sin esto la segunda
  // cobraría otra vez.
  const result = claimAndPayMission(trainer.id, missionId, (reward) => {
    if (reward.digibytes > 0) {
      giveDigibytes(trainer.id, reward.digibytes);
      lines.push(`💰 **+${reward.digibytes}** DigiBytes`);
    }
    for (const [key, quantity] of Object.entries(reward.items ?? {})) {
      addItem(trainer.id, key, quantity);
      const item = getItem(key);
      lines.push(`${item?.emoji ?? '📦'} **+${quantity}x** ${item?.name ?? key}`);
    }
  });

  if (!result.ok) {
    await interaction.editReply({ content: `❌ ${result.message}`, embeds: [], components: [] });
    return;
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle('🎁 Misión completada')
        .setDescription(lines.join('\n') || 'La recompensa ya estaba a tu nombre.')
        .setFooter({
          text: `Se reinicia el ${periodResetsIn(period)}. Esta misión ya no se puede reclamar.`,
        }),
    ],
    components: [],
  });

}
