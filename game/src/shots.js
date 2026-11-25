// The screenshot scenes behind ?shot=board|counter|assembly|serve. Each one stages the world
// through the real rules deterministically so the same seed always gives the same frame.
import { STEP } from './config.js';
import { SCREEN_PLAY } from './render.js';

export function stageShot(name, world) {
  world.reset();
  world.begin();

  if (name === 'board') {
    for (let index = 0; index < 150; index += 1) {
      world.step(STEP, null);
    }
    return { screen: SCREEN_PLAY, best: 0 };
  }

  if (name === 'counter') {
    for (let index = 0; index < 150; index += 1) {
      world.step(STEP, null);
    }
    if (world.state.orders.length > 0) {
      const order = world.state.orders[0];
      world.state.activeId = order.id;
      world.state.bowl.dishId = order.dishId;
      world.state.bowl.recipe = order.recipe.slice();
      order.state = 'claimed';
    }
    world.state.heat[1] = { comp: 'noodles', t: 1.5, state: 'cooking' };
    world.state.cook.x = 272;
    world.state.money = 18000;
    world.state.clock = 210;
    return { screen: SCREEN_PLAY, best: world.state.money };
  }

  if (name === 'assembly') {
    for (let index = 0; index < 150; index += 1) {
      world.step(STEP, null);
    }
    if (world.state.orders.length > 0) {
      const order = world.state.orders[0];
      world.state.activeId = order.id;
      world.state.bowl.dishId = order.dishId;
      world.state.bowl.recipe = order.recipe.slice();
      if (order.recipe.length >= 2) {
        world.state.bowl.contents = [
          { comp: order.recipe[0], quality: 'perfect', t: 0 },
          { comp: order.recipe[1], quality: 'perfect', t: 0 },
        ];
      }
      world.state.bowl.complete = false;
      order.state = 'assembling';
    }
    world.state.cook.x = 918;
    world.state.money = 24000;
    world.state.clock = 190;
    return { screen: SCREEN_PLAY, best: world.state.money };
  }

  if (name === 'serve') {
    for (let index = 0; index < 150; index += 1) {
      world.step(STEP, null);
    }
    if (world.state.orders.length > 0) {
      const order = world.state.orders[0];
      world.state.activeId = order.id;
      world.state.bowl.dishId = order.dishId;
      world.state.bowl.recipe = order.recipe.slice();
      world.state.bowl.contents = order.recipe.map((comp) => ({ comp, quality: 'perfect', t: 0 }));
      world.state.bowl.complete = true;
      order.state = 'plated';
    }
    world.state.cook.x = 1150;
    world.state.money = 42000;
    world.state.clock = 160;
    return { screen: SCREEN_PLAY, best: world.state.money };
  }

  // Fallback
  for (let index = 0; index < 150; index += 1) {
    world.step(STEP, null);
  }
  return { screen: SCREEN_PLAY, best: 0 };
}
