// Procedural 3D models. Every tree, mushroom, flower and bird is generated
// from a seed and the numbers in the content pack, so the game ships with
// endless variety and zero paid art. Real glTF models can replace any of
// these later, one kind at a time.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { getTextures } from './textures.js';
import { addWind } from './wind.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0);

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
}

function shadowy(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A tapered cylinder running from a to b. */
function limb(a, b, rA, rB, material, radial = 7) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(rB, rA, len, radial, 1);
  geo.translate(0, len / 2, 0);
  const mesh = shadowy(new THREE.Mesh(geo, material));
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  return mesh;
}

function joint(p, r, material) {
  const mesh = shadowy(new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), material));
  mesh.position.copy(p);
  return mesh;
}


/**
 * Combines the plain meshes under `container` that share a material into one
 * mesh each. A flower made of 40 parts becomes ~4 draw calls, which is what
 * keeps phones fast. Subtrees in `skip`, sprites, points and instanced
 * meshes are left alone. Returns the new meshes.
 */
export function mergeByMaterial(container, skip = new Set()) {
  container.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(container.matrixWorld).invert();
  const buckets = new Map();
  const visit = (obj) => {
    for (const child of [...obj.children]) {
      if (skip.has(child)) continue;
      if (child.isMesh && !child.isInstancedMesh && !child.userData.noMerge) {
        const key = child.material;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(child);
      }
      visit(child);
    }
  };
  visit(container);

  const merged = [];
  for (const [material, meshes] of buckets) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => {
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      return g;
    });
    // Keep only attributes every part has.
    const names = Object.keys(geos[0].attributes).filter((n) => geos.every((g) => g.attributes[n]));
    for (const g of geos) for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
    const geo = mergeGeometries(geos);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = meshes.some((m) => m.castShadow);
    mesh.receiveShadow = meshes.some((m) => m.receiveShadow);
    mesh.userData = { ...meshes[0].userData };
    for (const m of meshes) m.removeFromParent();
    container.add(mesh);
    merged.push(mesh);
  }
  return merged;
}

// ---------------------------------------------------------------- tree

/**
 * Builds a tree from a seed. Shape, lean, branch count, bark and leaf colour
 * all vary, which is how we test that placement adapts to any tree.
 * Returns bark meshes (placement surfaces) and perch points for birds.
 */
