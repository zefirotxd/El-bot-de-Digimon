import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { SPECIES, getSpecies } from '../../game/species.js';
import { dexOf, dexProgress } from '../../game/dexRepo.js';
import { TIER_NAMES } from '../../game/progression.js';
import { ATTRIBUTE_EMOJI, ATTRIBUTE_NAMES } from '../../game/attributes.js';
import { ELEMENT_EMOJI, ELEMENT_NAMES, affinityReport } from '../../game/elements.js';
import { MOVES } from '../../game/moves.js';
import { getItem } from '../../game/items.js';
import { collectionProgress, unlocksOf } from '../../game/evolutionRepo.js';
import { getZone, zoneRoster } from '../../game/zones.js';
import {
  actionRow,
  areaRows,
  header,
  navRow,
  paginate,
  pageRow,
  panel,
  playerField,
} from '../components.js';
import { encodeNav } from '../nav.js';
import { familyIndex, refOrEmpty } from '../../game/dex.js';
import { licenseNote, refLine, refRow } from '../dexView.js';
import { register } from '../screen.js';
import type { NavSession } from '../session.js';
import { COLORS } from '../theme.js';

/**
 * El Digivice como dispositivo: registro, bestiario, misiones y logros.
 *
 * El registro es el índice completo de las 35 especies del juego. Antes solo
 * existía `/pokedex`, que volcaba el catálogo entero en un embed (que se
 * cortaba) o exigía que escribieras el nombre de la especie.
 *
 * El bestiario es lo mismo pero con el estado del jugador: qué ha visto, qué
 * ha capturado y qué le falta. La diferencia no es cosmética — un catálogo sin
 * progreso es documentación, un bestiario con progreso es una lista de cosas
 * por hacer.
 */

