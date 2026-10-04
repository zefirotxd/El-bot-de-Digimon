import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import {
  listWildSpecies, getSpecies, SPECIES, STARTERS } from '../game/species.js';
import {
  findTrainer,
  listParty,
  countPCSlots,
  registerTrainer,
  updateUsername,
} from '../game/repository.js';
import { elementTags, profileEmbed, starterPickerEmbed, COLORS } from '../views/embeds.js';
// ATASJO-GUIA: este comando abre una pantalla de la interfaz.
import { open } from '../ui/router.js';
import { TIER_NAMES } from '../game/progression.js';

export const data = new SlashCommandBuilder()
  .setName('perfil')
  .setDescription('Registra tu entrenador o consulta tu ficha.');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await open(interaction, 'perfil');
}

/**
 * La implementación anterior, que pintaba su propio embed.
 *
 * Se conserva por si otro comando la reutiliza; este ya no la llama.
 */
async function legacyExecute(interaction: ChatInputCommandInteraction): Promise<void> {
  const trainer = findTrainer(interaction.user.id);

  if (!trainer) {
    await interaction.reply({
      embeds: [
        starterPickerEmbed(),
      ],
      components: [starterMenu()],
      ephemeral: true,
    });
    return;
  }

  updateUsername(trainer.id, interaction.user.username);
  const roster = listParty(trainer.id);
  const stored = countPCSlots(trainer.id);
  const embed = profileEmbed(trainer, roster);

  if (stored > 0) {
    embed.addFields({
      name: '🗄️ PC',
      value: `${stored} Digimon depositados.\nUsa \`/pc ver\` para verlos o sacarlos al equipo.`,
    });
  }

  await interaction.reply({ embeds: [embed] });
}

/** Menú de selección de Digimon inicial. */
export function starterMenu() {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('perfil:starter')
      .setPlaceholder('Elige tu primer compañero...')
      .addOptions(
        STARTERS.map((key) => {
          const species = SPECIES[key]!;
          // Con la evolución manual puede haber varias rutas: el resumen dice
          // cuántas, y `/evolucion ver` es donde se eligele.
          const branches = species.evolutions.length;
          return {
            label: species.name,
            description:
              branches > 0
                ? `${branches} ruta(s) de evolución · /evolucion`
                : 'Forma final',
            value: key,
            emoji: species.emoji,
          };
        }),
      ),
  );
}

/** Maneja la selección del menú de inicial. Se invoca desde index.ts. */
export async function handleStarterSelect(
  interaction: import('discord.js').StringSelectMenuInteraction,
  speciesKey: string,
): Promise<void> {
  const species = getSpecies(speciesKey);
  if (!species || !STARTERS.includes(speciesKey)) {
    await interaction.reply({ content: '❌ Opción no válida.', ephemeral: true });
    return;
  }

  const existing = findTrainer(interaction.user.id);
  if (existing) {
    await interaction.reply({
      content: '⚠️ Ya estás registrado. Usa `/perfil` para ver tu ficha.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const trainer = registerTrainer(interaction.user.id, interaction.user.username, species);
  const roster = listParty(trainer.id);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle('🎉 ¡Bienvenido al Archivo Digital!')
        .setDescription(
          `${species.emoji} **${species.name}** ha aceptado la orden y se ha unido a tu equipo.\n\n` +
            'Empieza con `/explorar` para tu primer combate.',
        )
        .setFooter({
          text: `Entrenador #${trainer.id} · ${trainer.digibytes} DigiBytes de regalo`,
        }),
      profileEmbed(trainer, roster),
    ],
    components: [],
  });
}

/** `/descubrir` - bestiario de lo que hay por la zona. */
export const discoverData = new SlashCommandBuilder()
  .setName('descubrir')
  .setDescription('Muestra los Digimon salvajes que te puedes encontrar por la zona.');

export async function discover(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!findTrainer(interaction.user.id)) {
    await interaction.reply({
      content: 'Usa `/perfil` para registrarte primero.',
      ephemeral: true,
    });
    return;
  }
  await interaction.reply({ embeds: [wildListEmbed()] });
}

function wildListEmbed(): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🗺️ Digimon salvajes de la zona')
    .setDescription(
      'Usa `/atacar <nombre>` para desafiar a uno concreto, o `/explorar` para uno aleatorio.\n' +
        '*A menor nivel, más fácil de capturar.*',
    );

  for (const row of listWildSpecies()) {
    const lines = row.species.map(
      (s) =>
        `\`${s.key.padEnd(16)}\` ${s.emoji} **${s.name}** · ${elementTags(s)} · ` +
        `${TIER_NAMES[s.tier]} · 🎯 ${s.catchRate}`,
    );
    embed.addFields({
      name: `Nv. ${row.minLevel} – ${row.maxLevel}`,
      value: lines.join('\n').slice(0, 1024),
    });
  }

  return embed;
}
