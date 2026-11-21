// Wires everything together: data -> simulation -> 3D -> UI.

import { loadContentPack } from './core/content.js';
import { createWorld, createRoomWorld, makeTreeAnchor } from './core/model.js';
import { simNow, withRate, jumpClock, sunPosition, birdVisits, findNextSunCrossing } from './core/sim.js';
import { randomSeed } from './core/rng.js';
import { LocalWorldStore } from './store/localStore.js';
import { createScene } from './render/scene.js';
import { GardenView } from './render/garden.js';
import { BirdFlock } from './render/birds.js';
import { windTime } from './render/wind.js';
import { createHud, esc } from './ui/hud.js';
import { setupAR } from './xr/ar.js';
import { createCameraView } from './ui/cameraView.js';
import { createInteraction } from './ui/interaction.js';

const pack = await loadContentPack('./content/base-pack.json');
// Two worlds per device: the 3D patch, and the life-size room garden used in AR room mode.
const stores = { patch: new LocalWorldStore('glowgrove.world'), room: new LocalWorldStore('glowgrove.world.room') };
const patchWorld = await stores.patch.load();
const isNewWorld = !patchWorld;
const worlds = { patch: patchWorld ?? createWorld(), room: (await stores.room.load()) ?? createRoomWorld() };
if (isNewWorld) stores.patch.save(worlds.patch);
let world = worlds.patch;

let saveTimer = 0;
function changed() {
  clearTimeout(saveTimer);
  const w = world;
  saveTimer = setTimeout(() => stores[w.kind === 'room' ? 'room' : 'patch'].save(w), 400);
}

/** Show a different world (entering or leaving AR room mode). */
function setActiveWorld(kind) {
  const next = worlds[kind];
  if (next === world) return;
  clearTimeout(saveTimer);
  stores[world.kind === 'room' ? 'room' : 'patch'].save(world);
  world = next;
  interaction?.deselect();
  garden.sync(world);
  hud.setRate(world.clock.rate);
  hud.setGrowth(world.settings.growthSpeed);
}

// Graphics quality is a per-device preference, so it lives in this browser, not in the world.
const QUALITY_KEY = 'glowgrove.quality';
function loadQuality() {
  try {
    const saved = localStorage.getItem(QUALITY_KEY);
    if (saved === 'high' || saved === 'low') return saved;
  } catch {}
  return (navigator.hardwareConcurrency ?? 8) <= 4 ? 'low' : 'high';
}
let quality = loadQuality();

const { renderer, scene, camera, controls, root, ground, setEnvironment, updateAmbient, render, setQuality, arMode } = createScene(
  document.getElementById('app'),
  world.zone.radiusM,
  quality
);
const garden = new GardenView(root, ground, pack);
garden.sync(world);

const hud = createHud(pack, {
  onRate(rate) {
    world.clock = withRate(world.clock, rate);
    hud.setRate(rate);
    changed();
  },
  onJump(to) {
    const { lat, lng } = world.location;
    const now = simNow(world.clock);
    // Night: just after dusk. Morning: once the sun is properly up.
    const target = to === 'night' ? findNextSunCrossing(now, lat, lng, -10, false) : findNextSunCrossing(now, lat, lng, 8, true);
    world.clock = jumpClock(world.clock, target);
    changed();
  },
  onGrowth(v) {
    world.settings.growthSpeed = v;
    changed();
  },
  onNewTree() {
    if (!world.anchors['tree-1']) return; // room mode has no virtual tree
    world.anchors['tree-1'] = makeTreeAnchor(randomSeed());
    world.entities = world.entities.filter((e) => e.anchorId !== 'tree-1');
    garden.sync(world);
    changed();
    hud.toast('A new tree. Anything growing on the old one went with it.');
  },
  onLocation() {
    if (!navigator.geolocation) {
      hud.setLocationNote("This browser can't share your location.");
      return;
    }
    hud.setLocationNote('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Rounded to ~10 km: enough for sun times, and nothing more precise is stored.
        const lat = Math.round(pos.coords.latitude * 10) / 10;
        const lng = Math.round(pos.coords.longitude * 10) / 10;
        for (const [kind, w] of Object.entries(worlds)) {
          w.location = { lat, lng, source: 'device-rounded' };
          stores[kind].save(w);
        }
        hud.setLocationNote(`Using your area (${lat}°, ${lng}°) for sunrise and sunset.`);
      },
      (err) => hud.setLocationNote(err.code === 1 ? 'Location permission was blocked. Day and night stay estimated.' : `Couldn't get your location: ${err.message}`),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 3600e3 }
    );
  },
  onShowGarden(kind) {
    if (ar?.active) return; // AR decides which garden is shown
    setActiveWorld(kind);
    if (kind === 'room') {
      // The home spot is the room garden's centre.
      controls.target.set(0, 0.6, 0);
      camera.position.set(3.5, 2.6, 4.5);
      hud.setHint('Preview of your room garden. The centre is your home spot', false, 4000);
      if (!world.entities.length) hud.toast('Your room garden is empty. Start it with <b>View in AR → Life-size room</b>.', 6000);
    } else {
      controls.target.set(0, 1.3, 0);
      camera.position.set(6.5, 3.6, 8.5);
    }
    controls.update();
  },
  onQuality(q) {
    quality = q;
    setQuality(q);
    hud.setQuality(q);
    try {
      localStorage.setItem(QUALITY_KEY, q);
    } catch {}
  },
  onClear() {
    world.entities = [];
    garden.sync(world);
    changed();
  },
});
hud.setRate(world.clock.rate);
hud.setGrowth(world.settings.growthSpeed);
hud.setQuality(quality);
if (world.location.source?.startsWith('device')) hud.setLocationNote(`Using your area (${world.location.lat}°, ${world.location.lng}°) for sunrise and sunset.`);

