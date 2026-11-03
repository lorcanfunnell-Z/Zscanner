// Builds a "design gallery" - a chocoprint gallery (same format as app/model6/gallery.json) sourced ENTIRELY from
// computer-generated photos of the official designs (training/synth.py), not real reference photos. Lets the
// design marks be compared through the same proven embedding the real chocoprint uses, rather than raw pixels
// (a direct pixel/edge comparison was tried and rejected - see CLAUDE.md, 3 Nov "Lookalike tie-breaker").
//
// Usage: SEED=<synth.py seed, must be different from any seed used for evaluation> node training/build_design_gallery.js <out.json>
const path = require("path");
const { fs, tf, ROOT, IDS, mk, toTensor } = require("./lib/common.js");
const { zoomView } = require("./lib/crops.js");
const { loadData } = require("./lib/data.js");
const SEED = process.env.SEED;
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "experiments", "design-gallery.json"));
if (!SEED) { console.log("Usage: SEED=<seed> node training/build_design_gallery.js <out.json>"); process.exit(1); }

(async () => {
  const { train } = loadData({ synth: true, tests: false, quiet: true });
  const items = train.filter(a => a.synth && a.name.startsWith(`syn${SEED}_`));
  if (!items.length) { console.log("No synthetic items for that seed - generate some first with training/synth.py."); process.exit(1); }
  console.log(`building design gallery from ${items.length} synthetic photos (seed ${SEED})`);

  const PR = path.join(ROOT, "app/model6");
  const pm = await tf.loadLayersModel("file://" + path.join(PR, "print", "model.json"));
  const gal0 = JSON.parse(fs.readFileSync(path.join(PR, "gallery.json")));
  const gray = !!gal0.gray, zoom = gal0.zoom;
  const norm = t => t.div(tf.norm(t, 2, -1, true).add(1e-9));

  const entries = [];
  for (let i = 0; i < items.length; i += 16) {
    const b = items.slice(i, i + 16);
    const x = toTensor(await Promise.all(b.map(a => zoomView(a, false, { gray, zoom }))));
    const e = norm(pm.predict(x)); const E = e.arraySync(); tf.dispose([x, e]);
    b.forEach((a, j) => entries.push([mk(a.cls), E[j].map(v => Math.round(v * 1e3) / 1e3)]));
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ gray, zoom, entries, source: `training/synth.py seed ${SEED}, design-only (no real photos)` }));
  console.log(`wrote ${entries.length} design-gallery entries to ${path.relative(ROOT, OUT)}`);
})().catch(e => { console.error(e); process.exit(1); });
