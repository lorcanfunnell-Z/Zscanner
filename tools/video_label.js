// Boxes the chocolate frames of a "mixed" video clip with today's finder (25 Nov, the Nothing video round).
// Today's finder is excellent at WHERE a chocolate is when one is there (held-back close-ups 325/327); what it lacks is
// saying "nothing". So: a frame it is very sure of (>= SURE, 0.97) gets its box; a frame it is unsure of (< 0.5) is a
// Nothing frame only if FILE_UNSURE=1 (off by default: in a mixed clip an unsure frame may still show a chocolate);
// everything in between is dropped. Writes experiments/video-mixed/<clip>/labels.json for a contact-sheet check, and
// with --file copies the kept frames into training-photos-wide/mixed/ (boxes.json).
// Usage: node tools/video_label.js experiments/video-mixed/<clip> [--file]   (Node 20)
const { fs, path, tf, at, toTensor } = require("../training/lib/common.js");
const { view } = require("../training/lib/view.js");
const dir = path.resolve(process.argv[2]), FILE = process.argv.includes("--file"), SURE = +(process.env.SURE || .97);
(async () => {
  const finder = await tf.loadLayersModel("file://" + at("app/model6/finder/model.json"));
  const files = fs.readdirSync(dir).filter(f => /^vid_.*\.jpg$/.test(f)).sort(), labels = {};
  for (let i = 0; i < files.length; i += 32) {
    const b = files.slice(i, i + 32), x = toTensor(await Promise.all(b.map(f => view(path.join(dir, f), .5, .5, 1))));
    const [po, pb] = tf.tidy(() => finder.predict(x)); const O = po.arraySync(), B = pb.arraySync(); tf.dispose([x, po, pb]);
    b.forEach((f, k) => { const o = O[k][0], [cx, cy, s] = B[k];
      labels[f] = o >= SURE ? { obj: +o.toFixed(3), box: [cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2].map(v => +Math.min(1, Math.max(0, v)).toFixed(4)) }
        : o < .5 && process.env.FILE_UNSURE === "1" ? { obj: +o.toFixed(3), box: null } : { obj: +o.toFixed(3), drop: true }; });
  }
  fs.writeFileSync(path.join(dir, "labels.json"), JSON.stringify(labels, null, 1));
  const kept = Object.entries(labels).filter(([, l]) => !l.drop);
  console.log(`${path.basename(dir)}: ${files.length} frames, ${kept.filter(([, l]) => l.box).length} boxed as chocolate, ${kept.filter(([, l]) => !l.box).length} as nothing, ${files.length - kept.length} dropped (unsure)`);
  if (!FILE) return console.log("check the contact sheet, then run again with --file");
  const DEST = at("training-photos-wide"), bp = path.join(DEST, "boxes.json"), boxes = JSON.parse(fs.readFileSync(bp));
  fs.mkdirSync(path.join(DEST, "mixed"), { recursive: true });
  for (const [f, l] of kept) { fs.copyFileSync(path.join(dir, f), path.join(DEST, "mixed", f)); boxes[`mixed/${f}`] = l.box; }
  fs.writeFileSync(bp, JSON.stringify(boxes, null, 1)); console.log(`filed ${kept.length} frames into training-photos-wide/mixed/`);
})();
