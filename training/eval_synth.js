// Large-scale synthetic stress-test: runs the deployed reader + chocoprints on a big batch of training/synth.py's
// generated photos (known ground truth, known angle - no quarter-model guess needed) and reports accuracy and
// confusion, exactly as eval_combo.js does for real photos.
//
// This is NOT a replacement for real-phone testing (see CLAUDE.md's fair-testing rule: held-back real sessions
// are the standard that decides whether a change is kept). What a big synthetic batch gives that a real session
// can't: real sessions answer each chocolate once or twice a night, so a single wrong answer for N17 could just
// be bad luck; 500 synthetic photos of N17 under many lights/angles/blurs give an actual rate, and 500 photos of
// every OTHER chocolate at the same time turn "is 18/15/23 still a real confusion?" into a checked answer instead
// of a guess from a handful of real scans.
//
// Usage: READER=<reader model.json> PRINT=<chocoprint folder> SEED=<seed used by synth.py> node training/eval_synth.js
// Options: GRAY=0/1 (default: gallery's own), TOPK=<k> (default 3, matches the live app), DUMP=<file>
const { fs, path, tf, ROOT, IDS, toTensor } = require("./lib/common.js");
const { readerCrop, zoomView } = require("./lib/crops.js");
const { view } = require("./lib/view.js");
const { loadData } = require("./lib/data.js");
const { combine, printScores } = require("./lib/evaluate.js");
const TOPK = process.env.TOPK ? Number(process.env.TOPK) : 3;
const SEED = process.env.SEED;

(async () => {
  const { train } = loadData({ synth: true, tests: false, quiet: true });
  let items = train.filter(a => a.synth);
  if (SEED) items = items.filter(a => a.name.startsWith(`syn${SEED}_`));
  if (!items.length) { console.log("No synthetic items found (check training-synth/ and SEED)."); process.exit(1); }
  console.log(`synthetic items: ${items.length}`);

  const PR = path.resolve(process.env.PRINT);
  const reader = await tf.loadLayersModel("file://" + path.resolve(process.env.READER));
  const pm = await tf.loadLayersModel("file://" + path.join(PR, "print", "model.json"));
  const gal = JSON.parse(fs.readFileSync(path.join(PR, "gallery.json")));
  const gray = process.env.GRAY ? process.env.GRAY === "1" : !!gal.gray;
  const norm = t => t.div(tf.norm(t, 2, -1, true).add(1e-9));

  const rows = [];
  for (let i = 0; i < items.length; i += 16) {
    const b = items.slice(i, i + 16);
    const x1 = toTensor(await Promise.all(b.map(a => { const [cx, cy, s] = readerCrop(a, false); return view(a.file, cx, cy, s, {}); })));
    const p = reader.predict(x1); const [I, SH, MK] = p.map(t => t.arraySync()); tf.dispose([x1, ...p]);
    const x2 = toTensor(await Promise.all(b.map(a => zoomView(a, false, { gray }))));
    const e = norm(pm.predict(x2)); const E = e.arraySync(); tf.dispose([x2, e]);
    b.forEach((a, j) => {
      const m4 = combine(I[j], SH[j], MK[j]);
      const { perChocolate: pp } = printScores(E[j], gal.entries, 20, TOPK);
      const prod = IDS.map((k, n) => m4[n] * pp[n]), ps = prod.reduce((u, w) => u + w, 0);
      rows.push({ truth: a.cls, m4, pp, both: prod.map(v => v / ps) });
    });
    if ((i / 16) % 20 === 0) process.stderr.write(`  ${i}/${items.length}\n`);
  }

  const top = arr => { const o = arr.map((v, k) => [v, k]).sort((u, w) => w[0] - u[0]); return { k: IDS[o[0][1]], p: o[0][0], gap: o[0][0] - o[1][0] }; };
  const summarize = (name, f) => {
    const t = rows.map(r => ({ ...top(f(r)), truth: r.truth }));
    const right = t.filter(x => x.k === x.truth).length;
    const conf = {};
    t.filter(x => x.k !== x.truth).forEach(x => { const key = `${x.truth}→${x.k}`; conf[key] = (conf[key] || 0) + 1; });
    const topConfusions = Object.entries(conf).sort((a, b) => b[1] - a[1]).slice(0, 15);
    console.log(`\n=== ${name} ===`);
    console.log(`right: ${right}/${t.length} (${(100 * right / t.length).toFixed(1)}%)`);
    console.log(`top confusions: ${topConfusions.map(([k, n]) => `${k}:${n}`).join(" ") || "(none)"}`);
    return t;
  };
  summarize("reader alone (classifier x shell x mark logic)", r => r.m4);
  summarize("chocoprint alone (vs gallery)", r => r.pp);
  const bothT = summarize("combined (reader x chocoprint) - closest to the live decision", r => r.both);

  // per-chocolate accuracy, combined rule - only meaningful at this sample size (500/class)
  console.log("\n=== per-chocolate accuracy (combined rule) ===");
  for (const k of IDS) {
    const rs = bothT.filter(x => x.truth === k);
    const right = rs.filter(x => x.k === k).length;
    console.log(`${k.padEnd(6)} ${right}/${rs.length} (${(100 * right / rs.length).toFixed(1)}%)`);
  }

  if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify({ ids: IDS, rows: rows.map(r => ({ truth: r.truth, m4: r.m4, pp: r.pp })) }));
})().catch(e => { console.error(e); process.exit(1); });
