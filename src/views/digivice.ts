import { EmbedBuilder } from 'discord.js';
import {
  ATTRIBUTE_CODES,
  ATTRIBUTE_EMOJI,
  ATTRIBUTE_NAMES,
  attributeMatchups,
} from '../game/attributes.js';
import {
  affinityReport,
  ELEMENT_CODES,
  ELEMENT_EMOJI,
  ELEMENT_NAMES,
  analyzeMatchup,
  type MatchupBreakdown,
} from '../game/elements.js';
import { statusLabel } from '../game/combat.js';
import { expToNextLevel, MAX_LEVEL } from '../game/stats.js';
import { progressBar, TIER_NAMES } from '../game/progression.js';
import { config } from '../config.js';
import { SPECIES as SPECIES_LOOKUP } from '../game/species.js';
import type { MoveDef, OwnedDigimon, SpeciesDef } from '../game/types.js';

/** ASCII del dispositivo. Discord respeta el code block, la UI "en marco". */
function frame(title: string, bodyLines: string[], footer?: string): string {
  const width = 46;
  const top = `╔${'═'.repeat(width)}╗`;
  const bottom = `╚${'═'.repeat(width)}╝`;
  const rows = [
    `║ ${title.padEnd(width - 2)} ║`,
    `╟${'─'.repeat(width)}╢`,
    ...bodyLines.map((line) => `║ ${line.slice(0, width - 2).padEnd(width - 2)} ║`),
    ...(footer ? [`╟${'─'.repeat(width)}╢`, `║ ${footer.slice(0, width - 2).padEnd(width - 2)} ║`] : []),
  ];
  return [top, ...rows, bottom].join('\n');
}

/** Barra de PV con bloques, estilo terminal. */
function bar(current: number, max: number, width = 14): string {
  const ratio = max <= 0 ? 0 : Math.max(0, Math.min(1, current / max));
  const filled = Math.round(ratio * width);
  const glyphs = ['█', '▓', '▒', '░'];
  const glyph = ratio > 0.5 ? glyphs[0]! : ratio > 0.25 ? glyphs[1]! : ratio > 0.1 ? glyphs[2]! : glyphs[3]!;
  return `${glyph.repeat(filled)}${'░'.repeat(width - filled)}`;
}

function statRow(label: string, value: number, width = 14): string {
  const scale = 300; // valor maximo aproximado en nivel 100
  const filled = Math.max(1, Math.round((value / scale) * width));
  return `${label.padEnd(4)}${'█'.repeat(Math.min(width, filled))}${'·'.repeat(width - Math.min(width, filled))} ${value}`;
}

/**
 * Pantalla principal del Digivice: el Digimon lider con su ficha completa.
 * Es lo que sale al hacer `/digivice`.
 */
export function digiviceEmbed(
  leader: OwnedDigimon | null,
  party: OwnedDigimon[],
  pcCount: number,
): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(0x1b2838);

  if (!leader) {
    embed
      .setTitle('📟 Digivice')
      .setDescription(
        '```' +
          frame('SISTEMA INICIANDO', [
            'No hay ningun Digimon activo.',
            '',
            'Registrate con /perfil o saca uno del',
            'PC con /pc sacar <id>.',
          ]) +
          '```',
      );
    return embed;
  }

  const species = leader.species;
  const matchup = attributeMatchups(species.attribute);

  const body = [
    `${species.emoji} ${leader.nickname ?? species.name}   Nv.${leader.level}  ${TIER_NAMES[species.tier]}`,
    `ATRIB   ${ATTRIBUTE_EMOJI[species.attribute]} ${ATTRIBUTE_CODES[species.attribute]} ${ATTRIBUTE_NAMES[species.attribute]}`,
    `ELEM    ${species.elements.map((e) => `${ELEMENT_EMOJI[e]}${ELEMENT_CODES[e]}`).join('  ')}`,
    '',
    `HP      ${bar(leader.hp, leader.stats.hp)}`,
    `        ${leader.hp} / ${leader.stats.hp}`,
    '',
    statRow('ATQ', leader.stats.attack),
    statRow('DEF', leader.stats.defense),
    statRow('VEL', leader.stats.speed),
    '',
    expLine(leader),
  ];

  const footer = [
    `EQUIPO ${party.length}/${config.maxPartySize}   PC ${pcCount}/${config.pcCapacity}`,
    leader.status !== 'ok' ? `ESTADO ${statusLabel(leader.status)}` : 'ESTADO Normal',
  ].join('   ');

  embed
    .setTitle('📟 Digivice')
    .setDescription('```' + frame(`${ATTRIBUTE_CODES[species.attribute]}-${ELEMENT_CODES[species.elements[0]!]} // ${species.key.toUpperCase()}`, body, footer) + '```')
    .addFields(
      {
        name: '⚔️ Ventaja de atributo',
        value:
          matchup.strong.length > 0
            ? matchup.strong.map((a) => `${ATTRIBUTE_EMOJI[a]} ${ATTRIBUTE_NAMES[a]}`).join('\n')
            : '—',
        inline: true,
      },
      {
        name: '🛡️ Desventaja de atributo',
        value:
          matchup.weak.length > 0
            ? matchup.weak.map((a) => `${ATTRIBUTE_EMOJI[a]} ${ATTRIBUTE_NAMES[a]}`).join('\n')
            : '—',
        inline: true,
      },
    )
    .setFooter({ text: `${species.lore}` });

  return embed;
}

function expLine(digimon: OwnedDigimon): string {
  if (digimon.level >= MAX_LEVEL) return 'EXP    ████████████████████ MAX';
  const need = expToNextLevel(digimon.level);
  return `EXP    ${progressBar(digimon.exp, need, 12)} ${digimon.exp}/${need}`;
}

