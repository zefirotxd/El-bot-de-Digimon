import type { CombatRecord } from './types.js';

/**
 * Telemetría de combate.
 *
 * El motor lleva aquí lo que cada Digimon ha hecho, para que al final se pueda
 * decir "Agumon hizo 482 de daño, 2 críticos y estuvo 9 turnos activo, MVP" en
 * vez de solo "ganaste 200 EXP".
 *
 * DÓNDE ESTÁ LA CUENTA importa, y hay una tentación evidente que hay que
 * rechazar: contar al cerrar el combate, recorriendo el registro de eventos. Sería
 * más corto. Sería también un segundo motor con las mismas reglas, y en cuanto
 * una cuenta no cuadre con la otra el análisis mintiendo. Aquí se cuenta EN EL
 * PUNTO donde la cosa pasa, que es el único sitio donde los datos son ciertos.
 *
 * Por eso estas funciones no devuelven nada ni deciden: solo anotan. Quien llama
 * es el motor, y ya sabe qué acaba de pasar.
 */

/** Una cuenta a cero. */
export function recordInicial(): CombatRecord {
  return {
    dealt: 0,
    taken: 0,
    healed: 0,
    shielded: 0,
    skills: 0,
    landed: 0,
    missed: 0,
    crits: 0,
    effective: 0,
    combos: 0,
    turnsActive: 0,
    turnsBlocked: 0,
    switchesIn: 0,
  };
}

/** Suma dos cuentas. Para un Digimon que vuelve a entrar tras un cambio. */
export function sumarRecords(a: CombatRecord, b: CombatRecord): CombatRecord {
  return {
    dealt: a.dealt + b.dealt,
    taken: a.taken + b.taken,
    healed: a.healed + b.healed,
    shielded: a.shielded + b.shielded,
    skills: a.skills + b.skills,
    landed: a.landed + b.landed,
    missed: a.missed + b.missed,
    crits: a.crits + b.crits,
    effective: a.effective + b.effective,
    combos: a.combos + b.combos,
    turnsActive: a.turnsActive + b.turnsActive,
    turnsBlocked: a.turnsBlocked + b.turnsBlocked,
    switchesIn: a.switchesIn + b.switchesIn,
  };
}

/**
 * El MVP de un equipo.
 *
 * Se decide por daño, y no por "cuántas cosas hizo". Es lo que el jugador espera
 * cuando ve una estrella: el que pegó. Los_curanderos que no hacen daño quedan
 * fuera, y a propósito: un MVP que solo cura no es el que se señala en una pelea.
 *
 * Los empates se rompen por daño recibido ASCENDENTE: entre dos Digimon que
 * hicieron lo mismo, el que recibió más es el que más se_la_jugó.
 *
 * Devuelve `null` si no hay nada que decidir, para que quien lo pinte pueda
 * omitir la sección en vez de inventar un ganador.
 */
export function mvpDe(
  candidatos: { uid: string; nombre: string; record: CombatRecord }[],
): { uid: string; nombre: string; record: CombatRecord } | null {
  const vivos = candidatos.filter((c) => c.record.skills > 0 || c.record.dealt > 0);
  if (vivos.length === 0) return null;

  let mejor = vivos[0]!;

  for (const c of vivos.slice(1)) {
    if (c.record.dealt > mejor.record.dealt) {
      mejor = c;
    } else if (
      c.record.dealt === mejor.record.dealt &&
      c.record.taken > mejor.record.taken
    ) {
      mejor = c;
    }
  }

  return mejor;
}

/**
 * Precision de acierto, en porcentaje.
 *
 * Devuelve 0 si nunca se usó un movimiento. Sin ese caso, un Digimon que solo
 * seofeude estados daría 0% de precisión y parecería que fallaba todo, cuando en
 * realidad nunca intentó golpear.
 */
export function precision(record: CombatRecord): number {
  const intentos = record.landed + record.missed;
  if (intentos === 0) return 0;
  return Math.round((record.landed / intentos) * 100);
}

