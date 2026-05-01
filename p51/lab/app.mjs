import { api, setLabToken } from './api.mjs';
import { getState, setState, subscribe } from './state.mjs';
import { mountHistory } from './ui/history.mjs';
import { mountCompose } from './ui/compose.mjs';
import { mountPreview } from './ui/preview.mjs';
import { mountApprove, approve } from './ui/approve.mjs';
import { mountChoreograph } from './ui/choreograph.mjs';

// Phase 1 entrypoint — wire health, providers, history.
// Phase 2 will mount compose+preview panels too.

async function boot() {
  // Mount the brand cursor (dot + ring). p51.js declares `const P51` at top level
  // of a classic script — it's script-scoped, NOT on window — so a module can't
  // see it. We re-implement the same 10 lines of logic here. CSS for .cursor-dot
  // and .cursor-ring already lives in /p51/tokens.css so we just need the DOM.
  initBrandCursor();

  // Pull lab token from a meta tag (server injects this in phase 0/1 via static middleware
  // — skipped for now; phase 5 promote ops will require it).
  const meta = document.querySelector('meta[name="lab-token"]');
  if (meta) setLabToken(meta.getAttribute('content'));

  try {
    const health = await api.health();
    setState({ health });
    document.querySelector('[data-role="health-pill"]').textContent =
      `${health.host}:${health.port} · ${health.geminiKey}`;
  } catch (e) {
    document.querySelector('[data-role="health-pill"]').textContent = '/api/health · ERROR';
    document.querySelector('[data-role="status"]').dataset.state = 'error';
    console.error('[boot] health failed', e);
    return;
  }

  try {
    const providers = await api.providers();
    setState({ providers });
    document.querySelector('[data-role="provider-pill"]').textContent =
      `${providers.defaults.image} · ${providers.defaults.text}`;

    // populate provider <select>
    const sel = document.querySelector('[data-role="provider"]');
    sel.innerHTML = providers.image.map(p =>
      `<option value="${p.name}" ${p.name === providers.defaults.image ? 'selected' : ''} ${p.ready ? '' : 'disabled'}>${p.name}${p.ready ? '' : ' (no key)'}</option>`
    ).join('');
  } catch (e) {
    console.error('[boot] providers failed', e);
  }

  mountHistory();
  await mountCompose();
  await mountPreview();
  mountModes();
  mountApprove();
  mountChoreograph();
  mountWindowDrop();
  // expose for cross-module triggers
  window.labApprove = approve;

  // Reflect status in strip
  subscribe(state => {
    const s = document.querySelector('[data-role="status"]');
    s.textContent = state.status;
    s.dataset.state = state.status;
  });

  // ── keyboard shortcuts ──
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === '/') {
      e.preventDefault();
      document.querySelector('[data-role="search"]')?.focus();
    } else if (e.key === 'r' || e.key === 'R') {
      const btn = document.querySelector('[data-role="run-chain"]');
      if (btn && !btn.disabled) btn.click();
    } else if (e.key === 'a' || e.key === 'A') {
      const btn = document.querySelector('[data-role="abort"]');
      if (btn && !btn.hidden) btn.click();
    } else if (e.key === 's' || e.key === 'S') {
      document.querySelector('[data-role="snapshot"]')?.click();
    }
  });

  console.info('[lab] all phases booted · history · compose · preview · trace');
}

