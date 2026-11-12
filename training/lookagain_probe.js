// "Look again" finder probe on the hand-labelled distance sessions (tests/test-9/10/11) - NO training, nothing written to app/.
//
// The finder is run once on the whole camera square exactly as the app does (stage 1), then again on a zoomed window
// around its own first guess, mapped back to frame coordinates. Several window rules are compared; the one that works
// on BOTH the distance sessions and the held-back close-ups (see lookagain_closeups.js) is "x2-iter": window = 2 x the
// last box, repeated until the box stops shrinking (at most 4 extra looks). 12 Nov 2026 result with the live finder:
// distance 3/17 -> 9/17 (test-9 3/9 -> 9/9; test-10/11 unchanged at 0, since the first look lands on the keyboard there
// and looking again around the wrong place cannot help), close-ups 325/327 -> 325/327, mean overlap 0.775 -> 0.794.
//
// Usage:  node training/lookagain_probe.js                       (the live finder)
//         node training/lookagain_probe.js live=app/model6/finder/model.json other=experiments/x/finder/model.json
// Needs Node 20 (PATH="$HOME/.local/node20/bin:$PATH"). Writes experiments/lookagain-<label>.json (gitignored) for drawing.
const { fs, path, tf, ROOT, at, toTensor } = require("./lib/common.js");
const { view } = require("./lib/view.js");
const { toCorners, iou } = require("./lib/finder_eval.js");
const models = (process.argv.length > 2 ? process.argv.slice(2) : ["live=app/model6/finder/model.json"]).map(s => { const [label, p] = s.split("="); return { label, p: path.resolve(ROOT, p) }; });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const inside = ([cx, cy], [x0, y0, x1, y1]) => cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
// single extra look, window side z (fractions of the frame) from the previous guess g = [obj, cx, cy, size]
const RULES = {
  "x2": g => clamp(2 * Math.max(g[3], .08), .3, 1),
  "x3": g => clamp(3 * Math.max(g[3], .08), .3, 1),
  "fix0.5": () => .5,      // great on test-9, but cuts close-up chocolates in half - see lookagain_closeups.js
  "fix0.35": () => .35,
};
async function predictAll(finder, frames, wins) {   // wins: [cx, cy, z] per frame -> [obj, cx, cy, s] in WINDOW coords
  const x = toTensor(await Promise.all(frames.map((f, i) => view(f.file, wins[i][0], wins[i][1], wins[i][2]))));
  const [po, pb] = tf.tidy(() => finder.predict(x)); const O = po.arraySync(), B = pb.arraySync(); tf.dispose([x, po, pb]);
  return frames.map((_, i) => [O[i][0], B[i][0], B[i][1], B[i][2]]);
}
async function look(finder, frames, guesses, zfn) {   // one extra look around each guess; returns frame-coord guesses
  const wins = guesses.map(g => { const z = zfn(g); return [clamp(g[1], z / 2, 1 - z / 2), clamp(g[2], z / 2, 1 - z / 2), z]; });
  const out = await predictAll(finder, frames, wins);
  return out.map((o, i) => { const [wx, wy, z] = wins[i], [obj, cx, cy, s] = o; return obj < .5 ? guesses[i] : [obj, wx - z / 2 + cx * z, wy - z / 2 + cy * z, s * z]; });
}
(async () => {
  const frames = [];
  for (const s of ["test-9", "test-10", "test-11"]) {
    const truth = JSON.parse(fs.readFileSync(at(`tests/${s}/finder-truth.json`)));
    for (const [rel, box] of Object.entries(truth)) if (!rel.startsWith("_")) frames.push({ sess: s, rel, truth: box, file: at(`tests/${s}/camera/${rel}`) });
  }
  for (const m of models) {
    const finder = await tf.loadLayersModel("file://" + m.p);
    const stage1 = await predictAll(finder, frames, frames.map(() => [.5, .5, 1]));
    const results = { stage1 };
    for (const [name, zfn] of Object.entries(RULES)) results[name] = await look(finder, frames, stage1, zfn);
    for (const k of [2, 2.5, 3]) {   // repeated proportional looks until the box stops shrinking (max 4 extra)
      let cur = stage1;
      for (let it = 0; it < 4; it++) {
        const next = await look(finder, frames, cur, g => clamp(k * Math.max(g[3], .08), .3, 1));
        const moved = next.some((n, i) => Math.abs(n[3] - cur[i][3]) > .1 * cur[i][3]);
        cur = next; if (!moved) break;
      }
      results[`x${k}-iter`] = cur;
    }
    console.log(`\n=== ${m.label} (${path.relative(ROOT, m.p)}) ===`);
    const names = Object.keys(results);
    console.log("frame".padEnd(26) + names.map(n => n.padStart(10)).join(""));
    const tot = {}; for (const n of names) tot[n] = { hit: 0, cin: 0, iouSum: 0, n: 0, bySess: {} };
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]; let row = `${f.sess} ${f.rel}`.padEnd(26);
      for (const n of names) {
        const r = results[n][i], v = f.truth ? iou(toCorners([r[1], r[2], r[3]]), f.truth) : null;
        row += (v === null ? `obj${(100 * r[0]).toFixed(0)}%` : v.toFixed(2) + (v >= .3 ? "*" : " ")).padStart(10);
        if (f.truth) { const t = tot[n]; t.n++; t.iouSum += v; const hit = v >= .3 && r[0] >= .5; if (hit) t.hit++; if (inside([r[1], r[2]], f.truth)) t.cin++;
          t.bySess[f.sess] = t.bySess[f.sess] || { hit: 0, n: 0 }; t.bySess[f.sess].n++; if (hit) t.bySess[f.sess].hit++; }
      }
      console.log(row);
    }
    console.log("hits (IoU>=0.3)".padEnd(26) + names.map(n => `${tot[n].hit}/${tot[n].n}`.padStart(10)).join(""));
    for (const s of ["test-9", "test-10", "test-11"]) console.log(`  ${s}`.padEnd(26) + names.map(n => `${tot[n].bySess[s].hit}/${tot[n].bySess[s].n}`.padStart(10)).join(""));
    console.log("centre inside truth".padEnd(26) + names.map(n => `${tot[n].cin}/${tot[n].n}`.padStart(10)).join(""));
    console.log("mean IoU".padEnd(26) + names.map(n => (tot[n].iouSum / tot[n].n).toFixed(3).padStart(10)).join(""));
    fs.mkdirSync(at("experiments"), { recursive: true }); fs.writeFileSync(at(`experiments/lookagain-${m.label}.json`), JSON.stringify({ frames, results }, null, 1));
    finder.dispose();
  }
})().catch(e => { console.error(e); process.exit(1); });
