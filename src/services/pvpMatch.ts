import { EmbedBuilder } from 'discord.js';
import { attachRuntime, type BattleCore, buildWildFighter, createTrainerBattle, type BattleState 
} from '../game/combat.js';
import { fighterFromOwned } from '../game/combat.js';
import type { Fighter, OwnedDigimon } from '../game/types.js';
import { MAX_PVP_TEAM } from '../game/pvpConfig.js';
import { COLORS } from '../views/embeds.js';

/**
 * Partida PvP al mejor de N rondas.
 *
 * AISLAMIENTE: una partida PvP **nunca** escribe en la base de datos de los
 * Digimon. Todo vive aquí, en memoria. Al terminar solo se registra el
 * resultado (puntos e historial) en `pvpRepo`. Si alguien desconecta a mitad, el
 * resto de su equipo conserva intactos nivel, EXP, PV y objetos: no hay
 * commit de progreso que deshacer porque nunca se hizo.
 */

export interface PvpSide {
  trainerId: number;
  username: string;
  party: OwnedDigimon[];
  /** Índice del Digimon activo. */
  activeIndex: number;
  /** Victorias de ronda. */
  roundsWon: number;
  /** PV del activo al empezar esta ronda. */
  snapshotHp: Map<number, number>;
  /** Guardas si su activo cayó, para pedir cambio. */
  awaitingSwitch: boolean;
  disconnected: boolean;
  /** Si pidió abandonar. */
  forfeited: boolean;
}

export interface PvpRound {
  index: number;
  state: BattleState;
}

export interface PvpMatch {
  id: string;
  a: PvpSide;
  b: PvpSide;
  /** Rondas necesarias para ganar. */
  target: number;
  round: PvpRound | null;
  startedAt: number;
  finished: boolean;
  winnerId: number | null;
  /** 'jugado' | 'desconexion' | 'abandono' */
  reason: 'jugado' | 'desconexion' | 'abandono' | null;
  /** Multiplicador de poder del emparejamiento, para el resumen. */
  powerRatio: number;
  warning: string | null;
}

export function roundsNeeded(partySize: number): number {
  // A 2 se gana con una ronda; a 3, mejor de 2.
  return partySize <= 2 ? 1 : 2;
}

export function sideOf(match: PvpMatch, trainerId: number): PvpSide {
  return match.a.trainerId === trainerId ? match.a : match.b;
}

export function opponentOf(match: PvpMatch, trainerId: number): PvpSide {
  return match.a.trainerId === trainerId ? match.b : match.a;
}

/** Arranca la primera ronda (o la siguiente si `roundIndex` no es la primera). */
export function startRound(
  match: PvpMatch,
  roundIndex: number,
  activeA: number,
  activeB: number,
): PvpRound {
  // Cada ronda empieza con TODOS los Digimon a tope: si no, la segunda ronda
  // sería una continuación con la mitad del equipo sin vida.
  for (const side of [match.a, match.b]) {
    side.activeIndex = 0;
    side.awaitingSwitch = false;
  }

  const a = match.a.party[activeA] ?? match.a.party[0]!;
  const b = match.b.party[activeB] ?? match.b.party[0]!;

  // Cada bando es una lista de Fighters: al caerse uno, entra el siguiente.
  // El equipo entero se construye aquí, no con `createTrainerBattle`, que
  // asume un jugador contra un rival de especie.
  const party = match.a.party.slice(0, MAX_PVP_TEAM);
  const aIndex = Math.max(0, party.findIndex((p) => p.id === a.id));

  const enemyTeam: Fighter[] = match.b.party
    .slice(0, MAX_PVP_TEAM)
    .map((member) => {
      const fighter = fighterFromOwned(member, 'rival');
      fighter.uid = `rival-b-${member.id}`;
      return fighter;
    });

  // El Digimon activo del rival va el primero. Se ordena por filtro en vez de
  // con splice/unshift: si el índice no cuadra, `unshift(undefined)` colaba una
  // entrada basura en el equipo (y el rival aparecía con unDigimon de más).
  const ordered = [
    ...enemyTeam.filter((f) => f.uid === `rival-b-${b.id}`),
    ...enemyTeam.filter((f) => f.uid !== `rival-b-${b.id}`),
  ];

const core: BattleCore = {
    player: fighterFromOwned(a, 'jugador'),
    enemy: ordered[0]!,
    party,
    activeIndex: aIndex,
    enemyTeam: ordered,
    enemyIndex: 0,
    enemyTrainer: match.b.username,
    enemyIntro: null,
    isBoss: false,
    turn: 1,
    log: [
      `**Ronda ${roundIndex}** — ${a.species.emoji} ${a.nickname ?? a.species.name} contra ` +
        `${b.species.emoji} ${b.nickname ?? b.species.name}.`,
    ],
    // En PvP no hay objetos ni captura: sería una ventaja de recursos.
    items: [],
    finished: false,
    awaitingSwitch: false,
    result: null,
    capturedSpeciesKey: null,
    capsulesUsed: 0,
    rewardMultiplier: 1,
  };

  // El identificador lleva el número de ronda. Es lo que impide que un
  // botón de la ronda 1 (que sigue en un mensaje viejo) actúe sobre la 2:
  // el id no coincide y el enrutador lo rechaza.
  const state = attachRuntime(core, 'pvp', Date.now(), `pvp-${match.id}-${roundIndex}`);

  match.a.activeIndex = aIndex;
  match.a.awaitingSwitch = false;

  const round: PvpRound = { index: roundIndex, state };
  match.round = round;
  return round;
}

