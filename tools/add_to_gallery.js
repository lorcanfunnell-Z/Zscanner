// Adaptation (like Face ID updating itself): adds the labelled close-ups from a test session or a reference round to the
// chocoprint gallery, so the scanner gets better at those places and lights without retraining.
//
// Usage:  node tools/add_to_gallery.js <folder with closeup/<chocolate>/*.jpg> [model folder, default app/model6]
//         e.g. node tools/add_to_gallery.js tests/test-3      or      node tools/add_to_gallery.js reference/round-1
//
// SAFEGUARD (fair testing): training/sessions.json lists the test sessions held back as the fair check. A held-back
// session can only be added once another session has taken its place, so there is always one the scanner has never seen.
// Each close-up goes through the same steps as the phone: straighten (edge maths) → which side is up → zoom on the number
// → black and white → chocoprint. Afterwards, run tools/fair_check.sh to confirm nothing got worse.
const { fs, path, tf, ROOT, S, IDS, mk, toGray, toTensor } = require("../training/lib/common.js");
const sharp = require("sharp");
const { edgeAngle } = require("../training/align_lib.js");
const SRC = path.resolve(process.argv[2] || ""), MODEL = path.resolve(process.argv[3] || path.join(ROOT, "app/model6"));
const SESS = path.join(ROOT, "training/sessions.json");
if (!process.argv[2] || !fs.existsSync(path.join(SRC, "closeup"))) { console.log("Give a folder that contains closeup/<chocolate>/*.jpg"); process.exit(1); }
const sessions = fs.existsSync(SESS) ? JSON.parse(fs.readFileSync(SESS)) : { heldBack: ["test-3"], inGallery: [] };
const name = path.basename(SRC);
if (sessions.inGallery.includes(name)) { console.log(`${name} is already in the gallery.`); process.exit(1); }
if (sessions.heldBack.includes(name)) {
  if (sessions.heldBack.length < 2) {
    console.log(`REFUSED: ${name} is the only held-back test session (the fair check). Add it after a newer test session has been ` +
      `held back in its place: edit training/sessions.json, e.g. "heldBack": ["test-4", "${name}"].`); process.exit(1);
  }
  sessions.heldBack = sessions.heldBack.filter(s => s !== name);
}
const VALID = new Set(IDS);

// turn a 224 close-up clockwise by `deg` about its centre (mirror-padded so the corners stay filled), keep the middle `frac`
async function turnCrop(buf, deg, frac) {
  const big = await sharp(buf, { raw: { width: S, height: S, channels: 3 } }).extend({ top: S / 2, bottom: S / 2, left: S / 2, right: S / 2, extendWith: "mirror" })
    .rotate(deg, { background: "#808080" }).raw().toBuffer({ resolveWithObject: true });
  const side = Math.round(S * frac), left = Math.round((big.info.width - side) / 2), top = Math.round((big.info.height - side) / 2);
  return sharp(big.data, { raw: big.info }).extract({ left, top, width: side, height: side }).resize(S, S).removeAlpha().raw().toBuffer();
}
const tensor = toTensor;

(async () => {
  const quarter = await tf.loadLayersModel("file://" + path.join(MODEL, "quarter/model.json"));
  const printer = await tf.loadLayersModel("file://" + path.join(MODEL, "print/model.json"));
  const gpath = path.join(MODEL, "gallery.json"), gal = JSON.parse(fs.readFileSync(gpath));
  const items = [];
  for (const k of fs.readdirSync(path.join(SRC, "closeup"))) {
    if (!VALID.has(k)) continue;                               // skips "unlabelled" and anything unknown
    for (const f of fs.readdirSync(path.join(SRC, "closeup", k))) if (/\.jpe?g$/i.test(f)) items.push({ k, file: path.join(SRC, "closeup", k, f) });
  }
  if (!items.length) { console.log("No labelled close-ups found."); process.exit(1); }
  const added = {};
  for (let i = 0; i < items.length; i += 16) {
    const b = items.slice(i, i + 16);
    const raws = await Promise.all(b.map(a => sharp(a.file).resize(S, S).removeAlpha().raw().toBuffer()));
    const es = raws.map(r => edgeAngle(new Uint8Array(r), S).angle);
    const sq = tensor(await Promise.all(raws.map((r, j) => turnCrop(r, -es[j], 1))));
    const pq = quarter.predict(sq).arraySync(); sq.dispose();
    const rots = pq.map((p, j) => -es[j] + 90 * p.indexOf(Math.max(...p)));
    const x = tensor(await Promise.all(raws.map((r, j) => turnCrop(r, rots[j], gal.zoom).then(gal.gray ? toGray : v => v))));
    const e = tf.tidy(() => { const v = printer.predict(x); return v.div(tf.norm(v, 2, -1, true).add(1e-9)); }); const E = e.arraySync(); tf.dispose([x, e]);
    b.forEach((a, j) => { gal.entries.push([mk(a.k), E[j].map(v => Math.round(v * 1e3) / 1e3)]); added[mk(a.k)] = (added[mk(a.k)] || 0) + 1; });
  }
  fs.mkdirSync(path.join(ROOT, "experiments"), { recursive: true });
  fs.copyFileSync(gpath, path.join(ROOT, "experiments", `gallery-before-${name}.json`));   // easy to undo
  gal.sources = [...(gal.sources || []), { session: name, added: items.length, date: new Date().toISOString().slice(0, 10) }];
  fs.writeFileSync(gpath, JSON.stringify(gal));
  sessions.inGallery.push(name); fs.writeFileSync(SESS, JSON.stringify(sessions, null, 2));
  console.log(`Added ${items.length} references from ${name} to ${path.relative(ROOT, gpath)}: ` + Object.entries(added).map(([m, n]) => `${m}:${n}`).join(" "));
  console.log(`Gallery now holds ${gal.entries.length} references. Held back as the fair check: ${sessions.heldBack.join(", ")}.`);
  console.log(`Next: tools/fair_check.sh after-${name} app/model6/reader/model.json ${path.relative(ROOT, MODEL)}`);
})().catch(e => { console.error(e); process.exit(1); });
