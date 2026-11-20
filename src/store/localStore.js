// Saves the world on this device. It implements the same small interface a
// cloud store (e.g. Supabase) will implement later, so swapping is one line in
// main.js:  load() -> world | null,  save(world).

import { migrateWorld } from '../core/model.js';

export class LocalWorldStore {
  constructor(key = 'glowgrove.world') {
    this.key = key;
  }

  async load() {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? migrateWorld(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  async save(world) {
    try {
      localStorage.setItem(this.key, JSON.stringify(world));
    } catch {
      // Storage can be unavailable (private mode). The game still runs.
    }
  }
}
