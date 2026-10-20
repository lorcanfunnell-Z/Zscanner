// Hidden "collect" mode for building training photos: add ?collect to the scanner address.
// Pick a chocolate → guided 9-second recording → review → Save or Retake → next chocolate.
// Photos stay on the phone (IndexedDB) until you download them as one zip for retraining.
(() => {
  if (!/[?&]collect\b/.test(location.search)) return;

  const C = window.CHOCOLATES;
  const KEYS = [...Array.from({ length: 25 }, (_, i) => String(i)), "zdark", "zmilk", "zwhite", "none"];
  const SHORT = k => k === "none" ? "Nothing" : k === "zdark" ? "Z dark" : k === "zmilk" ? "Z milk" : k === "zwhite" ? "Z white" : k;
  const LONG = k => k === "none" ? "Nothing (empty box, table, hand)" : C[k].z ? C[k].name : `N°${k} ${C[k].name}`;
  // Guided recording: each step shows a prompt while frames are taken
  const STEPS = [
    { say: "Hold it still in the circle", n: 12 },
    { say: "Slowly tilt it left and right", n: 12 },
    { say: "Slowly turn it a little", n: 10 },
    { say: "Move the phone closer, then further", n: 11 }
  ];
  const NOTHING_STEPS = [{ say: "Point at the empty box or table and move around slowly", n: 45 }];
  const EVERY_MS = 200, SAVE_SHARE = 0.85, SIZE = 384;

  // ---------- storage ----------
  const dbp = new Promise((res, rej) => {
    const r = indexedDB.open("zscanner-collect", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("shots", { autoIncrement: true });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => { const db = await dbp; return new Promise((res, rej) => { const t = db.transaction("shots", mode); const q = fn(t.objectStore("shots")); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  // iPhone Safari can refuse to store Blob objects, so photos are stored as raw bytes.
  // If storage fails completely, photos are kept in memory for this visit (download before closing the tab).
  const memory = []; let memoryOnly = false;
  const saveShots = async (key, blobs) => {
    const t = Date.now();
    const rows = await Promise.all(blobs.map(async (b, i) => ({ key, bytes: await b.arrayBuffer(), type: b.type || "image/jpeg", t: t + i })));
    if (!memoryOnly) {
      try { await tx("readwrite", s => rows.forEach(r => s.add(r))); return; }
      catch (e) { console.warn("Storage failed, keeping photos in memory", e); memoryOnly = true; }
    }
    memory.push(...rows);
  };
  const allShots = async () => {
    let stored = [];
    try { stored = await tx("readonly", s => s.getAll()) || []; } catch (e) { memoryOnly = true; }
    return [...stored, ...memory].map(r => ({ key: r.key, t: r.t, blob: r.blob || new Blob([r.bytes], { type: r.type || "image/jpeg" }) }));
  };
  const clearAll = async () => { memory.length = 0; try { await tx("readwrite", s => s.clear()); } catch (e) {} };

  // ---------- UI ----------
  document.head.insertAdjacentHTML("beforeend", `<style>
  .cl{position:fixed;inset:0;z-index:50;background:#000;color:#fff;overflow:auto;font:400 14px/1.5 var(--sans);
      padding:calc(16px + env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) calc(20px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px))}
  .cl h3{margin:0;color:#fff;font:500 26px/1.15 var(--serif)}
  .cl p{margin:0}
  .cl .muted{color:rgba(255,255,255,.65);font-size:13px}
  .cl-screen{display:flex;flex-direction:column;gap:14px;max-width:560px;margin:0 auto}
  .cl-bar{height:2px;background:rgba(255,255,255,.2)} .cl-bar i{display:block;height:100%;background:#fff;transition:width .3s}
  .cl-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}
  .cl-tile{appearance:none;aspect-ratio:1/1;border:1px solid rgba(255,255,255,.25);background:transparent;color:#fff;font:400 20px/1 var(--serif);cursor:pointer;position:relative;padding:0}
  .cl-tile.wide{grid-column:span 5;aspect-ratio:auto;min-height:48px;font:500 11px/1 var(--sans);letter-spacing:.2em;text-transform:uppercase}
  .cl-tile.done{background:#fff;color:#000}
  .cl-tile.done::after{content:"✓";position:absolute;top:3px;right:5px;font:500 10px var(--sans)}
  .cl-tile.cl-next{outline:1px solid #fff;outline-offset:2px}
  .cl-cam{position:relative;width:100%;aspect-ratio:1/1;background:#111;overflow:hidden}
  .cl-cam video{width:100%;height:100%;object-fit:cover;display:block}
  .cl-cam .sq{position:absolute;inset:15%;box-shadow:0 0 0 999px rgba(0,0,0,.45)}
  .cl-cam .ring{position:absolute;left:26.5%;top:26.5%;width:47%;height:47%;border-radius:50%;border:1px dashed rgba(255,255,255,.7)}
  .cl-cam.rec .ring{border:2px solid #e5484d}
  .cl-say{position:absolute;left:0;right:0;bottom:14px;text-align:center;font:500 15px/1.3 var(--sans);text-shadow:0 1px 4px rgba(0,0,0,.8);padding:0 12px}
  .cl-dot{position:absolute;top:12px;left:12px;font:500 11px var(--sans);letter-spacing:.15em;text-transform:uppercase;background:rgba(0,0,0,.6);padding:6px 10px}
  .cl-thumbs{display:grid;grid-template-columns:repeat(6,1fr);gap:3px}
  .cl-thumbs img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block}
  .cl-row{display:flex;gap:10px} .cl-row .btn{flex:1}
  .cl .btn{width:100%}
  .cl-err{color:#f0b9a8;font-size:13px}
  .cl-link{background:none;border:0;color:rgba(255,255,255,.6);text-decoration:underline;font:inherit;font-size:13px;cursor:pointer;padding:6px 0}
  </style>`);
  const root = document.createElement("div"); root.className = "cl"; document.body.append(root);
  const video = Object.assign(document.createElement("video"), { muted: true, autoplay: true, playsInline: true });
  video.setAttribute("playsinline", ""); video.setAttribute("muted", "");
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  let counts = {}, current = null, takes = [], stream = null;

  async function refreshCounts() {
    counts = {}; (await allShots()).forEach(s => counts[s.key] = (counts[s.key] || 0) + 1);
  }
  const nextKey = () => KEYS.find(k => !counts[k]);
  const doneN = () => KEYS.filter(k => counts[k]).length;

  // ---------- screen 1: pick a chocolate ----------
  async function showPicker() {
    await refreshCounts();
    const nk = nextKey(), total = Object.values(counts).reduce((a, b) => a + b, 0);
    root.innerHTML = `<div class="cl-screen">
      <p class="eyebrow">zScanner · training photos</p>
      <h3>Which chocolate are you recording?</h3>
      <div class="cl-bar"><i style="width:${doneN() / KEYS.length * 100}%"></i></div>
      <p class="muted">${doneN()} of ${KEYS.length} done${nk ? ` · next up: ${LONG(nk)}` : " · all done!"}. A second round somewhere else (another room or light) makes it even better.</p>
      ${memoryOnly ? `<p class="cl-err">This phone isn't letting the page store photos, so they're only kept while this tab is open. Download the zip before closing it.</p>` : ""}
      <div class="cl-grid">${KEYS.map(k => `<button class="cl-tile ${k.length > 2 ? "wide" : ""} ${counts[k] ? "done" : ""} ${k === nk ? "cl-next" : ""}" data-k="${k}" type="button">${SHORT(k)}</button>`).join("")}</div>
      <button class="btn btn-light" id="clZip" type="button" ${total ? "" : "disabled"}>Download all photos (.zip)${total ? " · " + total : ""}</button>
      <button class="cl-link" id="clClear" type="button">Delete all collected photos</button>
    </div>`;
    root.querySelectorAll(".cl-tile").forEach(b => b.onclick = () => showRecord(b.dataset.k));
    root.querySelector("#clZip").onclick = downloadZip;
    let armed = false;
    root.querySelector("#clClear").onclick = async e => {
      if (!armed) { armed = true; e.target.textContent = "Tap again to delete everything"; return; }
      await clearAll(); showPicker();
    };
  }

  // ---------- camera ----------
  async function ensureCamera() {
    if (stream && stream.active) return true;
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    video.srcObject = stream; await video.play();
    if (!video.videoWidth) await new Promise(r => video.onloadedmetadata = r);
    return true;
  }
  function grab() {
    const w = video.videoWidth, h = video.videoHeight, size = Math.round(Math.min(w, h) * SAVE_SHARE);
    ctx.drawImage(video, (w - size) / 2, (h - size) / 2, size, size, 0, 0, SIZE, SIZE);
    return new Promise(r => canvas.toBlob(r, "image/jpeg", 0.88));
  }

  // ---------- screen 2: record ----------
  async function showRecord(key) {
    current = key; takes = [];
    root.innerHTML = `<div class="cl-screen">
      <button class="cl-link" id="clBack" type="button" style="align-self:flex-start">← All chocolates</button>
      <h3>${LONG(key)}</h3>
      <div class="cl-cam" id="clCam"><span class="cl-dot" id="clDot">Ready</span><div class="sq"></div><div class="ring"></div><div class="cl-say" id="clSay">${key === "none" ? "Point at the empty box or the table" : "Put the chocolate in the circle"}</div></div>
      <p class="muted">${key === "none" ? "No chocolate in view. Takes about 9 seconds." : "Follow the prompts on screen. It takes about 9 seconds."}</p>
      <button class="btn btn-light" id="clGo" type="button">Start recording</button>
      <p class="cl-err" id="clErr"></p>
    </div>`;
    root.querySelector("#clCam").prepend(video);
    root.querySelector("#clBack").onclick = showPicker;
    const go = root.querySelector("#clGo"), err = root.querySelector("#clErr");
    try { await ensureCamera(); }
    catch (e) {
      err.textContent = e.name === "NotAllowedError"
        ? "Camera access is blocked. Tap “aA” in Safari's address bar → Website Settings → Camera → Allow, then reload."
        : "The camera couldn't start (" + e.name + "). Close other apps using the camera and reload.";
      go.disabled = true; return;
    }
    go.onclick = record;
  }

  async function record() {
    const go = root.querySelector("#clGo"), say = root.querySelector("#clSay"), dot = root.querySelector("#clDot"), cam = root.querySelector("#clCam");
    go.disabled = true; cam.classList.add("rec");
    for (let c = 3; c > 0; c--) { dot.textContent = "Starting in " + c; await new Promise(r => setTimeout(r, 700)); }
    const steps = current === "none" ? NOTHING_STEPS : STEPS, total = steps.reduce((a, s) => a + s.n, 0);
    let i = 0;
    for (const step of steps) {
      say.textContent = step.say;
      for (let k = 0; k < step.n; k++) {
        takes.push(await grab()); i++;
        dot.textContent = `● Recording ${Math.round(i / total * 100)}%`;
        await new Promise(r => setTimeout(r, EVERY_MS));
      }
    }
    cam.classList.remove("rec");
    if (navigator.vibrate) navigator.vibrate(80);
    showReview();
  }

  // ---------- screen 3: review ----------
  function showReview() {
    const pick = takes.filter((_, i) => i % Math.ceil(takes.length / 12) === 0).slice(0, 12);
    root.innerHTML = `<div class="cl-screen">
      <p class="eyebrow">Check the photos</p>
      <h3>${LONG(current)}</h3>
      <p class="muted">${takes.length} photos taken. ${current === "none" ? "Make sure no chocolate is in them." : "The chocolate should be in most of them and not too blurry."}</p>
      <div class="cl-thumbs">${pick.map(b => `<img src="${URL.createObjectURL(b)}" alt="">`).join("")}</div>
      <div class="cl-row">
        <button class="btn btn-outline-light" id="clRetake" type="button">Retake</button>
        <button class="btn btn-light" id="clSave" type="button">Save</button>
      </div>
    </div>`;
    root.querySelector("#clRetake").onclick = () => showRecord(current);
    root.querySelector("#clSave").onclick = async e => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = "Saving…";
      try { await saveShots(current, takes); }
      catch (err) { btn.disabled = false; btn.textContent = "Save"; root.querySelector(".muted").textContent = "Couldn't save: " + (err && (err.message || err.name) || err) + ". Take a screenshot and send it to Claude."; return; }
      takes = [];
      await refreshCounts();
      const nk = nextKey();
      root.innerHTML = `<div class="cl-screen">
        <p class="eyebrow">Saved</p>
        <h3>${LONG(current)} ✓</h3>
        <p class="muted">${doneN()} of ${KEYS.length} done.</p>
        ${nk ? `<button class="btn btn-light" id="clNext" type="button">Next: ${LONG(nk)}</button>` : `<p>Everything is recorded. Download the zip and send it over.</p>`}
        <button class="btn btn-outline-light" id="clList" type="button">Choose a different one</button>
      </div>`;
      const nb = root.querySelector("#clNext"); if (nb) nb.onclick = () => showRecord(nk);
      root.querySelector("#clList").onclick = showPicker;
    };
  }

  // ---------- download ----------
  async function downloadZip(e) {
    const btn = e.target, shots = await allShots(); if (!shots.length) return;
    btn.textContent = "Preparing zip…"; btn.disabled = true;
    const zip = new JSZip(), n = {};
    shots.forEach(s => { n[s.key] = (n[s.key] || 0) + 1; zip.file(`${s.key}/cam_${s.t}.jpg`, s.blob); });
    const blob = await zip.generateAsync({ type: "blob" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `zscanner-photos-${new Date().toISOString().slice(0, 10)}.zip` });
    document.body.append(a); a.click(); a.remove();
    btn.disabled = false; btn.textContent = `Download all photos (.zip) · ${shots.length}`;
  }

  showPicker();
})();
