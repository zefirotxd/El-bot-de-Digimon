import { analyzeMatchup, effectivenessText } from './elements.js';
import {
  COUNTER_REDUCTION,
  getBoss,
  nextPhaseAt,
  phaseAt,
  telegraphExposure,
  type BossDef,
} from './bosses.js';
import { MOVES, resolveMoves } from './moves.js';
import { getItem, STARTING_INVENTORY } from './items.js';
import { equippedGear } from './gearRepo.js';
import { gearEffects, gearExtras } from './equipment.js';
import { Rng } from './random.js';
import { getSpecies, movesForLevel } from './species.js';
import {
  computeStats,
  DAMAGE_SCALE,
  expToNextLevel,
  MAX_LEVEL,
  maxEnergyForLevel,
} from './stats.js';
import type {
  Action,
  Fighter,
  ItemUse,
  MoveDef,
  OwnedDigimon,
  SpeciesDef,
  StatKey,
  StatusEffect,
} from './types.js';
import {
  MAX_EVENTS,
  TURN_SECONDS,
  type BattleEvent,
  type BattleMode,
  type BattleStats,
  type BattleStatus,
  type TurnGuard,
} from './battleEvents.js';

// El catálogo de estados vive aparte porque lo consultan el motor, la IA, la
// interfaz y los tests. Si estuviera aquí dentro, los tres últimos
// importarían `combat.ts` y el motor tendría que importar a la IA para
// llamarla: un círculo. Así solo el motor lo importa, y hacia dentro.
import {
  STATUS_INFO,
  absorbirEscudo,
  applyStatus,
  bloqueo,
  clearStatus,
  enEspera,
  hasStatus,
  residualDamage,
  tickCooldowns,
  tickStatuses,
  type StatusKind,
} from './statuses.js';
import { recordInicial, sumarRecords } from './telemetry.js';
import { comboInicial, registrarAccion, tickCombo, type ComboState } from './combos.js';
import { totalesSinergia, type SynergyTotals } from './synergies.js';
import { decidir as decidirIA, type Personalidad } from './ai.js';
import type { CombatRecord } from './types.js';

export const MAX_LOG_LINES = 12;

export type BattleResultKind = 'victoria' | 'derrota' | 'huida';

export interface BattleCore {
  player: Fighter;
  enemy: Fighter;
  /** Roster del entrenador, para cambios en caliente. */
  party: OwnedDigimon[];
  /** Índice dentro de `party` del Digimon activo. */
  activeIndex: number;
  /** Resto del equipo rival. `enemy` apunta a `enemyTeam[enemyIndex]`. */
  enemyTeam: Fighter[];
  enemyIndex: number;
  /** Nombre del entrenador rival, si el combate es contra un NPC. */
  enemyTrainer: string | null;
  /** Frase de presentación. */
  enemyIntro: string | null;
  /** Un jefe no se puede esquivar con una huida normal. */
  isBoss: boolean;
  turn: number;
  log: string[];
  items: ItemUse[];
  finished: boolean;
  /** El jugador activo cayó y debe cambiar antes de continuar. */
  awaitingSwitch: boolean;
  result: BattleResultKind | null;
  capturedSpeciesKey: string | null;
  /** Cuántos intentos de captura lleva gastados. */
  capsulesUsed: number;
  /**
   * Multiplicador de recompensa (1 = salvaje normal, 3-6 = jefe).
   * Lo fija la plantilla del entrenador rival, no el motor.
   */
  rewardMultiplier: number;

  /** Qué tipo de combate es. Lo fija quien lo arranca, no el motor. */
  /** Estado explícito de la máquina de turnos. */
  /**
   * Registro estructurado. El `log` de texto se sigue llenando; esto es
   * lo que permite pintar "SUPER EFFECTIVE, base 38, +12, final 50".
   */
  /** Cifras agregadas para la pantalla de resultado. */
  /**
   * Guardián de turno. Es lo que impide que un doble clic juegue dos
   * turnos, y vive en el estado para que vale igual desde cualquier
   * entrada: botón, comando o collector antiguo.
   */
}

/**
 * Estado completo de un combate, con lo que la interfaz necesita.
 *
 * Nadie construye esto a mano: se llama a `attachRuntime` sobre un
 * `BattleCore`, que es lo que hacen las fábricas del motor y las del PvP.
 */
export interface BattleState extends BattleCore {
  /** Identificador único del combate. Va dentro de los `custom_id`. */
  id: string;
  /** Qué tipo de combate es. Lo fija quien lo arranca. */
  mode: BattleMode;
  /** Estado explícito de la máquina de turnos. */
  status: BattleStatus;
  /**
   * Registro estructurado.
   *
   * El `log` de texto se sigue llenando; esto es lo que permite pintar
   * "SUPER EFFECTIVE, base 38, +12, final 50" sin recalcular la fórmula.
   */
  events: BattleEvent[];
  /** Cifras agregadas para la pantalla de resultado. */
  stats: BattleStats;
  /**
   * Guardián de turno.
   *
   * Es lo que impide que un doble clic juegue dos turnos. Vive en el estado
   * y no en el handler de Discord para que valga igual desde un botón, un
   * comando o un collector antiguo.
   */
  turnGuard: TurnGuard;

  /** Segundos que tiene el jugador para actuar. */
  turnSeconds: number;

  /**
   * Estado de los combos.
   *
   * Vive en el combate y no en el jugador: una ventana abierta es de ESTA
   * pelea. Si sobreviviera al combate, el primer golpe del siguiente heredaría
   * la ventana del rival anterior, que es un bonus gratis.
   */
  combo: ComboState;

  /**
   * Sinergias del equipo que va a pelear.
   *
   * Se calcula al construir el combate, sobre el equipo REAL, y no cuando
   * el jugador monta la pantalla. Si se calculara más tarde, cambiar el orden
   * de la formación no cambiaría el bonus hasta la siguiente pelea, que es
   * justo la trampa de "la sinergia no funciona".
   */
  sinergias: SynergyTotals;

  /** Estilo de combate del rival. Lo fija quien arranca el combate. */
  /**
   * Historial de cada Digimon del equipo, indexado igual que `party`.
   *
   * Va en el combate y NO solo en el `Fighter` porque `fighterFromOwned`
   * construye un fighter NUEVO cada vez que alguien entra al campo, con su
   * cuenta a cero. Sin esto, un Agumon que sale al tercer turno, vuelve a
   * entrar y pega 200 de daño aparecería en el resumen final con los turnos
   * perdidos.
   *
   * Al cambiar se copia de `records[índice]` al fighter que entra, y de vuelta
   * al salir. Es lo único que evita que el cambio en caliente borre el
   * historial, y por eso el resumen puede enseñar a los tres Digimon.
   */
  records: CombatRecord[];

  personalidad: Personalidad;
}

// ------------------------------------------------------------- factories ---

/**
 * Construye un Fighter a partir de un Digimon guardado en la BD.
 *
 * `digimon.stats` ya viene con el equipo sumado (ver `effectiveStats`), asi que
 * aqui solo se recogen los efectos activos y los extras de critico y precision.
 *
 * El objeto devuelto es una COPIA: el combate nunca muta el `OwnedDigimon`.
 * Eso es lo que permite que una partida PvP terminada o abandonada no toque
 * el progreso permanente de nadie.
 */
export function fighterFromOwned(digimon: OwnedDigimon, side: 'jugador' | 'rival'): Fighter {
  const gear = equippedGear(digimon.id);
  const extras = gearExtras(gear);

  return {
    side,
    uid: `${side}-${digimon.id}`,
    name: digimon.nickname ?? digimon.species.name,
    emoji: digimon.species.emoji,
    speciesKey: digimon.species.key,
    attribute: digimon.species.attribute,
    level: digimon.level,
    stats: { ...digimon.stats },
    hp: digimon.stats.hp,
    energy: maxEnergyForLevel(digimon.level),
    moves: digimon.moves,
    status: digimon.status,
    statusTurns: 0,
    // Los estados con duración, el escudo y los cooldowns. `status` y
    // `statusTurns` son el resumen para el código antiguo; esto es lo que
    // lee el panel de efectos y lo que decide si puede actuar.
    statuses: [],
    shield: 0,
    cooldowns: {},
    // Lo que ha hecho en ESTE combate. La base del análisis final.
    record: recordInicial(),
    modifiers: {},
    isDefending: false,
    caught: false,
    gear: gearEffects(gear).map((g) => g.effect),
    gearCritRate: extras.critRate,
    gearAccuracy: extras.accuracy,
    boss: null,
  };
}

/**
 * Construye el Fighter de un jefe con su runtime de fases.
 *
 * El PV se multiplica con `hpScale`, pero el resto no se toca: las diferencias
 * vienen de las fases y del telegrafiado, no de inflar números. Un jefe con 3
 * veces más PV que uno normal es un jefe aburrido.
 */
