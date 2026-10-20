// On-device chocolate recogniser.
// MobileNet (vendor/mobilenet) turns a 224×224 picture into a fingerprint;
// the trained head (model/head) turns the fingerprint into a score per chocolate.
// Everything runs in the browser: no photo ever leaves the phone.
window.Recognizer = (() => {
  let base = null, head = null, labels = null, loading = null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 224;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  function load() {
    if (!loading) loading = (async () => {
      await tf.ready();
      const [b, h, l] = await Promise.all([
        tf.loadGraphModel("vendor/mobilenet/model.json"),
        tf.loadLayersModel("model/head/model.json"),
        fetch("model/labels.json").then(r => r.json())
      ]);
      base = b; head = h; labels = l.labels;
      tf.tidy(() => head.predict(base.predict(tf.zeros([1, 224, 224, 3])))); // warm up
    })();
    return loading;
  }

  // source: <video>, <img> or <canvas>; box: {x, y, size} in source pixels
  function classify(source, box) {
    ctx.drawImage(source, box.x, box.y, box.size, box.size, 0, 0, 224, 224);
    const scores = tf.tidy(() => {
      const x = tf.browser.fromPixels(canvas).toFloat().div(255).expandDims(0);
      const f = base.predict(x);
      return head.predict(f.div(f.norm("euclidean", 1, true))).dataSync();
    });
    return Array.from(scores).map((p, i) => ({ key: labels[i], p })).sort((a, b) => b.p - a.p);
  }

  // Several windows of one picture in a single batch (much faster than one at a time).
  // Returns the ranked scores of the window the model is most confident about.
  function classifyBest(source, boxes) {
    const pics = boxes.map(b => { ctx.drawImage(source, b.x, b.y, b.size, b.size, 0, 0, 224, 224); return tf.browser.fromPixels(canvas); });
    const out = tf.tidy(() => {
      const x = tf.stack(pics).toFloat().div(255);
      const f = base.predict(x);
      return head.predict(f.div(f.norm("euclidean", 1, true)));
    });
    pics.forEach(t => t.dispose());
    const all = out.arraySync(); out.dispose();
    let bestRow = all[0];
    for (const row of all) if (Math.max(...row) > Math.max(...bestRow)) bestRow = row;
    return bestRow.map((p, i) => ({ key: labels[i], p })).sort((a, b) => b.p - a.p);
  }

  return { load, classify, classifyBest, get ready() { return !!head; }, get backend() { return tf.getBackend(); } };
})();
