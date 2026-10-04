import { ensureSession, getSession as getNavSession } from '../ui/session.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Message,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type RepliableInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import {
  captureChance,
  createBattle,
  createTrainerBattle,
  effectiveStat,
  grantExp,
  resolveTurn,
  switchCandidates,
  switchTo,
  type BattleState,
  type OpponentSpec,
} from '../game/combat.js';
import { getMove } from '../game/moves.js';
import { rng } from '../game/random.js';
import { rollEncounter, rollRewards } from '../game/progression.js';
import { getTutorTemplateByName, templateLevel, type TrainerTemplate } from '../game/trainers.js';
import {
  consumeItem,
  countTeam,
  addItem,
  createDigimon,
  findTrainer,
  getInventory,
  giveDigibytes,
  listParty,
  markBossBeaten,
  makePersister,
  restTeam,
  saveBattleResult,
  type Trainer,
} from '../game/repository.js';
import { runOf, energyOf, startRun, worldBossState } from '../game/dungeonRepo.js';
import { bump } from '../game/progressionRepo.js';
import { markCaught, markSeen } from '../game/dexRepo.js';
import { getDungeon } from '../game/dungeons.js';
import { getBoss } from '../game/bosses.js';
import { buildRaidState, buildRoomState, runSummaryEmbed, settleRun } from './runs.js';
import { getSpecies } from '../game/species.js';
import { config } from '../config.js';
import {
  battleEmbed,
  capturedEmbed,
  COLORS,
  escapeEmbed,
  victoryEmbed,
} from '../views/embeds.js';
import { ELEMENT_EMOJI } from '../game/elements.js';
import type { Action, Element, OwnedDigimon } from '../game/types.js';

const BATTLE_TTL_MS = 5 * 60_000;
const MAX_CAPSULES = 3;

/**
 * Una sesión de combate por entrenador. Vive solo en memoria: si el bot se
 * reinicia, las batallas en curso se pierden (los Digimon no se pierden).
 */
interface Session {
  id: string;
  trainerId: number;
  discordUserId: string;
  message: Message;
  state: BattleState;
  mode: 'accion' | 'movimiento' | 'objeto' | 'cambio' | 'terminada';
  /**
   * Contexto de mazmorra o incursión. `null` en un combate normal.
   *
   * Va en la sesión y no en el estado del combate a propósito: el motor no
   * sabe nada de mazmorras, así que el PvE y el PvP siguen siendo el mismo
   * código y nada de esto toca a los Digimon persistidos.
   */
  run: RunContext | null;
}

/**
 * Contexto de una sala de mazmorra o de una incursión global.
 */
export interface RunContext {
  kind: 'mazmorra' | 'incursion';
  /** Clave de mazmorra, o del jefe global si es incursión. */
  key: string;
  name: string;
  /** Sala actual (1-indexada para que se lea como el jugador). */
  roomNumber: number;
  roomTotal: number;
  roomName: string;
  /** Daño hecho al jefe en ESTA sala, para la contribución. */
  bossDamage: number;
  bossMaxHp: number;
  /** Si es la sala final: cerrar la mazmorra al ganar. */
  isFinalRoom: boolean;
}

const sessions = new Map<number, Session>();

/**
 * Deja el combate vivo en la sesión de navegación.
 *
 * La sesión de combate de este módulo resuelve la vigencia del turno y el
 * TTL. La de navegación, indexada por `userId`, resuelve el aislamiento entre
 * jugadores y es lo que la GUI usa para encontrar el combate.
 *
 * Se guarda la MISMA referencia a propósito: `resolveTurn` muta el objeto en
 * sitio, así que un collector viejo y la pantalla nueva ven lo mismo. Dos
 * copias divergirían en el primer turno.
 */
function registrar(session: Session): void {
  sessions.set(session.trainerId, session);
  ensureSession(session.discordUserId, session.trainerId).battle = session.state;
  attachCollectors(session, session.message);
}

export function getSession(trainerId: number): Session | undefined {
  return sessions.get(trainerId);
}

