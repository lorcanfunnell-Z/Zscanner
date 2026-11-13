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
    const t0 = performance.now(); let status = "";
    while (performance.now() - t0 < 9000) { status = document.querySelector("#status").textContent.trim(); if (/Found|certain/.test(status)) break; await new Promise(r => setTimeout(r, 100)); }
    clearInterval(watch);
    return { status: status || "(no result within 9 s)", label };
  });
  ok(/N°18/.test(adminLive.status) && /box \d+%/.test(adminLive.label), `admin live loop: ${adminLive.status}; finder box overlay: "${adminLive.label}"`);
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
