// Trains the chocolate recogniser.
// Reads training-photos/<chocolate-key>/*.jpg, makes many varied copies of each photo
// (rotation, framing, lighting, blur), turns each copy into a MobileNet "fingerprint",
// and trains a small classifier on top. Writes app/model/head/ and app/model/labels.json.
//
// Usage: npm run train   (from the project folder)

const fs = require("fs");
const path = require("path");
const tf = require("@tensorflow/tfjs-node");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const PHOTOS = path.join(ROOT, "training-photos");
const OUT = process.env.OUT ? path.resolve(process.env.OUT) : path.join(ROOT, "app", "model");
const TRAIN_PER_PHOTO = Number(process.env.TRAIN_PER_PHOTO || 80);
const TEST_PER_PHOTO = Number(process.env.TEST_PER_PHOTO || 25);
const FRAME = 0.62; // share of a hand-cropped training photo that matches the app's framing square
const CAM_FRAME = Number(process.env.CAM_FRAME || 0.82); // photos from collect mode (cam_*.jpg) are saved a little wider than the live square
const frameOf = f => /cam_/.test(path.basename(f)) ? CAM_FRAME : FRAME;

// Small seeded random generator so runs are repeatable
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const between = (r, a, b) => a + (b - a) * r();

async function variant(file, r, hard, plain = false) {
  if (plain) { const m = await sharp(file).metadata(); const s = m.width, fr = Math.round(s * frameOf(file)), o = Math.round((s - fr) / 2);
    return sharp(file).extract({ left: o, top: o, width: fr, height: fr }).resize(224, 224).removeAlpha().raw().toBuffer(); }
  const meta = await sharp(file).metadata();
  const size = meta.width;
  const angle = between(r, hard ? -35 : -25, hard ? 35 : 25);
  const rotated = await sharp(file).rotate(angle, { background: { r: 235, g: 232, b: 228 } }).toBuffer({ resolveWithObject: true });
  const W = rotated.info.width, H = rotated.info.height;
  const frame = size * frameOf(file) * between(r, hard ? 0.78 : 0.85, hard ? 1.3 : 1.18);
  const cx = W / 2 + size * between(r, -0.07, 0.07), cy = H / 2 + size * between(r, -0.07, 0.07);
  const left = Math.max(0, Math.round(cx - frame / 2)), top = Math.max(0, Math.round(cy - frame / 2));
  const side = Math.min(Math.round(frame), W - left, H - top);
  let img = sharp(rotated.data).extract({ left, top, width: side, height: side }).resize(224, 224)
    .modulate({ brightness: between(r, hard ? 0.6 : 0.7, hard ? 1.4 : 1.3), saturation: between(r, 0.75, 1.25), hue: Math.round(between(r, -12, 12)) })
    .linear(between(r, 0.8, 1.2), between(r, -15, 15));
  const blur = r();
  if (blur > 0.6) img = img.blur(between(r, 0.3, hard ? 1.8 : 1.2));
  if (r() > 0.5) img = img.jpeg({ quality: Math.round(between(r, 35, 85)) });
  const buf = await img.removeAlpha().raw().toBuffer();
  return buf;
}

