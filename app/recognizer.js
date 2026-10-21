// zScanner recogniser v2, all on the phone.
// 1. FINDER looks at the whole camera square and says whether there is a chocolate and where it is.
// 2. READER looks closely at that spot and gives three opinions: which chocolate, which shell colour
//    (dark / milk / white / milk-and-white) and which kind of mark (one digit / two digits / z).
// 3. LOGIC: the three opinions are multiplied together, so a chocolate is only likely if its number,
//    its shell and its mark all agree. A dark two-digit chocolate can only be 10, 13, 15, 17, 18, 19, 21 or 23.
window.Recognizer = (() => {
  let finder = null, reader = null, meta = null, loading = null;
  const S = 224;
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  function load() {
    if (!loading) loading = (async () => {
      await tf.ready();
      [finder, reader, meta] = await Promise.all([
        tf.loadLayersModel("model3/finder/model.json"),
        tf.loadLayersModel("model3/reader/model.json"),
        fetch("model3/meta.json").then(r => r.json())
      ]);
      tf.tidy(() => { finder.predict(tf.zeros([1, S, S, 3])); reader.predict(tf.zeros([1, S, S, 3])); }); // warm up
    })();
    return loading;
  }

  // draw a square region of the source (may extend past the edges) onto the 224×224 canvas
  function grab(source, x, y, size) {
    ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, S, S);
    ctx.drawImage(source, x, y, size, size, 0, 0, S, S);
    return tf.browser.fromPixels(canvas).toFloat().div(127.5).sub(1);
  }
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
    const side = box.size * meta.readerPad * sq.size;
    const crop = grab(source, sq.x + cx * sq.size - side / 2, sq.y + cy * sq.size - side / 2, side);
    const sharp = sharpness();
    const rd = tf.tidy(() => reader.predict(crop.expandDims(0))); crop.dispose();
    const [pid, psh, pmk] = rd.map(t => Array.from(t.dataSync())); tf.dispose(rd);
    return { found: true, obj, box, sharp, ranked: combine(pid, psh, pmk), shell: meta.shells[psh.indexOf(Math.max(...psh))], mark: meta.marks[pmk.indexOf(Math.max(...pmk))] };
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

  return { load, scan, scanPhoto, snapshot, get ready() { return !!reader; }, get backend() { return tf.getBackend(); } };
})();
