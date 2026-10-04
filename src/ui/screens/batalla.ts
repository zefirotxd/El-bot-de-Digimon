import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { BattleState } from '../../game/combat.js';
import { previewDamage } from '../../game/combat.js';
import { getItem } from '../../game/items.js';
import { ELEMENT_EMOJI, ELEMENT_NAMES } from '../../game/elements.js';
import { ATTRIBUTE_EMOJI } from '../../game/attributes.js';
import {
  actionsNow,
  candidates,
  clock,
  itemsOf,
  movesOf,
  summary,
  type ActionResult,
} from '../../services/battleFlow.js';
import {
  fighterBlock,
  hintBlock,
  matchupLine,
  outcomeBlock,
  resultBlock,
  statusLines,
  teamsBlock,
} from '../battleView.js';
import { panelEfectos } from '../battlePanels.js';
import { paginate, pageRow } from '../components.js';
import { encodeNav } from '../nav.js';
import { register } from '../screen.js';
import { COLORS } from '../theme.js';

/**
 * La Battle GUI.
 *
 * Todas las pantallas del combate viven aquí y se sirven desde el mismo mensaje.
 * No se abre un embed por acción: pulsar "Pepper Breath" actualiza la pantalla
 * de combate y deja la de habilidades detrás, en la pila.
 *
 * La navegación es la de siempre: volver al Digivice, ir a la zona cuando el
 * combate acaba, y un botón atrás en cada subpantalla.
 *
 * El combate se identifica por `state.id`, que va dentro del botón. Un mensaje
 * viejo lleva un id que ya no coincide y el enrutador lo rechaza antes de tocar
 * el estado.
 */

// =========================================================== principal ======

register('batalla', async (ctx) => {
  const state = ctx.session.battle;

  if (!state) {
    ctx.flash('No hay ningún combate en marcha.', 'aviso');
    return ctx.go('combate');
  }

  if (state.finished) return ctx.go('batalla_fin');

  const acciones = actionsNow(state);
  const reloj = clock(state);

  // Si el reloj se agotó, se resuelve antes de pintar: el contador visual por
  // sí solo no sirve, tiene que estar en el estado.
  if (reloj.expired) {
    const { timeoutTurn } = await import('../../services/battleFlow.js');
    timeoutTurn(state);
  }

  const embeds: EmbedBuilder[] = [];

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.combate)
      .setAuthor({ name: `⚔️ DIGIMON BATTLE  ·  TURNO ${state.turn}` })
      .setDescription(fighterBlock(state.enemy, 'rival', 'ENEMIGO'))
      .addFields({
        name: 'VS',
        value: fighterBlock(state.player, 'jugador', 'TÚ'),
        inline: false,
      }),
  );

  // El resultado de la última acción, que es lo que el jugador quiere ver.
  const golpe = outcomeBlock(state);
  if (golpe) embeds.push(new EmbedBuilder().setColor(COLORS.neutral).setDescription(golpe));

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setTitle('Equipos')
      .setDescription(teamsBlock(state))
      .addFields(
        {
          name: 'Efectos',
          value: panelEfectos(state.player),
          inline: true,
        },
        {
          name: 'Estados',
          value:
            [
              `**${state.player.name}**`,
              ...statusLines(state.player),
              '',
              `**${state.enemy.name}**`,
              ...statusLines(state.enemy),
            ]
              .join('\n') || '—',
          inline: true,
        },
      )
      .addFields({
        name: 'Reloj',
        value: `⏱️ **${reloj.seconds}s**\n${matchupLine(state)}`,
        inline: true,
      }),
  );

  if (acciones.motivo) {
    embeds.push(new EmbedBuilder().setColor(COLORS.warning).setDescription(`⚠️ ${acciones.motivo}`));
  }

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  // --- la fila de acciones ------------------------------------------------
  const principal = new ActionRowBuilder<ButtonBuilder>();

  principal.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(ctx.session, 'bat_atacar'))
      .setLabel('Atacar')
      .setEmoji('⚔️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!acciones.atacar),
  );

  principal.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(ctx.session, 'bat_defender', { turno: String(state.turn) }))
      .setLabel('Defender')
      .setEmoji('🛡️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!acciones.defender),
  );

  principal.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(ctx.session, 'bat_objetos'))
      .setLabel('Objetos')
      .setEmoji('🎒')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!acciones.objetos),
  );

  principal.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(ctx.session, 'bat_cambiar'))
      .setLabel('Cambiar')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!acciones.cambiar),
  );

  if (acciones.capturar) {
    principal.addComponents(
      new ButtonBuilder()
        .setCustomId(encodeNav(ctx.session, 'bat_capturar', { turno: String(state.turn) }))
        .setLabel('Capturar')
        .setEmoji('📦')
        .setStyle(ButtonStyle.Success),
    );
  }

  components.push(principal);

  // --- la fila de abajo ---------------------------------------------------
  // Sin esto, el estado del Digimon no es visible más que en la barra de PV, y
  // un jugador con tres estados activos no tiene dónde verlos sin abrir otra
  // cosa.
  const ayuda = new ActionRowBuilder<ButtonBuilder>();
  ayuda.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(ctx.session, 'bat_log'))
      .setLabel('Registro')
      .setEmoji('📜')
      .setStyle(ButtonStyle.Secondary),
  );
  ayuda.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(ctx.session, 'bat_estado'))
      .setLabel('Equipo')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
  );

  const nav = new ActionRowBuilder<ButtonBuilder>();
  nav.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(ctx.session, 'bat_huir', { turno: String(state.turn) }))
      .setLabel('Huir')
      .setEmoji('🏃')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!acciones.huir),
  );
  nav.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(ctx.session, 'hub'))
      .setLabel('Digivice')
      .setEmoji('📟')
      .setStyle(ButtonStyle.Primary),
  );
  // ACTIVE EFFECTS: los estados de ambos bandos, con su duración. Va en su
  // propia fila porque es el dato que decide el turno siguiente, y esconderlo
  // en un panel obliga a abrir otra pantalla para tomar una decisión urgente.
  ayuda.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(ctx.session, 'bat_efectos'))
      .setLabel('Efectos')
      .setEmoji('🧪')
      .setStyle(ButtonStyle.Secondary),
  );

  // ℹ️ La tabla de atributos. El jugador no tiene que buscarla en una wiki para
  // saber por qué su Agimon no le hace daño a un Virus.
  ayuda.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(ctx.session, 'bat_atributos'))
      .setLabel('Atributos')
      .setEmoji('ℹ️')
      .setStyle(ButtonStyle.Secondary),
  );

  nav.components.push(...ayuda.components);
  components.push(nav);

  return { embeds, components };
});

