import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { Direccion } from '../../game/dungeonMap.js';
import { eventoDe, TABLA_EVENTOS, elegirEvento } from '../../game/dungeonEvents.js';
import { arquetipoDe } from '../../game/dungeonMiniboss.js';
import { getSpecies } from '../../game/species.js';
import {
  cambiarRecursos,
  cerrarExpedicion,
  cerrar,
  guardarExpedicion,
  resolver,
} from '../../game/dungeonExpedition.js';
import {
  abrirCofre,
  cargarVista,
  marcarCheckpoint,
  mover,
  resolverEvento,
  retirarse,
  type Entrada,
  type ResultadoEventoClase,
  type VistaExpedicion,
} from '../../services/dungeonRun.js';
import { addItem } from '../../game/repository.js';
import { getItem } from '../../game/items.js';
import type { Expedicion } from '../../game/dungeonExpedition.js';
import { rngDe } from '../../game/dungeonMap.js';
import { panelRecursos, panelResumen } from '../dungeonPanels.js';
import { encodeNav } from '../nav.js';
import { register, type ScreenContext } from '../screen.js';
import { blocker } from '../../services/world.js';
import { startBattle, type Presenter } from '../../services/battleSession.js';
import { COLORS } from '../theme.js';
import { expedicionActiva } from '../../game/dungeonExpedition.js';

/**
 * Las acciones de la mazmorra.
 *
 * Cada botón es un caso, y todos terminan en el servicio. Aquí no hay ni una regla
 * de mazmorra: qué se puede hacer y qué pasa al hacerlo lo dice `dungeonRun`, que
 * es el único que sabe qué es una casilla.
 *
 * Lo que sí hay aquí es la PRESENTACIÓN de lo que el servicio acaba de decidir: qué
 * texto sale, qué botones aparecen y a dónde va después. Que es exactamente lo
 * que la GUI debe poder hacer por su cuenta.
 */

// ========================================================== la casilla =====

/**
 * Lo que hay en la casilla en la que se acaba de entrar.
 *
 * Es una pantalla de LECTURA: no decide nada. Lo que hay en la casilla ya lo
 * decidió `resolverCasilla` al entrar, y lo que se puede hacer lo deciden las
 * pantallas de acción. Aquí solo se enseña y se ofrecen los dos botones de la
 * decisión.
 *
 * Y esa separación es lo que permite que el jugador vea lo que tiene delante
 * ANTES de compromising: investigar un ruido o abrir un cofre son decisiones con
 * información, y una decisión sin información es una apuesta a ciegas.
 */
