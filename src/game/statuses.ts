import type { ActiveStatus, Fighter, MoveDef, StatKey, StatusKind } from './types.js';

// Se reexporta porque el motor lo necesita para sus own tipos, y que lo importe
// de aquí en vez de de `types.ts` deja claro que para lo que es un ESTADO hay
// que mirar este fichero.
export type { StatusKind, ActiveStatus };

/**
 * Estados: catálogo y ciclo de vida.
 *
 * Aquí vive TODO lo que un estado hace. La interfaz no sabe si la quemadura
 * quita el 6% o el 8% de los PV: pregunta, y lo lee de `RESIDUAL_RATIO`. Si el
 * motor cambiara el valor y la pantalla no, el jugador vería un número que el
 * combate no aplica, y la única forma de quejarse sería perder contra algo que
 * en realidad no le hizo ese daño.
 *
 * Por eso este módulo NO importa nada de Discord y NO sabe qué es una pantalla.
 */

/** Qué hace cada estado y cómo se representa. */
export interface StatusInfo {
  emoji: string;
  label: string;
  /** Lo que se lee al tocar el estado en la interfaz. */
  desc: string;
  /** Turnos por defecto si el movimiento no dice. 0 = no caduca. */
  turns: number;
  /** Potencia por defecto si el movimiento no dice. */
  magnitude: number;
  /** Qué estadística modifica, si modifica alguna. */
  stat?: StatKey;
  /** `true` si el multiplicador sube; `false` si baja. */
  up?: boolean;
  /**
   * Cómo impide actuar:
   *
   * - `'siempre'`: no puede actuar, sin más (dormir, congelado, aturdido).
   * - `'probabilidad'`: puede pasar (parálisis, que se esquiva la mitad de las
   *   veces). Esto es lo que hace que la parálisis sea una amenaza y no un
   *   simple "no te mueves" como dormir.
   * - `undefined`: no impide actuar.
   */
  control?: 'siempre' | 'probabilidad';
  /** Probabilidad de bloqueo, para `control: 'probabilidad'`. */
  chance?: number;
}

export const STATUS_INFO: Record<StatusKind, StatusInfo> = {
  quemadura: {
    emoji: '🔥',
    label: 'Quemadura',
    desc: 'Pierde PV al final de cada turno.',
    turns: 0,
    magnitude: 0.06,
  },
  veneno: {
    emoji: '☠️',
    label: 'Veneno',
    desc: 'Pierde PV al final de cada turno, menos que la quemadura.',
    turns: 0,
    magnitude: 0.045,
  },
  paralisis: {
    emoji: '⚡',
    label: 'Parálisis',
    desc: 'Puede no actuar en la mitad de los turnos.',
    turns: 3,
    magnitude: 0,
    control: 'probabilidad',
    chance: 0.5,
  },
  dormir: {
    emoji: '💤',
    label: 'Sueño',
    desc: 'No puede actuar hasta que se despierte.',
    turns: 2,
    magnitude: 0,
    control: 'siempre',
  },
  congelado: {
    emoji: '🧊',
    label: 'Congelado',
    desc: 'No puede actuar hasta que se descongele.',
    turns: 2,
    magnitude: 0,
    control: 'siempre',
  },
  aturdir: {
    emoji: '💫',
    label: 'Aturdido',
    desc: 'No puede actuar este turno. No lo puede esquivar.',
    turns: 1,
    magnitude: 0,
    control: 'siempre',
  },
  escudo: {
    emoji: '🛡️',
    label: 'Escudo',
    desc: 'Absorbe PV antes de que le lleguen al Digimon.',
    turns: 0,
    magnitude: 0,
  },
  atk_up: {
    emoji: '⬆️',
    label: 'Ataque ↑',
    desc: 'Hace más daño mientras dure.',
    turns: 3,
    magnitude: 0.15,
    stat: 'attack',
    up: true,
  },
  atk_down: {
    emoji: '⬇️',
    label: 'Ataque ↓',
    desc: 'Hace menos daño mientras dure.',
    turns: 3,
    magnitude: 0.15,
    stat: 'attack',
    up: false,
  },
  def_up: {
    emoji: '🛡️',
    label: 'Defensa ↑',
    desc: 'Resiste más mientras dure.',
    turns: 3,
    magnitude: 0.2,
    stat: 'defense',
    up: true,
  },
  def_down: {
    emoji: '🕳️',
    label: 'Defensa ↓',
    desc: 'Resiste menos mientras dure.',
    turns: 3,
    magnitude: 0.2,
    stat: 'defense',
    up: false,
  },
  vel_up: {
    emoji: '💨',
    label: 'Velocidad ↑',
    desc: 'Actúa antes mientras dure.',
    turns: 3,
    magnitude: 0.25,
    stat: 'speed',
    up: true,
  },
  vel_down: {
    emoji: '🐌',
    label: 'Velocidad ↓',
    desc: 'Actúa después mientras dure.',
    turns: 3,
    magnitude: 0.25,
    stat: 'speed',
    up: false,
  },
  inmune: {
    emoji: '✨',
    label: 'Inmune',
    desc: 'No puede recibir efectos negativos.',
    turns: 2,
    magnitude: 0,
  },
};

