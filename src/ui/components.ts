import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type APIEmbedField,
  EmbedBuilder,
} from 'discord.js';
import type { Trainer } from '../game/repository.js';
import { countPartySlots, countPCSlots, getLeader } from '../game/repository.js';
import { config } from '../config.js';
import { energyOf } from '../game/dungeonRepo.js';
import { queueSize } from '../services/pvpQueue.js';
import { summaryOf } from '../game/progressionRepo.js';
import { encodeNav } from './nav.js';
import { canGoBack, type NavEntry, type NavSession } from './session.js';
import { AREA_EMOJI, AREA_HOME, AREAS, COLORS, type AreaKey } from './theme.js';

/**
 * Piezas de construcción de todas las pantallas.
 *
 * Todo lo que se repite vive aquí para que las pantallas sean cortas y para que
 * los botones de "atrás" y "Digivice" sean SIEMPRE iguales. Esa uniformidad es
 * lo que hace que el jugador sepa moverse sin leer: si hay un botón azul abajo a
 * la izquierda, lleva a casa, en todas partes.
 */

export interface NavButton {
  screen: string;
  label: string;
  emoji?: string;
  params?: Record<string, string>;
  style?: ButtonStyle;
  disabled?: boolean;
}

/** Un embed ya montage: lo que una pantalla devuelve. */
export interface View {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<any>[];
}

/**
 * Cabecera de pantalla.
 *
 * Siempre con el mismo esqueleto: color del área, título, y una línea de
 * contexto con dónde está el jugador. Que la cabecera sea idéntica en forma en
 * las seis áreas es lo que hace que el conjunto se lea como un solo juego.
 */
export function header(options: {
  area: AreaKey;
  title: string;
  /** Dónde está el jugador, en una línea. Ej: "Zona: Bosque Gelido". */
  context?: string;
  color?: number;
}): EmbedBuilder {
  const emoji = AREA_EMOJI[options.area];
  const embed = new EmbedBuilder()
    .setColor(options.color ?? COLORS[options.area])
    .setAuthor({ name: `${emoji} ${options.title}` });

  if (options.context) {
    embed.setDescription(options.context);
  }

  return embed;
}

/**
 * Barra de estado del jugador: lo que tienes a mano en cualquier pantalla.
 *
 * Va como campo, no como embed aparte, para no gastar uno de los diez.
 */
export function playerField(trainer: Trainer): APIEmbedField {
  const leader = getLeader(trainer.id);
  const energy = energyOf(trainer.id);
  const progress = summaryOf(trainer.id);

  const partes: string[] = [];
  if (leader) partes.push(`${leader.species.emoji} ${leader.nickname ?? leader.species.name} Nv.${leader.level}`);
  partes.push(`💰 **${formatBytes(trainer.digibytes)}** DB`);
  partes.push(`⚡ ${energy.energy}/${energy.max}`);

  const extras: string[] = [];
  extras.push(`Equipo ${countPartySlots(trainer.id)}/${config.maxPartySize}`);
  extras.push(`PC ${countPCSlots(trainer.id)}/${config.pcCapacity}`);
  extras.push(`📋 ${progress.dailyReady + progress.weeklyReady} listas`);
  extras.push(`🏅 ${progress.achievementsUnlocked}/${progress.achievementsTotal}`);
  if (queueSize() > 0) extras.push(`⚔️ ${queueSize()} en cola`);

  return {
    name: `${trainer.username}`,
    value: `${partes.join('  ·  ')}\n\`\`\`${extras.join('   ')}\`\`\``,
    inline: false,
  };
}

export function formatBytes(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

/**
 * Fila de navegación: atrás, inicio y, si se puede, el nombre de donde vienes.
 *
 * Es la fila más importante del juego. Va siempre la primera para que el jugador
 * la encuentre sin recorrer botones, y los dos botones están siempre en el
 * mismo orden.
 */
export function navRow(
  session: NavSession,
  options: {
    /** Etiqueta del botón de atrás. Por defecto "Atrás". */
    backLabel?: string;
    /** Texto de "vuelvo a donde estaba". */
    backTo?: NavEntry;
    /** Botón "Atrás" deshabilitado si no hay historial. */
    hideBack?: boolean;
  } = {},
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();

  if (!options.hideBack) {
    const back = options.backTo;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(back ? encodeNav(session, back.screen, back.params) : 'n:__noop:x')
        .setLabel(options.backLabel ?? 'Atrás')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!back),
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(session, 'hub'))
      .setLabel('Digivice')
      .setEmoji('📟')
      .setStyle(ButtonStyle.Primary),
  );

  return row;
}

/**
 * Fila de selección de área.
 *
 * Seis botones en dos filas de tres (Discord admite cinco por fila y aquí no
 * cabrían seis). Es el mapa del juego: desde cualquier pantalla se llega a
 * cualquier área en dos clics.
 */
