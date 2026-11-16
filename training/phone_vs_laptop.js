// Phone versus laptop: does the chocoprint the PHONE computed during a scan match what the LAPTOP computes from the
// saved close-up of the same scan? The model file is the same on both sides; the pictures are not. The phone cuts the
// number out of the live video through a 2D canvas; the laptop starts from the 224 px JPEG close-up the phone saved
// and goes through sharp, which is how every gallery reference and every fair check of the chocoprint is made
// (tools/add_to_gallery.js, training/lib/crops.js). Google's Rules of ML call this training/serving skew; it had never
// been measured here (research review, 13-16 Nov 2026).
//
// Usage:  PATH="$HOME/.local/node20/bin:$PATH" node training/phone_vs_laptop.js tests/test-N [tests/test-M ...]
//
// Phone side = the last held frame of each scan's trace: its chocoprint vector (`vec`, logged on the admin page since
// scanner-v54, 13 Nov), top mark (`pmark`), similarity (`psim`) and the rotation it used (`rot`). Laptop side = the
// saved close-up through the gallery tool's steps (straighten, which way up, zoom on the number, black and white,
// chocoprint), scored against the live gallery. Two laptop readings: at the laptop's own rotation, and at the phone's,
// so a rotation disagreement is not mistaken for a pixel difference.
// Sessions saved before `vec` was logged get the crude comparison only: logged top mark and similarity against the laptop's.
const { fs, path, tf, ROOT, S, IDS, mk, toGray, toTensor } = require("./lib/common.js");
const sharp = require("sharp");
const { edgeAngle } = require("./align_lib.js");
const { printScores } = require("./lib/evaluate.js");
const MODEL = path.join(ROOT, "app/model6");
const sessions = process.argv.slice(2).map(p => path.resolve(p));
if (!sessions.length || !sessions.every(s => fs.existsSync(path.join(s, "test-log.json")))) {
  console.log("Give one or more saved sessions: node training/phone_vs_laptop.js tests/test-7 tests/test-12"); process.exit(1);
}
// the same crop the gallery tool makes: turn the 224 close-up clockwise by deg (mirror-padded), keep the middle frac
async function turnCrop(buf, deg, frac) {
  const big = await sharp(buf, { raw: { width: S, height: S, channels: 3 } }).extend({ top: S / 2, bottom: S / 2, left: S / 2, right: S / 2, extendWith: "mirror" })
    .rotate(deg, { background: "#808080" }).raw().toBuffer({ resolveWithObject: true });
  const side = Math.round(S * frac), left = Math.round((big.info.width - side) / 2), top = Math.round((big.info.height - side) / 2);
  return sharp(big.data, { raw: big.info }).extract({ left, top, width: side, height: side }).resize(S, S).removeAlpha().raw().toBuffer();
}
function findFile(sess, truth, n) {   // the close-up is filed under its truth; tolerate a relabel that was not moved
  const direct = path.join(sess, "closeup", truth, `scan${n}.jpg`); if (fs.existsSync(direct)) return direct;
  const dir = path.join(sess, "closeup"); if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir).map(f => path.join(dir, f, `scan${n}.jpg`)).find(fs.existsSync) || null;
}
const med = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const f3 = x => x == null ? "-" : x.toFixed(3);

