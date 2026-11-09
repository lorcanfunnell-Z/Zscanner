// zScanner FINDER trainer - no train_finder.js has ever existed in this repo (confirmed via git log); the finder
// training logic used to exist (training/archive/train2.js, back when one script trained both reader and finder
// together) but was dropped when the reader got its own trainer. This rebuilds just the finder half, following
// train_reader.js's current structure (lib/common.js, lib/models.js, lib/data.js, lib/crops.js) rather than the
// archived script's older, inlined one.
//
// The finder looks at the WHOLE camera square (not a close-up) and says: is there a chocolate, and where
// (obj: 0..1 sigmoid, box: [cx,cy,size] 0..1 sigmoid, all fractions of the square it was shown).
//
// Two kinds of training photo:
//   - real training-photos (via lib/data.js's loadData): a close-up around the chocolate, box in CLOSE-UP fractions.
//     Collect-mode close-ups are ~85% of the camera square, so finderCrop() (lib/crops.js) zooms back OUT to
//     simulate the whole square the finder actually sees, and the box target is recomputed for that zoomed-out crop.
//   - cutpaste composites (tools/cutpaste_finder.js): already a whole 640x640 "camera view" with the chocolate
//     pasted on a real, non-white-card background, box already in WHOLE-FRAME fractions - no zoom-out needed.
// Both kinds also get an "aim away" augmentation (train2.js's own idea, kept): sometimes crop away from the known
// chocolate entirely, so the finder also learns "no chocolate here" from an otherwise-positive photo.
//
// Usage:  node training/train_finder.js                      (needs Node 20 for @tensorflow/tfjs-node - see
//                                                               HANDOVER.md "Environment": PATH="$HOME/.local/node20/bin:$PATH")
// Switches: EPOCHS_F=10  CUTPASTE=experiments/cutpaste-finder (set "" to disable)  OUT=experiments/finder-new  RESUME=1
//           COMPARE=app/model6/finder/model.json (set "" to skip the old-vs-new eval at the end)
const { fs, path, tf, ROOT, at, between, rnd, shuffle, toTensor } = require("./lib/common.js");
const { view, jitter } = require("./lib/view.js");
const { finderCrop } = require("./lib/crops.js");
const { loadData } = require("./lib/data.js");
const { backbone, heads, saveRound, resumeRound } = require("./lib/models.js");
const flag = (k, d) => process.env[k] === undefined ? d : process.env[k] === "1";
const OUT = path.resolve(process.env.OUT || at("experiments/finder-new")), EPOCHS_F = +(process.env.EPOCHS_F || 10), BATCH = 32;
const CUTPASTE = process.env.CUTPASTE === "" ? null : path.resolve(process.env.CUTPASTE || at("experiments/cutpaste-finder"));
const COMPARE = process.env.COMPARE === "" ? null : path.resolve(process.env.COMPARE || at("app/model6/finder/model.json"));

// ---- data: real training-photos (close-ups, needing the finderCrop zoom-out) + cutpaste composites (already
// whole-frame, box as-is) ----
function loadCutpaste(dir) {
  const bp = dir && path.join(dir, "boxes.json");
  if (!bp || !fs.existsSync(bp)) { console.log(dir ? `no cutpaste batch found at ${path.relative(ROOT, dir)} - training on real photos only` : "CUTPASTE disabled - training on real photos only"); return []; }
  const boxes = JSON.parse(fs.readFileSync(bp));
  return Object.entries(boxes).map(([rel, box]) => ({ file: path.join(dir, rel), cls: "cutpaste", box, full: true, name: rel }));
}
const { train: realTrain, test: realTest } = loadData({ synth: false, tests: false });
const cutpaste = loadCutpaste(CUTPASTE);
console.log(`cutpaste composites: ${cutpaste.length} (${cutpaste.filter(a => a.box).length} with a chocolate, ${cutpaste.filter(a => !a.box).length} pure background)`);
const items = [...realTrain, ...cutpaste];   // realTest stays untouched - the held-back real-photo eval at the end

