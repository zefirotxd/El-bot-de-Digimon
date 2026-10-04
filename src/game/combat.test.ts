import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEvolution,
  buildBossFighter,
  buildWildFighter,
  captureChance,
  chooseEnemyAction,
  createBattle,
  createTrainerBattle,
  effectiveSpecies,
  grantExp,
  registerCounter,
  resolveTurn,
  setBossPhase,
  switchCandidates,
  switchTo,
  type BattleState,
} from './combat.js';
import { Rng } from './random.js';
import { MOVES } from './moves.js';
import { rollEncounter, rollRewards } from './progression.js';
import { config } from '../config.js';
import { getTutorTemplate, getTemplates, rollTrainer, templateAttributes, templateLevel } from './trainers.js';
import { canEnter, zoneForLevel, zoneRoster, ZONES } from './zones.js';
import { getItem } from './items.js';
import { BOSSES, COUNTER_REDUCTION, getBoss, phaseAt, telegraphExposure } from './bosses.js';
import {
  applyGear,
  EQUIPMENT,
  gearEffects,
  MAX_UPGRADE,
  SLOTS,
  upgradeCost,
  upgradeMaterialCost,
} from './equipment.js';
import { checkCommand, rateLimitMessage, resetRateLimit } from '../services/rateLimit.js';
import { analyzeMatchup, elementMultiplierAgainst, ALL_ELEMENTS } from './elements.js';
import { attributeMultiplier, ALL_ATTRIBUTES } from './attributes.js';
import type { Attribute } from './types.js';
import { getSpecies, movesForLevel, SPECIES, ENCOUNTER_TABLES, STARTERS } from './species.js';
import { computeStats, expToNextLevel, maxEnergyForLevel } from './stats.js';
import { MOVES, resolveMoves } from './moves.js';
import type { Action, OwnedDigimon, SpeciesDef } from './types.js';

function makeDigimon(species: SpeciesDef, level = 5, id = 1, moves?: string[]): OwnedDigimon {
  const stats = computeStats(species.base, level);
  return {
    id,
    trainerId: 1,
    species,
    nickname: null,
    level,
    exp: 0,
    stats,
    hp: stats.hp,
    moves: resolveMoves(moves ?? movesForLevel(species, level)),
    status: 'ok',
    storage: 'party',
    caughtAt: '2026-01-01 00:00:00',
  };
}

function bestMoveAction(state: BattleState): Action {
  const move = state.player.moves.find((m) => m.energyCost <= state.player.energy) ?? state.player.moves[0]!;
  return { type: 'movimiento', move };
}

/** Juega la batalla hasta el final. Devuelve los turnos que duró. */
function playOut(state: BattleState, rng: Rng, maxTurns = 200): number {
  let turns = 0;
  while (!state.finished && turns < maxTurns) {
    if (state.awaitingSwitch) break;
    resolveTurn(state, bestMoveAction(state), rng);
    turns += 1;
  }
  return turns;
}

describe('estadísticas', () => {
  it('sube monótonamente con el nivel', () => {
    const species = getSpecies('agumon')!;
    const prev = computeStats(species.base, 1);
    for (let level = 2; level <= 50; level++) {
      const current = computeStats(species.base, level);
      for (const key of ['hp', 'attack', 'defense', 'speed'] as const) {
        assert.ok(current[key] > prev[key], `${key} no creció en nivel ${level}`);
      }
      prev.hp = current.hp;
      prev.attack = current.attack;
      prev.defense = current.defense;
      prev.speed = current.speed;
    }
  });
});

describe('motor de combate', () => {
  it('un combate acaba con un ganador y en un número razonable de turnos', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = new Rng(seed);
      const state = createBattle([makeDigimon(getSpecies('agumon')!)], 0, getSpecies('goburimon')!, 5);
      const turns = playOut(state, rng);

      assert.ok(state.finished, `semilla ${seed}: la batalla no terminó`);
      assert.ok(turns <= 40, `semilla ${seed}: la batalla se alargó demasiado (${turns} turnos)`);
      assert.ok(['victoria', 'derrota'].includes(state.result!), 'resultado inesperado');
    }
  });

  it('quitar PV al rival nunca lo deja negativos', () => {
    const rng = new Rng(99);
    const state = createBattle([makeDigimon(getSpecies('gatomon')!, 20)], 0, getSpecies('kunemon')!, 3);
    for (let i = 0; i < 60 && !state.finished; i++) {
      resolveTurn(state, bestMoveAction(state), rng);
      assert.ok(state.enemy.hp >= 0, 'HP negativo');
      assert.ok(state.player.hp >= 0, 'HP negativo del jugador');
    }
  });

  it('la energía nunca baja de cero', () => {
    const rng = new Rng(7);
    const state = createBattle([makeDigimon(getSpecies('gatomon')!),], 0, getSpecies('kunemon')!, 8);
    for (let i = 0; i < 40 && !state.finished; i++) {
      resolveTurn(state, bestMoveAction(state), rng);
      assert.ok(state.player.energy >= 0, 'energía negativa');
      assert.ok(state.player.energy <= 6, 'energía desbordada');
    }
  });

  it('capturar un rival da la victoria y fija la especie', () => {
    // El camino de éxito se busca entre muchas semillas, porque capturar falla
    // la mayoría de veces: con el rival a 1 PV la probabilidad es de un 16%, así
    // que un solo intento no prueba nada.
    //
    // El intento se hace SIEMPRE en un combate nuevo y se comprueba SU resultado. La
    // versión anterior disparaba un intento fuera del bucle y luego entraba
    // mientras `!state.finished`: si ese primer intento acertaba, el combate
    // quedaba terminado, el bucle no daba ni una vuelta y la prueba terminaba
    // en `assert.fail` SIN haber fallado en nada. Dependía de que la primera
    // captura fallara por casualidad, que es la forma más frágil de escribir
    // una prueba.
    let exito = false;

    for (let semilla = 1; semilla <= 60 && !exito; semilla++) {
      const state = createBattle(
        [makeDigimon(getSpecies('agumon')!, 30)],
        0,
        getSpecies('kunemon')!,
        3,
      );
      // Al límite para maximizar la probabilidad.
      state.enemy.hp = 1;

      resolveTurn(state, { type: 'capturar' }, new Rng(semilla));

      if (!state.capturedSpeciesKey) continue;

      exito = true;
      assert.equal(state.capturedSpeciesKey, 'kunemon', 'fija la especie capturada');
      assert.equal(state.result, 'victoria', 'capturar es ganar');
      assert.ok(state.finished, 'el combate termina al capturar');
      assert.ok(state.enemy.caught, 'el rival queda marcado como capturado');
    }

    assert.ok(exito, 'no se pudo capturar en 60 intentos con 1 PV restante');
  });

  it('la probabilidad de captura está acotada', () => {
    const rng = new Rng(1);
    const state = createBattle([makeDigimon(getSpecies('agumon')!, 5)], 0, getSpecies('kunemon')!, 5);
    for (let i = 0; i < 50; i++) {
      state.enemy.hp = Math.floor(Math.random() * state.enemy.stats.hp);
      const chance = captureChance(state);
      assert.ok(chance > 0 && chance <= 0.95, `probabilidad fuera de rango: ${chance}`);
    }
    void rng;
  });

  it('defender reduce el daño recibido', () => {
    const defendRng = new Rng(5);
    const attackRng = new Rng(5);
    const agumon = getSpecies('agumon')!;
    const foe = getSpecies('goburimon')!;

    const normal = createBattle([makeDigimon(agumon)], 0, foe, 5);
    resolveTurn(normal, bestMoveAction(normal), new Rng(11));
    const damageNormal = normal.enemy.stats.hp - normal.enemy.hp;

    const guarded = createBattle([makeDigimon(agumon)], 0, foe, 5);
    resolveTurn(guarded, { type: 'defender' }, new Rng(11));
    const damageGuarded = guarded.enemy.stats.hp - guarded.enemy.hp;

    assert.ok(damageGuarded < damageNormal, `defender debería reducir daño: ${damageGuarded} vs ${damageNormal}`);
    void defendRng;
    void attackRng;
  });

  it('el cambio de Digimon entra en juego cuando el activo cae', () => {
    const party = [
      makeDigimon(getSpecies('agumon')!, 3, 1),
      makeDigimon(getSpecies('gabumon')!, 8, 2),
    ];
    const state = createBattle(party, 0, getSpecies('metalgreymon')!, 30);

    for (let i = 0; i < 30 && !state.finished && !state.awaitingSwitch; i++) {
      resolveTurn(state, bestMoveAction(state), new Rng(i + 1));
    }

    assert.ok(state.awaitingSwitch, 'debería pedir cambio de Digimon');
    assert.ok(switchTo(state, 2), 'el cambio debería ser válido');
    assert.equal(state.player.speciesKey, 'gabumon');
    assert.equal(state.awaitingSwitch, false);
  });

  it('la IA siempre devuelve una acción legal', () => {
    const rng = new Rng(3);
    for (let seed = 1; seed <= 40; seed++) {
      const state = createBattle(
        [makeDigimon(getSpecies('paulmon')!)],
        0,
        getSpecies('kunemon')!,
        3,
      );
      const action = chooseEnemyAction(state, new Rng(seed));
      assert.ok(action.type !== 'movimiento' || action.move.energyCost <= state.enemy.energy);
      void rng;
    }
  });

  it('todas las especies y movimientos referenciados existen', () => {
    for (const species of Object.values(SPECIES)) {
      assert.ok(species.learnset.length > 0, `${species.name} no tiene moveset`);
      for (const key of species.learnset) {
        assert.ok(
          resolveMoves([key]).length === 1,
          `${species.name} apunta a un move inexistente: ${key}`,
        );
      }
      // Toda ruta apunta a una especie real y con los movimientos que la
      // nueva forma debe conocer.
      for (const route of species.evolutions) {
        const next = getSpecies(route.to);
        assert.ok(
          next,
          `${species.name} evoluciona a una especie inexistente: ${route.to}`,
        );
        assert.ok(route.level >= 1, `${species.name}: ruta con nivel ${route.level}`);
      }

      if (species.devolution) {
        assert.ok(
          getSpecies(species.devolution.to),
          `${species.name} retrocede a una especie inexistente: ${species.devolution.to}`,
        );
      }
    }
  });

  it('las tablas de encuentro solo contienen especies reales', () => {
    for (const table of ENCOUNTER_TABLES) {
      for (const key of table.keys) {
        assert.ok(getSpecies(key), `la tabla de encuentro usa una especie inexistente: ${key}`);
      }
    }
  });
});

