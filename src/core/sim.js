// The simulation. Everything here is a pure function of (world data, time).
// No server has to tick the world: any device works out the same answer,
// even offline. This is what keeps hosting nearly free.

import { rngFor } from './rng.js';

export const HOUR = 3600e3;
const DAY = 24 * HOUR;
const BIRD_SLOT = HOUR; // birds decide once per world-hour whether to visit

// ---------- clock ----------

export function simNow(clock, realNow = Date.now()) {
  return clock.simAnchor + (realNow - clock.realAnchor) * clock.rate;
}

export function withRate(clock, rate, realNow = Date.now()) {
  return { realAnchor: realNow, simAnchor: simNow(clock, realNow), rate };
}

export function jumpClock(clock, simTime, realNow = Date.now()) {
  return { realAnchor: realNow, simAnchor: simTime, rate: clock.rate };
}

// ---------- helpers ----------

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ---------- growth & glow ----------

/** 0 = just planted, 1 = fully grown. */
export function maturity(entity, def, now, growthSpeed = 1) {
  if (!def || !def.growHours) return 1; // rocks, water: already 'grown'
  const age = Math.max(0, now - entity.plantedAt);
  return Math.min(1, (age * growthSpeed) / (def.growHours * HOUR));
}

/** How strongly something glows right now (0..1). */
export function glowLevel(def, mat, night) {
  if (!def?.glow) return 0;
  return night * smoothstep(def.glow.minMaturity ?? 0.5, 1, mat);
}

// ---------- sun ----------

/** Sun elevation and azimuth (degrees) for a time and place. NOAA approximation. */
export function sunPosition(time, lat, lng) {
  const d = new Date(time);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((time - yearStart) / DAY) + 1;
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hour - 12) / 24);
  const eqTime =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const trueSolarMinutes = hour * 60 + eqTime + 4 * lng;
  const ha = ((trueSolarMinutes / 4 - 180) * Math.PI) / 180;
  const latR = (lat * Math.PI) / 180;
  const cosZen = Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.min(1, Math.max(-1, cosZen)));
  const elevation = 90 - (zen * 180) / Math.PI;
  const azSouth = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(latR) - Math.tan(decl) * Math.cos(latR));
  const azimuth = ((azSouth * 180) / Math.PI + 180 + 360) % 360; // 0 = north, clockwise
  return { elevation, azimuth };
}

/** 0 in daylight, 1 at full night, smooth through dusk and dawn. */
export function nightFactor(elevation) {
  return smoothstep(2, -8, elevation);
}

/** Next world time after `from` where the sun crosses `elevation`, going up or down. */
export function findNextSunCrossing(from, lat, lng, elevation, rising) {
  let prev = sunPosition(from, lat, lng).elevation;
  for (let t = from + 10 * 60e3; t < from + 2 * DAY; t += 10 * 60e3) {
    const el = sunPosition(t, lat, lng).elevation;
    if (rising ? prev < elevation && el >= elevation : prev > elevation && el <= elevation) return t;
    prev = el;
  }
  return from;
}

// ---------- birds ----------

/** What the garden offers, by tag: { flower: 2.4, glow: 1.1, ... } */
export function attractionScores(world, pack, now, night) {
  const scores = {};
  const add = (tag, v) => (scores[tag] = (scores[tag] || 0) + v);
  for (const anchor of Object.values(world.anchors)) {
    if (anchor.feature?.type === 'tree') add('tree', 1);
  }
  for (const e of world.entities) {
    const def = pack.placeableById.get(e.type);
    if (!def) continue;
    const m = maturity(e, def, now, world.settings.growthSpeed);
    if (m < 0.5) continue;
    const bloom = (m - 0.5) * 2;
    for (const tag of def.tags) {
      // Glowing things only attract anything while they actually glow.
      add(tag, tag === 'glow' ? glowLevel(def, m, night) : bloom);
    }
  }
  return scores;
}

function isActive(when, night) {
  if (when === 'day') return night < 0.3;
  if (when === 'night') return night > 0.7;
  if (when === 'twilight') return night > 0.1 && night < 0.9;
  return true;
}

/**
 * Which birds are visiting right now. Deterministic: every device showing this
 * world at this time gets the same answer from (world seed, hour, species).
 */
export function birdVisits(world, pack, now) {
  const visits = [];
  const { lat, lng } = world.location;
  const slot = Math.floor(now / BIRD_SLOT);
  const slotStart = slot * BIRD_SLOT;
  const night = nightFactor(sunPosition(slotStart + BIRD_SLOT / 2, lat, lng).elevation);
  const scores = attractionScores(world, pack, slotStart, night);

  for (const bird of pack.birds) {
    if (!isActive(bird.active, night)) continue;
    let score = 0;
    for (const [tag, weight] of Object.entries(bird.attractedBy)) score += (scores[tag] || 0) * weight;
    if (score < bird.minScore) continue;

    const chance = Math.min(bird.maxChance, (score - bird.minScore + 1) * bird.chancePerPoint);
    const rnd = rngFor(world.seed, slot, bird.id);
    if (rnd() >= chance) continue;

    const arriveAt = slotStart + rnd() * 0.25 * BIRD_SLOT;
    const leaveAt = arriveAt + (0.45 + rnd() * 0.3) * BIRD_SLOT;
    if (now < arriveAt || now >= leaveAt) continue;

    const [minFlock, maxFlock] = bird.flock ?? [1, 1];
    const count = minFlock + Math.floor(rnd() * (maxFlock - minFlock + 1));
    for (let i = 0; i < count; i++) {
      visits.push({ key: `${bird.id}:${slot}:${i}`, birdId: bird.id, seed: Math.floor(rnd() * 1e9), leader: i === 0 });
    }
  }
  return visits;
}
