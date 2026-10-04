import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import {
  achievementsOf,
  claimAndPayAchievement,
  claimAndPayMission,
  missionsOf,
  periodResetsIn,
  summaryOf,
  titlesOf,
} from '../../game/progressionRepo.js';
import { addItem, giveDigibytes } from '../../game/repository.js';
import { getItem } from '../../game/items.js';
import { METRIC_NAMES, RARITY_NAMES, type Reward } from '../../game/missions.js';
import {
  actionRow,
  areaRows,
  header,
  navRow,
  paginate,
  pageRow,
  playerField,
} from '../components.js';
import { encodeNav } from '../nav.js';
import { register } from '../screen.js';
import { COLORS } from '../theme.js';

/**
 * Misiones, logros y títulos.
 *
 * El comando `/misiones` ya existía y funcionaba; lo que faltaba era que fuera
 * un sitio. Aquí las recompensas se reclaman con un botón y el jugador ve, sin
 * escribir nada, qué tiene listo y qué le falta.
 *
 * Lo que NO se ha reimplementado: ni el catálogo, ni las reglas, ni la
 * transacción de pago. Eso sigue en `progressionRepo`. La pantalla solo pinta y
 * llama a `claimAndPayMission`, que paga y marca en la misma operación.
 */

// ---------------------------------------------------------------- misiones -

register('misiones', async (ctx) => {
  const { trainer, session } = ctx;
  const resumen = summaryOf(trainer.id);
  const diario = missionsOf(trainer.id, 'diaria');
  const semanal = missionsOf(trainer.id, 'semanal');

  const partes = ['### 📅 Misiones diarias', ...misionLines(diario)];
  if (ctx.params.which === 'semanal') {
    partes.push('', '### 🗓️ Misiones semanales', ...misionLines(semanal));
  }

  const embeds: EmbedBuilder[] = [
    header({
      area: 'digivice',
      title: 'MISIONES',
      context:
        `Diarias listas: **${resumen.dailyReady}/${resumen.dailyTotal}**  ·  ` +
        `Semanales: **${resumen.weeklyReady}/${resumen.weeklyTotal}**\n` +
        'Cada recompensa se reclama **una vez** por periodo.',
      color: COLORS.digivice,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));
  embeds[0]!.setDescription(partes.join('\n'));

  // Las listos van como tarjetas propias: son lo que el jugador viene a mirar.
  const listas = [...diario, ...semanal].filter((m) => m.ready);

  for (const m of listas) {
    embeds.push(
      new EmbedBuilder()
        .setColor(COLORS.success)
        .setAuthor({ name: `🎁 ${m.mission.name}` })
        .setDescription(
          `${m.mission.description}\n\n` + recompensa(m.mission.reward),
        ),
    );
  }

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  // Botones de reclamo: hasta tres, que es lo que entra cómodo en una fila.
  for (let i = 0; i < listas.length; i += 3) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const m of listas.slice(i, i + 3)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(
            encodeNav(session, 'mis_reclamar', {
              id: m.mission.id,
              periodo: m.mission.period,
            }),
          )
          .setLabel(m.mission.name)
          .setEmoji('🎁')
          .setStyle(ButtonStyle.Success),
      );
    }
    components.push(row);
  }

  components.push(
    ...actionRow(
      [
        {
          screen: 'misiones',
          params: { which: 'semanal' },
          label: 'Ver semanales',
          emoji: '🗓️',
          style: ButtonStyle.Secondary,
        },
        { screen: 'logros', label: 'Logros', emoji: '🏅', style: ButtonStyle.Primary },
        { screen: 'titulos', label: 'Títulos', emoji: '🎖️', style: ButtonStyle.Secondary },
      ],
      session,
    ),
  );

  components.push(navRow(session, { backLabel: 'Registro' }));
  components.push(...areaRows(session, 'digivice'));

  return { embeds, components };
});