/**
 * Ficha completa de un Digimon: la pantalla "Setup" del Digivice.
 * Incluye la tabla de afinidades, que es la parte strategica del juego.
 */
export function setupEmbed(
  digimon: OwnedDigimon,
  isLead: boolean,
  preview?: SpeciesDef,
): EmbedBuilder {
  const species = digimon.species;
  const affinities = affinityReport(species);

  const body = [
    `${species.emoji} ${digimon.nickname ?? species.name}`,
    `Nv.${digimon.level}  ${TIER_NAMES[species.tier]}${isLead ? '  [LIDER]' : ''}`,
    `ATRIB ${ATTRIBUTE_EMOJI[species.attribute]} ${ATTRIBUTE_NAMES[species.attribute]}`,
    `ELEM  ${species.elements.map((e) => `${ELEMENT_EMOJI[e]} ${ELEMENT_NAMES[e]}`).join('  ')}`,
    '',
    `HP ${bar(digimon.hp, digimon.stats.hp)} ${digimon.hp}/${digimon.stats.hp}`,
    expLine(digimon),
  ];

  const fields: { name: string; value: string; inline: boolean }[] = [
    {
      name: '📊 Estadísticas',
      value: [
        `❤️ **PV** ${digimon.stats.hp}`,
        `⚔️ **ATQ** ${digimon.stats.attack}`,
        `🛡️ **DEF** ${digimon.stats.defense}`,
        `💨 **VEL** ${digimon.stats.speed}`,
      ].join('\n'),
      inline: true,
    },
    {
      name: '🎯 Afinidad elemental',
      value: [
        `◎ **Muy débil a** ${affinities.weak.map((e) => `${ELEMENT_EMOJI[e]} ${ELEMENT_NAMES[e]}`).join(', ') || '—'}`,
        `△ **Resiste** ${affinities.resists.map((e) => `${ELEMENT_EMOJI[e]} ${ELEMENT_NAMES[e]}`).join(', ') || '—'}`,
        affinities.immune.length > 0
          ? `X **Inmune a** ${affinities.immune.map((e) => `${ELEMENT_EMOJI[e]} ${ELEMENT_NAMES[e]}`).join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      inline: true,
    },
    {
      name: '📖 Movimientos',
      value: digimon.moves.map(moveLine).join('\n') || '—',
      inline: false,
    },
  ];

  // Panel de analisis: cuanto pega cada movimiento contra un rival dado.
  if (preview) {
    fields.push({
      name: `🔬 Análisis contra ${preview.emoji} ${preview.name}`,
      value: digimon.moves
        .map((move) => analysisLine(move, digimon, preview))
        .join('\n')
        .slice(0, 1024),
      inline: false,
    });
  }

  // La evolución es manual: el pie resume cuántas rutas hay y a dónde llevan,
  // sin prometer que salte sola al subir de nivel.
  const evolutions = species.evolutions;
  const footer =
    evolutions.length === 0
      ? 'Forma final de su linea evolutiva.'
      : `${evolutions.length} ruta(s): ${evolutions
          .map((r) => `${r.branch ? '🔀' : '➡️'} ${SPECIES_LOOKUP[r.to]?.name ?? r.to} (Nv.${r.level})`)
          .join(' · ')} · /evolucion`;

  return new EmbedBuilder()
    .setColor(isLead ? 0x38a169 : 0x2b6cb0)
    .setTitle(`${species.emoji} ${digimon.nickname ?? species.name}`)
    .setDescription(
      '```' +
        frame(`SETUP #${digimon.id}`, body, `Capturado ${digimon.caughtAt}`) +
        '```',
    )
    .addFields(fields)
    .setFooter({ text: footer });
}

function moveLine(move: MoveDef): string {
  const kind = move.category === 'estado' ? 'Estado' : `Pot ${move.power}`;
  return `${ELEMENT_EMOJI[move.element]} **${move.name}** · ${kind} · ${move.energyCost}⚡ · ${Math.round(move.accuracy * 100)}%`;
}

/** Una fila del panel de analisis: cuanto hira este movimiento concreto. */
function analysisLine(move: MoveDef, mine: OwnedDigimon, theirs: SpeciesDef): string {
  const m: MatchupBreakdown = analyzeMatchup(
    { attribute: mine.species.attribute, species: mine.species },
    move.element,
    { attribute: theirs.attribute, species: theirs },
  );

  const pct = Math.round(m.total * 100);
  const parts: string[] = [];
  if (m.attribute > 1) parts.push('ATQ+');
  if (m.attribute < 1) parts.push('ATQ−');
  if (m.element > 1) parts.push('ELEM+');
  if (m.element < 1) parts.push('ELEM−');
  if (m.stab > 1) parts.push('STAB');

  const verdict =
    pct >= 200 ? '💀 letal' : pct >= 150 ? '🔥 fuerte' : pct >= 110 ? '✅ bien' : pct >= 90 ? '➖ neutro' : '🐌 flojo';
  if (pct <= 1) return `✖️ **${move.name}** — inmune`;

  return `${ELEMENT_EMOJI[move.element]} **${move.name}** → \`${pct}%\` ${verdict}${parts.length ? ` \`${parts.join(' ')}\`` : ''}`;
}

/** Mini-ficha de un Digimon del PC, sin occupy todo el embed. */
export function pcLine(digimon: OwnedDigimon, index: number): string {
  const species = digimon.species;
  const mark = species.elements.map((e) => ELEMENT_EMOJI[e]).join('');
  return `\`${String(index + 1).padStart(2)}\` #${digimon.id} ${species.emoji} **${digimon.nickname ?? species.name}** Nv.${digimon.level} ${ATTRIBUTE_EMOJI[species.attribute]}${mark}`;
}
