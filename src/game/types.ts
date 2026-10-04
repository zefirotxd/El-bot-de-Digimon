/** Tipos compartidos por toda la capa de juego (sin dependencias de Discord). */

import type { GearEffect } from './equipment.js';
import type { TelegraphCounter } from './bosses.js';

export type { GearEffect };
export type { TelegraphCounter };

/**
 * Atributo (capa 1 del combate, el triángulo de Time Stranger).
 * Solo `vacuna`, `virus` y `datos` participan; el resto es neutral.
 */
export type Attribute =
  | 'vacuna'
  | 'virus'
  | 'datos'
  | 'free'
  | 'variable'
  | 'unknown'
  | 'sin_datos';

/** Afinidad elemental (capa 2). Ver `game/elements.ts`. */
export type Element =
  | 'fuego'
  | 'hielo'
  | 'planta'
  | 'agua'
  | 'rayo'
  | 'metal'
  | 'viento'
  | 'tierra'
  | 'luz'
  | 'oscuridad'
  | 'nulo';

export type Tier =
  | 'inicial'
  | 'diminuto'
  | 'novato'
  | 'campeon'
  | 'ultimate'
  | 'mega';

/**
 * Estados del combate.
 *
 * Antes eran seis, y solo tres hacían cosas distintas: dormir, congelado y
 * parálisis. Los buffs no caducaban nunca, no había blindaje, y "aturdido" era
 * indistinguible de "dormido". Eso dejaba el combate con muy poca forma: dos
 * Digimon con los mismos estados se jugaban exactamente igual.
 *
 * Ahora hay control, daño continuo, protección y modificadores con duración.
 * El enum solo dice QUÉ es; los turnos que quedan y la potencia van en
 * `ActiveStatus`, que es lo que la interfaz pinta.
 */
export type StatusKind =
  // Daño continuo, al cerrar el turno.
  | 'quemadura'
  | 'veneno'
  // Control: impide actuar. Cada uno con su propia regla.
  | 'paralisis'
  | 'dormir'
  | 'congelado'
  /** Aturdido: no puede actuar, no lo esquiva nada y dura un turno. */
  | 'aturdir'
  // Protección: absorbe PV antes de que lleguen al Digimon.
  | 'escudo'
  // Modificadores con duración.
  | 'atk_up'
  | 'atk_down'
  | 'def_up'
  | 'def_down'
  | 'vel_up'
  | 'vel_down'
  // Inmunidad temporal.
  | 'inmune';

/**
 * Estado por defecto.
 *
 * Se deja aparte y no como valor de `StatusKind` porque no es un estado: es la
 * ausencia de estado. Mezclarlos obligaba a comprobar `status === 'ok'` por
 * todas partes, y de ahí salía el fallo más feo del combate: un buff se
 * aplicaba encima de una quemadura sin replacing nada, y ambos se pisaban.
 */
export type StatusEffect = StatusKind | 'ok';

/**
 * Un efecto activo sobre un Digimon.
 *
 * Es lo que se pinta en el panel ACTIVE EFFECTS, y por eso lleva la duración y
 * la potencia: sin ellas, "🔥 Burn" no dice cuánto dura ni cuánto hace, y el
 * jugador no puede decidir si merece la pena gastarse un turno en curarse.
 */
export interface ActiveStatus {
  kind: StatusKind;
  /**
   * Turnos que quedan. 0 = no caduca.
   *
   * Es lo que distingue "quema hasta que acabe el combate" de "dormir dos
   * turnos", y es el dato que el panel necesita para poder mostrar `⏱️ 2`.
   */
  turns: number;
  /**
   * Potencia. La unidad depende del estado:
   *
   * - quemadura / veneno: PV por turno.
   * - escudo: PV que absorbe.
   * - buffs: el multiplicador (0.15 = +15%).
   * - resto: no se usa.
   */
  magnitude: number;
  /**
   * Los multiplicadores que este estado puso, para deshacerlos al caducar.
   *
   * Sin esto, un "+15% de Ataque durante 2 turnos" se acumulaba para siempre y
   * el Digimon acababa con el Ataque al 300% sin que nada lo explicara. Guarda
   * el valor ANTERIOR de cada estadística, no el nuevo, y por eso el orden de
   * aplicación importa: se aplican de más corto a más largo.
   */
  revert?: Partial<Record<StatKey, number>>;
  /** De qué movimiento vino. Aparece en el panel. */
  source: string;
}