export function makeTree(seed, opts = {}) {
  const rnd = mulberry32(seed);
  const group = new THREE.Group();
  const height = opts.height ? opts.height * (0.85 + rnd() * 0.3) : 3 + rnd() * 2.5;
  const baseR = opts.height ? height * 0.035 : 0.15 + rnd() * 0.17;
  const surface = opts.surface ?? 'bark';

  const tex = getTextures();
  const barkMap = tex.bark.map.clone();
  const barkNormal = tex.bark.normalMap.clone();
  for (const t of [barkMap, barkNormal]) {
    t.repeat.set(2, Math.max(2, Math.round(height / 1.2)));
    t.needsUpdate = true;
  }
  const bark = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.07 + rnd() * 0.04, 0.25 + rnd() * 0.15, 0.2 + rnd() * 0.07),
    map: barkMap,
    normalMap: barkNormal,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughness: 0.95,
  });
  const leafHue = 0.2 + rnd() * 0.12;
  // Dark inner volume so the canopy never looks see-through.
  const innerLeafMat = mat(new THREE.Color().setHSL(leafHue, 0.5, 0.05), { roughness: 1, envMapIntensity: 0.3 });

  const barkMeshes = [];
  const perches = [];
  const addBark = (m) => {
    m.userData.surface = surface;
    barkMeshes.push(m);
    group.add(m);
  };

  // Trunk: a gently leaning, kinked column.
  const segs = 5;
  const leanX = (rnd() - 0.5) * 0.6;
  const leanZ = (rnd() - 0.5) * 0.6;
  const pts = [new THREE.Vector3()];
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    pts.push(new THREE.Vector3(leanX * t * t + (rnd() - 0.5) * 0.12, height * t, leanZ * t * t + (rnd() - 0.5) * 0.12));
  }
  const radiusAt = (t) => baseR * (1 - 0.72 * t);
  const pointAt = (t) => {
    const f = t * segs;
    const i = Math.min(segs - 1, Math.floor(f));
    return pts[i].clone().lerp(pts[i + 1], f - i);
  };
  for (let i = 0; i < segs; i++) {
    addBark(limb(pts[i], pts[i + 1], radiusAt(i / segs), radiusAt((i + 1) / segs), bark, 14));
    addBark(joint(pts[i + 1], radiusAt((i + 1) / segs), bark));
  }

  // Root flare.
  const roots = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * Math.PI * 2 + rnd();
    const out = new THREE.Vector3(Math.cos(a) * baseR * 2.4, -0.02, Math.sin(a) * baseR * 2.4);
    addBark(limb(new THREE.Vector3(0, baseR * 1.6, 0), out, baseR * 0.5, baseR * 0.15, bark, 6));
  }

  const foliage = [];
  const leafSpots = []; // { center, radius } spheres to cover with leaf cards
  const addFoliage = (center, size) => {
    const blobs = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < blobs; i++) {
      const r = size * (0.45 + rnd() * 0.4);
      const c = new THREE.Vector3(center.x + (rnd() - 0.5) * size, center.y + (rnd() - 0.3) * size * 0.7, center.z + (rnd() - 0.5) * size);
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.6, 2), innerLeafMat);
      m.position.copy(c);
      m.receiveShadow = true;
      m.userData.surface = 'foliage';
      foliage.push(m);
      group.add(m);
      leafSpots.push({ center: c, radius: r });
    }
  };

  // Branches.
  const branchCount = 3 + Math.floor(rnd() * 4);
  for (let b = 0; b < branchCount; b++) {
    const t = 0.4 + rnd() * 0.45;
    const start = pointAt(t);
    const ang = (b / branchCount) * Math.PI * 2 + rnd() * 0.8;
    const len = height * (0.25 + rnd() * 0.2) * (1.1 - t * 0.5);
    const dir = new THREE.Vector3(Math.cos(ang), 0.45 + rnd() * 0.6, Math.sin(ang)).normalize();
    const mid = start.clone().addScaledVector(dir, len * 0.55);
    const dir2 = dir.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.5, 0.3, (rnd() - 0.5) * 0.5)).normalize();
    const end = mid.clone().addScaledVector(dir2, len * 0.45);
    const r0 = radiusAt(t) * 0.55;
    addBark(limb(start, mid, r0, r0 * 0.6, bark));
    addBark(joint(mid, r0 * 0.6, bark));
    addBark(limb(mid, end, r0 * 0.6, r0 * 0.25, bark, 6));
    perches.push(start.clone().lerp(mid, 0.7).add(new THREE.Vector3(0, r0 * 0.65, 0)));
    addFoliage(end, height * (0.17 + rnd() * 0.08));
  }
  addFoliage(pts[segs], height * (0.22 + rnd() * 0.08));

  const cards = makeLeafCards(leafSpots, height, leafHue, rnd);
  cards.userData.surface = 'foliage';

  // Bark parts -> one mesh, canopy blobs -> one mesh.
  const merged = mergeByMaterial(group);
  const mergedBark = merged.filter((m) => m.material === bark);
  const mergedFoliage = merged.filter((m) => m.material === innerLeafMat);
  group.add(cards);

  return {
    group,
    barkMeshes: mergedBark.length ? mergedBark : barkMeshes,
    perches,
    foliage: [...(mergedFoliage.length ? mergedFoliage : foliage), cards],
    height,
  };
}

