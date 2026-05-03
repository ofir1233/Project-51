/* Three.js point-cloud renderer that takes a pre-sampled luminance grid
   instead of an image URL. Used by the online Lab where the source image
   is sampled server-side and never sent to the browser.

   API:
     mountPointCloudFromGrid(canvas, { grid, getVar }) → { setGrid, destroy }
       grid: { lum: number[], w: number, h: number }
         lum is row-major, each entry 0..255 (greyscale).

   Mirrors the look of pointcloud-embed.mjs (same shaders, same uniforms),
   but skips the image-load and canvas-sample steps. */

const VERT = `
  uniform float uTime;
  uniform vec2  uMouse;
  uniform float uHover;
  uniform float uPointerActive;
  uniform float uPointSize;
  uniform float uDepth;
  uniform float uNoise;
  uniform float uMouseForce;
  uniform float uPixelRatio;
  uniform float uEdgeFade;        // 0 = no fade, up to ~0.5 = fade over outer 50% of canvas
  attribute float aLum;
  varying float vLum;
  varying float vEdgeAlpha;

  void main() {
    vLum = aLum;
    vec3 pos = position;
    pos.z += (aLum - 0.5) * uDepth;

    float n = sin(uTime * 0.6 + position.x * 4.0 + position.y * 5.0);
    pos.z += n * uNoise;
    pos.x += cos(uTime * 0.5 + position.y * 3.0) * uNoise * 0.4;

    vec2 toMouse = pos.xy - uMouse;
    float d = length(toMouse);
    float fall = smoothstep(0.6, 0.0, d) * uPointerActive;
    float seed  = fract(sin(dot(position.xy, vec2(127.1, 311.7))) * 43758.5453);
    float seed2 = fract(sin(dot(position.xy, vec2(269.5, 183.3))) * 43758.5453);
    float angle = seed * 6.2831853 + uTime * (0.35 + seed2 * 0.25);
    vec2 dir = vec2(cos(angle), sin(angle));
    float envelope = 0.5 + 0.5 * sin(uTime * 0.8 + seed * 6.2831853);
    pos.xy += dir * fall * uMouseForce * envelope;
    pos.z  += (seed - 0.5) * fall * 0.18;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPos;
    float sizeBoost = 1.0 + aLum * 0.7 + uHover * 0.4;
    gl_PointSize = uPointSize * uPixelRatio * sizeBoost * (1.6 / -mvPos.z);

    // Edge fade — STOCHASTIC dropout, not a uniform alpha gradient.
    // Each particle gets a stable seed in [0,1) from its world position. The
    // closer a particle is to a viewport edge, the lower its "visibility
    // probability" gets. We then test seed < probability — pass = full alpha,
    // fail = invisible. As you approach the edge, more particles fail the
    // test individually, producing a dissolve / scatter look that can't be
    // confused with a CSS overlay. The kept particles stay full opacity.
    vec2 ndc = gl_Position.xy / max(gl_Position.w, 0.0001);
    float edgeDist = min(1.0 - abs(ndc.x), 1.0 - abs(ndc.y));
    float pSeed = fract(sin(dot(position.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float vis   = smoothstep(0.0, uEdgeFade, edgeDist);
    vEdgeAlpha  = uEdgeFade > 0.0 ? step(pSeed, vis) : 1.0;
  }
`;
const FRAG = `
  uniform vec3  uColor;
  uniform vec3  uColorCold;
  uniform vec3  uColorDark;
  uniform float uHover;
  varying float vLum;
  varying float vEdgeAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float alpha = 1.0 - smoothstep(0.34, 0.5, r);
    vec3 cold = mix(vec3(0.025), uColorCold, vLum);
    vec3 hot  = mix(uColorDark, uColor, smoothstep(0.05, 0.95, vLum));
    hot += pow(vLum, 4.0) * uColor * 0.4;
    vec3 col = mix(cold, hot, uHover);
    gl_FragColor = vec4(col, alpha * vEdgeAlpha);
  }
`;