export function buildBossFighter(boss: BossDef, side: 'jugador' | 'rival'): Fighter {
  const species = getSpecies(boss.speciesKey);
  if (!species) throw new Error(`jefe con especie inexistente: ${boss.speciesKey}`);

  const stats = computeStats(species.base, boss.level);
  stats.hp = Math.round(stats.hp * boss.hpScale);

  const fighter: Fighter = {
    side,
    uid: `boss-${boss.key}`,
    name: boss.name,
    emoji: boss.emoji,
    speciesKey: boss.speciesKey,
    attribute: boss.attribute,
    level: boss.level,
    stats,
    hp: stats.hp,
    energy: maxEnergyForLevel(boss.level) + 2,
    moves: resolveMoves(movesForLevel(species, boss.level + 20)),
    status: 'ok',
    statusTurns: 0,
    // Los estados con duración, el escudo y los cooldowns. `status` y
    // `statusTurns` son el resumen para el código antiguo; esto es lo que
    // lee el panel de efectos y lo que decide si puede actuar.
    statuses: [],
    shield: 0,
    cooldowns: {},
    // Lo que ha hecho en ESTE combate. La base del análisis final.
    record: recordInicial(),
    modifiers: {},
    isDefending: false,
    caught: false,
    gear: [],
    gearCritRate: 0,
    gearAccuracy: 0,
    boss: {
      key: boss.key,
      phaseIndex: 0,
      attribute: boss.attribute,
      // El primer aviso entra en `every` turnos, para que el jugador vea al
      // menos un turno limpio de apertura.
      nextTelegraphAt: (boss.telegraph?.every ?? 0) + 1,
      telegraph: null,
      damageTaken: 0,
    },
  };

  return fighter;
}

/** Construye un rival salvaje a partir de su especie y nivel. */
export function buildWildFighter(species: SpeciesDef, level: number): Fighter {
  const stats = computeStats(species.base, level);
  return {
    side: 'rival',
    uid: `rival-${species.key}-${level}`,
    name: species.name,
    emoji: species.emoji,
    speciesKey: species.key,
    attribute: species.attribute,
    level,
    stats,
    hp: stats.hp,
    energy: maxEnergyForLevel(level),
    moves: resolveMoves(movesForLevel(species, level)),
    status: 'ok',
    statusTurns: 0,
    // Los estados con duración, el escudo y los cooldowns. `status` y
    // `statusTurns` son el resumen para el código antiguo; esto es lo que
    // lee el panel de efectos y lo que decide si puede actuar.
    statuses: [],
    shield: 0,
    cooldowns: {},
    // Lo que ha hecho en ESTE combate. La base del análisis final.
    record: recordInicial(),
    modifiers: {},
    isDefending: false,
    caught: false,
    gear: [],
    gearCritRate: 0,
    gearAccuracy: 0,
    boss: null,
  };
}

export const MAX_CAPSULES = 3;

export const ITEM_KEYS = ['pocion', 'superpocion', 'elixir', 'repelente', 'capsula', 'tonico'];

/**
 * Prepara la bolsa de objetos de un combate a partir del inventario.
 *
 * Antes era una bolsa mágica fija (3 pociones, 1 superpoción, 1 repelente) que
 * se regeneraba sola en cada batalla, y comprar no servía para nada. Ahora
 * sale del inventario real: cada Poción que compras es un uso más en cada
 * combate futuro, y `perBattleCap` impide llevarte 20 Elixires.
 */
export function buildBattleItems(inventory: Record<string, number>): ItemUse[] {
  const bag: ItemUse[] = [];

  for (const key of ITEM_KEYS) {
    const def = getItem(key);
    if (!def) continue;

    const owned = inventory[key] ?? 0;
    // La captura se cuenta aparte: hay un máximo por combate (MAX_CAPSULES).
    const cap = key === 'capsula' ? MAX_CAPSULES : def.perBattleCap;
    const quantity = Math.min(owned, cap);
    if (quantity <= 0) continue;

    bag.push({ key, name: def.name, emoji: def.emoji, quantity });
  }

  return bag;
}

/** Cartucho inicial, por si se llama a createBattle sin inventario. */
export function defaultBattleItems(): ItemUse[] {
  return buildBattleItems(STARTING_INVENTORY);
}

export function createBattle(
  party: OwnedDigimon[],
  activeIndex: number,
  enemySpecies: SpeciesDef,
  enemyLevel: number,
  inventory: Record<string, number> = STARTING_INVENTORY,
): BattleState {
  return createTrainerBattle(party, activeIndex, {
    team: [{ species: enemySpecies, level: enemyLevel }],
    trainerName: null,
    intro: null,
    boss: false,
    inventory,
  });
}

export interface OpponentSpec {
  /** Digimon del rival, en orden. El primero es el que sale. */
  /**
   * Jefe del rival, si lo es.
   *
   * Va aparte de `team` porque un jefe NO es un Digimon normal: tiene fases,
   * telegrafiado y golpes propios, y `buildWildFighter` no sabe de nada de
   * eso. Antes se resolvia pasando `team: []` y parcheando `state.enemy`
   * despues, lo que dejaba un estado con el rival indefinido durante un
   * rato. Aqui se construye bien desde el principio.
   */
  bossDef?: BossDef | null;
  /** Estilo de combate del rival. Lo lee la IA. */
  personalidad?: Personalidad;
  team: { species: SpeciesDef; level: number }[];
  trainerName: string | null;
  intro: string | null;
  boss: boolean;
  inventory: Record<string, number>;
}

/**
 * Combate contra un entrenador rival con varios Digimon.
 *
 * La diferencia con `createBattle` no es solo la cantidad: el rival cambia en
 * caliente cuando el suyo cae, así que la partida se decide también en el
 * intercambio de Digimon.
 */
export function createTrainerBattle(
  party: OwnedDigimon[],
  activeIndex: number,
  opponent: OpponentSpec,
): BattleState {
  const enemyTeam = opponent.bossDef
    ? [buildBossFighter(opponent.bossDef, 'rival')]
    : opponent.team.map((member, index) => {
    const fighter = buildWildFighter(member.species, member.level);
    // uid único: dos miembros del equipo pueden ser la misma especie.
    fighter.uid = `rival-${index}-${member.species.key}-${member.level}`;
      return fighter;
    });

  // `enemy` DEBE ser la misma referencia que enemyTeam[enemyIndex], no una
  // copia: si son dos objetos, el daño recibido no se guarda y el cambio en
  // caliente del rival no funciona (era exactamente lo que pasaba antes).
  const enemy = enemyTeam[0]!;
  const player = fighterFromOwned(party[activeIndex]!, 'jugador');

  const intro =
    opponent.trainerName && opponent.intro
      ? `👤 **${opponent.trainerName}** te cierra el paso. _"${opponent.intro}"_`
      : `¡Apareció un ${enemy.emoji} **${enemy.name}** salvaje de nivel ${enemy.level}!`;

  const log = [intro, `Tú envías a ${player.emoji} **${player.name}**.`];
  if (enemyTeam.length > 1) {
    log.push(`⚔️ ${opponent.trainerName ?? 'El rival'} tiene **${enemyTeam.length}** Digimon en su equipo.`);
  }

  const state: BattleCore = {
    player,
    enemy,
    party,
    activeIndex,
    enemyTeam,
    enemyIndex: 0,
    enemyTrainer: opponent.trainerName,
    enemyIntro: opponent.intro,
    isBoss: opponent.boss,
    turn: 1,
    log,
    items: buildBattleItems(opponent.inventory),
    finished: false,
    awaitingSwitch: false,
    result: null,
    capturedSpeciesKey: null,
    capsulesUsed: 0,
    rewardMultiplier: 1,
  };

  const combate = attachRuntime(state, opponent.boss ? 'jefe' : 'entrenador');

  // Las sinergias se resuelven aqui, con el equipo que va a pelear de verdad.
  combate.sinergias = totalesSinergia(party);
  combate.personalidad = opponent.personalidad ?? 'equilibrado';

  return combate;
}

// ------------------------------------------------------------- statistics --

/** Valor de una estadística ya corregido por buffs/debuffs y defensa. */
export function effectiveStat(fighter: Fighter, stat: StatKey): number {
  const raw = fighter.stats[stat] * (fighter.modifiers[stat] ?? 1);
  const guarded = stat === 'defense' && fighter.isDefending ? raw * 2 : raw;
  return Math.max(1, Math.floor(guarded));
}

export function movePriority(fighter: Fighter, action: Action): number {
  if (action.type === 'movimiento') return action.move.priority;
  if (action.type === 'cambiar') return 6;
  return 0;
}

// ------------------------------------------------------------- turno ------

/**
 * Resuelve un turno completo: ambos bandos actúan segun prioridad y velocidad,
 * despues se aplican los residuos de estado y se regenera energia.
 *
 * Devuelve el estado resultante (el objeto se muta).
 */
/**
 * Registra un evento y actualiza las cifras del combate.
 *
 * Es la unica puerta de salida de eventos: quien juega emite, y la interfaz
 * solo pinta lo que llega. Nada se recalcula fuera del motor.
 */
export function emit(state: BattleState, event: BattleEvent): void {
  state.events.push(event);

  // El recorte es por el principio: un registro se lee desde el principio,
  // y perder los ultimos eventos (los que explican como acabaste) lo deja
  // inutil. MAX_EVENTS esta muy por encima de la duracion de un combate real.
  if (state.events.length > MAX_EVENTS) {
    state.events.splice(0, state.events.length - MAX_EVENTS);
  }

  // Las cifras van aqui, en el punto donde ocurre el dano. Recalcularlas al
  // final obligaria a recorrer el registro con la misma logica, que es la
  // forma segura de que las dos cosas se desincronicen.
  if (event.kind === 'ataque') {
    if (event.actor === state.player.name) state.stats.dealt += event.damage.final;
    if (event.target === state.player.name) state.stats.taken += event.damage.final;
  }

  if (event.kind === 'curacion' && event.target === state.player.name) {
    // La curacion no resta: solo evita que el "recibido" crezca por error.
  }

  if (event.kind === 'caida' && event.target === state.enemy.name && state.enemy.boss) {
    state.stats.bossDamage = Math.max(
      state.stats.bossDamage,
      state.enemy.boss.damageTaken,
    );
  }
}

