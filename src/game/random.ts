/**
 * Generador pseudoaleatorio con semilla. Permite battles reproducibles
 * (útil para tests y para depurar un combate concreto).
 */
export class Rng {
  private state: number;

  constructor(seed = Date.now() >>> 0) {
    this.state = Rng.mix(seed);
  }

  /**
   * Dispersa la semilla (splitmix32). Sin este paso, xorshift32 con semillas
   * consecutivas (1, 2, 3...) produce casi la misma primera salida, y cualquier
   * bucle "new Rng(base + i)" genera exactamente la misma secuencia: los
   * encuentros de cada nivel salían siempre con la misma especie.
   */
  private static mix(seed: number): number {
    let x = seed >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
    x = (x ^ (x >>> 15)) >>> 0;
    return x === 0 ? 1 : x;
  }

  /** Float en [0, 1). */
  next(): number {
    // xorshift32
    let x = this.state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.state = x;
    return x / 0x1_0000_0000;
  }

  /** Entero en [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]!;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Baraja un array sin mutarlo. */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  }
}

export const rng = new Rng();
