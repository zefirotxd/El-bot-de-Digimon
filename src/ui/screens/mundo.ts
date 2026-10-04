import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import {
  getProgress,
  listParty,
} from '../../game/repository.js';
import { dexOf } from '../../game/dexRepo.js';
import { ZONES, getZone, zoneRoster } from '../../game/zones.js';
import {
  blocker,
  challengeBoss,
  challengeRival,
  currentZoneOf,
  explore,
  travel,
  zoneView,
} from '../../services/world.js';
import type { Presenter } from '../../services/battleSession.js';
import {
  actionRow,
  areaRows,
  bar,
  header,
  navRow,
  paginate,
  pageRow,
  panel,
  playerField,
  type View,
} from '../components.js';
import { encodeNav } from '../nav.js';
import { register, type ScreenContext } from '../screen.js';
import { COLORS } from '../theme.js';

/**
 * El Mundo Digital.
 *
 * Tres pantallas encadenadas: mapa -> zona -> acción. No son tres comandos con
 * nombres parecidos, son tres lugares: el mapa dice dónde estás, la zona dice
 * qué hay aquí, y la acción ocurre donde estás.
 *
 * El mapa es un ASCII del mundo. Podría haber sido una lista de cinco líneas, y
 * funcionalmente es lo mismo, pero un sitio tiene que tener forma: si "viajar a
 * Bosque Gelido" es una opción más entre otras, no hay viaje, hay un formulario.
 */

/** El mapa del mundo, dibujado. */
function worldMap(current: string): string {
  const at = (key: string) => (current === key ? '📍' : '  ');

  return [
    '┌────────────────────────────────────────┐',
    '│                                        │',
    '│          MAPA DEL MUNDO DIGITAL        │',
    '│                                        │',
    '│   🏝️ Isla del Despertar                │',
    '│        │                               │',
    '│   🌲 Bosque Gelido ──── 🌋 Volcán     │',
    '│        │                               │',
    '│   🏙️ Ciudad en Ruinas                 │',
    '│        │                               │',
    '│   🕳️ Abismo Sin Nombre                │',
    '│                                        │',
    `│   ${at('isla_inicial')} estás aquí: ${
      ZONES.find((z) => z.key === current)?.name ?? 'Isla del Despertar'
    }`.padEnd(40) + '│',
    '│                                        │',
    '└────────────────────────────────────────┘',
  ].join('\n');
}

