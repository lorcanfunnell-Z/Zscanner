// On-device chocolate recogniser.
// MobileNet (vendor/mobilenet) turns a 224×224 picture into a fingerprint;
// the trained head (model/head) turns the fingerprint into a score per chocolate.
// Everything runs in the browser: no photo ever leaves the phone.
window.Recognizer = (() => {
  let base = null, head = null, headTight = null, labels = null, loading = null;
  // Two classifiers: one sees the whole framing square, one is zoomed in on the middle (the pressed number).
  // Their scores are averaged, which tested more accurate than either alone.
  const TIGHT = 0.425 / 0.70; // zoomed view as a share of the framing square
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 224;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  function load() {
    if (!loading) loading = (async () => {
      await tf.ready();
      const [b, h, ht, l] = await Promise.all([
        tf.loadGraphModel("vendor/mobilenet/model.json"),
        tf.loadLayersModel("model/head/model.json"),
        tf.loadLayersModel("model/head-tight/model.json"),
        fetch("model/labels.json").then(r => r.json())
      ]);
      base = b; head = h; headTight = ht; labels = l.labels;
      tf.tidy(() => head.predict(base.predict(tf.zeros([1, 224, 224, 3])))); // warm up
    })();
    return loading;
  }

  const inner = b => { const s = b.size * TIGHT; return { x: b.x + (b.size - s) / 2, y: b.y + (b.size - s) / 2, size: s }; };
  // Scores each box with both classifiers and returns one averaged probability row per box
  function score(source, boxes) {
    const grab = b => { ctx.drawImage(source, b.x, b.y, b.size, b.size, 0, 0, 224, 224); return tf.browser.fromPixels(canvas); };
    const wide = boxes.map(grab), tight = boxes.map(b => grab(inner(b)));
    const out = tf.tidy(() => {
      const emb = list => { const f = base.predict(tf.stack(list).toFloat().div(255)); return f.div(f.norm("euclidean", 1, true)); };
      return head.predict(emb(wide)).add(headTight.predict(emb(tight))).div(2);
    });
    [...wide, ...tight].forEach(t => t.dispose());
    const rows = out.arraySync(); out.dispose();
    return rows;
  }
  const rank = row => row.map((p, i) => ({ key: labels[i], p })).sort((a, b) => b.p - a.p);

  // source: <video>, <img> or <canvas>; box: {x, y, size} in source pixels
  function classify(source, box) { return rank(score(source, [box])[0]); }

  // Several windows of one picture in a single batch (much faster than one at a time).
  // Returns the ranked scores of the window the model is most confident about.
  function classifyBest(source, boxes) {
    const all = [];
    for (let i = 0; i < boxes.length; i += 8) all.push(...score(source, boxes.slice(i, i + 8))); // batches of 8 keep phone memory low
    const real = row => Math.max(...row.filter((_, i) => labels[i] !== "none"));
    let bestRow = all[0];
    for (const row of all) if (real(row) > real(bestRow)) bestRow = row;
    return rank(bestRow);
  }

  return { load, classify, classifyBest, get ready() { return !!head; }, get backend() { return tf.getBackend(); } };
})();
