import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { refOf, refOrEmpty, familiesOf, type SpeciesRef } from '../game/dex.js';

/**
 * Piezas de presentación del bestiario de referencia.
 *
 * ESTO NO GENERA IMÁGENES. El usuario pidió explícitamente no hacerlo, y además
 * Discord no puede pintar una imagen externa dentro de un embed: `setImage` de
 * una URL no renderiza nada. Para ver una foto dentro del bot hay que subir el
 * fichero como adjunto, y casi todo lo del infobox de Fandom es material de uso
 * justo que no se puede redistribuir.
 *
 * Así que lo que se hace es lo correcto en los dos sentidos: se guarda la
 * REFERENCIA (URL, miniatura, fuente, licencia) y se enseña como enlace. Si en
 * algún momento se incorporan imágenes propias con licencia, se leen de `assets/`
 * y se adjuntan; el hueco está preparado en `imagenLocal()`.
 */

const SLOT_EMOJI = '🖼️';

/** Líneas de referencia de una especie, para una ficha. */
export function refLines(ref: SpeciesRef): string[] {
  const lineas: string[] = [];

  lineas.push(`**Level**     ${ref.level ?? '—'}`);
  lineas.push(`**Type**      ${ref.type ?? '—'}`);

  const atributo = ref.attribute
    ? ref.attribute2
      ? `${ref.attribute} / ${ref.attribute2}`
      : ref.attribute
    : '—';
  lineas.push(`**Attribute** ${atributo}`);

  lineas.push(
    `**Family**    ${ref.families.length > 0 ? ref.families.join(' · ') : '—'}`,
  );

  return lineas;
}

/** Una línea corta, para listados donde no cabe un bloque. */
export function refLine(ref: SpeciesRef): string {
  const partes = [
    ref.level ?? '?',
    ref.attribute ?? '?',
    ref.families[0] ?? '—',
  ];
  return partes.join(' · ');
}

/** Botón a la ficha en la fuente, si la hay. */
export function sourceButton(session: { nonce: string }, ref: SpeciesRef): ButtonBuilder | null {
  if (!ref.sourceUrl) return null;

  return new ButtonBuilder()
    .setLabel('Ficha en la fuente')
    .setEmoji('📖')
    .setStyle(ButtonStyle.Link)
    .setURL(ref.sourceUrl);
}

/** Botón a la miniatura, si la hay. Se abre aparte. */
export function imageButton(ref: SpeciesRef): ButtonBuilder | null {
  if (!ref.imageUrl) return null;

  return new ButtonBuilder()
    .setLabel('Ver imagen')
    .setEmoji(SLOT_EMOJI)
    .setStyle(ButtonStyle.Link)
    .setURL(ref.imageUrl);
}

/**
 * Imagen local, si la hubiera.
 *
 * El hook queda preparado y vacío a propósito: meter imágenes en el repositorio
 * exige que tengan licencia, y eso no se decide aquí. Cuando haya material
 * propio, se comprueba `assets/digimon/<clave>.png` y se devuelve la ruta; el
 * resto de la interfaz no tiene que cambiar.
 */
export function imagenLocal(_speciesKey: string): string | null {
  return null;
}

/**
 * Aviso de licencia, cuando la imagen es de uso justo.
 *
 * Se muestra una vez por ficha y no en cada listado: repetido en todas partes
 * es ruido, y una vez se lee.
 */
export function licenseNote(ref: SpeciesRef): string {
  if (!ref.imageNonFree) return '';

  return (
    '_Imagen de uso justo: se enlaza a la fuente, no se redistribuye._'
  );
}

/** Datos de referencia de varias especies, para una pantalla de listado. */
export function refsOf(claves: readonly string[]): SpeciesRef[] {
  return claves.map((k) => refOrEmpty(k));
}

/** Especies que comparten al menos una familia con esta. */
export function familiaDe(speciesKey: string): string | null {
  return familiesOf(speciesKey)[0] ?? null;
}

/** Botones de referencia, reunited en una fila. */
export function refRow(session: { nonce: string }, ref: SpeciesRef): ActionRowBuilder<ButtonBuilder>[] {
  const botones = [sourceButton(session as never, ref), imageButton(ref)].filter(
    (b): b is ButtonBuilder => b !== null,
  );

  if (botones.length === 0) return [];
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(...botones)];
}

export { refOf, refOrEmpty };