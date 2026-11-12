// Score a finder model on its own - no training, nothing written to app/. This is the "what are we starting
// from?" number for the distance/clutter problem (CLAUDE.md, "Reading from further away"), so that when real
// photos arrive and the finder is retrained, better-or-worse is a straight before-and-after rather than a
// judgement call.
//
// It scores two things, both of them about WHERE THE BOX LANDS, not how confident the model sounds (see the
// long note at the top of lib/finder_eval.js for why that distinction is the whole point here):
//   - the hand-labelled distance/clutter sessions tests/test-9/10/11 (whole camera frames, boxes measured by
//     hand because the live finder's own boxes there are wrong - that is the dataset's reason for existing)
//   - the held-back real close-ups (the last quarter of every collect recording, never trained on)
//
// Usage:  node training/eval_finder.js                              (scores the live finder, app/model6/finder)
//         node training/eval_finder.js experiments/finder-new/finder/model.json
//         SAVE=1 node training/eval_finder.js                       (also writes training/baseline-finder.txt)
//         WORST=1 node training/eval_finder.js                      (list every frame it got wrong)
// Needs Node 20 for @tensorflow/tfjs-node - see HANDOVER.md "Environment":
//         PATH="$HOME/.local/node20/bin:$PATH" node training/eval_finder.js
const { fs, path, tf, ROOT, at } = require("./lib/common.js");
const { loadData } = require("./lib/data.js");
const { evalWideSessions, evalCloseups, fmt, IOU_HIT } = require("./lib/finder_eval.js");

const MODEL = path.resolve(process.argv[2] || at("app/model6/finder/model.json"));
const SESSIONS = (process.env.SESSIONS || "test-9,test-11,test-10").split(",").filter(Boolean);
const SAVE = process.env.SAVE === "1", WORST = process.env.WORST === "1";

(async () => {
  if (!fs.existsSync(MODEL)) { console.error(`no finder model at ${MODEL}`); process.exit(1); }
  const finder = await tf.loadLayersModel("file://" + MODEL);
  const { test: realTest } = loadData({ synth: false, tests: false, quiet: true });

  const lines = [];
  const say = s => { lines.push(s); console.log(s); };
  say(`finder: ${path.relative(ROOT, MODEL)}`);
  say(`"box on the chocolate" means at least ${Math.round(100 * IOU_HIT)}% overlap with the hand-measured box AND the model saying a chocolate is there.`);
  say("");

  say("--- distance / clutter sessions (hand-labelled, never trained on) ---");
  const wide = await evalWideSessions(finder, SESSIONS);
  let onT = 0, nT = 0, noneOk = 0, noneN = 0;
  for (const s of SESSIONS) {
    const r = wide[s];
    if (!r) { say(`${s}: no finder-truth.json - skipped`); continue; }
    say(`${s}: ${fmt(r)}`);
    onT += r.onTarget; nT += r.n; noneOk += r.noneOk; noneN += r.noneN;
  }
  say(`all three together: box on the chocolate ${onT}/${nT}${nT ? ` (${Math.round(100 * onT / nT)}%)` : ""}` +
      (noneN ? `, correctly said "nothing" ${noneOk}/${noneN}` : ""));
  say("");

  say("--- held-back real close-ups (last quarter of each recording) ---");
  const close = await evalCloseups(finder, realTest);
  say(`${realTest.length} photos: ${fmt(close)}`);

  // The distance frames it got wrong are few and are the whole point, so they go in the saved baseline too -
  // a change that fixes or breaks a specific frame should show up in the diff, not just in a percentage.
  say("");
  say("--- distance frames it got wrong ---");
  for (const s of SESSIONS) for (const w of (wide[s]?.worst || [])) say(`  ${w.name}: ${w.why}`);

  if (WORST) {   // the close-up misses as well: usually a short list, not worth saving in the baseline
    console.log("\n--- close-ups it got wrong ---");
    for (const w of close.worst.slice(0, 40)) console.log(`  ${w.name}: ${w.why}`);
    if (close.worst.length > 40) console.log(`  …and ${close.worst.length - 40} more`);
  }

  if (SAVE) {
    const out = at("training/baseline-finder.txt");
    fs.writeFileSync(out, `zScanner finder baseline - written by training/eval_finder.js on ${new Date().toISOString().slice(0, 10)}\n` +
      `Re-run with: SAVE=1 node training/eval_finder.js   (after a deliberate change, same idea as tools/check.sh --update-baseline)\n\n` +
      lines.join("\n") + "\n");
    console.log(`\nsaved to ${path.relative(ROOT, out)}`);
  }
  finder.dispose();
})().catch(e => { console.error(e); process.exit(1); });
