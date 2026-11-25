// The finder's "is there a chocolate here?" judged on whole camera frames it has never been trained on (25 Nov).
// Why: training/lib/finder_eval.js scores where the box lands on chocolates; nothing scored whether the finder says
// "nothing" on an empty view, which is what the Nothing video round is meant to teach it.
//   chocolates: every held-back session's saved camera frame (tests/<session>/camera/<chocolate>/scanN.jpg)
//   nothing:    the held-back sessions' Nothing shots (camera/none) plus any folders named in NOTHING_DIRS
//               (comma-separated, e.g. a held-back video clip's frames), and CHOC_DIRS for extra chocolate frames
// A frame counts as "found" at the app's own line, MIN_OBJ 0.75 (app/app.js).
// Usage: node training/nothing_eval.js [finder model.json]   (Node 20, see HANDOVER §6)
const { fs, path, tf, at, toTensor } = require("./lib/common.js");
const { view } = require("./lib/view.js");
const MODEL = path.resolve(process.argv[2] || at("app/model6/finder/model.json")), LINE = +(process.env.LINE || .75);
const held = JSON.parse(fs.readFileSync(at("training/sessions.json"))).heldBack;
const jpgs = d => fs.existsSync(d) ? fs.readdirSync(d).filter(f => /\.(jpe?g|png)$/i.test(f)).map(f => path.join(d, f)) : [];
const choc = [], none = [];
for (const s of held) {
  const cam = at(`tests/${s}/camera`); if (!fs.existsSync(cam)) continue;
  for (const c of fs.readdirSync(cam)) { const d = path.join(cam, c); if (!fs.statSync(d).isDirectory()) continue; (c === "none" ? none : choc).push(...jpgs(d)); }
}
for (const d of (process.env.NOTHING_DIRS || "").split(",").filter(Boolean)) none.push(...jpgs(path.resolve(d)));
for (const d of (process.env.CHOC_DIRS || "").split(",").filter(Boolean)) choc.push(...jpgs(path.resolve(d)));
(async () => {
  const finder = await tf.loadLayersModel("file://" + MODEL);
  const objs = async files => { const out = []; for (let i = 0; i < files.length; i += 32) {
    const x = toTensor(await Promise.all(files.slice(i, i + 32).map(f => view(f, .5, .5, 1))));
    const [po, pb] = tf.tidy(() => finder.predict(x)); out.push(...po.arraySync().map(v => v[0])); tf.dispose([x, po, pb]); } return out; };
  const q = a => { const s = a.slice().sort((x, y) => x - y); return [.1, .5, .9].map(p => s[Math.floor(p * (s.length - 1))]?.toFixed(2)).join(" / "); };
  const oc = await objs(choc), on = await objs(none);
  console.log(`finder: ${path.relative(at("."), MODEL)}   line ${LINE}`);
  console.log(`chocolate frames found:      ${oc.filter(v => v >= LINE).length}/${oc.length}   (confidence 10th / median / 90th: ${q(oc)})`);
  console.log(`nothing frames said nothing: ${on.filter(v => v < LINE).length}/${on.length}   (confidence 10th / median / 90th: ${q(on)})`);
  if (process.env.LIST) none.forEach((f, i) => console.log(`  ${on[i].toFixed(2)}  ${path.relative(at("."), f)}`));
})();
