// Manual label (admin page only): take one photo and say directly what's in it - no waiting for the live
// scanner to guess. For a real chocolate, drag a box around it; for background clutter with nothing there,
// just tag it "Nothing" - no box needed. Meant for building real, correctly-labelled finder training examples
// (distance, surface, background variety) faster than the full guided Collect-photos recording, since you
// already know the answer and don't need the scanner's own guess in the loop.
// Saves to IndexedDB like collect.js/reference.js; exports a zip with images plus labels.json in the same
// [x0,y0,x1,y1]-fraction format as training-photos/boxes.json, ready to merge in by hand.
// Uses the .cl/.cl-screen CSS that collect.js injects into <head> - needs collect.js loaded first.
(() => {
  if (window.ZADMIN !== true) return;
  const $ = s => document.querySelector(s);
  const C = window.CHOCOLATES;
  const KEYS = [...Array.from({ length: 25 }, (_, i) => String(i)), "zdark", "zmilk", "zwhite", "none"];
  const SHORT = k => k === "none" ? "Nothing" : k === "zdark" ? "Z dark" : k === "zmilk" ? "Z milk" : k === "zwhite" ? "Z white" : k;
  const LONG = k => k === "none" ? "Nothing (no chocolate in view)" : C[k].z ? C[k].name : `N°${k} ${C[k].name}`;
  const SIZE = 640;

  const tx = ZIdbStore.openStore("zscanner-manuallabel", "shots", { autoIncrement: true });
  const memory = []; let memoryOnly = false;
  const saveShot = async row => {
    if (!memoryOnly) { try { await tx("readwrite", s => s.add(row)); return; } catch (e) { memoryOnly = true; } }
    memory.push(row);
  };
  const allShots = async () => {
    let stored = []; try { stored = await tx("readonly", s => s.getAll()) || []; } catch (e) {}
    return [...stored, ...memory];
  };
  const clearAll = async () => { memory.length = 0; try { await tx("readwrite", s => s.clear()); } catch (e) {} };

  document.body.insertAdjacentHTML("beforeend", `<div class="cl" id="ml" hidden><div class="cl-screen" id="mlScreen"></div></div>`);
  const root = $("#ml"), screen = $("#mlScreen");
  const video = Object.assign(document.createElement("video"), { muted: true, autoplay: true, playsInline: true });
  video.setAttribute("playsinline", ""); video.setAttribute("muted", "");
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  let stream = null, shotBlob = null, shotUrl = null, count = 0;

  async function ensureCamera() {
    if (!stream || !stream.active || stream.getVideoTracks().every(t => t.readyState === "ended")) {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1920 } }, audio: false });
    }
    video.srcObject = null; video.srcObject = stream;
    await video.play().catch(() => {});
    if (!video.videoWidth) await new Promise(r => { video.onloadedmetadata = r; setTimeout(r, 3000); });
    if (!video.videoWidth) throw Object.assign(new Error("no picture"), { name: "NoPicture" });
  }
  function grabSquare() {
    const w = video.videoWidth, h = video.videoHeight, size = Math.min(w, h);
    ctx.drawImage(video, (w - size) / 2, (h - size) / 2, size, size, 0, 0, SIZE, SIZE);
    return new Promise(r => canvas.toBlob(r, "image/jpeg", 0.88));
  }
  async function refreshCount() { count = (await allShots()).length; }

  function showCapture() {
    screen.innerHTML = `
      <button class="cl-link" id="mlExit" type="button" style="align-self:flex-start">← Back to admin</button>
      <p class="eyebrow">zScanner · manual label</p>
      <h3>Take a photo</h3>
      <p class="muted">${count} saved so far. Hold it however you want to teach it - further away, on a different surface, in your hand, or point at background clutter with nothing there.</p>
      <div class="cl-cam" id="mlCam"><span class="cl-dot">Ready</span></div>
      <button class="btn btn-light" id="mlShoot" type="button" disabled>Starting camera…</button>
      <p class="cl-err" id="mlErr"></p>
      <button class="btn btn-outline-light" id="mlZip" type="button" ${count ? "" : "disabled"}>Download labelled photos (.zip)${count ? " · " + count : ""}</button>
      <button class="cl-link" id="mlClear" type="button">Delete all manual photos</button>`;
    screen.querySelector("#mlCam").prepend(video);
    $("#mlExit").onclick = close;
    $("#mlZip").onclick = downloadZip;
    let armed = false;
    $("#mlClear").onclick = async e => {
      if (!armed) { armed = true; e.target.textContent = "Tap again to delete everything"; return; }
      await clearAll(); await refreshCount(); showCapture();
    };
    const shoot = $("#mlShoot"), err = $("#mlErr");
    ensureCamera().then(() => { shoot.disabled = false; shoot.textContent = "Take photo"; })
      .catch(e => {
        err.textContent = e.name === "NotAllowedError" ? "Camera access is blocked. Tap “aA” in Safari's address bar → Website Settings → Camera → Allow, then reload."
          : "The camera couldn't start (" + e.name + ").";
      });
    shoot.onclick = async () => { shoot.disabled = true; shoot.textContent = "…"; shotBlob = await grabSquare(); shotUrl = URL.createObjectURL(shotBlob); showPick(); };
  }

  function showPick() {
    screen.innerHTML = `
      <p class="eyebrow">What's this?</p>
      <img src="${shotUrl}" style="width:100%;aspect-ratio:1/1;object-fit:cover" alt="">
      <div class="cl-grid">${KEYS.map(k => `<button class="cl-tile ${k.length > 2 ? "wide" : ""}" data-k="${k}" type="button">${SHORT(k)}</button>`).join("")}</div>
      <button class="btn btn-outline-light" id="mlRetake" type="button">Retake</button>`;
    $("#mlRetake").onclick = showCapture;
    screen.querySelectorAll(".cl-tile").forEach(b => b.onclick = () => { const k = b.dataset.k; k === "none" ? saveAndNext(k, null) : showBox(k); });
  }

  // drag a box on the just-taken photo: press one corner of the chocolate, drag to the other, release
  function showBox(key) {
    screen.innerHTML = `
      <p class="eyebrow">${LONG(key)}</p>
      <h3>Drag a box around it</h3>
      <div id="mlBoxWrap" style="position:relative;width:100%;aspect-ratio:1/1;touch-action:none">
        <img src="${shotUrl}" style="width:100%;height:100%;object-fit:cover;display:block" alt="">
        <div id="mlRect" style="position:absolute;border:2px solid #fff;background:rgba(255,255,255,.15);display:none;pointer-events:none"></div>
      </div>
      <p class="muted">Press and drag from one corner of the chocolate to the other, then Save.</p>
      <div class="cl-row">
        <button class="btn btn-outline-light" id="mlRetake2" type="button">Retake</button>
        <button class="btn btn-light" id="mlConfirm" type="button" disabled>Save</button>
      </div>`;
    $("#mlRetake2").onclick = showCapture;
    const wrap = $("#mlBoxWrap"), rect = $("#mlRect"), confirm = $("#mlConfirm");
    let box = null, sx = 0, sy = 0, dragging = false;
    const relPos = e => { const r = wrap.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    const draw = (x0, y0, x1, y1) => {
      rect.style.display = "block";
      rect.style.left = Math.min(x0, x1) * 100 + "%"; rect.style.top = Math.min(y0, y1) * 100 + "%";
      rect.style.width = Math.abs(x1 - x0) * 100 + "%"; rect.style.height = Math.abs(y1 - y0) * 100 + "%";
    };
    wrap.onpointerdown = e => { dragging = true; confirm.disabled = true; [sx, sy] = relPos(e); wrap.setPointerCapture(e.pointerId); };
    wrap.onpointermove = e => { if (!dragging) return; const [x, y] = relPos(e); draw(sx, sy, x, y); };
    wrap.onpointerup = e => {
      if (!dragging) return; dragging = false;
      const [x, y] = relPos(e);
      const x0 = Math.max(0, Math.min(sx, x)), x1 = Math.min(1, Math.max(sx, x));
      const y0 = Math.max(0, Math.min(sy, y)), y1 = Math.min(1, Math.max(sy, y));
      if (x1 - x0 < 0.03 || y1 - y0 < 0.03) return;   // too small to be a real drag, not a box
      box = [x0, y0, x1, y1]; confirm.disabled = false;
    };
    confirm.onclick = () => saveAndNext(key, box);
  }

  async function saveAndNext(key, box) {
    await saveShot({ key, box, blob: shotBlob, t: Date.now() });
    shotBlob = null; shotUrl = null;
    await refreshCount(); showCapture();
  }

  async function downloadZip(e) {
    const btn = e.target, shots = await allShots(); if (!shots.length) return;
    btn.textContent = "Preparing zip…"; btn.disabled = true;
    const zip = new JSZip(), labels = {};
    shots.forEach(s => { const name = `${s.key}/manual_${s.t}.jpg`; zip.file(name, s.blob); labels[name] = s.box; });
    zip.file("labels.json", JSON.stringify(labels, null, 2));
    const blob = await zip.generateAsync({ type: "blob" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `zscanner-manual-labels-${new Date().toISOString().slice(0, 10)}.zip` });
    document.body.append(a); a.click(); a.remove();
    btn.disabled = false; btn.textContent = `Download labelled photos (.zip) · ${shots.length}`;
  }

  function close() { stream?.getTracks().forEach(t => t.stop()); stream = null; root.hidden = true; document.body.style.overflow = ""; }
  window.ZManualLabel = { open: async () => { root.hidden = false; document.body.style.overflow = "hidden"; await refreshCount(); showCapture(); } };
})();
