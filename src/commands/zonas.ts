import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import {
  getProgress,
  listParty,
  setCurrentZone,
} from '../game/repository.js';
import {
  canEnter,
  defaultZone,
  ENTRY_MESSAGES,
  getZone,
  trainersInZone,
  ZONES,
  zoneRoster,
} from '../game/zones.js';
import { getTemplates, getTutorTemplate, rollTrainer } from '../game/trainers.js';
import { hasActiveSession, startTrainerBattle } from '../services/battleSession.js';
import { rng } from '../game/random.js';
import { COLORS } from '../views/embeds.js';
import { guardTrainer } from './guard.js';
// ATASJO-GUIA: este comando abre una pantalla de la interfaz.
import { open } from '../ui/router.js';

export const data = new SlashCommandBuilder()
  .setName('zonas')
  .setDescription('Viaja entre zonas del Mundo Digital y desafía a sus jefes.')
  .addSubcommand((sub) => sub.setName('ver').setDescription('Muestra las zonas y dónde estás.'))
  .addSubcommand((sub) =>
    sub
      .setName('ir')
      .setDescription('Cambia de zona.')
      .addStringOption((opt) =>
        opt
          .setName('zona')
          .setDescription('A qué zona quieres ir.')
          .addChoices(ZONES.map((z) => ({ name: `${z.emoji} ${z.name}`, value: z.key })))
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('jefe').setDescription('Enfréntate al jefe de tu zona actual.'),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // `/zonas ir <zona>` sigue siendo el atajo directo: salta a la zona sin
  // pasar por el mapa. El resto abre el mapa, que es el sitio.
  if (interaction.options.getSubcommand() === 'ir') {
    const trainer = await guardTrainer(interaction);
    if (!trainer) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return;
  }

  await open(interaction, 'mapa');
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
  if (sub === 'ir') return travel(interaction, trainer.id);
  if (sub === 'jefe') return fightBoss(interaction, trainer.id);
  return show(interaction, trainer.id);
}

async function show(interaction: ChatInputCommandInteraction, trainerId: number): Promise<void> {
  const level = listParty(trainerId)[0]?.level ?? 1;
  const progress = getProgress(trainerId);
  const current = getZone(progress.currentZone) ?? defaultZone();

  const embed = new EmbedBuilder()
    .setColor(0x2f6f4e)
    .setTitle('🗺️ Zonas del Mundo Digital')
    .setDescription(
      `Estás en **${current.emoji} ${current.name}**.\n` +
        'Usa `/zonas ir` para cambiar y `/zonas jefe` para retar al guardián.',
    );

  for (const zone of ZONES) {
    const level_fit = canEnter(zone, level);
    const isHere = zone.key === current.key;
    const beaten = zone.boss && progress.bossesBeaten.includes(zone.boss);

    const roster = zoneRoster(zone)
      .slice(0, 8)
      .map((s) => s.emoji)
      .join('');

    const rivals = trainersInZone(zone, getTemplates());

    embed.addFields({
      name:
        `${isHere ? '📍' : level_fit === 'bajo' ? '🔒' : '  '} ` +
        `${zone.emoji} ${zone.name} · Nv.${zone.minLevel}-${zone.maxLevel}` +
        (beaten ? ' 👑' : ''),
      value:
        `${zone.description}\n` +
        `${roster} ${level_fit === 'bajo' ? '_(te quedarás corto de nivel)_' : ''}\n` +
        `Rivals: ${rivals.map((r) => r.name).join(', ') || '—'}` +
        (zone.boss
          ? `\nGuardián: ${beaten ? '✓ derrotado' : getTutorTemplate(zone.boss)?.name ?? '—'} ` +
            `(recompensa ×${zone.bonus})`
          : ''),
      inline: false,
    });
  }

  embed.setFooter({
    text: `Nivel ${level} · Jefes derrotados: ${progress.bossesFound}`,
  });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function travel(interaction: ChatInputCommandInteraction, trainerId: number): Promise<void> {
  const zoneKey = interaction.options.getString('zona', true);
  const zone = getZone(zoneKey);

  if (!zone) {
    await interaction.reply({ content: '❌ Esa zona no existe.', flags: MessageFlags.Ephemeral });
    return;
  }

  const level = listParty(trainerId)[0]?.level ?? 1;
  const fit = canEnter(zone, level);

  setCurrentZone(trainerId, zone.key);
  const progress = getProgress(trainerId);
  const beaten = zone.boss ? progress.bossesBeaten.includes(zone.boss) : false;

  const embed = new EmbedBuilder()
    .setColor(fit === 'bajo' ? COLORS.warning : COLORS.primary)
    .setTitle(`${zone.emoji} Llegaste a ${zone.name}`)
    .setDescription(
      `${ENTRY_MESSAGES[fit]}\n\n` +
        `_${zone.description}_\n` +
        `Rango: **Nv.${zone.minLevel}-${zone.maxLevel}** · Recompensa **×${zone.bonus}**`,
    );

  await interaction.reply({
    embeds: [embed],
    components: [zoneRow(trainerId, zone.boss, beaten)],
    flags: MessageFlags.Ephemeral,
  });
}

function zoneRow(trainerId: number, bossKey: string | null, beaten: boolean) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`zona:ir:${trainerId}`)
      .setLabel('Entrenadores de la zona')
      .setEmoji('⚔️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`zona:jefe:${trainerId}`)
      .setLabel(beaten ? 'Retar de nuevo al jefe' : 'Desafiar al jefe')
      .setEmoji('👑')
      .setStyle(beaten ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(!bossKey),
  );
}

async function fightBoss(
  interaction: ChatInputCommandInteraction,
  trainerId: number,
): Promise<void> {
  if (hasActiveSession(trainerId)) {
    await interaction.reply({
      content: '⚠️ Ya tienes un combate en marcha.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const progress = getProgress(trainerId);
  const zone = getZone(progress.currentZone) ?? defaultZone();

  if (!zone.boss) {
    await interaction.reply({
      content: 'Esta zona no tiene guardián.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const boss = getTutorTemplate(zone.boss);
  if (!boss) {
    await interaction.reply({
      content: '❌ No se encontró el jefe de esta zona.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await startTrainerBattle(interaction, { ...boss, rewardBonus: boss.rewardBonus * zone.bonus });
}

// ------------------------------------------------------------- botones -----

/** Se invoca desde index.ts cuando alguien pulsa un botón `zona:`. */
export async function handleZoneAction(
  interaction: import('discord.js').ButtonInteraction,
  trainerId: number,
): Promise<void> {
  const [, action] = interaction.customId.split(':');

  if (action === 'ir') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const level = listParty(trainerId)[0]?.level ?? 1;
    const progress = getProgress(trainerId);
    const zone = getZone(progress.currentZone) ?? defaultZone();
    const rivals = trainersInZone(zone, getTemplates());

    if (rivals.length === 0) {
      await interaction.editReply('No hay rivales registrados en esta zona.');
      return;
    }

    const template = rollTrainer(level, rng);
    // Nos quedamos con uno de los de la zona si hay, si no el que toque.
    const chosen = rivals.find((r) => r.key === template.key) ?? rivals[0]!;
    await startTrainerBattle(interaction, chosen);
    return;
  }

  if (action === 'jefe') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const progress = getProgress(trainerId);
    const zone = getZone(progress.currentZone) ?? defaultZone();
    const boss = zone.boss ? getTutorTemplate(zone.boss) : null;

    if (!boss) {
      await interaction.editReply('Esta zona no tiene guardián.');
      return;
    }

    await startTrainerBattle(interaction, {
      ...boss,
      rewardBonus: boss.rewardBonus * zone.bonus,
    });
  }
}