export function hasActiveSession(trainerId: number): boolean {
  const session = sessions.get(trainerId);
  return Boolean(session && !session.state.finished);
}

export function closeSession(trainerId: number, discordUserId?: string): void {
  const session = sessions.get(trainerId);
  sessions.delete(trainerId);

  // Sin esto, la GUI seguiría mostrando un combate ya cerrado: el botón
  // de "Volver" llevaría a una pantalla de un combate que ya no existe.
  if (discordUserId) {
    const nav = getNavSession(discordUserId);
    if (nav) nav.battle = null;
  }
}

// ------------------------------------------------------------- lifecycle ---

/**
 * Como se pinta el combate.
 *
 * Devuelve el `Message` donde se ha puesto, porque el combate necesita
 * colgarle sus collectors encima. La variante por defecto crea un mensaje
 * nuevo (lo que se usa desde un comando); la de edicion reutiliza el que ya
 * hay en pantalla (lo que se usa desde la interfaz).
 */
export interface BattlePayload {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

export type Presenter = (payload: BattlePayload) => Promise<Message>;

export interface StartBattleOptions {
  /** Fuerza una especie concreta (subcomando /atacar). */
  speciesKey?: string;
  level?: number;
}

/**
 * Combate contra un entrenador NPC con equipo de varios Digimon.
 *
 * El equipo del rival se escala al nivel del jugador: una plantilla fija de
 * nivel 38 contra un jugador de nivel 12 no es un combate, es una tontería.
 *
 * Acepta cualquier interacción respondible (comando o botón) porque los
 * botones de `/zonas` también lanzan combates.
 */
export async function startTrainerBattle(
  interaction: RepliableInteraction,
  template: TrainerTemplate,
  present?: Presenter,
): Promise<void> {
  const trainer = findTrainer(interaction.user.id);
  if (!trainer) {
    await interaction.reply({ content: 'Usa `/perfil` primero.', ephemeral: true });
    return;
  }

  if (hasActiveSession(trainer.id)) {
    await interaction.reply({
      content: '⚠️ Ya tienes una batalla en curso. Termínala con los botones.',
      ephemeral: true,
    });
    return;
  }

  const party = listParty(trainer.id);
  if (party.length === 0) {
    await interaction.reply({ content: 'No tienes ningún Digimon.', ephemeral: true });
    return;
  }

  const lead = party[0]!;
  const scale = Math.max(
    0.5,
    Math.min(1.6, lead.level / Math.max(1, templateLevel(template))),
  );

  const opponent: OpponentSpec = {
    team: template.team.map((member) => ({
      species: getSpecies(member.speciesKey)!,
      level: Math.max(1, Math.round(member.level * scale)),
    })),
    trainerName: template.name,
    intro: template.intro,
    boss: template.boss,
    inventory: getInventory(trainer.id),
  };

  // Ver al rival es verlo: su equipo entra en el bestiario aunque no
  // llegues a capturar a nadie.
  for (const member of template.team) markSeen(trainer.id, member.speciesKey);

  const state = createTrainerBattle(party, 0, opponent);
  state.rewardMultiplier = template.rewardBonus;

  const session: Session = {
    id: `${trainer.id}-${state.turn}-${Date.now()}`,
    trainerId: trainer.id,
    discordUserId: interaction.user.id,
    message: null as unknown as Message,
    state,
    mode: 'accion',
    run: null,
  };

  // Pedimos `withResponse` para poder obtener el mensaje y colgarle los
  // collectors de los botones, tanto si viene de un comando como de un botón.
  // Sin presentador, el combate crea su propio mensaje: es lo que pasa
  // cuando lo lanza un comando. Con presentador, se queda donde ya está.
  const show: Presenter =
    present ??
    (async (payload) => {
      const response = await interaction.reply({ ...payload, withResponse: true });
      const resource = response.resource;
      if (!resource || !('message' in resource)) {
        throw new Error('No se pudo crear el mensaje de combate.');
      }
      return resource.message as Message;
    });

  const message = await show({ embeds: [battleEmbed(state)], components: [actionRow(session)] });

  session.message = message;
  sessions.set(trainer.id, session);

/**
 * Deja el combate vivo en la sesión de navegación.
 *
 * La sesión de combate de este módulo resuelve layczeness del turno y el
 * TTL. La de navegación, indexada por `userId`, resuelve el aislamiento entre
 * jugadores y es lo que la GUI usa para encontrarlo.
 *
 * Se guarda la MISMA referencia a propósito: `resolveTurn` muta el objeto en
 * sitio, así que un collector viejo y la pantalla nueva ven lo mismo. Dos
 * copias divergirían en el primer turno.
 */
function registrar(session: Session): void {
  sessions.set(session.trainerId, session);
  ensureSession(session.discordUserId, session.trainerId).battle = session.state;
  attachCollectors(session, session.message);
}

registrar(session);
}

export async function startBattle(
  interaction: ChatInputCommandInteraction,
  options: StartBattleOptions = {},
  present?: Presenter,
): Promise<void> {
  const trainer = findTrainer(interaction.user.id);
  if (!trainer) {
    await interaction.reply({
      content: 'No estás registrado todavía. Usa `/registrarse` para crear tu entrenador.',
      ephemeral: true,
    });
    return;
  }

  if (hasActiveSession(trainer.id)) {
    await interaction.reply({
      content: '⚠️ Ya tienes una batalla en curso. Termínala con los botones del mensaje de combate.',
      ephemeral: true,
    });
    return;
  }

  const party = listParty(trainer.id);
  if (party.length === 0) {
    await interaction.reply({
      content: 'No tienes ningún Digimon. Usa `/registrarse` primero.',
      ephemeral: true,
    });
    return;
  }

  const lead = party[0]!;
  const encounter = options.speciesKey
    ? { species: getSpecies(options.speciesKey)!, level: options.level ?? Math.max(1, lead.level) }
    : rollEncounter(lead.level, rng);

  if (!encounter.species) {
    await interaction.reply({ content: '❌ No encontré esa especie.', ephemeral: true });
    return;
  }

  // La bolsa de objetos sale del inventario real: comprar tiene que importar.
  // Un encuentro cuenta como "vista" aunque te escapes o pierdas: el
  // bestiario sirve para saber a qué volver, no para premiar la captura.
  markSeen(trainer.id, encounter.species.key);

  const state = createBattle(party, 0, encounter.species, encounter.level, getInventory(trainer.id));

  const session: Session = {
    id: `${trainer.id}-${state.turn}-${Date.now()}`,
    trainerId: trainer.id,
    discordUserId: interaction.user.id,
    message: null as unknown as Message,
    state,
    mode: 'accion',
    run: null,
  };

  const show: Presenter =
    present ??
    (async (payload) => {
      const sent = await interaction.reply(payload);
      return ('message' in sent ? sent.message : await interaction.fetchReply()) as Message;
    });

  session.message = await show({ embeds: [battleEmbed(state)], components: [actionRow(session)] });
  sessions.set(trainer.id, session);

registrar(session);
}

// ------------------------------------------------------ mazmorras / incursión ---

/**
 * Arranca (o continúa) una mazmorra.
 *
 * Reutiliza la sesión de combate ENTERA —mismos botones, mismo TTL, mismos
 * telegrafiados de jefe— y solo cambia dos cosas: el embed de cabecera dice
 * dónde estás, y el cierre escala la recompensa por contribución.
 *
 * El cobro de energía y el intento diario los pone `startRun`, antes de tocar
 * nada: si el jugador no puede entrar, no se le crea una sesión a medias.
 */
export async function startDungeon(
  interaction: ChatInputCommandInteraction,
  dungeonKey: string,
): Promise<void> {
  const trainer = findTrainer(interaction.user.id);
  if (!trainer) {
    await interaction.reply({ content: 'Usa `/perfil` primero.', ephemeral: true });
    return;
  }

  if (hasActiveSession(trainer.id)) {
    await interaction.reply({
      content: '⚠️ Ya tienes una batalla en curso. Termínala con los botones.',
      ephemeral: true,
    });
    return;
  }

  const started = startRun(trainer.id, dungeonKey);
  if (!started.ok) {
    await interaction.reply({ content: `⚠️ ${started.message}`, ephemeral: true });
    return;
  }

  const dungeon = getDungeon(dungeonKey);
  const run = started.run;
  if (!dungeon || !run.nextRoom) {
    await interaction.reply({
      content: `Ya completaste ${dungeon?.name ?? dungeonKey} hoy.`,
      ephemeral: true,
    });
    return;
  }

  const party = listParty(trainer.id);
  if (party.length === 0) {
    await interaction.reply({ content: 'No tienes ningún Digimon.', ephemeral: true });
    return;
  }

  const room = run.nextRoom;
  const built = buildRoomState(party, room);
  if ('error' in built) {
    await interaction.reply({ content: `❌ ${built.error}`, ephemeral: true });
    return;
  }

  const roomNumber = run.roomIndex + 1;

  const header = new EmbedBuilder()
    .setColor(COLORS.legendary)
    .setTitle(`${dungeon.emoji} ${dungeon.name} — Sala ${roomNumber}/${dungeon.rooms.length}`)
    .setDescription(
      `**${room.emoji} ${room.name}**\n${room.description}\n\n` +
        (run.roomsCleared > 0
          ? `Llevas **${run.roomsCleared}** sala(s) superadas. Si caes aquí, vuelves a esta.`
          : 'El progreso se guarda sala a sala.'),
    )
    .setFooter({
      text:
        `⚡ ${energyOf(trainer.id).energy} energía · ` +
        `Intentos hoy: ${dungeon.dailyAttempts - run.attemptsLeft}/${dungeon.dailyAttempts}`,
    });

  await launchSession(interaction, trainer.id, built.state, header, {
    kind: 'mazmorra',
    key: dungeonKey,
    name: dungeon.name,
    roomNumber,
    roomTotal: dungeon.rooms.length,
    roomName: room.name,
    bossDamage: 0,
    bossMaxHp: built.bossMaxHp,
    isFinalRoom: built.isFinalRoom,
  });
}

/**
 * Arranca la incursión global.
 *
 * Dos diferencias con una mazmorra: no hay salas (un solo combate largo) y la
 * vida del jefe es COMPARTIDA, así que el daño se guarda en la base de datos y
 * sobrevive a los reinicios del bot.
 */
export async function startRaid(interaction: ChatInputCommandInteraction): Promise<void> {
  const trainer = findTrainer(interaction.user.id);
  if (!trainer) {
    await interaction.reply({ content: 'Usa `/perfil` primero.', ephemeral: true });
    return;
  }

  if (hasActiveSession(trainer.id)) {
    await interaction.reply({
      content: '⚠️ Ya tienes una batalla en curso. Termínala con los botones.',
      ephemeral: true,
    });
    return;
  }

  const boss = worldBossState();
  const def = getBoss(boss.bossKey);

  if (!def) {
    await interaction.reply({ content: '❌ No hay incursión activa.', ephemeral: true });
    return;
  }

  if (boss.currentHp <= 0 || boss.defeatedBy !== null) {
    await interaction.reply({
      content: `${boss.emoji} **${boss.name}** ya ha caído. La siguiente incursión empieza pronto.`,
      ephemeral: true,
    });
    return;
  }

  const party = listParty(trainer.id);
  if (party.length === 0) {
    await interaction.reply({ content: 'No tienes ningún Digimon.', ephemeral: true });
    return;
  }

  const built = buildRaidState(party, trainer.id);
  if ('error' in built) {
    await interaction.reply({ content: `❌ ${built.error}`, ephemeral: true });
    return;
  }

  const header = new EmbedBuilder()
    .setColor(COLORS.legendary)
    .setTitle(`🌐 ${boss.emoji} ${boss.name}`)
    .setDescription(
      `**Vida global: ${Math.round(boss.remaining * 100)}%** ` +
        `(\`${boss.currentHp.toLocaleString('es-ES')}\` / \`${boss.maxHp.toLocaleString('es-ES')}\`)\n` +
        `${boss.participants} participante(s) · ${boss.totalDamage.toLocaleString('es-ES')} de daño total\n\n` +
        'Cada golpe que metas aquí va a la **misma vida** que la de todos los demás.',
    )
    .setFooter({ text: `Termina: ${boss.endsAt.slice(0, 10)} · Paga por daño hecho` });

  await launchSession(interaction, trainer.id, built.state, header, {
    kind: 'incursion',
    key: boss.bossKey,
    name: 'Incursión global',
    roomNumber: 1,
    roomTotal: 1,
    roomName: def.name,
    bossDamage: 0,
    bossMaxHp: built.bossMaxHp,
    isFinalRoom: true,
  });
}

/**
 * Crea la sesión, publica cabecera + combate y engancha los botones.
 *
 * Es lo único que comparten las cuatro formas de arranque (`startBattle`,
 * `startTrainerBattle`, `startDungeon`, `startRaid`). Existe para que el UI del
 * combate no se pueda desincronizar entre ellas: si una tiene un botón menos,
 * nadie se da cuenta hasta que alguien no puede cambiar de Digimon.
 */
async function launchSession(
  interaction: ChatInputCommandInteraction,
  trainerId: number,
  state: BattleState,
  header: EmbedBuilder | null,
  run: RunContext | null,
): Promise<void> {
  const session: Session = {
    id: `run-${trainerId}-${Date.now()}`,
    trainerId,
    discordUserId: interaction.user.id,
    message: null as unknown as Message,
    state,
    mode: 'accion',
    run,
  };

  const embeds = header ? [header, battleEmbed(state)] : [battleEmbed(state)];

  const response = await interaction.reply({
    embeds,
    components: [actionRow(session)],
    withResponse: true,
  });

  const resource = response.resource;
  if (!resource || !('message' in resource)) {
    await interaction.editReply('⚠️ No se pudo crear el mensaje de combate.');
    return;
  }

  session.message = resource.message as Message;
  sessions.set(trainerId, session);
registrar(session);
}

// ----------------------------------------------------------------- render ---

function button(
  customId: string,
  label: string,
  emoji: string,
  style: ButtonStyle,
  disabled = false,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label.slice(0, 80))
    .setEmoji(emoji)
    .setStyle(style)
    .setDisabled(disabled);
}

