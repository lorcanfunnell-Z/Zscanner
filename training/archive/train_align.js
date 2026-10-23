// zScanner Stage 2: the ALIGNER. Like face alignment, it works out which way up the number is, so the reader can
// be shown the chocolate straightened. Learns from the design-based synthetic photos, whose rotation is known.
// Output: (cos, sin) of the counter-clockwise angle the chocolate is turned by. The app rotates the close-up back.
// Usage: OUT=/path node training/train_align.js      (EPOCHS=10)
const fs = require("fs"), path = require("path"), tf = require("@tensorflow/tfjs-node"), sharp = require("sharp");
const ROOT = path.join(__dirname, ".."), SYN = path.join(ROOT, "training-synth"), S = 224, BATCH = 32;
const OUT = path.resolve(process.env.OUT || path.join(ROOT, "app", "aligner"));
const EPOCHS = +(process.env.EPOCHS || 10), PAD = 1.35;
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296), between = (a, b) => a + (b - a) * rnd();
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Crop a square region (centre cx,cy and side, in fractions of the photo; may go past the edge, which is mirrored),
// rotate it, adjust light, and return 224x224 RGB bytes.
async function view(file, cx, cy, side, { angle = 0, light = 1, sat = 1, hue = 0, blur = 0, jpeg = 0, ...fx } = {}) {
  const meta = await sharp(file).metadata(), W = meta.width, H = meta.height, pad = Math.round(Math.max(W, H) * 0.8);
  const grow = angle ? 1.42 : 1;                       // take a bigger square first so rotating leaves no empty corners
  const ps = Math.max(8, Math.round(side * W * grow));
  const big = await sharp(file).extend({ top: pad, bottom: pad, left: pad, right: pad, extendWith: "mirror" }).raw().toBuffer({ resolveWithObject: true });
  let px = Math.round(cx * W - ps / 2) + pad, py = Math.round(cy * H - ps / 2) + pad;
  px = Math.max(0, Math.min(px, big.info.width - ps)); py = Math.max(0, Math.min(py, big.info.height - ps));
  const R = Math.round(S * grow);
  let out = await sharp(big.data, { raw: big.info }).extract({ left: px, top: py, width: ps, height: ps }).resize(R, R).raw().toBuffer({ resolveWithObject: true });
  if (angle) {
    const rot = await sharp(out.data, { raw: out.info }).rotate(angle, { background: "#808080" }).raw().toBuffer({ resolveWithObject: true });
    out = await sharp(rot.data, { raw: rot.info }).extract({ left: Math.floor((rot.info.width - S) / 2), top: Math.floor((rot.info.height - S) / 2), width: S, height: S }).raw().toBuffer({ resolveWithObject: true });
  }
  let img = sharp(out.data, { raw: out.info }).modulate({ brightness: light, saturation: sat, hue: Math.round(hue) });
  if (fx.gamma) img = img.gamma(fx.gamma);                                    // harsh vs flat light
  if (fx.contrast) img = img.linear(fx.contrast, 128 * (1 - fx.contrast));
  if (fx.shadow || fx.glare) {                                                 // hard shadow edge across the chocolate / sun reflection
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">` +
      (fx.shadow ? `<polygon points="${fx.shadow.map(p => p.join(",")).join(" ")}" fill="black" fill-opacity="${fx.shadowAlpha}"/>` : "") +
      (fx.glare ? `<defs><radialGradient id="g"><stop offset="0" stop-color="white" stop-opacity="${fx.glare[3]}"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient></defs><circle cx="${fx.glare[0]}" cy="${fx.glare[1]}" r="${fx.glare[2]}" fill="url(#g)"/>` : "") + `</svg>`;
    const flat = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const done = await sharp(flat.data, { raw: flat.info }).composite([{ input: Buffer.from(svg), blend: "over" }]).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    img = sharp(done.data, { raw: done.info });
  }
  if (fx.lowres) { const small = await img.resize(fx.lowres, fx.lowres).png().toBuffer(); img = sharp(small).resize(S, S); }
  if (fx.sharpen) img = img.sharpen({ sigma: fx.sharpen });
  if (blur > 0.3) img = img.blur(blur);
  if (jpeg) { const j = await img.jpeg({ quality: jpeg }).toBuffer(); img = sharp(j); }
  return img.removeAlpha().resize(S, S).raw().toBuffer();
}
const toTensor = bufs => tf.tidy(() => tf.stack(bufs.map(b => tf.tensor3d(new Uint8Array(b), [S, S, 3]))).toFloat().div(127.5).sub(1));
const jitter = hard => {
  const j = { angle: between(-180, 180), light: between(.55, 1.45), sat: between(.8, 1.2), hue: between(-6, 6), blur: rnd() < .3 ? between(.3, 1.4) : 0, jpeg: rnd() < .4 ? Math.round(between(40, 85)) : 0 };
  if (rnd() < .5) j.gamma = between(1.0, 2.2);                 // sharp's gamma: >1 = harsher, more contrasty light
  if (rnd() < .5) j.contrast = between(.75, 1.6);
  if (rnd() < .4) { const a = between(0, Math.PI * 2), c = [S / 2 + Math.cos(a) * between(-60, 60), S / 2 + Math.sin(a) * between(-60, 60)], d = [Math.cos(a + Math.PI / 2) * 400, Math.sin(a + Math.PI / 2) * 400], o = [Math.cos(a) * 400, Math.sin(a) * 400];
    j.shadow = [[c[0] - d[0], c[1] - d[1]], [c[0] + d[0], c[1] + d[1]], [c[0] + d[0] + o[0], c[1] + d[1] + o[1]], [c[0] - d[0] + o[0], c[1] - d[1] + o[1]]]; j.shadowAlpha = between(.25, .6); }
  if (rnd() < .3) j.glare = [between(40, 184), between(40, 184), between(25, 80), between(.25, .7)];
  if (rnd() < .3) j.lowres = Math.round(between(60, 140));    // a small, far-away chocolate
  else if (rnd() < .5) j.sharpen = between(.8, 2.2);          // the very sharp live camera close-ups
  return j;
};