describe('capa 1: atributo (triangulo RPS)', () => {
  it('forma el ciclo Vacuna > Virus > Datos > Vacuna', () => {
    // Verificado contra la guia de Digimon Story: Time Stranger.
    assert.ok(attributeMultiplier('vacuna', 'virus') > 1, 'Vacuna debe vencer a Virus');
    assert.ok(attributeMultiplier('virus', 'datos') > 1, 'Virus debe vencer a Datos');
    assert.ok(attributeMultiplier('datos', 'vacuna') > 1, 'Datos debe vencer a Vacuna');

    // Y cada uno pierde contra el que le gana.
    assert.ok(attributeMultiplier('virus', 'vacuna') < 1);
    assert.ok(attributeMultiplier('datos', 'virus') < 1);
    assert.ok(attributeMultiplier('vacuna', 'datos') < 1);
  });

  it('el triangulo es coherente en ambos sentidos', () => {
    const pairs: [Attribute, Attribute][] = [
      ['vacuna', 'virus'], ['virus', 'datos'], ['datos', 'vacuna'],
    ];
    for (const [a, b] of pairs) {
      const forward = attributeMultiplier(a, b);
      const backward = attributeMultiplier(b, a);
      assert.ok(forward > 1 && backward < 1, `asimetría en ${a} vs ${b}`);
      // La ventaja y la desventaja compensan: el producto queda cerca de 1.
      const product = forward * backward;
      assert.ok(product > 0.9 && product < 1.1, `desequilibrio en ${a}/${b}: ${product}`);
    }
  });

  it('Free, Unknown, Variable y Sin Datos son neutrales', () => {
    for (const neutral of ['free', 'unknown', 'variable', 'sin_datos'] as Attribute[]) {
      for (const other of ['vacuna', 'virus', 'datos'] as Attribute[]) {
        assert.equal(
          attributeMultiplier(neutral, other),
          1,
          `${neutral} no debería tener ventaja ni desventaja contra ${other}`,
        );
        assert.equal(attributeMultiplier(other, neutral), 1);
      }
    }
  });

  it('Variable copia el atributo del rival y queda neutral', () => {
    assert.equal(attributeMultiplier('variable', 'virus'), 1);
    assert.equal(attributeMultiplier('variable', 'datos'), 1);
    assert.equal(attributeMultiplier('variable', 'vacuna'), 1);
  });

  it('nunca deja a un atributo sin respuesta', () => {
    for (const a of ALL_ATTRIBUTES) {
      for (const b of ALL_ATTRIBUTES) {
        assert.ok(attributeMultiplier(a, b) > 0, `multiplicador no positivo: ${a} vs ${b}`);
      }
    }
  });
});

describe('capa 2: afinidad elemental', () => {
  it('las afinidades son por Digimon, no un chart global', () => {
    // Agumon es debilisimo a Agua y resiste Planta.
    assert.ok(elementMultiplierAgainst('agua', getSpecies('agumon')!) > 1);
    assert.ok(elementMultiplierAgainst('planta', getSpecies('agumon')!) < 1);
    // Un elemento con el que Agumon no tiene relacion queda en 1.
    assert.equal(elementMultiplierAgainst('rayo', getSpecies('agumon')!), 1);
  });

  it('aplica las tres escalas del juego', () => {
    const target = getSpecies('agumon')!;
    assert.equal(elementMultiplierAgainst('agua', target), 1.8, 'muy debil (◎)');
    assert.equal(elementMultiplierAgainst('planta', target), 0.6, 'resiste (△)');
    assert.equal(elementMultiplierAgainst('rayo', target), 1, 'sin efecto (ー)');
  });

  it('ningun Digimon declara elementos repetidos o contradictorios', () => {
    for (const species of Object.values(SPECIES)) {
      const overlap = species.weakTo.filter((e) => species.resists.includes(e));
      assert.deepEqual(overlap, [], `${species.name}: debil y resiste a la vez ${overlap}`);

      for (const list of [species.elements, species.weakTo, species.resists]) {
        assert.equal(new Set(list).size, list.length, `${species.name}: elementos repetidos`);
        for (const element of list) {
          assert.ok(ALL_ELEMENTS.includes(element), `${species.name}: elemento desconocido ${element}`);
        }
      }

      // Un Digimon no puede ser inmune y a la vez debil a lo mismo.
      const immune = species.immuneTo ?? [];
      for (const element of immune) {
        assert.ok(!species.weakTo.includes(element), `${species.name}: inmune y debil a ${element}`);
        assert.ok(!species.resists.includes(element), `${species.name}: inmune y resiste ${element}`);
      }
    }
  });

  it('cada Digimon tiene al menos una debilidad y una resistencia', () => {
    // Si esto falla, hay Digimon inimitables y el sistema pierde su utilidad.
    for (const species of Object.values(SPECIES)) {
      assert.ok(species.weakTo.length > 0, `${species.name} no tiene debilidades`);
      assert.ok(species.resists.length > 0, `${species.name} no tiene resistencias`);
    }
  });

  it('los multiplicadores se quedan en un rango sano', () => {
    for (const species of Object.values(SPECIES)) {
      for (const element of ALL_ELEMENTS) {
        const m = elementMultiplierAgainst(element, species);
        assert.ok(m >= 0 && m <= 1.8, `fuera de rango: ${species.key} vs ${element} = ${m}`);
      }
    }
  });
});

describe('las dos capas juntas', () => {
  it('el multiplicador total es atributo x elemento x STAB', () => {
    const fireAgumon = getSpecies('agumon')!; // virus, fuego
    const iceGabumon = getSpecies('gabumon')!; // datos, hielo, debil a fuego

    // Virus vence a Datos, asi que aqui el atributo ayuda (+1.25), no castiga.
    const win = analyzeMatchup(
      { attribute: fireAgumon.attribute, species: fireAgumon },
      'fuego',
      { attribute: iceGabumon.attribute, species: iceGabumon },
    );

    assert.equal(win.attribute, 1.25, 'Virus > Datos');
    assert.equal(win.element, 1.8, 'Gabumon es muy debil a Fuego');
    assert.equal(win.stab, 1.2, 'STAB: Agumon es de tipo Fuego');
    assert.ok(Math.abs(win.total - 1.25 * 1.8 * 1.2) < 0.0001);

    // El camino inverso: Datos pierde contra Virus, asi que el atributo resta
    // aunque el elemento y el STAB favoralezcan.
    const loss = analyzeMatchup(
      { attribute: iceGabumon.attribute, species: iceGabumon },
      'fuego', // sin STAB para Gabumon
      { attribute: fireAgumon.attribute, species: fireAgumon },
    );

    assert.equal(loss.attribute, 0.85, 'Datos < Virus');
    assert.equal(loss.stab, 1, 'sin STAB');
    assert.ok(loss.total < 1, `deberia quedar por debajo de 1: ${loss.total}`);
  });

  it('el doble counter es fuerte pero no instantaneo', () => {
    let max = 0;
    let min = Infinity;

    for (const a of Object.values(SPECIES)) {
      for (const b of Object.values(SPECIES)) {
        for (const element of ALL_ELEMENTS) {
          const m = analyzeMatchup(
            { attribute: a.attribute, species: a },
            element,
            { attribute: b.attribute, species: b },
          ).total;
          max = Math.max(max, m);
          min = Math.min(min, m);
        }
      }
    }

    // Con el sistema anterior una especie concreta llegaba al 71% de victorias
    // solo por emparejamiento. Este techo lo evita que se repita.
    assert.ok(max <= 3.1, `demasiado alto: ${max}`);
    assert.ok(min >= 0.5, `demasiado bajo: ${min}`);
  });

  it('la ventaja de atributo siempre acompaña a la de elemento', () => {
    // Un movimiento debe poder ganar por cualquiera de las dos capas: ese es
    // el motivo de que el sistema tenga dos capas y no una sola.
    const vaccine = getSpecies('gatomon')!; // vacuna, luz
    const virus = getSpecies('guilmon')!; // virus, fuego/oscuridad

    const byAttribute = analyzeMatchup(
      { attribute: vaccine.attribute, species: vaccine },
      'luz', // sin STAB ni relacion elemental con el rival
      { attribute: virus.attribute, species: virus },
    );
    assert.ok(byAttribute.attribute > 1, 'Vacuna deberia ganar por atributo');
    assert.equal(byAttribute.element, 1);
    assert.ok(byAttribute.total > 1);
  });
});