/**
 * Prepara los campos de interfaz de un combate recien creado.
 *
 * Lo llama cada factoría. Es OBLIGATORIO: sin esto, el combate se juega
 * pero la interfaz no tiene identificador, ni reloj, ni registro.
 */
export function attachRuntime(
  core: BattleCore,
  mode: BattleMode,
  now = Date.now(),
  id?: string,
): BattleState {
  // Se construye un objeto NUEVO en lugar de mutar el núcleo.
  //
  // No es purismo: `createBattle` devuelve directamente el resultado de
  // `createTrainerBattle`, y si se mutara el núcleo los dos compartirían las
  // mismas propiedades de interfaz. Que un combate devuelva un objeto con su
  // runtime propio es lo que hace que dos peleas simultáneas no se pisen.
  const state: BattleState = {
    ...core,
    id: id ?? newBattleId(mode, now),
    mode,
    status: 'esperando',
    events: [],
    stats: { dealt: 0, taken: 0, turns: 0, bossDamage: 0 },
    turnGuard: { resolved: 0, startedAt: now, requests: 0 },
    turnSeconds: TURN_SECONDS,
    combo: comboInicial(),
    sinergias: { damage: 0, critRate: 0, attack: 0, defense: 0, speed: 0, hp: 0, lista: [] },
    // El historial se crea DESPUÉS del spread, para que `core.party` ya tenga la
    // longitud definitiva. Antes, un equipo de tres tendría un historial de uno y
    // el cambio en caliente escribiría fuera de rango.
    records: core.party.map(() => recordInicial()),
    personalidad: 'equilibrado',
  };

  // Se filtra: un combate se puede crear y luego parchear el rival (lo hacen
  // las mazmorras), y un `undefined` aqui reventaria treinta lineas mas abajo,
  // en un sitio donde nadie sospecharia la causa.
  for (const fighter of [state.player, state.enemy]) {
    if (fighter && fighter.statusTurns === undefined) fighter.statusTurns = 0;
  }

  return state;
}

export function resolveTurn(state: BattleState, playerAction: Action, rng: Rng): BattleState {
  if (state.finished || state.awaitingSwitch) return state;

  // El telegrafiado se resuelve al FINAL del turno, cuando su cuenta llega a
  // cero. Doing antes de resolver las acciones normales haría que el jugador
  // recibiera el telegrafiado antes de poder responderle en ese mismo turno, y
  // el aviso no serviría para nada.
  const telegraphResolved = tickBossTelegraph(state, rng);

  // La IA decide su acción ANTES de ordenar, para poder leer la prioridad.
  // Si este turno el jefe ya ha ejecutado su golpe telegrafiado, no ataca dos
  // veces: el telegrafiado sustituye al movimiento normal.
  const enemyAction = telegraphResolved
    ? { type: 'defender' as const }
    : chooseEnemyAction(state, rng);

  const order = buildOrder(state, playerAction, enemyAction, rng);

  for (const fighter of order) {
    if (state.finished) break;
    if (fighter.hp <= 0) continue;

    // El turno cuenta como activo ANTES de mirar si puede actuar: un Digimon
    // bloqueado estuvo en la pelea igual. Si no se contara, el análisis
    // diría que uno que durmió tres turnos estuvo uno, y el "turnos activos"
    // no serviría para nada.
    fighter.record.turnsActive += 1;

    const block = statusBlock(fighter, rng);
    if (block) {
      push(state, block);
      fighter.record.turnsBlocked += 1;
      continue;
    }

    const action = fighter.side === 'jugador' ? playerAction : enemyAction;
    applyAction(state, fighter, action, rng);

    if (state.finished) break;
  }

  // El orden de estas tres líneas importa y está escogido:
  //
  // 1. Caducan los estados, y al caducar deshacen sus modificadores.
  // 2. Después el daño continuo, sobre un Digimon ya sin buffs.
  //
  // Al revés, alguien con "Defensa ↑" aguantaría un tick más de quemadura del
  // que debería, y vería un número que no cuadra con nada.
  if (!state.finished) {
    tickStatusTimers(state);
    applyResiduals(state);
  }

  // Los cooldowns bajan para los DOS bandos, no solo para el jugador: si bajaran
  // solo para el rival, su kit parecería más amplio de lo que es.
  for (const fighter of [state.player, state.enemy]) {
    tickCooldowns(fighter);
  }

  // La ventana de combo caduca. Que se pueda perder es a propósito: si no, el
  // combo sería la estrategia obligatoria y el resto del kit dejaría de importar.
  tickCombo(state.combo);

  regenEnergy(state);
  bossRegen(state);
  state.turn += 1;
  checkEnd(state);
  return state;
}

/**
 * Recarga de energía: +1 por turno hasta el máximo del nivel.
 *
 * Sin esto la energía solo baja y, gastada una vez, el Digimon se queda
 * sin poder usar nada que cueste energía para el resto del combate: los
 * combates se eternizaban.
 */
function regenEnergy(state: BattleState): void {
  for (const fighter of [state.player, state.enemy]) {
    if (fighter.hp <= 0) continue;
    const max = maxEnergyForLevel(fighter.level);
    if (fighter.energy < max) fighter.energy += 1;
  }
}

function buildOrder(
  state: BattleState,
  playerAction: Action,
  enemyAction: Action,
  rng: Rng,
): Fighter[] {
  const { player, enemy } = state;
  const playerPriority = movePriority(player, playerAction);
  const enemyPriority = movePriority(enemy, enemyAction);

  if (playerPriority !== enemyPriority) {
    return playerPriority > enemyPriority ? [player, enemy] : [enemy, player];
  }

  const playerSpeed = effectiveStat(player, 'speed');
  const enemySpeed = effectiveStat(enemy, 'speed');
  if (playerSpeed === enemySpeed) return rng.chance(0.5) ? [player, enemy] : [enemy, player];
  return playerSpeed > enemySpeed ? [player, enemy] : [enemy, player];
}

/** Devuelve un texto si el fighter no puede actuar este turno. */
function statusBlock(fighter: Fighter, rng: Rng): string | null {
  // `rng.chance` se pasa como función y no se usa dentro: una comprobación no
  // debe gastar azar. Si esta función sorteara por su cuenta, mirar la misma
  // pantalla dos veces podría decir "no puede actuar" una vez y "puede actuar" la
  // siguiente, y el jugador vería un botón que a veces se activaba sin
  // explicación.
  const estado = bloqueo(fighter, (p) => rng.chance(p));
  if (!estado) return null;

  switch (estado) {
    case 'dormir':
      return `${fighter.emoji} ${fighter.name} duerme profundamente...`;
    case 'congelado':
      return `${fighter.emoji} ${fighter.name} está congelado y no se mueve.`;
    case 'aturdir':
      return `💫 ${fighter.name} está aturdido y no puede actuar.`;
    case 'paralisis':
      return `⚡ ${fighter.name} está paralizado y no puede moverse.`;
    default:
      return `${fighter.emoji} ${fighter.name} no puede actuar.`;
  }
}

/** Quemadura y veneno al final del turno. */
/**
 * Daño continuo y caducidad de estados, al cerrar el turno.
 *
 * El orden está escogido a propósito y por eso son DOS funciones: primero
 * caducan los estados (y al caducar deshacen sus modificadores), después se
 * aplica el daño continuo.
 *
 * Al revés, un Digimon con "Defensa ↑" aguantaría un turno más de quemadura
 * del que debería, y el jugador vería un número que no cuadra con nada.
 */
function applyResiduals(state: BattleState): void {
  for (const fighter of [state.player, state.enemy]) {
    if (fighter.hp <= 0) continue;

    const residual = residualDamage(fighter);
    if (!residual) continue;

    const info = STATUS_INFO[residual.kind];
    fighter.hp = Math.max(0, fighter.hp - residual.amount);

    push(state, `${fighter.emoji} ${fighter.name} sufre **${residual.amount}** PV por ${info.label.toLowerCase()}.`);
    emit(state, {
      kind: 'estado',
      target: fighter.name,
      targetEmoji: fighter.emoji,
      status: fighter.status,
      statusKind: residual.kind,
      turns: 0,
      magnitude: residual.amount,
      text: `${info.label}: -${residual.amount} PV`,
    });

    if (fighter.hp <= 0) {
      emit(state, { kind: 'caida', target: fighter.name, targetEmoji: fighter.emoji });
    }
  }
}

/**
 * Caduca los estados que se quedan sin turnos.
 *
 * Va JUSTO ANTES de `applyResiduals` y no dentro. Al anidarla se quedaba
 * definida pero sin ejecutarse nunca, y el contador de turnos de sueño,
 * congelado y parálisis no bajaba jamás: un Digimon dormido seguía dormido
 * hasta que le ganaban la pelea entera.
 */
function tickStatusTimers(state: BattleState): void {
  for (const fighter of [state.player, state.enemy]) {
    if (fighter.hp <= 0) continue;

    tickStatuses(fighter, (kind) => {
      const info = STATUS_INFO[kind];
      push(state, `${fighter.emoji} ${fighter.name} se libró de ${info.label.toLowerCase()}.`);
      emit(state, {
        kind: 'mensaje',
        text: `${info.emoji} ${fighter.name}: ${info.label} expiró.`,
      });
    });
  }
}

