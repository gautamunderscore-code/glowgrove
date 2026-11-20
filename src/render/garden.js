// Turns world data into 3D objects and keeps them in sync each frame:
// growth scale, flower blooming and night-time glow.

import * as THREE from 'three';
import { maturity, glowLevel, smoothstep } from '../core/sim.js';
import { makeTree, makeMushroomCluster, makeFlower, makeIvy, makeMoss, makeRock, makeGrassClump, makePond, makePlaceholder } from './procedural.js';
import { getTextures } from './textures.js';

// Soft contact shadows: a dark blob under each thing that sits on the ground,
// so it looks planted rather than floating.
const aoGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
let aoMaterial = null;
function contactShadow(size) {
  aoMaterial ??= new THREE.MeshBasicMaterial({ map: getTextures().ao, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const m = new THREE.Mesh(aoGeometry, aoMaterial);
  m.scale.setScalar(size);
  m.position.y = 0.004;
  m.raycast = () => {};
  return m;
}
const AO_SIZE = { tree: 1.6, flower: 0.3, bell: 0.25, mushroom: 0.5, shelf: 0, ivy: 0, moss: 0, rock: 0.9, grass: 0.6, pond: 0 };

const easeOut = (t) => 1 - (1 - t) * (1 - t);

export class GardenView {
  constructor(root, ground, pack) {
    this.root = root;
    this.ground = ground;
    this.pack = pack;
    this.anchorObjs = new Map(); // anchorId -> { group, tree? , key }
    this.views = new Map(); // entityId -> view
    // A few shared lights that follow the brightest glowing mushrooms, so the
    // glow actually lights up the bark and ground around it. A fixed count
    // keeps shaders from recompiling.
    this.glowLights = Array.from({ length: 4 }, () => {
      const light = new THREE.PointLight('#ffffff', 0, 3, 2);
      root.add(light);
      return light;
    });

    // Selection ring, drawn on top of everything so it shows through bark.
    this.selectedId = null;
    this.dragValid = true;
    this.selRing = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 1, 48),
      new THREE.MeshBasicMaterial({ color: '#5fe3b9', transparent: true, opacity: 0.8, depthTest: false, depthWrite: false, side: THREE.DoubleSide })
    );
    this.selRing.renderOrder = 10;
    this.selRing.raycast = () => {};
  }

  setSelected(id) {
    this.selectedId = id;
    this.attachRing();
  }

  attachRing() {
    const view = this.selectedId && this.views.get(this.selectedId);
    if (!view) {
      this.selRing.removeFromParent();
      return;
    }
    const size = { tree: 0.7, flower: 0.24, bell: 0.2, mushroom: 0.3, shelf: 0.32 }[view.kind] ?? 0.25;
    const normal = new THREE.Vector3(...(view.entity.normal ?? [0, 1, 0])).normalize();
    this.selRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    this.selRing.position.copy(normal).multiplyScalar(0.015);
    this.selRing.scale.setScalar(size);
    view.group.add(this.selRing);
  }

  setDragValid(ok) {
    this.dragValid = ok;
  }

  /** While dragging: show the object at a new spot without changing the data yet. */
  previewMove(id, anchorId, position) {
    const view = this.views.get(id);
    const anchor = this.anchorGroup(anchorId);
    if (!view || !anchor) return;
    if (view.group.parent !== anchor) anchor.add(view.group);
    view.group.position.fromArray(position);
  }

  /** Put a view back where its data says it is (e.g. a cancelled drag). */
  refresh(id) {
    const view = this.views.get(id);
    if (!view) return;
    (this.anchorGroup(view.entity.anchorId) ?? this.root).add(view.group);
    view.group.position.fromArray(view.entity.position);
  }

  /** Create or rebuild anchor objects (the ground, detected trees, ...). */
  syncAnchors(world) {
    const rebuilt = new Set();
    for (const [id, anchor] of Object.entries(world.anchors)) {
      const key = JSON.stringify(anchor);
      const existing = this.anchorObjs.get(id);
      if (existing?.key === key) continue;
      if (existing) this.root.remove(existing.group);
      rebuilt.add(id);

      const group = new THREE.Group();
      const local = anchor.fingerprints.find((f) => f.kind === 'local');
      if (local) group.position.fromArray(local.position);
      let tree = null;
      if (anchor.feature?.type === 'tree') {
        tree = makeTree(anchor.feature.seed);
        group.add(tree.group);
        group.add(contactShadow(tree.height * 0.6));
      }
      this.root.add(group);
      this.anchorObjs.set(id, { group, tree, key });
    }
    for (const id of [...this.anchorObjs.keys()]) {
      if (!world.anchors[id]) {
        this.root.remove(this.anchorObjs.get(id).group);
        this.anchorObjs.delete(id);
        rebuilt.add(id);
      }
    }
    return rebuilt;
  }

  anchorGroup(anchorId) {
    return this.anchorObjs.get(anchorId)?.group ?? null;
  }

  /** Add views for new entities, remove views for deleted ones. */
  sync(world) {
    const rebuiltAnchors = this.syncAnchors(world);
    const byId = new Map(world.entities.map((e) => [e.id, e]));
    for (const [id, view] of this.views) {
      // Entities are replaced (not edited) when they change, so a different
      // object means "rebuild this one", e.g. after a move.
      if (byId.get(id) !== view.entity || rebuiltAnchors.has(view.entity.anchorId)) {
        view.group.parent?.remove(view.group);
        this.views.delete(id);
      }
    }
    for (const entity of world.entities) {
      if (!this.views.has(entity.id)) {
        const view = this.buildView(entity);
        // Things planted (not loaded) pop in with a little bounce.
        if (this.loaded) view.popStart = performance.now() / 1000;
        this.views.set(entity.id, view);
      }
    }
    if (this.selectedId && !this.views.has(this.selectedId)) this.selectedId = null;
    this.attachRing();
    this.loaded = true;
  }

  buildView(entity) {
    const def = this.pack.placeableById.get(entity.type);
    const kind = def?.model.kind ?? 'unknown';
    let built;
    if (kind === 'mushroom' || kind === 'shelf') built = makeMushroomCluster(def, entity.seed, entity.normal ?? [0, 1, 0]);
    else if (kind === 'flower' || kind === 'bell') built = makeFlower(def, entity.seed);
    else if (kind === 'tree') built = makeTree(entity.seed, { height: def.model.height, surface: 'young-bark' });
    else if (kind === 'ivy') built = makeIvy(def, entity.seed, entity.normal ?? [0, 0, 1]);
    else if (kind === 'moss') built = makeMoss(def, entity.seed, entity.normal ?? [0, 1, 0]);
    else if (kind === 'rock') built = makeRock(def, entity.seed);
    else if (kind === 'grass') built = makeGrassClump(def, entity.seed);
    else if (kind === 'pond') built = makePond(def, entity.seed);
    else built = makePlaceholder();

    const group = new THREE.Group();
    group.add(built.group);
    const aoSize = (AO_SIZE[kind] ?? 0.3) * (kind === 'flower' ? def.model.height * 2 : 1);
    const onFloor = (entity.normal?.[1] ?? 1) > 0.7 && entity.anchorId !== 'tree-1';
    if (onFloor && aoSize > 0) built.group.add(contactShadow(aoSize));
    group.position.fromArray(entity.position);
    group.scale.setScalar(entity.scale ?? 1);
    group.traverse((o) => (o.userData.entityId = entity.id));
    (this.anchorGroup(entity.anchorId) ?? this.root).add(group);

    // `built.group` is the inner model (scaled by growth); `group` is the outer
    // holder (positioned and sized by the player). Keep them distinct.
    return { ...built, entity, def, kind, group, inner: built.group, phase: (entity.seed % 1000) / 159 };
  }

  update(world, now, night, timeSec) {
    this.selRing.material.color.set(this.dragValid ? '#5fe3b9' : '#ff6b5a');
    this.selRing.material.opacity = 0.6 + 0.3 * Math.sin(timeSec * 5);
    const glowing = [];
    for (const view of this.views.values()) {
      // Ripples drift slowly across ponds.
      if (view.water) view.water.normalMap.offset.set(timeSec * 0.012, timeSec * 0.008);
    }
    for (const view of this.views.values()) {
      const { def, kind } = view;
      if (!def) continue;
      const m = maturity(view.entity, def, now, world.settings.growthSpeed);
      view.maturity = m;
      let pop = 1;
      if (view.popStart !== undefined) {
        const t = Math.min(1, (timeSec - view.popStart) / 0.6);
        pop = t >= 1 ? 1 : 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2; // ease-out with a slight overshoot
        if (t >= 1) view.popStart = undefined;
      }

      if (kind === 'tree') {
        view.inner.scale.setScalar((0.15 + 0.85 * easeOut(m)) * pop);
      } else if (kind === 'flower' || kind === 'bell') {
        view.inner.scale.setScalar((0.3 + 0.7 * easeOut(Math.min(1, m * 1.3))) * pop);
        view.head.scale.setScalar(0.3 + 0.7 * smoothstep(0.3, 1, m));
        // Flowers close up a little at night.
        if (kind === 'flower') view.head.scale.y *= 1 - 0.4 * night;
      } else {
        view.inner.scale.setScalar((0.3 + 0.7 * easeOut(m)) * pop);
      }

      if (view.glowMats) {
        const pulse = 0.8 + 0.2 * Math.sin(timeSec * 1.3 + view.phase);
        const g = glowLevel(def, m, night) * pulse;
        for (const mat of view.glowMats) mat.emissiveIntensity = g * 1.6;
        for (const halo of view.halos) halo.material.opacity = g * 0.45;
        if (g > 0.05) glowing.push({ view, g });
      }
    }

    glowing.sort((a, b) => b.g - a.g);
    this.root.updateMatrixWorld();
    this.glowLights.forEach((light, i) => {
      const item = glowing[i];
      if (!item) {
        light.intensity = 0;
        return;
      }
      light.color.set(item.view.def.glow.color);
      light.intensity = item.g * 2.5;
      const p = item.view.group.localToWorld(new THREE.Vector3(0, 0.15, 0));
      light.position.copy(this.root.worldToLocal(p));
    });
  }

  /** Change an entity's data without rebuilding its model (e.g. resizing). */
  updateEntity(entity) {
    const view = this.views.get(entity.id);
    if (!view) return;
    view.entity = entity;
    view.group.scale.setScalar(entity.scale ?? 1);
  }

  /** Raycast targets: ground, tree bark and existing entities. */
  pickTargets() {
    // Hidden things still get hit by rays, so leave out the ground when it's hidden (room mode).
    const targets = this.ground.visible ? [this.ground] : [];
    for (const { tree } of this.anchorObjs.values()) if (tree) targets.push(...tree.barkMeshes, ...tree.foliage);
    for (const view of this.views.values()) targets.push(view.group);
    return targets;
  }

  /** Spots where birds can land, in root-local coordinates, grouped by type. */
  birdSpots() {
    const toRoot = (obj, p) => this.root.worldToLocal(obj.localToWorld(p.clone()));
    const spots = { perch: [], hover: [], ground: [], water: [] };
    this.root.updateMatrixWorld(true);
    for (const { tree } of this.anchorObjs.values()) {
      if (tree) for (const p of tree.perches) spots.perch.push(toRoot(tree.group, p));
    }
    for (const view of this.views.values()) {
      if (!view.def || (view.maturity ?? 0) < 0.6) continue;
      if (view.kind === 'tree') for (const p of view.perches) spots.perch.push(toRoot(view.inner, p));
      if (view.kind === 'pond') for (const p of view.edge) spots.water.push(toRoot(view.inner, p));
      if (view.kind === 'rock') spots.ground.push(toRoot(view.group, new THREE.Vector3(0, view.def.model.size * 0.5, 0)));
      if (view.kind === 'flower' || view.kind === 'bell') {
        const head = toRoot(view.inner, view.top);
        if (view.def.tags.includes('nectar')) spots.hover.push(head);
        spots.ground.push(toRoot(view.group, new THREE.Vector3()));
      }
    }
    return spots;
  }
}
