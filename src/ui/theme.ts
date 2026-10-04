/**
 * Identidad visual de la interfaz.
 *
 * Cada área tiene su color y su emoji, y ese par es lo que hace que "MUNDO" se
 * sienta como un sitio distinto de "CIUDAD". La coherencia la da compartir las
 * reglas de construcción (mismos botones de atrás y de inicio, misma barra de
 * jugador), no usar el mismo color en todas partes: un juego donde todo es azul
 * no tiene sitios, tiene pantallas.
 */

export const COLORS = {
  hub: 0x2b6cb0,
  digimon: 0x38a169,
  mundo: 0x2f855a,
  combate: 0xc53030,
  ciudad: 0xb7791f,
  social: 0x6b46c1,
  digivice: 0x2c7a7b,
  neutral: 0x4a5568,
  success: 0x38a169,
  warning: 0xd69e2e,
  danger: 0xe53e3e,
  legendary: 0xb7791f,
} as const;

export type AreaKey = 'digimon' | 'mundo' | 'combate' | 'ciudad' | 'social' | 'digivice';

export interface AreaDef {
  key: AreaKey;
  label: string;
  emoji: string;
  color: number;
  /** Texto de una línea: qué se hace aquí. */
  blurb: string;
}

/**
 * Las seis áreas del Digivice.
 *
 * El orden es el del hub: equipo, mundo, combate, ciudad, social y el propio
 * dispositivo. Es también el orden en el que un jugador nuevo las necesita.
 */
export const AREAS: AreaDef[] = [
  {
    key: 'digimon',
    label: 'Digimon',
    emoji: '🐾',
    color: COLORS.digimon,
    blurb: 'Equipo, PC, fichas y evolución',
  },
  {
    key: 'mundo',
    label: 'Mundo',
    emoji: '🌍',
    color: COLORS.mundo,
    blurb: 'Mapa, zonas y encuentros',
  },
  {
    key: 'combate',
    label: 'Combate',
    emoji: '⚔️',
    color: COLORS.combate,
    blurb: 'Rivales, guardianes y PvP',
  },
  {
    key: 'ciudad',
    label: 'Ciudad',
    emoji: '🏪',
    color: COLORS.ciudad,
    blurb: 'Tienda, inventario y equipo',
  },
  {
    key: 'social',
    label: 'Social',
    emoji: '👥',
    color: COLORS.social,
    blurb: 'Perfil, entrenadores y rankings',
  },
  {
    key: 'digivice',
    label: 'Digivice',
    emoji: '📖',
    color: COLORS.digivice,
    blurb: 'Registro, bestiario, misiones y logros',
  },
];

/** Emoji de cada área, para las cabeceras. */
export const AREA_EMOJI: Record<AreaKey, string> = Object.fromEntries(
  AREAS.map((a) => [a.key, a.emoji]),
) as Record<AreaKey, string>;

/** Pantalla de inicio de cada área. */
export const AREA_HOME: Record<AreaKey, string> = {
  digimon: 'digimon',
  mundo: 'mapa',
  combate: 'combate',
  ciudad: 'ciudad',
  social: 'social',
  digivice: 'registro',
};

export function areaOf(key: AreaKey): AreaDef {
  return AREAS.find((a) => a.key === key)!;
}

export function areaLabel(key: AreaKey): string {
  const area = areaOf(key);
  return `${area.emoji} ${area.label.toUpperCase()}`;
}