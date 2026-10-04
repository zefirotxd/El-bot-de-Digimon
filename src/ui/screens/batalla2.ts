import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { BattleState } from '../../game/combat.js';
import { movimientosUsables } from '../../game/statuses.js';
import { analizar } from '../../services/battleAnalysis.js';
import { lineaDeMomento } from '../../game/telemetry.js';
import { combosDe } from '../../game/combos.js';
import { getItem } from '../../game/items.js';
import { ELEMENT_EMOJI, ELEMENT_NAMES } from '../../game/elements.js';
import {
  fighterBlock,
  matchupLine,
  outcomeBlock,
  statusLines,
  teamsBlock,
} from '../battleView.js';
import { panelEfectos, panelSinergias, tablaAtributos, estilosIA } from '../battlePanels.js';
import { paginate, pageRow } from '../components.js';
import { encodeNav } from '../nav.js';
import { register } from '../screen.js';
import { COLORS } from '../theme.js';

/**
 * Las pantallas nuevas del combate.
 *
 * Todas leen `ctx.session.battle` y todas devuelven una vista. Ninguna calcula
 * reglas: el desglose del daño, los estados, el MVP y los momentos salen del
 * motor y de los módulos que leen el motor. Si aquí apareciera una fórmula, la
 * pantalla y el combate empezarían a discrepar y no habría forma de saber cuál
 * tiene razón.
 */

// =========================================================== ℹ️tabla ========

register('bat_atributos', async (ctx) => {
  return {
    embeds: [tablaAtributos()],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, ctx.session.battle ? 'batalla' : 'combate'))
          .setLabel('Volver')
          .setEmoji('◀️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, 'bat_ia'))
          .setLabel('Estilos de la IA')
          .setEmoji('🧠')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, 'hub'))
          .setLabel('Digivice')
          .setEmoji('📟')
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  };
});

register('bat_ia', async (ctx) => {
  return {
    embeds: [estilosIA()],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, 'bat_atributos'))
          .setLabel('Volver')
          .setEmoji('◀️')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, 'hub'))
          .setLabel('Digivice')
          .setEmoji('📟')
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  };
});

// =========================================================== efectos ========

register('bat_efectos', async (ctx) => {
  const state = ctx.session.battle;
  if (!state) return ctx.go('combate');

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.combate)
        .setAuthor({ name: '🧪 ESTADOS Y EFECTOS' })
        .setDescription(panelEfectos(state.player, `${state.player.name.toUpperCase()} — TÚ`)),
        new EmbedBuilder()
          .setColor(COLORS.neutral)
          .setDescription(panelEfectos(state.enemy, `${state.enemy.name.toUpperCase()} — RIVAL`)),
      new EmbedBuilder()
        .setColor(COLORS.neutral)
        .setDescription(
          '**PARA QUÉ SIRVE CADA COSA**\n' +
            '🔥 Quemadura · pierde PV cada turno\n' +
            '☠️ Veneno · lo mismo, pero más despacio\n' +
            '⚡ Parálisis · falla la mitad de los turnos\n' +
            '💤 Sueño · no actúa hasta que se despierte\n' +
            '🧊 Congelado · igual que el sueño\n' +
            '💫 Aturdido · un turno entero, sin escapatoria\n' +
            '🛡️ Escudo · absorbe PV antes de que lleguen\n' +
            '⬆️⬇️ Los modificadores caducan solos',
        ),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, state.finished ? 'batalla_fin' : 'batalla'))
          .setLabel('Volver')
          .setEmoji('◀️')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
});

// ====================================================== análisis final ======