function checkEnd(state: BattleState): void {
  if (state.finished) return;

  // Las fases se comprueban ANTES que el final: un jefe que muere al caer de
  // fase debe entrar en ella igual, para que el cambio de atributo sea visible
  // en el log aunque el golpe fuera el último.
  advanceBossPhase(state);

  if (state.enemy.hp <= 0) {
    // El rival puede tener más Digimon: entra el siguiente en vez de terminar.
    const nextIndex = state.enemyTeam.findIndex(
      (f, i) => i > state.enemyIndex && f.hp > 0,
    );

    if (nextIndex !== -1) {
      state.enemyIndex = nextIndex;
      state.enemy = state.enemyTeam[nextIndex]!;
      push(
        state,
        `${state.enemy.emoji} **${state.enemy.name}** entra en el campo por ${state.enemyTrainer ?? 'el rival'}!`,
      );
      return;
    }

    state.finished = true;
    state.result = 'victoria';
    return;
  }

  if (state.player.hp <= 0) {
    push(state, `¡${state.player.emoji} ${state.player.name} ha caído!`);
    markFainted(state, state.activeIndex);

    // Solo cuenta como reserva un Digimon que siga en pie: si no, el jugador
    // se queda en un bucle de "cambia" hacia un Digimon ya derrotado.
    if (switchCandidates(state).length > 0) {
      state.awaitingSwitch = true;
    } else {
      state.finished = true;
      state.result = 'derrota';
    }
  }
}

// ------------------------------------------------- mecánicas de jefe -------

/**
/**
 * Cambia la fase del jefe y deja el runtime coherente.
 *
 * Existe como funcion, y no como asignaciones sueltas, por un motivo concreto:
 * el atributo vigente vive en el runtime, asi que cambiar `phaseIndex` sin
 * actualizarlo dejaba al jefe con el atributo de una fase y el resto de datos
 * de otra. A traves de aqui ese estado es imposible de representar.
 */
export function setBossPhase(fighter: Fighter, index: number): void {
  const runtime = fighter.boss;
  if (!runtime) return;

  const def = getBoss(runtime.key);
  const phase = def?.phases[index];
  if (!def || !phase) return;

  runtime.phaseIndex = index;
  // Una fase sin atributo propio mantiene el anterior a proposito.
  runtime.attribute = phase.attribute ?? runtime.attribute;
}

/**
 * Avanza la fase del jefe si ha cruzado su umbral.
 *
 * Solo puede avanzar, nunca retroceder: si el jugador le cura al jefe con
 * drenaje, no vuelve a la fase anterior. Retroceder invitaría a "subirlo y
 * bajarlo" para farmear el cambio de atributo.
 */
function advanceBossPhase(state: BattleState): void {
  const fighter = state.enemy;
  if (!fighter.boss) return;

  const def = getBoss(fighter.boss.key);
  if (!def) return;

  const ratio = fighter.hp / fighter.stats.hp;
  const target = nextPhaseAt(def, ratio);

  // Solo avanza. Si el jugador le cura con drenaje, o sube el PV con un objeto,
  // no vuelve a la fase anterior: retroceder invitaría a subirlo y bajarlo
  // para farmear el cambio de atributo.
  if (target === null || target <= fighter.boss.phaseIndex) return;

  const skipped = target - fighter.boss.phaseIndex - 1;
  setBossPhase(fighter, target);
  const phase = def.phases[target]!;

  push(state, `⚡ **${fighter.name} cambia de fase: ${phase.name}!**`);
  push(state, phase.announce);

  // Si un golpe lo saltó varias fases de golpe, se dice: si no, el jugador ve
  // "Cambia de fase" sin idea de qué se ha saltado.
  if (skipped > 0) {
    push(state, `💥 Ese golpe le ha atravesado **${skipped + 1}** fases de golpe.`);
  }

  // El cambio se dice en voz alta porque es información que el jugador necesita
  // para decidir. Si el jefe se vuelve inmune a luz y no lo lees, te llevas un
  // turno entero a cero sin entender por qué.
  if (phase.attribute && phase.attribute !== fighter.boss.attribute) {
    fighter.boss.attribute = phase.attribute;
    push(state, `🔄 Su atributo pasa a **${phase.attribute}**.`);
  }
  if (phase.immuneTo) {
    push(state, `🛡️ Ahora es **inmune a ${phase.immuneTo.join(', ')}**.`);
  }
  if (phase.weakTo && phase.weakTo.length > 0) {
    push(state, `🎯 Sus debilidades ahora: ${phase.weakTo.join(', ')}.`);
  }
}

/** Curación por turno de la fase activa del jefe. */
function bossRegen(state: BattleState): void {
  const fighter = state.enemy;
  if (!fighter.boss) return;

  const def = getBoss(fighter.boss.key);
  const phase = def?.phases[fighter.boss.phaseIndex];
  if (!phase?.regen) return;

  const healed = Math.round(fighter.stats.hp * phase.regen);
  if (healed <= 0 || fighter.hp <= 0) return;

  fighter.hp = Math.min(fighter.stats.hp, fighter.hp + healed);
  push(state, `♻️ ${fighter.name} recupera **${healed}** PV en esta fase.`);
}

/** Daño estimado del telegrafiado, para que el jugador sepa qué stake tiene. */
function estimateTelegraph(
  state: BattleState,
  fighter: Fighter,
  power: number,
  move: MoveDef,
): number {
  const target = state.player;
  const matchup = analyzeMatchup(
    { attribute: fighter.attribute, species: effectiveSpecies(fighter) },
    move.element,
    { attribute: target.attribute, species: effectiveSpecies(target) },
  );

  const base = baseDamage(fighter, target, move);

  return Math.max(1, Math.round(base * DAMAGE_SCALE * matchup.total));
}

/**
 * Anuncia o resuelve un ataque telegrafiado.
 *
 * Se llama una vez por turno del jefe. Un telegrafiado sin respuesta cuesta
 * mucho; con respuesta, mucho menos.
 *
 * Devuelve `true` si este turno el jefe ha ejecutado el golpe telegrafiado, para
 * que la IA no elija además un movimiento normal.
 */
export function tickBossTelegraph(state: BattleState, rng: Rng): boolean {
  const fighter = state.enemy;
  if (!fighter.boss) return false;

  const def = getBoss(fighter.boss.key);
  const spec = def?.telegraph;
  if (!def || !spec) return false;

  // Ya había uno en curso: cuenta atrás.
  if (fighter.boss.telegraph) {
    fighter.boss.telegraph.turnsLeft -= 1;
    if (fighter.boss.telegraph.turnsLeft <= 0) {
      resolveTelegraph(state, fighter, def, spec, rng);
      return true;
    }
    return false;
  }

  // No tocaba todavía.
  if (state.turn < fighter.boss.nextTelegraphAt) return false;

  const move = MOVES[spec.moveKey];
  if (!move) return false;

  // El telegrafiado NO cuesta energía: sustituye el turno normal del jefe.
  // Antes se cobraba como un movimiento más y el jefe se quedaba sin nunca
  // llegar al aviso, porque gastaba todo en moves normales. Una mecánica
  // firmada que puede no ocurrir nunca no es una mecánica.
  //
  // Y se autorregula en daño: el jefe pega un telegrafiado fuerte en vez de
  // un movimiento normal, no las dos cosas.

  fighter.boss.telegraph = {
    moveKey: spec.moveKey,
    name: move.name,
    element: move.element,
    turnsLeft: spec.lead,
    lead: spec.lead,
    estimate: estimateTelegraph(state, fighter, spec.power, move),
    counter: spec.counter,
    hint: spec.hint,
    // Solo la respuesta ACTIVA. La exposicion elemental se recalcula al caer
    // el golpe, contra el Digimon que este en pie entonces.
    mitigated: 0,
  };

  fighter.boss.nextTelegraphAt = state.turn + spec.every;

  // Si el Digimon que tiene puesto ya aguanta (o no aguanta) el elemento, se
  // lo decimos: cambiar de Digimon deja de ser la respuesta obvia.
  const held = effectiveSpecies(state.player);
  const exposureNote = held.resists.includes(move.element)
    ? ` Tu activo resiste ${move.element}.`
    : held.weakTo.includes(move.element)
      ? ` Tu activo es muy debil a ${move.element}. Cambialo antes de que caiga.`
      : ``;

  push(
    state,
    `⚠️ **${fighter.name} prepara ${move.name}** — cae en **${spec.lead}** turno(s). ${spec.hint}${exposureNote}`,
  );
  return false;
}

