// Add a chocolate (admin page only): teach the scanner a new chocolate (seasonal, delicacies) from a few seconds of
// camera, without retraining. The phone turns each good frame into a chocoprint; these, with the name, shell,
// description and a photo, go into custom-chocolates.json. Put that file in the Zscanner app folder and push it:
// every scanner then knows the chocolate. Needs a model with chocoprints.
(() => {
  if (window.ZADMIN !== true) return;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const TARGET = 24, EVERY_MS = 180, MIN_SHARP = 45;
  const PROMPTS = ["Hold the phone above it, number visible", "Tilt the phone a little each way", "Move a little closer, then further away"];

  document.body.insertAdjacentHTML("beforeend", `
  <div class="cl" id="ac" hidden>
    <div class="cl-screen">
      <div style="display:flex;justify-content:space-between;align-items:center"><p class="eyebrow" style="color:#fff">Add a chocolate</p>
        <button class="btn btn-light" type="button" id="acClose" style="padding:10px 14px">Close</button></div>
      <div id="acForm" class="cl-screen" style="gap:10px">
        <h3>New chocolate</h3>
        <p class="muted">The scanner learns it from about ${TARGET} camera frames. Clients see the name, description and photo.</p>
        <input id="acName" placeholder="Name (e.g. Christmas spiced praliné)" style="font:16px var(--sans);padding:12px;background:#111;color:#fff;border:1px solid rgba(255,255,255,.35)">
        <input id="acNo" placeholder="Number on it, if any (e.g. 25)" style="font:16px var(--sans);padding:12px;background:#111;color:#fff;border:1px solid rgba(255,255,255,.35)">
        <select id="acShell" style="font:16px var(--sans);padding:12px;background:#111;color:#fff;border:1px solid rgba(255,255,255,.35)">
          <option value="dark">Dark shell</option><option value="milk">Milk shell</option><option value="white">White shell</option></select>
        <textarea id="acDesc" rows="4" placeholder="Description" style="font:16px var(--sans);padding:12px;background:#111;color:#fff;border:1px solid rgba(255,255,255,.35)"></textarea>
        <input id="acTags" placeholder="Tags, separated by commas (e.g. Seasonal, Gluten-free)" style="font:16px var(--sans);padding:12px;background:#111;color:#fff;border:1px solid rgba(255,255,255,.35)">
        <button class="btn btn-light" type="button" id="acGo">Record it</button>
        <p class="muted" id="acMsg"></p>
      </div>
      <div id="acRec" hidden class="cl-screen">
        <div style="position:relative;aspect-ratio:1/1;background:#111;overflow:hidden"><video id="acVideo" playsinline muted style="width:100%;height:100%;object-fit:cover"></video></div>
        <div class="cl-bar"><i id="acBar" style="width:0%"></i></div>
        <p id="acSay" style="font:500 18px/1.3 var(--serif)"></p>
        <p class="muted" id="acCount"></p>
      </div>
      <div id="acDone" hidden class="cl-screen">
        <h3>Ready to add</h3>
        <div style="display:flex;gap:12px;align-items:center"><img id="acImg" alt="" style="width:96px;height:96px;object-fit:cover"><p id="acSum"></p></div>
        <button class="btn btn-light" type="button" id="acSave">Download custom-chocolates.json</button>
        <button class="btn btn-outline-light" type="button" id="acRetake" style="color:#fff;border:1px solid rgba(255,255,255,.4)">Record again</button>
        <p class="muted">Then put the file in Documents → GitHub → Zscanner → app (replace the old one if asked), and Commit + Push in GitHub Desktop. It already includes every chocolate added before.</p>
      </div>
    </div>
  </div>`);

  let stream = null, prints = [], photoUrl = "", timer = null;
  const show = id => ["acForm", "acRec", "acDone"].forEach(x => $("#" + x).hidden = x !== id);
  const stop = () => { clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); stream = null; };
  const close = () => { stop(); $("#ac").hidden = true; document.body.style.overflow = ""; };
  $("#acClose").onclick = close;

  async function record() {
    if (!$("#acName").value.trim()) { $("#acMsg").textContent = "Please give it a name first."; return; }
    if (!Recognizer.ready) await Recognizer.load();
    if (!Recognizer.hasPrints) { $("#acMsg").textContent = "This needs the chocoprint model, which isn't live yet."; return; }
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1920 } }, audio: false }); }
    catch (e) { $("#acMsg").textContent = "The camera could not be opened."; return; }
    const v = $("#acVideo"); v.srcObject = stream; await v.play();
    prints = []; photoUrl = ""; show("acRec");
    const tick = () => {
      if (!stream) return;
      if (v.readyState >= 2) {
        const r = Recognizer.scan(v);
        if (r.found && r.sharp >= MIN_SHARP && r.print?.vec) {
          prints.push(r.print.vec.map(x => Math.round(x * 1e4) / 1e4));
          if (!photoUrl || prints.length === Math.round(TARGET / 2)) photoUrl = Recognizer.snapshot();
        }
      }
      const n = prints.length;
      $("#acBar").style.width = Math.round(100 * n / TARGET) + "%";
      $("#acSay").textContent = PROMPTS[Math.min(PROMPTS.length - 1, Math.floor(n / (TARGET / PROMPTS.length)))];
      $("#acCount").textContent = `${n} of ${TARGET} good frames`;
      if (n >= TARGET) { stop(); done(); return; }
      timer = setTimeout(tick, EVERY_MS);
    };
    tick();
  }
  function done() {
    $("#acImg").src = photoUrl;
    $("#acSum").innerHTML = `<b>${esc($("#acName").value.trim())}</b><br><span class="muted">${prints.length} chocoprints, ${esc($("#acShell").value)} shell</span>`;
    show("acDone");
  }
  async function save() {
    let cu = { chocolates: {}, prints: [] };
    try { const r = await fetch("custom-chocolates.json", { cache: "no-store" }); if (r.ok) cu = await r.json(); } catch (e) {}
    const name = $("#acName").value.trim(), no = $("#acNo").value.trim();
    const key = "c-" + (no || name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    cu.chocolates[key] = { name, no: no || undefined, cv: $("#acShell").value, d: $("#acDesc").value.trim(),
      tags: $("#acTags").value.split(",").map(t => t.trim()).filter(Boolean), img: photoUrl, added: new Date().toISOString().slice(0, 10) };
    cu.prints = (cu.prints || []).filter(([k]) => k !== key).concat(prints.map(p => [key, p]));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(cu)], { type: "application/json" }));
    a.download = "custom-chocolates.json"; document.body.appendChild(a); a.click(); a.remove();
  }
  $("#acGo").onclick = record;
  $("#acRetake").onclick = () => { show("acForm"); };
  $("#acSave").onclick = save;
  window.ZAddChoc = { open: () => { $("#ac").hidden = false; document.body.style.overflow = "hidden"; $("#acMsg").textContent = ""; show("acForm"); } };
})();
