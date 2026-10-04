import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,

  StringSelectMenuBuilder,
} from 'discord.js';
import {
  ATRIBUTOS_ES,
  activables,
  entradaDe,
  listaDeFamilias,
  lineaDe,
  metaCatalogo,
  nivelEnJuego,
  presentarImagen,
  todasEntradas,
  type EntradaCatalogo,
} from '../../game/catalogo.js';
import { header, navRow, pageRow, paginate } from '../components.js';
import { encodeNav } from '../nav.js';
import { register, type ScreenContext } from '../screen.js';
import { COLORS } from '../theme.js';

/**
 * El catálogo de referencia y la ficha de especie.
 *
 * Va aparte del `bestiario` de `digivice.ts` porque son DOS bestiarios con dos
 * propósitos distintos, y mezclarlos era el error que había:
 *
 *   - El bestiario del Digivice son las especies JUGABLES, con lo que el jugador
 *     tiene y ha visto. Son unas pocas y se recorren enteras.
 *   - El catálogo son las especies DOCUMENTADAS, que no se pueden capturar todas.
 *     Se recorre filtrando.
 *
 * Un jugador tiene que poder consultar "qué es WarGreymon" sin que eso le sugiera
 * que puede ir a por uno, y ver su colección sin que se mezcle con mil entradas
 * que no puede tener.
 *
 * LO QUE NINGUNA PANTALLA DE AQUÍ HACE
 *
 * Poner una imagen dentro de un embed por su cuenta. Todo pasa por
 * `presentarImagen`, que es donde vive la política. Si alguna pantalla llamara a
 * `setImage` directamente, la decisión de derechos quedaría repartida por veinte
 * sitios y en uno de ellos se colaría.
 */

/** Una fila puede llevar botones, enlaces o un menú. Nunca los tres. */
type Fila = ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>;

// ================================================================== filtros ===

/**
 * Los valores por los que se puede filtrar.
 *
 * Se calculan una vez del catálogo entero. Sin caché serían 1384 comparaciones en
 * cada pulsación de "página siguiente", que no es una cantidad que asuste, pero el
 * cálculo es idéntico siempre y la lista no cambia sin reimportar.
 */
let valoresFiltro: { niveles: string[]; atributos: string[]; familias: string[] } | null = null;

function filtros(): NonNullable<typeof valoresFiltro> {
  if (valoresFiltro) return valoresFiltro;

  const niveles = new Set<string>();
  const atributos = new Set<string>();
  const familias = new Set<string>();

  for (const e of todasEntradas()) {
    if (e.nivel.estado === 'verificado') niveles.add(e.nivel.valor);
    if (e.atributo.estado === 'verificado') atributos.add(e.atributo.valor);
    for (const f of listaDeFamilias(e)) familias.add(f);
  }

  valoresFiltro = {
    niveles: [...niveles].sort(),
    atributos: [...atributos].sort(),
    familias: [...familias].sort((a, b) => a.localeCompare(b, 'es')),
  };

  return valoresFiltro;
}

/** Aplica los filtros de la navegación al catálogo. */
function filtrar(params: Record<string, string>): EntradaCatalogo[] {
  let pool = params.juego === '1' ? activables() : todasEntradas();

  if (params.n) pool = pool.filter((e) => e.nivel.valor === params.n);
  if (params.a) pool = pool.filter((e) => e.atributo.valor === params.a || e.atributo2.valor === params.a);
  if (params.f) pool = pool.filter((e) => listaDeFamilias(e).includes(params.f!));

  return pool;
}

/**
 * Cuántas especies cumplen un filtro.
 *
 * Va en la etiqueta del menú, para que el jugador vea "Champion (243)" antes de
 * elegir y no se meta en un filtro que sale vacío. Un menú con doce opciones de las
 * que ocho dan cero resultados es un menú que hace perder el tiempo.
 */
function cuentaDe(campo: 'n' | 'a' | 'f', valor: string): number {
  let n = 0;

  for (const e of todasEntradas()) {
    if (campo === 'n' && e.nivel.valor === valor) n++;
    else if (campo === 'a' && (e.atributo.valor === valor || e.atributo2.valor === valor)) n++;
    else if (campo === 'f' && listaDeFamilias(e).includes(valor)) n++;
  }

  return n;
}

// ================================================================ pantallas ===