/** Resuelve el golpe telegrafiado ya anunciado. */
function resolveTelegraph(
  state: BattleState,
  fighter: Fighter,
  def: BossDef,
  spec: NonNullable<BossDef['telegraph']>,
  rng: Rng,
): void {
  const telegraph = fighter.boss!.telegraph!;
  fighter.boss!.telegraph = null;

  const move = MOVES[telegraph.moveKey]!;
  const target = state.player;

  if (rng.next() > move.accuracy) {
    push(state, `${fighter.emoji} ${move.name} falla y se pierde entre el terreno.`);
    return;
  }

  // La exposicion se lee AHORA, no al anunciar: cuenta el Digimon que esta en
  // pie cuando cae el golpe.
  const playerSpecies = effectiveSpecies(target);
  const exposure = telegraphExposure(playerSpecies.resists, playerSpecies.weakTo, move.element);

  // Lo mejor de las dos cosas: lo que el jugador respondio activamente y lo que
  // su Digimon ya aguanta por resistencias.
  const reduction = Math.min(0.95, Math.max(0, Math.max(telegraph.mitigated, 1 - exposure)));

  // Una fase con daño amplificado también amplifica el telegrafiado: si no,
  // la última fase sería el momento exacto de dejar de defenderse.
  const phase = def.phases[fighter.boss!.phaseIndex];
  const damage = Math.max(
    1,
    Math.round(telegraph.estimate * (1 - reduction) * (phase?.damageTaken ?? 1)),
  );

  target.hp = Math.max(0, target.hp - damage);

  const wording =
    reduction >= 0.55
      ? '**lo esquivas**'
      : reduction >= 0.3
        ? '**lo amortigua**'
        : 'te alcanza de lleno';

  push(
    state,
    `${fighter.emoji} **${move.name}** cae sobre ${target.emoji} ${target.name}: ` +
      `${wording}, **${damage}** PV` +
      `${reduction > 0 ? ` (reducido un ${Math.round(reduction * 100)}%)` : ''}.`,
  );

  // Contribución: el telegrafiado también cuenta como daño al jefe, pero no
  // suma a `damageTaken` porque no se lo ha hecho el jugador.
  if (target.hp === 0) {
    push(state, `¡${target.emoji} ${target.name} ha caído por ${move.name}!`);
  }

  void spec;
}

/**
 * Registra la respuesta del jugador a un telegrafiado vivo.
 *
 * Devuelve `true` si la respuesta ha servido para algo. Se llama desde
 * `applyAction` cuando el jugador defiende, se cura o cambia de Digimon.
 *
 * Cada respuesta solo cuenta una vez: si el jugador ya tiene un Digimon que
 * resiste el elemento, la exposición ya está recortando y no hay doble premio
 * por defender.
 */
export function registerCounter(
  state: BattleState,
  kind: 'defender' | 'curar' | 'cambiar',
): boolean {
  const telegraph = state.enemy.boss?.telegraph;
  if (!telegraph) return false;

  const offered = COUNTER_REDUCTION[kind];
  if (offered <= telegraph.mitigated) return false;

  telegraph.mitigated = offered;
  push(state, `🛡️ Respondes a ${telegraph.name}: el golpe se recorta un ${Math.round(offered * 100)}%.`);
  return true;
}

/** Si el jugador tiene una respuesta mejor disponible cambiando de Digimon. */
export function counterHint(state: BattleState): string | null {
  const telegraph = state.enemy.boss?.telegraph;
  if (!telegraph) return null;

  const wanted = telegraph.counter;
  const offered = COUNTER_REDUCTION[wanted];

  if (wanted === 'elemento') {
    const reserve = switchCandidates(state).find((d) =>
      d.species.resists.includes(telegraph.element) && d.species.immuneTo?.includes(telegraph.element),
    );
    if (reserve) {
      return `${reserve.species.emoji} **${reserve.nickname ?? reserve.species.name}** es inmune a ${telegraph.element}.`;
    }
    const resist = switchCandidates(state).find((d) => d.species.resists.includes(telegraph.element));
    if (resist && telegraph.mitigated < 0.6) {
      return `${resist.species.emoji} **${resist.nickname ?? resist.species.name}** resiste ${telegraph.element}.`;
    }
  }

  if (telegraph.mitigated >= offered) return null;

  switch (wanted) {
    case 'defender':
      return 'Pulsa **Defender** para recortar el golpe un 60%.';
    case 'curar':
      return 'Usa un **objeto de curación**: recorta el golpe y repone.';
    case 'cambiar':
      return '**Cambia de Digimon**: el nuevo entra con la vida llena.';
    default:
      return null;
  }
}

// -------------------------------------------------------------- acciones --

function applyAction(state: BattleState, actor: Fighter, action: Action, rng: Rng): void {
  actor.isDefending = action.type === 'defender';

  // Respuesta al telegrafiado del jefe. Solo cuenta la del JUGADOR: que el
  // jefe se defienda no le protege de su propio golpe anunciado.
  if (actor.side === 'jugador' && state.enemy.boss?.telegraph) {
    if (action.type === 'defender') registerCounter(state, 'defender');
    else if (action.type === 'objeto') registerCounter(state, 'curar');
    else if (action.type === 'cambiar') registerCounter(state, 'cambiar');
  }

  switch (action.type) {
    case 'movimiento':
      useMove(state, actor, action.move, rng);
      break;
    case 'defender':
      push(state, `${actor.emoji} ${actor.name} adopta una postura defensiva.`);
      break;
    case 'objeto':
      useItem(state, actor, action.item, rng);
      break;
    case 'cambiar':
      push(state, `${actor.emoji} ${actor.name} vuelve a la mochila.`);
      break;
    case 'capturar':
      tryCapture(state, rng);
      break;
    case 'huir':
      if (action.success) {
        push(state, `${actor.emoji} ${actor.name} se retira a la zona segura.`);
        state.finished = true;
        state.result = 'huida';
      } else {
        push(state, '¡No has podido escapar!');
      }
      break;
  }
}

/**
 * Daño bruto de un golpe, antes de ningún multiplicador.
 *
 * Vive suelta porque la usan DOS cosas: el golpe de verdad y la vista previa
 * que muestra la pantalla de habilidades. Copiarla en el preview habría sido
 * dos reglas de la misma cosa, y en cuanto una se tocara la pantalla
 * mentiría sin que nada fallara.
 */
function baseDamage(actor: Fighter, target: Fighter, move: MoveDef): number {
  return Math.floor(
    (((2 * actor.level) / 5 + 2) *
      move.power *
      effectiveStat(actor, 'attack')) /
      effectiveStat(target, 'defense') /
      8 +
      2,
  );
}

/**
 * Daño esperado de un movimiento contra un objetivo concreto.
 *
 * Devuelve un RANGO, no una cifra: el golpe real tira dados (variación del
 * turno y crítico), y prometer un número exacto sería mentir. Se promedia
 * usando la misma función del golpe real, así que el centro del rango es
 * de verdad lo que suele salir.
 */
export function previewDamage(
  state: BattleState,
  move: MoveDef,
  target?: Fighter,
): { min: number; expected: number; max: number; effectiveness: ReturnType<typeof efectoDe> } {
  const enemy = target ?? (state.player.side === 'jugador' ? state.enemy : state.player);
  const actor = state.player;

  const matchup = analyzeMatchup(
    { attribute: actor.attribute, species: speciesOf(actor) },
    move.element,
    { attribute: enemy.attribute, species: speciesOf(enemy) },
  );

  const base = baseDamage(actor, enemy, move);
  const medio = Math.max(
    1,
    Math.round(base * DAMAGE_SCALE * matchup.total * 0.95),
  );

  // El máximo es con crítico y la mejor tirada; el mínimo, sin él y con la
  // peor. No son los extremos reales (el equipo los modifica), sino lo que
  // el jugador puede esperar de este movimiento contra ESTE rival.
  return {
    min: Math.max(1, Math.round(medio * 0.9)),
    expected: medio,
    max: Math.round(medio * 1.5),
    effectiveness: efectoDe(matchup.total),
  };
}

