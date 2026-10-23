// Building models on Google's MobileNetV2 0.35 (app/vendor/mnv2), and saving/restoring training rounds.
const { fs, path, tf, CONFIG, at } = require("./common.js");
const backbone = () => tf.loadLayersModel("file://" + at(CONFIG.backbone));
// several outputs on one backbone: spec = [[name, units, activation], …], each with its own 128-unit layer
function heads(base, spec) {
  const x = tf.layers.globalAveragePooling2d({}).apply(base.outputs[0]);
  const outs = spec.map(([name, units, act]) => tf.layers.dense({ units, activation: act, name }).apply(tf.layers.dense({ units: 128, activation: "relu", name: name + "_h" }).apply(x)));
  return tf.model({ inputs: base.inputs, outputs: outs });
}
// restore weights layer by layer (order-safe, even if some layers were frozen when saved)
function copyWeights(from, to) { for (const l of to.layers) { try { const sl = from.getLayer(l.name); if (sl.getWeights().length) l.setWeights(sl.getWeights()); } catch (e) {} } }
// checkpoint after every round, so a paused or restarted workspace can carry on (RESUME=1)
async function saveRound(model, dir, epoch, extra = {}) { fs.mkdirSync(dir, { recursive: true }); await model.save("file://" + dir); fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ epoch, ...extra })); }
async function resumeRound(model, dir) {
  if (process.env.RESUME !== "1" || !fs.existsSync(path.join(dir, "state.json"))) return { epoch: 0 };
  const saved = await tf.loadLayersModel("file://" + path.join(dir, "model.json")); copyWeights(saved, model); saved.dispose();
  const st = JSON.parse(fs.readFileSync(path.join(dir, "state.json"))); console.log(`resuming from round ${st.epoch + 1}`); return st;
}
module.exports = { backbone, heads, copyWeights, saveRound, resumeRound };
