// Procedural WebAudio: every sound in the stall is made here out of oscillators and one short
// noise buffer generated in code. There is no audio file anywhere in game/, and nothing is
// fetched. The AudioContext is created lazily on the first real gesture (a key or a click), which
// is both what browsers require and what the checklist asks for.
//
// Checklist technique: procedural WebAudio — a short motif per action. Each name in SOUNDS is one
// gesture's sound: a tick, an add-blip, a sizzle, a serve chime, a fail buzz. `play` never throws:
// a browser that blocks audio just gets a silent stall.

const SOUNDS = {
  // A dry wooden tick: the cook's footstep on the counter boards.
  step: { kind: 'tone', wave: 'triangle', from: 190, to: 150, gain: 0.05, decay: 0.07 },
  // Picking a ticket off the string: two quick rising notes.
  claim: { kind: 'notes', notes: [660, 880], gain: 0.07, decay: 0.1 },
  // An ingredient landing in the bowl: a soft falling blip.
  add: { kind: 'tone', wave: 'sine', from: 720, to: 460, gain: 0.09, decay: 0.13 },
  // Dropping a basket into hot oil: a short burst of filtered noise.
  sizzle: { kind: 'noise', gain: 0.12, decay: 0.34, filter: 2600, q: 0.9 },
  // The serve chime: a three-note motif, the only "happy" sound in the game.
  serve: { kind: 'notes', notes: [784, 988, 1319], gain: 0.1, decay: 0.16 },
  // A walkout or a burnt batch: a low, ugly two-tone buzz.
  fail: { kind: 'notes', notes: [196, 147], gain: 0.12, decay: 0.24, wave: 'sawtooth' },
  // The shift clock's last ten seconds.
  urgent: { kind: 'tone', wave: 'square', from: 1046, to: 1046, gain: 0.05, decay: 0.06 },
  // Money going in the tin.
  cash: { kind: 'notes', notes: [1046, 1568], gain: 0.08, decay: 0.09 },
  // The stall opening.
  open: { kind: 'notes', notes: [523, 659, 784], gain: 0.09, decay: 0.2 },
  // The stall closing.
  close: { kind: 'notes', notes: [523, 415, 330], gain: 0.09, decay: 0.26 },
};

export function createAudio() {
  let context = null;
  let master = null;
  let noise = null;

  /** Called from the first gesture; safe to call on every gesture. */
  function unlock() {
    if (context !== null) {
      if (context.state === 'suspended') context.resume().catch(() => {});
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    try {
      context = new Ctor();
      master = context.createGain();
      master.gain.value = 0.55;
      master.connect(context.destination);
      // One second of white noise, made here in code: the only "sample" the game has.
      const rate = context.sampleRate;
      noise = context.createBuffer(1, rate, rate);
      const data = noise.getChannelData(0);
      let seed = 0x9e3779b9;
      for (let index = 0; index < data.length; index += 1) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        data[index] = ((seed >>> 8) / 8388608) - 1;
      }
    } catch {
      context = null;
    }
  }

  function envelope(gain, decay) {
    const now = context.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gain.gain.value, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    return now;
  }

  function tone(spec) {
    const now = context.currentTime;
    const osc = context.createOscillator();
    const amp = context.createGain();
    osc.type = spec.wave ?? 'sine';
    osc.frequency.setValueAtTime(spec.from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), now + spec.decay);
    amp.gain.value = spec.gain;
    envelope(amp, spec.decay);
    osc.connect(amp);
    amp.connect(master);
    osc.start(now);
    osc.stop(now + spec.decay + 0.05);
  }

  function notes(spec) {
    const start = context.currentTime;
    const step = spec.decay * 0.62;
    for (let index = 0; index < spec.notes.length; index += 1) {
      const osc = context.createOscillator();
      const amp = context.createGain();
      const at = start + index * step;
      osc.type = spec.wave ?? 'triangle';
      osc.frequency.setValueAtTime(spec.notes[index], at);
      amp.gain.setValueAtTime(0.0001, at);
      amp.gain.linearRampToValueAtTime(spec.gain, at + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.0001, at + spec.decay);
      osc.connect(amp);
      amp.connect(master);
      osc.start(at);
      osc.stop(at + spec.decay + 0.05);
    }
  }

  function hiss(spec) {
    if (noise === null) return;
    const now = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const amp = context.createGain();
    source.buffer = noise;
    filter.type = 'bandpass';
    filter.frequency.value = spec.filter;
    filter.Q.value = spec.q;
    amp.gain.setValueAtTime(spec.gain, now);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + spec.decay);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    source.start(now);
    source.stop(now + spec.decay + 0.05);
  }

  /** Play one named sound. Silently does nothing until the first gesture has unlocked audio. */
  function play(name) {
    if (context === null || master === null) return;
    if (context.state === 'suspended') context.resume().catch(() => {});
    const spec = SOUNDS[name];
    if (spec === undefined) return;
    try {
      if (spec.kind === 'notes') notes(spec);
      else if (spec.kind === 'noise') hiss(spec);
      else tone(spec);
    } catch {
      // Audio is decoration: a failing node must never take the game down with it.
    }
  }

  return { unlock, play, get ready() { return context !== null; } };
}
