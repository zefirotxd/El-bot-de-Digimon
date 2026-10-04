import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getDigimonOwnedBy, getInventory, listParty } from '../../game/repository.js';
import {
  devolveInto,
  evolveOwned,
  historyOf,
  routeStatuses,
  unlocksOf,
} from '../../game/evolutionRepo.js';
import { getSpecies } from '../../game/species.js';
import { getItem } from '../../game/items.js';
import { expToNextLevel, MAX_LEVEL } from '../../game/stats.js';
import { MOVES } from '../../game/moves.js';
import { ATTRIBUTE_EMOJI, ATTRIBUTE_NAMES } from '../../game/attributes.js';
import { ELEMENT_EMOJI, ELEMENT_NAMES } from '../../game/elements.js';
import {
  actionRow,
  areaRows,
  bar,
  header,
  navRow,
  panel,
  playerField,
} from '../components.js';
import { encodeNav } from '../nav.js';
import { register } from '../screen.js';
import { COLORS } from '../theme.js';

/**
 * Evolución y regresión.
 *
 * La evolución es manual: subir de nivel abre la ruta pero no la ejecuta. Eso
 * convierte la decisión en el momento de juego más importante de la pantalla de
 * Digimon, y por eso tiene tres pasos y no uno:
 *
 *   elegir Digimon -> elegir ruta -> confirmar -> resultado
 *
 * El paso de confirmar existe porque elegir rama es irreversible (hasta que
 * desbloqueas la regresión). Un botón que ejecuta sin preguntar, en una pantalla
 * donde el jugador está mirando cinco rutas a la vez, es un botón que se pulsa
 * por inercia.
 */

/** El árbol entero: qué formas tienes abiertas y qué te falta. */
register('evolucion', async (ctx) => {
  const { trainer, session } = ctx;
  const party = listParty(trainer.id);
  const inventory = getInventory(trainer.id);
  const unlocked = unlocksOf(trainer.id);

  const embeds: EmbedBuilder[] = [
    header({
      area: 'digimon',
      title: 'EVOLUCIÓN',
      context:
        'Subir de nivel **abre** la ruta; no la ejecuta. Eliges tú.\n' +
        'Las formas de rama se pueden deshacer con materiales.',
      color: COLORS.digivice,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  // Los Digimon con rutas pendientes, con lo que falta en cada una.
  const conRuta = party
    .map((d) => ({ digimon: d, rutas: routeStatuses(d, trainer, inventory, unlocked) }))
    .filter((x) => x.rutas.length > 0);

  if (conRuta.length === 0) {
    embeds.push(
      new EmbedBuilder()
        .setColor(COLORS.legendary)
        .setDescription('Ningún Digimon de tu equipo tiene rutas pendientes. 👑'),
    );
  }

  for (const { digimon, rutas } of conRuta) {
    const species = digimon.species;
    const lista = rutas.map((r) => {
      const icon = r.ready ? '✅' : r.lockedByBranch ? '🔒' : '🟡';
      const falta = r.missing.map((m) => `${m.label} ${m.have}/${m.needed}`).join(', ');
      const rama = r.lockedByBranch ? ` — cerrada en ${r.lockedByBranch}` : '';
      return (
        `${icon} ${r.to.emoji} **${r.to.name}**` +
        (r.ready ? ' — ¡listo!' : ` — falta ${falta}`) +
        rama
      );
    });

    embeds.push(
      new EmbedBuilder()
        .setColor(rutas.some((r) => r.ready) ? COLORS.success : COLORS.neutral)
        .setAuthor({ name: `${species.emoji} ${digimon.nickname ?? species.name} · Nv.${digimon.level}` })
        .setDescription(lista.join('\n'))
        .addFields({
          name: 'Siguiente nivel',
          value:
            digimon.level >= MAX_LEVEL
              ? 'Nivel máximo'
              : `${bar(digimon.exp, expToNextLevel(digimon.level), 10)} ${digimon.exp}/${expToNextLevel(digimon.level)}`,
          inline: true,
        }),
    );

    embeds[embeds.length - 1]!.setFooter({
      text: 'Pulsa su nombre para ver las rutas en detalle.',
    });
  }

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let i = 0; i < conRuta.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const { digimon } of conRuta.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(session, 'evo_rutas', { id: String(digimon.id) }))
          .setLabel(digimon.nickname ?? digimon.species.name)
          .setEmoji(digimon.species.emoji)
          .setStyle(ButtonStyle.Primary),
      );
    }
    components.push(row);
  }

  // Aunque no haya rutas, se ofrece el botón de atrás: el jugador tiene que
  // poder salir de aquí sin usar un comando.
  components.push(navRow(session, { backLabel: 'Equipo' }));

  return { embeds, components };
});

