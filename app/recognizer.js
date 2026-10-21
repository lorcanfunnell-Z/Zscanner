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
  const DIR = "model4";   // admin tries a candidate model here once it beats model 4 on the fair check
  let finder = null, reader = null, quarter = null, meta = null, loading = null;
  const S = 224;
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  function load() {
    if (!loading) loading = (async () => {
      await tf.ready();
      [finder, reader, meta] = await Promise.all([
        tf.loadLayersModel(DIR + "/finder/model.json"),
        tf.loadLayersModel(DIR + "/reader/model.json"),
        fetch(DIR + "/meta.json").then(r => r.json())
      ]);
      if (meta.align) quarter = await tf.loadLayersModel(DIR + "/quarter/model.json");
      tf.tidy(() => { finder.predict(tf.zeros([1, S, S, 3])); reader.predict(tf.zeros([1, S, S, 3])); if (quarter) quarter.predict(tf.zeros([1, S, S, 3])); }); // warm up
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
  function edgeAngle() {
    const d = ctx.getImageData(0, 0, S, S).data, g = new Float32Array(S * S);
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
  }
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
  const srcSize = s => ({ w: s.videoWidth || s.naturalWidth || s.width, h: s.videoHeight || s.naturalHeight || s.height });

  // the logic step: chocolate score × shell score × mark score, renormalised
  function combine(pid, psh, pmk) {
    const r = meta.ids.map((k, i) => pid[i] * psh[meta.shells.indexOf(meta.shellOf[k])] * pmk[meta.marks.indexOf(meta.markOf[k])]);
    const sum = r.reduce((a, b) => a + b, 0) || 1;
    return meta.ids.map((k, i) => ({ key: k, p: r[i] / sum })).sort((a, b) => b.p - a.p);
  }

  // Look at one square of the source. Returns { found, obj, box: {cx, cy, size} (0..1 of the square), ranked }
  function scan(source, sq) {
    const { w, h } = srcSize(source);
    sq = sq || { x: (w - Math.min(w, h)) / 2, y: (h - Math.min(w, h)) / 2, size: Math.min(w, h) };
    const fin = tf.tidy(() => finder.predict(grab(source, sq.x, sq.y, sq.size).expandDims(0)));
    const obj = fin[0].dataSync()[0], [cx, cy, bs] = fin[1].dataSync(); tf.dispose(fin);
    const box = { cx, cy, size: Math.max(0.08, bs) };
    if (obj < 0.5) return { found: false, obj, box };
    const side = box.size * meta.readerPad * sq.size, x = sq.x + cx * sq.size - side / 2, y = sq.y + cy * sq.size - side / 2;
    grab(source, x, y, side).dispose();
    const sharp = sharpness();
    let pid, psh, pmk, rot = 0, qsure = 1;
    if (!quarter) [pid, psh, pmk] = readAt(source, x, y, side, 0);
    else {
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
    return { found: true, obj, box, sharp, rot, qsure, ranked: combine(pid, psh, pmk), shell: meta.shells[psh.indexOf(Math.max(...psh))], mark: meta.marks[pmk.indexOf(Math.max(...pmk))] };
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
  const snapshot = () => canvas.toDataURL("image/jpeg", 0.85);

  return { load, scan, scanPhoto, snapshot, get meta() { return meta; }, get model() { return DIR; }, get ready() { return !!reader; }, get backend() { return tf.getBackend(); } };
})();