register('maz_casilla', async (ctx) => {
  const vista = expeditionAsActive(ctx.trainer.id);
  if (!vista) return ctx.go('mazmorra');

  const tipo = ctx.params.t ?? 'nada';
  const embeds: EmbedBuilder[] = [new EmbedBuilder()];
  const botones: ButtonBuilder[] = [];

  switch (tipo) {
    case 'combate': {
      const arquetipo = ctx.params.arq ? arquetipoDe(ctx.params.arq) : null;
      const especie = ctx.params.e ?? '???';
      const nivel = ctx.params.n ?? '?';
      const mini = ctx.params.minijefe === '1';

      embeds[0]!
        .setColor(arquetipo ? COLORS.danger : COLORS.combate)
        .setAuthor({
          name: arquetipo
            ? `🟥 MINI JEFE · ${arquetipo.emoji} ${arquetipo.nombre}`
            : mini
              ? '⚔️ EMBOSCADA'
              : '⚔️ ENCUENTRO',
        })
        .setDescription(
          (arquetipo
            ? arquetipo.descripcion
            : 'Un Digimon se cruza en tu camino. Combatir da botín; retirarse no cuesta nada… todavía.'
          ) + `\n\n**${especie}** · Nv.${nivel}`,
        );

      if (arquetipo) {
        embeds[0]!.addFields({
          name: 'Cómo se pelea',
          value:
            arquetipo.mecanicas.map((m) => `\`${m}\``).join(' ') +
            `\nVida ×${arquetipo.vidaExtra}`,
        });
      }

      botones.push(
        nav(ctx, 'maz_combatir', '⚔️ Combatir', '⚔️', ButtonStyle.Danger, {
          e: ctx.params.key ?? especie,
          n: nivel,
          arq: ctx.params.arq ?? '',
        }),
        nav(ctx, 'maz_pasar', '🚶 Retirarse', '🏃', ButtonStyle.Secondary),
      );
      break;
    }

    case 'evento': {
      const evento = eventoDe(ctx.params.id ?? '');

      if (!evento) {
        embeds[0]!.setColor(COLORS.neutral).setAuthor({ name: '❓ EVENTO' }).setDescription('No ocurre nada.');
        break;
      }

      embeds[0]!
        .setColor(COLORS.digivice)
        .setAuthor({ name: `${evento.emoji} ${evento.titulo}` })
        .setDescription(evento.texto);

      botones.push(
        nav(ctx, 'maz_evento_si', evento.opciones[0], '❓', ButtonStyle.Primary, { id: evento.key }),
        nav(ctx, 'maz_evento_no', evento.opciones[1], '🚶', ButtonStyle.Secondary, { id: evento.key }),
      );
      break;
    }

    case 'cofre': {
      embeds[0]!
        .setColor(COLORS.ciudad)
        .setAuthor({ name: '🟫 COFRE' })
        .setDescription('Cerrado, y sin cerradura. Eso ya es una pista.')
        .addFields({
          name: 'Rareza',
          value: `${ctx.params.rareza ?? 'normal'}`.replace('_', ' '),
        });

      botones.push(
        nav(ctx, 'maz_cofre', '🎁 Abrir', '🎁', ButtonStyle.Success, {
          rareza: ctx.params.rareza ?? 'normal',
          trampa: ctx.params.trampa ?? '0',
        }),
        nav(ctx, 'maz_pasar', '🚶 Dejarlo', '🚶', ButtonStyle.Secondary),
      );
      break;
    }

    case 'santuario': {
      embeds[0]!
        .setColor(COLORS.success)
        .setAuthor({ name: '⛩️ SANTUARIO' })
        .setDescription('El aire de aquí dentro no es de este lugar. Puedes descansar.');

      botones.push(nav(ctx, 'maz_santuario', '🙏 Descansar', '⛲', ButtonStyle.Success));
      break;
    }

    case 'comerciante': {
      embeds[0]!
        .setColor(COLORS.ciudad)
        .setAuthor({ name: '🧧 MERCADER' })
        .setDescription('«Tengo cosas que probablemente no deberías necesitar...»');

      botones.push(nav(ctx, 'maz_comercio', '💬 Hablar', '💬', ButtonStyle.Primary));
      break;
    }

    case 'habitacion': {
      embeds[0]!
        .setColor(COLORS.digivice)
        .setAuthor({ name: '🚪 HABITACIÓN' })
        .setDescription('La pared de aquí no era pared.');

      botones.push(nav(ctx, 'maz_pasar', '⬅️ Salir', '⬅️', ButtonStyle.Secondary));
      break;
    }

    case 'jefe': {
      embeds[0]!
        .setColor(COLORS.danger)
        .setAuthor({ name: '👑 GUARDIÁN' })
        .setDescription(
          'La puerta del fondo no se ha abierto hasta ahora. Detrás hay algo que lleva ' +
            'mucho tiempo esperando.',
        );

      botones.push(
        nav(ctx, 'maz_jefe', '⚔️ Enfrentarlo', '👑', ButtonStyle.Danger),
        nav(ctx, 'maz_retirada', '🚪 Retirada', '🚪', ButtonStyle.Secondary),
      );
      break;
    }

    default: {
      embeds[0]!
        .setColor(COLORS.neutral)
        .setAuthor({ name: '⬜ NADA' })
        .setDescription('Ni una grieta, ni una pista. A veces eso también es información.');

      botones.push(nav(ctx, 'maz_pasar', 'Continuar', '🚶', ButtonStyle.Secondary));
    }
  }

  const componentes: ActionRowBuilder<ButtonBuilder>[] = [];

  if (botones.length > 0) {
    componentes.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...botones));
  }

  componentes.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      nav(ctx, 'mazmorra', '🗺️ Mapa', '🗺️', ButtonStyle.Secondary),
      nav(ctx, 'maz_retirada', '🚪 Salir', '🚪', ButtonStyle.Secondary),
      nav(ctx, 'hub', '📱 Digivice', '📟', ButtonStyle.Primary),
    ),
  );

  return { embeds: [...embeds, recursosDe(vista)], components: componentes };
});