// =========================================================== habilidades ===

register('bat_atacar', async (ctx) => {
  const state = ctx.session.battle;
  if (!state) return ctx.go('combate');

  const embeds: EmbedBuilder[] = [
    new EmbedBuilder()
      .setColor(COLORS.combate)
      .setAuthor({ name: `⚔️ HABILIDADES DE ${state.player.name.toUpperCase()}` })
      .setDescription(
        `Nivel ${state.player.level} · ⚡ ${state.player.energy}\n` +
          'El daño estimado sale del motor: es un rango, porque el golpe real tira dados.',
      ),
  ];

  const moves = movesOf(state);

  for (const move of moves) {
    const prev = previewDamage(state, move);
    const et = prev.effectiveness;

    const etiqueta = et
      ? {
          supereficaz: '💥 **SUPER EFECTIVO**',
          eficaz: '✅ Efectivo',
          inmune: '✖️ **INMUNE**',
          ineficaz: '🛡️ **RESISTIDO**',
          neutro: '',
        }[et]
      : '';

    const lineas = [
      move.category === 'estado' || move.power === 0
        ? 'Efecto: sin daño directo'
        : `Daño estimado: **${prev.min}–${prev.max}** (habitual ${prev.expected})`,
      `Tipo: ${ELEMENT_EMOJI[move.element]} ${ELEMENT_NAMES[move.element]}`,
      `Precisión: ${Math.round(move.accuracy * 100)}%${move.critRate > 0 ? ` · Crítico ${Math.round(move.critRate * 100)}%` : ''}`,
      `Coste: ${move.energyCost}⚡`,
      move.effect ? `${move.effect.text} (${Math.round(move.effect.chance * 100)}%)` : '',
      etiqueta,
      move.description,
    ].filter(Boolean);

    embeds.push(
      new EmbedBuilder()
        .setColor(
          et === 'supereficaz' ? COLORS.success : et === 'inmune' ? COLORS.neutral : COLORS.combate,
        )
        .setAuthor({
          name: `${ELEMENT_EMOJI[move.element]} ${move.name}${state.player.energy >= move.energyCost ? '' : '  (sin energía)'}`,
        })
        .setDescription(lineas.join('\n')),
    );
  }

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let i = 0; i < moves.length; i += 3) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const move of moves.slice(i, i + 3)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, 'bat_usar', { turno: String(state.turn),  k: move.key }))
          .setLabel(move.name)
          .setEmoji(ELEMENT_EMOJI[move.element])
          .setStyle(ButtonStyle.Danger)
          .setDisabled(state.player.energy < move.energyCost),
      );
    }
    components.push(row);
  }

  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeNav(ctx.session, 'batalla'))
        .setLabel('Volver')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return { embeds, components };
});

