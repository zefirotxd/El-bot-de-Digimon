import { EmbedBuilder } from 'discord.js';
import { ELEMENT_EMOJI, ELEMENT_NAMES } from '../game/elements.js';
import {
  ATTRIBUTE_EMOJI,
  ATTRIBUTE_NAMES,
  attributeMultiplier,
} from '../game/attributes.js';
import {
  statusLabel,
  counterHint,
  effectiveSpecies,
  effectiveStat,
  type BattleState,
} from '../game/combat.js';
import { getBoss } from '../game/bosses.js';
import { expToNextLevel, MAX_LEVEL } from '../game/stats.js';
import { formatNumber, progressBar, TIER_NAMES } from '../game/progression.js';
import { SPECIES } from '../game/species.js';
import type { Attribute, Fighter, OwnedDigimon, SpeciesDef } from '../game/types.js';

export const COLORS = {
  primary: 0x2b6cb0,
  success: 0x38a169,
  danger: 0xe53e3e,
  warning: 0xd69e2e,
  neutral: 0x4a5568,
  legendary: 0xb7791f,
} as const;

export function elementTags(species: SpeciesDef): string {
  return species.elements.map((e) => `${ELEMENT_EMOJI[e]} ${ELEMENT_NAMES[e]}`).join(' ');
}

/** Etiqueta del atributo: "☣️ Virus". */
export function attributeTag(attribute: Attribute): string {
  return `${ATTRIBUTE_EMOJI[attribute]} ${ATTRIBUTE_NAMES[attribute]}`;
}

/** Ventaja o desventaja de atributo, para el panel del combate. */
export function attributeMatchLine(mine: Attribute, theirs: Attribute): string | null {
  const m = attributeMultiplier(mine, theirs);
  if (m > 1) return `☣️ Ventaja de atributo contra ${attributeTag(theirs)}`;
  if (m < 1) return `⚠️ Desventaja de atributo contra ${attributeTag(theirs)}`;
  return null;
}

function hpBar(fighter: Fighter): string {
  const max = fighter.stats.hp;
  const width = 12;
  const ratio = max <= 0 ? 0 : fighter.hp / max;
  const filled = Math.round(ratio * width);
  const color = ratio > 0.5 ? '🟩' : ratio > 0.25 ? '🟨' : '🟥';
  return `${color.repeat(filled)}${'⬜'.repeat(width - filled)} \`${fighter.hp}/${max}\``;
}

function fighterBlock(fighter: Fighter, title: string): string {
  const mods = Object.entries(fighter.modifiers)
    .filter(([, factor]) => factor !== 1)
    .map(([stat, factor]) => `${(factor! * 100).toFixed(0)}% ${stat.toUpperCase()}`);

  const species = getSpeciesOf(fighter);

  const lines = [
    `**${title}**`,
    `${fighter.emoji} ${fighter.name}  ·  Nv.${fighter.level}  ·  ${TIER_NAMES[species.tier]}`,
    `${attributeTag(fighter.attribute)}  ·  ${elementTags(species)}`,
    `PV ${hpBar(fighter)}`,
    `⚔️ ${effectiveStat(fighter, 'attack')}   🛡️ ${effectiveStat(fighter, 'defense')}   💨 ${effectiveStat(fighter, 'speed')}`,
  ];

  if (species.weakTo.length > 0) {
    lines.push(
      `◎ Débil a ${species.weakTo.map((e) => ELEMENT_EMOJI[e]).join(' ')}  ·  ` +
        `△ Resiste ${species.resists.map((e) => ELEMENT_EMOJI[e]).join(' ')}`,
    );
  }

  if (fighter.status !== 'ok') lines.push(`⚠️ ${statusLabel(fighter.status)}`);
  if (fighter.isDefending) lines.push('🛡️ Defendiendo');
  if (mods.length > 0) lines.push(`📉 ${mods.join(' · ')}`);

  return lines.join('\n');
}

function rivalLabel(state: BattleState): string {
  if (!state.enemyTrainer) return 'Rival';
  const position = state.enemyIndex + 1;
  return state.enemyTeam.length > 1 ? `Rival ${position}/${state.enemyTeam.length}` : 'Rival';
}

function getSpeciesOf(fighter: Fighter): SpeciesDef {
  const species = SPECIES[fighter.speciesKey];
  if (!species) throw new Error(`Especie desconocida: ${fighter.speciesKey}`);
  return species;
}

