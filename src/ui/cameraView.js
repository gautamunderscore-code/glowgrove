// Camera view: shows the device camera behind the garden. On a laptop this
// is a preview of the look (the garden doesn't track the room). Real tracking
// comes from AR mode on phones.

export function createCameraView({ hud, arMode, root, renderer, controls, onPhotoRequest }) {
  const video = document.getElementById('camera-feed');
  const camBtn = document.getElementById('cam-btn');
  const camControls = document.getElementById('cam-controls');
  const scaleInput = document.getElementById('patch-scale');
  const scaleOut = document.getElementById('patch-scale-out');
  const photoBtn = document.getElementById('photo-btn');
  let stream = null;

  if (!navigator.mediaDevices?.getUserMedia) {
    camBtn.disabled = true;
    document.getElementById('cam-note').textContent = window.isSecureContext
      ? "This browser can't use the camera."
      : 'The camera needs a secure (https or localhost) link.';
  }

  function setScale(pct) {
    root.scale.setScalar(pct / 100);
    controls.target.y = 1.3 * (pct / 100); // keep looking at the middle of the tree
    scaleOut.textContent = `${pct}%`;
  }

  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    } catch (err) {
      const denied = err.name === 'NotAllowedError';
      hud.setHint(denied ? 'Camera permission was blocked. Allow it in the browser settings.' : `Couldn't open the camera: ${err.message}`, true, 5000);
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    video.hidden = false;
    arMode.enter();
    camControls.hidden = false;
    camBtn.textContent = 'Turn camera off';
    setScale(Number(scaleInput.value));
    hud.setHint('Drag to tilt and turn. Right-drag or two fingers to slide the patch into place', false, 6000);
  }

  function stop() {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    video.srcObject = null;
    video.hidden = true;
    arMode.exit();
    camControls.hidden = true;
    camBtn.textContent = 'Use camera';
    root.scale.setScalar(1);
    controls.target.y = 1.3;
  }

  camBtn.addEventListener('click', () => (stream ? stop() : start()));
  scaleInput.addEventListener('input', () => setScale(Number(scaleInput.value)));
  photoBtn.addEventListener('click', () => onPhotoRequest(() => savePhoto(video, renderer.domElement)));

  return {
    get active() {
      return !!stream;
    },
  };
}

/** Combines the camera frame and the 3D garden into one PNG and downloads it.
 *  Must run right after a render, while the WebGL canvas still holds the frame. */
function savePhoto(video, glCanvas) {
  const out = document.createElement('canvas');
  out.width = glCanvas.width;
  out.height = glCanvas.height;
  const ctx = out.getContext('2d');
  if (video.videoWidth) {
    // Same crop as CSS object-fit: cover.
    const s = Math.max(out.width / video.videoWidth, out.height / video.videoHeight);
    const w = video.videoWidth * s;
    const h = video.videoHeight * s;
    ctx.drawImage(video, (out.width - w) / 2, (out.height - h) / 2, w, h);
  }
  ctx.drawImage(glCanvas, 0, 0);
  out.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `glowgrove-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
}
