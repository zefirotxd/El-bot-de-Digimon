/**
 * La tabla de eventos de mazmorra.
 *
 * El encargo lo dice así: "la probabilidad debe estar controlada por una tabla de
 * eventos y no ser completamente aleatoria sin límites". Y tiene razón: tirar un
 * dado y que salga cualquier cosa produce resultados que el jugador no puede
 * aprender ni aprovechar. Si un evento aparece el 3% de las veces, el jugador
 * merece saberlo antes de decidir si investigar.
 *
 * Por eso CADA evento lleva su peso explícito, su texto y su resolución. El peso
 * es relativo dentro de su grupo, y el peso total del grupo decide cuánto
 * aparece "algo que investigar" frente a un combate o un cofre.
 */

/** Lo que puede salir de un evento. */
export type ResultadoEvento =
  | 'combate'
  | 'combate_raro'
  | 'emboscada'
  | 'minijefe'
  | 'objeto'
  | 'trampa'
  | 'curacion'
  | 'npc'
  | 'habitacion'
  | 'recompensa'
  | 'perdita'
  | 'nada'
  | 'llave'
  | 'mapa';

/** Un evento de la tabla. */
export interface EventoDungeon {
  key: string;
  emoji: string;
  titulo: string;
  /** Lo que lee el jugador antes de decidir. Nunca revela el resultado. */
  texto: string;
  /** La pregunta y sus dos opciones. */
  opciones: [string, string];
  /** Peso dentro del grupo. */
  peso: number;
  /** A qué grupo pertenece. Los grupos eligen primero. */
  grupo: 'senuelo' | 'pista' | 'riesgo' | 'ayuda' | 'sorpresa';
  /** Si tiene salida, cuál. */
  salida: ResultadoEvento;
  /** Probabilidad de que la salida sea la BUENA. El resto va a la mala. */
  probBuena: number;
  /** Recompensa o efecto, cuando aplica. */
  botin?: { digibytes?: number; item?: string; cantidad?: number };
}

/**
 * Los grupos.
 *
 * Se elige primero el grupo y después el evento dentro de él. Es lo que permite
 * que un bioma tenga "más trampas y menos santuarios" sin reescribir la tabla:
 * se pesan los grupos, no los eventos.
 */
export const GRUPOS_EVENTO: Record<EventoDungeon['grupo'], number> = {
  senuelo: 26,
  pista: 22,
  riesgo: 20,
  ayuda: 18,
  sorpresa: 14,
};

