import type { Element, Fighter, OwnedDigimon, SpeciesDef } from './types.js';
import { getSpecies, SPECIES } from './species.js';

/**
 * Sinergias de equipo.
 *
 * Hasta ahora la familia de un Digimon era decorativa: salía en la ficha del
 * bestiario y no cambiaba nada. Esto la convierte en mecánica.
 *
 * Dos reglas que lo mantienen honesto:
 *
 * 1. **El bonus se calcula con el equipo que va a pelear**, no con la que el
 *    jugador tiene guardada. Si no, cambiar el equipo en la GUI no cambiaría
 *    nada hasta el siguiente combate, que es justo la trampa de la que se queja
 *    la gente cuando "la sinergia no funciona".
 * 2. **Cada sinergia se aplica UNA vez**, independently de cuántos Digimon la
 *    formen. Meter tres Digimon de fuego no debe dar el triple: daría por subir
 *    el daño de forma arbitraria y el mejor equipo siempre sería el mismo.
 */

/** Cómo se modifica una estadística por una sinergia. */
export interface SynergyStatBoost {
  stat: 'attack' | 'defense' | 'speed' | 'hp';
  /** Multiplicador: 0.08 = +8%. */
  factor: number;
}

export interface SynergyDef {
  key: string;
  name: string;
  emoji: string;
  desc: string;
  /** Cuántos Digimon del equipo hacen falta. */
  min: number;
  /** Cómo se comprueba. */
  test: (firma: FirmaEquipo) => number;
  boosts: SynergyStatBoost[];
  /** Bonificación al daño, independiente de las estadísticas. */
  damage?: number;
  /** Bonificación a la velocidad de crítico. */
  critRate?: number;
}

/** Lo que se necesita para evaluar sinergias sin arrastrar al Fighter. */
export interface FirmaEquipo {
  species: SpeciesDef[];
  elements: Element[];
  /**
   * Claves de familia que tienen al menos un miembro. ESTA SÍ se deduplica: es
   * una lista de conjuntos, no un recuento.
   */
  familias: string[];
  /** Cuántos Digimon hay en total. */
  tamano: number;
}

/**
 * LA FAMILIA DE UN DIGIMON, CUANDO EL DATO NO VIENE DE LA WIKI.
 *
 * El importador de la wiki trae la familia canónica, pero solo para 34 de las 35
 * especies y a veces en formato texto ("Dragón's Roar" con apóstrofos y todo).
 * Estas constantes son el respaldo: sin ellas, la mitad del bestiario no podría
 * activar ninguna sinergia y el jugador vería un requisito que no se cumple nunca.
 */
const FAMILIA_POR_DEFECTO: Record<string, string> = {
  // Reptil
  agumon: 'Núcleo Dragón',
  greymon: 'Núcleo Dragón',
  metalgreymon: 'Núcleo Dragón',
  war_greymon: 'Núcleo Dragón',
  flamedramon: 'Núcleo Dragón',
  // Nieve
  gabumon: 'Ígneo',
  garurumon: 'Ígneo',
  weregarurumon: 'Ígneo',
  // Compuerta
  patamon: 'Santo',
  angemon: 'Santo',
  holyangemon: 'Santo',
  magnitude: 'Santo',
  // Insectoide
  kunemon: 'Infecto',
 numemon: 'Infecto',
  // Monstruo
  devimon: 'Oscuro',
  demimeramon: 'Oscuro',
  // Máquina
  kunemon_robot: 'Máquina',
  // Dragón
  meramon: 'Furia Bestial',
  birdramon: 'Furia Bestial',
  kuwagamon: 'Furia Bestial',
  // Siembra
  etemon: 'Compuerta',
};

/** Normaliza una familia de la wiki a un formato comparable. */
export function normalizarFamilia(familia: string): string {
  return familia
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ');
}

/** La familia de una especie: la de la wiki si la hay, si no la del respaldo. */
export function familiaDe(key: string): string {
  const entry = SPECIES[key];
  const wiki = (entry as unknown as { family?: string })?.family;
  return wiki ?? FAMILIA_POR_DEFECTO[key] ?? 'Desconocida';
}

/** Reúne lo necesario para evaluar el equipo. */
/**
 * Reúne lo necesario para evaluar el equipo.
 *
 * Acepta las dos formas porque las necesitan los dos sitios: quien va a
 * GUARDAR el equipo tiene `OwnedDigimon`, y quien ya tiene el combate montado
 * tiene `Fighter`. Que sea el mismo código es lo que evita que la pantalla
 * de formación y el combateMillisimoarse sobre qué sinergia hay.
 */
export function firmarEquipo(digimones: (OwnedDigimon | Fighter)[]): FirmaEquipo {
  const species: SpeciesDef[] = [];
  const elements: Element[] = [];
  const familias: string[] = [];

  for (const d of digimones) {
    // `OwnedDigimon` trae la especie entera; `Fighter` solo la clave, porque
    // guarda el mínimo para el combate.
    const sp = 'species' in d ? d.species : getSpecies(d.speciesKey);
    if (!sp) continue;

    species.push(sp);
    // SIN deduplicar, a propósito. Las sinergias cuentan cuántos Digimon
    // comparten elemento, y contar sobre una lista sin repetir es contar mal:
    // con tres de fuego sobre una lista deduplicada salía UNO, y la sinergia
    // no podía activarse nunca. Se ve en `SINERGIAS`, que hace
    // `elements.filter(...)` justamente para contar Digimon.
    for (const e of sp.elements) elements.push(e);

    const f = familiaDe(sp.key);
    if (!familias.includes(f)) familias.push(f);
  }

  return { species, elements, familias, tamano: digimones.length };
}

