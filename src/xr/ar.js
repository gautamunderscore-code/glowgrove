// WebXR AR (Chrome on ARCore Android phones, e.g. Samsung Galaxy).
//
// Two modes:
// - Tabletop: the 3D patch, shrunk onto a floor or table. Tap to drop it.
// - Room (life-size): no patch. Mark a home spot with two taps (a corner,
//   then a point along the same edge), then plant on real floors, tables
//   and walls at real size. Everything is saved relative to the home spot,
//   so marking the same spot next time brings the garden back, grown.
//
// Placed things are pinned with XR anchors so ARCore's corrections keep
// them on the real surface. iPhone Safari has no WebXR AR yet.

import * as THREE from 'three';

const TABLETOP_SCALE = 0.12; // a 12 m patch becomes about 1.4 m across
const STABLE_FRAMES = 8; // a surface must be found this many frames in a row
const MIN_EDGE = 0.15; // metres between the two home-spot taps

export function setupAR({ renderer, scene, root, camera, arMode, hud, onSelectRay, onModeChange, hasRoomGarden }) {
  const buttons = [hud.arButton, hud.arQuickButton];
  const note = hud.arNote;
  const moveBtn = hud.arMoveButton;
  const roomBtn = hud.arRoomButton;
  const nudgeBox = hud.arNudge;

  let session = null;
  let mode = null; // 'tabletop' | 'room'
  let step = null; // 'find' | 'home-a' | 'home-b' | 'ready'
  let hitTestSource = null;
  let tapSource = null; // hit tests under the finger (room mode)
  let anchor = null;
  let stableFrames = 0;
  let request = null; // what to do in the next AR frame: 'place' | 'home-a' | 'home-b'
  let homeA = null;
  let lastTap = null;
  const basePos = new THREE.Vector3(); // where the home spot is; nudgeY lifts or lowers the garden from there
  let nudgeY = 0;

  const reticleMat = new THREE.MeshBasicMaterial({ color: '#5fe3b9', transparent: true, opacity: 0.9, depthTest: false });
  const makeRing = () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.RingGeometry(0.07, 0.09, 40).rotateX(-Math.PI / 2), reticleMat));
    g.add(new THREE.Mesh(new THREE.CircleGeometry(0.012, 16).rotateX(-Math.PI / 2), reticleMat));
    g.renderOrder = 20;
    return g;
  };
  const reticle = makeRing();
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
  // Marks the first home-spot tap while you choose the edge direction.
  const homeMarker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.12, 12).translate(0, 0.06, 0),
    new THREE.MeshBasicMaterial({ color: '#ffcf7a', depthTest: false })
  );
  homeMarker.visible = false;
  scene.add(homeMarker);

  const controller = renderer.xr.getController(0);
  scene.add(controller);
  controller.addEventListener('select', onSelect);

  // Taps on the on-screen controls shouldn't also plant things.
  hud.overlayRoot.addEventListener('beforexrselect', (e) => {
    if (e.target.closest?.('button, input, label, .panel, .toolbar, .selection, .ar-chooser')) e.preventDefault();
  });

  const setButtons = (visible, label) => {
    for (const b of buttons) {
      if (!b) continue;
      b.hidden = !visible;
      if (label) b.textContent = label;
    }
    refreshRoomButton();
  };
  let arSupported = false;
  function refreshRoomButton() {
    if (roomBtn) roomBtn.hidden = !(arSupported && !session && hasRoomGarden?.());
  }
  // One tap straight into the life-size room garden, no chooser.
  roomBtn?.addEventListener('click', () => {
    if (!session) start('room');
  });
  for (const b of nudgeBox?.querySelectorAll('button') ?? []) {
    b.addEventListener('click', () => {
      nudgeY += Number(b.dataset.dy);
      root.position.copy(basePos).y += nudgeY;
      hud.setHint(nudgeY === 0 ? 'Garden back at the home spot height' : `Garden ${nudgeY > 0 ? 'raised' : 'lowered'} ${Math.round(Math.abs(nudgeY) * 100)} cm`, false, 2000);
    });
  }

  if (!navigator.xr) {
    note.textContent = window.isSecureContext
      ? "AR isn't available in this browser. On Android, use Chrome. iPhone support will come with the app."
      : 'AR needs a secure (https) link. Use the published version on your phone.';
  } else {
    navigator.xr.isSessionSupported('immersive-ar').then((ok) => {
      if (ok) {
        arSupported = true;
        setButtons(true);
        note.textContent = 'Life-size room: plant on your real floor, tables and walls. Tabletop: your patch, shrunk onto a surface.';
      } else {
        note.textContent = "This device doesn't support AR in the browser. On Android, use Chrome and install Google Play Services for AR. iPhone support will come with the app.";
      }
    });
  }

  for (const b of buttons) {
    b?.addEventListener('click', () => {
      if (session) session.end();
      else hud.chooseARMode((m) => m && start(m)); // runs inside the click, so AR is allowed to start
    });
  }

  moveBtn?.addEventListener('click', () => {
    if (!session) return;
    if (mode === 'room') beginHomeSpot(true);
    else {
      unplace();
      step = 'find';
      hud.setHint('Find a surface again, then tap to move your patch there');
    }
  });

  async function start(m) {
    try {
      session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'anchors', 'light-estimation'],
        domOverlay: { root: hud.overlayRoot },
      });
    } catch (err) {
      session = null;
      note.textContent = `Couldn't start AR: ${err.message}`;
      hud.setHint(`Couldn't start AR: ${err.message}`, true, 5000);
      return;
    }
    mode = m;
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);
    arMode.enter();
    onModeChange?.(mode);
    arMode.setPatchVisible(mode === 'tabletop');
    setButtons(true, 'Exit AR');
    document.body.classList.add('in-ar');
    session.addEventListener('end', onEnd);

    const viewerSpace = await session.requestReferenceSpace('viewer');
    hitTestSource = await requestPlaneHits(() => session.requestHitTestSource({ space: viewerSpace, entityTypes: ['plane'] }), () =>
      session.requestHitTestSource({ space: viewerSpace })
    );
    if (mode === 'room') {
      tapSource = await requestPlaneHits(
        () => session.requestHitTestSourceForTransientInput({ profile: 'generic-touchscreen', entityTypes: ['plane'] }),
        () => session.requestHitTestSourceForTransientInput({ profile: 'generic-touchscreen' })
      ).catch(() => null);
      beginHomeSpot(false);
    } else {
      unplace();
      step = 'find';
      hud.setHint('Move your phone slowly over the floor until the green ring appears');
    }
  }

  async function requestPlaneHits(preferred, fallback) {
    try {
      return await preferred();
    } catch {
      return fallback();
    }
  }

  function beginHomeSpot(again) {
    unplace();
    nudgeY = 0;
    root.quaternion.identity();
    step = 'home-a';
    homeA = null;
    homeMarker.visible = false;
    const returning = hasRoomGarden?.();
    hud.setHint(
      returning || again
        ? 'Aim the ring at the SAME corner as last time, then tap'
        : 'Choose a home spot you can find again, like a table corner. Aim the ring at it and tap'
    );
  }

  function unplace() {
    root.visible = false;
    request = null;
    anchor?.delete?.();
    anchor = null;
    stableFrames = 0;
    if (moveBtn) moveBtn.hidden = true;
    if (nudgeBox) nudgeBox.hidden = true;
  }

  function onEnd() {
    hitTestSource = null;
    tapSource = null;
    session = null;
    anchor = null;
    step = null;
    reticle.visible = false;
    homeMarker.visible = false;
    root.visible = true;
    root.position.set(0, 0, 0);
    root.quaternion.identity();
    root.scale.setScalar(1);
    arMode.setPatchVisible(true);
    arMode.exit();
    mode = null;
    onModeChange?.(null);
    setButtons(true, 'View in AR');
    if (moveBtn) moveBtn.hidden = true;
    if (nudgeBox) nudgeBox.hidden = true;
    document.body.classList.remove('in-ar');
    hud.setHint('Back in the 3D view', false, 2500);
  }

  function onSelect() {
    if (step === 'find' || step === 'home-a' || step === 'home-b') {
      if (!reticle.visible || (step !== 'home-b' && stableFrames < STABLE_FRAMES)) {
        hud.setHint('Still looking for a surface. Move the phone slowly', true, 2500);
        return;
      }
      request = step === 'find' ? 'place' : step;
      return;
    }
    if (step !== 'ready') return;
    const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(controller.matrixWorld));
    let real = null;
    if (mode === 'room' && lastTap && performance.now() - lastTap.time < 600) {
      const inv = root.quaternion.clone().invert();
      real = {
        position: root.worldToLocal(lastTap.position.clone()),
        normal: lastTap.normal.clone().applyQuaternion(inv).normalize(),
        distanceWorld: lastTap.position.distanceTo(origin),
      };
    }
    onSelectRay(origin, dir, real);
  }

  function pinWith(hit) {
    hit.createAnchor?.()?.then(
      (a) => {
        if (step === 'ready' || step === 'home-b') anchor = a;
        else a.delete?.();
      },
      () => {} // no anchor support: the fixed position still works
    );
  }

  function finishTabletop() {
    root.position.setFromMatrixPosition(reticle.matrix);
    const cam = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(cam.x - root.position.x, cam.z - root.position.z));
    root.scale.setScalar(TABLETOP_SCALE);
    root.visible = true;
    step = 'ready';
    reticle.visible = false;
    if (moveBtn) {
      moveBtn.textContent = 'Move patch';
      moveBtn.hidden = false;
    }
    hud.setHint('Patch placed. Pick something and tap to plant', false, 4000);
  }

  function finishRoom(b) {
    const dx = b.x - homeA.x;
    const dz = b.z - homeA.z;
    if (Math.hypot(dx, dz) < MIN_EDGE) {
      hud.setHint('Too close to the corner. Tap a point further along the edge', true, 3000);
      return;
    }
    basePos.copy(homeA);
    root.position.copy(homeA);
    root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-dz, dx));
    if (nudgeBox) nudgeBox.hidden = false;
    root.scale.setScalar(1);
    root.visible = true;
    step = 'ready';
    reticle.visible = false;
    homeMarker.visible = false;
    if (moveBtn) {
      moveBtn.textContent = 'Set home again';
      moveBtn.hidden = false;
    }
    hud.setHint(
      hasRoomGarden?.() ? 'Welcome back! Your garden is where you left it' : 'Home set. Pick something and tap any floor, table or wall',
      false,
      5000
    );
  }

  return {
    get active() {
      return !!session;
    },
    get mode() {
      return mode;
    },
    update(frame) {
      if (!frame || !session) return;
      const refSpace = renderer.xr.getReferenceSpace();

      if (step === 'ready') {
        if (anchor && frame.trackedAnchors?.has(anchor)) {
          const pose = frame.getPose(anchor.anchorSpace, refSpace);
          if (pose) {
            basePos.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
            root.position.copy(basePos).y += nudgeY;
          }
        }
        if (tapSource) {
          for (const input of frame.getHitTestResultsForTransientInput(tapSource)) {
            const hit = input.results[0];
            if (!hit) continue;
            const pose = hit.getPose(refSpace);
            const o = pose.transform.orientation;
            lastTap = {
              position: new THREE.Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z),
              normal: new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(o.x, o.y, o.z, o.w)),
              time: performance.now(),
            };
          }
        }
        return;
      }

      if (!hitTestSource) return;
      const hits = frame.getHitTestResults(hitTestSource);
      if (!hits.length) {
        reticle.visible = false;
        stableFrames = 0;
        return; // keep the preview steady through brief tracking gaps

      }
      const pose = hits[0].getPose(refSpace);
      reticle.visible = true;
      reticle.matrix.fromArray(pose.transform.matrix);
      stableFrames++;
      reticleMat.opacity = stableFrames >= STABLE_FRAMES ? 0.95 : 0.4;

      const at = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
      // Live preview once the corner is set: the garden turns as you aim
      // along the edge, so you can line it up before the second tap.
      if (step === 'home-b' && homeA) {
        root.position.copy(homeA);
        const dx = at.x - homeA.x;
        const dz = at.z - homeA.z;
        if (Math.hypot(dx, dz) >= MIN_EDGE) root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-dz, dx));
        root.visible = true;
      }
      if (request === 'place') {
        request = null;
        finishTabletop();
        pinWith(hits[0]);
      } else if (request === 'home-a') {
        request = null;
        homeA = at;
        homeMarker.position.copy(at);
        homeMarker.visible = true;
        step = 'home-b';
        pinWith(hits[0]);
        hud.setHint('Now aim along the same edge. The garden turns with the ring. Tap when it lines up');
      } else if (request === 'home-b') {
        request = null;
        finishRoom(at);
      }
    },
  };
}