(async () => {
  const quarter = await tf.loadLayersModel("file://" + path.join(MODEL, "quarter/model.json"));
  const printer = await tf.loadLayersModel("file://" + path.join(MODEL, "print/model.json"));
  const gal = JSON.parse(fs.readFileSync(path.join(MODEL, "gallery.json")));
  const embed = async raw => { const x = toTensor([gal.gray ? toGray(raw) : raw]); const v = tf.tidy(() => { const e = printer.predict(x); return e.div(tf.norm(e, 2, -1, true).add(1e-9)); }); const out = Array.from(v.dataSync()); tf.dispose([x, v]); return out; };
  const score = vec => { const by = printScores(vec, gal.entries, 20, 3).byMark; const o = Object.entries(by).sort((a, b) => b[1] - a[1]); return { mark: o[0][0], sim: o[0][1], gap: o[0][1] - o[1][1] }; };
  for (const sess of sessions) {
    const name = path.basename(sess), L = JSON.parse(fs.readFileSync(path.join(sess, "test-log.json")));
    const rows = [];
    for (const e of L) {
      if (!e.truth || !IDS.includes(e.truth) || !e.trace || !e.trace.length) continue;
      const file = findFile(sess, e.truth, e.n); if (!file) continue;
      const f = e.trace[e.trace.length - 1]; if (f.pmark == null) continue;
      const raw = await sharp(file).resize(S, S).removeAlpha().raw().toBuffer();
      const ea = edgeAngle(new Uint8Array(raw), S).angle;
      const sq = toTensor([await turnCrop(raw, -ea, 1)]); const pq = quarter.predict(sq).arraySync()[0]; sq.dispose();
      const rotOwn = -ea + 90 * pq.indexOf(Math.max(...pq));
      const own = score(await embed(await turnCrop(raw, rotOwn, gal.zoom)));
      const atPhone = f.rot != null ? score(await embed(await turnCrop(raw, f.rot, gal.zoom))) : null;
      const vecPhone = Array.isArray(f.vec) && f.vec.length === gal.entries[0][1].length ? f.vec : null;
      let dist = null, phoneScored = null;
      if (vecPhone) {
        const vl = await embed(await turnCrop(raw, f.rot != null ? f.rot : rotOwn, gal.zoom));
        const nrm = Math.hypot(...vecPhone) || 1; dist = 1 - vl.reduce((a, x, i) => a + x * vecPhone[i] / nrm, 0);
        phoneScored = score(vecPhone.map(x => x / nrm));
      }
      rows.push({ n: e.n, truth: mk(e.truth), phone: { mark: f.pmark, sim: f.psim, rot: f.rot }, own: { ...own, rot: rotOwn }, atPhone, dist, phoneScored });
    }
    const n = rows.length, withVec = rows.filter(r => r.dist != null);
    console.log(`\n${name}: ${n} scans with a trace and a close-up; ${withVec.length} with the phone's own chocoprint vector logged${withVec.length ? "" : " (crude comparison only: the logged top mark and similarity against the laptop's)"}`);
    if (!n) continue;
    const diffOwn = rows.filter(r => r.phone.mark !== r.own.mark), diffPhoneRot = rows.filter(r => r.atPhone && r.phone.mark !== r.atPhone.mark);
    const rotDiff = rows.filter(r => r.atPhone && Math.abs((((r.own.rot - r.phone.rot) % 360) + 540) % 360 - 180) > 10);
    console.log(`  rotation: laptop's own differs from the phone's by more than 10 degrees on ${rotDiff.length} of ${n}`);
    console.log(`  top mark differs, phone vs laptop: at the laptop's own rotation ${diffOwn.length} of ${n}; at the phone's rotation ${diffPhoneRot.length} of ${rows.filter(r => r.atPhone).length}`);
    const sd = rows.filter(r => r.atPhone && r.phone.sim != null).map(r => Math.abs(r.phone.sim - r.atPhone.sim));
    console.log(`  similarity |phone - laptop| at the phone's rotation: median ${f3(med(sd))}, max ${f3(sd.length ? Math.max(...sd) : null)}`);
    console.log(`  names the truth: phone ${rows.filter(r => r.phone.mark === r.truth).length}, laptop own rotation ${rows.filter(r => r.own.mark === r.truth).length}, laptop at the phone's rotation ${rows.filter(r => r.atPhone && r.atPhone.mark === r.truth).length} (of ${n})`);
    if (withVec.length) {
      const d = withVec.map(r => r.dist);
      console.log(`  chocoprint vectors, phone vs laptop at the phone's rotation (1 - cosine; 0 = identical): median ${f3(med(d))}, max ${f3(Math.max(...d))}, over 0.05 on ${d.filter(x => x > .05).length}`);
      console.log(`  the phone's own vector rescored against gallery.json names the logged top mark on ${withVec.filter(r => r.phoneScored.mark === r.phone.mark).length} of ${withVec.length} (a difference here is the 16-bit packed gallery, not the picture)`);
    }
    const show = rows.filter(r => r.phone.mark !== r.own.mark || (r.atPhone && r.phone.mark !== r.atPhone.mark) || (r.dist != null && r.dist > .05));
    if (show.length) {
      console.log(`  scans that differ (phone | laptop own rotation | laptop at the phone's rotation):`);
      for (const r of show) console.log(`    #${String(r.n).padStart(2)} truth ${r.truth.padEnd(5)} phone ${r.phone.mark.padEnd(5)} ${f3(r.phone.sim)} rot ${String(r.phone.rot).padStart(4)} | laptop ${r.own.mark.padEnd(5)} ${f3(r.own.sim)} rot ${String(Math.round(r.own.rot)).padStart(4)} | ${r.atPhone ? `${r.atPhone.mark.padEnd(5)} ${f3(r.atPhone.sim)}` : "-"}${r.dist != null ? ` | vec dist ${f3(r.dist)}` : ""}`);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
