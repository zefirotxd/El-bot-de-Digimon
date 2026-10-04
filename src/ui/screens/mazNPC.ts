import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getDungeon } from '../../game/dungeons.js';
import { getBoss, BOSSES } from '../../game/bosses.js';
import { rngDe, type Tile } from '../../game/dungeonMap.js';
import {
  addItem,
  buyItem,
  getItemCount,
  trySpendDigibytes,
  type PurchaseResult,
} from '../../game/repository.js';
import { getItem } from '../../game/items.js';
import { expedicionActiva, type Expedicion } from '../../game/dungeonExpedition.js';
import { cargarVista } from '../../services/dungeonRun.js';
import { startBattle, type Presenter } from '../../services/battleSession.js';
import { blocker } from '../../services/world.js';
import { encodeNav } from '../nav.js';
import { register, type ScreenContext } from '../screen.js';
import { COLORS } from '../theme.js';

/**
 * El mercader y el jefe.
 *
 * Van en su propio fichero porque los dos hacen lo mismo —leer el estado, decidir
 * con ayuda del servicio y pintar— y `mazActions` ya era un fichero que no se
 * leía de un vistazo.
 */

// ============================================================ el mercader ====

/**
 * Los objetos que un mercader puede tener.
 *
 * Tres, a propósito. Un mercader con veinte artículos deja de ser una decisión y
 * pasa a ser un inventario, y el jugador deja de decidir y empieza a leer.
 */
const STOCK_BASE = ['pocion', 'tonico', 'superpocion'] as const;

/** El bando: cómo se comporta este mercader. */
type Bando = 'barato' | 'caro' | 'raro';

/**
 * El stock de ESTA expedición.
 *
 * El encargo pide que el inventario del mercader sea distinto en cada expedición,
 * y sale de la semilla: la misma expedición enseña siempre lo mismo y dos
 * expediciones distintas no tienen por qué enseñar lo mismo.
 *
 * Sin la semilla el stock sería un azar nuevo en cada visita, y el jugador vería
 * precios distintos para el mismo objeto dos veces seguidas. Eso no es una
 * sorpresa interesante: es un fallo.
 *
 * Y el precio sale de AQUÍ, no del catálogo. Si se comprara al precio del
 * catálogo, el mercader de la mazmorra sería la tienda con otro nombre.
 */
export function stockDe(semilla: number, bando: Bando): { key: string; precio: number }[] {
  const rng = rngDe(semilla + bando.length * 7919);

  const factor = bando === 'caro' ? 2 : bando === 'raro' ? 3 : 1;
  const base = bando === 'raro' ? STOCK_BASE.slice(-1) : STOCK_BASE;

  // El tipo se declara aquí y no se deduce: sin él, `salida` queda reducida a las
  // tres claves de `STOCK_BASE` y el artículo caro del bando raro no compila.
  const salida: { key: string; precio: number }[] = base.map((key) => {
    const item = getItem(key);
    const precio = Math.max(
      10,
      Math.round((item?.price ?? 120) * factor * (0.9 + rng.next() * 0.3)),
    );
    return { key, precio };
  });

  if (bando === 'raro') {
        // El artículo caro sale del catálogo real. `espectro_digimon` es lo que de
    // verdad se quiere dentro de una mazmorra; un «chip de fuego» inventado
    // compraría algo que no existe y solo fallaría al pulsarlo.
    salida.push({
      key: 'espectro_digimon',
      precio: Math.round((getItem('espectro_digimon')?.price ?? 1500) * (0.9 + rng.next() * 0.3)),
    });
  }

  return salida;
}

/** La frase del mercader. El bando tiene que notarse ANTES de comprar. */
const FRASES: Record<Bando, string> = {
  barato: '«Tengo cosas que probablemente no deberías necesitar...»',
  caro: '«Si quieres algo, pagas lo que vale. No regateo.»',
  raro: '«No tengo nada común. Y no, no te digo de dónde salió.»',
};

register('maz_comercio', async (ctx) => {
  const e = expedicionActiva(ctx.trainer.id);
  if (!e) return ctx.go('mazmorra');

  const bando = bandoDe(e);
  const stock = stockDe(e.seed, bando);
  const digibytes = ctx.trainer.digibytes;

  const lineas = stock.map((s) => {
    const item = getItem(s.key);
    const marcado = digibytes >= s.precio ? '' : ' · *no te llega*';
    return `⚙️ **${item?.name ?? s.key}** — \`${s.precio.toLocaleString('es')}\`${marcado}`;
  });

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.ciudad)
        .setAuthor({ name: '🧑‍💼 MERCADER' })
        .setDescription(FRASES[bando])
        .addFields({
          name: 'En venta',
          value: `${lineas.join('\n')}\n\n💰 Tienes **${digibytes.toLocaleString('es')}** DigiBytes`,
        }),
    ],
    components: [
      ...filasDeStock(ctx, stock, digibytes),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        nav(ctx, 'maz_pasar', 'Salir', '🚶', ButtonStyle.Secondary),
      ),
    ],
  };
});

/**
 * El stock en botones.
 *
 * Cinco por fila, el máximo de Discord, y dos filas como tope. El precio va
 * DENTRO del `custom_id` porque es parte de la decisión: si se leyera del catálogo
 * al pulsar, el jugador vería un precio y le cobrarían otro.
 */
