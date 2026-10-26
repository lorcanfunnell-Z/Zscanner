// Browser smoke test (used by tools/check.sh --browser): opens the client and admin pages in a headless browser,
// identifies chocolates from stored photos, and checks the client page shows no admin tools or hooks.
// Needs a local server on port 8767 serving app/ (check.sh starts one) and Playwright with Chromium.
const { chromium } = require("playwright");
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
  ok(/N°18/.test(ar["18"]) && /N°21/.test(ar["21"]), `admin photo upload: ${ar["18"]} / ${ar["21"]}`);
  const c = await ctx.newPage(), cr = await run(c, "http://localhost:8767/index.html", false);
  ok(await c.evaluate(() => Recognizer.model) === "model6", "client page runs model 6");
  ok(!(await c.$(".adminbar")) && !(await c.$("section.tl")) && (await c.$$(".hk, .hk-heart, .hk-tasting")).length === 0, "client page: no admin tools, no hooks");
  ok(/Found|certain/.test(cr["21"]), `client photo upload responds: ${cr["21"]}`);
  ok(errs.length === 0, `no page errors${errs.length ? ": " + errs.join("; ") : ""}`);
  await b.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