/** Hundreds of small leafy cards scattered over each canopy blob, in one draw call. */
function makeLeafCards(spots, treeHeight, hue, rnd) {
  const tex = getTextures();
  // Big trees use more, smaller-relative leaves instead of giant cards.
  const cardSize = Math.min(0.55, treeHeight * 0.1);
  const density = ((treeHeight * 0.1) / cardSize) ** 2;
  const perSpot = spots.map((s) => Math.min(2200, Math.round((40 + s.radius * s.radius * 220) * Math.min(density, 6))));
  const count = perSpot.reduce((a, b) => a + b, 0);
  const material = addWind(
    new THREE.MeshStandardMaterial({ map: tex.leaf, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.7 }),
    0.025,
    'card'
  );
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex.leaf, alphaTest: 0.45 });

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const dir = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const color = new THREE.Color();
  let i = 0;
  spots.forEach((spot, k) => {
    for (let n = 0; n < perSpot[k]; n++, i++) {
      dir.set(rnd() * 2 - 1, rnd() * 2 - 0.7, rnd() * 2 - 1).normalize();
      pos.copy(spot.center).addScaledVector(dir, spot.radius * (0.45 + rnd() * 0.55));
      q.setFromEuler(new THREE.Euler(rnd() * Math.PI, rnd() * Math.PI * 2, rnd() * Math.PI));
      scl.setScalar(cardSize * (0.8 + rnd() * 0.6));
      mesh.setMatrixAt(i, m4.compose(pos, q, scl));
      // Outer, upper leaves catch more light.
      const light = 0.55 + 0.35 * Math.max(0, dir.y) + rnd() * 0.15;
      mesh.setColorAt(i, color.setHSL(hue + (rnd() - 0.5) * 0.06, 0.35 + rnd() * 0.2, light * 0.75));
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// ---------------------------------------------------------------- glow halo

let glowTexture = null;
function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}

function makeHalo(color, size) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: getGlowTexture(), color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  sprite.scale.setScalar(size);
  sprite.raycast = () => {}; // never block taps
  return sprite;
}

// ---------------------------------------------------------------- mushrooms

/**
 * A small cluster of mushrooms growing out of a surface whose outward
 * direction is `normal`. Works on any bark angle or on the ground.
 */
export function makeMushroomCluster(def, seed, normal) {
  const rnd = mulberry32(seed);
  const model = def.model;
  const tex = getTextures();
  const group = new THREE.Group();
  const glowColor = new THREE.Color(def.glow?.color ?? '#ffffff');
  const glowMats = [];
  const halos = [];

  const n = new THREE.Vector3(...normal).normalize();
  const t1 = Math.abs(n.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3().crossVectors(UP, n).normalize();
  const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();

  const [cMin, cMax] = model.cluster ?? [1, 1];
  const count = cMin + Math.floor(rnd() * (cMax - cMin + 1));
  const capColor = new THREE.Color(model.capColor);

  const capMats = new Map();
  const capMaterial = (extra = {}) => {
    const key = Object.keys(extra).join(',');
    if (capMats.has(key)) return capMats.get(key);
    const m = new THREE.MeshPhysicalMaterial({
      color: capColor.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.06),
      roughness: 0.55,
      sheen: 0.8,
      sheenRoughness: 0.45,
      sheenColor: capColor.clone().lerp(new THREE.Color('#ffffff'), 0.5),
      emissive: glowColor,
      emissiveIntensity: 0,
      side: THREE.DoubleSide,
      ...extra,
    });
    glowMats.push(m);
    capMats.set(key, m);
    return m;
  };
  const stemMat = mat(model.stemColor, { emissive: glowColor, emissiveIntensity: 0, roughness: 0.75, normalMap: tex.bark.normalMap, normalScale: new THREE.Vector2(0.35, 0.35) });
  const gillMat = mat(new THREE.Color(model.stemColor).multiplyScalar(0.85), { map: tex.gills, emissive: glowColor, emissiveIntensity: 0, side: THREE.DoubleSide });
  const spotMat = model.spots ? mat(model.spots, { roughness: 0.6, emissive: glowColor, emissiveIntensity: 0 }) : null;
  glowMats.push(stemMat, gillMat);
  if (spotMat) glowMats.push(spotMat);

  for (let i = 0; i < count; i++) {
    const size = model.size * (0.6 + rnd() * 0.6) * (i === 0 ? 1 : 0.7);

    if (model.kind === 'shelf') {
      // Half-disc brackets stacked up the trunk, facing outward, with growth rings on top.
      const offset = t1.clone().multiplyScalar((rnd() - 0.5) * size * 0.8).addScaledVector(UP, i * size * 0.75 - size * 0.3);
      const geo = new THREE.CylinderGeometry(size, size * 1.06, size * 0.14, 28, 1, false, -Math.PI / 2, Math.PI);
      const shelf = shadowy(new THREE.Mesh(geo, capMaterial({ map: tex.rings, roughness: 0.7 })));
      const h = new THREE.Vector3(n.x, 0, n.z);
      if (h.lengthSq() < 1e-4) h.set(0, 0, 1);
      h.normalize();
      shelf.rotation.y = Math.atan2(h.x, h.z);
      shelf.rotation.x = -0.08;
      shelf.position.copy(offset).addScaledVector(h, -size * 0.15);
      group.add(shelf);
      const halo = makeHalo(glowColor, size * 3.2);
      halo.position.copy(shelf.position).addScaledVector(h, size * 0.5);
      halos.push(halo);
      group.add(halo);
      continue;
    }

    // Stalked mushroom: the stem bends from the surface toward the sky.
    const puff = model.cap === 'puff';
    const base = t1.clone().multiplyScalar((rnd() - 0.5) * model.size * 1.6).addScaledVector(t2, (rnd() - 0.5) * model.size * 1.6);
    const stemDir = n.clone().lerp(UP, puff ? 0.8 : 0.6).add(new THREE.Vector3((rnd() - 0.5) * 0.25, 0, (rnd() - 0.5) * 0.25)).normalize();
    const stemLen = puff ? size * 0.3 : size * (0.9 + rnd() * 0.6);
    const mid = base.clone().addScaledVector(stemDir, stemLen * 0.5).addScaledVector(t1, (rnd() - 0.5) * size * 0.15);
    const top = base.clone().addScaledVector(stemDir, stemLen);
    group.add(limb(base, mid, size * 0.25, size * 0.19, stemMat, 12));
    group.add(limb(mid, top, size * 0.19, size * 0.16, stemMat, 12));
    group.add(joint(mid, size * 0.19, stemMat));

    const capUp = stemDir.clone().lerp(UP, 0.5).normalize();
    const cap = new THREE.Group();
    cap.position.copy(top);
    cap.quaternion.setFromUnitVectors(UP, capUp);
    group.add(cap);

    if (puff) {
      const ball = shadowy(
        new THREE.Mesh(
          new THREE.SphereGeometry(size * 0.55, 24, 18),
          capMaterial({ normalMap: tex.bark.normalMap, normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.8 })
        )
      );
      ball.scale.y = 0.85;
      cap.add(ball);
    } else {
      const r = size * 0.6;
      const dome = shadowy(new THREE.Mesh(new THREE.SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), capMaterial()));
      dome.scale.y = 0.72;
      cap.add(dome);
      // Gills underneath: they glow too, which looks lovely from below.
      const gills = new THREE.Mesh(new THREE.RingGeometry(size * 0.15, r * 0.98, 40, 1), gillMat);
      gills.rotation.x = Math.PI / 2;
      gills.position.y = 0.002;
      cap.add(gills);
      // Spots.
      if (model.spots) {
        const spots = 5 + Math.floor(rnd() * 6);
        for (let k = 0; k < spots; k++) {
          const theta = rnd() * Math.PI * 2;
          const phi = rnd() * 1.15;
          const d = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
          const spot = new THREE.Mesh(new THREE.SphereGeometry(r * (0.07 + rnd() * 0.06), 8, 6), spotMat);
          spot.position.set(d.x * r, d.y * r * 0.72, d.z * r);
          spot.scale.y = 0.35;
          spot.quaternion.setFromUnitVectors(UP, d);
          cap.add(spot);
        }
      }
    }

    const halo = makeHalo(glowColor, size * 3.5);
    halo.position.copy(top).addScaledVector(UP, size * 0.2);
    halos.push(halo);
    group.add(halo);
  }

  mergeByMaterial(group);
  return { group, glowMats, halos };
}


