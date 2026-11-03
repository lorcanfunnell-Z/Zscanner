// Trial: can a decision made from only THREE signals - chocoprint (vs the real photo gallery), design marks (vs a
// gallery built purely from computer-generated renders of the official designs, see training/build_design_gallery.js),
// and shell logic (the reader's own shell-colour probability for each candidate) - stand in for the full system,
// which also uses the reader's direct "which chocolate" guess (pid)? Reports accuracy, confusion and per-decision
// timing, against either the big synthetic test set or the real held-back sessions.
//
// Usage: READER=<reader model.json> PRINT=<app/model6-style folder> DESIGN_GALLERY=<path from build_design_gallery.js>
//        EVAL_SET=synth SEED=<seed>              (the big synthetic batch)
//     or EVAL_SET=real HOLD_TEST=test-4,test-5,test-6   (the real fair-testing standard)
const { fs, path, tf, ROOT, IDS, SHELLS, shellOf, toTensor } = require("./lib/common.js");
const { readerCrop, zoomView } = require("./lib/crops.js");
const { view } = require("./lib/view.js");
const { loadData, attachRotations } = require("./lib/data.js");
const { printScores } = require("./lib/evaluate.js");
const TOPK = process.env.TOPK ? Number(process.env.TOPK) : 3;

(async () => {
  let items;
  if (process.env.EVAL_SET === "synth") {
    const { train } = loadData({ synth: true, tests: false, quiet: true });
    items = train.filter(a => a.synth);
    if (process.env.SEED) items = items.filter(a => a.name.startsWith(`syn${process.env.SEED}_`));
  } else {
    const hold = process.env.HOLD_TEST ? process.env.HOLD_TEST.split(",").filter(Boolean) : undefined;
    const { heldScans } = loadData({ synth: false, tests: false, hold, quiet: true });
    await attachRotations(heldScans);
    items = heldScans;
  }
  if (!items.length) { console.log("No items found - check EVAL_SET/SEED/HOLD_TEST."); process.exit(1); }
  console.log(`items: ${items.length}`);

  const PR = path.resolve(process.env.PRINT);
  const reader = await tf.loadLayersModel("file://" + path.resolve(process.env.READER));
  const pm = await tf.loadLayersModel("file://" + path.join(PR, "print", "model.json"));
  const gal = JSON.parse(fs.readFileSync(path.join(PR, "gallery.json")));
  const designGal = JSON.parse(fs.readFileSync(path.resolve(process.env.DESIGN_GALLERY)));
  const gray = !!gal.gray;
  const norm = t => t.div(tf.norm(t, 2, -1, true).add(1e-9));

  const rows = [];
  let computeMs = 0, nTimed = 0;
  for (let i = 0; i < items.length; i += 16) {
    const b = items.slice(i, i + 16);
    const t0 = process.hrtime.bigint();
    // reader: only the shell head is used below - the chocolate-id head's own guess (pid) is deliberately ignored
    const x1 = toTensor(await Promise.all(b.map(a => { const [cx, cy, s] = readerCrop(a, false); return view(a.file, cx, cy, s, {}); })));
    const p = reader.predict(x1); const [, SH] = p.map(t => t.arraySync()); tf.dispose([x1, ...p]);
    const x2 = toTensor(await Promise.all(b.map(a => zoomView(a, false, { gray }))));
    const e = norm(pm.predict(x2)); const E = e.arraySync(); tf.dispose([x2, e]);
    const t1 = process.hrtime.bigint();
    computeMs += Number(t1 - t0) / 1e6; nTimed += b.length;
    b.forEach((a, j) => {
      const shellScore = IDS.map(k => SH[j][SHELLS.indexOf(shellOf(k))]);
      const { perChocolate: pp } = printScores(E[j], gal.entries, 20, TOPK);
      const { perChocolate: dp } = printScores(E[j], designGal.entries, 20, TOPK);
      const prod = IDS.map((k, n) => pp[n] * dp[n] * shellScore[n]), ps = prod.reduce((u, w) => u + w, 0) || 1;
      rows.push({ truth: a.cls, combined: prod.map(v => v / ps) });
    });
  }
  const top = arr => { const o = arr.map((v, k) => [v, k]).sort((u, w) => w[0] - u[0]); return { k: IDS[o[0][1]], p: o[0][0] }; };
  const t = rows.map(r => ({ ...top(r.combined), truth: r.truth }));
  const right = t.filter(x => x.k === x.truth).length;
  const conf = {};
  t.filter(x => x.k !== x.truth).forEach(x => { const key = `${x.truth}→${x.k}`; conf[key] = (conf[key] || 0) + 1; });
  console.log(`\n=== three signals only: chocoprint x design-gallery x shell-logic (no reader id) ===`);
  console.log(`right: ${right}/${t.length} (${(100 * right / t.length).toFixed(1)}%)`);
  console.log(`top confusions: ${Object.entries(conf).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `${k}:${n}`).join(" ") || "(none)"}`);
  console.log(`avg compute time per decision (batched reader-shell-pass + chocoprint + design-gallery embed): ${(computeMs / nTimed).toFixed(2)} ms`);
})().catch(e => { console.error(e); process.exit(1); });
