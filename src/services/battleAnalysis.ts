import type { BattleState } from '../game/combat.js';
import { isFainted } from '../game/combat.js';
import { mvpDe, momentosDe, precision, type Momento } from '../game/telemetry.js';
import type { CombatRecord } from '../game/types.js';
import { ESTILO } from '../game/ai.js';
import { resumenCombo } from '../game/combos.js';

/**
 * Análisis de combate, para las pantallas.
 *
 * Es una CAPA DE LECTURA. Todo lo que devuelve sale de `BattleState`, que el motor
 * ha ido llenando. Aquí no se calcula una sola regla: si este módulo decidiera
 * qué Digimon fue el MVP, habría dos definiciones de MVP y la de la pantalla
 * acabaría mandando sobre la del juego.
 *
 * Se separa del `battleFlow` a propósito: aquel decide si una acción se acepta,
 * este solo describe lo que pasó. Mezclarlos haría que leer una pelea modificara
 * la pelea.
 */

/** Una línea de la tabla de análisis. */
export interface LineaAnalisis {
  etiqueta: string;
  valor: string;
  /** `true` si es un número que se puede comparar entre Digimon. */
  numerico: boolean;
}

/** El análisis de un combatiente. */
export interface AnalisisCombatiente {
  uid: string;
  nombre: string;
  especie: string;
  emoji: string;
  nivel: number;
  record: CombatRecord;
  /** 0..1 */
  pvRatio: number;
  caido: boolean;
  precision: number;
  /** Si es el MVP del equipo. */
  mvp: boolean;
  lineas: LineaAnalisis[];
}

/** El análisis entero. */
export interface AnalisisCombate {
  resultado: 'victoria' | 'derrota' | 'huida';
  turnos: number;
  /** Cifras del lado del jugador. */
  dealt: number;
  taken: number;
  jugador: AnalisisCombatiente[];
  rival: AnalisisCombatiente[];
  mvp: AnalisisCombatiente | null;
  momentos: Momento[];
  /** Sinergias que estaban activas, para recordarlas. */
  sinergias: { nombre: string; emoji: string; desc: string }[];
  /** Combo que se completó, si alguno. */
  combo: string;
  /** Estilo del rival, si lo tiene. */
  estiloRival: string;
}

/**
 * Analiza un combate terminado.
 *
 * Devuelve `null` si la pelea no ha acabado todavía, y no una versión a medias:
 * un análisis de una pelea en curso daría cifras que luego se contradicen, y el
 * jugador vería dos números para la misma partida.
 */
export function analizar(state: BattleState): AnalisisCombate | null {
  if (!state.finished) return null;

  // El equipo del jugador: los Digimon que están en reserva no tienen un `Fighter`
  // vivo, así que su historial sale de `state.records`. El activo, además, tiene
  // el suyo en `state.player.record`, que es la MISMA referencia.
  const jugador: AnalisisCombatiente[] = state.party.map((d, i) => {
    const activo = i === state.activeIndex;
    // La cuenta del ACTIVO vive en `state.player.record`, no en
    // `state.records`: esa ranura solo se actualiza al cambiar, así que mientras
    // está en el campo sigue con los ceros del principio. Un `??` no lo
    // arreglaba porque la ranura existe: se crea vacía al montar el combate.
    const record = activo ? state.player.record : state.records[i] ?? recordCero();

    return {
      uid: String(d.id),
      nombre: d.nickname ?? d.species.name,
      emoji: d.species.emoji,
      especie: d.species.name,
      nivel: d.level,
      record,
      pvRatio: activo ? ratio(state.player.hp, state.player.stats.hp) : ratio(d.hp, d.stats.hp),
      caido: activo ? state.player.hp <= 0 : isFainted(state, i),
      precision: precision(record),
      mvp: false,
      lineas: [],
    };
  });

  // El equipo rival son `Fighter`, no `OwnedDigimon`: son copias de combate y no
  // llevan la especie resuelta, así que todo se lee del propio fighter.
  const rival: AnalisisCombatiente[] = state.enemyTeam.map((f) => ({
    uid: f.uid,
    nombre: f.name,
    emoji: f.emoji,
    especie: f.speciesKey,
    nivel: f.level,
    record: f.record,
    pvRatio: ratio(f.hp, f.stats.hp),
    caido: f.hp <= 0,
    precision: precision(f.record),
    mvp: false,
    lineas: [],
  }));

  // El MVP se decide UNA vez, con la misma función que usarán los logros. Si lo
  // calculara la pantalla, el resumen y el logro podrían señalar Digimon
  // distintos en la misma pelea.
  const estrella = mvpDe(
    jugador.map((c) => ({ uid: c.uid, nombre: c.nombre, record: c.record })),
  );

  for (const c of jugador) {
    c.mvp = estrella?.uid === c.uid;
    c.lineas = lineasDe(c.record, c.pvRatio);
  }
  for (const c of rival) c.lineas = lineasDe(c.record, c.pvRatio);

  const mvp = estrella ? jugador.find((c) => c.uid === estrella.uid) ?? null : null;

  const momentos = momentosDe({
    jugador: { nombre: 'Tú', activo: { name: state.player.name } },
    rival: { nombre: state.enemy.name },
    turno: state.turn,
    resultado: state.result ?? 'derrota',
    combatants: [
      ...jugador.map((c) => ({ nombre: c.nombre, record: c.record, hpRatio: c.pvRatio })),
      ...rival.map((c) => ({ nombre: c.nombre, record: c.record, hpRatio: c.pvRatio })),
    ],
  });

  return {
    resultado: state.result ?? 'derrota',
    turnos: state.turn,
    dealt: state.stats.dealt,
    taken: state.stats.taken,
    jugador,
    rival,
    mvp,
    momentos,
    sinergias: state.sinergias.lista.map((s) => ({ nombre: s.name, emoji: s.emoji, desc: s.desc })),
    combo: resumenCombo(state.combo),
    estiloRival: ESTILO[state.personalidad] ?? ESTILO.equilibrado,
  };
}

