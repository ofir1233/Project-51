import { api } from '../api.mjs';
import { getState, setState, subscribe } from '../state.mjs';

let listEl, emptyEl, searchEl, filtersEl;

export function mountHistory() {
  listEl    = document.querySelector('[data-role="history-list"]');
  emptyEl   = document.querySelector('[data-role="history-empty"]');
  searchEl  = document.querySelector('[data-role="search"]');
  filtersEl = document.querySelector('[data-role="filters"]');

  searchEl.addEventListener('input', debounce(() => {
    setState({ searchQuery: searchEl.value.trim() });
    refresh();
  }, 220));

  filtersEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    filtersEl.querySelectorAll('.lab-chip').forEach(b => b.classList.remove('is-on'));
    btn.classList.add('is-on');
    setState({ filter: btn.dataset.filter });
    refresh();
  });

  listEl.addEventListener('click', onCardClick);

  // RUN EXAMPLE in the empty state — seed the goal and click RUN CHAIN
  const exampleBtn = document.querySelector('[data-role="run-example"]');
  if (exampleBtn) {
    exampleBtn.addEventListener('click', () => {
      const goal = document.querySelector('[data-role="goal"]');
      const runBtn = document.querySelector('[data-role="run-chain"]');
      if (!goal || !runBtn) return;
      goal.value = `A high-density Op-Art continuous-line halftone illustration in the New Yorker editorial style. Two figures composed of intricate serpentine line patterns warping and flowing around facial features, every beard hair a winding line, eyes drawn with concentric dense lines. Pure black ink on pure white #FFFFFF paper, no color. Behind them: a classical Beaux-Arts corner building rendered in the same dense line work. Wide 3:2 landscape composition, identity preserved.`;
      // dispatch input so the run-hint updates and the button enables
      goal.dispatchEvent(new Event('input', { bubbles: true }));
      // tiny delay so the button enables before we click
      setTimeout(() => { if (!runBtn.disabled) runBtn.click(); }, 80);
    });
  }

  subscribe(state => render(state));
  refresh();
}

export async function refresh() {
  const { filter, searchQuery } = getState();
  const filters = {};
  if (filter === 'visible')      filters.visibility = 'visible';
  else if (filter === 'hidden')  filters.visibility = 'hidden';
  else if (filter === 'starred') { filters.visibility = 'all'; filters.starred = '1'; }
  else                           filters.visibility = 'all';
  if (searchQuery) filters.q = searchQuery;
  filters.limit = 200;

  try {
    const { items } = await api.generations(filters);
    setState({ generations: items });
  } catch (e) {
    console.error('[history] fetch failed', e);
  }
}

async function onCardClick(e) {
  const judgeBtn = e.target.closest('[data-judge-rating]');
  const starBtn  = e.target.closest('[data-act="star"]');
  const hideBtn  = e.target.closest('[data-act="hide"]');
  const card     = e.target.closest('[data-gen-id]');
  if (!card) return;
  const id = card.dataset.genId;

  if (judgeBtn) {
    e.stopPropagation();
    const rating = judgeBtn.dataset.judgeRating;
    try {
      await api.addJudgment({ generationId: id, source: 'user', rating });
      await refresh();
    } catch (err) { console.error('[judgment]', err); }
    return;
  }
  if (starBtn) {
    e.stopPropagation();
    const g = getState().generations.find(x => x.id === id);
    await api.patchGeneration(id, { starred: !g.starred });
    await refresh();
    return;
  }
  if (hideBtn) {
    e.stopPropagation();
    const g = getState().generations.find(x => x.id === id);
    const newVis = g.visibility === 'hidden' ? 'visible' : 'hidden';
    await api.patchGeneration(id, { visibility: newVis });
    await refresh();
    return;
  }
  // plain card click → select for preview
  setState({ selectedId: id, previewSource: 'selected' });
}

function render(state) {
  const items = state.generations;
  if (!items || items.length === 0) {
    listEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  listEl.innerHTML = items.map(g => cardHTML(g, state.selectedId === g.id)).join('');
  // Reveal-on-mount: each card fades in with a tiny stagger
  requestAnimationFrame(() => {
    listEl.querySelectorAll('.lab-history-card').forEach((el, i) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      el.style.transition = `opacity 480ms var(--ease-expo) ${Math.min(i, 12) * 22}ms, transform 480ms var(--ease-expo) ${Math.min(i, 12) * 22}ms`;
      requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
    });
  });
}

function cardHTML(g, isSelected) {
  const score = g.score != null ? g.score.toFixed(1) : '—';
  const thumb = g.thumbUrl || g.imageUrl;
  const time = formatRelTime(g.createdAt);
  const promptSnippet = (g.prompt || '').slice(0, 240);
  const cls = ['card', 'lab-history-card'];
  if (isSelected)             cls.push('is-selected');
  if (g.visibility === 'hidden') cls.push('is-hidden');
  const userRating = g.userJudgment?.rating;

  return `
    <li class="${cls.join(' ')}" data-gen-id="${g.id}">
      <div class="thumb" style="background-image: url('${thumb}')"></div>
      <div class="meta">
        <div class="prompt">${escapeHTML(promptSnippet)}</div>
        <div class="row">
          <span>${time}</span>
          <span>·</span>
          <span class="score">★ ${score}</span>
          <span>·</span>
          <span>${g.provider}</span>
          <button class="lab-judge-btn ${g.starred ? 'is-good' : ''}" data-act="star" title="star">★</button>
          <button class="lab-judge-btn" data-act="hide" title="${g.visibility === 'hidden' ? 'unhide' : 'hide'}">${g.visibility === 'hidden' ? '↺' : '×'}</button>
        </div>
        <div class="lab-judge-row">
          <button class="lab-judge-btn ${userRating === 'good' ? 'is-good' : ''}" data-judge-rating="good"  title="good">👍</button>
          <button class="lab-judge-btn ${userRating === 'meh'  ? 'is-meh'  : ''}" data-judge-rating="meh"   title="meh">🤷</button>
          <button class="lab-judge-btn ${userRating === 'bad'  ? 'is-bad'  : ''}" data-judge-rating="bad"   title="bad">👎</button>
        </div>
      </div>
    </li>`;
}

function formatRelTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
