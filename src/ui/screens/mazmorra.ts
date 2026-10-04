import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { BIOMES, TILE_EMOJI } from '../../game/dungeonMap.js';
import { DUNGEONS, getDungeon } from '../../game/dungeons.js';
import { expedicionActiva } from '../../game/dungeonExpedition.js';
import { listParty } from '../../game/repository.js';
import { cargarVista, entrar, progreso, puedeMover, type VistaExpedicion } from '../../services/dungeonRun.js';
import { panelRecursos } from '../dungeonPanels.js';
import { encodeNav } from '../nav.js';
import { register, type ScreenContext } from '../screen.js';
import { COLORS } from '../theme.js';

/**
 * La mazmorra jugable.
 *
 * Estas pantallas son LECTURA del estado. Ninguna dice "puedes moverte" o "aquí
 * hay un cofre": eso lo dicen `puedeMover` y `resolverCasilla`, en el servicio.
 *
 * Y hay una razón de peso para que sea así: la NIEBLA DE GUERRA. El jugador no
 * puede ver una casilla que no ha visitado. Si la GUI calculara "qué hay alrededor"
 * por su cuenta, se lo enseñaría. Con el servicio como única fuente, lo que se ve
 * es exactamente lo que el jugador ha visto, que es lo único que le da sentido a
 * explorar.
 */

// ============================================================== mapa ========
(globalThis as { __n?: number }).__n = ((globalThis as { __n?: number }).__n ?? 0) + 1;

register('mazmorra', async (ctx) => {
  const vista = vistaDe(ctx);
  if (!vista) return fueraDeMazmorra(ctx);

  const definicion = getDungeon(vista.expedicion.dungeonKey);
  const bioma = BIOMES[definicion?.bioma ?? 'ruinas'];

  return {
    embeds: [
      mapaEmbed(vista, bioma.emoji, bioma.nombre),
      new EmbedBuilder().setColor(COLORS.neutral).setDescription(panelRecursos(vista)),
      leyendaEmbed(),
    ],
    components: filasDeMovimiento(ctx, vista),
  };
});

/**
 * El estado de "no estás dentro de nada".
 *
 * Se PINTA en vez de redirigir. Un `go('mapa')` silencioso manda al jugador a otra
 * parte sin explicarle por qué: si escribió el comando o pulsó un botón, su
 * intención desaparece sin respuesta. Aquí se le dice que no está dentro y se le
 * ofrece entrar.
 */
function fueraDeMazmorra(ctx: ScreenContext) {
  const nivel = nivelEntrenador(ctx.trainer.id);
  const disponibles = Object.values(DUNGEONS).filter(
    (d) => nivel >= d.minLevel && nivel <= d.maxLevel,
  );

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.neutral)
        .setAuthor({ name: '🏰 MAZMORRAS' })
        .setDescription(
          disponibles.length > 0
            ? 'No estás dentro de ninguna mazmorra. Elige una y entra.'
            : 'No hay ninguna mazmorra a tu nivel todavía.',
        ),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...disponibles.slice(0, 4).map((d) =>
          new ButtonBuilder()
            .setCustomId(encodeNav(ctx.session, 'maz_expedir', { k: d.key }))
            .setLabel(d.name)
            .setEmoji(d.emoji)
            .setStyle(ButtonStyle.Primary),
        ),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, 'hub'))
          .setLabel('Digivice')
          .setEmoji('📟')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

/** Entrar en una mazmorra. */
register('maz_expedir', async (ctx) => {
  const clave = ctx.params.k ?? '';
  const definicion = getDungeon(clave);

  if (!definicion) {
    ctx.flash('Mazmorra desconocida.', 'error');
    return ctx.refresh('mazmorra');
  }

  const nivel = nivelEntrenador(ctx.trainer.id);

  if (nivel < definicion.minLevel) {
    ctx.flash(`Necesitas nivel ${definicion.minLevel}.`, 'aviso');
    return ctx.refresh('mazmorra');
  }

  if (nivel > definicion.maxLevel) {
    ctx.flash(`Esta mazmorra se queda corta para el nivel ${nivel}.`, 'aviso');
    return ctx.refresh('mazmorra');
  }

  const resultado = entrar(ctx.trainer.id, clave, definicion.energiaExpedicion);

  if ('error' in resultado) {
    ctx.flash(resultado.error, 'error');
    return ctx.refresh('mazmorra');
  }

  return ctx.go('mazmorra');
});

