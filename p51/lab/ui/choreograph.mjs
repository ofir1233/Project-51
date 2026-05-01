// CHOREOGRAPH mode — image canvas with element bounding boxes + groups panel.
import { api } from '../api.mjs';
import { getState, setState, subscribe } from '../state.mjs';

const REACTION_KEYS = ['tint', 'scatter', 'pull', 'pulse', 'reveal', 'parallax'];
const GROUP_PALETTE = [
  { name: 'sacral',  color: '#c8ff00' },
  { name: 'ajna',    color: '#78aaff' },
  { name: 'throat',  color: '#ff8c50' },
  { name: 'spleen',  color: '#b478ff' },
  { name: 'heart',   color: '#ff5a78' },
  { name: 'solar',   color: '#ffd250' },
  { name: 'root',    color: '#8c5a3c' },
  { name: 'ego',     color: '#ffb4b4' },
];

// Local module state
let imgEl, overlayEl, emptyEl, listEl, groupsEl;
let detectBtn, manualBtn, clearBtn, addGroupBtn, saveBtn, gotoStageBtn;
let currentGenId = null;
let elements = [];          // detected/manual elements
let graph = { groups: [] }; // current scene graph
let selectedElementId = null;

export function mountChoreograph() {
  imgEl       = document.querySelector('[data-role="choreo-image"]');
  overlayEl   = document.querySelector('[data-role="choreo-overlay"]');
  emptyEl     = document.querySelector('[data-role="choreo-empty"]');
  listEl      = document.querySelector('[data-role="elements-list"]');
  groupsEl    = document.querySelector('[data-role="groups"]');
  detectBtn   = document.querySelector('[data-role="detect-elements"]');
  manualBtn   = document.querySelector('[data-role="add-manual-box"]');
  clearBtn    = document.querySelector('[data-role="clear-elements"]');
  addGroupBtn = document.querySelector('[data-role="add-group"]');
  saveBtn     = document.querySelector('[data-role="save-graph"]');
  gotoStageBtn = document.querySelector('[data-role="goto-stage"]');

  detectBtn.addEventListener('click', onDetect);
  clearBtn.addEventListener('click', onClear);
  manualBtn.addEventListener('click', onAddManualBox);
  addGroupBtn.addEventListener('click', onAddGroup);
  saveBtn.addEventListener('click', onSaveGraph);
  gotoStageBtn.addEventListener('click', () => window.labSetMode?.('stage'));

  // React to selection changes
  subscribe(state => {
    if (state.selectedId !== currentGenId) {
      loadFor(state.selectedId);
    }
  });

  // Mode change → re-trigger load if entering choreograph with a stale view
  document.addEventListener('lab:mode-changed', e => {
    if (e.detail.mode === 'choreograph') loadFor(getState().selectedId);
  });

  document.addEventListener('lab:select-generation', e => {
    setState({ selectedId: e.detail.id });
  });
}

async function loadFor(genId) {
  currentGenId = genId;
  if (!genId) {
    emptyEl.hidden = false;
    imgEl.removeAttribute('src');
    overlayEl.innerHTML = '';
    listEl.innerHTML = '';
    groupsEl.innerHTML = '';
    return;
  }
  try {
    const g = await api.getGeneration(genId);
    imgEl.src = g.imageUrl;
    emptyEl.hidden = true;
    elements = (await api.elementsList(genId)).items || [];
    const sg = await api.getSceneGraph(genId);
    graph = sg?.graph || { groups: [] };
    if (!graph.groups) graph.groups = [];
    selectedElementId = null;
    renderAll();
  } catch (e) {
    console.error('[choreo]', e);
  }
}

function renderAll() {
  renderOverlay();
  renderElementsList();
  renderGroups();
}

function renderOverlay() {
  overlayEl.setAttribute('viewBox', '0 0 100 100');
  overlayEl.innerHTML = elements.map(e => {
    const groupColor = colorForElement(e.id);
    const isSel = selectedElementId === e.id;
    return `<g data-elem-id="${e.id}">
      <rect class="choreo-bbox ${isSel ? 'is-selected' : ''}"
            x="${(e.bbox_x*100).toFixed(2)}" y="${(e.bbox_y*100).toFixed(2)}"
            width="${(e.bbox_w*100).toFixed(2)}" height="${(e.bbox_h*100).toFixed(2)}"
            ${groupColor ? `style="stroke:${groupColor}; fill:${groupColor}1A;"` : ''}/>
      <text class="choreo-label"
            x="${(e.bbox_x*100 + 1).toFixed(2)}"
            y="${(e.bbox_y*100 + 4).toFixed(2)}">${escapeHTML(e.label || '')}</text>
    </g>`;
  }).join('');
  overlayEl.querySelectorAll('[data-elem-id]').forEach(g => {
    g.addEventListener('click', () => { selectedElementId = g.dataset.elemId; renderAll(); });
  });
}