register('mapa', async (ctx) => {
  const { trainer, session } = ctx;
  const level = listParty(trainer.id)[0]?.level ?? 1;
  const progress = getProgress(trainer.id);
  const current = currentZoneOf(trainer.id);
  const page = ctx.page();

  const perPage = 3;
  const { page: p, pages, items } = paginate(ZONES, page, perPage);

  const embeds: EmbedBuilder[] = [
    header({
      area: 'mundo',
      title: 'MUNDO DIGITAL',
      context: `**${current.emoji} ${current.name}**\n\`\`\`${worldMap(current.key)}\`\`\``,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  // Un embed por zona en la página: los rangos grandes se leen mucho mejor en
  // tarjeta que como una lista de veinte líneas en un solo campo.
  for (const zone of items) {
    const view = zoneView(zone, level, progress);
    const fitLabel =
      view.fit === 'bajo' ? '🔒 te quedarás corto' : view.fit === 'fácil' ? 'te queda corta' : '✅ bien';

    embeds.push(
      new EmbedBuilder()
        .setColor(view.isHere ? COLORS.success : view.fit === 'bajo' ? COLORS.neutral : COLORS.mundo)
        .setAuthor({
          name: `${zone.emoji} ${zone.name}${view.isHere ? '  ·  ESTÁS AQUÍ' : ''}`,
        })
        .setDescription(
          '```' +
            panel(
              `NIVEL ${zone.minLevel}–${zone.maxLevel}  ·  RECOMPENSA ×${zone.bonus}`,
              [
                `_${zone.description}_`,
                '',
                `${zoneRoster(zone).slice(0, 10).map((s) => s.emoji).join(' ')}`,
                `Rivals: ${view.rivals.join(', ') || '—'}`,
                zone.boss
                  ? `Guardián: ${view.bossName ?? '—'} ${view.bossBeaten ? '✓' : '👑 sin derrotar'}`
                  : 'Guardián: —',
              ],
            ) +
            '```',
        )
        .addFields({ name: 'Estado', value: fitLabel, inline: true })
        .addFields({
          name: 'Acción',
          value:
            view.isHere
              ? 'Pulsa **Entrar** para ver qué hay dentro.'
              : 'Pulsa **Viajar** para moverte aquí.',
          inline: true,
        }),
    );
  }

  // ----------------------------------------------------------- acciones ---
  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  // Fila 1: navegación + viaje, en una sola.
  //
  // Discord admite cinco filas de botones por mensaje y esta pantalla llega
  // justo al límite. Con la navegación y el viaje en filas separadas eran seis,
  // y Discord rechaza el mensaje ENTERO cuando se pasa: no sale ni una fila, así
  // que el jugador se queda sin mapa y sin forma de moverse.
  const nav = navRow(session);
  for (const zone of items) {
    nav.addComponents(
      new ButtonBuilder()
        .setCustomId(encodeNav(session, 'ir', { z: zone.key, page: String(p) }))
        .setLabel(zone.key === current.key ? 'Entrar' : 'Viajar')
        .setEmoji(zone.emoji)
        .setStyle(zone.key === current.key ? ButtonStyle.Success : ButtonStyle.Primary),
    );
  }
  components.push(nav);

  // Fila 2: atajos a otras áreas y paginación.
  const acceso = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(session, 'combate'))
      .setLabel('Combatir')
      .setEmoji('⚔️')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(encodeNav(session, 'ciudad'))
      .setLabel('Ciudad')
      .setEmoji('🏪')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(encodeNav(session, 'dungeon'))
      .setLabel('Mazmorras')
      .setEmoji('🗝️')
      .setStyle(ButtonStyle.Secondary),
  );

  const pager = pageRow(session, 'mapa', {}, p, pages);
  // La paginación va en su propia fila: juntarla con los tres atajos son seis
  // botones y Discord admite cinco por fila.
  components.push(acceso);
  if (pager) components.push(pager);

  components.push(...areaRows(session, 'mundo'));

  return { embeds, components };
});

// --------------------------------------------------------------- viajar ---

register('ir', async (ctx) => {
  const key = ctx.params.z ?? '';
  const zone = getZone(key);

  if (!zone) {
    ctx.flash('Esa zona no existe.', 'error');
    return ctx.go('mapa');
  }

  const result = travel(ctx.trainer.id, zone.key);
  ctx.flash(result.message, 'ok');

  return ctx.go('zona', { z: zone.key });
});

// ---------------------------------------------------------------- zona ---

register('zona', async (ctx) => {
  const { trainer, session } = ctx;
  const zone = getZone(ctx.params.z ?? '');
  const progress = getProgress(trainer.id);
  const level = listParty(trainer.id)[0]?.level ?? 1;

  if (!zone) {
    ctx.flash('Esa zona no existe.', 'error');
    return ctx.go('mapa');
  }

  const view = zoneView(zone, level, progress);
  const roster = view.roster;
  const dex = dexOf(trainer.id);

  // Cuántos de la zona hay en el bestiario: convierte "hay 12 especies" en
  // "te faltan 5", que es una razón para volver y no solo un dato.
  const registrados = roster.filter((s) => dex.has(s.key)).length;
  const capturados = roster.filter((s) => dex.get(s.key)?.caught).length;

  const embeds: EmbedBuilder[] = [
    header({
      area: 'mundo',
      title: zone.name.toUpperCase(),
      context:
        `${zone.description}\n` +
        `**Nivel recomendado:** ${zone.minLevel}–${zone.maxLevel}  ·  ` +
        `**Recompensa:** ×${zone.bonus}  ·  ` +
        `**Tú:** Nv.${level}  ·  ` +
        (view.fit === 'bajo' ? '⚠️ `te quedarás corto`' : view.fit === 'fácil' ? 'esta zona se te queda corta' : '✅ nivel adecuado'),
      color: view.fit === 'bajo' ? COLORS.warning : COLORS.mundo,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.mundo)
      .setDescription(
        '```' +
          panel(`INFORMACIÓN DE ${zone.name.toUpperCase()}`, [
            `🌿 Encuentros disponibles: ${roster.length}`,
            `⚔️ Rivales encontrados:  ${view.rivals.length}`,
            `👑 Guardián:             ${view.bossName ?? '—'}${view.bossBeaten ? '  (derrotado)' : ''}`,
            '',
            `📖 Registrados aquí:  ${registrados}/${roster.length}`,
            `🎯 Capturados aquí:   ${capturados}/${roster.length}`,
            `🎁 Recompensa de zona: ×${zone.bonus} DigiBytes`,
          ]) +
          '```',
      ),
  );

  // Bestiario de la zona: qué te puede salir.
  const page = ctx.page();
  const { page: p, pages, items } = paginate(roster, page, 8);

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setTitle('Encuentros de la zona')
      .setDescription(
        items.length > 0
          ? items
              .map((s) => {
                const entry = dex.get(s.key);
                const mark = entry?.caught ? '✔️' : entry ? '👁️' : '❔';
                return `${mark} ${s.emoji} ${s.name}${entry?.captures ? ` \`×${entry.captures}\`` : ''}`;
              })
              .join('\n')
          : '_Esta zona no tiene encuentros registrados._',
      )
      .setFooter({ text: `${p}/${pages} · ✔️ capturado  👁️ visto  ❔ sin ver` }),
  );

  // ----------------------------------------------------------- botones ---
  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  // Fila 1: las tres acciones de la zona. Es el corazón de la pantalla.
  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeNav(session, 'explorar', { z: zone.key }))
        .setLabel('Explorar')
        .setEmoji('🔎')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(encodeNav(session, 'rival', { z: zone.key }))
        .setLabel('Buscar rival')
        .setEmoji('⚔️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(view.rivals.length === 0),
      new ButtonBuilder()
        .setCustomId(encodeNav(session, 'guar', { z: zone.key }))
        .setLabel(view.bossBeaten ? 'Retar de nuevo' : 'Guardián')
        .setEmoji('👑')
        .setStyle(view.bossBeaten ? ButtonStyle.Secondary : ButtonStyle.Danger)
        .setDisabled(!zone.boss),
    ),
  );

  // Fila 2: bestiario, mapa, mazmorras.
  const pager = pageRow(session, 'zona', { z: zone.key }, p, pages);

  const info = new ActionRowBuilder<ButtonBuilder>();
  info.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(session, 'bestiario', { zone: zone.key }))
      .setLabel('Bestiario')
      .setEmoji('📖')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(encodeNav(session, 'mapa'))
      .setLabel('Mapa')
      .setEmoji('🗺️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(encodeNav(session, 'bestiario'))
      .setLabel('Todos los Digimon')
      .setEmoji('📚')
      .setStyle(ButtonStyle.Secondary),
  );
  if (pager) info.addComponents(pager.components[0]!);
  components.push(info);

  components.push(navRow(session, { backLabel: 'Volver al mapa' }));
  components.push(...areaRows(session, 'mundo'));

  return { embeds, components };
});

// ------------------------------------------------------------ acciones ---

/**
 * Presentador que edita el mensaje actual.
 *
 * Es lo que hace que "Explorar" convierta la pantalla de zona en la pantalla de
 * combate en el mismo sitio, en vez de dejar la zona colgada arriba y el combate
 * en un mensaje nuevo que el jugador tiene que encontrar.
 */
function editor(ctx: ScreenContext): Presenter {
  return async (payload) => {
    // El router ya ha hecho `deferUpdate`, así que `editReply` es lo válido:
    // un clic de botón no puede volver a responder.
    await (ctx.interaction as unknown as {
      editReply: (p: unknown) => Promise<unknown>;
    }).editReply(payload);

    // Para colgar los collectors del combate hace falta el `Message`. En un clic
    // de botón, el mensaje original es exactamente ese.
    return (ctx.interaction as unknown as { message: unknown }).message as never;
  };
}

register('explorar', async (ctx) => {
  const blocked = await explore(
    ctx.interaction,
    ctx.trainer.id,
    editor(ctx),
  );

  // Si el servicio ha podido lanzar el combate, la pantalla ya no es nuestra:
  // el combate ha tomado el mensaje.
  // El combate ya ha tomado el mensaje. Devolver una vista vacía aquí lo
  // borraría encima, que es justo lo que pasaba antes.
  if (!blocked) return;

  ctx.flash(blocked.message, 'aviso');
  return ctx.go('zona', { z: ctx.params.z ?? '' });
});

register('rival', async (ctx) => {
  const blocked = await challengeRival(ctx.interaction, ctx.trainer.id, editor(ctx));
  // El combate ya ha tomado el mensaje. Devolver una vista vacía aquí lo
  // borraría encima, que es justo lo que pasaba antes.
  if (!blocked) return;

  ctx.flash(blocked.message, 'aviso');
  return ctx.go('zona', { z: ctx.params.z ?? '' });
});

register('guar', async (ctx) => {
  const blocked = await challengeBoss(ctx.interaction, ctx.trainer.id, editor(ctx));
  // El combate ya ha tomado el mensaje. Devolver una vista vacía aquí lo
  // borraría encima, que es justo lo que pasaba antes.
  if (!blocked) return;

  ctx.flash(blocked.message, 'aviso');
  return ctx.go('zona', { z: ctx.params.z ?? '' });
});

// -------------------------------------------------------------- apoyo ---
