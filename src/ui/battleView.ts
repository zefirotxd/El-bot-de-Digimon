import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import {
  ATTRIBUTE_EMOJI,
  ATTRIBUTE_NAMES,
  attributeMatchups,
} from '../game/attributes.js';
import { ELEMENT_EMOJI, ELEMENT_NAMES } from '../game/elements.js';
import { counterHint, effectiveSpecies, statusLabel, type BattleState } from '../game/combat.js';
import { STATUS_INFO } from '../game/statuses.js';
import { textoDeStat } from '../game/synergies.js';
import { type StatusEffect } from '../game/types.js';
import type { Fighter } from '../game/types.js';
import { bar, panel } from './components.js';

/**
 * Piezas de pintado del combate.
 *
 * NADA aquí calcula reglas. Todo lo que aparece sale de `BattleState`, que es lo
 * que el motor ha ido llenando mientras jugaba. Si aquí se calculara un daño o
 * una afinidad, habría dos reglas y la pantalla mentiría en cuanto una cambiara.
 *
 * Las únicas operaciones propias son de formato: barras, colores y etiquetas.
 */

const EFECTIVIDAD: Record<string, { emoji: string; texto: string; color: number }> = {
  supereficaz: { emoji: '💥', texto: 'SUPER EFECTIVO', color: 0x38a169 },
  eficaz: { emoji: '✅', texto: 'EFECTIVO', color: 0x48bb78 },
  inmune: { emoji: '✖️', texto: 'INMUNE', color: 0x718096 },
  ineficaz: { emoji: '🛡️', texto: 'RESISTIDO', color: 0xd69e2e },
};

// ------------------------------------------------------------- fighters ----

/**
 * Una cara del combate: el Digimon activo con su barra.
 *
 * `lado` decide el color. El del jugador es verde y el del rival rojo porque es
 * la convención de todos los juegos de lucha y ahorra explanation.
 */
export function fighterBlock(fighter: Fighter, lado: 'jugador' | 'rival', titulo: string): string {
  const species = effectiveSpecies(fighter);
  const ratio = fighter.stats.hp > 0 ? fighter.hp / fighter.stats.hp : 0;
  const emoji = ratio > 0.5 ? '🟩' : ratio > 0.25 ? '🟨' : '🟥';

  const estado =
    fighter.hp <= 0
      ? '**CAÍDO**'
      : fighter.statuses.length > 0
        ? `⚠️ ${fighter.statuses.map((s) => STATUS_INFO[s.kind].emoji).join('')}`
        : `${fighter.energy}⚡`;

  const modificadores = Object.entries(fighter.modifiers)
    .filter(([, factor]) => factor !== 1)
    .map(([stat, factor]) => `${Math.round((factor! - 1) * 100) >= 0 ? '+' : ''}${Math.round((factor! - 1) * 100)}% ${stat.toUpperCase()}`);

  const filas = [
    `${fighter.emoji} **${fighter.name}** · Nv.${fighter.level}`,
    `${ATTRIBUTE_EMOJI[fighter.attribute]} ${ATTRIBUTE_NAMES[fighter.attribute]}  ·  ${species.elements.map((e) => `${ELEMENT_EMOJI[e]} ${ELEMENT_NAMES[e]}`).join(' ')}`,
    `${emoji.repeat(Math.round(ratio * 10))}${'⬜'.repeat(10 - Math.round(ratio * 10))} \`${fighter.hp}/${fighter.stats.hp}\``,
    `⚡ ${fighter.energy}  ·  ${estado}`,
  ];

  if (modificadores.length > 0) filas.push(`📈 ${modificadores.join('  ')}`);
  if (fighter.isDefending) filas.push('🛡️ Defendiendo');
  if (fighter.boss?.telegraph) filas.push(`⚠️ **${fighter.boss.telegraph.name}** en ${fighter.boss.telegraph.turnsLeft}`);

  return '```' + panel(titulo, filas, 42) + '```';
}

/** El bloque del Digimon que acaba de actuar, con el resultado del golpe. */
export function outcomeBlock(state: BattleState): string | null {
  const ultimo = [...state.events].reverse().find((e) => e.kind === 'ataque' || e.kind === 'fallo');
  if (!ultimo) return null;

  if (ultimo.kind === 'fallo') {
    return (
      '```' +
      panel('FALLO', [`${ultimo.actor} usó ${ultimo.move}… y falló.`], 40) +
      '```'
    );
  }

  const d = ultimo.damage;
  const et = d.effectiveness ? EFECTIVIDAD[d.effectiveness] : null;

  const filas = [`${ultimo.actorEmoji} ${ultimo.actor} usó **${ultimo.move}**`];

  if (et) filas.push(`${et.emoji} **${et.texto}**`);
  filas.push('');
  filas.push(`Base            ${d.base}`);
  if (d.attribute !== 1) filas.push(`Atributo        ×${d.attribute.toFixed(2)}  (${signed(d.base * d.attribute - d.base)})`);
  if (d.element !== 1) filas.push(`Afinidad       ×${d.element.toFixed(2)}  (${signed(d.base * d.element - d.base)})`);
  if (d.stab !== 1) filas.push(`Propio (STAB)   ×${d.stab.toFixed(2)}`);
  if (d.critico) filas.push('Crítico         ×1.50');
  filas.push('');
  filas.push(`**TOTAL         ${d.final}**`);

  return '```' + panel(`${ultimo.target} recibe`, filas, 40) + '```';
}

function signed(value: number): string {
  const n = Math.round(value);
  return n >= 0 ? `+${n}` : `${n}`;
}

