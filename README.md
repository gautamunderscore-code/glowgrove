# Glowgrove

An AR world-building game. Players design a patch of landscape: mushrooms that
grow on trees and glow at night, flowers and saplings that attract birds.
Other players can later walk through the worlds that others have built.

This is the **web prototype**: a 3D sandbox that runs in any browser, plus an AR
mode in Chrome on Android. There's no build step and nothing to install.

## Run it on your Mac

```bash
cd "/Users/gautampandey/My project/glowgrove"
python3 tools/serve.py
```

Then open <http://127.0.0.1:5173>.

## How to play

- Pick something from the bar at the bottom, then tap the patch to plant it.
  Glowcaps and Ember shelves grow on tree bark. Flowers and saplings need soil.
- Tap anything you've planted to select it. The card shows its growth, with
  **Delete** and **Done** buttons.
- **Drag** anything you've planted to move it. The ring turns red where it
  can't go. Mushrooms can move between bark and soil.
- Keyboard: **Esc** deselects, **Delete** or **Backspace** removes the selection.
- Drag empty space to look around. Scroll or pinch to zoom.
- **Settings → World clock** speeds up time. **Skip to night** shows the glow.
- **Growth speed** makes everything grow faster.
- Birds visit depending on what you've grown. Owls come at night for glowing
  mushrooms, robins come for flowers, finches for seeds and hummingbirds for nectar.
- **New tree** swaps in a different tree shape, to show that placement adapts.

## How it's built (and why)

| Folder | What it is | Future-proofing |
|---|---|---|
| `src/core/model.js` | The world data: zones, anchors, entities | Plain JSON with a schema version. Anchors keep a list of location fingerprints (`local` today; `gps`, `geospatial`, `cloud-anchor` later) |
| `src/core/sim.js` | Growth, glow, sun position, bird visits | Pure functions of time, so no server has to run the world. That keeps hosting nearly free |
| `content/*.json` | Plants, mushrooms and birds as data | Add species without changing code or shipping an app update |
| `src/render/` | Three.js visuals; every model is procedural | Swap in real 3D models (glTF) one kind at a time |
| `src/store/` | Saving | `LocalWorldStore` today; a cloud store with the same `load`/`save` methods later |
| `src/xr/ar.js` | WebXR AR mode | Only one plug-in. A native app or new AR tech replaces just this part |

**Look:** a physically based sky follows the real sun and also lights the
scene. Bark, soil and leaf textures are painted in code at startup
([src/render/textures.js](src/render/textures.js)). Canopies are made of hundreds
of leaf cards, and grass is thousands of blades that sway in a shader-driven
breeze. At night, bloom makes the mushrooms glow and fireflies come out.
Mushrooms have gills, spots and velvety caps. Flowers have curved petals and
seed-spiral centres. Everything casts a soft contact shadow, and hills and a
tree line ring the clearing. Each plant's parts are merged into a few meshes
(`mergeByMaterial`), which keeps draw calls low enough for phones. **Settings → Graphics** has
a *Battery saver* mode for phones.

`vendor/three` holds Three.js r170 (MIT licence), so the game works offline
and never depends on a CDN.

## AR on a phone

WebXR AR needs **https** and **Chrome on an ARCore Android phone**. iPhone
Safari doesn't support it yet, so iPhone AR will come from the native app later.
To try it on a phone, deploy the folder to a free static host such as
Cloudflare Pages or GitHub Pages and open the https link.

## Next steps

1. Deploy to a free https host so it can be tried on phones.
2. Cloud saving and logins (Supabase free tier), so worlds can be shared.
3. A world map and visiting other players' patches.
4. Real-location zones (GPS) and an anchor-accuracy test outdoors.
