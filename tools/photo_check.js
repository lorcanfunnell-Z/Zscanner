// Fair check for the SINGLE-PHOTO path (13 Nov 2026): what a client gets when the live camera is unavailable, e.g.
// inside some in-app browsers opened from a QR code. It had its own rule (app/app.js fromPhoto: both opinions agree,
// or 99% sure, on one frame) and had never been measured. This runs the real client page in headless Chromium over
// every held-back close-up and camera frame on disk (training/sessions.json heldBack), applies fromPhoto's decision
// lines verbatim in effect, and prints answered / wrong / "Is it one of these?" per set, plus the standard
// scan-by-scan comparison with the live rule (python3 training/scorecard.py compare, through carrier dumps).
//
// Usage:  node tools/photo_check.js                     (compares with training/baseline-photo.txt)
//         node tools/photo_check.js --update-baseline   (after a deliberate change)
//         tools/check.sh --photo                        (runs this; about 6 minutes)
// Needs Playwright with Chromium (npx playwright install chromium) and python3. Starts its own local server.
const path = require("path"), fs = require("fs"), { spawn, execFileSync } = require("child_process");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, ".."), PORT = 8768, OUT = path.join(ROOT, "experiments"), BASE = path.join(ROOT, "training", "baseline-photo.txt");
const UPDATE = process.argv.includes("--update-baseline");
const sessions = JSON.parse(fs.readFileSync(path.join(ROOT, "training", "sessions.json"))).heldBack;
const IDS = JSON.parse(fs.readFileSync(path.join(ROOT, "app", "model6", "meta.json"))).ids;

// the scans, exactly as training/trace_replay.py sees them (labelled, with a trace), and their two saved pictures
function findFile(sess, kind, truth, n) {
  const direct = path.join(ROOT, "tests", sess, kind, truth, `scan${n}.jpg`); if (fs.existsSync(direct)) return direct;
  const dir = path.join(ROOT, "tests", sess, kind); if (!fs.existsSync(dir)) return null;
  const hits = fs.readdirSync(dir).map(f => path.join(dir, f, `scan${n}.jpg`)).filter(fs.existsSync);   // relabelled after export (e.g. test-7 N°22 under 21/)
  return hits.length === 1 ? hits[0] : null;
}
const items = []; let gi = 0;   // gi: the scan's position in the replay's order (sessions in order, scans in log order), to line up with liveOut below
for (const s of sessions) for (const r of JSON.parse(fs.readFileSync(path.join(ROOT, "tests", s, "test-log.json"))).filter(r => r.truth && r.trace)) {
  for (const kind of ["closeup", "camera"]) items.push({ sess: s, n: r.n, truth: r.truth, kind, gi, file: findFile(s, kind, r.truth, r.n) });
  gi++;
}

// the live rule's outcome per scan, from the project's own replay
const liveOut = JSON.parse(execFileSync("python3", ["-c", `
import sys, json; sys.path.insert(0, ${JSON.stringify(path.join(ROOT, "training"))}); import trace_replay as tr
out = []
for s in ${JSON.stringify(sessions)}:
    for truth, said, at in tr.run(tr.LIVE, detail=True, L=tr.load(${JSON.stringify(path.join(ROOT, "tests"))} + "/" + s)): out.append([s, truth, said])
print(json.dumps(out))`]).toString());

const onehot = k => { const v = new Array(IDS.length).fill(0); v[IDS.indexOf(k)] = 1; return v; };
const carrier = outs => ({ ids: IDS, rows: outs.map(([t, s]) => s ? { truth: t, m4: onehot(s), pp: onehot(s) } : { truth: t, m4: onehot("1"), pp: onehot("2") }) });

