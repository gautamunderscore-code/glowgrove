// The world data model. This is the durable heart of the game: plain JSON that
// any client (this web app, a future native app, AR glasses) can read.
//
// Key ideas:
// - Entities never store a global position. They hang off an *anchor*.
// - Anchors keep a list of location "fingerprints". Today the sandbox only has
//   'local' ones; later we add 'gps', 'geospatial', 'cloud-anchor', ... and each
//   client resolves the best fingerprint it supports.
// - Growth, glow and bird visits are NOT stored. They are calculated from time
//   (see sim.js), which keeps hosting cheap.

import { randomId, randomSeed } from './rng.js';

export const SCHEMA_VERSION = 1;

/** Rough longitude from the device time zone, so day/night roughly matches the
 *  player's real sky without asking for their location. */
export function longitudeFromTimezone(date = new Date()) {
  const lng = -date.getTimezoneOffset() / 4;
  return Math.max(-180, Math.min(180, lng));
}

export function createWorld({ name = 'My patch', now = Date.now() } = {}) {
  const seed = randomSeed();
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'patch',
    id: randomId('world'),
    name,
    createdAt: now,
    seed,
    location: { lat: 40, lng: longitudeFromTimezone(), source: 'timezone-estimate' },
    // The playable area. Placement outside it is refused.
    zone: { shape: 'circle', radiusM: 6 },
    settings: { growthSpeed: 1 },
    // World clock. rate 1 = real time. The sandbox lets you fast-forward;
    // shared public worlds would always run at rate 1.
    clock: { realAnchor: now, simAnchor: now, rate: 60 },
    anchors: {
      ground: {
        id: 'ground',
        kind: 'ground',
        fingerprints: [{ kind: 'local', position: [0, 0, 0] }],
      },
      // A real-world feature. In the sandbox it is simulated from a seed; in AR
      // it would come from the camera (tree detection, LiDAR mesh, ...).
      'tree-1': makeTreeAnchor(seed),
    },
    entities: [],
  };
}

/**
 * A life-size world for AR "Room mode". Everything hangs off a single home
 * spot that the player marks in their real room (a table corner, a door
 * frame...). Re-marking the same spot next time brings the garden back in
 * place. Later, a cloud anchor or a venue scan (VPS) becomes another
 * fingerprint on this anchor and the taps go away.
 */
export function createRoomWorld({ name = 'My room', now = Date.now() } = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'room',
    id: randomId('world'),
    name,
    createdAt: now,
    seed: randomSeed(),
    location: { lat: 40, lng: longitudeFromTimezone(), source: 'timezone-estimate' },
    zone: { shape: 'circle', radiusM: 60 },
    settings: { growthSpeed: 1 },
    clock: { realAnchor: now, simAnchor: now, rate: 1 }, // real time: come back in a week and it's grown
    anchors: {
      home: {
        id: 'home',
        kind: 'home-spot',
        // 'manual-two-tap': the player taps the same corner and edge each visit.
        fingerprints: [{ kind: 'manual-two-tap', position: [0, 0, 0] }],
      },
    },
    entities: [],
  };
}

export function makeTreeAnchor(seed) {
  return {
    id: 'tree-1',
    kind: 'feature',
    feature: { type: 'tree', seed: (seed * 7919 + 13) % 2147483647 },
    fingerprints: [{ kind: 'local', position: [0, 0, 0] }],
  };
}

export function createEntity({ type, anchorId, position, normal, plantedAt }) {
  return {
    id: randomId('ent'),
    type, // content id, e.g. 'glowcap'
    anchorId,
    position, // [x, y, z] relative to the anchor
    normal, // [x, y, z] surface direction it grows from
    plantedAt, // world-clock time in ms
    seed: randomSeed(), // shape and colour variation
    scale: 1, // size multiplier set by the player (life-size trees, tiny moss...)
  };
}

/** Upgrade older saved worlds. Returns null if the data can't be used. */
export function migrateWorld(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.schemaVersion === SCHEMA_VERSION) {
    raw.kind ??= 'patch';
    raw.settings ??= { growthSpeed: 1 };
    raw.entities ??= [];
    return raw;
  }
  // Future: if (raw.schemaVersion === 1) { ...convert to 2... }
  return null;
}