// ---------------------------------------------------------------- wall plants

/** Basis vectors for a surface: n = out of the surface, down = along it, downhill. */
function surfaceBasis(normal) {
  const n = new THREE.Vector3(...normal).normalize();
  const down = new THREE.Vector3(0, -1, 0).addScaledVector(n, n.y); // gravity projected onto the surface
  if (down.lengthSq() < 1e-4) down.set(1, 0, 0).addScaledVector(n, -n.x);
  down.normalize();
  const side = new THREE.Vector3().crossVectors(n, down).normalize();
  return { n, down, side };
}

/** Trailing ivy hanging from where it was planted, hugging the wall or trunk. */
export function makeIvy(def, seed, normal) {
  const rnd = mulberry32(seed);
  const model = def.model;
  const tex = getTextures();
  const group = new THREE.Group();
  const { n, down, side } = surfaceBasis(normal);
  const stemMat = mat('#3d4a22', { roughness: 0.9 });
  const leafSpots = [];

  const [vMin, vMax] = model.vines ?? [3, 5];
  const vines = vMin + Math.floor(rnd() * (vMax - vMin + 1));
  for (let v = 0; v < vines; v++) {
    const len = model.length * (0.5 + rnd() * 0.7);
    const startSide = (rnd() - 0.5) * 0.25;
    const wiggle = 0.03 + rnd() * 0.05;
    const phase = rnd() * 6;
    const steps = 10;
    let prev = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = new THREE.Vector3()
        .addScaledVector(side, startSide + Math.sin(t * 7 + phase) * wiggle + t * (rnd() - 0.5) * 0.1)
        .addScaledVector(down, t * len)
        .addScaledVector(n, 0.012);
      if (prev) group.add(limb(prev, p, 0.005, 0.004, stemMat, 5));
      // Leaves along the vine, denser near the top.
      const leaves = i === 0 ? 3 : 2;
      for (let k = 0; k < leaves; k++) leafSpots.push(p.clone().addScaledVector(side, (rnd() - 0.5) * 0.06));
      prev = p;
    }
  }

  const leafMat = addWind(new THREE.MeshStandardMaterial({ map: tex.leaf, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.6, color: model.leafColor }), 0.008, 'card');
  const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), leafMat, leafSpots.length);
  leaves.castShadow = true;
  leaves.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex.leaf, alphaTest: 0.45 });
  const m4 = new THREE.Matrix4();
  const face = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  const color = new THREE.Color();
  leafSpots.forEach((p, i) => {
    const spin = new THREE.Quaternion().setFromAxisAngle(n, rnd() * Math.PI * 2);
    const tilt = new THREE.Quaternion().setFromAxisAngle(side, (rnd() - 0.5) * 0.8);
    const q = spin.multiply(tilt).multiply(face);
    m4.compose(p.clone().addScaledVector(n, 0.01 + rnd() * 0.02), q, new THREE.Vector3().setScalar(0.07 + rnd() * 0.05));
    leaves.setMatrixAt(i, m4);
    leaves.setColorAt(i, color.setHSL(0.27 + (rnd() - 0.5) * 0.05, 0.4, 0.6 + rnd() * 0.25));
  });
  leaves.instanceMatrix.needsUpdate = true;
  leaves.computeBoundingSphere();
  group.add(leaves);
  mergeByMaterial(group);
  return { group };
}