async function main() {
  const labels = fs.readdirSync(PHOTOS).filter(d => fs.statSync(path.join(PHOTOS, d)).isDirectory())
    .sort((a, b) => (isNaN(a) - isNaN(b)) || (Number(a) - Number(b)) || a.localeCompare(b));
  console.log(`Chocolates: ${labels.length} (${labels.join(", ")})`);
  const base = await tf.loadGraphModel("file://" + path.join(ROOT, "app", "vendor", "mobilenet", "model.json"));

  // Collect-mode photos: the last quarter of each recording is never trained on and is used as the real test.
  const split = {};
  for (const l of labels) {
    const files = fs.readdirSync(path.join(PHOTOS, l)).filter(f => /\.(jpe?g|png)$/i.test(f)).sort();
    const cam = files.filter(f => /^cam_/.test(f)), other = files.filter(f => !/^cam_/.test(f));
    const cut = Math.floor(cam.length * 0.75);
    split[l] = { train: [...other, ...cam.slice(0, cut)], test: cam.slice(cut) };
  }
  const hasRealTest = Object.values(split).some(s => s.test.length);

  async function embedAll(perPhoto, seed, hard, part = "train") {
    const feats = [], ys = [];
    const r = rng(seed);
    for (let li = 0; li < labels.length; li++) {
      const dir = path.join(PHOTOS, labels[li]);
      const files = (part === "realtest" ? split[labels[li]].test : split[labels[li]].train).map(f => path.join(dir, f));
      if (!files.length) continue;
      const n = part === "realtest" ? 1 : Math.max(2, Math.ceil(perPhoto / Math.max(1, Math.sqrt(files.length)))); // more photos -> fewer copies each
      const batch = [];
      for (const f of files) for (let i = 0; i < n; i++) batch.push(await variant(f, r, hard, part === "realtest"));
      const x = tf.tidy(() => tf.stack(batch.map(b => tf.tensor3d(new Uint8Array(b), [224, 224, 3]))).toFloat().div(255));
      const e = tf.tidy(() => { const o = base.predict(x); return o.div(o.norm("euclidean", 1, true)); });
      feats.push(e); x.dispose();
      for (let i = 0; i < batch.length; i++) ys.push(li);
      process.stdout.write(".");
    }
    process.stdout.write("\n");
    const X = tf.concat(feats); feats.forEach(t => t.dispose());
    return { X, Y: tf.oneHot(tf.tensor1d(ys, "int32"), labels.length).toFloat(), y: ys };
  }

  console.log("Making training copies…");
  const train = await embedAll(TRAIN_PER_PHOTO, 1, false);
  const test = hasRealTest
    ? (console.log("Testing on held-back camera photos the model never saw…"), await embedAll(1, 999, false, "realtest"))
    : (console.log("Making harder test copies…"), await embedAll(TEST_PER_PHOTO, 999, true));

  const head = tf.sequential();
  head.add(tf.layers.dropout({ inputShape: [train.X.shape[1]], rate: 0.3 }));
  head.add(tf.layers.dense({ units: 256, activation: "relu", kernelRegularizer: tf.regularizers.l2({ l2: 1e-4 }) }));
  head.add(tf.layers.dropout({ rate: 0.3 }));
  head.add(tf.layers.dense({ units: labels.length, activation: "softmax" }));
  head.compile({ optimizer: tf.train.adam(1e-3), loss: "categoricalCrossentropy", metrics: ["accuracy"] });
  await head.fit(train.X, train.Y, { epochs: 60, batchSize: 64, shuffle: true, verbose: 0,
    callbacks: { onEpochEnd: (ep, l) => { if ((ep + 1) % 20 === 0) console.log(`epoch ${ep + 1}: train accuracy ${(l.acc * 100).toFixed(1)}%`); } } });

  const probs = head.predict(test.X);
  const pred = probs.argMax(1).dataSync(), conf = probs.max(1).dataSync();
  let right = 0; const wrong = {};
  let confident = 0, confidentRight = 0;
  pred.forEach((p, i) => {
    if (labels[test.y[i]] === "none" && labels[p] === "none") { right++; return; }
    if (p === test.y[i]) right++; else { const k = `${labels[test.y[i]]}→${labels[p]}`; wrong[k] = (wrong[k] || 0) + 1; }
    if (conf[i] >= 0.6) { confident++; if (p === test.y[i]) confidentRight++; }
  });
  const report = {
    trainedAt: new Date().toISOString(), labels, photos: labels.map(l => fs.readdirSync(path.join(PHOTOS, l)).length),
    testType: hasRealTest ? "held-back camera photos" : "augmented copies of training photos (optimistic)", testAccuracy: right / pred.length, confidentShare: confident / pred.length, confidentAccuracy: confidentRight / Math.max(1, confident),
    commonMistakes: Object.entries(wrong).sort((a, b) => b[1] - a[1]).slice(0, 10)
  };
  console.log(`Test accuracy (${report.testType}): ${(report.testAccuracy * 100).toFixed(1)}%`);
  console.log(`Confident answers (>=60%): ${(report.confidentShare * 100).toFixed(1)}% of scans, ${(report.confidentAccuracy * 100).toFixed(1)}% right`);
  console.log("Most common mix-ups:", report.commonMistakes);

  fs.mkdirSync(path.join(OUT, "head"), { recursive: true });
  await head.save("file://" + path.join(OUT, "head"));
  fs.writeFileSync(path.join(OUT, "labels.json"), JSON.stringify({ labels, frame: FRAME, input: 224 }, null, 2));
  fs.writeFileSync(path.join(OUT, "training-report.json"), JSON.stringify(report, null, 2));
  console.log("Saved model to app/model/");
}

main().catch(e => { console.error(e); process.exit(1); });
