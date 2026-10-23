// zScanner "WHICH SIDE IS UP" trainer. After the edge maths (align_lib.js) has squared the chocolate up, this model picks
// which of the 4 sides is the top (0 = upright, 1/2/3 = turned 90/180/270° anticlockwise). Learns from the generated
// images (exact angles known) with random extra quarter turns; checked on the held-back test session's close-ups
// (scanned upright) turned by known quarters.  Usage: OUT=/path node training/train_quarter.js   (EPOCHS=8)
const { fs, path, tf, S, CONFIG, at, rnd, between, shuffle, toTensor } = require("./lib/common.js");
const { view, jitter } = require("./lib/view.js");
const { backbone } = require("./lib/models.js");
const { sessions } = require("./lib/data.js");
const { edgeAngle } = require("./align_lib.js");
const OUT = path.resolve(process.env.OUT || at("experiments/quarter-new")), EPOCHS = +(process.env.EPOCHS || 8), BATCH = 32;
const wrap90 = a => { let w = ((a % 90) + 90) % 90; return w > 45 ? w - 90 : w; };
const SYN = at(CONFIG.synth), boxes = JSON.parse(fs.readFileSync(path.join(SYN, "boxes.json"))), angles = {};
for (const f of fs.readdirSync(SYN)) if (/^angles_/.test(f)) Object.assign(angles, JSON.parse(fs.readFileSync(path.join(SYN, f))));
const train = Object.keys(angles).filter(r => boxes[r]).map(r => ({ file: path.join(SYN, r), box: boxes[r], ang: angles[r] }));
const HELD = process.env.HOLD_TEST || sessions().heldBack[0], CD = at(path.join(CONFIG.tests, HELD, "closeup")), real = [];
for (const k of fs.readdirSync(CD)) for (const f of fs.readdirSync(path.join(CD, k))) real.push({ file: path.join(CD, k, f) });
console.log(`which-side-up model: ${train.length} generated images to learn from, ${real.length} ${HELD} close-ups × 4 turns to check`);

function crop(a, aug) {
  const [x0, y0, x1, y1] = a.box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, side = Math.max(x1 - x0, y1 - y0);
  return aug ? [cx + between(-.1, .1) * side, cy + between(-.1, .1) * side, side * between(1.15, 1.6)] : [cx, cy, side * 1.35];
}
async function synthBatch(list) {
  const ks = list.map(() => Math.floor(rnd() * 4)), q0 = list.map(a => ((Math.round(a.ang / 90) % 4) + 4) % 4);
  const bufs = await Promise.all(list.map((a, i) => {
    const j = jitter(false); j.angle = wrap90(a.ang) - 90 * ks[i] + between(-8, 8);   // sharp turns clockwise
    const [cx, cy, s] = crop(a, true); return view(a.file, cx, cy, s, j);
  }));
  return { x: toTensor(bufs), y: tf.oneHot(list.map((a, i) => (q0[i] + ks[i]) % 4), 4).toFloat() };
}
// the phone's steps on a real close-up: square it up with the edge maths, then turn it by k quarters
async function realBatch(list, k) {
  return toTensor(await Promise.all(list.map(async a => {
    const e = edgeAngle(new Uint8Array(await view(a.file, 0.5, 0.5, 1.0, {})), S).angle;
    return view(a.file, 0.5, 0.5, 1.0, { angle: -e - 90 * k });
  })));
}
(async () => {
  const base = await backbone();
  const x = tf.layers.globalAveragePooling2d({}).apply(base.outputs[0]);
  const out = tf.layers.dense({ units: 4, activation: "softmax", name: "quarter" }).apply(tf.layers.dense({ units: 128, activation: "relu", name: "quarter_h" }).apply(x));
  const model = tf.model({ inputs: base.inputs, outputs: out });
  const baseLayers = model.layers.filter(l => !/^quarter/.test(l.name) && !/global_average/.test(l.name));
  const xent = (p, y) => tf.neg(tf.sum(tf.mul(y, tf.log(tf.clipByValue(p, 1e-7, 1))), 1)).mean();
  let opt = tf.train.adam(1e-3);
  async function check() {
    let ok = 0, n = 0, sure = 0, sureOk = 0;
    for (let k = 0; k < 4; k++) for (let i = 0; i < real.length; i += 16) {
      const xb = await realBatch(real.slice(i, i + 16), k); const p = model.predict(xb).arraySync(); xb.dispose();
      p.forEach(v => { const q = v.indexOf(Math.max(...v)); n++; if (q === k) ok++; if (Math.max(...v) > .9) { sure++; if (q === k) sureOk++; } });
    }
    return `${HELD} close-ups: ${Math.round(100 * ok / n)}% right side up (${n}); when >90% sure: ${Math.round(100 * sureOk / Math.max(1, sure))}% of ${sure}`;
  }
  for (let ep = 0; ep < EPOCHS; ep++) {
    const warm = ep < 1; baseLayers.forEach(l => l.trainable = !warm);
    if (!warm) { if (ep === 1) opt.dispose(); opt = tf.train.adam(3e-4 * (1 - ep / EPOCHS) + 2e-5); }
    const order = shuffle(train.slice()); let sum = 0, n = 0; const t0 = Date.now();
    for (let i = 0; i < order.length; i += BATCH) {
      const { x, y } = await synthBatch(order.slice(i, i + BATCH));
      const cost = opt.minimize(() => xent(model.apply(x, { training: false }), y), true);
      sum += cost.dataSync()[0]; n++; tf.dispose([x, y, cost]);
      if (process.env.STEPS && n >= +process.env.STEPS) break;
    }
    console.log(`which-side-up round ${ep + 1}/${EPOCHS}: loss ${(sum / n).toFixed(3)} (${Math.round((Date.now() - t0) / 1000)}s) | ${await check()}`);
  }
  fs.mkdirSync(OUT, { recursive: true }); await model.save("file://" + OUT); console.log("saved to", OUT);
})().catch(e => { console.error(e); process.exit(1); });
