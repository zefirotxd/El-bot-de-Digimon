/**
 * Misiones y logros.
 *
 * REGLA que manda sobre todo lo demás: **una recompensa se reclama una vez**.
 *
 * El patrón `_completed` en BD con clave primaria (trainer, misión, periodo) es
 * lo que impide farmear. Una misión sin eso es un botón que paga infinitamente,
 * y en cuanto sale a la gente encuentra la primera forma de repetirla.
 *
 * Los periodos se calculan por fecha, no por contador: la misión diariacaduca
 * sola al día siguiente sin ningún proceso que limpiarla, y un reinicio del bot
 * no reinicia el progreso de nadie.
 */

/** Lo que se puede contar. Es la intersección entre misiones y logros. */
export type Metric =
  | 'capturas'
  | 'victorias'
  | 'exploraciones'
  | 'evoluciones'
  | 'regresiones'
  | 'jefes'
  | 'mazmorras'
  | 'salas'
  | 'incursiones'
  | 'pvp_victorias'
  | 'dano_jefe'
  | 'mejoras'
  | 'formas_desbloqueadas'
  | 'nivel_maximo'
  | 'digimon_capturados'
  | 'partidas'
  | 'dias_activos';

export const METRIC_NAMES: Record<Metric, string> = {
  capturas: 'capturas',
  victorias: 'victorias',
  exploraciones: 'exploraciones',
  evoluciones: 'evoluciones',
  regresiones: 'regresiones',
  jefes: 'jefes derrotados',
  mazmorras: 'mazmorras completadas',
  salas: 'salas superadas',
  incursiones: 'incursiones',
  pvp_victorias: 'victorias PvP',
  dano_jefe: 'daño a jefes',
  mejoras: 'piezas mejoradas',
  formas_desbloqueadas: 'formas descubiertas',
  nivel_maximo: 'nivel máximo',
  digimon_capturados: 'Digimon distintos',
  partidas: 'combates jugados',
  dias_activos: 'días activos',
};

/** Las métricas que se cuentan "de golpe" desde una consulta, no un contador. */
export const SNAPSHOT_METRICS: Metric[] = [
  'nivel_maximo',
  'digimon_capturados',
  'formas_desbloqueadas',
  'dias_activos',
];

export type Period = 'diaria' | 'semanal';

export interface Reward {
  digibytes: number;
  /** Objetos: clave -> cantidad. */
  items?: Record<string, number>;
  /** Recompensa exclusiva: la clave de un trofeo o pieza. */
  exclusive?: { kind: 'titulo' | 'equipo'; key: string; name: string; emoji: string };
}

export interface MissionDef {
  id: string;
  name: string;
  /** Qué hay que hacer, en una línea. */
  description: string;
  metric: Metric;
  target: number;
  period: Period;
  reward: Reward;
}

/**
 * Misiones.
 *
 * Las diarias son cortas a propósito: un objetivo de 5 se cumple jugando, uno de
 * 50 se cumple con el calendario y deja de ser una decisión. Las semanales
 * piden más porque su recompensa también es mayor.
 */
