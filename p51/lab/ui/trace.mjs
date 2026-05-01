// SSE chain run renderer.
import { setState } from '../state.mjs';
import { refresh as refreshHistory } from './history.mjs';

let traceEl, runIdEl, statusEl, currentRunId = null, currentReader = null;
let runStartTs = 0, currentIter = 0, totalIters = 0, statusTicker = null, currentStep = '';

export function mountTrace() {
  traceEl  = document.querySelector('[data-role="trace"]');
  runIdEl  = document.querySelector('[data-role="run-id"]');
  statusEl = document.querySelector('[data-role="status"]');
}

export function writeLine({ step = '', text = '', level = 'info' }) {
  const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const cls = step ? ` step-${step}` : '';
  const stepText = step ? step.replace('_', ' ') : '';
  const escText = String(text).replace(/[&<>]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));
  const html = `<div class="row"><span class="ts">${ts}</span><span class="step${cls}">${stepText}</span><span>${escText}</span></div>`;
  traceEl.insertAdjacentHTML('beforeend', html);
  traceEl.scrollTop = traceEl.scrollHeight;
}
export function clearTrace() { if (traceEl) traceEl.innerHTML = ''; }

export async function startChainStream(body, abortBtn) {
  clearTrace();
  setState({ status: 'running' });
  runStartTs = Date.now();
  currentIter = 0;
  totalIters = body.maxIters || 3;
  currentStep = 'starting';
  startStatusTicker();
  if (abortBtn) abortBtn.hidden = false;

  const ctrl = new AbortController();
  abortBtn?.addEventListener('click', () => ctrl.abort(), { once: true });

  let res;
  try {
    res = await fetch('/api/chain/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    writeLine({ text: 'connect error: ' + e.message });
    setState({ status: 'error' });
    if (statusEl) { statusEl.dataset.state = 'error'; statusEl.textContent = 'error'; }
    if (abortBtn) abortBtn.hidden = true;
    return;
  }
  if (!res.ok) {
    writeLine({ text: 'http ' + res.status });
    setState({ status: 'error' });
    if (abortBtn) abortBtn.hidden = true;
    return;
  }

  const reader = res.body.getReader();
  currentReader = reader;
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        handleSSEChunk(chunk);
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') writeLine({ text: 'stream error: ' + e.message });
  } finally {
    setState({ status: 'idle' });
    stopStatusTicker();
    if (statusEl) { statusEl.dataset.state = 'idle'; statusEl.textContent = 'idle'; }
    if (abortBtn) abortBtn.hidden = true;
    currentReader = null;
    refreshHistory();
  }
}

function startStatusTicker() {
  stopStatusTicker();
  paintStatus();
  statusTicker = setInterval(paintStatus, 500);
}
function stopStatusTicker() {
  if (statusTicker) { clearInterval(statusTicker); statusTicker = null; }
}
function paintStatus() {
  if (!statusEl) return;
  statusEl.dataset.state = 'running';
  const sec = Math.floor((Date.now() - runStartTs) / 1000);
  const iterPart = currentIter ? `iter ${currentIter}/${totalIters} · ` : '';
  const stepPart = currentStep ? `${currentStep.replace('_', ' ')} · ` : '';
  statusEl.textContent = `running · ${iterPart}${stepPart}${sec}s`;
}

function handleSSEChunk(chunk) {
  let event = 'message';
  let dataStr = '';
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
  }
  let d = null;
  try { d = JSON.parse(dataStr); } catch {}
  if (!d) return;

  switch (event) {
    case 'run.started':
      currentRunId = d.runId;
      if (runIdEl) runIdEl.textContent = `run · ${d.runId.slice(-8)}`;
      writeLine({ text: `goal: ${d.goal}` });
      break;
    case 'iter.started':
      currentIter = d.iteration || 0;
      writeLine({ text: `── iter ${d.iteration} ──` });
      break;
    case 'agent.started':
      currentStep = d.stepName || '';
      writeLine({ step: d.stepName, text: `start · ${d.provider}` });
      break;
    case 'agent.finished':
      if (d.status === 'error') {
        writeLine({ step: d.stepName, text: `× ${d.error || 'error'}` });
      } else {
        const tok = d.tokens?.total ? ` · ${d.tokens.total}tok` : '';
        let extra = '';
        if (d.output?.score != null) extra = ` · score=${(+d.output.score).toFixed(1)}`;
        if (d.output?.rating) extra = ` · ${d.output.rating}`;
        if (d.output?.changeSummary) extra = ` · ${d.output.changeSummary}`;
        if (d.generationId) extra += ` · gen=${d.generationId.slice(-8)}`;
        writeLine({ step: d.stepName, text: `done${tok}${extra}` });
      }
      break;
    case 'iter.scored':
      writeLine({ text: `→ score ${(+d.score).toFixed(1)} · gaps: ${(d.gaps || []).slice(0,3).join(' · ')}` });
      break;
    case 'iter.finished':
      writeLine({ text: `iter ${d.iteration} done · best=${(+d.bestSoFar.score).toFixed(1)}` });
      break;
    case 'run.finished':
      writeLine({ text: `── ${d.status} · best=${d.bestGenId?.slice(-8) || '—'} score=${d.finalScore?.toFixed?.(1) ?? '—'} ──` });
      refreshHistory();
      // Auto-open the Approve overlay on the finalist (escape paths: ESC key,
      // CLOSE button, click on backdrop outside the card).
      if (d.status === 'done' && d.bestGenId && window.labApprove?.open) {
        setTimeout(() => window.labApprove.open(d.bestGenId), 600);
      }
      break;
    case 'run.error':
      writeLine({ text: 'ERROR · ' + d.message });
      break;
    case 'heartbeat':
      // silent
      break;
  }
}
