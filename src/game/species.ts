import type { SpeciesDef, Tier } from './types.js';

export const TIER_NAMES: Record<Tier, string> = {
  inicial: 'Inicial',
  diminuto: 'Diminuto',
  novato: 'Rookie',
  campeon: 'Champion',
  ultimate: 'Ultimate',
  mega: 'Mega',
};

/**
 * Los seis Digimon iniciales.
 *
 * Cada uno tiene una identidad de combate que no comparte con los demás cinco, y
 * esa identidad es MECÁNICA, no decorativa: son los estados y los efectos que cada
 * uno puede aplicar y nadie más. Dos jugadores que elijan distinto no están
 * eligiendo un nombre: están eligiendo cómo se pelea.
 *
 * Todo lo de referencia viene de la wiki y se puede comprobar con `check:catalogo`:
 * nivel, tipo, atributo, familias y línea evolutiva. Lo de combate —estadísticas,
 * elementos, learnset— es diseño del juego, y por eso no pretende ser canon.
 *
 * Las evoluciones son las DOCUMENTADAS. Ninguno de los seis va a un Rookie genérico:
 * Hagurumon va a Guardromon, que es su línea real en la Machine, y no a Greymon por
 * que ya estuviera en el juego. Esa fue una decisión consciente, y su coste está a
 * la vista: hay que añadir las formas Champion de estos seis al bestiario.
 */