const lastAnnounced = new Map();
const flock = new BirdFlock(root, pack, (def) => {
  const t = performance.now();
  if (t - (lastAnnounced.get(def.id) ?? -Infinity) < 30000) return; // don't repeat the same species
  lastAnnounced.set(def.id, t);
  hud.toast(`<b>${esc(def.name)}</b> arrived, ${esc(def.reason)}.`);
});

// ---------------------------------------------------------------- tapping, planting, moving

var interaction = createInteraction({
  getWorld: () => world,
  pack,
  garden,
  root,
  camera,
  controls,
  canvas: renderer.domElement,
  container: document.getElementById('app'),
  hud,
  changed,
  isReadOnly: () => world.kind === 'room' && !ar?.active,
});

var ar = setupAR({
  renderer,
  scene,
  root,
  camera,
  arMode,
  hud,
  onSelectRay(origin, dir, real) {
    interaction.tapRay(origin, dir, real);
  },
  onModeChange(mode) {
    setActiveWorld(mode === 'room' ? 'room' : 'patch');
  },
  hasRoomGarden: () => worlds.room.entities.length > 0,
});

let pendingPhoto = null;
createCameraView({
  hud,
  arMode,
  root,
  renderer,
  controls,
  onPhotoRequest(capture) {
    pendingPhoto = capture; // taken right after the next frame is drawn
  },
});

// ---------------------------------------------------------------- loop

function dayNumber(now) {
  const startOf = (t) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  return Math.round((startOf(now) - startOf(world.createdAt)) / 86400e3) + 1;
}

function updateUi(now, night) {
  const time = new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const phase = night > 0.7 ? 'night' : night > 0.1 ? 'dusk' : 'day';
  hud.setClock(`Day ${dayNumber(now)} · ${time}`, phase);
  let plants = 0;
  let shrooms = 0;
  for (const e of world.entities) {
    if (pack.placeableById.get(e.type)?.category === 'mushroom') shrooms++;
    else plants++;
  }
  hud.setStats(`${plants} plants · ${shrooms} mushrooms · ${flock.birds.size} birds`);
  hud.setGardens({ patch: worlds.patch.entities.length, room: worlds.room.entities.length, active: world.kind === 'room' ? 'room' : 'patch' });
}

let visits = [];
let spots = { perch: [], hover: [], ground: [] };
let lastSlow = -1;
let lastT = performance.now() / 1000;

renderer.setAnimationLoop((_, frame) => {
  const t = performance.now() / 1000;
  const dt = Math.min(0.1, t - lastT);
  lastT = t;
  ar.update(frame);

  const now = simNow(world.clock);
  const night = setEnvironment(sunPosition(now, world.location.lat, world.location.lng));
  garden.update(world, now, night, t);

  if (t - lastSlow > 0.5) {
    lastSlow = t;
    visits = birdVisits(world, pack, now);
    spots = garden.birdSpots();
    updateUi(now, night);
    interaction.refreshCard();
  }
  flock.update(visits, spots, dt, t);

  if (!ar.active) controls.update();
  windTime.value = t;
  updateAmbient(t);
  render();
  if (pendingPhoto) {
    pendingPhoto();
    pendingPhoto = null;
    hud.setHint('Photo saved to your downloads', false, 2500);
  }
});

// Ask the browser not to clear our saved gardens when the phone is low on space.
navigator.storage?.persist?.().catch(() => {});

if (worlds.room.entities.length) {
  const n = worlds.room.entities.length;
  hud.toast(
    `Your life-size room garden has <b>${n} thing${n === 1 ? '' : 's'}</b> growing. To see ${n === 1 ? 'it' : 'them'} in your room: <b>View in AR → Life-size room</b>, then tap your home corner and edge.`,
    10000
  );
}

if (isNewWorld) {
  hud.toast('Welcome to your patch. Try putting <b>Glowcaps</b> on the tree, then open Settings and skip to night.', 9000);
}

// Handy for debugging in the browser console.
window.glowgrove = { world: () => world, worlds, setActiveWorld, interaction, pack, garden, flock, camera, controls, renderer, render };