/** Un botón de navegación. */
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

function recursosDe(vista: VistaExpedicion): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS.neutral).setDescription(panelRecursos(vista));
}

// ============================================================ el combate =====

/**
 * Combatir lo que hay en la casilla.
 *
 * Lanza el combate de verdad contra el motor que ya existe, no una simulación. Y
 * EDITA el mensaje actual en vez de responder uno nuevo: si el combate saliera en
 * otro mensaje, la casilla quedaría colgando arriba y el jugador tendría dos
 * sitios donde mirar.
 *
 * La expedición NO se cierra aquí. Queda suspendida mientras se pelea, que es
 * justo lo que hace que la decisión de la casilla —pelear aquí o retirarse— tenga
 * peso: si se pierde, la expedición sigue ahí con la misma energía.
 */
register('maz_combatir', async (ctx) => {
  const speciesKey = ctx.params.e ?? '';
  const nivel = Number(ctx.params.n ?? '0') || undefined;

  const blocked = blocker(ctx.trainer.id);
  if (blocked) {
    ctx.flash(blocked.message, 'aviso');
    return ctx.back();
  }

  await startBattle(ctx.interaction as never, { speciesKey, level: nivel }, editor(ctx));

  // El combate ha tomado el mensaje. Devolver una vista aquí la borraría encima.
  return;
});

// ------------------------------------------------------------- Presentation --

/**
 * El presentador que edita el mensaje actual.
 *
 * Va aquí y no se importa de `mundo.ts` porque es la MISMA idea en dos sitios y
 * no merece un módulo entero: en un clic de botón el router ya ha hecho
 * `deferUpdate`, así que `editReply` es lo válido.
 */
function editor(ctx: ScreenContext): Presenter {
  return async (payload) => {
    await (ctx.interaction as unknown as {
      editReply: (p: unknown) => Promise<unknown>;
    }).editReply(payload);

    return (ctx.interaction as unknown as { message: unknown }).message as never;
  };
}

// =========================================================== movimiento =====

/**
 * Moverse una casilla.
 *
 * El turno del clic va en el botón. No por seguridad —la sesión ya aísla por
 * jugador— sino por una razón práctica: si el jugador pulsa dos veces antes de que
 * la pantalla se repinte, el segundo clic se llegaría a aplicar con el mapa que ya
 * no ve. Con el turno, el segundo se rechaza y no mueve dos casillas.
 */
register('maz_mover', async (ctx) => {
  const dir = ctx.params.d as Direccion | undefined;
  if (!dir) return ctx.refresh('mazmorra');

  const resultado = mover(ctx.trainer.id, dir);

  if ('error' in resultado) {
    const bloqueo = resultado.error;
    const motivo = bloqueo.ok ? 'terminado' : bloqueo.motivo;

    const motivos: Record<string, string> = {
      fuera: '🧱 Aquí no hay nada.',
      pared: '🧱 No se puede pasar por aquí.',
      cerrada: '🔒 Está cerrado.',
      energia: '🔋 **No te queda energía.** No puedes avanzar más.',
      terminado: 'La expedición ya no está activa.',
    };

    ctx.flash(motivos[motivo] ?? 'No se puede.', 'aviso');
    return ctx.refresh('mazmorra');
  }

  return ctx.go('maz_casilla', paramsDeEntrada(resultado.entrada));
});

/**
 * La expedición activa del jugador, ya con el mapa cargado.
 *
 * Devuelve `null` si no está dentro de ninguna. Se llama mucho en estas pantallas
 * y siempre con el mismo patrón, así que merece un nombre.
 */
function expeditionAsActive(trainerId: number): VistaExpedicion | null {
  const e = expedicionActiva(trainerId);
  return e ? cargarVista(e) : null;
}