register('registro', async (ctx) => {
  const { trainer, session } = ctx;
  const dex = dexProgress(trainer.id);
  const coleccion = collectionProgress(trainer.id);

  const embeds: EmbedBuilder[] = [
    header({
      area: 'digivice',
      title: 'REGISTRO',
      context: 'El índice completo de las especies del Mundo Digital.',
      color: COLORS.digivice,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.digivice)
      .setDescription(
        '```' +
          panel('TU REGISTRO', [
            `Especies:       ${dex.total}`,
            `Vistas:         ${dex.seen}`,
            `Capturadas:     ${dex.caught}`,
            `Formas abiertas: ${coleccion.unlocked}`,
            '',
            ...Object.entries(dex.byTier).map(
              ([tier, dato]) =>
                `${tier.padEnd(9)} ${dato.caught}/${dato.total} capturadas`,
            ),
          ]) +
          '```',
      ),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [
    ...actionRow(
      [
        { screen: 'bestiario', label: 'Mi bestiario', emoji: '📖', style: ButtonStyle.Success },
        // El catálogo y el bestiario son cosas distintas y por eso tienen botones
        // distintos: el bestiario son las especies JUGABLES y lo que el jugador ha
        // visto; el catálogo son todas las especies DOCUMENTADAS, que no se pueden
        // capturar. Meterlos en la misma pantalla obligaría a elegir entre una lista
        // de treinta y otra de mil y pico.
        { screen: 'catalogo', label: 'Catálogo', emoji: '📚', style: ButtonStyle.Primary },
        { screen: 'misiones', label: 'Misiones', emoji: '📋', style: ButtonStyle.Primary },
      ],
      session,
    ),
  ];

  components.push(
    ...actionRow([{ screen: 'logros', label: 'Logros', emoji: '🏅', style: ButtonStyle.Primary }], session),
  );

  components.push(navRow(session));
  components.push(...areaRows(session, 'digivice'));

  return { embeds, components };
});

// ------------------------------------------------------------ bestiario --

register('bestiario', async (ctx) => {
  const { trainer, session } = ctx;
  const dex = dexOf(trainer.id);
  const filtroZona = ctx.params.zone ? getZone(ctx.params.zone) : undefined;
  const filtroFamilia = ctx.params.familia ?? '';

  // Tres filtros combinables: zona, familia y "solo los que he visto".
  // La familia viene del bestiario de referencia y es la unica forma de
  // recorrer 35 fichas sin mirarlas una a una.
  const indice = familyIndex();

  let pool = filtroZona ? zoneRoster(filtroZona).map((s) => s.key) : Object.keys(SPECIES);

  if (filtroFamilia) {
    const miembros = indice.get(filtroFamilia) ?? [];
    pool = pool.filter((k) => miembros.includes(k));
  }

  const soloVistos = ctx.params.vistos === '1';
  if (soloVistos) pool = pool.filter((k) => dex.has(k));

  const { page: p, pages, items } = paginate(pool, ctx.page(), 8);
  const total = pool.length;
  const vistos = pool.filter((k) => dex.has(k)).length;
  const capturados = pool.filter((k) => dex.get(k)?.caught).length;

  const filtros: string[] = [];
  if (filtroZona) filtros.push(`zona: **${filtroZona.name}**`);
  if (filtroFamilia) filtros.push(`familia: **${filtroFamilia}**`);
  if (soloVistos) filtros.push('solo los que vi');

  const embeds: EmbedBuilder[] = [
    header({
      area: 'digivice',
      title: filtroFamilia
        ? `BESTIARIO · ${filtroFamilia.toUpperCase()}`
        : filtroZona
          ? `BESTIARIO · ${filtroZona.name.toUpperCase()}`
          : 'MI BESTIARIO',
      context:
        `👁️ **${vistos}/${total}** vistas  ·  ✔️ **${capturados}** capturadas\n` +
        (filtros.length > 0
          ? `Filtrando por ${filtros.join(' · ')}`
          : 'Todas las especies del catalogo.'),
      color: COLORS.digivice,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  // Sin ver, el nombre se tapa pero se dicen el nivel y el tipo: saber que hay
  // 35 especies y que llevas 12 es el primer motivo para explorar.
  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setDescription(
        items.length > 0
          ? items
              .map((key) => {
                const species = getSpecies(key);
                if (!species) return null;

                const ref = refOrEmpty(key);
                const entrada = dex.get(key);
                const marca = entrada?.caught ? '✔️' : entrada ? '👁️' : '❔';

                if (!entrada) {
                  return (
                    `${marca} **???**\n` +
                    `\`   ${ref.level ?? '?'} · ${ref.type ?? '?'} · ${species.tier}\``
                  );
                }

                return (
                  `${marca} ${species.emoji} **${species.name}**\n` +
                  `\`   ${ref.level ?? '?'} · ${ref.attribute ?? '?'} · ${refLine(ref)}\``
                );
              })
              .filter(Boolean)
              .join('\n')
          : '_Nada coincide con ese filtro._',
      )
      .setFooter({ text: `${p}/${pages} · ✔️ capturado  👁️ visto  ❔ sin ver` }),
  );

  // La fila del select se declara aparte porque no lleva botones: `components`
  // es una lista heterogénea y mezclar los dos tipos en un array obliga a
  // tiparlo de forma laxa en todas partes.
  const selects: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  // El filtro de familia es un select y no botones: hay diez familias y cinco
  // botones por fila, asi que con botones habria que paginar el filtro, que es
  // absurdo para elegir un dato.
  const familias = [...indice.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([nombre, miembros]) => ({ nombre, total: miembros.length }));

  // Se calcula aqui porque lo usan dos sitios: la fila de atajos de especie
  // (cuando hay paginacion) y la fila de navegacion (cuando no la hay).
  const pager = pageRow(session, 'bestiario', ctx.params, p, pages);

  if (familias.length > 0) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(encodeSelect(session, 'dex_familia', filtroFamilia))
      .setPlaceholder(filtroFamilia ? `Familia: ${filtroFamilia}` : 'Filtrar por familia')
      .addOptions([
        {
          label: 'Todas las familias',
          description: `${pool.length} especies`,
          value: '*',
          ...(filtroFamilia ? { default: true } : {}),
        },
        ...familias.map((f) => ({
          label: f.nombre.slice(0, 100),
          description: `${f.total} especies`,
          value: f.nombre,
          ...(f.nombre === filtroFamilia ? { default: true } : {}),
        })),
      ]);

    selects.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }

  // Los atajos de especie ceden sitio a la paginación: son una comodidad (el
  // nombre ya está en la tarjeta) y la paginación es navegación de verdad.
  // El `pager` se calcula antes porque lo usan dos sitios: esta fila cuando hay
  // paginación, y la de navegación cuando no la hay.
  const cupoEspecie = pages > 1 ? 2 : 5;
  const vistosEnPagina = items.filter((k) => dex.has(k)).slice(0, cupoEspecie);

  if (vistosEnPagina.length > 0) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const key of vistosEnPagina) {
      const species = getSpecies(key)!;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(session, 'dex', { species: key }))
          .setLabel(species.name)
          .setEmoji(species.emoji)
          .setStyle(ButtonStyle.Secondary),
      );
    }
    if (pager) row.addComponents(...pager.components);
    components.push(row);
  } else if (pager) {
    components.push(pager);
  }

  const nav = navRow(session, {
    backLabel: filtroZona ? 'Volver a la zona' : filtroFamilia ? 'Quitar filtro' : 'Registro',
  });

  if (soloVistos) {
    nav.addComponents(
      new ButtonBuilder()
        .setCustomId(encodeNav(session, 'bestiario', sinFamilia(ctx.params)))
        .setLabel('Ver todos')
        .setEmoji('👁️')
        .setStyle(ButtonStyle.Success),
    );
  } else if (total > 0) {
    nav.addComponents(
      new ButtonBuilder()
        .setCustomId(encodeNav(session, 'bestiario', { ...ctx.params, vistos: '1' }))
        .setLabel('Solo los que vi')
        .setEmoji('👁️')
        .setStyle(ButtonStyle.Secondary),
    );
  }


  // La paginación va en su propia fila: el `navRow` de arriba ya lleva dos
  // botones, el de "solo los que vi" un tercero, y la paginación tres más.
  // Son seis, y Discord admite cinco por fila.
  components.push(nav);
  components.push(...areaRows(session, 'digivice'));

  // El select de familia va primero: es el filtro, y el jugador lo busca
  // antes que los atajos de especie.
  return { embeds, components: [...selects, ...components] };
});

