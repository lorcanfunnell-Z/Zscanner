// zScanner evaluator (the engine behind tools/fair_check.sh): runs the reader + chocoprints on photos and scans they
// were never trained on, exactly as the phone does, and reports the answering rules.
//   EVAL_SET=rec  → the held-back recording photos (last quarter of each recording)
//   otherwise     → the held-back test session(s) (training/sessions.json "heldBack", or HOLD_TEST=test-3)
// Options: READER=<reader model.json>  PRINT=<folder with print/ and gallery.json>  DUMP=<file> (raw scores for
//          training/tradeoff.py and holdreplay.py)  NNCHECK=1 (print each scan's single closest gallery reference)
const { fs, path, tf, ROOT, IDS, mk, toTensor } = require("./lib/common.js");
const { view } = require("./lib/view.js");
const { readerCrop, zoomView } = require("./lib/crops.js");
const { loadData } = require("./lib/data.js");
const { combine, printScores } = require("./lib/evaluate.js");

const hold = process.env.HOLD_TEST ? process.env.HOLD_TEST.split(",").filter(Boolean) : undefined;
const { test, heldScans } = loadData({ synth: false, tests: false, hold });

(async () => {
  const PR = path.resolve(process.env.PRINT), reader = await tf.loadLayersModel("file://" + path.resolve(process.env.READER || path.join(ROOT, "app/model4/reader/model.json")));
  const pm = await tf.loadLayersModel("file://" + path.join(PR, "print", "model.json")), gal = JSON.parse(fs.readFileSync(path.join(PR, "gallery.json")));
  const gray = process.env.GRAY ? process.env.GRAY === "1" : !!gal.gray;
  const cache = JSON.parse(fs.readFileSync(path.join(ROOT, "training", "rot-cache.json")));
  const items = process.env.EVAL_SET === "rec" ? test.filter(a => a.cls !== "none" && Array.isArray(a.box)) : heldScans;
  for (const a of items) a.rot = cache[a.file + "|" + a.box];
  const norm = t => t.div(tf.norm(t, 2, -1, true).add(1e-9));
  const rows = [];
  for (let i = 0; i < items.length; i += 16) {
    const b = items.slice(i, i + 16);
    const x1 = toTensor(await Promise.all(b.map(a => { const [cx, cy, s] = readerCrop(a, false); return view(a.file, cx, cy, s); })));
    const p = reader.predict(x1); const [I, SH, MK] = p.map(t => t.arraySync()); tf.dispose([x1, ...p]);
    const x2 = toTensor(await Promise.all(b.map(a => zoomView(a, false, { gray })))); const e = norm(pm.predict(x2)); const E = e.arraySync(); tf.dispose([x2, e]);
    b.forEach((a, j) => {
      const m4 = combine(I[j], SH[j], MK[j]);
      const { byMark, perChocolate: pp } = printScores(E[j], gal.entries);
      const prod = IDS.map((k, n) => m4[n] * pp[n]), ps = prod.reduce((u, w) => u + w, 0);
      if (process.env.NNCHECK) { let best = -2, bl = ""; gal.entries.forEach(([m, v]) => { const s2 = v.reduce((acc, x, k) => acc + x * E[j][k], 0); if (s2 > best) { best = s2; bl = m; } }); console.log("NN", a.cls, bl, best.toFixed(3)); }
      rows.push({ truth: a.cls, m4, pp, both: prod.map(v => v / ps), sim: byMark });
    });
  }
  const top = arr => { const o = arr.map((v, k) => [v, k]).sort((u, w) => w[0] - u[0]); return { k: IDS[o[0][1]], p: o[0][0], gap: o[0][0] - o[1][0] }; };
  for (const [name, f] of [["model 4 alone", r => r.m4], ["chocoprints alone", r => r.pp], ["model 4 x chocoprints", r => r.both]]) {
    const t = rows.map(r => ({ ...top(f(r)), truth: r.truth }));
    console.log(name, JSON.stringify({ right: `${t.filter(x => x.k === x.truth).length}/${t.length}`, mistakes: t.filter(x => x.k !== x.truth).map(x => x.truth + "→" + x.k).join(" ") }));
  }
  const agree = rows.map(r => ({ a: top(r.m4), b: top(r.pp), truth: r.truth })).filter(x => x.a.k === x.b.k || (mk(x.a.k) === "z" && mk(x.b.k) === "z"));
  console.log("agreement rule:", JSON.stringify({ answers: `${agree.length}/${rows.length}`, wrong: agree.filter(x => x.a.k !== x.truth).length }));
  if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify({ ids: IDS, rows: rows.map(r => ({ truth: r.truth, m4: r.m4, pp: r.pp })) }));
})().catch(e => { console.error(e); process.exit(1); });