(async () => {
  const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
  const up = async () => { for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${PORT}/app/index.html`); return true; } catch (e) { await new Promise(r => setTimeout(r, 200)); } } return false; };
  if (!(await up())) { srv.kill(); throw new Error("local server did not start"); }
  const b = await chromium.launch(), page = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/app/index.html`);
  await page.waitForFunction(() => window.Recognizer && Recognizer.ready, null, { timeout: 300000 });
  for (const it of items) {
    if (!it.file) { it.missing = true; continue; }
    Object.assign(it, await page.evaluate(async url => {
      const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      // scanPhoto tries three windows along the long side; on a square picture all three coincide, so one scan() is
      // the same result at a third of the cost. Non-square pictures take the real scanPhoto.
      const res = img.width === img.height ? Recognizer.scan(img) : Recognizer.scanPhoto(img);
      if (!res || !res.found) return { found: false };
      const zm = k => k && k.startsWith("z") ? "z" : k;                                           // fromPhoto, app/app.js:
      const best = res.ranked.filter(x => window.CHOCOLATES[x.key]);                               //   best = ranked keys the page knows
      const tooDark = !!(res.light && res.light.p90 < 50);                                        //   MIN_LIGHT
      const agree = zm(res.m4top) === zm(best[0].key) && (res.print && res.print.mark) === zm(best[0].key);
      const sure = agree || best[0].p >= 0.99;                                                    //   agree-or-99
      return { found: true, tooDark, said: best[0].key, p: +best[0].p.toFixed(3), sure, top3: best.slice(0, 3).map(x => x.key) };
    }, `http://127.0.0.1:${PORT}/${path.relative(ROOT, it.file).split(path.sep).join("/")}`));
  }
  await b.close(); srv.kill();
  if (errs.length) console.log("  page errors: " + errs.join("; "));
  const lines = [];
  for (const kind of ["closeup", "camera"]) {
    const rs = items.filter(i => i.kind === kind && !i.missing), found = rs.filter(r => r.found), dark = found.filter(r => r.tooDark);
    const ans = found.filter(r => !r.tooDark && r.sure), wrong = ans.filter(r => r.said !== r.truth), chips = found.filter(r => !r.tooDark && !r.sure);
    const hasTruth = chips.filter(r => r.top3.includes(r.truth)).length, missing = items.filter(i => i.kind === kind && i.missing).length;
    lines.push(`${kind}: ${rs.length} scans${missing ? ` (${missing} without a saved ${kind})` : ""}, found ${found.length}, too dark ${dark.length}, answered ${ans.length}, wrong ${wrong.length} ${wrong.map(r => r.truth + "→" + r.said).join(" ")}| chips ${chips.length} (truth among them ${hasTruth})`);
    fs.mkdirSync(OUT, { recursive: true });
    const live = rs.map(r => { const o = liveOut[r.gi]; if (!o || o[0] !== r.sess || o[1] !== r.truth) throw new Error(`scan order mismatch at ${r.sess}#${r.n}`); return [r.truth, o[2]]; });
    const photo = rs.map(r => [r.truth, r.found && !r.tooDark && r.sure ? r.said : null]);
    const fl = path.join(OUT, `photo-check-live-${kind}.json`), fp = path.join(OUT, `photo-check-photo-${kind}.json`);
    fs.writeFileSync(fl, JSON.stringify(carrier(live))); fs.writeFileSync(fp, JSON.stringify(carrier(photo)));
    const cmp = execFileSync("python3", [path.join(ROOT, "training", "scorecard.py"), "--rule", "agree99", "compare", fl, fp]).toString();
    lines.push(`  vs the live rule: ${(cmp.match(/^verdict: .*$/m) || ["verdict: ?"])[0]}   (${(cmp.match(/^wrong answers .*$/m) || [""])[0].replace(/\s+/g, " ").trim()})`);
  }
  const now = lines.join("\n") + "\n";
  process.stdout.write(now);
  if (UPDATE || !fs.existsSync(BASE)) { fs.writeFileSync(BASE, now); console.log(UPDATE ? "  baseline updated" : "  baseline saved (first run)"); }
  else if (fs.readFileSync(BASE, "utf8") === now) console.log("  ok    identical to training/baseline-photo.txt");
  else { console.log("  CHANGED from training/baseline-photo.txt:"); console.log(fs.readFileSync(BASE, "utf8").split("\n").map(l => "    - " + l).join("\n")); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