function filasDeStock(
  ctx: ScreenContext,
  stock: { key: string; precio: number }[],
  digibytes: number,
): ActionRowBuilder<ButtonBuilder>[] {
  const filas: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let i = 0; i < stock.length && i < 10; i += 5) {
    filas.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...stock.slice(i, i + 5).map((s) => {
          const item = getItem(s.key);

          return nav(
            ctx,
            'maz_comprar',
            item?.name ?? s.key,
            '🛒',
            digibytes >= s.precio ? ButtonStyle.Success : ButtonStyle.Secondary,
            { k: s.key, p: String(s.precio) },
          );
        }),
      ),
    );
  }

  return filas;
}

register('maz_comprar', async (ctx) => {
  const itemKey = ctx.params.k ?? '';
  const precio = Number(ctx.params.p ?? '0');

  const item = getItem(itemKey);
  if (!item || precio <= 0) {
    ctx.flash('Ese artículo no está en venta aquí.', 'aviso');
    return ctx.refresh('maz_comercio');
  }

  const resultado = comprarA(ctx.trainer.id, itemKey, precio);

  if (!resultado.ok) {
    const mensajes: Record<string, string> = {
      'sin-dinero': 'No te llega. Te faltan DigiBytes.',
      'no-existe': 'Ese artículo no existe.',
      'sin-espacio': `Ya no te caben más de ${item.name}.`,
    };

    ctx.flash(mensajes[resultado.reason] ?? 'No se puede.', 'aviso');
    return ctx.refresh('maz_comercio');
  }

  ctx.flash(`🎒 Compras **${item.name}** por ${precio.toLocaleString('es')} DigiBytes.`, 'ok');
  return ctx.refresh('maz_comercio');
});

/**
 * Compra al precio de la expedición.
 *
 * `buyItem` cobra a precio de catálogo y además carga y guarda por su cuenta. Aquí
 * el precio lo pone el stock de la mazmorra, así que se cobra aquí.
 *
 * Cuando el precio coincide con el del catálogo se delega en `buyItem`, para no
 * tener dos caminos distintos haciendo lo mismo.
 */
function comprarA(trainerId: number, itemKey: string, precio: number): PurchaseResult {
  const item = getItem(itemKey);
  if (!item) return { ok: false, reason: 'no-existe' };

  if (getItemCount(trainerId, itemKey) >= 99) return { ok: false, reason: 'sin-espacio' };

  if (precio === item.price) return buyItem(trainerId, itemKey);

  if (!trySpendDigibytes(trainerId, precio)) return { ok: false, reason: 'sin-dinero' };

  const newQuantity = addItem(trainerId, itemKey, 1);
  return { ok: true, newQuantity };
}

// ================================================================ el jefe ====

/**
 * El jefe del piso.
 *
 * Pelea contra el jefe que declara la MAZMORRA, no contra lo que hubiera
 * generatesdo la casilla: la casilla solo marca dónde está el jefe, y qué se pelea
 * es contenido de la mazmorra. Si se pelease contra lo de la casilla, cambiar el
 * jefe de una mazmorra exigiría cambiar el generador.
 *
 * La expedición se SUSPENDE, no se cierra. Perder contra el jefe la deja donde
 * estaba, y eso es lo que hace que retirarse antes sea una decisión y no un
 * trámite.
 */
register('maz_jefe', async (ctx) => {
  const e = expedicionActiva(ctx.trainer.id);
  if (!e) return ctx.go('mazmorra');

  const definicion = getDungeon(e.dungeonKey);
  const boss = definicion?.jefeFinal ? getBoss(definicion.jefeFinal) : undefined;

  if (!boss) {
    ctx.flash('Esta mazmorra todavía no tiene jefe final.', 'aviso');
    return ctx.refresh('mazmorra');
  }

  const stop = blocker(ctx.trainer.id);
  if (stop) {
    ctx.flash(stop.message, 'aviso');
    return ctx.back();
  }

  // El jefe sube con el piso. En el tercero no puede ser el mismo enemigo que en el
  // primero: si lo fuera, los pisos de más arriba serían repetir el primero.
  const nivel = Math.max(boss.level, (definicion?.minLevel ?? 10) + (e.pisoActual - 1) * 8);

  await startBattle(ctx.interaction as never, { speciesKey: boss.speciesKey, level: nivel }, editor(ctx));
  return;
});

// ------------------------------------------------------------- comunes ------

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
 * El presentador que edita el mensaje actual.
 *
 * El combate tiene que ocupar el mensaje de la casilla, no salir en otro debajo:
 * con dos mensajes, la casilla queda colgando arriba y el jugador no sabe cuál
 * manda.
 */
function editor(ctx: ScreenContext): Presenter {
  return async (payload) => {
    await (ctx.interaction as unknown as { editReply: (p: unknown) => Promise<unknown> }).editReply(payload);
    return (ctx.interaction as unknown as { message: unknown }).message as never;
  };
}

/** El bando, según la casilla en la que está el mercader. */
function bandoDe(e: Expedicion): Bando {
  const vista = cargarVista(e);
  const tile: Tile | undefined = vista?.mapa.get(`${e.posX},${e.posY}`);

  if (tile?.contenido.tipo === 'comerciante') {
    // Se comprueba contra la lista en vez de castear. Un `as Bando` habría
    // compilado y habría fallado en producción si el generador añadía un bando
    // nuevo sin que nadie se acordara de este fichero.
    const bando = tile.contenido.mercader;
    if (bando === 'barato' || bando === 'caro' || bando === 'raro') return bando;
  }

  // Sin bando legible no se inventa: se supone el más normal.
  return 'barato';
}

export { BOSSES };