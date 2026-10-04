import type { Stats } from './types.js';

/**
 * Curvas de crecimiento por estadística.
 * stat(nivel) = base * (1 + crecimiento * (nivel - 1))
 *
 * El HP crece algo MÁS rápido que el Ataque a propósito: un Digimon aguanta más
 * golpes de los que hace, y eso hace que un turno de daño no cierre la pelea.
 * Con todo igual, los combates duraban la mitad.
 *
 * Lo que NO crece con el nivel es la duración de la pelea, y esa es la comprobación
 * que importa. Medida con la misma especie a distintos niveles (Agumon: 5, 20,
 * 40, 60, 80 y 100) da 4, 4, 3, 3, 3 y 3 turnos. Plana, como debe ser: si subía
 * con el nivel, el Techo del juego sería un castigo.
 */
const GROWTH = {
  hp: 0.13,
  attack: 0.1,
  defense: 0.09,
  speed: 0.06,
} as const;

/** Techo del primer ciclo. El Rebirth lo sube; ver `game/rebirth.ts`. */
export const MAX_LEVEL = 100;

/**
 * Factor global de daño.
 *
 * La fórmula clásica ((2·nivel/5 + 2) · potencia · atq/def / N) da números
 * demasiado altos para nuestro reparto de PV base: con N = 8 un golpe de
 * potencia 70 arrasaba más de la mitad de la vida del rival.
 *
 * EL VALOR ANTERIOR (0.42) ESTABA CALIBRADO CUANDO LOS BUFFS NO CADUCABAN, y
 * conviene saber de dónde salió para no volver a ajustarlo a ciegas. Antes,
 * `Promoción` (x1.5 de Ataque, x1.4 de Velocidad) se multiplicaba una vez por
 * cada uso y se quedaba así hasta el final. En una pelea de 25 turnos eso
 * acababa en multiplicadores de 4 o más: el daño era de ficción y el combate se
 * resolvía en la mitad de turnos de los que se veían.
 *
 * Al caducar los buffs —que es lo correcto— las peleas se alargaron a 48 turnos
 * en Mega y 71 en el techo. No se había roto el daño: es que por fin se veía.
 *
 * El valor sale de MEDIR, no de suponer. Y hacen falta DOS barridos, porque con
 * uno solo se tomó una conclusión que era justo la contraria de la verdad.
 *
 *  - `npm run balance:turnos` — espejo contra la misma especie: el caso más duro,
 *    sin ventaja de atributo y con la afinidad elemental contra sí mismo.
 *  - `npm run balance:real` — contra salvajes de zona, que es lo que se juega.
 *
 *     escala |  Nv.5 | Nv.18 | Nv.35 | Nv.55
 *        0.42 |    11 |    17 |    48 |    71     <- buffs apilados, luego no
 *         0.8 |     7 |    10 |    21 |    32
 *         0.9 |     6 |     8 |    19 |    28
 *        1.00 |     5 |     8 |    17 |    24     <- este
 *         1.1 |     5 |     7 |    15 |    22
 *
 * Se elige 1.0 porque cumple la ventana que el test exige (mediana entre 3 y 25)
 * en los cuatro niveles y es la mejor distribución entre ellos. También porque
 * es 1/8, el mismo divisor de la fórmula de daño: si hay que recalibrar, el
 * número se lee como "el doble de potencia" y no como un decimal misterioso.
 *
 * LO QUE HAY QUE SABER PARA NO VOLVER A EQUIVOCARSE: la duración NO crecía con
 * el nivel, crecía con la ESPECIE. Medir solo espejo-y-nivel dio un número, y
 * ajustar el daño con él dejó a los Digimon altos en 71 turnos mientras el
 * Agumon estaba en 4. La causa era la energía (ver `maxEnergyForLevel`), no el
 * daño. Con la energía escalada, la misma escala da 5-24 en vez de 4-20.
 *
 * `DAMAGE_SCALE_AUTOTUNE` existe solo para repetir los barridos. Si no está
 * definida, el valor es el de abajo.
 */
const AUTOTUNE = Number(process.env.DAMAGE_SCALE_AUTOTUNE ?? Number.NaN);

export const DAMAGE_SCALE = Number.isFinite(AUTOTUNE) ? AUTOTUNE : 1.0;

export function computeStats(base: Stats, level: number): Stats {
  const lvl = Math.max(1, level);
  return {
    hp: Math.round(base.hp * (1 + GROWTH.hp * (lvl - 1))),
    attack: Math.round(base.attack * (1 + GROWTH.attack * (lvl - 1))),
    defense: Math.round(base.defense * (1 + GROWTH.defense * (lvl - 1))),
    speed: Math.round(base.speed * (1 + GROWTH.speed * (lvl - 1))),
  };
}

/**
 * Energía máxima por combate. Se regenera al empezar cada batalla.
 *
 * ESCALA CON EL NIVEL, y no debería hacerlo.
 *
 * La energía se quedaba en 5 para todos los niveles. Con un tope fijo, los Digimon
 * de nivel alto se atascan: sus mejores movimientos cuestan 3 o 4, así que solo
 * pueden usarlos un turno de cada dos, y encima el cooldown los deja fuera un
 * turno más. El resultado medido eran 48 turnos para un espejo de MetalGreymon y
 * 71 de WarGreymon, contra 4 de Agumon.
 *
 * Y lo grave no era la duración: era que el combate se decidía por la ENERGY BAR
 * y no por las decisiones. Un jugador con un Digimon alto no podia ni plantearse
 * usar a Ada o Juicio Divino dos veces seguidas, porque el motor le decía que no
 * por saldo, no porque tuviera una razón.
 *
 * Con +1 de energía cada 12 niveles, el tope llega a 12 en el nivel 100: un
 * movimiento caro sigue siendo una decisión, pero un Digimon alto ya tiene
 * suficiente para elegir entre dos opciones en un turno, que es de lo que
 * trata el combate.
 */
export function maxEnergyForLevel(level: number): number {
  return 4 + Math.floor(level / 12);
}

/** Exp necesaria para pasar de `level` a `level + 1`. */
export function expToNextLevel(level: number): number {
  return Math.floor(12 * Math.pow(level, 1.6));
}

/** Recompensa base por derrotar a un digimon de nivel `enemyLevel`. */
export function expReward(enemyLevel: number, tierBonus = 1): number {
  return Math.floor(enemyLevel * 9 * tierBonus);
}

export function digibyteReward(enemyLevel: number): number {
  return Math.floor(enemyLevel * 4);
}

/** Devuelve los digibytes gastados al curar en la clínica. */
export function healCost(digimon: number): number {
  return digimon * 50;
}
