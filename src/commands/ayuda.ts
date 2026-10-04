import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import { COLORS } from '../views/embeds.js';
import { config } from '../config.js';
import { RATE_LIMIT_INFO } from '../services/rateLimit.js';

export const data = new SlashCommandBuilder()
  .setName('ayuda')
  .setDescription('Muestra la guía de inicio del juego.');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('📘 Digimon MMO · Guía rápida')
    .setDescription(
      'Un RPG por turnos ambientado en el Mundo Digital. Estos son los comandos disponibles.',
    )
    .addFields(
      {
        name: 'Primeros pasos',
        value: [
          '1️⃣ `/perfil` — elige tu primer Digimon',
          '2️⃣ `/digivice` — míralo y gestiona el equipo',
          '3️⃣ `/explorar` — busca un rival por la zona',
          '4️⃣ Botones: **Atacar**, **Objetos**, **Capturar**, **Defender**, **Huir**',
          '5️⃣ Al subir de nivel se **desbloquean rutas**, pero no te transformas',
          '   hasta que uses `/evolucion elegir`',
          '6️⃣ `/mazmorra ver` — contenido para equipos ya formados',
          '7️⃣ `/misiones diarias` — un motivo para volver cada día',
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Comandos',
        value: [
          '`/digivice` — tu dispositivo: líder y equipo',
          '`/perfil` — ficha de entrenador',
          '`/explorar` — encuentro por la zona',
          '`/rival [jefe]` — trainers con equipo de varios Digimon',
          '`/entrenadores` — quién hay y a qué nivel',
          '`/atacar <especie> [nivel]` — combate a medida',
          '`/evolucion ver|elegir|regresar` — árbol y ramas',
          '`/equipo ver|lider|guardar|descansar` — plantilla',
          '`/equipo arma|quitar|mejorar` — equipo permanente',
          '`/pc ver|guardar|sacar` — depósito',
          '`/tienda ver|comprar|inventario` — economía',
          '`/zonas ver|ir|jefe` — viaje y guardianes',
          '`/pvp buscar|rango|diaria` — competitivo',
          '`/mazmorra ver|entrar` — salas encadenadas',
          '`/misiones diarias|semanales` — objetivos del día o la semana',
          '`/logros ver|titulos` — hitos de por vida',
          '`/incursion ver|atacar|ranking` — jefe global',
          '`/apodo <id> <nombre>` — nombra a un Digimon',
          '`/leaderboard` — clasificación global',
          '`/pokedex` · `/descubrir` — bestiario',
        ].join('\n'),
        inline: false,
      },
      {
        name: '⚖️ El sistema de tipos (dos capas)',
        value: [
          '**1. Atributo** (piedra-papel-tijera)',
          'Vacuna > Virus > Datos > Vacuna',
          'Free, Unknown, Variable y Sin Datos son',
          'neutrales: siempre ×1.',
          '',
          '**2. Elemento** (afinidad de cada Digimon)',
          '◎ muy débil ×1.8  ·  △ resiste ×0.6',
          '',
          'Se multiplican entre sí. Un Ataque de tipo',
          'Vacuna (fuerte contra Virus) que además es',
          'Fuego contra un rival muy débil a Fuego pega',
          '`1.25 × 1.8 × 1.2 = 2.7×`. Ese mismo ataque',
          'contra uno que resiste Fuego se queda en `0.9×`.',
          '',
          'El **panel de análisis** del `/digivice` te dice',
          'cuánto pega cada movimiento contra cada rival.',
        ].join('\n'),
        inline: false,
      },
      {
        name: '👝 Equipo, PC y líder',
        value: [
          `· **${config.maxPartySize}** Digimon peleando a la vez`,
          `· El resto espera en el PC (hasta ${config.pcCapacity})`,
          '· El **líder** sale primero y abre el combate',
          '· Si lo mandas al PC, otro asume el liderazgo',
          '· Al acabar un combate, el equipo descansa',
        ].join('\n'),
        inline: false,
      },
      {
        name: '💰 Economía',
        value:
          'Los DigiBytes se ganan en combate y se gastan en `/tienda`. ' +
          'Los objetos que usas en combate salen de tu inventario: cada Poción ' +
          'que compras es un uso más en cada combate futuro.',
        inline: false,
      },
      {
        name: 'Reglas del combate',
        value: [
          '· El turno se decide por **prioridad** y luego **Velocidad**',
          '· La energía se recarga +1 por turno (máx. 4, y 5 desde Nv.15)',
          '· **Capturar** funciona mejor con el rival a poca vida',
          '· Si tu activo cae, eliges otro del equipo (los caídos no vuelven)',
          '· Los **jefes** no se pueden esquivar',
        ].join('\n'),
        inline: false,
      },
      {
        name: '⏳ Rate limit',
        value: RATE_LIMIT_INFO,
        inline: false,
      },
    )
    .setFooter({ text: '¿Listo? Empieza con /perfil' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