register('catalogo', async (ctx) => {
  const pool = filtrar(ctx.params);
  const { page, pages, items } = paginate(pool, ctx.page(), 10);
  const meta = metaCatalogo();

  const activos: string[] = [];
  if (ctx.params.juego === '1') activos.push('solo jugables');
  if (ctx.params.n) activos.push(`nivel ${ctx.params.n}`);
  if (ctx.params.a) activos.push(`atributo ${ctx.params.a}`);
  if (ctx.params.f) activos.push(`familia ${ctx.params.f}`);

  const embeds: EmbedBuilder[] = [
    header({
      area: 'digivice',
      title: 'CATÁLOGO DE DIGIMON',
      context:
        `📖 **${pool.length}** especies documentadas · ${meta.categoria}\n` +
        (activos.length > 0 ? `Filtrando por ${activos.join(' · ')}` : 'Universo completo, por orden alfabético.'),
      color: COLORS.digivice,
    }),
  ];

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setDescription(
        items.length > 0
          ? items.map(lineaDeEspecie).join('\n')
          : 'Ninguna especie cumple esos filtros.',
      ),
  );

  // Por qué no hay ilustración. Sin esta línea, un jugador ve una ficha sin
  // imagen y piensa que al catálogo le falta el dato, cuando lo que falta es el
  // permiso para mostrarlo.
  embeds.push(
    new EmbedBuilder().setColor(COLORS.neutral).setDescription(
      [
        '🔗 **Las ilustraciones no se incrustan.**',
        'El arte de Digimon es material de Bandai y Toei, y la fuente lo marca como no libre.',
        'Cada ficha lleva un botón a su página de origen, con su licencia y su procedencia.',
        '',
        `Fuente: ${meta.fuente} · generada el ${meta.generado.slice(0, 10)}`,
      ].join('\n'),
    ),
  );

  const filas: Fila[] = [...menusDeFiltro(ctx, activos)];

  const paginacion = pageRow(ctx.session, 'catalogo', ctx.params, page, pages);
  if (paginacion) filas.push(paginacion);

  if (ctx.params.juego !== '1') {
    filas.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(ctx.session, 'catalogo', { ...ctx.params, juego: '1' }))
          .setLabel('Solo las jugables')
          .setEmoji('🎮')
          .setStyle(ButtonStyle.Primary),
      ),
    );
  }

  filas.push(navRow(ctx.session));

  return { embeds, components: filas as never };
});

/** Una línea del listado. */
function lineaDeEspecie(e: EntradaCatalogo): string {
  // La marca explica POR QUÉ una especie está marcada como está. Sin leyenda, un
  // `⚠️` al lado de una línea no dice nada.
  const marca = e.activable ? '🎮' : e.imagen.correspondencia === 'difiere' ? '⚠️' : '📖';

  // El `??` y el `||` no se pueden mezclar sin paréntesis, y no es una curiosidad
  // del analizador: si se mezclan, el parser se equivoca y el error que sale es
  // "expected ) but found function" trescientas líneas más abajo, que no señala
  // nada.
  //
  // Y el orden importa: `ATRIBUTOS_ES[''] ?? ''` devuelve `''`, porque `??` solo
  // actúa sobre null y undefined. Un `||` detrás nunca llegaría a ejecutarse y un
  // atributo pendiente se mostraría como una cadena vacía en vez de como
  // "pendiente", que es justo lo que el catálogo sabe y la pantalla callaría.
  const atributo =
    e.atributo.valor === ''
      ? 'atributo pendiente'
      : (ATRIBUTOS_ES[e.atributo.valor] ?? e.atributo.valor);

  const atributo2 = e.atributo2.valor !== '' ? ` / ${ATRIBUTOS_ES[e.atributo2.valor] ?? e.atributo2.valor}` : '';
  const familias = listaDeFamilias(e);

  return (
    `${marca} **${e.nombre}** — ${e.nivel.valor} · ${e.tipo.valor}\n` +
    `\`   ${atributo}${atributo2}` +
    `${familias.length > 0 ? ` · ${familias.slice(0, 2).join(', ')}` : ''}\``
  );
}

// --------------------------------------------------------------- los menús ---

