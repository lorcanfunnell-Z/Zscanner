// Checks the trained model on whole photos the same way the app's "Use a photo" does:
// square windows at two sizes slid across the photo, keeping the most confident one.
// Usage: node training/evaluate.js <folder of photos named after their chocolate key, e.g. 12.jpg, zdark-2.jpg>
const fs = require("fs"), path = require("path"), tf = require("@tensorflow/tfjs-node"), sharp = require("sharp");
const ROOT = path.join(__dirname, "..");
(async () => {
  const dir = process.argv[2];
  const base = await tf.loadGraphModel("file://" + path.join(ROOT, "app/vendor/mobilenet/model.json"));
  const head = await tf.loadLayersModel("file://" + path.join(ROOT, "app/model/head/model.json"));
  const { labels } = JSON.parse(fs.readFileSync(path.join(ROOT, "app/model/labels.json")));
  let ok = 0, n = 0;
  for (const f of fs.readdirSync(dir).filter(f => /\.jpe?g$/i.test(f)).sort()) {
    const want = f.replace(/(-\d+)?\.jpe?g$/i, "");
    const { width: W, height: H } = await sharp(path.join(dir, f)).metadata();
    const side = Math.min(W, H), boxes = [];
    for (const share of [0.38, 0.55]) { const size = Math.round(side * share), step = size / 2;
      for (let y = 0; y + size <= H + 1; y += step) for (let x = 0; x + size <= W + 1; x += step)
        boxes.push({ left: Math.round(Math.min(x, W - size)), top: Math.round(Math.min(y, H - size)), width: size, height: size }); }
    const bufs = await Promise.all(boxes.map(b => sharp(path.join(dir, f)).extract(b).resize(224, 224).removeAlpha().raw().toBuffer()));
    const probs = tf.tidy(() => { const x = tf.stack(bufs.map(b => tf.tensor3d(new Uint8Array(b), [224, 224, 3]))).toFloat().div(255);
      const e = base.predict(x); return head.predict(e.div(e.norm("euclidean", 1, true))).arraySync(); });
    let best = probs[0]; for (const r of probs) if (Math.max(...r) > Math.max(...best)) best = r;
    const i = best.indexOf(Math.max(...best)), got = labels[i], p = best[i];
    n++; const good = got === want && p >= 0.45; if (good) ok++;
    console.log(`${want.padEnd(6)} ${good ? "OK" : "--"} got ${got} (${(p * 100).toFixed(0)}%)`);
  }
  console.log(`Correct and confident: ${ok}/${n}`);
})();
