/* Multi-group point cloud renderer.

   Takes a source image + scene graph and renders the cloud with:
     · per-point group membership (aGroupId attribute)
     · per-group reactions baked into per-vertex attributes (aTintEnabled,
       aTintColor, aScatterScale, aPullScale, aPulseScale, aRevealScale,
       aParallaxWeight)
     · runtime per-group hover/active state passed via uGroupHover[16] uniform
       and uGroupColors[16] (so changing colors in the UI updates immediately)

   Reactions:
     · TINT       — recolor on hover toward group color
     · SCATTER    — push points away from cursor when group is hovered
     · PULL       — attract points toward cursor when group is hovered
     · PULSE      — slow continuous breath (always on if enabled)
     · REVEAL     — group is dim until hovered, then full opacity
     · PARALLAX   — per-group y offset proportional to scroll progress

   API:
     mountMultiGroupCloud(canvas, { imageUrl, sceneGraph, getVar }) → handle
*/

const MAX_GROUPS = 16;

const VERT = `
  uniform float uTime;
  uniform vec2  uMouse;
  uniform float uPointerActive;
  uniform float uPointSize;
  uniform float uDepth;
  uniform float uNoise;
  uniform float uPixelRatio;
  uniform float uScrollProgress;
  uniform float uGroupHover[${MAX_GROUPS}];
  uniform vec3  uGroupColors[${MAX_GROUPS}];

  attribute float aLum;
  attribute float aGroupId;          // -1 = ungrouped, 0..N-1 = group index
  attribute float aTintEnabled;
  attribute float aScatterScale;
  attribute float aPullScale;
  attribute float aPulseScale;
  attribute float aRevealScale;
  attribute float aParallaxWeight;

  varying float vLum;
  varying float vHover;
  varying float vTintEnabled;
  varying vec3  vTintColor;
  varying float vRevealAlpha;

  float groupHover() {
    float h = 0.0;
    int gid = int(aGroupId + 0.5);
    if (aGroupId < 0.0) return 0.0;
    for (int i = 0; i < ${MAX_GROUPS}; i++) {
      if (i == gid) h = uGroupHover[i];
    }
    return h;
  }
  vec3 groupColor() {
    vec3 c = vec3(0.78, 1.0, 0.0);  // default lime
    int gid = int(aGroupId + 0.5);
    if (aGroupId < 0.0) return c;
    for (int i = 0; i < ${MAX_GROUPS}; i++) {
      if (i == gid) c = uGroupColors[i];
    }
    return c;
  }

  void main() {
    vLum = aLum;
    float h = groupHover();
    vHover = h;
    vTintEnabled = aTintEnabled;
    vTintColor = groupColor();

    // Reveal — points are dim/hidden when ungrouped or when reveal is enabled and not hovered
    float revealMul = 1.0 - aRevealScale + aRevealScale * h;
    vRevealAlpha = revealMul;

    vec3 pos = position;
    pos.z += (aLum - 0.5) * uDepth;

    // Pulse — continuous breath, scaled by aPulseScale
    if (aPulseScale > 0.001) {
      float pulse = sin(uTime * 1.4 + position.x * 3.0 + position.y * 4.0) * 0.5 + 0.5;
      pos.z += pulse * aPulseScale * 0.20;
    }

    // Always-on per-point ambient breath
    float n = sin(uTime * 0.6 + position.x * 4.0 + position.y * 5.0);
    pos.z += n * uNoise;
    pos.x += cos(uTime * 0.5 + position.y * 3.0) * uNoise * 0.4;

    // Cursor-driven scatter (per-group, requires both group hover AND scatter enabled)
    vec2 toMouse = pos.xy - uMouse;
    float d = length(toMouse);
    float fall = smoothstep(0.55, 0.0, d) * uPointerActive * h;

    if (aScatterScale > 0.001) {
      float seed  = fract(sin(dot(position.xy, vec2(127.1, 311.7))) * 43758.5453);
      float seed2 = fract(sin(dot(position.xy, vec2(269.5, 183.3))) * 43758.5453);
      float angle = seed * 6.2831853 + uTime * (0.35 + seed2 * 0.25);
      vec2 dir = vec2(cos(angle), sin(angle));
      float envelope = 0.5 + 0.5 * sin(uTime * 0.8 + seed * 6.2831853);
      pos.xy += dir * fall * aScatterScale * 0.32 * envelope;
      pos.z  += (seed - 0.5) * fall * 0.18;
    }

    if (aPullScale > 0.001) {
      vec2 toward = -toMouse;  // pull TOWARD cursor
      pos.xy += toward * fall * aPullScale * 0.18;
    }

    // Parallax — per-group y drift based on scroll
    pos.y += uScrollProgress * aParallaxWeight;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPos;
    float sizeBoost = 1.0 + aLum * 0.7 + h * 0.4;
    gl_PointSize = uPointSize * uPixelRatio * sizeBoost * (1.6 / -mvPos.z);
  }
`;