/** Categoría de un movimiento, análoga a Físico / Especial / Estado. */
export type MoveCategory = 'fisico' | 'especial' | 'estado';

/** Efecto secundario que un movimiento puede aplicar. */
export interface SecondaryEffect {
  /** Probabilidad de disparo, 0..1 */
  chance: number;
  status?: StatusKind;
  /** Turnos que dura. Si no se dice, usa el que toque para ese estado. */
  turns?: number;
  /**
   * Potencia: daño por turno de la quemadura, PV del escudo, multiplicador del
   * buff. Si no se dice, la usa el valor por defecto del estado.
   */
  magnitude?: number;
  /** Buffs/debuffs de estadísticas: stat -> multiplicador */
  statChange?: Partial<Record<StatKey, number>>;
  target: 'self' | 'enemy';
  /** Texto para el log, ej. "quedó quemado" */
  text: string;
}

export interface MoveDef {
  key: string;
  name: string;
  element: Element;
  category: MoveCategory;
  /** Potencia base. 0 para movimientos de estado. */
  power: number;
  /** 0..1. 1 = nunca falla. */
  accuracy: number;
  /** Coste de energía. 0 = gratuito. */
  energyCost: number;
  priority: number;
  /** Porcentaje de crítico. */
  critRate: number;
  /**
   * Turnos que hay que esperar antes de volver a usarlo. 0 = siempre.
   *
   * Sin esto, la energía era el único freno y como se recarga a +1 por turno,
   * un movimiento barato y potente se usaba cada dos turnos sin que nada lo
   * frenara. Con cooldown, el kit de cada Digimon tiene ritmo: hay momentos en
   * que su mejor golpe no está y hay que decidir con el segundo.
   */
  cooldown: number;
  /** PV que cura. 0 si no cura. */
  heal?: number;
  /** Fracción del daño que devuelve al usuario. 0..1. */
  drain?: number;
  /** PV de escudo que coloca. 0 si no coloca. */
  shield?: number;
  effect?: SecondaryEffect;
  description: string;
}

export interface Stats {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
}

export type StatKey = keyof Stats;

/**
 * Una ruta de evolución.
 *
 * La evolución es MANUAL: subir de nivel no transforma nada, solo desbloquea
 * rutas. Aquí van todos los requisitos de una ruta concreta.
 *
 * `exclusiveWith` es lo que convierte esto en un árbol de verdad: si el jugador
 * ya tomó la ruta a `X`, la de `X` se cierra para siempre. Sin eso, "elegir"
 * no sería una decisión sino una lista.
 */
export interface EvolutionRoute {
  /** Especie destino. */
  to: string;
  /** Nivel mínimo del Digimon. */
  level: number;
  /** Victorias totales del entrenador. */
  wins?: number;
  /** DigiBytes que cuesta. */
  digibytes?: number;
  /** Materiales: clave de objeto -> cantidad. */
  items?: Record<string, number>;
  /** Explicación de la rama, para `/evolucion`. */
  note?: string;
  /** Se cierra si el jugador ya evolucionó a esta especie. */
  exclusiveWith?: string;
  /** Marca la ruta alternativa en el árbol. */
  branch?: boolean;
}

/** Regresión: deshacer una evolución con un objeto especial. */
export interface DevolutionRoute {
  to: string;
  /** Materiales: clave -> cantidad. */
  items: Record<string, number>;
  note?: string;
}