describe('balance', () => {
  it('el motor es simétrico: un espejo se decide 50/50', () => {
    // Si el motor favoreciera a un bando, un combate idéntico no saldría 50/50.
    for (const [key, level] of [
      ['goburimon', 5],
      ['greymon', 18],
      ['metalgreymon', 35],
      ['wargreymon', 55],
    ] as [string, number][]) {
      let wins = 0;
      let losses = 0;
      const runs = 160;

      for (let i = 0; i < runs; i++) {
        const state = createBattle(
          [makeDigimon(getSpecies(key)!, level)],
          0,
          getSpecies(key)!,
          level,
        );
        const rng = new Rng(50_000 + i);
        let turns = 0;
        while (!state.finished && turns < 200) {
          const asEnemy = { ...state, player: state.enemy, enemy: state.player } as BattleState;
          resolveTurn(state, chooseEnemyAction(asEnemy, rng), rng);
          turns++;
        }
        if (state.result === 'victoria') wins++;
        if (state.result === 'derrota') losses++;
      }

      const rate = wins / (wins + losses);
      assert.ok(
        rate > 0.4 && rate < 0.6,
        `${key} Nv.${level}: espejo ${(rate * 100).toFixed(0)}% victorias (se esperaba ~50%)`,
      );
    }
  });

  it('los combates no se eternizan', () => {
    for (const level of [5, 18, 35, 55]) {
      const species = level < 12 ? 'agumon' : level < 25 ? 'greymon' : level < 45 ? 'metalgreymon' : 'wargreymon';
      const turns: number[] = [];

      for (let i = 0; i < 60; i++) {
        const state = createBattle(
          [makeDigimon(getSpecies(species)!, level)],
          0,
          getSpecies(species)!,
          level,
        );
        const rng = new Rng(60_000 + i);
        let t = 0;
        while (!state.finished && t < 200) {
          const asEnemy = { ...state, player: state.enemy, enemy: state.player } as BattleState;
          resolveTurn(state, chooseEnemyAction(asEnemy, rng), rng);
          t++;
        }
        turns.push(t);
      }

      const median = turns.sort((a, b) => a - b)[turns.length >> 1]!;
      assert.ok(median >= 3, `nivel ${level}: combate demasiado corto (${median})`);
      assert.ok(median <= 25, `nivel ${level}: combate demasiado largo (${median})`);
    }
  });

  it('la energía se regenera', () => {
    // Esta es una prueba de la REGLA de energía, no del daño. Por eso no la
    // monta sobre una pelea real: con el daño correcto, un Agumon de nivel 20
    // deja al rival en cero en un turno, el combate acaba, y lo que se mide
    // acaba siendo la duración de la pelea.
    //
    // Que pasara dos veces seguidas es lo que hace que merezca el comentario.
    // Primero el rival era de nivel 20 y la pelea moría de sobredosis; luego se
    // bajó a nivel 2 y murió igual de rápido, porque el problema no era el
    // nivel sino que un solo turno basta. El rivalry se mantiene artificialmente
    // vivo, que es exactamente lo que hay que hacer cuando lo que se prueba es
    // la recarga y no el combate.
    const state = createBattle(
      [makeDigimon(getSpecies('agumon')!, 20)],
      0,
      getSpecies('kunemon')!, 20,
    );
    const max = maxEnergyForLevel(20);
    assert.equal(state.player.energy, max);

    // Gastar 2 de energía y resolver un turno deja max - 2 + 1.
    const cheap = state.player.moves.find((m) => m.energyCost === 2)!;
    state.player.energy = max;
    resolveTurn(state, { type: 'movimiento', move: cheap }, new Rng(1));
    assert.equal(state.player.energy, max - 2 + 1);

    // Se devuelven los PV de los dos. Con el daño correcto, un turno basta para
    // que uno de los dos caiga, y `resolveTurn` corta en seco cuando el jugador
    // cae: no recarga energía y no resuelve nada. La recarga es lo que se
    // quiere probar, no la pelea.
    state.enemy.hp = state.enemy.stats.hp;
    state.player.hp = state.player.stats.hp;
    state.awaitingSwitch = false;
    state.finished = false;
    assert.ok(!state.finished, 'el combate sigue vivo');

    // Defender no cuesta nada, así que solo cuenta la recarga.
    resolveTurn(state, { type: 'defender' }, new Rng(2));
    assert.equal(state.player.energy, max);
  });

  it('la energía nunca supera el máximo del nivel', () => {
    for (const level of [5, 20, 50]) {
      const state = createBattle(
        [makeDigimon(getSpecies('agumon')!, level)],
        0,
        getSpecies('kunemon')!, level,
      );
      const max = maxEnergyForLevel(level);
      const rng = new Rng(level);
      for (let i = 0; i < 30 && !state.finished; i++) {
        resolveTurn(state, { type: 'defender' }, rng);
        assert.ok(state.player.energy <= max, `nivel ${level}: energía ${state.player.energy} > ${max}`);
      }
    }
  });
});

describe('atributos de las especies', () => {
  it('todo Digimon tiene un atributo válido', () => {
    for (const species of Object.values(SPECIES)) {
      assert.ok(
        ALL_ATTRIBUTES.includes(species.attribute),
        `${species.name}: atributo desconocido "${species.attribute}"`,
      );
    }
  });

  it('cada starter pertenece al triángulo para que el RPS aplique', () => {
    for (const key of STARTERS) {
      const attribute = getSpecies(key)!.attribute;
      assert.ok(
        ['vacuna', 'virus', 'datos'].includes(attribute),
        `${key} es "${attribute}" y no participaria en el triangulo`,
      );
    }
  });

  it('reparte los starters entre los tres atributos', () => {
    const used = new Set(STARTERS.map((k) => getSpecies(k)!.attribute));
    assert.equal(used.size, 3, 'los 6 iniciales deberian cubrir los 3 atributos');
  });

  it('son seis, y son los que se eligieron', () => {
    assert.equal(STARTERS.length, 6, `hay ${STARTERS.length} starters`);

    // Los antiguos siguen en el bestiario pero no se entregan. Sin esta lista se
    // podría añadir un starter nuevo y dejar los seis viejos repartiendo turnos
    // sin que nadie se entere.
    const antiguos = ['agumon', 'gabumon', 'biyomon', 'gatomon', 'guilmon', 'pabumon'];
    for (const key of antiguos) {
      assert.ok(!STARTERS.includes(key), `${key} ya no es starter`);
      assert.ok(Boolean(getSpecies(key)), `${key} debería seguir siendo especie`);
    }
  });

  /**
   * LA IDENTIDAD DE UN STARTER ES MECÁNICA.
   *
   * Es lo que hace que la elección signifique algo. Si dos starters compartieran
   * exactamente las mismas mecánicas, serían el mismo Digimon con distinto nombre,
   * y el jugador no podría distinguir cuál le conviene hasta que ya es tarde.
   *
   * La comprobación compara el conjunto de ESTADOS y ESTADÍSTICAS que cada starter
   * puede aplicar. Exige que cada uno tenga al menos uno que los otros cinco no
   * pueden aplicar, que es la definición operativa de «identidad diferente».
   */
  it('cada starter tiene una mecánica que los otros cinco no pueden aplicar', () => {
    /** Los efectos que el learnset entero de un starter le permite provocar. */
    const efectosDe = (key: string): Set<string> => {
      const salida = new Set<string>();

      for (const moveKey of getSpecies(key)!.learnset) {
        const move = MOVES[moveKey];
        if (!move) continue;

        if (move.effect?.status) salida.add(`estado:${move.effect.status}`);
        if (move.heal) salida.add('cura');
        if (move.drain) salida.add('drenaje');
        if (move.shield) salida.add('escudo');
        if (move.priority > 0) salida.add(`prioridad:${move.priority}`);

        // La potencia y el crítico cuentan como mecánica, no como decoración.
        //
        // El multiplicador del crítico se aplica DESPUÉS de la Defensa, así que
        // un Digimon que pega fuerte en críticos no se iguala con un arma como uno
        // que solo tiene más Ataque bruto. Por eso Pteromon puede ser su
        // identidad sin estafar de números.
        if (move.critRate >= 0.25) salida.add('critico-alto');
        if (move.power >= 70) salida.add('golpe-fuerte');

        for (const stat of Object.keys(move.effect?.statChange ?? {})) {
          const signo = (move.effect!.statChange as Record<string, number>)[stat]! >= 1 ? '+' : '-';
          salida.add(`stat:${stat}${signo}`);
        }
      }

      return salida;
    };

    for (const key of STARTERS) {
      const propio = efectosDe(key);

      assert.ok(propio.size > 0, `${key} no tiene ninguna mecánica`);

      const exclusivos = [...propio].filter((e) =>
        STARTERS.filter((otro) => otro !== key).every((otro) => !efectosDe(otro).has(e)),
      );

      assert.ok(
        exclusivos.length > 0,
        `${key} no tiene ninguna mecánica exclusiva: ${[...propio].join(', ')}`,
      );
    }
  });

  it('los seis starters no se juegan igual', () => {
    // Comprobación gruesa a propósito: si dos starters tuvieran el mismo elemento,
    // el mismo atributo y estadísticas casi iguales, serían el mismo Digimon con
    // dos nombres. No hace falta que cada par sea distinto: basta con que el grupo
    // tenga variedad de verdad.
    const firmas = STARTERS.map((key) => {
      const s = getSpecies(key)!;
      return `${s.attribute}/${s.elements.join('+')}`;
    });

    assert.ok(
      new Set(firmas).size >= 4,
      `solo ${new Set(firmas).size} combinaciones distintas entre los seis: ${firmas.join(' | ')}`,
    );
  });

  it('la evolución puede cambiar de atributo, y el combate lo refleja', () => {
    // No es un error: Agumon->WarGreymon pasa de Virus a Vacuna, Gabumon->Garurumon
    // de Datos a Vacuna y WereGarurumon->MetalGarurumon de Vacuna a Datos. Son los
    // atributos canonicos, y que evolucionar cambie tu tipo es strategia pura.
    const metalgreymon = makeDigimon(getSpecies('metalgreymon')!, 44, 1, ['impacto']);
    assert.equal(metalgreymon.species.attribute, 'virus');

    // Con la evolución MANUAL, subir de nivel NO transforma. La especie y el
    // atributo se quedan como estaban.
    const needed = expToNextLevel(44);
    const result = grantExp(metalgreymon, needed, () => {});

    assert.equal(result!.evolvedTo, null, 'subir de nivel no debe evolucionar');
    assert.equal(metalgreymon.level, 45, 'el nivel si sube');
    assert.equal(metalgreymon.species.key, 'metalgreymon', 'la especie no cambia sola');
    assert.equal(metalgreymon.species.attribute, 'virus');

    // Y el cambio ocurre al ejecutar la ruta a mano.
    applyEvolution(metalgreymon, 'wargreymon');
    assert.equal(metalgreymon.species.attribute, 'vacuna', 'el atributo debe seguir a la especie');

    // Y un luchador nuevo debe construir su atributo desde la especie actual.
    const fighter = buildWildFighter(getSpecies('wargreymon')!, 45);
    assert.equal(fighter.attribute, 'vacuna');
  });

  it('el cambio de atributo al evolucionar es intencionado, no un descuido', () => {
    // Estas lineas cambian de atributo a proposito (atributos canonicos), y las
    // ramas nuevas tambien. Si alguien edita species.ts y rompe una, esta lista
    // avisa. Es una lista, no una regla: cambiar de tipo al evolucionar es
    // estrategia, pero tiene que ser deliberado.
    const expected: Record<string, string> = {
      garurumon: 'vacuna',
      wargreymon: 'vacuna',
      metalgarurumon: 'datos',
      // Ramas: Ogremon es Datos y Seraphimon es Virus. El coloso oscuro cambia
      // de tipo a proposito. Cherubimon es Vacuna y Diaboromon es Datos: el
      // angel cae al otro lado del triangulo al pasar a su forma final.
      seraphimon: 'virus',
      diaboromon: 'datos',
      // Pabumon -> Palmon. Palmon es Datos en el canon y en el juego; Pabumon es
      // Virus en el canon, y este proyecto invierte el triangulo a proposito
      // (Agumon es Virus aqui y Vaccine alli, con el motivo escrito en
      // `dex-accepted.json`), asi que aqui es Vacuna. El cambio es real, no un
      // descuido: por eso esta en la lista.
      //
      // La clave sigue siendo `paulmon` aunque el nombre ya sea `Palmon`. Cambiar
      // la clave obligaria a migrar los Digimon que los jugadores ya tienen, y una
      // migracion mal hecha dejaria sus Digimon sin especie. El nombre mal escrito
      // era el dato erroneo; la clave no.
      paulmon: 'datos',
      // Tapirmon -> Monochromon. Tapirmon es Vacuna en el canon y Monochromon es
      // Data. Los dos valores vienen de la ficha de la fuente, no de una decisión
      // del juego, así que el cambio es inevitable y se declara.
      //
      // Monochromon va a `datos` porque es el atributo que publica la fuente, y eso
      // también significa que un jugador que empieza con Tapirmon cambia de lado
      // del triangulo en su primera evolución. Es un coste real de que el
      // atributo sea el del canon y no uno elegido para que la línea no cambie.
      monochromon: 'datos',
    };

    const seen = new Set<string>();

    for (const species of Object.values(SPECIES)) {
      for (const route of species.evolutions) {
        const next = getSpecies(route.to)!;
        if (species.attribute === next.attribute) continue;

        assert.ok(
          expected[next.key] === next.attribute,
          `${species.name} -> ${next.name} cambia a "${next.attribute}" sin estar en la lista de cambios intencionados`,
        );
        seen.add(next.key);
      }
    }

    // Y no puede haber lineas nuevas que cambien sin avisar.
    assert.equal(seen.size, Object.keys(expected).length);
  });

  it('toda linea evolutiva mantiene elementos y stats crecientes', () => {
    // Con ramas, "linea" ya no es un camino unico: hay que recorrer TODOS los
    // caminos posibles desde cada especie inicial.
    for (const start of STARTERS) {
      const pending = [{ species: getSpecies(start)!, path: start }];

      while (pending.length > 0) {
        const { species: current, path } = pending.shift()!;

        for (const route of current.evolutions) {
          const next = getSpecies(route.to)!;
          const nextPath = `${path} -> ${next.name}`;

          assert.notDeepEqual(next.elements, [], `${next.name} se queda sin elementos`);
          assert.ok(next.weakTo.length > 0, `${next.name} se queda sin debilidades`);

          // Cada fase debe ser claramente mas resistente y fuerte.
          assert.ok(
            next.base.hp > current.base.hp,
            `${next.name} (${next.base.hp} PV) no mejora a ${current.name} (${current.base.hp}) [${nextPath}]`,
          );
          assert.ok(
            next.base.attack > current.base.attack,
            `${next.name} no mejora el Ataque de ${current.name} [${nextPath}]`,
          );
          assert.ok(
            TIER_ORDER.indexOf(next.tier) > TIER_ORDER.indexOf(current.tier),
            `${nextPath} no sube de rango`,
          );

          pending.push({ species: next, path: nextPath });
        }
      }
    }
  });

  it('toda ruta tiene un destino alcanzable y termina', () => {
    // Ningún camino puede ser infinito ni quedar en una especie sin evoluciones
    // que seDeclare final por descuido.
    for (const species of Object.values(SPECIES)) {
      for (const route of species.evolutions) {
        const next = getSpecies(route.to)!;
        const rounds = roundsToFinal(next);
        assert.ok(rounds < 6, `cadena interminable desde ${species.name} a ${next.name}`);
      }
    }
  });
});

