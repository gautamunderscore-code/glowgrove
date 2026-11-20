// Textures painted in code at startup: bark, soil/grass and leaves.
// No image files to download, buy or license.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

/** Smooth value noise in 0..1, tileable over `period` cells. */
function makeNoise(seed, period) {
  const rnd = mulberry32(seed);
  const grid = Array.from({ length: period * period }, () => rnd());
  const at = (x, y) => grid[((y % period) + period) % period * period + (((x % period) + period) % period)];
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = fade(x - xi);
    const yf = fade(y - yi);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * xf;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * xf;
    return a + (b - a) * yf;
  };
}

/** Builds a normal map from a grayscale height field (0..1 values). */
function normalMapFrom(heights, w, h, strength) {
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  const H = (x, y) => heights[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, false);
}

function toTexture(c, isColor = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (isColor) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let cache = null;

export function getTextures() {
  if (cache) return cache;
  cache = {
    bark: makeBark(),
    ground: makeGround(),
    leaf: makeLeaf(),
    gills: makeGills(),
    seeds: makeSeeds(),
    rings: makeRings(),
    ao: makeContactShadow(),
  };
  return cache;
}

// Mushroom gills: fine radial lines (drawn for a ring mapped flat).
function makeGills() {
  const s = 256;
  const [c, g] = canvas(s, s);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(80,70,60,0.55)';
  g.lineWidth = 1.2;
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    g.beginPath();
    g.moveTo(s / 2 + Math.cos(a) * s * 0.06, s / 2 + Math.sin(a) * s * 0.06);
    g.lineTo(s / 2 + Math.cos(a) * s * 0.5, s / 2 + Math.sin(a) * s * 0.5);
    g.stroke();
  }
  return toTexture(c);
}

// Flower centres: seeds in the golden-angle spiral real sunflowers use.
function makeSeeds() {
  const s = 256;
  const [c, g] = canvas(s, s);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, s, s);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < 700; i++) {
    const r = Math.sqrt(i / 700) * s * 0.5;
    const a = i * golden;
    g.fillStyle = `rgba(30,20,10,${0.25 + (i / 700) * 0.35})`;
    g.beginPath();
    g.arc(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, 2.6, 0, Math.PI * 2);
    g.fill();
  }
  return toTexture(c);
}

// Bracket fungus top: concentric growth bands.
function makeRings() {
  const s = 256;
  const [c, g] = canvas(s, s);
  for (let r = s * 0.5; r > 0; r -= 6) {
    const k = 200 + Math.sin(r * 0.9) * 40 + (r / s) * 30;
    g.fillStyle = `rgb(${k},${k * 0.95},${k * 0.88})`;
    g.beginPath();
    g.arc(s / 2, s / 2, r, 0, Math.PI * 2);
    g.fill();
  }
  return toTexture(c);
}

// Soft dark blob laid under things so they sit on the ground.
function makeContactShadow() {
  const s = 128;
  const [c, g] = canvas(s, s);
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  return t;
}

// Bark: vertical ridges and furrows. Near-white so the tree's own colour tints it.
function makeBark() {
  const w = 256;
  const h = 512;
  const n1 = makeNoise(11, 16);
  const n2 = makeNoise(12, 64);
  const heights = new Float32Array(w * h);
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Stretch the noise vertically for long furrows.
      const ridge = Math.abs(n1((x / w) * 16, (y / h) * 3) * 2 - 1);
      const fine = n2((x / w) * 64, (y / h) * 18);
      const v = Math.min(1, 0.35 + 0.5 * (1 - ridge) + 0.25 * fine);
      heights[y * w + x] = v;
      const i = (y * w + x) * 4;
      const shade = 120 + v * 135;
      img.data[i] = shade;
      img.data[i + 1] = shade * 0.94;
      img.data[i + 2] = shade * 0.88;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { map: toTexture(c), normalMap: normalMapFrom(heights, w, h, 6) };
}

// Ground: mottled grass with patches of soil.
function makeGround() {
  const s = 512;
  const big = makeNoise(21, 8);
  const mid = makeNoise(22, 32);
  const fine = makeNoise(23, 128);
  const heights = new Float32Array(s * s);
  const [c, g] = canvas(s, s);
  const img = g.createImageData(s, s);
  const grassA = [74, 112, 46];
  const grassB = [104, 140, 58];
  const soil = [86, 72, 50];
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = x / s;
      const v = y / s;
      const patch = big(u * 8, v * 8);
      const m = mid(u * 32, v * 32);
      const f = fine(u * 128, v * 128);
      const soilAmt = Math.max(0, Math.min(1, (patch * 0.7 + m * 0.3 - 0.7) * 4));
      const grassMix = m * 0.6 + f * 0.4;
      const i = (y * s + x) * 4;
      for (let k = 0; k < 3; k++) {
        const grass = grassA[k] + (grassB[k] - grassA[k]) * grassMix;
        img.data[i + k] = (grass * (1 - soilAmt) + soil[k] * soilAmt) * (0.85 + f * 0.3);
      }
      img.data[i + 3] = 255;
      heights[y * s + x] = f * 0.6 + m * 0.4;
    }
  }
  g.putImageData(img, 0, 0);
  return { map: toTexture(c), normalMap: normalMapFrom(heights, s, s, 1.2) };
}

// Leaves: a small sprig of leaves on a transparent background, used on
// "leaf cards" that make up the tree canopies.
function makeLeaf() {
  const s = 128;
  const [c, g] = canvas(s, s);
  const rnd = mulberry32(31);
  const leaves = 7;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + rnd() * 0.5;
    const r = 18 + rnd() * 16;
    const cx = s / 2 + Math.cos(a) * r;
    const cy = s / 2 + Math.sin(a) * r;
    g.save();
    g.translate(cx, cy);
    g.rotate(a + Math.PI / 2);
    const len = 26 + rnd() * 10;
    const grad = g.createLinearGradient(0, -len, 0, len);
    const l = 70 + rnd() * 30;
    grad.addColorStop(0, `rgb(${l + 40},${l + 70},${l + 10})`);
    grad.addColorStop(1, `rgb(${l},${l + 30},${l - 20})`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, -len);
    g.quadraticCurveTo(len * 0.55, 0, 0, len);
    g.quadraticCurveTo(-len * 0.55, 0, 0, -len);
    g.fill();
    g.strokeStyle = 'rgba(255,255,230,0.35)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(0, -len * 0.9);
    g.lineTo(0, len * 0.9);
    g.stroke();
    g.restore();
  }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
