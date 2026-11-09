// Demo-scale cut-paste synthetic backgrounds for the FINDER (CLAUDE.md "Next steps" item 9, the distance/clutter
// weak spot: the finder locks onto a laptop keyboard once a chocolate is a small part of a busier scene, most
// likely because every real training photo so far is the same white card on the same wood table - see CLAUDE.md,
// "Reading from further away", 4 Nov).
//
// What this does: cuts a chocolate out of a real reference-round close-up (classical colour-threshold segmentation,
// not a trained model - Otsu's method on "how far is this pixel from the border colour", largest connected blob,
// feathered edge), pastes it onto a real background photo that has nothing to do with the finder's own white-card
// shortcut, adds one smaller "distractor" chocolate elsewhere in the frame (so the finder can't just learn "exactly
// one blob = the answer"), and writes out the composite plus its true box in the SAME [x0,y0,x1,y1]-fraction format
// training-photos/boxes.json already uses - training/train_finder.js loads it exactly like a real photo.
//
// Honest limit, confirmed before writing any of this (see the research notes this was built from): outside the
// held-back test sessions there are only two real background textures on disk - 45 plain wood-grain "none" photos,
// and 15 frames of one laptop+desk+white-card sitting. Neither contains the keyboard/hand/bag clutter that actually
// fooled the finder in tests/test-9..11. A FEW HUNDRED composites from two backgrounds can prove the pipeline works
// and give a first before/after number - they cannot plausibly teach "ignore a keyboard", because no keyboard is in
// this data. Said plainly again in this script's own summary line at the end, not just here.
//
// Usage: node tools/cutpaste_finder.js [outDir] [count]
//   outDir  default experiments/cutpaste-finder (gitignored - this is scratch training data, not shipped)
//   count   default 300 (demo scale, not the ~2000 CLAUDE.md's "next steps" idea mentions - see the file header
//           above and this script's final summary for why: more copies of two textures isn't more real diversity)
const fs = require("fs"), path = require("path"), sharp = require("sharp");
const ROOT = path.join(__dirname, ".."), CANVAS = 640;
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "experiments/cutpaste-finder"));
const COUNT = +(process.argv[3] || 300);
const NEG_SHARE = 0.15;   // share of the batch that's a pure background, no chocolate at all (a clutter negative)

let seed = 11; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const between = (a, b) => a + (b - a) * rnd(), pick = a => a[Math.floor(rnd() * a.length)];

// ---------- cutout sources: the reference-round "gallery" close-ups, every chocolate Lorcan has photographed ----------
function listCutoutSources() {
  const dirs = [
    ["reference/2026-10-28/closeup", null],     // 27 chocolates, 432 photos
    ["reference/2026-11-03/closeup", ["zmilk"]], // the one chocolate the Oct round missed
  ];
  const byClass = {};
  for (const [rel, only] of dirs) {
    const base = path.join(ROOT, rel);
    if (!fs.existsSync(base)) continue;
    for (const cls of fs.readdirSync(base)) {
      if (only && !only.includes(cls)) continue;
      const d = path.join(base, cls);
      if (!fs.statSync(d).isDirectory()) continue;
      (byClass[cls] = byClass[cls] || []).push(...fs.readdirSync(d).map(f => path.join(d, f)));
    }
  }
  return byClass;
}