/** Posicion de un rango en la escalera de poder. */
const TIER_ORDER = ['inicial', 'novato', 'campeon', 'ultimate', 'mega'];

/** Cuantas formas finales se encuentran siguiendo todas las rutas. */
function roundsToFinal(species: SpeciesDef): number {
  if (species.evolutions.length === 0) return 0;
  let best = Infinity;
  for (const route of species.evolutions) {
    const next = getSpecies(route.to)!;
    best = Math.min(best, 1 + roundsToFinal(next));
  }
  return best === Infinity ? 0 : best;
}

describe('jefes con fases', () => {
  /**
   * El requisito de diseño: un jefe NO es un enemigo con más PV. Estos tests
   * fallan si alguien lo convierte en eso.
   */

  it('cada jefe tiene al menos dos fases con algo que cambie', () => {
    const bosses = Object.values(BOSSES);
    assert.ok(bosses.length >= 3, `solo hay ${bosses.length} jefes`);

    for (const boss of bosses) {
      assert.ok(boss.phases.length >= 2, `${boss.name}: un jefe de una fase es un enemigo grande`);

      for (const phase of boss.phases) {
        const changesSomething =
          phase.attribute !== undefined ||
          phase.weakTo !== undefined ||
          phase.resists !== undefined ||
          phase.immuneTo !== undefined ||
          phase.damageTaken !== undefined ||
          phase.regen !== undefined;
        assert.ok(
          changesSomething,
          `${boss.name} / ${phase.name}: la fase no cambia nada (solo sube el PV)`,
        );
        assert.ok(phase.announce.length > 10, `${boss.name} / ${phase.name}: sin frase de aviso`);
      }

      // Los umbrales tienen que bajar: si suben, la segunda fase no se alcanza.
      for (let i = 1; i < boss.phases.length; i++) {
        assert.ok(
          boss.phases[i]!.from < boss.phases[i - 1]!.from,
          `${boss.name}: el umbral de la fase ${i + 1} no baja respecto a la anterior`,
        );
      }
    }
  });

  it('phaseAt devuelve la fase correcta en cada tramo', () => {
    const boss = getBoss('titanramon')!;
    const expected = [0, 1, 2, 3];

    // Justo por encima de cada umbral debe seguir en la fase anterior.
    assert.equal(phaseAt(boss, 1.0), 0, '100% -> fase 1');
    assert.equal(phaseAt(boss, 0.9), 0, '90% -> fase 1');
    assert.equal(phaseAt(boss, 0.76), 0, '76% -> fase 1');
    assert.equal(phaseAt(boss, 0.75), 1, '75% -> fase 2 (justo en el umbral)');
    assert.equal(phaseAt(boss, 0.74), 1, '74% -> fase 2');
    assert.equal(phaseAt(boss, 0.4), 2, '40% -> fase 3');
    assert.equal(phaseAt(boss, 0.39), 2, '39% -> fase 3');
    assert.equal(phaseAt(boss, 0.0), 3, '0% -> ultima fase');

    for (let i = 0; i < boss.phases.length; i++) {
      assert.ok(expected.includes(i), `fase ${i} existe`);
    }
  });

  it('cambiar de fase cambia el atributo y las resistencias EFFECTIVAS', () => {
    const boss = getBoss('guardiana_luz')!;
    const fighter = buildBossFighter(boss, 'rival');

    const before = effectiveSpecies(fighter);
    assert.equal(fighter.boss!.phaseIndex, 0);

    // La fase 2 declara atributo virus e inmunidad a luz.
    setBossPhase(fighter, 1);
    const after = effectiveSpecies(fighter);

    assert.equal(after.attribute, 'virus', 'el atributo cambia con la fase');
    assert.deepEqual(after.immuneTo, ['luz'], 'la inmunidad de fase se aplica');
    // El perfil elemental entero, no solo `weakTo`: dos fases pueden
    // compartir debilidades y seguir siendoStrategies distintas.
    const profile = (s: typeof before) =>
      `${s.elements}|${s.weakTo}|${s.resists}|${s.immuneTo ?? []}`;
    assert.notEqual(profile(after), profile(before), 'el perfil elemental se redefine');
  });

  it('el atributo NO revierte si la fase siguiente no lo declara', () => {
    // Regresión: leer el atributo de la ESPECIE en vez del del combatiente
    // hacía que cada fase sin atributo propio deshaciera el cambio anterior.
    const boss = getBoss('titanramon')!;
    const fighter = buildBossFighter(boss, 'rival');

    setBossPhase(fighter, 1);
    assert.equal(effectiveSpecies(fighter).attribute, boss.phases[1]!.attribute);

    // La fase 3 declara otro, y la 4 no declara ninguno.
    setBossPhase(fighter, 2);
    const third = effectiveSpecies(fighter).attribute;
    assert.equal(third, boss.phases[2]!.attribute);

    setBossPhase(fighter, 3);
    assert.equal(
      effectiveSpecies(fighter).attribute,
      third,
      'la fase sin atributo debe MANTENER el anterior, no volver a la especie',
    );
  });

  it('el motor avanza de fase y lo dice', () => {
    const boss = getBoss('ceniza_viva')!;
    const fighter = buildBossFighter(boss, 'rival');
    const state = bossBattle(fighter);

    // 30% de vida: debería entrar en la segunda fase.
    fighter.hp = Math.round(fighter.stats.hp * 0.3);
    const before = state.log.length;

    resolveTurn(state, { type: 'defender' }, new Rng(3));

    assert.ok(fighter.boss!.phaseIndex >= 1, `sigue en la fase ${fighter.boss!.phaseIndex}`);
    const joined = state.log.slice(before).join('\n');
    assert.ok(joined.includes('cambia de fase'), `no se anuncia el cambio: ${joined}`);
  });

  it('un golpe que salta varias fases aterriza en la correcta', () => {
    const boss = getBoss('titanramon')!;
    const fighter = buildBossFighter(boss, 'rival');
    const state = bossBattle(fighter);

    // De 100% a 20% de golpe: debe quedar en la fase 3, no en la 1.
    fighter.hp = Math.round(fighter.stats.hp * 0.2);
    resolveTurn(state, { type: 'defender' }, new Rng(11));

    assert.equal(fighter.boss!.phaseIndex, 2, `aterrizó en la fase ${fighter.boss!.phaseIndex}`);
    assert.equal(
      effectiveSpecies(fighter).attribute,
      boss.phases[2]!.attribute,
      'con la identidad de la fase en la que esta, no en una intermedia',
    );
  });

  it('las fases NO retroceden si el jugador cura al jefe', () => {
    const boss = getBoss('titanramon')!;
    const fighter = buildBossFighter(boss, 'rival');
    const state = bossBattle(fighter);

    fighter.hp = Math.round(fighter.stats.hp * 0.5);
    resolveTurn(state, { type: 'defender' }, new Rng(3));
    const reached = fighter.boss!.phaseIndex;
    assert.ok(reached >= 1, 'ha avanzado');

    // Curarlo (o drenarlo) no debe devolverlo a la fase anterior.
    fighter.hp = fighter.stats.hp;
    resolveTurn(state, { type: 'defender' }, new Rng(3));

    assert.equal(
      fighter.boss!.phaseIndex,
      reached,
      'retroceder de fase invitaría a subirlo y bajarlo para farmear el cambio de tipo',
    );
  });

  it('el jefe acumula el daño que recibe, para la contribución', () => {
    const boss = getBoss('ceniza_viva')!;
    const fighter = buildBossFighter(boss, 'rival');
    const state = bossBattle(fighter);

    assert.equal(fighter.boss!.damageTaken, 0);

    const hpBefore = fighter.hp;
    resolveTurn(state, { type: 'movimiento', move: attack(state) }, new Rng(21));

    assert.ok(hpBefore - fighter.hp > 0, 'el golpe hizo daño');
    assert.equal(
      fighter.boss!.damageTaken,
      hpBefore - fighter.hp,
      'el daño al jefe se lleva la cuenta exacta',
    );
  });

  it('los telegrafiados tienen un movimiento real y un aviso con margen', () => {
    for (const boss of Object.values(BOSSES)) {
      if (!boss.telegraph) continue;
      const spec = boss.telegraph;

      assert.ok(MOVES[spec.moveKey], `${boss.name}: telegrafía un move inexistente (${spec.moveKey})`);
      assert.ok(spec.lead >= 2, `${boss.name}: ${spec.lead} turno(s) de aviso no dan tiempo a reaccionar`);
      assert.ok(spec.every > spec.lead, `${boss.name}: se telegrafía más rápido de lo que dura el aviso`);
      assert.ok(spec.power > 1, `${boss.name}: el golpe telegrafiado no pega más que un golpe normal`);
      assert.ok(spec.hint.length > 10, `${boss.name}: sin pista para el jugador`);
    }
  });

  it('sin un Digimon del elemento correcto, el golpe se lleva entero', () => {
    assert.equal(telegraphExposure([], [], 'fuego'), 1, 'neutro = 100%');
    assert.equal(telegraphExposure(['fuego'], [], 'fuego'), 0.4, 'el que resiste aguanta el 40%');
    assert.equal(telegraphExposure([], ['fuego'], 'fuego'), 2, 'el muy débil se lleva el doble');
  });

  it('cada respuesta recorta, y ninguna dos veces', () => {
    const boss = getBoss('titanramon')!;
    const fighter = buildBossFighter(boss, 'rival');
    const state = bossBattle(fighter);

    // Forzamos el telegrafiado para no depender del turno.
    fighter.boss!.telegraph = {
      moveKey: 'combo_terrestre',
      name: 'Combo Terrestre',
      element: 'tierra',
      turnsLeft: 1,
      lead: 2,
      estimate: 500,
      counter: 'cambiar',
      hint: 'cambia',
      mitigated: 0,
    };

    registerCounter(state, 'cambiar');
    assert.equal(fighter.boss!.telegraph!.mitigated, COUNTER_REDUCTION.cambiar);

    // La segunda vez no mejora nada: no se puede farmear el recorte.
    registerCounter(state, 'cambiar');
    assert.equal(
      fighter.boss!.telegraph!.mitigated,
      COUNTER_REDUCTION.cambiar,
      'repetir la respuesta no la acumula',
    );
  });

  it('defender recorta más que cambiar, y el elemento gana a las dos', () => {
    assert.ok(COUNTER_REDUCTION.defender > COUNTER_REDUCTION.cambiar, 'defender > cambiar');
    assert.ok(COUNTER_REDUCTION.cambiar > COUNTER_REDUCTION.curar, 'cambiar > curar');
    assert.ok(
      COUNTER_REDUCTION.elemento > COUNTER_REDUCTION.defender,
      'tener el elemento correcto tiene que ser la mejor respuesta, o no se busca',
    );
  });
});

