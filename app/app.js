// zScanner: camera, result card, number tray.
(() => {
  const C = window.CHOCOLATES;
  const SITE = "https://www.zchocolat.com";
  const SHOP = SITE + "/collections/28-chocolate-assortments";
  // Official studio photos from the zchocolat.com tasting guide; our own photo is the fallback
  const photo = k => SITE + "/img/cms/flavors/" + (k.startsWith("z") ? "z-" + k.slice(1) : "n" + k.padStart(2, "0")) + ".jpg";
  const COUV = {
    dark: { label: "70% dark couverture", sw: "var(--dark-c)" },
    milk: { label: "40% milk couverture", sw: "var(--milk-c)" },
    white: { label: "White couverture", sw: "var(--white-c)" }
  };
  // Recognition settings
  const INSTANT = 0.90;     // one clear frame this sure → answer straight away
  const SETTLED = 0.80;     // or: the running average of recent frames this sure (needs at least 3 frames)
  const MEMORY = 0.6;       // how much each new frame keeps of the running average (higher = smoother, slower)
  const PHOTO_SURE = 0.55;  // single photos: show the top match above this, else offer choices

  const $ = s => document.querySelector(s);
  let META = { shellOf: {}, markOf: {} };
  fetch("model2/meta.json").then(r => r.json()).then(m => META = m).catch(() => {});
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function utm(url, content) {
    const u = new URL(url);
    u.searchParams.set("utm_source", "zscanner");
    u.searchParams.set("utm_medium", "gift_recipient");
    u.searchParams.set("utm_campaign", "zscanner");
    if (content) u.searchParams.set("utm_content", content);
    return u.toString();
  }
  document.querySelectorAll("a[data-utm]").forEach(a => a.href = utm(a.href, a.dataset.utm));
  const setStatus = (html, cls = "") => { const s = $("#status"); s.className = "status " + cls; s.innerHTML = html; };
  const label = k => C[k].z ? C[k].name : "N°" + k + " " + C[k].name;

  // ---------- Result card ----------
  function render(key, opts = {}) {
    const c = C[key]; if (!c) return;
    const title = c.z
      ? esc(c.name)
      : `<span class="n"><span class="no">N°</span>${esc(key)}</span>${esc(c.name)}`;
    const zpick = c.z ? `
      <div class="zpick">
        <p>${opts.scanned ? "Please confirm the colour of the shell." : "Which colour is the shell of your Z chocolate?"}</p>
        <div class="zrow">${["dark", "milk", "white"].map(t => `<button class="zbtn" type="button" data-z="${t}" aria-pressed="${"z" + t === key}"><span class="sw" style="background:${COUV[t].sw}"></span>${t}</button>`).join("")}</div>
      </div>` : "";
    const meta = [COUV[c.cv].label, ...c.tags].map(esc).join(" · ");
    $("#result").innerHTML = `
      <article class="card">
        <div class="card-photo">
          <img src="${photo(key)}" alt="${esc(c.name)}" onerror="this.onerror=null;this.src='images/${esc(key)}.jpg'">
          ${opts.example ? '<span class="badge">Example</span>' : ""}
        </div>
        <p class="eyebrow dark">${c.z ? "The signature Z chocolates" : "The numbered collection"}</p>
        <h2>${title}</h2>
        ${zpick}
        <p class="desc">${esc(c.d)}</p>
        <p class="meta">${meta}</p>
        <div class="card-actions">
          <a class="btn btn-dark" href="${utm(SHOP, key)}" target="_blank" rel="noopener">Shop this flavour</a>
        </div>
        ${opts.scanned ? `<p class="wrong">Not the right chocolate? <button type="button" id="fixBtn">Choose the number instead</button></p>` : ""}
      </article>`;
    document.querySelectorAll(".zbtn").forEach(b => b.onclick = () => render("z" + b.dataset.z, { ...opts, keepScroll: true }));
    const fix = $("#fixBtn"); if (fix) fix.onclick = () => $("#grid").scrollIntoView({ behavior: "smooth", block: "center" });
    document.querySelectorAll(".key").forEach(k => k.setAttribute("aria-current", String(k.dataset.k === key || (k.dataset.k === "z" && !!c.z))));
    if (!opts.example && !opts.keepScroll) $("#result").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- Number tray ----------
  const grid = $("#grid");
  for (let i = 0; i <= 24; i++) grid.insertAdjacentHTML("beforeend", `<button class="key" type="button" data-k="${i}" aria-label="Chocolate number ${i}">${i}</button>`);
  grid.insertAdjacentHTML("beforeend", `<button class="key z" type="button" data-k="z" aria-label="Z chocolate"><em>z</em><span>Signature Z chocolates</span></button>`);
  grid.onclick = e => {
    const k = e.target.closest(".key"); if (!k) return;
    setStatus(""); $("#suggest").hidden = true;
    render(k.dataset.k === "z" ? "zdark" : k.dataset.k);
  };

  // ---------- Model ----------
  async function ensureModel() {
    if (Recognizer.ready) return true;
    setStatus(`<span class="dot"></span><span>Preparing the scanner…</span>`);
    try { await Recognizer.load(); setStatus(""); return true; }
    catch (e) { console.error(e); setStatus("The scanner could not start. Please choose your number below.", "err"); return false; }
  }

  // ---------- Live camera ----------
  const video = $("#video"), viewer = $("#viewer");
  let stream = null, timer = null, avg = null, frames = 0, lastSeen = 0;
  let canLive = !!(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;
  function noLiveCamera(msg) {
    canLive = false;
    $("#camLabel").textContent = "Take a photo";
    setStatus(msg);
  }
  if (!canLive) $("#camLabel").textContent = "Take a photo";

  async function startCamera() {
    if (!(await ensureModel())) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
    } catch (e) {
      noLiveCamera(e.name === "NotAllowedError"
        ? "Live scanning is not available here. Tap “Take a photo” to photograph your chocolate instead."
        : "The camera could not be opened. Tap “Take a photo” instead.");
      return;
    }
    video.srcObject = stream; await video.play();
    viewer.hidden = false; viewer.classList.remove("locked");
    $(".actions").hidden = true;
    $("#hint").textContent = "Point the camera at one chocolate";
    setStatus(""); $("#suggest").hidden = true;
    avg = null; frames = 0; lastSeen = 0;
    loop();
  }

  function stopCamera(label = "Scan another") {
    clearTimeout(timer); timer = null;
    stream?.getTracks().forEach(t => t.stop()); stream = null;
    viewer.hidden = true; $(".actions").hidden = false; $("#camLabel").textContent = label;
  }

  // Live scanning: every frame, find the chocolate and read it. Answer at once if one frame is clear;
  // otherwise keep a running average of recent frames so a wobble doesn't start everything again.
  const mark = $("#mark");
  function showMark(r, guess) {
    if (!r || !r.found) { mark.hidden = true; return; }
    const s = r.box.size * 1.25;
    Object.assign(mark.style, { left: (r.box.cx - s / 2) * 100 + "%", top: (r.box.cy - s / 2) * 100 + "%", width: s * 100 + "%", height: s * 100 + "%" });
    mark.hidden = false; mark.dataset.label = guess || "";
  }
  function loop() {
    if (!stream) return;
    const t0 = performance.now();
    if (video.readyState >= 2) {
      const r = Recognizer.scan(video);
      if (r.found) {
        lastSeen = t0; frames++;
        const p = Object.fromEntries(r.ranked.map(x => [x.key, x.p]));
        avg = avg ? Object.fromEntries(Object.keys(p).map(k => [k, avg[k] * MEMORY + p[k] * (1 - MEMORY)])) : p;
        const top = Object.entries(avg).sort((a, b) => b[1] - a[1])[0];
        // logic check: only answer if the chocolate, its shell colour and its digit count all agree
        const agrees = k => r.shell === META.shellOf[k] && r.mark === META.markOf[k];
        const instant = r.ranked[0].p >= INSTANT && agrees(r.ranked[0].key);
        const settled = frames >= 3 && top[1] >= SETTLED && agrees(top[0]);
        showMark(r, top[1] > 0.4 ? label(top[0]).split(" ")[0] : "");
        $("#hint").textContent = top[1] > 0.4 ? "Reading…" : "Got it, reading the number…";
        if (instant || settled) {
          const key = instant ? r.ranked[0].key : top[0];
          viewer.classList.add("locked");
          setTimeout(() => { stopCamera(); render(key, { scanned: true }); setStatus(`Found: ${esc(label(key))}`); }, 250);
          return;
        }
      } else {
        showMark(null);
        if (t0 - lastSeen > 1200) { avg = null; frames = 0; }   // forget only after a second with no chocolate in view
        $("#hint").textContent = "Point the camera at one chocolate";
      }
    }
    timer = setTimeout(loop, Math.max(0, 60 - (performance.now() - t0)));
  }

  // ---------- Single photo (works without live camera access) ----------
  async function fromPhoto(file) {
    if (!file || !(await ensureModel())) return;
    const url = URL.createObjectURL(file);
    setStatus(`<img class="thumb" src="${url}" alt=""><span class="dot"></span><span>Reading your chocolate…</span>`);
    const img = new Image();
    img.onload = () => setTimeout(() => {
      const res = Recognizer.scanPhoto(img);
      const best = res ? res.ranked.filter(b => C[b.key]) : [];
      if (!best.length) {
        setStatus(`<img class="thumb" src="${url}" alt=""><span>We couldn't find a chocolate in this photo. Try again from above, a little closer.</span>`, "err");
        return;
      }
      if (best[0].p >= PHOTO_SURE) {
        render(best[0].key, { scanned: true });
        setStatus(`<img class="thumb" src="${url}" alt=""><span>Found: ${esc(label(best[0].key))}</span>`);
        $("#suggest").hidden = true;
      } else {
        setStatus(`<img class="thumb" src="${url}" alt=""><span>We could not be certain which chocolate this is.</span>`, "err");
        const s = $("#suggest"); s.hidden = false;
        s.innerHTML = `<p>Is it one of these?</p><div class="chips">${best.slice(0, 3).map(b => `<button class="chip" type="button" data-k="${b.key}"><img src="${photo(b.key)}" alt="" onerror="this.onerror=null;this.src='images/${b.key}.jpg'">${esc(label(b.key))}</button>`).join("")}</div>`;
        s.querySelectorAll(".chip").forEach(ch => ch.onclick = () => { s.hidden = true; setStatus(""); render(ch.dataset.k, { scanned: true }); });
      }
    }, 30);
    img.src = url;
  }

  $("#camBtn").onclick = () => canLive ? startCamera() : $("#photoInput").click();
  $("#stopBtn").onclick = () => stopCamera("Scan a chocolate");
  $("#photoBtn").onclick = () => $("#photoInput").click();
  $("#photoInput").onchange = e => { const f = e.target.files[0]; e.target.value = ""; fromPhoto(f); };
  document.addEventListener("visibilitychange", () => { if (document.hidden && stream) stopCamera("Scan a chocolate"); });

  // Start loading the model straight away so the first scan is quick
  Recognizer.load().catch(() => {});
})();
