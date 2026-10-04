import type { VistaExpedicion } from '../services/dungeonRun.js';

/**
 * Paneles de la expedición.
 *
 * Solo de lectura y solo formato. Que el panel de recursos se dibuje aquí y no en
 * la pantalla no es una casualidad: hay tres pantallas que lo pintan y si cada una
 * calculara la barra por su cuenta, tres barras dirían tres cosas distintas en la
 * misma partida.
 */

function barra(valor: number, max: number, ancho = 10): string {
  if (max <= 0) return '█'.repeat(ancho);

  const llenos = Math.round((valor / max) * ancho);
  return '█'.repeat(Math.max(0, Math.min(ancho, llenos))) + '░'.repeat(ancho - Math.max(0, Math.min(ancho, llenos)));
}

/** Los recursos de la expedición: lo que hace decidir si sigue o se retira. */
export function panelRecursos(vista: VistaExpedicion): string {
  const e = vista.expedicion;

  const energiaMax = Math.max(12, e.energia);
  const pocionMax = 5;

  const minutos = Math.floor(e.duracionSeg / 60);
  const segundos = e.duracionSeg % 60;
  const tiempo = `${minutos}m ${segundos.toString().padStart(2, '0')}s`;

  const lineas = [
    `**ENERGÍA** \`${barra(e.energia, energiaMax)}\` ${e.energia}`,
    `**POCIONES** \`${barra(e.pociones, pocionMax)}\` ×${e.pociones}`,
    `**TIEMPO** ⏱️ ${tiempo}`,
  ];

  if (e.checkpoint) {
    lineas.push(`💾 Checkpoint: piso ${e.checkpoint.piso}`);
  }

  if (e.energia <= 2) {
    // Se avisa antes de quedarse sin energía. Sin energía no se puede mover, y
    // quedarse encerrado sin avisar es la peor forma de perder una expedición.
    lineas.push('', '⚠️ **Te quedan muy pocas.** Sin energía no te mueves: o vuelves o gastas lo que queda.');
  }

  return lineas.join('\n');
}

/** El resumen de la expedición, para la pantalla de salida. */
export function panelResumen(vista: VistaExpedicion, digibytes: number, objetos: number): string {
  const e = vista.expedicion;
  const minutos = Math.floor(e.duracionSeg / 60);

  return [
    `Piso ${e.pisoActual} · ${vista.explorado}/${vista.total} casillas`,
    `⏱️ ${minutos} min`,
    '',
    `💰 **${digibytes.toLocaleString('es')}** DigiBytes asegurados`,
    `🎒 **${objetos}** objetos asegurados`,
  ].join('\n');
}

/** Un mensaje de "no se puede" con el motivo del servicio, sin inventar nada. */
export function motivoDe(motivo: string): string {
  switch (motivo) {
    case 'fuera':
      return '🧱 Aquí no hay nada. El borde de la mazmorra.';
    case 'pared':
      return '🧱 No se puede pasar. No has visto nada al otro lado.';
    case 'cerrada':
      return '🔒 Está cerrado. Algo tiene que abrirlo.';
    case 'energia':
      return '🔋 Te has quedado sin energía. No puedes avanzar más.';
    case 'terminado':
      return 'La expedición ya no está activa.';
    default:
      return 'No se puede.';
  }
}

export { barra };