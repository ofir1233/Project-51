/* Forked + parameterized version of `disciplineStage` from p51/synthesis.html.
   Same shader, single cloud (whatever image you point it at), exposes:
     mountPointCloud(canvas, { imageUrl, getVar }) -> { setImage, setVar, destroy }
   All mouse interaction works, no dependence on .discipline-pane elements. */

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
  attribute float aLum;
  varying float vLum;

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
  }
`;
const FRAG = `
  uniform vec3  uColor;
  uniform vec3  uColorCold;
  uniform vec3  uColorDark;
  uniform float uHover;
  varying float vLum;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float alpha = 1.0 - smoothstep(0.34, 0.5, r);
    vec3 cold = mix(vec3(0.025), uColorCold, vLum);
    vec3 hot  = mix(uColorDark, uColor, smoothstep(0.05, 0.95, vLum));
    hot += pow(vLum, 4.0) * uColor * 0.4;
    vec3 col = mix(cold, hot, uHover);
    gl_FragColor = vec4(col, alpha);
  }
`;

export function mountPointCloud(canvas, { imageUrl, getVar }) {
  const wrap = canvas.parentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function readNum(name, fb) {
    const v = parseFloat(getVar(name) ?? fb);
    return Number.isFinite(v) ? v : fb;
  }
  function readColor(name, fb) {
    const v = (getVar(name) ?? fb).trim();
    return new THREE.Color(v);
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
  };

  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    vertexShader: VERT, fragmentShader: FRAG,
  });

  let points = null;
  let currentUrl = null;

  async function loadAndSample(url) {
    if (!url) return;
    currentUrl = url;
    const img = await loadImage(url);
    if (currentUrl !== url) return; // race
    sampleAndUpload(img);
  }

  function sampleAndUpload(img) {
    const step = Math.max(1, Math.floor(readNum('--portrait-density', 2)));
    const lumCutoff = readNum('--portrait-lum-cutoff', 0.78);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;

    const aspect = c.width / c.height;
    const positions = [];
    const lums = [];
    for (let y = 0; y < c.height; y += step) {
      for (let x = 0; x < c.width; x += step) {
        const i = (y * c.width + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const lum = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
        if (lum > lumCutoff) continue;
        const px = (x / c.width  - 0.5) *  2.0 * aspect;
        const py = (0.5 - y / c.height) * 2.0;
        positions.push(px, py, 0);
        lums.push(1.0 - lum);
      }
    }
    if (!positions.length) { console.warn('[cloud] empty sample'); return; }

    if (points) { scene.remove(points); points.geometry.dispose(); }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('aLum',     new THREE.Float32BufferAttribute(lums, 1));
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

  const targetMouse = new THREE.Vector2(0, 0);
  let mouseInside = false, targetActive = 0, targetHover = 0;

  function onMove(e) {
    const r = wrap.getBoundingClientRect();
    const aspect = r.width / r.height;
    const x = ((e.clientX - r.left) / r.width  - 0.5) *  2.0 * aspect;
    const y = ((e.clientY - r.top)  / r.height - 0.5) * -2.0;
    targetMouse.set(x, y);
  }
  function onEnter() { mouseInside = true; targetActive = 1; targetHover = 1; }
  function onLeave() { mouseInside = false; targetActive = 0; targetHover = 0; }
  wrap.addEventListener('pointermove', onMove);
  wrap.addEventListener('pointerenter', onEnter);
  wrap.addEventListener('pointerleave', onLeave);

  // CSS-var refresh ~2× per second (so DevTools tweaks apply)
  let varTick = 0;
  function refreshVarsIfChanged() {
    if (++varTick % 30 !== 0) return;
    uniforms.uColor.value     = readColor('--portrait-color',      '#c8ff00');
    uniforms.uColorCold.value = readColor('--portrait-color-cold', '#b8b8b8');
    uniforms.uColorDark.value = readColor('--portrait-color-dark', '#0a0a0a');
    uniforms.uPointSize.value = readNum('--portrait-point-size',   1.3);
    uniforms.uDepth.value     = readNum('--portrait-depth',        0.45);
    uniforms.uNoise.value     = readNum('--portrait-noise',        0.028);
    uniforms.uMouseForce.value= readNum('--portrait-mouse-force',  0.22);
  }

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
    refreshVarsIfChanged();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }
  if (!reduced) loop();
  else renderer.render(scene, camera);

  // Initial load
  if (imageUrl) loadAndSample(imageUrl);

  return {
    setImage(url) { return loadAndSample(url); },
    resample() { if (currentUrl) loadAndSample(currentUrl); },
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
