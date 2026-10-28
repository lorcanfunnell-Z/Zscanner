// Reference round (admin page only): like Face ID's setup, where you turn your head so it sees you in several ways.
// Each chocolate is recorded in a few lights (window, lamp, inside the box). Two ways to use what's recorded:
//   - "Use right away": each good frame's chocoprint is kept and merged into custom-chocolates.json (the same file
//     "Add a chocolate" writes) — live the moment that file is pushed, no retraining, no processing step.
//   - "Download reference photos": the close-ups themselves, for tools/add_to_gallery.js to fold into the next
//     trained model properly. Slower, but keeps the fuller picture (JPEGs, not just the chocoprint).
// These photos are kept apart from test sessions, so tests stay fair.
// Uses the .cl/.cl-screen/.cl-tile/.cl-bar CSS that collect.js injects into <head> — needs collect.js loaded first.
(() => {
  if (window.ZADMIN !== true) return;
  const C = window.CHOCOLATES, $ = s => document.querySelector(s);
  const KEYS = [...Array.from({ length: 25 }, (_, i) => String(i)), "zdark", "zmilk", "zwhite"];
  const SHORT = k => k === "zdark" ? "Z dark" : k === "zmilk" ? "Z milk" : k === "zwhite" ? "Z white" : k;
  const LONG = k => C[k].z ? C[k].name : `N°${k} ${C[k].name}`;
  const CONDS = [
    { id: "window", name: "By a window", tip: "Daylight from a window, not in direct sun" },
    { id: "lamp", name: "Under a lamp", tip: "Ceiling light or desk lamp, evening-style light" },
    { id: "box", name: "Inside the box", tip: "In its place in the open box" }
  ];
  const PER = 8, GAP_MS = 300, MIN_SHARP = 45, MIN_LIGHT = 50;
  const PROMPTS = ["Hold the phone above it, number visible", "Tilt the phone a little each way", "A little closer, then a little further"];

  // ---------- storage (IndexedDB, plain bytes so iPhone Safari accepts it; memory fallback) ----------
  const dbp = new Promise((res, rej) => { const r = indexedDB.open("zscanner-reference", 1); r.onupgradeneeded = () => r.result.createObjectStore("shots", { autoIncrement: true }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (mode, fn) => { const db = await dbp; return new Promise((res, rej) => { const t = db.transaction("shots", mode); const q = fn(t.objectStore("shots")); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  const memory = [];
  const saveShots = async rows => { try { await tx("readwrite", s => rows.forEach(r => s.add(r))); } catch (e) { memory.push(...rows); } };
  const allShots = async () => { let st = []; try { st = await tx("readonly", s => s.getAll()) || []; } catch (e) {} return [...st, ...memory]; };
  const clearAll = async () => { memory.length = 0; try { await tx("readwrite", s => s.clear()); } catch (e) {} };
  const dataUrlBytes = u => { const b = atob(u.split(",")[1]), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a.buffer; };

  document.body.insertAdjacentHTML("beforeend", `
  <div class="cl" id="rf" hidden>
    <div class="cl-screen">
      <div style="display:flex;justify-content:space-between;align-items:center"><p class="eyebrow" style="color:#fff">Reference round</p>
        <button class="btn btn-light" type="button" id="rfClose" style="padding:10px 14px">Close</button></div>
      <div id="rfHome" class="cl-screen"></div>
      <div id="rfPick" class="cl-screen" hidden></div>
      <div id="rfRec" class="cl-screen" hidden>
        <h3 id="rfWhat"></h3>
        <div style="position:relative;aspect-ratio:1/1;background:#111;overflow:hidden"><video id="rfVideo" playsinline muted style="width:100%;height:100%;object-fit:cover"></video></div>
        <div class="cl-bar"><i id="rfBar" style="width:0%"></i></div>
        <p id="rfSay" style="font:500 18px/1.3 var(--serif)"></p>
        <p class="muted" id="rfCount"></p>
        <button class="btn btn-outline-light" type="button" id="rfStop" style="color:#fff;border:1px solid rgba(255,255,255,.4)">Stop</button>
      </div>
    </div>
  </div>`);
  const show = id => ["rfHome", "rfPick", "rfRec"].forEach(x => $("#" + x).hidden = x !== id);
  let cond = null, stream = null, timer = null;
  const stopCam = () => { clearTimeout(timer); timer = null; stream?.getTracks().forEach(t => t.stop()); stream = null; };
  const close = () => { stopCam(); $("#rf").hidden = true; document.body.style.overflow = ""; };
  $("#rfClose").onclick = close;

  async function home() {
    const rows = await allShots(), done = c => new Set(rows.filter(r => r.cond === c).map(r => r.key)).size;
    $("#rfHome").innerHTML = `
      <h3>Each chocolate in a few lights</h3>
      <p class="muted">Pick a light, then record each chocolate for a few seconds (${PER} close-ups). About 15 minutes per light for all 28. "Use right away" is live as soon as you push the file it downloads; "Download reference photos" is for folding into the next trained model properly. These photos teach the scanner new conditions; they are not a test.</p>
      ${CONDS.map(c => `<button class="cl-tile wide" type="button" data-c="${c.id}" style="text-align:left;padding:14px 16px;min-height:64px">
        <span style="display:block;font:500 12px var(--sans);letter-spacing:.2em">${c.name}</span>
        <span style="display:block;font:400 13px/1.4 var(--sans);letter-spacing:0;text-transform:none;opacity:.7;margin-top:4px">${c.tip} · ${done(c.id)}/28 done</span></button>`).join("")}
      <button class="btn btn-light" type="button" id="rfFresh" ${rows.some(r => r.vec) ? "" : "disabled"}>Use right away (${rows.filter(r => r.vec).length} chocoprints)</button>
      <button class="btn btn-outline-light" type="button" id="rfZip" style="color:#fff;border:1px solid rgba(255,255,255,.4)" ${rows.length ? "" : "disabled"}>Download reference photos (${rows.length})</button>
      <button class="tl-link" type="button" id="rfClear" style="color:rgba(255,255,255,.6);background:none;border:0;text-decoration:underline;cursor:pointer;align-self:flex-start">Clear reference photos</button>`;
    $("#rfHome").querySelectorAll("[data-c]").forEach(b => b.onclick = () => { cond = CONDS.find(c => c.id === b.dataset.c); pick(); });
    $("#rfFresh").onclick = downloadFresh;
    $("#rfZip").onclick = download;
    $("#rfClear").onclick = async e => { if (e.target.dataset.sure) { await clearAll(); home(); } else { e.target.dataset.sure = 1; e.target.textContent = "Tap again to delete all reference photos on this phone"; } };
    show("rfHome");
  }
  async function pick() {
    const rows = await allShots(), have = new Set(rows.filter(r => r.cond === cond.id).map(r => r.key));
    $("#rfPick").innerHTML = `<h3>${cond.name}</h3><p class="muted">${cond.tip}. Tap the chocolate you're about to record.</p>
      <div class="cl-grid">${KEYS.map(k => `<button class="cl-tile${k.startsWith("z") ? "" : ""}" type="button" data-k="${k}" style="${have.has(k) ? "background:rgba(255,255,255,.14)" : ""}">${SHORT(k)}${have.has(k) ? " ✓" : ""}</button>`).join("")}</div>
      <button class="btn btn-outline-light" type="button" id="rfBack" style="color:#fff;border:1px solid rgba(255,255,255,.4)">Back</button>`;
    $("#rfPick").querySelectorAll("[data-k]").forEach(b => b.onclick = () => record(b.dataset.k));
    $("#rfBack").onclick = home;
    show("rfPick");
  }
  async function record(key) {
    if (!Recognizer.ready) { $("#rfCount").textContent = "Preparing the scanner…"; await Recognizer.load(); }
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1920 } }, audio: false }); }
    catch (e) { alert("The camera could not be opened."); return; }
    const v = $("#rfVideo"); v.srcObject = stream; await v.play();
    $("#rfWhat").textContent = `${LONG(key)} · ${cond.name.toLowerCase()}`;
    show("rfRec");
    const shots = []; let last = 0;
    $("#rfStop").onclick = () => { stopCam(); pick(); };
    const tick = async () => {
      if (!stream) return;
      if (v.readyState >= 2 && performance.now() - last >= GAP_MS) {
        const r = Recognizer.scan(v);
        if (r.found && r.sharp >= MIN_SHARP && (!r.light || r.light.p90 >= MIN_LIGHT)) {
          shots.push({ url: Recognizer.snapshot(), vec: r.print?.vec ? r.print.vec.map(x => Math.round(x * 1e4) / 1e4) : null }); last = performance.now();
        }
        else $("#rfCount").textContent = !r.found ? "Point at the chocolate" : r.sharp < MIN_SHARP ? "Hold steady" : "A bit more light, please";
      }
      $("#rfBar").style.width = Math.round(100 * shots.length / PER) + "%";
      $("#rfSay").textContent = PROMPTS[Math.min(PROMPTS.length - 1, Math.floor(shots.length / (PER / PROMPTS.length)))];
      if (shots.length) $("#rfCount").textContent = `${shots.length} of ${PER} close-ups`;
      if (shots.length >= PER) {
        stopCam(); const t = Date.now();
        await saveShots(shots.map((s, i) => ({ cond: cond.id, key, t: t + i, bytes: dataUrlBytes(s.url), vec: s.vec })));
        pick(); return;
      }
      timer = setTimeout(tick, 60);
    };
    tick();
  }
  // Merge every captured chocoprint straight into custom-chocolates.json (same file "Add a chocolate" writes), under
  // the chocolate's own existing key — not added to its "chocolates" list, so it stays a normal, known chocolate;
  // this just gives the gallery extra, fresher reference prints for it. Live as soon as that file is pushed.
  async function downloadFresh(ev) {
    const btn = ev.currentTarget, rows = (await allShots()).filter(r => r.vec); if (!rows.length) return;
    btn.textContent = "Preparing…"; btn.disabled = true;
    let cu = { chocolates: {}, prints: [] };
    try { const r = await fetch("custom-chocolates.json", { cache: "no-store" }); if (r.ok) cu = await r.json(); } catch (e) {}
    // the three Z chocolates share one gallery mark ("z"); their shell decides which Z (same as training's mk())
    const mk = k => (k.startsWith("z") ? "z" : k);
    // each shot gets a stable id (light + chocolate + capture time, always unique) as a 3rd array element — ignored
    // by the existing [k, v] reader in recognizer.js, but lets this button be clicked again after new captures
    // without re-merging shots it already pushed last time
    const shotId = r => `${r.cond}:${r.key}:${r.t}`;
    const already = new Set((cu.prints || []).map(p => p[2]).filter(Boolean));
    const fresh = rows.filter(r => !already.has(shotId(r)));
    cu.prints = (cu.prints || []).concat(fresh.map(r => [mk(r.key), r.vec, shotId(r)]));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(cu)], { type: "application/json" }));
    a.download = "custom-chocolates.json"; document.body.appendChild(a); a.click(); a.remove();
    btn.textContent = `Use right away (${rows.length} chocoprints)`; btn.disabled = false;
  }
  async function download(ev) {
    const btn = ev.currentTarget, rows = await allShots(); if (!rows.length) return;
    btn.textContent = "Preparing…"; btn.disabled = true;
    const zip = new JSZip(), count = {};
    rows.forEach(r => { count[r.cond] = (count[r.cond] || 0) + 1; zip.file(`closeup/${r.key}/${r.cond}-${r.t}.jpg`, r.bytes); });
    zip.file("manifest.json", JSON.stringify({ kind: "reference round", made: new Date().toISOString(), model: Recognizer.model, closeups: rows.length, byLight: count }, null, 2));
    const blob = await zip.generateAsync({ type: "blob" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `zscanner-reference-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    btn.textContent = `Download reference photos (${rows.length})`; btn.disabled = false;
  }
  window.ZReference = { open: () => { $("#rf").hidden = false; document.body.style.overflow = "hidden"; home(); } };
})();
