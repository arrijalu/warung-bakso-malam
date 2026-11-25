// Keyboard and pointer input, normalised into the three things the stall understands: a walking
// direction, a queue of one-shot presses (act, pause, confirm, tray 1-4), and a pointer with its
// button held or not. Held keys are polled; presses are queued so a tap between two frames is
// never lost and never counted twice. Pointer positions are converted to the game's 1280x720
// logical space here, so nothing downstream has to know about the window size.
//
// The mouse is deliberately not a second, separate game: a click on a station issues the same
// "walk there" the arrow keys do, a click on an ingredient issues the same "add it", and holding
// the button over a pot is the same ladle-drag the E key is (see world.js).

export const ACTION_ACT = 1;
export const ACTION_PAUSE = 2;
export const ACTION_CONFIRM = 4;

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const ACT = new Set(['KeyE', 'Space', 'Enter']);
const PAUSE = new Set(['Escape', 'KeyP']);
const DIGITS = new Map([
  ['Digit1', 0],
  ['Digit2', 1],
  ['Digit3', 2],
  ['Digit4', 3],
  ['Numpad1', 0],
  ['Numpad2', 1],
  ['Numpad3', 2],
  ['Numpad4', 3],
]);

/**
 * @param {HTMLCanvasElement} canvas the element the pointer is measured against
 * @param {(clientX: number, clientY: number) => {x: number, y: number}} toField window to logical
 */
export function createInput(canvas, toField) {
  let left = false;
  let right = false;
  let actions = 0;
  let tray = -1;
  const clicks = [];
  const pointer = { x: 640, y: 360, down: false, inside: false };

  window.addEventListener('keydown', (event) => {
    if (event.repeat) {
      if (LEFT.has(event.code) || RIGHT.has(event.code) || ACT.has(event.code) || PAUSE.has(event.code) || DIGITS.has(event.code)) event.preventDefault();
      return;
    }
    if (LEFT.has(event.code)) left = true;
    else if (RIGHT.has(event.code)) right = true;
    else if (ACT.has(event.code)) actions |= ACTION_ACT | ACTION_CONFIRM;
    else if (PAUSE.has(event.code)) actions |= ACTION_PAUSE;
    else if (DIGITS.has(event.code)) tray = DIGITS.get(event.code);
    else return;
    event.preventDefault();
  });

  window.addEventListener('keyup', (event) => {
    if (LEFT.has(event.code)) left = false;
    else if (RIGHT.has(event.code)) right = false;
  });

  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    left = false;
    right = false;
    pointer.down = false;
  });

  function move(event) {
    const point = toField(event.clientX, event.clientY);
    pointer.x = point.x;
    pointer.y = point.y;
    pointer.inside = true;
  }

  canvas.addEventListener('pointerdown', (event) => {
    move(event);
    pointer.down = true;
    actions |= ACTION_CONFIRM;
    if (clicks.length < 4) clicks.push({ x: pointer.x, y: pointer.y });
    if (canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Capture is a nicety; a browser that refuses it still gets the events while over the canvas.
      }
    }
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event) => {
    move(event);
    event.preventDefault();
  });
  window.addEventListener('pointerup', () => {
    pointer.down = false;
  });
  window.addEventListener('pointercancel', () => {
    pointer.down = false;
  });
  canvas.addEventListener('pointerleave', () => {
    pointer.inside = false;
  });

  return {
    /** -1 for left, 1 for right, 0 for neither or both. */
    axis() {
      return (right ? 1 : 0) - (left ? 1 : 0);
    },
    /** The one-shot key presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** The tray digit (0-3) pressed since the last call, or -1. */
    takeTray() {
      const taken = tray;
      tray = -1;
      return taken;
    },
    /** The clicks since the last call, oldest first; the queue is cleared. */
    takeClicks() {
      const taken = clicks.slice();
      clicks.length = 0;
      return taken;
    },
    /** The live pointer: logical position, whether its button is held, whether it is over the page. */
    pointer,
  };
}
