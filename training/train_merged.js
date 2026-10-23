// zScanner MERGED trainer (item 4 part B experiment): one model that does the reader's job (which chocolate, shell, mark)
// AND the "which side is up" job, from one look at the squared-up close-up. On the phone this would replace two model
// passes per frame with one (edge maths → square up → one model). Kept only if the fair check says it's at least as good.
//
// Every training picture is turned by (its upright angle − 90°×L) ± 8°, so the number points up, left, down or right,
// and the model is told L. Real photos' upright angles come from training/rot-cache.json; generated ones know theirs.
// Starts from model 4's reader (proven), the new "which side is up" head learns first (2 warm-up rounds).
// Usage:  OUT=/path node training/train_merged.js     Switches: EPOCHS_R=14  STEPS  RESUME=1  INIT=<reader model.json|none>
const { fs, path, tf, ROOT, at, IDS, SHELLS, MARKS, shellOf, markOf, rnd, between, shuffle, toTensor } = require("./lib/common.js");
const { view, jitter } = require("./lib/view.js");
const { readerCrop } = require("./lib/crops.js");
const { loadData, attachRotations } = require("./lib/data.js");
const { backbone, heads, copyWeights, saveRound, resumeRound } = require("./lib/models.js");
const OUT = path.resolve(process.env.OUT || at("experiments/merged-new")), EPOCHS_R = +(process.env.EPOCHS_R || 14), BATCH = 32;
const INIT = process.env.INIT || at("app/model4/reader/model.json");
const hold = process.env.HOLD_TEST ? process.env.HOLD_TEST.split(",").filter(Boolean) : undefined;
const { train } = loadData({ synth: true, tests: true, hold });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await attachRotations(train);
  const xent = (p, y) => tf.neg(tf.sum(tf.mul(y, tf.log(tf.clipByValue(p, 1e-7, 1))), 1));
  const rItems = train.filter(a => a.cls !== "none" && Array.isArray(a.box) && typeof a.rot === "number");
  console.log(`merged model: ${rItems.length} pictures with a known upright angle`);
  let order = [], pos = 0;
  const batchItems = () => { if (pos >= order.length) { order = shuffle(rItems.slice()); pos = 0; } const b = order.slice(pos, pos + BATCH); pos += BATCH; return b; };
  async function makeBatch(items) {
    const L = items.map(() => Math.floor(rnd() * 4));
    const bufs = await Promise.all(items.map((a, i) => { const [cx, cy, s] = readerCrop(a, true); const j = jitter(false); j.angle = a.rot - 90 * L[i] + between(-8, 8); return view(a.file, cx, cy, s, j); }));
    const y = [tf.oneHot(items.map(a => IDS.indexOf(a.cls)), IDS.length).toFloat(), tf.oneHot(items.map(a => SHELLS.indexOf(shellOf(a.cls))), 4).toFloat(),
      tf.oneHot(items.map(a => MARKS.indexOf(markOf(a.cls))), 3).toFloat(), tf.oneHot(L, 4).toFloat()];
    return { x: toTensor(bufs), y };
  }
  const model = heads(await backbone(), [["id", IDS.length, "softmax"], ["shell", 4, "softmax"], ["mark", 3, "softmax"], ["quarter", 4, "softmax"]]);
  if (INIT !== "none") { const r = await tf.loadLayersModel("file://" + path.resolve(INIT)); copyWeights(r, model); r.dispose(); console.log("started from", path.relative(ROOT, INIT)); }
  const CK = path.join(OUT, "checkpoint"), { epoch: startEp } = await resumeRound(model, CK);
  const baseLayers = model.layers.filter(l => !/_h$|^(id|shell|mark|quarter)$|global_average/.test(l.name));
  const steps = +(process.env.STEPS || Math.ceil(rItems.length / BATCH));
  let opt = tf.train.adam(1e-3);
  for (let ep = startEp; ep < EPOCHS_R; ep++) {
    const warm = ep < 2; baseLayers.forEach(l => l.trainable = !warm);
    if (!warm) { opt.dispose(); opt = tf.train.adam(2.5e-4 * (1 - ep / EPOCHS_R) + 2e-5); }
    let sum = 0, qsum = 0; const t0 = Date.now();
    for (let s = 0; s < steps; s++) {
      const { x, y } = await makeBatch(batchItems());
      let q;
      const cost = opt.minimize(() => { const p = model.apply(x, { training: false }); const ql = xent(p[3], y[3]).mean(); q = ql.dataSync()[0];
        return xent(p[0], y[0]).add(xent(p[1], y[1]).mul(.5)).add(xent(p[2], y[2]).mul(.5)).mean().add(ql.mul(.5)); }, true);
      sum += cost.dataSync()[0]; qsum += q; tf.dispose([x, ...y, cost]);
    }
    console.log(`merged round ${ep + 1}/${EPOCHS_R}: loss ${(sum / steps).toFixed(3)} (which-side-up part ${(qsum / steps).toFixed(3)}) (${Math.round((Date.now() - t0) / 1000)}s)`);
    await saveRound(model, CK, ep + 1);
  }
  await model.save("file://" + path.join(OUT, "merged"));
  console.log(`saved to ${OUT}/merged. Check it: MERGED=1 tools/fair_check.sh <name> ${path.relative(ROOT, path.join(OUT, "merged/model.json"))} app/model6`);
})().catch(e => { console.error(e); process.exit(1); });