function renderElementsList() {
  if (!elements.length) {
    listEl.innerHTML = `<li style="color: var(--p51-t-15); border: none; padding: 8px 0;">no elements yet · click DETECT</li>`;
    return;
  }
  listEl.innerHTML = elements.map(e => {
    const groupName = groupNameForElement(e.id);
    const color = colorForElement(e.id);
    const isSel = selectedElementId === e.id;
    return `<li class="${isSel ? 'is-selected' : ''}" data-elem-id="${e.id}">
      <span class="swatch" style="background:${color || 'var(--p51-t-30)'}"></span>
      <span class="label">${escapeHTML(e.label)}</span>
      <span class="group-tag">${groupName || '—'}</span>
      <button class="lab-judge-btn" data-act="del" title="delete">×</button>
    </li>`;
  }).join('');
  listEl.querySelectorAll('[data-elem-id]').forEach(li => {
    li.addEventListener('click', e => {
      if (e.target.closest('[data-act="del"]')) {
        const id = li.dataset.elemId;
        api.deleteElement(id).then(() => {
          elements = elements.filter(x => x.id !== id);
          // also remove from any groups
          for (const grp of graph.groups) grp.elementIds = (grp.elementIds || []).filter(x => x !== id);
          renderAll();
        });
      } else {
        selectedElementId = li.dataset.elemId;
        renderAll();
      }
    });
  });
}

function renderGroups() {
  if (!graph.groups.length) {
    groupsEl.innerHTML = `<div style="color: var(--p51-t-15); font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; padding: 8px 0;">no groups · click + ADD GROUP</div>`;
    return;
  }
  groupsEl.innerHTML = graph.groups.map((g, i) => {
    const memberLabels = (g.elementIds || []).map(id => {
      const e = elements.find(x => x.id === id);
      return e ? `<span class="chip">${escapeHTML(e.label)}</span>` : '';
    }).join('');
    const reactionChips = REACTION_KEYS.map(k => {
      const on = g.reactions?.[k]?.enabled;
      return `<button class="lab-react-chip ${on ? 'is-on' : ''}" data-grp="${i}" data-react="${k}">${k}</button>`;
    }).join('');
    const intensity = (key) => Math.round((g.reactions?.[key]?.intensity ?? 0.5) * 100);
    const enabledIntensities = REACTION_KEYS
      .filter(k => g.reactions?.[k]?.enabled)
      .map(k => `
        <div class="lab-group-intensity">
          <span>${k}</span>
          <input type="range" min="0" max="100" value="${intensity(k)}" data-grp="${i}" data-int="${k}">
          <span class="val">${intensity(k)}%</span>
        </div>`).join('');
    return `
      <div class="lab-group" style="--group-color: ${g.color}">
        <div class="lab-group-head">
          <span class="lab-group-color" data-cycle-color="${i}" title="click to recolor"></span>
          <input class="lab-group-name" data-name="${i}" value="${escapeHTML(g.name)}"/>
          <button class="lab-react-chip" data-del-group="${i}">×</button>
        </div>
        <div class="lab-group-members">
          ${memberLabels || '<span class="empty">— add elements (select a box, click here)</span>'}
        </div>
        <button class="btn btn-sm btn-ghost" data-add-selected="${i}">＋ ADD SELECTED</button>
        <div class="lab-group-reactions">${reactionChips}</div>
        ${enabledIntensities}
      </div>`;
  }).join('');

  // Wire interactions
  groupsEl.querySelectorAll('[data-cycle-color]').forEach(el =>
    el.addEventListener('click', () => cycleGroupColor(+el.dataset.cycleColor)));
  groupsEl.querySelectorAll('[data-name]').forEach(el =>
    el.addEventListener('input', () => { graph.groups[+el.dataset.name].name = el.value; }));
  groupsEl.querySelectorAll('[data-del-group]').forEach(btn =>
    btn.addEventListener('click', () => { graph.groups.splice(+btn.dataset.delGroup, 1); renderGroups(); renderOverlay(); renderElementsList(); }));
  groupsEl.querySelectorAll('[data-react]').forEach(btn =>
    btn.addEventListener('click', () => toggleReaction(+btn.dataset.grp, btn.dataset.react)));
  groupsEl.querySelectorAll('[data-int]').forEach(slider =>
    slider.addEventListener('input', () => setIntensity(+slider.dataset.grp, slider.dataset.int, +slider.value / 100)));
  groupsEl.querySelectorAll('[data-add-selected]').forEach(btn =>
    btn.addEventListener('click', () => addSelectedToGroup(+btn.dataset.addSelected)));
}