/**
 * Los menús de filtro.
 *
 * Cada opción lleva el filtro DENTRO del `value` (`n:Champion`). Así elegir una
 * aplica y repinta en un clic, sin pantalla intermedia. Un filtro es una decisión
 * de un clic; ponerle un paso en medio es poner una barrera donde no la hay.
 *
 * Discord admite 25 opciones por menú. Las familias son cientos, así que se
 * ofrecen las más pobladas y el resto se llega escribiendo: el `custom_id` lo
 * lleva el router, y aquí solo se generan las opciones.
 */
function menusDeFiltro(ctx: ScreenContext, activos: string[]): Fila[] {
  const f = filtros();
  const filas: Fila[] = [];

  const opcionesNivel = f.niveles.slice(0, 25).map((v) => ({
    label: `${v} (${cuentaDe('n', v)})`,
    value: `n:${v}`,
    default: ctx.params.n === v,
  }));

  if (opcionesNivel.length > 0) {
    filas.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`flt:n:${ctx.session.nonce}`)
          .setPlaceholder('Nivel evolutivo…')
          .addOptions(opcionesNivel),
      ),
    );
  }

  const opcionesAtributo = f.atributos.slice(0, 25).map((v) => ({
    label: `${v} (${cuentaDe('a', v)})`,
    value: `a:${v}`,
    default: ctx.params.a === v,
  }));

  if (opcionesAtributo.length > 0) {
    filas.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`flt:a:${ctx.session.nonce}`)
          .setPlaceholder('Atributo…')
          .addOptions(opcionesAtributo),
      ),
    );
  }

  // Solo con filtro activo: un "quitar filtros" con nada que quitar es un botón
  // que no hace nada, y eso enseña al jugador a pulsarlo sin mirar.
  if (activos.length > 0) {
    filas.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`flt:x:${ctx.session.nonce}`)
          .setPlaceholder('Quitar los filtros')
          .addOptions([{ label: 'Quitar todos los filtros', value: 'x:1', default: false }]),
      ),
    );
  }

  return filas;
}

// ========================================================= ficha de especie ===

register('cat_especie', async (ctx) => {
  const e = entradaDe(ctx.params.e ?? '');
  if (!e) return ctx.back();

  const img = presentarImagen(e);
  const linea = lineaDe(e.key);
  const nivelJuego = nivelEnJuego(e.nivel.valor);

  const principal = new EmbedBuilder()
    .setColor(e.activable ? COLORS.success : COLORS.digivice)
    .setAuthor({ name: e.activable ? `${e.nombre} · jugable` : e.nombre })
    .setDescription(
      [
        e.descripcion ?? '*La fuente no tiene descripción para esta especie.*',
        '',
        `**Nivel** ${e.nivel.valor}` +
          (nivelJuego !== e.nivel.valor ? ` · en el juego: ${nivelJuego}` : ''),
        `**Tipo** ${e.tipo.valor}`,
        `**Atributo** ${ATRIBUTOS_ES[e.atributo.valor] ?? e.atributo.valor}` +
          (e.atributo2.valor !== '' ? ` / ${ATRIBUTOS_ES[e.atributo2.valor] ?? e.atributo2.valor}` : ''),
        listaDeFamilias(e).length > 0
          ? `**Familias** ${listaDeFamilias(e).join(', ')}`
          : '**Familias** *la fuente no las declara*',
      ].join('\n'),
    )
    .setFooter({ text: `${e.procedencia.sitio} · ${e.procedencia.pagina}` });

  // La imagen SOLO si la política lo permite. `presentarImagen` ya decidió; aquí no
  // se re-decide nada.
  if (img.embebir) principal.setThumbnail(img.embebir);

  if (e.ataques.length > 0) {
    const lineas = e.ataques
      .slice(0, 8)
      .map((a) => (a.alias.length > 0 ? `${a.nombre} *(también ${a.alias.slice(0, 2).join(', ')})*` : a.nombre));

    principal.addFields({
      name: `Ataques documentados (${e.ataques.length})`,
      value: lineas.join('\n') + (e.ataques.length > 8 ? `\n… y ${e.ataques.length - 8} más` : ''),
    });
  }

  const filasEvo: string[] = [];

  if (linea.anterior.length > 0) {
    filasEvo.push(`**Viene de** ${linea.anterior.map((x) => x.nombre).join(' · ')}`);
  }

  if (linea.posterior.length > 0) {
    filasEvo.push(`**Evoluciona a** ${linea.posterior.map((x) => x.nombre).join(' · ')}`);
  }

  // La fuente declara una forma que no está en el catálogo. Decirlo es mejor que
  // callarlo: si no, el jugador creería que esa rama no existe.
  if (e.desde.length > 0 && linea.anterior.length === 0) {
    filasEvo.push(`**Viene de** ${e.desde.join(' · ')} *(fuera del catálogo)*`);
  }

  if (e.hacia.length > 0 && linea.posterior.length === 0) {
    filasEvo.push(`**Evoluciona a** ${e.hacia.join(' · ')} *(fuera del catálogo)*`);
  }

  if (filasEvo.length === 0) filasEvo.push('La fuente no documenta ninguna ruta para esta especie.');

  principal.addFields({ name: 'Línea evolutiva', value: filasEvo.join('\n') });

  if (e.nombresAlternativos.estado === 'verificado') {
    principal.addFields({ name: 'Nombres alternativos', value: e.nombresAlternativos.valor.slice(0, 1000) });
  }

  // --- la procedencia, siempre visible --------------------------------------
  //
  // Es lo que distingue un catálogo de una colección de enlaces: dice de dónde
  // sale cada dato, con qué licencia y qué queda sin verificar.
  return { embeds: [principal, embedsDeProcedencia(e, img)], components: botonesDeFicha(ctx, e, linea) };
});

