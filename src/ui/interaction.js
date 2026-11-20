// Tapping, selecting, dragging and planting. Planting and moving share the
// same placement rules (right surface, inside the zone, not on top of
// something else).

import * as THREE from 'three';
import { createEntity } from '../core/model.js';
import { simNow, maturity, HOUR } from '../core/sim.js';

const MAX_ENTITIES = 150;
const SURFACE_LABELS = { bark: 'tree bark', ground: 'soil' };
const DRAG_START_PX = 6;
const TAP_MAX_PX = 8;
const TAP_MAX_MS = 500;

const round3 = (n) => Math.round(n * 1000) / 1000;

export function entityIdOf(obj) {
  for (let o = obj; o; o = o.parent) if (o.userData.entityId) return o.userData.entityId;
  return null;
}

export function createInteraction({ getWorld, pack, garden, root, camera, controls, canvas, container, hud, changed }) {
  const raycaster = new THREE.Raycaster();
  let selectedId = null;
  let press = null;

  // ------------------------------------------------------------ helpers

  function aimAt(e) {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }

  function firstHit(exclude) {
    const targets = garden.pickTargets().filter((t) => t !== exclude);
    return raycaster.intersectObjects(targets, true)[0] ?? null;
  }

  /** Can `def` go where the ray hit? Returns where, in anchor terms, or why not. */
  function evaluateSpot(def, hit) {
    if (!hit) return { ok: false, reason: '' };
    if (entityIdOf(hit.object)) return { ok: false, reason: "It's crowded there. Try a clear spot" };
    const surface = hit.object.userData.surface;
    if (!def.surfaces.includes(surface)) {
      return { ok: false, reason: `${def.name} needs ${def.surfaces.map((s) => SURFACE_LABELS[s] ?? s).join(' or ')}` };
    }
    const local = root.worldToLocal(hit.point.clone());
    if (Math.hypot(local.x, local.z) > getWorld().zone.radiusM) return { ok: false, reason: "That's outside your patch" };
    const anchorId = surface === 'bark' ? 'tree-1' : 'ground';
    return {
      ok: true,
      anchorId,
      position: garden.anchorGroup(anchorId).worldToLocal(hit.point.clone()).toArray().map(round3),
      normal: hit.face.normal.clone().transformDirection(hit.object.matrixWorld).toArray().map(round3),
    };
  }

  // ------------------------------------------------------------ actions

  function select(id) {
    selectedId = id;
    garden.setSelected(id);
    refreshCard();
  }

  function removeEntity(id) {
    const world = getWorld();
    world.entities = world.entities.filter((e) => e.id !== id);
    if (selectedId === id) select(null);
    garden.sync(world);
    changed();
  }

  function plant(tool, hit) {
    const world = getWorld();
    const def = pack.placeableById.get(tool);
    if (world.entities.length >= MAX_ENTITIES) {
      hud.setHint('Your patch is full. Remove something first', true, 3000);
      return;
    }
    const spot = evaluateSpot(def, hit);
    if (!spot.ok) {
      if (spot.reason) hud.setHint(spot.reason, true, 3000);
      return;
    }
    world.entities.push(createEntity({ type: tool, anchorId: spot.anchorId, position: spot.position, normal: spot.normal, plantedAt: simNow(world.clock) }));
    garden.sync(world);
    changed();
  }

  function tap() {
    const tool = hud.activeTool;
    const hit = firstHit();
    const entityId = hit ? entityIdOf(hit.object) : null;

    if (tool === 'remove') {
      if (entityId) removeEntity(entityId);
      else hud.setHint('Tap something you planted to remove it', true, 2500);
      return;
    }
    // Tapping something already planted selects it, whatever tool is active.
    if (entityId) {
      select(entityId === selectedId ? null : entityId);
      return;
    }
    if (!tool || tool === 'move') {
      if (selectedId) select(null);
      else if (!tool) hud.setHint('Pick something from the bar below first', true, 2500);
      else hud.setHint('Tap something you planted to select it, or just drag it', true, 2500);
      return;
    }
    if (hit) plant(tool, hit);
  }

  function commitMove(p) {
    const world = getWorld();
    const i = world.entities.findIndex((e) => e.id === p.entityId);
    if (i < 0) return;
    if (!p.lastValid) {
      garden.refresh(p.entityId);
      return;
    }
    const { anchorId, position, normal } = p.lastValid;
    world.entities[i] = { ...world.entities[i], anchorId, position, normal };
    garden.sync(world);
    changed();
    hud.setHint('Moved', false, 1500);
  }

  function cancelPress() {
    if (press?.dragging) garden.refresh(press.entityId);
    garden.setDragValid(true);
    press = null;
    controls.enabled = true;
  }

  // ------------------------------------------------------------ pointer events
  // Listening in the capture phase on the container means we see a press
  // before the camera controls do, so dragging a plant doesn't spin the view.

  container.addEventListener(
    'pointerdown',
    (e) => {
      if (press) {
        cancelPress(); // a second finger: that's a pinch, hand over to the camera
        return;
      }
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      aimAt(e);
      const hit = firstHit();
      const entityId = hit ? entityIdOf(hit.object) : null;
      const canDrag = !!entityId && hud.activeTool !== 'remove';
      press = { x: e.clientX, y: e.clientY, t: performance.now(), pointerId: e.pointerId, entityId: canDrag ? entityId : null, dragging: false, lastValid: null };
      if (canDrag) controls.enabled = false;
    },
    true
  );

  window.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.pointerId || !press.entityId) return;
    if (!press.dragging) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_START_PX) return;
      press.dragging = true;
      select(press.entityId);
    }
    const view = garden.views.get(press.entityId);
    if (!view?.def) return;
    aimAt(e);
    const spot = evaluateSpot(view.def, firstHit(view.group));
    garden.setDragValid(spot.ok);
    if (spot.ok) {
      press.lastValid = spot;
      garden.previewMove(press.entityId, spot.anchorId, spot.position);
      hud.setHint(`Moving ${view.def.name}. Let go to drop it`);
    } else {
      hud.setHint(spot.reason || "Can't go there", true);
    }
  });

  const finish = (e) => {
    if (!press || e.pointerId !== press.pointerId) return;
    const p = press;
    press = null;
    controls.enabled = true;
    garden.setDragValid(true);
    if (p.dragging) {
      commitMove(p);
      return;
    }
    if (e.type === 'pointercancel') return;
    const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    if (moved > TAP_MAX_PX || performance.now() - p.t > TAP_MAX_MS) return; // camera drag
    aimAt(e);
    tap();
  };
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);

  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    if (e.key === 'Escape') select(null);
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      e.preventDefault();
      removeEntity(selectedId);
    }
  });

  // ------------------------------------------------------------ info card

  function refreshCard() {
    const world = getWorld();
    const entity = selectedId && world.entities.find((e) => e.id === selectedId);
    if (!entity) {
      if (selectedId) select(null);
      hud.hideSelection();
      return;
    }
    const def = pack.placeableById.get(entity.type);
    const now = simNow(world.clock);
    const m = maturity(entity, def, now, world.settings.growthSpeed);
    const growth = m >= 1 ? 'Fully grown' : `${Math.floor(m * 100)}% grown`;
    hud.showSelection(def?.name ?? 'Unknown', `${growth} · planted ${formatAge(now - entity.plantedAt)}`);
  }

  hud.onSelectionAction((action) => {
    if (action === 'delete' && selectedId) removeEntity(selectedId);
    if (action === 'done') select(null);
  });

  return {
    refreshCard,
    /** For AR: a tap arrives as a ray instead of a screen position. */
    tapRay(origin, dir) {
      raycaster.set(origin, dir);
      tap();
    },
    deselect: () => select(null),
  };
}

function formatAge(ms) {
  if (ms < HOUR) return 'just now';
  if (ms < 48 * HOUR) return `${Math.floor(ms / HOUR)} h ago`;
  return `${Math.floor(ms / (24 * HOUR))} days ago`;
}
