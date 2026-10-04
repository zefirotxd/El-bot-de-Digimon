import type { RepliableInteraction } from 'discord.js';
import {
  canEnter,
  defaultZone,
  ENTRY_MESSAGES,
  getZone,
  trainersInZone,
  ZONES,
  zoneForLevel,
  zoneRoster,
  type ZoneDef,
} from '../game/zones.js';
import { getTemplates, getTutorTemplate, rollTrainer } from '../game/trainers.js';
import { getProgress, listParty, setCurrentZone, type Progress } from '../game/repository.js';
import { rng } from '../game/random.js';
import { ENCOUNTER_TABLES } from '../game/species.js';
import { markSeen } from '../game/dexRepo.js';
import {
  hasActiveSession,
  startBattle,
  startTrainerBattle,
  type Presenter,
} from './battleSession.js';

/**
 * Acciones del Mundo Digital.
 *
 * Aquí vive la lógica de explorar, viajar y retar al guardián, y no en las
 * pantallas. La razón es práctica además de arquitectónica: estas acciones
 * tienen reglas (escalar al nivel, avisar si te vas a quedar corto, negarse si
 * ya hay un combate) y si vivieran en un botón habría que duplicarlas en cada
 * sitio desde el que se puedan pulsar. Con un solo servicio, el botón, el
 * comando y el test hacen exactamente lo mismo.
 */

export interface ZoneView {
  zone: ZoneDef;
  isHere: boolean;
  fit: 'ok' | 'bajo' | 'fácil';
  bossBeaten: boolean;
  bossName: string | null;
  rivals: string[];
  roster: { key: string; name: string; emoji: string }[];
}

/** Cómo le va al jugador en una zona: nivel, guardianes, rivales. */
export function zoneView(zone: ZoneDef, level: number, progress: Progress): ZoneView {
  const bossBeaten = zone.boss ? progress.bossesBeaten.includes(zone.boss) : false;
  const boss = zone.boss ? getTutorTemplate(zone.boss) : null;

  return {
    zone,
    isHere: false,
    fit: canEnter(zone, level),
    bossBeaten,
    bossName: boss?.name ?? null,
    rivals: trainersInZone(zone, getTemplates()).map((t) => t.name),
    roster: zoneRoster(zone),
  };
}

export function currentZoneOf(trainerId: number): ZoneDef {
  return getZone(getProgress(trainerId).currentZone) ?? defaultZone();
}

/** La zona que le viene bien al jugador por su nivel. */
export function suggestedZone(trainerId: number): ZoneDef {
  const lead = listParty(trainerId)[0];
  return zoneForLevel(lead?.level ?? 1);
}

export interface TravelResult {
  ok: boolean;
  zone: ZoneDef;
  message: string;
}

/** Viaja. Nunca falla: una zona no válida cae a la actual. */
export function travel(trainerId: number, zoneKey: string): TravelResult {
  const zone = getZone(zoneKey) ?? currentZoneOf(trainerId);
  const level = listParty(trainerId)[0]?.level ?? 1;
  const fit = canEnter(zone, level);

  setCurrentZone(trainerId, zone.key);

  const prefix = fit === 'bajo' ? ENTRY_MESSAGES.bajo : fit === 'fácil' ? ENTRY_MESSAGES.fácil : '';
  const dondeYa = zone.key === getProgress(trainerId).currentZone && zoneKey === zone.key;

  return {
    ok: true,
    zone,
    message: dondeYa ? `Ya estabas en ${zone.name}.` : `Llegaste a ${zone.emoji} ${zone.name}.${prefix ? `\n${prefix}` : ''}`,
  };
}

export interface ActionBlocked {
  blocked: true;
  message: string;
}

export function blocker(trainerId: number): ActionBlocked | null {
  if (listParty(trainerId).length === 0) {
    return { blocked: true, message: 'No tienes ningún Digimon en el equipo.' };
  }
  if (hasActiveSession(trainerId)) {
    return { blocked: true, message: 'Ya tienes un combate en marcha. Termínalo primero.' };
  }
  return null;
}

/**
 * Explora la zona: tira un encuentro de la tabla de la zona y lo convierte en
 * combate.
 *
 * No elige una especie al azar de todo el bestiario: coge lo que la zona puede
 * ofrecer de verdad, que es la diferencia entre "explorar" y "tirar dados".
 */
export async function explore(
  interaction: RepliableInteraction,
  trainerId: number,
  present: Presenter,
): Promise<ActionBlocked | null> {
  const stop = blocker(trainerId);
  if (stop) return stop;

  const zone = currentZoneOf(trainerId);
  const roster = zoneRoster(zone);
  const keys = roster.length > 0 ? roster.map((r) => r.key) : ENCOUNTER_TABLES[0]!.keys;
  const key = rng.pick(keys)!;
  markSeen(trainerId, key);

  await startBattle(
    interaction as never,
    { speciesKey: key },
    present,
  );

  return null;
}

/** Reta a uno de los rivales de la zona, escalado a tu nivel. */
export async function challengeRival(
  interaction: RepliableInteraction,
  trainerId: number,
  present: Presenter,
): Promise<ActionBlocked | null> {
  const stop = blocker(trainerId);
  if (stop) return stop;

  const zone = currentZoneOf(trainerId);
  const rivals = trainersInZone(zone, getTemplates());
  if (rivals.length === 0) {
    return { blocked: true, message: 'No hay rivales registrados en esta zona.' };
  }

  const level = listParty(trainerId)[0]?.level ?? 1;
  const rolled = rollTrainer(level, rng);
  const chosen = rivals.find((r) => r.key === rolled.key) ?? rivals[0]!;

  await startTrainerBattle(interaction, chosen, present);
  return null;
}

/** Reta al guardián de la zona actual. */
export async function challengeBoss(
  interaction: RepliableInteraction,
  trainerId: number,
  present: Presenter,
): Promise<ActionBlocked | null> {
  const stop = blocker(trainerId);
  if (stop) return stop;

  const zone = currentZoneOf(trainerId);
  if (!zone.boss) {
    return { blocked: true, message: 'Esta zona no tiene guardián.' };
  }

  const boss = getTutorTemplate(zone.boss);
  if (!boss) {
    return { blocked: true, message: 'No se encontró el guardián de esta zona.' };
  }

  await startTrainerBattle(interaction, {
    ...boss,
    rewardBonus: boss.rewardBonus * zone.bonus,
  }, present);

  return null;
}

export { ZONES, getZone, zoneRoster, canEnter, ENTRY_MESSAGES };