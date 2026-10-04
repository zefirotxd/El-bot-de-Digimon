import type { MoveDef } from './types.js';

/**
 * Catálogo de movimientos. Añadir uno nuevo es solo meter una entrada aquí:
 * los learnsets de species.ts lo referencian por `key`.
 */
export const MOVES: Record<string, MoveDef> = {
  // ---------------- universal ----------------
  impacto: {
    key: 'impacto',
    name: 'Impacto',
    element: 'viento',
    category: 'fisico',
    power: 40,
    accuracy: 1,
    energyCost: 0,
    priority: 0,
    critRate: 0.05,
    cooldown: 0,
    description: 'Un golpe seco con la cabeza. Confiable.',
  },
  rugido: {
    key: 'rugido',
    name: 'Rugido',
    element: 'viento',
    category: 'estado',
    power: 0,
    accuracy: 0.95,
    energyCost: 0,
    priority: 0,
    critRate: 0,
    cooldown: 1,
    effect: {
      chance: 1,
      statChange: { attack: 0.7 },
      target: 'enemy',
      text: 'su Ataque bajó',
    },
    description: 'Un rugido aturdidor que reduce el Ataque del rival.',
  },
  guardia: {
    key: 'guardia',
    name: 'Guardia',
    element: 'luz',
    category: 'estado',
    power: 0,
    accuracy: 1,
    energyCost: 1,
    priority: 0,
    critRate: 0,
    cooldown: 1,
    effect: {
      chance: 1,
      statChange: { defense: 1.6 },
      target: 'self',
      text: 'su Defensa subió',
    },
    description: 'Endurece la dermis y aumenta la Defensa.',
  },
  concentracion: {
    key: 'concentracion',
    name: 'Concentración',
    element: 'luz',
    category: 'estado',
    power: 0,
    accuracy: 1,
    energyCost: 1,
    priority: 0,
    critRate: 0,
    cooldown: 2,
    effect: {
      chance: 1,
      statChange: { speed: 1.6, attack: 1.3 },
      target: 'self',
      text: 'su Velocidad y Ataque subieron',
    },
    description: 'Aumenta la Velocidad y el Ataque.',
  },

  // ---------------- fuego ----------------
  lanza_llamas: {
    key: 'lanza_llamas',
    name: 'Lanza Llamas',
    element: 'fuego',
    category: 'especial',
    power: 55,
    accuracy: 0.95,
    energyCost: 2,
    priority: 0,
    critRate: 0.1,
    cooldown: 2,
    effect: {
      chance: 0.15,
      status: 'quemadura',
      target: 'enemy',
      text: 'quedó quemado',
    },
    description: 'Escupe fuego. Puede dejar una quemadura.',
  },
  mega_llama: {
    key: 'mega_llama',
    name: 'Mega Llama',
    element: 'fuego',
    category: 'especial',
    power: 85,
    accuracy: 0.85,
    energyCost: 4,
    priority: 0,
    critRate: 0.12,
    cooldown: 4,
    effect: {
      chance: 0.2,
      status: 'quemadura',
      target: 'enemy',
      text: 'quedó quemado',
    },
    description: 'Una llamarada enorme. Precisa, pero devastadora.',
  },
  llama_sagradada: {
    key: 'llama_sagradada',
    name: 'Llama Sagrada',
    element: 'fuego',
    category: 'especial',
    power: 70,
    accuracy: 0.9,
    energyCost: 3,
    priority: 0,
    critRate: 0.15,
    cooldown: 4,
    effect: {
      chance: 0.35,
      status: 'quemadura',
      target: 'enemy',
      text: 'quedó quemado',
    },
    description: 'Fuego con alma. Quemadura muy probable.',
  },

  // ---------------- agua / hielo ----------------
  chorro_agua: {
    key: 'chorro_agua',
    name: 'Chorro de Agua',
    element: 'agua',
    category: 'especial',
    power: 50,
    accuracy: 1,
    energyCost: 1,
    priority: 0,
    critRate: 0.05,
    cooldown: 2,
    description: 'Un bol de agua a presión.',
  },
  acido_corrosivo: {
    key: 'acido_corrosivo',
    name: 'Ácido Corrosivo',
    element: 'agua',
    category: 'especial',
    power: 60,
    accuracy: 0.95,
    energyCost: 2,
    priority: 0,
    critRate: 0.05,
    cooldown: 3,
    effect: {
      chance: 0.25,
      statChange: { defense: 0.6 },
      target: 'enemy',
      text: 'su Defensa cayó',
    },
    description: 'Corroe la armadura del rival.',
  },
  carambano: {
    key: 'carambano',
    name: 'Carambano',
    element: 'hielo',
    category: 'especial',
    power: 65,
    accuracy: 0.9,
    energyCost: 3,
    priority: 0,
    critRate: 0.1,
    cooldown: 3,
    effect: {
      chance: 0.2,
      status: 'congelado',
      target: 'enemy',
      text: 'quedó congelado',
    },
    description: 'Aguja helada que inmoviliza brevemente.',
  },

  // ---------------- planta ----------------
  latigazo_cipoll: {
    key: 'latigazo_cipoll',
    name: 'Latigazo Cipoll',
    element: 'planta',
    category: 'fisico',
    power: 50,
    accuracy: 1,
    energyCost: 1,
    priority: 0,
    critRate: 0.05,
    cooldown: 2,
    description: 'Una hoja afilada como un látigo.',
  },
  espina: {
    key: 'espina',
    name: 'Espina Doble',
    element: 'planta',
    category: 'fisico',
    power: 70,
    accuracy: 0.9,
    energyCost: 3,
    priority: 0,
    critRate: 0.1,
    cooldown: 2,
    effect: {
      chance: 0.2,
      statChange: { speed: 0.7 },
      target: 'enemy',
      text: 'su Velocidad cayó',
    },
    description: 'Dos espinas cargadas de veneno leve.',
  },

  // ---------------- rayo ----------------
  chispa: {
    key: 'chispa',
    name: 'Chispa',
    element: 'rayo',
    category: 'especial',
    power: 45,
    accuracy: 1,
    energyCost: 1,
    priority: 1,
    critRate: 0.05,
    cooldown: 1,
    description: 'Una descarga rápida que siempre ataca primero.',
  },
  rayo: {
    key: 'rayo',
    name: 'Rayo',
    element: 'rayo',
    category: 'especial',
    power: 75,
    accuracy: 0.85,
    energyCost: 3,
    priority: 0,
    critRate: 0.1,
    cooldown: 3,
    effect: {
      chance: 0.2,
      status: 'paralisis',
      target: 'enemy',
      text: 'quedó paralizado',
    },
    description: 'Descarga poderosa con riesgo de parálisis.',
  },
  trueno: {
    key: 'trueno',
    name: 'Trueno Volador',
    element: 'rayo',
    category: 'especial',
    power: 95,
    accuracy: 0.8,
    energyCost: 5,
    priority: 0,
    critRate: 0.12,
    cooldown: 4,
    description: 'El ataque eléctrico más potente.',
  },

  // ---------------- viento ----------------
  tajo_alas: {
    key: 'tajo_alas',
    name: 'Tajo de Alas',
    element: 'viento',
    category: 'fisico',
    power: 60,
    accuracy: 0.95,
    energyCost: 2,
    priority: 0,
    critRate: 0.12,
    cooldown: 2,
    description: 'Tajo con las alas afiladas.',
  },
  tornado: {
    key: 'tornado',
    name: 'Tornado',
    element: 'viento',
    category: 'especial',
    power: 65,
    accuracy: 0.9,
    energyCost: 3,
    priority: 0,
    critRate: 0.08,
    cooldown: 2,
    effect: {
      chance: 0.3,
      statChange: { speed: 0.7, defense: 0.8 },
      target: 'enemy',
      text: 'su Velocidad y Defensa cayeron',
    },
    description: 'Remueve el aire y desestabiliza al rival.',
  },

  // ---------------- luz ----------------
  holy_light: {
    key: 'holy_light',
    name: 'Luz Sagrada',
    element: 'luz',
    category: 'especial',
    power: 55,
    accuracy: 1,
    energyCost: 2,
    priority: 0,
    critRate: 0.08,
    cooldown: 3,
    description: 'Un pilar de luz sagrada.',
  },
  juicio_divino: {
    key: 'juicio_divino',
    name: 'Juicio Divino',
    element: 'luz',
    category: 'especial',
    power: 90,
    accuracy: 0.85,
    energyCost: 5,
    priority: 0,
    critRate: 0.1,
    cooldown: 4,
    effect: {
      chance: 0.15,
      status: 'paralisis',
      target: 'enemy',
      text: 'quedó paralizado',
    },
    description: 'Castigo sagrado de luz pura.',
  },
  promocion: {
    key: 'promocion',
    name: 'Promoción',
    element: 'luz',
    category: 'estado',
    power: 0,
    accuracy: 1,
    energyCost: 2,
    priority: 0,
    critRate: 0,
    cooldown: 3,
    effect: {
      chance: 1,
      statChange: { attack: 1.5, speed: 1.4 },
      target: 'self',
      text: 'su Ataque y Velocidad subieron',
    },
    description: 'Eleva su poder interior.',
  },

  // ---------------- oscuridad ----------------
  garrote: {
    key: 'garrote',
    name: 'Garrote Sombrío',
    element: 'oscuridad',
    category: 'fisico',
    power: 65,
    accuracy: 0.95,
    energyCost: 2,
    priority: 0,
    critRate: 0.1,
    cooldown: 1,
    description: 'Un bastonazo cubierto de sombra.',
  },
  drain: {
    key: 'drain',
    name: 'Drenaje de Datos',
    element: 'oscuridad',
    category: 'especial',
    power: 50,
    accuracy: 1,
    energyCost: 2,
    priority: 0,
    critRate: 0.08,
    cooldown: 2,
    description: 'Roba energía y se la queda.',
  },
  darkness_ball: {
    key: 'darkness_ball',
    name: 'Esfera de Oscuridad',
    element: 'oscuridad',
    category: 'especial',
    power: 80,
    accuracy: 0.9,
    energyCost: 4,
    priority: 0,
    critRate: 0.1,
    cooldown: 3,
    effect: {
      chance: 0.25,
      statChange: { attack: 0.75 },
      target: 'enemy',
      text: 'su Ataque cayó',
    },
    description: 'Esfera de oscuridad densa.',
  },

  // ---------------- dragón ----------------
  aliento_dragon: {
    key: 'aliento_dragon',
    name: 'Aliento Dragón',
    element: 'viento',
    category: 'especial',
    power: 60,
    accuracy: 1,
    energyCost: 2,
    priority: 0,
    critRate: 0.1,
    cooldown: 3,
    description: 'Aire cargado de energía draconiana.',
  },
  rugido_dragon: {
    key: 'rugido_dragon',
    name: 'Rugido Dracónico',
    element: 'viento',
    category: 'estado',
    power: 0,
    accuracy: 0.9,
    energyCost: 2,
    priority: 0,
    critRate: 0,
    cooldown: 3,
    effect: {
      chance: 1,
      statChange: { attack: 0.6, defense: 0.75 },
      target: 'enemy',
      text: 'su Ataque y Defensa cayeron',
    },
    description: 'Intimida y debilita al rival.',
  },

  // ---------------- tierra ----------------
  combo_terrestre: {
    key: 'combo_terrestre',
    name: 'Combo Terrestre',
    element: 'tierra',
    category: 'fisico',
    power: 60,
    accuracy: 0.95,
    energyCost: 2,
    priority: 0,
    critRate: 0.08,
    cooldown: 3,
    description: 'Golpe sísmico de combate cuerpo a cuerpo.',
  },
  rugido_sismico: {
    key: 'rugido_sismico',
    name: 'Rugido Sísmico',
    element: 'tierra',
    category: 'especial',
    power: 75,
    accuracy: 0.9,
    energyCost: 3,
    priority: 0,
    critRate: 0.08,
    cooldown: 4,
    description: 'Sacude el terreno bajo el rival.',
  },
  manto_terroso: {
    key: 'manto_terroso',
    name: 'Manto Terroso',
    element: 'tierra',
    category: 'estado',
    power: 0,
    accuracy: 1,
    energyCost: 1,
    priority: 0,
    critRate: 0,
    cooldown: 3,
    effect: {
      chance: 1,
      statChange: { defense: 1.5, speed: 0.8 },
      target: 'self',
      text: 'una capa de tierra boosts su Defensa y frena su Velocidad',
    },
    description: 'Se cubre de roca: mucha Defensa, menos Velocidad.',
  },

  // ---------------- metal ----------------
  cortador: {
    key: 'cortador',
    name: 'Cortador de Acero',
    element: 'metal',
    category: 'fisico',
    power: 65,
    accuracy: 0.95,
    energyCost: 2,
    priority: 0,
    critRate: 0.12,
    cooldown: 2,
    description: 'Un tajo con una hoja de metal afilada.',
  },
  bala_acero: {
    key: 'bala_acero',
    name: 'Bala de Acero',
    element: 'metal',
    category: 'especial',
    power: 80,
    accuracy: 0.9,
    energyCost: 4,
    priority: 0,
    critRate: 0.12,
    cooldown: 3,
    description: 'Dispara un proyectil de acero a toda velocidad.',
  },
  blindaje: {
    key: 'blindaje',
    name: 'Blindaje',
    element: 'metal',
    category: 'estado',
    power: 0,
    accuracy: 1,
    energyCost: 2,
    priority: 0,
    critRate: 0,
    cooldown: 2,
    effect: {
      chance: 1,
      statChange: { defense: 1.8 },
      target: 'self',
      text: 'se blindó y subió mucho su Defensa',
    },
    description: 'Endurece la piel como una plancha.',
  },

  // ---------------- veneno ----------------
  aguja_venenosa: {
    key: 'aguja_venenosa',
    name: 'Aguja Venenosa',
    element: 'planta',
    category: 'fisico',
    power: 50,
    accuracy: 0.95,
    energyCost: 1,
    priority: 1,
    critRate: 0.08,
    cooldown: 2,
    effect: {
      chance: 0.2,
      status: 'veneno',
      target: 'enemy',
      text: 'quedó envenenado',
    },
    description: 'Ataca primero y deja veneno en la herida.',
  },
  toxina: {
    key: 'toxina',
    name: 'Nube de Toxina',
    element: 'planta',
    category: 'estado',
    power: 0,
    accuracy: 0.95,
    energyCost: 2,
    priority: 0,
    critRate: 0,
    cooldown: 2,
    effect: {
      chance: 1,
      status: 'veneno',
      target: 'enemy',
      text: 'quedó envenenado',
    },
    description: 'Envuelve al rival en un gas tóxico.',
  },
  acido_toxico: {
    key: 'acido_toxico',
    name: 'Acido Tóxico',
    element: 'planta',
    category: 'especial',
    power: 78,
    accuracy: 0.88,
    energyCost: 4,
    priority: 0,
    critRate: 0.1,
    cooldown: 3,
    effect: {
      chance: 0.3,
      status: 'veneno',
      target: 'enemy',
      text: 'quedó envenenado',
    },
    description: 'Ácido corrosivo con muy alta probabilidad de veneno.',
  },

  // ---------------- psichic ----------------
  pulso_mental: {
    key: 'pulso_mental',
    name: 'Pulso Mental',
    element: 'luz',
    category: 'especial',
    power: 58,
    accuracy: 1,
    energyCost: 2,
    priority: 0,
    critRate: 0.1,
    cooldown: 2,
    description: 'Una onda telepática que golpea sin fallo.',
  },
  descarga_mental: {
    key: 'descarga_mental',
    name: 'Descarga Mental',
    element: 'luz',
    category: 'estado',
    power: 0,
    accuracy: 0.9,
    energyCost: 2,
    priority: 0,
    critRate: 0,
    cooldown: 2,
    effect: {
      chance: 1,
      statChange: { attack: 0.6, speed: 0.7 },
      target: 'enemy',
      text: 'le rompió la concentración: cayó su Ataque y Velocidad',
    },
    description: 'Ruido mental que paraliza al rival.',
  },
  rugido_mental: {
    key: 'rugido_mental',
    name: 'Rugido Mental',
    element: 'luz',
    category: 'especial',
    power: 88,
    accuracy: 0.85,
    energyCost: 4,
    priority: 0,
    critRate: 0.12,
    cooldown: 3,
    description: 'La explosión psíquica más potente.',
  },

  // ================================================================ starters ===
  //
  // Los movimientos de los seis Digimon iniciales.
  //
  // No son sabor: cada pareja da a su portador una mecánica que los demás no
  // tienen, y sin eso los seis se jugarían igual con distinto nombre. La identidad
  // de un starter es lo que hace que dos jugadores elijan distinto.
  //
  // Todos tienen `cooldown` alto a propósito. Son golpes que definen una partida,
  // no un botón que se pulsa cada turno: sin enfriamiento, un Digimon con buen
  // kit acaba resolviendo la pelea sin que nadie decida nada.

  // --- Hagurumon: control y tecnología ---

  /**
   * Interferencia.
   *
   * Daño bajo y parálisis. Es el movimiento que hace que Hagurumon sea un
   * controlador y no un atacante mediocre: no mata, quita un turno. El rival que
   * cae paralizado pierde su mejor golpe, y eso vale más que 40 de daño.
   */
  interferencia: {
    key: 'interferencia',
    name: 'Interferencia',
    element: 'metal',
    category: 'especial',
    power: 42,
    accuracy: 0.95,
    energyCost: 3,
    priority: 0,
    critRate: 0.05,
    cooldown: 3,
    effect: {
      chance: 0.55,
      status: 'paralisis',
      turns: 1,
      target: 'enemy',
      text: 'quedó paralizado',
    },
    description: 'Un pulso de ruido blanco en la Wiring del rival. Daño bajo, pero le roba un turno.',
  },

  /**
   * Sobrecarga.
   *
   * Sin daño: solo hunde la Defensa. Aplicarlo pronto multiplica todo lo que venga
   * después, así que su valor depende de la posición en la pelea.
   */
  sobrecarga: {
    key: 'sobrecarga',
    name: 'Sobrecarga',
    element: 'metal',
    category: 'estado',
    power: 0,
    accuracy: 1,
    energyCost: 2,
    priority: 1,
    critRate: 0,
    cooldown: 3,
    effect: {
      chance: 1,
      statChange: { defense: 0.6 },
      target: 'enemy',
      text: 'su Defensa bajó',
    },
    description: 'Funda el blindaje del rival antes de que pueda protegerse.',
  },

  /**
   * Zarpazo sangrante.
   *
   * Daño y cura a la vez.
   *
   * Existe por una razón concreta: la comprobación de que los seis iniciales tengan
   * mecánicas EXCLUSIVAS encontró que Liollmon no tenía ninguna. Sus tres efectos
   * —bajar el Ataque, subirlo, subir la Velocidad— los comparten otros starters, así
   * que su identidad se reducía a tener más Ataque, y eso lo iguala cualquier arma.
   *
   * Un estado o un efecto exclusivo no se puede igualar con equipo. Un número, sí.
   *
   * Y encaja con lo que es: un combatiente cuerpo a cuerpo que se cura con lo que
   * arranca. Pelea más tiempo que los demás porque cada mordida le devuelve algo.
   */
  zarpazo_sangrante: {
    key: 'zarpazo_sangrante',
    name: 'Zarpazo sangrante',
    element: 'luz',
    category: 'fisico',
    power: 66,
    accuracy: 0.9,
    energyCost: 3,
    priority: 0,
    critRate: 0.15,
    cooldown: 3,
    drain: 0.5,
    description: 'Zarpa y se cura con la mitad de lo que ha arrancado.',
  },

  // --- Liollmon: ataque equilibrado ---

  /**
   * Garra Lio.
   *
   * El golpe más fuerte de un inicial. Sin efecto secundario y con crítico alto:
   * Liollmon gana por daño directo y no tiene nada más. Su identidad es que no
   * necesita nada más para ganar.
   */
  garra_lio: {
    key: 'garra_lio',
    name: 'Garra Lio',
    element: 'luz',
    category: 'fisico',
    power: 78,
    accuracy: 0.95,
    energyCost: 3,
    priority: 0,
    critRate: 0.2,
    cooldown: 2,
    description: 'Zarpazo vertical. Simple, rápido y el más fuerte del elenco inicial.',
  },

  /**
   * Presión.
   *
   * Ataque y bajada de Ataque a la vez. Es lo que hace que Liollmon sea
   * «equilibrado» y no «un tanque de daño»: recorta al rival mientras pega, así que
   * el daño se queda arriba durante toda la pelea.
   */
  presion: {
    key: 'presion',
    name: 'Presión',
    element: 'luz',
    category: 'fisico',
    power: 52,
    accuracy: 1,
    energyCost: 2,
    priority: 0,
    critRate: 0.1,
    cooldown: 3,
    effect: {
      chance: 0.7,
      statChange: { attack: 0.75 },
      target: 'enemy',
      text: 'su Ataque bajó',
    },
    description: 'Embiste y le quita las ganas de contraatacar.',
  },

  // --- Floramon: estados alterados ---

  /**
   * Polen venenoso.
   *
   * Veneno de varios turnos. Floramon gana por suma, no por golpes: el daño por turno
   * del veneno hace el trabajo mientras ella se cura o se defiende.
   */
  polen_venenoso: {
    key: 'polen_venenoso',
    name: 'Polen venenoso',
    element: 'planta',
    category: 'estado',
    power: 0,
    accuracy: 0.9,
    energyCost: 2,
    priority: 0,
    critRate: 0,
    cooldown: 3,
    effect: {
      chance: 0.85,
      status: 'veneno',
      turns: 4,
      target: 'enemy',
      text: 'quedó envenenado',
    },
    description: 'Una nube de polen que sigue trabajando después de impactar.',
  },

  /**
   * Enredadera.
   *
   * Veneno otra vez, pero con ralentización. Floramon es la única que puede quitar
   * dos cosas a la vez, y por eso su pelea se alarga: si la deja pronto, el rival
   * llega a su turno cuando puede le conviene.
   */
  enredadera: {
    key: 'enredadera',
    name: 'Enredadera',
    element: 'planta',
    category: 'estado',
    power: 30,
    accuracy: 0.9,
    energyCost: 3,
    priority: 0,
    critRate: 0.05,
    cooldown: 3,
    effect: {
      chance: 0.8,
      status: 'veneno',
      turns: 3,
      statChange: { speed: 0.7 },
      target: 'enemy',
      text: 'quedó envenenado y ralentizado',
    },
    description: 'Lianas que aprietan y envenenan a la vez.',
  },

  // --- Tapirmon: apoyo y resistencia ---

  /**
   * Sueño pesadilla.
   *
   * El movimiento de Tapirmon: dormir al rival. Es de los más fuertes del juego
   * porque no hace daño, quita turnos, y no se esquiva. Por eso el juego tiene un estado de sueño
   * aparte, y no se ha reutilizado el de aturdimiento.
   */
  sueno_pesadilla: {
    key: 'sueno_pesadilla',
    name: 'Sueño pesadilla',
    element: 'oscuridad',
    category: 'estado',
    power: 0,
    accuracy: 0.65,
    energyCost: 4,
    priority: 0,
    critRate: 0,
    cooldown: 4,
    effect: {
      chance: 1,
      status: 'dormir',
      turns: 2,
      target: 'enemy',
      text: 'se quedó dormido',
    },
    description: 'Un sueño del Nightmare Soldiers. No hace daño: hace que no despierte.',
  },

  /**
   * Sello sagrado.
   *
   * Inmunidad a estados durante tres turnos. Tapirmon es el único inicial que puede
   * atravesar una quemadura, un veneno y una parálisis seguidos, y esa es
   * exactamente su identidad: aguantar lo que el rival le echa encima.
   */
  sello_sagrado: {
    key: 'sello_sagrado',
    name: 'Sello sagrado',
    element: 'luz',
    category: 'estado',
    power: 0,
    accuracy: 1,
    energyCost: 3,
    priority: 0,
    critRate: 0,
    cooldown: 4,
    effect: {
      chance: 1,
      status: 'inmune',
      turns: 3,
      target: 'self',
      text: 'quedó inmune a estados',
    },
    description: 'Un sello de los Nightmare Soldiers. Nada de lo que le lancen entra.',
  },

  // --- Otamamon: agua y control ---

  /**
   * Burbuja aturdida.
   *
   * Daño bajo, aturdimiento garantizado si acierta. El aturdimiento no se esquiva y
   * dura un turno, así que es el segundo mejor movimiento del elenco inicial
   * después del sueño.
   */
  burbuja_aturdida: {
    key: 'burbuja_aturdida',
    name: 'Burbuja aturdida',
    element: 'agua',
    category: 'especial',
    power: 46,
    accuracy: 0.9,
    energyCost: 3,
    priority: 1,
    critRate: 0.05,
    cooldown: 3,
    effect: {
      chance: 1,
      status: 'aturdir',
      turns: 1,
      target: 'enemy',
      text: 'quedó aturdido',
    },
    description: 'Una pompa que revienta. El aturdimiento no se puede esquivar.',
  },

  /**
   * Burbuja envolvente.
   *
   * Sin daño y con prioridad alta: llega antes que casi todo. Ralentizar un turno
   * antes de que el rival golpee es la forma más barata de quitarle su mejor turno.
   */
  burbuja_envolvente: {
    key: 'burbuja_envolvente',
    name: 'Burbuja envolvente',
    element: 'agua',
    category: 'estado',
    power: 0,
    accuracy: 0.95,
    energyCost: 2,
    priority: 2,
    critRate: 0,
    cooldown: 3,
    effect: {
      chance: 1,
      statChange: { speed: 0.6 },
      target: 'enemy',
      text: 'su Velocidad bajó',
    },
    description: 'Envuelve al rival en espuma. Llega antes que él.',
  },

  // --- Pteromon: velocidad y movilidad ---

  /**
   * Tajo de viento.
   *
   * Prioridad +1, crítico muy alto y enfriamiento de uno. Es la velocidad hecha
   * arma: Pteromon golpea antes, y a menudo antes dos veces, y en una pelea por
   * turnos eso es decidirla.
   */
  tajo_viento: {
    key: 'tajo_viento',
    name: 'Tajo de viento',
    element: 'viento',
    category: 'fisico',
    power: 62,
    accuracy: 0.95,
    energyCost: 2,
    priority: 1,
    critRate: 0.28,
    cooldown: 1,
    description: 'Ala cortante. Llega antes que casi todo y casi siempre acierta crítico.',
  },

  /**
   * Vuelo rasante.
   *
   * Velocidad propia. Su uso defensivo: sobrevive al turno en que el rival pega fuerte, y llega
   * antes al siguiente.
   */
  vuelo_rasante: {
    key: 'vuelo_rasante',
    name: 'Vuelo rasante',
    element: 'viento',
    category: 'estado',
    power: 0,
    accuracy: 1,
    energyCost: 2,
    priority: 0,
    critRate: 0,
    cooldown: 3,
    effect: {
      chance: 1,
      statChange: { speed: 1.6 },
      target: 'self',
      text: 'su Velocidad subió',
    },
    description: 'Se coloca por encima del rival. El siguiente golpe llega antes.',
  },
};

export function getMove(key: string): MoveDef | undefined {
  return MOVES[key];
}

export function resolveMoves(keys: string[]): MoveDef[] {
  return keys.map((key) => MOVES[key]).filter((m): m is MoveDef => Boolean(m));
}
