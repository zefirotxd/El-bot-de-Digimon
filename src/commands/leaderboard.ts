import {
  type ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { db } from '../db/index.js';
import { formatNumber } from '../game/progression.js';
import { COLORS } from '../views/embeds.js';
// ATASJO-GUIA: este comando abre una pantalla de la interfaz.
import { open } from '../ui/router.js';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Clasificación global de entrenadores.')
  .addStringOption((opt) =>
    opt
      .setName('categoria')
      .setDescription('Qué clasificación quieres ver.')
      .addChoices(
        { name: '🏆 Victorias', value: 'victorias' },
        { name: '📈 Nivel total', value: 'nivel' },
        { name: '🐾 Digimon capturados', value: 'coleccion' },
        { name: '💰 Rico', value: 'dineron' },
      )
      .setRequired(false),
  );

interface Row {
  username: string;
  digibytes: number;
  battles_won: number;
  battles_lost: number;
  total_level: number;
  total_digimon: number;
  best_level: number;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await open(interaction, 'lb');
}

/**
 * La implementación anterior, que pintaba su propio embed.
 *
 * Se conserva por si otro comando la reutiliza; este ya no la llama.
 */
async function legacyExecute(
  interaction: import('discord.js').ChatInputCommandInteraction,
): Promise<void> {
  // La clasificación es pública: mirarla no debería exigir estar registrado.
  const category = interaction.options.getString('categoria') ?? 'victorias';

  const orderBy: Record<string, string> = {
    victorias: 'battles_won DESC, battles_lost ASC',
    nivel: 'total_level DESC, best_level DESC',
    coleccion: 'total_digimon DESC, total_level DESC',
    dineron: 'digibytes DESC',
  };

  const rows = db
    .prepare<[], Row>(
      `SELECT t.username,
              t.digibytes,
              t.battles_won,
              t.battles_lost,
              COALESCE(SUM(d.level), 0) AS total_level,
              COUNT(d.id)               AS total_digimon,
              COALESCE(MAX(d.level), 0) AS best_level
         FROM trainers t
         LEFT JOIN digimon d ON d.trainer_id = t.id
        GROUP BY t.id
        ORDER BY ${orderBy[category] ?? orderBy.victorias}
        LIMIT 15`,
    )
    .all();

  if (rows.length === 0) {
    await interaction.reply({
      content: 'Todavía no hay nadie en la clasificación. Sé el primero: `/perfil`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const podium = ['🥇', '🥈', '🥉'];

  const lines = rows.map((row, index) => {
    const rank = podium[index] ?? `\`${String(index + 1).padStart(2)}\``;

    let value: string;
    switch (category) {
      case 'nivel':
        value = `Nv.${formatNumber(row.total_level)} acumulado · mejor Nv.${row.best_level}`;
        break;
      case 'coleccion':
        value = `${row.total_digimon} Digimon`;
        break;
      case 'dineron':
        value = `${formatNumber(row.digibytes)} DB`;
        break;
      default: {
        const total = row.battles_won + row.battles_lost;
        const rate = total === 0 ? 0 : Math.round((row.battles_won / total) * 100);
        value = `${row.battles_won} victorias · ${rate}% de acierto`;
      }
    }

    return `${rank} **${row.username}** · ${value}`;
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🏅 Clasificación global')
    .setDescription(lines.join('\n'))
    .setFooter({
      text: {
        victorias: 'Ordenado por victorias',
        nivel: 'Ordenado por nivel acumulado',
        coleccion: 'Ordenado por Digimon capturados',
        dineron: 'Ordenado por DigiBytes',
      }[category]!,
    });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