// ---------- classical cutout: Otsu threshold on "distance from the border colour", largest blob, feathered alpha ----------
async function loadRaw(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}
function borderColor(data, w, h, ch, marginFrac = 0.05) {
  const mx = Math.round(w * marginFrac), my = Math.round(h * marginFrac), rs = [], gs = [], bs = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x > mx && x < w - mx && y > my && y < h - my) continue;
    const i = (y * w + x) * ch; rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
  }
  const med = a => { a = a.slice().sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; };
  return [med(rs), med(gs), med(bs)];
}
function otsuThreshold(d) {
  const N = 256, maxD = 255 * Math.sqrt(3), hist = new Array(N).fill(0);
  for (const v of d) hist[Math.min(N - 1, Math.round(v / maxD * (N - 1)))]++;
  const total = d.length; let sum = 0; for (let i = 0; i < N; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, max = 0, thresh = 0;
  for (let i = 0; i < N; i++) {
    wB += hist[i]; if (!wB) continue; const wF = total - wB; if (!wF) break;
    sumB += i * hist[i]; const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > max) { max = between; thresh = i; }
  }
  return thresh / (N - 1) * maxD;
}
// largest 4-connected blob of mask===1 (iterative flood fill - a 224x224 grid is small, this is fast)
function largestComponent(mask, w, h) {
  const seen = new Uint8Array(w * h); let best = { size: 0, minX: w, minY: h, maxX: 0, maxY: 0 }; const stack = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const idx = y * w + x; if (!mask[idx] || seen[idx]) continue;
    let size = 0, minX = x, maxX = x, minY = y, maxY = y;
    stack.push(idx); seen[idx] = 1;
    while (stack.length) {
      const c = stack.pop(), cy = (c / w) | 0, cx = c % w; size++;
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx; if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nidx = ny * w + nx; if (mask[nidx] && !seen[nidx]) { seen[nidx] = 1; stack.push(nidx); }
      }
    }
    if (size > best.size) best = { size, minX, minY, maxX, maxY };
  }
  return best;
}
// Cuts the chocolate out of one reference photo. Returns null (caller tries another photo) when the blob found
// doesn't look like a clean, centred, roughly-square chocolate - about 7% of real reference photos fail this,
// mostly ones with strong shadow or a pale (zwhite) shell close in colour to the card; plenty of good ones remain.
async function cutout(file) {
  const { data, w, h, ch } = await loadRaw(file);
  const bg = borderColor(data, w, h, ch);
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * ch, dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
    d[y * w + x] = Math.sqrt(dr * dr + dg * dg + db * db);
  }
  const t = otsuThreshold(d), mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = d[i] > t ? 1 : 0;
  const comp = largestComponent(mask, w, h), areaFrac = comp.size / (w * h);
  const x0 = comp.minX / w, y0 = comp.minY / h, x1 = (comp.maxX + 1) / w, y1 = (comp.maxY + 1) / h;
  const bw = x1 - x0, bh = y1 - y0, fill = areaFrac / Math.max(1e-6, bw * bh), aspect = bw / bh;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const ok = areaFrac > 0.08 && areaFrac < 0.75 && fill > 0.55 && aspect > 0.55 && aspect < 1.8 &&
    cx > 0.2 && cx < 0.8 && cy > 0.15 && cy < 0.85;
  if (!ok) return null;
  // feather the WHOLE-frame mask before cropping, so the blur isn't clipped at the crop edge; .toColourspace("b-w")
  // matters here - sharp silently widens a single-channel raw buffer back to 3 channels on output otherwise
  const maskBuf = Buffer.from(mask.map(v => v * 255));
  const feathered = await sharp(maskBuf, { raw: { width: w, height: h, channels: 1 } })
    .blur(2.2).toColourspace("b-w").raw().toBuffer();
  const margin = 0.06;
  const mx0 = Math.max(0, Math.round((x0 - margin) * w)), my0 = Math.max(0, Math.round((y0 - margin) * h));
  const mx1 = Math.min(w, Math.round((x1 + margin) * w)), my1 = Math.min(h, Math.round((y1 + margin) * h));
  const cw = mx1 - mx0, chh = my1 - my0, rgba = Buffer.alloc(cw * chh * 4);
  for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
    const sx = mx0 + x, sy = my0 + y, si = (sy * w + sx) * ch, di = (y * cw + x) * 4;
    rgba[di] = data[si]; rgba[di + 1] = data[si + 1]; rgba[di + 2] = data[si + 2]; rgba[di + 3] = feathered[sy * w + sx];
  }
  return { data: rgba, w: cw, h: chh, source: file };
}
async function resizeCutout(cut, targetW) {
  const targetH = Math.max(1, Math.round(cut.h * (targetW / cut.w)));
  const data = await sharp(cut.data, { raw: { width: cut.w, height: cut.h, channels: 4 } })
    .resize(targetW, targetH).raw().toBuffer();
  return { data, w: targetW, h: targetH };
}

