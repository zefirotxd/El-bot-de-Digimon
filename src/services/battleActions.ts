import type { BattleState } from '../game/combat.js';
import {
  itemOf,
  moveOf,
  requestSwitch,
  submitAction,
  type ActionResult,
} from './battleFlow.js';
import { register } from '../ui/screen.js';

/**
 * Acciones de combate.
 *
 * Cada botón es un CASO, y todos acaban igual: `submitAction`, que es donde vive
 * la comprobación de que el turno no está ya resuelto.
 *
 * Aquí no hay ni una regla de combate. Un botón que sabe si puede atacar es un
 * botón que algún día se equivoca; uno que solo pide la acción y deja que el
 * servicio decida, no puede.
 */
register('bat_usar', async (ctx) => {
  const state = ctx.session.battle;
  const move = state ? moveOf(state, ctx.params.k ?? '') : null;

  if (!state || !move) {
    ctx.flash('Ese movimiento no está disponible.', 'error');
    return ctx.go('batalla');
  }

  const resultado = submitAction(state, { type: 'movimiento', move }, ctx.num('turno', state.turn));

  if (!resultado.ok) {
    ctx.flash(resultado.message, 'aviso');
    return ctx.refresh('batalla');
  }

  if (resultado.finished) return ctx.go('batalla_fin');
  return ctx.refresh('batalla');
});

register('bat_defender', async (ctx) => {
  const state = ctx.session.battle;
  if (!state) return ctx.go('combate');

  const resultado = submitAction(state, { type: 'defender' }, ctx.num('turno', state.turn));

  if (!resultado.ok) {
    ctx.flash(resultado.message, 'aviso');
    return ctx.refresh('batalla');
  }

  if (resultado.finished) return ctx.go('batalla_fin');
  return ctx.refresh('batalla');
});

register('bat_usar_item', async (ctx) => {
  const state = ctx.session.battle;
  const item = state ? itemOf(state, ctx.params.k ?? '') : null;

  if (!state || !item) {
    ctx.flash('No tienes ese objeto.', 'error');
    return ctx.go('batalla');
  }

  const resultado = submitAction(state, { type: 'objeto', item }, ctx.num('turno', state.turn));

  if (!resultado.ok) {
    ctx.flash(resultado.message, 'aviso');
    return ctx.refresh('batalla');
  }

  if (resultado.finished) return ctx.go('batalla_fin');
  return ctx.refresh('batalla');
});

register('bat_capturar', async (ctx) => {
  const state = ctx.session.battle;
  if (!state) return ctx.go('combate');

  const resultado = submitAction(state, { type: 'capturar' }, ctx.num('turno', state.turn));

  if (!resultado.ok) {
    ctx.flash(resultado.message, 'aviso');
    return ctx.refresh('batalla');
  }

  if (resultado.finished) return ctx.go('batalla_fin');
  return ctx.refresh('batalla');
});

register('bat_huir', async (ctx) => {
  const state = ctx.session.battle;
  if (!state) return ctx.go('combate');

  // La huida la decide el motor: contra un jefe no se puede.
  const resultado = submitAction(state, { type: 'huir', success: !state.isBoss }, ctx.num('turno', state.turn));

  if (!resultado.ok) {
    ctx.flash(resultado.message, 'aviso');
    return ctx.refresh('batalla');
  }

  if (!resultado.finished) {
    ctx.flash('No has podido huir.', 'aviso');
    return ctx.refresh('batalla');
  }

  return ctx.go('batalla_fin');
});

/**
 * Cambio de Digimon.
 *
 * No pasa por `submitAction` porque NO es una acción de turno: se permite
 * incluso con `awaitingSwitch`, que es justo el estado en el que solo se puede
 * hacer esto. La validación de "¿está en pie?" la hace `switchTo` del motor,
 * no esta capa, aunque la interfaz ya haya filtrado los caídos.
 */
register('bat_cambiar_a', async (ctx) => {
  const state = ctx.session.battle;
  if (!state) return ctx.go('combate');

  const resultado = requestSwitch(state, ctx.num('id', 0));

  if (!resultado.switched) {
    ctx.flash(resultado.message, 'aviso');
    return ctx.refresh('bat_cambiar');
  }

  ctx.flash(`⚡ **${state.player.name}** entra al campo.`, 'ok');

  // Tras cambiar, el turno sigue sin jugarse: no se ha gastado nada.
  return ctx.refresh('batalla');
});