export function mountPointCloudFromGrid(canvas, { grid, getVar }) {
  const wrap = canvas.parentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const _getVar = getVar || ((name) => getComputedStyle(document.documentElement).getPropertyValue(name));

  function readNum(name, fb) {
    const v = parseFloat(_getVar(name) ?? fb);
    return Number.isFinite(v) ? v : fb;
  }
  function readColor(name, fb) {
    const v = (_getVar(name) ?? fb).trim();
    return new THREE.Color(v || fb);
  }

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 2.6;

  const uniforms = {
    uTime:          { value: 0 },
    uMouse:         { value: new THREE.Vector2(0, 0) },
    uHover:         { value: 0 },
    uPointerActive: { value: 0 },
    uColor:         { value: readColor('--portrait-color',      '#c8ff00') },
    uColorCold:     { value: readColor('--portrait-color-cold', '#b8b8b8') },
    uColorDark:     { value: readColor('--portrait-color-dark', '#0a0a0a') },
    uPointSize:     { value: readNum('--portrait-point-size',   1.3) },
    uDepth:         { value: readNum('--portrait-depth',        0.45) },
    uNoise:         { value: readNum('--portrait-noise',        0.028) },
    uMouseForce:    { value: readNum('--portrait-mouse-force',  0.22) },
    uPixelRatio:    { value: renderer.getPixelRatio() },
    uEdgeFade:      { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    vertexShader: VERT, fragmentShader: FRAG,
  });

  let points = null;
  let lastGrid = null; // remembered so density/cutoff can re-sample without a full reload

  function uploadFromGrid(grid, opts = {}) {
    if (!grid || !grid.lum || !grid.w || !grid.h) return;
    lastGrid = grid;
    const { lum, w, h } = grid;
    const lumCutoff = opts.cutoff ?? readNum('--portrait-lum-cutoff', 0.85);
    const aspect = w / h;
    const positions = [];
    const lums = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = lum[y * w + x] / 255;
        if (v > lumCutoff) continue;
        const px = (x / w - 0.5) *  2.0 * aspect;
        const py = (0.5 - y / h) *  2.0;
        positions.push(px, py, 0);
        lums.push(1.0 - v);
      }
    }
    if (!positions.length) { console.warn('[grid-cloud] empty sample'); return; }

    if (points) { scene.remove(points); points.geometry.dispose(); }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('aLum',     new THREE.Float32BufferAttribute(lums, 1));
    points = new THREE.Points(geom, mat);
    scene.add(points);
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

  const targetMouse = new THREE.Vector2(0, 0);
  let mouseInside = false, targetActive = 0, targetHover = 0;

  function onMove(e) {
    const r = wrap.getBoundingClientRect();
    const aspect = r.width / r.height;
    const x = ((e.clientX - r.left) / r.width  - 0.5) *  2.0 * aspect;
    const y = ((e.clientY - r.top)  / r.height - 0.5) * -2.0;
    targetMouse.set(x, y);
  }
  // Resting hover level — the shader's cold colour is dim at low vLum, so we
  // hold a partial "hot" mix even when the cursor is away. Hovering boosts it
  // to full intensity. Trade-off: less dramatic hover reveal, but points are
  // visible without requiring the cursor to be over them.
  const REST_HOVER = 0.6;
  function onEnter() { mouseInside = true; targetActive = 1; targetHover = 1; }
  function onLeave() { mouseInside = false; targetActive = 0; targetHover = REST_HOVER; }
  // Initialise resting state so the cloud is visible immediately on load.
  targetHover = REST_HOVER;
  wrap.addEventListener('pointermove', onMove);
  wrap.addEventListener('pointerenter', onEnter);
  wrap.addEventListener('pointerleave', onLeave);

  const clock = new THREE.Clock();
  let raf = null;
  function loop() {
    if (!points) {
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
      return;
    }
    uniforms.uTime.value = clock.getElapsedTime();
    uniforms.uMouse.value.lerp(targetMouse, 0.10);
    uniforms.uPointerActive.value += (targetActive - uniforms.uPointerActive.value) * 0.08;
    uniforms.uHover.value         += (targetHover  - uniforms.uHover.value)         * 0.06;
    const par = readNum('--portrait-parallax', 0.18) * uniforms.uPointerActive.value;
    const px = mouseInside ? targetMouse.x : 0;
    const py = mouseInside ? targetMouse.y : 0;
    points.rotation.y += (px * par - points.rotation.y) * 0.05;
    points.rotation.x += (-py * par * 0.6 - points.rotation.x) * 0.05;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }
  if (!reduced) loop();
  else renderer.render(scene, camera);

  if (grid) uploadFromGrid(grid);

  return {
    setGrid(g) { uploadFromGrid(g); },
    setColor(hex) {
      const c = new THREE.Color(hex);
      uniforms.uColor.value     = c;
      uniforms.uColorCold.value = c;
    },
    setSize(n) {
      uniforms.uPointSize.value = Math.max(0.1, Number(n) || 1.4);
    },
    setDensity(cutoff) {
      // cutoff in [0,1] — higher keeps brighter pixels too (denser cloud).
      if (lastGrid) uploadFromGrid(lastGrid, { cutoff: Math.max(0.05, Math.min(1.0, Number(cutoff) || 0.98)) });
    },
    setDepth(n) {
      uniforms.uDepth.value = Math.max(0, Number(n) || 0);
    },
    setNoise(n) {
      uniforms.uNoise.value = Math.max(0, Number(n) || 0);
    },
    setMouseForce(n) {
      uniforms.uMouseForce.value = Math.max(0, Number(n) || 0);
    },
    setEdgeFade(n) {
      // n in [0, ~0.5] — 0 disables fade, 0.5 fades the outer half of the canvas.
      uniforms.uEdgeFade.value = Math.max(0, Math.min(0.99, Number(n) || 0));
    },
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      wrap.removeEventListener('pointermove', onMove);
      wrap.removeEventListener('pointerenter', onEnter);
      wrap.removeEventListener('pointerleave', onLeave);
      if (points) points.geometry.dispose();
      mat.dispose();
      renderer.dispose();
    },
  };
}
