// zScanner v4 training (Stage 2): ALIGN=1 shows the reader every chocolate straightened (edge maths + quarter model,
// exactly like the app), with only small rotation jitter. HOLD_TEST=test-3 keeps that session out of training entirely
// and reports it as the fair check. Usage: ALIGN=1 SYNTH=1 TESTS=1 HOLD_TEST=test-3 QUARTER=app/quarter OUT=... node training/train4.js
// (v3 notes follow)
// zScanner v3 training (reader only; the finder from v2 is kept): tougher lighting/sharpness augmentation,
// optional real test scans (TESTS=1, mistakes weighted x4), and an honest check on test close-ups.
// Usage: OUT=app/model3 TESTS=0 node training/train3.js
// (v2 notes follow)
// zScanner v2 training: a FINDER (where is the chocolate in the camera view?) and a READER
// (which chocolate is it?), both fine-tuned from Google's MobileNetV2 0.35 (app/vendor/mnv2).
// The reader also predicts the shell colour and the kind of mark (one digit / two digits / z),
// which the app uses to rule out chocolates that can't match.
//
// Usage: node training/train2.js      (needs training-photos/ and training-photos/boxes.json from boxes.py)
// Options: EPOCHS_R=14 EPOCHS_F=10 OUT=app/model2
const fs = require("fs"), path = require("path"), tf = require("@tensorflow/tfjs-node"), sharp = require("sharp");
const { edgeAngle } = require("./align_lib.js");
const ALIGN = process.env.ALIGN === "1", HOLD = (process.env.HOLD_TEST || "").split(",").filter(Boolean);

const ROOT = path.join(__dirname, ".."), PHOTOS = path.join(ROOT, "training-photos");
const OUT = path.resolve(process.env.OUT || path.join(ROOT, "app", "model3"));
const EPOCHS_R = +(process.env.EPOCHS_R || 14), EPOCHS_F = +(process.env.EPOCHS_F || 10), BATCH = 32;
const S = 224;
const PAD = +(process.env.READER_PAD || 1.35);   // how much around the chocolate the reader sees (lower = more zoomed on the number)

// ---- what we know about each chocolate ----
const IDS = [...Array.from({ length: 25 }, (_, i) => String(i)), "zdark", "zmilk", "zwhite"];
const DARK = new Set(["1", "3", "5", "6", "8", "10", "13", "15", "17", "18", "19", "21", "23", "zdark"]);
const SHELLS = ["dark", "milk", "white", "milkwhite"], MARKS = ["one", "two", "z"];
const shellOf = k => k === "zwhite" ? "white" : k === "20" ? "milkwhite" : DARK.has(k) ? "dark" : "milk";
const markOf = k => k.startsWith("z") ? "z" : k.length === 2 ? "two" : "one";

