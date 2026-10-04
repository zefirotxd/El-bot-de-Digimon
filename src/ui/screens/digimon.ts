import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import {
  ATRIBUTOS_ES,
  atributoCoincide,
  claveCatalogoDe,
  entradaDe,
  listaDeFamilias,
  presentarImagen,
} from '../../game/catalogo.js';
import {
  countPCSlots,
  countPartySlots,
  depositToPC,
  getDigimonOwnedBy,
  getInventory,
  getLeader,
  listParty,
  listPC,
  setLeader,
  withdrawFromPC,
} from '../../game/repository.js';
import { config } from '../../config.js';
import { expToNextLevel, MAX_LEVEL } from '../../game/stats.js';
import { TIER_NAMES } from '../../game/progression.js';
import { ATTRIBUTE_EMOJI, ATTRIBUTE_NAMES } from '../../game/attributes.js';
import { ELEMENT_EMOJI, ELEMENT_NAMES } from '../../game/elements.js';
import { equippedGear, withEffectiveStats } from '../../game/gearRepo.js';
import { getEquipment, type Slot } from '../../game/equipment.js';
import {
  historyOf,
  routeStatuses,
  unlocksOf,
  type RouteStatus,
} from '../../game/evolutionRepo.js';
import { getSpecies } from '../../game/species.js';
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
} from '../components.js';
import { encodeNav } from '../nav.js';
import { refOf } from '../../game/dex.js';
import { licenseNote, refLines, refRow } from '../dexView.js';
import { register } from '../screen.js';
import { COLORS } from '../theme.js';

/**
 * El área Digimon.
 *
 * Tres niveles: el equipo (cómo estoy ahora), la ficha de un Digimon (cómo
 * está), y la decisión (qué hago con él). Entremedias, el PC y el
 * equipamiento.
 *
 * La ficha es la pantalla que más se visita del juego y la que peor estaba
 * antes: `/digivice ficha` devolvía un embed con cuatro campos y una fila de
 * botones, sin forma de volver al equipo más que cerrar el mensaje.
 */

/** Tarjeta compacta de un Digimon, para el listado del equipo. */
function card(digimon: ReturnType<typeof getDigimonOwnedBy>): string {
  if (!digimon) return '_vacío_';
  const species = digimon.species;
  return [
    `\`\`\`${species.emoji} ${digimon.nickname ?? species.name}`,
    `Nv.${String(digimon.level).padStart(3)} ${TIER_NAMES[species.tier]}`,
    `PV  ${bar(digimon.hp, digimon.stats.hp, 8)} ${digimon.hp}/${digimon.stats.hp}\`\`\``,
  ].join('\n');
}

// ------------------------------------------------------------- equipo -----

