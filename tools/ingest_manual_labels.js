// Takes a "Manual label" export off the phone (admin page → Manual label → Download labelled photos) and files
// it where the finder trainer can use it: training-photos-wide/.
//
// Usage:  node tools/ingest_manual_labels.js ~/Downloads/zscanner-manual-labels-2026-11-12.zip
//         node tools/ingest_manual_labels.js <an already-unzipped folder>
//         node tools/ingest_manual_labels.js <zip> --dry-run        (say what would happen, write nothing)
//
// WHY A SEPARATE FOLDER, NOT training-photos/. The photos in training-photos/ are CLOSE-UPS: their boxes are
// fractions of an already-zoomed-in picture, and every training script assumes that (finderCrop zooms back out
// by 1/0.85 to simulate the camera square). Manual-label photos are the opposite - the WHOLE camera square,
// with the box drawn on the whole square. Dropping them into training-photos/ would silently feed a wrong-scale
// box to the reader and chocoprint trainers as well as the finder. They therefore live in their own folder,
// in the same [x0,y0,x1,y1] boxes.json format, and only training/train_finder.js reads it (WIDE=).
//
// Safe to run twice: a photo already filed with identical contents is skipped, and one already filed with
// DIFFERENT contents is refused rather than overwritten - nothing already on disk is ever replaced.
const { execFileSync } = require("child_process");
const os = require("os");
const { fs, path, ROOT, CONFIG, IDS, at } = require("../training/lib/common.js");

const SRC = process.argv[2] ? path.resolve(process.argv[2]) : null;
const DRY = process.argv.includes("--dry-run");
const DEST = at(CONFIG.photosWide);
const VALID = new Set([...IDS, "none"]);

if (!SRC || !fs.existsSync(SRC)) {
  console.log("Give the Manual-label export: a .zip straight from the phone, or a folder you have already unzipped.");
  console.log("  node tools/ingest_manual_labels.js ~/Downloads/zscanner-manual-labels-2026-11-12.zip");
  process.exit(1);
}

// ---- find labels.json + the photos, unzipping to a temp folder first if we were given a zip ----
let dir = SRC, tmp = null;
if (/\.zip$/i.test(SRC)) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zscanner-manual-"));
  try { execFileSync("unzip", ["-q", SRC, "-d", tmp]); }
  catch (e) { console.error(`could not unzip ${SRC}: ${e.message}`); process.exit(1); }
  dir = tmp;
}
// the export puts labels.json at the top, but be forgiving if it was zipped inside one wrapper folder
if (!fs.existsSync(path.join(dir, "labels.json"))) {
  const inner = fs.readdirSync(dir).map(f => path.join(dir, f)).filter(f => fs.statSync(f).isDirectory() && fs.existsSync(path.join(f, "labels.json")));
  if (inner.length === 1) dir = inner[0];
}
const labelsFile = path.join(dir, "labels.json");
if (!fs.existsSync(labelsFile)) {
  console.error(`no labels.json in ${SRC} - is this really a Manual-label export? (the Reference-round and Collect-photos exports are a different shape)`);
  process.exit(1);
}
const labels = JSON.parse(fs.readFileSync(labelsFile));

// ---- check every entry before writing anything ----
const ok = [], problems = [];
for (const [rel, box] of Object.entries(labels)) {
  const parts = rel.split("/");
  if (parts.length !== 2 || !/\.jpe?g$/i.test(parts[1])) { problems.push(`${rel}: not a <chocolate>/<file>.jpg name`); continue; }
  const [cls] = parts;
  if (!VALID.has(cls)) { problems.push(`${rel}: "${cls}" is not a chocolate this project knows (or "none")`); continue; }
  if (!fs.existsSync(path.join(dir, rel))) { problems.push(`${rel}: listed in labels.json but the photo is missing from the export`); continue; }
  if (box !== null) {
    const bad = !Array.isArray(box) || box.length !== 4 || box.some(v => typeof v !== "number" || v < 0 || v > 1) || box[2] <= box[0] || box[3] <= box[1];
    if (bad) { problems.push(`${rel}: box is not [x0,y0,x1,y1] fractions inside the frame - got ${JSON.stringify(box)}`); continue; }
  } else if (cls !== "none") {
    problems.push(`${rel}: filed under "${cls}" but has no box - a photo with no chocolate in it should be tagged "Nothing"`); continue;
  }
  ok.push({ rel, cls, box, from: path.join(dir, rel) });
}
// SAFEGUARD (fair testing): the distance sessions tests/test-9/10/11 are the held-back check this whole effort
// is measured against - if one of their frames were ever ingested and trained on, "the finder got better at
// distance" would stop meaning anything. Their camera frames are few, so just compare the bytes.
const held = [];
for (const s of ["test-9", "test-10", "test-11"]) {
  const cam = at(`tests/${s}/camera`);
  if (!fs.existsSync(cam)) continue;
  for (const k of fs.readdirSync(cam)) for (const f of fs.readdirSync(path.join(cam, k))) held.push(path.join(cam, k, f));
}
const heldSizes = new Map();
for (const f of held) { const sz = fs.statSync(f).size; if (!heldSizes.has(sz)) heldSizes.set(sz, []); heldSizes.get(sz).push(f); }
const contaminated = [];
for (const a of ok) {
  const candidates = heldSizes.get(fs.statSync(a.from).size);
  if (!candidates) continue;
  const bytes = fs.readFileSync(a.from);
  const match = candidates.find(f => fs.readFileSync(f).equals(bytes));
  if (match) contaminated.push(`${a.rel} is the same photo as ${path.relative(ROOT, match)}`);
}
if (contaminated.length) {
  console.log(`REFUSED - this export contains ${contaminated.length} frame${contaminated.length === 1 ? "" : "s"} from a held-back distance session:`);
  for (const c of contaminated) console.log(`  ${c}`);
  console.log(`tests/test-9, test-10 and test-11 are the fair check for exactly this work (see CLAUDE.md "Reading from`);
  console.log(`further away"). Training on them would make any improvement meaningless. Nothing has been written.`);
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}

