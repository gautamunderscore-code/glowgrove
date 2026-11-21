// The on-screen controls. Kept separate from game logic so the UI can be
// redesigned freely.

const $ = (id) => document.getElementById(id);

export function createHud(pack, handlers) {
  const tools = $('tools');
  const hint = $('hint');
  let activeTool = null;
  let hintTimer = 0;

  const allTools = [
    ...pack.placeables.map((p) => ({ id: p.id, name: p.name, color: swatchColor(p), blurb: p.blurb, surfaces: p.surfaces })),
    { id: 'move', name: 'Move', color: 'transparent', symbol: '✥', blurb: 'Drag anything you planted to move it. Tap to select it.' },
    { id: 'remove', name: 'Remove', color: 'transparent', symbol: '✕', blurb: 'Tap something you planted to remove it.' },
  ];

  for (const t of allTools) {
    const btn = document.createElement('button');
    btn.className = 'tool';
    btn.dataset.tool = t.id;
    btn.innerHTML = `<span class="swatch"></span><span class="label"></span>`;
    btn.querySelector('.swatch').style.background = t.color;
    if (t.symbol) {
      btn.querySelector('.swatch').textContent = t.symbol;
      btn.querySelector('.swatch').classList.add('symbol');
    }
    btn.querySelector('.label').textContent = t.name;
    btn.addEventListener('click', () => selectTool(activeTool === t.id ? null : t.id));
    tools.appendChild(btn);
  }

  function selectTool(id) {
    activeTool = id;
    for (const b of tools.children) b.classList.toggle('active', b.dataset.tool === id);
    const t = allTools.find((x) => x.id === id);
    setHint(t ? `${t.name}: ${t.blurb}` : 'Pick something to plant, then tap the patch');
    handlers.onTool?.(id);
  }

  function setHint(text, warn = false, holdMs = 0) {
    clearTimeout(hintTimer);
    hint.textContent = text;
    hint.classList.toggle('warn', warn);
    if (holdMs) {
      hintTimer = setTimeout(() => {
        const t = allTools.find((x) => x.id === activeTool);
        setHint(t ? `${t.name}: ${t.blurb}` : 'Pick something to plant, then tap the patch');
      }, holdMs);
    }
  }

  // Settings panel.
  const panel = $('panel');
  const toggle = $('panel-toggle');
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  });

  for (const b of $('rates').querySelectorAll('button')) {
    b.addEventListener('click', () => handlers.onRate?.(Number(b.dataset.rate)));
  }
  for (const b of $('quality').querySelectorAll('button')) {
    b.addEventListener('click', () => handlers.onQuality?.(b.dataset.quality));
  }
  $('use-location').addEventListener('click', () => handlers.onLocation?.());
  $('show-patch').addEventListener('click', () => handlers.onShowGarden?.('patch'));
  $('show-room').addEventListener('click', () => handlers.onShowGarden?.('room'));
  $('to-night').addEventListener('click', () => handlers.onJump?.('night'));
  $('to-morning').addEventListener('click', () => handlers.onJump?.('morning'));
  $('new-tree').addEventListener('click', () => handlers.onNewTree?.());
  $('clear').addEventListener('click', () => {
    if (confirm('Clear everything you planted in this patch?')) handlers.onClear?.();
  });

  const growth = $('growth');
  growth.addEventListener('input', () => {
    $('growth-out').textContent = `${growth.value}×`;
    handlers.onGrowth?.(Number(growth.value));
  });

  selectTool(null);

  // Selection card.
  const card = $('selection');
  let onSelectionAction = null;
  $('sel-delete').addEventListener('click', () => onSelectionAction?.('delete'));
  $('sel-done').addEventListener('click', () => onSelectionAction?.('done'));
  // Size slider: 0..100 maps to 0.25x .. 4x on a log scale (50 = 1x).
  const sliderToScale = (v) => Math.round(0.25 * Math.pow(16, v / 100) * 100) / 100;
  const scaleToSlider = (k) => Math.round((Math.log(k / 0.25) / Math.log(16)) * 100);
  const scaleInput = $('sel-scale');
  const showScale = (k) => ($('sel-scale-out').textContent = `${k}×`);
  scaleInput.addEventListener('input', () => {
    const k = sliderToScale(Number(scaleInput.value));
    showScale(k);
    onSelectionAction?.('scale', k, false);
  });
  scaleInput.addEventListener('change', () => onSelectionAction?.('scale', sliderToScale(Number(scaleInput.value)), true));

  // AR mode chooser.
  const chooser = $('ar-chooser');
  let chooserResolve = null;
  const closeChooser = (mode) => {
    chooser.hidden = true;
    chooserResolve?.(mode);
    chooserResolve = null;
  };
  $('ar-mode-room').addEventListener('click', () => closeChooser('room'));
  $('ar-mode-table').addEventListener('click', () => closeChooser('tabletop'));
  $('ar-mode-cancel').addEventListener('click', () => closeChooser(null));

  return {
    showSelection(name, status, scale = 1, sizeNote = '') {
      $('sel-name').textContent = name;
      $('sel-status').textContent = status;
      if (document.activeElement !== scaleInput) {
        scaleInput.value = scaleToSlider(scale);
        showScale(scale);
      }
      if (sizeNote) $('sel-scale-out').textContent = `${scale}× ${sizeNote}`;
      card.hidden = false;
    },
    /** Opens the AR chooser; onPick runs inside the button's click, so AR can start. */
    chooseARMode(onPick) {
      chooserResolve = onPick;
      chooser.hidden = false;
    },
    hideSelection() {
      card.hidden = true;
    },
    onSelectionAction(fn) {
      onSelectionAction = fn;
    },
    get activeTool() {
      return activeTool;
    },
    setHint,
    setClock(text, phase) {
      $('clock').textContent = text;
      $('phase-dot').style.background = phase === 'night' ? '#9fb4ff' : phase === 'dusk' ? '#ff9a5a' : '#ffd34d';
    },
    setStats(text) {
      $('stats').textContent = text;
    },
    setRate(rate) {
      for (const b of $('rates').querySelectorAll('button')) b.classList.toggle('active', Number(b.dataset.rate) === rate);
    },
    /** Counts for the two saved gardens, and which one is on screen. */
    setGardens({ patch, room, active }) {
      $('patch-count').textContent = `${patch} planted`;
      $('room-count').textContent = room ? `${room} planted · open AR → Life-size room to see it in your room` : 'Empty · start one with View in AR → Life-size room';
      $('show-patch').classList.toggle('active', active === 'patch');
      $('show-room').classList.toggle('active', active === 'room');
    },
    setLocationNote(text) {
      $('location-note').textContent = text;
    },
    setQuality(q) {
      for (const b of $('quality').querySelectorAll('button')) b.classList.toggle('active', b.dataset.quality === q);
    },
    setGrowth(v) {
      growth.value = v;
      $('growth-out').textContent = `${v}×`;
    },
    toast(html, ms = 5000) {
      const el = document.createElement('div');
      el.className = 'toast';
      el.innerHTML = html;
      $('toasts').prepend(el);
      while ($('toasts').children.length > 3) $('toasts').lastChild.remove();
      setTimeout(() => el.remove(), ms);
    },
    arButton: $('ar-btn'),
    arQuickButton: $('ar-quick'),
    arMoveButton: $('ar-move'),
    arNote: $('ar-note'),
    overlayRoot: $('hud'),
  };
}

function swatchColor(def) {
  const m = def.model;
  if (def.glow && m.capColor) return `radial-gradient(circle at 40% 35%, ${def.glow.color}, ${m.capColor})`;
  if (m.kind === 'tree') return 'radial-gradient(circle at 40% 35%, #7fbf4d, #3d6b2a)';
  if (m.kind === 'rock') return `radial-gradient(circle at 40% 35%, #c9c3b6, ${m.color})`;
  if (m.kind === 'grass') return 'radial-gradient(circle at 40% 35%, #b8d47a, #3f6a22)';
  if (m.kind === 'pond') return `radial-gradient(circle at 40% 35%, #8fd0e0, ${m.waterColor})`;
  if (m.kind === 'ivy') return `radial-gradient(circle at 40% 35%, #6fae4f, ${m.leafColor})`;
  if (m.kind === 'moss') return `radial-gradient(circle at 40% 35%, ${def.glow?.color ?? '#9fe08a'}, ${m.color})`;
  return `radial-gradient(circle at 50% 50%, ${m.centerColor ?? m.petalColor} 25%, ${m.petalColor} 30%)`;
}

/** Escape text before putting it in a toast. */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
