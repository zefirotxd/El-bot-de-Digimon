import {
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type RepliableInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { findTrainer } from '../game/repository.js';
import { decodeNav, isNavId } from './nav.js';
import { getScreen } from './screen.js';
import {
  canGoBack,
  ensureSession,
  getSession,
  nonceMatches,
  pop,
  push,
  pruneSessions,
  replace,
  rotateNonce,
  toRoot,
  type NavEntry,
  type NavSession,
} from './session.js';
import type { ScreenContext, View } from './screen.js';
import { notice as noticeEmbed } from './components.js';
import type { Trainer } from '../game/repository.js';

import './screens/index.js';

/**
 * Enrutador de la interfaz.
 *
 * Es el ÚNICO punto por el que pasa un clic de navegación. Antes había un `if`
 * por prefijo en `index.ts` (`dv:`, `zona:`, `mis:`) y cada pantalla decidía por
 * su cuenta qué hacer; los mensajes se quedaban muertos a los dos minutos y no
 * había forma de volver a donde venías.
 *
 * Aquí ocurre lo contrario: cada clic lleva un destino (`screen` + `params` +
 * `nonce`) y el enrutador se limita a ejecutar ese destino.
 */

/** Frases para el jugador, todas en el mismo sitio. */
const SELECT_PREFIX = "sel:";

/**
 * Un select de menú: `sel:<accion>:<nonce>:<valor>`.
 *
 * El `custom_id` del `n:` no sirve aquí porque el valor (el nombre de una
 * familia, "Dragon's Roar") lleva acentos y apostrofes que rompen el
 * formato de pares clave=valor. El router lo traduce a una navegación normal.
 */
export interface DecodedSelect {
  accion: string;
  nonce: string;
  valor: string;
}

export function isSelectId(customId: string): boolean {
  return customId.startsWith(SELECT_PREFIX);
}

export function decodeSelect(customId: string): DecodedSelect | null {
  const parts = customId.split(':');
  if (parts[0] !== SELECT_PREFIX || parts.length < 3) return null;
  return { accion: parts[1]!, nonce: parts[2]!, valor: parts[3] ?? '' };
}

const MESSAGES = {
  noTrainer: 'Usa `/perfil` para registrarte antes de entrar al Digivice.',
  stale: 'Este mensaje es viejo. Escribe `/digivice` para abrir la interfaz otra vez.',
  unknown: 'Ese botón no lleva a ningún sitio conocido.',
  error: '❌ Algo salió mal al cambiar de pantalla. Vuelve a intentarlo.',
  homeOnly: 'Ya estás en el Digivice.',
} as const;

let lastPrune = 0;

/** Poda las sesiones caducadas, como mucho una vez por minuto. */
function maybePrune(): void {
  const now = Date.now();
  if (now - lastPrune < 60_000) return;
  lastPrune = now;
  pruneSessions(now);
}

function makeContext(
  interaction: RepliableInteraction,
  trainer: Trainer,
  session: NavSession,
  params: Record<string, string>,
): ScreenContext {
  let answered = false;

  const context: ScreenContext = {
    interaction,
    trainer,
    session,
    params,

    async present(view: View) {
      const embeds = view.embeds.slice(0, 10);
      const components = view.components.slice(0, 5);

      if (answered) {
        // Una segunda `present` en la misma interacción no es válida en Discord.
        // Se avisa en consola en vez de romper el flujo del jugador.
        console.warn('[ui] present() llamado dos veces en la misma interacción');
        return;
      }
      answered = true;

      const payload = { embeds, components };

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload);
        return;
      }

      await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    },

    go(screen, nextParams = {}) {
      push(session, screen, nextParams);
      return render(interaction, trainer, session, screen, nextParams);
    },

    refresh(screen, nextParams = {}) {
      const target = screen ?? session.stack[session.stack.length - 1]?.screen ?? 'hub';
      const params = nextParams ?? session.stack[session.stack.length - 1]?.params ?? {};
      replace(session, target, params);
      return render(interaction, trainer, session, target, params);
    },

    async back() {
      const entry = pop(session);
      if (!entry) {
        context.flash(MESSAGES.homeOnly, 'aviso');
        return render(interaction, trainer, session, 'hub', {});
      }
      await render(interaction, trainer, session, entry.screen, entry.params);
    },

    home() {
      toRoot(session, 'hub', {});
      return render(interaction, trainer, session, 'hub', {});
    },

    flash(message, kind = 'ok') {
      session.flash = { message, kind };
    },

    num(key, fallback) {
      const raw = params[key];
      if (raw === undefined) return fallback;
      const value = Number(raw);
      return Number.isFinite(value) ? value : fallback;
    },

    page() {
      const raw = params.page;
      if (raw === undefined) return 1;
      const value = Number(raw);
      return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
    },
  };

  return context;
}

/**
 * Ejecuta una pantalla y pinta lo que devuelva.
 *
 * Añade el mensaje pendiente de la sesión y se asegura de que el jugador tenga
 * un Digimon: si no, se le manda a `/perfil` en vez de dejarle una pantalla
 * llena de ceros.
 */