function embedsDeProcedencia(
  e: EntradaCatalogo,
  img: ReturnType<typeof presentarImagen>,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setDescription(
      [
        `**Fuente** ${e.procedencia.url}`,
        `**Ilustración** ${img.pagina ?? '*la fuente no tiene imagen*'}`,
        img.origen ? `**Procedencia** ${img.origen}` : '',
        `**Licencia** \`${e.imagen.licencia}\``,
        img.aviso ?? '',
        img.advertencia ?? '',
        '',
        e.pendientes.length > 0
          ? `**Sin verificar** ${e.pendientes.join(', ')}`
          : 'Todos los campos verificados.',
      ]
        .filter((l) => l !== '')
        .join('\n'),
    );
}

function botonesDeFicha(
  ctx: ScreenContext,
  e: EntradaCatalogo,
  linea: ReturnType<typeof lineaDe>,
): Fila[] {
  const img = presentarImagen(e);
  const filas: Fila[] = [];

  // Botones de enlace: abren fuera y no llevan `custom_id`. Por eso van en fila
  // propia y no se mezclan con los que navegan.
  // Un botón de enlace en discord.js es un `ButtonBuilder` con `ButtonStyle.Link`
  // y una URL. No hay clase aparte, y sobre todo NO lleva `custom_id`: abrir no es
  // navegar. Por eso van en fila propia —mezclados con los de navegación,
  // romperían el router al intentar descifrar un id que no existe—.
  if (img.pagina) {
    filas.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel(img.etiqueta)
          .setStyle(ButtonStyle.Link)
          .setURL(img.pagina)
          .setEmoji('🔗'),
        new ButtonBuilder()
          .setLabel('Ficha en la wiki')
          .setStyle(ButtonStyle.Link)
          .setURL(e.procedencia.url)
          .setEmoji('📖'),
      ),
    );
  }

  // Las evoluciones navegan a sus fichas. Se limita a cuatro porque un Digimon
  // con doce evoluciones documentadas no cabe en una pantalla y el resto se
  // encuentra por el filtro de familia.
  const vecinos = [...linea.anterior, ...linea.posterior].slice(0, 4);

  if (vecinos.length > 0) {
    filas.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...vecinos.map((x) =>
          new ButtonBuilder()
            .setCustomId(encodeNav(ctx.session, 'cat_especie', { e: x.key }))
            .setLabel(x.nombre.slice(0, 80))
            .setStyle(ButtonStyle.Secondary),
        ),
      ),
    );
  }

  // De la ficha de una especie no documentada no se vuelve al listado con un
  // «atrás»: se va al catálogo, que es donde se pidió.
  filas.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeNav(ctx.session, 'catalogo'))
        .setLabel('Volver al catálogo')
        .setEmoji('📖')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(encodeNav(ctx.session, 'hub'))
        .setLabel('Digivice')
        .setEmoji('📟')
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return filas;
}