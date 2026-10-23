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


// ======================= Stage 4: READER with hard pairs + colour drop-out =======================
// Half of each batch is lookalike pairs from training/hard-pairs.json (both sides together); half the photos are shown
// in black and white, and for those the shell answer isn't asked (so "reddish = 16" stops working).
// Usage: SYNTH=1 TESTS=1 HOLD_TEST=test-3 OUT=... node training/train5.js   (RESUME=1 continues from the last round)
const HARD = JSON.parse(fs.readFileSync(path.join(ROOT, "training", "hard-pairs.json"))), GRAYP = +(process.env.GRAYP ?? 0.5);
function toGray(b) { const o = Buffer.alloc(b.length); for (let i = 0; i < b.length; i += 3) { const g = Math.round(0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2]); o[i] = o[i + 1] = o[i + 2] = g; } return o; }
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const xent = (p, y) => tf.neg(tf.sum(tf.mul(y, tf.log(tf.clipByValue(p, 1e-7, 1))), 1));
  const rItems = train.filter(a => a.cls !== "none" && Array.isArray(a.box));
  const byCls = {}; for (const a of rItems) (byCls[a.cls] = byCls[a.cls] || []).push(a);
  const zAll = ["zdark", "zmilk", "zwhite"];
  const pickOf = c => { const l = c === "z" ? zAll.flatMap(k => byCls[k] || []) : byCls[c] || []; return l[Math.floor(rnd() * l.length)]; };
  const wsum = HARD.reduce((s, h) => s + h[2], 0);
  const pickPair = () => { let r = rnd() * wsum; for (const h of HARD) { r -= h[2]; if (r <= 0) return h; } return HARD[0]; };
  function batchItems() {
    const out = [];
    while (out.length < BATCH / 2) { const [a, b] = pickPair(); out.push(pickOf(a), pickOf(a), pickOf(b), pickOf(b)); }
    while (out.length < BATCH) out.push(rItems[Math.floor(rnd() * rItems.length)]);
    return out.filter(Boolean);
  }
  async function makeBatch(items, aug) {
    const gray = items.map(() => aug && rnd() < GRAYP);
    const bufs = await Promise.all(items.map((a, i) => { const [cx, cy, s] = readerCrop(a, aug); const v = view(a.file, cx, cy, s, aug ? jitter(false) : {}); return gray[i] ? v.then(toGray) : v; }));
    const x = toTensor(bufs);
    const y = [tf.oneHot(items.map(a => IDS.indexOf(a.cls)), IDS.length).toFloat(), tf.oneHot(items.map(a => SHELLS.indexOf(shellOf(a.cls))), 4).toFloat(),
      tf.oneHot(items.map(a => MARKS.indexOf(markOf(a.cls))), 3).toFloat(), tf.tensor1d(gray.map(g => g ? 0 : 1))];
    return { x, y };
  }
  const reader = heads(await backbone(), [["id", IDS.length, "softmax"], ["shell", 4, "softmax"], ["mark", 3, "softmax"]]);
  const CK = path.join(OUT, "checkpoint"); let startEp = 0;
  if (process.env.RESUME === "1" && fs.existsSync(path.join(CK, "state.json"))) {
    const saved = await tf.loadLayersModel("file://" + path.join(CK, "model.json")); for (const l of reader.layers) { try { const sl = saved.getLayer(l.name); if (sl.getWeights().length) l.setWeights(sl.getWeights()); } catch (e) {} } saved.dispose();
    startEp = JSON.parse(fs.readFileSync(path.join(CK, "state.json"))).epoch; console.log(`resuming from round ${startEp + 1}`);
  }
  const baseLayers = reader.layers.filter(l => !/_h$|^(id|shell|mark)$|global_average/.test(l.name));
  const steps = Math.ceil(rItems.length / BATCH);
  let opt = tf.train.adam(1e-3);
  for (let ep = startEp; ep < EPOCHS_R; ep++) {
    const warm = ep < 2; baseLayers.forEach(l => l.trainable = !warm);
    if (!warm) { opt.dispose(); opt = tf.train.adam(2.5e-4 * (1 - ep / EPOCHS_R) + 2e-5); }
    let sum = 0; const t0 = Date.now();
    for (let s = 0; s < steps; s++) {
      const { x, y } = await makeBatch(batchItems(), true);
      const cost = opt.minimize(() => { const p = reader.apply(x, { training: false });
        return xent(p[0], y[0]).add(xent(p[1], y[1]).mul(y[3]).mul(.5)).add(xent(p[2], y[2]).mul(.5)).mean(); }, true);
      sum += cost.dataSync()[0]; tf.dispose([x, ...y, cost]);
    }
    console.log(`reader (hard pairs, colour drop-out) epoch ${ep + 1}/${EPOCHS_R}: loss ${(sum / steps).toFixed(3)} (${Math.round((Date.now() - t0) / 1000)}s)`);
    fs.mkdirSync(CK, { recursive: true }); await reader.save("file://" + CK); fs.writeFileSync(path.join(CK, "state.json"), JSON.stringify({ epoch: ep + 1 }));
  }
  await reader.save("file://" + path.join(OUT, "reader"));
  console.log("saved to", OUT);
})().catch(e => { console.error(e); process.exit(1); });