/**
 * Cierra la ronda y decide el estado de la partida.
 *
 * Devuelve `'ronda' | 'victoria-a' | 'victoria-b' | 'empate'`.
 */
export function closeRound(match: PvpMatch, result: 'victoria' | 'derrota' | 'empate'): string {
  if (result === 'victoria') match.a.roundsWon += 1;
  else if (result === 'derrota') match.b.roundsWon += 1;

  if (match.a.roundsWon >= match.target) {
    finishMatch(match, match.a.trainerId, 'jugado');
    return `victoria-${match.a.trainerId}`;
  }
  if (match.b.roundsWon >= match.target) {
    finishMatch(match, match.b.trainerId, 'jugado');
    return `victoria-${match.b.trainerId}`;
  }

  return 'ronda';
}

export function finishMatch(
  match: PvpMatch,
  winnerId: number | null,
  reason: 'jugado' | 'desconexion' | 'abandono',
): void {
  match.finished = true;
  match.winnerId = winnerId;
  match.reason = reason;
}

/**
 * Marca una desconexión. Perder por cortar es lo que hace que abandonar no
 * salga gratis: el rival cobra `POINTS.desconexion`, que es más que una
 * victoria normal.
 */
export function handleDisconnect(match: PvpMatch, trainerId: number): void {
  const side = sideOf(match, trainerId);
  const other = opponentOf(match, trainerId);

  side.disconnected = true;
  finishMatch(match, other.trainerId, 'desconexion');
}

export function handleForfeit(match: PvpMatch, trainerId: number): void {
  const side = sideOf(match, trainerId);
  const other = opponentOf(match, trainerId);

  side.forfeited = true;
  finishMatch(match, other.trainerId, 'abandono');
}

// --------------------------------------------------------------- embeds ----

export function pvpHeaderEmbed(match: PvpMatch, roundIndex: number): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(COLORS.legendary)
    .setTitle(`⚔️ PvP · Ronda ${roundIndex} de ${match.target}`)
    .setDescription(
      `**${match.a.username}** ${match.a.roundsWon} — ${match.b.roundsWon} **${match.b.username}**\n` +
        `Gana ${match.target} ronda(s).`,
    )
    .setFooter({
      text: `Desajuste de poder ×${match.powerRatio.toFixed(2)}` +
        (match.warning ? ' · aviso de desajuste' : ''),
    });

  for (const [side, tag] of [
    [match.a, 'A'],
    [match.b, 'B'],
  ] as const) {
    embed.addFields({
      name: `${side.username}${side.disconnected ? ' · desconectado' : ''}`,
      value: side.party
        .slice(0, MAX_PVP_TEAM)
        .map((d) => {
          const alive = side.snapshotHp.get(d.id) ?? d.stats.hp;
          const ko = alive <= 0;
          return `${ko ? '✖️' : side.party.indexOf(d) === side.activeIndex ? '▶️' : '　'} ` +
            `${d.species.emoji} ${d.nickname ?? d.species.name} \`${Math.max(0, alive)}\``;
        })
        .join('\n'),
    });
    void tag;
  }

  return embed;
}

export function pvpResultEmbed(
  match: PvpMatch,
  viewerId: number,
  points: { gained: number; total: number },
): EmbedBuilder {
  const won = match.winnerId === viewerId;
  const drew = match.winnerId === null;

  const title = drew ? '🤝 Empate' : won ? '🏆 ¡Victoria!' : '💀 Derrota';
  const reason =
    match.reason === 'desconexion'
      ? '\n*El rival se desconectó.*'
      : match.reason === 'abandono'
        ? '\n*El rival abandonó.*'
        : '';

  const opponent = opponentOf(match, viewerId);

  return new EmbedBuilder()
    .setColor(won ? COLORS.success : drew ? COLORS.neutral : COLORS.danger)
    .setTitle(title)
    .setDescription(
      `Contra **${opponent.username}** · ${match.a.roundsWon}-${match.b.roundsWon}` + reason,
    )
    .addFields({
      name: 'Puntos',
      value: `**+${points.gained}** · Total **${points.total}**`,
    })
    .setFooter({
      text:
        match.reason === 'desconexion'
          ? 'Abandonar da puntos extra al rival. Se puede notar.'
          : 'Tus Digimon no han cambiado: el PvP no toca tu progreso.',
    });
}

/** Reajusta la vida de los Digimon de un lado al empezar una ronda. */
export function healSideForRound(match: PvpMatch, side: PvpSide): void {
  for (const digimon of side.party) {
    side.snapshotHp.set(digimon.id, digimon.stats.hp);
  }
}

export { buildWildFighter, createTrainerBattle };
