// Renderer, camera, sky, lighting and the patch of ground.
//
// Realism comes from:
// - a physically based sky that follows the real sun position
// - image-based lighting: the sky itself lights the scene, refreshed as the sun moves
// - bloom, so glowing mushrooms bleed light like a camera sees it
// - textured ground, swaying grass blades and soft shadows
// In camera/AR mode the sky and surroundings hide and only the garden shows.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { mulberry32 } from '../core/rng.js';
import { smoothstep, nightFactor } from '../core/sim.js';
import { getTextures } from './textures.js';
import { addWind } from './wind.js';
import { makeTree } from './procedural.js';

const NIGHT_SKY = new THREE.Color('#070d22');
const QUALITY = {
  high: { pixelRatio: 2, shadowMap: 2048, grass: 16000, bloom: true, backgroundTrees: 26, wildflowers: 1600 },
  low: { pixelRatio: 1, shadowMap: 1024, grass: 5000, bloom: false, backgroundTrees: 8, wildflowers: 500 },
};

export function createScene(container, zoneRadius, qualityName = 'high') {
  let quality = QUALITY[qualityName] ?? QUALITY.high;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = NIGHT_SKY.clone();
  scene.fog = new THREE.FogExp2('#b9cfe0', 0.009);

  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.03, 3000);
  camera.position.set(6.5, 3.6, 8.5);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.3, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.minDistance = 1.2;
  controls.maxDistance = 22;
  controls.update();

  // ---------------------------------------------------------- lights

  const hemi = new THREE.HemisphereLight('#cfe8ff', '#4b3a26', 0.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffffff', 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 60 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const moon = new THREE.DirectionalLight('#9db4ff', 0.3);
  moon.position.set(-6, 10, 4);
  scene.add(moon);

  // ---------------------------------------------------------- sky + sky lighting

  const sky = new Sky();
  sky.scale.setScalar(1000);
  const skyU = sky.material.uniforms;
  skyU.turbidity.value = 3;
  skyU.rayleigh.value = 2.2;
  skyU.mieCoefficient.value = 0.004;
  skyU.mieDirectionalG.value = 0.85;
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  envSky.material.uniforms.turbidity.value = 3;
  envSky.material.uniforms.rayleigh.value = 2.2;
  envScene.add(envSky);
  let envTarget = null;
  let lastEnvElevation = 999;

  function refreshEnvironment(sunDir, elevation) {
    if (Math.abs(elevation - lastEnvElevation) < 1.5) return;
    lastEnvElevation = elevation;
    envSky.material.uniforms.sunPosition.value.copy(sunDir);
    envTarget?.dispose();
    envTarget = pmrem.fromScene(envScene, 0, 0.1, 2000);
    scene.environment = envTarget.texture;
  }

  // ---------------------------------------------------------- the world root

  // Everything placed in the world lives under `root`, so camera/AR mode can move and scale it.
  const root = new THREE.Group();
  scene.add(root);

  const tex = getTextures();
  const groundMap = tex.ground.map.clone();
  const groundNormal = tex.ground.normalMap.clone();
  for (const t of [groundMap, groundNormal]) {
    t.repeat.set(10, 10);
    t.needsUpdate = true;
  }
  const groundGeo = new THREE.CircleGeometry(zoneRadius + 0.6, 64);
  groundGeo.rotateX(-Math.PI / 2);
  const grassMat = new THREE.MeshStandardMaterial({ map: groundMap, normalMap: groundNormal, roughness: 1 });
  const ground = new THREE.Mesh(groundGeo, grassMat);
  ground.receiveShadow = true;
  ground.userData.surface = 'ground';
  root.add(ground);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(zoneRadius - 0.03, zoneRadius, 128).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#f4ffe0', transparent: true, opacity: 0.25, depthWrite: false })
  );
  ring.position.y = 0.012;
  ring.raycast = () => {};
  root.add(ring);

  // ---------------------------------------------------------- surroundings (hidden in camera/AR mode)

  const env = new THREE.Group();
  scene.add(env);
  const outsideMap = tex.ground.map.clone();
  outsideMap.repeat.set(60, 60);
  outsideMap.needsUpdate = true;
  const outside = new THREE.Mesh(
    new THREE.CircleGeometry(300, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: outsideMap, color: '#c9d6b8', roughness: 1 })
  );
  outside.position.y = -0.02;
  outside.receiveShadow = true;
  outside.userData.surface = 'outside';
  env.add(outside);

  const rnd = mulberry32(42);
  const rockMat = new THREE.MeshStandardMaterial({ color: '#8d877c', roughness: 0.95, normalMap: tex.bark.normalMap });
  for (let i = 0; i < 12; i++) {
    const geo = new THREE.DodecahedronGeometry(0.2 + rnd() * 0.55, 1);
    const p = geo.attributes.position;
    for (let v = 0; v < p.count; v++) p.setXYZ(v, p.getX(v) * (0.8 + rnd() * 0.4), p.getY(v) * (0.55 + rnd() * 0.3), p.getZ(v) * (0.8 + rnd() * 0.4));
    geo.computeVertexNormals();
    const rock = new THREE.Mesh(geo, rockMat);
    const a = rnd() * Math.PI * 2;
    const r = zoneRadius + 1.5 + rnd() * 10;
    rock.position.set(Math.cos(a) * r, 0.02, Math.sin(a) * r);
    rock.rotation.y = rnd() * 6;
    rock.castShadow = rock.receiveShadow = true;
    env.add(rock);
  }

  // Rolling hills on the horizon.
  const hillGeo = new THREE.RingGeometry(30, 320, 128, 40);
  hillGeo.rotateX(-Math.PI / 2);
  const hp = hillGeo.attributes.position;
  const ph = [rnd() * 6, rnd() * 6, rnd() * 6, rnd() * 6];
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i);
    const z = hp.getZ(i);
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const shape = 0.5 + 0.3 * Math.sin(a * 3 + ph[0]) + 0.15 * Math.sin(a * 7 + ph[1]) + 0.1 * Math.sin(a * 13 + ph[2] + r * 0.02);
    hp.setY(i, smoothstep(45, 170, r) * shape * 34 + smoothstep(30, 60, r) * (0.5 + 0.5 * Math.sin(a * 9 + ph[3])) * 2.5);
  }
  hillGeo.computeVertexNormals();
  const hills = new THREE.Mesh(hillGeo, outside.material);
  hills.position.y = -0.03;
  hills.receiveShadow = true;
  env.add(hills);

  // A loose ring of trees around the clearing.
  for (let i = 0; i < quality.backgroundTrees; i++) {
    const t = makeTree(Math.floor(rnd() * 1e9));
    const a = (i / quality.backgroundTrees) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
    const r = 15 + rnd() * 30;
    t.group.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    t.group.scale.setScalar(1 + rnd() * 0.8);
    t.group.rotation.y = rnd() * Math.PI * 2;
    t.group.traverse((o) => {
      o.raycast = () => {};
      o.castShadow = false;
    });
    env.add(t.group);
  }

  // Tiny wildflowers dotted through the meadow outside your patch.
  const wfColors = ['#ffffff', '#fff3a0', '#c9b6ff', '#ffd0e0'].map((c) => new THREE.Color(c));
  const wildflowers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.014, 6, 4), new THREE.MeshStandardMaterial({ roughness: 0.6 }), quality.wildflowers);
  {
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < wildflowers.count; i++) {
      const r = zoneRadius + 0.8 + Math.sqrt(rnd()) * 14;
      const a = rnd() * Math.PI * 2;
      m4.makeTranslation(Math.cos(a) * r, 0.1 + rnd() * 0.12, Math.sin(a) * r);
      wildflowers.setMatrixAt(i, m4);
      wildflowers.setColorAt(i, wfColors[Math.floor(rnd() * wfColors.length)]);
    }
  }
  wildflowers.raycast = () => {};
  env.add(wildflowers);

  // Stars.
  const starPos = [];
  for (let i = 0; i < 900; i++) {
    const a = rnd() * Math.PI * 2;
    const y = 0.06 + rnd() * 0.94;
    const r = Math.sqrt(1 - y * y);
    starPos.push(Math.cos(a) * r * 400, y * 400, Math.sin(a) * r * 400);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#c9d4ff', size: 0.8, sizeAttenuation: true, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  env.add(stars);

  // ---------------------------------------------------------- grass blades

  let grass = null;
  function buildGrass(count) {
    if (grass) {
      grass.removeFromParent();
      grass.geometry.dispose();
    }
    // One curved, tapered blade; colour darkens toward the root.
    const geo = new THREE.PlaneGeometry(0.03, 0.2, 1, 4);
    geo.translate(0, 0.1, 0);
    const pos = geo.attributes.position;
    const colors = [];
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v) / 0.2;
      pos.setX(v, pos.getX(v) * (1 - y * 0.85));
      pos.setZ(v, y * y * 0.06);
      const c = new THREE.Color('#1f3a12').lerp(new THREE.Color('#5f8f2e'), y);
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = addWind(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 }), 0.05, 'tip');
    grass = new THREE.InstancedMesh(geo, mat, count);
    grass.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    const tint = new THREE.Color();
    const g = mulberry32(7);
    for (let i = 0; i < count; i++) {
      const r = Math.sqrt(g()) * (zoneRadius + 9);
      const a = g() * Math.PI * 2;
      const s = 0.5 + g() * 0.8;
      m4.compose(
        new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r),
        new THREE.Quaternion().setFromEuler(new THREE.Euler((g() - 0.5) * 0.35, g() * Math.PI * 2, (g() - 0.5) * 0.35)),
        new THREE.Vector3(s, s * (0.7 + g() * 0.6), s)
      );
      grass.setMatrixAt(i, m4);
      // Natural variety: some blades greener, some drier and yellower.
      const dry = g();
      grass.setColorAt(i, tint.setRGB(0.85 + dry * 0.35, 0.9 + g() * 0.25, 0.8 + (1 - dry) * 0.2));
    }
    grass.raycast = () => {};
    env.add(grass);
  }
  buildGrass(quality.grass);

  // ---------------------------------------------------------- post-processing

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.5, 0.5, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // Gentle colour grade: a touch more colour and contrast, darker corners.
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, saturation: { value: 1.12 }, contrast: { value: 1.05 }, vignette: { value: 0.32 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float saturation; uniform float contrast; uniform float vignette;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        c.rgb = mix(vec3(l), c.rgb, saturation);
        c.rgb = (c.rgb - 0.5) * contrast + 0.5;
        float d = distance(vUv, vec2(0.5));
        c.rgb *= 1.0 - vignette * smoothstep(0.35, 0.85, d);
        gl_FragColor = c;
      }`,
  });
  composer.addPass(grade);

  // ---------------------------------------------------------- fireflies (part of the garden, so they show in camera mode too)

  const FIREFLIES = 45;
  const ffGeo = new THREE.BufferGeometry();
  const ffPos = new Float32Array(FIREFLIES * 3);
  const ffCol = new Float32Array(FIREFLIES * 3);
  const ffSeed = Array.from({ length: FIREFLIES }, () => ({ x: (rnd() - 0.5) * zoneRadius * 1.6, z: (rnd() - 0.5) * zoneRadius * 1.6, y: 0.2 + rnd() * 1.6, p: rnd() * 100, s: 0.3 + rnd() * 0.5 }));
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
  ffGeo.setAttribute('color', new THREE.BufferAttribute(ffCol, 3));
  const fireflies = new THREE.Points(
    ffGeo,
    new THREE.PointsMaterial({ map: getGlowSprite(), size: 0.16, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  fireflies.frustumCulled = false;
  fireflies.raycast = () => {};
  root.add(fireflies);

  function updateAmbient(t) {
    const on = smoothstep(0.5, 0.9, night);
    fireflies.visible = on > 0;
    if (!on) return;
    for (let i = 0; i < FIREFLIES; i++) {
      const f = ffSeed[i];
      ffPos[i * 3] = f.x + Math.sin(t * f.s + f.p) * 0.8;
      ffPos[i * 3 + 1] = f.y + Math.sin(t * f.s * 1.7 + f.p * 2) * 0.25;
      ffPos[i * 3 + 2] = f.z + Math.cos(t * f.s * 0.8 + f.p) * 0.8;
      const blink = Math.max(0, Math.sin(t * 1.3 + f.p * 3)) ** 3 * on;
      ffCol[i * 3] = 0.85 * blink;
      ffCol[i * 3 + 1] = 1.0 * blink;
      ffCol[i * 3 + 2] = 0.35 * blink;
    }
    ffGeo.attributes.position.needsUpdate = true;
    ffGeo.attributes.color.needsUpdate = true;
  }

  // ---------------------------------------------------------- environment per frame

  let passthrough = false;
  const sunDir = new THREE.Vector3();
  const fogColor = new THREE.Color();
  let night = 0;

  function setEnvironment({ elevation, azimuth }) {
    night = nightFactor(elevation);
    const day = 1 - night;
    const el = (elevation * Math.PI) / 180;
    const az = (azimuth * Math.PI) / 180;
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));

    skyU.sunPosition.value.copy(sunDir);
    sky.visible = !passthrough && elevation > -9;
    refreshEnvironment(sunDir, Math.max(elevation, -6));

    // Sun light: never from below the horizon, warmer when low.
    const lit = Math.max(elevation, 4) * (Math.PI / 180);
    sun.position.set(Math.sin(az) * Math.cos(lit) * 30, Math.sin(lit) * 30, -Math.cos(az) * Math.cos(lit) * 30);
    const horizon = 1 - smoothstep(0, 20, Math.abs(elevation));
    sun.intensity = 3 * smoothstep(-3, 8, elevation);
    sun.color.setHSL(0.08, 0.9 * horizon, 0.55 + 0.45 * (1 - horizon));
    hemi.intensity = 0.08 + 0.25 * day;
    moon.intensity = 0.5 * night;
    scene.environmentIntensity = 0.12 + 0.5 * day;

    // Fog matches the sky near the horizon.
    fogColor.setHSL(0.57, 0.4, 0.74).lerp(new THREE.Color('#e8a777'), horizon * 0.6).lerp(NIGHT_SKY, night);
    if (!passthrough) {
      scene.fog.color.copy(fogColor);
      scene.background.copy(NIGHT_SKY);
    }
    stars.material.opacity = smoothstep(0.4, 1, night);
    renderer.toneMappingExposure = 0.75 + 0.15 * day;
    bloom.strength = 0.2 + 0.35 * night;
    bloom.threshold = 0.9 - 0.15 * night;
    return night;
  }

  // ---------------------------------------------------------- rendering

  function render() {
    // Bloom needs an opaque background, so camera/AR mode renders directly.
    if (quality.bloom && !passthrough && !renderer.xr.isPresenting) composer.render();
    else renderer.render(scene, camera);
  }

  function resize() {
    if (renderer.xr.isPresenting) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(container.clientWidth, container.clientHeight);
  }
  window.addEventListener('resize', resize);

  function setQuality(name) {
    quality = QUALITY[name] ?? QUALITY.high;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
    sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    buildGrass(quality.grass);
    resize();
  }

  // "Passthrough" = the real world shows behind the garden (camera view or AR).
  // The grass becomes invisible but still catches shadows.
  const shadowMat = new THREE.ShadowMaterial({ opacity: 0.4 });
  let passthroughUsers = 0;
  const arMode = {
    enter() {
      passthroughUsers++;
      passthrough = true;
      scene.background = null;
      scene.fog = null;
      env.visible = false;
      sky.visible = false;
      ground.material = shadowMat;
      ring.material.opacity = 0.5;
    },
    exit() {
      passthroughUsers = Math.max(0, passthroughUsers - 1);
      if (passthroughUsers > 0) return;
      passthrough = false;
      scene.background = NIGHT_SKY.clone();
      scene.fog = new THREE.FogExp2(fogColor.clone(), 0.009);
      env.visible = true;
      ground.material = grassMat;
      ring.material.opacity = 0.25;
    },
  };

  return { renderer, scene, camera, controls, root, ground, setEnvironment, updateAmbient, render, setQuality, arMode };
}

let glowSprite = null;
function getGlowSprite() {
  if (glowSprite) return glowSprite;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowSprite = new THREE.CanvasTexture(c);
  return glowSprite;
}