function useMove(state: BattleState, actor: Fighter, move: MoveDef, rng: Rng): void {
  actor.energy = Math.max(0, actor.energy - move.energyCost);

  // El cooldown arranca AQUÍ, no al final del turno: un movimiento con espera 2
  // usado en el turno 3 vuelve a estar libre en el 5, que es lo que el jugador
  // cuenta en la cabeza. Si arrancara al cerrar el turno, parecería que tarda
  // un turno más de lo que dice la pantalla.
  if (move.cooldown > 0) {
    actor.cooldowns[move.key] = move.cooldown;
  }
  const target = opponentOf(state, actor);

  if (rng.next() > move.accuracy) {
    emit(state, { kind: 'fallo', actor: actor.name, move: move.name });
    push(state, `${actor.emoji} ${actor.name} falló ${move.name}...`);

    actor.record.missed += 1;
    return;
  }

  if (move.category === 'estado' || move.power === 0) {
    push(state, `${actor.emoji} ${actor.name} usó ${move.name}.`);
    if (move.effect) applyEffect(state, actor, target, move.effect, rng);
    return;
  }

  const crit = rng.next() < move.critRate;

  // Las dos capas del sistema de Time Stranger se multiplican entre si:
  // atributo (triangulo Vacuna/Virus/Datos) x afinidad elemental del rival x STAB.
  const matchup = analyzeMatchup(
    { attribute: actor.attribute, species: speciesOf(actor) },
    move.element,
    { attribute: target.attribute, species: speciesOf(target) },
  );
  const roll = 0.9 + rng.next() * 0.1;

  const base = baseDamage(actor, target, move);

  // Equipo: primera sangre multiplica el golpe mientras el rival este sano.
  let damage = Math.max(
    1,
    Math.floor(base * DAMAGE_SCALE * matchup.total * roll * (crit ? 1.5 : 1)),
  );

  for (const effect of actor.gear) {
    if (effect.kind !== 'primera_sangre') continue;
    // Solo cuenta como "sano" por encima del 60% de PV.
    if (target.hp / target.stats.hp <= 0.6) break;
    damage = Math.round(damage * effect.ratio);
    push(state, `${actor.emoji} La **primera sangre** de ${actor.name} golpea más fuerte.`);
    break;
  }

  // Equipo: escudo del objetivo, solo durante los primeros turnos.
  if (state.turn <= 3) {
    for (const effect of target.gear) {
      if (effect.kind !== 'escudo') continue;
      damage = Math.max(1, Math.round(damage * (1 - effect.ratio)));
      push(state, `🛡️ El escudo de **${target.name}** absorbe parte del golpe.`);
      break;
    }
  }

const combo = registrarAccion(state.combo, move.key);

  // Sinergias y combo entran ANTES de multiplicar, no después. Multiplicar al
  // final daría un redondeo distinto según el orden, y el jugador vería dos
  // números para el mismo golpe según si pegó o no pegó.
  const synergyDamage = 1 + state.sinergias.damage;

  if (combo) {
    push(state, `${combo.emoji} **¡COMBO ${combo.name}!** +${Math.round(combo.bonus * 100)}% daño`);
    emit(state, {
      kind: 'combo',
      nombre: combo.name,
      emoji: combo.emoji,
      bonus: combo.bonus,
      actor: actor.name,
    });
  }

  damage = Math.max(1, Math.round(damage * synergyDamage * (1 + (combo?.bonus ?? 0))));

  const hpAntes = target.hp;

  // El escudo se gasta ANTES de tocar los PV, y el resto del golpe sigue
  // pasando. Un escudo que anulara el golpe entero no lo usaría nadie: es lo
  // mismo que no tenerlo.
  const absorcion = target.shield > 0 ? absorbirEscudo(target, damage) : null;
  const absorbido = absorcion?.absorbido ?? 0;
  const damageReal = absorcion ? absorcion.pasa : damage;

  target.hp = Math.max(0, target.hp - damageReal);

  if (absorbido > 0) {
    push(state, `🛡️ El escudo de **${target.name}** absorbe **${absorbido}** PV (${damage - damageReal} pasan).`);
  }

  // El desglose se registra AQUÍ, con las variables que ya se han aplicado. No se
  // recalcula: la interfaz pinta estos mismos números, así que un cambio en la
  // fórmula se refleja sin tocar la UI.
  emit(state, {
    kind: 'ataque',
    actor: actor.name,
    actorEmoji: actor.emoji,
    move: move.name,
    element: move.element,
    target: target.name,
    damage: {
      base,
      attribute: matchup.attribute,
      element: matchup.element,
      stab: matchup.stab,
      scale: DAMAGE_SCALE,
      roll,
      crit: crit ? 1.5 : 1,
      final: damage,
      targetHpBefore: hpAntes,
      targetHpAfter: Math.max(0, hpAntes - damageReal),
      effectiveness: efectoDe(matchup.total),
      critico: crit,
    },
    combo: combo ? { name: combo.name, emoji: combo.emoji, bonus: combo.bonus } : null,
    escudo: absorbido > 0 ? absorbido : null,
  });

  // La telemetría se anota DESPUÉS de absorber el escudo y con el daño real.
  // Si se anotara el bruto, el análisis diría que este Digimon hizo 120 cuando
  // de hecho entraron 80: el escudo es una bonificación del RIVAL y no cuenta
  // como daño hecho.
  actor.record.skills += 1;
  actor.record.landed += 1;
  actor.record.dealt += damageReal;
  target.record.taken += damageReal;
  if (crit) actor.record.crits += 1;
  if (efectoDe(matchup.total) === 'supereficaz') actor.record.effective += 1;
  if (combo) actor.record.combos += 1;
  if (absorbido > 0) target.record.shielded += absorbido;

  // Contribución al jefe: se lleva la cuenta de cuánto PV le has quitado tú.
  if (target.boss) target.boss.damageTaken += damageReal;

  const notes: string[] = [];
  const note = effectivenessText(matchup.total);
  if (note) notes.push(note);
  if (matchup.attribute > 1) notes.push('ventaja de atributo');
  else if (matchup.attribute < 1) notes.push('desventaja de atributo');
  if (matchup.stab > 1) notes.push('STAB');

  let line = `${actor.emoji} ${actor.name} usó ${move.name}: **${damageReal}** PV`;
  if (notes.length > 0) line += ` (${notes.join(', ')})`;
  if (crit) line += ' ¡**CRÍTICO**!';
  push(state, line);

  // Equipo: contraataque tras absorber el golpe.
  applyCounterattack(state, target, actor, damageReal, rng);

  // Drenaje: tanto por el movimiento "Drenaje de Datos" como por el equipo con
  // el efecto `drenar` (Garra Omega). Se queda con el mayor de los dos, y drena
  // sobre el daño REAL: si el escudo paró la mitad, no hay de dónde drainar.
  const drainRatio = bestDrainRatio(actor, move);
  if (drainRatio > 0 && actor.hp < actor.stats.hp && damageReal > 0) {
    const healed = Math.max(1, Math.floor(damageReal * drainRatio));
    const actual = Math.min(healed, actor.stats.hp - actor.hp);
    actor.hp += actual;
    push(state, `${actor.emoji} ${actor.name} drenó **${actual}** PV.`);
    emit(state, { kind: 'curacion', target: actor.name, amount: actual, origen: move.name });

    actor.record.healed += actual;
  }

  if (target.hp === 0) {
    push(state, `¡${target.emoji} ${target.name} cae derrotado!`);
    emit(state, { kind: 'caida', target: target.name, targetEmoji: target.emoji });
    return;
  }

  if (move.effect && rng.next() < move.effect.chance) {
    applyEffect(state, actor, target, move.effect, rng);
  }
}

/**
 * Aplica un efecto secundario.
 *
 * Todo pasa por el catálogo de `statuses.ts`. Antes esta función multiplicaba
 * directamente sobre `modifiers` sin guardar el valor anterior, y los buffs no
 * caducaban nunca: tres "+15% de Ataque" de fuentes distintas dejaban al Digimon
 * en 1.52 de Ataque para siempre y nadie podía explicar por qué.
 *
 * Ahora cada efecto es un estado con su duración, y cuando caduca se deshace
 * él solo.
 */
function applyEffect(
  state: BattleState,
  actor: Fighter,
  target: Fighter,
  effect: NonNullable<MoveDef['effect']>,
  rng: Rng,
): void {
  const recipient = effect.target === 'self' ? actor : target;

  for (const [stat, factor] of Object.entries(effect.statChange ?? {}) as [StatKey, number][]) {
    const estado = estadoDeStat(stat, factor >= 1);

    // Un buff que ya se tiene se ALARGA, no se apila. Sumar dos "+15%" es
    // justo lo que convertía el combate en una carrera sin final.
    if (hasStatus(recipient, estado)) {
      const previo = recipient.statuses.find((x) => x.kind === estado)!;
      previo.turns = Math.max(previo.turns, effect.turns ?? STATUS_INFO[estado].turns);
      push(state, `${recipient.emoji} ${recipient.name} mantiene ${STATUS_INFO[estado].label}.`);
      continue;
    }

    // El multiplicador del movimiento es relativo (`1.15` = +15%); el estado
    // guarda la parte que se suma, que es lo que la interfaz muestra.
    applyStatus(recipient, estado, {
      magnitude: Math.abs(factor - 1),
      turns: effect.turns,
      source: actor.name,
    });

    const info = STATUS_INFO[estado];
    push(state, `${recipient.emoji} ${recipient.name}: ${info.label} (${Math.round(Math.abs(factor - 1) * 100)}%).`);
  }

  if (effect.status) {
    const aplicado = applyStatus(recipient, effect.status, {
      turns: effect.turns,
      magnitude: effect.magnitude,
      source: actor.name,
    });

    const info = STATUS_INFO[effect.status];
    push(
      state,
      `${recipient.emoji} ${recipient.name} ${
        aplicado.turns > 0
          ? `queda ${info.label.toLowerCase()} (${aplicado.turns} turnos)`
          : `sufre ${info.label.toLowerCase()}`
      }.`,
    );

    emit(state, {
      kind: 'estado',
      target: recipient.name,
      targetEmoji: recipient.emoji,
      status: recipient.status,
      statusKind: effect.status,
      turns: aplicado.turns,
      magnitude: aplicado.magnitude,
      text: effect.text,
    });
  }

  void rng;
}