// Mode-tab switcher — show/hide columns and run mode-specific mounts.
function mountModes() {
  const grid = document.querySelector('.lab-grid');
  const modesNav = document.querySelector('.lab-modes');
  function setMode(mode) {
    grid.dataset.mode = mode;
    document.querySelectorAll('.lab-modes [data-mode]').forEach(b => b.classList.toggle('is-on', b.dataset.mode === mode));
    document.querySelectorAll('[data-shown-in]').forEach(el => {
      const list = (el.dataset.shownIn || '').split(/\s+/);
      el.hidden = !list.includes(mode);
    });
    updateStepDots(mode);
    document.dispatchEvent(new CustomEvent('lab:mode-changed', { detail: { mode } }));
  }

  // Click handler delegated to nav so children spans inside the buttons still work.
  modesNav.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (btn) setMode(btn.dataset.mode);
  });

  setMode('create');
  // Allow lazy mounts to switch the mode programmatically (e.g. from the approve overlay).
  window.labSetMode = setMode;

  // Update step-dot indicators as the user advances through the funnel.
  // Subscribe to state changes — when there's a selected generation, choreograph
  // step has data; when a scene-graph exists for it, stage step has data.
  subscribe(updateStepDotsFromState);
  updateStepDotsFromState(getState());

  function updateStepDots(activeMode) {
    const dots = {
      create:      document.querySelector('[data-role="step-dot-create"]'),
      choreograph: document.querySelector('[data-role="step-dot-choreograph"]'),
      stage:       document.querySelector('[data-role="step-dot-stage"]'),
    };
    for (const [m, dot] of Object.entries(dots)) {
      if (!dot) continue;
      dot.classList.toggle('is-active', m === activeMode);
    }
  }
  async function updateStepDotsFromState(state) {
    const createDot = document.querySelector('[data-role="step-dot-create"]');
    const choreoDot = document.querySelector('[data-role="step-dot-choreograph"]');
    const stageDot  = document.querySelector('[data-role="step-dot-stage"]');
    // CREATE step: has data once we have at least one generation
    if (createDot) createDot.classList.toggle('has-data', (state.generations?.length || 0) > 0);
    // CHOREOGRAPH step: has data once a generation is selected
    if (choreoDot) choreoDot.classList.toggle('has-data', !!state.selectedId);
    // STAGE step: has data once the selected generation has a saved scene graph
    if (stageDot) {
      let hasSG = false;
      if (state.selectedId) {
        try {
          const r = await fetch(`/api/scene-graphs/${state.selectedId}`);
          const j = await r.json();
          hasSG = !!j?.graph?.groups?.length;
        } catch {}
      }
      stageDot.classList.toggle('has-data', hasSG);
    }
  }
}

// Full-window drop target — anywhere on the page accepts image drops, uploads to .lab/refs/.
function mountWindowDrop() {
  const overlay = document.querySelector('[data-role="drop-overlay"]');
  if (!overlay) return;
  let dragDepth = 0;

  function hasFiles(e) {
    const t = e.dataTransfer;
    if (!t) return false;
    if (t.items) for (const i of t.items) if (i.kind === 'file') return true;
    return (t.types || []).includes('Files');
  }
  function show() { overlay.hidden = false; }
  function hide() { dragDepth = 0; overlay.hidden = true; }

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    show();
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) hide();
  });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    hide();
    const files = [...(e.dataTransfer?.files || [])].filter(f => /^image\/(png|jpeg|webp)$/.test(f.type));
    if (!files.length) return;
    // Reuse the upload path in compose.mjs by dispatching to a shared helper.
    document.dispatchEvent(new CustomEvent('lab:drop-files', { detail: { files } }));
  });
  // ESC dismisses if somehow stuck
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
}

// Mirrors p51.js initCursor — dot follows pointer 1:1, ring lerps behind.
function initBrandCursor() {
  if (window.matchMedia('(hover: none)').matches) return;
  const dot  = document.createElement('div');
  const ring = document.createElement('div');
  dot.className  = 'cursor-dot';
  ring.className = 'cursor-ring';
  document.body.appendChild(dot);
  document.body.appendChild(ring);

  let mx = innerWidth / 2, my = innerHeight / 2;
  let rx = mx, ry = my;
  document.addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY;
    dot.style.left = mx + 'px';
    dot.style.top  = my + 'px';
  });
  (function loop() {
    rx += (mx - rx) * 0.16;
    ry += (my - ry) * 0.16;
    ring.style.left = rx + 'px';
    ring.style.top  = ry + 'px';
    requestAnimationFrame(loop);
  })();
}

boot();