/**
 * Fracción de los PV máximos que se pierde por turno.
 *
 * Antes estos números estaban escritos dentro del bucle de residuos, uno por
 * estado, y la interfaz no tenía forma de mostrarlos. Aquí están en un sitio, y
 * el panel de efectos puede leerlos sin inventar nada.
 */
export const RESIDUAL_RATIO: Partial<Record<StatusKind, number>> = {
  quemadura: 0.06,
  veneno: 0.045,
};

/** ¿Este estado impide actuar? */
export function isControl(kind: StatusKind): boolean {
  return STATUS_INFO[kind].control !== undefined;
}

/** ¿Este estado es malo para quien lo lleva? */
export function isDebuff(kind: StatusKind): boolean {
  return kind === 'quemadura' || kind === 'veneno' || kind.endsWith('_down');
}

// ------------------------------------------------------------ aplicación ----

export interface ApplyStatusOptions {
  /** Turnos. Si no se dicen, los del catálogo. */
  turns?: number;
  /** Potencia. Si no se dice, la del catálogo. */
  magnitude?: number;
  /** De qué movimiento viene, para el panel. */
  source?: string;
  /** Rotulo extra para el log. */
  text?: string;
}

/**
 * Pone un estado.
 *
 * Tres decisiones que importan:
 *
 * 1. **No se acumula.** Si el Digimon ya tiene `atk_up`, se le ALARGAN los
 *    turnos en vez de sumar otro +15%. Con acumul libre, tres buffs de fuentes
 *    distintas dejan el Ataque al 150% y el combate se rompe por el lado del
 *    jugador, que es la peor forma de romperse.
 * 2. **Guarda el valor anterior** de cada estadística en `revert`, no el nuevo.
 *    Es lo que permite volver atrás sin tener que adivinar qué había antes.
 * 3. **El escudo no vive aquí.** Se consume de golpe y cuando se agota
 *    desaparece entero, así que se guarda en `fighter.shield` y no en la lista.
 *    Un estado con "turnos = 0" en la lista sería un escudo que nunca se acaba.
 */
export function applyStatus(
  fighter: Fighter,
  kind: StatusKind,
  opts: ApplyStatusOptions = {},
): ActiveStatus {
  const info = STATUS_INFO[kind];
  const turnos = opts.turns ?? info.turns;
  const magnitud = opts.magnitude ?? info.magnitude;
  const origen = opts.source ?? info.label;

  // El escudo se acumula en el contador, no en la lista.
  if (kind === 'escudo') {
    fighter.shield += magnitud;
    return { kind, turns: turnos, magnitude: fighter.shield, source: origen };
  }

  const previa = fighter.statuses.find((s) => s.kind === kind);

  if (previa) {
    // Se refresca en vez de apilar. Los turnos se alargan, nunca se suman.
    previa.turns = Math.max(previa.turns, turnos);
    previa.source = origen;
    sincronizarEspejo(fighter);
    return previa;
  }

  const estado: ActiveStatus = { kind, turns: turnos, magnitude: magnitud, source: origen };

  if (info.stat) {
    const actual = fighter.modifiers[info.stat] ?? 1;
    const factor = info.up ? 1 + magnitud : Math.max(0.25, 1 - magnitud);
    fighter.modifiers[info.stat] = Number((actual * factor).toFixed(3));
    estado.revert = { [info.stat]: actual } as Partial<Record<StatKey, number>>;
  }

  fighter.statuses.push(estado);
  sincronizarEspejo(fighter);
  return estado;
}