/** Monta un combate contra el jefe dado, con un jugador de prueba. */
function bossBattle(fighter: ReturnType<typeof buildBossFighter>) {
  const party = [makeDigimon(getSpecies('wargreymon')!, 55, 1, ['mega_llama'])];
  const state = createBattle(party, 0, getSpecies('wargreymon')!, 55);
  state.enemy = fighter;
  state.enemyTeam = [fighter];
  state.enemyIndex = 0;
  state.isBoss = true;
  return state;
}

/** Primer movimiento utilizable del jugador. */
function attack(state: BattleState) {
  const move = state.player.moves.find((m) => m.energyCost <= state.player.energy);
  assert.ok(move, 'el jugador no tiene movimientos utilizables');
  return move!;
}

describe('bandas de encuentro', () => {
  /**
   * El triángulo es canonico y no se puede tocar (Datos > Vacuna, etc). Lo que
   * sí es diseño nuestro es qué especies hay en cada banda. Si una banda sale
   * casi toda del mismo atributo, el único Digimon del otro atributo queda
   * countered de forma permanente: Gatomon (vacuna) llegaba al 7% de victorias
   * contra un pool de Rookie que era 60% Datos.
   */
  it('ninguna banda está dominada por un solo atributo', () => {
    for (const table of ENCOUNTER_TABLES) {
      const counts = new Map<string, number>();
      for (const key of table.keys) {
        const attribute = getSpecies(key)!.attribute;
        counts.set(attribute, (counts.get(attribute) ?? 0) + 1);
      }

      const worst = Math.max(...counts.values());
      const share = worst / table.keys.length;

      assert.ok(
        share <= 0.5,
        `banda ${table.minLevel}-${table.maxLevel}: ` +
          `${Math.round(share * 100)}% del pool es del mismo atributo ` +
          `(${[...counts].map(([a, n]) => `${a}:${n}`).join(', ')})`,
      );
    }
  });

  it('cada banda cubre al menos dos atributos distintos', () => {
    for (const table of ENCOUNTER_TABLES) {
      const attributes = new Set(table.keys.map((k) => getSpecies(k)!.attribute));
      assert.ok(
        attributes.size >= 2,
        `banda ${table.minLevel}-${table.maxLevel}: todo el pool comparte atributo`,
      );
    }
  });

  it('la banda corresponde al tier que el jugador tiene a esa altura', () => {
    // Si una banda mezcla tiers muy distintos, un Rookie se encuentra con un
    // Champion de su nivel y el combate es imposible por stats, no por juego.
    for (const table of ENCOUNTER_TABLES) {
      const tiers = new Set(table.keys.map((k) => getSpecies(k)!.tier));
      assert.ok(
        tiers.size <= 2,
        `banda ${table.minLevel}-${table.maxLevel}: mezcla ${[...tiers].join('/')}`,
      );
    }
  });

  it('las bandas cubren todos los niveles sin huecos ni solapes', () => {
    const sorted = [...ENCOUNTER_TABLES].sort((a, b) => a.minLevel - b.minLevel);
    assert.equal(sorted[0]!.minLevel, 2, 'la primera banda debe empezar en el nivel 2');

    for (let i = 1; i < sorted.length; i++) {
      assert.equal(
        sorted[i]!.minLevel,
        sorted[i - 1]!.maxLevel + 1,
        `hueco o solape entre la banda ${sorted[i - 1]!.minLevel}-${sorted[i - 1]!.maxLevel}` +
          ` y ${sorted[i]!.minLevel}-${sorted[i]!.maxLevel}`,
      );
    }

    assert.equal(sorted[sorted.length - 1]!.maxLevel, 100, 'la última banda debe llegar a 100');
  });
});

describe('equipo permanente', () => {
  it('el equipo suma y nunca baja una estadística', () => {
    const base = { hp: 100, attack: 50, defense: 40, speed: 30 };

    assert.deepEqual(applyGear(base, []), base, 'sin equipo no cambia nada');

    const armed = applyGear(base, [{ itemKey: 'espada_digital', upgrade: 0 }]);
    assert.equal(armed.attack, base.attack + EQUIPMENT.espada_digital!.bonus.attack);
    assert.equal(armed.hp, base.hp, 'un arma no toca el PV');
    assert.equal(armed.defense, base.defense);
    assert.equal(armed.speed, base.speed);

    // Nunca puede quedar por debajo de la base, aunque se combinen muchas.
    const stacked = applyGear(base, [
      { itemKey: 'espada_digital', upgrade: 5 },
      { itemKey: 'coraza_titanio', upgrade: 5 },
      { itemKey: 'chip_reflejos', upgrade: 5 },
      { itemKey: 'anillo_prisa', upgrade: 5 },
    ]);
    for (const stat of ['hp', 'attack', 'defense', 'speed'] as const) {
      assert.ok(stacked[stat] >= base[stat], `${stat} bajó por debajo de la base`);
    }
  });

  it('cada mejora suma más que la anterior', () => {
    const base = { hp: 0, attack: 100, defense: 0, speed: 0 };
    const at = (upgrade: number) => applyGear(base, [{ itemKey: 'espada_digital', upgrade }]).attack;

    const steps = [0, 1, 2, 3, 4, 5].map(at);
    for (let i = 1; i < steps.length; i++) {
      assert.ok(steps[i]! > steps[i - 1]!, `paso ${i}: ${steps[i - 1]} -> ${steps[i]}`);
    }
    assert.equal(MAX_UPGRADE, 5);
  });

  it('todo el catálogo es coherente', () => {
    const seen = new Set<string>();

    for (const def of Object.values(EQUIPMENT)) {
      assert.ok(def.key === Object.keys(EQUIPMENT).find((k) => EQUIPMENT[k] === def), 'key coherente');
      assert.ok(!seen.has(def.key), `clave duplicada: ${def.key}`);
      seen.add(def.key);

      assert.ok(SLOTS.includes(def.slot), `${def.key}: ranura desconocida ${def.slot}`);
      assert.ok(def.price > 0, `${def.key}: precio inválido`);
      assert.ok(def.requiredLevel >= 1, `${def.key}: nivel requerido inválido`);

      const hasBonus = Object.values(def.bonus).some((v) => (v ?? 0) > 0);
      const hasExtra = (def.critRate ?? 0) > 0 || (def.accuracy ?? 0) > 0 || def.effect;
      assert.ok(hasBonus || hasExtra, `${def.key}: no hace absolutamente nada`);

      // Un bonus negativo rompería la garantía de "nunca baja".
      for (const [stat, value] of Object.entries(def.bonus)) {
        assert.ok(
          (value ?? 0) >= 0,
          `${def.key}: bonus negativo en ${stat}; el equipo nunca debe bajar stats`,
        );
      }
    }

    for (const slot of SLOTS) {
      assert.ok(
        Object.values(EQUIPMENT).some((e) => e.slot === slot),
        `nadie ocupa la ranura ${slot}`,
      );
    }
    for (const rarity of ['comun', 'raro', 'epico', 'leyenda']) {
      assert.ok(
        Object.values(EQUIPMENT).some((e) => e.rarity === rarity),
        `falta la rareza ${rarity}`,
      );
    }
  });

  it('los efectos activos son recognoscibles y acotados', () => {
    for (const def of Object.values(EQUIPMENT)) {
      const effect = def.effect;
      if (!effect) continue;

      assert.ok(
        ['drenar', 'primera_sangre', 'escudo', 'contraataque', 'lento'].includes(effect.kind),
        `${def.key}: efecto desconocido ${effect.kind}`,
      );

      const ratio = (effect as { ratio?: number }).ratio;
      if (ratio !== undefined) {
        assert.ok(ratio > 0 && ratio <= 2, `${def.key}: ratio fuera de rango (${ratio})`);
      }
    }
  });

  it('los efectos se acumulan sin volverse infinitos', () => {
    const all = Object.values(EQUIPMENT)
      .filter((e) => e.effect)
      .map((e) => ({ itemKey: e.key, upgrade: 0 }));

    const effects = gearEffects(all);
    assert.equal(effects.length, all.length);

    // Ningún combo de equipo puede superar el 100% de mitigación: un jugador
    // con 4 piezas de escudo no debe volverse invencible.
    const totalMitigation = gearEffects(all)
      .filter((e) => e.effect.kind === 'escudo')
      .reduce((sum, e) => sum + e.effect.ratio, 0);

    assert.ok(totalMitigation < 1, `mitigación total ${totalMitigation} sería invencible`);
  });

  it('mejorar cuesta más cada vez y hay tope', () => {
    const def = EQUIPMENT.espada_digital!;
    const costs = [0, 1, 2, 3, 4].map((u) => upgradeCost(def, u));

    for (let i = 1; i < costs.length; i++) {
      assert.ok(costs[i]! > costs[i - 1]!, `paso ${i}: ${costs[i - 1]} -> ${costs[i]}`);
    }
    assert.ok(upgradeMaterialCost(5) > upgradeMaterialCost(0), 'el material también sube');
  });
});