function actionRow(session: Session): ActionRowBuilder<ButtonBuilder> {
  const { state } = session;
  const capsules = state.items.find((i) => i.key === 'capsula')?.quantity ?? 0;

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`bl:movimiento:${session.id}`, 'Atacar', '⚔️', ButtonStyle.Primary),
    button(`bl:objeto:${session.id}`, 'Objetos', '🧪', ButtonStyle.Secondary),
    button(
      `bl:capturar:${session.id}`,
      `Capturar (${capsules})`,
      '📦',
      ButtonStyle.Secondary,
      capsules <= 0,
    ),
    button(`bl:defender:${session.id}`, 'Defender', '🛡️', ButtonStyle.Secondary),
    // Un jefe no se esquiva: el botón va apagado para no prometer nada falso.
    button(
      `bl:huir:${session.id}`,
      state.isBoss ? 'No puedes huir' : 'Huir',
      '🏃',
      ButtonStyle.Danger,
      state.turn <= 1 || state.isBoss,
    ),
  );
}

function moveMenu(session: Session): ActionRowBuilder<StringSelectMenuBuilder> {
  const { state } = session;
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`bl:sel-mov:${session.id}`)
      .setPlaceholder('Elige un movimiento...')
      .addOptions(
        state.player.moves.map((move) => ({
          label: move.name,
          description:
            move.energyCost > state.player.energy
              ? `Necesitas ${move.energyCost}⚡`
              : `${move.energyCost}⚡ · ${move.category === 'estado' ? 'Estado' : `Pot ${move.power}`}`,
          value: move.key,
          emoji: ELEMENT_EMOJI[move.element as Element],
          default: move.energyCost <= state.player.energy,
        })),
      ),
  );
}