/** Los parametros del bestiario sin el filtro de familia ni la pagina. */
function sinFamilia(params: Record<string, string>): Record<string, string> {
  const copia = { ...params };
  delete copia.familia;
  delete copia.page;
  return copia;
}

/**
 * `custom_id` del select de familia.
 *
 * Las familias llevan acentos y apostrofes ("Dragon's Roar"), que rompen el
 * formato `n:pantalla:clave=valor`. El valor real viaja en
 * `interaction.values[0]`; aquí solo va lo necesario para enrutar.
 */
function encodeSelect(session: NavSession, accion: string, _familia: string): string {
  return `sel:${accion}:${session.nonce}`;
}

// --------------------------------------------------------- ficha especie --

register('dex', async (ctx) => {
  const { session } = ctx;
  const species = getSpecies(ctx.params.species ?? '');

  if (!species) {
    ctx.flash('Esa especie no existe.', 'error');
    return ctx.go('bestiario');
  }

  // Ficha de especie del bestiario de referencia.
  const ref = refOrEmpty(species.key);

  const afinidades = affinityReport(species);
  const rutas = species.evolutions;

  const embeds: EmbedBuilder[] = [
    header({
      area: 'digivice',
      title: species.name.toUpperCase(),
      context:
        `${ATTRIBUTE_EMOJI[species.attribute]} ${ATTRIBUTE_NAMES[species.attribute]}  ·  ` +
        `${species.elements.map((e) => `${ELEMENT_EMOJI[e]} ${ELEMENT_NAMES[e]}`).join('  ')}  ·  ` +
        `${TIER_NAMES[species.tier]}`,
      color: COLORS.digivice,
    }),
  ];

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setDescription(
        '```' +
          panel('DATOS', [
            `PV base: ${species.base.hp}  ATQ: ${species.base.attack}`,
            `DEF base: ${species.base.defense}  VEL: ${species.base.speed}`,
            `Tamaño: ${(species.catchRate * 100).toFixed(0)}% de captura`,
            '',
            ...(species.lore ? [_speciesLore(species.lore)] : []),
          ]) +
          '```',
      )
      .addFields({
        name: '🎯 Afinidad elemental',
        value: [
          afinidades.weak.length > 0
            ? `◎ **Muy débil a** ${afinidades.weak.map((e) => `${ELEMENT_EMOJI[e]} ${ELEMENT_NAMES[e]}`).join(', ')}`
            : '',
          afinidades.resists.length > 0
            ? `🛡️ **Resiste** ${afinidades.resists.map((e) => `${ELEMENT_EMOJI[e]} ${ELEMENT_NAMES[e]}`).join(', ')}`
            : '',
          afinidades.immune.length > 0
            ? `✖️ **Inmune a** ${afinidades.immune.map((e) => `${ELEMENT_EMOJI[e]} ${ELEMENT_NAMES[e]}`).join(', ')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n') || '—',
        inline: true,
      }),
  );

  // `SpeciesDef` guarda `learnset` (claves), no `moves`. La diferencia importa:
  // la learnset es lo que puede aprender, no lo que trae al aparecer.
  const movimientos = species.learnset
    .map((key: string) => MOVES[key])
    .filter(Boolean)
    .slice(0, 8);

  if (movimientos.length > 0) {
    embeds.push(
      new EmbedBuilder()
        .setColor(COLORS.neutral)
        .setTitle('Puede aprender')
        .setDescription(
          movimientos
            .map(
              (m: (typeof MOVES)[string]) =>
                `${ELEMENT_EMOJI[m.element]} **${m.name}** · ${
                  m.category === 'estado' ? 'Estado' : `Pot ${m.power}`
                } · ${m.energyCost}⚡ · ${Math.round(m.accuracy * 100)}%`,
            )
            .join('\n'),
        ),
    );
  }

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.digimon)
      .setTitle(rutas.length > 0 ? 'Evolución' : 'Forma final')
      .setDescription(
        rutas.length > 0
          ? rutas
              .map((r) => {
                const destino = getSpecies(r.to);
                const costes = [`Nv.${r.level}`];
                if (r.wins !== undefined) costes.push(`${r.wins} vict.`);
                if (r.digibytes !== undefined) costes.push(`${r.digibytes} DB`);
                for (const [k, n] of Object.entries(r.items ?? {})) {
                  const def = getItem(k);
                  if (def) costes.push(`${n}x ${def.name}`);
                }
                return `${r.branch ? '🔀' : '➡️'} **${destino?.name ?? r.to}** — ${costes.join(' · ')}`;
              })
              .join('\n')
          : 'No evoluciona más.',
      ),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [
    navRow(session, { backLabel: 'Bestiario' }),
    ...areaRows(session, 'digivice'),
  ];

  return { embeds, components };
});

function _speciesLore(lore: string): string {
  const words = lore.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + word).length > 34) {
      lines.push(line);
      line = '';
    }
    line += word + ' ';
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join('\n');
}