/**
 * Las sinergias.
 *
 * Los multiplicadores son PEQUEÑOS a propósito. Una sinergia tiene que cambiar la
 * decisión de qué meter en el equipo, no decidirla: si el bonus de fuego fuera
 * del 30%, el mejor equipo sería siempre "los tres de fuego" y la elección
 * interesting desaparece.
 */
export const SINERGIAS: SynergyDef[] = [
  {
    key: 'fuego',
    name: 'Equipo de Fuego',
    emoji: '🔥',
    desc: 'Tres Digimon comparten el elemento Fuego.',
    min: 3,
    test: (f) => f.elements.filter((e) => e === 'fuego').length,
    boosts: [],
    damage: 0.08,
  },
  {
    key: 'agua',
    name: 'Marea',
    emoji: '🌊',
    desc: 'Tres Digimon comparten el elemento Agua.',
    min: 3,
    test: (f) => f.elements.filter((e) => e === 'agua').length,
    boosts: [],
    damage: 0.06,
    critRate: 0.03,
  },
  {
    key: 'rayo',
    name: 'Tormenta',
    emoji: '⚡',
    desc: 'Tres Digimon comparten el elemento Rayo.',
    min: 3,
    test: (f) => f.elements.filter((e) => e === 'rayo').length,
    boosts: [{ stat: 'speed', factor: 0.1 }],
    damage: 0.05,
  },
  {
    key: 'oscuridad',
    name: 'Sombra',
    emoji: '🌑',
    desc: 'Tres Digimon comparten la oscuridad.',
    min: 3,
    test: (f) => f.elements.filter((e) => e === 'oscuridad').length,
    boosts: [{ stat: 'attack', factor: 0.08 }],
    damage: 0.07,
  },
  {
    key: 'familia',
    name: 'Lazo de Familia',
    emoji: '🧬',
    desc: 'Dos Digimon son de la misma familia.',
    min: 2,
    test: (f) => {
      // Cuenta la familia más repetida, sin contar Digimon sueltos: con tres
      // Digimon de tres familias distintas NO hay lazo, y con eso se evita que
      // cualquier equipo de tres lo active.
      const cuenta = new Map<string, number>();
      for (const d of f.species) {
        const fam = familiaDe(d.key);
        cuenta.set(fam, (cuenta.get(fam) ?? 0) + 1);
      }
      return Math.max(0, ...cuenta.values());
    },
    boosts: [{ stat: 'attack', factor: 0.06 }],
  },
  {
    key: 'atributo',
    name: 'Unidad de Atributo',
    emoji: '⚔️',
    desc: 'Tres Digimon del mismo atributo.',
    min: 3,
    test: (f) => {
      const cuenta = new Map<string, number>();
      for (const s of f.species) {
        cuenta.set(s.attribute, (cuenta.get(s.attribute) ?? 0) + 1);
      }
      return Math.max(0, ...cuenta.values());
    },
    boosts: [{ stat: 'hp', factor: 0.1 }],
  },
  {
    key: 'equipo_completo',
    name: 'Equipo Completo',
    emoji: '🛡️',
    desc: 'Tres Digimon en el equipo.',
    min: 3,
    test: (f) => f.tamano,
    boosts: [{ stat: 'defense', factor: 0.05 }],
  },
];

/** Una sinergia activa, ya resuelta a números. */
export interface SinergiaActiva extends SynergyDef {
  /** Cuántos Digimon la activan de verdad. */
  miembros: number;
  /** El bonus total, ya aplicado. */
  damage: number;
  critRate: number;
}

/**
 * Qué sinergias tiene este equipo.
 *
 * Es una FUNCIÓN PURA del equipo: no toca el combate ni la base de datos. La
 * llama quien va a construir el estado, y también la pantalla de formación, que
 * quiere enseñar el bonus ANTES de pelear. Que las dos saw lo mismo es lo que
 * hace que el jugador pueda decidir con información y no adivinando.
 */
export function sinergiasDe(digimones: (OwnedDigimon | Fighter)[]): SinergiaActiva[] {
  const firma = firmarEquipo(digimones);
  const activas: SinergiaActiva[] = [];

  for (const def of SINERGIAS) {
    const miembros = def.test(firma);
    if (miembros < def.min) continue;

    activas.push({
      ...def,
      miembros,
      damage: def.damage ?? 0,
      critRate: def.critRate ?? 0,
    });
  }

  return activas;
}

/** Totales de todas las sinergias, ya sumados. */
export interface SynergyTotals {
  damage: number;
  critRate: number;
  attack: number;
  defense: number;
  speed: number;
  hp: number;
  /** Las sinergias, para pintarlas una a una. */
  lista: SinergiaActiva[];
}

export function totalesSinergia(digimones: (OwnedDigimon | Fighter)[]): SynergyTotals {
  const activas = sinergiasDe(digimones);

  const totales: SynergyTotals = {
    damage: 0,
    critRate: 0,
    attack: 0,
    defense: 0,
    speed: 0,
    hp: 0,
    lista: activas,
  };

  for (const s of activas) {
    totales.damage += s.damage;
    totales.critRate += s.critRate;

    for (const b of s.boosts) {
      totales[b.stat] += b.factor;
    }
  }

  return totales;
}

/** Texto corto de un bonus, para el panel. */
export function textoDeStat(stat: string): string {
  switch (stat) {
    case 'attack':
      return 'ATQ';
    case 'defense':
      return 'DEF';
    case 'speed':
      return 'VEL';
    case 'hp':
      return 'PV';
    default:
      return stat.toUpperCase();
  }
}