register('bat_analisis', async (ctx) => {
  const state = ctx.session.battle;
  if (!state) return ctx.go('combate');

  const a = analizar(state);
  if (!a) {
    ctx.flash('La pelea no ha terminado todavía.', 'aviso');
    return ctx.refresh('batalla');
  }

  const embeds: EmbedBuilder[] = [];

  embeds.push(
    new EmbedBuilder()
      .setColor(
        a.resultado === 'victoria' ? COLORS.success : a.resultado === 'huida' ? COLORS.neutral : COLORS.danger,
      )
      .setAuthor({ name: '📊 ANÁLISIS DE COMBATE' })
      .setDescription(
        [
          `**Rival:** ${a.estiloRival}`,
          `**Turnos:** ${a.turnos}`,
          `**Daño total:** ${a.dealt.toLocaleString('es')} · **Recibido:** ${a.taken.toLocaleString('es')}`,
        ].join('\n'),
      ),
  );

  // --- MVP ---------------------------------------------------------------
  if (a.mvp) {
    embeds.push(
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setAuthor({ name: `⭐ MVP · ${a.mvp.emoji} ${a.mvp.nombre}` })
        .setDescription(
          `Nv.${a.mvp.nivel} · ${a.mvp.record.dealt.toLocaleString('es')} de daño en ` +
            `${a.mvp.record.turnsActive} turnos.`,
        ),
    );
  }

  // --- tabla por Digimon -------------------------------------------------
  embeds.push(tablaCombatientes('TU EQUIPO', a.jugador, a.mvp?.uid ?? null));
  if (a.rival.length > 0) embeds.push(tablaCombatientes('RIVAL', a.rival, null));

  // --- momentos ----------------------------------------------------------
  if (a.momentos.length > 0) {
    embeds.push(
      new EmbedBuilder()
        .setColor(COLORS.digivice)
        .setAuthor({ name: '📸 MOMENTOS' })
        .setDescription(a.momentos.slice(0, 5).map(lineaDeMomento).join('\n')),
    );
  }

  // --- sinergias ----------------------------------------------------------
  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setDescription(panelSinergias(a.sinergias)),
  );

  return {
    embeds,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, 'bat_replay'))
          .setLabel('Replay')
          .setEmoji('🎥')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, 'bat_log'))
          .setLabel('Registro')
          .setEmoji('📜')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, 'hub'))
          .setLabel('Digivice')
          .setEmoji('📟')
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  };
});

function tablaCombatientes(
  titulo: string,
  lista: { uid: string; nombre: string; emoji: string; nivel: number; caido: boolean; mvp: boolean; record: { dealt: number; taken: number; crits: number; effective: number; skills: number; healed: number; turnsActive: number } }[],
  mvpUid: string | null,
): EmbedBuilder {
  const emb = new EmbedBuilder().setColor(COLORS.neutral).setTitle(titulo);

  if (lista.length === 0) {
    emb.setDescription('—');
    return emb;
  }

  // Un campo por Digimon: es más legible que una tabla con cinco columnas en un
  // móvil, que es donde se lee esto la mayor parte de las veces.
  for (const c of lista) {
    const estrellas = c.uid === mvpUid ? '⭐ ' : '';
    const caido = c.caido ? ' 🔴' : '';

    emb.addFields({
      name: `${estrellas}${c.emoji} ${c.nombre} · Nv.${c.nivel}${caido}`,
      value: c.record.dealt === 0 && c.record.skills === 0
        ? '_No llegó a actuar._'
        : [
            `⚔️ ${c.record.dealt.toLocaleString('es')} hecho · ${c.record.taken.toLocaleString('es')} recibido`,
            `🎯 ${c.record.skills} habilidades · ${c.record.crits} críticos · ${c.record.effective} super-efectivos`,
            c.record.healed > 0 ? `💚 ${c.record.healed.toLocaleString('es')} PV curados` : '',
            `⏱️ ${c.record.turnsActive} turnos activo`,
          ]
            .filter(Boolean)
            .join('\n'),
      inline: true,
    });
  }

  return emb;
}

// ============================================================== replay ======

