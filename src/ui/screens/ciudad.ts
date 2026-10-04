import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import {
  buyItem,
  getDigimonOwnedBy,
  getInventory,
} from '../../game/repository.js';
import { ITEMS, MATERIALS, getItem } from '../../game/items.js';
import {
  type GearSlotView,
  equipItem,
  equippedGear,
  gearSlots,
  ownedGear,
  unequip,
  upgradeGear,
} from '../../game/gearRepo.js';
import {
  MAX_UPGRADE,
  RARITY_COLORS,
  RARITY_NAMES,
  SLOTS,
  SLOT_NAMES,
  getEquipment,
  upgradeCost,
  type Slot,
} from '../../game/equipment.js';
import {
  actionRow,
  areaRows,
  formatBytes,
  header,
  navRow,
  paginate,
  pageRow,
  panel,
  playerField,
} from '../components.js';
import { encodeNav } from '../nav.js';
import { register } from '../screen.js';
import { COLORS } from '../theme.js';

/**
 * La Ciudad: donde se gasta lo que se gana.
 *
 * Tres sitios distintos con tresearable problemas distintos. La tienda es un
 * catálogo largo (paginación). El inventario es una lista de lo tuyo (y hay que
 * poder usarlo). El equipamiento es una decisión porDigimon (y hay que poder
 * ver el efecto antes de decidir).
 *
 * Todos comparten la misma regla: nada se compra ni se equipa sin pasar por la
 * transacción del repositorio, y la pantalla solo cuenta el resultado.
 */

const SLOT_EMOJI: Record<Slot, string> = {
  arma: '⚔️',
  armadura: '🛡️',
  chip: '💠',
  accesorio: '📿',
};

// -------------------------------------------------------------- ciudad ----

