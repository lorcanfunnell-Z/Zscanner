// Marks where the chocolate is in round-2 collect photos (cam2_*.jpg = the whole camera view, any background)
// using the trained finder, and adds the boxes to training-photos/boxes.json.
// Photos where the finder isn't sure there's a chocolate are marked "skip" (except the "none" folder).
// Usage: node training/boxes_finder.js [finder model.json]   (default app/model4/finder)
const fs = require("fs"), path = require("path"), tf = require("@tensorflow/tfjs-node"), sharp = require("sharp");
const ROOT = path.join(__dirname, ".."), P = path.join(ROOT, "training-photos"), S = 224;
(async () => {
  const finder = await tf.loadLayersModel("file://" + path.resolve(process.argv[2] || path.join(ROOT, "app/model4/finder/model.json")));
  const boxes = JSON.parse(fs.readFileSync(path.join(P, "boxes.json")));
  const todo = [];
  for (const k of fs.readdirSync(P)) {
    if (!fs.statSync(path.join(P, k)).isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(P, k))) if (/^cam2_/.test(f) && !(k + "/" + f in boxes)) todo.push(k + "/" + f);
  }
  let found = 0, skipped = 0;
  for (let i = 0; i < todo.length; i += 32) {
    const batch = todo.slice(i, i + 32);
    const bufs = await Promise.all(batch.map(r => sharp(path.join(P, r)).resize(S, S, { fit: "cover" }).removeAlpha().raw().toBuffer()));
    const x = tf.tidy(() => tf.stack(bufs.map(b => tf.tensor3d(new Uint8Array(b), [S, S, 3]))).toFloat().div(127.5).sub(1));
    const [o, b] = finder.predict(x); const O = o.arraySync(), B = b.arraySync(); tf.dispose([x, o, b]);
    batch.forEach((r, j) => {
      if (r.startsWith("none/")) { boxes[r] = null; return; }
      const [cx, cy, s] = B[j];
      if (O[j][0] < 0.5 || s < 0.05) { boxes[r] = "skip"; skipped++; return; }
      boxes[r] = [cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2].map(v => Math.round(v * 1e4) / 1e4); found++;
    });
    process.stdout.write(".");
  }
  fs.writeFileSync(path.join(P, "boxes.json"), JSON.stringify(boxes));
  console.log(`\n${todo.length} round-2 photos: chocolate marked in ${found}, skipped ${skipped}`);
})();