function useItem(state: BattleState, actor: Fighter, item: ItemUse, rng: Rng): void {
  const entry = state.items.find((i) => i.key === item.key);
  if (!entry || entry.quantity <= 0) {
    push(state, `${actor.emoji} ${actor.name} ya no tiene ${item.name}.`);
    return;
  }

  const def = getItem(item.key);
  if (!def) {
    push(state, `${actor.emoji} ${actor.name} no sabe usar ${item.name}.`);
    return;
  }

  // El objeto se gasta antes de resolver: si el efecto hace algo raro, el
  // jugador no quiere descubrir después que conservó la Poción.
  entry.quantity -= 1;

  // Los materiales no tienen efecto de combate: no deberían llegar hasta aquí
  // (`buildBattleItems` los filtra), pero si colaran se gastan sin hacer nada.
  if (!def.effect) {
    entry.quantity += 1;
    push(state, `${def.emoji} ${def.name} es un material, no se usa en combate.`);
    return;
  }

  switch (def.effect.kind) {
    case 'curar': {
      const healed = Math.min(def.effect.amount, actor.stats.hp - actor.hp);
      actor.hp = Math.min(actor.stats.hp, actor.hp + healed);

      // La curacion se registra con lo que SE CURO, no con lo que decia el
      // objeto: una Poción sobre un Digimon al 95% solo cura 5, y pintar "100"
      // ahi seria una mentira que el jugador ve enseguida.
      emit(state, {
        kind: 'curacion',
        target: actor.name,
        amount: healed,
        origen: def.name,
      });
      push(state, `${actor.emoji} ${actor.name} recuperó **${healed}** PV (${def.emoji} ${def.name}).`);
      break;
    }
    case 'energia': {
      const before = actor.energy;
      actor.energy = Math.min(maxEnergyForLevel(actor.level), actor.energy + def.effect.amount);
      push(
        state,
        `${actor.emoji} ${actor.name} recuperó **${actor.energy - before}** energía (${def.emoji} ${def.name}).`,
      );

      emit(state, {
        kind: 'curacion',
        target: actor.name,
        amount: actor.energy - before,
        origen: `${def.name} (energía)`,
      });
      break;
    }
    case 'huir':
      push(state, `${actor.emoji} ${actor.name} usó ${def.emoji} ${def.name} y huyó.`);
      state.finished = true;
      state.result = 'huida';
      break;

    case 'capturar':
      tryCapture(state, rng);
      break;
  }
}

// ----------------------------------------------------------------- IA -----

/**
 * IA simple pero no tonta:
 *  - si puede, usa un movimiento de curación cuando va por debajo del 30%
 *  - penaliza los movimientos de estado si ya tiene buffs o el rival está KO
 *  - si se pone a la defensiva, prefiere el golpe más fuerte que pueda pagar
 */
/**
 * IA de un jefe.
 *
 * Si hay un telegrafiado a punto de caer, el jefe NO usa un movimiento caro:
 * el turno del telegrafiado ya es una Decisions, no hace falta_double_damage.
 * Así el jugador ve el aviso caer como un golpe aparte y no se pregunta por qué
 * el jefe no ha atacado.
 */

/**
 * Qué hace el rival este turno.
 *
 * La decisión vive en `ai.ts`, que es donde están los perfiles. Aquí solo se le
 * pasa lo que necesita y se traduce su respuesta al tipo de acción.
 *
 * Se le inyecta `speciesOf` en vez de dejar que la IA importe el resolver de
 * especies: este módulo ES el motor, y si la IA lo importara para ahorrarse
 * una línea, tendríamos un círculo entre los dos.
 */
export function chooseEnemyAction(state: BattleState, rng: Rng): Action {
  const enemigo = state.enemy;

  // La fase solo la mira el guardián. Para los demás es irrelevante: un cazador
  // no cambia de plan porque el jefe cambie de fase.
  const fase = enemigo.boss ? enemigo.boss.phaseIndex + 1 : 1;

  const decision = decidirIA(
    {
      actor: enemigo,
      rival: state.player,
      personalidad: state.personalidad,
      fase,
      azar: rng,
    },
    speciesOf,
  );

  if (decision.action.type !== 'movimiento') {
    // El motivo va al registro para que el jugador pueda LEER al rival. Un
    // enemigo que hace cosas sin explicar es el mismo enemigo de antes, con más
    // pasos por delante.
    push(state, `${enemigo.emoji} ${enemigo.name}: ${decision.motivo}.`);
  }

  return decision.action as Action;
}

// ------------------------------------------------------------- captura ----

/** Probabilidad de captura en porcentaje (0-95). */
export function captureChance(state: BattleState): number {
  const species = speciesOf(state.enemy);
  const levelRatio = clamp(1 - (state.player.level / Math.max(1, state.enemy.level) - 1) * 0.3, 0.3, 1.4);
  const hpFactor = (3 * state.enemy.stats.hp - 2 * state.enemy.hp) / (3 * state.enemy.stats.hp);
  const rarity = 190 / species.catchRate;
  return clamp(0.55 * levelRatio * hpFactor * rarity, 0.02, 0.95);
}

function tryCapture(state: BattleState, rng: Rng): void {
  state.capsulesUsed += 1;
  const chance = captureChance(state);

  if (rng.next() < chance) {
    state.enemy.caught = true;
    state.finished = true;
    state.result = 'victoria';
    state.capturedSpeciesKey = state.enemy.speciesKey;
    push(state, `¡${state.enemy.emoji} **${state.enemy.name}** fue capturado!`);
  } else {
    push(
      state,
      `¡Se ha soltado de la DigiCápsula! (${Math.round(chance * 100)}% de probabilidad)`,
    );
  }
}

// ------------------------------------------------------------- switching --

/**
 * Digimon que han caído durante ESTE combate.
 *
 * El HP de `party` no se toca hasta el final del combate, así que no sirve para
 * saber quién sigue en pie. Sin este registro, `switchTo` dejaba cambiar a un
 * Digimon ya con 0 PV y la batalla entraba en bucle: caía el activo, se
 * proponía el mismo caído, caía otra vez...
 */
const fainted = new WeakMap<BattleState, Set<number>>();

/**
 * Si un Digimon del equipo está caído.
 *
 * Hay dos fuentes y hacen falta las dos:
 *
 * 1. El registro `fainted`, con los que cayeron DURANTE este combate. Es
 *    necesario porque el combate muta copias: `party[i].hp` sigue con el valor
 *    que tenía al empezar y no baja cuando el combate le hace daño.
 * 2. El HP del propio `party`, para los que ya estaban en cero al empezar. Sin
 *    esta segunda comprobación, un Digimon que una pelea anterior dejó a cero
 *    sería una opción seleccionable, entraría con 0 PV y caería en el acto.
 *
 * Ninguna de las dos basta sola, y ese es el motivo de que la interfaz NO sea
 * quien decida: filtrar en pantalla deja pasar el caso raro, y el motor es el
 * único sitio donde está la verdad.
 */
export function isFainted(state: BattleState, index: number): boolean {
  if (fainted.get(state)?.has(index)) return true;
  const d = state.party[index];
  return d !== undefined && d.hp <= 0;
}

function markFainted(state: BattleState, index: number): void {
  const set = fainted.get(state) ?? new Set<number>();
  set.add(index);
  fainted.set(state, set);
}

/**
 * Cambia el Digimon activo. Devuelve false si el cambio no es legal.
 */
/**
 * Cambia de Digimon, arrastrando el historial de cada uno.
 *
 * El `Fighter` se construye NUEVO en cada entrada al campo. Sin más, el resumen
 * final solo tendría los datos del último que estuvo en el campo, y no los de
 * los tres: sería la diferencia entre "Agumon hizo 482" y "el que estaba activo
 * al final hizo 482".
 *
 * El orden de estas cuatro líneas es lo único delicate:
 *
 *   1. Se guarda la cuenta de QUIEN SALE.
 *   2. Se construye el fighter del que entra.
 *   3. Se le asigna su cuenta.
 *   4. Se cambia el índice.
 *
 * Los pasos 2 y 3 están en ese orden por un motivo concreto: `fighterFromOwned`
 * devuelve un objeto NUEVO con la cuenta a cero, así que asignarla ANTES se
 * perdería en el acto. Lo pasó: el resumen decía 0 de daño para un Digimon que
 * acababa de pegar 172.
 */
export function switchTo(state: BattleState, digimonId: number): boolean {
  const index = state.party.findIndex((d) => d.id === digimonId);
  if (index === -1) return false;

  if (isFainted(state, index)) {
    push(state, `${state.party[index]!.species.name} ya ha caído y no puede volver.`);
    return false;
  }

  const cambia = state.activeIndex !== index;

  // 1. La cuenta de quien sale, antes de que deje de ser el activo.
  if (cambia) {
    state.records[state.activeIndex] = state.player.record;
  }

  // 2. El fighter del que entra, con sus PV.
  state.activeIndex = index;
  const next = state.party[index]!;
  state.player = fighterFromOwned(next, 'jugador');

  // 3. Su cuenta, por encima de la que trae el fighter nuevo.
  if (cambia) {
    state.records[index] = state.records[index] ?? recordInicial();
    state.player.record = state.records[index]!;
    state.player.record.switchesIn += 1;
  } else {
    // Cambiar al mismo Digimon no borra nada: se le devuelve su propia cuenta.
    state.records[index] = state.player.record;
  }

  state.awaitingSwitch = false;

  // Cambiar también es una respuesta válida a un telegrafiado: el nuevo entra
  // con la vida llena, que es justo de lo que se trata.
  if (state.enemy.boss?.telegraph) registerCounter(state, 'cambiar');

  push(state, `Adelante, ${state.player.emoji} **${state.player.name}**!`);
  return true;
}

/** Digimon disponibles para cambiar: los vivos y distintos del activo. */
export function switchCandidates(state: BattleState): OwnedDigimon[] {
  return state.party.filter((_, i) => i !== state.activeIndex && !isFainted(state, i));
}

// ------------------------------------------------------------- rewards ----

export interface LevelUpResult {
  digimonId: number;
  nickname: string | null;
  /** Nombre de la especie ANTES de evolves (para el texto del embed). */
  speciesName: string;
  fromLevel: number;
  toLevel: number;
  newMoves: string[];
  /** Nombre de la forma nueva si este nivel ha provocado una evolución. */
  evolvedTo: string | null;
}