export const SPECIES: Record<string, SpeciesDef> = {
  // ================================================= starters =================================================

  /**
   * Hagurumon. Control y tecnología.
   *
   * Su problema con los estados alterados es de los más útiles que existen: si acierta,
   * el rival pierde un turno entero. No es el más fuerte sosteniendo la pelea, pero
   * es el que más decide cómo termina.
   */
  hagurumon: {
    key: 'hagurumon',
    name: 'Hagurumon',
    emoji: '⚙️',
    attribute: 'virus',
    elements: ['metal'],
    weakTo: ['rayo', 'agua'],
    resists: ['fuego', 'oscuridad'],
    tier: 'inicial',
    base: { hp: 64, attack: 50, defense: 56, speed: 60 },
    catchRate: 42,
    learnset: ['interferencia', 'sobrecarga', 'blindaje', 'pulso_mental', 'impacto'],
    evolutions: [{ to: 'guardromon', level: 14 }],
    lore: 'Engranaje con alas y muy mal carácter. Desmonta rivales más rápido de lo que los monta.',
  },

  /**
   * Liollmon. Ataque equilibrado.
   *
   * El único inicial cuyo argumento es simplemente que pega fuerte. No tiene control,
   * ni sustain, ni velocidad: tiene el golpe más potente del elenco y una bajada de
   * Ataque que hace que ese golpe valga más cada vez que lo usa.
   */
  liollmon: {
    key: 'liollmon',
    name: 'Liollmon',
    emoji: '🦁',
    attribute: 'vacuna',
    elements: ['luz'],
    weakTo: ['oscuridad', 'agua'],
    resists: ['rayo', 'hielo'],
    tier: 'inicial',
    base: { hp: 66, attack: 64, defense: 52, speed: 58 },
    catchRate: 40,
    // `zarpazo_sangrante` es lo que le hace único: ningún otro inicial se cura con
    // lo que pega. Sus otros tres efectos los comparten con los demás, y con solo
    // números su identidad se reducía a «más Ataque», que es lo primero que iguala
    // cualquier equipo.
    learnset: ['zarpazo_sangrante', 'garra_lio', 'presion', 'concentracion', 'impacto'],
    evolutions: [{ to: 'liamon', level: 14 }],
    lore: 'Bestia sagrada con melena de sol. No hace ruido porque no lo necesita.',
  },

  /**
   * Floramon. Estados alterados.
   *
   * Ganar por acumulación es más lento que ganar por golpe, y por eso Floramon es
   * el que más partido pierde si se le corta el ritmo. A cambio, es el único que
   * puede dejar al rival muriéndose poco a poco durante cuatro turnos mientras ella
   * se prepara.
   */
  floramon: {
    key: 'floramon',
    name: 'Floramon',
    emoji: '🌻',
    attribute: 'datos',
    elements: ['planta'],
    weakTo: ['fuego', 'rayo'],
    resists: ['agua', 'viento'],
    tier: 'inicial',
    base: { hp: 62, attack: 52, defense: 54, speed: 56 },
    catchRate: 44,
    learnset: ['polen_venenoso', 'enredadera', 'aguja_venenosa', 'guardia', 'impacto'],
    evolutions: [{ to: 'sunflowmon', level: 14 }],
    lore: 'Floración del bosque con aroma de moho. Su polen no se ve y trabaja despacio.',
  },

  /**
   * Tapirmon. Apoyo y resistencia.
   *
   * El único inicial que puede sellarse contra los estados. Quemaduras, venenos y
   * parálisis le pasan por encima durante tres turnos, y con eso sobrevive a lo que
   * los otros cinco no aguantarían. Su daño es el más bajo del elenco; a cambio,
   * es el único que puede decir que no.
   */
  tapirmon: {
    key: 'tapirmon',
    name: 'Tapirmon',
    emoji: '🐼',
    attribute: 'vacuna',
    elements: ['oscuridad', 'luz'],
    // `oscuridad` porque es un Nightmare Soldier de los cinco, y por eso duerme.
    // La resistencia a `luz` es el reverso de eso: es la única INITIAL cuyo atributo
    // es Vacuna y cuyo elemento principal es oscuridad, y esa tensión es su
    // identidad.
    weakTo: ['rayo', 'agua'],
    resists: ['oscuridad', 'nulo'],
    tier: 'inicial',
    base: { hp: 72, attack: 44, defense: 66, speed: 50 },
    catchRate: 38,
    learnset: ['sueno_pesadilla', 'sello_sagrado', 'promocion', 'holy_light', 'manto_terroso'],
    evolutions: [{ to: 'monochromon', level: 14 }],
    lore: 'Soldado del sueño. Duerme a quien lo mira y despierta a quien no debía.',
  },

  /**
   * Otamamon. Agua y control.
   *
   * Llega antes que casi todo. Su burbuja envolvente tiene la prioridad más alta del
   * elenco inicial, así que en la práctica abre el combate él: ralentiza al rival y le
   * quita el turno bueno antes de que exista.
   */
  otamamon: {
    key: 'otamamon',
    name: 'Otamamon',
    emoji: '🐸',
    attribute: 'virus',
    elements: ['agua'],
    weakTo: ['planta', 'tierra'],
    resists: ['agua', 'rayo'],
    tier: 'inicial',
    base: { hp: 68, attack: 54, defense: 56, speed: 54 },
    catchRate: 42,
    learnset: ['burbuja_aturdida', 'burbuja_envolvente', 'chorro_agua', 'acido_corrosivo', 'impacto'],
    evolutions: [{ to: 'gekomon', level: 14 }],
    lore: 'Anfibio de boca ancha. Pelea como quien traga entera y no mastica.',
  },

  /**
   * Pteromon. Velocidad y movilidad.
   *
   * El más rápido del elenco y el que más críticos hace. Su `Tajo de viento` pega
   * menos que la `Garra Lio` de Liollmon pero acierta crítico casi la mitad de las
   * veces, y eso no se iguala con un arma: el multiplicador va después de la
   * Defensa, así que un arma sube el número y Pteromon lo multiplica.
   *
   * Su salto a Zephagamon salta la banda Champion a propósito: es una de las pocas
   * evoluciones del canon que van directamente a Mega, y el árbol la respeta en
   * lugar de inventarse un escalón intermedio que el universo no tiene.
   *
   * LO QUE TODAVÍA NO ESTÁ: evasión y daño extra contra debilidades eran parte de
   * su propuesta de rol, y el motor no tiene ninguna de las dos mecánicas. No se
   * anuncian como si existieran. Cuando se añadan, van aquí.
   */
  pteromon: {
    key: 'pteromon',
    name: 'Pteromon',
    emoji: '🕊️',
    attribute: 'datos',
    elements: ['viento'],
    weakTo: ['rayo', 'metal'],
    resists: ['planta', 'agua'],
    tier: 'inicial',
    base: { hp: 56, attack: 58, defense: 44, speed: 78 },
    catchRate: 36,
    learnset: ['tajo_viento', 'vuelo_rasante', 'tornado', 'rugido', 'impacto'],
    evolutions: [{ to: 'zephagamon', level: 22 }],
    lore: 'Ave del cielo abierto. El aire no la frena: es donde se mueve mejor.',
  },

  // ============================================= evoluciones de los starters =============================================

  /** Guardromon. La línea Machine de Hagurumon. */
  guardromon: {
    key: 'guardromon',
    name: 'Guardromon',
    emoji: '🛡️',
    attribute: 'virus',
    elements: ['metal'],
    weakTo: ['rayo', 'agua'],
    resists: ['fuego', 'oscuridad'],
    tier: 'campeon',
    base: { hp: 112, attack: 92, defense: 100, speed: 86 },
    catchRate: 55,
    learnset: ['interferencia', 'sobrecarga', 'descarga_mental', 'blindaje', 'rayo'],
    evolutions: [],
    devolution: { to: 'hagurumon', items: { cromonizador: 1 } },
    lore: 'Tanque blindado. Lo que entra en su cono no vuelve entero.',
  },

  /** Liamon. Holy Beast de Liollmon, y forma final documentada. */
  liamon: {
    key: 'liamon',
    name: 'Liamon',
    emoji: '🦁',
    attribute: 'vacuna',
    elements: ['luz'],
    weakTo: ['oscuridad', 'agua'],
    resists: ['rayo', 'hielo'],
    tier: 'campeon',
    base: { hp: 118, attack: 116, defense: 92, speed: 94 },
    catchRate: 45,
    learnset: ['garra_lio', 'presion', 'llama_sagradada', 'juicio_divino', 'holy_light'],
    evolutions: [],
    devolution: { to: 'liollmon', items: { cromonizador: 1 } },
    lore: 'Bestia sagrada adulta. La fuente la documenta como último eslabón de su línea.',
  },

  /** Sunflowmon. La rama Vegetation de Floramon; es la que va a Lillymon en el canon. */
  sunflowmon: {
    key: 'sunflowmon',
    name: 'Sunflowmon',
    emoji: '🌻',
    attribute: 'datos',
    elements: ['planta'],
    weakTo: ['fuego', 'rayo'],
    resists: ['agua', 'viento'],
    tier: 'campeon',
    base: { hp: 108, attack: 90, defense: 96, speed: 92 },
    catchRate: 50,
    // Los movimientos se eligen del catálogo: `rayo_pollen` se escribió aquí y no
    // existe. `promocion` es lo que corresponde —subir de nivel antes de que se te
    // acabe el tiempo— y encaja con una planta que envenena y aguanta.
    learnset: ['polen_venenoso', 'enredadera', 'acido_toxico', 'promocion', 'espina'],
    evolutions: [],
    devolution: { to: 'floramon', items: { cromonizador: 1 } },
    lore: 'Girasol enorme de cuatro cabezas. Emite polen que pesa y no se va.',
  },

  /** Monochromon. La línea de Tapirmon; en el canon es la que corta. */
  monochromon: {
    key: 'monochromon',
    name: 'Monochromon',
    emoji: '🌒',
    attribute: 'datos',
    elements: ['oscuridad', 'tierra'],
    weakTo: ['rayo', 'agua'],
    resists: ['oscuridad', 'luz'],
    tier: 'campeon',
    base: { hp: 124, attack: 88, defense: 108, speed: 78 },
    catchRate: 40,
    learnset: ['sello_sagrado', 'sueno_pesadilla', 'manto_terroso', 'garrote', 'holy_light'],
    evolutions: [],
    devolution: { to: 'tapirmon', items: { cromonizador: 1 } },
    lore: 'Media luna con patas. Lo que toca queda a oscuras hasta que pasa el día.',
  },

  /** Gekomon. La línea Amphibian de Otamamon. */
  gekomon: {
    key: 'gekomon',
    name: 'Gekomon',
    emoji: '🐸',
    attribute: 'virus',
    elements: ['agua'],
    weakTo: ['planta', 'tierra'],
    resists: ['agua', 'rayo'],
    tier: 'campeon',
    base: { hp: 114, attack: 94, defense: 100, speed: 84 },
    catchRate: 52,
    learnset: ['burbuja_aturdida', 'burbuja_envolvente', 'chorro_agua', 'acido_corrosivo', 'pulso_mental'],
    evolutions: [],
    devolution: { to: 'otamamon', items: { cromonizador: 1 } },
    lore: 'Rana acorazada que traga enteros a los rivales y regurgita espuma.',
  },

  /**
   * Zephagamon.
   *
   * Es Mega y no Champion, y su ruta viene de Pteromon que es Rookie. El salto
   * existe en el canon —una de las pocas evoluciones que van directas a Mega— y
   * el árbol lo respeta. Un escalón intermedio inventado habría sido más cómodo de
   * equilibrar y habría sido mentira.
   */
  zephagamon: {
    key: 'zephagamon',
    name: 'Zephagamon',
    emoji: '🌪️',
    attribute: 'datos',
    elements: ['viento', 'rayo'],
    weakTo: ['rayo', 'metal'],
    resists: ['planta', 'agua', 'tierra'],
    tier: 'mega',
    base: { hp: 186, attack: 148, defense: 138, speed: 176 },
    catchRate: 12,
    learnset: ['tajo_viento', 'vuelo_rasante', 'trueno', 'tornado', 'rayo'],
    evolutions: [],
    devolution: { to: 'pteromon', items: { nucleo_datos: 2 } },
    lore: 'Caballero del vendaval. La fuente lo documenta como salto directo desde Pteromon.',
  },

  // ---------------- starters antiguos ----------------
  // Agumon, Gabumon, Biyomon, Gatomon, Guilmon y Pabumon siguen en el bestiario y
  // se capturan en las primeras zonas. Dejaron de starters cuando se eligieron los
  // seis nuevos; no se borraron, porque un Digimon que se puede encontrar en el
  // mundo es una de las pocas cosas que hacen que explorar tenga sentido.
  agumon: {
    key: 'agumon',
    name: 'Agumon',
    emoji: '🦖',
    attribute: 'virus',
    elements: ['fuego'],
    weakTo: ['agua', 'hielo'],
    resists: ['planta'],
    tier: 'inicial',
    base: { hp: 66, attack: 58, defense: 50, speed: 62 },
    catchRate: 45,
    learnset: ['impacto', 'lanza_llamas', 'concentracion', 'mega_llama'],
    evolutions: [{ to: 'greymon', level: 12 }],
    lore: 'Clon de dinosaurio con un brazo lleno de fuerza y muy mal genio.',
  },
  gabumon: {
    key: 'gabumon',
    name: 'Gabumon',
    emoji: '🐺',
    attribute: 'datos',
    elements: ['hielo'],
    weakTo: ['fuego', 'rayo'],
    resists: ['agua', 'viento'],
    tier: 'inicial',
    base: { hp: 64, attack: 54, defense: 58, speed: 58 },
    catchRate: 45,
    learnset: ['impacto', 'carambano', 'guardia', 'chorro_agua'],
    evolutions: [{ to: 'garurumon', level: 12 }],
    lore: 'Se cubre con una capa que parece hielo pero en realidad es pelo.',
  },
  biyomon: {
    key: 'biyomon',
    name: 'Biyomon',
    emoji: '🐦',
    attribute: 'datos',
    elements: ['viento'],
    weakTo: ['rayo', 'metal'],
    resists: ['planta', 'tierra'],
    tier: 'inicial',
    base: { hp: 58, attack: 52, defense: 46, speed: 72 },
    catchRate: 45,
    learnset: ['impacto', 'tajo_alas', 'chorro_agua', 'tornado'],
    evolutions: [{ to: 'birdramon', level: 12 }],
    lore: 'Ave del tamaño de una paloma con alas-ancla que le permiten flotar.',
  },
  paulmon: {
    key: 'paulmon',
    name: 'Palmon',
    emoji: '🌵',
    attribute: 'datos',
    elements: ['planta'],
    weakTo: ['fuego', 'rayo'],
    resists: ['agua', 'viento'],
    // Palmon es Rookie en el canon, no un inicial. El nombre estaba mal escrito
    // —«Paulmon» en vez de «Palmon»— y de paso la banda era de la anterior: el
    // Fresh que desemboca aquí es Pabumon, que se añadió como starter.
    tier: 'novato',
    base: { hp: 68, attack: 50, defense: 56, speed: 48 },
    catchRate: 45,
    learnset: ['impacto', 'latigazo_cipoll', 'guardia', 'espina'],
    evolutions: [{ to: 'togemon', level: 12 }],
    lore: 'Cactus del desierto. Su único pasatiempo es hacer fotos.',
  },
  /**
   * Pabumon.
   *
   * Existe por una corrección de datos, no por decoración. La especie que el juego
   * llamaba «Paulmon» era Palmon con el nombre mal escrito, y Palmon es Rookie:
   * estaba en la banda equivocada. Su forma Fresh de verdad es Pabumon, así que
   * añadirla deja la línea coherente de principio a fin y mantiene los seis
   * starters.
   *
   * En la wiki Pabumon es `Fresh`, de tipo `Slime` y con el atributo sin
   * declarar. Aquí es `vacuna` por decisión de diseño, como los otros cinco
   * starters: el triángulo del juego es otro campo, y esa divergencia está
   * registrada en `dex-accepted.json`.
   */
  pabumon: {
    key: 'pabumon',
    name: 'Pabumon',
    emoji: '🫧',
    attribute: 'vacuna',
    elements: ['planta'],
    weakTo: ['fuego', 'rayo'],
    resists: ['agua', 'viento'],
    tier: 'inicial',
    base: { hp: 58, attack: 42, defense: 50, speed: 40 },
    catchRate: 50,
    learnset: ['impacto', 'guardia', 'espina'],
    // La ruta natural de Palmon. El juego tiene muchas evolution posibles por
    // branches, y esta es la línea del desierto.
    evolutions: [{ to: 'paulmon', level: 10 }],
    lore: 'Una gota con cara. No tiene patas, y aun así se mueve.',
  },
  gatomon: {
    key: 'gatomon',
    name: 'Gatomon',
    emoji: '😺',
    attribute: 'vacuna',
    elements: ['luz'],
    weakTo: ['oscuridad'],
    resists: ['rayo', 'metal'],
    tier: 'inicial',
    base: { hp: 62, attack: 54, defense: 52, speed: 68 },
    catchRate: 45,
    learnset: ['impacto', 'holy_light', 'concentracion', 'juicio_divino'],
    evolutions: [{ to: 'angemon', level: 12 }],
    lore: 'Gato de orejas puntiagudas que lleva un digivice y odia la lluvia.',
  },
  guilmon: {
    key: 'guilmon',
    name: 'Guilmon',
    emoji: '🦎',
    attribute: 'virus',
    elements: ['fuego', 'oscuridad'],
    weakTo: ['agua', 'planta'],
    resists: ['rayo', 'tierra'],
    tier: 'inicial',
    base: { hp: 66, attack: 60, defense: 52, speed: 60 },
    catchRate: 40,
    learnset: ['impacto', 'garrote', 'lanza_llamas', 'darkness_ball'],
    evolutions: [{ to: 'growlmon', level: 14 }],
    lore: 'Digimon ovni con alas de membranosa. Débil al inicio, pero rabioso.',
  },

  // ---------------- rookies salvajes ----------------
  goburimon: {
    key: 'goburimon',
    name: 'Goburimon',
    emoji: '👺',
    attribute: 'datos',
    elements: ['tierra'],
    weakTo: ['rayo', 'planta'],
    resists: ['agua'],
    tier: 'novato',
    base: { hp: 64, attack: 56, defense: 52, speed: 45 },
    catchRate: 190,
    learnset: ['impacto', 'combo_terrestre', 'rugido'],
    evolutions: [],
    lore: 'Duende de las profundidades que lanza terra sin avisar.',
  },
  kunemon: {
    key: 'kunemon',
    name: 'Kunemon',
    emoji: '🐛',
    attribute: 'vacuna',
    elements: ['planta'],
    weakTo: ['fuego', 'hielo'],
    resists: ['agua', 'viento'],
    tier: 'novato',
    base: { hp: 58, attack: 52, defense: 44, speed: 62 },
    catchRate: 190,
    learnset: ['impacto', 'latigazo_cipoll', 'tornado'],
    evolutions: [],
    lore: 'Oruga que se convierte en latigo cuando se enfurece.',
  },
  betamon: {
    key: 'betamon',
    name: 'Betamon',
    emoji: '🦀',
    attribute: 'datos',
    elements: ['agua'],
    weakTo: ['rayo', 'planta'],
    resists: ['fuego'],
    tier: 'novato',
    base: { hp: 60, attack: 50, defense: 58, speed: 40 },
    catchRate: 190,
    learnset: ['impacto', 'chorro_agua', 'guardia'],
    evolutions: [],
    lore: 'Cangrejo marino con un registro de datos grabado en la concha.',
  },
  veldmon: {
    key: 'veldmon',
    name: 'Veldmon',
    emoji: '👹',
    attribute: 'virus',
    elements: ['oscuridad'],
    weakTo: ['luz'],
    resists: ['tierra'],
    tier: 'novato',
    base: { hp: 58, attack: 58, defense: 46, speed: 56 },
    catchRate: 190,
    learnset: ['impacto', 'garrote', 'drain'],
    evolutions: [],
    lore: 'Demonio pequeño que succiona el alma de las estrellas caídas.',
  },
  demimeramon: {
    key: 'demimeramon',
    name: 'DemiMeramon',
    emoji: '🫖',
    attribute: 'vacuna',
    elements: ['tierra'],
    weakTo: ['agua', 'rayo'],
    resists: ['fuego'],
    tier: 'novato',
    base: { hp: 70, attack: 46, defense: 60, speed: 38 },
    catchRate: 190,
    learnset: ['impacto', 'rugido_sismico', 'guardia'],
    evolutions: [],
    lore: 'Mitad hada, mitad fenix. Su armadura natural es una manta.',
  },

  // ---------------- champions ----------------
  greymon: {
    key: 'greymon',
    name: 'Greymon',
    emoji: '🦕',
    attribute: 'virus',
    elements: ['fuego'],
    weakTo: ['agua', 'hielo'],
    resists: ['planta'],
    tier: 'campeon',
    base: { hp: 108, attack: 92, defense: 84, speed: 80 },
    catchRate: 75,
    learnset: ['impacto', 'lanza_llamas', 'mega_llama', 'llama_sagradada', 'promocion'],
    evolutions: [
      { to: 'metalgreymon', level: 25 },
      {
        to: 'mastertyrannomon',
        level: 40,
        wins: 30,
        digibytes: 5000,
        items: { nucleo_datos: 3 },
        branch: true,
        note:
          'Salta a Mega sin pasar por el cromonizador: mas HP y defensa, mucha menos velocidad y pierde el Moveset de WereGreymon.',
      },
    ],
    lore: 'Dinosaurio acorazado con una CromoDiarmonita brillando en el pecho.',
  },
  garurumon: {
    key: 'garurumon',
    name: 'Garurumon',
    emoji: '🐕',
    attribute: 'vacuna',
    elements: ['hielo'],
    weakTo: ['fuego', 'rayo'],
    resists: ['agua', 'viento'],
    tier: 'campeon',
    base: { hp: 106, attack: 88, defense: 86, speed: 92 },
    catchRate: 75,
    learnset: ['impacto', 'carambano', 'tajo_alas', 'tornado', 'llama_sagradada'],
    evolutions: [{ to: 'weregarurumon', level: 25 }],
    lore: 'Lycantrope del norte cuyo pelaje se endurece como el hielo.',
  },
  birdramon: {
    key: 'birdramon',
    name: 'Birdramon',
    emoji: '🦅',
    attribute: 'datos',
    elements: ['viento'],
    weakTo: ['rayo', 'metal'],
    resists: ['planta', 'tierra'],
    tier: 'campeon',
    base: { hp: 100, attack: 86, defense: 80, speed: 104 },
    catchRate: 75,
    learnset: ['impacto', 'tajo_alas', 'tornado', 'chispa', 'aliento_dragon'],
    evolutions: [{ to: 'garudamon', level: 25 }],
    lore: 'Águila gigante de cuatro alas que caza ayudada por el viento.',
  },
  angemon: {
    key: 'angemon',
    name: 'Angemon',
    emoji: '👼',
    attribute: 'vacuna',
    elements: ['luz'],
    weakTo: ['oscuridad'],
    resists: ['rayo', 'metal'],
    tier: 'campeon',
    base: { hp: 106, attack: 94, defense: 82, speed: 96 },
    catchRate: 75,
    learnset: ['impacto', 'holy_light', 'juicio_divino', 'rayo', 'promocion'],
    evolutions: [
      { to: 'holyangemon', level: 25 },
      {
        to: 'cherubimon',
        level: 28,
        wins: 20,
        digibytes: 3000,
        items: { nucleo_datos: 2 },
        branch: true,
        note:
          'Salta a Ultimate por otra via. Esbelta y muy veloz, pero con el PV mas bajo de su linea.',
      },
    ],
    lore: 'Ángel con dieciséis alas hechas de anillos de energía.',
  },
  togemon: {
    key: 'togemon',
    name: 'Togemon',
    emoji: '🌴',
    attribute: 'datos',
    elements: ['planta'],
    weakTo: ['fuego', 'rayo'],
    resists: ['agua', 'viento'],
    tier: 'campeon',
    base: { hp: 110, attack: 88, defense: 96, speed: 74 },
    catchRate: 75,
    learnset: ['impacto', 'latigazo_cipoll', 'espina', 'combo_terrestre'],
    evolutions: [{ to: 'ogremon', level: 25 }],
    lore: 'Cactus con brazos de boxeo. Su foto es su técnica mortal.',
  },
  growlmon: {
    key: 'growlmon',
    name: 'Growlmon',
    emoji: '🦖',
    attribute: 'virus',
    elements: ['fuego', 'oscuridad'],
    weakTo: ['agua', 'planta', 'oscuridad'],
    resists: ['rayo', 'tierra'],
    tier: 'campeon',
    base: { hp: 104, attack: 92, defense: 80, speed: 94 },
    catchRate: 70,
    learnset: ['impacto', 'garrote', 'lanza_llamas', 'darkness_ball', 'mega_llama'],
    evolutions: [{ to: 'wargrowlmon', level: 25 }],
    lore: 'Digimon de garras que ve el futuro en el fuego.',
  },

  // ---------------- ultimates ----------------
  metalgreymon: {
    key: 'metalgreymon',
    name: 'MetalGreymon',
    emoji: '🦖',
    attribute: 'virus',
    elements: ['fuego', 'tierra'],
    weakTo: ['agua', 'rayo', 'hielo'],
    resists: ['planta'],
    tier: 'ultimate',
    base: { hp: 150, attack: 118, defense: 112, speed: 106 },
    catchRate: 30,
    learnset: ['mega_llama', 'llama_sagradada', 'combo_terrestre', 'rugido_sismico', 'promocion'],
    evolutions: [
      { to: 'wargreymon', level: 45 },
      {
        to: 'skullgreymon',
        level: 50,
        wins: 45,
        digibytes: 8000,
        items: { cromonizador: 2, espectro_digimon: 1 },
        branch: true,
        note:
          'La rama del sacrificio: el doble de ataque y la mitad de aguante. Se juega en un solo golpe, no de frente.',
      },
    ],
    lore: 'Tiranosaurio con una Cromonitizer montada en la espalda.',
  },
  weregarurumon: {
    key: 'weregarurumon',
    name: 'WereGarurumon',
    emoji: '🐺',
    attribute: 'vacuna',
    elements: ['hielo'],
    weakTo: ['fuego', 'rayo'],
    resists: ['agua', 'viento'],
    tier: 'ultimate',
    base: { hp: 150, attack: 118, defense: 110, speed: 120 },
    catchRate: 30,
    learnset: ['carambano', 'tajo_alas', 'tornado', 'garrote', 'juicio_divino'],
    evolutions: [{ to: 'metalgarurumon', level: 45 }],
    lore: 'la forma más veloz del Norte: la luna le da fuerza.',
  },
  garudamon: {
    key: 'garudamon',
    name: 'Garudamon',
    emoji: '🕊️',
    attribute: 'datos',
    elements: ['viento', 'luz'],
    weakTo: ['rayo', 'hielo'],
    resists: ['planta'],
    tier: 'ultimate',
    base: { hp: 146, attack: 116, defense: 108, speed: 130 },
    catchRate: 30,
    learnset: ['tajo_alas', 'tornado', 'holy_light', 'trueno', 'aliento_dragon'],
    evolutions: [
      { to: 'valemon', level: 45 },
      {
        to: 'phoenixmon',
        level: 50,
        wins: 45,
        digibytes: 8000,
        items: { cromonizador: 2, espectro_digimon: 1 },
        branch: true,
        note:
          'Renace de las cenizas: la forma mas rapida del catalogo, a cambio de menos aguante.',
      },
    ],
    lore: 'Dios del viento con alas que barren las tormentas.',
  },
  wargrowlmon: {
    key: 'wargrowlmon',
    name: 'WarGrowlmon',
    emoji: '🐲',
    attribute: 'virus',
    elements: ['fuego', 'oscuridad'],
    weakTo: ['agua', 'luz'],
    resists: ['rayo'],
    tier: 'ultimate',
    base: { hp: 154, attack: 120, defense: 108, speed: 124 },
    catchRate: 25,
    learnset: ['darkness_ball', 'mega_llama', 'garrote', 'drain', 'aliento_dragon'],
    evolutions: [{ to: 'kimeramon', level: 45 }],
    lore: 'El digimon de garras más destructivo del archivo.',
  },
  holyangemon: {
    key: 'holyangemon',
    name: 'HolyAngemon',
    emoji: '🕊️',
    attribute: 'vacuna',
    elements: ['luz'],
    weakTo: ['oscuridad'],
    resists: ['rayo', 'metal'],
    tier: 'ultimate',
    base: { hp: 150, attack: 120, defense: 114, speed: 124 },
    catchRate: 25,
    learnset: ['holy_light', 'juicio_divino', 'rayo', 'promocion', 'trueno'],
    evolutions: [{ to: 'magnadramon', level: 45 }],
    lore: 'Serafín de doce alas que purifica el agua que toca.',
  },
  ogremon: {
    key: 'ogremon',
    name: 'Ogremon',
    emoji: '🌵',
    attribute: 'datos',
    elements: ['planta', 'tierra'],
    weakTo: ['fuego', 'rayo', 'hielo'],
    resists: ['agua', 'viento'],
    tier: 'ultimate',
    base: { hp: 158, attack: 110, defense: 128, speed: 84 },
    catchRate: 30,
    learnset: ['espina', 'combo_terrestre', 'latigazo_cipoll', 'rugido_sismico'],
    evolutions: [
      { to: 'groundramon', level: 45 },
      {
        to: 'seraphimon',
        level: 50,
        wins: 45,
        digibytes: 8000,
        items: { cromonizador: 2, espectro_digimon: 1 },
        branch: true,
        note:
          'El coloso oscuro: el PV y la defensa mas altos del catalogo. Lento y vulnerable al elemento luz.',
      },
    ],
    lore: 'Golpeador profesional. Su MRT se dispara con cada movimiento.',
  },

  // ---------------- megas de leyenda ----------------
  wargreymon: {
    key: 'wargreymon',
    name: 'WarGreymon',
    emoji: '🐉',
    attribute: 'vacuna',
    elements: ['fuego', 'luz'],
    weakTo: ['oscuridad', 'agua'],
    resists: ['rayo'],
    tier: 'mega',
    base: { hp: 198, attack: 140, defense: 134, speed: 130 },
    catchRate: 5,
    learnset: ['mega_llama', 'llama_sagradada', 'promocion', 'juicio_divino', 'aliento_dragon'],
    evolutions: [],
    lore: 'Guerrero biblico. Su cuerpo brilla como una estrella naciente.',
  },
  metalgarurumon: {
    key: 'metalgarurumon',
    name: 'MetalGarurumon',
    emoji: '🐺',
    attribute: 'datos',
    elements: ['hielo', 'tierra'],
    weakTo: ['rayo', 'fuego'],
    resists: ['agua'],
    tier: 'mega',
    base: { hp: 196, attack: 138, defense: 140, speed: 138 },
    catchRate: 5,
    learnset: ['carambano', 'rugido_sismico', 'tajo_alas', 'combo_terrestre', 'tornado'],
    evolutions: [],
    lore: 'Lobo de acero y nieve infinita.',
  },
  valemon: {
    key: 'valemon',
    name: 'Valemon',
    emoji: '🦅',
    attribute: 'datos',
    elements: ['viento', 'luz'],
    weakTo: ['rayo', 'hielo'],
    resists: ['planta'],
    tier: 'mega',
    base: { hp: 194, attack: 136, defense: 128, speed: 142 },
    catchRate: 5,
    learnset: ['tajo_alas', 'tornado', 'holy_light', 'trueno', 'aliento_dragon'],
    evolutions: [],
    lore: 'Su voz basta para derrumbar montañas.',
  },
  kimeramon: {
    key: 'kimeramon',
    name: 'Kimeramon',
    emoji: '🌋',
    attribute: 'virus',
    elements: ['fuego', 'oscuridad'],
    weakTo: ['agua', 'luz'],
    resists: ['rayo'],
    tier: 'mega',
    base: { hp: 206, attack: 142, defense: 130, speed: 130 },
    catchRate: 5,
    learnset: ['mega_llama', 'darkness_ball', 'garrote', 'aliento_dragon', 'llama_sagradada'],
    evolutions: [],
    lore: 'Cuatro brazos y dos cabezas. Letal por diseño.',
  },
  magnadramon: {
    key: 'magnadramon',
    name: 'Magnadramon',
    emoji: '✨',
    attribute: 'vacuna',
    elements: ['luz'],
    weakTo: ['oscuridad', 'agua'],
    resists: ['rayo', 'metal'],
    tier: 'mega',
    base: { hp: 198, attack: 142, defense: 138, speed: 138 },
    catchRate: 5,
    learnset: ['holy_light', 'juicio_divino', 'trueno', 'rayo', 'promocion'],
    evolutions: [],
    lore: 'Ocho cabezas y un solo cuerpo de luz.',
  },
  groundramon: {
    key: 'groundramon',
    name: 'Groundramon',
    emoji: '🌍',
    attribute: 'datos',
    elements: ['planta', 'tierra'],
    weakTo: ['fuego', 'rayo', 'hielo'],
    resists: ['agua', 'viento'],
    tier: 'mega',
    base: { hp: 212, attack: 138, defense: 146, speed: 112 },
    catchRate: 5,
    learnset: ['espina', 'combo_terrestre', 'rugido_sismico', 'latigazo_cipoll', 'aliento_dragon'],
    evolutions: [],
    lore: 'Un tanque viviente con cien años de vida.',
  },
  // ================= Formas de bifurcación =================
  // Las 6 que hay aquí son los finales alternativos del árbol. Cada una la
  // desbloquea una ruta con requisitos concretos, no el nivel por sí solo.
  mastertyrannomon: {
    key: 'mastertyrannomon',
    name: 'MasterTyrannomon',
    emoji: '👑',
    attribute: 'virus',
    elements: ['tierra'],
    weakTo: ['agua', 'hielo'],
    resists: ['rayo', 'viento'],
    tier: 'mega',
    base: { hp: 208, attack: 138, defense: 140, speed: 108 },
    catchRate: 5,
    learnset: ['combo_terrestre', 'rugido_sismico', 'mega_llama', 'garrote', 'promocion'],
    evolutions: [],
    devolution: {
      to: 'greymon',
      items: { espectro_digimon: 1 },
      note: 'Vuelve a Greymon si te arrepientes de la rama.',
    },
    lore: 'El rey tiranosaurio. Se ocurrio coronarse a si mismo y por eso nadie le discute el trono.',
  },
  skullgreymon: {
    key: 'skullgreymon',
    name: 'SkullGreymon',
    emoji: '💀',
    attribute: 'virus',
    elements: ['oscuridad', 'tierra'],
    weakTo: ['luz', 'agua'],
    resists: ['fuego', 'viento'],
    tier: 'mega',
    base: { hp: 176, attack: 158, defense: 120, speed: 118 },
    catchRate: 5,
    learnset: ['rugido_sismico', 'garrote', 'darkness_ball', 'combo_terrestre', 'mega_llama'],
    evolutions: [],
    devolution: {
      to: 'metalgreymon',
      items: { espectro_digimon: 2 },
      note: 'Vuelve a MetalGreymon si te arrepientes de la rama.',
    },
    lore: 'Un esqueleto con resentment dentro de un cuerpo que ya no le hace falta.',
  },
  cherubimon: {
    key: 'cherubimon',
    name: 'Cherubimon',
    emoji: '😇',
    attribute: 'vacuna',
    elements: ['luz'],
    // La diferencia con HolyAngemon NO es el atributo sino la fragilidad:
    // HolyAngemon aguanta casi de todo, Cherubimon se desmorona con el agua.
    // Esa es la decisión: aguante o velocidad.
    weakTo: ['oscuridad', 'agua'],
    resists: ['rayo'],
    tier: 'ultimate',
    base: { hp: 146, attack: 108, defense: 122, speed: 128 },
    catchRate: 15,
    learnset: ['holy_light', 'juicio_divino', 'rayo', 'trueno', 'promocion'],
    evolutions: [{ to: 'diaboromon', level: 48 }],
    devolution: {
      to: 'angemon',
      items: { espectro_digimon: 1 },
      note: 'Vuelve a Angemon si te arrepientes de la rama.',
    },
    lore: 'Seis alas para volar y seis para poder arrodillarse.',
  },
  diaboromon: {
    key: 'diaboromon',
    name: 'Diaboromon',
    emoji: '😈',
    attribute: 'datos',
    elements: ['oscuridad', 'metal'],
    weakTo: ['luz', 'agua'],
    resists: ['fuego', 'tierra'],
    tier: 'mega',
    base: { hp: 194, attack: 146, defense: 132, speed: 124 },
    catchRate: 5,
    learnset: ['darkness_ball', 'garrote', 'rayo', 'trueno', 'combo_terrestre'],
    evolutions: [],
    devolution: {
      to: 'cherubimon',
      items: { espectro_digimon: 2 },
      note: 'Vuelve a Cherubimon si te arrepientes de la rama.',
    },
    lore: 'El diagrama del Apocalipsis con alas de automata. Cruel por diseño.',
  },
  phoenixmon: {
    key: 'phoenixmon',
    name: 'Phoenixmon',
    emoji: '🔥',
    attribute: 'datos',
    elements: ['fuego', 'viento'],
    weakTo: ['agua', 'hielo'],
    resists: ['rayo'],
    tier: 'mega',
    base: { hp: 186, attack: 132, defense: 126, speed: 148 },
    catchRate: 5,
    learnset: ['mega_llama', 'aliento_dragon', 'tornado', 'tajo_alas', 'holy_light'],
    evolutions: [],
    devolution: {
      to: 'garudamon',
      items: { espectro_digimon: 2 },
      note: 'Vuelve a Garudamon si te arrepientes de la rama.',
    },
    lore: 'El unico que muere y vuelve. Por eso es el mas rapido: ya conoce el truco.',
  },
  seraphimon: {
    key: 'seraphimon',
    name: 'Seraphimon',
    emoji: '⚖️',
    attribute: 'virus',
    elements: ['oscuridad', 'tierra'],
    weakTo: ['luz', 'agua'],
    resists: ['planta', 'viento'],
    tier: 'mega',
    base: { hp: 226, attack: 136, defense: 150, speed: 98 },
    catchRate: 5,
    learnset: ['darkness_ball', 'garrote', 'rugido_sismico', 'latigazo_cipoll', 'combo_terrestre'],
    evolutions: [],
    devolution: {
      to: 'ogremon',
      items: { espectro_digimon: 2 },
      note: 'Vuelve a Ogremon si te arrepientes de la rama.',
    },
    lore: 'El angel de las seis alas guarnecidas de espinas. El mas duro del catalogo.',
  },

};

