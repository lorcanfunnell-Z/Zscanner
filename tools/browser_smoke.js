// Browser smoke test (used by tools/check.sh --browser): opens the client and admin pages in a headless browser,
// identifies chocolates from stored photos, and checks the client page shows no admin tools or hooks.
// Needs a local server on port 8767 serving app/ (check.sh starts one) and Playwright with Chromium.
const path = require("path");
const { chromium } = require("playwright");
const sharp = require("sharp");
const { edgeAngle } = require("../training/align_lib.js");
(async () => {
  let fails = 0; const ok = (c, w) => { console.log(`${c ? "  ok  " : "  FAIL"}  ${w}`); if (!c) fails++; };
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/zchocolat\.com/, r => r.abort());
  const errs = [];
  const run = async (page, url, admin) => {
    page.on("pageerror", e => errs.push(e.message));
    await page.goto(url);
    if (admin) { await page.fill("#gatePass", "Scanner23?"); await page.click("#gate button"); }
    await page.waitForFunction(() => window.Recognizer && Recognizer.ready, null, { timeout: 300000 });
    const res = {};
    for (const k of ["18", "21"]) {
      await page.setInputFiles("#photoInput", `app/images/${k}.jpg`);
      await page.waitForFunction(() => !/Reading/.test(document.querySelector("#status").textContent), null, { timeout: 300000 });
      res[k] = (await page.textContent("#status")).trim();
    }
    return res;
  };
  const a = await ctx.newPage(), ar = await run(a, "http://localhost:8767/admin.html", true);
  ok(await a.evaluate(() => Recognizer.model) === "model6", "admin page runs model 6");
  await a.waitForFunction(() => /scanner-v\d+/.test(document.querySelector("#tlBuild")?.textContent || ""), null, { timeout: 20000 }).catch(() => {});
  ok(/scanner-v\d+ · models-[\d.]+ · model6/.test(await a.textContent("#tlBuild")), `admin page shows the build: ${(await a.textContent("#tlBuild")).trim()}`);
  ok(/N°18/.test(ar["18"]) && /N°21/.test(ar["21"]), `admin photo upload: ${ar["18"]} / ${ar["21"]}`);
  // 23 Nov: Exam mode deals three lists of 120 (every chocolate 4 times, then 8 Nothing shots with a subject to point at),
  // kept on the phone with each list's position; a finished list says so and the next starts on its button.
  const exam1 = await a.evaluate(() => { localStorage.removeItem("zscanner-exam-v2"); const cb = document.querySelector("#tlExam"); cb.checked = true; cb.dispatchEvent(new Event("change"));
    const x = JSON.parse(localStorage.getItem("zscanner-exam-v2"));
    return { next: document.querySelector("#tlNext").textContent, buttons: [...document.querySelectorAll("#tlLists button")].map(b => b.textContent.trim()),
      lists: x.lists.length, len: x.lists.map(L => L.queue.length), nothing: x.lists.map(L => L.queue.filter(k => k === "none").length), tail: x.lists.map(L => L.queue.slice(-8).every(k => k === "none")),
      each: x.lists.map(L => { const c = {}; L.queue.forEach(k => c[k] = (c[k] || 0) + 1); return Object.values(c).filter(v => v === 4).length; }) }; });
  ok(/^Exam list 1 · 1 of 120 · Scan next: /.test(exam1.next) && exam1.lists === 3 && exam1.len.every(n => n === 120) && exam1.nothing.every(n => n === 8) && exam1.tail.every(Boolean) && exam1.each.every(n => n === 28) && exam1.buttons.length === 3,
     `exam mode deals three lists of 112 + 8 Nothing: "${exam1.next}"; buttons ${exam1.buttons.join(" / ")}`);
  const exam2 = await a.evaluate(() => { const cb = document.querySelector("#tlExam"), set = (l, pos) => { const x = JSON.parse(localStorage.getItem("zscanner-exam-v2")); x.lists[l].pos = pos; localStorage.setItem("zscanner-exam-v2", JSON.stringify(x)); cb.dispatchEvent(new Event("change")); return document.querySelector("#tlNext").textContent; };
    const a1 = set(0, 112), a2 = set(0, 120); document.querySelectorAll("#tlLists button")[1].click(); const a3 = document.querySelector("#tlNext").textContent;
    set(1, 120); set(2, 120); document.querySelectorAll("#tlLists button")[2].click(); const a4 = document.querySelector("#tlNext").textContent;
    cb.checked = false; cb.dispatchEvent(new Event("change")); localStorage.removeItem("zscanner-exam-v2"); return { a1, a2, a3, a4, off: document.querySelector("#tlNext").textContent, hidden: document.querySelector("#tlLists").hidden }; });
  ok(/113 of 120 · Scan next: nothing \(point at /.test(exam2.a1), `a list ends with eight Nothing shots and says what to point at: "${exam2.a1}"`);
  ok(/^Exam list 1 finished: 120 scans\. Download the zip, then tap Exam list 2\./.test(exam2.a2) && /^Exam list 2 · 1 of 120/.test(exam2.a3) && /^All three exam lists finished/.test(exam2.a4) && exam2.off === "" && exam2.hidden,
     `a finished list says so, the next starts on its button, the end is announced: "${exam2.a2}" -> "${exam2.a3}" -> "${exam2.a4}"`);
  // recognizer.js's inlined straightening maths vs training/align_lib.js's copy: deliberately duplicated (one reads
  // a canvas, the other a raw buffer) with nothing else checking they stay in sync as the maths evolves
  const angleInBrowser = await a.evaluate(async () => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "images/18.jpg"; });
    return Recognizer._edgeAngleOf(img);
  });
  const { data: rgb } = await sharp(path.join(__dirname, "..", "app", "images", "18.jpg"))
    .resize(224, 224, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const angleInNode = edgeAngle(new Uint8Array(rgb), 224).angle;
  const angleDiff = Math.abs(((angleInBrowser - angleInNode) % 90 + 135) % 90 - 45);   // smallest gap, mod 90
  ok(angleDiff < 5, `recognizer.js's edgeAngle agrees with align_lib.js's (browser ${angleInBrowser.toFixed(1)}°, node ${angleInNode.toFixed(1)}°)`);
  // 13 Nov: the admin page's live loop too, on the same static picture: its finder-box overlay must appear and label the
  // box, and the scan must still answer (this path also exercises the admin-only trace and "settling" logging).
  const adminLive = await a.evaluate(async () => {
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "images/18.jpg"; });
    const cv = document.createElement("canvas"); cv.width = cv.height = 640; cv.getContext("2d").drawImage(img, 0, 0, 640, 640);
    navigator.mediaDevices.getUserMedia = async () => cv.captureStream(15);
    let label = ""; const watch = setInterval(() => { const b = document.querySelector("#finderBox"); if (b && !b.hidden) label = b.dataset.label; }, 50);
    document.querySelector("#status").textContent = "";   // the photo upload above left "Found: N°21" here; wait for the live scan's own result
    document.querySelector("#camBtn").click();
    const t0 = performance.now(); let status = "", last = ""; const timeline = [];   // 23 Nov: the hint's changes, printed when the scan does not answer, so a stall can be placed
    while (performance.now() - t0 < 12000) {
      status = document.querySelector("#status").textContent.trim(); const k = status.slice(0, 40) + " | " + document.querySelector("#hint").textContent.slice(0, 110);
      if (k !== last && timeline.length < 30) { timeline.push(`${Math.round(performance.now() - t0)}ms ${k}`); last = k; }
      if (/Found|certain/.test(status)) break; await new Promise(r => setTimeout(r, 100));
    }
    clearInterval(watch);
    return { status: status || "(no result within 12 s)", label, timeline };
  });
  ok(/N°18/.test(adminLive.status) && /box \d+%/.test(adminLive.label), `admin live loop: ${adminLive.status}; finder box overlay: "${adminLive.label}"`);
  if (!/N°18/.test(adminLive.status)) console.log("        timeline:\n" + adminLive.timeline.map(t => "          " + t).join("\n"));
  // 23 Nov: the exam RECORDING path, end to end on the real page - a Nothing item that the scanner answers must be stored as a
  // wrong Nothing shot and move the list on; "I scanned something else" must step the list back AND store the cleared row;
  // an X with nothing framed must still be saved (a "noanswer" with 0 frames) so the list can move on; the tick survives a reload.
  const examRec = await a.evaluate(async () => {
    const cb = document.querySelector("#tlExam"); localStorage.removeItem("zscanner-exam-v2"); cb.checked = true; cb.dispatchEvent(new Event("change"));
    const x = JSON.parse(localStorage.getItem("zscanner-exam-v2")); x.current = 0; x.lists[0].pos = 112; localStorage.setItem("zscanner-exam-v2", JSON.stringify(x)); cb.dispatchEvent(new Event("change"));
    const line0 = document.querySelector("#tlNext").textContent;
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "images/18.jpg"; });
    const cv = document.createElement("canvas"); cv.width = cv.height = 640; const cx = cv.getContext("2d"); cx.drawImage(img, 0, 0, 640, 640);
    const redraw = setInterval(() => cx.drawImage(img, 0, 0, 640, 640), 100);   // captureStream only delivers frames that change
    navigator.mediaDevices.getUserMedia = async () => cv.captureStream(15);
    document.querySelector("#status").textContent = ""; document.querySelector("#camBtn").click();
    let t0 = performance.now(), status = "";
    while (performance.now() - t0 < 12000) { status = document.querySelector("#status").textContent.trim(); if (/Found|certain/.test(status)) break; await new Promise(r => setTimeout(r, 100)); }
    await new Promise(r => setTimeout(r, 500));
    const pos = () => JSON.parse(localStorage.getItem("zscanner-exam-v2")).lists[0].pos;
    const card1 = document.querySelector("#tlCurrent").textContent.replace(/\s+/g, " "), pos1 = pos(), stats1 = document.querySelector("#tlStats").textContent.replace(/\s+/g, " ");
    const rows1 = await window.ZTESTLOG.all(); const l1 = rows1[rows1.length - 1]; const last1 = { truth: l1.truth, correct: l1.correct, exam: l1.exam, examList: l1.examList, type: l1.type, n: l1.n };   // a copy: the log hands out its live objects
    const other = document.querySelector("#tlOther"); if (other) other.click(); await new Promise(r => setTimeout(r, 400));
    const pos2 = pos(); const rows2 = await window.ZTESTLOG.all(); const l2 = rows2[rows2.length - 1]; const last2 = { truth: l2.truth, correct: l2.correct, exam: l2.exam, n: l2.n };
    // an X with nothing framed: a grey canvas the finder never "finds", then Stop
    cx.fillStyle = "#777"; cx.fillRect(0, 0, 640, 640); clearInterval(redraw); const redraw2 = setInterval(() => { cx.fillStyle = "#777"; cx.fillRect(0, 0, 640, 640); cx.fillStyle = "#7a7a7a"; cx.fillRect(Math.random() * 600, 0, 20, 20); }, 100);
    cb.dispatchEvent(new Event("change")); document.querySelector("#status").textContent = ""; document.querySelector("#camBtn").click();
    await new Promise(r => setTimeout(r, 2500)); const hint = document.querySelector("#hint").textContent;
    document.querySelector("#stopBtn").click(); await new Promise(r => setTimeout(r, 500)); clearInterval(redraw2);
    const pos3 = pos(); const rows3 = await window.ZTESTLOG.all(); const l3 = rows3[rows3.length - 1]; const last3 = { truth: l3.truth, correct: l3.correct, type: l3.type, frames: l3.frames, exam: l3.exam };
    const card3 = document.querySelector("#tlCurrent").textContent.replace(/\s+/g, " ");
    const tick = localStorage.getItem("zscanner-exam-on");
    cb.checked = false; cb.dispatchEvent(new Event("change")); localStorage.removeItem("zscanner-exam-v2");
    return { line0, card1, pos1, stats1, last1, pos2, last2: { ...last2, n2: last2.n, n1: last1.n }, hint, pos3, last3, card3, tick };
  });
  const rec1 = { line: /113 of 120 · Scan next: nothing \(point at the box lid\)/.test(examRec.line0), card: /Expected nothing: wrong, it said N°18/.test(examRec.card1), pos: examRec.pos1 === 113,
    row: examRec.last1.truth === "none" && examRec.last1.correct === false && examRec.last1.exam === 113 && examRec.last1.examList === 1, stats: /1 Nothing shot: 1 answered \(wrong\)/.test(examRec.stats1) && /\b0\s*scans/.test(examRec.stats1) };
  ok(Object.values(rec1).every(Boolean), `exam recording: an answered Nothing shot is stored as wrong, moves the list on and stays out of the chocolate counts (stats "${examRec.stats1.trim()}")`);
  if (!Object.values(rec1).every(Boolean)) console.log("        exam recording detail: " + JSON.stringify({ rec1, line0: examRec.line0, pos1: examRec.pos1, last1: examRec.last1, card1: examRec.card1.slice(0, 300) }));
  ok(examRec.pos2 === 112 && examRec.last2.n2 === examRec.last2.n1 && examRec.last2.truth === null && examRec.last2.correct === null && examRec.last2.exam === null,
     `"I scanned something else" steps the list back to 112 and stores the row as unlabelled (truth ${examRec.last2.truth}, exam ${examRec.last2.exam})`);
  ok(/Hold the camera above one chocolate/.test(examRec.hint) && examRec.pos3 === 113 && examRec.last3.truth === "none" && examRec.last3.correct === true && examRec.last3.type === "noanswer" && examRec.last3.frames === 0 && /nothing was ever framed/.test(examRec.card3) && examRec.tick === "1",
     `an X with nothing framed saves a right Nothing shot with 0 frames and moves the list on ("${examRec.card3.slice(0, 90)}…"); the Exam tick is remembered`);
  const c = await ctx.newPage(), cr = await run(c, "http://localhost:8767/index.html", false);
  ok(await c.evaluate(() => Recognizer.model) === "model6", "client page runs model 6");
  ok(!(await c.$(".adminbar")) && !(await c.$("section.tl")) && (await c.$$(".hk, .hk-heart, .hk-tasting")).length === 0, "client page: no admin tools, no hooks");
  ok(/Found|certain/.test(cr["21"]), `client photo upload responds: ${cr["21"]}`);
  // 13 Nov: a plain tray tap after an automatic answer must leave the gallery alone; only "Choose the number instead"
  // (#fixBtn) followed by a tap is a correction, and that one moves the scan's reinforcement to the tapped number.
  // Client page on purpose: reinforcement is off on the admin page (DEBUG), so only here can the gallery change at all.
  const counts = () => c.evaluate(() => Recognizer._galleryCounts());
  const before = await counts();                                   // the last upload above (N°21) is the current automatic answer
  await c.click('#grid .key[data-k="5"]');
  const afterPlain = await counts();
  ok(JSON.stringify(afterPlain) === JSON.stringify(before), `plain tray tap leaves the gallery unchanged (${before.total} references)`);
  await c.setInputFiles("#photoInput", "app/images/21.jpg");      // a fresh automatic answer, so there is something to correct
  await c.waitForFunction(() => !/Reading/.test(document.querySelector("#status").textContent), null, { timeout: 300000 });
  const mid = await counts(), fixBtn = await c.$("#fixBtn");
  ok(!!fixBtn, "result card offers 'Choose the number instead'");
  if (fixBtn) { await fixBtn.click(); await c.click('#grid .key[data-k="5"]'); }
  const afterFix = await counts();
  const autoReinforced = (mid.byMark["21"] || 0) === (before.byMark["21"] || 0) + 1;   // the upload itself may have reinforced N°21 at the top tier
  ok((afterFix.byMark["5"] || 0) === (mid.byMark["5"] || 0) + 1 && afterFix.total === mid.total + 1 - (autoReinforced ? 1 : 0)
     && (!autoReinforced || afterFix.byMark["21"] === mid.byMark["21"] - 1),
     `"Choose the number instead" then a tap moves the reinforcement (N°5 +1${autoReinforced ? ", N°21 -1" : ""}; ${mid.total} -> ${afterFix.total} references)`);
  // 13 Nov: the live scan loop itself, on a static picture fed to the page as if it were the camera - the settle gate
  // must open, the hold must run and rule E must answer within the 5 s deadline. Headless Chromium has no camera, so
  // getUserMedia is replaced by a canvas stream showing app/images/18.jpg (the same picture the photo upload reads).
  const live = await c.evaluate(async () => {
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "images/18.jpg"; });
    const cv = document.createElement("canvas"); cv.width = cv.height = 640; cv.getContext("2d").drawImage(img, 0, 0, 640, 640);
    navigator.mediaDevices.getUserMedia = async () => cv.captureStream(15);
    const hints = new Set(); const watch = setInterval(() => hints.add(document.querySelector("#hint").textContent), 50);
    document.querySelector("#status").textContent = "";
    document.querySelector("#camBtn").click();
    const t0 = performance.now(); let status = "";
    while (performance.now() - t0 < 9000) {
      status = document.querySelector("#status").textContent.trim();
      if (/Found|certain/.test(status)) break;
      await new Promise(r => setTimeout(r, 100));
    }
    clearInterval(watch);
    return { status: status || "(no result within 9 s)", ms: Math.round(performance.now() - t0), settled: [...hints].some(h => /Hold still/.test(h)) };
  });
  ok(/N°18/.test(live.status), `live scan loop on a static picture: ${live.status} after ${live.ms} ms (settle gate seen: ${live.settled})`);
  ok(errs.length === 0, `no page errors${errs.length ? ": " + errs.join("; ") : ""}`);
  await b.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