/** Quita un estado y deshace lo que puso. */
export function clearStatus(fighter: Fighter, kind: StatusKind): void {
  const i = fighter.statuses.findIndex((s) => s.kind === kind);
  if (i === -1) return;

  const estado = fighter.statuses[i]!;
  if (estado.revert) {
    for (const [stat, valor] of Object.entries(estado.revert) as [StatKey, number][]) {
      fighter.modifiers[stat] = valor;
    }
  }

  fighter.statuses.splice(i, 1);
  sincronizarEspejo(fighter);
}

/**
 * Vuelve a llenar `status` y `statusTurns`.
 *
 * Son un espejo de la lista para el código que ya existía y para los tests. Se
 * reescriben SIEMPRE desde `statuses`, nunca al revés: si los dos se escribieran
 * por separado acabarían diciendo cosas distintas, y el panel de efectos
 * enseñaría un estado que el motor no está aplicando.
 *
 * Si hay varios estados de control a la vez, el espejo muestra el primero. El
 * motor consulta la lista entera, así que el espejo es solo para pintar y para
 * el `switch` antiguo.
 */
export function sincronizarEspejo(fighter: Fighter): void {
  const control = fighter.statuses.find((s) => isControl(s.kind));

  fighter.status = control?.kind ?? (fighter.statuses.length > 0 ? fighter.statuses[0]!.kind : 'ok');
  fighter.statusTurns = control?.turns ?? 0;
}

// ---------------------------------------------------------------- ciclo ----

/** Un estado con este nombre está activo. */
export function hasStatus(fighter: Fighter, kind: StatusKind): boolean {
  return fighter.statuses.some((s) => s.kind === kind);
}

/** Cuántos turnos le quedan; `Infinity` si no caduca. */
export function turnsLeft(fighter: Fighter, kind: StatusKind): number {
  const estado = fighter.statuses.find((s) => s.kind === kind);
  if (!estado) return 0;
  return estado.turns === 0 ? Infinity : estado.turns;
}

/**
 * ¿Puede actuar este turno?
 *
 * Devuelve `null` si sí, o el estado que lo impide.
 *
 * `chance` recibe la probabilidad y devuelve el resultado: se PASA, no se usa
 * directamente, por una razón concreta. Una comprobación no debe gastar azar.
 * Si esta función llamara a un generador por su cuenta, mirar la misma pantalla
 * dos veces podía devolver dos cosas distintas —"está paralizado" y "puede
 * actuar"— y el jugador vería un botón que se activaba a veces sin explicación.
 *
 * La parálisis se sortea con su probabilidad, y por eso es una amenaza de verdad
 * en vez de un "no te mueves" más como el sueño.
 */
export function bloqueo(
  fighter: Fighter,
  chance: (p: number) => boolean,
): StatusKind | null {
  for (const estado of fighter.statuses) {
    const info = STATUS_INFO[estado.kind];
    if (info.control === 'siempre') return estado.kind;
    if (info.control === 'probabilidad' && chance(info.chance ?? 0.5)) return estado.kind;
  }
  return null;
}

/** PV que le quitan los estados continuos al cerrar el turno. */
export function residualDamage(fighter: Fighter): { kind: StatusKind; amount: number } | null {
  let peor: { kind: StatusKind; amount: number } | null = null;

  for (const estado of fighter.statuses) {
    const ratio = RESIDUAL_RATIO[estado.kind];
    if (ratio === undefined) continue;

    // `magnitude` es la potencia pedida por el movimiento; si no la pidió, es el
    // ratio del catálogo. En ambos casos el daño sale de aquí.
    const factor = estado.magnitude > 0 ? estado.magnitude : ratio;
    const amount = Math.max(1, Math.floor(fighter.stats.hp * factor));

    if (!peor || amount > peor.amount) peor = { kind: estado.kind, amount };
  }

  return peor;
}

/** Cuánto absorbe el escudo de un golpe. Devuelve lo que pasa de largo. */
export function absorbirEscudo(fighter: Fighter, damage: number): { absorbido: number; pasa: number } {
  if (fighter.shield <= 0) return { absorbido: 0, pasa: damage };

  const absorbido = Math.min(fighter.shield, damage);
  fighter.shield -= absorbido;

  if (fighter.shield <= 0) {
    fighter.shield = 0;
    // El escudo se acaba entero, así que sale de la lista.
    const i = fighter.statuses.findIndex((s) => s.kind === 'escudo');
    if (i !== -1) fighter.statuses.splice(i, 1);
  }

  sincronizarEspejo(fighter);
  return { absorbido, pasa: damage - absorbido };
}

