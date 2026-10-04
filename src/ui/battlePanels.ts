import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { Fighter } from '../game/types.js';
import { STATUS_INFO } from '../game/statuses.js';
import { ESTILO, PERFILES, type Personalidad } from '../game/ai.js';
import {
  ATTRIBUTE_EMOJI,
  ATTRIBUTE_NAMES,
  ATTRIBUTE_STRONG,
  ATTRIBUTE_WEAK,
  TRIANGLE_ATTRIBUTES,
  attributeMatchups,
} from '../game/attributes.js';

/**
 * Paneles de solo lectura del combate.
 *
 * Ninguna función aquí calcula una regla. Todo lo que sale es lectura del estado
 * que el motor ya escribió, y por eso estas pantallas no pueden mentir: si el
 * motor cambia un porcentaje, cambia el texto sin tocar este fichero.
 *
 * Lo que SÍ hacen es decidir la FORMA: qué estado va primero, cómo se recorta un
 * nombre, dónde va un campo. Esa parte es de presentación y no puede estar en el
 * motor, porque el motor no sabe qué es una pantalla.
 */

/**
 * El panel ACTIVE EFFECTS.
 *
 * Devuelve una línea por efecto. El detalle —qué hace cada estado y por qué— sale
 * del catálogo, no de una tabla escrita aquí. La diferencia importa: cuando se
 * añadió un estado al motor, la tabla de este fichero habría seguido mostrando el
 * texto viejo sin que nada fallara.
 */
export function panelEfectos(fighter: Fighter, titulo = 'EFECTOS ACTIVOS'): string {
  if (fighter.hp <= 0) return `**${titulo}**\n🔴 ${fighter.name} ha caído.`;

  const partes: string[] = [];

  // El escudo va aparte porque su unidad son los PV que le quedan, no los turnos.
  if (fighter.shield > 0) partes.push(`🛡️ **Escudo** · ${fighter.shield} PV`);

  const combatientes: string[] = [];
  const pasivos: string[] = [];

  for (const estado of fighter.statuses) {
    if (estado.kind === 'escudo') continue;

    const info = STATUS_INFO[estado.kind];
    const marca = `${info.emoji} **${info.label}**`;
    const reloj = estado.turns > 0 ? ` ⏱️ ${estado.turns}` : '';

    if (info.control) {
      // Los de control van PRIMERO: son los que cambian el turno siguiente, y son
      // los que el jugador tiene que mirar para decidir.
      combatientes.push(marca + reloj);
    } else if (info.stat) {
      const signo = info.up ? '+' : '−';
      pasivos.push(`${marca} ${signo}${Math.round(estado.magnitude * 100)}%${reloj}`);
    } else {
      pasivos.push(marca + reloj);
    }
  }

  if (pasivos.length > 0) partes.push(pasivos.join('  ·  '));
  if (combatientes.length > 0) partes.push(`⚡ ${combatientes.join('  ·  ')}`);

  if (partes.length === 0) partes.push('_Sin efectos._');

  return `**${titulo}**\n${partes.join('\n')}`;
}

/** Ficha de un estado, para cuando el jugador toca uno en la pantalla. */
export function fichaEstado(fighter: Fighter, kind: string): EmbedBuilder | null {
  const estado = fighter.statuses.find((s) => s.kind === kind);
  const info = STATUS_INFO[kind as keyof typeof STATUS_INFO];

  if (!estado || !info) return null;

  const emb = new EmbedBuilder()
    .setColor(0x4a5568)
    .setAuthor({ name: `${info.emoji} ${info.label}` })
    .setDescription(info.desc)
    .addFields({
      name: 'Duración',
      value: estado.turns > 0 ? `⏱️ ${estado.turns} turno(s)` : 'Hasta el final del combate',
      inline: true,
    });

  if (info.stat && estado.magnitude > 0) {
    emb.addFields({
      name: 'Intensidad',
      value: `${estado.magnitude > 0 && info.up ? '+' : '−'}${Math.round(estado.magnitude * 100)}% de ${textoStat(info.stat)}`,
      inline: true,
    });
  }

  emb.addFields({ name: 'Origen', value: estado.source || '—', inline: true });

  return emb;
}

