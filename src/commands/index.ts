import type { ChatInputCommandInteraction, RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';
import * as perfil from './perfil.js';
import * as equipo from './equipo.js';
import * as combate from './combate.js';
import * as pokedex from './pokedex.js';
import * as ayuda from './ayuda.js';
import * as digivice from './digivice.js';
import * as pc from './pc.js';
import * as tienda from './tienda.js';
import * as zonas from './zonas.js';
import * as apodo from './apodo.js';
import * as leaderboard from './leaderboard.js';
import * as pvp from './pvp.js';
import * as evolucion from './evolucion.js';
import { incursion, incursionExecute, mazmorra, mazmorraExecute } from './mazmorra.js';
import { logros, logrosExecute, misiones, misionesExecute } from './misiones.js';

export interface Command {
  /** Cualquier builder de slash command de discord.js. */
  data: { name: string; toJSON(): RESTPostAPIApplicationCommandsJSONBody };
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

/**
 * Registro de comandos. Para añadir uno nuevo: créalo en ./commands y
 * añádelo a esta lista.
 */
export const COMMANDS: Command[] = [
  { data: perfil.data, execute: perfil.execute },
  { data: digivice.data, execute: digivice.execute },
  { data: pc.data, execute: pc.execute },
  { data: tienda.data, execute: tienda.execute },
  { data: zonas.data, execute: zonas.execute },
  { data: apodo.data, execute: apodo.execute },
  { data: leaderboard.data, execute: leaderboard.execute },
  { data: pvp.data, execute: pvp.execute },
  { data: evolucion.data, execute: evolucion.execute },
  { data: mazmorra, execute: mazmorraExecute },
  { data: incursion, execute: incursionExecute },
  { data: misiones, execute: misionesExecute },
  { data: logros, execute: logrosExecute },
  { data: combate.data, execute: combate.execute },
  { data: combate.atacarData, execute: combate.atacar },
  { data: combate.rivalData, execute: combate.rival },
  { data: combate.trainersData, execute: combate.trainers },
  { data: equipo.data, execute: equipo.execute },
  { data: pokedex.data, execute: pokedex.execute },
  { data: ayuda.data, execute: ayuda.execute },
  { data: perfil.discoverData, execute: perfil.discover },
];

const byName = new Map(COMMANDS.map((command) => [command.data.name, command]));

export function lookupCommand(name: string): Command | undefined {
  return byName.get(name);
}