export const MISSIONS: MissionDef[] = [
  // ------------------------------------------------------------- diarias ---
  {
    id: 'd_captura_3',
    name: 'Recolector',
    description: 'Captura 3 Digimon salvajes.',
    metric: 'capturas',
    target: 3,
    period: 'diaria',
    reward: { digibytes: 300, items: { pocion: 2 } },
  },
  {
    id: 'd_victorias_5',
    name: 'Cinco depulla',
    description: 'Gana 5 combates en cualquier modo.',
    metric: 'victorias',
    target: 5,
    period: 'diaria',
    reward: { digibytes: 400, items: { tonico: 1 } },
  },
  {
    id: 'd_explorar_10',
    name: 'Explorador',
    description: 'Sal a explorar 10 veces.',
    metric: 'exploraciones',
    target: 10,
    period: 'diaria',
    reward: { digibytes: 350 },
  },
  {
    id: 'd_evolucion_1',
    name: 'Siguiente forma',
    description: 'Evoluciona a un Digimon.',
    metric: 'evoluciones',
    target: 1,
    period: 'diaria',
    reward: { digibytes: 600, items: { nucleo_datos: 1 } },
  },
  {
    id: 'd_jefe_1',
    name: 'Cazador de guardianes',
    description: 'Derrota a un guardián de zona.',
    metric: 'jefes',
    target: 1,
    period: 'diaria',
    reward: { digibytes: 700, items: { superpocion: 1 } },
  },
  {
    id: 'd_sala_3',
    name: 'Descenso',
    description: 'Supera 3 salas de mazmorra.',
    metric: 'salas',
    target: 3,
    period: 'diaria',
    reward: { digibytes: 500, items: { pocion: 3 } },
  },
  {
    id: 'd_pvp_1',
    name: 'Duelo',
    description: 'Gana una partida PvP.',
    metric: 'pvp_victorias',
    target: 1,
    period: 'diaria',
    reward: { digibytes: 450 },
  },
  {
    id: 'd_dano_5000',
    name: 'Aplastador',
    description: 'Haz 5.000 de daño a un jefe.',
    metric: 'dano_jefe',
    target: 5000,
    period: 'diaria',
    reward: { digibytes: 650, items: { espectro_digimon: 1 } },
  },

  // ------------------------------------------------------------ semanales ---
  {
    id: 's_captura_40',
    name: 'Zoólogo',
    description: 'Captura 40 Digimon en la semana.',
    metric: 'capturas',
    target: 40,
    period: 'semanal',
    reward: { digibytes: 2500, items: { capsula: 5 } },
  },
  {
    id: 's_victorias_60',
    name: 'Veterano',
    description: 'Gana 60 combates en la semana.',
    metric: 'victorias',
    target: 60,
    period: 'semanal',
    reward: { digibytes: 3000, items: { superpocion: 4 } },
  },
  {
    id: 's_evolucion_5',
    name: 'Zoólogo del Mundo Digital',
    description: 'Evoluciona a 5 Digimon en la semana.',
    metric: 'evoluciones',
    target: 5,
    period: 'semanal',
    reward: { digibytes: 3500, items: { cromonizador: 3 } },
  },
  {
    id: 's_mazmorra_3',
    name: 'Explorador profundo',
    description: 'Completa 3 mazmorras en la semana.',
    metric: 'mazmorras',
    target: 3,
    period: 'semanal',
    reward: { digibytes: 4000, items: { nucleo_datos: 4, espectro_digimon: 2 } },
  },
  {
    id: 's_jefes_10',
    name: 'Cazador de Formas',
    description: 'Derrota a 10 jefes en la semana.',
    metric: 'jefes',
    target: 10,
    period: 'semanal',
    reward: { digibytes: 4500, items: { elixir: 2 } },
  },
  {
    id: 's_pvp_10',
    name: 'Competidor',
    description: 'Gana 10 partidas PvP en la semana.',
    metric: 'pvp_victorias',
    target: 10,
    period: 'semanal',
    reward: { digibytes: 5000, items: { superpocion: 5 } },
  },
  {
    id: 's_dano_100000',
    name: 'Maza de la incursión',
    description: 'Haz 100.000 de daño a jefes en la semana.',
    metric: 'dano_jefe',
    target: 100_000,
    period: 'semanal',
    reward: { digibytes: 6000, items: { cromonizador: 5 } },
  },
  {
    id: 's_regresion_2',
    name: 'Sin arrepentimientos',
    description: 'Usa la regresión 2 veces. Equivocarse también cuenta.',
    metric: 'regresiones',
    target: 2,
    period: 'semanal',
    reward: { digibytes: 1200, items: { espectro_digimon: 3 } },
  },
];

export type Rarity = 'comun' | 'raro' | 'epico' | 'leyenda';

export const RARITY_COLORS: Record<Rarity, number> = {
  comun: 0x718096,
  raro: 0x3182ce,
  epico: 0x805ad5,
  leyenda: 0xd69e2e,
};

export const RARITY_NAMES: Record<Rarity, string> = {
  comun: 'Común',
  raro: 'Raro',
  epico: 'Épico',
  leyenda: 'Leyenda',
};

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  metric: Metric;
  target: number;
  rarity: Rarity;
  reward: Reward;
  /** Se esconde hasta cumplirlo: da más ganas de descubrirlo. */
  hidden?: boolean;
}

