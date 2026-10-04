import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { ENCOUNTER_TABLES, getSpecies, SPECIES } from '../game/species.js';
import { getProgress, listParty } from '../game/repository.js';
import { hasActiveSession, startBattle, startTrainerBattle } from '../services/battleSession.js';
import { getTemplates, rollTrainer, templateLevel } from '../game/trainers.js';
import { getZone, trainersInZone } from '../game/zones.js';
import { rng } from '../game/random.js';
import { guardTrainer } from './guard.js';
// ATASJO-GUIA: este comando abre una pantalla de la interfaz.
import { open } from '../ui/router.js';

export const data = new SlashCommandBuilder()
  .setName('explorar')
  .setDescription('Busca un Digimon salvaje por la zona y empieza un combate.');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await open(interaction, 'combate');
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
      content: '⚠️ Ya tienes un combate en marcha. Resuélvelo con los botones.',
      ephemeral: true,
    });
    return;
  }

  // Un 35% de las veces el encuentro es contra un entrenador de la zona: así
  // `/explorar` no es solo un salvaje suelto y da sensación de que hay gente
  // ahí fuera.
  if (rng.chance(0.35)) {
    const zone = getZone(getProgress(trainer.id).currentZone);
    const rivals = zone ? trainersInZone(zone, getTemplates()) : [];
    if (rivals.length > 0) {
      await startTrainerBattle(interaction, rng.pick(rivals));
      return;
    }
  }

  await startBattle(interaction);
}

/** `/rival`: enfrentamientos contra entrenadores NPC con equipo completo. */
export const rivalData = new SlashCommandBuilder()
  .setName('rival')
  .setDescription('Enfréntate a un entrenador rival con varios Digimon.')
  .addBooleanOption((opt) =>
    opt
      .setName('jefe')
      .setDescription('Busca un jefe de zona (no se puede huir).')
      .setRequired(false),
  );

export async function rival(interaction: ChatInputCommandInteraction): Promise<void> {
  const trainer = await guardTrainer(interaction);
  if (!trainer) return;

  if (hasActiveSession(trainer.id)) {
    await interaction.reply({
      content: '⚠️ Ya tienes un combate en marcha. Resuélvelo con los botones.',
      ephemeral: true,
    });
    return;
  }

  const party = listParty(trainer.id);
  const wantsBoss = interaction.options.getBoolean('jefe') ?? false;
  await startTrainerBattle(interaction, rollTrainer(party[0]?.level ?? 5, rng, wantsBoss));
}

/** `/entrenadores`: la lista de rivales disponibles. */
export const trainersData = new SlashCommandBuilder()
  .setName('entrenadores')
  .setDescription('Mira qué trainers hay y a qué nivel te esperan.');

export async function trainers(interaction: ChatInputCommandInteraction): Promise<void> {
  const trainer = await guardTrainer(interaction);
  if (!trainer) return;

  const level = listParty(trainer.id)[0]?.level ?? 1;
  const upcoming = rollTrainer(level, rng);

  const embed = new EmbedBuilder()
    .setColor(0x4a5568)
    .setTitle('🏅 Entrenadores rivales')
    .setDescription(
      `Estás en nivel **${level}**. Ahora mismo te tocaría **${upcoming.name}**.\n` +
        'Usa `/rival` para uno normal y `/rival jefe:true` para un guardián de zona.',
    );

  for (const template of getTemplates()) {
    const ready = templateLevel(template) <= level + 4;
    const line = template.team
      .map((m) => `${getSpecies(m.speciesKey)?.emoji} ${getSpecies(m.speciesKey)?.name}`)
      .join(' · ');

    embed.addFields({
      name: `${template.boss ? '👑' : '⚔️'} ${template.name} — Nv.${templateLevel(template)}`,
      value:
        `${ready ? '' : '🔒 '}_${template.intro}_\n${line}\nRecompensa ×${template.rewardBonus}`,
    });
  }

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

export const atacarData = new SlashCommandBuilder()
  .setName('atacar')
  .setDescription('Desafía a una especie concreta en vez de una cita aleatoria.')
  .addStringOption((opt) =>
    opt
      .setName('especie')
      .setDescription('Especie del rival (usa /descubrir para ver la lista).')
      .addChoices(wildChoices())
      .setRequired(true),
  )
  .addIntegerOption((opt) =>
    opt
      .setName('nivel')
      .setDescription('Nivel del rival (1-100). Por defecto se ajusta a tu equipo.')
      .setMinValue(1)
      .setMaxValue(100)
      .setRequired(false),
  )
  .addBooleanOption((opt) =>
    opt
      .setName('jefe')
      .setDescription('Enfréntate al jefe de la zona en vez de a un salvaje.')
      .setRequired(false),
  );

export async function atacar(interaction: ChatInputCommandInteraction): Promise<void> {
  const trainer = await guardTrainer(interaction);
  if (!trainer) return;

  if (hasActiveSession(trainer.id)) {
    await interaction.reply({
      content: '⚠️ Ya tienes un combate en marcha. Resuélvelo con los botones.',
      ephemeral: true,
    });
    return;
  }

  const party = listParty(trainer.id);
  const level = interaction.options.getInteger('nivel') ?? party[0]?.level ?? 5;

  // Un jefe lo define la zona, no una especie suelta.
  if (interaction.options.getBoolean('jefe')) {
    await startTrainerBattle(interaction, rollTrainer(level, rng, true));
    return;
  }

  const speciesKey = interaction.options.getString('especie', true);
  const species = getSpecies(speciesKey);
  if (!species) {
    await interaction.reply({ content: '❌ Esa especie no existe.', ephemeral: true });
    return;
  }

  await startBattle(interaction, { speciesKey, level });
}

/** Discord admite máximo 25 opciones por comando slash. */
function wildChoices(): { name: string; value: string }[] {
  const keys = new Set<string>();
  for (const table of ENCOUNTER_TABLES) for (const key of table.keys) keys.add(key);

  return [...keys]
    .slice(0, 25)
    .map((key) => ({ name: `${SPECIES[key]!.emoji} ${SPECIES[key]!.name}`, value: key }));
}