// ================================================================ objetos ==

register('bat_objetos', async (ctx) => {
  const state = ctx.session.battle;
  if (!state) return ctx.go('combate');

  const items = itemsOf(state);

  const embeds: EmbedBuilder[] = [
    new EmbedBuilder()
      .setColor(COLORS.ciudad)
      .setAuthor({ name: '🎒 OBJETOS DE COMBATE' })
      .setDescription(
        items.length > 0
          ? 'Tu inventario real. El consumo se descuenta del mismo sitio que lo añade.'
          : 'No llevas objetos.',
      ),
  ];

  for (const item of items) {
    const def = getItem(item.key);
    embeds.push(
      new EmbedBuilder()
        .setColor(COLORS.ciudad)
        .setAuthor({ name: `${item.emoji} ${item.name} ×${item.quantity}` })
        .setDescription(def?.description ?? ''),
    );
  }

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let i = 0; i < items.length; i += 3) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const item of items.slice(i, i + 3)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, 'bat_usar_item', { turno: String(state.turn),  k: item.key }))
          .setLabel(`${item.name} ×${item.quantity}`)
          .setEmoji(item.emoji)
          .setStyle(ButtonStyle.Success),
      );
    }
    components.push(row);
  }

  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeNav(ctx.session, 'batalla'))
        .setLabel('Volver')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return { embeds, components };
});

// ================================================================ cambiar ==

register('bat_cambiar', async (ctx) => {
  const state = ctx.session.battle;
  if (!state) return ctx.go('combate');

  const lista = candidates(state);
  const caidos = state.party.filter((d) => !lista.some((c) => c.id === d.id));

  const embeds: EmbedBuilder[] = [
    new EmbedBuilder()
      .setColor(COLORS.digimon)
      .setAuthor({ name: '🔄 CAMBIAR DIGIMON' })
      .setDescription(
        'Activo ahora:\n' +
          `\`${state.player.name}\` — ${state.player.hp}/${state.player.stats.hp} PV` +
          (state.awaitingSwitch ? '\n\n⚠️ **No puedes continuar hasta cambiar.**' : ''),
      ),
  ];

  if (lista.length === 0) {
    embeds.push(
      new EmbedBuilder()
        .setColor(COLORS.warning)
        .setDescription('No queda ningún Digimon en pie.'),
    );
  } else {
    embeds.push(
      new EmbedBuilder()
        .setColor(COLORS.neutral)
        .setDescription(
          lista
            .map(
              (d) =>
                `🟢 **${d.nickname ?? d.species.name}**\n` +
                `\`${ATTRIBUTE_EMOJI[d.species.attribute]} Nv.${d.level} · ${d.hp}/${d.stats.hp} PV\``,
            )
            .join('\n\n'),
        ),
    );
  }

  // Los caídos se muestran tachados y NO seleccionables. Es lo que pidió el
  // jugador: que aparezcan pero no se puedan elegir.
  if (caidos.length > 0) {
    embeds.push(
      new EmbedBuilder()
        .setColor(COLORS.neutral)
        .setTitle('Caídos')
        .setDescription(
          caidos.map((d) => `🔴 **${d.nickname ?? d.species.name}** — 0 PV`).join('\n'),
        ),
    );
  }

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let i = 0; i < lista.length; i += 3) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const d of lista.slice(i, i + 3)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, 'bat_cambiar_a', { turno: String(state.turn),  id: String(d.id) }))
          .setLabel(d.nickname ?? d.species.name)
          .setEmoji(d.species.emoji)
          .setStyle(ButtonStyle.Success),
      );
    }
    components.push(row);
  }

  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeNav(ctx.session, 'batalla'))
        .setLabel('Volver')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(state.awaitingSwitch),
    ),
  );

  return { embeds, components };
});

// ================================================================== log ====