export function areaRows(session: NavSession, current?: AreaKey): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let i = 0; i < AREAS.length; i += 3) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const area of AREAS.slice(i, i + 3)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(session, AREA_HOME[area.key]))
          .setLabel(area.label)
          .setEmoji(area.emoji)
          .setStyle(current === area.key ? ButtonStyle.Success : ButtonStyle.Secondary),
      );
    }
    rows.push(row);
  }

  return rows;
}

/** Fila de acciones: botones con estilo, de tres en tres. */
export function actionRow(buttons: NavButton[], session: NavSession): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let i = 0; i < buttons.length; i += 3) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const button of buttons.slice(i, i + 3)) {
      const b = new ButtonBuilder()
        .setCustomId(encodeNav(session, button.screen, button.params))
        .setLabel(button.label.slice(0, 80))
        .setStyle(button.style ?? ButtonStyle.Secondary);

      if (button.emoji) b.setEmoji(button.emoji);
      if (button.disabled) b.setDisabled(true);
      row.addComponents(b);
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Paginación.
 *
 * Las flechas llevan la pantalla y la página, así que el botón de "atrás" de la
 * lista devuelva a la página 3, no a la 1. Por eso la página va en los
 * parámetros de la entrada de la pila.
 */
export function pageRow(
  session: NavSession,
  screen: string,
  params: Record<string, string>,
  page: number,
  pages: number,
): ActionRowBuilder<ButtonBuilder> | null {
  if (pages <= 1) return null;

  const row = new ActionRowBuilder<ButtonBuilder>();
  const at = (n: number) => ({ ...params, page: String(n) });

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(session, screen, at(page - 1)))
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
  );

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(session, screen, params))
      .setLabel(`${page}/${pages}`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true),
  );

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(session, screen, at(page + 1)))
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pages),
  );

  return row;
}

/** Reparte una lista en páginas y devuelve la que toca. */
export function paginate<T>(items: T[], page: number, perPage: number): {
  page: number;
  pages: number;
  items: T[];
} {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const clamped = Math.min(Math.max(1, page), pages);
  const start = (clamped - 1) * perPage;
  return { page: clamped, pages, items: items.slice(start, start + perPage) };
}

/**
 * Botón de confirmación.
 *
 * Lo usan las acciones irreversibles (vender, evolucionar, entrar en una
 * mazmorra): primero se explica qué va a pasar y se pide el sí, porque un clic
 * con consequence en un mensaje que se desliza es un clic que nadie quiere
 * hacer.
 */
export function confirmRow(
  session: NavSession,
  options: {
    confirmScreen: string;
    confirmParams?: Record<string, string>;
    confirmLabel?: string;
    cancelScreen?: string;
    cancelParams?: Record<string, string>;
    cancelLabel?: string;
  },
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(session, options.confirmScreen, options.confirmParams))
      .setLabel(options.confirmLabel ?? 'Confirmar')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(encodeNav(session, options.cancelScreen ?? 'hub', options.cancelParams))
      .setLabel(options.cancelLabel ?? 'Cancelar')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Secondary),
  );
}

/** Panel informativo: el bloque con marco que pide la maqueta. */
export function panel(title: string, lines: string[], width = 40): string {
  const top = `╔${'═'.repeat(width)}╗`;
  const bottom = `╚${'═'.repeat(width)}╝`;
  const body = lines.flatMap((line) => {
    // Las líneas largas se parten: Discord corta a 2000 y un marco a media
    // altura queda feo, que es peor que perder un salto.
    const parts: string[] = [];
    let rest = line;
    while (rest.length > width - 4) {
      parts.push(rest.slice(0, width - 4));
      rest = rest.slice(width - 4);
    }
    parts.push(rest);
    return parts;
  });

  return [
    top,
    `║ ${title.padEnd(width - 2).slice(0, width - 2)} ║`,
    `╟${'─'.repeat(width)}╢`,
    ...body.map((line) => `║ ${line.padEnd(width - 2).slice(0, width - 2)} ║`),
    bottom,
  ].join('\n');
}

/** Barra de progreso con bloques. */
export function bar(current: number, max: number, width = 12): string {
  const ratio = max <= 0 ? 0 : Math.max(0, Math.min(1, current / max));
  const filled = Math.round(ratio * width);
  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`;
}

/** Avisa de algo en la parte de arriba, sin robar una pantalla entera. */
export function notice(
  message: string,
  kind: 'ok' | 'aviso' | 'error' = 'ok',
): EmbedBuilder {
  const color = kind === 'ok' ? COLORS.success : kind === 'aviso' ? COLORS.warning : COLORS.danger;
  const icon = kind === 'ok' ? '✅' : kind === 'aviso' ? '⚠️' : '❌';
  return new EmbedBuilder().setColor(color).setDescription(`${icon} ${message}`);
}

export { canGoBack };