/**
 * Suma EXP a un Digimon, aplica los niveles y devuelve el resumen.
 * `persist` recibe el objeto ya modificado para escribirlo en la BD.
 */
export function grantExp(
  digimon: OwnedDigimon,
  gained: number,
  persist: (digimon: OwnedDigimon) => void,
): LevelUpResult | null {
  const fromLevel = digimon.level;
  const previousSpeciesName = digimon.species.name;
  digimon.exp += gained;

  let levelsGained = 0;
  while (digimon.level < MAX_LEVEL && digimon.exp >= expToNextLevel(digimon.level)) {
    digimon.exp -= expToNextLevel(digimon.level);
    digimon.level += 1;
    levelsGained += 1;
  }
  if (digimon.level >= MAX_LEVEL) digimon.exp = 0;
  if (levelsGained === 0) return null;

  // ANTES esto llamaba a `maybeEvolve()` y transformaba al Digimon solo al
  // subir de nivel. Ya no: la evolucion es manual (ver `/evolucion`). Subir de
  // nivel desbloquea rutas, no las ejecuta.
  const evolvedTo = null;

  const previousHpRatio = digimon.stats.hp > 0 ? digimon.hp / digimon.stats.hp : 1;
  const oldMaxHp = digimon.stats.hp;
  digimon.stats = computeStats(digimon.species.base, digimon.level);

  // Al subir de nivel curas el HP ganado, como es habitual en la saga.
  const healedByLevelUp = digimon.stats.hp - oldMaxHp;
  digimon.hp = Math.min(
    digimon.stats.hp,
    Math.max(digimon.hp, Math.round(digimon.stats.hp * previousHpRatio)) + healedByLevelUp,
  );
  digimon.hp = Math.min(digimon.hp, digimon.stats.hp);

  const learned = movesForLevel(digimon.species, digimon.level).filter(
    (key) => !digimon.moves.some((m) => m.key === key),
  );
  if (learned.length > 0) {
    digimon.moves = resolveMoves([...digimon.moves.map((m) => m.key), ...learned]);
  }

  persist(digimon);

  return {
    digimonId: digimon.id,
    nickname: digimon.nickname,
    speciesName: previousSpeciesName,
    fromLevel,
    toLevel: digimon.level,
    newMoves: learned,
    evolvedTo,
  };
}

/**
 * Aplica una forma nueva a un Digimon, conservando lo que la nueva especie
 * todavía sepa hacer.
 *
 * No comprueba requisitos ni cobra nada: eso es responsabilidad de
 * `evolutionRepo.evolveInto`, que lo hace dentro de una transacción. Aquí solo
 * cambia el estado en memoria.
 *
 * Devuelve el nombre de la forma nueva, o null si la especie destino no existe
 * en el catálogo (un dato corrupto en `evolutions` no debe corromper al
 * Digimon: se ignora y se queda como estaba).
 */
export function applyEvolution(
  digimon: OwnedDigimon,
  toSpeciesKey: string,
): string | null {
  const next = getSpecies(toSpeciesKey);
  if (!next) return null;

  const allowed = new Set(next.learnset);
  const kept = digimon.moves.filter((m) => allowed.has(m.key)).map((m) => m.key);
  const gained = movesForLevel(next, digimon.level).filter((key) => !kept.includes(key));

  digimon.species = next;
  digimon.moves = resolveMoves([...kept, ...gained]);

  // Las estadísticas se derivan de la especie y el nivel, nunca se suman.
  // Recalcular aquí es lo que evita que evolucionar dos veces escale de más.
  digimon.stats = computeStats(next.base, digimon.level);
  digimon.hp = Math.min(digimon.hp, digimon.stats.hp);

  return next.name;
}

/**
 * Mayor porcentaje de drenaje entre el movimiento y el equipo.
 */
function bestDrainRatio(actor: Fighter, move: MoveDef): number {
  const fromMove = move.key === 'drain' ? 0.5 : 0;
  const fromGear = actor.gear
    .filter((e) => e.kind === 'drenar')
    .reduce((max, e) => Math.max(max, (e as { ratio: number }).ratio), 0);
  return Math.max(fromMove, fromGear);
}
/**
 * Equipo: contraataque. Quien lleva el chip de reflejos devuelve una parte
 * del daño que acaba de recibir.
 *
 * No puede aplicar ni escudo ni dreno: seria un efecto dentro de un efecto,
 * y un contraataque infinito rompería la partida.
 */
function applyCounterattack(
  state: BattleState,
  victim: Fighter,
  attacker: Fighter,
  damage: number,
  rng: Rng,
): void {
  if (victim.hp <= 0) return;

  for (const effect of victim.gear) {
    if (effect.kind !== 'contraataque') continue;
    if (!rng.chance(effect.ratio)) break;

    const back = Math.max(1, Math.round(damage * 0.3));
    attacker.hp = Math.max(0, attacker.hp - back);
    push(state, `⚡ **${victim.name}** contraataca y devuelve **${back}** PV.`);
    break;
  }
}
// -------------------------------------------------------------- helpers ---

export function opponentOf(state: BattleState, actor: Fighter): Fighter {
  return actor.side === 'jugador' ? state.enemy : state.player;
}

/**
 * Especie efectiva de un combatiente.
 *
 * Para un jefe NO devuelve la especie del catálogo sino una copia con los
 * valores de la FASE ACTIVA: atributo, debilidades, resistencias e inmunidad.
 *
 * Es el truco que hace que las fases funcionen sin tocar el motor tres veces:
 * `useMove`, `chooseEnemyAction` y `captureChance` ya consultan esta función,
 * así que un cambio de fase reordena los emparejamientos de golpe.
 */
export function effectiveSpecies(fighter: Fighter): SpeciesDef {
  const base = getSpecies(fighter.speciesKey)!;
  const phase = fighter.boss ? activePhase(fighter) : null;

  if (!phase) return base;

  return {
    ...base,
    // El atributo sale del RUNTIME del jefe, no del Fighter: ahí vive el de la
    // especie y no el de la fase vigente. Si una fase no declara atributo
    // propio, se mantiene el de la anterior; leer el de la especie haría que
    // cada fase sin atributo revirtiese el cambio anterior.
    attribute: phase.attribute ?? fighter.boss!.attribute,
    weakTo: phase.weakTo ?? base.weakTo,
    resists: phase.resists ?? base.resists,
    immuneTo: phase.immuneTo ?? base.immuneTo,
  };
}

/** Fase activa de un jefe, o null si no es un jefe. */
function activePhase(fighter: Fighter) {
  if (!fighter.boss) return null;
  return getBoss(fighter.boss.key)?.phases[fighter.boss.phaseIndex] ?? null;
}

/**
 * Traduce una estadística a su estado equivalente.
 *
 * `statChange` es un multiplicador relativo (`1.15` sube, `0.85` baja), y
 * quien lo aplica es quien sabe la dirección. El catálogo solo tiene que
 * saber qué hace cada estado, así que la traducción vive en el motor y no
 * al revés.
 */
const ESTADO_DE = {
  attack_up: 'atk_up',
  attack_down: 'atk_down',
  defense_up: 'def_up',
  defense_down: 'def_down',
  speed_up: 'vel_up',
  speed_down: 'vel_down',
} as const;

function estadoDeStat(stat: string, sube: boolean): StatusKind {
  const base = stat === 'defense' ? 'defense' : stat === 'speed' ? 'speed' : 'attack';
  return ESTADO_DE[`${base}_${sube ? 'up' : 'down'}`];
}

function speciesOf(fighter: Fighter): SpeciesDef {
  return effectiveSpecies(fighter);
}

function push(state: BattleState, line: string): void {
  state.log.push(line);
  if (state.log.length > MAX_LOG_LINES) state.log.shift();
}

/**
 * Qué catejo es un multiplicador de interacción.
 *
 * Vive aquí y no en la interfaz para que el rótulo y el cálculo no se
 * separen: si el motor subiera el umbral de "supereficaz" sin tocar esta
 * tabla, la pantalla diría NORMAL sobre un golpe del 190%.
 */
export function efectoDe(total: number):
  | 'supereficaz' | 'eficaz' | 'neutro' | 'ineficaz' | 'inmune' | null {
  if (total <= 0) return 'inmune';
  if (total >= 1.6) return 'supereficaz';
  if (total > 1.1) return 'eficaz';
  if (total < 0.9) return 'ineficaz';
  return null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}


/**
 * Nombre corto de un estado.
 *
 * Se mantiene como reexportación del catálogo y no como una tabla propia. Antes
 * vivía aquí una copia con seis entradas, y cuando el motor ganó siete estados
 * más siguió compilando: la tabla quedó desfasada en silencio y el panel de
 * efectos pintaba `undefined` para un escudo.
 */
export function statusLabel(status: StatusEffect): string {
  return status === 'ok' ? 'Normal' : STATUS_INFO[status].label;
}

export { computeStats, expToNextLevel, maxEnergyForLevel, MAX_LEVEL };



/**
 * Secuencia de ids de combate.
 *
 * Sin azar a propósito: el id solo tiene que ser único dentro del proceso, y
 * dos combates del mismo milisegundo se separan con este contador.
 */
let idSeq = 0;

export function newBattleId(mode: BattleMode, now = Date.now()): string {
  idSeq += 1;
  return `${mode.slice(0, 3)}-${now.toString(36)}-${idSeq.toString(36)}`;
}