/** A soft, glowing carpet of moss that hugs any surface. */
export function makeMoss(def, seed, normal) {
  const rnd = mulberry32(seed);
  const model = def.model;
  const group = new THREE.Group();
  const { n, down, side } = surfaceBasis(normal);
  const glowColor = new THREE.Color(def.glow?.color ?? '#ffffff');
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, emissive: glowColor, emissiveIntensity: 0 });
  const count = 90;
  const tufts = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), material, count);
  tufts.receiveShadow = true;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  const base = new THREE.Color(model.color);
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(rnd()) * model.size * (0.6 + rnd() * 0.5);
    const a = rnd() * Math.PI * 2;
    const p = new THREE.Vector3().addScaledVector(side, Math.cos(a) * r).addScaledVector(down, Math.sin(a) * r * 1.2);
    const s = model.size * (0.06 + rnd() * 0.08) * (1 - (r / model.size) * 0.5);
    m4.compose(p, q, new THREE.Vector3(s, s * 0.45, s));
    tufts.setMatrixAt(i, m4);
    tufts.setColorAt(i, color.copy(base).offsetHSL((rnd() - 0.5) * 0.06, 0, (rnd() - 0.5) * 0.12));
  }
  tufts.instanceMatrix.needsUpdate = true;
  tufts.computeBoundingSphere();
  group.add(tufts);
  const halo = makeHalo(glowColor, model.size * 3);
  halo.position.copy(n).multiplyScalar(0.03);
  group.add(halo);
  return { group, glowMats: [material], halos: [halo] };
}

// ---------------------------------------------------------------- flowers

/**
 * A curved petal or leaf: narrow at the base, rounded at the tip, cupped
 * across its width and drooping toward the tip. Lies along +Z.
 */