register('mis_reclamar', async (ctx) => {
  const periodo = ctx.params.periodo === 'semanal' ? 'semanal' : 'diaria';
  const resultado = claimAndPayMission(ctx.trainer.id, ctx.params.id ?? '', (r) =>
    pagar(ctx.trainer.id, r),
  );

  if (!resultado.ok) {
    ctx.flash(resultado.message, 'aviso');
  } else {
    ctx.flash(`🎁 Reclamado. Se reinicia el ${periodResetsIn(periodo)}.`, 'ok');
  }

  return ctx.refresh('misiones', ctx.params.which ? { which: ctx.params.which } : {});
});

// ------------------------------------------------------------------ logros -

register('logros', async (ctx) => {
  const { trainer, session } = ctx;
  const estado = achievementsOf(trainer.id);
  const verOcultos = ctx.params.hidden === '1';
  const visibles = verOcultos ? estado : estado.filter((s) => !s.hidden);

  const { page: p, pages, items } = paginate(visibles, ctx.page(), 8);
  const listos = estado.filter((s) => s.ready);

  const embeds: EmbedBuilder[] = [
    header({
      area: 'digivice',
      title: 'LOGROS',
      context:
        `Conseguidos: **${estado.filter((s) => s.unlocked).length}/${estado.length}**  ·  ` +
        `Listos para reclamar: **${listos.length}**\n` +
        'Son de por vida: no caducan.',
      color: COLORS.legendary,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setDescription(
        items.length > 0
          ? items
              .map((s) => {
                const a = s.achievement;
                const marca = s.claimed ? '✅' : s.ready ? '🎁' : s.unlocked ? '🏅' : '▫️';
                const barra = `${'█'.repeat(Math.round(s.ratio * 8))}${'░'.repeat(8 - Math.round(s.ratio * 8))}`;
                const nombre = s.hidden ? '???' : a.name;
                return (
                  `${marca} ${nombre} · ${RARITY_NAMES[a.rarity]} · \`${barra}\` ` +
                  `${Math.min(s.progress, a.target)}/${a.target} ${METRIC_NAMES[a.metric]}`
                );
              })
              .join('\n')
          : '_Nada por aquí._',
      )
      .setFooter({ text: `${p}/${pages} · ✅ reclamado  🎁 listo  🏅 conseguido  ▫️ en curso` }),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  if (listos.length > 0) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const s of listos.slice(0, 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(encodeNav(session, 'log_reclamar', { id: s.achievement.id }))
          .setLabel(s.hidden ? '???' : s.achievement.name)
          .setEmoji('🎁')
          .setStyle(ButtonStyle.Success),
      );
    }
    components.push(row);
  }

  const nav = navRow(session, { backLabel: 'Registro' });
  const pager = pageRow(session, 'logros', ctx.params, p, pages);
  if (pager) nav.components.push(...pager.components);
  components.push(nav);

  components.push(
    ...actionRow(
      [
        {
          screen: 'logros',
          params: { hidden: verOcultos ? '' : '1' },
          label: verOcultos ? 'Ocultos' : 'Ver ocultos',
          emoji: verOcultos ? '🙈' : '👁️',
          style: ButtonStyle.Secondary,
        },
        { screen: 'titulos', label: 'Títulos', emoji: '🎖️', style: ButtonStyle.Secondary },
      ],
      session,
    ),
  );

  components.push(...areaRows(session, 'digivice'));

  return { embeds, components };
});

register('log_reclamar', async (ctx) => {
  const resultado = claimAndPayAchievement(ctx.trainer.id, ctx.params.id ?? '', (r) =>
    pagar(ctx.trainer.id, r),
  );

  if (!resultado.ok) {
    ctx.flash(resultado.message, 'aviso');
  } else {
    const titulo = resultado.reward.exclusive;
    ctx.flash(
      titulo?.kind === 'titulo'
        ? `🏅 ¡${titulo.emoji} ${titulo.name}! Un título nuevo.`
        : '🏅 Logro reclamado.',
      'ok',
    );
  }

  return ctx.refresh('logros');
});

// ----------------------------------------------------------------- títulos -

register('titulos', async (ctx) => {
  const { trainer, session } = ctx;
  const titulos = titlesOf(trainer.id);

  const embeds: EmbedBuilder[] = [
    header({
      area: 'digivice',
      title: 'TÍTULOS',
      context:
        titulos.length > 0
          ? `${titulos.length} título(s) exclusivos. Salen de logros de por vida.`
          : 'Todavía no tienes ninguno. Se consiguen con logros.',
      color: COLORS.legendary,
    }),
  ];

  embeds[0]!.addFields(playerField(trainer));

  if (titulos.length > 0) {
    embeds.push(
      new EmbedBuilder()
        .setColor(COLORS.legendary)
        .setDescription(titulos.map((t) => `${t.emoji} **${t.name}**`).join('\n')),
    );
  }

  // Los que faltan: sin nombre, para no regalar el que se consigue por sorpresa.
  const faltan = achievementsOf(trainer.id).filter(
    (s) => s.achievement.reward.exclusive?.kind === 'titulo' && !s.unlocked,
  );

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setTitle('Por descubrir')
      .setDescription(
        faltan.length > 0
          ? faltan
              .map((s) => `❔ **???** — ${s.achievement.description}`)
              .join('\n')
          : 'No te queda ninguno. 👑',
      ),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [
    navRow(session, { backLabel: 'Logros' }),
    ...areaRows(session, 'digivice'),
  ];

  return { embeds, components };
});

// ------------------------------------------------------------------ apoyo --

/**
 * Paga una recompensa.
 *
 * Se inyecta en el reclamo, dentro de la MISMA transacción que marca la
 * fila como reclamada. Aquí solo se escribe en la economía: el dinero y los
 * objetos. Si algo fallara, la transacción entera se deshace y el botón
 * sigue vivo, en vez de haber cobrado sin entregar.
 */
function pagar(trainerId: number, r: Reward): void {
  if (r.digibytes > 0) giveDigibytes(trainerId, r.digibytes);
  for (const [key, n] of Object.entries(r.items ?? {})) {
    addItem(trainerId, key, n);
  }
}

/**
 * Líneas de una misión: barra, contador y recompensa.
 *
 * Se usa el mismo formato en la lista y en las tarjetas para que el jugador no
 * tenga que aprender dos lecturas.
 */
function misionLines(lista: ReturnType<typeof missionsOf>): string[] {
  return lista.map((s) => {
    const m = s.mission;
    const marca = s.claimed ? '✅' : s.ready ? '🎁' : '▫️';
    const barra = `${'█'.repeat(Math.round(s.ratio * 6))}${'░'.repeat(6 - Math.round(s.ratio * 6))}`;
    const contador = `${Math.min(s.progress, m.target)}/${m.target}`;

    return (
      `${marca} \`${barra}\` **${m.name}** — ${contador} ${METRIC_NAMES[m.metric]}\n` +
      `　　${recompensa(m.reward, true)}`
    );
  });
}

function recompensa(r: Reward, corto = false): string {
  const partes: string[] = [];

  if (r.digibytes > 0) partes.push(`${r.digibytes} DB`);

  if (!corto) {
    for (const [key, n] of Object.entries(r.items ?? {})) {
      const def = getItem(key);
      partes.push(`${n}x ${def?.name ?? key}`);
    }
    if (r.exclusive) partes.push(`${r.exclusive.emoji} ${r.exclusive.name}`);
  } else {
    const objetos = Object.keys(r.items ?? {}).length;
    if (objetos > 0) partes.push(`${objetos} objeto(s)`);
    if (r.exclusive) partes.push(`${r.exclusive.emoji} título`);
  }

  return partes.join(' · ');
}