function ratio(valor: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(1, valor / max)) : 0;
}

/** Construye la línea de un combatiente. */
function combatiente(
  uid: string | number,
  nombre: string,
  emoji: string,
  especie: string,
  nivel: number,
  fighter: { record: CombatRecord } | null,
  state: BattleState,
  caido: boolean,
  hp: number,
  hpMax: number,
): AnalisisCombatiente {
  const record = fighter?.record ?? recordCero();
  const pvRatio = hpMax > 0 ? Math.max(0, hp) / hpMax : 0;
  void state;

  return {
    uid: String(uid),
    nombre,
    emoji,
    especie,
    nivel,
    record,
    pvRatio,
    caido,
    precision: precision(record),
    mvp: false,
    lineas: lineasDe(record, pvRatio),
  };
}

function recordCero(): CombatRecord {
  return {
    dealt: 0, taken: 0, healed: 0, shielded: 0, skills: 0, landed: 0,
    missed: 0, crits: 0, effective: 0, combos: 0, turnsActive: 0,
    turnsBlocked: 0, switchesIn: 0,
  };
}

/**
 * Las líneas de la tabla.
 *
 * Solo se incluye lo que el Digimon hizo. Un Digimon que no se movió tiene tres
 * ceros y no un bloque entero de "0 de daño, 0 de curas, 0 de críticos": la
 * tabla vacía dice "no llegó a actuar" mejor que cinco ceros.
 */
/**
 * Las líneas de la tabla, o una lista VACÍA si el Digimon no llegó a actuar.
 *
 * Se decide aquí, no en la pantalla, porque "no hizo nada" es un dato y no un
 * texto: la pantalla tiene que poder escribirlo como considere —"no llegó a
 * actuar", "se quedó en la reserva"— y el servicio tiene que poder decir que no
 * hay cifras que enseñar.
 *
 * La primera versión metía "Daño causado: 0" y "PV al final: 100%" para un
 * Digimon que salió en el momento de aparecer. No es mentira, pero es ruido: cinco
 * ceros dicen menos que una frase que explica lo que pasó.
 */
function lineasDe(record: CombatRecord, pvRatio: number): LineaAnalisis[] {
  if (record.skills === 0 && record.dealt === 0 && record.healed === 0 && record.shielded === 0) {
    return [];
  }

  const lineas: LineaAnalisis[] = [];
  const n = (v: number) => v.toLocaleString('es');

  lineas.push({ etiqueta: 'Daño causado', valor: n(record.dealt), numerico: true });
  lineas.push({ etiqueta: 'Daño recibido', valor: n(record.taken), numerico: true });

  lineas.push({ etiqueta: 'Habilidades usadas', valor: String(record.skills), numerico: true });

  const intentos = record.landed + record.missed;
  if (intentos > 0) {
    lineas.push({ etiqueta: 'Precisión', valor: `${precision(record)}%`, numerico: true });
  }

  if (record.crits > 0) {
    lineas.push({ etiqueta: 'Críticos', valor: String(record.crits), numerico: true });
  }

  if (record.effective > 0) {
    lineas.push({ etiqueta: 'Golpes super-efectivos', valor: String(record.effective), numerico: true });
  }

  if (record.healed > 0) {
    lineas.push({ etiqueta: 'PV curados', valor: n(record.healed), numerico: true });
  }

  if (record.shielded > 0) {
    lineas.push({ etiqueta: 'Escudo aguantado', valor: n(record.shielded), numerico: true });
  }

  if (record.combos > 0) {
    lineas.push({ etiqueta: 'Combos', valor: String(record.combos), numerico: true });
  }

  if (record.turnsActive > 0) {
    lineas.push({ etiqueta: 'Turnos activo', valor: String(record.turnsActive), numerico: true });
  }

  if (record.turnsBlocked > 0) {
    lineas.push({ etiqueta: 'Turnos bloqueado', valor: String(record.turnsBlocked), numerico: true });
  }

  if (record.switchesIn > 0) {
    lineas.push({ etiqueta: 'Cambios', valor: String(record.switchesIn), numerico: true });
  }

  lineas.push({
    etiqueta: 'PV al final',
    valor: `${Math.round(pvRatio * 100)}%`,
    numerico: true,
  });

  return lineas;
}

export { ESTILO, mvpDe, momentosDe, resumenCombo };