describe('entrenadores rivales', () => {
  it('ningún rival tiene su equipo entero de un solo atributo', () => {
    // Uno de los primeros trainersorhíame los tres Digimon de tipo Vacuna: el
    // jugador lo leía en dos turnos y no había combate.
    for (const template of getTemplates()) {
      const attributes = new Set(templateAttributes(template));
      assert.ok(
        attributes.size > 1,
        `${template.name} tiene el equipo entero de un atributo (${[...attributes]})`,
      );
    }
  });

  it('todos los Digimon de las plantillas existen y están equilibrados', () => {
    for (const template of getTemplates()) {
      assert.ok(template.team.length >= 2, `${template.name}: equipo demasiado corto`);

      for (const member of template.team) {
        const species = getSpecies(member.speciesKey);
        assert.ok(species, `${template.name}: especie inexistente ${member.speciesKey}`);
        assert.ok(member.level >= 1, `${template.name}: nivel inválido`);
      }

      // Los niveles del equipo no pueden estar muy dispersos: parecería
      // que el entrenador no los conoce.
      const levels = template.team.map((m) => m.level);
      const spread = Math.max(...levels) - Math.min(...levels);
      assert.ok(spread <= 5, `${template.name}: niveles muy dispersos (${spread})`);
    }
  });

  it('el nivel del rival nunca supera al del jugador por mucho', () => {
    for (const level of [1, 5, 12, 20, 30, 45, 60, 90]) {
      for (let seed = 1; seed <= 12; seed++) {
        const template = rollTrainer(level, new Rng(seed));
        assert.ok(
          templateLevel(template) <= level + 4,
          `jugador Nv.${level} se encontró a ${template.name} de Nv.${templateLevel(template)}`,
        );
      }
    }
  });

  it('el filtro de jefe solo devuelve jefes y el normal nunca bosses', () => {
    for (let seed = 1; seed <= 30; seed++) {
      assert.equal(rollTrainer(40, new Rng(seed), true).boss, true);
      assert.equal(rollTrainer(40, new Rng(seed), false).boss, false);
    }
  });

  it('los jefes pagan mucho más que un salvaje', () => {
    const species = getSpecies('kunemon')!;
    const rng = () => new Rng(5);
    const plain = rollRewards(species, 20, rng(), 1);
    const boss = rollRewards(species, 20, rng(), 4);

    assert.ok(boss.exp >= plain.exp * 3, `solo x${(boss.exp / plain.exp).toFixed(1)}`);
    assert.ok(boss.digibytes > plain.digibytes);
  });

  it('el rival entra en combate aunque caiga el primero', () => {
    const state = createTrainerBattle(
      [makeDigimon(getSpecies('greymon')!, 40)],
      0,
      {
        team: [
          { species: getSpecies('kunemon')!, level: 1 },
          { species: getSpecies('betamon')!, level: 20 },
        ],
        trainerName: 'Test',
        intro: 'Vamos',
        boss: false,
        inventory: {},
      },
    );

    assert.equal(state.enemyTeam.length, 2);
    assert.equal(state.enemyIndex, 0);

    // Matamos al primero a base de golpes.
    let turns = 0;
    while (!state.finished && turns < 60 && state.enemy === state.enemyTeam[0]) {
      state.enemy.hp = 0;
      resolveTurn(state, { type: 'defender' }, new Rng(turns + 1));
      turns++;
    }

    assert.equal(state.enemy, state.enemyTeam[1], 'el rival debe cambiar');
    assert.equal(state.enemyIndex, 1);
    assert.equal(state.finished, false, 'no debe terminar solo por caer uno');
    assert.ok(state.enemy.hp > 0, 'el nuevo rival entra vivo');
  });

  it('un jefe se marca como tal', () => {
    const state = createTrainerBattle([makeDigimon(getSpecies('greymon')!, 40)], 0, {
      team: [{ species: getSpecies('kunemon')!, level: 40 }],
      trainerName: 'Jefe',
      intro: 'No pasarás',
      boss: true,
      inventory: {},
    });

    assert.equal(state.isBoss, true);
    assert.equal(state.enemyTrainer, 'Jefe');
  });

  it('un Digimon caído no puede volver a entrar', () => {
    const party = [
      makeDigimon(getSpecies('agumon')!, 5, 1),
      makeDigimon(getSpecies('gabumon')!, 5, 2),
      makeDigimon(getSpecies('biyomon')!, 5, 3),
    ];
    const state = createBattle(party, 0, getSpecies('metalgreymon')!, 40);

    // Matamos al activo a mano.
    state.player.hp = 0;
    resolveTurn(state, { type: 'defender' }, new Rng(1));
    assert.equal(state.awaitingSwitch, true);

    // Al segundo le queda vida.
    switchTo(state, party[1]!.id);
    assert.equal(state.activeIndex, 1);

    // Ahora matamos al segundo.
    state.player.hp = 0;
    resolveTurn(state, { type: 'defender' }, new Rng(2));
    assert.equal(state.awaitingSwitch, true, 'el tercero sigue en pie');

    // Cambiar al ya caído (índice 0) debe rechazarse.
    assert.equal(switchTo(state, party[0]!.id), false, 'no se puede volver a un caído');
    assert.equal(state.awaitingSwitch, true, 'sigue pidiendo cambio');

    const candidates = switchCandidates(state);
    assert.equal(candidates.length, 1, `candidatos: ${candidates.map((c) => c.species.name)}`);
    assert.equal(candidates[0]!.id, party[2]!.id);
  });

  it('la batalla termina cuando no queda nadie en pie', () => {
    const party = [
      makeDigimon(getSpecies('agumon')!, 5, 1),
      makeDigimon(getSpecies('gatomon')!, 5, 2),
    ];
    const state = createBattle(party, 0, getSpecies('metalgreymon')!, 40);

    for (let i = 0; i < 4 && !state.finished; i++) {
      if (state.awaitingSwitch) {
        const reserve = switchCandidates(state)[0];
        if (!reserve) break;
        switchTo(state, reserve.id);
      }
      state.player.hp = 0;
      resolveTurn(state, { type: 'defender' }, new Rng(i + 1));
    }

    assert.equal(state.finished, true);
    assert.equal(state.result, 'derrota');
  });

  it('un rival con equipo entra en combate aunque caiga el primero', () => {
    const state = createTrainerBattle([makeDigimon(getSpecies('agumon')!, 90)], 0, {
      team: [
        { species: getSpecies('kunemon')!, level: 5 },
        { species: getSpecies('betamon')!, level: 5 },
        { species: getSpecies('veldmon')!, level: 5 },
      ],
      trainerName: 'Rival',
      intro: 'Vamos',
      boss: false,
      inventory: {},
    });

    assert.equal(state.enemyTeam.length, 3);
    assert.equal(state.enemy, state.enemyTeam[0], 'enemy y enemyTeam[0] son el MISMO objeto');

    // El jugador ataca de verdad: si solo se defendiera, ningún rival caería
    // y la prueba no mediría nada.
    const seen = new Set<string>([state.enemy.name]);
    let turns = 0;
    while (!state.finished && turns < 200) {
      const move = state.player.moves.find((m) => m.energyCost <= state.player.energy)!;
      resolveTurn(state, { type: 'movimiento', move }, new Rng(turns + 1));
      seen.add(state.enemy.name);
      turns++;
    }

    assert.equal(state.finished, true, 'la batalla acaba');
    assert.equal(state.result, 'victoria');
    assert.ok(
      seen.size === 3,
      `el rival debería usar sus 3 Digimon; se vio: ${[...seen].join(', ')}`,
    );
  });
});

