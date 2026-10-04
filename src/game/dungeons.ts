import type { Biome } from './dungeonMap.js';
import { BOSSES } from './bosses.js';

/**
 * Mazmorras: salas encadenadas con un jefe al final.
 *
 * La diferencia con "pelear tres veces seguidas" es que el progreso se guarda
 * SALA A SALA. Si abandonas en la tercera de cinco, vuelves a la tercera con
 * lo que ya te llevaste. Sin eso no es una mazmorra: es una lista de combates
 * con un nombre encima.
 *
 * La recompensa se escala por CONTRIBUCIÓN: qué porcentaje de la vida del jefe
 * te has llevado tú. Es la traducción honesta de "premiar al que más pega" en un
 * juego donde nadie comparte el mismo jefe al mismo tiempo.
 */

export type RoomKind = 'combate' | 'elite' | 'jefe';

export interface RoomDef {
  key: string;
  name: string;
  emoji: string;
  kind: RoomKind;
  /** Plantilla de entrenador rival. Null si es un jefe. */
  trainer: string | null;
  /** Clave de `BOSSES` si la sala es de jefe. */
  boss: string | null;
  /** Plantillas de salvajes que pueden salir en esta sala. */
  wildKeys: string[];
  description: string;
}

export interface DungeonDef {

  /**
   * Qué tipo de mazmorra es. Cambia la mezcla de casillas, los peligros y la
   * rareza de los encuentros, no solo el decorado.
   */
  bioma: Biome;
  /** Cuántos pisos tiene. El primero es donde se entra. */
  pisos: number;
  /** El jefe del último piso. Es el que cierra la expedición. */
  jefeFinal: string | null;
  /**
   * Cuánta energía da el jugador al empezar una expedición.
   *
   * No es la misma que `energyCost`: esta es la DOTACIÓN de la expedición, y
   * sirve para decidir si se sigue explorando. Mezclarlas hacía que "entrar"
   * pareciera distinto de "quedarte sin energía".
   */
  energiaExpedicion: number;

  /**
   * Las salas lineales de siempre.
   *
   * Se conservan porque el servicio viejo las usa, y porque el jefe final
   * sigue saliendo de aquí: la mazmorra por casillas hereda el contenido, no
   * lo sustituye.
   */
  key: string;
  name: string;
  emoji: string;
  /** Nivel a partir del cual se puede entrar. */
  minLevel: number;
  /** Nivel al que la mazmorra se queda corta. */
  maxLevel: number;
  /** Energía que cuesta entrar. */
  energyCost: number;
  /** Intentos por día. */
  dailyAttempts: number;
  rooms: RoomDef[];
  /** Materiales de fabricación que salen al completar. */
  materials: Record<string, number>;
  /** DigiBytes de la primera pasada. */
  firstClearDigibytes: number;
  lore: string;
}

export const DUNGEONS: Record<string, DungeonDef> = {
  forja_de_ceniza: {
    bioma: 'volcan',
    pisos: 4,
    jefeFinal: 'ceniza_viva',
    energiaExpedicion: 14,
    key: 'forja_de_ceniza',
    name: 'Forja de Ceniza',
    emoji: '🌋',
    minLevel: 26,
    maxLevel: 60,
    energyCost: 3,
    dailyAttempts: 3,
    rooms: [
      {
        key: 'umbral',
        name: 'Umbral de ceniza',
        emoji: '🚪',
        kind: 'combate',
        trainer: 'veterano_hielo',
        boss: null,
        wildKeys: ['gabumon', 'paulmon', 'gatomon'],
        description: 'La ceniza entra por la puerta y no vuelve a salir.',
      },
      {
        key: 'conducto',
        name: 'Conducto de vapor',
        emoji: '♨️',
        kind: 'elite',
        trainer: 'guerrero_viento',
        boss: null,
        wildKeys: ['garurumon', 'birdramon'],
        description: 'El suelo quema y nadie ha puesto una baldosa.',
      },
      {
        key: 'horno',
        name: 'El horno',
        emoji: '🔥',
        kind: 'jefe',
        trainer: null,
        boss: 'ceniza_viva',
        wildKeys: [],
        description: 'La montaña tenía un corazón y llevaba mucho tiempo quieta.',
      },
    ],
    materials: { cromonizador: 1 },
    firstClearDigibytes: 2500,
    lore: 'Los Deleted articles no se pierden: se cocinan.',
  },

  catedral_luz: {
    bioma: 'ruinas',
    pisos: 4,
    jefeFinal: 'guardiana_luz',
    energiaExpedicion: 14,
    key: 'catedral_luz',
    name: 'Catedral de la Luz',
    emoji: '🕊️',
    minLevel: 32,
    maxLevel: 70,
    energyCost: 4,
    dailyAttempts: 3,
    rooms: [
      {
        key: 'nave',
        name: 'La nave central',
        emoji: '⛪',
        kind: 'combate',
        trainer: 'estratega_luz',
        boss: null,
        wildKeys: ['angemon', 'gatomon', 'togemon'],
        description: 'Los bancos están llenos y nadie se sienta.',
      },
      {
        key: 'cripta',
        name: 'Cripta',
        emoji: '🕯️',
        kind: 'elite',
        trainer: 'veterano_ultimate',
        boss: null,
        wildKeys: ['angemon', 'metalgreymon'],
        description: 'Cada vela tarda lo mismo en apagarse.',
      },
      {
        key: 'altar',
        name: 'El altar',
        emoji: '✝️',
        kind: 'jefe',
        trainer: null,
        boss: 'guardiana_luz',
        wildKeys: [],
        description: 'Aquí no se reza. Aquí se rinde cuentas.',
      },
    ],
    materials: { nucleo_datos: 2, espectro_digimon: 1 },
    firstClearDigibytes: 4000,
    lore: 'Construida para venerar algo que acabó contestando.',
  },
};

