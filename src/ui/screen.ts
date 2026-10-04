import type { EmbedBuilder, MessageFlags, RepliableInteraction } from 'discord.js';
import type { Trainer } from '../game/repository.js';
import type { View } from './components.js';
import type { NavSession } from './session.js';

/**
 * Contrato de una pantalla.
 *
 * Una pantalla es una función pura de "estado -> vista". Recibe el jugador, sus
 * parámetros y las herramientas de navegación, y devuelve embeds y botones. No
 * escribe en la base de datos, no tira dados y no decide reglas: si una pantalla
 * necesita alterar algo, pide un servicio (`claimAndPayMission`, `equipItem`,
 * `evolveInto`) y luego se vuelve a pintar.
 *
 * Esa es la frontera que pediste:
 *
 *     GUI / navegacion  ->  Services  ->  Engine  ->  Repository  ->  DB
 *
 * Los botones no llevan lógica dentro: llevan un destino. Toda la lógica vive
 * en el servicio que el destino llama, lo que hace que el mismo destino
 * funcione igual desde un botón, desde un comando o desde un test.
 */

export type FlashKind = 'ok' | 'aviso' | 'error';

export interface ScreenContext {
  /** La interacción que ha abierto o cambiado la pantalla. */
  interaction: RepliableInteraction;

  trainer: Trainer;
  session: NavSession;
  params: Record<string, string>;

  /** Pinta la vista: edita el mensaje actual, o responde si es el primero. */
  present(view: View): Promise<void>;

  /**
   * Va a otra pantalla y apila, para que "Atrás" funcione.
   *
   * Es el equivalente visual de `cd` seguido de `ls`.
   */
  go(screen: string, params?: Record<string, string>): Promise<void>;

  /**
   * Repinta la pantalla actual sin apilar.
   *
   * Para cuando la acción cambió el estado pero el jugador sigue en el mismo
   * sitio: comprar en la tienda, Receive un item, evolucionar.
   */
  refresh(screen?: string, params?: Record<string, string>): Promise<void>;

  /** Un paso atrás. No hace nada si ya no hay historial. */
  back(): Promise<void>;

  /** Al Digivice, vaciando el historial. */
  home(): Promise<void>;

  /**
   * Deja un mensaje para la siguiente pantalla.
   *
   * Sobrevive al salto porque vive en la sesión, no en el mensaje: sin esto, el
   * resultado de una acción (comprar, evolucionar) desaparecería al cambiar de
   * pantalla y el jugador no sabría si le funcionó.
   */
  flash(message: string, kind?: FlashKind): void;

  /** Parámetro numérico, con valor por defecto si falta o no es número. */
  num(key: string, fallback: number): number;

  /** Parámetro de página (base 1). */
  page(): number;
}

/**
 * Lo que devuelve una pantalla.
 *
 * `void` significa "esta pantalla ya ha pintado lo suyo y no me toca a
 * mí". Lo usa el combate: cuando arrancas una pelea desde un botón, la
 * pantalla de combate se queda con el mensaje y la de zona no tiene nada
 * que decir. Devolver una vista vacía en ese caso la borraría.
 */
export type ScreenResult = View | void;

export type ScreenHandler = (ctx: ScreenContext) => Promise<ScreenResult>;

export interface ScreenDef {
  id: string;
  /** A qué área pertenece, para saber el color de la cabecera. */
  handler: ScreenHandler;
}

/**
 * Registro de pantallas.
 *
 * Las pantallas se registran al ser importadas. `router.ts` importa el índice de
 * pantallas, así que ninguna pantalla necesita importar al router: la
 * navegación se resuelve por el contexto que le pasa, no por una referencia
 * circular.
 */
const registry = new Map<string, ScreenHandler>();

export function register(id: string, handler: ScreenHandler): void {
  if (registry.has(id)) {
    // Dos pantallas con el mismo id: la segunda sobrescribiría a la primera en
    // silencio y el jugador acabaría en un sitio distinto del que cree.
    throw new Error(`Pantalla duplicada: "${id}" ya está registrada`);
  }
  registry.set(id, handler);
}

export function getScreen(id: string): ScreenHandler | undefined {
  return registry.get(id);
}

export function hasScreen(id: string): boolean {
  return registry.has(id);
}

export function screenIds(): string[] {
  return [...registry.keys()].sort();
}

/** Metadatos para el verificador. */
export function registrySize(): number {
  return registry.size;
}

export type { View, EmbedBuilder, Trainer, RepliableInteraction, MessageFlags, NavSession };