/**
 * Logros: hitos de por vida. No tienen periodo porque no se repiten.
 *
 * Los hitos están escalonados para que haya siempre algo visible cerca: los
 * primeros a 10 y 25, los últimos a 500. Un catálogo donde solo hay metas de
 * 1000 no genera ningún motivo para volver.
 */
export const ACHIEVEMENTS: AchievementDef[] = [
  // ------------------------------------------------------------- etiquetas ---
  {
    id: 'a_primer_captura',
    name: 'Primer enlace',
    description: 'Captura tu primer Digimon.',
    metric: 'capturas',
    target: 1,
    rarity: 'comun',
    reward: { digibytes: 200, exclusive: { kind: 'titulo', key: 'titulo_primer_enlace', name: 'Primer Enlace', emoji: '🔗' } },
  },
  {
    id: 'a_capturas_10',
    name: 'Diez capturas',
    description: 'Captura 10 Digimon.',
    metric: 'capturas',
    target: 10,
    rarity: 'comun',
    reward: { digibytes: 400, items: { capsula: 2 } },
  },
  {
    id: 'a_capturas_100',
    name: 'Cien capturas',
    description: 'Captura 100 Digimon.',
    metric: 'capturas',
    target: 100,
    rarity: 'epico',
    reward: { digibytes: 3000, items: { capsula: 10 } },
  },
  {
    id: 'a_capturas_500',
    name: 'Archivo viviente',
    description: 'Captura 500 Digimon.',
    metric: 'capturas',
    target: 500,
    rarity: 'leyenda',
    reward: {
      digibytes: 15000,
      items: { elixir: 5 },
      exclusive: { kind: 'titulo', key: 'titulo_archivo_viviente', name: 'Archivo Viviente', emoji: '📚' },
    },
  },

  // ------------------------------------------------------------- combate ---
  {
    id: 'a_victorias_10',
    name: 'Novato sellado',
    description: 'Gana 10 combates.',
    metric: 'victorias',
    target: 10,
    rarity: 'comun',
    reward: { digibytes: 500 },
  },
  {
    id: 'a_victorias_100',
    name: 'Cien victorias',
    description: 'Gana 100 combates.',
    metric: 'victorias',
    target: 100,
    rarity: 'raro',
    reward: { digibytes: 2000, items: { superpocion: 3 } },
  },
  {
    id: 'a_victorias_500',
    name: 'Invencible',
    description: 'Gana 500 combates.',
    metric: 'victorias',
    target: 500,
    rarity: 'leyenda',
    reward: {
      digibytes: 12000,
      items: { elixir: 5 },
      exclusive: { kind: 'titulo', key: 'titulo_invencible', name: 'Invencible', emoji: '🛡️' },
    },
  },

  // ------------------------------------------------------------ evolución ---
  {
    id: 'a_evolucion_1',
    name: 'Primera mutación',
    description: 'Evoluciona a tu primer Digimon.',
    metric: 'evoluciones',
    target: 1,
    rarity: 'comun',
    reward: { digibytes: 300, exclusive: { kind: 'titulo', key: 'titulo_mutacion', name: 'Mutación', emoji: '🧬' } },
  },
  {
    id: 'a_evolucion_25',
    name: 'Catalogo de formas',
    description: 'Evoluciona 25 veces.',
    metric: 'evoluciones',
    target: 25,
    rarity: 'epico',
    reward: { digibytes: 4000, items: { cromonizador: 3 } },
  },
  {
    id: 'a_evolucion_100',
    name: 'Árbol completo',
    description: 'Evoluciona 100 veces.',
    metric: 'evoluciones',
    target: 100,
    rarity: 'leyenda',
    reward: {
      digibytes: 10000,
      items: { nucleo_datos: 8, espectro_digimon: 8 },
      exclusive: { kind: 'titulo', key: 'titulo_arbol_completo', name: 'Arbol Completo', emoji: '🌳' },
    },
  },
  {
    id: 'a_formas_10',
    name: 'Diez formas',
    description: 'Desbloquea 10 formas distintas.',
    metric: 'formas_desbloqueadas',
    target: 10,
    rarity: 'raro',
    reward: { digibytes: 1500, items: { nucleo_datos: 2 } },
  },
  {
    id: 'a_formas_25',
    name: 'Media coleccion',
    description: 'Desbloquea 25 formas distintas.',
    metric: 'formas_desbloqueadas',
    target: 25,
    rarity: 'leyenda',
    hidden: true,
    reward: {
      digibytes: 8000,
      items: { espectro_digimon: 4 },
      exclusive: { kind: 'titulo', key: 'titulo_media_coleccion', name: 'Media Colección', emoji: '💠' },
    },
  },

  // ---------------------------------------------------------------- jefes ---
  {
    id: 'a_jefes_1',
    name: 'Cazador novel',
    description: 'Derrota a tu primer guardián.',
    metric: 'jefes',
    target: 1,
    rarity: 'comun',
    reward: { digibytes: 600 },
  },
  {
    id: 'a_jefes_25',
    name: 'Cazador de_Fromas',
    description: 'Derrota a 25 jefes.',
    metric: 'jefes',
    target: 25,
    rarity: 'epico',
    reward: { digibytes: 4500, items: { elixir: 3 } },
  },
  {
    id: 'a_jefes_100',
    name: 'Cazador de Fortalezas',
    description: 'Derrota a 100 jefes.',
    metric: 'jefes',
    target: 100,
    rarity: 'leyenda',
    reward: {
      digibytes: 12000,
      items: { elixir: 5 },
      exclusive: { kind: 'titulo', key: 'titulo_cazador_fortalezas', name: 'Cazador de Fortalezas', emoji: '👑' },
    },
  },

  // ------------------------------------------------------------ mazmorras ---
  {
    id: 'a_mazmorra_1',
    name: 'Primera mazmorra',
    description: 'Completa una mazmorra.',
    metric: 'mazmorras',
    target: 1,
    rarity: 'comun',
    reward: { digibytes: 800, items: { cromonizador: 1 } },
  },
  {
    id: 'a_mazmorra_25',
    name: 'Espeleólogo',
    description: 'Completa 25 mazmorras.',
    metric: 'mazmorras',
    target: 25,
    rarity: 'epico',
    reward: {
      digibytes: 5000,
      items: { cromonizador: 4, espectro_digimon: 4 },
      exclusive: { kind: 'titulo', key: 'titulo_espeleologo', name: 'Espeleólogo', emoji: '🕳️' },
    },
  },
  {
    id: 'a_dano_jefe_100000',
    name: 'Cien mil de daño',
    description: 'Acumula 100.000 de daño a jefes.',
    metric: 'dano_jefe',
    target: 100_000,
    rarity: 'raro',
    reward: { digibytes: 2000, items: { superpocion: 4 } },
  },

  // ----------------------------------------------------------------- PvP ---
  {
    id: 'a_pvp_10',
    name: 'Primer duelista',
    description: 'Gana 10 partidas PvP.',
    metric: 'pvp_victorias',
    target: 10,
    rarity: 'raro',
    reward: { digibytes: 1200 },
  },
  {
    id: 'a_pvp_100',
    name: 'Leyenda del PvP',
    description: 'Gana 100 partidas PvP.',
    metric: 'pvp_victorias',
    target: 100,
    rarity: 'leyenda',
    reward: {
      digibytes: 9000,
      exclusive: { kind: 'titulo', key: 'titulo_leyenda_pvp', name: 'Leyenda del PvP', emoji: '⚔️' },
    },
  },

  // -------------------------------------------------------------- equipo ---
  {
    id: 'a_mejoras_1',
    name: 'Primera mejora',
    description: 'Mejora una pieza de equipo.',
    metric: 'mejoras',
    target: 1,
    rarity: 'comun',
    reward: { digibytes: 300 },
  },
  {
    id: 'a_mejoras_50',
    name: 'Maestro de	forja',
    description: 'Mejora 50 piezas de equipo.',
    metric: 'mejoras',
    target: 50,
    rarity: 'epico',
    reward: {
      digibytes: 5000,
      items: { cromonizador: 4 },
      exclusive: { kind: 'titulo', key: 'titulo_maestro_forja', name: 'Maestro de Forja', emoji: '🔨' },
    },
  },

  // ----------------------------------------------------------- personajes ---
  {
    id: 'a_nivel_50',
    name: 'Mitad de camino',
    description: 'Consigue un Digimon de nivel 50.',
    metric: 'nivel_maximo',
    target: 50,
    rarity: 'raro',
    reward: { digibytes: 2000, items: { elixir: 1 } },
  },
  {
    id: 'a_nivel_100',
    name: 'Techo del Mundo Digital',
    description: 'Consigue un Digimon de nivel 100.',
    metric: 'nivel_maximo',
    target: 100,
    rarity: 'leyenda',
    reward: {
      digibytes: 20000,
      items: { elixir: 10 },
      exclusive: { kind: 'titulo', key: 'titulo_techo', name: 'Techo del Mundo Digital', emoji: '⭐' },
    },
  },
  {
    id: 'a_coleccion_15',
    name: 'Quince Digimon',
    description: 'Ten 15 Digimon a la vez, entre equipo y PC.',
    metric: 'digimon_capturados',
    target: 15,
    rarity: 'raro',
    reward: { digibytes: 2500, items: { capsula: 4 } },
  },
  {
    id: 'a_fidelidad_30',
    name: 'Treinta días',
    description: 'Juega 30 días distintos.',
    metric: 'dias_activos',
    target: 30,
    rarity: 'epico',
    reward: {
      digibytes: 6000,
      items: { elixir: 3 },
      exclusive: { kind: 'titulo', key: 'titulo_fidelidad', name: 'Treinta Días', emoji: '📅' },
    },
  },
];