if (problems.length) {
  console.log(`${problems.length} entr${problems.length === 1 ? "y" : "ies"} in this export can't be used:`);
  for (const p of problems) console.log(`  ${p}`);
  console.log("");
}
if (!ok.length) { console.log("nothing usable in this export."); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); }

// ---- merge, refusing to overwrite anything already there ----
fs.mkdirSync(DEST, { recursive: true });
const boxesFile = path.join(DEST, "boxes.json");
const boxes = fs.existsSync(boxesFile) ? JSON.parse(fs.readFileSync(boxesFile)) : {};
const before = Object.keys(boxes).length;
let added = 0, same = 0; const clashes = [];
for (const a of ok) {
  const dst = path.join(DEST, a.rel);
  if (fs.existsSync(dst)) {
    if (fs.readFileSync(dst).equals(fs.readFileSync(a.from)) && JSON.stringify(boxes[a.rel]) === JSON.stringify(a.box)) { same++; continue; }
    clashes.push(a.rel); continue;
  }
  if (!DRY) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(a.from, dst); }
  boxes[a.rel] = a.box; added++;
}
if (clashes.length) {
  console.log(`REFUSED - ${clashes.length} photo${clashes.length === 1 ? " is" : "s are"} already filed under the same name but differ${clashes.length === 1 ? "s" : ""} from this export:`);
  for (const c of clashes.slice(0, 10)) console.log(`  ${c}`);
  if (clashes.length > 10) console.log(`  …and ${clashes.length - 10} more`);
  console.log(`Nothing already in ${path.relative(ROOT, DEST)} has been changed. Rename or remove them first if you really mean to replace them.`);
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}
if (!DRY && added) fs.writeFileSync(boxesFile, JSON.stringify(boxes, null, 1));
if (tmp) fs.rmSync(tmp, { recursive: true, force: true });

// ---- what landed ----
const withBox = ok.filter(a => a.box), none = ok.filter(a => !a.box);
const byCls = {}; for (const a of withBox) byCls[a.cls] = (byCls[a.cls] || 0) + 1;
console.log(`${DRY ? "[dry run - nothing written] " : ""}${added} new photo${added === 1 ? "" : "s"} filed in ${path.relative(ROOT, DEST)}` +
  (same ? `, ${same} already there and identical (skipped)` : "") + `.`);
console.log(`  this export: ${withBox.length} with a chocolate (${Object.entries(byCls).map(([k, v]) => `${k}×${v}`).join(", ") || "none"}), ${none.length} "Nothing" shots.`);
console.log(`  the folder now holds ${Object.keys(boxes).length} photo${Object.keys(boxes).length === 1 ? "" : "s"} in total (was ${before}).`);

// How big did the chocolate actually come out? This is the honest check on whether the shots were taken far
// enough away, measured against the hand-labelled distance sessions rather than guessed:
//   ~0.26 of the frame  = the normal close scanning distance (roughly 25cm; test-9's good shots)
//   ~0.10-0.13          = test-9's further-back shots and test-10 at arm's length
//   ~0.06-0.09          = test-11, the furthest real examples on record
if (withBox.length) {
  const sides = withBox.map(a => Math.max(a.box[2] - a.box[0], a.box[3] - a.box[1])).sort((x, y) => x - y);
  const med = sides[Math.floor(sides.length / 2)];
  const band = s => s > .20 ? "close (about normal scanning distance)" : s > .135 ? "a bit further back" : s > .095 ? "roughly the 50cm target" : "further than the 50cm target";
  const counts = {}; for (const s of sides) counts[band(s)] = (counts[band(s)] || 0) + 1;
  console.log(`  how big the chocolate came out: smallest ${sides[0].toFixed(3)}, middle ${med.toFixed(3)}, largest ${sides[sides.length - 1].toFixed(3)} of the frame`);
  for (const [b, c] of Object.entries(counts)) console.log(`    ${c} ${b}`);
  if (med > .20) console.log(`  NOTE: most of these are close-ups. The finder is already good at those (99% on held-back close-ups) - the gap is further back, see training/finder-capture-brief.md.`);
}
console.log(`\nNext: PATH="$HOME/.local/node20/bin:$PATH" node training/train_finder.js   (it reads this folder automatically)`);
