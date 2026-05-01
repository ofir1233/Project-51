import { api } from '../api.mjs';
import { setState, getState } from '../state.mjs';
import { refresh as refreshHistory } from './history.mjs';
import { mountTrace, startChainStream } from './trace.mjs';

let goalEl, refsEl, providerEl, singleEl, runEl, abortEl, statusEl;
let itersEl, thresholdEl;
let refsCache = [];
let selectedRefIds = new Set();
let _provReady = false;

export async function mountCompose() {
  goalEl       = document.querySelector('[data-role="goal"]');
  refsEl       = document.querySelector('[data-role="refs"]');
  providerEl   = document.querySelector('[data-role="provider"]');
  singleEl     = document.querySelector('[data-role="single-shot"]');
  runEl        = document.querySelector('[data-role="run-chain"]');
  abortEl      = document.querySelector('[data-role="abort"]');
  statusEl     = document.querySelector('[data-role="status"]');
  itersEl      = document.querySelector('[data-role="max-iters"]');
  thresholdEl  = document.querySelector('[data-role="threshold"]');

  // load available refs
  await loadRefs();
  mountTrace();

  // Listen for files dropped anywhere on the window (full-window drop target)
  document.addEventListener('lab:drop-files', (e) => {
    if (e.detail?.files) uploadFiles(e.detail.files);
  });

  // Enable RUN CHAIN only if a non-stub provider is ready (gemini key present).
  _provReady = await checkProvReady();
  if (_provReady && goalEl.value.trim()) runEl.disabled = false;
  updateRunHint();
  updateAdvancedSummary();

  goalEl.addEventListener('input', () => {
    updateRunHint();
  });
  itersEl.addEventListener('input',     updateAdvancedSummary);
  thresholdEl.addEventListener('input', updateAdvancedSummary);
  providerEl.addEventListener('change', updateAdvancedSummary);

  singleEl.addEventListener('click', onSingleShot);
  runEl.addEventListener('click', onRunChain);
}

function updateRunHint() {
  const hintEl = document.querySelector('[data-role="run-hint"]');
  const goal = goalEl.value.trim();
  if (!_provReady) {
    runEl.disabled = true;
    if (hintEl) hintEl.textContent = '— paste GEMINI_API_KEY in .lab/.env';
    return;
  }
  if (!goal) {
    runEl.disabled = true;
    if (hintEl) hintEl.textContent = '— add a goal first';
    return;
  }
  runEl.disabled = false;
  if (hintEl) {
    const refs = selectedRefIds.size;
    hintEl.textContent = refs ? `${refs} ref${refs > 1 ? 's' : ''} · 6 agents · auto-iterate` : `no refs · text-only · 6 agents`;
  }
}

function updateAdvancedSummary() {
  const sum = document.querySelector('[data-role="advanced-summary"]');
  if (!sum) return;
  const iters = itersEl?.value || 3;
  const thresh = thresholdEl?.value || 8;
  const prov = providerEl?.value || 'gemini-image';
  sum.textContent = `iters ${iters} · score ≥ ${thresh} · ${prov}`;
}

async function checkProvReady() {
  try {
    const p = await api.providers();
    return p.image.some(x => x.name !== 'stub-image' && x.ready);
  } catch { return false; }
}

async function onRunChain() {
  const goal = goalEl.value.trim();
  if (!goal) { flash(goalEl); return; }
  runEl.disabled = true;
  try {
    await startChainStream({
      goal,
      refIds: Array.from(selectedRefIds),
      maxIters: Number(itersEl.value || 3),
      scoreThreshold: Number(thresholdEl.value || 8),
      provider: providerEl.value,
    }, abortEl);
  } finally {
    runEl.disabled = false;
  }
}

async function loadRefs() {
  try {
    const { items } = await api.refsList();
    refsCache = items;
    // drop selections that no longer exist
    for (const id of Array.from(selectedRefIds)) {
      if (!refsCache.find(r => r.id === id)) selectedRefIds.delete(id);
    }
    renderRefs();
  } catch (e) {
    console.error('[compose] refs failed', e);
  }
  wireUpload();
}

function renderRefs() {
  if (!refsCache.length) {
    refsEl.innerHTML = '<span class="lab-ref-empty">— no refs uploaded yet</span>';
    return;
  }
  refsEl.innerHTML = refsCache.map(r => {
    const on = selectedRefIds.has(r.id) ? 'is-on' : '';
    return `<span class="lab-ref-chip ${on}" data-ref-id="${r.id}">
      <span class="thumb" style="background-image: url('${r.url}')"></span>
      <span>${r.name}</span>
      <button class="lab-judge-btn" style="width:18px; height:18px; font-size:10px;" data-del-ref="${r.name}" title="delete">×</button>
    </span>`;
  }).join('');
  for (const chip of refsEl.querySelectorAll('[data-ref-id]')) {
    chip.addEventListener('click', e => {
      if (e.target.closest('[data-del-ref]')) return;
      toggleRef(chip.dataset.refId);
    });
  }
  for (const del of refsEl.querySelectorAll('[data-del-ref]')) {
    del.addEventListener('click', async e => {
      e.stopPropagation();
      try { await api.deleteRef(del.dataset.delRef); await loadRefs(); }
      catch (err) { console.error('[ref delete]', err); }
    });
  }
}

function toggleRef(id) {
  if (selectedRefIds.has(id)) selectedRefIds.delete(id);
  else selectedRefIds.add(id);
  renderRefs();
  updateRunHint();
}

let uploadWired = false;
function wireUpload() {
  if (uploadWired) return;
  uploadWired = true;
  const dropZone = document.querySelector('[data-role="ref-drop"]');
  const fileInput = document.querySelector('[data-role="ref-file"]');
  const pickBtn = document.querySelector('[data-role="ref-pick"]');
  if (!dropZone || !fileInput || !pickBtn) return;

  pickBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => uploadFiles([...fileInput.files]));

  ['dragenter', 'dragover'].forEach(ev =>
    dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('is-dragover'); }));
  ['dragleave', 'drop'].forEach(ev =>
    dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.remove('is-dragover'); }));
  dropZone.addEventListener('drop', e => {
    if (!e.dataTransfer?.files) return;
    uploadFiles([...e.dataTransfer.files]);
  });
}

async function uploadFiles(files) {
  for (const f of files) {
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) continue;
    try {
      const b64 = await fileToBase64(f);
      await api.uploadRef({ name: f.name, base64: b64, mime: f.type });
    } catch (e) {
      console.error('[upload]', e);
    }
  }
  await loadRefs();
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function onSingleShot() {
  const prompt = goalEl.value.trim();
  if (!prompt) { flash(goalEl); return; }

  const provider = providerEl.value;
  setStatus('running');
  singleEl.disabled = true;

  try {
    const refIds = Array.from(selectedRefIds);
    const result = await api.generateStandalone({ prompt, refIds, provider, goal: prompt });
    setState({ selectedId: result.id, previewSource: 'selected' });
    await refreshHistory();
    setStatus('idle');
  } catch (e) {
    console.error('[single-shot]', e);
    setStatus('error');
  } finally {
    singleEl.disabled = false;
  }
}

function setStatus(s) {
  setState({ status: s });
  statusEl.dataset.state = s;
  statusEl.textContent = s;
}
function flash(el) {
  el.style.borderBottomColor = 'rgba(255,90,120,0.7)';
  setTimeout(() => el.style.borderBottomColor = '', 600);
}