register('digimon', async (ctx) => {
  const { trainer, session } = ctx;
  const party = listParty(trainer.id);
  const pc = listPC(trainer.id);
  const leader = party[0] ?? null;

  const embeds: EmbedBuilder[] = [
    header({
      area: 'digimon',
      title: 'DIGIMON',
      context:
        `Equipo **${party.length}/${config.maxPartySize}**  ·  ` +
        `PC **${pc.length}/${config.pcCapacity}**` +
        (leader ? `\n${leader.species.emoji} Líder: **${leader.nickname ?? leader.species.name}** Nv.${leader.level}` : '\n⚠️ No tienes líder'),
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  // El equipo: un embed con las tarjetas, y botones uno por Digimon.
  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.digimon)
      .setTitle('Tu equipo')
      .setDescription(
        party.length > 0
          ? party
              .map((d, i) => `**[${i + 1}]** ${card(d)}`)
              .join('\n\n')
          : '_No tienes ningún Digimon en el equipo._',
      ),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  // Botones del equipo: hasta 4, que es el máximo de una fila y lo que cabe
  // cómodo en una pantalla de móvil.
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const d of party.slice(0, 4)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(encodeNav(session, 'ficha', { id: String(d.id) }))
        .setLabel(d.nickname ?? d.species.name)
        .setEmoji(d.species.emoji)
        .setStyle(d.id === leader?.id ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
  }
  if (row.components.length > 0) components.push(row);

  components.push(
    ...actionRow(
      [
        { screen: 'pc', label: 'PC', emoji: '🗄️', style: ButtonStyle.Primary },
        { screen: 'equipo', label: 'Equipamiento', emoji: '⚙️', style: ButtonStyle.Secondary },
        { screen: 'evolucion', label: 'Evolución', emoji: '✨', style: ButtonStyle.Secondary },
      ],
      session,
    ),
  );

  components.push(navRow(session, { hideBack: false }));
  components.push(...areaRows(session, 'digimon'));

  return { embeds, components };
});

// ------------------------------------------------------------- ficha -----

register('ficha', async (ctx) => {
  const { trainer, session } = ctx;
  const id = ctx.num('id', 0);
  const digimon = getDigimonOwnedBy(trainer.id, id);

  if (!digimon) {
    ctx.flash('Ya no tienes ese Digimon.', 'error');
    return ctx.go('digimon');
  }

  // Las estadísticas SON las del equipo: los stickers suman, y una ficha que
  // no lo refleja hace que el jugador equipe y no vea nada.
  const shown = withEffectiveStats(digimon);
  const gear = equippedGear(digimon.id);
  const isLead = getLeader(trainer.id)?.id === digimon.id;
  const species = digimon.species;

  const expNeeded = digimon.level >= MAX_LEVEL ? 0 : expToNextLevel(digimon.level);
  const expText =
    digimon.level >= MAX_LEVEL
      ? '**MAX**'
      : `${bar(digimon.exp, expNeeded, 10)} ${Math.round((digimon.exp / expNeeded) * 100)}%`;

  // Las filas de la referencia se rellenan más abajo, cuando ya se sabe si la
  // especie tiene ficha en el catálogo. Se declaran aquí porque se usan en el
  // bloque de botones, que está después.
  let filasReferencia: ActionRowBuilder<ButtonBuilder>[] = [];

  const embeds: EmbedBuilder[] = [
    header({
      area: 'digimon',
      title: species.name.toUpperCase(),
      context:
        `Nv.${digimon.level} · ${TIER_NAMES[species.tier]}` +
        `${isLead ? ' · ⭐ LÍDER' : ''}\n` +
        `\`\`\`EXP ${expText}\`\`\``,
      color: isLead ? COLORS.digimon : COLORS.hub,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  // Ficha en marco: es lo que el jugador mira primero.
  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setDescription(
        '```' +
          panel(
            `#${digimon.id}  ${ATTRIBUTE_EMOJI[species.attribute]} ${ATTRIBUTE_NAMES[species.attribute]}`,
            [
              `❤️ PV      ${String(shown.hp).padStart(4)} / ${shown.stats.hp}`,
              `⚔️ ATQ     ${String(shown.stats.attack).padStart(4)}`,
              `🛡️ DEF     ${String(shown.stats.defense).padStart(4)}`,
              `💨 VEL     ${String(shown.stats.speed).padStart(4)}`,
              '',
              `ELEMENTOS  ${species.elements.map((e) => `${ELEMENT_EMOJI[e]} ${ELEMENT_NAMES[e]}`).join('  ')}`,
            ],
          ) +
          '```',
      )
      .addFields({
        name: 'Equipo puesto',
        value:
          gear.length > 0
            ? gear
                .map((g) => {
                  const def = getEquipment(g.itemKey);
                  return `${SLOT_EMOJI[def?.slot ?? 'arma']} ${def?.name ?? g.itemKey}${
                    g.upgrade > 0 ? ` +${g.upgrade}` : ''
                  }`;
                })
                .join('\n')
            : '_Nada equipped._',
        inline: true,
      })
      .addFields({
        name: 'Almacén',
        value:
          digimon.storage === 'party'
            ? 'En el equipo'
            : `En el PC (${countPCSlots(trainer.id)}/${config.pcCapacity})`,
        inline: true,
      }),
  );

  // Evoluciones: la decisión que el jugador tiene delante.
  const inventory = getInventory(trainer.id);
  const rutas = routeStatuses(digimon, trainer, inventory, unlocksOf(trainer.id));
  const lineaFinal = species.evolutions.length === 0;

  embeds.push(
    new EmbedBuilder()
      .setColor(lineaFinal ? COLORS.legendary : COLORS.digivice)
      .setTitle(lineaFinal ? 'Forma final' : 'Evoluciones disponibles')
      .setDescription(
        lineaFinal
          ? 'No tiene más rutas. Has llegado al final de su línea.'
          : rutas
              .map((r) => rutaLine(r))
              .join('\n'),
      )
      .setFooter({
        text:
          species.lore ??
          'La evolución es manual: subir de nivel abre la ruta, no la ejecuta.',
      }),
  );

  // Ficha de referencia de la ESPECIE, desde el catálogo.
  //
  // Va en su propio embed y no mezclado con las estadísticas, porque son cosas
  // distintas: las estadísticas son del Digimon del jugador, y lo de aquí son los
  // datos de la ESPECIE, que comparten todos los que la tienen.
  //
  // LA SEPARACIÓN QUE PIDE EL ENCARGO: dos Agumon de nivel distinto son dos
  // Digimon con estadísticas, apodo y equipo propios, pero UN solo cuerpo de
  // referencia. Por eso esto no se guarda en el Digimon: se busca por especie en el
  // catálogo. Duplicarlo en cada ejemplar sería tirar la misma ficha mil veces y
  // hacer que se desincronizasen.
  //
  // Y el Atributo oficial NO sobrescribe el del juego. Agumon es `virus` en el
  // combate y `Vaccine` en la fuente; se muestran los dos y se dice que difieren.
  // Cuando el juego se aparta del canon a propósito, esa separación está escrita
  // en `dex-accepted.json`; aquí solo se muestra.
  const claveCat = claveCatalogoDe(species.key);
  const refCatalogo = claveCat ? entradaDe(claveCat) : null;

  if (refCatalogo) {
    const img = presentarImagen(refCatalogo);
    const familias = listaDeFamilias(refCatalogo);
    // ¿El atributo del juego se aparta del que publica la fuente? Puede hacerlo a
    // propósito —el triángulo del juego está invertido por diseño— y en ese caso
    // la divergencia está registrada en `dex-accepted.json`. Aquí solo se dice.
    const diverge = !atributoCoincide(refCatalogo.atributo.valor, species.attribute);

    const fichaEspecie = new EmbedBuilder()
      .setColor(COLORS.digivice)
      .setAuthor({ name: '📖 FICHA DE ESPECIE' })
      .setDescription(
        [
          `**Nivel evolutivo** ${refCatalogo.nivel.valor}`,
          `**Tipo** ${refCatalogo.tipo.valor}`,
          `**Atributo** ${ATRIBUTOS_ES[refCatalogo.atributo.valor] ?? refCatalogo.atributo.valor}`,
          refCatalogo.atributo2.valor !== ''
            ? `**Segundo atributo** ${ATRIBUTOS_ES[refCatalogo.atributo2.valor] ?? refCatalogo.atributo2.valor}`
            : '',
          familias.length > 0 ? `**Familias** ${familias.slice(0, 4).join(', ')}` : '**Familias** *(la fuente no las declara)*',
          '',
          `**En el juego** ${ATTRIBUTE_NAMES[species.attribute]} · ${species.elements.map((e) => `${ELEMENT_EMOJI[e]} ${ELEMENT_NAMES[e]}`).join(' · ')}`,
          diverge ? '_El atributo del juego difiere del canon a propósito; está registrado como tal._' : '',
        ]
          .filter((l) => l !== '')
          .join('\n'),
      )
      .addFields({
        name: 'Fuente',
        value: `[${refCatalogo.nombre} en la wiki](${refCatalogo.procedencia.url})`,
        inline: true,
      });

    // El botón a la ficha completa del catálogo. Aquí va el resumen; los ataques
    // documentados, la línea evolutiva entera y la procedencia de la imagen están
    // en la ficha de catálogo, que tiene sitio para ellos.
    fichaEspecie.addFields({
      name: 'Más',
      value: 'Ataques documentados, línea evolutiva completa y procedencia de la imagen, en la ficha del catálogo.',
      inline: true,
    });

    if (img.embebir) fichaEspecie.setThumbnail(img.embebir);
    if (img.aviso) fichaEspecie.setFooter({ text: img.aviso });

    embeds.push(fichaEspecie);

    // Botón de enlace a la imagen y a la ficha completa.
    const filasRef: ActionRowBuilder<ButtonBuilder>[] = [];

    if (img.pagina) {
      filasRef.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel(img.etiqueta)
            .setStyle(ButtonStyle.Link)
            .setURL(img.pagina)
            .setEmoji('🔗'),
          new ButtonBuilder()
            .setCustomId(encodeNav(session, 'cat_especie', { e: refCatalogo.key }))
            .setLabel('Ficha completa')
            .setEmoji('📚')
            .setStyle(ButtonStyle.Secondary),
        ),
      );
    } else {
      filasRef.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(encodeNav(session, 'cat_especie', { e: refCatalogo.key }))
            .setLabel('Ficha completa en el catálogo')
            .setEmoji('📚')
            .setStyle(ButtonStyle.Secondary),
        ),
      );
    }

    filasReferencia = filasRef;
  }

  // Historia.
  const historia = historyOf(digimon.id);
  if (historia.length > 0) {
    embeds.push(
      new EmbedBuilder()
        .setColor(COLORS.neutral)
        .setTitle('Historia')
        .setDescription(
          historia
            .slice(-6)
            .reverse()
            .map(
              (h) =>
                `${h.kind === 'regresion' ? '↩️' : '➡️'} **${h.fromName}** → **${h.toName}**`,
            )
            .join('\n'),
        ),
    );
  }

  // --------------------------------------------------------- botones -----
  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  // Las de la referencia van primero: están debajo del embed de la ficha de
  // especie, que es donde el jugador acaba de mirar. Si fueran al final, entre
  // cinco filas de botones de gestión, no se encontrarían.
  components.push(...filasReferencia);

  const principal = new ActionRowBuilder<ButtonBuilder>();
  principal.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(session, 'ficha_evo', { id: String(digimon.id) }))
      .setLabel('Evolucionar')
      .setEmoji('✨')
      .setStyle(rutas.length > 0 ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(lineaFinal),
    new ButtonBuilder()
      .setCustomId(encodeNav(session, 'ficha_gear', { id: String(digimon.id) }))
      .setLabel('Equipo')
      .setEmoji('⚙️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(encodeNav(session, 'mover', { id: String(digimon.id) }))
      .setLabel(digimon.storage === 'party' ? 'Guardar en PC' : 'Sacar al equipo')
      .setEmoji(digimon.storage === 'party' ? '🗄️' : '📤')
      .setStyle(ButtonStyle.Secondary),
  );

  if (!isLead && digimon.storage === 'party') {
    principal.addComponents(
      new ButtonBuilder()
        .setCustomId(encodeNav(session, 'lider', { id: String(digimon.id) }))
        .setLabel('Poner de líder')
        .setEmoji('⭐')
        .setStyle(ButtonStyle.Success),
    );
  }

  components.push(principal);

  const info = new ActionRowBuilder<ButtonBuilder>();
  info.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(session, 'bestiario', { species: species.key }))
      .setLabel('Ficha de especie')
      .setEmoji('📖')
      .setStyle(ButtonStyle.Secondary),
  );
  info.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeNav(session, 'combate', { target: String(digimon.id) }))
      .setLabel('Combatir con él')
      .setEmoji('⚔️')
      .setStyle(ButtonStyle.Success),
  );

  const backRow = navRow(session, { backLabel: 'Equipo' });
  backRow.components.push(...info.components);
  components.push(backRow);

  // Las filas de la referencia ya están arriba, justo debajo de su propio embed.
  // Aquí no se añaden más: un enlace a la fuente debajo de cinco filas de botones
  // de gestión no se encuentra, y la ficha de especie está encima.

  components.push(...areaRows(session, 'digimon'));

  return { embeds, components };
});

