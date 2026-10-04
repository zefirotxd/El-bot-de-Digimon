import type { NavEntry, NavSession } from './session.js';

/**
 * Codificación de los botones.
 *
 * Discord limita `custom_id` a 100 caracteres, así que el formato es corto y
 * plano, sin JSON ni base64:
 *
 *     n:<pantalla>:<clave>=<valor>:<clave>=<valor>:<nonce>
 *
 * `<pantalla>` son identificadores de dos o tres letras (`mapa`, `zona`, `dgd`)
 * porque los nombres largos se comen el presupuesto del nonce y de los
 * parámetros, y el nonce es lo que impide que un mensaje viejo actúe.
 *
 * Los parámetros NO llevan el `userId`: la sesión se busca por
 * `interaction.user.id`, que Discord ya ha resuelto y en el que no podemos
 * mentir. Meter el usuario en el botón solo serviría para que un button false
 * (los que ve el resto del canal) fuera inyectado por otra persona.
 */

const PREFIX = 'n';

/** Longitud máxima real de Discord. Si nos pasamos, el registro de comandos falla. */
export const CUSTOM_ID_MAX = 100;

/**
 * NO hay mapa de abreviaturas, y es a propósito.
 *
 * La primera versión tenía `zone -> z`. Funcionaba hasta que una pantalla usó
 * `z=` como nombre literal: al decodificar, `z` se expandía a `zone` y la
 * pantalla leía `params.z`, que no existía. Cuatro caracteres ahorrados no
 * justifican un nombre que se puede desambiguar mal.
 */
export interface DecodedNav {
  screen: string;
  params: Record<string, string>;
  nonce: string;
}

export function encodeNav(session: NavSession, screen: string, params: Record<string, string> = {}): string {
  const entries: [string, string][] = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    // El separador no puede aparecer dentro del valor: rompería la estructura
    // y el destino se leería como otra pantalla.
    .map(([key, value]) => [key, String(value).replace(/[|:=]/g, '_')] as [string, string]);

  const nonce = session.nonce;
  const build = () =>
    [PREFIX, screen, ...entries.map(([k, v]) => `${k}=${v}`), nonce].join(':');

  let id = build();

  // Discord RECHAZA el registro si un custom_id pasa de 100 caracteres, y eso
  // tumba el comando entero. Mejor un destino sin un parámetro que ningún
  // botón: la pantalla usa su valor por defecto y sigue funcionando.
  //
  // Se descartan parámetros de mayor a menor, nunca se truncan. Un `speciesKey`
  // cortado a la mitad no es "el primero que empiece por agum", es un id que no
  // existe, y el jugador aterriza en un error sin entender por qué.
  while (id.length > CUSTOM_ID_MAX && entries.length > 0) {
    let longest = 0;
    for (let i = 1; i < entries.length; i++) {
      if (entries[i]![1].length > entries[longest]![1].length) longest = i;
    }
    entries.splice(longest, 1);
    id = build();
  }

  // Si ni droppingo basta, el problema es el nombre de la pantalla.
  if (id.length > CUSTOM_ID_MAX) {
    const room = CUSTOM_ID_MAX - PREFIX.length - nonce.length - 2;
    return [PREFIX, screen.slice(0, room), nonce].join(':');
  }

  return id;
}

export function decodeNav(customId: string): DecodedNav | null {
  const parts = customId.split(':');
  if (parts[0] !== PREFIX || parts.length < 3) return null;

  const screen = parts[1]!;
  if (!/^[a-z0-9_]+$/.test(screen)) return null;

  const params: Record<string, string> = {};
  const nonce = parts[parts.length - 1]!;

  for (const part of parts.slice(2, -1)) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    params[part.slice(0, eq)!] = part.slice(eq + 1)!;
  }

  return { screen, params, nonce };
}

export function isNavId(customId: string): boolean {
  return customId.startsWith(`${PREFIX}:`);
}

/** Identificador de una entrada de la pila, para compararlas. */
export function entryKey(entry: NavEntry): string {
  const params = Object.entries(entry.params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return `${entry.screen}?${params}`;
}