function curvedBlade(len, width, cup, droop, baseColor, tipColor, segments = 6) {
  const geo = new THREE.PlaneGeometry(1, 1, 4, segments);
  const p = geo.attributes.position;
  const colors = [];
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) * 2; // -1..1 across
    const v = p.getY(i) + 0.5; // 0..1 along
    const profile = Math.pow(Math.sin(Math.PI * (0.06 + v * 0.9)), 0.6) * (1 - 0.25 * v);
    const x = u * 0.5 * width * profile;
    const y = cup * u * u * width * 0.35 * profile - droop * v * v * len;
    p.setXYZ(i, x, y, v * len);
    c.copy(baseColor).lerp(tipColor, Math.min(1, v * 1.6));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export function makeFlower(def, seed) {
  const rnd = mulberry32(seed);
  const model = def.model;
  const tex = getTextures();
  const group = new THREE.Group();
  const h = model.height * (0.8 + rnd() * 0.4);
  const s = model.headSize;
  const green = new THREE.Color().setHSL(0.26 + rnd() * 0.04, 0.55, 0.13);
  const stemMat = mat(green, { roughness: 0.85 });
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.65 });

  // Stem, curving gently. Bell flowers arch over at the top.
  const bell = model.kind === 'bell';
  const lean = new THREE.Vector3((rnd() - 0.5) * 0.1, h * 0.55, (rnd() - 0.5) * 0.1);
  const top = bell
    ? new THREE.Vector3(lean.x + h * 0.18, h * 0.95, lean.z)
    : new THREE.Vector3(lean.x * 1.6, h, lean.z * 1.6);
  const stemR = Math.max(0.006, s * 0.06);
  group.add(limb(new THREE.Vector3(), lean, stemR, stemR * 0.9, stemMat, 8));
  group.add(joint(lean, stemR * 0.9, stemMat));
  group.add(limb(lean, top, stemR * 0.9, stemR * 0.7, stemMat, 8));

  // A rosette of leaves at the base and one on the stem.
  const leafGeo = curvedBlade(h * 0.35, h * 0.09, 0.6, 0.35, green.clone().multiplyScalar(0.8), green.clone().offsetHSL(0, 0, 0.12));
  const leaves = 3 + Math.floor(rnd() * 2);
  for (let i = 0; i < leaves; i++) {
    const leaf = shadowy(new THREE.Mesh(leafGeo, leafMat));
    leaf.rotation.y = (i / leaves) * Math.PI * 2 + rnd();
    leaf.rotation.x = -0.6 - rnd() * 0.3;
    leaf.position.y = 0.01;
    group.add(leaf);
  }
  const stemLeaf = shadowy(new THREE.Mesh(leafGeo, leafMat));
  stemLeaf.position.copy(lean).multiplyScalar(0.7);
  stemLeaf.rotation.y = rnd() * Math.PI * 2;
  stemLeaf.rotation.x = -0.9;
  stemLeaf.scale.setScalar(0.6);
  group.add(stemLeaf);

  const head = new THREE.Group();
  head.position.copy(top);
  const petalColor = new THREE.Color(model.petalColor);

  if (bell) {
    // Flared, hanging bells along the arched tip.
    const profile = [
      [0.02, 0], [0.16, -0.06], [0.3, -0.25], [0.34, -0.55], [0.4, -0.8], [0.56, -0.92], [0.6, -0.88],
    ].map(([r, y]) => new THREE.Vector2(r * s * 1.6, y * s * 1.6));
    const bellGeo = new THREE.LatheGeometry(profile, 18);
    const bellMat = new THREE.MeshStandardMaterial({ color: petalColor, side: THREE.DoubleSide, roughness: 0.55 });
    const bells = model.bells ?? 3;
    for (let i = 0; i < bells; i++) {
      const t = i / Math.max(1, bells - 1);
      const anchor = new THREE.Vector3(-t * h * 0.22, -t * h * 0.12, (rnd() - 0.5) * 0.02);
      const hang = anchor.clone().add(new THREE.Vector3(0, -s * 0.4, 0));
      head.add(limb(anchor, hang, stemR * 0.4, stemR * 0.35, stemMat, 5));
      const b = shadowy(new THREE.Mesh(bellGeo, bellMat));
      b.position.copy(hang);
      b.rotation.z = (rnd() - 0.5) * 0.4;
      head.add(b);
    }
  } else {
    // Seed-patterned centre, slightly domed.
    const r = s * (model.petals > 15 ? 0.42 : 0.28);
    const discGeo = new THREE.RingGeometry(0.0001, r, 32, 6);
    const dp = discGeo.attributes.position;
    for (let i = 0; i < dp.count; i++) {
      const d = Math.hypot(dp.getX(i), dp.getY(i)) / r;
      dp.setZ(i, (1 - d * d) * r * 0.35);
    }
    discGeo.computeVertexNormals();
    discGeo.rotateX(-Math.PI / 2);
    const disc = shadowy(new THREE.Mesh(discGeo, mat(model.centerColor, { map: tex.seeds, roughness: 0.95 })));
    disc.position.y = 0.002;
    head.add(disc);

    // Two rings of curved petals, slightly offset, cupped upward.
    const petals = model.petals ?? 8;
    const thin = petals > 10;
    const petalGeo = curvedBlade(s * (thin ? 0.62 : 0.7), s * (thin ? 0.2 : 0.55), 0.8, 0.12, petalColor.clone().lerp(new THREE.Color(model.centerColor), 0.15), petalColor);
    const petalMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.5 });
    for (let ring = 0; ring < (thin ? 2 : 1); ring++) {
      for (let i = 0; i < petals; i++) {
        const a = ((i + ring * 0.5) / petals) * Math.PI * 2 + (rnd() - 0.5) * 0.08;
        const petal = shadowy(new THREE.Mesh(petalGeo, petalMat));
        petal.position.set(Math.sin(a) * r * 0.85, -ring * 0.004, Math.cos(a) * r * 0.85);
        petal.rotation.order = 'YXZ';
        petal.rotation.y = a;
        petal.rotation.x = -(0.15 + ring * 0.12 + rnd() * 0.1);
        petal.scale.setScalar(1 - ring * 0.1);
        head.add(petal);
      }
    }
    head.rotation.x = -0.35 + rnd() * 0.2;
    head.rotation.y = rnd() * Math.PI * 2;
  }
  group.add(head);
  mergeByMaterial(head);
  mergeByMaterial(group, new Set([head]));

  return { group, head, top };
}