function itemMenu(session: Session): ActionRowBuilder<StringSelectMenuBuilder> {
  const { state } = session;
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`bl:sel-item:${session.id}`)
      .setPlaceholder('Elige un objeto...')
      .addOptions(
        state.items.map((item) => ({
          label: `${item.name} (x${item.quantity})`,
          value: item.key,
          emoji: item.emoji,
          default: item.quantity > 0,
        })),
      ),
  );
}

function switchRow(session: Session): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const digimon of switchCandidates(session.state).slice(0, 4)) {
    row.addComponents(
      button(
        `bl:switch:${session.id}:${digimon.id}`,
        digimon.nickname ?? digimon.species.name,
        digimon.species.emoji,
        ButtonStyle.Success,
      ),
    );
  }
  row.addComponents(
    button(`bl:abandonar:${session.id}`, 'Huir', '🏃', ButtonStyle.Danger),
  );
  return row;
}

async function render(session: Session): Promise<void> {
  const { state } = session;

  if (state.finished) {
    await finalize(session);
    return;
  }

  if (state.awaitingSwitch) {
    await session.message.edit({
      embeds: [
        battleEmbed(state),
        new EmbedBuilder().setColor(COLORS.warning).setDescription(
          '💀 **¡Tu Digimon ha caído!** Elige quién sale a combatir.',
        ),
      ],
      components: [switchRow(session)],
    });
    return;
  }

  const components =
    session.mode === 'movimiento'
      ? [moveMenu(session)]
      : session.mode === 'objeto'
        ? [itemMenu(session)]
        : [actionRow(session)];

  await session.message.edit({ embeds: [battleEmbed(state)], components });
}