// ------------------------------------------------------- elegir ruta -----

register('evo_rutas', async (ctx) => {
  const { trainer, session } = ctx;
  const digimon = getDigimonOwnedBy(trainer.id, ctx.num('id', 0));

  if (!digimon) {
    ctx.flash('Ya no tienes ese Digimon.', 'error');
    return ctx.go('evolucion');
  }

  const rutas = routeStatuses(digimon, trainer, getInventory(trainer.id), unlocksOf(trainer.id));
  const species = digimon.species;

  const embeds: EmbedBuilder[] = [
    header({
      area: 'digimon',
      title: `EVOLUCIÓN · ${(digimon.nickname ?? species.name).toUpperCase()}`,
      context:
        `Nv.${digimon.level} · ${ATTRIBUTE_EMOJI[species.attribute]} ${ATTRIBUTE_NAMES[species.attribute]}\n` +
        'Elige una ruta. **Tú decides cuándo**: esto no pasa solo.',
      color: COLORS.digivice,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setDescription(
        '```' +
          panel('AHORA', [
            `${species.emoji} ${digimon.nickname ?? species.name}  Nv.${digimon.level}`,
            `${ATTRIBUTE_EMOJI[species.attribute]} ${ATTRIBUTE_NAMES[species.attribute]}`,
            species.elements.map((e) => `${ELEMENT_EMOJI[e]} ${ELEMENT_NAMES[e]}`).join('  '),
            `ATQ ${digimon.stats.attack}  DEF ${digimon.stats.defense}  VEL ${digimon.stats.speed}`,
          ]) +
          '```',
      ),
  );

  // Una tarjeta por ruta: el jugador tiene que comparar, y comparar funciona
  // mal en una lista de una línea por opción.
  for (const r of rutas) {
    const destino = getSpecies(r.to.key);
    embeds.push(
      new EmbedBuilder()
        .setColor(
          r.ready ? COLORS.success : r.lockedByBranch ? COLORS.neutral : COLORS.warning,
        )
        .setAuthor({
          name: `${r.route.branch ? '🔀' : '➡️'} ${destino?.emoji ?? '❔'} ${r.to.name}`,
        })
        .setDescription(
          (r.lockedByBranch ? `🔒 Cerraste la rama en **${r.lockedByBranch}**.` : '') +
            (r.ready
              ? '\n✅ **Puedes evolucionar ahora mismo.**'
              : `\n🔒 Falta: ${r.missing.map((m) => `${m.label} (${m.have}/${m.needed})`).join(' · ')}`) +
            (destino ? `\n_${destino.lore}_` : ''),
        )
        .addFields({
          name: 'Atributo y elementos',
          value: destino
            ? `${ATTRIBUTE_EMOJI[destino.attribute]} ${ATTRIBUTE_NAMES[destino.attribute]}\n${destino.elements.map((e) => `${ELEMENT_EMOJI[e]} ${ELEMENT_NAMES[e]}`).join(' · ')}`
            : '—',
          inline: true,
        })
        .addFields({
          name: 'Base',
          value: destino
            ? `PV ${destino.base.hp}\nATQ ${destino.base.attack} · DEF ${destino.base.defense} · VEL ${destino.base.speed}`
            : '—',
          inline: true,
        }),
    );
  }

  // Regresión: solo si la especie la tiene, y con su coste a la vista.
  if (species.devolution) {
    const dev = species.devolution;
    const coste = Object.entries(dev.items ?? {});
    const hayMateriales = coste.every(([k, n]) => (getInventory(trainer.id)[k] ?? 0) >= n);

    embeds.push(
      new EmbedBuilder()
        .setColor(COLORS.danger)
        .setTitle('↩️ Regresión')
        .setDescription(
          `Puedes volver a **${getSpecies(dev.to)?.name ?? dev.to}**.\n` +
            `Coste: ${coste.map(([k, n]) => `${n}x ${getItem(k)?.name ?? k}`).join(' · ') || 'gratis'}\n` +
            (hayMateriales ? '' : '⚠️ **No tienes los materiales suficientes.**'),
        ),
    );
  }

  // ---------------------------------------------------------- botones ----
  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  // Solo las rutas accionables: una tarjeta no pulsable no es un botón
  // deshabilitado, es información, y deshabilitado confunde.
  const accionables = rutas.filter((r) => !r.lockedByBranch);

  for (let i = 0; i < accionables.length; i += 3) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const r of accionables.slice(i, i + 3)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(
            encodeNav(session, 'evo_confirmar', {
              id: String(digimon.id),
              ruta: String(r.index),
            }),
          )
          .setLabel(r.to.name)
          .setEmoji(r.route.branch ? '🔀' : '➡️')
          .setStyle(r.ready ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(!r.ready),
      );
    }
    components.push(row);
  }

  if (species.devolution) {
    const dev = species.devolution;
    const coste = Object.entries(dev.items ?? {});
    const hayMateriales = coste.every(([k, n]) => (getInventory(trainer.id)[k] ?? 0) >= n);

    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(session, 'evo_revertir', { id: String(digimon.id) }))
          .setLabel(`Volver a ${getSpecies(dev.to)?.name ?? dev.to}`)
          .setEmoji('↩️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!hayMateriales),
      ),
    );
  }

  components.push(navRow(session, { backLabel: 'Evolución' }));
  components.push(...areaRows(session, 'digimon'));

  return { embeds, components };
});

