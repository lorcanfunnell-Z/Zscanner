// Packs app/model6/gallery.json into the two files the phone actually downloads (13 Nov 2026):
//   app/model6/gallery.bin        every reference chocoprint as 16-bit floats, in gallery.json's order
//   app/model6/gallery.pack.json  the small part: marks, zoom, gray, and the mark of each entry
// gallery.json stays the source of truth for every tool (add_to_gallery, audit_gallery, eval_combo, fair_check, ...);
// the packed copy is only a download format: 1.16 MB of JSON text becomes ~0.37 MB. The values in gallery.json are
// already rounded to 3 decimals, well inside what 16-bit floats keep (about 3 significant digits), and
// experiments/eight-fixes/verify_f16.js confirmed identical chocoprint answers on all 112 held-back scans.
//
// Usage:  node tools/pack_gallery.js            (re-pack after any change to gallery.json, then bump MODEL_VERSION in app/sw.js)
//         node tools/pack_gallery.js --check    (tools/check.sh: fails if the packed files are out of date)
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "app", "model6");
const CHECK = process.argv.includes("--check");

// IEEE 754 half precision, round to nearest even - Node 20 has no Float16Array
function toHalf(f) {
  const buf = new DataView(new ArrayBuffer(4)); buf.setFloat32(0, f);
  const x = buf.getUint32(0), sign = (x >>> 16) & 0x8000, exp = (x >>> 23) & 0xff, mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);            // inf / nan
  let e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;                                     // overflow -> inf
  if (e <= 0) {                                                            // subnormal half
    if (e < -10) return sign;
    const m = (mant | 0x800000) >>> (1 - e);
    const half = m >>> 13, rem = m & 0x1fff;
    return sign | (half + (rem > 0x1000 || (rem === 0x1000 && (half & 1)) ? 1 : 0));
  }
  let half = sign | (e << 10) | (mant >>> 13); const rem = mant & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (half & 1))) half += 1;          // may carry into the exponent: correct rounding
  return half;
}

function pack() {
  const g = JSON.parse(fs.readFileSync(path.join(DIR, "gallery.json")));
  const n = g.entries.length, dim = g.entries[0][1].length;
  const bin = Buffer.alloc(n * dim * 2);
  g.entries.forEach(([, v], i) => { if (v.length !== dim) throw new Error(`entry ${i} has ${v.length} values, expected ${dim}`); v.forEach((x, k) => bin.writeUInt16LE(toHalf(x), (i * dim + k) * 2)); });
  const index = { marks: g.marks, zoom: g.zoom, gray: !!g.gray, n, dim, format: "float16 little-endian, entries in gallery.json order", entryMarks: g.entries.map(([m]) => m) };
  return { bin, index: JSON.stringify(index) };
}

const { bin, index } = pack();
const binPath = path.join(DIR, "gallery.bin"), idxPath = path.join(DIR, "gallery.pack.json");
if (CHECK) {
  const same = fs.existsSync(binPath) && fs.existsSync(idxPath) && bin.equals(fs.readFileSync(binPath)) && index === fs.readFileSync(idxPath, "utf8");
  console.log(same ? `  ok    app/model6/gallery.bin + gallery.pack.json match gallery.json (${JSON.parse(index).n} references)` : "  FAIL  app/model6/gallery.bin is out of date: run node tools/pack_gallery.js and bump MODEL_VERSION in app/sw.js");
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(binPath, bin); fs.writeFileSync(idxPath, index);
console.log(`packed ${JSON.parse(index).n} references x ${JSON.parse(index).dim}: gallery.bin ${bin.length} bytes + gallery.pack.json ${index.length} bytes (gallery.json is ${fs.statSync(path.join(DIR, "gallery.json")).size} bytes). Bump MODEL_VERSION in app/sw.js.`);