function colorForElement(elemId) {
  for (const g of graph.groups) if ((g.elementIds || []).includes(elemId)) return g.color;
  return null;
}
function groupNameForElement(elemId) {
  for (const g of graph.groups) if ((g.elementIds || []).includes(elemId)) return g.name;
  return null;
}

function toggleReaction(groupIdx, key) {
  const g = graph.groups[groupIdx];
  if (!g.reactions) g.reactions = {};
  if (!g.reactions[key]) g.reactions[key] = { enabled: true, intensity: 0.5 };
  else g.reactions[key].enabled = !g.reactions[key].enabled;
  renderGroups();
}
function setIntensity(groupIdx, key, val) {
  const g = graph.groups[groupIdx];
  if (!g.reactions[key]) g.reactions[key] = { enabled: true, intensity: 0.5 };
  g.reactions[key].intensity = val;
}
function addSelectedToGroup(groupIdx) {
  if (!selectedElementId) return alert('select an element first');
  const g = graph.groups[groupIdx];
  if (!g.elementIds) g.elementIds = [];
  // remove from any other group
  for (const og of graph.groups) og.elementIds = (og.elementIds || []).filter(x => x !== selectedElementId);
  g.elementIds.push(selectedElementId);
  renderAll();
}

function onAddGroup() {
  const i = graph.groups.length % GROUP_PALETTE.length;
  const swatch = GROUP_PALETTE[i];
  graph.groups.push({
    id: 'g' + (graph.groups.length + 1),
    name: swatch.name,
    color: swatch.color,
    elementIds: [],
    reactions: { tint: { enabled: true, intensity: 0.7 } },
  });
  renderGroups();
}
function cycleGroupColor(idx) {
  const g = graph.groups[idx];
  const curIdx = GROUP_PALETTE.findIndex(p => p.color.toLowerCase() === (g.color || '').toLowerCase());
  const next = GROUP_PALETTE[(curIdx + 1) % GROUP_PALETTE.length];
  g.color = next.color;
  g.name = next.name;
  renderAll();
}

async function onDetect() {
  if (!currentGenId) return;
  detectBtn.disabled = true; detectBtn.textContent = 'DETECTING…';
  try {
    const r = await api.detectElements(currentGenId);
    elements = r.elements || [];
    selectedElementId = null;
    renderAll();
  } catch (e) { alert('detect failed: ' + e.message); }
  finally { detectBtn.disabled = false; detectBtn.textContent = 'DETECT ELEMENTS'; }
}
async function onClear() {
  if (!currentGenId) return;
  if (!confirm('clear all elements (and groups)?')) return;
  await api.clearElements(currentGenId);
  elements = [];
  graph.groups = [];
  renderAll();
}
async function onAddManualBox() {
  if (!currentGenId) return;
  const label = prompt('label for the new box?', 'manual');
  if (!label) return;
  const r = await api.addElement({ generationId: currentGenId, label, bbox: [0.3, 0.3, 0.4, 0.4] });
  elements.push(r);
  selectedElementId = r.id;
  renderAll();
}

async function onSaveGraph() {
  if (!currentGenId) return;
  saveBtn.disabled = true;
  try {
    await api.saveSceneGraph(currentGenId, graph);
    saveBtn.textContent = 'SAVED ✓';
    setTimeout(() => { saveBtn.textContent = 'SAVE SCENE'; saveBtn.disabled = false; }, 1200);
  } catch (e) { alert('save failed: ' + e.message); saveBtn.disabled = false; }
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