// ---------- backgrounds: the only two real, non-held-back, non-white-card-only textures on disk (see file header) ----------
function listBackgrounds() {
  const wood = fs.existsSync(path.join(ROOT, "training-photos/none"))
    ? fs.readdirSync(path.join(ROOT, "training-photos/none")).map(f => path.join(ROOT, "training-photos/none", f)) : [];
  const deskDir = path.join(ROOT, "experiments/vision-chat-test-2026-11-03/photos");
  const desk = fs.existsSync(deskDir) ? fs.readdirSync(deskDir).map(f => path.join(deskDir, f)) : [];
  return { wood, desk };
}
// Plain wood grain (training-photos/none, already square-ish): random zoom crop for variety.
async function bgFromWood(file) {
  const meta = await sharp(file).metadata(), side = Math.round(Math.min(meta.width, meta.height) * between(0.55, 1));
  const left = Math.floor(between(0, meta.width - side)), top = Math.floor(between(0, meta.height - side));
  return sharp(file).extract({ left, top, width: side, height: side }).resize(CANVAS, CANVAS)
    .modulate({ brightness: between(0.85, 1.15) }).rotate(between(-8, 8), { background: "#808080" })
    .resize(CANVAS, CANVAS, { fit: "cover" }).removeAlpha().raw().toBuffer();
}
// The one real laptop+desk+card sitting (experiments/..., 1512x2016): crop only from the TOP half, which keeps the
// laptop edge and desk/card but reliably avoids the real chocolate itself (it always sits lower in these photos).
async function bgFromDesk(file) {
  const meta = await sharp(file).metadata();
  const side = Math.round(Math.min(meta.width, meta.height * 0.5) * between(0.5, 1));
  const left = Math.floor(between(0, meta.width - side)), top = Math.floor(between(0, meta.height * 0.5 - side));
  return sharp(file).extract({ left, top: Math.max(0, top), width: side, height: side }).resize(CANVAS, CANVAS)
    .modulate({ brightness: between(0.85, 1.15) }).removeAlpha().raw().toBuffer();
}