// The reader sees a square around the chocolate (like the app does after the finder has found it)
function readerCrop(a, aug) {
  const [x0, y0, x1, y1] = a.box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, side = Math.max(x1 - x0, y1 - y0);
  return aug ? [cx + between(-.12, .12) * side, cy + between(-.12, .12) * side, side * between(1.15, 1.6)] : [cx, cy, side * 1.35];
}

const boxes = JSON.parse(fs.readFileSync(path.join(SYN, "boxes.json"))), angles = {};
for (const f of fs.readdirSync(SYN)) if (/^angles_/.test(f)) Object.assign(angles, JSON.parse(fs.readFileSync(path.join(SYN, f))));
const items = Object.keys(angles).filter(r => boxes[r]).map(r => ({ file: path.join(SYN, r), box: boxes[r], ang: angles[r], name: r }));
shuffle(items); const nTest = 200, test = items.slice(0, nTest), train = items.slice(nTest);
console.log(`aligner: ${train.length} train, ${test.length} test`);
const rad = d => d * Math.PI / 180;
async function batch(list, aug) {
  const js = list.map(() => aug ? jitter(false) : {});
  js.forEach(j => { if (j.angle === undefined) j.angle = 0; });
  const bufs = await Promise.all(list.map((a, i) => { const [cx, cy, s] = readerCrop(a, aug); return view(a.file, cx, cy, s, js[i]); }));
  // sharp rotates clockwise, so the chocolate ends up turned by (synth angle - jitter angle) counter-clockwise
  const y = tf.tensor2d(list.map((a, i) => { const t = rad(a.ang - js[i].angle); return [Math.cos(t), Math.sin(t)]; }));
  return { x: toTensor(bufs), y };
}
const angLoss = (p, y) => { const n = tf.sqrt(tf.sum(tf.square(p), 1).add(1e-6)); return tf.scalar(1).sub(tf.sum(tf.mul(p, y), 1).div(n)).mean(); };
(async () => {
  const base = await tf.loadLayersModel("file://" + path.join(ROOT, "app/vendor/mnv2/model.json"));
  const x = tf.layers.globalAveragePooling2d({}).apply(base.outputs[0]);
  const out = tf.layers.dense({ units: 2, name: "angle" }).apply(tf.layers.dense({ units: 128, activation: "relu", name: "angle_h" }).apply(x));
  const model = tf.model({ inputs: base.inputs, outputs: out });
  const baseLayers = model.layers.filter(l => !/^angle/.test(l.name) && !/global_average/.test(l.name));
  let opt = tf.train.adam(1e-3);
  for (let ep = 0; ep < EPOCHS; ep++) {
    const warm = ep < 2; baseLayers.forEach(l => l.trainable = !warm);
    if (!warm) { if (ep === 2) opt.dispose(); opt = tf.train.adam(3e-4 * (1 - ep / EPOCHS) + 2e-5); }
    const order = shuffle(train.slice()); let sum = 0, n = 0; const t0 = Date.now();
    for (let i = 0; i < order.length; i += BATCH) {
      const { x, y } = await batch(order.slice(i, i + BATCH), true);
      const cost = opt.minimize(() => angLoss(model.apply(x, { training: false }), y), true);
      sum += cost.dataSync()[0]; n++; tf.dispose([x, y, cost]);
    }
    // check: share of held-out synthetic photos straightened to within 20 degrees
    let ok = 0, errs = [];
    for (let i = 0; i < test.length; i += 25) {
      const { x, y } = await batch(test.slice(i, i + 25), true);
      const p = model.predict(x).arraySync(), t = y.arraySync(); tf.dispose([x, y]);
      p.forEach((v, k) => { let d = Math.abs(Math.atan2(v[1], v[0]) - Math.atan2(t[k][1], t[k][0])) * 180 / Math.PI; d = Math.min(d, 360 - d); errs.push(d); if (d <= 20) ok++; });
    }
    errs.sort((a, b) => a - b);
    console.log(`aligner epoch ${ep + 1}/${EPOCHS}: loss ${(sum / n).toFixed(3)} | within 20°: ${Math.round(100 * ok / test.length)}% | median error ${errs[errs.length >> 1].toFixed(1)}° (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
  fs.mkdirSync(OUT, { recursive: true }); await model.save("file://" + OUT); console.log("saved to", OUT);
})().catch(e => { console.error(e); process.exit(1); });
