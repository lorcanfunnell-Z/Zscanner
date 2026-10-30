// Gallery health check (29 Oct): the leave-one-out self-check that found the N21/N20 mislabel and the empty-frame
// shot on 28 Oct, made into a standing tool instead of a one-off script. Flags entries, never removes anything
// automatically - the 28 Oct lesson was that a broad automatic removal regressed test-6, so every flag here needs
// a human to actually look at the photo before deciding.
//
// For each reference in the gallery: compare it against every OTHER reference of its own chocolate (not itself),
// and see how closely its own chocolate's "typical" appearance actually matches it. A genuinely bad photo (wrong
// chocolate, empty frame, severe blur/glare/angle) usually scores far below the rest of its own chocolate's references.
//
// Usage:  node tools/audit_gallery.js [model folder, default app/model6] [threshold, default 0.15]
// Best run after any tools/add_to_gallery.js call, to catch problems in what was just added while it's still fresh.
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const MODEL = path.resolve(process.argv[2] || path.join(ROOT, "app/model6"));
const THRESHOLD = process.argv[3] !== undefined ? +process.argv[3] : 0.15;
const gal = JSON.parse(fs.readFileSync(path.join(MODEL, "gallery.json")));

const norm = v => { const n = Math.hypot(...v); return n > 0 ? v.map(x => x / n) : v; };
const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

const byMark = {};
gal.entries.forEach(([m, v], i) => (byMark[m] = byMark[m] || []).push({ i, v: norm(v) }));

const flagged = [];
for (const [mark, items] of Object.entries(byMark)) {
  for (const { i, v } of items) {
    const pool = items.filter(o => o.i !== i).map(o => o.v);
    if (!pool.length) continue;
    const d = pool[0].length;
    const centroid = norm(Array.from({ length: d }, (_, k) => pool.reduce((s, p) => s + p[k], 0) / pool.length));
    const sim = cos(v, centroid);
    if (sim < THRESHOLD) flagged.push({ mark, index: i, sim });
  }
}
flagged.sort((a, b) => a.sim - b.sim);

console.log(`${gal.entries.length} references, ${flagged.length} scoring below ${THRESHOLD} similarity to their own chocolate's typical appearance:\n`);
if (!flagged.length) { console.log("Nothing flagged. (Note: this can't tell a correctly-labelled-but-unusual photo from a genuinely bad one by itself - the N21/N20 mislabel on 28 Oct still needed a human look at the actual photo before being sure.)"); process.exit(0); }

// Best-effort: attribute a flagged entry to the source session that added it, using gallery.sources' running
// counts (sessions are always appended, never inserted - but a session added before any entries were ever removed
// stays attributable; one added after a removal shifted later indices may not be, so this is a best guess, not
// a guarantee). Where that session's own closeup/ folder still exists, trace_prints.js-style recomputation (see
// CLAUDE.md, 29 Oct gallery audit) can pin down the exact photo from there.
let cursor = 0; const ranges = [];
for (const s of gal.sources || []) { if (s.session) { ranges.push({ from: cursor, to: cursor + s.added, session: s.session }); cursor += s.added; } }

for (const f of flagged) {
  const hit = ranges.find(r => f.index >= r.from && f.index < r.to);
  console.log(`  ${f.sim.toFixed(3)}  mark=${f.mark.padEnd(6)} entry #${f.index}${hit ? `  (likely from "${hit.session}")` : "  (from the base trained set, or position has shifted since a removal - can't attribute automatically)"}`);
}
console.log(`\nNothing removed automatically. Look at each flagged photo before deciding - some of what scores low here is a genuinely unusual but correct shot, not a bad one (see CLAUDE.md, 29 Oct gallery audit).`);
