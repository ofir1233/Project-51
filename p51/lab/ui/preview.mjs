import { api } from '../api.mjs';
import { getState, subscribe } from '../state.mjs';
import { mountPointCloud } from '../pointcloud-embed.mjs';
import { mountMultiGroupCloud } from '../pointcloud-multigroup.mjs';

let cloud = null;
let multiCloud = null;
let currentMode = 'create';
let canvas, sourceEl, emptyEl;
let lastSrc = null;
let tunablesByKey = {};

const TUNABLES = [
  { key: '--portrait-density',     label: 'density',  type: 'range', min: 1,    max: 6,    step: 1,     fmt: v => `${v}` },
  { key: '--portrait-point-size',  label: 'point sz', type: 'range', min: 0.4,  max: 3.0,  step: 0.05,  fmt: v => `${(+v).toFixed(2)}` },
  { key: '--portrait-lum-cutoff',  label: 'cutoff',   type: 'range', min: 0.4,  max: 0.95, step: 0.01,  fmt: v => `${(+v).toFixed(2)}` },
  { key: '--portrait-depth',       label: 'depth',    type: 'range', min: 0,    max: 1.2,  step: 0.01,  fmt: v => `${(+v).toFixed(2)}` },
  { key: '--portrait-noise',       label: 'noise',    type: 'range', min: 0,    max: 0.12, step: 0.001, fmt: v => `${(+v).toFixed(3)}` },
  { key: '--portrait-mouse-force', label: 'mouse',    type: 'range', min: 0,    max: 0.6,  step: 0.01,  fmt: v => `${(+v).toFixed(2)}` },
  { key: '--portrait-parallax',    label: 'parallax', type: 'range', min: 0,    max: 0.5,  step: 0.01,  fmt: v => `${(+v).toFixed(2)}` },
  { key: '--portrait-color',       label: 'lime',     type: 'color' },
  { key: '--portrait-color-cold',  label: 'cold',     type: 'color' },
];