async function render(
  interaction: RepliableInteraction,
  trainer: Trainer,
  session: NavSession,
  screen: string,
  params: Record<string, string>,
): Promise<void> {
  const handler = getScreen(screen);
  if (!handler) {
    await safeReply(interaction, MESSAGES.unknown);
    return;
  }

  // Cada render rota el nonce para invalidar el mensaje anterior.
  rotateNonce(session);

  const context = makeContext(interaction, trainer, session, params);

  try {
    const view = await handler(context);

    // Una pantalla que devuelve `void` ya ha pintado lo suyo y se ha hecho
    // cargo del mensaje. Lo usa el combate: al arrancarlo desde un boton, la
    // pantalla de zona no tiene nada que decir.
    if (!view) return;

    // El aviso pendiente se antepone: es la respuesta a lo que el jugador
    // acaba de hacer, y buryarlo al final es como se pierde.
    const flash = session.flash;
    if (flash) {
      session.flash = undefined;
      view.embeds.unshift(noticeEmbed(flash.message, flash.kind));
    }

    await context.present(view);
  } catch (error) {
    console.error(`[ui] fallo en la pantalla "${screen}":`, error);
    await safeReply(interaction, MESSAGES.error);
  }
}

/** Responde o edita, según el estado de la interacción. Sin petarse si no puede. */
async function safeReply(interaction: RepliableInteraction, message: string): Promise<void> {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message, embeds: [], components: [] });
      return;
    }
    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
  } catch {
    /* la interacción expiró: no hay nada que hacer */
  }
}

/**
 * Abre una pantalla desde un comando.
 *
 * Es el atajo `/digivice`, `/tienda`, `/pvp`…: los comandos siguen existiendo,
 * pero el jugador que entre por ahí recibe exactamente la misma pantalla que si
 * hubiera llegado pulsando botones.
 */
export async function open(
  interaction: ChatInputCommandInteraction,
  screen: string,
  params: Record<string, string> = {},
): Promise<void> {
  const trainer = findTrainer(interaction.user.id);
  if (!trainer) {
    await interaction.reply({
      content: MESSAGES.noTrainer,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  maybePrune();

  // Un comando es una entrada nueva al hub: el historial se reinicia, porque el
  // jugador ha vuelto a empezar por el principio y "atrás" desde aquí no
  // debería devolverlo a una pantalla de hace media hora.
  const session = ensureSession(interaction.user.id, trainer.id);
  toRoot(session, screen, params);

  await render(interaction, trainer, session, screen, params);
}

/** Igual que `open`, pero desde un comando con subcomando de acción. */
export async function openScreen(
  interaction: ChatInputCommandInteraction,
  screen: string,
  params: Record<string, string> = {},
): Promise<void> {
  await open(interaction, screen, params);
}

/**
 * Punto de entrada de los botones de navegación.
 *
 * Devuelve `true` si se ha gestionado el clic, para que `index.ts` pueda dejar
 * seguir su camino con los botones que no son de navegación (`perfil:`).
 */
/**
 * Los selects de menú (`sel:...`).
 *
 * Se validan igual que los botones: misma sesión, mismo nonce. El select no
 * es una excepción, y si lo fuera un mensaje viejo podría filtrar el
 * bestiario a otra cuenta.
 */
export async function handleSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
  if (!isSelectId(interaction.customId)) return false;

  const trainer = findTrainer(interaction.user.id);
  if (!trainer) {
    await interaction.reply({
      content: MESSAGES.noTrainer,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const decoded = decodeSelect(interaction.customId);
  const session = getSession(interaction.user.id);

  if (!decoded || !session || !nonceMatches(session, decoded.nonce)) {
    await interaction.reply({
      content: MESSAGES.stale,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  await interaction.deferUpdate();

  const valor = interaction.values[0] ?? '';

  if (decoded.accion === 'dex_familia') {
    await render(
      interaction,
    // '*' es el centinela de "sin filtro": un StringSelectMenuOption no
    // admite value: '', y hace falta una opcion para poder quitarla.
      trainer,
      session,
      'bestiario',
      valor && valor !== '*' ? { familia: valor } : {},
    );
    return true;
  }

  await safeReply(interaction, MESSAGES.unknown);
  return true;
}

export async function handleNavButton(interaction: ButtonInteraction): Promise<boolean> {
  if (!isNavId(interaction.customId)) return false;

  const trainer = findTrainer(interaction.user.id);
  if (!trainer) {
    await interaction.reply({
      content: MESSAGES.noTrainer,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const decoded = decodeNav(interaction.customId);
  if (!decoded) {
    await interaction.reply({
      content: MESSAGES.unknown,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const session = getSession(interaction.user.id);

  // Sin sesión, o con un nonce que no es el actual, el mensaje es viejo. Es el
  // caso de un mensaje abierto hace una hora o de un button false copiado: en
  // ambos casos los datos que lleva ya no son ciertos, así que no se ejecuta.
  if (!session || !nonceMatches(session, decoded.nonce)) {
    await interaction.reply({
      content: MESSAGES.stale,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (decoded.screen === '__noop') {
    await interaction.reply({
      content: 'No hay a dónde volver.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  maybePrune();

  // Un clic puede tardar: la API tiene tres segundos y una pantalla con una
  // lista de bestiario puede llegar justo. Se aplaza la respuesta antes de
  // calcular nada.
  await interaction.deferUpdate();

  await render(interaction, trainer, session, decoded.screen, decoded.params);
  return true;
}

/** Para el verificador: el destino de un `custom_id`. */
export function inspectButton(customId: string): {
  screen: string;
  params: Record<string, string>;
} | null {
  const decoded = decodeNav(customId);
  return decoded ? { screen: decoded.screen, params: decoded.params } : null;
}

/** Reexportado para las pantallas. */
export { canGoBack, getSession, ensureSession };
export type { NavEntry, NavSession };
export type { EmbedBuilder, ActionRowBuilder, ButtonBuilder };