// ------------------------------------------------------------- collectors --

function attachCollectors(session: Session, message: Message): void {
  const byOwner = (userId: string) => userId === session.discordUserId;

  const buttons = message.createMessageComponentCollector({
    filter: (i) => i.isButton() && byOwner(i.user.id),
    time: BATTLE_TTL_MS,
  });

  buttons.on('collect', (interaction) => {
    void onButton(session, interaction as ButtonInteraction).catch(async (error) => {
      console.error('[battle] fallo en botón:', error);
      await interaction
        .reply({ content: '❌ Algo salió mal con esa acción.', ephemeral: true })
        .catch(() => {});
    });
  });

  buttons.on('end', (_collected, reason) => {
    if (reason === 'time' && !session.state.finished) void expire(session);
    sessions.delete(session.trainerId);
  });

  const menus = message.createMessageComponentCollector({
    filter: (i) => i.isStringSelectMenu() && byOwner(i.user.id),
    time: BATTLE_TTL_MS,
  });

  menus.on('collect', (interaction) => {
    void onMenu(session, interaction as StringSelectMenuInteraction).catch(async (error) => {
      console.error('[battle] fallo en menú:', error);
      await interaction
        .reply({ content: '❌ Algo salió mal con esa acción.', ephemeral: true })
        .catch(() => {});
    });
  });
}