function textoStat(stat: string): string {
  switch (stat) {
    case 'attack':
      return 'ATQ';
    case 'defense':
      return 'DEF';
    case 'speed':
      return 'VEL';
    default:
      return stat.toUpperCase();
  }
}

/**
 * La tabla de atributos, para el botón ℹ️.
 *
 * Las relaciones salen de `attributeMatchups`, que es donde viven. Escribirlas a
 * mano en la pantalla sería tener la misma tabla en dos sitios, y el día que
 * cambiara el triángulo el diagrama seguiría diciendo la versión vieja sin que nada
 * se rompiera.
 */
export function tablaAtributos(): EmbedBuilder {
  const emb = new EmbedBuilder()
    .setColor(0x4a5568)
    .setAuthor({ name: 'ℹ️ CÓMO FUNCIONA EL COMBATE' })
    .setDescription(
      'El daño pasa por **dos capas**. Se multiplican entre sí, así que una puede ' +
        'compensar a la otra.',
    );

  const filas = TRIANGLE_ATTRIBUTES.map((a) => {
    const m = attributeMatchups(a);
    const advantages = m.strong.map((x) => ATTRIBUTE_NAMES[x] ?? x).join(', ') || '—';
    const debilidades = m.weak.map((x) => ATTRIBUTE_NAMES[x] ?? x).join(', ') || '—';

    return (
      `${ATTRIBUTE_EMOJI[a]} **${ATTRIBUTE_NAMES[a]}**\n` +
      `→ vence a ${advantages}\n` +
      `→ pierde contra ${debilidades}`
    );
  }).join('\n\n');

  emb.addFields(
    { name: '🔺 Capa 1 · Atributo', value: filas },
    {
      name: 'Los multiplicadores',
      value:
        `Ventaja · **×${ATTRIBUTE_STRONG}**\n` +
        `Ventaja · **×${ATTRIBUTE_WEAK}**\n` +
        'Igual atributo · ×1\n\n' +
        'Los otros atributos (`Free`, `Variable`…) no participan en el triángulo.',
    },
  );

  emb.addFields({
    name: '🔻 Capa 2 · Elemento',
    value:
      'Fuego, Agua, Rayo, Tierra… Cada Digimon es muy débil a algunos, resiste ' +
      'otros e inmune a alguno. Los que no tienen afinidad cuentan como neutrales.',
  });

  return emb;
}

/** Los estilos de IA, para la pantalla del rival. */
export function estilosIA(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x4a5568)
    .setAuthor({ name: '🧠 ESTILOS DE COMBATE' })
    .setDescription(
      'Cada rival decide con un criterio distinto. No son dificultades distintas: ' +
        'son formas distintas de tomar la misma decisión, y por eso dos rivales ' +
        'con las mismas estadísticas no juegan igual.',
    )
    .addFields(
      ...(Object.keys(PERFILES) as Personalidad[]).map((p) => ({
        name: `${PERFILES[p].emoji} ${ESTILO[p]}`,
        value: PERFILES[p].desc,
        inline: true,
      })),
    );
}

/** Las sinergias activas del equipo. */
export function panelSinergias(
  sinergias: { nombre: string; emoji: string; desc: string }[],
): string {
  if (sinergias.length === 0) return '**SINERGÍAS**\n_El equipo no activa ninguna._';

  return (
    '**SINERGÍAS**\n' +
    sinergias.map((s) => `${s.emoji} **${s.nombre}** — ${s.desc}`).join('\n')
  );
}

/** Un botón de "explicar" para las cabeceras. */
export function botonInfo(etiqueta = 'Tabla'): ButtonBuilder {
  return new ButtonBuilder()
    .setLabel(etiqueta)
    .setEmoji('ℹ️')
    .setStyle(ButtonStyle.Secondary);
}

export { ActionRowBuilder };
export type { Personalidad };