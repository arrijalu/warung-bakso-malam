// Boot and the one loop for Warung Bakso Malam. Input is read every frame, the stall advances in
// fixed 1/60 s steps (several in a slow frame, none in a fast one), and the renderer paints what is
// there. Four screens: title, play, paused and the closing till.
//
// The world owns all the rules and reports what happened as EV_* flags; this file is the only
// place that turns those flags into sound and into the screen the player sees. That split is why
// the game can be screenshot-staged without a browser event ever firing (see shots.js).
//
// ?seed=N fixes the customers and their extras. ?shot=board|counter|assembly|serve (with &seed=N)
// stages that scene instead of running the loop, paints it twice and sets window.__shotReady for
// the headless screenshot pass.
import { BEST_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import {
  createWorld,
  EV_ADD,
  EV_BURN,
  EV_CASH,
  EV_CLAIM,
  EV_END,
  EV_FAIL,
  EV_PULL,
  EV_REFUSE,
  EV_SERVE,
  EV_SIZZLE,
  EV_STEP,
  EV_TICK,
} from './world.js';
import { ACTION_ACT, ACTION_CONFIRM, ACTION_PAUSE, createInput } from './input.js';
import { createRenderer, SCREEN_END, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

// A runtime error must be visible to the smoke test, not only in a console nobody reads while the
// screenshot pass runs: the title is the one place headless Chrome can report it back.
window.onerror = (message) => {
  document.title = `ERR: ${message}`;
};

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);
const audio = createAudio();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best takings then last this visit only.
  }
}

/** The screenshot pass: set the scene through the real rules, then paint it twice and signal. */
function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.best);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas, renderer.toField);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  /** One-shot intent gathered this frame, spent on the first step only so it cannot repeat. */
  let pending = null;

  // Screen readers (and anyone watching the page's text) hear the screen changes and each refusal.
  function announce(message) {
    status.textContent = message;
  }

  /** Turn the world's event flags into the short procedural motifs in audio.js. */
  function sound(events) {
    if (events & EV_SERVE) audio.play('serve');
    else if (events & EV_FAIL) audio.play('fail');
    else if (events & EV_CLAIM) audio.play('claim');
    else if (events & EV_ADD) audio.play('add');
    else if (events & EV_PULL) audio.play('sizzle');
    else if (events & EV_SIZZLE) audio.play('sizzle');
    else if (events & EV_REFUSE) audio.play('step');
    if (events & EV_CASH) audio.play('cash');
    if (events & EV_BURN) audio.play('fail');
    if (events & EV_TICK) audio.play('urgent');
    if (events & EV_STEP) audio.play('step');
  }

  function startShift() {
    world.reset();
    world.begin();
    accumulator = 0;
    pending = null;
    screen = SCREEN_PLAY;
    audio.play('open');
    announce('Warung open. Bring the tickets in off the string.');
  }

  function closeShift() {
    screen = SCREEN_END;
    if (world.state.money > best) {
      best = world.state.money;
      saveBest(best);
    }
    audio.play('close');
    announce(`Warung closed. Takings Rp ${world.state.money}. Best Rp ${best}.`);
  }

  /**
   * Gather this frame's input into the one intent a step consumes. On a display faster than 60 Hz
   * a frame can run no step at all, so a gathered press is kept in `pending` and merged with the
   * next frame's input rather than dropped: the player's tap is never lost between two ticks.
   */
  function takeIntent() {
    const actions = input.takeActions();
    if (actions !== 0) audio.unlock();

    if (screen === SCREEN_TITLE || screen === SCREEN_END) {
      if (actions & (ACTION_CONFIRM | ACTION_ACT)) startShift();
      return;
    }
    if (screen === SCREEN_PAUSED) {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM | ACTION_ACT)) {
        screen = SCREEN_PLAY;
        announce('Playing on.');
      }
      return;
    }
    if (actions & ACTION_PAUSE) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
      return;
    }

    const clicks = input.takeClicks();
    const tray = input.takeTray();
    const act = (actions & ACTION_ACT) !== 0;
    if (pending === null) {
      pending = {
        axis: input.axis(),
        act,
        tray,
        clicks: clicks.length > 0 ? clicks : null,
        pointer: input.pointer,
      };
      return;
    }
    if (input.axis() !== 0) pending.axis = input.axis();
    pending.act = pending.act || act;
    if (tray >= 0) pending.tray = tray;
    if (clicks.length > 0) pending.clicks = (pending.clicks ?? []).concat(clicks);
    pending.pointer = input.pointer;
  }

  function step() {
    const intent = pending;
    pending = null;
    const events = world.step(STEP, intent);
    sound(events);
    if (events & EV_END) {
      closeShift();
      return;
    }
    if (events & EV_CLAIM) {
      const order = world.activeOrder();
      if (order !== null) announce(`Ticket up: ${order.dishId}. ${order.recipe.length} things to make.`);
    }
    if (events & EV_FAIL) announce(`A customer left. ${world.state.walkouts} of 3 gone.`);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;

    const intent = takeIntent();
    if (intent !== null) pending = intent;

    if (screen === SCREEN_PLAY) {
      while (accumulator >= STEP && screen === SCREEN_PLAY) {
        step();
        // A step that did not consume the gathered intent leaves it for the next step in this
        // frame; a step that did is the only one that gets it.
        if (pending !== null) pending = null;
        accumulator -= STEP;
      }
    } else if (screen === SCREEN_TITLE) {
      // The title screen keeps the stall breathing: steam, the bulb, the queue. No clock, no orders.
      while (accumulator >= STEP) {
        world.step(STEP, null);
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }

    renderer.draw(world.state, screen, best);
  }

  // Leaving the tab pauses a running shift rather than letting the pot boil unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  announce('Warung Bakso Malam. Press Space or click to open the stall.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
