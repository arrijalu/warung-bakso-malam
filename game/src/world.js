// The stall's rules and state, with no drawing and no browser in it. The cook, the bowl, the four
// cookers, the three ticket slots and the shift clock all live here; step() advances one fixed step
// and returns what happened as bit flags, so the caller can play a sound or flash a panel without
// the world knowing that screens or speakers exist.
//
// Checklist technique: order-queue state machine. Every ticket is in exactly one of ORDER_STATES,
// and moveOrder() is the only way it changes — it refuses any edge ORDER_TRANSITIONS does not list.
// There is no "ready" or "cooked" boolean anywhere: the ticket's state is the truth, and the
// patience drain, the serve check and the renderer all read it.
//
// Checklist technique: juice. addComponent() starts a tweened pop on the bowl, serve() a burst of
// particles and a cash pop, failOrder() a red flash and a shake, burn() smoke. The shake and flash
// numbers live in the state so the renderer only has to read them.
import {
  COMPONENTS,
  COOK,
  DISHES,
  DISH_IDS,
  EXTRAS,
  FAIL,
  LAYOUT,
  MONEY,
  REACH,
  SHIFT,
  STATIONS,
  STATION_INDEX,
  TRAYS,
} from './config.js';
import { pick, randomInt, shuffle } from './random.js';

/** The seven states a ticket can hold. */
export const ORDER_STATES = {
  WAITING: 'waiting',
  CLAIMED: 'claimed',
  ASSEMBLING: 'assembling',
  COOKING: 'cooking',
  PLATED: 'plated',
  SERVED: 'served',
  FAILED: 'failed',
};

/**
 * The legal edges. A ticket only ever moves forward: it is claimed once, it may flip between
 * assembling and cooking as batches go on and off the heat, and it ends either served or failed.
 */
export const ORDER_TRANSITIONS = {
  waiting: ['claimed', 'failed'],
  claimed: ['assembling', 'cooking', 'failed'],
  assembling: ['cooking', 'plated', 'failed'],
  cooking: ['assembling', 'plated', 'failed'],
  plated: ['served', 'failed'],
  served: [],
  failed: [],
};

export const EV_ADD = 1;
export const EV_CLAIM = 2;
export const EV_SERVE = 4;
export const EV_FAIL = 8;
export const EV_CASH = 16;
export const EV_SIZZLE = 32;
export const EV_STEP = 64;
export const EV_BURN = 128;
export const EV_REFUSE = 256;
export const EV_END = 512;
export const EV_TICK = 1024;
export const EV_PULL = 2048;

/** Which stations are cookers, and what they produce. Garnish and the drink are not timed. */
export const COOKER_OF_STATION = {
  pot: 'meatballs',
  noodle: 'noodles',
  wok: 'chicken',
  fryer: 'gorengan',
};

const MAX_PARTICLES = 220;
const MAX_TOASTS = 4;

/** Where the four bumbu trays sit, bottom right. render.js draws to the same maths. */
export function trayRect(index) {
  const { x, y, w, h, gap } = LAYOUT.trays;
  return { x: x + index * (w + gap), y, w, h };
}