function mapaEmbed(vista: VistaExpedicion, emojiBioma: string, nombreBioma: string): EmbedBuilder {
  const { expedicion: e, piso } = vista;

  const filas: string[] = [];
  const ancho = Math.min(piso.ancho, 13);

  for (let y = 0; y < piso.alto; y++) {
    const celdas: string[] = [];

    for (let x = 0; x < ancho; x++) {
      // El jugador se ve siempre: esté descubierta la casilla o no, está encima.
      if (x === e.posX && y === e.posY) {
        celdas.push('🟢');
        continue;
      }

      const t = vista.mapa.get(`${x},${y}`);
      celdas.push(t ? pintar(t) : '⬛');
    }

    filas.push(celdas.join(' '));
  }

  const definicion = getDungeon(e.dungeonKey);

  return new EmbedBuilder()
    .setColor(COLORS.mundo)
    .setAuthor({ name: `${emojiBioma} ${definicion?.name ?? e.dungeonKey.toUpperCase()}` })
    .setDescription(
      `Piso ${e.pisoActual} · ${nombreBioma} · ${progreso(vista)}% explorado\n\n` +
        '```\n' +
        filas.join('\n') +
        '\n```',
    )
    .setFooter({ text: `Semilla ${e.seed} · ${vista.explorado}/${vista.total} casillas` });
}

/**
 * Cómo se pinta una casilla.
 *
 * Lo no descubierto es un PUNTO y no un interrogante. El jugador sabe que ahí no
 * ha ido, no que haya algo: un `❓` por todas partes sugiere que el mapa está
 * lleno, y la mitad no lo está.
 */
function pintar(t: { cerrada: boolean; kind: keyof typeof TILE_EMOJI }): string {
  if (t.cerrada) return '·';
  return TILE_EMOJI[t.kind] ?? '⬜';
}

function leyendaEmbed(): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS.neutral).setDescription(
    [
      '🟢 Tú · 🟨 Combate · 🟦 Evento',
      '🟥 Mini jefe · 🟪 Jefe · 🟫 Tesoro',
      '⛩️ Santuario · 🧧 Mercader · 🚪 Habitación',
      '`·` Explorado · `⬛` Desconocido',
    ].join('\n'),
  );
}

// --------------------------------------------------------- movimiento -------

/**
 * Los botones direccionales.
 *
 * Los que no se puede ir van APAGADOS y no desaparecen. Un botón que aparece y se
 * va hace que la pantalla "salte", y el jugador no sabe si ahí hay pared o si su
 * clic no se registró. Apagado significa "aquí no se puede".
 */
function filasDeMovimiento(ctx: ScreenContext, vista: VistaExpedicion): ActionRowBuilder<ButtonBuilder>[] {
  const hueco = () =>
    new ButtonBuilder()
      .setCustomId('hueco:mazmorra')
      .setLabel(' ')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

  const dir = (d: 'norte' | 'sur' | 'oeste' | 'este', etiqueta: string, emoji: string) => {
    const b = new ButtonBuilder()
      .setCustomId(encodeNav(ctx.session, 'maz_mover', { d }))
      .setLabel(etiqueta)
      .setEmoji(emoji)
      .setStyle(ButtonStyle.Primary);

    if (!puedeMover(vista, d).ok) b.setDisabled(true);
    return b;
  };

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(hueco(), dir('norte', 'Arriba', '⬆️'), hueco()),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      dir('oeste', 'Izquierda', '⬅️'),
      dir('este', 'Derecha', '➡️'),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(hueco(), dir('sur', 'Abajo', '⬇️'), hueco()),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      nav(ctx, 'maz_grande', '🗺️ Mapa completo', '🗺️', ButtonStyle.Secondary),
      nav(ctx, 'maz_checkpoint', '💾 Checkpoint', '💾', ButtonStyle.Secondary),
      nav(ctx, 'maz_retirada', '🚪 Salir', '🚪', ButtonStyle.Secondary),
      nav(ctx, 'hub', '📱 Digivice', '📟', ButtonStyle.Primary),
    ),
  ];
}

function nav(
  ctx: ScreenContext,
  pantalla: string,
  etiqueta: string,
  emoji: string,
  estilo: ButtonStyle,
  params?: Record<string, string>,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(encodeNav(ctx.session, pantalla, params))
    .setLabel(etiqueta)
    .setEmoji(emoji)
    .setStyle(estilo);
}

/**
 * La vista del jugador, o `null` si no está dentro.
 *
 * El identificador sale de `ctx.trainer`, NO de un parámetro de navegación: un
 * `trainerId` dentro del `custom_id` sería algo que el jugador puede mandar, y
 * serviría para preguntar por la expedición de otro.
 */
function vistaDe(ctx: ScreenContext): VistaExpedicion | null {
  const e = expedicionActiva(ctx.trainer.id);
  if (!e) return null;

  return cargarVista(e);
}

/**
 * El nivel del entrenador.
 *
 * Es el de su Digimon líder, no un campo propio: `Trainer` no tiene `level`, y
 * escribir `ctx.trainer.level` compila solo si el tipo lo permitiera.
 */
function nivelEntrenador(trainerId: number): number {
  const lider = listParty(trainerId).find((d) => d.species) ?? listParty(trainerId)[0];
  return lider?.level ?? 1;
}

export { progreso, puedeMover, cargarVista, vistaDe, fueraDeMazmorra, nivelEntrenador };