// ----------------------------------------------- evolucionar desde la ficha --

/**
 * Botón "Evolucionar" de la ficha.
 *
 * No evoluciona: lleva a la pantalla de rutas. Esa separación es la razón por la
 * que existe la pantalla de confirmar — pulsar "evolucionar" sobre la ficha
 * sería un clic que ejecuta sin preguntar, y elegir rama no se puede deshacer
 * hasta que se desbloquea la regresión.
 */
register('ficha_evo', async (ctx) => {
  const id = ctx.num('id', 0);
  const digimon = getDigimonOwnedBy(ctx.trainer.id, id);

  if (!digimon) {
    ctx.flash('Ya no tienes ese Digimon.', 'error');
    return ctx.go('digimon');
  }

  return ctx.go('evo_rutas', { id: String(id) });
});

const SLOT_EMOJI: Record<Slot, string> = {
  arma: '⚔️',
  armadura: '🛡️',
  chip: '💠',
  accesorio: '📿',
};

/** Una línea por ruta de evolución, con lo que falta para poder tomarla. */
/**
 * Una línea por ruta, con lo que falta para poder tomarla.
 *
 * Se apoya en `missing` y `ready`, que es lo que el repositorio ya calcula:
 * la pantalla no vuelve a interpretar los requisitos, porque si lo hiciera
 * habría dos reglas de "puedo evolucionar" y tarde o temprano discreparían.
 */