register('bat_replay', async (ctx) => {
  const state = ctx.session.battle;
  if (!state) return ctx.go('combate');

  // El replay se construye con los eventos que el motor ya emitió, agrupados por
  // turno. No se reconstruye la pelea ni se recalcula nada: si el registro
  // estuviera mal, el replay ESTARÍA bien, porque enseña exactamente lo que pasó.
  const turnos = turnosDelReplay(state);

  const { page: p, pages, items } = paginate(turnos, ctx.page(), 5);

  const cuerpo =
    items.length === 0
      ? 'Todavía no ha pasado nada.'
      : items
          .map(
            (grupo) =>
              `**TURNO ${grupo.turno}**\n` +
              (grupo.eventos.map((linea) => `  ${linea}`).join('\n') || '  —'),
          )
          .join('\n\n');

  const embeds: EmbedBuilder[] = [
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setAuthor({ name: '🎥 REPLAY' })
      .setDescription(cuerpo)
      .setFooter({ text: `${p}/${pages} · ${state.events.length} eventos` }),

    // La última imagen del replay: cómo acabó cada uno.
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setDescription(
        `${fighterBlock(state.enemy, 'rival', 'RIVAL')}\n\n` +
          `${fighterBlock(state.player, 'jugador', 'TÚ')}`,
      ),
  ];

  const nav = new ActionRowBuilder<ButtonBuilder>();
  nav.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(ctx.session, state.finished ? 'bat_analisis' : 'batalla'))
      .setLabel('Volver')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary),
  );

  const pager = pageRow(ctx.session, 'bat_replay', {}, p, pages);
  if (pager) nav.components.push(...pager.components);

  return { embeds, components: [nav] };
});

/**
 * Agrupa los eventos por turno para el replay.
 *
 * El motor no numera cada evento con su turno, así que se agrupa por su
 * posición: todos los eventos entre un punto y el siguiente pertenecen al mismo
 * turno. Es exacto, porque es como se emitieron.
 */

function turnosDelReplay(state: BattleState): { turno: number; eventos: string[] }[] {
  const grupos: { turno: number; eventos: string[] }[] = [];
  let actual: { turno: number; eventos: string[] } | null = null;

  state.events.forEach((evento, i) => {
    // El turno se deduce de la posición: `turn - (eventos que quedan)`.
    const restante = state.events.length - i;
    const turno = Math.max(1, state.turn - restante);

    if (!actual || actual.turno !== turno) {
      actual = { turno, eventos: [] };
      grupos.push(actual);
    }

    const linea = lineaDeReplay(evento);
    if (linea) actual.eventos.push(linea);
  });

  return grupos;
}

function lineaDeReplay(evento: BattleState['events'][number]): string {
  switch (evento.kind) {
    case 'ataque': {
      const d = evento.damage;
      const etiquetas: string[] = [];
      if (d.critico) etiquetas.push('¡CRÍTICO!');
      if (evento.combo) etiquetas.push(`${evento.combo.emoji} COMBO`);
      if (evento.escudo) etiquetas.push(`escudo −${evento.escudo}`);

      const sufijo = etiquetas.length > 0 ? `  *(${etiquetas.join(' ')})*` : '';
      return (
        `${evento.actorEmoji} **${evento.actor}** → ${evento.move}\n` +
        `  ${evento.target} −${d.final} PV${sufijo}`
      );
    }
    case 'fallo':
      return `${evento.actor} → ${evento.move} — falló`;
    case 'combo':
      return `${evento.emoji} **COMBO ${evento.nombre}** · +${Math.round(evento.bonus * 100)}% daño`;
    case 'estado':
      return evento.text;
    case 'curacion':
      return `${evento.target} recuperó ${evento.amount} PV`;
    case 'caida':
      return `💥 **${evento.target} ha caído**`;
    case 'entrada':
      return `⚡ ${evento.target} entra al campo`;
    case 'fase':
      return `🔺 ${evento.boss} — ${evento.nombre}`;
    case 'objeto':
      return `🎒 ${evento.target} ${evento.texto}`;
    case 'defensa':
      return `🛡️ ${evento.target} se cubre`;
    default:
      return evento.kind === 'mensaje' ? evento.text : '';
  }
}

