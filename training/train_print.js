// zScanner CHOCOPRINT trainer: a model that turns the straightened, zoomed-in number into a 128-number fingerprint
// ("chocoprint"). Same chocolate → similar print; lookalikes pushed apart. The three Z chocolates share one mark ("z");
// their shell decides which Z. Also builds the reference gallery and checks it on the held-back test session.
//
// Defaults = the model 6.1 recipe: ArcFace, black and white, lookalike pairs + mining, tougher lighting, generated images
// and the non-held test scans. So:   OUT=/path/to/new-model node training/train_print.js
// Switches (all optional): LOSS=triplet  GRAY=0  HARDPAIRS=0  HARSHAUG=0  SYNTH=0  TESTS=0  EPOCHS_R=12  STEPS=120
//                          TILT=0.5 (share of pictures seen from a tilted camera, added after test 4; default 0 = 6.1 recipe)
//                          HOLD_TEST=test-3 (default: training/sessions.json)  RESUME=1 (carry on after a restart)
const { fs, path, tf, ROOT, ZOOM, MKS, mk, rnd, shuffle, toTensor } = require("./lib/common.js");
const { zoomView } = require("./lib/crops.js");
const { loadData, attachRotations } = require("./lib/data.js");
const { backbone } = require("./lib/models.js");
const flag = (k, d) => process.env[k] === undefined ? d : process.env[k] === "1";
const OUT = path.resolve(process.env.OUT || path.join(ROOT, "experiments", "print-new"));
const EPOCHS_R = +(process.env.EPOCHS_R || 12), STEPS = +(process.env.STEPS || 120), EMB = 128;
const LOSS = process.env.LOSS || "arcface", GRAY = flag("GRAY", true), HARSHAUG = flag("HARSHAUG", true);
if (process.env.HARDPAIRS === undefined) process.env.HARDPAIRS = "1";
const ZV = { gray: GRAY, harsh: HARSHAUG, tilt: +(process.env.TILT || 0) };
const hold = process.env.HOLD_TEST ? process.env.HOLD_TEST.split(",").filter(Boolean) : undefined;
const { train, test, testScans, heldScans, hold: HOLD } = loadData({ synth: flag("SYNTH", true), tests: flag("TESTS", true), hold });
// lookalike groups (always mixed in) — the confusion-map pairs come from training/hard-pairs.json
const GROUPS = [["16", "18", "19", "21", "12"], ["6", "9", "5", "3", "8"], ["14", "20", "24", "22", "4", "2"], ["15", "13", "23", "17", "10", "1", "7", "11"], ["z", "0"]];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // which way up each real photo is (same steps as the phone; cached in training/rot-cache.json)
  await attachRotations([...train, ...test, ...testScans], process.env.QUARTER);
  const pool = {}; for (const m of MKS) pool[m] = { real: [], syn: [] };
  for (const a of train) if (a.cls !== "none" && Array.isArray(a.box)) pool[mk(a.cls)][a.synth ? "syn" : "real"].push(a);
  console.log("training prints:", MKS.map(m => `${m}:${pool[m].real.length}r/${pool[m].syn.length}s`).join(" "));
  const pick = m => { const p = pool[m]; const src = p.real.length && (rnd() < .55 || !p.syn.length) ? p.real : p.syn; return src[Math.floor(rnd() * src.length)]; };
  // P classes x K photos per batch; lookalike groups are put together half the time (hard pairs)
  // Stage 4 (HARDPAIRS=1): lookalike pairs from the confusion map, plus pairs whose prints sit closest (re-mined every round)
  const HARDP = process.env.HARDPAIRS === "1" ? JSON.parse(fs.readFileSync(path.join(ROOT, "training", "hard-pairs.json"))).map(([a, b, w]) => [mk(a), mk(b), w]) : [];
  let mined = [];
  const pickPair = () => { const all = HARDP.concat(mined), tot = all.reduce((s, h) => s + h[2], 0); let r = rnd() * tot; for (const h of all) { r -= h[2]; if (r <= 0) return h; } return all[0]; };
  function sampleBatch(P = 8, K = 4) {
    const cls = new Set();
    if (HARDP.length) while (cls.size < P / 2 + 1) { const [a, b] = pickPair(); cls.add(a); cls.add(b); }
    while (cls.size < P) {
      if (rnd() < .5) { const g = GROUPS[Math.floor(rnd() * GROUPS.length)]; for (const c of shuffle(g.slice()).slice(0, 3)) if (cls.size < P) cls.add(c); }
      else cls.add(MKS[Math.floor(rnd() * MKS.length)]);
    }
    const out = []; for (const c of [...cls].slice(0, P + 1)) for (let k = 0; k < K; k++) out.push(pick(c)); return out;
  }
  // ---- model ----
  const base = await backbone();
  const g = tf.layers.globalAveragePooling2d({}).apply(base.outputs[0]);
  const h = tf.layers.dense({ units: 256, activation: "relu", name: "print_h" }).apply(g);
  const e = tf.layers.dense({ units: EMB, name: "print" }).apply(h);
  const model = tf.model({ inputs: base.inputs, outputs: e });
  const W = tf.variable(tf.randomNormal([EMB, MKS.length], 0, 0.05), true, "arc_w");
  const norm = t => t.div(tf.norm(t, 2, -1, true).add(1e-9));
  const S_ = 30, M_ = 0.35;
  const arcLoss = (emb, labels) => {
    const en = norm(emb), wn = W.div(tf.norm(W, 2, 0, true).add(1e-9));
    const cos = tf.clipByValue(tf.matMul(en, wn), -1 + 1e-6, 1 - 1e-6);
    const oh = tf.oneHot(labels, MKS.length).toFloat();
    const target = tf.cos(tf.acos(cos).add(M_));
    const logits = oh.mul(target).add(tf.scalar(1).sub(oh).mul(cos)).mul(S_);
    return tf.losses.softmaxCrossEntropy(oh, logits);
  };
  const tripLoss = (emb, labels) => {
    const en = norm(emb), sim = tf.matMul(en, en, false, true), d = tf.sqrt(tf.relu(tf.scalar(2).sub(sim.mul(2))).add(1e-9));
    const l = labels.expandDims(1), same = tf.equal(l, l.transpose()).toFloat(), eye = tf.eye(labels.shape[0]);
    const pos = same.sub(eye), neg = tf.scalar(1).sub(same);
    // batch-all, soft margin: every (anchor, same, different) triplet in the batch counts, averaged over the ones still
    // wrong. Gentler than "hardest only", which can collapse all prints to one point.
    const t = d.expandDims(2).sub(d.expandDims(1)).add(0.2);              // d(a,p) - d(a,n) + margin
    const valid = pos.expandDims(2).mul(neg.expandDims(1));
    const sl = tf.softplus(t.mul(5)).div(5).mul(valid);
    return sl.sum().div(valid.sum().add(1));
  };
  const lossFn = LOSS === "triplet" ? tripLoss : arcLoss;
  const baseLayers = model.layers.filter(l => !/^print/.test(l.name) && !/global_average/.test(l.name));
  // checkpoints: saved after every round so a paused/restarted workspace can carry on (RESUME=1)
  const CK = path.join(OUT, "checkpoint"); let startEp = 0;
  if (process.env.RESUME === "1" && fs.existsSync(path.join(CK, "state.json"))) {
    const st = JSON.parse(fs.readFileSync(path.join(CK, "state.json")));
    const saved = await tf.loadLayersModel("file://" + path.join(CK, "model.json"));
    for (const l of model.layers) { try { const sl = saved.getLayer(l.name); if (sl.getWeights().length) l.setWeights(sl.getWeights()); } catch (e) {} } saved.dispose();
    W.assign(tf.tensor(st.W)); startEp = st.epoch; for (let i = 0; i < st.rndCalls; i++) rnd();
    console.log(`resuming from round ${startEp + 1}`);
  }
  let opt = tf.train.adam(1e-3);
  for (let ep = startEp; ep < EPOCHS_R; ep++) {
    const warm = ep < 2; baseLayers.forEach(l => l.trainable = !warm);
    if (!warm) { opt.dispose(); opt = tf.train.adam(2.5e-4 * (1 - ep / EPOCHS_R) + 2e-5); }
    let sum = 0; const t0 = Date.now();
    for (let s = 0; s < STEPS; s++) {
      const b = sampleBatch();
      const x = toTensor(await Promise.all(b.map(a => zoomView(a, true, ZV)))), y = tf.tensor1d(b.map(a => MKS.indexOf(mk(a.cls))), "int32");
      const cost = opt.minimize(() => lossFn(model.apply(x, { training: false }), y), true);
      sum += cost.dataSync()[0]; tf.dispose([x, y, cost]);
    }
    console.log(`prints (${LOSS}) epoch ${ep + 1}/${EPOCHS_R}: loss ${(sum / STEPS).toFixed(3)} (${Math.round((Date.now() - t0) / 1000)}s)`);
    if (HARDP.length) {   // hard-negative mining: which marks' average prints are closest right now?
      const cent = {};
      for (const m of MKS) { const l = pool[m].real.length ? pool[m].real : pool[m].syn; const sm = shuffle(l.slice()).slice(0, 6);
        const x = toTensor(await Promise.all(sm.map(a => zoomView(a, false, ZV)))); const e = norm(model.predict(x)); cent[m] = norm(e.mean(0)).arraySync(); tf.dispose([x, e]); }
      const sims = []; for (let i = 0; i < MKS.length; i++) for (let j = i + 1; j < MKS.length; j++) sims.push([MKS[i], MKS[j], cent[MKS[i]].reduce((s, v, k) => s + v * cent[MKS[j]][k], 0)]);
      sims.sort((a, b) => b[2] - a[2]); mined = sims.slice(0, 12).map(([a, b, v]) => [a, b, 3 * Math.max(0.1, v)]);
      console.log("  closest prints now:", sims.slice(0, 6).map(([a, b, v]) => `${a}/${b} ${v.toFixed(2)}`).join(", "));
    }
    fs.mkdirSync(CK, { recursive: true }); await model.save("file://" + CK);
    fs.writeFileSync(path.join(CK, "state.json"), JSON.stringify({ epoch: ep + 1, W: W.arraySync(), rndCalls: 0 }));
  }
  await model.save("file://" + path.join(OUT, "print"));
  // ---- gallery: prints of real photos (training recordings + seen tests), plus a few synthetic per mark ----
  const embed = async list => { const out = []; for (let i = 0; i < list.length; i += 32) { const x = toTensor(await Promise.all(list.slice(i, i + 32).map(a => zoomView(a, false, ZV)))); const p = norm(model.predict(x)); out.push(...p.arraySync()); tf.dispose([x, p]); } return out; };
  const galItems = []; for (const m of MKS) { galItems.push(...shuffle(pool[m].real.slice()).slice(0, 30), ...shuffle(pool[m].syn.slice()).slice(0, 6)); }
  const galE = await embed(galItems), galL = galItems.map(a => mk(a.cls));
  fs.writeFileSync(path.join(OUT, "gallery.json"), JSON.stringify({ marks: MKS, zoom: ZOOM, gray: GRAY, entries: galE.map((v, i) => [galL[i], v.map(x => Math.round(x * 1e4) / 1e4)]) }));
  // ---- check: nearest references (mean of the 3 closest per mark) ----
  async function check(items, label) {
    const qs = await embed(items); let ok = 0, sure = 0, sureOk = 0; const wrong = [];
    qs.forEach((q, i) => {
      const per = {}; galE.forEach((g, j) => { const s = g.reduce((a, v, k) => a + v * q[k], 0); (per[galL[j]] = per[galL[j]] || []).push(s); });
      const sc = Object.entries(per).map(([m, ss]) => [m, ss.sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0) / 3]).sort((a, b) => b[1] - a[1]);
      const truth = mk(items[i].cls), [g1, s1] = sc[0], s2 = sc[1][1];
      if (g1 === truth) ok++; else wrong.push(truth + "→" + g1);
      if (s1 > .6 && s1 - s2 > .08) { sure++; if (g1 === truth) sureOk++; }
    });
    const r = { label, n: items.length, right: Math.round(100 * ok / items.length) + "%", sureShare: Math.round(100 * sure / items.length) + "%", rightWhenSure: Math.round(100 * sureOk / Math.max(1, sure)) + "%", mistakes: wrong.join(" ") };
    console.log(r); return r;
  }
  const report = { loss: LOSS, zoom: ZOOM, gray: GRAY, trainedAt: new Date().toISOString(),
    heldBackRecordings: await check(test.filter(a => a.cls !== "none" && Array.isArray(a.box)), "held-back recording photos (mark only)"),
    heldTest: heldScans.length ? await check(heldScans, "HELD-BACK " + HOLD.join(",") + " (mark only, fair check)") : null };
  fs.writeFileSync(path.join(OUT, "print-report.json"), JSON.stringify(report, null, 2));
  console.log("saved to", OUT);
})().catch(e => { console.error(e); process.exit(1); });