export interface SpeciesDef {
  key: string;
  name: string;
  emoji: string;
  /** Capa 1: el triángulo Vacuna / Virus / Datos. */
  attribute: Attribute;
  /** Elementos que usa con ventaja propia (STAB). */
  elements: Element[];
  /** Capa 2: elementos a los que este Digimon es muy débil (◎ 1.8x). */
  weakTo: Element[];
  /** Capa 2: elementos que este Digimon resiste (△ 0.6x). */
  resists: Element[];
  /** Elementos a los que es inmune (X 0x). */
  immuneTo?: Element[];
  tier: Tier;
  /** Estadísticas base en nivel 1. */
  base: Stats;
  /** Tamaño del cuerpo: afecta al porcentaje de captura. */
  catchRate: number;
  /** Claves de movimientos aprendibles. */
  learnset: string[];
  /** Rutas de evolución disponibles. Vacío = forma final. */
  evolutions: EvolutionRoute[];
  /**
   * Regresión a una forma anterior.
   *
   * Existe para que ninguna elección sea irreversible: si el jugador toma la
   * rama equivocada, puede deshacerla con materiales en vez de quedarse
   * atascado hasta el final de la temporada.
   */
  devolution?: DevolutionRoute;
  lore: string;
}

/** Instancia persistida de un Digimon que pertenece a un entrenador. */
export interface OwnedDigimon {
  id: number;
  trainerId: number;
  species: SpeciesDef;
  nickname: string | null;
  level: number;
  exp: number;
  stats: Stats;
  /** PV actuales; se recalcula a tope al descansar o al salir de combate. */
  hp: number;
  moves: MoveDef[];
  status: StatusEffect;
  caughtAt: string;
  /** 'party' = equipo activo y pelable. 'pc' = depositado en el PC. */
  storage: Storage;
}

/** Dónde está guardado un Digimon. */
export type Storage = 'party' | 'pc';

/** Estado completo e inmutable-ish de un Digimon dentro del combate. */
export interface Fighter {
  side: 'jugador' | 'rival';
  /** Identificador único dentro de la batalla. */
  uid: string;
  name: string;
  emoji: string;
  speciesKey: string;
  /** Capa 1 del sistema de combate. */
  attribute: Attribute;
  level: number;
  stats: Stats;
  hp: number;
  energy: number;
  moves: MoveDef[];
  status: StatusEffect;
  /**
   * Turnos que le quedan al estado inmovilizante.
   *
   * 0 para los estados que no caducan (quemadura, veneno) y para `ok`.
   * Existía un contador aparte porque la interfaz tiene que poder decir
   * "⏱️ 2 turnos" y el enum solo no lo sabe.
   *
   * Es un espejo de `statuses`: el motor legacy y los tests leen este campo, y
   * el panel de efectos lee la lista. Los dos los escribe `applyStatus`, en el
   * mismo sitio, para que no puedan separarse.
   */
  statusTurns: number;
  /**
   * Todos los efectos activos, con su duración y su potencia.
   *
   * Es la fuente de verdad: de aquí salen el panel ACTIVE EFFECTS, el daño
   * continuo, la expiración de los buffs y el consumo del escudo.
   *
   * `status` y `statusTurns` son el resumen para el código que ya existía, no
   * una segunda copia. Un Digimon puede tener cuatro buffs y una quemadura a la
   * vez, cosa que un único `status` no puede representar.
   */
  statuses: ActiveStatus[];
  /**
   * PV que el escudo absorbe antes de llegar al Digimon.
   *
   * Va aquí y no dentro de `statuses` porque se consume de golpe: cuando se
   * agota, el escudo desaparece entero, no le quedan "turnos" a cero.
   */
  shield: number;
  /**
   * Turnos que faltan para poder usar cada movimiento, por clave.
   *
   * Se descuenta al empezar el turno de quien lo usa, no al final: un movimiento
   * con cooldown 2 usado en el turno 3 vuelve a estar disponible en el 5, que es
   * lo que el jugador cuenta en la cabeza.
   */
  cooldowns: Record<string, number>;
  /** Multiplicadores temporales de estadísticas (buffs/debuffs). */
  modifiers: Partial<Record<StatKey, number>>;
  isDefending: boolean;
  caught: boolean;
  /**
   * Efectos activos del equipo que lleva puesto. Las estadísticas ya vienen
   * sumadas en `stats`; aquí solo viven los efectos que necesitan ejecutarse
   * dentro del motor (escudo, drenaje, contraataque...).
   */
  gear: GearEffect[];
  /** Bonus acumulados de crítico y precisión del equipo. */
  gearCritRate: number;
  gearAccuracy: number;
  /**
   * Mecánicas de jefe. `null` para cualquier combatiente normal.
   *
   * Vive en el Fighter y NO en la entidad persistente, igual que el resto del
   * estado de combate: una mazmorra abandonada a medias no deja al jugador con
   * un jefe a medio matar en la base de datos.
   */
  boss: BossRuntime | null;
  /**
   * Lo que ha hecho ESTE Digimon en ESTE combate.
   *
   * Antes no existía, y por eso el análisis post-combate solo podía decir
   * "ganaste 200 EXP". Para poder decir "Agumon hizo 482 de daño, 2 críticos y
   * estuvo 9 turnos activo, MVP" hace falta que el motor lleve la cuenta.
   *
   * Va en el `Fighter` y no en el `BattleState` porque el dato es POR
   * combatiente: el cambio en caliente tiene que arrastrar las estadísticas de
   * quien sale, y si estuvieran en el estado se perderían o se sumarían al que
   * entra. Con `uid` se sabe de quién son.
   */
  record: CombatRecord;
}