/**
 * Un "momento" de la pelea: algo que el jugador querrá recordar.
 *
 * Se detecta aquí y no en la interfaz porque tiene que ser la MISMA definición
 * para el combate en vivo y para el resumen, y para los logros. Si la GUI lo
 * calculara, el resumen y el logro dirían cosas distintas sobre la misma pelea.
 *
 * No se guarda ningún estado: es una función pura del estado, que es lo que
 * permite recalcular el análisis de una pelea vieja sin haber guardado nada.
 */
export interface Momento {
  key: string;
  emoji: string;
  titulo: string;
  detalle: string;
  /** Cuanto más alto, másruvoso. Para ordenar. */
  peso: number;
}

/** Todos los momentos de un combate ya terminado. */
export function momentosDe(input: {
  jugador: { nombre: string; activo: { name: string } };
  rival: { nombre: string };
  turno: number;
  resultado: 'victoria' | 'derrota' | 'huida';
  combatants: { nombre: string; record: CombatRecord; hpRatio: number }[];
}): Momento[] {
  const momentos: Momento[] = [];

  const masDano = [...input.combatants].sort((a, b) => b.record.dealt - a.record.dealt)[0];

  // --- último golpe --------------------------------------------------------
  // Se detecta por el PV final relative al máximo, no por el daño: "ganaste con
  // un Digimon al 5%" no significa que pegara mucho, sino que llegó vivo.
  for (const c of input.combatants) {
    if (input.resultado !== 'victoria') continue;
    if (c.hpRatio > 0.05) continue;

    momentos.push({
      key: 'ultimo-golpe',
      emoji: '🏆',
      titulo: 'Último golpe',
      detalle: `${c.nombre} ganó con ${Math.round(c.hpRatio * 100)}% de PV.`,
      peso: 90,
    });
  }

  // --- al límite -----------------------------------------------------------
  if (masDano && masDano.hpRatio < 0.15 && masDano.record.dealt > 0) {
    momentos.push({
      key: 'al-limite',
      emoji: '💔',
      titulo: 'Al límite',
      detalle: `${masDano.nombre} hizo ${masDano.record.dealt} de daño con ${Math.round(masDano.hpRatio * 100)}% de PV.`,
      peso: 70,
    });
  }

  // --- combo ---------------------------------------------------------------
  for (const c of input.combatants) {
    if (c.record.combos < 1) continue;
    momentos.push({
      key: 'combo',
      emoji: '🔥',
      titulo: 'Combo',
      detalle: `${c.nombre} encadenó ${c.record.combos} combo(s).`,
      peso: 50 + c.record.combos * 5,
    });
  }

  // --- criticos ------------------------------------------------------------
  for (const c of input.combatants) {
    if (c.record.crits < 3) continue;
    momentos.push({
      key: 'criticos',
      emoji: '💥',
      titulo: 'Certero',
      detalle: `${c.nombre} acertó ${c.record.crits} críticos.`,
      peso: 45,
    });
  }

  // --- sin daño ------------------------------------------------------------
  const clean = input.combatants.find((c) => c.record.taken === 0 && c.record.dealt > 0);
  if (clean) {
    momentos.push({
      key: 'intacto',
      emoji: '🛡️',
      titulo: 'Intacto',
      detalle: `${clean.nombre} no recibió ni un punto de daño.`,
      peso: 65,
    });
  }

  // --- revancha ------------------------------------------------------------
  if (input.resultado === 'derrota' && masDano && masDano.record.dealt > 0) {
    momentos.push({
      key: 'revancha',
      emoji: '💪',
      titulo: 'Se llegará',
      detalle: `${masDano.nombre} hizo ${masDano.record.dealt} de daño antes de caer.`,
      peso: 30,
    });
  }

  // --- fuga ----------------------------------------------------------------
  if (input.resultado === 'huida') {
    momentos.push({
      key: 'huida',
      emoji: '🏃',
      titulo: 'Estrategia',
      detalle: `${input.rival.nombre} no te dio opciones.`,
      peso: 20,
    });
  }

  return momentos.sort((a, b) => b.peso - a.peso);
}

/** Una línea por momento, para pintar. */
export function lineaDeMomento(m: Momento): string {
  return `${m.emoji} **${m.titulo}** — ${m.detalle}`;
}