export function createWorld(random) {
  // Two independent streams: one for the customers, so a burst of particles can never change who
  // walks in next, and one for the decoration. A seeded shift then stays the same under any play.
  const orderRandom = random;
  let fxSeed = (randomInt(random, 1 << 20) ^ 0x5f3759df) | 0;
  function fx() {
    fxSeed = (Math.imul(fxSeed, 1664525) + 1013904223) | 0;
    return ((fxSeed >>> 8) & 0xffffff) / 0x1000000;
  }

  const state = {
    /** The shift. */
    clock: SHIFT.seconds,
    money: 0,
    served: 0,
    spawned: 0,
    walkouts: 0,
    burnt: 0,
    bestServe: 0,
    finished: false,
    finishReason: '',
    finishT: 0,
    /** The cook. */
    cook: { x: 640, target: null, stepT: 0, bob: 0 },
    /** The hero bowl on the prep board. `contents` is the layer stack, bottom first. */
    bowl: { dishId: null, recipe: [], contents: [], pops: [], complete: false, vessel: 'bowl' },
    /** The active ticket's id, or -1. */
    activeId: -1,
    /** Every ticket that is still on the string or recently left it. */
    orders: [],
    /** One slot per station: { comp, t, state: 'idle'|'cooking'|'burnt' }. */
    heat: STATIONS.map(() => ({ comp: null, t: 0, state: 'idle' })),
    /** Which bumbu tray is selected (0-3). */
    tray: 0,
    /** Feedback with a short life. */
    toasts: [],
    particles: [],
    pulses: [],
    shake: 0,
    flash: 0,
    flashColor: '#ffffff',
    /** Arrival scheduling and the last-ten-seconds tick. */
    arrivalT: 2.4,
    urgentT: 0,
    pointerActT: 0,
    /** The cook's nearest station, cached for the renderer's highlight. */
    nearStation: 0,
    /** A free-running animation clock, advanced by step(): steam, flames and bubbles read it. */
    animT: 0,
    /** False on the title screen: the stall is drawn but the clock, patience and arrivals wait. */
    live: false,
  };

  let nextOrderId = 1;

  function reset() {
    state.clock = SHIFT.seconds;
    state.money = 0;
    state.served = 0;
    state.spawned = 0;
    state.walkouts = 0;
    state.burnt = 0;
    state.bestServe = 0;
    state.finished = false;
    state.finishReason = '';
    state.finishT = 0;
    state.cook.x = 640;
    state.cook.target = null;
    state.cook.stepT = 0;
    state.cook.bob = 0;
    state.bowl.dishId = null;
    state.bowl.recipe = [];
    state.bowl.contents.length = 0;
    state.bowl.pops.length = 0;
    state.bowl.complete = false;
    state.bowl.vessel = 'bowl';
    state.activeId = -1;
    state.orders.length = 0;
    for (const heat of state.heat) {
      heat.comp = null;
      heat.t = 0;
      heat.state = 'idle';
    }
    state.tray = 0;
    state.toasts.length = 0;
    state.particles.length = 0;
    state.pulses.length = 0;
    state.shake = 0;
    state.flash = 0;
    state.arrivalT = 2.4;
    state.urgentT = 0;
    state.pointerActT = 0;
    state.nearStation = 0;
    state.animT = 0;
    nextOrderId = 1;
  }

  // ---- feedback ------------------------------------------------------------------------

  function toast(text, color) {
    if (state.toasts.length >= MAX_TOASTS) state.toasts.shift();
    state.toasts.push({ text, color: color ?? '#f4e6cb', t: 0, life: 1.6 });
  }

  function burst(x, y, color, count, speed, kind) {
    for (let index = 0; index < count; index += 1) {
      if (state.particles.length >= MAX_PARTICLES) break;
      const angle = fx() * Math.PI * 2;
      const v = speed * (0.35 + fx() * 0.95);
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v - speed * 0.6,
        life: 0,
        max: 0.5 + fx() * 0.6,
        size: 3 + fx() * 6,
        color,
        kind: kind ?? 'dot',
      });
    }
  }

  function pulse(x, y, color) {
    state.pulses.push({ x, y, t: 0, color });
    if (state.pulses.length > 10) state.pulses.shift();
  }

  // ---- tickets -------------------------------------------------------------------------

  function moveOrder(order, next) {
    if (!ORDER_TRANSITIONS[order.state].includes(next)) {
      // A refused edge would be a bug in the game, not in the player: say so in the console.
      console.warn(`ticket ${order.id}: ${order.state} -> ${next} is not a legal transition`);
      return false;
    }
    order.state = next;
    return true;
  }

  /** Build one customer's ticket: a dish, its base, and zero to two extras (or one removal). */
  function makeOrder(id, ojek) {
    const dishId = pick(orderRandom, DISH_IDS);
    const dish = DISHES[dishId];
    let recipe = dish.base.slice();
    const extras = [];
    if (dishId !== 'teh') {
      const roll = orderRandom();
      const wanted = roll < 0.38 ? 0 : roll < 0.76 ? 1 : 2;
      const pool = shuffle(orderRandom, Object.keys(EXTRAS));
      for (let index = 0; index < pool.length && extras.length < wanted; index += 1) {
        const key = pool[index];
        const extra = EXTRAS[key];
        if (extra.remove) {
          if (!recipe.includes(extra.remove)) continue;
          recipe = recipe.filter((comp) => comp !== extra.remove);
        } else {
          if (recipe.includes(extra.comp)) continue;
          recipe.push(extra.comp);
        }
        extras.push(key);
      }
    }
    if (recipe.length === 0) recipe = dish.base.slice();
    const patience = ojek ? SHIFT.ojekPatience : SHIFT.patience;
    return {
      id,
      dishId,
      extras,
      recipe,
      ojek,
      state: ORDER_STATES.WAITING,
      patience,
      maxPatience: patience,
      age: 0,
      slot: -1,
      x: 0,
      quality: 0,
      paid: 0,
      exitT: 0,
      reason: '',
    };
  }

  function isLive(order) {
    return order.state !== ORDER_STATES.SERVED && order.state !== ORDER_STATES.FAILED;
  }

  function liveOrders() {
    let count = 0;
    for (const order of state.orders) if (isLive(order)) count += 1;
    return count;
  }

  function freeSlot() {
    const used = [false, false, false];
    for (const order of state.orders) if (order.slot >= 0 && isLive(order)) used[order.slot] = true;
    for (let index = 0; index < used.length; index += 1) if (!used[index]) return index;
    return -1;
  }

  function spawnOrder() {
    if (state.spawned >= SHIFT.orders) return false;
    const slot = freeSlot();
    if (slot === -1) return false;
    state.spawned += 1;
    const ojek = state.spawned % SHIFT.ojekEvery === 0;
    const order = makeOrder(nextOrderId, ojek);
    nextOrderId += 1;
    order.slot = slot;
    order.x = LAYOUT.slots[slot];
    state.orders.push(order);
    // Keep the live tickets plus the two most recent exits: the array never grows unbounded.
    const dead = state.orders.filter((entry) => !isLive(entry));
    while (dead.length > 2) state.orders.splice(state.orders.indexOf(dead.shift()), 1);
    pulse(order.x + LAYOUT.ticket.w / 2, LAYOUT.ticket.y + 40, '#ffc45c');
    return true;
  }

  function activeOrder() {
    if (state.activeId === -1) return null;
    for (const order of state.orders) if (order.id === state.activeId) return order;
    return null;
  }

  function clearBowl() {
    state.bowl.dishId = null;
    state.bowl.recipe = [];
    state.bowl.contents.length = 0;
    state.bowl.pops.length = 0;
    state.bowl.complete = false;
    state.bowl.vessel = 'bowl';
  }

  function claim(order) {
    if (order === null || state.activeId !== -1) return false;
    if (order.state !== ORDER_STATES.WAITING) return false;
    if (!moveOrder(order, ORDER_STATES.CLAIMED)) return false;
    state.activeId = order.id;
    const dish = DISHES[order.dishId];
    state.bowl.dishId = order.dishId;
    state.bowl.vessel = dish.vessel;
    state.bowl.recipe = order.recipe.slice();
    state.bowl.contents.length = 0;
    state.bowl.pops.length = 0;
    state.bowl.complete = false;
    pulse(order.x + LAYOUT.ticket.w / 2, LAYOUT.ticket.y + 100, '#2f8f99');
    return true;
  }

  /** Claim the ticket that has been waiting longest. This is what E does with nothing active. */
  function claimOldest() {
    let oldest = null;
    for (const order of state.orders) {
      if (order.state !== ORDER_STATES.WAITING) continue;
      if (oldest === null || order.age > oldest.age) oldest = order;
    }
    if (oldest === null) {
      toast('BELUM ADA PESANAN', '#9fb4b8');
      return false;
    }
    return claim(oldest);
  }

  function failOrder(order, reason) {
    if (!isLive(order)) return 0;
    if (!moveOrder(order, ORDER_STATES.FAILED)) return 0;
    order.reason = reason;
    order.exitT = 0;
    if (order.id === state.activeId) {
      state.activeId = -1;
      clearBowl();
    }
    if (reason === 'walkout') {
      state.walkouts += 1;
      toast('PEMBELI KABUR', '#d94b2b');
      burst(order.x + LAYOUT.ticket.w / 2, LAYOUT.ticket.y + 100, '#d94b2b', 18, 250);
    } else {
      toast('GOSONG, PESANAN BATAL', '#d94b2b');
    }
    state.shake = 0.45;
    state.flash = 0.4;
    state.flashColor = '#d94b2b';
    return EV_FAIL;
  }

  // ---- the bowl ------------------------------------------------------------------------

  function componentNeeded(comp) {
    const order = activeOrder();
    if (order === null) return false;
    if (!state.bowl.recipe.includes(comp)) return false;
    return !state.bowl.contents.some((entry) => entry.comp === comp);
  }

  function addComponent(comp, quality) {
    const order = activeOrder();
    if (order === null) return 0;
    if (!componentNeeded(comp)) {
      toast(`${COMPONENTS[comp].name} TIDAK DIPESAN`, '#d94b2b');
      return EV_REFUSE;
    }
    state.bowl.contents.push({ comp, quality, t: 0 });
    state.bowl.pops.push({ comp, t: 0, quality });
    burst(LAYOUT.bowl.cx, LAYOUT.bowl.rimY + 8, quality === 'over' ? '#8a4a26' : '#ffc45c', 12, 160, 'crumb');
    if (order.state === ORDER_STATES.CLAIMED || order.state === ORDER_STATES.COOKING) moveOrder(order, ORDER_STATES.ASSEMBLING);
    if (state.bowl.contents.length >= state.bowl.recipe.length) {
      state.bowl.complete = true;
      if (order.state === ORDER_STATES.ASSEMBLING) moveOrder(order, ORDER_STATES.PLATED);
    }
    return EV_ADD;
  }

  // ---- cookers -------------------------------------------------------------------------

  function startCook(index) {
    const station = STATIONS[index];
    const comp = COOKER_OF_STATION[station.id];
    if (comp === undefined) return 0;
    const heat = state.heat[index];
    if (heat.state !== 'idle') return 0;
    if (!componentNeeded(comp)) {
      toast(`BELUM PERLU ${COMPONENTS[comp].name}`, '#ffc45c');
      return EV_REFUSE;
    }
    const order = activeOrder();
    if (order === null) return 0;
    heat.comp = comp;
    heat.t = 0;
    heat.state = 'cooking';
    if (order.state === ORDER_STATES.CLAIMED || order.state === ORDER_STATES.ASSEMBLING) moveOrder(order, ORDER_STATES.COOKING);
    pulse(station.x, 420, '#f0862a');
    return EV_SIZZLE;
  }

  function pullCook(index) {
    const station = STATIONS[index];
    const heat = state.heat[index];
    if (heat.state !== 'cooking' || heat.comp === null) return 0;
    const spec = COMPONENTS[heat.comp];
    if (heat.t < spec.cook) {
      toast('BELUM MATANG', '#ffc45c');
      return EV_REFUSE;
    }
    const quality = heat.t > spec.cook + spec.window ? 'over' : 'perfect';
    const comp = heat.comp;
    heat.state = 'idle';
    heat.comp = null;
    heat.t = 0;
    let events = addComponent(comp, quality) | EV_PULL;
    if (quality === 'over') {
      toast('KEMATANGAN LEWAT', '#ffc45c');
      state.money = Math.max(0, state.money + MONEY.overcookedPull);
    } else {
      burst(station.x, 410, '#ffc45c', 14, 200);
      state.money += MONEY.perfectPull;
    }
    return events;
  }

  function burn(index) {
    const heat = state.heat[index];
    const station = STATIONS[index];
    heat.state = 'burnt';
    state.burnt += 1;
    burst(station.x, 400, '#08171c', 24, 230, 'smoke');
    burst(station.x, 410, '#542b16', 10, 150);
    state.shake = 0.4;
    state.flash = 0.32;
    state.flashColor = '#d94b2b';
    toast('GOSONG! TEKAN E UNTUK BUANG', '#d94b2b');
    const order = activeOrder();
    if (order !== null && order.state === ORDER_STATES.COOKING) moveOrder(order, ORDER_STATES.ASSEMBLING);
    return EV_BURN | EV_FAIL;
  }

  function clearBurnt(index) {
    const heat = state.heat[index];
    if (heat.state !== 'burnt') return 0;
    heat.state = 'idle';
    heat.comp = null;
    heat.t = 0;
    toast('DIBUANG', '#9fb4b8');
    return EV_SIZZLE;
  }

  // ---- serving -------------------------------------------------------------------------

  function missingComponents() {
    const missing = [];
    for (const comp of state.bowl.recipe) {
      if (!state.bowl.contents.some((entry) => entry.comp === comp)) missing.push(comp);
    }
    return missing;
  }

  function serve() {
    const order = activeOrder();
    if (order === null) {
      toast('TIDAK ADA PESANAN AKTIF', '#9fb4b8');
      return EV_REFUSE;
    }
    if (!state.bowl.complete) {
      const names = missingComponents().map((comp) => COMPONENTS[comp].name).join(', ');
      toast(`KURANG: ${names}`, '#d94b2b');
      return EV_REFUSE;
    }
    const dish = DISHES[order.dishId];
    let perfect = 0;
    for (const entry of state.bowl.contents) if (entry.quality === 'perfect') perfect += 1;
    const ratio = state.bowl.contents.length === 0 ? 0 : perfect / state.bowl.contents.length;
    let extrasValue = 0;
    for (const key of order.extras) extrasValue += EXTRAS[key].price;
    let total = dish.price + extrasValue + Math.round(ratio * 3000);
    const patienceLeft = order.patience / order.maxPatience;
    let tipRate = 0;
    if (patienceLeft >= MONEY.fastAt) tipRate = MONEY.fastTip;
    else if (patienceLeft >= MONEY.slowAt) tipRate = MONEY.slowTip;
    total += Math.round(total * tipRate);
    if (order.ojek) total *= 2;
    order.paid = total;
    order.quality = ratio;
    state.money += total;
    state.served += 1;
    state.bestServe = Math.max(state.bestServe, total);
    moveOrder(order, ORDER_STATES.PLATED);
    moveOrder(order, ORDER_STATES.SERVED);
    order.exitT = 0;
    state.activeId = -1;
    const cx = LAYOUT.bowl.cx;
    const cy = LAYOUT.bowl.rimY + 24;
    burst(cx, cy, '#ffc45c', 26, 320);
    burst(cx, cy, '#2f8f99', 18, 240);
    burst(cx, cy, '#fff8e8', 12, 190);
    pulse(cx, cy, '#ffc45c');
    clearBowl();
    toast(`+ Rp ${total.toLocaleString('id-ID')}`, '#6fc46f');
    return EV_SERVE | EV_CASH;
  }

  // ---- the shift -----------------------------------------------------------------------

  /** The station nearest a logical x, whatever the distance: clicks use it to walk there. */
  function nearestStation(x) {
    let best = 0;
    let bestDist = Infinity;
    for (let index = 0; index < STATIONS.length; index += 1) {
      const dist = Math.abs(STATIONS[index].x - x);
      if (dist < bestDist) {
        bestDist = dist;
        best = index;
      }
    }
    return best;
  }

  /** True when the cook stands close enough to work that station. */
  function inReach(index) {
    return Math.abs(STATIONS[index].x - state.cook.x) <= REACH;
  }

  /** One press of act, resolved by where the cook stands. Returns event flags. */
  function act() {
    if (state.finished) return 0;
    if (state.activeId === -1) return claimOldest() ? EV_CLAIM : EV_REFUSE;
    const index = nearestStation(state.cook.x);
    if (!inReach(index)) {
      state.cook.target = STATIONS[index].x;
      return EV_REFUSE;
    }
    const station = STATIONS[index];
    if (station.id === 'serve') return serve();
    if (station.id === 'garnish') {
      const comp = TRAYS[state.tray];
      return componentNeeded(comp) ? addComponent(comp, 'perfect') : refuseComp(comp);
    }
    if (station.id === 'drink') {
      if (!componentNeeded('tea')) {
        toast('BUKAN PESANAN TEH', '#d94b2b');
        return EV_REFUSE;
      }
      burst(station.x, 400, '#f0862a', 12, 160, 'splash');
      return addComponent('tea', 'perfect');
    }
    const heat = state.heat[index];
    if (heat.state === 'idle') return startCook(index);
    if (heat.state === 'burnt') return clearBurnt(index);
    return pullCook(index);
  }

  function refuseComp(comp) {
    toast(`${COMPONENTS[comp].name} TIDAK DIPESAN`, '#d94b2b');
    return EV_REFUSE;
  }

  function finish(reason) {
    if (state.finished) return 0;
    state.finished = true;
    state.finishReason = reason;
    state.finishT = 0;
    state.activeId = -1;
    return EV_END;
  }

  /** Add the tray the cook has selected, if they are at the bumbu station. Returns event flags. */
  function addTray(tray) {
    state.tray = tray;
    const comp = TRAYS[tray];
    if (state.activeId === -1 || !componentNeeded(comp)) {
      if (state.activeId !== -1) return refuseComp(comp);
      return 0;
    }
    if (!inReach(STATION_INDEX.garnish)) {
      state.cook.target = STATIONS[STATION_INDEX.garnish].x;
      return EV_REFUSE;
    }
    return addComponent(comp, 'perfect');
  }

  const NO_INTENT = { axis: 0, act: false, tray: -1, clicks: null, pointer: null };

  function step(dt, intent) {
    const input = intent ?? NO_INTENT;
    let events = 0;
    state.animT += dt;

    // Mouse: a click on a ticket claims it, on a tray picks it, on a station walks there (and acts
    // at once if already close); a held button over the counter is the ladle drag.
    if (input.tray >= 0) events |= addTray(input.tray);
    if (input.clicks !== null) {
      for (const click of input.clicks) {
        const ticket = ticketAt(click.x, click.y);
        if (ticket !== null) {
          if (ticket.state === ORDER_STATES.WAITING) events |= claim(ticket) ? EV_CLAIM : 0;
          else if (ticket.state === ORDER_STATES.PLATED) events |= serve();
          continue;
        }
        const tray = trayAt(click.x, click.y);
        if (tray >= 0) {
          events |= addTray(tray);
          continue;
        }
        if (click.y >= 280) {
          const station = nearestStation(click.x);
          state.cook.target = STATIONS[station].x;
          if (inReach(station)) events |= act();
        }
      }
    }

    if (input.act) events |= act();

    if (input.pointer !== null && input.pointer.down && input.pointer.inside && input.pointer.y > 280) {
      state.pointerActT -= dt;
      if (state.pointerActT <= 0) {
        state.pointerActT = 0.3;
        const station = nearestStation(input.pointer.x);
        if (inReach(station)) events |= act();
      }
    } else {
      state.pointerActT = 0;
    }

    // Walk: a click target pulls the cook, a held key overrides it and cancels it.
    let moving = false;
    if (input.axis !== 0) {
      state.cook.target = null;
      state.cook.x += input.axis * COOK.speed * dt;
      moving = true;
    } else if (state.cook.target !== null) {
      const delta = state.cook.target - state.cook.x;
      if (Math.abs(delta) < 6) state.cook.target = null;
      else {
        state.cook.x += Math.sign(delta) * COOK.speed * dt;
        moving = true;
      }
    }
    state.cook.x = Math.min(COOK.maxX, Math.max(COOK.minX, state.cook.x));
    state.cook.bob = moving ? state.cook.bob + dt * 12 : 0;
    if (moving) {
      state.cook.stepT -= dt;
      if (state.cook.stepT <= 0) {
        state.cook.stepT = 0.28;
        events |= EV_STEP;
      }
    }
    state.nearStation = nearestStation(state.cook.x);

    // The shift clock.
    if (state.live && !state.finished) {
      state.clock -= dt;
      if (state.clock <= 10 && state.clock > 0) {
        state.urgentT -= dt;
        if (state.urgentT <= 0) {
          state.urgentT = 1;
          events |= EV_TICK;
        }
      }
      if (state.clock <= 0) {
        state.clock = 0;
        events |= finish('closed');
      }
    }

    // Cookers: each one runs its own timer up to its burn point.
    for (let index = 0; index < state.heat.length; index += 1) {
      const heat = state.heat[index];
      if (heat.state !== 'cooking') continue;
      heat.t += dt;
      if (heat.t >= COMPONENTS[heat.comp].burn) events |= burn(index);
    }

    // Tickets: patience, exits, arrivals.
    for (const order of state.orders) {
      if (isLive(order) && state.live) {
        order.age += dt;
        order.patience -= dt;
        if (order.patience <= 0) {
          order.patience = 0;
          events |= failOrder(order, 'walkout');
        }
      }
      if (!isLive(order)) order.exitT += dt;
    }

    if (state.live && !state.finished) {
      if (state.walkouts >= FAIL.walkouts) events |= finish('walkouts');
      else if (state.burnt >= FAIL.burnt) events |= finish('burnt');
      else if (state.spawned < SHIFT.orders) {
        state.arrivalT -= dt;
        if (state.arrivalT <= 0 && liveOrders() < SHIFT.maxTickets) {
          spawnOrder();
          state.arrivalT = SHIFT.arrival;
        }
      } else if (liveOrders() === 0) {
        events |= finish('complete');
      }
    }

    // Feedback decay.
    for (let index = state.particles.length - 1; index >= 0; index -= 1) {
      const p = state.particles[index];
      p.life += dt;
      if (p.life >= p.max) {
        state.particles.splice(index, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.kind === 'smoke' ? -80 : 640) * dt;
      p.vx *= 0.985;
    }
    for (let index = state.pulses.length - 1; index >= 0; index -= 1) {
      state.pulses[index].t += dt;
      if (state.pulses[index].t > 0.75) state.pulses.splice(index, 1);
    }
    for (let index = state.toasts.length - 1; index >= 0; index -= 1) {
      state.toasts[index].t += dt;
      if (state.toasts[index].t >= state.toasts[index].life) state.toasts.splice(index, 1);
    }
    for (const entry of state.bowl.contents) entry.t += dt;
    for (const pop of state.bowl.pops) pop.t += dt;
    for (let index = state.bowl.pops.length - 1; index >= 0; index -= 1) if (state.bowl.pops[index].t > 0.6) state.bowl.pops.splice(index, 1);
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt);
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 2.4);
    if (state.finished) state.finishT += dt;

    return events;
  }

  function ticketAt(x, y) {
    if (y < LAYOUT.ticket.y - 24 || y > LAYOUT.ticket.y + LAYOUT.ticket.h + 24) return null;
    for (const order of state.orders) {
      if (!isLive(order)) continue;
      if (x >= order.x - 6 && x <= order.x + LAYOUT.ticket.w + 6) return order;
    }
    return null;
  }

  function trayAt(x, y) {
    for (let index = 0; index < 4; index += 1) {
      const rect = trayRect(index);
      if (x >= rect.x - 4 && x <= rect.x + rect.w + 4 && y >= rect.y - 8 && y <= rect.y + rect.h + 8) return index;
    }
    return -1;
  }

  function stationNameAt(x) {
    return STATIONS[nearestStation(x)].name;
  }

  reset();
  return {
    state,
    reset,
    step,
    ticketAt,
    trayAt,
    stationNameAt,
    nearestStation,
    inReach,
    componentNeeded,
    missingComponents,
    activeOrder,
    liveOrders,
    /** Open the stall without going through the title screen (the screenshot scenes use this). */
    begin() {
      state.live = true;
    },
  };
}