/** Los parámetros que necesita la pantalla de casilla. */
function paramsDeEntrada(e: Entrada): Record<string, string> {
  switch (e.tipo) {
    case 'combate': {
      const especie = getSpecies(e.especie);
      const arquetipo = e.arquetipo ? arquetipoDe(e.arquetipo) : null;

      // `e` es el NOMBRE, para pintar. `key` es la clave, para pelear. Se
      // confundían porque el nombre se ve en la pantalla y parece el bueno, pero
      // el motor busca por clave: pasarle el nombre hacía que el combate no
      // encontrara la especie y el arranque fallara.
      return {
        t: 'combate',
        e: especie?.name ?? e.especie,
        key: e.especie,
        n: String(e.nivel),
        ...(arquetipo ? { arq: arquetipo.key } : {}),
        ...(e.minijefe ? { minijefe: '1' } : {}),
      };
    }

    case 'evento':
      return { t: 'evento', id: e.eventoId };

    case 'cofre':
      return { t: 'cofre', rareza: e.rareza, trampa: e.trampa ? '1' : '0' };

    case 'santuario':
      return { t: 'santuario', b: e.bendicion };

    case 'comerciante':
      return { t: 'comerciante', m: e.mercader };

    case 'habitacion':
      return { t: 'habitacion', h: e.habitacion };

    case 'jefe':
      return { t: 'jefe' };

    default:
      return { t: 'nada' };
  }
}

/** Volver al mapa sin hacer nada. */
register('maz_pasar', async (ctx) => {
  // Pasar por una casilla la da por resuelta: si no, volver a pisarla daría el
  // cofre otra vez.
  const vista = expeditionAsActive(ctx.trainer.id);
  if (vista) {
    resolver(vista.expedicion, vista.expedicion.pisoActual, vista.expedicion.posX, vista.expedicion.posY);
    guardarExpedicion(vista.expedicion);
  }

  return ctx.go('mazmorra');
});

// ============================================================== eventos =====

/**
 * Investigar: la opción que puede salir mal.
 *
 * La GUI NO tira el dado. Pide el resultado al servicio y lo pinta. La razón es la
 * misma que en el resto del proyecto: si la GUI decidiera, el resultado dependería
 * de qué pantalla se abrió en lugar de de dónde se está, y no se podría repetir ni
 * comprobar.
 *
 * Además, el azar sale de la semilla de la expedición. Con un dado de reloj, dos
 * veces que se entrara en la misma casilla darían resultados distintos; con la
 * semilla, el mismo hueco da siempre lo mismo.
 */
register('maz_evento_si', async (ctx) => {
  const evento = eventoDe(ctx.params.id ?? '');

  const vista = expeditionAsActive(ctx.trainer.id);
  if (!vista) return ctx.go('mazmorra');

  if (!evento) {
    ctx.flash('El evento ya no existe.', 'aviso');
    return ctx.refresh('mazmorra');
  }

  const e = vista.expedicion;

  // La probabilidad la pone la TABLA del evento, y la casilla decide la clase de
  // salida. La GUI no sabe nada de las dos cosas.
  const r = resolverEvento(
    e,
    e.posX,
    e.posY,
    evento.probBuena,
    claseDe(evento.salida),
  );

  // Se aplica el efecto: es dinero y energía, que son cosas que tienen que quedar
  // guardadas aunque el jugador cierre el bot en este momento.
  aplicarResultado(r, e);

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(r.buena ? COLORS.success : COLORS.danger)
        .setAuthor({ name: `${evento.emoji} ${evento.titulo}` })
        .setDescription(textoDe(r)),
      new EmbedBuilder().setColor(COLORS.neutral).setDescription(panelRecursos(cargarVista(e)!)),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, 'mazmorra'))
          .setLabel('Seguir explorando')
          .setEmoji('🚶')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, 'maz_retirada'))
          .setLabel('Salir')
          .setEmoji('🚪')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
});

/** La segunda opción: siempre se puede seguir, y no pasa nada. */
register('maz_evento_no', async (ctx) => {
  const vista = expeditionAsActive(ctx.trainer.id);

  // Continuar marca la casilla como resuelta, para que volver a pisarla no vuelva a
  // a preguntar. Sin esto, ignorar un evento veinte veces lo reactivaría veinte
  // veces, y el jugador vería el mismo ruido una y otra vez.
  if (vista) {
    resolver(vista.expedicion, vista.expedicion.pisoActual, vista.expedicion.posX, vista.expedicion.posY);
    guardarExpedicion(vista.expedicion);
  }

  return ctx.go('mazmorra');
});

