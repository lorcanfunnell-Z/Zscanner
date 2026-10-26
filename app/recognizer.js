// zScanner recogniser v2, all on the phone.
// 1. FINDER looks at the whole camera square and says whether there is a chocolate and where it is.
// 2. READER looks closely at that spot and gives three opinions: which chocolate, which shell colour
//    (dark / milk / white / milk-and-white) and which kind of mark (one digit / two digits / z).
// 3. LOGIC: the three opinions are multiplied together, so a chocolate is only likely if its number,
//    its shell and its mark all agree. A dark two-digit chocolate can only be 10, 13, 15, 17, 18, 19, 21 or 23.
// 4. ALIGN (Stage 2, model5 onwards): like face alignment, the close-up is straightened before reading. The chocolate is
//    square, so its edges give the angle modulo 90 degrees (plain maths, edgeAngle); a small QUARTER model then says
//    which side is the top. If it isn't sure, the reader tries the two likeliest ways up and keeps the clearer reading.
// The admin page runs the newest candidate model; the client page keeps the proven one until a fair test says otherwise.
window.Recognizer = (() => {
  const DIR = "model6";   // model 6.1 + rules E and A on both pages since 26 Oct 2026 (model4/ kept as a fallback)
  let finder = null, reader = null, quarter = null, printer = null, gallery = null, meta = null, loading = null;
  const S = 224;
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  // Loading: every model downloads at the same time; listeners hear progress 0..1 (90% = downloaded, 100% = ready).
  const progressFns = []; let progress = 0;
  const report = p => { progress = Math.max(progress, p); progressFns.forEach(f => { try { f(progress); } catch (e) {} }); };
  function load(onProgress) {
    if (onProgress) { progressFns.push(onProgress); onProgress(progress); }
    if (!loading) loading = (async () => {
      loadStart = performance.now();
      await tf.ready();
      meta = await fetch(DIR + "/meta.json").then(r => r.json());
      const B = meta.base || DIR;                               // a candidate can reuse the proven finder and reader
      const parts = [B + "/finder", B + "/reader", ...(meta.align || meta.print ? [DIR + "/quarter"] : []), ...(meta.print ? [DIR + "/print"] : [])];
      const frac = parts.map(() => 0), tick = () => report(0.9 * frac.reduce((a, b) => a + b, 0) / parts.length);
      const models = await Promise.all(parts.map((u, i) => tf.loadLayersModel(u + "/model.json", { onProgress: f => { frac[i] = f; tick(); } })));
      [finder, reader] = models; quarter = meta.align || meta.print ? models[2] : null; printer = meta.print ? models[3] : null;
      if (meta.print) {   // Stage 3: reference gallery
        gallery = await fetch(DIR + "/gallery.json").then(r => r.json());
        gallery.byMark = {}; gallery.entries.forEach(([m, v]) => (gallery.byMark[m] = gallery.byMark[m] || []).push(v));
        // chocolates added from the admin page (custom-chocolates.json): their prints join the gallery under their own key
        try { const cu = await fetch("custom-chocolates.json", { cache: "no-store" }).then(r => r.ok ? r.json() : null);
          if (cu) { gallery.custom = Object.keys(cu.chocolates || {}); (cu.prints || []).forEach(([k, v]) => (gallery.byMark[k] = gallery.byMark[k] || []).push(v)); } } catch (e) {}
      }
      report(0.92);
      // warm up: the first run prepares the phone's graphics chip; reading the result waits until that is really done
      for (const m of [finder, reader, quarter, printer]) if (m) { const out = m.predict(tf.zeros([1, S, S, 3])); await (Array.isArray(out) ? out[0] : out).data(); tf.dispose(out); }
      report(1);
      loadMs = performance.now() - loadStart;
    })();
    return loading;
  }

  // draw a square region of the source (may extend past the edges) onto the 224×224 canvas,
  // optionally turned clockwise by rot degrees about its centre (extra margin is drawn so corners stay filled)
  function grab(source, x, y, size, rot = 0) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, S, S);
    if (!rot) ctx.drawImage(source, x, y, size, size, 0, 0, S, S);
    else {
      const g = size * 1.42, G = S * 1.42;
      ctx.translate(S / 2, S / 2); ctx.rotate(rot * Math.PI / 180);
      ctx.drawImage(source, x + size / 2 - g / 2, y + size / 2 - g / 2, g, g, -G / 2, -G / 2, G, G);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    return tf.browser.fromPixels(canvas).toFloat().div(127.5).sub(1);
  }
  // Square-edge angle (same maths as training/align_lib.js): degrees to turn the picture counter-clockwise to square it up
  // Speed: worked out on a half-size copy (112 px): same accuracy (98-99% within 10°; 0.3° from full size on real close-ups), a quarter of the work
  const E = 112, ecan = document.createElement("canvas"); ecan.width = ecan.height = E;
  const ectx = ecan.getContext("2d", { willReadFrequently: true });
  function edgeAngle() {
    ectx.drawImage(canvas, 0, 0, S, S, 0, 0, E, E);
    { const S = E;   // the loops below run on the small copy
    const d = ectx.getImageData(0, 0, S, S).data, g = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) g[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2];
    const b = new Float32Array(S * S), c = new Float32Array(S * S);
    for (const [src, dst] of [[g, b], [b, c]]) for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
      let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += src[(y + dy) * S + x + dx]; dst[y * S + x] = s / 9;
    }
    let re = 0, im = 0; const sig = 0.35 * S, c0 = S / 2;
    for (let y = 2; y < S - 2; y++) for (let x = 2; x < S - 2; x++) {
      const i = y * S + x;
      const gx = (c[i - S + 1] + 2 * c[i + 1] + c[i + S + 1]) - (c[i - S - 1] + 2 * c[i - 1] + c[i + S - 1]);
      const gy = (c[i + S - 1] + 2 * c[i + S] + c[i + S + 1]) - (c[i - S - 1] + 2 * c[i - S] + c[i - S + 1]);
      const m = Math.hypot(gx, gy); if (m < 1e-3) continue;
      const w = m * Math.exp(-((x - c0) ** 2 + (y - c0) ** 2) / (2 * sig * sig)), phi = Math.atan2(gy, gx);
      re += w * Math.cos(4 * phi); im += w * Math.sin(4 * phi);
    }
    return (Math.atan2(im, re) * 180 / Math.PI) / 4;
  } }
  const readAt = (source, x, y, side, rot) => {
    const crop = grab(source, x, y, side, rot);
    const rd = tf.tidy(() => reader.predict(crop.expandDims(0))); crop.dispose();
    const out = rd.map(t => Array.from(t.dataSync())); tf.dispose(rd); return out;
  };
  // Sharpness of what's on the canvas (variance of the Laplacian, same measure as the test analysis).
  // Below ~45 the pressed number can't be read, so those frames are skipped.
  const LAP = tf.tensor4d([0, 1, 0, 1, -4, 1, 0, 1, 0], [3, 3, 1, 1]);
  const sharpness = () => tf.tidy(() => {
    const g = tf.browser.fromPixels(canvas).toFloat().mul(tf.tensor1d([0.299, 0.587, 0.114])).sum(2).expandDims(0).expandDims(-1);
    return tf.moments(tf.conv2d(g, LAP, 1, "valid")).variance.dataSync()[0];
  });
  // Light on the chocolate (middle half of the close-up): how bright its brighter parts are (90th percentile, 0-255)
  // and the share of blown-out pixels (a reflection). In tests 1-3 every close-up under 56 was read wrong.
  function light() {
    const d = ctx.getImageData(S / 4, S / 4, S / 2, S / 2).data, hist = new Uint32Array(256); let blown = 0;
    for (let i = 0; i < d.length; i += 4) { const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); hist[y]++; if (d[i] >= 250 && d[i + 1] >= 250 && d[i + 2] >= 250) blown++; }
    const n = d.length / 4; let c = 0, p90 = 255; for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= 0.9 * n) { p90 = v; break; } }
    return { p90, glare: blown / n };
  }
  const srcSize = s => ({ w: s.videoWidth || s.naturalWidth || s.width, h: s.videoHeight || s.naturalHeight || s.height });

  // the logic step: chocolate score × shell score × mark score, renormalised
  function combine(pid, psh, pmk) {
    const r = meta.ids.map((k, i) => pid[i] * psh[meta.shells.indexOf(meta.shellOf[k])] * pmk[meta.marks.indexOf(meta.markOf[k])]);
    const sum = r.reduce((a, b) => a + b, 0) || 1;
    return meta.ids.map((k, i) => ({ key: k, p: r[i] / sum })).sort((a, b) => b.p - a.p);
  }

  // Look at one square of the source. Returns { found, obj, box: {cx, cy, size} (0..1 of the square), ranked }
  // stopwatch per step of the latest scan (ms), for the admin speed test; dataSync() waits for the phone's GPU, so these are real
  let times = {}, tl = 0; const lap = k => { const n = performance.now(); times[k] = (times[k] || 0) + n - tl; tl = n; };
  let loadMs = 0, loadStart = 0;
  // Speed (opts.track, live camera only): while someone holds still, the finder runs every other frame (the box is
  // reused in between) and "which side is up" is only re-checked when the angle changes. prev = the last frame's results.
  let prev = null, nFrame = 0;
  function scan(source, sq, opts = {}) {
    times = {}; tl = performance.now(); nFrame++;
    const { w, h } = srcSize(source);
    sq = sq || { x: (w - Math.min(w, h)) / 2, y: (h - Math.min(w, h)) / 2, size: Math.min(w, h) };
    const now = performance.now(), recent = opts.track && prev && now - prev.t < Math.max(250, 3 * prev.dur);
    let obj, cx, cy, bs;
    const reuse = recent && nFrame % 2 === 0;
    if (reuse) ({ obj, cx, cy, bs } = prev.fin);   // reuse the box on alternate frames while holding
    else {
      const fin = tf.tidy(() => finder.predict(grab(source, sq.x, sq.y, sq.size).expandDims(0)));
      obj = fin[0].dataSync()[0]; [cx, cy, bs] = fin[1].dataSync(); tf.dispose(fin);
    }
    if (!opts.track) prev = null;
    const box = { cx, cy, size: Math.max(0.08, bs) }; lap("finder");
    if (obj < 0.5) { prev = null; return { found: false, obj, box }; }
    if (obj < 0.5) return { found: false, obj, box };
    const side = box.size * meta.readerPad * sq.size, x = sq.x + cx * sq.size - side / 2, y = sq.y + cy * sq.size - side / 2;
    grab(source, x, y, side).dispose();
    snapCtx.drawImage(canvas, 0, 0);   // keep the standard close-up (whole chocolate, as seen) for the test log and gallery
    const sharp = sharpness(), lit = light(); lap("crop + sharpness");
    let pid, psh, pmk, rot = 0, qsure = 1;
    if (!quarter) [pid, psh, pmk] = readAt(source, x, y, side, 0);
    else if (!meta.align) {                                    // reader reads as it is; straightening is only for the chocoprint
      [pid, psh, pmk] = readAt(source, x, y, side, 0); lap("reader");
      const e = reuse && prev.e != null ? prev.e : edgeAngle(); lap("straighten (edges)");   // same box as last frame → same angle
      const de = prev ? Math.abs(((e - prev.e) % 90 + 135) % 90 - 45) : 99;   // change in angle since last frame (mod 90)
      let q;
      if (recent && prev.q != null && de < 12 && prev.qsure >= 0.8) { q = prev.q; qsure = prev.qsure; }   // same way up as a moment ago
      else {
        const sqd = grab(source, x, y, side, -e);
        const pq = tf.tidy(() => quarter.predict(sqd.expandDims(0))).dataSync(); sqd.dispose();
        q = [0, 1, 2, 3].sort((a, b) => pq[b] - pq[a])[0]; qsure = pq[q];
      }
      rot = -e + 90 * q; lap("which side is up");
      if (opts.track) prev = { t: performance.now(), dur: performance.now() - now, fin: { obj, cx, cy, bs }, e, q, qsure };
    } else {
      const e = edgeAngle();                                   // 1. square it up
      const sqd = grab(source, x, y, side, -e);
      const pq = tf.tidy(() => quarter.predict(sqd.expandDims(0))).dataSync(); sqd.dispose();
      const order = [0, 1, 2, 3].sort((a, b) => pq[b] - pq[a]); qsure = pq[order[0]];
      const tries = qsure >= 0.9 ? [order[0]] : order.slice(0, 2);   // 2. which side is up (two tries if unsure)
      let best = null;
      for (const q of tries) {
        const r = readAt(source, x, y, side, -e + 90 * q), ranked = combine(...r);
        if (!best || ranked[0].p > best.top) best = { top: ranked[0].p, r, rot: -e + 90 * q };
      }
      [pid, psh, pmk] = best.r; rot = best.rot;
      if (tries.length > 1) grab(source, x, y, side, rot).dispose();   // leave the chosen view on the canvas for the snapshot
    }
    let ranked = combine(pid, psh, pmk), print = null; const m4top = ranked[0].key;
    if (printer) {
      // Stage 3: chocoprint of the straightened, zoomed-in number, compared with the gallery (mean of the 3 closest per mark)
      const z = side * gallery.zoom, zc = grab(source, x + side / 2 - z / 2, y + side / 2 - z / 2, z, rot);
      const v = tf.tidy(() => {
        // black-and-white (shape only) when the chocoprint model was trained that way
        const inp = gallery.gray ? zc.mul(tf.tensor1d([0.299, 0.587, 0.114])).sum(2, true).tile([1, 1, 3]) : zc;
        const e = printer.predict(inp.expandDims(0)); return e.div(tf.norm(e, 2, -1, true).add(1e-9));
      }).dataSync(); zc.dispose(); lap("chocoprint");
      const sims = {};
      for (const [m, refs] of Object.entries(gallery.byMark)) {
        const ss = refs.map(r => { let d = 0; for (let k = 0; k < r.length; k++) d += r[k] * v[k]; return d; }).sort((a, b) => b - a);
        sims[m] = (ss[0] + (ss[1] ?? ss[0]) + (ss[2] ?? ss[0])) / 3;
      }
      const mx = Math.max(...Object.values(sims)), ex = {}; let zsum = 0;
      for (const [m, s2] of Object.entries(sims)) { ex[m] = Math.exp(20 * (s2 - mx)); zsum += ex[m]; }
      const pm = k => ex[k.startsWith("z") ? "z" : k] / zsum;
      const prod = ranked.map(r => ({ key: r.key, p: r.p * pm(r.key) })), t = prod.reduce((a, b) => a + b.p, 0) || 1;
      const order = Object.entries(sims).sort((a, b) => b[1] - a[1]);
      print = { mark: order[0][0], sim: order[0][1], gap: order[0][1] - order[1][1], vec: Array.from(v) };
      ranked = prod.map(r => ({ key: r.key, p: r.p / t })).sort((a, b) => b.p - a.p);
      // an added chocolate isn't known to the classifier, so it is recognised by its print alone, and only when clearly closest
      if ((gallery.custom || []).includes(print.mark) && print.sim >= 0.6 && print.gap >= 0.08)
        ranked = [{ key: print.mark, p: 0.9 }, ...ranked.map(r => ({ key: r.key, p: r.p * 0.1 }))];
      lap("gallery compare");
    }
    return { found: true, obj, box, sharp, light: lit, rot, qsure, print, m4top, ranked, shell: meta.shells[psh.indexOf(Math.max(...psh))], mark: meta.marks[pmk.indexOf(Math.max(...pmk))] };
  }

  // For still photos: try a few squares along the long side and keep the most confident result
  function scanPhoto(img) {
    const { w, h } = srcSize(img), side = Math.min(w, h), long = Math.max(w, h), out = [];
    for (const f of [0.5, 0.25, 0.75]) {
      const off = Math.max(0, Math.min(long - side, f * long - side / 2));
      const r = scan(img, w >= h ? { x: off, y: 0, size: side } : { x: 0, y: off, size: side });
      if (r.found) out.push(r);
    }
    return out.sort((a, b) => b.ranked[0].p - a.ranked[0].p)[0] || null;
  }

  // the last close-up the reader looked at (for the debug test log)
  // The standard close-up of the latest scan: the whole chocolate with its margin, unturned, in colour. (The canvas itself
  // may end up holding the zoomed, straightened view used for the chocoprint, which isn't what tests and the gallery need.)
  const snapCan = document.createElement("canvas"); snapCan.width = snapCan.height = S; const snapCtx = snapCan.getContext("2d");
  const snapshot = () => snapCan.toDataURL("image/jpeg", 0.85);

  return { load, scan, scanPhoto, snapshot, get meta() { return meta; }, get hasPrints() { return !!printer; }, get times() { return times; }, get loadMs() { return loadMs; }, get model() { return DIR; }, get ready() { return !!reader && loadMs > 0; }, get backend() { return tf.getBackend(); } };
})();
