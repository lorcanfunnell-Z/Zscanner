// Loading the photos, generated images and test scans, with the fair split:
//   - the last quarter of each recording is held back (never trained on)
//   - test sessions listed in training/sessions.json "heldBack" are never trained on (the fair check)
const { fs, path, tf, ROOT, CONFIG, IDS, S, at, toTensor } = require("./common.js");
const { view } = require("./view.js");
const { readerCrop } = require("./crops.js");
const { edgeAngle } = require("../align_lib.js");

const sessions = () => fs.existsSync(at(CONFIG.sessions)) ? JSON.parse(fs.readFileSync(at(CONFIG.sessions))) : { heldBack: [], inGallery: [] };

// opts: { synth: bool, tests: bool (train on non-held test scans), hold: [session names] (default: sessions.json), onlyTest, quiet }
function loadData(opts = {}) {
  const HOLD = opts.hold || sessions().heldBack;
  const P = at(CONFIG.photos), boxes = JSON.parse(fs.readFileSync(path.join(P, "boxes.json")));
  const all = [];
  for (const [rel, box] of Object.entries(boxes)) {
    if (box === "skip") continue;
    const [cls, file] = rel.split("/");
    all.push({ file: path.join(P, rel), cls, box, cam: /^cam2?_/.test(file), name: file });
  }
  const train = [], test = [];
  for (const cls of [...IDS, "none"]) {
    const items = all.filter(a => a.cls === cls).sort((a, b) => a.name.localeCompare(b.name));
    const cam = items.filter(a => a.cam), other = items.filter(a => !a.cam), cut = Math.floor(cam.length * 0.75);
    train.push(...other, ...cam.slice(0, cut)); test.push(...cam.slice(cut));
  }
  const log = (...a) => { if (!opts.quiet) console.log(...a); };
  log(`photos: ${train.length} train, ${test.length} test`);
  const SY = at(CONFIG.synth);
  if (opts.synth && fs.existsSync(path.join(SY, "boxes.json"))) {
    const sb = JSON.parse(fs.readFileSync(path.join(SY, "boxes.json"))); let n = 0;
    const sang = {}; for (const f of fs.readdirSync(SY)) if (/^angles_/.test(f)) Object.assign(sang, JSON.parse(fs.readFileSync(path.join(SY, f))));
    for (const [rel, box] of Object.entries(sb)) { const [cls, file] = rel.split("/"); train.push({ file: path.join(SY, rel), cls, box, cam: false, name: file, synth: true, rot: sang[rel] }); n++; }
    log(`synthetic photos from the designs: ${n}`);
  }
  // Real test scans: their close-ups are exactly what the reader saw (box = the middle 1/1.35). Mistakes ×4, right ×2.
  const TD = at(CONFIG.tests), testScans = [];
  if (fs.existsSync(TD)) for (const t of fs.readdirSync(TD).sort()) {
    const lp = path.join(TD, t, "test-log.json"); if (!fs.existsSync(lp)) continue;
    if (opts.onlyTest && t !== opts.onlyTest && !HOLD.includes(t)) continue;
    for (const r of JSON.parse(fs.readFileSync(lp))) {
      if (!r.truth || !IDS.includes(r.truth)) continue;
      const f = path.join(TD, t, "closeup", r.truth, `scan${r.n}.jpg`); if (!fs.existsSync(f)) continue;
      testScans.push({ file: f, cls: r.truth, box: [.13, .13, .87, .87], cam: true, name: "test", wasRight: !!r.correct, test: t });
    }
  }
  if (opts.tests) for (const s of testScans) if (!HOLD.includes(s.test)) for (let i = 0; i < (s.wasRight ? 2 : 4); i++) train.push(s);
  const heldScans = testScans.filter(s => HOLD.includes(s.test)), seenScans = testScans.filter(s => !HOLD.includes(s.test));
  log(`real test scans: ${testScans.length} found; held back (never trained on): ${heldScans.length}; ${opts.tests ? "others used for training" : "none used for training"}`);
  return { train, test, testScans, heldScans, seenScans, hold: HOLD };
}

// Which way up each real photo is, worked out the same way as the phone (edge maths + the "which side is up" model),
// cached in training/rot-cache.json. Generated images already know their angle.
async function attachRotations(items, quarterModelJson) {
  const CACHE = at(CONFIG.rotationCache), cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE)) : {};
  const real = [...new Set(items)].filter(a => !a.synth && Array.isArray(a.box));
  const todo = real.filter(a => !(a.file + "|" + a.box in cache));
  if (todo.length) {
    const quarter = await tf.loadLayersModel("file://" + path.resolve(quarterModelJson || at("app/model6/quarter/model.json")));
    for (let i = 0; i < todo.length; i += 16) {
      const b = todo.slice(i, i + 16);
      const es = await Promise.all(b.map(async a => { const [cx, cy, s] = readerCrop(a, false); return edgeAngle(new Uint8Array(await view(a.file, cx, cy, s, {})), S).angle; }));
      const x = toTensor(await Promise.all(b.map((a, j) => { const [cx, cy, s] = readerCrop(a, false); return view(a.file, cx, cy, s, { angle: -es[j] }); })));
      const p = quarter.predict(x).arraySync(); x.dispose();
      b.forEach((a, j) => { const q = p[j].indexOf(Math.max(...p[j])); cache[a.file + "|" + a.box] = -es[j] + 90 * q; });
    }
    fs.writeFileSync(CACHE, JSON.stringify(cache));
  }
  for (const a of real) a.rot = cache[a.file + "|" + a.box];
  return real.length;
}
module.exports = { loadData, attachRotations, sessions };
