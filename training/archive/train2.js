// zScanner v2 training: a FINDER (where is the chocolate in the camera view?) and a READER
// (which chocolate is it?), both fine-tuned from Google's MobileNetV2 0.35 (app/vendor/mnv2).
// The reader also predicts the shell colour and the kind of mark (one digit / two digits / z),
// which the app uses to rule out chocolates that can't match.
//
// Usage: node training/train2.js      (needs training-photos/ and training-photos/boxes.json from boxes.py)
// Options: EPOCHS_R=14 EPOCHS_F=10 OUT=app/model2
const fs = require("fs"), path = require("path"), tf = require("@tensorflow/tfjs-node"), sharp = require("sharp");

const ROOT = path.join(__dirname, ".."), PHOTOS = path.join(ROOT, "training-photos");
const OUT = path.resolve(process.env.OUT || path.join(ROOT, "app", "model2"));
const EPOCHS_R = +(process.env.EPOCHS_R || 14), EPOCHS_F = +(process.env.EPOCHS_F || 10), BATCH = 32;
const S = 224;

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
  all.push({ file: path.join(PHOTOS, rel), cls, box, cam: file.startsWith("cam_"), name: file });
}
// hold back the last quarter of each recording for testing
const train = [], test = [];
for (const cls of [...IDS, "none"]) {
  const items = all.filter(a => a.cls === cls).sort((a, b) => a.name.localeCompare(b.name));
  const cam = items.filter(a => a.cam), other = items.filter(a => !a.cam), cut = Math.floor(cam.length * 0.75);
  train.push(...other, ...cam.slice(0, cut)); test.push(...cam.slice(cut));
}
console.log(`photos: ${train.length} train, ${test.length} test`);

let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296), between = (a, b) => a + (b - a) * rnd();
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Crop a square region (centre cx,cy and side, in fractions of the photo; may go past the edge, which is mirrored),
// rotate it, adjust light, and return 224x224 RGB bytes.
async function view(file, cx, cy, side, { angle = 0, light = 1, sat = 1, hue = 0, blur = 0, jpeg = 0 } = {}) {
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
  if (blur > 0.3) img = img.blur(blur);
  if (jpeg) { const j = await img.jpeg({ quality: jpeg }).toBuffer(); img = sharp(j); }
  return img.removeAlpha().raw().toBuffer();
}
const toTensor = bufs => tf.tidy(() => tf.stack(bufs.map(b => tf.tensor3d(new Uint8Array(b), [S, S, 3]))).toFloat().div(127.5).sub(1));
const jitter = hard => ({ angle: between(-180, 180), light: between(hard ? .6 : .72, hard ? 1.35 : 1.28), sat: between(.85, 1.15), hue: between(-5, 5), blur: rnd() < .35 ? between(.3, 1.6) : 0, jpeg: rnd() < .4 ? Math.round(between(40, 85)) : 0 });