export function battleEmbed(state: BattleState): EmbedBuilder {
  const matchup = attributeMatchLine(state.player.attribute, state.enemy.attribute);

  const embed = new EmbedBuilder()
    .setColor(state.isBoss ? COLORS.legendary : COLORS.primary)
    .setTitle(`${state.isBoss ? '👑 Jefe' : '⚔️ Combate'} · Turno ${state.turn}`)
    .setDescription(
      `${fighterBlock(state.player, 'Tú')}\n\n${fighterBlock(state.enemy, rivalLabel(state))}`,
    );

  // La vida del equipo rival se ve de un vistazo: es la información que
  // decide a quién sacas cuando el tuyo cae.
  if (state.enemyTeam.length > 1) {
    embed.addFields({
      name: `Equipo de ${state.enemyTrainer ?? 'el rival'}`,
      value: state.enemyTeam
        .map((f, i) => {
          const alive = f.hp > 0;
          const active = i === state.enemyIndex;
          return `${active ? '▶️' : alive ? '　' : '✖️'} ${f.emoji} ${f.name} Nv.${f.level} ` +
            (alive ? `\`${f.hp}/${f.stats.hp}\`` : '`KO`');
        })
        .join('\n'),
    });
  }

  if (matchup) {
    embed.addFields({ name: '⚖️ Ventaja', value: matchup });
  }

  // ------------------------------------------------------------- jefe ------
  // Un jefe sin su fase a la vista es un jefe con más PV. Y un ataque
  // telegrafiado sin la cuenta atrás es un ataque que no se puede responder.
  const boss = state.enemy.boss;
  if (boss) {
    const def = getBoss(boss.key);
    const phase = def?.phases[boss.phaseIndex];
    const species = effectiveSpecies(state.enemy);

    const bars = def?.phases
      .map((p, i) => {
        const active = i === boss.phaseIndex;
        return `${active ? '▶️' : '　'} ${p.name}`;
      })
      .join('\n');

    embed.addFields({
      name: `👑 Fase ${boss.phaseIndex + 1}/${def?.phases.length ?? 1}${phase ? ` — ${phase.name}` : ''}`,
      value: [
        bars ?? '',
        '',
        `Atributo **${species.attribute}** · Debilidades: **${species.weakTo.join(', ')}**`,
        species.resists.length > 0 ? `Resiste: ${species.resists.join(', ')}` : '',
        species.immuneTo?.length ? `🛡️ Inmune a **${species.immuneTo.join(', ')}**` : '',
        phase?.damageTaken ? `Daño recibido: **×${phase.damageTaken}**` : '',
        phase?.regen ? `Se cura **${Math.round(phase.regen * 100)}%** de sus PV por turno` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      inline: true,
    });

    const telegraph = boss.telegraph;
    if (telegraph) {
      const countdown = telegraph.turnsLeft;
      const warning =
        countdown > 1
          ? `⚠️ **Cae en ${countdown} turnos.**`
          : '⚠️ **¡CAE ESTE TURNO!**';

      const reduction = Math.round(telegraph.mitigated * 100);
      const lines = [
        warning,
        `**${telegraph.name}** — ${ELEMENT_EMOJI[telegraph.element] ?? ''} ${telegraph.element}`,
        `Daño estimado: **~${telegraph.estimate}**`,
        telegraph.hint,
      ];

      if (reduction > 0) {
        lines.push(`✅ Ya has recortado un **${reduction}%**.`);
      }

      const hint = counterHint(state);
      if (hint) lines.push(`👉 ${hint}`);

      embed.addFields({
        name: '🚨 Ataque anunciado',
        value: lines.join('\n'),
        inline: true,
      });
    }
  }

  if (state.log.length > 0) {
    embed.addFields({
      name: 'Registro',
      value: state.log.map((l) => `• ${l}`).join('\n').slice(0, 1024),
    });
  }

  const energy = '⚡'.repeat(state.player.energy) + '·'.repeat(6 - state.player.energy);
  const items = state.items.map((i) => `${i.emoji} ${i.quantity}`).join('  ');
  embed.setFooter({
    text: `Energía ${energy}   ·   Objetos: ${items}   ·   Cápsulas: ${3 - state.capsulesUsed}/3`,
  });

  return embed;
}

export function profileEmbed(
  trainer: { username: string; digibytes: number; battlesWon: number; battlesLost: number; createdAt: string },
  roster: OwnedDigimon[],
): EmbedBuilder {
  const total = trainer.battlesWon + trainer.battlesLost;
  const winrate = total === 0 ? 0 : Math.round((trainer.battlesWon / total) * 100);

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`Entrenador ${trainer.username}`)
    .addFields(
      {
        name: 'Registro',
        value: [
          `💰 **${formatNumber(trainer.digibytes)}** DigiBytes`,
          `🏆 ${trainer.battlesWon} victorias · ${trainer.battlesLost} derrotas (${winrate}%)`,
          `🐾 ${roster.length} Digimon`,
          `📅 Desde ${trainer.createdAt}`,
        ].join('\n'),
        inline: false,
      },
      { name: '\u200b', value: '\u200b', inline: false },
    );

  if (roster.length === 0) {
    embed.setDescription('Todavía no tienes ningún Digimon. Usa `/registrarse` para empezar.');
    return embed;
  }

  embed.addFields({
    name: 'Tu equipo',
    value: roster
      .map((d) => {
        const need = expToNextLevel(d.level);
        const expBar =
          d.level >= MAX_LEVEL ? 'Nivel máximo' : `EXP ${progressBar(d.exp, need, 8)} ${d.exp}/${need}`;
        return (
          `\`#${d.id}\` ${d.species.emoji} **${d.nickname ?? d.species.name}** · Nv.${d.level} ` +
          `· ${TIER_NAMES[d.species.tier]} · ${elementTags(d.species)}\n` +
          `${expBar}`
        );
      })
      .join('\n\n')
      .slice(0, 1024),
  });

  return embed;
}