// ---- data ----
const boxes = JSON.parse(fs.readFileSync(path.join(PHOTOS, "boxes.json")));
const all = [];
for (const [rel, box] of Object.entries(boxes)) {
  if (box === "skip") continue;
  const [cls, file] = rel.split("/");
  all.push({ file: path.join(PHOTOS, rel), cls, box, cam: /^cam2?_/.test(file), name: file });
}
// hold back the last quarter of each recording for testing
const train = [], test = [];
for (const cls of [...IDS, "none"]) {
  const items = all.filter(a => a.cls === cls).sort((a, b) => a.name.localeCompare(b.name));
  const cam = items.filter(a => a.cam), other = items.filter(a => !a.cam), cut = Math.floor(cam.length * 0.75);
  train.push(...other, ...cam.slice(0, cut)); test.push(...cam.slice(cut));
}
console.log(`photos: ${train.length} train, ${test.length} test`);
// Synthetic photos made from the official number designs (training/synth.py). Training only, never checked on.
const SYNTH = path.join(ROOT, "training-synth");
if (process.env.SYNTH === "1" && fs.existsSync(path.join(SYNTH, "boxes.json"))) {
  const sb = JSON.parse(fs.readFileSync(path.join(SYNTH, "boxes.json"))); let n = 0;
  const sang = {}; for (const f of fs.readdirSync(SYNTH)) if (/^angles_/.test(f)) Object.assign(sang, JSON.parse(fs.readFileSync(path.join(SYNTH, f))));
  for (const [rel, box] of Object.entries(sb)) { const [cls, file] = rel.split("/"); train.push({ file: path.join(SYNTH, rel), cls, box, cam: false, name: file, synth: true, rot: sang[rel] }); n++; }
  console.log(`synthetic photos from the designs: ${n}`);
}
// Real test scans: their close-ups are exactly what the reader saw. Mistakes are weighted x4, right ones x2.
const TESTS = process.env.TESTS === "1", TESTDIR = path.join(ROOT, "tests");
const testScans = [];
if (fs.existsSync(TESTDIR)) for (const t of fs.readdirSync(TESTDIR)) {
  const log = path.join(TESTDIR, t, "test-log.json"); if (!fs.existsSync(log)) continue;
  if (process.env.ONLY_TEST && t !== process.env.ONLY_TEST && !HOLD.includes(t)) continue;
  for (const r of JSON.parse(fs.readFileSync(log))) {
    if (!r.truth || !IDS.includes(r.truth)) continue;
    const f = path.join(TESTDIR, t, "closeup", r.truth, `scan${r.n}.jpg`); if (!fs.existsSync(f)) continue;
    testScans.push({ file: f, cls: r.truth, box: [.13, .13, .87, .87], cam: true, name: "test", wasRight: !!r.correct, test: t });
  }
}
if (TESTS) for (const s of testScans) if (!HOLD.includes(s.test)) for (let i = 0; i < (s.wasRight ? 2 : 4); i++) train.push(s);
const heldScans = testScans.filter(s => HOLD.includes(s.test)), seenScans = testScans.filter(s => !HOLD.includes(s.test));
console.log(`real test scans: ${testScans.length} found; held back (never trained on): ${heldScans.length}; ${TESTS ? "others used for training" : "none used for training"}`);