register('ciudad', async (ctx) => {
  const { trainer, session } = ctx;
  const inventario = getInventory(trainer.id);
  const piezas = ownedGear(trainer.id);
  const usados = Object.values(inventario)
    .filter((n) => n > 0)
    .reduce((a, b) => a + b, 0);

  const embeds: EmbedBuilder[] = [
    header({
      area: 'ciudad',
      title: 'CIUDAD',
      context: `💰 **${formatBytes(trainer.digibytes)}** DigiBytes disponibles`,
      color: COLORS.ciudad,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  const consumibles = Object.values(ITEMS).filter((it) => it.role !== 'material').length;
  const materiales = Object.keys(MATERIALS).length;

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.ciudad)
      .setDescription(
        '```' +
          panel('PLAZA DEL MERCADO', [
            `🛒 Objetos a la venta:   ${consumibles}`,
            `🔧 Materiales:           ${materiales}`,
            `⚙️ Equipo en posesión:   ${piezas.length}`,
            `🎒 Objetos guardado:    ${usados}`,
            '',
            `Saldo: ${formatBytes(trainer.digibytes)} DB`,
          ]) +
          '```',
      ),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [
    ...actionRow(
      [
        { screen: 'tienda', label: 'Tienda', emoji: '🛒', style: ButtonStyle.Success },
        { screen: 'inventario', label: 'Inventario', emoji: '🎒', style: ButtonStyle.Primary },
        { screen: 'equipo', label: 'Equipamiento', emoji: '⚙️', style: ButtonStyle.Primary },
        { screen: 'forja', label: 'Forja', emoji: '🔨', style: ButtonStyle.Secondary },
      ],
      session,
    ),
  ];

  components.push(navRow(session));
  components.push(...areaRows(session, 'ciudad'));

  return { embeds, components };
});

// --------------------------------------------------------------- tienda ---

register('tienda', async (ctx) => {
  const { trainer, session } = ctx;

  const Page = { page: ctx.page() };
  const { page: p, pages, items } = paginate(
    Object.values(ITEMS).filter((i) => i.role !== 'material'),
    Page.page,
    6,
  );

  const embeds: EmbedBuilder[] = [
    header({
      area: 'ciudad',
      title: 'TIENDA',
      context: `💰 **${formatBytes(trainer.digibytes)}** DigiBytes`,
      color: COLORS.ciudad,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  // Un embed por artículo: con seis, el precio y la descripción caben sin que
  // el jugador tenga que descifrar una tabla apretada.
  for (const item of items) {
    const puede = trainer.digibytes >= item.price;
    const enMochila = getInventory(trainer.id)[item.key] ?? 0;

    embeds.push(
      new EmbedBuilder()
        .setColor(puede ? COLORS.ciudad : COLORS.neutral)
        .setAuthor({ name: `${item.emoji} ${item.name}` })
        .setDescription(item.description)
        .addFields(
          { name: 'Precio', value: `${formatBytes(item.price)} DB`, inline: true },
          { name: 'Tienes', value: `${enMochila}`, inline: true },
          {
            name: 'Comprar',
            value: puede
              ? 'Pulsa el botón para llevártelo.'
              : `Te faltan **${formatBytes(item.price - trainer.digibytes)}** DB.`,
            inline: true,
          },
        )
        .setFooter({ text: `Página ${p}/${pages}` }),
    );

    embeds[embeds.length - 1]!.data.footer = { text: `Página ${p}/${pages}` };
  }

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let i = 0; i < items.length; i += 3) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const item of items.slice(i, i + 3)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(session, 'comprar', { key: item.key }))
          .setLabel(item.name)
          .setEmoji(item.emoji)
          .setStyle(trainer.digibytes >= item.price ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(trainer.digibytes < item.price),
      );
    }
    components.push(row);
  }

  const pager = pageRow(session, 'tienda', {}, p, pages);
  const nav = navRow(session, { backLabel: 'Ciudad' });
  if (pager) nav.components.push(...pager.components);
  components.push(nav);
  components.push(...areaRows(session, 'ciudad'));

  return { embeds, components };
});

register('comprar', async (ctx) => {
  const key = ctx.params.key ?? '';
  const item = getItem(key);

  if (!item) {
    ctx.flash('Ese objeto no existe.', 'error');
    return ctx.go('tienda');
  }

  const result = buyItem(ctx.trainer.id, key);

  if (!result.ok) {
    ctx.flash(
      result.reason === 'sin-dinero'
        ? `No te llega: te faltan **${formatBytes(item.price - ctx.trainer.digibytes)}** DB.`
        : 'No se pudo completar la compra.',
      'aviso',
    );
  } else {
    ctx.flash(`${item.emoji} Compraste **${item.name}**.`, 'ok');
  }

  return ctx.refresh('tienda');
});

// ----------------------------------------------------------- inventario ---

register('inventario', async (ctx) => {
  const { trainer, session } = ctx;
  const inventario = getInventory(trainer.id);

  const entradas = Object.entries(inventario)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => (getItem(a)?.name ?? a).localeCompare(getItem(b)?.name ?? b));

  const { page: p, pages, items } = paginate(entradas, ctx.page(), 8);

  const embeds: EmbedBuilder[] = [
    header({
      area: 'ciudad',
      title: 'INVENTARIO',
      context:
        `🎒 **${entradas.length}** tipos de objeto  ·  ` +
        `💰 **${formatBytes(trainer.digibytes)}** DB`,
      color: COLORS.ciudad,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  // Materiales aparte: son currency, no consumibles, y mezclarlos con las
  // pociones hace que la mochila parezca más llena de lo que está.
  const materiales = entradas.filter(([k]) => getItem(k)?.role === 'material');
  const otros = entradas.filter(([k]) => getItem(k)?.role !== 'material');

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setTitle('Materiales')
      .setDescription(
        materiales.length > 0
          ? materiales.map(([k, n]) => `${getItem(k)?.emoji ?? '📦'} **${getItem(k)?.name ?? k}** ×${n}`).join('\n')
          : '_Sin materiales._',
      ),
  );

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setTitle(`Objetos (${otros.length})`)
      .setDescription(
        items.length > 0
          ? items
              .map(([k, n]) => `${getItem(k)?.emoji ?? '📦'} **${getItem(k)?.name ?? k}** ×${n}`)
              .join('\n')
          :otros.length > 0
            ? '_En otras páginas._'
            : '_No tienes objetos._',
      )
      .setFooter({ text: `${p}/${pages}` }),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  const pager = pageRow(session, 'inventario', {}, p, pages);

  const nav = navRow(session, { backLabel: 'Ciudad' });
  if (pager) nav.components.push(...pager.components);
  components.push(nav);
  components.push(...areaRows(session, 'ciudad'));

  return { embeds, components };
});

// -------------------------------------------------------- equipamiento ----

register('equipo', async (ctx) => {
  const { trainer, session } = ctx;
  const piezas = ownedGear(trainer.id);
  const digimonId = ctx.num('id', 0);

  const embeds: EmbedBuilder[] = [
    header({
      area: 'ciudad',
      title: 'EQUIPAMIENTO',
      context:
        `⚙️ **${piezas.length}** piezas en tu poder\n` +
        'Las estadísticas de la ficha ya incluyen lo que llevas puesto.',
      color: COLORS.ciudad,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  // Por ranura, que es como el jugador piensa ("necesito un arma").
  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setDescription(
        '```' +
          panel('TUS PIEZAS', [
            ...piezas.slice(0, 14).map((g) => {
              const def = getEquipment(g.itemKey);
              const rarity = def ? RARITY_NAMES[def.rarity] : '?';
              return `${SLOT_EMOJI[def?.slot ?? 'arma']} ${(def?.name ?? g.itemKey).slice(0, 26).padEnd(26)} +${g.upgrade}  ${rarity.slice(0, 7)}`;
            }),
            ...(piezas.length === 0 ? ['No tienes piezas todavía.'] : []),
          ]) +
          '```',
      ),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let i = 0; i < piezas.length; i += 3) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const g of piezas.slice(i, i + 3)) {
      const def = getEquipment(g.itemKey);
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(session, 'ficha_gear', { key: g.itemKey }))
          .setLabel(`${def?.name ?? g.itemKey}${g.upgrade ? ` +${g.upgrade}` : ''}`)
          .setEmoji(SLOT_EMOJI[def?.slot ?? 'arma'])
          .setStyle(
            def && RARITY_COLORS[def.rarity] !== undefined ? ButtonStyle.Primary : ButtonStyle.Secondary,
          ),
      );
    }
    components.push(row);
  }

  components.push(navRow(session, { backLabel: 'Ciudad' }));
  components.push(...areaRows(session, 'ciudad'));
  void digimonId;

  return { embeds, components };
});

