import { Client, GatewayIntentBits, Events, MessageFlags } from 'discord.js';
import { requireDiscordEnv } from './config.js';
import { lookupCommand } from './commands/index.js';
import { handleStarterSelect } from './commands/perfil.js';
import { handleDigiviceAction } from './commands/digivice.js';
import { handleZoneAction } from './commands/zonas.js';
import { checkCommand, rateLimitMessage } from './services/rateLimit.js';
import { findTrainer } from './game/repository.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (ready) => {
  console.log(`✅ ${ready.user.tag} conectado. Comandos slash listos.`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = lookupCommand(interaction.commandName);
      if (!command) {
        await interaction.reply({
          content: 'Ese comando ya no existe. Prueba con `/ayuda`.',
          ephemeral: true,
        });
        return;
      }

      // El freno va ANTES de ejecutar: si el comando abre collectors o escribe,
      // no queremos llegar a la API para luego devolver un error.
      const verdict = checkCommand(interaction.user.id, interaction.commandName);
      if (!verdict.allowed) {
        await interaction.reply({
          embeds: [rateLimitMessage(verdict)],
          ephemeral: true,
        });
        return;
      }

      await command.execute(interaction);
      return;
    }

    // Botones de navegacion (`n:...`). Primero de todo y con `return`: el
    // router lleva el estado de la sesion y decide a donde va cada clic.
    if (interaction.isButton() && interaction.customId.startsWith('n:')) {
      const handled = await handleNavButton(interaction);
      if (handled) return;
    }

    // Selects de la interfaz (`sel:...`). Se validan con la misma sesión y
    // el mismo nonce que los botones: no son una excepción.
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('sel:')) {
      const handled = await handleSelect(interaction);
      if (handled) return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('perfil:')) {
      await handleStarterSelect(interaction, interaction.values[0]!);
      return;
    }

    // Botones globales del Digivice y del PC (`dv:...`). Se despachan aqui
    // porque los usan varios comandos: /digivice, /equipo y /pc.
    if (interaction.isButton() && interaction.customId.startsWith('dv:')) {
      const trainer = findTrainer(interaction.user.id);
      if (!trainer) {
        await interaction.reply({
          content: 'Usa `/perfil` para registrarte.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const [, action] = interaction.customId.split(':');

      // "inicio" y "guardar" llegan de /equipo, donde no hay collector propio.
      if (action === 'inicio' || action === 'guardar') {
        await interaction.deferUpdate();
        await handleDigiviceAction(interaction, trainer.id);
        return;
      }

      await handleDigiviceAction(interaction, trainer.id);
      return;
    }

    // Botones de las zonas (`zona:...`): lanzan combates, así que van por el
    // mismo camino que /rival.
    if (interaction.isButton() && interaction.customId.startsWith('zona:')) {
      const trainer = findTrainer(interaction.user.id);
      if (!trainer) {
        await interaction.reply({
          content: 'Usa `/perfil` para registrarte.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await handleZoneAction(interaction, trainer.id);
      return;
    }

    // Botones de reclamo de misiones (`mis:reclamar:<id>:<periodo>`). Pagan y
    // marcan en una sola operación: pulsar dos veces no cobra dos veces.
    if (interaction.isButton() && interaction.customId.startsWith('mis:')) {
      await handleMissionClaim(interaction);
      return;
    }
  } catch (error) {
    console.error('[interaction] error:', error);

    const message =
      '❌ Ha ocurrido un error al procesar el comando. Inténtalo de nuevo en un momento.';
    if (interaction.isRepliable()) {
      await interaction
        .reply({ content: message, flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  }
});

client.login(requireDiscordEnv().token).catch((error) => {
  console.error('No se pudo iniciar sesión en Discord:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('[unhandledRejection]', error);
});

// La interfaz: un solo punto de entrada para los botones de navegacion.
import { handleNavButton, handleSelect } from './ui/router.js';

import { handleMissionClaim } from './services/missionButtons.js';