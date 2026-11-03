// For each chocolate: save the official design next to the actual straightened, zoomed, black-and-white crop the
// chocoprint model sees from a real reference photo - lets a human (or this script) sanity-check the straightening
// and zoom pipeline by eye, and is the raw material for a design-vs-chocoprint comparison document.
// Usage: node training/design_vs_crop.js <output dir>
const path = require("path");
const sharp = require("sharp");
const { fs, tf, ROOT, IDS, mk, S, ZOOM } = require("./lib/common.js");
const { edgeAngle } = require("./align_lib.js");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "experiments", "design-vs-crop"));

async function turnCrop(buf, deg, frac) {
  const big = await sharp(buf, { raw: { width: S, height: S, channels: 3 } }).extend({ top: S / 2, bottom: S / 2, left: S / 2, right: S / 2, extendWith: "mirror" })
    .rotate(deg, { background: "#808080" }).raw().toBuffer({ resolveWithObject: true });
  const side = Math.round(S * frac), left = Math.round((big.info.width - side) / 2), top = Math.round((big.info.height - side) / 2);
  return sharp(big.data, { raw: big.info }).extract({ left, top, width: side, height: side }).resize(S, S).removeAlpha().raw().toBuffer();
}
function toGray3(b) { const o = Buffer.alloc(b.length); for (let i = 0; i < b.length; i += 3) { const g = Math.round(0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2]); o[i] = o[i + 1] = o[i + 2] = g; } return o; }

const REFDIRS = ["reference/2026-10-28/closeup", "reference/2026-11-03/closeup"];
function findRef(k) {
  for (const rd of REFDIRS) {
    const dir = path.join(ROOT, rd, k);
    if (fs.existsSync(dir)) { const f = fs.readdirSync(dir).find(f => /\.jpe?g$/i.test(f)); if (f) return path.join(dir, f); }
  }
  return null;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const quarter = await tf.loadLayersModel("file://" + path.join(ROOT, "app/model6/quarter/model.json"));
  const made = [];
  for (const k of IDS) {
    const file = findRef(k);
    if (!file) { console.log(`${k}: no reference photo found, skipped`); continue; }
    const raw = await sharp(file).resize(S, S).removeAlpha().raw().toBuffer();
    const es = edgeAngle(new Uint8Array(raw), S).angle;
    const { toTensor } = require("./lib/common.js");
    const sq = toTensor([await turnCrop(raw, -es, 1)]);
    const pq = quarter.predict(sq).arraySync()[0]; sq.dispose();
    const rot = -es + 90 * pq.indexOf(Math.max(...pq));
    const zoomed = await turnCrop(raw, rot, ZOOM);
    const gray = toGray3(zoomed);
    const cropPath = path.join(OUT, `${k}_crop.png`);
    await sharp(gray, { raw: { width: S, height: S, channels: 3 } }).png().toFile(cropPath);
    const designPath = path.join(OUT, `${k}_design.png`);
    await sharp(path.join(ROOT, "designs", `mark_${mk(k)}.png`)).resize(S, S).png().toFile(designPath);
    made.push(k);
    process.stdout.write(`${k} `);
  }
  console.log(`\n${made.length}/${IDS.length} pairs written to ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
