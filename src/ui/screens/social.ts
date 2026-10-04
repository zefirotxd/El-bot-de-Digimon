import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { listParty, topTrainers } from '../../game/repository.js';
import { TIER_NAMES, formatNumber } from '../../game/progression.js';
import { getPvpProfile } from '../../game/pvpRepo.js';
import { getSpecies } from '../../game/species.js';
import { getTemplates, type TrainerTemplate } from '../../game/trainers.js';
import { collectionProgress } from '../../game/evolutionRepo.js';
import { dexProgress } from '../../game/dexRepo.js';
import { summaryOf, titlesOf } from '../../game/progressionRepo.js';
import { queueSize } from '../../services/pvpQueue.js';
import {
  actionRow,
  areaRows,
  formatBytes,
  header,
  navRow,
  paginate,
  pageRow,
  playerField,
} from '../components.js';
import { encodeNav } from '../nav.js';
import { register } from '../screen.js';
import { COLORS } from '../theme.js';

/**
 * Lo social: perfil, otros entrenadores y clasificaciones.
 *
 * Antes `/perfil` y `/leaderboard` eran dos comandos que nadie Discovería. Aquí
 * son dos pantallas en el mismo sitio, y el perfil es además la pantalla de
 * "qué he hecho": misiones, logros, títulos y bestiario en un vistazo.
 */

register('social', async (ctx) => {
  const { trainer, session } = ctx;
  const party = listParty(trainer.id);

  const embeds: EmbedBuilder[] = [
    header({
      area: 'social',
      title: 'SOCIAL',
      context: 'Tu perfil, otros entrenadores y las clasificaciones.',
      color: COLORS.social,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.social)
      .setTitle('¿Qué quieres ver?')
      .setDescription(
        queueSize() > 0 ? `Hay **${queueSize()}** entrenador(es) en la cola de PvP.` : 'Ahora mismo no hay nadie en la cola de PvP.',
      ),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [
    ...actionRow(
      [
        { screen: 'perfil', label: 'Mi perfil', emoji: '🪪', style: ButtonStyle.Success },
        { screen: 'entrenadores', label: 'Entrenadores', emoji: '👥', style: ButtonStyle.Primary },
        { screen: 'lb', label: 'Clasificación', emoji: '🏆', style: ButtonStyle.Primary },
      ],
      session,
    ),
  ];

  components.push(navRow(session));
  components.push(...areaRows(session, 'social'));

  return { embeds, components };
});

// -------------------------------------------------------------- perfil ----

register('perfil', async (ctx) => {
  const { trainer, session } = ctx;
  const party = listParty(trainer.id);
  const leader = party[0] ?? null;
  const pvp = getPvpProfile(trainer.id);
  const progreso = summaryOf(trainer.id);
  const dex = dexProgress(trainer.id);
  const coleccion = collectionProgress(trainer.id);
  const titulos = titlesOf(trainer.id);

  const embeds: EmbedBuilder[] = [
    new EmbedBuilder()
      .setColor(COLORS.social)
      .setAuthor({ name: `🪪 ${trainer.username}` })
      .setDescription(
        `💰 **${formatBytes(trainer.digibytes)}** DB  ·  ` +
          `⚔️ ${trainer.battlesWon} victorias  ·  ` +
          `📅 ${progreso.activeDays} días activos`,
      ),
  ];

  // El equipo, que es lo que un jugador quiere ver de otro.
  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setTitle('Equipo')
      .setDescription(
        party.length > 0
          ? party
              .map(
                (d) =>
                  `${d.id === leader?.id ? '⭐' : '  '} ${d.species.emoji} **${d.nickname ?? d.species.name}** Nv.${d.level} ${TIER_NAMES[d.species.tier]}`,
              )
              .join('\n')
          : '_Equipo vacío._',
      ),
  );

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setTitle('Progreso')
      .setDescription(
        '```' +
          [
            `Misiones listas:  ${progreso.dailyReady + progreso.weeklyReady}`,
            `Logros:           ${progreso.achievementsUnlocked}/${progreso.achievementsTotal}`,
            `Bestiario:        ${dex.caught}/${dex.total} capturados`,
            `Formas abiertas:  ${coleccion.unlocked}/${coleccion.total}`,
            `PvP:              ${pvp.wins}W ${pvp.losses}L ${pvp.draws}D`,
            `Rango PvP:        ${pvp.rankEmoji} ${pvp.rank}`,
            `Títulos:          ${titulos.length}`,
          ].join('\n') +
          '```',
      ),
  );

  const componentes: ActionRowBuilder<ButtonBuilder>[] = [
    ...actionRow(
      [
        { screen: 'misiones', label: 'Misiones', emoji: '📋', style: ButtonStyle.Secondary },
        { screen: 'logros', label: 'Logros', emoji: '🏅', style: ButtonStyle.Secondary },
        { screen: 'bestiario', label: 'Bestiario', emoji: '📖', style: ButtonStyle.Secondary },
        { screen: 'titulos', label: 'Títulos', emoji: '🎖️', style: ButtonStyle.Secondary },
      ],
      session,
    ),
  ];

  componentes.push(navRow(session, { backLabel: 'Social' }));
  componentes.push(...areaRows(session, 'social'));

  return { embeds, components: componentes };
});