async function onButton(session: Session, interaction: ButtonInteraction): Promise<void> {
  const [, kind, sessionId, extra] = interaction.customId.split(':');
  if (sessionId !== session.id || session.state.finished) return;

  const { state } = session;

  switch (kind) {
    case 'movimiento':
      await interaction.deferUpdate();
      session.mode = 'movimiento';
      await render(session);
      return;

    case 'objeto':
      await interaction.deferUpdate();
      session.mode = 'objeto';
      await render(session);
      return;

    case 'capturar': {
      await interaction.deferUpdate();
      const capsule = state.items.find((i) => i.key === 'capsula');
      if (!capsule || capsule.quantity <= 0) {
        state.log.push('No te quedan DigiCápsulas. Cópialas en `/tienda`.');
        await render(session);
        return;
      }
      takeTurn(session, { type: 'objeto', item: capsule });
      await render(session);
      return;
    }

    case 'defender':
      await interaction.deferUpdate();
      takeTurn(session, { type: 'defender' });
      await render(session);
      return;

    case 'huir': {
      await interaction.deferUpdate();
      if (state.isBoss) {
        state.log.push('No puedes huir de un jefe. Pelea o cae.');
        await render(session);
        return;
      }
      const faster = effectiveStat(state.player, 'speed') > effectiveStat(state.enemy, 'speed');
      takeTurn(session, { type: 'huir', success: faster || rng.chance(0.3) });
      await render(session);
      return;
    }

    case 'switch': {
      await interaction.deferUpdate();
      switchTo(state, Number(extra));
      session.mode = 'accion';
      await render(session);
      return;
    }

    case 'abandonar':
      await interaction.deferUpdate();
      state.finished = true;
      state.result = 'huida';
      await render(session);
      return;
  }
}

