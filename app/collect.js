// Hidden "collect" mode for building training photos: open the scanner with ?collect at the end of the address.
// For each chocolate it records 40 camera frames (framed exactly like live scanning) while you slowly tilt and turn it,
// keeps them on the phone (survives a reload), and downloads everything as one zip for retraining.
(() => {
  if (!/[?&]collect\b/.test(location.search)) return;

  const KEYS = [...Array.from({ length: 25 }, (_, i) => String(i)), "zdark", "zmilk", "zwhite", "none"];
  const NAME = k => k === "none" ? "Nothing (box, table, hand)" : k.startsWith("z") ? window.CHOCOLATES[k].name : "N°" + k + " " + window.CHOCOLATES[k].name;
  const SHOTS = 40, EVERY_MS = 200, SAVE_SHARE = 0.85, SIZE = 384; // saved view is a little wider than the live square (0.70)

  // ---- storage (IndexedDB) ----
  const dbp = new Promise((res, rej) => {
    const r = indexedDB.open("zscanner-collect", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("shots", { autoIncrement: true });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => { const db = await dbp; return new Promise((res, rej) => { const t = db.transaction("shots", mode); const out = fn(t.objectStore("shots")); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error); }); };
  const addShot = (key, blob) => tx("readwrite", s => s.add({ key, blob, t: Date.now() }));
  const allShots = () => tx("readonly", s => s.getAll());
  const clearAll = () => tx("readwrite", s => s.clear());

  // ---- UI ----
  const css = `
  .col{position:fixed;inset:0;z-index:50;background:#000;color:#fff;display:flex;flex-direction:column;font:400 14px/1.5 var(--sans)}
  .col-top{padding:calc(12px + env(safe-area-inset-top,0px)) 16px 10px;display:flex;flex-direction:column;gap:8px}
  .col-top h3{margin:0;color:#fff;font:500 22px/1.2 var(--serif)}
  .col-top select{font:inherit;padding:10px;background:#111;color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:0}
  .col-cam{position:relative;width:100%;aspect-ratio:1/1;background:#111;overflow:hidden}
  .col-cam video{width:100%;height:100%;object-fit:cover}
  .col-cam .sq{position:absolute;inset:15%;border:1px solid #fff;box-shadow:0 0 0 999px rgba(0,0,0,.45)}
  .col-cam .ring{position:absolute;left:26.5%;top:26.5%;width:47%;height:47%;border-radius:50%;border:1px dashed rgba(255,255,255,.6)}
  .col-cam .count{position:absolute;top:10px;left:10px;font:500 13px var(--sans);letter-spacing:.1em;background:rgba(0,0,0,.6);padding:6px 10px}
  .col-bot{padding:12px 16px calc(16px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:10px;overflow:auto}
  .col-bot .btn{width:100%}
  .col-tip{color:rgba(255,255,255,.7);font-size:13px;margin:0}
  .col-prog{font-size:12px;color:rgba(255,255,255,.75);display:flex;flex-wrap:wrap;gap:4px}
  .col-prog span{padding:2px 6px;border:1px solid rgba(255,255,255,.25)} .col-prog span.done{background:#fff;color:#000}`;
  document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);
  document.body.insertAdjacentHTML("beforeend", `
    <div class="col" id="col">
      <div class="col-top">
        <h3>Collect training photos</h3>
        <select id="colKey" aria-label="Chocolate">${KEYS.map(k => `<option value="${k}">${NAME(k)}</option>`).join("")}</select>
      </div>
      <div class="col-cam"><video id="colVideo" playsinline muted></video><div class="sq"></div><div class="ring"></div><div class="count" id="colCount"></div></div>
      <div class="col-bot">
        <button class="btn btn-light" id="colRec" type="button">Record 40 photos</button>
        <p class="col-tip" id="colTip">Hold the chocolate in the circle. While recording, slowly tilt and turn it a little, and move the phone slightly closer and further. Do each chocolate in two places (e.g. in the box and on the table) for best results.</p>
        <div class="col-prog" id="colProg"></div>
        <button class="btn btn-outline-light" id="colZip" type="button">Download all photos (.zip)</button>
        <button class="btn btn-outline-light" id="colClear" type="button">Delete all collected photos</button>
      </div>
    </div>`);

  const $ = s => document.querySelector(s);
  const video = $("#colVideo"), keySel = $("#colKey");
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  let busy = false, counts = {};

  async function refresh() {
    const shots = await allShots(); counts = {};
    shots.forEach(s => counts[s.key] = (counts[s.key] || 0) + 1);
    $("#colProg").innerHTML = KEYS.map(k => `<span class="${counts[k] ? "done" : ""}">${k === "none" ? "none" : k.replace(/^z/, "Z ")}${counts[k] ? " · " + counts[k] : ""}</span>`).join("");
    $("#colCount").textContent = `${counts[keySel.value] || 0} saved for this one`;
  }
  keySel.onchange = refresh;

  async function startCam() {
    try {
      video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
      await video.play();
    } catch (e) { $("#colTip").textContent = "Camera not available: " + e.name + ". Open this page in Safari over https and allow the camera."; }
  }

  $("#colRec").onclick = async () => {
    if (busy || !video.videoWidth) return; busy = true;
    const key = keySel.value, btn = $("#colRec");
    for (let i = 0; i < SHOTS; i++) {
      const w = video.videoWidth, h = video.videoHeight, side = Math.min(w, h), size = Math.round(side * SAVE_SHARE);
      ctx.drawImage(video, (w - size) / 2, (h - size) / 2, size, size, 0, 0, SIZE, SIZE);
      const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.88));
      await addShot(key, blob);
      btn.textContent = `Recording… ${i + 1}/${SHOTS}`;
      await new Promise(r => setTimeout(r, EVERY_MS));
    }
    btn.textContent = "Record 40 photos"; busy = false;
    if (navigator.vibrate) navigator.vibrate(80);
    const next = KEYS[KEYS.indexOf(key) + 1];
    if (next && !counts[next]) keySel.value = next; // move on to the next chocolate
    refresh();
  };

  $("#colZip").onclick = async () => {
    const btn = $("#colZip"), shots = await allShots();
    if (!shots.length) return;
    btn.textContent = "Preparing zip…";
    const zip = new JSZip(), n = {};
    shots.forEach(s => { n[s.key] = (n[s.key] || 0) + 1; zip.file(`${s.key}/cam_${s.t}_${n[s.key]}.jpg`, s.blob); });
    const blob = await zip.generateAsync({ type: "blob" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `zscanner-photos-${new Date().toISOString().slice(0, 10)}.zip` });
    document.body.append(a); a.click(); a.remove();
    btn.textContent = `Download all photos (.zip) · ${shots.length} photos`;
  };

  let armed = false;
  $("#colClear").onclick = async () => {
    const b = $("#colClear");
    if (!armed) { armed = true; b.textContent = "Tap again to delete everything"; setTimeout(() => { armed = false; b.textContent = "Delete all collected photos"; }, 4000); return; }
    await clearAll(); armed = false; b.textContent = "Delete all collected photos"; refresh();
  };

  startCam(); refresh();
})();