// ---------------------------------------------------------------- birds

export function makeBird(def) {
  const s = def.size;
  const c = def.colors;
  const group = new THREE.Group();
  const body = shadowy(new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat(c.body)));
  body.scale.set(s * 0.55, s * 0.5, s);
  group.add(body);
  const breast = shadowy(new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat(c.breast)));
  breast.scale.set(s * 0.45, s * 0.4, s * 0.6);
  breast.position.set(0, -s * 0.12, s * 0.35);
  group.add(breast);
  const head = shadowy(new THREE.Mesh(new THREE.SphereGeometry(s * 0.42, 14, 10), mat(c.head)));
  head.position.set(0, s * 0.45, s * 0.7);
  group.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(s * 0.1, s * (def.behavior === 'hover' ? 0.9 : 0.35), 5), mat(c.beak));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, s * 0.42, s * (def.behavior === 'hover' ? 1.45 : 1.15));
  group.add(beak);
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#111' });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(s * 0.07, 6, 4), eyeMat);
    eye.position.set(side * s * 0.3, s * 0.55, s * 0.9);
    group.add(eye);
  }
  const tail = shadowy(new THREE.Mesh(new THREE.BoxGeometry(s * 0.4, s * 0.06, s * 0.7), mat(c.wing)));
  tail.position.set(0, s * 0.1, -s * 1.1);
  tail.rotation.x = -0.3;
  group.add(tail);

  const wings = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * s * 0.45, s * 0.2, 0);
    const wing = shadowy(new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), mat(c.wing)));
    wing.scale.set(s * 0.75, s * 0.06, s * 0.5);
    wing.position.x = side * s * 0.65;
    pivot.add(wing);
    pivot.userData.side = side;
    group.add(pivot);
    wings.push(pivot);
  }
  group.traverse((o) => (o.raycast = () => {}));
  return { group, wings };
}

// ---------------------------------------------------------------- unknown

/** Shown for content this client doesn't know yet, so old clients never break. */
export function makePlaceholder() {
  const group = new THREE.Group();
  const m = shadowy(new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), mat('#a7a7b5')));
  m.position.y = 0.15;
  group.add(m);
  return { group };
}