// ---------------------------------------------------------- confirmar ----

register('evo_confirmar', async (ctx) => {
  const { trainer, session } = ctx;
  const digimon = getDigimonOwnedBy(trainer.id, ctx.num('id', 0));
  const index = ctx.num('ruta', 0);

  if (!digimon) {
    ctx.flash('Ya no tienes ese Digimon.', 'error');
    return ctx.go('evolucion');
  }

  const rutas = routeStatuses(digimon, trainer, getInventory(trainer.id), unlocksOf(trainer.id));
  const ruta = rutas[index];

  if (!ruta) {
    ctx.flash('Esa ruta no existe.', 'error');
    return ctx.go('evolucion');
  }

  const destino = getSpecies(ruta.to.key);

  if (!ruta.ready) {
    // Volver a avisar de qué falta es mejor que evolucionar a medias.
    ctx.flash(
      `Todavía falta: ${ruta.missing.map((m) => `${m.label} ${m.have}/${m.needed}`).join(', ')}.`,
      'aviso',
    );
    return ctx.refresh('evo_rutas', { id: String(digimon.id) });
  }

  const embeds: EmbedBuilder[] = [
    header({
      area: 'digimon',
      title: '¿EVOLUCIONAR?',
      context:
        `**${digimon.nickname ?? digimon.species.name}** → **${destino?.name ?? ruta.to.name}**\n\n` +
        'No se puede deshacer hasta desbloquear la regresión. ¿Seguro?',
      color: COLORS.warning,
    }),
  ];

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setDescription(
        '```' +
          panel('CAMBIO', [
            `${digimon.species.emoji} ${digimon.species.name}  Nv.${digimon.level}`,
            '        ↓',
            `${destino?.emoji ?? '❔'} ${destino?.name ?? ruta.to.name}`,
            '',
            destino
              ? `ATQ ${digimon.stats.attack} → ${destino.base.attack}`
              : '',
            destino ? `DEF ${digimon.stats.defense} → ${destino.base.defense}` : '',
            destino ? `VEL ${digimon.stats.speed} → ${destino.base.speed}` : '',
          ]) +
          '```',
      ),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          encodeNav(session, 'evo_hacer', {
            id: String(digimon.id),
            ruta: String(index),
          }),
        )
        .setLabel('Sí, evolucionar')
        .setEmoji('✨')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(encodeNav(session, 'evo_rutas', { id: String(digimon.id) }))
        .setLabel('Mejor no')
        .setEmoji('↩️')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  return { embeds, components };
});

