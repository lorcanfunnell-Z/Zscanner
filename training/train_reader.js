// zScanner READER trainer: looks at the close-up of the chocolate and gives three opinions — which chocolate (28),
// which shell (dark / milk / white / milk+white) and which mark (one digit / two digits / Z). The app multiplies them
// (the "logic step"), so all three must agree.
//
// Defaults = the model 4 recipe (the reader in use): generated images + the non-held test scans (mistakes ×4),
// every rotation and lighting variation. Usage:  OUT=/path node training/train_reader.js
// Experiments (both were tried in Stage 4 and REJECTED by the fair check, kept as switches):
//   HARDPAIRS=1  half of each batch = lookalike pairs from training/hard-pairs.json
//   GRAYP=0.5    colour drop-out: that share of photos in black and white, without the shell question
// Other switches: SYNTH=0  TESTS=0  EPOCHS_R=14  HOLD_TEST=test-3 (default: training/sessions.json)  RESUME=1
const { fs, path, tf, ROOT, at, IDS, SHELLS, MARKS, shellOf, markOf, rnd, shuffle, toTensor, toGray } = require("./lib/common.js");
const { view, jitter } = require("./lib/view.js");
const { readerCrop } = require("./lib/crops.js");
const { loadData } = require("./lib/data.js");
const { backbone, heads, saveRound, resumeRound } = require("./lib/models.js");
const flag = (k, d) => process.env[k] === undefined ? d : process.env[k] === "1";
const OUT = path.resolve(process.env.OUT || at("experiments/reader-new")), EPOCHS_R = +(process.env.EPOCHS_R || 14), BATCH = 32;
const HARDPAIRS = flag("HARDPAIRS", false), GRAYP = +(process.env.GRAYP || 0);
const hold = process.env.HOLD_TEST ? process.env.HOLD_TEST.split(",").filter(Boolean) : undefined;
const { train } = loadData({ synth: flag("SYNTH", true), tests: flag("TESTS", true), hold });
const HARD = HARDPAIRS ? JSON.parse(fs.readFileSync(at("training/hard-pairs.json"))) : [];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const xent = (p, y) => tf.neg(tf.sum(tf.mul(y, tf.log(tf.clipByValue(p, 1e-7, 1))), 1));
  const rItems = train.filter(a => a.cls !== "none" && Array.isArray(a.box));
  const byCls = {}; for (const a of rItems) (byCls[a.cls] = byCls[a.cls] || []).push(a);
  const pickOf = c => { const l = c === "z" ? ["zdark", "zmilk", "zwhite"].flatMap(k => byCls[k] || []) : byCls[c] || []; return l[Math.floor(rnd() * l.length)]; };
  const wsum = HARD.reduce((s, h) => s + h[2], 0);
  const pickPair = () => { let r = rnd() * wsum; for (const h of HARD) { r -= h[2]; if (r <= 0) return h; } return HARD[0]; };
  let order = [], pos = 0;
  function batchItems() {
    if (!HARDPAIRS) { if (pos >= order.length) { order = shuffle(rItems.slice()); pos = 0; } const b = order.slice(pos, pos + BATCH); pos += BATCH; return b; }
    const out = [];
    while (out.length < BATCH / 2) { const [a, b] = pickPair(); out.push(pickOf(a), pickOf(a), pickOf(b), pickOf(b)); }
    while (out.length < BATCH) out.push(rItems[Math.floor(rnd() * rItems.length)]);
    return out.filter(Boolean);
  }
  async function makeBatch(items, aug) {
    const gray = items.map(() => aug && GRAYP > 0 && rnd() < GRAYP);
    const bufs = await Promise.all(items.map((a, i) => { const [cx, cy, s] = readerCrop(a, aug); const v = view(a.file, cx, cy, s, aug ? jitter(false) : {}); return gray[i] ? v.then(toGray) : v; }));
    const y = [tf.oneHot(items.map(a => IDS.indexOf(a.cls)), IDS.length).toFloat(), tf.oneHot(items.map(a => SHELLS.indexOf(shellOf(a.cls))), 4).toFloat(),
      tf.oneHot(items.map(a => MARKS.indexOf(markOf(a.cls))), 3).toFloat(), tf.tensor1d(gray.map(g => g ? 0 : 1))];
    return { x: toTensor(bufs), y };
  }
  const reader = heads(await backbone(), [["id", IDS.length, "softmax"], ["shell", 4, "softmax"], ["mark", 3, "softmax"]]);
  const CK = path.join(OUT, "checkpoint"), { epoch: startEp } = await resumeRound(reader, CK);
  const baseLayers = reader.layers.filter(l => !/_h$|^(id|shell|mark)$|global_average/.test(l.name));
  const steps = +(process.env.STEPS || Math.ceil(rItems.length / BATCH));
  let opt = tf.train.adam(1e-3);
  for (let ep = startEp; ep < EPOCHS_R; ep++) {
    const warm = ep < 2; baseLayers.forEach(l => l.trainable = !warm);   // first 2 rounds: only the new heads learn
    if (!warm) { opt.dispose(); opt = tf.train.adam(2.5e-4 * (1 - ep / EPOCHS_R) + 2e-5); }
    let sum = 0; const t0 = Date.now();
    for (let s = 0; s < steps; s++) {
      const { x, y } = await makeBatch(batchItems(), true);
      const cost = opt.minimize(() => { const p = reader.apply(x, { training: false });
        return xent(p[0], y[0]).add(xent(p[1], y[1]).mul(y[3]).mul(.5)).add(xent(p[2], y[2]).mul(.5)).mean(); }, true);
      sum += cost.dataSync()[0]; tf.dispose([x, ...y, cost]);
    }
    console.log(`reader round ${ep + 1}/${EPOCHS_R}: loss ${(sum / steps).toFixed(3)} (${Math.round((Date.now() - t0) / 1000)}s)`);
    await saveRound(reader, CK, ep + 1);
  }
  await reader.save("file://" + path.join(OUT, "reader"));
  console.log(`saved to ${OUT}. Check it: tools/fair_check.sh <name> ${path.relative(ROOT, path.join(OUT, "reader/model.json"))} app/model6`);
})().catch(e => { console.error(e); process.exit(1); });