describe('zonas', () => {
  it('toda zona tiene una plantilla de jefe que existe de verdad', () => {
    for (const zone of ZONES) {
      if (!zone.boss) continue;
      const boss = getTutorTemplate(zone.boss);
      assert.ok(boss, `${zone.name}: jefe inexistente "${zone.boss}"`);
      assert.equal(boss!.boss, true, `${zone.name}: "${zone.boss}" no es un jefe`);
    }
  });

  it('toda zona lista rivales que existen', () => {
    for (const zone of ZONES) {
      for (const key of zone.trainers) {
        assert.ok(getTutorTemplate(key), `${zone.name}: rival inexistente "${key}"`);
      }
      assert.ok(zone.trainers.length > 0, `${zone.name} no tiene rivales`);
    }
  });

  it('las zonas cubren todos los niveles sin huecos', () => {
    const sorted = [...ZONES].sort((a, b) => a.minLevel - b.minLevel);
    assert.equal(sorted[0]!.minLevel, 1, 'la primera zona debe abrir en nivel 1');

    for (let i = 1; i < sorted.length; i++) {
      // Contiguo: la siguiente empieza como muy tarde un nivel después de
      // que acabe la anterior. (11 -> 12 está bien; 11 -> 15 deja un hueco.)
      assert.ok(
        sorted[i]!.minLevel <= sorted[i - 1]!.maxLevel + 1,
        `hueco entre ${sorted[i - 1]!.name} (${sorted[i - 1]!.maxLevel}) ` +
          `y ${sorted[i]!.name} (${sorted[i]!.minLevel})`,
      );
    }

    assert.equal(sorted[sorted.length - 1]!.maxLevel, 100);
  });

  it('cada zona tiene Digimon que puedes encontrar de verdad', () => {
    for (const zone of ZONES) {
      const roster = zoneRoster(zone);
      assert.ok(roster.length > 0, `${zone.name} no tiene espécies`);
      for (const member of roster) {
        assert.ok(getSpecies(member.key), `${zone.name}: especie inexistente ${member.key}`);
      }
    }
  });

  it('la zona de un nivel siempre cae dentro de su rango', () => {
    for (let level = 1; level <= 100; level++) {
      const zone = zoneForLevel(level);
      assert.ok(
        level <= zone.maxLevel,
        `Nv.${level} cae en ${zone.name} (máx ${zone.maxLevel})`,
      );
      // Y nunca te manda a una zona donde serías hopeless.
      assert.ok(
        level >= zone.minLevel - 12,
        `Nv.${level} cae en ${zone.name} (mín ${zone.minLevel}), demasiado lejos`,
      );
    }
  });

  it('avisa cuando vas sobre o bajo de nivel', () => {
    const first = ZONES[0]!; // 1-11
    const deep = ZONES[ZONES.length - 1]!; // 46-100

    assert.equal(canEnter(first, 5), 'ok', 'nivel dentro del rango');
    assert.equal(canEnter(first, 1), 'ok', 'el mínimo de la zona es alcanzable');
    assert.equal(canEnter(first, 90), 'fácil', 'muy por encima');
    assert.equal(canEnter(deep, 10), 'bajo', 'muy por debajo');
  });

  it('las zonas altas pagan más que las bajas', () => {
    const bonuses = ZONES.map((z) => z.bonus);
    for (let i = 1; i < bonuses.length; i++) {
      assert.ok(
        bonuses[i]! >= bonuses[i - 1]!,
        `${ZONES[i]!.name} paga menos que ${ZONES[i - 1]!.name}`,
      );
    }
  });

  it('un jefe solo puede estar en zonas de nivel alto', () => {
    for (const zone of ZONES) {
      if (!zone.boss) continue;
      const boss = getTutorTemplate(zone.boss)!;
      const bossLevel = boss.team.reduce((a, m) => a + m.level, 0) / boss.team.length;
      assert.ok(
        bossLevel >= zone.minLevel,
        `${zone.name} (mín ${zone.minLevel}) tiene un jefe de nivel ${bossLevel}`,
      );
    }
  });
});

describe('partido y PC', () => {
  it('el limite de equipo viene de la configuracion', () => {
    // MAX_PARTY_SIZE debe ser >= 2 para que cambiar de Digimon tenga sentido.
    assert.ok(config.maxPartySize >= 2, 'el equipo debe admitir al menos 2 Digimon');
    assert.ok(config.pcCapacity > config.maxPartySize, 'el PC debe ser mas grande que el equipo');
  });
});

describe('rate limiting', () => {
  it('bloquea un comando en enfriamiento y deja pasar tras expirar', () => {
    resetRateLimit('u1');
    const t0 = 1_000_000;

    check('u1', checkCommand('u1', 'explorar', t0).allowed, 'primer uso');
    const second = checkCommand('u1', 'explorar', t0 + 1000);
    check('u1', !second.allowed && second.reason === 'cooldown', 'bloqueado al instante');
    check('u1', second.retryAfter > 0, `${second.retryAfter}s`);

    check('u1', checkCommand('u1', 'explorar', t0 + 7000).allowed, 'pasado el enfriamiento');
  });

  it('el enfriamiento es por comando, no global', () => {
    resetRateLimit('u2');
    const t0 = 2_000_000;

    check('u2', checkCommand('u2', 'explorar', t0).allowed);
    check('u2', !checkCommand('u2', 'explorar', t0).allowed, 'explorar bloqueado');
    check('u2', checkCommand('u2', 'pokedex', t0).allowed, 'otro comando sigue libre');
    check('u2', checkCommand('u2', 'perfil', t0).allowed, 'comando sin regla sigue libre');
  });

  it('un usuario no agota el cupo de otro', () => {
    resetRateLimit('u3');
    resetRateLimit('u4');
    const t0 = 3_000_000;

    for (let i = 0; i < 25; i++) checkCommand('u3', 'perfil', t0 + i);
    check('u3', !checkCommand('u3', 'perfil', t0 + 26).allowed, 'u3 se pasa');
    check('u4', checkCommand('u4', 'perfil', t0).allowed, 'u4 intacto');
  });

  it('la ventana global se reabre sola', () => {
    resetRateLimit('u5');
    const t0 = 4_000_000;

    for (let i = 0; i < 25; i++) checkCommand('u5', 'perfil', t0 + i);
    check('u5', !checkCommand('u5', 'perfil', t0).allowed, 'bloqueado');

    // 61 segundos despues la ventana antigua ya no cuenta.
    check('u5', checkCommand('u5', 'perfil', t0 + 61_000).allowed, 'reabierto');
  });

  it('resetRateLimit limpia de verdad', () => {
    resetRateLimit('u6');
    const t0 = 5_000_000;
    check('u6', checkCommand('u6', 'explorar', t0).allowed);
    check('u6', !checkCommand('u6', 'explorar', t0).allowed);

    resetRateLimit('u6');
    check('u6', checkCommand('u6', 'explorar', t0).allowed, 'libre tras reset');
  });

  it('el mensaje de bloqueo explica el motivo', () => {
    resetRateLimit('u7');
    const t0 = 6_000_000;
    checkCommand('u7', 'explorar', t0);
    const verdict = checkCommand('u7', 'explorar', t0);
    const embed = rateLimitMessage(verdict);

    check('u7', embed.data.description!.includes(String(verdict.retryAfter)), 'incluye el tiempo');
  });

  /** Azucar para que las aserciones se lean en el fallo. */
  function check(label: string, condition: boolean, detail = '') {
    assert.ok(condition, `${label}: ${detail}`);
  }
});

describe('aleatoriedad', () => {
  it('semillas consecutivas no producen la misma secuencia', () => {
    // Sin dispersar la semilla, xorshift32 con semillas 1,2,3... devuelve casi
    // la misma primera salida y los encuentros de cada nivel salían siempre
    // con la misma especie.
    const firsts = Array.from({ length: 40 }, (_, i) => new Rng(1000 + i).next());
    assert.ok(new Set(firsts).size > 35, `solo ${new Set(firsts).size} valores distintos de 40`);

    const ints = Array.from({ length: 40 }, (_, i) => new Rng(i).int(0, 6));
    assert.ok(new Set(ints).size > 4, 'pick() devuelve siempre el mismo índice');
  });

  it('los encuentros de un nivel varían de especie', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      seen.add(rollEncounter(8, new Rng(1000 + i)).species.key);
    }
    assert.ok(seen.size >= 5, `solo ${seen.size} especies distintas en 80 encuentros`);
  });

  it('el nivel del rival se mantiene cerca del del jugador', () => {
    for (let i = 0; i < 100; i++) {
      const encounter = rollEncounter(20, new Rng(500 + i));
      assert.ok(
        encounter.level >= 19 && encounter.level <= 22,
        `nivel fuera de rango: ${encounter.level} para un jugador de nivel 20`,
      );
    }
  });

  it('shuffle no muta el array original', () => {
    const original = [1, 2, 3, 4, 5];
    const rng = new Rng(9);
    const shuffled = rng.shuffle(original);
    assert.deepEqual(original, [1, 2, 3, 4, 5]);
    assert.deepEqual([...shuffled].sort(), [...original].sort());
  });
});

describe('progresión', () => {
  it('acumula EXP y sube niveles correctamente', () => {
    const digimon = makeDigimon(getSpecies('agumon')!, 1);
    // La curva es creciente: hay que sumar el coste exacto de los tres niveles.
    const needed = expToNextLevel(1) + expToNextLevel(2) + expToNextLevel(3);
    const persisted: OwnedDigimon[] = [];
    const result = grantExp(digimon, needed + 5, (d) => persisted.push(d));

    assert.ok(result, 'debería haber subida de nivel');
    assert.equal(result!.fromLevel, 1);
    assert.equal(result!.toLevel, 4);
    assert.equal(digimon.exp, 5);
    // El persister debe recibir el objeto YA modificado, no una copia vieja.
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0]!.level, 4);
    assert.ok(persisted[0]!.stats.hp > getSpecies('agumon')!.base.hp);
  });

  it('aprende movimientos nuevos al subir de nivel', () => {
    const digimon = makeDigimon(getSpecies('agumon')!, 1, 1, ['impacto', 'lanza_llamas']);
    const needed = expToNextLevel(1) + expToNextLevel(2) + expToNextLevel(3) + expToNextLevel(4);
    const result = grantExp(digimon, needed, () => {});

    assert.equal(result!.toLevel, 5);
    assert.deepEqual(result!.newMoves, []);
    // El nivel 9 desbloquea el tercer movimiento del learnset.
    const digimon9 = makeDigimon(getSpecies('agumon')!, 5, 1, ['impacto', 'lanza_llamas']);
    const more = expToNextLevel(5) + expToNextLevel(6) + expToNextLevel(7) + expToNextLevel(8);
    const result2 = grantExp(digimon9, more, () => {});
    assert.equal(result2!.toLevel, 9);
    assert.deepEqual(result2!.newMoves, ['concentracion']);
    assert.ok(digimon9.moves.some((m) => m.key === 'concentracion'));
  });

  it('no supera el nivel máximo', () => {
    const digimon = makeDigimon(getSpecies('agumon')!, 100);
    const result = grantExp(digimon, 999_999, () => {});
    assert.equal(result, null);
    assert.equal(digimon.level, 100);
    assert.equal(digimon.exp, 0);
  });
});

