import 'dotenv/config';
import { resolve } from 'node:path';

export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN ?? '',
    clientId: process.env.DISCORD_CLIENT_ID ?? '',
    /**
     * Opcional: guild de desarrollo para que los comandos aparezcan al instante.
     * Vacio en produccion (los comandos se registran globalmente).
     */
    guildId: process.env.DISCORD_GUILD_ID ?? null,
  },
  databasePath: resolve(process.cwd(), process.env.DATABASE_PATH ?? './data/digimon.db'),

  /** Cuantos Digimon pelan a la vez. El resto vive en el PC. */
  maxPartySize: Number(process.env.MAX_PARTY_SIZE ?? 4),

  /** Capacidad del PC (deposito). */
  pcCapacity: Number(process.env.PC_CAPACITY ?? 200),

  /**
   * Mostrar las ilustraciones de referencia DENTRO de los embeds.
   *
   * POR DEFECTO NO. Y no es una decisión técnica: el arte de Digimon es material
   * de Bandai y Toei, la wiki que lo cataloga lo marca como no libre, y embebido
   * en Discord es mostrar material protegido.
   *
   * Con esto apagado, la ficha del Digimon lleva un botón a la página de origen.
   * Eso es lo que un catálogo puede hacer sin problemas: decir de dónde viene la
   * referencia y dejar que el jugador la mire.
   *
   * Encenderlo es una asunción de responsabilidad de quien opera el bot. Y
   * aunque esté encendido, `catalogo.ts` sigue sin embeber las imágenes cuya
   * licencia no se ha podido verificar: una bandera general no puede pasar por
   * encima de un dato que dice "no lo sé".
   */
  imagenesEmbed: process.env.IMAGENES_EMBED === '1',
} as const;

/**
 * Valida las variables de Discord solo cuando de verdad hacen falta.
 *
 * Antes `config` reventaba al importarse, y eso rompia `npm test` y las
 * herramientas de `tools/`, que no tocan Discord pero importan el modulo
 * (vía repository -> config). El error ahora sale en el punto de uso, que es
 * donde el mensaje puede ser util.
 */
export function requireDiscordEnv(): {
  token: string;
  clientId: string;
  guildId: string | null;
} {
  const missing: string[] = [];
  if (!config.discord.token) missing.push('DISCORD_TOKEN');
  if (!config.discord.clientId) missing.push('DISCORD_CLIENT_ID');

  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de entorno: ${missing.join(', ')}.\n` +
        'Copia .env.example a .env y rellénalas.',
    );
  }

  return config.discord;
}
