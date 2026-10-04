import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import {
  updateUsername, buyItem, findTrainer, getInventory } from '../game/repository.js';
import { ITEMS } from '../game/items.js';
import { formatNumber } from '../game/progression.js';
import { COLORS } from '../views/embeds.js';
import { guardTrainer } from './guard.js';
// ATASJO-GUIA: este comando abre una pantalla de la interfaz.
import { open } from '../ui/router.js';

export const data = new SlashCommandBuilder()
  .setName('tienda')
  .setDescription('Gasta DigiBytes en objetos para el combate.')
  .addSubcommand((sub) =>
    sub.setName('ver').setDescription('Muestra la tienda y tu inventario.'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('comprar')
      .setDescription('Compra un objeto.')
      .addStringOption((opt) =>
        opt
          .setName('objeto')
          .setDescription('Qué quieres comprar.')
          .addChoices(
            Object.values(ITEMS).map((item) => ({
              name: `${item.emoji} ${item.name} — ${formatNumber(item.price)} DB`.slice(0, 100),
              value: item.key,
            })),
          )
          .setRequired(true),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('cantidad')
          .setDescription('Cuántas unidades (por defecto 1).')
          .setMinValue(1)
          .setMaxValue(20)
          .setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('inventario').setDescription('Solo lo que llevas encima.'),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // La tienda es una pantalla: mismos datos, mismos botones, pero navegable.
  await open(interaction, 'tienda');
}

/**
 * La implementación anterior, que pintaba su propio embed.
 *
 * Se conserva por si algún comando la reutiliza; el comando ya no la llama.
 */
async function legacyExecute(interaction: ChatInputCommandInteraction): Promise<void> {
  const trainer = await guardTrainer(interaction);
  if (!trainer) return;

  updateUsername(trainer.id, interaction.user.username);

  const sub = interaction.options.getSubcommand();
  if (sub === 'comprar') return buy(interaction, trainer.id);
  if (sub === 'inventario') {
    const inventory = getInventory(trainer.id);
    await interaction.reply({ embeds: [inventoryEmbed(trainer.digibytes, inventory)], flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({ embeds: [shopEmbed(trainer.digibytes, getInventory(trainer.id))], flags: MessageFlags.Ephemeral });
}

const ROLE_EMOJI = {
  ofensivo: '⚔️',
  defensivo: '🛡️',
  utilidad: '🧰',
  material: '📦',
} as const;

function shopEmbed(digibytes: number, inventory: Record<string, number>): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🏪 Tienda · Datos del Mundo')
    .setDescription(`💰 Tienes **${formatNumber(digibytes)}** DigiBytes.\n`)
    .addFields(
      Object.values(ITEMS).map((item) => ({
        name: `${item.emoji} ${item.name} · ${formatNumber(item.price)} DB`,
        value:
          `${item.description}\n` +
          `${ROLE_EMOJI[item.role] ?? '📦'} \`${item.key}\` · ` +
          (item.role === 'material'
            ? 'material de evolución'
            : `hasta ${item.perBattleCap} por combate`) +
          (inventory[item.key] ? ` · tienes ${inventory[item.key]}` : ''),
        inline: true,
      })),
    )
    .setFooter({ text: 'Usa /tienda comprar objeto:<id> · /tienda inventario para ver lo tuyo' });

  return embed;
}

function inventoryEmbed(digibytes: number, inventory: Record<string, number>): EmbedBuilder {
  const owned = Object.values(ITEMS).filter((item) => (inventory[item.key] ?? 0) > 0);

  return new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setTitle('🎒 Inventario')
    .setDescription(`💰 **${formatNumber(digibytes)}** DigiBytes`)
    .addFields({
      name: 'Objetos',
      value:
        owned
          .map(
            (item) =>
              `${item.emoji} **${item.name}** ×${inventory[item.key]} — ${item.description}`,
          )
          .join('\n') || '_Vacío. Pásate por la tienda._',
    })
    .setFooter({
      text: 'Los objetos que gastas en combate salen de aquí, no se regeneran solos.',
    });
}

async function buy(interaction: ChatInputCommandInteraction, trainerId: number): Promise<void> {
  const itemKey = interaction.options.getString('objeto', true);
  const quantity = interaction.options.getInteger('cantidad') ?? 1;
  const item = ITEMS[itemKey];

  if (!item) {
    await interaction.reply({ content: '❌ Ese objeto no existe.', flags: MessageFlags.Ephemeral });
    return;
  }

  const total = item.price * quantity;
  const trainer = findTrainer(interaction.user.id);

  if (!trainer) {
    await interaction.reply({ content: '❌ No encontrado.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (trainer.digibytes < total) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.warning)
          .setTitle('💸 No te llega')
          .setDescription(
            `Te faltan **${formatNumber(total - trainer.digibytes)}** DigiBytes.\n` +
              `Coste: ${quantity} × ${formatNumber(item.price)} = **${formatNumber(total)}**`,
          ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const inventory = getInventory(trainerId);
  let spent = 0;
  let lastFailure: string | null = null;

  // Se compra de uno en uno para no cobrar por unidades que no entran
  // (por ejemplo al acercarse al tope de 99).
  for (let i = 0; i < quantity; i++) {
    const result = buyItem(trainerId, itemKey);
    if (!result.ok) {
      lastFailure = result.reason;
      break;
    }
    spent++;
  }

  const fresh = findTrainer(interaction.user.id)!;
  const owned = getInventory(trainerId);

  const note =
    lastFailure === 'sin-espacio'
      ? `\n⚠️ Paraste en ${spent}: tope de 99 unidades por objeto.`
      : '';

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle(`${item.emoji} Comprado`)
        .setDescription(
          `Has comprado **${spent} × ${item.name}** por **${formatNumber(item.price * spent)}** DigiBytes.` +
            note,
        )
        .addFields({
          name: 'Tu mochila',
          value:
            Object.values(ITEMS)
              .filter((i) => (owned[i.key] ?? 0) > 0)
              .map((i) => `${i.emoji} ${i.name} ×${owned[i.key]}`)
              .join('\n') || '_Vacía._',
        })
        .setFooter({ text: `Saldo: ${formatNumber(fresh.digibytes)} DigiBytes` }),
    ],
    components: [inventoryHintRow()],
    flags: MessageFlags.Ephemeral,
  });
}

function inventoryHintRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('tienda:noop')
      .setLabel('Usa /tienda inventario para verlos')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  );
}

export { StringSelectMenuBuilder };