// crop window [cx,cy,size] (fractions of the SOURCE file) the finder is shown, for one item
function cropFor(a, aug) { return a.full ? [0.5 + (aug ? between(-.15, .15) : 0), 0.5 + (aug ? between(-.15, .15) : 0), aug ? between(.8, 1.3) : 1] : finderCrop(a, aug); }

async function makeBatch(batch, aug) {
  const bufs = [], yo = [], yb = [];
  for (const a of batch) {
    let [cx, cy, z] = cropFor(a, aug);
    const away = aug && a.box && rnd() < .12;   // sometimes look away from the known chocolate on purpose
    if (away) { z = between(.3, .5); const bx = (a.box[0] + a.box[2]) / 2; cx = bx < .5 ? between(.72, .88) : between(.12, .28); cy = between(.18, .82); }
    const j = aug ? { ...jitter(false), angle: 0 } : {};   // the camera square itself doesn't rotate - only the chocolate's framing varies
    bufs.push(view(a.file, cx, cy, z, j));
    let obj = 0, t = [.5, .5, .3];
    if (a.box) {
      const [x0, y0, x1, y1] = a.box, bx = (x0 + x1) / 2, by = (y0 + y1) / 2, bs = Math.max(x1 - x0, y1 - y0);
      const rx = (bx - (cx - z / 2)) / z, ry = (by - (cy - z / 2)) / z, rs = bs / z;
      if (rx > .05 && rx < .95 && ry > .05 && ry < .95) { obj = 1; t = [rx, ry, Math.min(1, rs)]; }
    }
    yo.push([obj]); yb.push(t);
  }
  return { x: toTensor(await Promise.all(bufs)), y: [tf.tensor2d(yo), tf.tensor2d(yb)] };
}