let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296), between = (a, b) => a + (b - a) * rnd();
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Crop a square region (centre cx,cy and side, in fractions of the photo; may go past the edge, which is mirrored),
// rotate it, adjust light, and return 224x224 RGB bytes.
async function view(file, cx, cy, side, { angle = 0, light = 1, sat = 1, hue = 0, blur = 0, jpeg = 0, ...fx } = {}) {
  const meta = await sharp(file).metadata(), W = meta.width, H = meta.height, pad = Math.round(Math.max(W, H) * 0.8);
  const grow = angle ? 1.42 : 1;                       // take a bigger square first so rotating leaves no empty corners
  const ps = Math.max(8, Math.round(side * W * grow));
  const big = await sharp(file).extend({ top: pad, bottom: pad, left: pad, right: pad, extendWith: "mirror" }).raw().toBuffer({ resolveWithObject: true });
  let px = Math.round(cx * W - ps / 2) + pad, py = Math.round(cy * H - ps / 2) + pad;
  px = Math.max(0, Math.min(px, big.info.width - ps)); py = Math.max(0, Math.min(py, big.info.height - ps));
  const R = Math.round(S * grow);
  let out = await sharp(big.data, { raw: big.info }).extract({ left: px, top: py, width: ps, height: ps }).resize(R, R).raw().toBuffer({ resolveWithObject: true });
  if (angle) {
    const rot = await sharp(out.data, { raw: out.info }).rotate(angle, { background: "#808080" }).raw().toBuffer({ resolveWithObject: true });
    out = await sharp(rot.data, { raw: rot.info }).extract({ left: Math.floor((rot.info.width - S) / 2), top: Math.floor((rot.info.height - S) / 2), width: S, height: S }).raw().toBuffer({ resolveWithObject: true });
  }
  let img = sharp(out.data, { raw: out.info }).modulate({ brightness: light, saturation: sat, hue: Math.round(hue) });
  if (fx.gamma) img = img.gamma(fx.gamma);                                    // harsh vs flat light
  if (fx.contrast) img = img.linear(fx.contrast, 128 * (1 - fx.contrast));
  if (fx.shadow || fx.glare) {                                                 // hard shadow edge across the chocolate / sun reflection
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">` +
      (fx.shadow ? `<polygon points="${fx.shadow.map(p => p.join(",")).join(" ")}" fill="black" fill-opacity="${fx.shadowAlpha}"/>` : "") +
      (fx.glare ? `<defs><radialGradient id="g"><stop offset="0" stop-color="white" stop-opacity="${fx.glare[3]}"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient></defs><circle cx="${fx.glare[0]}" cy="${fx.glare[1]}" r="${fx.glare[2]}" fill="url(#g)"/>` : "") + `</svg>`;
    const flat = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const done = await sharp(flat.data, { raw: flat.info }).composite([{ input: Buffer.from(svg), blend: "over" }]).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    img = sharp(done.data, { raw: done.info });
  }
  if (fx.lowres) { const small = await img.resize(fx.lowres, fx.lowres).png().toBuffer(); img = sharp(small).resize(S, S); }
  if (fx.sharpen) img = img.sharpen({ sigma: fx.sharpen });
  if (blur > 0.3) img = img.blur(blur);
  if (jpeg) { const j = await img.jpeg({ quality: jpeg }).toBuffer(); img = sharp(j); }
  return img.removeAlpha().resize(S, S).raw().toBuffer();
}
const toTensor = bufs => tf.tidy(() => tf.stack(bufs.map(b => tf.tensor3d(new Uint8Array(b), [S, S, 3]))).toFloat().div(127.5).sub(1));
const jitter = hard => {
  const j = { angle: between(-180, 180), light: between(.55, 1.45), sat: between(.8, 1.2), hue: between(-6, 6), blur: rnd() < .3 ? between(.3, 1.4) : 0, jpeg: rnd() < .4 ? Math.round(between(40, 85)) : 0 };
  if (rnd() < .5) j.gamma = between(1.0, 2.2);                 // sharp's gamma: >1 = harsher, more contrasty light
  if (rnd() < .5) j.contrast = between(.75, 1.6);
  if (rnd() < .4) { const a = between(0, Math.PI * 2), c = [S / 2 + Math.cos(a) * between(-60, 60), S / 2 + Math.sin(a) * between(-60, 60)], d = [Math.cos(a + Math.PI / 2) * 400, Math.sin(a + Math.PI / 2) * 400], o = [Math.cos(a) * 400, Math.sin(a) * 400];
    j.shadow = [[c[0] - d[0], c[1] - d[1]], [c[0] + d[0], c[1] + d[1]], [c[0] + d[0] + o[0], c[1] + d[1] + o[1]], [c[0] - d[0] + o[0], c[1] - d[1] + o[1]]]; j.shadowAlpha = between(.25, .6); }
  if (rnd() < .3) j.glare = [between(40, 184), between(40, 184), between(25, 80), between(.25, .7)];
  if (rnd() < .3) j.lowres = Math.round(between(60, 140));    // a small, far-away chocolate
  else if (rnd() < .5) j.sharpen = between(.8, 2.2);          // the very sharp live camera close-ups
  return j;
};

// The reader sees a square around the chocolate (like the app does after the finder has found it)
function readerCrop(a, aug) {
  const [x0, y0, x1, y1] = a.box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, side = Math.max(x1 - x0, y1 - y0);
  return aug ? [cx + between(-.12, .12) * side * PAD / 1.35, cy + between(-.12, .12) * side * PAD / 1.35, side * PAD * between(.85, 1.18)] : [cx, cy, side * PAD];
}
// The finder sees the whole camera square. Collect-mode photos are 85% of it, so zoom out to ~1/0.85 and vary it.
function finderCrop(a, aug) {
  const z = aug ? between(.75, 1.5) : 1 / 0.85;
  return [0.5 + (aug ? between(-.22, .22) : 0), 0.5 + (aug ? between(-.22, .22) : 0), z];
}