/**
 * La frase de cada resultado.
 *
 * La GUI traduce un resultado a palabras; no lo decide. Que esté aquí y no en el
 * servicio es correcto: el servicio dice QUÉ pasó, la GUI dice cómo se cuenta.
 */
function textoDe(r: { buena: boolean; clase: string; digibytes: number; item: string | null; cantidad: number }): string {
  const partes: string[] = [];

  if (r.digibytes > 0) partes.push(`💰 **${r.digibytes.toLocaleString('es')}** DigiBytes`);
  if (r.digibytes < 0) partes.push(`💸 **${Math.abs(r.digibytes).toLocaleString('es')}** DigiBytes perdidos`);
  if (r.item) partes.push(`🎒 ${r.cantidad}× **${getItem(r.item)?.name ?? r.item}**`);

  const frase = FRASES[r.clase] ?? FRASES.nada!;
  partes.push(frase);

  return partes.join('\n');
}

const FRASES: Record<string, string> = {
  recompensa: 'Al final había algo.',
  combate: '⚔️ No tenías que haber tocado eso. Algo sale.',
  combate_raro: '👻 Algo que no debería estar aquí te está mirando.',
  minijefe: '🟥 Había alguien esperando aquí.',
  emboscada: '⚠️ Te esperaban. Y ya no se esconden.',
  trampa: '💥 El suelo cede. Pierdes energía.',
  curacion: '⛲ sales mejor de como entraste.',
  llave: '🗝️ Una llave. Y una puerta nueva.',
  mapa: '🗺️ Se mueve algo a tu alrededor.',
  perdita: '💸 Pierdes recursos.',
  npc: '🧑 Alguien te mira desde la oscuridad.',
  habitacion: '🚪 La pared de aquí no era pared.',
  nada: 'No había nada. Así es.',
};

// =============================================================== cofres =====

/**
 * Abrir un cofre.
 *
 * El importe también lo pone el servicio. Tirar `Math.random()` aquí significaba
 * que dos jugadores abriendo el mismo cofre del mismo mapa podían recibir
 * cantidades distintas, y que el mismo jugador no pudiera saber si un cofre había
 * sido malo o bueno.
 */
register('maz_cofre', async (ctx) => {
  const vista = expeditionAsActive(ctx.trainer.id);
  if (!vista) return ctx.go('mazmorra');

  const e = vista.expedicion;
  const rareza = ctx.params.rareza ?? 'normal';
  const r = abrirCofre(e, rareza === 'raro' ? 'raro' : rareza === 'bueno' ? 'bueno' : 'normal');

  const partes = [`💰 **${r.digibytes.toLocaleString('es')}** DigiBytes`];
  if (!r.trampa && r.pociones > 0) partes.push(`🧪 ${r.pociones}× Poción`);

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(r.trampa ? COLORS.danger : COLORS.ciudad)
        .setAuthor({ name: r.trampa ? '💥 ¡TRAMPA!' : '🎁 COFRE' })
        .setDescription(
          r.trampa
            ? 'El cofre estaba atado a algo que no hacía falta abrir. Pierdes energía.'
            : partes.join('\n'),
        ),
      new EmbedBuilder().setColor(COLORS.neutral).setDescription(panelRecursos(cargarVista(e)!)),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, 'mazmorra'))
          .setLabel('Seguir')
          .setEmoji('🚶')
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  };
});

// ============================================================ santuario =====

register('maz_santuario', async (ctx) => {
  const vista = expeditionAsActive(ctx.trainer.id);
  if (!vista) return ctx.go('mazmorra');

  // El santuario devuelve energía y una poción. Que cure también depende del
  // estado de los Digimon, y eso lo aplica el servicio de combate; aquí solo se
  // dice que el sanctuary exists.
  const e = vista.expedicion;
  cambiarRecursos(e, { energia: 5, pociones: 1 });
  guardarExpedicion(e);

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setAuthor({ name: '⛩️ SANTUARIO' })
        .setDescription('Descansas. Recuperas el aliento y una curación.'),
      new EmbedBuilder().setColor(COLORS.neutral).setDescription(panelRecursos(cargarVista(e)!)),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, 'mazmorra'))
          .setLabel('Seguir')
          .setEmoji('🚶')
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  };
});