export function getSpecies(key: string): SpeciesDef | undefined {
  return SPECIES[key];
}

export function resolveSpecies(keys: string[]): SpeciesDef[] {
  return keys.map((k) => SPECIES[k]).filter((s): s is SpeciesDef => Boolean(s));
}

/** Especies que un entrenador puede recibir como inicial. */
/**
 * Los seis Digimon con los que se empieza.
 *
 * Cada uno tiene una identidad de combate distinta y ninguna se solapa con las otras
 * cinco: control, daño directo, veneno, resistencia, agua con prioridad y velocidad.
 * El que se elige decide cómo se pelea el principio del juego, y esa es la razón de
 * que sean seis y no una especie con seis variantes de color.
 *
 * Agumon, Gabumon, Biyomon, Gatomon, Guilmon y Pabumon dejaron de ser starters pero
 * siguen en el bestiario y se capturan en las primeras zonas. Dejarlos fuera sería
 * tirar ocho meses de contenido por cambiar una pantalla de registro.
 */
export const STARTERS = [
  'hagurumon',
  'liollmon',
  'floramon',
  'tapirmon',
  'otamamon',
  'pteromon',
];

/**
 * Digimon salvajes por rango de nivel.
 *
 * Cada banda mantiene un tier concreto a propósito: si un Rookie se topa con un
 * Champion de su mismo nivel es matemáticamente imposible ganarle (sus
 * estadísticas base son un 50% mayores) y el juego se siente roto.
 *
 * Los cortes están donde el jugador evoluciona: Agumon -> Greymon en el 12,
 * Greymon -> MetalGreymon en el 25. Así, la banda 2-11 es de Rookie porque a
 * esas alturas el jugador todavía es un Rookie.
 */