export const TABLA_EVENTOS: EventoDungeon[] = [
  // ------------------------------------------------------------- señuelos ---
  {
    key: 'pared',
    emoji: '🧱',
    titulo: 'Un ruido detrás de la pared',
    texto: 'Algo se ha movido al otro lado. También puede ser viento.',
    opciones: ['🔎 Investigar', '🚶 Continuar'],
    peso: 20,
    grupo: 'senuelo',
    salida: 'recompensa',
    probBuena: 0.55,
    botin: { digibytes: 240, item: 'pocion', cantidad: 1 },
  },
  {
    key: 'charco',
    emoji: '💧',
    titulo: 'Un charco que brilla',
    texto: 'El agua tiene un color que el agua no debería tener.',
    opciones: ['🥤 Beber', '🚶 Continuar'],
    peso: 16,
    grupo: 'senuelo',
    salida: 'combate',
    probBuena: 0.25,
  },
  {
    key: 'manos',
    emoji: '🖐️',
    titulo: 'Huellas que no son tuyas',
    texto: 'Alguien pasó por aquí hace poco. O algo con muchas patas.',
    opciones: ['🔎 Seguir', '🚶 Continuar'],
    peso: 18,
    grupo: 'senuelo',
    salida: 'combate',
    probBuena: 0.2,
  },
  {
    key: 'eco',
    emoji: '📢',
    titulo: 'Tu propia voz, con retraso',
    texto: 'Has dicho algo que no has dicho.',
    opciones: ['🔎 Buscar', '🚶 Continuar'],
    peso: 14,
    grupo: 'senuelo',
    salida: 'trampa',
    probBuena: 0.3,
  },

  // --------------------------------------------------------------- pistas ---
  {
    key: 'marca',
    emoji: '🗺️',
    titulo: 'Marcas en el suelo',
    texto: 'Alguien con prisa pasó por aquí y no tuvo cuidado de borrarlo.',
    opciones: ['🔎 Seguir', '🚶 Continuar'],
    peso: 24,
    grupo: 'pista',
    salida: 'mapa',
    probBuena: 1,
  },
  {
    key: 'restos',
    emoji: '🦴',
    titulo: 'Restos de una batalla',
    texto: 'Alguien ganó aquí. Puede que dejara algo.',
    opciones: ['🔎 Registrar', '🚶 Continuar'],
    peso: 20,
    grupo: 'pista',
    salida: 'objeto',
    probBuena: 0.8,
    botin: { item: 'tonico', cantidad: 1 },
  },
  {
    key: 'llave',
    emoji: '🗝️',
    titulo: 'Una llave en el suelo',
    texto: 'Está tibia. Alguien la dejó hace poco.',
    opciones: ['🗝️ Recoger', '🚶 Continuar'],
    peso: 10,
    grupo: 'pista',
    salida: 'llave',
    probBuena: 0.92,
  },
  {
    key: 'sello',
    emoji: '🔏',
    titulo: 'Un sello en la pared',
    texto: 'Reconoces la marca. Falta una pieza.',
    opciones: ['🔎 Estudiar', '🚶 Continuar'],
    peso: 16,
    grupo: 'pista',
    salida: 'recompensa',
    probBuena: 0.7,
    botin: { digibytes: 180 },
  },

  // --------------------------------------------------------------- riesgo ---
  {
    key: 'pasadizo',
    emoji: '🚪',
    titulo: 'Un pasadizo sin fondo',
    texto: 'Se oye agua abajo. También se oye otra cosa.',
    opciones: ['⬇️ Bajar', '🚶 Continuar'],
    peso: 18,
    grupo: 'riesgo',
    salida: 'minijefe',
    probBuena: 0.35,
  },
  {
    key: 'altar',
    emoji: '🗿',
    titulo: 'Un altar a medio hacer',
    texto: 'La ofrenda es reciente. Eso significa que alguien vuelve.',
    opciones: ['🔎 Rezar', '🚶 Continuar'],
    peso: 14,
    grupo: 'riesgo',
    salida: 'combate_raro',
    probBuena: 0.4,
  },
  {
    key: 'veta',
    emoji: '💎',
    titulo: 'Una veta en la roca',
    texto: 'Brilla. También puede ser una trampa de los que construyen esto.',
    opciones: ['⛏️ Extraer', '🚶 Continuar'],
    peso: 16,
    grupo: 'riesgo',
    salida: 'trampa',
    probBuena: 0.45,
    botin: { digibytes: 520 },
  },
  {
    key: 'cueva',
    emoji: '🕳️',
    titulo: 'Una cueva entre las rocas',
    texto: 'Entra poca gente. La que entra, sale.',
    opciones: ['🔎 Entrar', '🚶 Continuar'],
    peso: 12,
    grupo: 'riesgo',
    salida: 'habitacion',
    probBuena: 0.5,
  },

  // ---------------------------------------------------------------- ayuda ---
  {
    key: 'manantial',
    emoji: '⛲',
    titulo: 'Agua limpia',
    texto: 'Sale de la roca y sabe a mineral, no a tierra.',
    opciones: ['🥤 Descansar', '🚶 Continuar'],
    peso: 22,
    grupo: 'ayuda',
    salida: 'curacion',
    probBuena: 1,
  },
  {
    key: 'refugio',
    emoji: '⛺',
    titulo: 'Un campamento abandonado',
    texto: 'Hay una hoguera todavía tibia.',
    opciones: ['🔥 Reposar', '🚶 Continuar'],
    peso: 18,
    grupo: 'ayuda',
    salida: 'curacion',
    probBuena: 0.85,
  },
  {
    key: 'carro',
    emoji: '🛒',
    titulo: 'Un carro volcado',
    texto: 'Nadie está. Los objetos tampoco.',
    opciones: ['🔎 Registrar', '🚶 Continuar'],
    peso: 18,
    grupo: 'ayuda',
    salida: 'objeto',
    probBuena: 0.75,
    botin: { item: 'superpocion', cantidad: 1 },
  },
  {
    key: 'mascara',
    emoji: '🎭',
    titulo: 'Alguien con máscara',
    texto: '«¿Buscas algo? Yo vendo lo que no se busca.»',
    opciones: ['💬 Hablar', '🚶 Continuar'],
    peso: 12,
    grupo: 'ayuda',
    salida: 'npc',
    probBuena: 0.9,
  },

  // -------------------------------------------------------------- sorpresa ---
  {
    key: 'silueta',
    emoji: '👻',
    titulo: 'Algo que no debería estar aquí',
    texto: 'Una especie que no aparece en esta zona. Sin más.',
    opciones: ['⚔️ Combatir', '🚶 Continuar'],
    peso: 10,
    grupo: 'sorpresa',
    salida: 'combate_raro',
    probBuena: 0.75,
  },
  {
    key: 'eco_propio',
    emoji: '👥',
    titulo: 'Una copia tuya',
    texto: 'Lleva tu equipo. Sonríe.',
    opciones: ['⚔️ Combatir', '🏃 Huir'],
    peso: 6,
    grupo: 'sorpresa',
    salida: 'combate',
    probBuena: 0.5,
  },
  {
    key: 'derrumbe',
    emoji: '💥',
    titulo: 'El techo se mueve',
    texto: 'No ha caído nada todavía.',
    opciones: ['🏃 Correr', '🔎 Sujetar'],
    peso: 12,
    grupo: 'sorpresa',
    salida: 'mapa',
    probBuena: 0.45,
  },
  {
    key: 'caja',
    emoji: '📦',
    titulo: 'Una caja sin etiqueta',
    texto: 'Se oye algo dedans. Algo pequeño.',
    opciones: ['🎁 Abrir', '🚶 Continuar'],
    peso: 18,
    grupo: 'sorpresa',
    salida: 'recompensa',
    probBuena: 0.8,
    botin: { digibytes: 300 },
  },
];

export function eventoDe(key: string): EventoDungeon | undefined {
  return TABLA_EVENTOS.find((e) => e.key === key);
}

/**
 * Elige un evento.
 *
 * Primero el grupo, después el evento. Así un bioma puede tener "muchos riesgos y
 * pocos santuarios" pesando los GRUPOS, sin reescribir los eventos uno a uno.
 */
export function elegirEvento(rng: { pesado<T>(o: { valor: T; peso: number }[]): T }): EventoDungeon {
  const grupo = rng.pesado(
    (Object.keys(GRUPOS_EVENTO) as EventoDungeon['grupo'][]).map((g) => ({
      valor: g,
      peso: GRUPOS_EVENTO[g],
    })),
  );

  const delGrupo = TABLA_EVENTOS.filter((e) => e.grupo === grupo);
  return rng.pesado(delGrupo.map((e) => ({ valor: e, peso: e.peso })));
}

/** Cuántos eventos hay. Lo usa el verificador. */
export const TOTAL_EVENTOS = TABLA_EVENTOS.length;