// ---- eval: real held-back close-ups (loadData's own 25% split) + the hand-labelled distance/clutter sessions
// (tests/test-9/10/11 - never trained on, see CLAUDE.md "Reading from further away") ----
async function evalCloseups(finder, testItems) {
  let hit = 0, n = 0, noneOk = 0, noneN = 0, errSum = 0, errN = 0;
  for (let i = 0; i < testItems.length; i += 32) {
    const b = testItems.slice(i, i + 32);
    const x = toTensor(await Promise.all(b.map(a => { const [cx, cy, z] = finderCrop(a, false); return view(a.file, cx, cy, z); })));
    const [po, pb] = tf.tidy(() => finder.predict(x)); const O = po.arraySync(), B = pb.arraySync(); tf.dispose([x, po, pb]);
    b.forEach((a, k) => {
      if (!a.box) { noneN++; if (O[k][0] < .5) noneOk++; return; }
      n++; if (O[k][0] >= .5) hit++;
      const [x0, y0, x1, y1] = a.box, z = 1 / 0.85, tx = ((x0 + x1) / 2 - (.5 - z / 2)) / z, ty = ((y0 + y1) / 2 - (.5 - z / 2)) / z;
      errSum += Math.hypot(B[k][0] - tx, B[k][1] - ty); errN++;
    });
  }
  return { hitRate: hit / Math.max(1, n), n, noneRate: noneOk / Math.max(1, noneN), noneN, centreErr: errSum / Math.max(1, errN) };
}
async function evalDistanceSessions(finder, sessions) {
  const out = {};
  for (const s of sessions) {
    const dir = at(`tests/${s}`), truthFile = path.join(dir, "finder-truth.json");
    if (!fs.existsSync(truthFile)) continue;
    const truth = JSON.parse(fs.readFileSync(truthFile));
    let hit = 0, n = 0, noneOk = 0, noneN = 0, errSum = 0, errN = 0;
    const entries = Object.entries(truth).filter(([k]) => !k.startsWith("_"));
    for (let i = 0; i < entries.length; i += 32) {
      const b = entries.slice(i, i + 32);
      const x = toTensor(await Promise.all(b.map(([rel]) => view(path.join(dir, "camera", rel), .5, .5, 1))));
      const [po, pb] = tf.tidy(() => finder.predict(x)); const O = po.arraySync(), B = pb.arraySync(); tf.dispose([x, po, pb]);
      b.forEach(([rel, box], k) => {
        if (!box) { noneN++; if (O[k][0] < .5) noneOk++; return; }
        n++; if (O[k][0] >= .5) hit++;
        const [x0, y0, x1, y1] = box, tx = (x0 + x1) / 2, ty = (y0 + y1) / 2;
        errSum += Math.hypot(B[k][0] - tx, B[k][1] - ty); errN++;
      });
    }
    out[s] = { hitRate: hit / Math.max(1, n), n, noneRate: noneOk / Math.max(1, noneN), noneN, centreErr: errSum / Math.max(1, errN) };
  }
  return out;
}
function fmt(r) { return `found chocolate ${(100 * r.hitRate).toFixed(0)}% of ${r.n}, centre error ${r.centreErr.toFixed(3)}` + (r.noneN ? `, correctly said "none" ${(100 * r.noneRate).toFixed(0)}% of ${r.noneN}` : ""); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const finder = heads(await backbone(), [["obj", 1, "sigmoid"], ["box", 3, "sigmoid"]]);
  const CK = path.join(OUT, "checkpoint"), { epoch: startEp } = await resumeRound(finder, CK);
  const baseLayers = finder.layers.filter(l => !/_h$|^(obj|box)$|global_average/.test(l.name));
  const steps = +(process.env.STEPS || Math.ceil(items.length / BATCH));
  let opt = tf.train.adam(1e-3);
  for (let ep = startEp; ep < EPOCHS_F; ep++) {
    const warm = ep < 2; baseLayers.forEach(l => l.trainable = !warm);
    if (!warm) { opt.dispose(); opt = tf.train.adam(2.5e-4 * (1 - ep / EPOCHS_F) + 2e-5); }
    const order = shuffle(items.slice()); let sum = 0; const t0 = Date.now();
    for (let s = 0; s < steps; s++) {
      const { x, y } = await makeBatch(order.slice(s * BATCH, s * BATCH + BATCH), true);
      const cost = opt.minimize(() => {
        const p = finder.apply(x, { training: false });
        const bce = tf.neg(tf.mean(tf.add(tf.mul(y[0], tf.log(tf.clipByValue(p[0], 1e-7, 1))), tf.mul(tf.sub(1, y[0]), tf.log(tf.clipByValue(tf.sub(1, p[0]), 1e-7, 1))))));
        const boxErr = tf.mean(tf.sum(tf.mul(tf.square(tf.sub(p[1], y[1])), y[0]), 1)).mul(20);
        return bce.add(boxErr);
      }, true);
      sum += cost.dataSync()[0]; tf.dispose([x, ...y, cost]);
    }
    console.log(`finder round ${ep + 1}/${EPOCHS_F}: loss ${(sum / steps).toFixed(3)} (${Math.round((Date.now() - t0) / 1000)}s)`);
    await saveRound(finder, CK, ep + 1);
  }
  await finder.save("file://" + path.join(OUT, "finder"));
  console.log(`\nsaved to ${path.relative(ROOT, OUT)}/finder (NOT app/model6 - nothing the live app loads was touched)`);

  console.log(`\n--- evaluating the new finder (never trained on any of this) ---`);
  const closeups = await evalCloseups(finder, realTest);
  console.log(`real held-back close-ups (${realTest.length} photos, last 25% of each recording): ${fmt(closeups)}`);
  const distance = await evalDistanceSessions(finder, ["test-9", "test-10", "test-11"]);
  for (const [s, r] of Object.entries(distance)) console.log(`${s} (distance/clutter, hand-labelled, never trained on): ${fmt(r)}`);

  if (COMPARE && fs.existsSync(COMPARE)) {
    console.log(`\n--- same eval, the CURRENT live finder (${path.relative(ROOT, COMPARE)}), for an old-vs-new comparison ---`);
    const old = await tf.loadLayersModel("file://" + COMPARE);
    console.log(`real held-back close-ups: ${fmt(await evalCloseups(old, realTest))}`);
    const oldDistance = await evalDistanceSessions(old, ["test-9", "test-10", "test-11"]);
    for (const [s, r] of Object.entries(oldDistance)) console.log(`${s}: ${fmt(r)}`);
    old.dispose();
  } else if (COMPARE) console.log(`\n(no old finder found at ${path.relative(ROOT, COMPARE)} to compare against)`);
})().catch(e => { console.error(e); process.exit(1); });
