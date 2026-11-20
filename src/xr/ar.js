// WebXR AR mode (works today in Chrome on ARCore Android phones).
// Flow: find the floor -> tap to drop the patch at tabletop scale -> tap to plant.
// iPhone Safari has no WebXR AR yet; the native app will cover that later.

import * as THREE from 'three';

const AR_SCALE = 0.12; // a 12 m patch becomes about 1.4 m across

export function setupAR({ renderer, scene, root, arMode, hud, onSelectRay }) {
  const button = hud.arButton;
  const note = hud.arNote;
  let session = null;
  let hitTestSource = null;
  let placed = false;

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#5fe3b9' })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  const controller = renderer.xr.getController(0);
  scene.add(controller);
  controller.addEventListener('select', onSelect);

  // Taps on the on-screen controls shouldn't also plant things.
  hud.overlayRoot.addEventListener('beforexrselect', (e) => {
    if (e.target.closest('button, input, .panel, .toolbar')) e.preventDefault();
  });

  if (!navigator.xr) {
    note.textContent = window.isSecureContext
      ? 'AR isn\'t available in this browser. On Android, use Chrome. iPhone support will come with the app.'
      : 'AR needs a secure (https) link. Use the deployed version on your phone.';
  } else {
    navigator.xr.isSessionSupported('immersive-ar').then((ok) => {
      if (ok) {
        button.hidden = false;
        note.textContent = 'Point your phone at the floor, then tap to place your patch.';
      } else {
        note.textContent = 'This device doesn\'t support AR in the browser. On Android, use Chrome. iPhone support will come with the app.';
      }
    });
  }

  button.addEventListener('click', () => (session ? session.end() : start()));

  async function start() {
    try {
      session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: hud.overlayRoot },
      });
    } catch (err) {
      note.textContent = `Couldn't start AR: ${err.message}`;
      return;
    }
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);
    arMode.enter();
    root.visible = false;
    placed = false;
    button.textContent = 'Exit AR';
    hud.setHint('Move your phone slowly to find the floor, then tap');
    const viewerSpace = await session.requestReferenceSpace('viewer');
    hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
    session.addEventListener('end', onEnd);
  }

  function onEnd() {
    hitTestSource = null;
    session = null;
    reticle.visible = false;
    root.visible = true;
    root.position.set(0, 0, 0);
    root.scale.setScalar(1);
    arMode.exit();
    button.textContent = 'View in AR';
    hud.setHint('Back in the sandbox', false, 2500);
  }

  function onSelect() {
    if (!placed) {
      if (!reticle.visible) return;
      root.position.setFromMatrixPosition(reticle.matrix);
      root.scale.setScalar(AR_SCALE);
      root.visible = true;
      placed = true;
      reticle.visible = false;
      hud.setHint('Patch placed. Pick something and tap to plant', false, 4000);
      return;
    }
    const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(controller.matrixWorld));
    onSelectRay(origin, dir);
  }

  return {
    get active() {
      return !!session;
    },
    update(frame) {
      if (!frame || !hitTestSource || placed) return;
      const hits = frame.getHitTestResults(hitTestSource);
      if (hits.length) {
        const pose = hits[0].getPose(renderer.xr.getReferenceSpace());
        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);
      } else {
        reticle.visible = false;
      }
    },
  };
}
