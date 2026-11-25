// Drawing only: the world's state and the current screen in, pixels out. The 1280x720 playfield is
// scaled to fit the window and centred, the margin filled with the night colour. Everything is
// drawn with canvas paths — rectangles, ellipses, arcs and text — because the game ships no image
// file at all.
//
// Checklist technique: canvas layered-sprite rendering. drawVessel() is a data-driven sprite: it
// takes the bowl's contents (a list of component ids), sorts them by LAYER_ORDER from config.js and
// paints one ordered layer per id — base, contents, garnish, highlight. Assembly state is literally
// the layer stack; there is no per-dish drawing code, so a new ingredient needs no renderer change.
//
// Checklist technique: juice. The renderer reads the world's particle, pulse, shake and flash
// numbers and turns them into sparks, rings, a lurching stall and a colour wash. It also plays the
// tweened pop that addComponent() starts, scaling each newly added layer up and back down.
//
// Legibility rules kept throughout: the ticket paper (#fff8e8) and the bowl are the brightest
// things on screen, every text label is at least 20px at 1280x720, and the palette is the eight
// base colours plus small accents from config.js.
import {
  COMPONENTS,
  DISHES,
  EXTRAS,
  FAIL,
  FONT,
  LAYOUT,
  LAYER_ORDER,
  PALETTE,
  SHIFT,
  STATIONS,
  TRAYS,
} from './config.js';
import { ORDER_STATES, trayRect } from './world.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_END = 'end';