// ---------------------------------------------------- equipo de un Digimon -

register('ficha_gear', async (ctx) => {
  const { trainer, session } = ctx;
  const digimonId = ctx.num('id', 0);
  const piezaKey = ctx.params.key;

  if (!digimonId) {
    // Se llegó desde la lista de piezas: hay que elegir un Digimon primero.
    return ctx.go('equipo');
  }

  const digimon = (await import('../../game/repository.js')).getDigimonOwnedBy(trainer.id, digimonId);
  if (!digimon) {
    ctx.flash('Ya no tienes ese Digimon.', 'error');
    return ctx.go('digimon');
  }

  const ranuras = gearSlots(digimonId);
  const puesta = equippedGear(digimonId);

  const embeds: EmbedBuilder[] = [
    header({
      area: 'digimon',
      title: `EQUIPO DE ${digimon.nickname ?? digimon.species.name}`.toUpperCase(),
      context:
        `Nv.${digimon.level} · ${puesta.length}/4 ranuras ocupadas\n` +
        'Pulsa una ranura para ver las piezas que te valen.',
      color: COLORS.ciudad,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  // Las cuatro ranuras, con lo que hay puesto.
  embeds.push(
    new EmbedBuilder().setColor(COLORS.neutral).setDescription(
      '```' +
        panel('RANURAS', [
          ...SLOTS.map((slot) => {
            const actual = ranuras[slot];
            return `${SLOT_EMOJI[slot]} ${SLOT_NAMES[slot].padEnd(12)} ${
              actual
                ? `${actual.def.name}${actual.upgrade ? ` +${actual.upgrade}` : ''}`
                : '(vacía)'
            }`;
          }),
        ]) +
        '```',
    ),
  );

  // Piezas compatibles con la ranura elegida, o con la primera vacía.
  const ranuraElegida = (ctx.params.slot ?? primeraVacia(ranuras)) as Slot;
  const compatibles = ownedGear(trainer.id).filter(
    (g) => getEquipment(g.itemKey)?.slot === ranuraElegida,
  );

  const { page: p, pages, items } = paginate(compatibles, ctx.page(), 6);

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.ciudad)
      .setTitle(`${SLOT_EMOJI[ranuraElegida]} ${SLOT_NAMES[ranuraElegida]}`)
      .setDescription(
        items.length > 0
          ? items
              .map((g) => {
                const def = getEquipment(g.itemKey)!;
                const b = def.bonus;
                const partes = [
                  b.attack ? `ATQ +${Math.round(b.attack * 100)}%` : null,
                  b.defense ? `DEF +${Math.round(b.defense * 100)}%` : null,
                  b.hp ? `PV +${Math.round(b.hp * 100)}%` : null,
                  b.speed ? `VEL +${Math.round(b.speed * 100)}%` : null,
                ].filter(Boolean);
                return `${def.name} \`+${g.upgrade}\` — ${partes.join(' ')}`;
              })
              .join('\n')
          : '_No tienes piezas para esta ranura._',
      )
      .setFooter({ text: `${p}/${pages}` }),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  // Elegir ranura.
  const slots = new ActionRowBuilder<ButtonBuilder>();
  for (const slot of SLOTS) {
    slots.addComponents(
      new ButtonBuilder()
        .setCustomId(encodeNav(session, 'ficha_gear', { id: String(digimonId), slot }))
        .setLabel(SLOT_NAMES[slot])
        .setEmoji(SLOT_EMOJI[slot])
        .setStyle(slot === ranuraElegida ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
  }
  components.push(slots);

  // Poner / quitar.
  for (let i = 0; i < items.length; i += 3) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const g of items.slice(i, i + 3)) {
      const def = getEquipment(g.itemKey)!;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(
            encodeNav(session, 'poner', { id: String(digimonId), key: g.itemKey, slot: ranuraElegida }),
          )
          .setLabel(`${def.name}${g.upgrade ? ` +${g.upgrade}` : ''}`)
          .setEmoji(SLOT_EMOJI[def.slot])
          .setStyle(ButtonStyle.Success),
      );
    }
    components.push(row);
  }

  const actual = ranuras[ranuraElegida];
  if (actual) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            encodeNav(session, 'quitar', { id: String(digimonId), slot: ranuraElegida }),
          )
          .setLabel(`Quitar ${actual.def.name}`)
          .setEmoji('🧺')
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  }

  const pager = pageRow(
    session,
    'ficha_gear',
    { id: String(digimonId), slot: ranuraElegida },
    p,
    pages,
  );
  const nav = navRow(session, { backLabel: 'Ficha' });
  if (pager) nav.components.push(...pager.components);
  components.push(nav);

  return { embeds, components };
});