register('bat_log', async (ctx) => {
  const state = ctx.session.battle;
  if (!state) return ctx.go('combate');

  // El registro se agrupa por turno, porque así se recuerda una pelea.
  const porTurno = new Map<number, typeof state.events>();
  for (const evento of state.events) {
    const turno =
      evento.kind === 'ataque' || evento.kind === 'fallo'
        ? ultimoTurno(state, evento)
        : state.turn;
    const lista = porTurno.get(turno) ?? [];
    lista.push(evento);
    porTurno.set(turno, lista);
  }

  const turnos = [...porTurno.keys()].sort((a, b) => a - b);
  const { page: p, pages, items } = paginate(turnos, ctx.page(), 6);

  const embeds: EmbedBuilder[] = [
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setAuthor({ name: '📜 REGISTRO DE COMBATE' })
      .setDescription(
        items.length > 0
          ? items
              .map((turno) => {
                const lineas = (porTurno.get(turno) ?? [])
                  .map((e) => `  ${lineaDe(e)}`)
                  .filter(Boolean);
                return `**Turno ${turno}**\n${lineas.join('\n')}`;
              })
              .join('\n\n')
          : 'Todavía no ha pasado nada.',
      )
      .setFooter({ text: `${p}/${pages} · ${state.events.length} eventos` }),
  ];

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  const pager = pageRow(ctx.session, 'bat_log', {}, p, pages);
  const nav = new ActionRowBuilder<ButtonBuilder>();
  nav.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(ctx.session, 'batalla'))
      .setLabel('Volver al combate')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary),
  );
  if (pager) nav.components.push(...pager.components);
  components.push(nav);

  return { embeds, components };
});

function ultimoTurno(state: BattleState, evento: unknown): number {
  // El motor no numera los eventos con turno; se usa la posición como proxy,
  // que para un registro legible es exactamente lo mismo.
  const i = state.events.indexOf(evento as never);
  return Math.max(1, state.turn - (state.events.length - i));
}

function lineaDe(evento: BattleState['events'][number]): string {
  switch (evento.kind) {
    case 'ataque':
      return (
        `${evento.actorEmoji} ${evento.actor} → **${evento.move}**\n` +
        `  ${evento.target} −${evento.damage.final} PV (${evento.damage.effectiveness ?? 'neutro'})`
      );
    case 'fallo':
      return `${evento.actor} → ${evento.move} — falló`;
    case 'estado':
      return `${evento.targetEmoji} ${evento.target} — ${evento.text}${evento.turns > 0 ? ` (${evento.turns} turnos)` : ''}`;
    case 'curacion':
      return `${evento.target} recuperó ${evento.amount} PV`;
    case 'caida':
      return `💥 **${evento.target} ha caído**`;
    case 'entrada':
      return `⚡ ${evento.target} entra al campo`;
    case 'fase':
      return `🔺 ${evento.boss} cambia a la fase "${evento.nombre}"`;
    case 'mensaje':
      return evento.text;
    case 'objeto':
      return `${evento.target} usó ${evento.item}`;
    default:
      return '';
  }
}

// ================================================================ estado ===

register('bat_estado', async (ctx) => {
  const state = ctx.session.battle;
  if (!state) return ctx.go('combate');

  const mio = state.party.map((d) => {
    const activo = d.id === state.party[state.activeIndex]?.id;
    return `${activo ? '⭐' : d.hp <= 0 ? '🔴' : '🟢'} **${d.nickname ?? d.species.name}** Nv.${d.level} — ${d.hp}/${d.stats.hp} PV`;
  });

  const suyo = state.enemyTeam.map((f) => {
    const activo = f.uid === state.enemy.uid;
    return `${activo ? '⭐' : f.hp <= 0 ? '🔴' : '🟢'} **${f.name}** Nv.${f.level} — ${f.hp}/${f.stats.hp} PV`;
  });

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.neutral)
        .setAuthor({ name: '📋 ESTADO DEL COMBATE' })
        .addFields(
          { name: 'Tu equipo', value: mio.join('\n') || '—', inline: true },
          { name: 'Rival', value: suyo.join('\n') || '—', inline: true },
        )
        .setFooter({
          text: `Turno ${state.turn} · ⏱️ ${clock(state).seconds}s`,
        }),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, 'batalla'))
          .setLabel('Volver al combate')
          .setEmoji('◀️')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
});

// ================================================================ final ====

register('batalla_fin', async (ctx) => {
  const state = ctx.session.battle;
  if (!state) {
    ctx.flash('No hay ningún combate que cerrar.', 'aviso');
    return ctx.go('combate');
  }

  const s = summary(state);
  const embeds: EmbedBuilder[] = [resultBlock(state)];

  const componentes: ActionRowBuilder<ButtonBuilder>[] = [];

  componentes.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeNav(ctx.session, 'bat_log'))
        .setLabel('Registro')
        .setEmoji('📜')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(encodeNav(ctx.session, 'bat_analisis'))
        .setLabel('Análisis')
        .setEmoji('📊')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(encodeNav(ctx.session, 'bat_replay'))
        .setLabel('Replay')
        .setEmoji('🎥')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(encodeNav(ctx.session, 'hub'))
        .setLabel('Digivice')
        .setEmoji('📟')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(encodeNav(ctx.session, 'mapa'))
        .setLabel('Seguir explorando')
        .setEmoji('🌍')
        .setStyle(ButtonStyle.Success),
    ),
  );

  void s;
  return { embeds, components: componentes };
});