/** Lo que ha hecho un Digimon en un combate. La base del análisis final. */
export interface CombatRecord {
  /** Daño que ha causado. */
  dealt: number;
  /** Daño que ha recibido. */
  taken: number;
  /** PV que ha curado, sin contar drenajes. */
  healed: number;
  /** PV absorbidos por su escudo. */
  shielded: number;
  /** Movimientos usados. */
  skills: number;
  /** Golpes que impactaron. */
  landed: number;
  /** Fallos por precisión. */
  missed: number;
  /** Críticos. */
  crits: number;
  /** Golpes con ventaja de atributo o elemento. */
  effective: number;
  /** Combos desbloqueados por este Digimon. */
  combos: number;
  /** Turnos en los que le tocó jugar. */
  turnsActive: number;
  /** Turnos en los que estuvo bloqueado por un estado. */
  turnsBlocked: number;
  /** Cuántas veces entró desde la reserva. */
  switchesIn: number;
}

/** Un ataque telegrafiado: el jefe avisa y hay una ventana para responder. */
export interface TelegraphRuntime {
  /** Movimiento que caerá. */
  moveKey: string;
  name: string;
  element: Element;
  /** Turnos que faltan para que caiga. */
  turnsLeft: number;
  /** Cuántos turnos llevaba avisado cuando se anunció. */
  lead: number;
  /** Daño estimado si no se responde. */
  estimate: number;
  /** Cómo se responde. */
  counter: TelegraphCounter;
  hint: string;
  /** Si el jugador ya respondió y recorta el golpe. */
  mitigated: number;
}

export interface BossRuntime {
  key: string;
  /** Índice de la fase activa en `BossDef.phases`. */
  phaseIndex: number;

  /**
   * Atributo vigente del jefe, carried por el runtime y no por el Fighter.
   *
   * Si viviera en `fighter.attribute` habría que acordarse de mutarlo al
   * cambiar de fase, y leerlo sin esa mutación daría el atributo de la
   * ESPECIE en vez del de la fase. Aquí la invariante es estructural.
   */
  attribute: Attribute;
  /** Turno en el que se vuelve a anunciar un telegrafiado. */
  nextTelegraphAt: number;
  telegraph: TelegraphRuntime | null;
  /**
   * Daño acumulado que este jefe ha recibido en el combate.
   *
   * Es lo que convierte "premiar al que más pega" en algo medible sin
   * multijugador real: la contribución es el porcentaje de PV del jefe que te
   * has llevado tú.
   */
  damageTaken: number;
}

/** Acciones que un combatiente puede elegir en su turno. */
export type Action =
  | { type: 'movimiento'; move: MoveDef }
  | { type: 'defender' }
  | { type: 'objeto'; item: ItemUse }
  | { type: 'cambiar'; digimonId: number }
  | { type: 'capturar' }
  | { type: 'huir'; success: boolean };

export interface ItemUse {
  key: string;
  name: string;
  emoji: string;
  quantity: number;
}

export interface BattleResult {
  outcome: 'victoria' | 'derrota' | 'huida';
  expGained: number;
  digibytesGained: number;
  levelsGained: { digimonId: number; newLevel: number; nickname: string | null }[];
  caughtSpeciesKey: string | null;
}
