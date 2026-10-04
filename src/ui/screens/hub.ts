import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import {
  countPCSlots,
  countPartySlots,
  getLeader,
  getProgress,
  listParty,
} from '../../game/repository.js';
import { config } from '../../config.js';
import { energyOf } from '../../game/dungeonRepo.js';
import { activeMatchOf, isQueued, queueSize } from '../../services/pvpQueue.js';
import { summaryOf } from '../../game/progressionRepo.js';
import { currentZoneOf } from '../../services/world.js';
import { expToNextLevel, MAX_LEVEL } from '../../game/stats.js';
import { bar, playerField, type View } from '../components.js';
import { encodeNav } from '../nav.js';
import { register, type ScreenContext } from '../screen.js';
import { AREAS, COLORS } from '../theme.js';

/**
 * El Digivice: el punto central de navegación.
 *
 * Antes de esto era una ficha del Digimon líder y poco más — un sitio del que
 * solo se podía ir al PC. Ahora es el hub: seis áreas, y desde cualquiera de
 * ellas se vuelve aquí con un botón.
 *
 * Lo que se mantiene del Digivice de antes es el marco: el jugador sigue
 * viendo su Digimon con sus barras, porque esa es la información que hace falta
 * para decidir si entrar a combate o no ir.
 */
register('hub', async (ctx): Promise<View> => {
  const { trainer, session } = ctx;
  const party = listParty(trainer.id);
  const leader = party[0] ?? null;
  const energy = energyOf(trainer.id);
  const progress = summaryOf(trainer.id);
  const zone = currentZoneOf(trainer.id);
  const match = activeMatchOf(trainer.id);

  const embeds: EmbedBuilder[] = [];

  // ---------------------------------------------------------------- hub ---
  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.hub)
      .setAuthor({ name: '📟 DIGIVICE' })
      .setDescription(
        'El centro de todo. Desde aquí sales a cualquier área y a cualquiera ' +
          'vuelves con el botón azul.',
      )
      .addFields(playerField(trainer)),
  );

  // ------------------------------------------------------------- estado ---
  const estados: string[] = [];
  estados.push(`🌍 **${zone.emoji} ${zone.name}**`);

  if (isQueued(trainer.id)) {
    estados.push('⚔️ **En la cola de PvP** — esperando rival');
  } else if (match) {
    estados.push('⚔️ **Combate PvP en curso**');
  }

  if (energy.energy < energy.max) {
    estados.push(`⚡ Energía: ${energy.energy}/${energy.max} (se recarga al día siguiente)`);
  }

  const listas = progress.dailyReady + progress.weeklyReady;
  if (listas > 0) {
    estados.push(`🎁 **${listas} recompensa(s) lista(s)** para reclamar`);
  }

  if (progress.dailyReady === 0 && progress.weeklyReady === 0) {
    estados.push('📋 Sin misiones listas. Juega un poco y vuelve.');
  }

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setTitle('Estado')
      .setDescription(estados.join('\n')),
  );

  // ---------------------------------------------------------- pantalla del líder ---
  if (leader) {
    const species = leader.species;
    const exp = leader.level >= MAX_LEVEL ? 0 : expToNextLevel(leader.level);
    const expText =
      leader.level >= MAX_LEVEL ? ' **MAX**' : ` ${bar(leader.exp, exp, 10)} \`${leader.exp}/${exp}\``;

    embeds.push(
      new EmbedBuilder()
        .setColor(species.tier === 'mega' ? COLORS.legendary : COLORS.hub)
        .setTitle(`${species.emoji} ${leader.nickname ?? species.name}`)
        .setDescription(
          `**Nivel ${leader.level}** · ${species.attribute.toUpperCase()}\n` +
            `\`\`\`PV  ${bar(leader.hp, leader.stats.hp, 12)} ${leader.hp}/${leader.stats.hp}` +
            `\nEXP ${expText.slice(0, 22)}\`\`\`` +
            (leader.status !== 'ok' ? `\n⚠️ Estado alterado: **${leader.status}**` : ''),
        )
        .addFields({
          name: 'Equipo',
          value:
            party
              .slice(0, config.maxPartySize)
              .map(
                (d) =>
                  `${d.id === leader.id ? '⭐' : '  '} ${d.species.emoji} ${d.nickname ?? d.species.name} Nv.${d.level}`,
              )
              .join('\n') || '—',
          inline: true,
        })
        .addFields({
          name: 'Reservas',
          value: `PC ${countPCSlots(trainer.id)}/${config.pcCapacity}\nEquipo ${countPartySlots(trainer.id)}/${config.maxPartySize}`,
          inline: true,
        }),
    );
  }

  // --------------------------------------------------------------- áreas ---
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let i = 0; i < AREAS.length; i += 3) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const area of AREAS.slice(i, i + 3)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(session, area.key === 'digivice' ? 'registro' : area.key))
          .setLabel(area.label)
          .setEmoji(area.emoji)
          .setStyle(ButtonStyle.Primary),
      );
    }
    rows.push(row);
  }

  // ------------------------------------------------------------- accesos ---
  const quick = new ActionRowBuilder<ButtonBuilder>();

  quick.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(session, 'mapa'))
      .setLabel('Mapa')
      .setEmoji('🗺️')
      .setStyle(ButtonStyle.Success),
  );

  quick.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(session, isQueued(trainer.id) ? 'pvp' : 'combate'))
      .setLabel(isQueued(trainer.id) ? 'Ver cola' : 'Combatir')
      .setEmoji('⚔️')
      .setStyle(ButtonStyle.Success),
  );

  quick.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(session, 'misiones'))
      .setLabel(progress.dailyReady + progress.weeklyReady > 0 ? 'Recompensas' : 'Misiones')
      .setEmoji(progress.dailyReady + progress.weeklyReady > 0 ? '🎁' : '📋')
      .setStyle(
        progress.dailyReady + progress.weeklyReady > 0 ? ButtonStyle.Success : ButtonStyle.Secondary,
      ),
  );

  rows.push(quick);

  if (queueSize() > 0) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(session, 'lb'))
          .setLabel('Clasificación')
          .setEmoji('🏆')
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  }

  const defeated = getProgress(trainer.id).bossesFound;

  embeds[0]!.setFooter({
    text:
      `Jefes derrotados: ${defeated} · Conexión: ${queueSize()} en cola de PvP` +
      `\nDigivice v2 · El hub de la interfaz`,
  });

  return { embeds, components: rows };
});