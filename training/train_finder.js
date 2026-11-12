// zScanner FINDER trainer - no train_finder.js has ever existed in this repo (confirmed via git log); the finder
// training logic used to exist (training/archive/train2.js, back when one script trained both reader and finder
// together) but was dropped when the reader got its own trainer. This rebuilds just the finder half, following
// train_reader.js's current structure (lib/common.js, lib/models.js, lib/data.js, lib/crops.js) rather than the
// archived script's older, inlined one.
//
// The finder looks at the WHOLE camera square (not a close-up) and says: is there a chocolate, and where
// (obj: 0..1 sigmoid, box: [cx,cy,size] 0..1 sigmoid, all fractions of the square it was shown).
//
// Three kinds of training photo:
//   - real training-photos (via lib/data.js's loadData): a close-up around the chocolate, box in CLOSE-UP fractions.
//     Collect-mode close-ups are ~85% of the camera square, so finderCrop() (lib/crops.js) zooms back OUT to
//     simulate the whole square the finder actually sees, and the box target is recomputed for that zoomed-out crop.
//   - REAL whole-frame photos (training-photos-wide/, filed by tools/ingest_manual_labels.js from the phone's
//     "Manual label" admin tool): a whole camera square with the box drawn on it by hand, box already in
//     WHOLE-FRAME fractions - no zoom-out. These are the ones that matter for the distance/clutter problem,
//     because they are the only pictures in the project taken further back, off the white card, or with real
//     clutter in them (CLAUDE.md, "Reading from further away").
//   - cutpaste composites (tools/cutpaste_finder.js): the synthetic stand-in for the above, same whole-frame
//     shape. Tried at demo scale on 9 Nov and rejected - off by default now that real photos are possible.
// All kinds also get an "aim away" augmentation (train2.js's own idea, kept): sometimes crop away from the known
// chocolate entirely, so the finder also learns "no chocolate here" from an otherwise-positive photo.
//
// Usage:  node training/train_finder.js                      (needs Node 20 for @tensorflow/tfjs-node - see
//                                                               HANDOVER.md "Environment": PATH="$HOME/.local/node20/bin:$PATH")
// Switches: EPOCHS_F=10  WIDE=training-photos-wide (set "" to disable)  OUT=experiments/finder-new  RESUME=1
//           WIDE_REPEAT=4 (how many times each real whole-frame photo is seen per round - there will be far
//                          fewer of them than close-ups, and they are the ones carrying the new information)
//           CUTPASTE="" (the rejected synthetic batch; set a path to put it back in)
//           COMPARE=app/model6/finder/model.json (set "" to skip the old-vs-new eval at the end)
const { fs, path, tf, ROOT, CONFIG, at, between, rnd, shuffle, toTensor } = require("./lib/common.js");
const { view, jitter } = require("./lib/view.js");
const { finderCrop } = require("./lib/crops.js");
const { loadData } = require("./lib/data.js");
const { backbone, heads, saveRound, resumeRound } = require("./lib/models.js");
const { evalWideSessions, evalCloseups, fmt } = require("./lib/finder_eval.js");
const OUT = path.resolve(process.env.OUT || at("experiments/finder-new")), EPOCHS_F = +(process.env.EPOCHS_F || 10), BATCH = 32;
const WIDE = process.env.WIDE === "" ? null : path.resolve(process.env.WIDE || at(CONFIG.photosWide));
const WIDE_REPEAT = +(process.env.WIDE_REPEAT || 4);
const CUTPASTE = process.env.CUTPASTE ? path.resolve(process.env.CUTPASTE) : null;
const COMPARE = process.env.COMPARE === "" ? null : path.resolve(process.env.COMPARE || at("app/model6/finder/model.json"));