async function onMenu(session: Session, interaction: StringSelectMenuInteraction): Promise<void> {
  const [kind, , sessionId] = interaction.customId.split(':');
  if (sessionId !== session.id || session.state.finished) return;
  await interaction.deferUpdate();

  const choice = interaction.values[0];
  if (!choice) return;
  session.mode = 'accion';

  if (kind === 'sel-mov') {
    const move = getMove(choice);
    if (!move) return;
    if (move.energyCost > session.state.player.energy) {
      session.state.log.push(`No tienes energía suficiente para **${move.name}**.`);
      await render(session);
      return;
    }
    takeTurn(session, { type: 'movimiento', move });
    await render(session);
    return;
  }

  if (kind === 'sel-item') {
    const item = session.state.items.find((i) => i.key === choice);
    if (!item || item.quantity <= 0) {
      session.state.log.push('No tienes ese objeto.');
      await render(session);
      return;
    }

    // Se consume del inventario ANTES de resolver el turno: si la sesión
    // llegara a reiniciarse a mitad, el jugador no pierde el objeto.
    if (!consumeItem(session.trainerId, item.key, 1)) {
      item.quantity = 0;
      session.state.log.push(`No te queda ${item.name} en la mochila.`);
      await render(session);
      return;
    }

    takeTurn(session, { type: 'objeto', item });
    await render(session);
  }
}

// ------------------------------------------------------------------- core --

function takeTurn(session: Session, action: Action): void {
  resolveTurn(session.state, action, rng);
  session.mode = 'accion';
}

/** Calcula recompensas, aplica persistencia y escribe los embeds finales. */
/**
 * Traduce el nombre visible de un jefe a su clave en `trainers.ts`.
 * Sin esto, `markBossBeaten` no encontraría la clave que guarda `/zonas`.
 */
function bossKeyFor(trainerName: string): string | null {
  return getTutorTemplateByName(trainerName)?.key ?? null;
}

