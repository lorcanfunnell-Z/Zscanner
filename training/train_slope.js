// SLOPE finder (25 Nov, Julien's idea): which side of the chocolate is the sloped one - top, right, bottom or left of
// the picture. The chocolate has one sloped side (his measured 3D model, app/choc3d/chocolat.json), and Lorcan always
// places pieces with it away from him, so every saved photo shows it at the top: turning a photo by a quarter turn k
// gives a free example of "slope at k". Trained on training-photos (and the non-held test scans), judged on every
// held-back session's close-ups turned all four ways. Caveat: in these photos the light also comes from roughly the
// same side, so the real test is photos of chocolates actually turned on the table (the reference round).
// Usage: PATH="$HOME/.local/node20/bin:$PATH" node training/train_slope.js     (OUT=experiments/slope, EPOCHS=10)
const { fs, path, tf, at, rnd, between, shuffle, toTensor } = require("./lib/common.js");
const { view } = require("./lib/view.js");
const { readerCrop } = require("./lib/crops.js");
const { loadData } = require("./lib/data.js");
const OUT = path.resolve(process.env.OUT || at("experiments/slope")), EPOCHS = +(process.env.EPOCHS || 10), BATCH = 32;
const { train } = loadData({ synth: false, tests: true, quiet: true });
const items = train.filter(a => a.cls !== "none" && Array.isArray(a.box));
const held = JSON.parse(fs.readFileSync(at("training/sessions.json"))).heldBack;
const heldFiles = held.flatMap(s => { const d = at(`tests/${s}/closeup`); return fs.existsSync(d) ? fs.readdirSync(d).flatMap(c => fs.readdirSync(path.join(d, c)).map(f => ({ file: path.join(d, c, f), cls: c, sess: s }))) : []; });
function model() {
  const m = tf.sequential();
  m.add(tf.layers.averagePooling2d({ inputShape: [224, 224, 3], poolSize: 2 }));
  for (const f of [16, 32, 48, 64, 64]) { m.add(tf.layers.conv2d({ filters: f, kernelSize: 3, strides: 2, padding: "same", activation: "relu" })); m.add(tf.layers.batchNormalization({ momentum: .9 })); }
  m.add(tf.layers.globalAveragePooling2d({})); m.add(tf.layers.dropout({ rate: .2 })); m.add(tf.layers.dense({ units: 4, activation: "softmax" }));
  m.compile({ optimizer: tf.train.adam(1e-3), loss: "categoricalCrossentropy", metrics: ["accuracy"] });
  return m;
}
const aug = k => ({ angle: k * 90 + between(-20, 20) || 0.1, light: between(.6, 1.4), sat: between(.8, 1.2), hue: between(-6, 6), ...(rnd() < .3 ? { blur: between(.3, 1.2) } : {}) });
async function evalHeld(m, label = "") {
  const tot = [0, 0], by69 = [0, 0], perK = [0, 0, 0, 0];
  for (let i = 0; i < heldFiles.length; i += 16) {
    const b = heldFiles.slice(i, i + 16);
    for (let k = 0; k < 4; k++) {
      const x = toTensor(await Promise.all(b.map(a => view(a.file, .5, .5, 1, { angle: k * 90 || 0.1 }))));   // always through the turn path, framed exactly like training
      const p = tf.tidy(() => m.predict(x).argMax(1)).arraySync(); tf.dispose(x);
      b.forEach((a, j) => { const ok = p[j] === k; tot[0] += ok; tot[1]++; perK[k] += ok; if (a.cls === "6" || a.cls === "9") { by69[0] += ok; by69[1]++; } });
    }
  }
  console.log(`${label}held-back close-ups turned four ways: slope side right ${tot[0]}/${tot[1]} (${(100 * tot[0] / tot[1]).toFixed(1)}%); by turn ${perK.join("/")} of ${tot[1] / 4}; N°6 and N°9 ${by69[0]}/${by69[1]}`);
  return tot[0] / tot[1];
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`training photos: ${items.length}; held-back close-ups: ${heldFiles.length} from ${held.join(", ")}`);
  const m = model();
  for (let ep = 0; ep < EPOCHS; ep++) {
    const order = shuffle(items.slice()); let loss = 0, n = 0;
    for (let i = 0; i < order.length; i += BATCH) {
      const b = order.slice(i, i + BATCH), ks = b.map(() => Math.floor(rnd() * 4));
      const x = toTensor(await Promise.all(b.map((a, j) => { const [cx, cy, s] = readerCrop(a, true); return view(a.file, cx, cy, s, aug(ks[j])); })));
      const y = tf.oneHot(tf.tensor1d(ks, "int32"), 4).toFloat();
      const h = await m.trainOnBatch(x, y); loss += h[0]; n++; tf.dispose([x, y]);
    }
    console.log(`round ${ep + 1}/${EPOCHS}: loss ${(loss / n).toFixed(3)}`);
    if (ep === EPOCHS - 1 || ep % 3 === 2) await evalHeld(m, `  after round ${ep + 1}: `);
  }
  await m.save("file://" + path.join(OUT, "model"));
})();
