import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getProgress, listParty } from '../../game/repository.js';
import { getDungeon, DUNGEONS as MAZMORRAS, type DungeonDef } from '../../game/dungeons.js';
import {
  DAILY_ENERGY,
  canEnterDungeon,
  clearCount,
  energyOf,
  runOf,
  worldBossLeaderboard,
  worldBossState,
  type DungeonAccess,
  type RunStatus,
  myContribution,
} from '../../game/dungeonRepo.js';
import { getPvpProfile, recentMatches, claimDaily, dailyStatus } from '../../game/pvpRepo.js';
import { teamPower, formatPower } from '../../game/power.js';
import {
  activeMatchOf,
  enqueue,
  getQueueEntry,
  isInMatch,
  isQueued,
  leaveQueue,
  queueSize,
  waitingSeconds,
} from '../../services/pvpQueue.js';
import {
  actionRow,
  areaRows,
  formatBytes,
  header,
  navRow,
  playerField,
} from '../components.js';
import { encodeNav } from '../nav.js';
import { register } from '../screen.js';
import { COLORS } from '../theme.js';
import { currentZoneOf, zoneView } from '../../services/world.js';

/**
 * Combate y mazmorras.
 *
 * El hub de combate tiene tres salidas: contra el Mundo (lo que ya hacían
 * `/zonas`), contra otros jugadores, y contra los jefes de mazmorra. Son
 * problemas distintos —niveles, energía, emparejamiento— y por eso son tres
 * secciones y no una sola con tres botones.
 */

// ------------------------------------------------------------- combate ----