export async function mountPreview() {
  canvas   = document.getElementById('labCanvas');
  sourceEl = document.querySelector('[data-role="preview-source"]');
  emptyEl  = document.querySelector('[data-role="preview-empty"]');

  // load tunables → push as :root CSS vars + render sliders
  try {
    tunablesByKey = await api.tunables();
    applyAllTunables();
  } catch (e) {
    console.warn('[preview] tunables failed', e);
  }
  renderTunables();
  openTunablesStream();

  await waitForGlobal('THREE', 3000);
  if (!window.THREE) {
    console.warn('[preview] THREE.js failed to load');
    showEmpty('three.js failed');
    return;
  }

  cloud = mountPointCloud(canvas, {
    imageUrl: '/p51/assets/Pair.jpg',  // approved-default
    getVar: (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim(),
  });
  lastSrc = '/p51/assets/Pair.jpg';

  // STAGE mode swap-in: when entering STAGE we destroy the simple cloud
  // and mount the multi-group renderer with the selected generation's scene graph.
  document.addEventListener('lab:mode-changed', async (e) => {
    const mode = e.detail.mode;
    currentMode = mode;
    if (mode === 'stage') await switchToMultiGroup();
    else                 await switchToSimple();
  });

  sourceEl.addEventListener('change', updateSource);

  // Approve & snapshot wiring
  const approveBtn  = document.querySelector('[data-role="approve"]');
  const slotEl      = document.querySelector('[data-role="approve-slot"]');
  const snapshotBtn = document.querySelector('[data-role="snapshot"]');
  approveBtn.addEventListener('click', async () => {
    const { selectedId } = getState();
    if (!selectedId) return alert('select a generation first');
    const slot = slotEl.value;
    approveBtn.disabled = true;
    try {
      await api.approve({ generationId: selectedId, slot });
      await loadSnapshots();
      // bust the live cache and refresh approved view
      const url = `/p51/assets/${slot}?ts=${Math.floor(Date.now() / 1000)}`;
      cloud.setImage(url); lastSrc = url; sourceEl.value = 'approved';
    } catch (e) { alert('approve failed: ' + e.message); }
    finally { approveBtn.disabled = false; }
  });
  snapshotBtn.addEventListener('click', async () => {
    const slot = slotEl.value;
    try { await api.snapshotNow({ slot }); await loadSnapshots(); }
    catch (e) { alert('snapshot failed: ' + e.message); }
  });

  // Enable approve when a generation is selected
  subscribe(state => {
    approveBtn.disabled = !state.selectedId;
  });

  await loadSnapshots();

  subscribe(state => {
    if (state.previewSource === 'selected' && state.selectedId) {
      const g = state.generations.find(x => x.id === state.selectedId);
      if (g) {
        const url = g.imageUrl;
        if (url !== lastSrc) { cloud.setImage(url); lastSrc = url; }
        sourceEl.value = 'selected';
      }
    } else if (state.previewSource === 'approved') {
      // bust cache so a swap shows fresh
      const url = '/p51/assets/Pair.jpg?ts=' + Math.floor(Date.now() / 1000);
      if (lastSrc !== url) { cloud.setImage(url); lastSrc = url; }
      sourceEl.value = 'approved';
    }
  });
}

function updateSource() {
  const v = sourceEl.value;
  if (v === 'approved') {
    const url = '/p51/assets/Pair.jpg?ts=' + Math.floor(Date.now() / 1000);
    cloud.setImage(url); lastSrc = url;
  } else {
    const { selectedId, generations } = getState();
    const g = generations.find(x => x.id === selectedId);
    if (g) { cloud.setImage(g.imageUrl); lastSrc = g.imageUrl; }
  }
}

function applyAllTunables() {
  for (const [k, v] of Object.entries(tunablesByKey)) {
    document.documentElement.style.setProperty(k, v);
  }
}

function renderTunables() {
  const host = document.querySelector('[data-role="tunables"]');
  host.innerHTML = TUNABLES.map(t => {
    const v = tunablesByKey[t.key] ?? '';
    if (t.type === 'range') {
      return `
        <label class="field-label">${t.label}</label>
        <input type="range" min="${t.min}" max="${t.max}" step="${t.step}" value="${v}" data-tk="${t.key}">
        <span class="val" data-vk="${t.key}">${t.fmt(v)}</span>`;
    }
    return `
      <label class="field-label">${t.label}</label>
      <input type="color" value="${v}" data-tk="${t.key}">
      <span class="val" data-vk="${t.key}">${v}</span>`;
  }).join('');
  for (const inp of host.querySelectorAll('[data-tk]')) {
    inp.addEventListener('input', debounce(e => onTunableChange(e.target.dataset.tk, e.target.value), 60));
  }
}

async function onTunableChange(key, value) {
  tunablesByKey[key] = value;
  document.documentElement.style.setProperty(key, value);
  // resample if density / cutoff changed
  if (cloud && (key === '--portrait-density' || key === '--portrait-lum-cutoff')) {
    cloud.resample();
  }
  const valEl = document.querySelector(`[data-vk="${key}"]`);
  if (valEl) {
    const t = TUNABLES.find(x => x.key === key);
    valEl.textContent = t?.fmt ? t.fmt(value) : value;
  }
  // persist (debounced via outer debounce already)
  try { await api.setTunable(key, value); } catch (e) { console.warn('[tunable] save failed', e); }
}

function openTunablesStream() {
  try {
    const es = new EventSource('/api/tunables/stream');
    es.addEventListener('tunable', e => {
      const { key, value } = JSON.parse(e.data);
      tunablesByKey[key] = value;
      document.documentElement.style.setProperty(key, value);
      const inp = document.querySelector(`[data-tk="${key}"]`);
      if (inp && inp.value !== value) inp.value = value;
      const valEl = document.querySelector(`[data-vk="${key}"]`);
      if (valEl) {
        const t = TUNABLES.find(x => x.key === key);
        valEl.textContent = t?.fmt ? t.fmt(value) : value;
      }
    });
  } catch {}
}

async function switchToMultiGroup() {
  const { selectedId } = getState();
  if (!selectedId) return;
  // Pull elements + scene graph
  const [elemsRes, sgRes] = await Promise.all([
    api.elementsList(selectedId),
    api.getSceneGraph(selectedId),
  ]);
  const sceneGraph = (sgRes?.graph) || { groups: [] };
  sceneGraph._elements = elemsRes.items || [];

  if (cloud) { cloud.destroy?.(); cloud = null; }
  if (multiCloud) { multiCloud.destroy?.(); multiCloud = null; }
  const g = getState().generations.find(x => x.id === selectedId);
  multiCloud = mountMultiGroupCloud(canvas, {
    imageUrl: g?.imageUrl || '/p51/assets/Pair.jpg',
    sceneGraph,
    getVar: (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim(),
  });
}

async function switchToSimple() {
  if (multiCloud) { multiCloud.destroy?.(); multiCloud = null; }
  if (!cloud) {
    cloud = mountPointCloud(canvas, {
      imageUrl: lastSrc || '/p51/assets/Pair.jpg',
      getVar: (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim(),
    });
  }
}

async function loadSnapshots() {
  const host = document.querySelector('[data-role="snapshots"]');
  try {
    const { items } = await api.snapshotsList();
    if (!items || !items.length) {
      host.innerHTML = `<div style="color: var(--p51-t-15); font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; padding: 8px 0;">— none yet</div>`;
      return;
    }
    host.innerHTML = items.slice(0, 20).map(s => `
      <div class="lab-snapshot-row">
        <span class="when">${new Date(s.created_at).toLocaleString('en-GB', { hour12: false })} · ${s.slot} · ${s.reason}</span>
        <button class="btn btn-sm btn-ghost" data-restore="${s.id}">↺</button>
      </div>`).join('');
    host.querySelectorAll('[data-restore]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('restore this snapshot?')) return;
        try { await api.restoreSnapshot(btn.dataset.restore); await loadSnapshots(); }
        catch (e) { alert('restore failed: ' + e.message); }
      });
    });
  } catch (e) { console.error('[snapshots]', e); }
}

function showEmpty(msg) {
  if (emptyEl) { emptyEl.hidden = false; emptyEl.textContent = msg; }
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function waitForGlobal(name, ms = 2000) {
  return new Promise(r => {
    if (window[name]) return r(true);
    const start = Date.now();
    const t = setInterval(() => {
      if (window[name]) { clearInterval(t); r(true); }
      else if (Date.now() - start > ms) { clearInterval(t); r(false); }
    }, 30);
  });
}
