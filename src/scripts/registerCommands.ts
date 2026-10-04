import { REST, Routes } from 'discord.js';
import { requireDiscordEnv } from '../config.js';
import { COMMANDS } from '../commands/index.js';

const env = requireDiscordEnv();
const body = COMMANDS.map((command) => command.data.toJSON());

const rest = new REST().setToken(env.token);

async function main() {
  if (env.guildId) {
    // Modo desarrollo: los comandos aparecen al instante solo en ese servidor.
    const route = Routes.applicationGuildCommands(env.clientId, env.guildId);
    const result = (await rest.put(route, { body })) as unknown[];
    console.log(`✅ ${result.length} comandos registrados en el servidor de desarrollo.`);
  } else {
    // Modo producción: los comandos tardan hasta 1 hora en propagarse.
    const route = Routes.applicationCommands(env.clientId);
    const result = (await rest.put(route, { body })) as unknown[];
    console.log(`✅ ${result.length} comandos registrados globalmente.`);
  }
}

main().catch((error) => {
  console.error('Error al registrar los comandos:', error);
  process.exit(1);
});
