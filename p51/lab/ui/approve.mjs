import { api } from '../api.mjs';
import { setState } from '../state.mjs';
import { refresh as refreshHistory } from './history.mjs';

let overlayEl, imgEl, scoresEl, judgeEl, fbEl, acceptBtn, improveBtn, closeBtn, traceEl;
let currentGenId = null;

export function mountApprove() {
  overlayEl  = document.querySelector('[data-role="approve-overlay"]');
  imgEl      = document.querySelector('[data-role="approve-image"]');
  scoresEl   = document.querySelector('[data-role="approve-scores"]');
  judgeEl    = document.querySelector('[data-role="approve-judge"]');
  fbEl       = document.querySelector('[data-role="approve-feedback"]');
  acceptBtn  = document.querySelector('[data-role="approve-accept"]');
  improveBtn = document.querySelector('[data-role="approve-improve"]');
  closeBtn   = document.querySelector('[data-role="approve-close"]');
  traceEl    = document.querySelector('[data-role="approve-trace"]');

  closeBtn.addEventListener('click', close);
  acceptBtn.addEventListener('click', onAccept);
  improveBtn.addEventListener('click', onImprove);
  // ESC closes
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !overlayEl.hidden) close();
  });
  // Click on the backdrop (not the card) closes
  overlayEl.addEventListener('click', e => {
    if (e.target === overlayEl) close();
  });
}

export async function open(generationId) {
  currentGenId = generationId;
  overlayEl.hidden = false;
  fbEl.value = '';
  scoresEl.innerHTML = '<span class="val">loading…</span>';
  judgeEl.textContent = 'loading…';
  traceEl.classList.remove('is-shown');
  traceEl.innerHTML = '';

  try {
    const g = await api.getGeneration(generationId);
    imgEl.src = g.imageUrl;
    renderScores(g);
    renderJudge(g);
  } catch (e) {
    console.error('[approve]', e);
  }
}

function close() {
  overlayEl.hidden = true;
  currentGenId = null;
}

function renderScores(g) {
  let critic = null;
  for (const j of (g.judgments || [])) {
    if (j.source === 'critic') { critic = j; break; }
  }
  let axes = {};
  if (critic?.context_json) try { axes = JSON.parse(critic.context_json).axes || {}; } catch {}
  const overall = g.score != null ? g.score.toFixed(1) : '—';
  scoresEl.innerHTML = `
    <span>overall</span><span class="val">${overall}</span>
    ${Object.entries(axes).map(([k, v]) =>
      `<span>${k.replace(/_/g, ' ')}</span><span class="val">${(+v).toFixed(1)}</span>`
    ).join('')}`;
}

function renderJudge(g) {
  const judge = (g.judgments || []).find(j => j.source === 'judge');
  if (!judge) {
    judgeEl.textContent = '— no judge prediction yet';
    return;
  }
  const tag = judge.rating ? `[${judge.rating.toUpperCase()}]` : '';
  judgeEl.innerHTML = `<strong>${tag}</strong> · ${judge.reasoning || '(no reasoning)'}`;
}

async function onAccept() {
  if (!currentGenId) return;
  setState({ selectedId: currentGenId, previewSource: 'selected' });
  // promote to choreograph mode
  if (window.labSetMode) window.labSetMode('choreograph');
  document.dispatchEvent(new CustomEvent('lab:select-generation', { detail: { id: currentGenId } }));
  close();
}

async function onImprove() {
  if (!currentGenId) return;
  const fb = fbEl.value.trim();
  if (!fb) { fbEl.style.borderBottomColor = 'rgba(255,90,120,0.7)'; setTimeout(() => fbEl.style.borderBottomColor = '', 600); return; }

  improveBtn.disabled = true;
  acceptBtn.disabled = true;
  traceEl.classList.add('is-shown');
  traceEl.innerHTML = `<div>refining with feedback…</div>`;

  try {
    const r = await fetch('/api/chain/refine-once', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generationId: currentGenId, feedback: fb }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'refine failed');
    traceEl.innerHTML = `<div>new generation: ${j.generation.id.slice(-8)}</div>` +
                       (j.refinerNotes ? `<div>${j.refinerNotes}</div>` : '');
    await refreshHistory();
    // open the overlay on the new generation so user can iterate again
    setTimeout(() => open(j.generation.id), 400);
  } catch (e) {
    traceEl.innerHTML = `<div style="color: rgba(255,90,120,0.9)">error: ${e.message}</div>`;
  } finally {
    improveBtn.disabled = false;
    acceptBtn.disabled = false;
  }
}

export const approve = { open, close };
