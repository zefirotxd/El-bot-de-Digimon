import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { SPECIES, TIER_NAMES } from '../game/species.js';
import { elementTags } from '../views/embeds.js';
import { MOVES } from '../game/moves.js';
import { ELEMENT_EMOJI } from '../game/elements.js';
import { formatNumber } from '../game/progression.js';
import { getItem } from '../game/items.js';
// ATASJO-GUIA: este comando abre una pantalla de la interfaz.
import { open } from '../ui/router.js';

export const data = new SlashCommandBuilder()
  .setName('pokedex')
  .setDescription('Ficha de una especie de Digimon.')
  .addStringOption((opt) =>
    opt
      .setName('nombre')
      .setDescription('Nombre de la especie (opcional). Sin argumento muestra el índice.')
      .addChoices(
        Object.values(SPECIES)
          .slice(0, 25)
          .map((s) => ({ name: `${s.emoji} ${s.name}`, value: s.key })),
      )
      .setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await open(interaction, 'registro');
}

/**
 * La implementación anterior, que pintaba su propio embed.
 *
 * Se conserva por si otro comando la reutiliza; este ya no la llama.
 */
async function legacyExecute(interaction: ChatInputCommandInteraction): Promise<void> {
  const key = interaction.options.getString('nombre');

  if (!key) return showIndex(interaction);

  const species = SPECIES[key];
  if (!species) {
    await interaction.reply({ content: '❌ Esa especie no existe.', ephemeral: true });
    return;
  }

  const evolutions = species.evolutions.map((route) => {
    const target = SPECIES[route.to];
    const name = target ? `${target.emoji} ${target.name}` : route.to;
    const costs: string[] = [`Nv.${route.level}`];
    if (route.wins !== undefined) costs.push(`${route.wins} vict.`);
    if (route.digibytes !== undefined) costs.push(`${route.digibytes} DB`);
    for (const [itemKey, quantity] of Object.entries(route.items ?? {})) {
      costs.push(`${quantity}x ${getItem(itemKey)?.name ?? itemKey}`);
    }
    return `${route.branch ? '🔀' : '➡️'} **${name}** — ${costs.join(' · ')}`;
  });

  const devolution = species.devolution
    ? `${SPECIES[species.devolution.to]?.emoji ?? ''} ${SPECIES[species.devolution.to]?.name ?? species.devolution.to}` +
      ` (${Object.entries(species.devolution.items)
        .map(([k, n]) => `${n}x ${getItem(k)?.name ?? k}`)
        .join(' + ')})`
    : null;
  const moves = species.learnset.map((moveKey) => {
    const move = MOVES[moveKey];
    if (!move) return null;
    return (
      `${ELEMENT_EMOJI[move.element]} **${move.name}** · ` +
      `${move.category === 'estado' ? 'Estado' : `Pot ${move.power}`} · ${move.energyCost}⚡`
    );
  });

  const embed = new EmbedBuilder()
    .setColor(0x2b6cb0)
    .setTitle(`${species.emoji} ${species.name}`)
    .setDescription(
      `${elementTags(species)}\n**${TIER_NAMES[species.tier]}** · Base PV ${species.base.hp} · ` +
        `ATQ ${species.base.attack} · DEF ${species.base.defense} · VEL ${species.base.speed}\n\n` +
        `*${species.lore}*`,
    )
    .addFields(
      {
        name: 'Evolución',
        value: evolutions.length > 0
          ? evolutions.join('\n') + '\n\n*El nivel desbloquea; no te transforma solo.*'
          : 'Forma final de su línea.',
        inline: true,
      },
      ...(devolution
        ? [{
            name: '↩️ Regresión',
            value: `Vuelve a ${devolution}`,
            inline: true,
          }]
        : []),
      {
        name: 'Captura',
        value: `🎯 ${species.catchRate} (${rarityLabel(species.catchRate)})`,
        inline: true,
      },
      { name: 'Movimientos', value: moves.filter(Boolean).join('\n').slice(0, 1024) },
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function showIndex(interaction: ChatInputCommandInteraction): Promise<void> {
  const byTier = new Map<string, string[]>();
  for (const species of Object.values(SPECIES)) {
    const list = byTier.get(species.tier) ?? [];
    list.push(`${species.emoji} **${species.name}** \`${species.key}\``);
    byTier.set(species.tier, list);
  }

  const embed = new EmbedBuilder()
    .setColor(0x2b6cb0)
    .setTitle('📖 Archivo Digital · Bestiario')
    .setDescription(
      `**${formatNumber(Object.keys(SPECIES).length)}** especies registradas.\n` +
        'Usa `/pokedex nombre:<especie>` para ver la ficha completa.',
    );

  for (const [tier, lines] of byTier) {
    embed.addFields({ name: TIER_NAMES[tier as keyof typeof TIER_NAMES], value: lines.join('\n') });
  }

  // Discord admite 25 campos por embed como máximo.
  while (embed.data.fields!.length > 25) {
    embed.spliceFields(embed.data.fields!.length - 1, 1);
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

function rarityLabel(catchRate: number): string {
  if (catchRate <= 10) return 'legendario';
  if (catchRate <= 40) return 'raro';
  if (catchRate <= 90) return 'poco común';
  return 'común';
}