// The reader sees a square around the chocolate (like the app does after the finder has found it)
function readerCrop(a, aug) {
  const [x0, y0, x1, y1] = a.box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, side = Math.max(x1 - x0, y1 - y0);
  return aug ? [cx + between(-.12, .12) * side, cy + between(-.12, .12) * side, side * between(1.15, 1.6)] : [cx, cy, side * 1.35];
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

  // ===== READER =====
  const rItems = train.filter(a => a.cls !== "none");
  const reader = heads(await backbone(), [["id", IDS.length, "softmax"], ["shell", 4, "softmax"], ["mark", 3, "softmax"]]);
  const rBatch = async (items, aug) => {
    const bufs = await Promise.all(items.map(a => { const [cx, cy, s] = readerCrop(a, aug); return view(a.file, cx, cy, s, aug ? jitter(false) : {}); }));
    const x = toTensor(bufs);
    const y = [tf.oneHot(items.map(a => IDS.indexOf(a.cls)), IDS.length).toFloat(), tf.oneHot(items.map(a => SHELLS.indexOf(shellOf(a.cls))), 4).toFloat(), tf.oneHot(items.map(a => MARKS.indexOf(markOf(a.cls))), 3).toFloat()];
    return { x, y };
  };
  await trainLoop(reader, rItems, EPOCHS_R, rBatch, (p, y) => xent(p[0], y[0]).add(xent(p[1], y[1]).mul(.5)).add(xent(p[2], y[2]).mul(.5)), "reader");

  // ===== FINDER =====
  const finder = heads(await backbone(), [["obj", 1, "sigmoid"], ["box", 3, "sigmoid"]]);
  const fBatch = async (items, aug) => {
    const bufs = [], yo = [], yb = [];
    for (const a of items) {
      let [cx, cy, z] = finderCrop(a, aug);
      // sometimes aim away from the chocolate entirely so the finder also learns "no chocolate here"
      const away = aug && a.box && rnd() < .12;
      if (away) { z = between(.35, .5); const bx = (a.box[0] + a.box[2]) / 2; cx = bx < .5 ? between(.75, .85) : between(.15, .25); cy = between(.2, .8); }
      const j = aug ? { ...jitter(false), angle: 0 } : {};
      bufs.push(view(a.file, cx, cy, z, j));
      // box target relative to the crop: centre x, centre y, size (all 0..1)
      let obj = 0, t = [.5, .5, .3];
      if (a.box) {
        const [x0, y0, x1, y1] = a.box, bx = (x0 + x1) / 2, by = (y0 + y1) / 2, bs = Math.max(x1 - x0, y1 - y0);
        const rx = (bx - (cx - z / 2)) / z, ry = (by - (cy - z / 2)) / z, rs = bs / z;
        if (rx > .05 && rx < .95 && ry > .05 && ry < .95) { obj = 1; t = [rx, ry, Math.min(1, rs)]; }
      }
      yo.push([obj]); yb.push(t);
    }
    return { x: toTensor(await Promise.all(bufs)), y: [tf.tensor2d(yo), tf.tensor2d(yb)] };
  };
  await trainLoop(finder, train, EPOCHS_F, fBatch, (p, y) => {
    const bce = tf.losses.sigmoidCrossEntropy(y[0], tf.log(tf.clipByValue(p[0], 1e-6, 1 - 1e-6)).sub(tf.log(tf.clipByValue(tf.sub(1, p[0]), 1e-6, 1))));
    const boxErr = tf.sum(tf.mul(tf.square(tf.sub(p[1], y[1])), y[0]), 1).mean().mul(20);
    return bce.add(boxErr);
  }, "finder");

  // ===== TEST on held-back photos =====
  const combine = (pid, psh, pmk) => { const r = IDS.map((k, i) => pid[i] * psh[SHELLS.indexOf(shellOf(k))] * pmk[MARKS.indexOf(markOf(k))]); const s = r.reduce((a, b) => a + b, 0); return r.map(v => v / s); };
  const argmax = a => a.indexOf(Math.max(...a));
  let readRight = 0, readComb = 0, n = 0, pipeRight = 0, pipeN = 0, findHit = 0, noneOk = 0, noneN = 0, boxErrSum = 0;
  const confusions = {};
  for (let i = 0; i < test.length; i += 16) {
    const items = test.slice(i, i + 16);
    // finder on the full camera square
    const fx = toTensor(await Promise.all(items.map(a => { const [cx, cy, z] = finderCrop(a, false); return view(a.file, cx, cy, z); })));
    const [po, pb] = finder.predict(fx); const O = po.arraySync(), B = pb.arraySync(); tf.dispose([fx, po, pb]);
    // reader on (a) the true box and (b) the box the finder found
    const crops = [];
    items.forEach((a, k) => {
      if (a.cls === "none") return;
      const [cx, cy, s] = readerCrop(a, false); crops.push(view(a.file, cx, cy, s));
      const z = 1 / 0.85, ox = .5 - z / 2, oy = .5 - z / 2, [rx, ry, rs] = B[k];
      crops.push(view(a.file, ox + rx * z, oy + ry * z, Math.max(.08, rs * z) * 1.35));
    });
    let R = [];
    if (crops.length) { const rx = toTensor(await Promise.all(crops)); const p = reader.predict(rx); R = p.map(t => t.arraySync()); tf.dispose([rx, ...p]); }
    let c = 0;
    items.forEach((a, k) => {
      if (a.cls === "none") { noneN++; if (O[k][0] < .5) noneOk++; return; }
      const truth = IDS.indexOf(a.cls);
      if (O[k][0] >= .5) findHit++;
      const [x0, y0, x1, y1] = a.box, z = 1 / 0.85, tx = ((x0 + x1) / 2 - (.5 - z / 2)) / z, ty = ((y0 + y1) / 2 - (.5 - z / 2)) / z;
      boxErrSum += Math.hypot(B[k][0] - tx, B[k][1] - ty);
      const a1 = c++, a2 = c++;
      n++; if (argmax(R[0][a1]) === truth) readRight++;
      const comb = combine(R[0][a1], R[1][a1], R[2][a1]); if (argmax(comb) === truth) readComb++;
      pipeN++; const comb2 = combine(R[0][a2], R[1][a2], R[2][a2]); const g = argmax(comb2);
      if (g === truth && O[k][0] >= .5) pipeRight++; else if (g !== truth) { const key = a.cls + "→" + IDS[g]; confusions[key] = (confusions[key] || 0) + 1; }
    });
  }
  const pct = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + "%";
  const report = {
    trainedAt: new Date().toISOString(), test: "held-back last quarter of each recording",
    readerAlone: pct(readRight, n), readerWithShellAndMarkLogic: pct(readComb, n),
    fullPipeline_findThenRead: pct(pipeRight, pipeN), finderFoundChocolate: pct(findHit, pipeN),
    finderAvgCentreError: (boxErrSum / Math.max(1, pipeN)).toFixed(3), noChocolateCorrectlyIgnored: pct(noneOk, noneN),
    mistakes: Object.entries(confusions).sort((a, b) => b[1] - a[1]).slice(0, 12)
  };
  console.log(report);
  await reader.save("file://" + path.join(OUT, "reader"));
  await finder.save("file://" + path.join(OUT, "finder"));
  fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify({ ids: IDS, shells: SHELLS, marks: MARKS, shellOf: Object.fromEntries(IDS.map(k => [k, shellOf(k)])), markOf: Object.fromEntries(IDS.map(k => [k, markOf(k)])), input: S, scale: "x/127.5-1", readerPad: 1.35, finderView: "centre square of the camera, full width" }, null, 2));
  fs.writeFileSync(path.join(OUT, "training-report.json"), JSON.stringify(report, null, 2));
  console.log("saved to", OUT);
})().catch(e => { console.error(e); process.exit(1); });