// ---- models ----
async function backbone() {
  const m = await tf.loadLayersModel("file://" + path.join(ROOT, "app/vendor/mnv2/model.json"));
  return m;
}
function heads(base, spec) {
  const x = tf.layers.globalAveragePooling2d({}).apply(base.outputs[0]);
  const outs = spec.map(([name, units, act]) => tf.layers.dense({ units, activation: act, name }).apply(tf.layers.dense({ units: 128, activation: "relu", name: name + "_h" }).apply(x)));
  return tf.model({ inputs: base.inputs, outputs: outs });
}

async function trainLoop(model, items, epochs, makeBatch, lossFn, label) {
  let opt = tf.train.adam(1e-3);
  const baseLayers = model.layers.filter(l => !/_h$|^(id|shell|mark|obj|box)$|global_average/.test(l.name));
  for (let ep = 0; ep < epochs; ep++) {
    const warm = ep < 2; baseLayers.forEach(l => l.trainable = !warm);   // first 2 epochs: only the new heads learn
    if (!warm) { if (ep === 2) opt.dispose(); opt = tf.train.adam(2.5e-4 * (1 - ep / epochs) + 2e-5); } // fresh optimiser when the whole network starts learning
    const order = shuffle(items.slice()); let sum = 0, n = 0; const t0 = Date.now();
    for (let i = 0; i < order.length; i += BATCH) {
      const { x, y } = await makeBatch(order.slice(i, i + BATCH), true);
      const cost = opt.minimize(() => lossFn(model.apply(x, { training: false }), y), true);
      sum += cost.dataSync()[0]; n++; tf.dispose([x, y, cost]);
    }
    console.log(`${label} epoch ${ep + 1}/${epochs}: loss ${(sum / n).toFixed(3)} (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
}


// ======================= Stage 3: CHOCOPRINTS =======================
// A model that turns the straightened, zoomed-in number into a 128-number "chocoprint". Same mark -> similar print;
// lookalikes pushed apart. LOSS=arcface or LOSS=triplet. The three Z chocolates share one mark ("z"); their shell decides.
// Usage: LOSS=arcface SYNTH=1 TESTS=1 ALIGN=1 HOLD_TEST=test-3 OUT=... node training/train_print.js
const GRAY = process.env.GRAY === "1", LOSS = process.env.LOSS || "arcface", ZOOM = +(process.env.ZOOM || 0.62), EMB = 128, STEPS = +(process.env.STEPS || 120);
const MKS = ["z", ...Array.from({ length: 25 }, (_, i) => String(i))];
const mk = cls => cls.startsWith("z") ? "z" : cls;
const GROUPS = [["16", "18", "19", "21", "12"], ["6", "9", "5", "3", "8"], ["14", "20", "24", "22", "4", "2"], ["15", "13", "23", "17", "10", "1", "7", "11"], ["z", "0"]];
function zoomView(a, aug) {
  const [x0, y0, x1, y1] = a.box, side = Math.max(x1 - x0, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const z = side * PAD * ZOOM * (aug ? between(.88, 1.15) : 1);
  const j = aug ? jitter(false) : {}; j.angle = (a.rot || 0) + (aug ? between(-10, 10) : 0);
  if (aug) { delete j.lowres; }
  const buf = view(a.file, cx + (aug ? between(-.07, .07) * side : 0), cy + (aug ? between(-.07, .07) * side : 0), z, j);
  const harsh = aug && HARSHAUG && rnd() < .3 ? { dim: between(.3, .7), grain: between(4, 16) } : null;   // a dim, grainy room
  return (GRAY ? buf.then(toGray) : buf).then(b => harsh ? dimGrain(b, harsh) : b);
}
const HARSHAUG = process.env.HARSHAUG === "1";
function dimGrain(b, { dim, grain }) { const o = Buffer.alloc(b.length); for (let i = 0; i < b.length; i += 3) { const n = (rnd() + rnd() + rnd() - 1.5) * grain; for (let c = 0; c < 3; c++) o[i + c] = Math.max(0, Math.min(255, Math.round(b[i + c] * dim + n))); } return o; }
// Shape only: the chocoprint sees black-and-white, so it can't take the colour shortcut ("reddish = 16");
// shell colour is judged by the reader instead.
function toGray(b) { const o = Buffer.alloc(b.length); for (let i = 0; i < b.length; i += 3) { const g = Math.round(0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2]); o[i] = o[i + 1] = o[i + 2] = g; } return o; }
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // alignment angles (cached by train4.js; same steps as the app)
  const CACHE = path.join(ROOT, "training", "rot-cache.json"), cache = JSON.parse(fs.readFileSync(CACHE));
  const realItems = [...new Set([...train, ...test, ...testScans])].filter(a => !a.synth && Array.isArray(a.box));
  const missing = realItems.filter(a => !(a.file + "|" + a.box in cache));
  if (missing.length) { console.log(`${missing.length} photos have no alignment yet: run train4.js with ALIGN=1 first`); process.exit(1); }
  for (const a of realItems) a.rot = cache[a.file + "|" + a.box];
  const pool = {}; for (const m of MKS) pool[m] = { real: [], syn: [] };
  for (const a of train) if (a.cls !== "none" && Array.isArray(a.box)) pool[mk(a.cls)][a.synth ? "syn" : "real"].push(a);
  console.log("training prints:", MKS.map(m => `${m}:${pool[m].real.length}r/${pool[m].syn.length}s`).join(" "));
  const pick = m => { const p = pool[m]; const src = p.real.length && (rnd() < .55 || !p.syn.length) ? p.real : p.syn; return src[Math.floor(rnd() * src.length)]; };
  // P classes x K photos per batch; lookalike groups are put together half the time (hard pairs)
  // Stage 4 (HARDPAIRS=1): lookalike pairs from the confusion map, plus pairs whose prints sit closest (re-mined every round)
  const HARDP = process.env.HARDPAIRS === "1" ? JSON.parse(fs.readFileSync(path.join(ROOT, "training", "hard-pairs.json"))).map(([a, b, w]) => [mk(a), mk(b), w]) : [];
  let mined = [];
  const pickPair = () => { const all = HARDP.concat(mined), tot = all.reduce((s, h) => s + h[2], 0); let r = rnd() * tot; for (const h of all) { r -= h[2]; if (r <= 0) return h; } return all[0]; };
  function sampleBatch(P = 8, K = 4) {
    const cls = new Set();
    if (HARDP.length) while (cls.size < P / 2 + 1) { const [a, b] = pickPair(); cls.add(a); cls.add(b); }
    while (cls.size < P) {
      if (rnd() < .5) { const g = GROUPS[Math.floor(rnd() * GROUPS.length)]; for (const c of shuffle(g.slice()).slice(0, 3)) if (cls.size < P) cls.add(c); }
      else cls.add(MKS[Math.floor(rnd() * MKS.length)]);
    }
    const out = []; for (const c of [...cls].slice(0, P + 1)) for (let k = 0; k < K; k++) out.push(pick(c)); return out;
  }
  // ---- model ----
  const base = await backbone();
  const g = tf.layers.globalAveragePooling2d({}).apply(base.outputs[0]);
  const h = tf.layers.dense({ units: 256, activation: "relu", name: "print_h" }).apply(g);
  const e = tf.layers.dense({ units: EMB, name: "print" }).apply(h);
  const model = tf.model({ inputs: base.inputs, outputs: e });
  const W = tf.variable(tf.randomNormal([EMB, MKS.length], 0, 0.05), true, "arc_w");
  const norm = t => t.div(tf.norm(t, 2, -1, true).add(1e-9));
  const S_ = 30, M_ = 0.35;
  const arcLoss = (emb, labels) => {
    const en = norm(emb), wn = W.div(tf.norm(W, 2, 0, true).add(1e-9));
    const cos = tf.clipByValue(tf.matMul(en, wn), -1 + 1e-6, 1 - 1e-6);
    const oh = tf.oneHot(labels, MKS.length).toFloat();
    const target = tf.cos(tf.acos(cos).add(M_));
    const logits = oh.mul(target).add(tf.scalar(1).sub(oh).mul(cos)).mul(S_);
    return tf.losses.softmaxCrossEntropy(oh, logits);
  };
  const tripLoss = (emb, labels) => {
    const en = norm(emb), sim = tf.matMul(en, en, false, true), d = tf.sqrt(tf.relu(tf.scalar(2).sub(sim.mul(2))).add(1e-9));
    const l = labels.expandDims(1), same = tf.equal(l, l.transpose()).toFloat(), eye = tf.eye(labels.shape[0]);
    const pos = same.sub(eye), neg = tf.scalar(1).sub(same);
    // batch-all, soft margin: every (anchor, same, different) triplet in the batch counts, averaged over the ones still
    // wrong. Gentler than "hardest only", which can collapse all prints to one point.
    const t = d.expandDims(2).sub(d.expandDims(1)).add(0.2);              // d(a,p) - d(a,n) + margin
    const valid = pos.expandDims(2).mul(neg.expandDims(1));
    const sl = tf.softplus(t.mul(5)).div(5).mul(valid);
    return sl.sum().div(valid.sum().add(1));
  };
  const lossFn = LOSS === "triplet" ? tripLoss : arcLoss;
  const baseLayers = model.layers.filter(l => !/^print/.test(l.name) && !/global_average/.test(l.name));
  // checkpoints: saved after every round so a paused/restarted workspace can carry on (RESUME=1)
  const CK = path.join(OUT, "checkpoint"); let startEp = 0;
  if (process.env.RESUME === "1" && fs.existsSync(path.join(CK, "state.json"))) {
    const st = JSON.parse(fs.readFileSync(path.join(CK, "state.json")));
    const saved = await tf.loadLayersModel("file://" + path.join(CK, "model.json"));
    for (const l of model.layers) { try { const sl = saved.getLayer(l.name); if (sl.getWeights().length) l.setWeights(sl.getWeights()); } catch (e) {} } saved.dispose();
    W.assign(tf.tensor(st.W)); startEp = st.epoch; for (let i = 0; i < st.rndCalls; i++) rnd();
    console.log(`resuming from round ${startEp + 1}`);
  }
  let opt = tf.train.adam(1e-3);
  for (let ep = startEp; ep < EPOCHS_R; ep++) {
    const warm = ep < 2; baseLayers.forEach(l => l.trainable = !warm);
    if (!warm) { opt.dispose(); opt = tf.train.adam(2.5e-4 * (1 - ep / EPOCHS_R) + 2e-5); }
    let sum = 0; const t0 = Date.now();
    for (let s = 0; s < STEPS; s++) {
      const b = sampleBatch();
      const x = toTensor(await Promise.all(b.map(a => zoomView(a, true)))), y = tf.tensor1d(b.map(a => MKS.indexOf(mk(a.cls))), "int32");
      const cost = opt.minimize(() => lossFn(model.apply(x, { training: false }), y), true);
      sum += cost.dataSync()[0]; tf.dispose([x, y, cost]);
    }
    console.log(`prints (${LOSS}) epoch ${ep + 1}/${EPOCHS_R}: loss ${(sum / STEPS).toFixed(3)} (${Math.round((Date.now() - t0) / 1000)}s)`);
    if (HARDP.length) {   // hard-negative mining: which marks' average prints are closest right now?
      const cent = {};
      for (const m of MKS) { const l = pool[m].real.length ? pool[m].real : pool[m].syn; const sm = shuffle(l.slice()).slice(0, 6);
        const x = toTensor(await Promise.all(sm.map(a => zoomView(a, false)))); const e = norm(model.predict(x)); cent[m] = norm(e.mean(0)).arraySync(); tf.dispose([x, e]); }
      const sims = []; for (let i = 0; i < MKS.length; i++) for (let j = i + 1; j < MKS.length; j++) sims.push([MKS[i], MKS[j], cent[MKS[i]].reduce((s, v, k) => s + v * cent[MKS[j]][k], 0)]);
      sims.sort((a, b) => b[2] - a[2]); mined = sims.slice(0, 12).map(([a, b, v]) => [a, b, 3 * Math.max(0.1, v)]);
      console.log("  closest prints now:", sims.slice(0, 6).map(([a, b, v]) => `${a}/${b} ${v.toFixed(2)}`).join(", "));
    }
    fs.mkdirSync(CK, { recursive: true }); await model.save("file://" + CK);
    fs.writeFileSync(path.join(CK, "state.json"), JSON.stringify({ epoch: ep + 1, W: W.arraySync(), rndCalls: 0 }));
  }
  await model.save("file://" + path.join(OUT, "print"));
  // ---- gallery: prints of real photos (training recordings + seen tests), plus a few synthetic per mark ----
  const embed = async list => { const out = []; for (let i = 0; i < list.length; i += 32) { const x = toTensor(await Promise.all(list.slice(i, i + 32).map(a => zoomView(a, false)))); const p = norm(model.predict(x)); out.push(...p.arraySync()); tf.dispose([x, p]); } return out; };
  const galItems = []; for (const m of MKS) { galItems.push(...shuffle(pool[m].real.slice()).slice(0, 30), ...shuffle(pool[m].syn.slice()).slice(0, 6)); }
  const galE = await embed(galItems), galL = galItems.map(a => mk(a.cls));
  fs.writeFileSync(path.join(OUT, "gallery.json"), JSON.stringify({ marks: MKS, zoom: ZOOM, gray: GRAY, entries: galE.map((v, i) => [galL[i], v.map(x => Math.round(x * 1e4) / 1e4)]) }));
  // ---- check: nearest references (mean of the 3 closest per mark) ----
  async function check(items, label) {
    const qs = await embed(items); let ok = 0, sure = 0, sureOk = 0; const wrong = [];
    qs.forEach((q, i) => {
      const per = {}; galE.forEach((g, j) => { const s = g.reduce((a, v, k) => a + v * q[k], 0); (per[galL[j]] = per[galL[j]] || []).push(s); });
      const sc = Object.entries(per).map(([m, ss]) => [m, ss.sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0) / 3]).sort((a, b) => b[1] - a[1]);
      const truth = mk(items[i].cls), [g1, s1] = sc[0], s2 = sc[1][1];
      if (g1 === truth) ok++; else wrong.push(truth + "→" + g1);
      if (s1 > .6 && s1 - s2 > .08) { sure++; if (g1 === truth) sureOk++; }
    });
    const r = { label, n: items.length, right: Math.round(100 * ok / items.length) + "%", sureShare: Math.round(100 * sure / items.length) + "%", rightWhenSure: Math.round(100 * sureOk / Math.max(1, sure)) + "%", mistakes: wrong.join(" ") };
    console.log(r); return r;
  }
  const report = { loss: LOSS, zoom: ZOOM, gray: GRAY, trainedAt: new Date().toISOString(),
    heldBackRecordings: await check(test.filter(a => a.cls !== "none" && Array.isArray(a.box)), "held-back recording photos (mark only)"),
    heldTest: heldScans.length ? await check(heldScans, "HELD-BACK " + HOLD.join(",") + " (mark only, fair check)") : null };
  fs.writeFileSync(path.join(OUT, "print-report.json"), JSON.stringify(report, null, 2));
  console.log("saved to", OUT);
})().catch(e => { console.error(e); process.exit(1); });
