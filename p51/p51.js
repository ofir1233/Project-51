/* ═══════════════════════════════════════════════════════════════
   P51 — runtime primitives
   No dependencies. Vanilla. Modular.
═══════════════════════════════════════════════════════════════ */

const P51 = (() => {

  /* ── render the mark · returns the SVG element ── */
  function mark({ size = 80, color = '#f0ede8', animate = 'static', strokeWidth = 1.5 } = {}) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', '0 0 110 110');
    svg.setAttribute('class', `p51-mark ${animate === 'breathe' ? 'breathing' : ''}`);

    svg.innerHTML = `
      <rect class="sq-a" x="0" y="0" width="80" height="80"
        fill="none" stroke="${color}" stroke-width="${strokeWidth}" opacity="0.45"/>
      <rect class="sq-b" x="30" y="30" width="80" height="80"
        fill="none" stroke="${color}" stroke-width="${strokeWidth}" opacity="0.45"/>
      <rect class="core" x="30" y="30" width="50" height="50" fill="${color}"/>
    `;

    return svg;
  }

  /* ── cursor instrument ── */
  function initCursor() {
    if (window.matchMedia('(hover: none)').matches) return;

    const dot  = document.createElement('div');
    const ring = document.createElement('div');
    dot.className  = 'cursor-dot';
    ring.className = 'cursor-ring';
    document.body.appendChild(dot);
    document.body.appendChild(ring);

    let mx = window.innerWidth / 2, my = window.innerHeight / 2;
    let rx = mx, ry = my;

    document.addEventListener('mousemove', e => {
      mx = e.clientX; my = e.clientY;
      dot.style.left = mx + 'px';
      dot.style.top  = my + 'px';
    });

    function animate() {
      rx += (mx - rx) * 0.16;
      ry += (my - ry) * 0.16;
      ring.style.left = rx + 'px';
      ring.style.top  = ry + 'px';
      requestAnimationFrame(animate);
    }
    animate();
  }

  /* ── compass · constellation navigator ── */
  const NODES = [
    { id: 'threshold', label: 'threshold', tag: '01', href: 'index.html' },
    { id: 'synthesis', label: 'synthesis', tag: '02', href: 'synthesis.html' },
    { id: 'library',   label: 'library',   tag: '03', href: 'library.html' },
    { id: 'atelier',   label: 'atelier',   tag: '04', href: 'work.html' },
  ];

  function compass({ label, mountTo = document.body }) {
    const el = document.createElement('div');
    el.className = 'compass';

    /* trigger (visible) */
    const trigger = document.createElement('div');
    trigger.className = 'compass-trigger';
    trigger.innerHTML = `
      <span class="compass-dot"></span>
      <span class="compass-arrow">→</span>
      <span class="compass-label">${label}</span>
    `;
    el.appendChild(trigger);

    /* panel (opens on hover) */
    const panel = document.createElement('div');
    panel.className = 'compass-panel';
    panel.innerHTML = `<div class="compass-panel-head">— constellation</div>`;

    NODES.forEach(node => {
      const a = document.createElement('a');
      a.className = 'compass-node' + (node.id === label ? ' active' : '');
      a.href = node.href;
      a.innerHTML = `
        <span>${node.label}</span>
        <span class="compass-node-tag">${node.tag}</span>
      `;
      a.addEventListener('click', (e) => {
        if (node.id !== label) {
          e.preventDefault();
          crossTo(node.href);
        }
      });
      panel.appendChild(a);
    });

    el.appendChild(panel);
    mountTo.appendChild(el);
    return el;
  }

  /* ── version stamp ── */
  function versionStamp({ text = 'v.1 · 0' } = {}) {
    const el = document.createElement('div');
    el.className = 'version-stamp';
    el.textContent = text;
    document.body.appendChild(el);
    return el;
  }

  /* ── koan · wraps each word in a span for stagger reveal ── */
  function koan(el) {
    const text = el.textContent.trim();
    el.innerHTML = '';
    text.split(/\s+/).forEach((w, i) => {
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = w;
      span.style.transitionDelay = (i * 80) + 'ms';
      el.appendChild(span);
      if (i < text.split(/\s+/).length - 1) {
        el.appendChild(document.createTextNode(' '));
      }
    });
  }

  /* ── reveal · trigger word stagger when koan enters viewport ── */
  function revealKoanWhenVisible(el, { delay = 0, root = null } = {}) {
    koan(el);
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          setTimeout(() => el.classList.add('revealed'), delay);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5, root });
    observer.observe(el);
  }

  /* ── reveal koan immediately (for the threshold) ── */
  function revealKoanNow(el, { delay = 0 } = {}) {
    koan(el);
    setTimeout(() => el.classList.add('revealed'), delay);
  }

  /* ── cross-page threshold animation ── */
  function crossTo(url, { onMark = null } = {}) {
    if (onMark) {
      onMark.classList.add('converging');
    }

    /* fade body to black */
    document.body.style.transition = 'opacity 600ms ease 200ms';
    document.body.style.opacity = '0';

    setTimeout(() => {
      window.location.href = url;
    }, 800);
  }

  /* ── verse reveal · for synthesis panels ── */
  function initVerse(el) {
    const meta = el.querySelector('.verse-meta');
    const koanEl = el.querySelector('.koan');
    const annotation = el.querySelector('.verse-annotation');

    if (koanEl && !koanEl.dataset.split) {
      koan(koanEl);
      koanEl.dataset.split = 'true';
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
          el.classList.add('active');
          if (meta) setTimeout(() => meta.classList.add('revealed'), 0);
          if (koanEl) setTimeout(() => koanEl.classList.add('revealed'), 200);
          if (annotation) setTimeout(() => annotation.classList.add('revealed'), 400);
        } else {
          el.classList.remove('active');
        }
      });
    }, { threshold: [0, 0.5, 1] });
    observer.observe(el);
  }

  /* ── visit tracking · localStorage ── */
  function trackVisit() {
    const count = parseInt(localStorage.getItem('p51.visit_count') || '0', 10) + 1;
    localStorage.setItem('p51.visit_count', String(count));
    localStorage.setItem('p51.last_seen', new Date().toISOString());
    return count;
  }

  function getVisitCount() {
    return parseInt(localStorage.getItem('p51.visit_count') || '0', 10);
  }

  /* ── public api ── */
  return {
    mark,
    initCursor,
    compass,
    versionStamp,
    koan,
    revealKoanWhenVisible,
    revealKoanNow,
    crossTo,
    initVerse,
    trackVisit,
    getVisitCount,
  };
})();
