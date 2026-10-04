import type { ArquetipoMinijefe } from './dungeonMap.js';

/**
 * Arquetipos de mini jefe.
 *
 * El encargo dice, con razón, que un mini jefe no puede ser "un Digimon con más
 * vida". Si lo fuera, el jugador solo tendría que aguantar, y aguantar no es una
 * decisión: es un temporizador.
 *
 * Cada arquetipo cambia CÓMO se pelea, y todos usan piezas que el motor ya tiene —
 * fases, escudo, telegrafiado— de modo que esto no es contenido nuevo, es
 * contenido con forma.
 *
 * `mecanicas` existe porque dos arquetipos describían algo que el dato NO PODÍA
 * expresar: el Devorador se curaba con cada golpe y el Reflejo copiaba el estilo
 * del rival, y ninguna de las dos cosas estaba en el tipo. El motor no tenía forma
 * de saberlo, así que el texto prometía una mecánica que nadie había implementado.
 *
 * Con la lista, cada mecánica es un dato comprobable. Y si alguna vez no se
 * implementa una, se ve en el tipo y no se descubre en la pelea.
 */
export const ARQUETIPOS_MINIJEFE: ArquetipoMinijefe[] = [
  {
    key: 'guardián',
    nombre: 'Guardián de la Ruina',
    descripcion:
      'Fase 1 pega fuerte. Fase 2 se protege con un escudo. Fase 3 convoca un auxiliar.',
    emoji: '🛡️',
    vidaExtra: 1.6,
    atributo: 'datos',
    mecanicas: ['escudo', 'auxiliar'],
    escudoFase2: true,
    invocaAuxiliar: true,
  },
  {
    key: 'corrupto',
    nombre: 'Datos Corruptos',
    descripcion: 'Cada 3 turnos cambia de atributo. El tuyo deja de funcionar.',
    emoji: '🔄',
    vidaExtra: 1.4,
    atributo: 'variable',
    mecanicas: ['rota-atributo'],
    rotaAtributo: 3,
  },
  {
    key: 'cargador',
    nombre: 'Cargador Ancestral',
    descripcion: 'Anuncia su golpe un turno antes. Hay que responder o comerlo entero.',
    emoji: '⚡',
    vidaExtra: 1.2,
    atributo: 'vacuna',
    mecanicas: ['telegrafiado'],
    telegrafiado: true,
  },
  {
    key: 'voraz',
    nombre: 'Devorador',
    descripcion: 'Se cura con cada golpe que le metes. Hay que rematar, no farmear.',
    emoji: '🩸',
    vidaExtra: 1.8,
    atributo: 'virus',
    mecanicas: ['drenaje'],
  },
  {
    key: 'espejo',
    nombre: 'Reflejo Roto',
    descripcion: 'Copia el estilo del último rival que perdió contra él.',
    emoji: '🪞',
    vidaExtra: 1.3,
    atributo: 'free',
    mecanicas: ['imita-estilo'],
  },
  {
    key: 'coloso',
    nombre: 'Coloso de Musgo',
    descripcion: 'Muchísima vida y muy poca velocidad. Un problema, no un muro.',
    emoji: '🌿',
    vidaExtra: 2.2,
    atributo: 'datos',
    mecanicas: ['blindaje'],
  },
  {
    key: 'cazador',
    nombre: 'Acechador',
    descripcion: 'Empieza invisible: no hace nada en su primer turno.',
    emoji: '👁️',
    vidaExtra: 1.1,
    atributo: 'virus',
    mecanicas: ['turno-invisible'],
  },
];

/**
 * Las mecánicas que el motor sabe aplicar hoy.
 *
 * Las que no están aquí NO funcionan todavía, y conviene que se note: un arquetipo
 * con una mecánica sin implementar se comportaría como un Digimon normal con más
 * vida, que es justo lo que el encargo dice que no quiere.
 */
export const MECANICAS_IMPLEMENTADAS = new Set<string>();

/** Un arquetipo por clave. */
export function arquetipoDe(key: string): ArquetipoMinijefe | undefined {
  return ARQUETIPOS_MINIJEFE.find((a) => a.key === key);
}

/** Cuántos arquetipos hay. Lo usa el verificador. */
export const TOTAL_ARQUETIPOS = ARQUETIPOS_MINIJEFE.length;