const FRAG = `
  uniform vec3  uColor;
  uniform vec3  uColorCold;
  uniform vec3  uColorDark;
  varying float vLum;
  varying float vHover;
  varying float vTintEnabled;
  varying vec3  vTintColor;
  varying float vRevealAlpha;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float alpha = (1.0 - smoothstep(0.34, 0.5, r)) * vRevealAlpha;

    // Cold (idle) ramp: dark → cool desaturated
    vec3 cold = mix(vec3(0.025), uColorCold, vLum);
    // Hot ramp blends toward group tint color when tint reaction enabled,
    // otherwise toward the global lime.
    vec3 hotTarget = mix(uColor, vTintColor, vTintEnabled);
    vec3 hot  = mix(uColorDark, hotTarget, smoothstep(0.05, 0.95, vLum));
    hot += pow(vLum, 4.0) * hotTarget * 0.4;

    vec3 col = mix(cold, hot, vHover);
    gl_FragColor = vec4(col, alpha);
  }
`;

export function mountMultiGroupCloud(canvas, { imageUrl, sceneGraph, getVar }) {
  const wrap = canvas.parentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function readNum(name, fb) { const v = parseFloat(getVar(name) ?? fb); return Number.isFinite(v) ? v : fb; }
  function readColor(name, fb) { return new THREE.Color((getVar(name) ?? fb).trim()); }

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 2.6;

  const groupColorVecs = new Array(MAX_GROUPS).fill(null).map(() => new THREE.Color('#c8ff00'));

  const uniforms = {
    uTime:           { value: 0 },
    uMouse:          { value: new THREE.Vector2(0, 0) },
    uPointerActive:  { value: 0 },
    uColor:          { value: readColor('--portrait-color',      '#c8ff00') },
    uColorCold:      { value: readColor('--portrait-color-cold', '#b8b8b8') },
    uColorDark:      { value: readColor('--portrait-color-dark', '#0a0a0a') },
    uPointSize:      { value: readNum('--portrait-point-size',   1.3) },
    uDepth:          { value: readNum('--portrait-depth',        0.45) },
    uNoise:          { value: readNum('--portrait-noise',        0.028) },
    uPixelRatio:     { value: renderer.getPixelRatio() },
    uScrollProgress: { value: 0 },
    uGroupHover:     { value: new Array(MAX_GROUPS).fill(0) },
    uGroupColors:    { value: groupColorVecs },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, vertexShader: VERT, fragmentShader: FRAG,
  });

  let points = null;
  let imgEl = null;
  let imgW = 0, imgH = 0;

  async function setImage(url) {
    if (!url) return;
    imgEl = await loadImage(url);
    imgW = imgEl.naturalWidth; imgH = imgEl.naturalHeight;
    rebuild();
  }
  function setSceneGraph(sg) {
    sceneGraph = sg || { groups: [] };
    pushGroupColors();
    rebuild();
  }

  function pushGroupColors() {
    const groups = (sceneGraph?.groups) || [];
    for (let i = 0; i < MAX_GROUPS; i++) {
      const g = groups[i];
      if (g?.color) groupColorVecs[i].set(g.color);
      else groupColorVecs[i].set('#c8ff00');
    }
  }

  function rebuild() {
    if (!imgEl) return;
    const step = Math.max(1, Math.floor(readNum('--portrait-density', 2)));
    const lumCutoff = readNum('--portrait-lum-cutoff', 0.78);
    const c = document.createElement('canvas');
    c.width = imgW; c.height = imgH;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imgEl, 0, 0);
    const data = ctx.getImageData(0, 0, imgW, imgH).data;

    const aspect = imgW / imgH;
    const groups = (sceneGraph?.groups) || [];

    // Pre-resolve which group an element belongs to
    const elemToGroup = new Map();
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      for (const eid of (g.elementIds || [])) elemToGroup.set(eid, gi);
    }

    const elements = sceneGraph?._elements || [];

    const positions = [];
    const lums = [];
    const groupIds = [];
    const tintEnabled = [];
    const scatterScale = [];
    const pullScale = [];
    const pulseScale = [];
    const revealScale = [];
    const parallaxW = [];

    for (let y = 0; y < imgH; y += step) {
      for (let x = 0; x < imgW; x += step) {
        const i = (y * imgW + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const lum = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
        if (lum > lumCutoff) continue;

        // Find which element bbox contains this pixel
        const u = x / imgW, v = y / imgH;
        let elemId = null;
        for (const e of elements) {
          if (u >= e.bbox_x && u < e.bbox_x + e.bbox_w &&
              v >= e.bbox_y && v < e.bbox_y + e.bbox_h) {
            elemId = e.id;
            // first match wins (elements are ordered by detection)
            break;
          }
        }
        const gIdx = elemId ? (elemToGroup.has(elemId) ? elemToGroup.get(elemId) : -1) : -1;

        // Compute per-vertex reaction scales by reading the group's reactions
        let tEn = 0, scS = 0, plS = 0, puS = 0, rvS = 0, paW = 0;
        if (gIdx >= 0) {
          const grp = groups[gIdx];
          const rx = grp.reactions || {};
          tEn = rx.tint?.enabled ? 1 : 0;
          scS = rx.scatter?.enabled ? (rx.scatter.intensity ?? 0.5) : 0;
          plS = rx.pull?.enabled ? (rx.pull.intensity ?? 0.5) : 0;
          puS = rx.pulse?.enabled ? (rx.pulse.intensity ?? 0.5) : 0;
          rvS = rx.reveal?.enabled ? (rx.reveal.intensity ?? 0.7) : 0;
          paW = rx.parallax?.enabled ? (rx.parallax.intensity ?? 0.3) * 0.5 : 0;  // 0..0.5 world units
        }

        const px = (u - 0.5) *  2.0 * aspect;
        const py = (0.5 - v) * 2.0;
        positions.push(px, py, 0);
        lums.push(1.0 - lum);
        groupIds.push(gIdx);
        tintEnabled.push(tEn);
        scatterScale.push(scS);
        pullScale.push(plS);
        pulseScale.push(puS);
        revealScale.push(rvS);
        parallaxW.push(paW);
      }
    }
    if (!positions.length) { console.warn('[multi-cloud] empty sample'); return; }

    if (points) { scene.remove(points); points.geometry.dispose(); }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position',         new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('aLum',             new THREE.Float32BufferAttribute(lums, 1));
    geom.setAttribute('aGroupId',         new THREE.Float32BufferAttribute(groupIds, 1));
    geom.setAttribute('aTintEnabled',     new THREE.Float32BufferAttribute(tintEnabled, 1));
    geom.setAttribute('aScatterScale',    new THREE.Float32BufferAttribute(scatterScale, 1));
    geom.setAttribute('aPullScale',       new THREE.Float32BufferAttribute(pullScale, 1));
    geom.setAttribute('aPulseScale',      new THREE.Float32BufferAttribute(pulseScale, 1));
    geom.setAttribute('aRevealScale',     new THREE.Float32BufferAttribute(revealScale, 1));
    geom.setAttribute('aParallaxWeight',  new THREE.Float32BufferAttribute(parallaxW, 1));
    points = new THREE.Points(geom, mat);
    scene.add(points);
  }

  function loadImage(url) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload  = () => res(i);
      i.onerror = () => rej(new Error('image load failed: ' + url));
      i.src = url;
    });
  }

  function resize() {
    const r = wrap.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);

  // Pointer state
  const targetMouse = new THREE.Vector2(0, 0);
  let mouseInside = false, targetActive = 0;
  const targetGroupHover = new Array(MAX_GROUPS).fill(0);

  function onMove(e) {
    const r = wrap.getBoundingClientRect();
    const aspect = r.width / r.height;
    const x = ((e.clientX - r.left) / r.width  - 0.5) *  2.0 * aspect;
    const y = ((e.clientY - r.top)  / r.height - 0.5) * -2.0;
    targetMouse.set(x, y);
    // Determine which element/group the cursor is over by image-space bbox lookup
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top)  / r.height;
    const groups = (sceneGraph?.groups) || [];
    const elements = sceneGraph?._elements || [];
    targetGroupHover.fill(0);
    for (const el of elements) {
      if (u >= el.bbox_x && u < el.bbox_x + el.bbox_w &&
          v >= el.bbox_y && v < el.bbox_y + el.bbox_h) {
        for (let gi = 0; gi < groups.length; gi++) {
          if ((groups[gi].elementIds || []).includes(el.id)) {
            targetGroupHover[gi] = 1;
            break;
          }
        }
        break;
      }
    }
  }
  function onEnter() { mouseInside = true; targetActive = 1; }
  function onLeave() { mouseInside = false; targetActive = 0; targetGroupHover.fill(0); }
  wrap.addEventListener('pointermove', onMove);
  wrap.addEventListener('pointerenter', onEnter);
  wrap.addEventListener('pointerleave', onLeave);

  let scrollProgress = 0;
  function onScroll() {
    const r = wrap.getBoundingClientRect();
    const vh = innerHeight || 800;
    const center = r.top + r.height / 2;
    scrollProgress = Math.max(-1.5, Math.min(1.5, (vh / 2 - center) / vh));
  }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  let varTick = 0;
  function refreshVarsIfChanged() {
    if (++varTick % 30 !== 0) return;
    uniforms.uColor.value     = readColor('--portrait-color',      '#c8ff00');
    uniforms.uColorCold.value = readColor('--portrait-color-cold', '#b8b8b8');
    uniforms.uColorDark.value = readColor('--portrait-color-dark', '#0a0a0a');
    uniforms.uPointSize.value = readNum('--portrait-point-size',   1.3);
    uniforms.uDepth.value     = readNum('--portrait-depth',        0.45);
    uniforms.uNoise.value     = readNum('--portrait-noise',        0.028);
    pushGroupColors();
  }

  const clock = new THREE.Clock();
  let raf = null;
  function loop() {
    uniforms.uTime.value = clock.getElapsedTime();
    uniforms.uMouse.value.lerp(targetMouse, 0.10);
    uniforms.uPointerActive.value += (targetActive - uniforms.uPointerActive.value) * 0.08;
    uniforms.uScrollProgress.value = scrollProgress;
    for (let i = 0; i < MAX_GROUPS; i++) {
      uniforms.uGroupHover.value[i] += (targetGroupHover[i] - uniforms.uGroupHover.value[i]) * 0.08;
    }
    refreshVarsIfChanged();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }
  if (!reduced) loop();
  else renderer.render(scene, camera);

  if (imageUrl) setImage(imageUrl);
  if (sceneGraph) pushGroupColors();

  return {
    setImage,
    setSceneGraph,
    rebuild,
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      wrap.removeEventListener('pointermove', onMove);
      wrap.removeEventListener('pointerenter', onEnter);
      wrap.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('scroll', onScroll);
      if (points) points.geometry.dispose();
      mat.dispose();
      renderer.dispose();
    },
  };
}