// ------------------------------------------------------------- validación ----

/**
 * Comprueba que el catálogo es coherente.
 *
 * Se ejecuta en los tests. Dos fallos concretos que ya han pasado: un id
 * duplicado hace que dos misiones compartan fila y una pague dos veces, y un
 * `target` de 0 paga sin jugar.
 */
export function validateCatalog(hasItem: (key: string) => boolean): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  const checkRewards = (where: string, reward: Reward) => {
    if (reward.digibytes < 0) problems.push(`${where}: DigiBytes negativos`);
    if (reward.digibytes === 0 && !reward.items && !reward.exclusive) {
      problems.push(`${where}: no paga nada`);
    }
    for (const [key, quantity] of Object.entries(reward.items ?? {})) {
      if (!hasItem(key)) problems.push(`${where}: objeto inexistente "${key}"`);
      if (quantity < 1) problems.push(`${where}: cantidad invalida de ${key}`);
    }
  };

  for (const mission of MISSIONS) {
    if (seen.has(mission.id)) problems.push(`id duplicado: ${mission.id}`);
    seen.add(mission.id);

    if (mission.target < 1) problems.push(`${mission.id}: objetivo de ${mission.target}`);
    if (!METRIC_NAMES[mission.metric]) problems.push(`${mission.id}: metrica desconocida`);
    checkRewards(mission.id, mission.reward);
  }

  const achievements = new Set<string>();
  for (const achievement of ACHIEVEMENTS) {
    if (seen.has(achievement.id)) problems.push(`id duplicado: ${achievement.id}`);
    seen.add(achievement.id);
    achievements.add(achievement.id);

    if (achievement.target < 1) problems.push(`${achievement.id}: objetivo de ${achievement.target}`);
    if (!METRIC_NAMES[achievement.metric]) problems.push(`${achievement.id}: metrica desconocida`);
    if (!RARITY_NAMES[achievement.rarity]) problems.push(`${achievement.id}: rareza desconocida`);
    checkRewards(achievement.id, achievement.reward);

    // Un titulo no puede concederse dos veces: el segundo no tendria sentido.
    if (achievement.reward.exclusive?.kind === 'titulo') {
      const key = achievement.reward.exclusive.key;
      const other = ACHIEVEMENTS.find(
        (a) => a.id !== achievement.id && a.reward.exclusive?.key === key,
      );
      if (other) problems.push(`titulo "${key}" granting en ${achievement.id} y ${other.id}`);
    }
  }

  if (MISSIONS.filter((m) => m.period === 'diaria').length < 3) {
    problems.push('hacen falta al menos 3 misiones diarias');
  }
  if (MISSIONS.filter((m) => m.period === 'semanal').length < 3) {
    problems.push('hacen falta al menos 3 misiones semanales');
  }

  return problems;
}