register('combate', async (ctx) => {
  const { trainer, session } = ctx;
  const party = listParty(trainer.id);
  const progress = getProgress(trainer.id);
  const zone = currentZoneOf(trainer.id);
  const vista = zoneView(zone, listParty(trainer.id)[0]?.level ?? 1, progress);

  const embeds: EmbedBuilder[] = [
    header({
      area: 'combate',
      title: 'COMBATE',
      context: '¿Con quién te peleas hoy?',
      color: COLORS.combate,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  const energia = energyOf(trainer.id);
  const poder = teamPower(party);

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.combate)
      .setTitle('Tus números')
      .setDescription(
        '```' +
          [
            `Equipo:     ${party.length} Digimon`,
            `Poder:      ${formatPower(poder.total)}`,
            `Zona:       ${zone.emoji} ${zone.name}`,
            `Energía:    ${energia.energy}/${energia.max}`,
            `Jefes:      ${progress.bossesFound} derrotados`,
          ].join('\n') +
          '```',
      ),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [
    ...actionRow(
      [
        { screen: 'pve', label: 'Zona', emoji: zone.emoji, style: ButtonStyle.Success },
        { screen: 'dungeon', label: 'Mazmorras', emoji: '🗝️', style: ButtonStyle.Primary },
        { screen: 'pvp', label: 'PvP', emoji: '⚔️', style: ButtonStyle.Primary },
        { screen: 'pvp_historial', label: 'Historial', emoji: '📜', style: ButtonStyle.Secondary },
      ],
      session,
    ),
  ];

  components.push(navRow(session));
  components.push(...areaRows(session, 'combate'));
  void vista;

  return { embeds, components };
});

// ------------------------------------------------------------------ PvE ---

register('pve', async (ctx) => {
  const { trainer, session } = ctx;
  const party = listParty(trainer.id);
  const level = party[0]?.level ?? 1;
  const progress = getProgress(trainer.id);
  const zona = currentZoneOf(trainer.id);
  const vista = zoneView(zona, level, progress);

  const embeds: EmbedBuilder[] = [
    header({
      area: 'combate',
      title: `ZONA ACTUAL: ${zona.name.toUpperCase()}`,
      context:
        `${zona.description}\n` +
        `Nivel recomendado **${zona.minLevel}–${zona.maxLevel}**  ·  ` +
        `Recompensa **×${zona.bonus}**`,
      color: vista.fit === 'bajo' ? COLORS.warning : COLORS.combate,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setDescription(
        '```' +
          [
            `Rivales:      ${vista.rivals.length}`,
            `Guardián:     ${vista.bossName ?? '—'}${vista.bossBeaten ? ' (derrotado)' : ''}`,
            `Encuentros:   ${vista.roster.length}`,
          ].join('\n') +
          '```',
      ),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [
    ...actionRow(
      [
        { screen: 'mapa', label: 'Cambiar de zona', emoji: '🗺️', style: ButtonStyle.Secondary },
        { screen: 'dungeon', label: 'Mazmorras', emoji: '🗝️', style: ButtonStyle.Secondary },
        { screen: 'rival', label: 'Buscar rival', emoji: '⚔️', style: ButtonStyle.Primary },
        { screen: 'guar', label: 'Guardián', emoji: '👑', style: ButtonStyle.Danger },
      ],
      session,
    ),
  ];

  components.push(navRow(session, { backLabel: 'Combate' }));
  components.push(...areaRows(session, 'combate'));

  return { embeds, components };
});

// ------------------------------------------------------------------ PvP ---

register('pvp', async (ctx) => {
  const { trainer, session } = ctx;
  const party = listParty(trainer.id);
  const pvp = getPvpProfile(trainer.id);
  const enCola = isQueued(trainer.id);
  const enPartida = isInMatch(trainer.id);
  const espera = enCola ? waitingSeconds(trainer.id) : 0;

  const embeds: EmbedBuilder[] = [
    header({
      area: 'combate',
      title: 'ARENA',
      context:
        `${pvp.rankEmoji} **${pvp.rank}**  ·  ${pvp.points} puntos  ·  ` +
        `${pvp.wins}W ${pvp.losses}L\n` +
        (enCola
          ? `⏳ Buscando rival desde hace **${espera}s**…`
          : enPartida
            ? '⚔️ **Tienes una partida en curso.**'
            : queueSize() > 0
              ? `Hay **${queueSize()}** entrenador(es) en cola.`
              : 'Sin nadie en cola todavía.'),
      color: COLORS.combate,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  if (party.length === 0) {
    embeds.push(
      new EmbedBuilder()
        .setColor(COLORS.warning)
        .setDescription('⚠️ Necesitas al menos un Digimon para pelear.'),
    );
  }

  const daily = dailyStatus(trainer.id);

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setTitle('Tu temporada')
      .setDescription(
        [
          `Rango: ${pvp.rankEmoji} ${pvp.rank}`,
          pvp.nextRankPoints !== null
            ? `Siguiente rango en **${pvp.nextRankPoints - pvp.points}** puntos`
            : 'Rango máximo alcanzado',
          `Racha diaria: **${pvp.streak}** día(s)`,
          daily.claimed ? 'Recompensa diaria: reclamada ✓' : 'Recompensa diaria: disponible 🎁',
        ].join('\n'),
      ),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  const fila = new ActionRowBuilder<ButtonBuilder>();

  if (enPartida) {
    fila.addComponents(
      new ButtonBuilder()
        .setCustomId(encodeNav(session, 'pvp'))
        .setLabel('Volver a la partida')
        .setEmoji('⚔️')
        .setStyle(ButtonStyle.Danger),
    );
  } else if (enCola) {
    fila.addComponents(
      new ButtonBuilder()
        .setCustomId(encodeNav(session, 'pvp_salir'))
        .setLabel('Salir de la cola')
        .setEmoji('🚪')
        .setStyle(ButtonStyle.Secondary),
    );
  } else {
    fila.addComponents(
      new ButtonBuilder()
        .setCustomId(encodeNav(session, 'pvp_entrar'))
        .setLabel('Buscar rival')
        .setEmoji('🔍')
        .setStyle(ButtonStyle.Success)
        .setDisabled(party.length === 0),
    );
  }

  fila.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(session, 'pvp_diaria'))
      .setLabel(daily.claimed ? 'Diaria reclamada' : 'Recompensa diaria')
      .setEmoji(daily.claimed ? '✅' : '🎁')
      .setStyle(daily.claimed ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(daily.claimed),
  );

  components.push(fila);

  components.push(
    ...actionRow(
      [
        { screen: 'pvp_historial', label: 'Historial', emoji: '📜', style: ButtonStyle.Secondary },
        { screen: 'lb', label: 'Clasificación', emoji: '🏆', style: ButtonStyle.Secondary },
      ],
      session,
    ),
  );

  components.push(navRow(session, { backLabel: 'Combate' }));
  components.push(...areaRows(session, 'combate'));

  return { embeds, components };
});

register('pvp_entrar', async (ctx) => {
  // La cola se lleva por Discord, no por una tabla: los dos jugadores
  // tienen que poder avisarse el uno al otro. Por eso necesita canal.
  const canal = canalDe(ctx.interaction);

  if (!canal) {
    ctx.flash('La arena necesita un canal para avisar. Usa `/pvp` desde un canal de texto.', 'aviso');
    return ctx.refresh('pvp');
  }

  const result = enqueue(
    ctx.trainer.discordId,
    canal,
    ctx.trainer.username,
  );

  // `reason` es opcional en `EnqueueResult`: sin él no hay motivo que enseñar.
  if (!result.ok) {
    ctx.flash(mensajeCola(result.reason), 'aviso');
  } else {
    ctx.flash('🔍 Buscando rival...', 'ok');
  }

  return ctx.refresh('pvp');
});

/** El canal donde avisar, o null si la interacción no lo tiene. */
function canalDe(interaction: unknown): string | null {
  const i = interaction as { channelId?: string; channel?: { id?: string } };
  return i.channelId ?? i.channel?.id ?? null;
}

register('pvp_salir', async (ctx) => {
  leaveQueue(ctx.trainer.id);
  ctx.flash('Has salido de la cola.', 'ok');
  return ctx.refresh('pvp');
});

register('pvp_diaria', async (ctx) => {
  const reward = claimDaily(ctx.trainer.id);

  ctx.flash(
    reward ? `🎁 Recompensa diaria: ${reward.digibytes} DB` : 'Ya la habías reclamado hoy.',
    reward ? 'ok' : 'aviso',
  );

  return ctx.refresh('pvp');
});

register('pvp_historial', async (ctx) => {
  const { trainer, session } = ctx;
  const partidas = recentMatches(trainer.id, 10);

  const embeds: EmbedBuilder[] = [
    header({
      area: 'combate',
      title: 'HISTORIAL',
      context: 'Tus últimas partidas de la arena.',
      color: COLORS.combate,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setDescription(
        partidas.length > 0
          ? partidas
              .map((m) => {
                const marca =
                  m.outcome === 'victoria' ? '🟢' : m.outcome === 'empate' ? '⚪' : '🔴';
                return (
                  `${marca} **${m.opponent}** · ` +
                  `${m.outcome} · ${m.reason}`
                );
              })
              .join('\n')
          : '_Todavía no has jugado ninguna partida._',
      ),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [
    navRow(session, { backLabel: 'Arena' }),
    ...areaRows(session, 'combate'),
  ];

  return { embeds, components };
});

function mensajeCola(reason?: string): string {
  switch (reason) {
    case 'ya-en-cola':
      return 'Ya estás en la cola.';
    case 'en-partida':
      return 'Tienes una partida en curso.';
    case 'sin-equipo':
      return 'Necesitas al menos dos Digimon para pelear en la arena.';
    case 'equipo-grande':
      return 'Tu equipo es demasiado grande. Deja alguno en el PC.';
    case 'revancha':
      return 'Aún no puedes volver a pelear contra ese rival (30 minutos).';
    default:
      return 'No se pudo entrar en la cola.';
  }
}

// -------------------------------------------------------------- mazmorras -

register('dungeon', async (ctx) => {
  const { trainer, session } = ctx;
  const energia = energyOf(trainer.id);
  const nivel = listParty(trainer.id)[0]?.level ?? 1;

  const embeds: EmbedBuilder[] = [
    header({
      area: 'combate',
      title: 'MAZMORRAS',
      context:
        `⚡ Energía: **${energia.energy}/${energia.max}** (se recarga cada día)\n` +
        'Las salas se guardan: puedes entrar, dejar y volver cuando quieras.',
      color: COLORS.combate,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  // Un embed por mazmorra, con su botón en las filas de abajo.
  const entradas: {
    dungeon: DungeonDef;
    acceso: DungeonAccess;
    enMarcha: RunStatus | null;
  }[] = [];

  for (const dungeon of Object.values(MAZMORRAS)) {
    const acceso = canEnterDungeon(trainer.id, dungeon, nivel);
    const enMarcha = runOf(trainer.id, dungeon.key);
    const veces = clearCount(trainer.id, dungeon.key);

    entradas.push({ dungeon, acceso, enMarcha });

    embeds.push(
      new EmbedBuilder()
        .setColor(acceso.ok ? COLORS.combate : COLORS.neutral)
        .setAuthor({ name: `${dungeon.emoji} ${dungeon.name}` })
        .setDescription(
          `_\n${dungeon.lore}_\n` +
            `\`Nivel ${dungeon.minLevel}+  ·  Salas: ${dungeon.rooms.length}  ·  Completadas: ${veces}\`\n` +
            `⚡ Cuesta ${dungeon.energyCost} de energía  ·  ${dungeon.dailyAttempts} intentos al día` +
            (enMarcha
              ? `\n▶️ **En curso:** sala ${enMarcha.roomIndex + 1}/${dungeon.rooms.length}`
              : ''),
        )
        .addFields({
          name: acceso.ok ? 'Estado' : 'Bloqueada',
          value: acceso.ok ? 'Puedes entrar.' : acceso.message,
          inline: true,
        })
        .addFields({
          name: 'Intentos hoy',
          value: enMarcha ? `Quedan **${enMarcha.attemptsLeft}**` : acceso.ok ? 'Disponibles' : '—',
          inline: true,
        }),
    );
  }

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  // El jefe mundial solo se ofrece mientras la ventana está abierta.
  const jefe = worldBossState();

  if (!jefe.expired) {
    const mio = myContribution(trainer.id);
    const top = worldBossLeaderboard(5);

    embeds.push(
      new EmbedBuilder()
        .setColor(COLORS.legendary)
        .setTitle(`${jefe.emoji} ${jefe.name}`)
        .setDescription(
          `\`PV: ${jefe.currentHp}/${jefe.maxHp}  ·  ${Math.round(jefe.remaining * 100)}% vivo\`\n` +
            `Tu daño: **${mio?.damage ?? 0}** (${mio?.hits ?? 0} golpe(s))\n\n` +
            (top.length > 0
              ? top.map((r, k) => `${k + 1}. **${r.username}** · ${r.damage}`).join('\n')
              : '_Todavía nadie ha pegado._'),
        )
        .setFooter({ text: `Termina ${jefe.endsAt}` }),
    );

    components.push(
      ...actionRow(
        [
          { screen: 'jefemundo', label: 'Atacar al jefe', emoji: '⚔️', style: ButtonStyle.Danger },
        ],
        session,
      ),
    );
  }

  for (let i = 0; i < entradas.length; i += 3) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const { dungeon, acceso, enMarcha } of entradas.slice(i, i + 3)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(session, 'maz_entrar', { key: dungeon.key }))
          .setLabel(enMarcha ? 'Continuar' : dungeon.name)
          .setEmoji('🗝️')
          .setStyle(acceso.ok ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(!acceso.ok),
      );
    }
    components.push(row);
  }

  components.push(navRow(session, { backLabel: 'Combate' }));
  components.push(...areaRows(session, 'combate'));

  return { embeds, components };
});

/**
 * Atacar al jefe mundial.
 *
 * La raid tiene su propia sesion de combate (con telegrafiado y todo), asi
 * que esto no es mas que lanzarla sobre el mensaje actual. La pantalla no
 * pinta nada encima: la raid se queda con el mensaje.
 */
register('jefemundo', async (ctx) => {
  const { startRaid } = await import('../../services/battleSession.js');

  await startRaid(ctx.interaction as never);

  return;
});

register('maz_entrar', async (ctx) => {
  const key = ctx.params.key ?? '';
  const dungeon = getDungeon(key);

  if (!dungeon) {
    ctx.flash('Esa mazmorra no existe.', 'error');
    return ctx.go('dungeon');
  }

  // La lógica de entrada (energía, intento diario, reanudación) vive en
  // `startRun`. Aquí solo se llama.
  const { startDungeon } = await import('../../services/battleSession.js');
  await startDungeon(ctx.interaction as never, key);

  return;
});