// ---- data ----
// Whole-frame photos, real or synthetic: a boxes.json of <chocolate>/<file> -> [x0,y0,x1,y1] or null, with the
// box already in fractions of the whole frame. `full: true` tells makeBatch not to zoom out.
function loadWhole(dir, kind) {
  const bp = dir && path.join(dir, "boxes.json");
  if (!bp || !fs.existsSync(bp)) return [];
  const boxes = JSON.parse(fs.readFileSync(bp));
  return Object.entries(boxes).filter(([, b]) => b !== "skip")
    .map(([rel, box]) => ({ file: path.join(dir, rel), cls: rel.split("/")[0], box, full: true, kind, name: rel }));
}
const { train: realTrain, test: realTest } = loadData({ synth: false, tests: false });
const wide = loadWhole(WIDE, "wide"), cutpaste = loadWhole(CUTPASTE, "cutpaste");
if (!WIDE) console.log("WIDE disabled - no real whole-frame photos in this run");
else if (!wide.length) console.log(`no real whole-frame photos yet at ${path.relative(ROOT, WIDE)} - see training/finder-capture-brief.md for what to shoot, then tools/ingest_manual_labels.js`);
else console.log(`real whole-frame photos: ${wide.length} (${wide.filter(a => a.box).length} with a chocolate, ${wide.filter(a => !a.box).length} "Nothing" shots), each seen ${WIDE_REPEAT}× per round`);
if (cutpaste.length) console.log(`cutpaste composites: ${cutpaste.length} (the 9 Nov approach, rejected - only in this run because CUTPASTE was set)`);
const items = [...realTrain, ...cutpaste];   // realTest stays untouched - the held-back real-photo eval at the end
for (let i = 0; i < WIDE_REPEAT; i++) items.push(...wide);

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

// ---- eval: the shared scorer (lib/finder_eval.js), the same one training/eval_finder.js uses on its own, so
// a retrain's numbers can be compared straight against training/baseline-finder.txt. It scores where the BOX
// lands, not how confident the model sounds - see that file's header for why that distinction is the point. ----
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

  const SESSIONS = ["test-9", "test-11", "test-10"];
  const score = async (m) => ({ close: await evalCloseups(m, realTest), wide: await evalWideSessions(m, SESSIONS) });
  const report = (label, r) => {
    console.log(`\n${label}`);
    console.log(`  held-back close-ups (${realTest.length} photos): ${fmt(r.close)}`);
    for (const s of SESSIONS) if (r.wide[s]) console.log(`  ${s} (distance/clutter, hand-labelled): ${fmt(r.wide[s])}`);
    const on = SESSIONS.reduce((a, s) => a + (r.wide[s]?.onTarget || 0), 0), n = SESSIONS.reduce((a, s) => a + (r.wide[s]?.n || 0), 0);
    console.log(`  all three distance sessions: box on the chocolate ${on}/${n}${n ? ` (${Math.round(100 * on / n)}%)` : ""}`);
    return { on, n };
  };

  const neu = await score(finder);
  const newTotal = report("--- the NEW finder (never trained on any of this) ---", neu);

  if (COMPARE && fs.existsSync(COMPARE)) {
    const old = await tf.loadLayersModel("file://" + COMPARE);
    const oldScore = await score(old); old.dispose();
    const oldTotal = report(`--- the CURRENT live finder (${path.relative(ROOT, COMPARE)}), for comparison ---`, oldScore);
    // The project's own rule: a change is only kept if it doesn't make a held-back result worse. The close-ups
    // matter as much as the distance sessions here - the finder is already 99% on them, and that must not be
    // traded away for distance (exactly how both oblique-angle retrains failed, see CLAUDE.md 3f / 3f-ii).
    const dist = `distance sessions ${oldTotal.on}/${oldTotal.n} -> ${newTotal.on}/${newTotal.n}`;
    const close = `held-back close-ups ${oldScore.close.onTarget}/${oldScore.close.n} -> ${neu.close.onTarget}/${neu.close.n}`;
    const better = newTotal.on > oldTotal.on, keptClose = neu.close.onTarget >= oldScore.close.onTarget;
    console.log(`\nold vs new: ${dist}, ${close}`);
    console.log(better && keptClose ? "A real improvement: better at distance without losing close-ups. Worth keeping - fair-test it properly next."
      : better ? "Better at distance but WORSE on close-ups - that is the trade the project's own rule says not to take."
      : keptClose ? "No better at distance. Per the project's own rule, this doesn't go in."
      : "Worse on both. This doesn't go in.");
  } else if (COMPARE) console.log(`\n(no old finder found at ${path.relative(ROOT, COMPARE)} to compare against)`);
})().catch(e => { console.error(e); process.exit(1); });