register('poner', async (ctx) => {
  const key = ctx.params.key ?? '';

  // La ranura la decide la propia pieza: `equipItem` no la recibe.
  const { result, replaced } = equipItem(ctx.trainer.id, ctx.num('id', 0), key);

  if (!result.ok) {
    ctx.flash(mensajeEquipar(result.reason), 'aviso');
  } else {
    const def = getEquipment(key);
    const cambio = replaced ? ` (sustituye a **${replaced.name}**)` : '';
    ctx.flash(`⚙️ **${def?.name ?? 'Pieza'}** equipada${cambio}.`, 'ok');
  }

  return ctx.refresh('ficha_gear', {
    id: ctx.params.id ?? '',
    slot: ctx.params.slot ?? '',
  });
});

/** Motivos de rechazo de `equipItem`, con el texto que ve el jugador. */
function mensajeEquipar(reason: string): string {
  switch (reason) {
    case 'no-posee':
    case 'no-existe':
      return 'No tienes esa pieza.';
    case 'ya-puesto':
      return 'Ya la llevas puesta.';
    case 'ranura-ocupada':
      return 'Esa ranura ya tiene algo. Quítatelo primero.';
    case 'nivel':
      return 'Tu Digimon no tiene nivel suficiente para esa pieza.';
    case 'no-existe':
      return 'Esa pieza no existe.';
    default:
      return 'No se pudo equipar.';
  }
}