function rutaLine(r: RouteStatus): string {
  const destino = r.to;
  const etiqueta = `${destino.emoji} **${destino.name}**`;

  if (r.lockedByBranch) {
    return `🔒 ${etiqueta} — cerraste la rama en **${r.lockedByBranch}**`;
  }

  if (r.ready) return `✅ ${etiqueta} — ¡listo!`;

  const falta = r.missing.map((m) => `${m.label} ${m.have}/${m.needed}`).join(
);
  return `🟡 ${etiqueta} — falta ${falta}`;
}

// ------------------------------------------------------------------ PC ----

register('pc', async (ctx) => {
  const { trainer, session } = ctx;
  const stored = listPC(trainer.id);
  const party = listParty(trainer.id);

  const embeds: EmbedBuilder[] = [
    header({
      area: 'digimon',
      title: 'PC · DEPÓSITO',
      context:
        `Equipo **${party.length}/${config.maxPartySize}**  ·  ` +
        `PC **${stored.length}/${config.pcCapacity}**\n` +
        '```' +
        panel('CAPACIDAD', [
          `EQUIPO ${'█'.repeat(party.length)}${'░'.repeat(Math.max(0, config.maxPartySize - party.length))}  ${party.length}/${config.maxPartySize}`,
          `PC     ${'█'.repeat(stored.length)}${'░'.repeat(Math.max(0, config.pcCapacity - stored.length))}  ${stored.length}/${config.pcCapacity}`,
        ]) +
        '```',
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  const page = ctx.page();
  const { page: p, pages, items } = paginate(stored, page, 10);

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setTitle(`Depositados (${stored.length})`)
      .setDescription(
        items.length > 0
          ? items
              .map(
                (d, i) =>
                  `\`${String((p - 1) * 10 + i + 1).padStart(2)}\` ${d.species.emoji} **${d.nickname ?? d.species.name}** Nv.${d.level}`,
              )
              .join('\n')
          : '_El PC está vacío._',
      ),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  // Sacar: hasta cinco en dos filas.
  if (items.length > 0) {
    for (let i = 0; i < items.length; i += 5) {
      const row = new ActionRowBuilder<ButtonBuilder>();
      for (const d of items.slice(i, i + 5)) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(encodeNav(session, 'mover', { id: String(d.id) }))
            .setLabel('📤')
            .setEmoji(d.species.emoji)
            .setStyle(ButtonStyle.Success)
            .setDisabled(party.length >= config.maxPartySize),
        );
      }
      components.push(row);
    }
  }

  const pager = pageRow(session, 'pc', {}, p, pages);

  const nav = navRow(session, { backLabel: 'Equipo' });
  if (pager) nav.components.push(...pager.components);
  components.push(nav);
  components.push(...areaRows(session, 'digimon'));

  return { embeds, components };
});

// -------------------------------------------------------------- acciones --

register('lider', async (ctx) => {
  const result = setLeader(ctx.trainer.id, ctx.num('id', 0));

  if (!result.ok) {
    ctx.flash('No se pudo cambiar el líder.', 'error');
  } else {
    const nuevo = getLeader(ctx.trainer.id);
    ctx.flash(`⭐ **${nuevo?.nickname ?? nuevo?.species.name}** ahora lidera tu equipo.`, 'ok');
  }

  return ctx.refresh('digimon');
});

register('mover', async (ctx) => {
  const id = ctx.num('id', 0);
  const digimon = getDigimonOwnedBy(ctx.trainer.id, id);

  if (!digimon) {
    ctx.flash('Ya no tienes ese Digimon.', 'error');
    return ctx.go('digimon');
  }

  // Mover entre equipo y PC va por el repositorio: los dos ya saben
  // comprobar la capacidad y que no se guarde al último, y aquí solo se cuenta
  // el resultado. La razón del rechazo se usa tal cual porque ya está escrita
  // para el jugador.
  const result =
    digimon.storage === 'party'
      ? depositToPC(ctx.trainer.id, id)
      : withdrawFromPC(ctx.trainer.id, id);

  if (!result.ok) {
    ctx.flash(motivoDeFallo(result.reason), 'aviso');
    return ctx.refresh('ficha', { id: String(id) });
  }

  ctx.flash(
    digimon.storage === 'party'
      ? `🗄️ **${digimon.nickname ?? digimon.species.name}** está en el PC.`
      : `📤 **${digimon.nickname ?? digimon.species.name}** ha salido al equipo.`,
    'ok',
  );

  return ctx.refresh('ficha', { id: String(id) });
});

/** Los motivos de rechazo del repositorio, con el texto que ve el jugador. */
function motivoDeFallo(reason: string): string {
  switch (reason) {
    case 'lleno':
      return `El equipo está lleno (${config.maxPartySize}). Saca alguno al PC primero.`;
    case 'ultimo':
      return 'No puedes guardar al último Digimon del equipo.';
    case 'no-existe':
      return 'Ya no tienes ese Digimon.';
    default:
      return 'No se pudo mover ese Digimon.';
  }
}