export function getDungeon(key: string): DungeonDef | undefined {
  return DUNGEONS[key];
}

export function dungeonForLevel(level: number): DungeonDef | null {
  const candidates = Object.values(DUNGEONS).filter((d) => level >= d.minLevel);
  if (candidates.length === 0) return null;
  // La más exigente que todavía te deje entrar: así el nivel alto va a la
  // mazmorra difícil y no se queda en la fácil por costumbre.
  return candidates.reduce((best, d) => (d.minLevel > best.minLevel ? d : best));
}

// ------------------------------------------------------------ contribución ---

/**
 * Fracción de la vida del jefe que se ha llevado el jugador.
 *
 * Es la contribución de verdad en un juego sin multijugador simultáneo: no es
 * "he participado", es "cuánto he hecho yo".
 */
export function contribution(damageDealt: number, bossMaxHp: number): number {
  if (bossMaxHp <= 0) return 0;
  return Math.max(0, Math.min(1, damageDealt / bossMaxHp));
}

export interface ContributionTier {
  /** 1 = completas la mazmorra. */
  ratio: number;
  name: string;
  digibyteFactor: number;
  materialFactor: number;
  emoji: string;
}

/**
 * Escalones de recompensa.
 *
 * El 100% es solo para quien tumbó al jefe. Entre el 40% y el 100% se lleva
 * una parte proporcional tanto de materiales como de DigiBytes: así el que
 * hizo un buen 70% no siente que le robaron, y el que se quedó al 20% se
 * lleva mucho menos. No es un castigo a los débiles, es una escala que refleja
 * lo que has hecho.
 */
export const CONTRIBUTION_TIERS: ContributionTier[] = [
  { ratio: 1, name: 'Jefe abatido', digibyteFactor: 1, materialFactor: 1, emoji: '🏆' },
  { ratio: 0.7, name: 'Casi', digibyteFactor: 0.7, materialFactor: 0.7, emoji: '💪' },
  { ratio: 0.4, name: 'Buen daño', digibyteFactor: 0.5, materialFactor: 0.4, emoji: '👍' },
  { ratio: 0.15, name: 'Aportaste', digibyteFactor: 0.25, materialFactor: 0, emoji: '🤝' },
  { ratio: 0, name: 'Espectador', digibyteFactor: 0, materialFactor: 0, emoji: '👀' },
];

export function tierFor(ratio: number): ContributionTier {
  for (const tier of CONTRIBUTION_TIERS) {
    if (ratio >= tier.ratio) return tier;
  }
  return CONTRIBUTION_TIERS[CONTRIBUTION_TIERS.length - 1]!;
}

/** Escala por el número de salas superadas, para que la última pese más. */
export function roomBonus(roomsCleared: number, totalRooms: number): number {
  if (totalRooms <= 1) return 1;
  return 0.4 + (roomsCleared / totalRooms) * 0.6;
}

// ------------------------------------------------------------- validación ----

/**
 * Comprueba que el catálogo de mazmorras es coherente.
 *
 * Se ejecuta en los tests: una mazmorra que apunte a un jefe inexistente o a una
 * plantilla que no existe rompe el comando en el momento de entrar, no al
 * escribir el catálogo.
 */
export function validateDungeons(
  hasTrainer: (key: string) => boolean,
  hasSpecies: (key: string) => boolean,
): string[] {
  const problems: string[] = [];

  for (const dungeon of Object.values(DUNGEONS)) {
    if (dungeon.rooms.length < 2) {
      problems.push(`${dungeon.name}: una mazmorra de una sala es un combate suelto`);
    }
    if (dungeon.maxLevel <= dungeon.minLevel) {
      problems.push(`${dungeon.name}: rango de niveles incoherente`);
    }
    if (dungeon.energyCost < 1) {
      problems.push(`${dungeon.name}: la energía debe costar algo`);
    }

    const last = dungeon.rooms[dungeon.rooms.length - 1]!;
    if (last.kind !== 'jefe') {
      problems.push(`${dungeon.name}: la última sala debe ser de jefe`);
    }
    if (!last.boss) {
      problems.push(`${dungeon.name}: la sala final no declara jefe`);
    }

    dungeon.rooms.forEach((room, index) => {
      if (room.kind === 'jefe') {
        if (!room.boss) {
          problems.push(`${dungeon.name} / ${room.name}: sala de jefe sin clave de jefe`);
        } else if (!BOSSES[room.boss]) {
          problems.push(`${dungeon.name} / ${room.name}: jefe inexistente "${room.boss}"`);
        }
        if (index !== dungeon.rooms.length - 1) {
          problems.push(
            `${dungeon.name} / ${room.name}: un jefe antes del final rompe el clímax de la mazmorra`,
          );
        }
      } else if (room.trainer && !hasTrainer(room.trainer)) {
        problems.push(`${dungeon.name} / ${room.name}: entrenador inexistente "${room.trainer}"`);
      }

      // Solo las salas normales y elite necesitan rival o salvajes. La de
      // jefe tiene al jefe: exigirle además un entrenador marcaba como
      // inválidas todas las mazmorras del catálogo.
      if (room.kind !== 'jefe' && !room.trainer && !room.wildKeys.length) {
        problems.push(`${dungeon.name} / ${room.name}: no hay ni rival ni salvajes`);
      }

      for (const key of room.wildKeys) {
        if (!hasSpecies(key)) {
          problems.push(`${dungeon.name} / ${room.name}: especie inexistente "${key}"`);
        }
      }
    });
  }

  return problems;
}
