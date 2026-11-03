// Shows the scanner's identified chocolate in 3D: the real mesh, its shell colour, the embossed number as a
// bump map, and "cut it open" to reveal the filling and recipe. Adapted from the zChocolat 3D Tasting Guide
// (built with Julien, 3 Nov 2026) for showing ONE already-identified chocolate rather than a full picker.
// Three.js loads lazily on first use (never during scanning itself) and the WebGL context is created once and
// reused for the rest of the visit - the canvas moves between result cards rather than being destroyed and
// recreated, specifically so this never competes with TensorFlow.js's own WebGL context for the phone's limited
// GPU memory (the same class of problem behind tonight's memory-leak crash fix, handled deliberately this time).
// Falls back to silently doing nothing (the static photo stays visible) if Three.js can't load or WebGL isn't
// available - this is a display enhancement, never something a scan result depends on.
(() => {
  const BASE = "choc3d/";
  const THREE_VER = "0.170.0";
  const CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VER}`;

  // ---- data, copied from the 3D Tasting Guide (do not hand-edit; regenerate from zchocolat.com if it changes) ----
  const SHELLS = {
    dark:  { color: 0x2c1811, cap: 0x2a1912, pbr: "dark",  label: "70% dark couverture (Venezuela & Madagascar blend)" },
    milk:  { color: 0x8a5531, cap: 0x7e4d2c, pbr: "milk",  label: "40% milk couverture (West Africa)" },
    white: { color: 0xeadcbb, cap: 0xe5d5b2, pbr: "white", label: "White chocolate couverture" },
  };
  const C = (color, n, min, max, kind = "chunk") => ({ color, n, min, max, kind });
  const CHUNK_SCALE = { chunk: 1.9, flake: 1.5, shard: 1.4, seed: 1 };
  const FILLS = {
    praline:         { label: "Hazelnut praliné",               base: "#b8783a", shade: "#95582a", rough: .3,  mottle: .7, grain: 0,   chunks: [C("#e9cf9f", 14, 10, 22), C("#d9b57d", 10, 6, 12)] },
    pralineAlmond:   { label: "Almond praliné",                 base: "#c48a4c", shade: "#a36c36", rough: .3,  mottle: .6, grain: 0,   chunks: [C("#f2e3c4", 14, 10, 22), C("#e2c796", 10, 6, 12)] },
    pralinePeanut:   { label: "Almond & peanut praliné",        base: "#bd7f40", shade: "#9a612c", rough: .3,  mottle: .6, grain: 0,   chunks: [C("#edd6a8", 12, 12, 24), C("#dcbb84", 10, 6, 12)] },
    gianduja:        { label: "Gianduja",                       base: "#7a4826", shade: "#5d351b", rough: .3,  mottle: .5, grain: 0,   chunks: [] },
    lemonGianduja:   { label: "Lemon gianduja",                 base: "#dcc77e", shade: "#c7af62", rough: .32, mottle: .5, grain: 0,   chunks: [] },
    pistachio:       { label: "Pistachio praliné",              base: "#9c8f5c", shade: "#7e7146", rough: .32, mottle: .6, grain: 0,   chunks: [C("#aab873", 12, 9, 20), C("#e6dcb2", 8, 6, 12)] },
    pistachioHaz:    { label: "Pistachio & hazelnut praliné",   base: "#ab8f58", shade: "#8c7243", rough: .32, mottle: .6, grain: 0,   chunks: [C("#aab873", 8, 9, 18), C("#e9cf9f", 10, 9, 18)] },
    coconut:         { label: "Hazelnut & coconut praliné",     base: "#b8783a", shade: "#95582a", rough: .32, mottle: .6, grain: 0,   chunks: [C("#f8f1e4", 30, 5, 11, "shard"), C("#e9cf9f", 8, 9, 18)] },
    sesame:          { label: "Toasted sesame praliné",         base: "#c08a4e", shade: "#9f6c38", rough: .32, mottle: .5, grain: 0,   chunks: [C("#f3e7cf", 120, 2, 3, "seed"), C("#6b4a2a", 25, 1.5, 2.5, "seed")] },
    walnut:          { label: "Walnut praliné & phyllo",        base: "#ad763b", shade: "#8f5c2a", rough: .35, mottle: .6, grain: 0,   chunks: [C("#d9b98a", 12, 9, 20), C("#ead3a2", 24, 6, 16, "flake")] },
    coriander:       { label: "Coriander & citrus praliné",     base: "#c08a4e", shade: "#9f6c38", rough: .32, mottle: .6, grain: 0,   chunks: [C("#8a8a4a", 40, 2, 3, "seed"), C("#e9cf9f", 10, 8, 16)] },
    crunch:          { label: "Caramelized hazelnuts & phyllo", base: "#a86f2f", shade: "#875622", rough: .4,  mottle: .6, grain: 0,   chunks: [C("#e9cf9f", 16, 8, 18), C("#ead3a2", 30, 6, 16, "flake")] },
    ganacheDark:     { label: "Dark ganache",                   base: "#4e2c1e", shade: "#3a2015", rough: .28, mottle: .6, grain: .05, chunks: [], gloss: .55 },
    ganacheCoffee:   { label: "Coffee ganache",                 base: "#5e3d29", shade: "#472c1b", rough: .28, mottle: .6, grain: .08, chunks: [C("#2a170d", 20, 1.5, 2.5, "seed")], gloss: .55 },
    ganacheCinnamon: { label: "Cinnamon ganache",               base: "#74462a", shade: "#5c3620", rough: .3,  mottle: .6, grain: .1,  chunks: [C("#8f5a33", 25, 1.5, 2.5, "seed")], gloss: .55 },
    ganacheRasp:     { label: "Raspberry ganache",              base: "#853542", shade: "#66252f", rough: .28, mottle: .6, grain: .05, chunks: [], gloss: .55 },
    ganacheEspelette:{ label: "Espelette pepper ganache",       base: "#5e2e21", shade: "#472118", rough: .28, mottle: .6, grain: .05, chunks: [C("#c0432a", 60, 1, 2.5, "seed")], gloss: .55 },
    ganacheViolet:   { label: "Violet ganache",                 base: "#583347", shade: "#422435", rough: .28, mottle: .6, grain: .05, chunks: [], gloss: .55 },
    ganacheMilk:     { label: "Milk ganache, notes of honey",   base: "#a06c42", shade: "#865733", rough: .3,  mottle: .6, grain: .05, chunks: [], gloss: .55 },
    ganacheVanilla:  { label: "Vanilla ganache",                base: "#efe2c3", shade: "#e0cea6", rough: .33, mottle: .4, grain: .05, chunks: [C("#2a1a10", 50, 1, 1.8, "seed")], gloss: .4 },
    ganacheTonka:    { label: "Tonka bean white ganache",       base: "#eee1c2", shade: "#dfcda6", rough: .33, mottle: .4, grain: .05, chunks: [C("#5a3a22", 25, 1, 1.8, "seed")], gloss: .4 },
    caramel:         { label: "Salted Bourbon-Vanilla caramel", base: "#cf8a30", shade: "#a9651d", rough: .12, mottle: .5, grain: 0,   chunks: [], gloss: 1 },
    caramelFruit:    { label: "Caramel, passion fruit & mango", base: "#d6912c", shade: "#b4701c", rough: .14, mottle: .5, grain: 0,   chunks: [C("#e8b24e", 20, 2, 4, "seed")], gloss: 1 },
    solidDark:       { label: "Solid 70% dark & crunchy almonds", base: "#2c1811", shade: "#241310", rough: .35, mottle: .3, grain: 0, chunks: [C("#ead3a8", 16, 9, 20), C("#c9a97a", 10, 5, 10)] },
    solidMilk:       { label: "Solid 40% milk & crunchy almonds", base: "#8a5531", shade: "#744527", rough: .35, mottle: .3, grain: 0, chunks: [C("#f1dfbb", 16, 9, 20), C("#d4b58a", 10, 5, 10)] },
  };
  const SPEC = {
    0:  { shell: "milk",  layers: [["praline", 0, 1]],        studs: true },
    1:  { shell: "dark",  layers: [["ganacheDark", 0, 1]] },
    2:  { shell: "milk",  layers: [["gianduja", 0, 1]] },
    3:  { shell: "dark",  layers: [["caramelFruit", 0, 1]] },
    4:  { shell: "milk",  layers: [["pralinePeanut", 0, 1]] },
    5:  { shell: "dark",  layers: [["ganacheDark", 0, 1]] },
    6:  { shell: "dark",  layers: [["pralineAlmond", 0, 1]],  studs: true },
    7:  { shell: "milk",  layers: [["pistachio", 0, 1]] },
    8:  { shell: "dark",  layers: [["crunch", 0, 0.42], ["ganacheCoffee", 0.42, 1]] },
    9:  { shell: "milk",  layers: [["pralineAlmond", 0, 1]] },
    10: { shell: "dark",  layers: [["solidDark", 0, 1]],      solid: true, pbr: "dark10" },
    11: { shell: "milk",  layers: [["ganacheRasp", 0, 1]] },
    12: { shell: "milk",  layers: [["sesame", 0, 1]] },
    13: { shell: "dark",  layers: [["ganacheCinnamon", 0, 1]] },
    14: { shell: "milk",  layers: [["pistachioHaz", 0, 1]] },
    15: { shell: "dark",  layers: [["lemonGianduja", 0, 1]] },
    16: { shell: "milk",  layers: [["solidMilk", 0, 1]],      solid: true },
    17: { shell: "dark",  layers: [["coconut", 0, 1]] },
    18: { shell: "dark",  layers: [["ganacheEspelette", 0, 1]] },
    19: { shell: "dark",  layers: [["walnut", 0, 1]] },
    20: { shell: "milk",  layers: [["praline", 0, 0.55], ["ganacheVanilla", 0.55, 1]] },
    21: { shell: "dark",  layers: [["ganacheTonka", 0, 1]] },
    22: { shell: "milk",  layers: [["coriander", 0, 1]] },
    23: { shell: "dark",  layers: [["ganacheViolet", 0, 1]] },
    24: { shell: "milk",  layers: [["ganacheMilk", 0, 1]] },
    Z:  { shell: "dark",  layers: [["praline", 0, 0.5], ["caramel", 0.5, 1]] },
  };

  // zScanner's own key ("0".."24", "zdark"/"zmilk"/"zwhite") -> the 3D model's (id, shell)
  function mapKey(key) {
    const c = window.CHOCOLATES[key];
    if (!c || c.custom) return null;   // admin-added chocolates have no 3D model - caller falls back to the photo
    return c.z ? { id: "Z", shell: c.cv } : { id: key, shell: c.cv };
  }

  let THREE, OrbitControls, GLTFLoader, RoomEnvironment;
  let renderer, scene, camera, controls, canvas, pivot, choc;
  let readyPromise = null, failed = false;
  const state = { id: "0", shell: "dark", cut: 0, cutTarget: 0 };
  const pbrCache = new Map(), numCache = new Map(), capCache = new Map();
  const BUMP = 1.1, CAP_BUMP = 0.02;

  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hex(h) { return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); }
  function tone(h, k, a = 1) { const [r, g, b] = hex(h).map(v => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))); return `rgba(${r},${g},${b},${a})`; }
  function shapePath(g, kind, x, y, s, rot, rand) {
    g.beginPath();
    if (kind === "chunk") {
      const n = 6 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) { const a = rot + i / n * Math.PI * 2, r = s * (0.65 + rand() * 0.35); g[i ? "lineTo" : "moveTo"](x + Math.cos(a) * r, y + Math.sin(a) * r * 0.85); }
      g.closePath();
    } else if (kind === "flake") g.ellipse(x, y, s, s * 0.28, rot, 0, Math.PI * 2);
    else if (kind === "shard") g.ellipse(x, y, s, s * 0.18, rot, 0, Math.PI * 2);
    else g.ellipse(x, y, s, s * 0.62, rot, 0, Math.PI * 2);
  }
  const CAP = 512;
  function capTextures(id, spec) {
    const key = id + ":" + spec.layers.map(l => l.join("/")).join("|");
    if (capCache.has(key)) return capCache.get(key);
    const mk = () => { const c = document.createElement("canvas"); c.width = c.height = CAP; return c; };
    const col = mk(), bump = mk(), prm = mk();
    const gc = col.getContext("2d"), gb = bump.getContext("2d"), gp = prm.getContext("2d");
    const order = [...Array(25).keys()].map(String).concat("Z");
    const rand = rng(1234 + order.indexOf(String(id)) * 97);
    const seam = [];
    for (const [name, from, to] of spec.layers) {
      const f = FILLS[name];
      const y0 = Math.round((1 - to) * CAP), y1 = Math.round((1 - from) * CAP), h = y1 - y0;
      const grad = gc.createLinearGradient(0, y0, 0, y1);
      grad.addColorStop(0, f.base); grad.addColorStop(1, f.shade);
      gc.fillStyle = grad; gc.fillRect(0, y0, CAP, h);
      gc.save(); gc.beginPath(); gc.rect(0, y0, CAP, h); gc.clip();
      for (let i = 0; i < 70 * f.mottle; i++) {
        const x = rand() * CAP, y = y0 + rand() * h, r = 14 + rand() * 50;
        const rg = gc.createRadialGradient(x, y, 0, x, y, r);
        const k = (rand() - 0.5) * 0.5;
        rg.addColorStop(0, tone(f.base, k, 0.6)); rg.addColorStop(1, tone(f.base, k, 0));
        gc.fillStyle = rg; gc.fillRect(x - r, y - r, r * 2, r * 2);
      }
      gb.fillStyle = "#808080"; gb.fillRect(0, y0, CAP, h);
      if (f.grain > 0) {
        for (let i = 0; i < 9000 * f.grain; i++) {
          const x = rand() * CAP, y = y0 + rand() * h, k = rand() < 0.5 ? -0.25 : 0.25;
          gc.fillStyle = tone(f.base, k, 0.35 * f.grain); gc.fillRect(x, y, 1.5, 1.5);
          gb.fillStyle = k > 0 ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.35)"; gb.fillRect(x, y, 1.5, 1.5);
        }
      }
      gp.fillStyle = `rgb(${Math.round((f.gloss || 0) * 255)},${Math.round(f.rough * 255)},0)`; gp.fillRect(0, y0, CAP, h);
      if (f.gloss === 1) {
        const sh = gc.createLinearGradient(0, y0, 0, y0 + h * 0.6);
        sh.addColorStop(0, "rgba(255,240,210,0.28)"); sh.addColorStop(1, "rgba(255,240,210,0)");
        gc.fillStyle = sh; gc.fillRect(0, y0, CAP, h * 0.6);
      }
      for (const c of f.chunks) {
        for (let i = 0; i < c.n; i++) {
          const s = (c.min + rand() * (c.max - c.min)) * CHUNK_SCALE[c.kind], x = rand() * CAP, y = y0 + s + rand() * Math.max(1, h - 2 * s), rot = rand() * Math.PI;
          const r0 = rand(); const sub = () => rng(Math.floor(r0 * 1e9));
          shapePath(gc, c.kind, x, y, s, rot, sub());
          gc.save(); gc.shadowColor = "rgba(60,30,10,0.45)"; gc.shadowBlur = s * 0.6; gc.shadowOffsetX = s * 0.15; gc.shadowOffsetY = s * 0.2;
          const rg = gc.createRadialGradient(x - s * 0.35, y - s * 0.35, s * 0.1, x, y, s * 1.1);
          rg.addColorStop(0, tone(c.color, 0.22)); rg.addColorStop(0.6, c.color); rg.addColorStop(1, tone(c.color, -0.25));
          gc.fillStyle = rg; gc.fill(); gc.restore();
          shapePath(gb, c.kind, x, y, s, rot, sub());
          const bg = gb.createRadialGradient(x, y, 0, x, y, s);
          bg.addColorStop(0, "#c8c8c8"); bg.addColorStop(0.7, "#a0a0a0"); bg.addColorStop(1, "#606060");
          gb.fillStyle = bg; gb.fill();
          shapePath(gp, c.kind, x, y, s, rot, sub());
          gp.fillStyle = `rgb(0,${Math.min(255, Math.round(f.rough * 255) + 70)},0)`; gp.fill();
        }
      }
      gc.restore();
      if (from > 0) seam.push(y1);
    }
    for (const y of seam) { gc.fillStyle = "rgba(40,20,10,0.4)"; gc.fillRect(0, y - 2, CAP, 4); gb.fillStyle = "#404040"; gb.fillRect(0, y - 2, CAP, 4); }
    const tex = c => { const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t; };
    const set = { color: tex(col), bump: tex(bump), prm: tex(prm) };
    set.color.colorSpace = THREE.SRGBColorSpace;
    capCache.set(key, set);
    return set;
  }

  function texLoad(url, color) {
    const texLoader = new THREE.TextureLoader();
    const t = texLoader.load(url, () => render(), undefined, () => {});
    t.flipY = false; t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4;
    return t;
  }
  function numberMask(id) { if (!numCache.has(id)) numCache.set(id, texLoad(`${BASE}num/${id}.jpg`, false)); return numCache.get(id); }
  function pbrMaps(kind) {
    if (!pbrCache.has(kind)) pbrCache.set(kind, { color: texLoad(`${BASE}pbr/${kind}_color.jpg`, true), rough: texLoad(`${BASE}pbr/${kind}_rough.jpg`, false) });
    return pbrCache.get(kind);
  }

  const CUT_N_ARR = [1, 0.16, -0.1];
  let CUT_N, fractureBump;
  function shellMaterial(planes) { return new THREE.MeshStandardMaterial({ color: SHELLS.dark.color, roughness: 0.42, metalness: 0, bumpScale: BUMP, clippingPlanes: planes }); }
  function stencilPair(geometry, plane, order) {
    const base = { depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, clippingPlanes: [plane] };
    const back = new THREE.MeshBasicMaterial({ ...base, side: THREE.BackSide, stencilFail: THREE.IncrementWrapStencilOp, stencilZFail: THREE.IncrementWrapStencilOp, stencilZPass: THREE.IncrementWrapStencilOp });
    const front = new THREE.MeshBasicMaterial({ ...base, side: THREE.FrontSide, stencilFail: THREE.DecrementWrapStencilOp, stencilZFail: THREE.DecrementWrapStencilOp, stencilZPass: THREE.DecrementWrapStencilOp });
    const a = new THREE.Mesh(geometry, back); a.renderOrder = order;
    const b = new THREE.Mesh(geometry, front); b.renderOrder = order;
    return [a, b];
  }
  let STENCIL_CAP;

  function buildHalf(geometry, innerGeometry, box, sign, orderBase) {
    const group = new THREE.Group();
    const localNormal = CUT_N.clone().multiplyScalar(sign);
    const plane = new THREE.Plane(localNormal.clone(), 0);
    const shellMat = shellMaterial([plane]);
    group.add(new THREE.Mesh(geometry, shellMat));
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const capGeo = new THREE.PlaneGeometry(size.z * 1.1, size.y * 1.1);
    const capShellMat = new THREE.MeshStandardMaterial({ color: SHELLS.dark.cap, roughness: 0.95, bumpMap: fractureBump, bumpScale: 0.006, ...STENCIL_CAP });
    const capShell = new THREE.Mesh(capGeo, capShellMat);
    const capFillMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, bumpScale: CAP_BUMP, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...STENCIL_CAP });
    const capFill = new THREE.Mesh(capGeo, capFillMat);
    for (const cap of [capShell, capFill]) {
      cap.position.set(0, center.y, center.z);
      cap.lookAt(localNormal.clone().multiplyScalar(-1).add(cap.position));
      cap.onAfterRender = () => renderer.clearStencil();
    }
    const [sa, sb] = stencilPair(geometry, plane, orderBase);
    capShell.renderOrder = orderBase + 1;
    const [ia, ib] = stencilPair(innerGeometry, plane, orderBase + 2);
    capFill.renderOrder = orderBase + 3;
    group.add(sa, sb, capShell, ia, ib, capFill);
    const normal = new THREE.Vector3(), point = new THREE.Vector3(), q = new THREE.Quaternion();
    function syncPlane() {
      group.updateMatrixWorld();
      normal.copy(localNormal).applyQuaternion(group.getWorldQuaternion(q)).normalize();
      point.setFromMatrixPosition(group.matrixWorld);
      plane.setFromNormalAndCoplanarPoint(normal, point);
    }
    return { group, plane, shellMat, capShellMat, capFillMat, syncPlane, sign };
  }

  function buildScene() {
    canvas = document.createElement("canvas");
    canvas.className = "choc3d-canvas";
    const gl = document.createElement("canvas").getContext("webgl2") || document.createElement("canvas").getContext("webgl");
    const d = gl && gl.getExtension("WEBGL_debug_renderer_info");
    const GPU = d ? String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)) : "";
    const SOFT = /swiftshader|llvmpipe|software|mesa offscreen/i.test(GPU);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !SOFT, alpha: true, stencil: true, powerPreference: "low-power" });
    renderer.setPixelRatio(SOFT ? 1 : Math.min(devicePixelRatio, 1.5));
    renderer.localClippingEnabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
    camera.position.set(2.6, 1.55, 2.1);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.38;
    pmrem.dispose();
    const key = new THREE.DirectionalLight(0xfff4e6, 1.8); key.position.set(3, 5, 2); scene.add(key);
    const eye = new THREE.DirectionalLight(0xfff8f0, 0.35); eye.position.set(1.2, 1.4, 0.6);
    camera.add(eye); scene.add(camera);
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
    controls.minDistance = 1.8; controls.maxDistance = 6; controls.maxPolarAngle = Math.PI * 0.62;
    controls.target.set(0, 0, 0); controls.autoRotate = false;
    controls.addEventListener("change", render);
    controls.addEventListener("start", () => { spin = null; });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
    {
      const c = document.createElement("canvas"); c.width = c.height = 256;
      const g = c.getContext("2d");
      const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
      grad.addColorStop(0, "rgba(40,25,15,0.45)"); grad.addColorStop(0.55, "rgba(40,25,15,0.18)"); grad.addColorStop(1, "rgba(40,25,15,0)");
      g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
      const tex = new THREE.CanvasTexture(c);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = -0.36; m.renderOrder = -1;
      scene.add(m);
    }
    pivot = new THREE.Group(); scene.add(pivot);
    CUT_N = new THREE.Vector3(...CUT_N_ARR).normalize();
    fractureBump = (() => {
      const c = document.createElement("canvas"); c.width = c.height = 256;
      const g = c.getContext("2d"); g.fillStyle = "#808080"; g.fillRect(0, 0, 256, 256);
      const rand = rng(77);
      for (let i = 0; i < 2600; i++) { const v = 96 + Math.floor(rand() * 64); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(rand() * 256, rand() * 256, 1 + rand() * 3, 1 + rand() * 2); }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); return t;
    })();
    STENCIL_CAP = { stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc, stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp };
    new ResizeObserver(render).observe(canvas);
  }

  function loadMesh() {
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(`${BASE}chocolat.json`, gltf => {
        let geometry = null;
        gltf.scene.traverse(o => { if (o.isMesh && !geometry) geometry = o.geometry; });
        geometry.computeBoundingBox();
        const size = new THREE.Vector3(); geometry.boundingBox.getSize(size);
        const s = 1 / Math.max(size.x, size.z);
        geometry.center(); geometry.scale(s, s, s); geometry.computeVertexNormals(); geometry.computeBoundingBox();
        const box = geometry.boundingBox.clone();
        const inner = geometry.clone(); inner.scale(0.9, 0.86, 0.9); inner.translate(0, 0.012, 0);
        const whole = new THREE.Mesh(geometry, shellMaterial(null));
        const L = buildHalf(geometry, inner, box, -1, 10);
        const R = buildHalf(geometry, inner, box, +1, 20);
        pivot.add(whole, L.group, R.group);
        choc = { whole, halves: [L, R], box };
        resolve();
      }, undefined, reject);
    });
  }

  function applyRecipe() {
    if (!choc) return;
    const spec = SPEC[state.id]; if (!spec) return;
    const shell = SHELLS[state.shell];
    const pbr = pbrMaps(spec.pbr ?? shell.pbr);
    const cap = capTextures(state.id, spec);
    for (const m of [choc.whole.material, ...choc.halves.map(h => h.shellMat)]) {
      m.map = pbr.color; m.roughnessMap = pbr.rough; m.roughness = pbr.rough ? 1 : 0.42;
      m.color.setHex(pbr.color ? 0xffffff : shell.color); m.bumpMap = numberMask(state.id); m.needsUpdate = true;
    }
    for (const h of choc.halves) {
      h.capShellMat.color.setHex(shell.cap);
      const m = h.capFillMat; m.map = cap.color; m.bumpMap = cap.bump; m.roughnessMap = cap.prm; m.needsUpdate = true;
    }
    render();
  }

  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function updateCut() {
    if (!choc) return;
    const t = easeInOut(state.cut), gap = 0.34 * t, open = state.cut > 0.002;
    choc.whole.visible = !open;
    for (const h of choc.halves) {
      h.group.visible = open;
      h.group.position.copy(CUT_N).multiplyScalar(h.sign * gap);
      h.group.position.z += 0.06 * t;
      h.group.rotation.set(0, -h.sign * 0.26 * t, h.sign * 0.05 * t);
      h.syncPlane();
    }
  }
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let spin = null, raf = 0, clock;
  function showcase() {
    if (!choc) return;
    state.cut = state.cutTarget = 0; controls.autoRotate = false;
    if (REDUCED) { state.cutTarget = 1; render(); return; }
    spin = { from: pivot.rotation.y, to: pivot.rotation.y + Math.PI * 2, t: 0, duration: 1.5, opened: false };
    render();
  }
  function stepSpin(dt) {
    if (!spin) return false;
    spin.t = Math.min(spin.duration, spin.t + dt);
    const p = spin.t / spin.duration;
    pivot.rotation.y = spin.from + (spin.to - spin.from) * easeInOut(p);
    if (!spin.opened && p >= 0.5) { spin.opened = true; state.cutTarget = 1; }
    if (p >= 1) { pivot.rotation.y = spin.from; spin = null; }
    return true;
  }
  function render() { if (!raf && !document.hidden && renderer) raf = requestAnimationFrame(frame); }
  function frame() {
    raf = 0; if (document.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    let busy = stepSpin(dt);
    if (Math.abs(state.cutTarget - state.cut) > 0.0005) { state.cut += Math.sign(state.cutTarget - state.cut) * Math.min(Math.abs(state.cutTarget - state.cut), dt * 1.4); busy = true; }
    updateCut();
    if (controls.update()) busy = true;
    resize();
    renderer.render(scene, camera);
    if (busy) raf = requestAnimationFrame(frame);
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight, pr = renderer.getPixelRatio();
    if (!w || !h) return;
    if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  }

  async function ensureReady() {
    if (failed) return false;
    if (!readyPromise) {
      readyPromise = (async () => {
        THREE = await import(`${CDN}/build/three.module.js`);
        ({ OrbitControls } = await import(`${CDN}/examples/jsm/controls/OrbitControls.js`));
        ({ GLTFLoader } = await import(`${CDN}/examples/jsm/loaders/GLTFLoader.js`));
        ({ RoomEnvironment } = await import(`${CDN}/examples/jsm/environments/RoomEnvironment.js`));
        clock = new THREE.Clock();
        buildScene();
        await loadMesh();
      })().catch(e => { console.error("choc3d: could not load", e); failed = true; throw e; });
    }
    try { await readyPromise; return true; } catch (e) { return false; }
  }

  window.Choc3D = {
    // Mounts (or re-shows) the identified chocolate in `container`. Returns true if the 3D view is showing,
    // false if it fell back (no 3D model for this key, or Three.js/WebGL unavailable) - caller keeps the photo.
    async show(container, key) {
      const mapped = mapKey(key);
      if (!mapped) return false;
      if (!(await ensureReady())) return false;
      state.id = mapped.id; state.shell = mapped.shell;
      container.appendChild(canvas);
      applyRecipe();
      showcase();
      return true;
    },
    toggleCut() {
      if (!choc) return;
      spin = null;
      state.cutTarget = state.cutTarget > 0.5 ? 0 : 1;
      render();
      return state.cutTarget > 0.5;
    },
    // The shell + filling breakdown for the result card's text, independent of whether 3D actually loaded.
    anatomy(key) {
      const mapped = mapKey(key); if (!mapped) return null;
      const spec = SPEC[mapped.id]; if (!spec) return null;
      const shell = SHELLS[mapped.shell];
      const rows = [{ label: "Shell", text: shell.label + (spec.studs ? ", studded with almonds" : ""), color: "#" + shell.color.toString(16).padStart(6, "0") }];
      if (!spec.solid) [...spec.layers].reverse().forEach(([f], i) => rows.push({ label: spec.layers.length > 1 ? (i === 0 ? "Top layer" : "Bottom layer") : "Heart", text: FILLS[f].label, color: FILLS[f].base }));
      else rows.push({ label: "Heart", text: FILLS[spec.layers[0][0]].label, color: FILLS[spec.layers[0][0]].base });
      return rows;
    },
  };
})();