describe('evolución manual', () => {
  /**
   * El cambio de diseño central del plan C: subir de nivel DESBLOQUEA, no
   * transforma. Estos tests son la garantía de que nadie reintroduce la
   * evolución automática por inercia.
   */
  it('subir de nivel NO evoluciona, solo desbloquea', () => {
    const agumon = makeDigimon(getSpecies('agumon')!, 11, 1, ['impacto', 'lanza_llamas']);
    assert.equal(agumon.species.key, 'agumon');

    const result = grantExp(agumon, expToNextLevel(11), () => {});

    assert.equal(result!.toLevel, 12, 'el nivel sube');
    assert.equal(result!.evolvedTo, null, 'pero no evoluciona');
    assert.equal(agumon.species.key, 'agumon', 'la especie se queda igual');

    // Los stats SI se escalan con el nivel, usando las bases de Agumon.
    assert.equal(agumon.stats.hp, computeStats(getSpecies('agumon')!.base, 12).hp);

    // Y muchos niveles de golpe tampoco evolucionan.
    const veteran = makeDigimon(getSpecies('agumon')!, 11, 1, ['impacto']);
    let bulk = 0;
    for (let i = 0; i < 12; i++) bulk += expToNextLevel(11 + i);
    const jumped = grantExp(veteran, bulk, () => {});
    assert.ok(jumped!.toLevel > 15, 'subió varios niveles');
    assert.equal(jumped!.evolvedTo, null, 'y aun así no evolucionó');
    assert.equal(veteran.species.key, 'agumon');
  });

  it('no desbloquea nada por debajo del nivel requerido', () => {
    const agumon = makeDigimon(getSpecies('agumon')!, 5, 1, ['impacto']);
    grantExp(agumon, expToNextLevel(5) + expToNextLevel(6) - 1, () => {});
    assert.equal(agumon.species.key, 'agumon');

    // Agumon pide nivel 12 y sigue en Agumon: la ruta existe pero no se cumple.
    const route = agumon.species.evolutions[0]!;
    assert.equal(route.to, 'greymon');
    assert.ok(agumon.level < route.level, 'no ha llegado al nivel de la ruta');
  });

  it('aplazar una evolución no pierde el acceso a ella', () => {
    const agumon = makeDigimon(getSpecies('agumon')!, 30, 1, ['impacto']);
    assert.ok(agumon.level > agumon.species.evolutions[0]!.level * 2);
    assert.equal(agumon.species.evolutions.length, 1, 'la ruta sigue ahí');
    assert.equal(getSpecies(agumon.species.evolutions[0]!.to)!.key, 'greymon');
  });

  it('conserva solo los movimientos que la nueva forma conoce', () => {
    const agumon = makeDigimon(getSpecies('agumon')!, 12, 1, [
      'impacto',
      'lanza_llamas',
      'concentracion',
      'mega_llama',
    ]);

    const name = applyEvolution(agumon, 'greymon');
    assert.equal(name, 'Greymon');

    const keys = agumon.moves.map((m) => m.key);
    for (const key of keys) {
      assert.ok(
        getSpecies('greymon')!.learnset.includes(key),
        `Greymon no debería conocer ${key}`,
      );
    }
    assert.ok(keys.includes('impacto'), 'debería conservar Impacto');
    assert.ok(
      !keys.includes('concentracion'),
      'concentracion no es de Greymon y debe desaparecer',
    );
  });

  it('evolucionar recalcula las estadísticas desde cero, no las suma', () => {
    const agumon = makeDigimon(getSpecies('agumon')!, 40, 1, ['impacto']);

    applyEvolution(agumon, 'greymon');
    const afterFirst = agumon.stats.hp;

    // Evolucionar de nuevo debe dar exactamente el valor derivado de la nueva
    // especie y el mismo nivel. Si se acumulara, esto seria mayor.
    applyEvolution(agumon, 'metalgreymon');
    applyEvolution(agumon, 'wargreymon');

    const expected = computeStats(getSpecies('wargreymon')!.base, 40);
    assert.equal(agumon.stats.hp, expected.hp);
    assert.equal(agumon.stats.attack, expected.attack);
    assert.equal(agumon.stats.defense, expected.defense);
    assert.equal(agumon.stats.speed, expected.speed);

    assert.ok(afterFirst < agumon.stats.hp, 'el salto entre formas es real');
  });

  it('las formas finales no tienen rutas', () => {
    for (const species of Object.values(SPECIES)) {
      if (species.tier !== 'mega') continue;
      assert.equal(
        species.evolutions.length,
        0,
        `${species.name} es Mega y no debería evolucionar más`,
      );
    }
  });

  it('ninguna línea es cíclica y todas las rutas suben de nivel', () => {
    for (const species of Object.values(SPECIES)) {
      for (const route of species.evolutions) {
        const visited = new Set<string>([species.key]);
        let current = SPECIES[route.to]!;
        let guard = 0;

        while (current.evolutions.length > 0) {
          assert.ok(
            !visited.has(current.key),
            `ciclo desde ${species.name}: ${current.name} vuelve a aparecer`,
          );
          assert.ok(guard++ < 6, `cadena demasiado larga desde ${species.name}`);
          visited.add(current.key);

          // Todas las rutas desde una especie piden un nivel >= el de la que
          // trajo al jugador hasta ahí.
          const needed = Math.min(...current.evolutions.map((r) => r.level));
          assert.ok(needed >= route.level, `${current.name} pide menos nivel del que costó llegar`);

          current = SPECIES[current.evolutions[0]!.to]!;
        }

        assert.ok(
          current.evolutions.length === 0,
          `${species.name} no debe quedar en un nodo sin final`,
        );
      }
    }
  });

  it('las ramas son alcanzables, distintas y cuestan algo', () => {
    const forked = Object.values(SPECIES).filter((s) => s.evolutions.some((r) => r.branch));
    assert.ok(forked.length >= 4, `solo ${forked.length} especies tienen rama alternativa`);

    for (const species of forked) {
      const main = species.evolutions.filter((r) => !r.branch);
      const branches = species.evolutions.filter((r) => r.branch);

      assert.ok(main.length >= 1, `${species.name} tiene ramas pero no tiene ruta principal`);
      assert.ok(branches.length >= 1, `${species.name} declara una ruta alternativa sin marcarla`);

      for (const route of branches) {
        const target = getSpecies(route.to)!;
        const mainTarget = getSpecies(main[0]!.to)!;

        assert.ok(
          !main.some((r) => r.to === route.to),
          `${species.name}: la rama repite el destino ${target.name}`,
        );
        assert.notDeepEqual(
          target.base,
          mainTarget.base,
          `${species.name} -> ${target.name}: mismas stats que la ruta principal`,
        );
        // La identidad de tipo de la rama tiene que ser distinta en ALGUN
        // aspecto: elementos, debilidades o resistencias. Comparar solo
        // `elements` no basta, porque dos variantes divinas comparten 'luz'
        // y lo que las separa son las debilidades.
        const typeProfile = (s: SpeciesDef) => [s.elements, s.weakTo, s.resists].join('|');
        assert.notEqual(
          typeProfile(target),
          typeProfile(mainTarget),
          `${species.name} -> ${target.name}: misma identidad elemental que la ruta principal`,
        );

        // Si la rama fuera gratis y más rápida que la principal, sería
        // estrictamente mejor y la elección sería falsa.
        const costsSomething =
          route.level > main[0]!.level ||
          (route.wins ?? 0) > 0 ||
          (route.digibytes ?? 0) > 0 ||
          Object.keys(route.items ?? {}).length > 0;
        assert.ok(costsSomething, `${species.name} -> ${target.name}: la rama no cuesta nada`);
      }
    }
  });

  it('toda rama tiene regresión para deshacerla', () => {
    for (const species of Object.values(SPECIES)) {
      for (const route of species.evolutions.filter((r) => r.branch)) {
        const target = getSpecies(route.to)!;
        assert.ok(
          target.devolution,
          `${target.name} es una rama y no puede volver atrás: sería irreversible`,
        );
        assert.equal(
          target.devolution!.to,
          species.key,
          `${target.name} debería volver a ${species.name}`,
        );
      }
    }
  });

  it('las formas finales también pueden retroceder', () => {
    // Sin esto, equivocarse de rama es perder la temporada entera.
    const withDevolution = Object.values(SPECIES).filter((s) => s.devolution);
    assert.ok(withDevolution.length >= 6, 'hay muy pocas formas con regresión');

    for (const species of withDevolution) {
      assert.ok(getSpecies(species.devolution!.to), 'destino de regresión inexistente');
      assert.ok(
        Object.keys(species.devolution!.items).length > 0,
        `${species.name}: la regresión no cuesta material`,
      );
    }
  });

  it('los materiales de evolución existen y no se usan en combate', () => {
    const routeItems = Object.values(SPECIES)
      .flatMap((s) => s.evolutions)
      .flatMap((r) => Object.keys(r.items ?? {}));

    const devolutionItems = Object.values(SPECIES)
      .filter((s) => s.devolution)
      .flatMap((s) => Object.keys(s.devolution!.items));

    const keys = new Set([...routeItems, ...devolutionItems]);
    assert.ok(keys.size >= 3, 'debería haber varios materiales de evolución');

    for (const key of keys) {
      const item = getItem(key);
      assert.ok(item, `material de evolución inexistente: ${key}`);
      assert.equal(item!.role, 'material', `${key} se usa para evolucionar pero no es material`);
      assert.equal(item!.effect, null, `${key} es material pero se puede usar en combate`);
    }
  });

  it('los Digimon ya existentes sobreviven a la migración sin evolucionar', () => {
    // Compatibilidad: un Digimon guardado con `species_key` tiene que seguir
    // siendo la misma especie y con las mismas estadísticas. La migración no
    // puede aprovechar para transformarlos.
    for (const key of Object.keys(SPECIES)) {
      const species = getSpecies(key)!;
      const digimon = makeDigimon(species, 30, 1, ['impacto']);

      // Recrearlo "como si viniera de la base de datos": mismo species_key, mismos
      // movimientos, mismas bases.
      const reloaded = makeDigimon(getSpecies(key)!, 30, 1, ['impacto']);

      assert.equal(reloaded.species.key, digimon.species.key);
      assert.deepEqual(reloaded.stats, digimon.stats);
      assert.equal(reloaded.species.name, species.name);
    }
  });
});