(async () => {
  const cutSources = listCutoutSources(), classes = Object.keys(cutSources);
  const { wood, desk } = listBackgrounds();
  if (!classes.length) { console.log("No reference-round cutout photos found under reference/ - nothing to build."); process.exit(1); }
  if (!wood.length && !desk.length) { console.log("No background photos found (training-photos/none, experiments/vision-chat-test-2026-11-03/photos) - nothing to paste onto."); process.exit(1); }
  fs.mkdirSync(path.join(OUT, "images"), { recursive: true });
  const boxes = {}, stats = { wood: 0, desk: 0, positive: 0, negative: 0, segFail: 0 };

  async function goodCutout(excludeCls) {
    for (let tries = 0; tries < 12; tries++) {
      const cls = pick(classes.filter(c => c !== excludeCls || classes.length === 1));
      const file = pick(cutSources[cls]);
      const c = await cutout(file);
      if (c) return c;
      stats.segFail++;
    }
    return null;   // very unlucky run of bad segmentations - caller just skips this slot
  }
  async function background() {
    if (desk.length && (!wood.length || rnd() < 0.35)) { stats.desk++; return bgFromDesk(pick(desk)); }
    stats.wood++; return bgFromWood(pick(wood));
  }

  for (let n = 0; n < COUNT; n++) {
    const bg = await background();
    const name = `images/finder_${String(n).padStart(4, "0")}.jpg`;
    const isNeg = rnd() < NEG_SHARE;
    if (isNeg) {
      await sharp(bg, { raw: { width: CANVAS, height: CANVAS, channels: 3 } }).jpeg({ quality: 88 }).toFile(path.join(OUT, name));
      boxes[name] = null; stats.negative++;
    } else {
      const main = await goodCutout(null);
      if (!main) { n--; continue; }   // ran out of luck this slot - retry with a fresh background instead of wasting it
      const mainW = Math.round(between(0.20, 0.45) * CANVAS);
      const mainR = await resizeCutout(main, mainW);
      const mainLeft = Math.round(between(0.05, 0.95 - mainR.w / CANVAS) * CANVAS);
      const mainTop = Math.round(between(0.05, 0.95 - mainR.h / CANVAS) * CANVAS);
      const layers = [{ input: mainR.data, raw: { width: mainR.w, height: mainR.h, channels: 4 }, left: mainLeft, top: mainTop, blend: "over" }];
      // one smaller distractor elsewhere in the frame, kept clear of the main chocolate's own box
      const other = await goodCutout(path.basename(path.dirname(main.source)));
      if (other) {
        const distW = Math.round(between(0.10, 0.28) * CANVAS);
        const distR = await resizeCutout(other, distW);
        let dLeft = mainLeft, dTop = mainTop;
        for (let t = 0; t < 6; t++) {
          dLeft = Math.round(between(0.03, 0.97 - distR.w / CANVAS) * CANVAS);
          dTop = Math.round(between(0.03, 0.97 - distR.h / CANVAS) * CANVAS);
          const ox = Math.max(0, Math.min(dLeft + distR.w, mainLeft + mainR.w) - Math.max(dLeft, mainLeft));
          const oy = Math.max(0, Math.min(dTop + distR.h, mainTop + mainR.h) - Math.max(dTop, mainTop));
          if ((ox * oy) / (distR.w * distR.h) < 0.15) break;   // good enough, not stacked on the main chocolate
        }
        layers.push({ input: distR.data, raw: { width: distR.w, height: distR.h, channels: 4 }, left: dLeft, top: dTop, blend: "over" });
      }
      await sharp(bg, { raw: { width: CANVAS, height: CANVAS, channels: 3 } }).composite(layers).jpeg({ quality: 90 }).toFile(path.join(OUT, name));
      boxes[name] = [mainLeft / CANVAS, mainTop / CANVAS, (mainLeft + mainR.w) / CANVAS, (mainTop + mainR.h) / CANVAS].map(v => Math.round(v * 1e4) / 1e4);
      stats.positive++;
    }
    if (n % 20 === 19) process.stdout.write(".");
  }
  fs.writeFileSync(path.join(OUT, "boxes.json"), JSON.stringify(boxes));
  console.log(`\n\nwrote ${stats.positive + stats.negative} composites to ${path.relative(ROOT, OUT)}/images/ (+ boxes.json):`);
  console.log(`  ${stats.positive} with a chocolate + 1 distractor pasted on, ${stats.negative} pure background (no chocolate - a clutter negative)`);
  console.log(`  backgrounds used: ${stats.wood} wood-grain crops, ${stats.desk} laptop/desk crops` + (desk.length ? "" : " (no laptop/desk photos found - wood-grain only)"));
  console.log(`  cutout segmentation failed and was retried ${stats.segFail} times (expected - about 7% of real reference photos don't segment cleanly; plenty of spares)`);
  console.log(`\nHonest limit, unchanged by this run: both backgrounds are still fairly clean (wood grain, or one laptop+desk+card scene) -`);
  console.log(`no keyboard, hand or bag is in this data, so this batch cannot plausibly teach the finder to ignore real clutter.`);
  console.log(`It proves the pipeline end to end and gives a first before/after number - the real fix still needs new real phone photos`);
  console.log(`of chocolates off the white card and genuinely cluttered "none" scenes (see CLAUDE.md's own "second, more fundamental gap").`);
})().catch(e => { console.error(e); process.exit(1); });