/** Los estados activos con su detalle, para el panel lateral. */
/**
 * Los estados activos, uno por línea, con su duración.
 *
 * Recorre la LISTA, no `fighter.status`. Un Digimon puede llevar a la vez
 * una quemadura y un +15% de Ataque, y con el enum de control solo se vería
 * uno de los dos: el jugador creería que el otro no está, y gastaría un
 * turno en un efecto que ya tiene puesto.
 *
 * La duración la pone el motor. Si aquí se contara "turnos que quedan"
 * con una regla propia, el panel podría decir 2 donde el combate dice 3.
 */
export function statusLines(fighter: Fighter): string[] {
  if (fighter.hp <= 0) return ['**CAÍDO**'];
  if (fighter.statuses.length === 0) return [];

  const lineas: string[] = [];

  for (const estado of fighter.statuses) {
    const info = STATUS_INFO[estado.kind];

    // El escudo se mide en PV y no en turnos: se consume y desaparece, así
    // que su "duración" es lo que le queda por absorber.
    if (estado.kind === 'escudo') {
      lineas.push(`${info.emoji} **${info.label}** · 🛡️ ${fighter.shield} PV`);
      continue;
    }

    const partes = [`${info.emoji} **${info.label}**`];

    if (estado.turns > 0) partes.push(`⏱️ ${estado.turns}`);

    // El modificador, en porcentaje. Sale del estado, no de `modifiers`:
    // `modifiers` es el total acumulado y no dice cuánto aportó cada efecto.
    if (info.stat && estado.magnitude > 0) {
      const signo = info.up ? '+' : '−';
      partes.push(`${signo}${Math.round(estado.magnitude * 100)}% ${textoDeStat(info.stat)}`);
    }

    lineas.push(partes.join(' · '))
  }

  return lineas;
}


export { ELEMENT_NAMES, ELEMENT_EMOJI };

/** Qué hace cada estado, para cuando el jugador pulsa sobre él. */

// ------------------------------------------------------------- equipos -----

/**
 * Los dos equipos en paralelo, con los caídos marcados.
 *
 * Un Digimon con 0 PV NO desaparece: se ve que está ahí y que cayó. Saber que
 * Gabumon sigue en pie es lo que hace que el jugador sepa si le conviene
 * cambiar o aguantar.
 */
export function teamsBlock(state: BattleState): string {
  const mio = [
    `${state.player.name} (activo)`,
    ...state.party
      .filter((_, i) => i !== state.activeIndex)
      .map((d) => `${d.nickname ?? d.species.name}`),
  ];

  const suyo = state.enemyTeam.map((f) => f.name);

  const lineas: string[] = [];
  const filas = Math.max(mio.length, suyo.length);

  for (let i = 0; i < filas; i++) {
    const a = state.party[i === 0 ? state.activeIndex : partyIndexOf(state, i)];
    const b = state.enemyTeam[state.enemyIndex + (i === 0 ? 0 : enemyOffset(state, i))];

    lineas.push(
      `${marca(a, a?.id === state.party[state.activeIndex]?.id)} ${(a?.nickname ?? a?.species.name ?? '—').padEnd(14)}` +
        '  ' +
        `${marca(b, i === 0)} ${(b?.name ?? '—').padEnd(14)}`,
    );
  }

  void mio;
  void suyo;
  return '```' + panel('TU EQUIPO              RIVAL', lineas, 42) + '```';
}

function marca(d: { hp: number } | undefined, activo: boolean): string {
  if (!d) return '  ';
  if (d.hp <= 0) return '🔴';
  return activo ? '⭐' : '🟢';
}

/** El Digimon del jugador que ocupa la fila `i` de la tabla de equipos. */
function partyIndexOf(state: BattleState, fila: number): number {
  let vistos = 0;
  for (let i = 0; i < state.party.length; i++) {
    if (i === state.activeIndex) continue;
    if (vistos === fila) return i;
    vistos++;
  }
  return state.activeIndex;
}

/** El equivalente del rival. */
function enemyOffset(state: BattleState, fila: number): number {
  let vistos = 0;
  for (let i = 0; i < state.enemyTeam.length; i++) {
    if (i === state.enemyIndex) continue;
    if (vistos === fila) return i;
    vistos++;
  }
  return 0;
}

// ------------------------------------------------------------- resultado ---

export function resultBlock(state: BattleState): EmbedBuilder {
  const s = state.stats;
  const gano = state.result === 'victoria';
  const empardo = state.result === 'huida';

  return new EmbedBuilder()
    .setColor(gano ? 0x38a169 : empardo ? 0x4a5568 : 0xe53e3e)
    .setAuthor({
      name: gano ? '🏆 VICTORIA' : empardo ? '🏃 ESCAPASTE' : '💀 DERROTA',
    })
    .setDescription(
      [
        `Turnos jugados: **${state.turn}**`,
        `Daño causado: **${s.dealt.toLocaleString('es')}**`,
        `Daño recibido: **${s.taken.toLocaleString('es')}**`,
        state.capturedSpeciesKey ? `Capturaste: **${state.capturedSpeciesKey}**` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
}

/** La ayuda del combate: qué hace el contraataque, si hay. */
export function hintBlock(state: BattleState): string | null {
  const hint = counterHint(state);
  if (hint) return `🛡️ ${hint}`;
  return null;
}

/** Ventaja de atributo entre los dos Digimon activos. */
export function matchupLine(state: BattleState): string {
  const m = attributeMatchups(state.player.attribute);
  const suyo = state.enemy.attribute;

  if (state.player.attribute === suyo) return 'Atributos iguales.';
  const fuerte = m.strong.includes(suyo);
  const debil = m.weak.includes(suyo);

  if (fuerte) return `🟢 Tu atributo vence al suyo.`;
  if (debil) return `🔴 Tu atributo pierde contra el suyo.`;
  return 'Atributos sin ventaja en ninguna dirección.';
}
