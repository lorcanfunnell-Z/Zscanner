// Speed test (admin page only): times every step of the scanner on THIS phone, without needing a chocolate.
// It reads a stored chocolate photo 30 times and reports the average milliseconds per step, so we know where a scan's
// time goes and what to speed up. "Copy results" puts a short summary on the clipboard to paste into the chat.
// Uses the .cl/.cl-screen CSS that collect.js injects into <head> — needs collect.js loaded first.
(() => {
  if (window.ZADMIN !== true) return;
  const $ = s => document.querySelector(s);
  const RUNS = 30, WARM = 3, PHOTOS = ["images/7.jpg", "images/18.jpg"];
  document.body.insertAdjacentHTML("beforeend", `
  <div class="cl" id="st" hidden>
    <div class="cl-screen">
      <div style="display:flex;justify-content:space-between;align-items:center"><p class="eyebrow" style="color:#fff">Speed test</p>
        <button class="btn btn-light" type="button" id="stClose" style="padding:10px 14px">Close</button></div>
      <h3>How fast is the scanner on this phone?</h3>
      <p class="muted">Reads a stored chocolate photo ${RUNS} times and times each step. Keep the screen on; it takes under a minute.</p>
      <button class="btn btn-light" type="button" id="stGo">Start</button>
      <div id="stOut" style="font:400 14px/1.5 var(--sans)"></div>
      <button class="btn btn-light" type="button" id="stCopy" hidden>Copy results</button>
    </div>
  </div>`);
  const close = () => { $("#st").hidden = true; document.body.style.overflow = ""; };
  $("#stClose").onclick = close;
  const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  let summary = "";
  $("#stGo").onclick = async () => {
    const out = $("#stOut"); $("#stGo").disabled = true; $("#stCopy").hidden = true;
    out.textContent = "Loading the scanner…";
    const t0 = performance.now(); await Recognizer.load(); const loadWait = performance.now() - t0;
    const imgs = await Promise.all(PHOTOS.map(loadImg));
    const sums = {}, totals = []; let found = 0;
    for (let i = 0; i < RUNS + WARM; i++) {
      const img = imgs[i % imgs.length], s0 = performance.now();
      const r = Recognizer.scan(img);
      const total = performance.now() - s0;
      if (i >= WARM) { totals.push(total); if (r.found) found++; for (const [k, v] of Object.entries(Recognizer.times)) sums[k] = (sums[k] || 0) + v; }
      out.textContent = `Reading ${Math.min(i + 1, RUNS + WARM)} of ${RUNS + WARM}…`;
      await new Promise(r => setTimeout(r, 30));
    }
    // second pass: the same photo every frame, like someone holding the phone still (lets the scanner reuse work)
    const held = [];
    for (let i = 0; i < RUNS + WARM; i++) {
      const s0 = performance.now(); Recognizer.scan(imgs[0], undefined, { track: true }); const t = performance.now() - s0;
      if (i >= WARM) held.push(t);
      out.textContent = `Holding still ${Math.min(i + 1, RUNS + WARM)} of ${RUNS + WARM}…`;
      await new Promise(r => setTimeout(r, 30));
    }
    const heldAvg = held.reduce((a, b) => a + b, 0) / held.length;
    totals.sort((a, b) => a - b);
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length, med = totals[totals.length >> 1];
    const rows = Object.entries(sums).map(([k, v]) => [k, v / RUNS]).sort((a, b) => b[1] - a[1]);
    const fps = 1000 / (avg + 15);
    summary = `zScanner speed test (${Recognizer.model}, ${Recognizer.backend})\n` +
      `${navigator.userAgent.replace(/^.*?\(([^)]*)\).*$/, "$1")}\n` +
      `scanner ready after ${Math.round(Recognizer.loadMs || loadWait)} ms (this visit)\n` +
      `per frame: average ${Math.round(avg)} ms, median ${Math.round(med)} ms, about ${fps.toFixed(1)} frames a second\n` +
      `while holding still: ${Math.round(heldAvg)} ms per frame, about ${(1000 / (heldAvg + 15)).toFixed(1)} frames a second\n` +
      rows.map(([k, v]) => `  ${k}: ${v.toFixed(1)} ms`).join("\n") + `\nchocolate found in ${found}/${RUNS} frames`;
    out.innerHTML = `<table style="width:100%;border-collapse:collapse">
      <tr><td>Scanner ready after</td><td style="text-align:right">${Math.round(Recognizer.loadMs || loadWait)} ms</td></tr>
      <tr><td><b>Per frame (average)</b></td><td style="text-align:right"><b>${Math.round(avg)} ms</b></td></tr>
      <tr><td>Frames per second</td><td style="text-align:right">${fps.toFixed(1)}</td></tr>
      <tr><td><b>While holding still</b></td><td style="text-align:right"><b>${Math.round(heldAvg)} ms</b> (${(1000 / (heldAvg + 15)).toFixed(1)}/s)</td></tr>
      ${rows.map(([k, v]) => `<tr><td style="color:rgba(255,255,255,.7)">${k}</td><td style="text-align:right;color:rgba(255,255,255,.7)">${v.toFixed(1)} ms</td></tr>`).join("")}
      <tr><td>Engine</td><td style="text-align:right">${Recognizer.backend}</td></tr></table>`;
    $("#stCopy").hidden = false; $("#stGo").disabled = false; $("#stGo").textContent = "Run again";
  };
  $("#stCopy").onclick = async () => { try { await navigator.clipboard.writeText(summary); $("#stCopy").textContent = "Copied, paste it in the chat"; } catch (e) { prompt("Copy this:", summary); } };
  window.ZSpeed = { open: () => { $("#st").hidden = false; document.body.style.overflow = "hidden"; } };
})();
