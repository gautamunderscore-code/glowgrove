// Deterministic randomness. Every device that knows a world's seed generates
// the same shapes, colours and bird visits, so none of that has to be stored
// or synced through a server.

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random generator seeded from any mix of values, e.g. rngFor(worldSeed, slot, 'owl'). */
export function rngFor(...parts) {
  return mulberry32(hashString(parts.join('|')));
}

export function randomId(prefix = 'id') {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}${Date.now().toString(36).slice(-4)}`;
}

export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}
