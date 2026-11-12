// Safety half of the "look again" finder probe: on the 339 held-back close-ups, does a second look around the first
// guess ever make an already-good box worse? Stage 1 mirrors training/lib/finder_eval.js evalCloseups exactly.
// 12 Nov 2026 result with the live finder: stage 1 325/327 (mean overlap 0.775); x2-iter 325/327 (0.794, no lost hits,
// 12 photos more than 0.1 worse, 35 more than 0.1 better); fix0.5 and fix0.35 are clearly harmful here (0.694 / 240/327)
// because a close-up chocolate already fills about a third of the view and a small fixed window cuts it.
//
// Usage:  node training/lookagain_closeups.js [path/to/finder/model.json]     (default: the live finder)
// Needs Node 20 (PATH="$HOME/.local/node20/bin:$PATH").
const { fs, path, tf, ROOT, at, toTensor } = require("./lib/common.js");
const { view } = require("./lib/view.js");
const { finderCrop } = require("./lib/crops.js");
const { loadData } = require("./lib/data.js");
const { toCorners, iou } = require("./lib/finder_eval.js");
const MODEL = path.resolve(ROOT, process.argv[2] || "app/model6/finder/model.json");
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const RULES = {
  "x2": g => clamp(2 * Math.max(g[3], .08), .3, 1),
  "x3": g => clamp(3 * Math.max(g[3], .08), .3, 1),
  "fix0.5": () => .5,
  "fix0.35": () => .35,
};
(async () => {
  const finder = await tf.loadLayersModel("file://" + MODEL);
  const { test } = loadData({ synth: false, tests: false, quiet: true });
  // each item: the simulated camera square is the source crop [cx_s, cy_s, zz] (finderCrop, no aug); truth in square coords
  const Z = 1 / 0.85, shift = v => (v - (.5 - Z / 2)) / Z;
  const items = test.map(a => { const [cx, cy, zz] = finderCrop(a, false); return { a, sq: [cx, cy, zz], truth: a.box ? a.box.map(shift) : null }; });
  async function predict(wins) {   // wins in SQUARE coords [wx, wy, z] -> [obj, cx, cy, s] in window coords
    const out = [];
    for (let i = 0; i < items.length; i += 32) {
      const b = items.slice(i, i + 32), w = wins.slice(i, i + 32);
      const x = toTensor(await Promise.all(b.map((it, k) => { const [sx, sy, zz] = it.sq, [wx, wy, z] = w[k]; return view(it.a.file, sx - zz / 2 + wx * zz, sy - zz / 2 + wy * zz, z * zz); })));
      const [po, pb] = tf.tidy(() => finder.predict(x)); const O = po.arraySync(), B = pb.arraySync(); tf.dispose([x, po, pb]);
      b.forEach((_, k) => out.push([O[k][0], B[k][0], B[k][1], B[k][2]]));
    }
    return out;
  }
  async function look(guesses, zfn) {
    const wins = guesses.map(g => { const z = zfn(g); return [clamp(g[1], z / 2, 1 - z / 2), clamp(g[2], z / 2, 1 - z / 2), z]; });
    const out = await predict(wins);
    return out.map((o, i) => { const [wx, wy, z] = wins[i], [obj, cx, cy, s] = o; return obj < .5 ? guesses[i] : [obj, wx - z / 2 + cx * z, wy - z / 2 + cy * z, s * z]; });
  }
  const stage1 = await predict(items.map(() => [.5, .5, 1]));
  const results = { stage1 };
  for (const [name, zfn] of Object.entries(RULES)) results[name] = await look(stage1, zfn);
  for (const k of [2, 2.5, 3]) {   // repeated proportional looks, per photo until that photo's box stops shrinking (max 4 extra)
    let cur = stage1.slice(), active = items.map(() => true);
    for (let it = 0; it < 4; it++) {
      if (!active.some(Boolean)) break;
      const next = await look(cur, g => clamp(k * Math.max(g[3], .08), .3, 1));
      next.forEach((n, i) => { if (!active[i]) return; if (Math.abs(n[3] - cur[i][3]) <= .1 * cur[i][3]) active[i] = false; cur[i] = n; });
    }
    results[`x${k}-iter`] = cur;
  }
  console.log(`close-ups: ${items.length} photos (${items.filter(i => i.truth).length} with a chocolate), finder ${path.relative(ROOT, MODEL)}`);
  console.log("rule".padEnd(16) + "hit(IoU>=.3)".padStart(14) + "mean IoU".padStart(10) + "none ok".padStart(9) + "worse>.1".padStart(10) + "better>.1".padStart(10) + "  lost hits");
  const base = results.stage1.map((r, i) => items[i].truth ? iou(toCorners([r[1], r[2], r[3]]), items[i].truth) : null);
  for (const n of Object.keys(results)) {
    let hit = 0, nn = 0, sum = 0, noneOk = 0, noneN = 0, worse = 0, better = 0; const lost = [];
    results[n].forEach((r, i) => {
      const t = items[i].truth;
      if (!t) { noneN++; if (r[0] < .5) noneOk++; return; }
      const v = iou(toCorners([r[1], r[2], r[3]]), t); nn++; sum += v; if (v >= .3 && r[0] >= .5) hit++;
      if (v < base[i] - .1) worse++; if (v > base[i] + .1) better++;
      if (base[i] >= .3 && v < .3) lost.push(`${items[i].a.cls}/${items[i].a.name} ${base[i].toFixed(2)}->${v.toFixed(2)}`);
    });
    console.log(n.padEnd(16) + `${hit}/${nn}`.padStart(14) + (sum / nn).toFixed(3).padStart(10) + `${noneOk}/${noneN}`.padStart(9) + String(worse).padStart(10) + String(better).padStart(10) + "  " + lost.slice(0, 4).join(", ") + (lost.length > 4 ? ` +${lost.length - 4}` : ""));
  }
  finder.dispose();
})().catch(e => { console.error(e); process.exit(1); });
