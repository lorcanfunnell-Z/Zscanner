// Scoring the finder - shared by training/eval_finder.js (score a finder on its own) and
// training/train_finder.js (old-vs-new after a retrain), so both report the same numbers the same way.
//
// WHY THIS MEASURES THE BOX, NOT JUST THE CONFIDENCE. The finder has two outputs: obj ("is a chocolate in
// this picture?") and box ("where, and how big?"). The 4 Nov distance tests found that at ~50-90cm, or over
// a busy desk, obj stays at ~100% while the box lands on a laptop keyboard or a patch of empty table - so a
// score built on obj alone would call every one of those a success. Every number here is therefore about the
// box: does it overlap the real chocolate (onTarget), is its centre even inside it (centreIn), how far off is
// it (centreErr). "said" is kept separately, only so the gap between "claimed to see one" and "actually
// pointed at it" stays visible - that gap IS the bug.
const { fs, path, tf, at, toTensor } = require("./common.js");
const { view } = require("./view.js");
const { finderCrop } = require("./crops.js");

const IOU_HIT = +(process.env.IOU_HIT || 0.3);   // overlap counted as "the box landed on the chocolate"

// [x0,y0,x1,y1] from the model's [centre x, centre y, side]
const toCorners = ([cx, cy, s]) => [cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2];
function iou(a, b) {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = w * h, union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}
const inside = ([cx, cy], [x0, y0, x1, y1]) => cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;

// one running tally, so every set is scored identically
function tally() {
  const r = { n: 0, said: 0, onTarget: 0, centreIn: 0, iouSum: 0, errSum: 0, noneN: 0, noneOk: 0, worst: [] };
  r.add = (pred, truth, name) => {
    const [po, pbox] = pred;
    if (!truth) { r.noneN++; if (po < .5) r.noneOk++; else r.worst.push({ name, why: `said a chocolate is here (${(100 * po).toFixed(0)}%) when the frame has none` }); return; }
    r.n++;
    if (po >= .5) r.said++;
    const corners = toCorners(pbox), v = iou(corners, truth);
    r.iouSum += v;
    const tc = [(truth[0] + truth[2]) / 2, (truth[1] + truth[3]) / 2];
    r.errSum += Math.hypot(pbox[0] - tc[0], pbox[1] - tc[1]);
    if (inside([pbox[0], pbox[1]], truth)) r.centreIn++;
    if (po >= .5 && v >= IOU_HIT) r.onTarget++;
    else r.worst.push({ name, why: `box ${v < .02 ? "nowhere near" : `only ${(100 * v).toFixed(0)}% overlapping`} the chocolate, but still ${(100 * po).toFixed(0)}% sure` });
  };
  r.done = () => ({
    n: r.n, said: r.said, onTarget: r.onTarget, centreIn: r.centreIn,
    meanIou: r.iouSum / Math.max(1, r.n), centreErr: r.errSum / Math.max(1, r.n),
    noneN: r.noneN, noneOk: r.noneOk, worst: r.worst
  });
  return r;
}

function fmt(s) {
  const pc = (a, b) => `${a}/${b}${b ? ` (${Math.round(100 * a / b)}%)` : ""}`;
  const bits = [];
  if (s.n) bits.push(`box on the chocolate ${pc(s.onTarget, s.n)}`, `centre inside it ${pc(s.centreIn, s.n)}`,
    `said one was there ${pc(s.said, s.n)}`, `mean overlap ${s.meanIou.toFixed(2)}`, `centre off by ${s.centreErr.toFixed(3)}`);
  if (s.noneN) bits.push(`correctly said "nothing" ${pc(s.noneOk, s.noneN)}`);
  return bits.join(", ");
}

// ---- the hand-labelled distance/clutter sessions: whole camera frames, boxes already in whole-frame
// fractions (tests/test-N/finder-truth.json - see CLAUDE.md "Reading from further away") ----
async function evalWideSessions(finder, sessions = ["test-9", "test-10", "test-11"]) {
  const out = {};
  for (const s of sessions) {
    const dir = at(`tests/${s}`), truthFile = path.join(dir, "finder-truth.json");
    if (!fs.existsSync(truthFile)) continue;
    const truth = JSON.parse(fs.readFileSync(truthFile));
    const entries = Object.entries(truth).filter(([k]) => !k.startsWith("_"));
    const t = tally();
    for (let i = 0; i < entries.length; i += 32) {
      const b = entries.slice(i, i + 32);
      const x = toTensor(await Promise.all(b.map(([rel]) => view(path.join(dir, "camera", rel), .5, .5, 1))));
      const [po, pb] = tf.tidy(() => finder.predict(x)); const O = po.arraySync(), B = pb.arraySync(); tf.dispose([x, po, pb]);
      b.forEach(([rel, box], k) => t.add([O[k][0], B[k]], box, `${s} ${rel}`));
    }
    out[s] = t.done();
  }
  return out;
}

// ---- the held-back real close-ups (loadData's own last-25%-of-each-recording split). These are close-ups,
// so finderCrop zooms back out to simulate the whole camera square, and the target box moves with it. ----
async function evalCloseups(finder, testItems) {
  const t = tally(), z = 1 / 0.85, shift = v => (v - (.5 - z / 2)) / z;
  for (let i = 0; i < testItems.length; i += 32) {
    const b = testItems.slice(i, i + 32);
    const x = toTensor(await Promise.all(b.map(a => { const [cx, cy, zz] = finderCrop(a, false); return view(a.file, cx, cy, zz); })));
    const [po, pb] = tf.tidy(() => finder.predict(x)); const O = po.arraySync(), B = pb.arraySync(); tf.dispose([x, po, pb]);
    b.forEach((a, k) => t.add([O[k][0], B[k]], a.box ? a.box.map(shift) : null, a.cls + "/" + a.name));
  }
  return t.done();
}

module.exports = { evalWideSessions, evalCloseups, fmt, iou, toCorners, IOU_HIT };