// =========================================================== checkpoint =====

register('maz_checkpoint', async (ctx) => {
  const vista = expeditionAsActive(ctx.trainer.id);
  if (!vista) return ctx.go('mazmorra');

  marcarCheckpoint(vista);

  ctx.flash(
    `💾 Checkpoint guardado en el piso ${vista.expedicion.pisoActual}. ` +
      'Si te desconectas, volverás a aquí.',
    'ok',
  );

  return ctx.refresh('mazmorra');
});

// =========================================================== retirada =======

/**
 * Retirarse.
 *
 * Lleva lo RECOGIDO y pierde lo que quedaba por delante. Esa asimetría es
 * exactamente la decisión que el encargo pide: si no costara nada quedarse, no
 * habría nada que decidir.
 */
register('maz_retirada', async (ctx) => {
  const vista = expeditionAsActive(ctx.trainer.id);
  if (!vista) return ctx.go('mazmorra');

  const premio = retirarse(vista);

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.warning)
        .setAuthor({ name: '🚪 TE HAS RETIRADO' })
        .setDescription(panelResumen(vista, premio.digibytes, premio.objetos))
        .addFields({
          name: 'Lo que te has dejado',
          value:
            'Lo que quedaba por explorar, las recompensas de los cofres que no ' +
            'abriste y el jefe. Eso es el precio de salir antes de tiempo.',
        }),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, 'hub'))
          .setLabel('Digivice')
          .setEmoji('📟')
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  };
});

// ========================================================== mapa grande =====

register('maz_grande', async (ctx) => {
  const vista = expeditionAsActive(ctx.trainer.id);
  if (!vista) return ctx.go('mazmorra');

  const piso = vista.piso;
  const filas: string[] = [];

  for (let y = 0; y < piso.alto; y++) {
    const celdas: string[] = [];
    for (let x = 0; x < piso.ancho; x++) {
      const t = vista.mapa.get(`${x},${y}`);
      celdas.push(!t ? '⬛' : t.cerrada ? '·' : t.kind === 'vacia' ? '⬜' : '❔');
    }
    filas.push(celdas.join(' '));
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.neutral)
        .setAuthor({ name: `🗺️ MAPA · PISO ${piso.indice}` })
        .setDescription('```\n' + filas.join('\n') + '\n```')
        .setFooter({ text: '⬔ tú · ❔ por descubrir · · ya visto' }),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, 'mazmorra'))
          .setLabel('Volver')
          .setEmoji('◀️')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
});

/** Traduce la clase de salida del catálogo a la del servicio. */
function claseDe(salida: string): ResultadoEventoClase {
  switch (salida) {
    case 'combate':
      return 'combate';
    case 'combate_raro':
      return 'combate_raro';
    case 'emboscada':
      return 'emboscada';
    case 'minijefe':
      return 'minijefe';
    case 'objeto':
      return 'recompensa';
    case 'trampa':
      return 'trampa';
    case 'curacion':
      return 'curacion';
    case 'npc':
      return 'npc';
    case 'habitacion':
      return 'habitacion';
    case 'recompensa':
      return 'recompensa';
    case 'perdita':
      return 'perdita';
    case 'llave':
      return 'llave';
    case 'mapa':
      return 'mapa';
    case 'nada':
    default:
      return 'nada';
  }
}

/** Aplica un resultado de evento a la expedición y lo guarda. */
function aplicarResultado(r: { digibytes: number; costeEnergia: number; item: string | null; cantidad: number }, e: Expedicion): void {
  if (r.costeEnergia > 0) cambiarRecursos(e, { energia: -r.costeEnergia });
  if (r.item && r.cantidad > 0) {
    addItem(e.trainerId, r.item, r.cantidad);
  }
  guardarExpedicion(e);
}

export { TABLA_EVENTOS };