export const ENCOUNTER_TABLES: { minLevel: number; maxLevel: number; keys: string[] }[] = [
  { minLevel: 2, maxLevel: 11, keys: ['goburimon', 'kunemon', 'betamon', 'veldmon', 'demimeramon'] },
  {
    minLevel: 12,
    maxLevel: 24,
    keys: ['greymon', 'garurumon', 'birdramon', 'angemon', 'togemon', 'growlmon'],
  },
  {
    minLevel: 25,
    maxLevel: 45,
    keys: [
      'metalgreymon',
      'weregarurumon',
      'garudamon',
      'wargrowlmon',
      'holyangemon',
      'ogremon',
    ],
  },
  {
    minLevel: 46,
    maxLevel: 100,
    keys: ['wargreymon', 'metalgarurumon', 'valemon', 'kimeramon', 'magnadramon', 'groundramon'],
  },
];

/** Moveset según nivel: aprende uno nuevo cada 4 niveles. */
export function movesForLevel(species: SpeciesDef, level: number): string[] {
  const count = Math.min(species.learnset.length, 1 + Math.floor(level / 4));
  return species.learnset.slice(0, count);
}

/** Agrupación de especies salvajes por rango de nivel, para el bestiario. */
export function listWildSpecies(): { minLevel: number; maxLevel: number; species: SpeciesDef[] }[] {
  return ENCOUNTER_TABLES.map((table) => ({
    minLevel: table.minLevel,
    maxLevel: table.maxLevel,
    species: table.keys
      .map((key) => SPECIES[key]!)
      .filter((species, index, all) => all.findIndex((s) => s.key === species.key) === index),
  }));
}