const C = PALETTE;
const W = 1280;
const H = 720;
const COUNTER = LAYOUT.counterTop;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(window.innerWidth * ratio));
    const height = Math.max(1, Math.round(window.innerHeight * ratio));
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / W, height / H);
    view.x = (width - W * view.scale) / 2;
    view.y = (height - H * view.scale) / 2;
  }

  // ---- primitives -------------------------------------------------------------------------

  const fontCache = new Map();
  function label(text, x, y, size, color, align, weight) {
    const key = `${weight ?? 600}|${size}`;
    if (!fontCache.has(key)) fontCache.set(key, `${weight ?? 600} ${size}px ${FONT}`);
    ctx.font = fontCache.get(key);
    ctx.fillStyle = color;
    ctx.textAlign = align ?? 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, x, y);
  }

  function rect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  function roundRect(x, y, w, h, r, color, stroke, strokeWidth) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
    if (color !== null) {
      ctx.fillStyle = color;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth ?? 2;
      ctx.stroke();
    }
  }

  function circle(x, y, r, color) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function ellipse(x, y, rx, ry, color) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  /** A soft radial glow, used for the bulb and the warm pool it throws on the stall. */
  function glow(x, y, radius, color, strength) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, radius));
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = strength;
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.globalAlpha = 1;
  }

  // ---- the stall --------------------------------------------------------------------------

  /** Night sky, the tarp overhead, the hanging bulb: the frame and its warm centre. */
  function drawNight(state) {
    const sky = ctx.createLinearGradient(0, 0, 0, COUNTER);
    sky.addColorStop(0, '#04141a');
    sky.addColorStop(0.55, C.wall);
    sky.addColorStop(1, '#12505c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, COUNTER);

    // Far-off windows across the street, so the night is a city and not a void.
    ctx.globalAlpha = 0.42;
    for (let index = 0; index < 11; index += 1) {
      const x = 20 + ((index * 176) % 1160);
      const y = 168 + ((index * 53) % 96);
      rect(x, y, 22, 28, index % 3 === 0 ? C.amber : C.tealLite);
    }
    ctx.globalAlpha = 1;

    // The tarp roof: a scalloped hem along the top, in the warung's teal.
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, 0);
    ctx.lineTo(W, 48);
    for (let x = W; x > 0; x -= 80) ctx.quadraticCurveTo(x - 40, 92, x - 80, 48);
    ctx.closePath();
    ctx.fillStyle = C.tarp;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 52);
    for (let x = 0; x < W; x += 80) ctx.quadraticCurveTo(x + 40, 96, x + 80, 52);
    ctx.strokeStyle = 'rgba(6,26,33,0.5)';
    ctx.lineWidth = 4;
    ctx.stroke();

    // The bulb: cord, shade, glass, and the cone of light it throws.
    glow(640, 62, 320, 'rgba(255,196,92,0.55)', 0.9);
    rect(637, 14, 6, 22, C.ink);
    ctx.beginPath();
    ctx.moveTo(602, 46);
    ctx.quadraticCurveTo(640, 26, 678, 46);
    ctx.closePath();
    ctx.fillStyle = C.woodDark;
    ctx.fill();
    circle(640, 62, 20, C.amber);
    circle(640, 57, 11, C.paper);

    // The warm pool it throws down over the counter.
    glow(640, 330, 460, 'rgba(255,196,92,0.18)', 1);
  }

  /** The back wall: bamboo battens, the glass cabinet and a shelf of stacked bowls. */
  function drawWall(state) {
    rect(0, 172, W, COUNTER - 172, 'rgba(14,55,66,0.5)');
    ctx.globalAlpha = 0.16;
    for (let x = 0; x < W; x += 34) rect(x, 172, 3, COUNTER - 172, C.tealLite);
    ctx.globalAlpha = 1;

    // The glass cabinet, with bottles and a warm strip light inside.
    const cab = { x: 248, y: 250, w: 86, h: 190 };
    rect(cab.x, cab.y, cab.w, cab.h, 'rgba(159,180,184,0.16)');
    rect(cab.x + 6, cab.y + 8, cab.w - 12, 5, C.amber);
    for (let index = 0; index < 4; index += 1) {
      circle(cab.x + 18 + index * 17, cab.y + 96, 8, index % 2 ? C.orange : C.green);
      rect(cab.x + 14 + index * 17, cab.y + 104, 8, 30, index % 2 ? C.wood : C.cream);
    }
    rect(cab.x, cab.y + cab.h - 9, cab.w, 9, C.woodDark);
    roundRect(cab.x, cab.y, cab.w, cab.h, 4, null, C.steel, 3);

    // A stack of bowls ready to be filled, on a shelf behind the board.
    for (let index = 0; index < 5; index += 1) {
      ellipse(894, 452 - index * 11, 34 - index * 1.5, 8, index === 4 ? C.cream : C.paper);
    }
    rect(854, 452, 80, 9, C.woodDark);

    // Plastic stools stacked at the kerb, on the far left of the wall.
    for (let index = 0; index < 3; index += 1) {
      const sx = 40 + index * 4;
      const sy = 452 - index * 16;
      ellipse(sx + 46, sy, 44, 12, index % 2 ? C.red : C.paper);
      ellipse(sx + 46, sy - 3, 30, 8, 'rgba(0,0,0,0.12)');
    }
  }

  /** The counter's surface, from the back edge down off the bottom of the frame. */
  function drawCounterSurface() {
    const grad = ctx.createLinearGradient(0, COUNTER, 0, H);
    grad.addColorStop(0, '#155762');
    grad.addColorStop(1, '#0d3d47');
    ctx.fillStyle = grad;
    ctx.fillRect(0, COUNTER, W, H - COUNTER);
    // The warm rim along the back edge, and the plank joints running toward the viewer.
    rect(0, COUNTER, W, 9, 'rgba(255,196,92,0.5)');
    ctx.globalAlpha = 0.22;
    for (let x = 60; x < W; x += 132) rect(x, COUNTER + 9, 3, H - COUNTER);
    ctx.globalAlpha = 1;
    rect(0, H - 4, W, 4, C.ink);
  }

  // ---- tickets ----------------------------------------------------------------------------

  function patienceColor(ratio) {
    if (ratio > 0.5) return C.green;
    if (ratio > 0.25) return C.amber;
    return C.red;
  }

  /** One customer's head and shoulders. The ojek driver wears a red helmet. */
  function drawCustomer(x, y, ojek, tone) {
    if (ojek) {
      ctx.beginPath();
      ctx.arc(x, y - 1, 20, Math.PI, Math.PI * 2);
      ctx.fillStyle = C.red;
      ctx.fill();
      rect(x - 21, y - 3, 42, 6, C.red);
      circle(x, y + 6, 15, C.ink);
      circle(x - 7, y + 7, 4, C.cream);
    } else {
      circle(x, y, 17, tone);
      circle(x - 6, y - 1, 2.6, C.ink);
      circle(x + 6, y - 1, 2.6, C.ink);
      ctx.beginPath();
      ctx.arc(x, y + 5, 7, 0.2, Math.PI - 0.2);
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x - 22, y + 28);
    ctx.quadraticCurveTo(x, y + 13, x + 22, y + 28);
    ctx.lineTo(x + 22, y + 31);
    ctx.lineTo(x - 22, y + 31);
    ctx.closePath();
    ctx.fillStyle = ojek ? '#2b5560' : tone;
    ctx.fill();
  }

  function drawTickets(state) {
    const { y, w, h } = LAYOUT.ticket;

    // The string the tickets hang from, with a little sag.
    ctx.beginPath();
    ctx.moveTo(LAYOUT.string.x0, LAYOUT.string.y);
    ctx.quadraticCurveTo(820, LAYOUT.string.y + 18, LAYOUT.string.x1, LAYOUT.string.y - 2);
    ctx.strokeStyle = C.cream;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.globalAlpha = 1;

    for (const order of state.orders) {
      const alive = order.state !== ORDER_STATES.SERVED && order.state !== ORDER_STATES.FAILED;
      const isActive = order.id === state.activeId;
      const drop = alive ? 0 : Math.min(1, order.exitT / 0.5) * 24;
      const x = order.x;
      const top = y + drop;

      circle(x + w / 2, y + 2, 6, C.steel);

      let tint = C.paper;
      if (order.state === ORDER_STATES.SERVED) tint = '#c8e6b4';
      else if (order.state === ORDER_STATES.FAILED) tint = '#c98d80';
      else if (order.state === ORDER_STATES.PLATED) tint = '#dcf4c8';

      ctx.globalAlpha = alive ? 1 : 0.6;
      roundRect(x, top, w, h, 10, tint, isActive ? C.orange : 'rgba(0,0,0,0.35)', isActive ? 5 : 2);

      // The header band: the dish name, the largest text on the board.
      const head = order.state === ORDER_STATES.FAILED ? '#8f3a25' : C.orange;
      roundRect(x + 8, top + 8, w - 16, 46, 8, head);
      label(DISHES[order.dishId].name, x + 18, top + 42, 29, C.paper, 'left', 800);
      drawCustomer(x + w - 34, top + 27, order.ojek, C.amber);

      // The extras, exactly what the cook has to hit.
      let lineY = top + 80;
      for (let index = 0; index < order.extras.length && index < 2; index += 1) {
        const extra = EXTRAS[order.extras[index]];
        label(`${extra.remove ? '−' : '+'} ${extra.name}`, x + 18, lineY, 21, extra.remove ? C.red : C.ink, 'left', 700);
        lineY += 23;
      }
      if (order.extras.length === 0) label('TANPA TAMBAHAN', x + 18, lineY, 20, 'rgba(8,23,28,0.5)', 'left', 600);

      if (order.ojek) {
        roundRect(x + w - 100, top + 58, 84, 24, 5, C.red);
        label('OJOK x2', x + w - 58, top + 76, 20, C.paper, 'center', 800);
      }

      // The money and the state chip along the bottom.
      label(`Rp ${(order.paid || DISHES[order.dishId].price).toLocaleString('id-ID')}`, x + w - 16, top + h - 38, 21, C.ink, 'right', 800);

      let chip = 'MENUNGGU';
      let chipColor = C.tealLite;
      if (order.state === ORDER_STATES.SERVED) {
        chip = 'SELESAI';
        chipColor = '#3f7a3f';
      } else if (order.state === ORDER_STATES.FAILED) {
        chip = order.reason === 'walkout' ? 'KABUR' : 'BATAL';
        chipColor = C.red;
      } else if (order.state === ORDER_STATES.PLATED) {
        chip = 'SIAP!';
        chipColor = '#2f7a3a';
      } else if (isActive) {
        chip = 'DIKERJAKAN';
        chipColor = C.wood;
      }
      const chipW = chip.length > 7 ? 118 : 100;
      roundRect(x + 14, top + h - 54, chipW, 26, 5, chipColor);
      label(chip, x + 14 + chipW / 2, top + h - 35, 20, C.paper, 'center', 800);

      // The patience bar: green, amber, red, and always present while the ticket is alive.
      const barX = x + 14;
      const barW = w - 28;
      const barY = top + h - 18;
      rect(barX, barY, barW, 10, 'rgba(8,23,28,0.2)');
      const ratio = Math.max(0, order.patience / order.maxPatience);
      rect(barX, barY, barW * ratio, 10, patienceColor(ratio));

      // A ready ticket is the brightest thing on the board: pulse its outline.
      if (order.state === ORDER_STATES.PLATED) {
        ctx.globalAlpha = 0.4 + 0.4 * Math.sin(state.animT * 9);
        roundRect(x - 4, top - 4, w + 8, h + 8, 13, null, C.green, 4);
        ctx.globalAlpha = 1;
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---- stations ---------------------------------------------------------------------------

  function steam(x, y, t, strength, color) {
    ctx.globalAlpha = strength;
    for (let index = 0; index < 3; index += 1) {
      const phase = t * 1.1 + index * 1.7;
      const rise = (phase % 1) * 46;
      const drift = Math.sin(phase * 2.3) * 10;
      circle(x + drift, y - rise, 8 + rise * 0.22, color);
    }
    ctx.globalAlpha = 1;
  }

  function drawPot(station, heat, t, x, y) {
    const w = 146;
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + 6, y);
    ctx.lineTo(x + w / 2 - 6, y);
    ctx.lineTo(x + w / 2, y - 74);
    ctx.lineTo(x - w / 2, y - 74);
    ctx.closePath();
    ctx.fillStyle = C.steel;
    ctx.fill();
    rect(x - w / 2, y - 86, w, 16, '#c9d7d9');
    ellipse(x, y - 74, w / 2 - 6, 12, '#2e6b5a');
    for (let index = 0; index < 8; index += 1) {
      const bx = x - 52 + (index % 4) * 34 + (heat.state === 'cooking' ? Math.sin(t * 2 + index) * 3 : 0);
      const by = y - 80 + Math.floor(index / 4) * 14 + Math.cos(t * 1.7 + index) * 2;
      circle(bx, by, 11, C.cream);
      circle(bx - 3, by - 3, 4, 'rgba(255,255,255,0.5)');
    }
    ctx.beginPath();
    ctx.ellipse(x, y - 74, w / 2 - 6, 12, 0, Math.PI, Math.PI * 2);
    ctx.strokeStyle = '#dbe7e8';
    ctx.lineWidth = 4;
    ctx.stroke();
    if (heat.state === 'cooking') {
      for (let index = 0; index < 4; index += 1) {
        const phase = (t * 1.6 + index * 0.7) % 1;
        circle(x - 36 + index * 24, y - 78 - phase * 22, 4 + phase * 5, 'rgba(255,255,255,0.5)');
      }
    }
    steam(x, y - 92, t, 0.45, 'rgba(244,230,203,0.45)');
  }

  function drawNoodlePot(station, heat, t, x, y) {
    const w = 110;
    rect(x - w / 2, y - 58, w, 58, '#b8c8ca');
    rect(x - w / 2, y - 64, w, 10, '#d5e0e1');
    ellipse(x, y - 58, w / 2 - 4, 9, '#3d7f6c');
    for (let index = 0; index < 7; index += 1) {
      const nx = x - 33 + (index % 4) * 22;
      const ny = y - 60 + Math.floor(index / 4) * 9;
      ctx.beginPath();
      ctx.ellipse(nx, ny, 14, 6, 0, 0, Math.PI * 2);
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x - 26, y - 62);
    ctx.quadraticCurveTo(x, y - 122, x + 26, y - 62);
    ctx.strokeStyle = '#cfd9da';
    ctx.lineWidth = 5;
    ctx.stroke();
    steam(x, y - 84, t, 0.4, 'rgba(244,230,203,0.4)');
  }

  function drawWok(station, heat, t, x, y) {
    rect(x - 46, y - 16, 92, 16, '#40484a');
    ellipse(x, y - 16, 46, 10, C.orange);
    ctx.beginPath();
    ctx.ellipse(x, y - 44, 74, 38, 0, 0, Math.PI * 2);
    ctx.fillStyle = C.ink;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, y - 48, 66, 30, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#2a2f31';
    ctx.fill();
    for (let index = 0; index < 6; index += 1) {
      const cx = x - 40 + (index % 3) * 40;
      const cy = y - 56 + Math.floor(index / 3) * 16;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 15, 10, 0.3, 0, Math.PI * 2);
      ctx.fillStyle = '#c67a3c';
      ctx.fill();
    }
    if (heat.state === 'cooking') {
      for (let index = 0; index < 3; index += 1) {
        const flame = 10 + Math.sin(t * 12 + index * 2) * 6;
        ctx.beginPath();
        ctx.moveTo(x - 30 + index * 30, y - 6);
        ctx.quadraticCurveTo(x - 24 + index * 30, y - 6 - flame - 12, x - 16 + index * 30, y - 6);
        ctx.fillStyle = index % 2 ? C.orange : C.amber;
        ctx.fill();
      }
    }
    steam(x, y - 82, t, 0.35, 'rgba(244,230,203,0.35)');
  }

  function drawFryer(station, heat, t, x, y) {
    const w = 154;
    rect(x - w / 2, y - 54, w, 54, '#6d7a7c');
    rect(x - w / 2 + 6, y - 54, w - 12, 12, C.amber);
    ellipse(x, y - 40, w / 2 - 10, 21, '#c98a2a');
    const burnt = heat.state === 'burnt';
    const pieces = [[-46, -44], [-14, -36], [20, -46], [48, -34], [-30, -28], [8, -26]];
    for (let index = 0; index < pieces.length; index += 1) {
      const px = x + pieces[index][0];
      const py = y + pieces[index][1] + (heat.state === 'cooking' ? Math.sin(t * 5 + index) * 2 : 0);
      ctx.beginPath();
      ctx.ellipse(px, py, 16, 11, index * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = burnt ? '#1c1c1c' : index % 2 ? C.amber : '#e2a13d';
      ctx.fill();
    }
    if (heat.state === 'cooking') {
      for (let index = 0; index < 6; index += 1) {
        const phase = (t * 1.9 + index * 0.4) % 1;
        circle(x - 50 + index * 20, y - 42 - phase * 12, 3 + phase * 4, 'rgba(255,248,232,0.7)');
      }
    }
    steam(x, y - 58, t * (burnt ? 0.7 : 1), burnt ? 0.85 : 0.3, burnt ? 'rgba(8,23,28,0.75)' : 'rgba(255,248,232,0.35)');
  }

  function drawDrink(station, heat, t, x, y) {
    roundRect(x - 40, y - 116, 78, 110, 8, 'rgba(255,248,232,0.22)', C.steel, 3);
    roundRect(x - 34, y - 100, 66, 88, 6, C.orange);
    rect(x - 34, y - 107, 66, 10, C.cream);
    for (let index = 0; index < 5; index += 1) {
      const iceY = y - 94 + index * 17 + Math.sin(t + index) * 2;
      roundRect(x - 26 + (index % 2) * 26, iceY, 20, 15, 4, 'rgba(255,255,255,0.72)');
    }
    rect(x - 4, y - 14, 8, 14, C.steel);
    for (let index = 0; index < 2; index += 1) {
      const gx = x + 52 + index * 28;
      roundRect(gx - 12, y - 44, 24, 44, 4, 'rgba(255,248,232,0.28)', C.steel, 2);
    }
  }

  function drawGarnish(station, heat, t, x, y) {
    rect(x - 74, y - 26, 148, 26, C.wood);
    rect(x - 74, y - 31, 148, 6, '#a85c30');
    const bowls = [C.green, C.amber, C.cream];
    for (let index = 0; index < 3; index += 1) {
      const bx = x - 46 + index * 46;
      ellipse(bx, y - 34, 20, 10, '#d8d2c2');
      ellipse(bx, y - 36, 16, 7, bowls[index]);
    }
    rect(x + 44, y - 50, 32, 6, C.steel);
    rect(x + 68, y - 52, 12, 12, C.woodDark);
  }

  function drawServeStation(station, heat, t, x, y) {
    rect(x - 76, y - 14, 152, 14, C.wood);
    ctx.beginPath();
    ctx.ellipse(x, y - 16, 56, 13, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#cfd9da';
    ctx.fill();
    // A white plastic bag, tied at the top.
    ctx.beginPath();
    ctx.moveTo(x - 26, y - 20);
    ctx.quadraticCurveTo(x - 34, y - 64, x - 12, y - 68);
    ctx.lineTo(x + 12, y - 68);
    ctx.quadraticCurveTo(x + 34, y - 64, x + 26, y - 20);
    ctx.closePath();
    ctx.fillStyle = C.paper;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 12, y - 68);
    ctx.quadraticCurveTo(x, y - 84, x + 12, y - 68);
    ctx.strokeStyle = C.paper;
    ctx.lineWidth = 4;
    ctx.stroke();
    // A bobbing arrow pointing at the customer.
    ctx.globalAlpha = 0.45 + 0.35 * Math.sin(t * 5);
    ctx.beginPath();
    ctx.moveTo(x + 42, y - 48);
    ctx.lineTo(x + 62, y - 48);
    ctx.lineTo(x + 62, y - 58);
    ctx.lineTo(x + 78, y - 42);
    ctx.lineTo(x + 62, y - 26);
    ctx.lineTo(x + 62, y - 36);
    ctx.lineTo(x + 42, y - 36);
    ctx.closePath();
    ctx.fillStyle = C.amber;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  const STATION_DRAW = {
    pot: drawPot,
    noodle: drawNoodlePot,
    wok: drawWok,
    fryer: drawFryer,
    drink: drawDrink,
    garnish: drawGarnish,
    serve: drawServeStation,
  };

  /** The seven station props, standing on the counter's back edge. */
  function drawStationProps(state) {
    for (let index = 0; index < STATIONS.length; index += 1) {
      const station = STATIONS[index];
      STATION_DRAW[station.id](station, state.heat[index], state.animT, station.x, COUNTER);
    }
  }

  /**
   * The plate on the counter edge in front of each station. At rest it names the station; while a
   * cooker is working it becomes that cooker's live timer — a bar filling to the perfect window and
   * a word that steps MEMASAK → ANGKAT! → LEWAT → GOSONG. Same box, same place, so the timer never
   * collides with anything. This is the "live cook timer for whatever is on the heat".
   */
  function drawStationTag(station, heat, t, active) {
    const { y, w, h } = LAYOUT.tags;
    const x = station.x - w / 2;
    const working = heat.state === 'cooking' || heat.state === 'burnt';

    if (!working) {
      roundRect(x, y, w, h, 7, active ? C.orange : 'rgba(6,26,33,0.8)', active ? C.amber : 'rgba(244,230,203,0.26)', 2);
      label(station.name, station.x, y + 24, 21, active ? C.ink : C.cream, 'center', 800);
      return;
    }

    const spec = COMPONENTS[heat.comp];
    const burnt = heat.state === 'burnt';
    const ratio = Math.min(1, heat.t / spec.burn);
    const goodEnd = (spec.cook + spec.window) / spec.burn;
    roundRect(x, y, w, h, 7, 'rgba(6,26,33,0.92)', burnt ? C.red : C.amber, 2);
    const text = burnt ? 'GOSONG!' : heat.t < spec.cook ? 'MEMASAK' : heat.t <= spec.cook + spec.window ? 'ANGKAT!' : 'LEWAT';
    const color = burnt ? C.red : heat.t < spec.cook ? C.cream : heat.t <= spec.cook + spec.window ? C.green : C.amber;
    label(text, station.x, y + 20, 20, color, 'center', 800);
    const barW = w - 18;
    rect(x + 9, y + 25, barW, 9, 'rgba(244,230,203,0.2)');
    rect(x + 9, y + 25, barW * Math.min(1, spec.cook / spec.burn), 9, C.amber);
    rect(x + 9, y + 25, barW * ratio, 9, burnt ? C.ink : C.orange);
    rect(x + 9 + barW * goodEnd - 1, y + 22, 3, 15, C.paper);
    if (!burnt && heat.t > spec.cook + spec.window) {
      ctx.globalAlpha = 0.3 + 0.3 * Math.sin(t * 12);
      roundRect(x - 4, y - 4, w + 8, h + 8, 9, null, C.red, 3);
      ctx.globalAlpha = 1;
    }
  }

  function drawStationTags(state) {
    for (let index = 0; index < STATIONS.length; index += 1) {
      const active = index === state.nearStation && state.activeId !== -1;
      drawStationTag(STATIONS[index], state.heat[index], state.animT, active);
    }
  }

  // ---- the cook ---------------------------------------------------------------------------

  function cookPoints(state) {
    const bob = Math.sin(state.cook.bob) * 3;
    return { x: state.cook.x, baseY: COUNTER, headY: LAYOUT.cookHead + 30 + bob };
  }

  /** The cook's body, drawn behind the station props (which stand in front of them). */
  function drawCookBody(state) {
    const { x, baseY, headY } = cookPoints(state);

    ctx.beginPath();
    ctx.moveTo(x - 46, baseY);
    ctx.lineTo(x - 40, headY + 40);
    ctx.quadraticCurveTo(x, headY + 24, x + 40, headY + 40);
    ctx.lineTo(x + 46, baseY);
    ctx.closePath();
    ctx.fillStyle = '#12444f';
    ctx.fill();

    // The apron panel, in the stall's warm orange.
    ctx.beginPath();
    ctx.moveTo(x - 30, baseY);
    ctx.lineTo(x - 26, headY + 56);
    ctx.quadraticCurveTo(x, headY + 46, x + 26, headY + 56);
    ctx.lineTo(x + 30, baseY);
    ctx.closePath();
    ctx.fillStyle = C.orange;
    ctx.fill();
    rect(x - 30, headY + 68, 60, 7, C.cream);

    // Head, cap, face.
    circle(x, headY, 27, C.cream);
    ctx.beginPath();
    ctx.arc(x, headY - 4, 28, Math.PI, Math.PI * 2);
    ctx.fillStyle = C.orange;
    ctx.fill();
    rect(x - 30, headY - 8, 60, 8, C.orange);
    rect(x + 20, headY - 8, 22, 7, '#d06a1a');
    circle(x - 9, headY + 3, 3, C.ink);
    circle(x + 9, headY + 3, 3, C.ink);
    ctx.beginPath();
    ctx.arc(x, headY + 8, 8, 0.2, Math.PI - 0.2);
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2.6;
    ctx.stroke();
  }

  /** The cook's arms and tool, drawn in front of the props: they reach into the pot. */
  function drawCookArms(state) {
    const { x, baseY, headY } = cookPoints(state);
    const station = STATIONS[state.nearStation];
    const tool = station.tool;
    const reach = Math.sin(state.animT * 3) * 3;
    const handY = baseY - 30;
    const hands = [-1, 1].map((side) => ({ x: x + side * 42, y: handY }));

    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + side * 34, headY + 44);
      ctx.quadraticCurveTo(x + side * 56, headY + 70 + reach, x + side * 42, handY);
      ctx.strokeStyle = '#12444f';
      ctx.lineWidth = 17;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // The tool, when there is a ticket in hand.
    if (tool !== null && state.activeId !== -1) {
      const hx = hands[1].x;
      const hy = hands[1].y;
      ctx.strokeStyle = C.paper;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (tool === 'ladle') {
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + 26, hy - 34);
        ctx.stroke();
        ellipse(hx + 30, hy - 40, 14, 10, C.steel);
      } else if (tool === 'basket') {
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + 22, hy - 30);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(hx + 26, hy - 38, 16, 12, 0, 0, Math.PI * 2);
        ctx.strokeStyle = C.steel;
        ctx.lineWidth = 4;
        ctx.stroke();
      } else if (tool === 'spatula') {
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + 24, hy - 36);
        ctx.stroke();
        rect(hx + 22, hy - 52, 16, 18, C.steel);
      } else if (tool === 'pitcher') {
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + 20, hy - 26);
        ctx.stroke();
        roundRect(hx + 14, hy - 52, 26, 30, 5, C.orange);
      }
    }

    for (const hand of hands) circle(hand.x, hand.y, 10, C.cream);
  }

  // ---- the bowl ---------------------------------------------------------------------------

  /** Layer painters. Each fills the bowl's interior in its own idiom; the stack order is data. */
  const LAYER_DRAW = {
    noodles(cx, cy) {
      for (let index = 0; index < 6; index += 1) {
        const y = cy + 8 - index * 7;
        ctx.beginPath();
        ctx.moveTo(cx - 96, y);
        for (let step = 0; step <= 6; step += 1) {
          const px = cx - 96 + step * 32;
          ctx.quadraticCurveTo(px + 16, y - 9, px + 32, y);
        }
        ctx.strokeStyle = index % 2 ? '#f3c979' : '#e3ae54';
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    },
    meatballs(cx, cy) {
      for (const [dx, dy] of [[-62, 4], [-22, -4], [18, 2], [58, 6], [-40, 16], [0, 12], [40, 18]]) {
        circle(cx + dx, cy + dy, 15, '#e6cfa8');
        circle(cx + dx - 4, cy + dy - 4, 5, 'rgba(255,255,255,0.45)');
        ctx.beginPath();
        ctx.arc(cx + dx, cy + dy, 15, 0.2, Math.PI - 0.2);
        ctx.strokeStyle = '#b99668';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    },
    chicken(cx, cy) {
      for (const [dx, dy] of [[-52, 6], [-6, -2], [40, 8], [12, 18], [-30, 20]]) {
        ctx.beginPath();
        ctx.ellipse(cx + dx, cy + dy, 20, 13, dx * 0.01, 0, Math.PI * 2);
        ctx.fillStyle = '#c6763a';
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx + dx - 4, cy + dy - 4, 10, 6, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#e09a55';
        ctx.fill();
      }
    },
    gorengan(cx, cy) {
      for (const [dx, dy] of [[-64, 10], [64, 14], [0, -6]]) {
        ctx.beginPath();
        ctx.ellipse(cx + dx, cy + dy, 22, 15, 0.4, 0, Math.PI * 2);
        ctx.fillStyle = C.amber;
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx + dx - 5, cy + dy - 5, 11, 7, 0.4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffe0a0';
        ctx.fill();
      }
    },
    telur(cx, cy) {
      ctx.beginPath();
      ctx.ellipse(cx + 34, cy + 8, 24, 17, 0.2, 0, Math.PI * 2);
      ctx.fillStyle = C.paper;
      ctx.fill();
      circle(cx + 34, cy + 8, 11, '#f2b33d');
    },
    sambal(cx, cy) {
      for (const [dx, dy] of [[-14, 14], [16, 16], [2, 4]]) {
        ctx.beginPath();
        ctx.ellipse(cx + dx, cy + dy, 12, 8, 0, 0, Math.PI * 2);
        ctx.fillStyle = C.red;
        ctx.fill();
      }
    },
    seledri(cx, cy) {
      for (let index = 0; index < 12; index += 1) {
        const dx = -80 + ((index * 37) % 160);
        const dy = -2 + ((index * 13) % 22);
        ctx.beginPath();
        ctx.ellipse(cx + dx, cy + dy, 8, 3.4, index * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = C.green;
        ctx.fill();
      }
    },
    bawang(cx, cy) {
      for (let index = 0; index < 14; index += 1) {
        const dx = -84 + ((index * 41) % 168);
        const dy = 4 + ((index * 17) % 20);
        circle(cx + dx, cy + dy, 4, '#ffd88a');
      }
    },
  };

  /**
   * The hero vessel, drawn as an ordered layer stack: rim, then each content layer in LAYER_ORDER,
   * then the highlight. `contents` is the truth; a just-added layer gets a tweened pop.
   */
  function drawVessel(state) {
    const b = state.bowl;
    const { cx, rimY, rx, ry, bottom } = LAYOUT.bowl;

    if (b.dishId !== null && DISHES[b.dishId].vessel === 'glass') {
      drawGlass(b, cx);
      return;
    }

    // 1. The bowl's outside, with a heavy foot.
    ctx.beginPath();
    ctx.moveTo(cx - rx, rimY);
    ctx.quadraticCurveTo(cx - rx + 10, bottom, cx, bottom);
    ctx.quadraticCurveTo(cx + rx - 10, bottom, cx + rx, rimY);
    ctx.closePath();
    ctx.fillStyle = '#d9c9a8';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - rx + 26, rimY + 26);
    ctx.quadraticCurveTo(cx - rx + 40, bottom - 12, cx, bottom - 12);
    ctx.quadraticCurveTo(cx + rx - 40, bottom - 12, cx + rx - 26, rimY + 26);
    ctx.closePath();
    ctx.fillStyle = '#bfab86';
    ctx.fill();
    // 2. The foot and its shadow.
    ellipse(cx, bottom + 6, 64, 13, 'rgba(0,0,0,0.3)');
    roundRect(cx - 54, bottom - 14, 108, 20, 6, '#b9a582');
    // 3. The rim band and the dark interior.
    ellipse(cx, rimY, rx, ry, C.paper);
    ellipse(cx, rimY, rx - 13, ry - 9, '#2f6b5c');

    // 4. The layer stack, clipped to the interior so nothing spills over the rim.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, rimY, rx - 13, ry - 9, 0, 0, Math.PI * 2);
    ctx.clip();
    const present = new Set(b.contents.map((entry) => entry.comp));
    for (const layer of LAYER_ORDER) {
      if (!present.has(layer)) continue;
      const entry = b.contents.find((item) => item.comp === layer);
      const pop = b.pops.find((item) => item.comp === layer);
      const bump = pop === undefined ? 1 : 1 + Math.sin(Math.min(1, pop.t / 0.55) * Math.PI) * 0.2;
      ctx.save();
      ctx.translate(cx, rimY + 8);
      ctx.scale(bump, bump);
      ctx.translate(-cx, -(rimY + 8));
      LAYER_DRAW[layer](cx, rimY + 8);
      ctx.restore();
      if (entry !== undefined && entry.quality === 'over') {
        // An overcooked layer is visibly tainted: the same shapes under a dark wash.
        ctx.fillStyle = 'rgba(30,16,8,0.45)';
        ctx.fillRect(cx - rx, rimY - ry, rx * 2, ry * 2);
      }
    }
    ctx.restore();

    // 5. The rim highlight, front arc only, so the bowl keeps a crisp silhouette.
    ctx.beginPath();
    ctx.ellipse(cx, rimY, rx, ry, 0, 0.08, Math.PI - 0.08);
    ctx.strokeStyle = C.paper;
    ctx.lineWidth = 9;
    ctx.stroke();

    // 6. Steam off a hot dish.
    if (b.contents.length > 0) {
      steam(cx - 60, rimY - 18, state.animT * 0.9, 0.3, 'rgba(255,248,232,0.5)');
      steam(cx + 50, rimY - 12, state.animT * 0.75 + 2, 0.26, 'rgba(255,248,232,0.5)');
    }

    // 7. An empty bowl still says what it is waiting for.
    if (b.dishId === null) label('AMBIL TIKET', cx, rimY + 10, 26, 'rgba(255,248,232,0.55)', 'center', 800);
  }

  /** The iced tea glass: the same layered idea, for the drink that comes in a glass. */
  function drawGlass(b, cx) {
    const rimY = LAYOUT.bowl.rimY - 12;
    const bottom = LAYOUT.bowl.bottom;
    const w = 104;
    roundRect(cx - w / 2, rimY, w, bottom - rimY, 10, 'rgba(255,248,232,0.2)');
    roundRect(cx - w / 2 + 8, rimY + 16, w - 16, bottom - rimY - 30, 6, C.orange);
    for (let index = 0; index < 4; index += 1) {
      roundRect(cx - 30 + (index % 2) * 34, rimY + 34 + index * 22, 26, 19, 5, 'rgba(255,255,255,0.8)');
    }
    rect(cx + 14, rimY - 40, 10, 50, C.paper);
    rect(cx + 14, rimY - 40, 10, 12, C.red);
    roundRect(cx - w / 2, rimY, w, bottom - rimY, 10, null, C.paper, 5);
    label('ES TEH', cx, bottom + 44, 22, C.cream, 'center', 800);
  }

  /** The prep board the bowl stands on. */
  function drawBoard() {
    const b = LAYOUT.board;
    roundRect(b.x, b.y + 4, b.w, b.h, 14, 'rgba(0,0,0,0.35)');
    roundRect(b.x, b.y, b.w, b.h, 14, C.wood);
    roundRect(b.x + 8, b.y + 8, b.w - 16, b.h - 24, 9, '#9d5730');
    for (let index = 0; index < 5; index += 1) {
      rect(b.x + 22 + index * 70, b.y + 14, 5, b.h - 34, 'rgba(84,43,22,0.4)');
    }
  }

  // ---- the bumbu trays and the active-order panel -----------------------------------------

  /** The four bumbu trays, with the selected one lifted and lit. Keys 1-4 and clicks both work. */
  function drawTrays(state) {
    for (let index = 0; index < 4; index += 1) {
      const r = trayRect(index);
      const selected = state.tray === index;
      const lift = selected ? -8 : 0;
      roundRect(r.x, r.y + lift, r.w, r.h, 10, selected ? C.orange : '#0d3b45', selected ? C.amber : 'rgba(244,230,203,0.45)', selected ? 4 : 2);
      const color = index === 0 ? C.green : index === 1 ? C.amber : index === 2 ? C.paper : C.red;
      ellipse(r.x + r.w / 2, r.y + 36 + lift, 26, 12, color);
      for (let dot = 0; dot < 5; dot += 1) {
        circle(r.x + 22 + dot * 13, r.y + 28 + lift + (dot % 2) * 8, 5, index === 0 ? '#4f9f4f' : index === 3 ? '#b03a1f' : color);
      }
      label(String(index + 1), r.x + 10, r.y + 23 + lift, 22, selected ? C.ink : C.cream, 'left', 800);
      label(COMPONENTS[TRAYS[index]].name, r.x + r.w / 2, r.y + r.h - 9 + lift, 20, selected ? C.ink : C.cream, 'center', 700);
    }
  }

  /** The active ticket's checklist: what still has to go into the bowl, ticked off as it lands. */
  function drawActivePanel(state) {
    const panel = LAYOUT.panel;
    roundRect(panel.x, panel.y, panel.w, panel.h, 12, 'rgba(6,26,33,0.85)', 'rgba(244,230,203,0.32)', 2);
    const order = state.activeOrder ? state.activeOrder() : null;

    if (order === null) {
      label('PESANAN AKTIF', panel.x + 16, panel.y + 28, 20, C.amber, 'left', 800);
      label('Klik tiket di atas', panel.x + 16, panel.y + 68, 22, C.cream, 'left', 600);
      label('atau tekan E untuk ambil', panel.x + 16, panel.y + 98, 22, C.cream, 'left', 600);
      label('ANTREAN', panel.x + 16, panel.y + 146, 20, 'rgba(244,230,203,0.6)', 'left', 700);
      let waiting = 0;
      for (const entry of state.orders) if (entry.state === ORDER_STATES.WAITING) waiting += 1;
      label(`${waiting} menunggu · ${state.served}/${SHIFT.orders} terjual`, panel.x + 16, panel.y + 182, 22, C.paper, 'left', 800);
      return;
    }

    label('PESANAN AKTIF', panel.x + 16, panel.y + 25, 20, C.amber, 'left', 800);
    label(DISHES[order.dishId].name, panel.x + 16, panel.y + 56, 30, C.paper, 'left', 800);
    if (order.ojek) {
      roundRect(panel.x + panel.w - 100, panel.y + 12, 84, 24, 5, C.red);
      label('OJOK x2', panel.x + panel.w - 58, panel.y + 30, 20, C.paper, 'center', 800);
    }
    if (order.extras.length > 0) {
      const names = order.extras
        .map((key) => (EXTRAS[key].remove ? `−${EXTRAS[key].name}` : `+${EXTRAS[key].name}`))
        .join('  ');
      label(names, panel.x + 16, panel.y + 80, 20, C.amber, 'left', 700);
    }

    let row = 0;
    for (const comp of order.recipe) {
      const y = panel.y + 110 + row * 24;
      if (row >= 4) {
        label(`+${order.recipe.length - row} lagi`, panel.x + 44, y, 20, 'rgba(244,230,203,0.6)', 'left', 700);
        break;
      }
      const done = state.bowl.contents.some((entry) => entry.comp === comp);
      roundRect(panel.x + 16, y - 15, 18, 18, 4, done ? C.green : 'rgba(244,230,203,0.12)', done ? null : C.cream, 2);
      if (done) {
        ctx.beginPath();
        ctx.moveTo(panel.x + 20, y - 6);
        ctx.lineTo(panel.x + 25, y - 1);
        ctx.lineTo(panel.x + 32, y - 11);
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      label(COMPONENTS[comp].name, panel.x + 44, y, 21, done ? C.green : C.cream, 'left', 700);
      const station = STATIONS.find((entry) => entry.id === COMPONENTS[comp].station);
      label(station.name, panel.x + panel.w - 14, y, 20, done ? 'rgba(244,230,203,0.3)' : 'rgba(244,230,203,0.65)', 'right', 600);
      row += 1;
    }
  }

  // ---- HUD ---------------------------------------------------------------------------------

  function drawHud(state) {
    // The sign.
    const sign = LAYOUT.sign;
    roundRect(sign.x, sign.y, sign.w, sign.h, 10, C.woodDark, C.amber, 3);
    label('WARUNG', sign.x + 18, sign.y + 30, 20, C.amber, 'left', 800);
    label('BAKSO MALAM', sign.x + 18, sign.y + 62, 29, C.paper, 'left', 800);

    // The shift clock: the third timer, always on screen.
    const clock = LAYOUT.clock;
    roundRect(clock.x, clock.y, clock.w, clock.h, 10, 'rgba(6,26,33,0.85)', 'rgba(244,230,203,0.3)', 2);
    label('SISA WAKTU', clock.x + 18, clock.y + 28, 20, C.cream, 'left', 700);
    const seconds = Math.max(0, Math.ceil(state.clock));
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    const urgent = state.clock <= 10;
    label(`${mm}:${ss}`, clock.x + 18, clock.y + 72, 40, urgent ? C.red : C.paper, 'left', 800);
    const barW = 124;
    const barX = clock.x + clock.w - barW - 18;
    rect(barX, clock.y + 52, barW, 16, 'rgba(244,230,203,0.16)');
    rect(barX, clock.y + 52, barW * Math.max(0, state.clock / SHIFT.seconds), 16, urgent ? C.red : C.tealLite);

    // Walkouts and burnt batches: the two ways the shift ends early.
    const s = LAYOUT.strikes;
    roundRect(s.x, s.y, s.w, s.h, 10, 'rgba(6,26,33,0.85)', 'rgba(244,230,203,0.3)', 2);
    label('KABUR', s.x + 18, s.y + 28, 20, C.cream, 'left', 700);
    label(`${state.walkouts}/${FAIL.walkouts}`, s.x + 116, s.y + 28, 24, state.walkouts > 0 ? C.red : C.cream, 'left', 800);
    label('GOSONG', s.x + 188, s.y + 28, 20, C.cream, 'left', 700);
    label(`${state.burnt}/${FAIL.burnt}`, s.x + 292, s.y + 28, 24, state.burnt > 0 ? C.red : C.cream, 'left', 800);
    for (let index = 0; index < FAIL.walkouts; index += 1) {
      circle(s.x + 24 + index * 20, s.y + 52, 6, index < state.walkouts ? C.red : 'rgba(244,230,203,0.22)');
    }
    for (let index = 0; index < FAIL.burnt; index += 1) {
      circle(s.x + 196 + index * 20, s.y + 52, 6, index < state.burnt ? C.red : 'rgba(244,230,203,0.22)');
    }

    // Takings.
    const tak = LAYOUT.takings;
    roundRect(tak.x, tak.y, tak.w, tak.h, 10, 'rgba(6,26,33,0.85)', C.amber, 2);
    label('PENDAPATAN', tak.x + 18, tak.y + 28, 20, C.cream, 'left', 700);
    label(`Rp ${state.money.toLocaleString('id-ID')}`, tak.x + 18, tak.y + 68, 30, C.amber, 'left', 800);
    label(`${state.served}/${SHIFT.orders} TERJUAL`, tak.x + tak.w - 18, tak.y + 62, 20, C.cream, 'right', 700);
  }

  /** Small floating plaques: refusals, money, warnings. They sit in the left column, clear of the
   *  hero bowl and the ticket board, and stack upward so the newest is nearest the counter. */
  function drawToasts(state) {
    for (let index = 0; index < state.toasts.length; index += 1) {
      const toast = state.toasts[index];
      const fade = toast.t > toast.life - 0.4 ? (toast.life - toast.t) / 0.4 : 1;
      const y = 372 - index * 46;
      ctx.globalAlpha = Math.max(0, fade);
      const width = Math.min(328, Math.max(210, toast.text.length * 13 + 34));
      roundRect(16, y - 32, width, 40, 8, 'rgba(6,26,33,0.94)', toast.color, 2);
      label(toast.text, 32, y - 4, 22, toast.color, 'left', 800);
      ctx.globalAlpha = 1;
    }
  }

  function drawParticles(state) {
    for (const p of state.particles) {
      const life = 1 - p.life / p.max;
      ctx.globalAlpha = Math.max(0, life);
      if (p.kind === 'crumb' || p.kind === 'splash') {
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.size, p.size * 0.6, p.life * 4, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      } else if (p.kind === 'smoke') {
        circle(p.x, p.y, p.size * (1.2 + p.life), p.color);
      } else {
        circle(p.x, p.y, p.size, p.color);
      }
    }
    ctx.globalAlpha = 1;
    for (const p of state.pulses) {
      const k = p.t / 0.75;
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12 + k * 46, 0, Math.PI * 2);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---- screens -----------------------------------------------------------------------------

  function blink() {
    return 0.55 + 0.45 * Math.sin(performance.now() / 300);
  }

  function drawTitlePanel() {
    ctx.fillStyle = 'rgba(3,12,16,0.68)';
    ctx.fillRect(0, 0, W, H);
    const w = 880;
    const h = 468;
    const x = (W - w) / 2;
    const y = 126;
    roundRect(x, y, w, h, 18, 'rgba(6,26,33,0.96)', C.amber, 4);
    roundRect(x + 20, y + 20, w - 40, 8, 4, C.orange);
    label('WARUNG BAKSO MALAM', 640, y + 98, 54, C.amber, 'center', 800);
    label('A Jakarta street stall after dark. You are the only cook.', 640, y + 140, 24, C.cream, 'center', 600);
    label('Ten orders. One shift. The queue will not wait.', 640, y + 174, 24, C.cream, 'center', 600);

    const lines = [
      ['GERAK', 'A / D or arrow keys — or click a station'],
      ['AKSI', 'E or Space — click a ticket, a tray, or hold to drag'],
      ['BUMBU', '1-4 pick a topping — or click a tray'],
      ['JEDA', 'Esc'],
    ];
    for (let index = 0; index < lines.length; index += 1) {
      const ly = y + 224 + index * 34;
      label(lines[index][0], x + 54, ly, 20, C.tealLite, 'left', 800);
      label(lines[index][1], x + 168, ly, 22, C.paper, 'left', 600);
    }
    label('Serve bakso, mie ayam and es teh manis before patience runs out.', 640, y + 400, 22, C.tealLite, 'center', 700);
    ctx.globalAlpha = blink();
    label('Press Space or click to open the stall', 640, y + 440, 26, C.amber, 'center', 800);
    ctx.globalAlpha = 1;
  }

  function drawPausePanel() {
    ctx.fillStyle = 'rgba(3,12,16,0.62)';
    ctx.fillRect(0, 0, W, H);
    roundRect(440, 252, 400, 216, 16, 'rgba(6,26,33,0.96)', C.amber, 3);
    label('ISTIRAHAT', 640, 324, 44, C.amber, 'center', 800);
    label('The stall is paused.', 640, 374, 24, C.cream, 'center', 600);
    label('Press Esc to carry on', 640, 426, 24, C.paper, 'center', 800);
  }

  function drawEndPanel(state, viewState) {
    ctx.fillStyle = 'rgba(3,12,16,0.7)';
    ctx.fillRect(0, 0, W, H);
    const good = state.finishReason === 'complete' || (state.finishReason === 'closed' && state.walkouts < FAIL.walkouts);
    const w = 720;
    const h = 440;
    const x = (W - w) / 2;
    const y = 136;
    roundRect(x, y, w, h, 18, 'rgba(6,26,33,0.96)', good ? C.amber : C.red, 4);
    label(good ? 'SHIFT SELESAI' : 'WARUNG TUTUP', 640, y + 82, 48, good ? C.amber : C.red, 'center', 800);

    const reasons = {
      complete: 'Every order served. The stall closes happy.',
      closed: 'Shift clock ran out. The stall closes.',
      walkouts: 'Too many customers walked off.',
      burnt: 'Too many batches went black.',
    };
    label(reasons[state.finishReason] ?? 'The stall closes.', 640, y + 124, 23, C.cream, 'center', 600);

    const stats = [
      ['PENDAPATAN', `Rp ${state.money.toLocaleString('id-ID')}`],
      ['TERJUAL', `${state.served} / ${SHIFT.orders}`],
      ['KABUR', `${state.walkouts}`],
      ['GOSONG', `${state.burnt}`],
    ];
    for (let index = 0; index < stats.length; index += 1) {
      const sx = x + 78 + (index % 2) * 292;
      const sy = y + 168 + Math.floor(index / 2) * 78;
      roundRect(sx, sy, 272, 64, 8, 'rgba(244,230,203,0.08)');
      label(stats[index][0], sx + 16, sy + 24, 20, 'rgba(244,230,203,0.7)', 'left', 700);
      label(stats[index][1], sx + 16, sy + 52, 26, C.paper, 'left', 800);
    }
    label(`Rekor: Rp ${((viewState ?? {}).best ?? 0).toLocaleString('id-ID')}`, 640, y + 356, 22, C.tealLite, 'center', 700);
    ctx.globalAlpha = blink();
    label('Press Space or click for another shift', 640, y + 404, 24, C.amber, 'center', 800);
    ctx.globalAlpha = 1;
  }

  // ---- the frame ---------------------------------------------------------------------------

  /** Paint one frame. `viewState` carries the best takings and nothing else the world knows. */
  function draw(state, screen, viewState) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.night;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);

    // A fail shake: the whole stall lurches for a quarter of a second.
    let shakeX = 0;
    let shakeY = 0;
    if (state.shake > 0) {
      shakeX = Math.sin(state.shake * 90) * state.shake * 16;
      shakeY = Math.cos(state.shake * 71) * state.shake * 9;
    }
    ctx.save();
    ctx.translate(shakeX, shakeY);

    drawNight(state);
    drawWall(state);
    drawTickets(state);
    drawCookBody(state);
    drawStationProps(state);
    drawCounterSurface();
    drawStationTags(state);
    drawCookArms(state);
    drawBoard();
    drawVessel(state);
    drawTrays(state);
    drawActivePanel(state);
    drawHud(state);
    drawParticles(state);
    drawToasts(state);

    if (state.flash > 0) {
      ctx.globalAlpha = state.flash * 0.5;
      ctx.fillStyle = state.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    if (screen === SCREEN_TITLE) drawTitlePanel();
    else if (screen === SCREEN_PAUSED) drawPausePanel();
    else if (screen === SCREEN_END) drawEndPanel(state, viewState);
  }

  /** Logical field coordinates for a pointer event, so input never needs to know the scale. */
  function toField(clientX, clientY) {
    const box = canvas.getBoundingClientRect();
    const ratio = canvas.width / Math.max(1, box.width);
    const px = (clientX - box.left) * ratio;
    const py = (clientY - box.top) * ratio;
    return { x: (px - view.x) / view.scale, y: (py - view.y) / view.scale };
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, toField, resize };
}