register('evo_hacer', async (ctx) => {
  const { trainer, session } = ctx;
  const digimon = getDigimonOwnedBy(trainer.id, ctx.num('id', 0));
  const index = ctx.num('ruta', 0);

  if (!digimon) {
    ctx.flash('Ya no tienes ese Digimon.', 'error');
    return ctx.go('evolucion');
  }

  const antes = digimon.species;
  const result = evolveOwned(digimon, index, trainer, getInventory(trainer.id));

  if (!result.ok) {
    // `evolveOwned` ya devuelve el texto: la regla está escrita una sola vez,
    // en el repositorio, y la pantalla no la reinterpreta.
    ctx.flash(result.message, 'aviso');
    return ctx.refresh('evo_rutas', { id: String(digimon.id) });
  }

  const despues = getDigimonOwnedBy(trainer.id, digimon.id)!;

  // El resultado: la pantalla donde el jugador ve qué pasó y qué tiene ahora.
  const nuevos = despues.species.learnset
    .map((k) => MOVES[k])
    .filter(Boolean)
    .slice(0, 5);

  const embeds: EmbedBuilder[] = [
    new EmbedBuilder()
      .setColor(COLORS.legendary)
      .setAuthor({ name: `✨ EVOLUCIÓN COMPLETA` })
      .setDescription(
        `**${antes.emoji} ${antes.name}** → **${despues.species.emoji} ${despues.species.name}**\n\n` +
          `Nv.${despues.level}  ·  ` +
          `${ATTRIBUTE_EMOJI[despues.species.attribute]} ${ATTRIBUTE_NAMES[despues.species.attribute]}  ·  ` +
          despues.species.elements.map((e) => `${ELEMENT_EMOJI[e]} ${ELEMENT_NAMES[e]}`).join(' '),
      ),
  ];

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setDescription(
        '```' +
          panel('AHORA', [
            `PV  ${bar(despues.hp, despues.stats.hp, 10)} ${despues.hp}/${despues.stats.hp}`,
            `ATQ ${despues.stats.attack}  DEF ${despues.stats.defense}  VEL ${despues.stats.speed}`,
          ]) +
          '```',
      )
      .addFields({
        name: 'Aprende',
        value:
          nuevos.length > 0
            ? nuevos.map((m) => `${ELEMENT_EMOJI[m.element]} **${m.name}**`).join('\n')
            : '—',
        inline: true,
      }),
  );

  const historial = historyOf(despues.id);
  if (historial.length > 0) {
    embeds.push(
      new EmbedBuilder()
        .setColor(COLORS.neutral)
        .setTitle('Historia')
        .setDescription(
          historial
            .slice(-5)
            .reverse()
            .map((h) => `${h.kind === 'regresion' ? '↩️' : '➡️'} ${h.fromName} → **${h.toName}**`)
            .join('\n'),
        ),
    );
  }

  const components: ActionRowBuilder<ButtonBuilder>[] = [
    ...actionRow(
      [
        { screen: 'ficha', params: { id: String(despues.id) }, label: 'Ver ficha', emoji: '🔍', style: ButtonStyle.Success },
        { screen: 'evolucion', label: 'Evolución', emoji: '✨', style: ButtonStyle.Secondary },
        { screen: 'combate', label: 'A pelear', emoji: '⚔️', style: ButtonStyle.Primary },
      ],
      session,
    ),
    navRow(session, { backLabel: 'Equipo' }),
    ...areaRows(session, 'digimon'),
  ];

  return { embeds, components };
});