register('quitar', async (ctx) => {
  const result = unequip(
    ctx.trainer.id,
    ctx.num('id', 0),
    (ctx.params.slot ?? 'arma') as Slot,
  );

  ctx.flash(
    result.ok
      ? '🧺 Pieza quitada. Ya no suma estadísticas.'
      : 'No se pudo quitar esa pieza.',
    result.ok ? 'ok' : 'aviso',
  );

  return ctx.refresh('ficha_gear', {
    id: ctx.params.id ?? '',
    slot: ctx.params.slot ?? '',
  });
});

// ------------------------------------------------------------------ forja -

register('forja', async (ctx) => {
  const { trainer, session } = ctx;
  const inventario = getInventory(trainer.id);

  const embeds: EmbedBuilder[] = [
    header({
      area: 'ciudad',
      title: 'FORJA',
      context: 'Mejora piezas con materiales. Cada mejora suma estadísticas de verdad.',
      color: COLORS.ciudad,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  const piezas = ownedGear(trainer.id).filter((g) => g.upgrade < MAX_UPGRADE);

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setTitle('Materiales')
      .setDescription(
        Object.keys(MATERIALS)
          .map((k) => {
            const def = getItem(k);
            const n = inventario[k] ?? 0;
            return `${def?.emoji ?? '📦'} ${def?.name ?? k}: **${n}**`;
          })
          .join('\n'),
      ),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let i = 0; i < piezas.length; i += 3) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const g of piezas.slice(i, i + 3)) {
      const def = getEquipment(g.itemKey)!;
      const coste = upgradeCost(def, g.upgrade);
      const puede = trainer.digibytes >= coste;

      row.addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(session, 'mejorar', { key: g.itemKey }))
          .setLabel(`${def.name} +${g.upgrade}→+${g.upgrade + 1}`)
          .setEmoji(SLOT_EMOJI[def.slot])
          .setStyle(puede ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(!puede),
      );
    }
    components.push(row);
  }

  components.push(navRow(session, { backLabel: 'Ciudad' }));
  components.push(...areaRows(session, 'ciudad'));

  return { embeds, components };
});

register('mejorar', async (ctx) => {
  const result = upgradeGear(ctx.trainer.id, ctx.params.key ?? '');

  if (!result.ok) {
    ctx.flash(mensajeForja(result.reason), 'aviso');
  } else {
    ctx.flash(`🔨 Mejora hecha: **+${result.upgrade}**.`, 'ok');
  }

  return ctx.refresh('forja');
});

function mensajeForja(reason: string): string {
  switch (reason) {
    case 'sin-dinero':
      return 'No te llega el dinero.';
    case 'sin-material':
      return 'Te faltan materiales.';
    case 'maximo':
      return `Ya está al máximo (+${MAX_UPGRADE}).`;
    case 'no-existe':
    case 'no-tienes':
      return 'No tienes esa pieza.';
    default:
      return 'No se pudo mejorar.';
  }
}

function primeraVacia(ranuras: Record<Slot, GearSlotView | null>): Slot {
  for (const slot of SLOTS) {
    if (!ranuras[slot]) return slot;
  }
  return SLOTS[0]!;
}
