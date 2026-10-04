import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { getDigimon, getInventory, getTrainerById, listParty } from '../game/repository.js';
import {
  collectionProgress,
  devolveInto,
  evolveOwned,
  historyOf,
  routeStatuses,
  unlocksOf,
  type Requirement,
} from '../game/evolutionRepo.js';
import { getItem } from '../game/items.js';
import { getSpecies } from '../game/species.js';
import { COLORS } from '../views/embeds.js';
import { guardTrainer } from './guard.js';
// ATASJO-GUIA: este comando abre una pantalla de la interfaz.
import { open } from '../ui/router.js';
import { TIER_NAMES } from '../game/progression.js';

/**
 * `/evolucion` — la evolución como decisión.
 *
 * El nivel desbloquea, no transforma. Por eso este comando tiene tres partes:
 * `ver` pinta el árbol con lo que falta, `elegir` cobra y cambia, y `regresar`
 * deshace una rama mal tomada. Sin la tercera, evolving sería una apuesta
 * irreversible con la temporada entera.
 */

export const data = new SlashCommandBuilder()
  .setName('evolucion')
  .setDescription('Rutas de evolución de tus Digimon.')
  .addSubcommand((sub) =>
    sub
      .setName('ver')
      .setDescription('Muestra el árbol evolutivo y lo que te falta.')
      .addStringOption((opt) =>
        opt
          .setName('digimon')
          .setDescription('Nombre o apodo. Si no lo pones, usa al líder.')
          .setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('elegir')
      .setDescription('Evoluciona por una ruta concreta.')
      .addStringOption((opt) =>
        opt.setName('digimon').setDescription('Nombre o apodo.').setRequired(false),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('ruta')
          .setDescription('Número de ruta tal como aparece en /evolucion ver.')
          .setMinValue(1)
          .setMaxValue(8)
          .setRequired(true),
      )
      .addBooleanOption((opt) =>
        opt
          .setName('confirmar')
          .setDescription('Pide confirmación antes de cobrar. Actívalo si no estás seguro.')
          .setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('regresar')
      .setDescription('Deshace una evolución con material y vuelve a la forma anterior.')
      .addStringOption((opt) =>
        opt.setName('digimon').setDescription('Nombre o apodo.').setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('coleccion').setDescription('Formas que ya has desbloqueado.'),
  )
  .addSubcommand((sub) =>
    sub.setName('historial').setDescription('Evoluciones de un Digimon concreto.')
      .addStringOption((opt) =>
        opt.setName('digimon').setDescription('Nombre o apodo.').setRequired(false),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await open(interaction, 'evolucion');
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

  if (sub === 'coleccion') return showCollection(interaction, trainer.id);
  if (sub === 'elegir') return choose(interaction, trainer.id);
  if (sub === 'regresar') return goBack(interaction, trainer.id);

  const digimon = resolveDigimon(interaction, trainer.id);
  if (!digimon) return;
  if (sub === 'historial') return showHistory(interaction, digimon.id, digimon.nickname ?? digimon.species.name);
  return showTree(interaction, trainer.id, digimon.id);
}

// ------------------------------------------------------------------ vista ----

/** Busca un Digimon por apodo o especie; si no se indica, usa al líder. */
function resolveDigimon(interaction: ChatInputCommandInteraction, trainerId: number) {
  const query = interaction.options.getString('digimon')?.trim().toLowerCase();
  const roster = [...listParty(trainerId)];

  if (!query) return roster[0] ?? null;

  const found =
    roster.find((d) => d.nickname?.toLowerCase() === query) ??
    roster.find((d) => d.species.name.toLowerCase() === query) ??
    roster.find((d) => d.species.name.toLowerCase().includes(query));

  if (!found) {
    void interaction.reply({
      content:
        `No encuentro ningún Digimon llamado así en tu equipo. ` +
        `Disponibles: ${roster.map((d) => d.nickname ?? d.species.name).join(', ') || '(vacio)'}.`,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  return found;
}

const CHECK_MARK = { nivel: '📈', victorias: '🏆', digibytes: '💰', material: '📦' } as const;

function requirementLine(req: Requirement): string {
  return `${CHECK_MARK[req.kind]} ${req.label} — ${req.met ? 'listo' : `te faltan ${req.needed - req.have}`}`;
}

async function showTree(
  interaction: ChatInputCommandInteraction,
  trainerId: number,
  digimonId: number,
): Promise<void> {
  const digimon = getDigimon(digimonId);
  if (!digimon) {
    await interaction.reply({ content: 'Ese Digimon ya no existe.', flags: MessageFlags.Ephemeral });
    return;
  }

  const trainer = getTrainerById(trainerId);
  if (!trainer) return;

  const inventory = getInventory(trainerId);
  const statuses = routeStatuses(digimon, trainer, inventory, unlocksOf(trainerId));

  if (statuses.length === 0) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.neutral)
          .setTitle(`${digimon.species.emoji} ${digimon.species.name}`)
          .setDescription('Esta es una forma final. No tiene más evoluciones.')
          .addFields({
            name: 'Regresión',
            value: digimon.species.devolution
              ? `Volver a **${getSpecies(digimon.species.devolution.to)?.name}** con ` +
                Object.entries(digimon.species.devolution.items)
                  .map(([k, n]) => `${n}x ${getItem(k)?.name ?? k}`)
                  .join(' + ')
              : 'No se puede retroceder desde esta forma.',
          }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const ready = statuses.filter((s) => s.ready);

  const embed = new EmbedBuilder()
    .setColor(ready.length > 0 ? COLORS.success : COLORS.primary)
    .setTitle(`🌳 Árbol evolutivo — ${digimon.species.emoji} ${digimon.nickname ?? digimon.species.name}`)
    .setDescription(
      `Nivel **${digimon.level}** · victories **${trainer.battlesWon}** · ` +
        `💰 **${trainer.digibytes}** DigiBytes\n` +
        (ready.length > 0
          ? `✨ Tienes **${ready.length}** ruta(s) lista(s). Elige con \`/evolucion elegir\`.`
          : 'Ninguna ruta lista todavía. Puedes aplazar la evolución: no pierdes el acceso.'),
    );

  statuses.forEach((status, i) => {
    const number = i + 1;
    const target = getSpecies(status.route.to);
    const lines: string[] = [];

    lines.push(
      `${status.route.branch ? '🔀 **Rama alternativa**' : '➡️ **Ruta principal**'}` +
        (status.route.branch ? '' : ''),
    );
    if (status.route.note) lines.push(`*${status.route.note}*`);

    lines.push(
      `👤 ${target?.attribute ?? '?'} · ${TIER_NAMES[target?.tier ?? 'inicial']} · ` +
        `⚔️ ${target?.base.attack ?? 0} 🛡️ ${target?.base.defense ?? 0} 💨 ${target?.base.speed ?? 0}`,
    );

    if (status.lockedByBranch) {
      lines.push(`🔒 Ruta cerrada: ya tienes **${getSpecies(status.lockedByBranch)?.name}**.`);
    } else if (status.ready) {
      lines.push('✅ **Todo listo.**');
    } else {
      lines.push(status.missing.map(requirementLine).join('\n'));
    }

    embed.addFields({
      name: `${number}. ${status.to.emoji} ${status.to.name}`,
      value: lines.join('\n'),
      inline: false,
    });
  });

  // Regresion, si la hay.
  const devo = digimon.species.devolution;
  if (devo) {
    embed.addFields({
      name: '↩️ Regresión',
      value:
        `Volver a **${getSpecies(devo.to)?.emoji} ${getSpecies(devo.to)?.name}** con ` +
        Object.entries(devo.items)
          .map(([k, n]) => `${n}x ${getItem(k)?.name ?? k}`)
          .join(' + ') +
        (devo.note ? `\n*${devo.note}*` : ''),
      inline: false,
    });
  }

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}

// ----------------------------------------------------------------- elegir ----

async function choose(
  interaction: ChatInputCommandInteraction,
  trainerId: number,
): Promise<void> {
  const digimon = resolveDigimon(interaction, trainerId);
  if (!digimon) return;

  const trainer = getTrainerById(trainerId);
  if (!trainer) return;

  const routeNumber = interaction.options.getInteger('ruta', true);
  const routeIndex = routeNumber - 1;
  const inventory = getInventory(trainerId);

  const statuses = routeStatuses(digimon, trainer, inventory, unlocksOf(trainerId));
  const status = statuses[routeIndex];

  if (!status) {
    await interaction.reply({
      content: `La ruta ${routeNumber} no existe para ${digimon.species.name}. Mira \`/evolucion ver\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const target = getSpecies(status.route.to);
  if (!target) {
    await interaction.reply({ content: 'Esa forma no existe en el catálogo.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Confirmación: evolve es irreversible sin material, así que avisamos antes de
  // cobrar. Con `confirmar: false` se ejecuta al instante, que es lo que quiere
  // quien ya sabe lo que hace.
  if (interaction.options.getBoolean('confirmar')) {
    const cost = [
      status.route.digibytes ? `💰 ${status.route.digibytes} DigiBytes` : '',
      ...Object.entries(status.route.items ?? {}).map(
        ([k, n]) => `${n}x ${getItem(k)?.name ?? k}`,
      ),
    ].filter(Boolean);

    const preview =
      `⚠️ **Vas a evolucionar**\n` +
      `${digimon.species.emoji} **${digimon.nickname ?? digimon.species.name}** → ` +
      `${target.emoji} **${target.name}**\n\n` +
      `Coste: ${cost.join(' + ') || 'gratis'}\n` +
      `Regresión: ${digimon.species.devolution ? 'posible con material' : 'no disponible'}\n\n` +
      `Repite con \`confirmar: false\` para hacerlo sin preguntar.`;

    await interaction.reply({ content: preview, flags: MessageFlags.Ephemeral });
    return;
  }

  const result = evolveOwned(digimon, routeIndex, trainer, inventory);
  if (!result.ok) {
    await interaction.reply({ content: `❌ ${result.message}`, flags: MessageFlags.Ephemeral });
    return;
  }

  const after = getDigimon(digimon.id);
  const spent = [
    result.spent.digibytes ? `💰 ${result.spent.digibytes} DigiBytes` : '',
    ...Object.entries(result.spent.items).map(
      ([k, n]) => `${n}x ${getItem(k)?.name ?? k}`,
    ),
  ].filter(Boolean);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.legendary)
        .setTitle(`✨ ¡Evolución!`)
        .setDescription(
          `**${result.from}** se convierte en\n${result.emoji} **${result.to}**`,
        )
        .addFields(
          { name: 'Invertido', value: spent.join('\n') || 'Nada: esta ruta era gratis.' },
          after
            ? {
                name: 'Nuevas estadísticas',
                value:
                  `❤️ ${after.stats.hp} PV · ⚔️ ${after.stats.attack} · ` +
                  `🛡️ ${after.stats.defense} · 💨 ${after.stats.speed}`,
              }
            : { name: 'Nuevas estadísticas', value: 'No disponible' },
        )
        .setFooter({ text: `Te quedan ${result.digibytesLeft} DigiBytes.` }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

// -------------------------------------------------------------- regresar -----

async function goBack(
  interaction: ChatInputCommandInteraction,
  trainerId: number,
): Promise<void> {
  const digimon = resolveDigimon(interaction, trainerId);
  if (!digimon) return;

  const inventory = getInventory(trainerId);
  const result = devolveInto(digimon, trainerId, inventory);

  if (!result.ok) {
    const messages: Record<string, string> = {
      'no-regresion': `${digimon.species.name} no puede retroceder.`,
      'sin-material': `Te falta: ${result.need?.map((r) => `${r.label} (faltan ${r.needed - r.have})`).join(', ')}.`,
      'material-invalido': 'El material de esta ruta no existe en el catálogo.',
      'no-poses': 'Ese Digimon no es tuyo.',
      'no-existe': 'Ese Digimon ya no existe.',
    };
    await interaction.reply({
      content: `❌ ${messages[result.reason] ?? 'No se puede retroceder.'}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle('↩️ Regresión')
        .setDescription(`**${result.from}** vuelve a ser ${result.emoji} **${result.to}**.`),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

// ------------------------------------------------------------- coleccion -----

async function showCollection(
  interaction: ChatInputCommandInteraction,
  trainerId: number,
): Promise<void> {
  const progress = collectionProgress(trainerId);

  const tiers = Object.entries(progress.byTier)
    .sort((a, b) => ['inicial', 'novato', 'campeon', 'ultimate', 'mega'].indexOf(a[0]) - ['inicial', 'novato', 'campeon', 'ultimate', 'mega'].indexOf(b[0]))
    .map(([tier, [have, total]]) => {
      const bar = '█'.repeat(have) + '░'.repeat(Math.max(0, total - have));
      return `${TIER_NAMES[tier as keyof typeof TIER_NAMES] ?? tier}: ${bar} **${have}/${total}**`;
    });

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.legendary)
        .setTitle('📖 Colección')
        .setDescription(`Has desbloqueado **${progress.unlocked}/${progress.total}** formas.`)
        .addFields({ name: 'Progreso por rango', value: tiers.join('\n') }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

// ------------------------------------------------------------- historial -----

async function showHistory(
  interaction: ChatInputCommandInteraction,
  digimonId: number,
  label: string,
): Promise<void> {
  const history = historyOf(digimonId);

  if (history.length === 0) {
    await interaction.reply({
      content: `**${label}** todavía no ha evolucionado.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = history.map((h) => {
    const arrow = h.kind === 'regresion' ? '↩️' : '➡️';
    return `${arrow} ${h.fromEmoji} **${h.fromName}** → ${h.toEmoji} **${h.toName}**\n   \`${h.createdAt}\``;
  });

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle(`📜 Evoluciones de ${label}`)
        .setDescription(lines.join('\n')),
    ],
    flags: MessageFlags.Ephemeral,
  });
}