// ----------------------------------------------------------- revertir ----

register('evo_revertir', async (ctx) => {
  const { trainer, session } = ctx;
  const digimon = getDigimonOwnedBy(trainer.id, ctx.num('id', 0));

  if (!digimon) {
    ctx.flash('Ya no tienes ese Digimon.', 'error');
    return ctx.go('evolucion');
  }

  const dev = digimon.species.devolution;
  if (!dev) {
    ctx.flash('Esa forma no se puede deshacer.', 'error');
    return ctx.refresh('evo_rutas', { id: String(digimon.id) });
  }

  const coste = Object.entries(dev.items ?? {});
  const destino = getSpecies(dev.to);

  const embeds: EmbedBuilder[] = [
    header({
      area: 'digimon',
      title: '¿REGRESAR?',
      context:
        `**${digimon.species.name}** → **${destino?.name ?? dev.to}**\n\n` +
        `Coste: ${coste.map(([k, n]) => `${n}x ${getItem(k)?.name ?? k}`).join(' · ') || 'gratis'}`,
      color: COLORS.warning,
    }),
  ];

  const componentes: ActionRowBuilder<ButtonBuilder>[] = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeNav(session, 'evo_revertir_si', { id: String(digimon.id) }))
        .setLabel('Sí, retroceder')
        .setEmoji('↩️')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(encodeNav(session, 'evo_rutas', { id: String(digimon.id) }))
        .setLabel('Cancelar')
        .setEmoji('✖️')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  return { embeds, components: componentes };
});

register('evo_revertir_si', async (ctx) => {
  const { trainer } = ctx;
  const digimon = getDigimonOwnedBy(trainer.id, ctx.num('id', 0));

  if (!digimon) {
    ctx.flash('Ya no tienes ese Digimon.', 'error');
    return ctx.go('evolucion');
  }

  const result = devolveInto(digimon, trainer.id, getInventory(trainer.id));

  if (!result.ok) {
    // `devolveInto` devuelve la razón y los requisitos que faltan, no un texto.
    const falta = result.need && result.need.length > 0
      ? ` Te falta: ${result.need.map((m) => `${m.label} ${m.have}/${m.needed}`).join(', ')}.`
      : '';
    ctx.flash(mensajeRegresion(result.reason) + falta, 'aviso');
    return ctx.refresh('evo_rutas', { id: String(digimon.id) });
  }

  ctx.flash(`↩️ **${digimon.species.name}** ha vuelto a su forma anterior.`, 'ok');
  return ctx.go('evolucion');
});


/**
 * Motivos de `devolveInto`.
 *
 * `devolveInto` devuelve la razón y los requisitos que faltan, no un texto
 * listo para enseñar. El texto se escribe aquí porque solo lo ve la interfaz;
 * la regla (qué requisito se comprueba) sigue estando en el repositorio.
 */
function mensajeRegresion(reason: string): string {
  switch (reason) {
    case 'sin-material':
      return 'No tienes materiales para retroceder.';
    case 'no-poses':
      return 'Ya no tienes ese Digimon.';
    case 'no-regresion':
      return 'Esa forma no tiene a dónde volver.';
    case 'material-invalido':
      return 'Ese material no sirve para esta regresión.';
    default:
      return 'No se pudo retroceder.';
  }
}
