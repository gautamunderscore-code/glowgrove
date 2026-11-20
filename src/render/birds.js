// Animates visiting birds. Which birds visit is decided by the simulation
// (sim.js); this file only handles flying in, idling and flying away, in real
// time so it looks natural even when the world clock is fast-forwarded.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { makeBird } from './procedural.js';

const MAX_BIRDS = 14;
const MIN_STAY_SEC = 5;

export class BirdFlock {
  constructor(root, pack, onArrive) {
    this.root = root;
    this.pack = pack;
    this.onArrive = onArrive;
    this.birds = new Map();
    this.announced = new Set();
  }

  update(visits, spots, dt, timeSec) {
    const wanted = new Set();
    for (const v of visits) {
      if (wanted.size >= MAX_BIRDS) break;
      wanted.add(v.key);
      if (!this.birds.has(v.key)) this.spawn(v, spots);
    }

    for (const [key, b] of this.birds) {
      if (!wanted.has(key) && b.state !== 'leaving' && timeSec - b.bornAt > MIN_STAY_SEC) this.leave(b);
      this.animate(b, spots, dt, timeSec);
      if (b.state === 'gone') {
        this.root.remove(b.group);
        this.birds.delete(key);
      }
    }
  }

  spawn(visit, spots) {
    const def = this.pack.birdById.get(visit.birdId);
    if (!def) return;
    const rnd = mulberry32(visit.seed);
    const target = this.pickTarget(def, spots, rnd);
    if (!target) return;
    const { group, wings } = makeBird(def);
    const a = rnd() * Math.PI * 2;
    group.position.set(Math.cos(a) * 16, 5 + rnd() * 4, Math.sin(a) * 16);
    this.root.add(group);
    const b = { def, group, wings, rnd, target, state: 'arriving', bornAt: performance.now() / 1000, idleTimer: 1 + rnd() * 2, hoverPhase: rnd() * 10 };
    this.birds.set(visit.key, b);
    if (visit.leader && !this.announced.has(visit.key)) {
      this.announced.add(visit.key);
      this.onArrive?.(def);
    }
  }

  pickTarget(def, spots, rnd) {
    const pick = (list) => (list.length ? list[Math.floor(rnd() * list.length)].clone() : null);
    if (def.behavior === 'hover') {
      const p = pick(spots.hover);
      return p ? p.add(new THREE.Vector3((rnd() - 0.5) * 0.3, 0.15 + rnd() * 0.15, (rnd() - 0.5) * 0.3)) : pick(spots.perch);
    }
    if (def.behavior === 'ground') {
      const p = pick(spots.ground);
      if (p) return p.add(new THREE.Vector3((rnd() - 0.5) * 0.8, 0, (rnd() - 0.5) * 0.8)).setY(0);
      return new THREE.Vector3((rnd() - 0.5) * 4, 0, (rnd() - 0.5) * 4);
    }
    return pick(spots.perch);
  }

  leave(b) {
    b.state = 'leaving';
    const a = b.rnd() * Math.PI * 2;
    b.target = new THREE.Vector3(Math.cos(a) * 18, 7 + b.rnd() * 4, Math.sin(a) * 18);
  }

  animate(b, spots, dt, t) {
    const pos = b.group.position;
    const flying = b.state === 'arriving' || b.state === 'leaving';
    const flapSpeed = b.def.behavior === 'hover' ? 60 : 18;

    if (flying) {
      const to = b.target.clone().sub(pos);
      const dist = to.length();
      const speed = Math.min(4.5, 1 + dist * 1.2);
      if (dist < 0.03) {
        if (b.state === 'leaving') b.state = 'gone';
        else {
          b.state = 'staying';
          const yaw = new THREE.Euler().setFromQuaternion(b.group.quaternion, 'YXZ').y;
          b.group.rotation.set(0, yaw, 0);
        }
      } else {
        to.normalize();
        pos.addScaledVector(to, Math.min(dist, speed * dt));
        pos.y += Math.sin(t * 6 + b.hoverPhase) * 0.004;
        const look = pos.clone().add(new THREE.Vector3(to.x, to.y * 0.3, to.z));
        b.group.lookAt(look);
      }
      this.flap(b, Math.sin(t * flapSpeed) * 0.9);
      return;
    }

    // Staying.
    if (b.def.behavior === 'hover') {
      pos.copy(b.target).add(new THREE.Vector3(Math.sin(t * 1.7 + b.hoverPhase) * 0.05, Math.sin(t * 3.1) * 0.03, Math.cos(t * 1.3) * 0.05));
      this.flap(b, Math.sin(t * flapSpeed) * 1.1);
      return;
    }

    pos.copy(b.target);
    this.flap(b, 0.15);
    b.idleTimer -= dt;
    if (b.idleTimer <= 0) {
      b.idleTimer = 0.8 + b.rnd() * 2.5;
      b.group.rotation.y += (b.rnd() - 0.5) * 1.8;
      b.hopUntil = t + 0.25;
      if (b.def.behavior === 'ground' && b.rnd() < 0.5) {
        b.target.x += (b.rnd() - 0.5) * 0.4;
        b.target.z += (b.rnd() - 0.5) * 0.4;
      }
    }
    if (b.hopUntil && t < b.hopUntil) pos.y += Math.sin(((b.hopUntil - t) / 0.25) * Math.PI) * 0.05;
  }

  flap(b, angle) {
    for (const w of b.wings) w.rotation.z = angle * w.userData.side;
  }
}