export function victoryEmbed(rewards: {
  exp: number;
  digibytes: number;
  enemyName: string;
  levels: {
    speciesName: string;
    nickname: string | null;
    toLevel: number;
    newMoves: string[];
    evolvedTo: string | null;
  }[];
  /** Nombre del entrenador rival, si lo hubo. */
  opponent?: string | null;
  boss?: boolean;
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(rewards.boss ? COLORS.legendary : COLORS.success)
    .setTitle(rewards.boss ? '👑 ¡Jefe derrotado!' : '🏆 ¡Victoria!')
    .setDescription(
      rewards.opponent
        ? `Has vencido a **${rewards.opponent}** y a su **${rewards.enemyName}**.`
        : `Has derrotado a **${rewards.enemyName}**.`,
    )
    .addFields({
      name: 'Recompensas',
      value: `✨ **+${formatNumber(rewards.exp)}** EXP para todo tu equipo\n💰 **+${formatNumber(rewards.digibytes)}** DigiBytes`,
    });

  const evolved = rewards.levels.filter((l) => l.evolvedTo);
  if (evolved.length > 0) {
    embed.addFields({
      name: '🌟 ¡Evolución!',
      value: evolved
        .map((l) => `**${l.nickname ?? l.speciesName}** → **${l.evolvedTo}**`)
        .join('\n')
        .slice(0, 1024),
    });
  }

  const leveled = rewards.levels.filter((l) => !l.evolvedTo);
  if (leveled.length > 0) {
    embed.addFields({
      name: '¡Subieron de nivel!',
      value: leveled
        .map(
          (l) =>
            `**${l.nickname ?? l.speciesName}** → Nv.${l.toLevel}` +
            (l.newMoves.length > 0 ? `\n📖 Aprendió: ${l.newMoves.join(', ')}` : ''),
        )
        .join('\n')
        .slice(0, 1024),
    });
  }

  return embed;
}

export function capturedEmbed(species: SpeciesDef, level: number, digimonId: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.legendary)
    .setTitle('📦 ¡Captura exitosa!')
    .setDescription(
      `${species.emoji} **${species.name}** de nivel ${level} se ha unido a tu equipo (id \`#${digimonId}\`).\n\n` +
        `*${species.lore}*`,
    )
    .addFields({
      name: 'Datos',
      value:
        `${elementTags(species)}\n` +
        `📊 ${TIER_NAMES[species.tier]} · 🧬 Base PV ${species.base.hp} / ATQ ${species.base.attack} / ` +
        `DEF ${species.base.defense} / VEL ${species.base.speed}`,
    });
}

export function escapeEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setTitle('🏃 Escape')
    .setDescription('Has conseguido huir. Tu equipo vuelve a la base con todos los PV.');
}

export function digimonEmbed(digimon: OwnedDigimon, isLead: boolean): EmbedBuilder {
  const need = expToNextLevel(digimon.level);
  const expLine =
    digimon.level >= MAX_LEVEL
      ? '**Nivel máximo**'
      : `${progressBar(digimon.exp, need, 10)} \`${digimon.exp}/${need} EXP\``;

  const moves = digimon.moves
    .map(
      (m) =>
        `${ELEMENT_EMOJI[m.element]} **${m.name}** · ${m.category === 'estado' ? 'Estado' : `Pot ${m.power}`} · ` +
        `${m.energyCost}⚡ · Prec ${Math.round(m.accuracy * 100)}%\n   *${m.description}*`,
    )
    .join('\n');

  return new EmbedBuilder()
    .setColor(isLead ? COLORS.success : COLORS.primary)
    .setTitle(`${digimon.species.emoji} ${digimon.nickname ?? digimon.species.name}`)
    .setDescription(
      `\`#${digimon.id}\` · **Nv.${digimon.level}** ${TIER_NAMES[digimon.species.tier]}${isLead ? ' · ⭐ Líder' : ''}\n` +
        `${elementTags(digimon.species)}\n${expLine}`,
    )
    .addFields(
      {
        name: 'Estadísticas',
        value: [
          `❤️ **PV** ${digimon.stats.hp}`,
          `⚔️ **ATQ** ${digimon.stats.attack}`,
          `🛡️ **DEF** ${digimon.stats.defense}`,
          `💨 **VEL** ${digimon.stats.speed}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Movimientos',
        value: moves || 'Sin movimientos',
        inline: false,
      },
    )
    .setFooter({ text: `Capturado: ${digimon.caughtAt}` })
    .setThumbnail(null);
}

export function starterPickerEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🐣 Elige tu primer Digimon')
    .setDescription(
      'Tu elección determina tu elemento inicial, pero **todas las cadenas evolutivas ' +
        'llegan al mismo final**. No hay elección equivocada.\n\n' +
        'Usa el menú desplegable de abajo para elegir.',
    );
}