// ------------------------------------------------------- otros entrenadores

register('entrenadores', async (ctx) => {
  const { trainer, session } = ctx;
  const plantillas = getTemplates();

  const { page: p, pages, items } = paginate(plantillas, ctx.page(), 8);

  const embeds: EmbedBuilder[] = [
    header({
      area: 'social',
      title: 'ENTRENADORES',
      context: 'Los rivales que te puedes encontrar por el Mundo Digital.',
      color: COLORS.social,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setDescription(
        items
          .map((t) => rivalLine(t))
          .join('\n\n'),
      )
      .setFooter({ text: `${p}/${pages} de ${plantillas.length}` }),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  const pager = pageRow(session, 'entrenadores', {}, p, pages);

  const nav = navRow(session, { backLabel: 'Social' });
  if (pager) nav.components.push(...pager.components);
  components.push(nav);
  components.push(...areaRows(session, 'social'));

  return { embeds, components };
});

/**
 * Una tarjeta de rival.
 *
 * Los niveles salen del equipo y no del primero de la lista: una plantilla con
 * tres Digimon de niveles distintos y un "Nv.18" arriba engaña sobre lo difícil
 * que va a ser.
 */
function rivalLine(t: TrainerTemplate): string {
  const niveles = t.team.map((m) => m.level);
  const min = Math.min(...niveles);
  const max = Math.max(...niveles);
  const rango = min === max ? `Nv.${min}` : `Nv.${min}–${max}`;

  return (
    `${t.boss ? '👑' : '⚔️'} **${t.name}** · ${rango}\n` +
    `${t.intro}\n` +
    '`' +
    t.team.map((m) => getSpecies(m.speciesKey)?.emoji ?? '?').join(' ') +
    '` ' +
    t.team.map((m) => getSpecies(m.speciesKey)?.name ?? m.speciesKey).join(', ')
  );
}

// ------------------------------------------------------- clasificación ----

register('lb', async (ctx) => {
  const { trainer, session } = ctx;
  const pvp = getPvpProfile(trainer.id);
  const tabla = topTrainers(10);

  const embeds: EmbedBuilder[] = [
    header({
      area: 'social',
      title: 'CLASIFICACIÓN',
      context: `Temporada ${pvp.season} · ${pvp.rankEmoji} ${pvp.rank} · ${pvp.points} puntos`,
      color: COLORS.social,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));


  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setTitle('Por victorias')
      .setDescription(
        tabla.length > 0
          ? tabla
              .map(
                (t, i) =>
                  `${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  '} **${t.username}** · ${t.battlesWon} victorias · ${formatNumber(t.battlesWon * 100)} poder`,
              )
              .join('\n')
          : '_Todavía no hay nadie en la clasificación._',
      ),
  );

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setTitle('Tu posición PvP')
      .setDescription(
        [
          `Puntos: **${pvp.points}**`,
          `Victorias: **${pvp.wins}** · Derrotas: **${pvp.losses}**`,
          `Racha: **${pvp.streak}** día(s)`,
        ].join('\n'),
      ),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [
    ...actionRow(
      [
        { screen: 'combate', label: 'Combatir', emoji: '⚔️', style: ButtonStyle.Success },
        { screen: 'entrenadores', label: 'Entrenadores', emoji: '👥', style: ButtonStyle.Secondary },
      ],
      session,
    ),
  ];

  components.push(navRow(session, { backLabel: 'Social' }));
  components.push(...areaRows(session, 'social'));

  return { embeds, components };
});
