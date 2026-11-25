// A small seeded random number generator (mulberry32), plus the three helpers the stall needs from
// it. The same seed gives the same shift — same customers, same extras, same ojek orders — which
// is what makes the ?shot= scenes repeatable down to the last meatball.
//
// The world only ever calls these three; nothing else in the game is allowed to touch Math.random,
// so a screenshot can never disagree with itself between two runs.

export function createRandom(seed) {
  let a = seed | 0;
  function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return random;
}

/** A random integer in [0, n). */
export function randomInt(random, n) {
  return Math.floor(random() * n);
}

/** One element of `list`, chosen with the seeded generator. */
export function pick(random, list) {
  return list[randomInt(random, list.length)];
}

/** A shuffle of `list` (Fisher–Yates, seeded); the input is left alone. */
export function shuffle(random, list) {
  const out = list.slice();
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = randomInt(random, index + 1);
    const held = out[index];
    out[index] = out[swap];
    out[swap] = held;
  }
  return out;
}