/**
 * Caduca lo que toca y descuenta los cooldowns.
 *
 * Se llama UNA vez por turno, al cerrarlo. El orden está escogido a propósito:
 *
 * 1. Primero caducan los estados, y al caducar deshacen sus modificadores.
 * 2. Después se aplica el daño continuo, sobre el Digimon ya sin buffs.
 *
 * Al revés, un Digimon con "Defensa ↑" withstandiría un tick más de quemadura
 * del que debería, y el jugador vería un número que no cuadra con nada.
 */
export interface TickResult {
  /** Estados que se quedaron sin turnos. */
  expirados: StatusKind[];
  /** Estado continuo que hizo daño, si hizo. */
  residual: { kind: StatusKind; amount: number } | null;
}

export function tickStatuses(
  fighter: Fighter,
  onExpire?: (kind: StatusKind) => void,
): TickResult {
  const expirados: StatusKind[] = [];

  for (let i = fighter.statuses.length - 1; i >= 0; i--) {
    const estado = fighter.statuses[i]!;

    // El escudo se governs por PV, no por turnos.
    if (estado.kind === 'escudo') continue;
    if (estado.turns === 0) continue;

    estado.turns -= 1;
    if (estado.turns > 0) continue;

    clearStatus(fighter, estado.kind);
    expirados.push(estado.kind);
    onExpire?.(estado.kind);
  }

  sincronizarEspejo(fighter);

  const residual = fighter.hp > 0 ? residualDamage(fighter) : null;
  return { expirados, residual };
}

/** Los cooldowns bajan al empezar el turno de quien los usa. */
export function tickCooldowns(fighter: Fighter): void {
  for (const key of Object.keys(fighter.cooldowns)) {
    const restante = fighter.cooldowns[key]!;
    if (restante <= 0) {
      delete fighter.cooldowns[key];
      continue;
    }
    fighter.cooldowns[key] = restante - 1;
  }
}

/**
 * ¿Se puede usar este movimiento ahora?
 *
 * Tres motivos, y los tres son los mismos que ve el jugador en la pantalla: no
 * hay energía, está en cooldown, o el Digimon no puede actuar. La función
 * devuelve el número de turnos que faltan en vez de un `true`, porque el panel de
 * habilidades pinta "⏱️ 2" al lado del botón y necesita el número.
 */
export function moveUsable(fighter: Fighter, move: MoveDef): { ok: boolean; motivo: string | null; espera: number } {
  if (fighter.hp <= 0) {
    return { ok: false, motivo: `${fighter.name} ha caído.`, espera: 0 };
  }

  const bloqueante = bloqueo(fighter, () => false);
  if (bloqueante) {
    return { ok: false, motivo: `${fighter.name} está ${STATUS_INFO[bloqueante].label.toLowerCase()}.`, espera: 0 };
  }

  if (move.energyCost > fighter.energy) {
    return { ok: false, motivo: `Faltan ${move.energyCost - fighter.energy}⚡.`, espera: 0 };
  }

  const espera = enEspera(fighter, move.key);
  if (espera > 0) {
    return { ok: false, motivo: `Enfriando: ${espera} turno(s).`, espera };
  }

  return { ok: true, motivo: null, espera: 0 };
}

/**
 * Los movimientos que el Digimon puede usar AHORA, con el motivo de los que no.
 *
 * Lo que se calcula una vez y se pinta en la lista de habilidades, en vez de
 * recalcularse en cada botón. La diferencia importa: si la interfaz decidiera por
 * su cuenta, un botón podría verse habilitado y el motor lo rechazar, que es la
 * forma más frustrante de jugar.
 */
export function movimientosUsables(
  fighter: Fighter,
  movimientos: MoveDef[],
): { move: MoveDef; ok: boolean; motivo: string | null; espera: number }[] {
  return movimientos.map((move) => ({ move, ...moveUsable(fighter, move) }));
}

/** ¿Se puede usar este movimiento ahora? Sin comprobar bloqueos. */
export function enEspera(fighter: Fighter, moveKey: string): number {
  return fighter.cooldowns[moveKey] ?? 0;
}