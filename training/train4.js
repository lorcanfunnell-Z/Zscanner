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

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const xent = (p, y) => tf.neg(tf.sum(tf.mul(y, tf.log(tf.clipByValue(p, 1e-7, 1))), 1)).mean();

  // ===== ALIGNMENT (same steps as the app): edge maths squares it up, the quarter model picks the top =====
  if (ALIGN) {
    const quarter = await tf.loadLayersModel("file://" + path.resolve(process.env.QUARTER || path.join(ROOT, "app/quarter"), "model.json"));
    const CACHE = path.join(ROOT, "training", "rot-cache.json"), cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE)) : {};
    const realItems = [...new Set([...train, ...test, ...testScans])].filter(a => !a.synth && Array.isArray(a.box));
    const todo = realItems.filter(a => !(a.file + "|" + a.box in cache)); let done = 0;
    for (let i = 0; i < todo.length; i += 16) {
      const b = todo.slice(i, i + 16);
      const es = await Promise.all(b.map(async a => { const [cx, cy, s] = readerCrop(a, false); return edgeAngle(new Uint8Array(await view(a.file, cx, cy, s, {})), S).angle; }));
      const x = toTensor(await Promise.all(b.map((a, j) => { const [cx, cy, s] = readerCrop(a, false); return view(a.file, cx, cy, s, { angle: -es[j] }); })));
      const p = quarter.predict(x).arraySync(); x.dispose();
      b.forEach((a, j) => { const q = p[j].indexOf(Math.max(...p[j])); cache[a.file + "|" + a.box] = -es[j] + 90 * q; });
      done += b.length; if (done % 320 < 16) process.stdout.write(`aligned ${done}/${todo.length}\n`);
    }
    fs.writeFileSync(CACHE, JSON.stringify(cache));
    for (const a of realItems) a.rot = cache[a.file + "|" + a.box];
    console.log(`alignment ready for ${realItems.length} real photos`);
  }

  // ===== READER =====
  const rItems = train.filter(a => a.cls !== "none");
  const EVAL_ONLY = process.env.EVAL_ONLY;   // path to an existing reader model.json: just run the checks
  const reader = EVAL_ONLY ? await tf.loadLayersModel("file://" + path.resolve(EVAL_ONLY)) : heads(await backbone(), [["id", IDS.length, "softmax"], ["shell", 4, "softmax"], ["mark", 3, "softmax"]]);
  const rBatch = async (items, aug) => {
    const bufs = await Promise.all(items.map(a => { const [cx, cy, s] = readerCrop(a, aug); const j = aug ? jitter(false) : {};
      if (ALIGN) j.angle = (a.rot || 0) + (aug ? between(-12, 12) : 0);
      return view(a.file, cx, cy, s, j); }));
    const x = toTensor(bufs);
    const y = [tf.oneHot(items.map(a => IDS.indexOf(a.cls)), IDS.length).toFloat(), tf.oneHot(items.map(a => SHELLS.indexOf(shellOf(a.cls))), 4).toFloat(), tf.oneHot(items.map(a => MARKS.indexOf(markOf(a.cls))), 3).toFloat()];
    return { x, y };
  };
  if (!EVAL_ONLY) await trainLoop(reader, rItems, EPOCHS_R, rBatch, (p, y) => xent(p[0], y[0]).add(xent(p[1], y[1]).mul(.5)).add(xent(p[2], y[2]).mul(.5)), "reader");

  // ===== CHECK on real test scans (an honest check when TESTS=0) =====
  const SW = +(process.env.SHELL_W ?? 1), MW = +(process.env.MARK_W ?? 1);   // how much the logic step trusts the shell / mark guesses
  const combine = (pid, psh, pmk) => { const r = IDS.map((k, i) => pid[i] * psh[SHELLS.indexOf(shellOf(k))] ** SW * pmk[MARKS.indexOf(markOf(k))] ** MW); const s = r.reduce((a, b) => a + b, 0); return r.map(v => v / s); };
  const argmax = a => a.indexOf(Math.max(...a));
  async function check(items, label) {
    let ok = 0, top3 = 0, sh = 0, mk = 0, sure = 0, sureOk = 0; const wrong = [];
    for (let i = 0; i < items.length; i += 16) {
      const b = items.slice(i, i + 16);
      const x = toTensor(await Promise.all(b.map(a => { const [cx, cy, s] = readerCrop(a, false); return view(a.file, cx, cy, s, ALIGN ? { angle: a.rot || 0 } : {}); })));
      const p = reader.predict(x); const [I, SH, MK] = p.map(t => t.arraySync()); tf.dispose([x, ...p]);
      b.forEach((a, j) => {
        const c = combine(I[j], SH[j], MK[j]), order = c.map((v, k) => [v, k]).sort((u, v) => v[0] - u[0]), g = IDS[order[0][1]];
        if (g === a.cls) ok++; else wrong.push(a.cls + "→" + g);
        if (order.slice(0, 3).some(o => IDS[o[1]] === a.cls)) top3++;
        if (SHELLS[argmax(SH[j])] === shellOf(a.cls)) sh++; if (MARKS[argmax(MK[j])] === markOf(a.cls)) mk++;
        if (order[0][0] >= .65 && order[0][0] - order[1][0] >= .3) { sure++; if (g === a.cls) sureOk++; }
      });
    }
    const n = items.length, pc = v => (100 * v / Math.max(1, n)).toFixed(0) + "%";
    const r = { label, n, right: pc(ok), inTop3: pc(top3), shellRight: pc(sh), digitsRight: pc(mk), wouldAnswer: pc(sure), rightWhenAnswering: (100 * sureOk / Math.max(1, sure)).toFixed(0) + "%", mistakes: wrong.join(" ") };
    console.log(r); return r;
  }
  const report = { trainedAt: new Date().toISOString(), testsUsedForTraining: TESTS,
    heldBack: await check(test.filter(a => a.cls !== "none" && Array.isArray(a.box)), "held-back recording photos"),
    seenTests: seenScans.length ? await check(seenScans, TESTS ? "real test scans (trained on, not a fair check)" : "real test scans (never trained on)") : null,
    heldTests: heldScans.length ? await check(heldScans, "HELD-BACK test (" + HOLD.join(",") + ", never trained on): the fair check") : null };
  if (EVAL_ONLY) return;
  await reader.save("file://" + path.join(OUT, "reader"));
  const F = path.join(ROOT, "app", "model4", "finder"); fs.mkdirSync(path.join(OUT, "finder"), { recursive: true });
  for (const f of fs.readdirSync(F)) fs.copyFileSync(path.join(F, f), path.join(OUT, "finder", f));
  fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify({ ids: IDS, shells: SHELLS, marks: MARKS, shellOf: Object.fromEntries(IDS.map(k => [k, shellOf(k)])), markOf: Object.fromEntries(IDS.map(k => [k, markOf(k)])), input: S, scale: "x/127.5-1", readerPad: PAD, align: ALIGN, finderView: "centre square of the camera, full width" }, null, 2));
  fs.writeFileSync(path.join(OUT, "training-report.json"), JSON.stringify(report, null, 2));
  console.log("saved to", OUT);
})().catch(e => { console.error(e); process.exit(1); });