async function finalize(session: Session): Promise<void> {
  const { state } = session;
  const trainer = findTrainer(session.discordUserId);
  session.mode = 'terminada';

  // Mazmorra e incursión tienen su propio cierre: la recompensa depende de la
  // contribución y el progreso se guarda sala a sala. Lo normal es un
  // `victoriaEmbed` con EXP y ya está.
  if (session.run) {
    await finalizeRun(session, trainer);
    return;
  }

  const embeds = [battleEmbed(state)];

  if (state.result === 'victoria' && trainer) {
    const species = getSpecies(state.enemy.speciesKey)!;

    if (state.capturedSpeciesKey) {
      if (countTeam(trainer.id) >= config.maxPartySize) {
        embeds.push(
          new EmbedBuilder()
            .setColor(COLORS.warning)
            .setDescription(
              `📦 **${species.name}** estaba listo para entrar, pero tu equipo ya tiene ` +
                `${config.maxPartySize} miembros. Libera espacio y vuelve a intentarlo.`,
            ),
        );
      } else {
        const captured: OwnedDigimon = createDigimon(trainer.id, species, state.enemy.level);
        bump(trainer.id, 'capturas');
        // El bestiario registra la captura, que es cuando la especie pasa de
        // "vista" a "en tu poder".
        markCaught(trainer.id, species.key);
        embeds.push(capturedEmbed(species, state.enemy.level, captured.id));
      }
    } else {
      const rewards = rollRewards(species, state.enemy.level, rng, state.rewardMultiplier);
      const levels = [];
      for (const digimon of state.party) {
        const result = grantExp(digimon, rewards.exp, makePersister());
        if (result) levels.push(result);
      }

      giveDigibytes(trainer.id, rewards.digibytes);
      saveBattleResult(trainer.id, true);

      // Derrotar a un jefe por primera vez se apunta en el progreso: es lo que
      // marca el "✓ derrotado" de `/zonas`.
      if (state.isBoss && state.enemyTrainer) {
        const key = bossKeyFor(state.enemyTrainer);
        if (key && markBossBeaten(trainer.id, key)) {
          embeds.push(
            new EmbedBuilder()
              .setColor(COLORS.legendary)
              .setTitle('👑 Guardián registrado')
              .setDescription(
                `**${state.enemyTrainer}** cae por primera vez.\n` +
                  'Puedes retarlo otra vez, pero no contará como nuevo.',
              ),
          );
        }
      }

      embeds.push(
        victoryEmbed({
          exp: rewards.exp,
          digibytes: rewards.digibytes,
          enemyName: state.enemy.name,
          levels,
          opponent: state.enemyTrainer,
          boss: state.isBoss,
        }),
      );
    }
  } else if (state.result === 'derrota' && trainer) {
    saveBattleResult(trainer.id, false);
    embeds.push(
      new EmbedBuilder()
        .setColor(COLORS.danger)
        .setTitle('💀 Derrota')
        .setDescription('Tu equipo regresa a la base. Todos recuperan sus PV.'),
    );
  } else if (state.result === 'huida') {
    embeds.push(escapeEmbed());
  }

  if (trainer) restTeam(trainer.id);

  embeds.push(
    new EmbedBuilder()
      .setColor(COLORS.neutral)
      .setDescription(
        'Siguiente paso: `/explorar` para otro rival · `/equipos` para ver tu plantilla · `/perfil` para tu ficha.',
      ),
  );

  await session.message.edit({ embeds, components: [] });
  sessions.delete(session.trainerId);
}

/**
 * Cierre de una sala de mazmorra o de la incursión global.
 *
 * `finalize()` delega aquí cuando hay contexto de sala. La diferencia con un
 * combate normal está toda en dos sitios:
 *
 * 1. La recompensa se escala por CONTRIBUCIÓN (daño hecho al jefe), no por
 *    participar. Es lo que evita que farmees la mazmorra muriendo en la sala 1.
 * 2. El progreso se guarda SALA A SALA, así que caer en la tercera no borra la
 *    primera ni la segunda.
 *
 * La EXP y el descanso del equipo son los de siempre: una mazmorra no debe
 * ser ni más fácil ni más suelta que un combate normal.
 */
async function finalizeRun(session: Session, trainer: Trainer | null): Promise<void> {
  const { state, run } = session;

  if (!trainer || !run) {
    sessions.delete(session.trainerId);
    return;
  }

  const won = state.result === 'victoria';
  const reward = settleRun({ state, run }, trainer.id, won);

  if (reward.digibytes > 0) giveDigibytes(trainer.id, reward.digibytes);
  for (const [key, quantity] of Object.entries(reward.materials)) {
    addItem(trainer.id, key, quantity);
  }

  restTeam(trainer.id);

  // Que sala sigue: solo tiene sentido en mazmorras. En la incursión se acaba
  // con el combate.
  let nextRoomName: string | null = null;
  if (run.kind === 'mazmorra' && won && !reward.finished) {
    const status = runOf(trainer.id, run.key);
    nextRoomName = status?.nextRoom?.name ?? null;
  }

  await session.message.edit({
    embeds: [
      battleEmbed(state),
      runSummaryEmbed(run, reward, nextRoomName),
    ],
    components: [],
  });

  sessions.delete(session.trainerId);
}


async function expire(session: Session): Promise<void> {
  session.state.finished = true;
  session.state.result = 'huida';
  const trainer = findTrainer(session.discordUserId);
  if (trainer) restTeam(trainer.id);

  await session.message
    .edit({
      embeds: [
        battleEmbed(session.state),
        new EmbedBuilder()
          .setColor(COLORS.neutral)
          .setDescription('⏱️ El combate expiró por inactividad. Tu equipo vuelve a la base.'),
      ],
      components: [],
    })
    .catch(() => {});
}
