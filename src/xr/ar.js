// WebXR AR mode (Chrome on ARCore Android phones, e.g. Samsung Galaxy).
// Flow: find a real surface -> tap to drop the patch -> tap to plant.
//
// The patch is pinned with an XR *anchor*: as the phone's understanding of
// the room improves, ARCore nudges the anchor and the patch follows, so it
// stays on the floor instead of drifting or floating. Phones without anchor
// support fall back to a fixed position.
//
// iPhone Safari has no WebXR AR yet; the native app will cover that later.

import * as THREE from 'three';

const AR_SCALE = 0.12; // a 12 m patch becomes about 1.4 m across
const STABLE_FRAMES = 8; // surface must be found this many frames in a row before placing

export function setupAR({ renderer, scene, root, camera, arMode, hud, onSelectRay }) {
  const buttons = [hud.arButton, hud.arQuickButton];
  const note = hud.arNote;
  const moveBtn = hud.arMoveButton;
  let session = null;
  let hitTestSource = null;
  let placed = false;
  let anchor = null;
  let stableFrames = 0;
  let placeRequested = false; // placement happens inside the next AR frame, where anchors can be made

  const reticle = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({ color: '#5fe3b9', transparent: true, opacity: 0.9 });
  reticle.add(new THREE.Mesh(new THREE.RingGeometry(0.07, 0.09, 40).rotateX(-Math.PI / 2), ringMat));
  reticle.add(new THREE.Mesh(new THREE.CircleGeometry(0.015, 16).rotateX(-Math.PI / 2), ringMat));
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  const controller = renderer.xr.getController(0);
  scene.add(controller);
  controller.addEventListener('select', onSelect);

  // Taps on the on-screen controls shouldn't also plant things.
  hud.overlayRoot.addEventListener('beforexrselect', (e) => {
    if (e.target.closest?.('button, input, .panel, .toolbar, .selection')) e.preventDefault();
  });

  const setButtons = (visible, label) => {
    for (const b of buttons) {
      if (!b) continue;
      b.hidden = !visible;
      if (label) b.textContent = label;
    }
  };

  if (!navigator.xr) {
    note.textContent = window.isSecureContext
      ? "AR isn't available in this browser. On Android, use Chrome. iPhone support will come with the app."
      : 'AR needs a secure (https) link. Use the published version on your phone.';
  } else {
    navigator.xr.isSessionSupported('immersive-ar').then((ok) => {
      if (ok) {
        setButtons(true);
        note.textContent = 'Point your phone at the floor or a table, wait for the green ring, then tap to place your patch.';
      } else {
        note.textContent = "This device doesn't support AR in the browser. On Android, use Chrome and install Google Play Services for AR. iPhone support will come with the app.";
      }
    });
  }

  for (const b of buttons) b?.addEventListener('click', () => (session ? session.end() : start()));
  moveBtn?.addEventListener('click', () => {
    if (!session) return;
    unplace();
    hud.setHint('Find a surface again, then tap to move your patch there');
  });

  async function start() {
    try {
      session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'anchors', 'light-estimation'],
        domOverlay: { root: hud.overlayRoot },
      });
    } catch (err) {
      note.textContent = `Couldn't start AR: ${err.message}`;
      hud.setHint(`Couldn't start AR: ${err.message}`, true, 5000);
      return;
    }
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);
    arMode.enter();
    unplace();
    setButtons(true, 'Exit AR');
    document.body.classList.add('in-ar');
    hud.setHint('Move your phone slowly over the floor until the green ring appears');
    const viewerSpace = await session.requestReferenceSpace('viewer');
    try {
      // Real surfaces (planes) only, so the patch lands on the floor itself.
      hitTestSource = await session.requestHitTestSource({ space: viewerSpace, entityTypes: ['plane'] });
    } catch {
      hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
    }
    session.addEventListener('end', onEnd);
  }

  function unplace() {
    placed = false;
    placeRequested = false;
    root.visible = false;
    anchor?.delete?.();
    anchor = null;
    stableFrames = 0;
    if (moveBtn) moveBtn.hidden = true;
  }

  function onEnd() {
    hitTestSource = null;
    session = null;
    anchor = null;
    placed = false;
    reticle.visible = false;
    root.visible = true;
    root.position.set(0, 0, 0);
    root.quaternion.identity();
    root.scale.setScalar(1);
    arMode.exit();
    setButtons(true, 'View in AR');
    if (moveBtn) moveBtn.hidden = true;
    document.body.classList.remove('in-ar');
    hud.setHint('Back in the 3D view', false, 2500);
  }

  function onSelect() {
    if (!placed) {
      if (!reticle.visible || stableFrames < STABLE_FRAMES) {
        hud.setHint('Still looking for a surface. Move the phone slowly over the floor', true, 2500);
        return;
      }
      placeRequested = true;
      return;
    }
    const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(controller.matrixWorld));
    onSelectRay(origin, dir);
  }

  function placeAt(matrix) {
    root.position.setFromMatrixPosition(matrix);
    // Turn the patch so the tree faces you.
    const cam = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const yaw = Math.atan2(cam.x - root.position.x, cam.z - root.position.z);
    root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    root.scale.setScalar(AR_SCALE);
    root.visible = true;
    placed = true;
    reticle.visible = false;
    if (moveBtn) moveBtn.hidden = false;
    hud.setHint('Patch placed. Pick something and tap to plant', false, 4000);
  }

  return {
    get active() {
      return !!session;
    },
    update(frame) {
      if (!frame || !session) return;
      const refSpace = renderer.xr.getReferenceSpace();

      if (placed) {
        if (anchor && frame.trackedAnchors?.has(anchor)) {
          const pose = frame.getPose(anchor.anchorSpace, refSpace);
          if (pose) root.position.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
        }
        return;
      }

      if (!hitTestSource) return;
      const hits = frame.getHitTestResults(hitTestSource);
      if (hits.length) {
        const pose = hits[0].getPose(refSpace);
        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);
        stableFrames++;
        if (placeRequested) {
          placeRequested = false;
          placeAt(reticle.matrix);
          // Pin it with an anchor so it follows ARCore's corrections.
          hits[0].createAnchor?.()?.then(
            (a) => {
              if (placed) anchor = a;
              else a.delete?.();
            },
            () => {} // no anchor support: the fixed position still works
          );
        }
        ringMat.opacity = stableFrames >= STABLE_FRAMES ? 0.95 : 0.4;
      } else {
        reticle.visible = false;
        stableFrames = 0;
      }
    },
  };
}
