// zScanner: camera, result card, number tray.
(() => {
  const C = window.CHOCOLATES;
  const SITE = "https://www.zchocolat.com";
  const SHOP = SITE + "/collections/28-chocolate-assortments";
  // Official studio photos from the zchocolat.com tasting guide; our own photo is the fallback
  const photo = k => C[k]?.img || SITE + "/img/cms/flavors/" + (k.startsWith("z") ? "z-" + k.slice(1) : "n" + k.padStart(2, "0")) + ".jpg";
  // chocolates added from the admin page
  fetch("custom-chocolates.json", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(cu => { if (cu) for (const [k, v] of Object.entries(cu.chocolates || {})) C[k] = { ...v, custom: true }; }).catch(() => {});
  const COUV = {
    dark: { label: "70% dark couverture", sw: "var(--dark-c)" },
    milk: { label: "40% milk couverture", sw: "var(--milk-c)" },
    white: { label: "White couverture", sw: "var(--white-c)" }
  };
  // Recognition settings
  const HOLD_MS = 1000;     // hold the camera over the chocolate this long before it decides
  const MOVE_LIMIT = 0.22;  // if the chocolate moves more than this (share of the view), the hold restarts
  const DECIDE = 0.65;      // average score over the held second needed to answer
  const MARGIN = 0.30;      // ...and this far ahead of the second guess
  const MIN_SHARP = 45;     // close-ups less sharp than this are skipped (the number can't be read)
  const MIN_SIZE = 0.13;    // chocolate smaller than this share of the view: ask to move closer
  const MIN_LIGHT = 50;      // model 6: chocolate's brighter parts darker than this → too dark to read (tests 1-3: all such scans wrong)
  const MAX_GLARE = 0.03;    // model 6: more than 3% blown-out pixels on the chocolate → a reflection (never reached in tests 1-3)
  const TILT_HINT_DEG = 25; // phone's own gyroscope: degrees away from lying flat before we nudge "hold it flatter" — a first guess, to refine once real sessions show what's helpful
  const IDK_AFTER_MS = 2000; // after the hold, this long without an answer → say what would help (live on both pages: model6's meta.json sets candidate:true for each)
  const HARD_DEADLINE_MS = 5000; // never let a scan run longer than this from the first usable frame. 3-13 Nov: past it the current best guess was answered (N20/N23 had run 42-104 s with no answer before that); since 13 Nov: no answer, "not certain" and the likeliest three offered - see loop()
  const PHOTO_SURE = 0.55;  // single photos: show the top match above this, else offer choices

  const $ = s => document.querySelector(s);
  let META = { shellOf: {}, markOf: {} };
  fetch("model6/meta.json").then(r => r.json()).then(m => META = m).catch(() => {});
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const zm = k => k && k.startsWith("z") ? "z" : k;   // the three Z chocolates read as one for voting/tallying purposes
  // "highest confidence tier": both signals agree AND the combined score is itself this sure, not just one or the
  // other — used both for the or-99 escape hatch and for deciding whether to self-reinforce (live scan and photo)
  const sureThresh = () => META.sure ?? 0.99;
  const highestConfidence = (agree, p) => agree && p >= sureThresh();

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
  const label = k => C[k].z || C[k].custom ? (C[k].custom && C[k].no ? "N°" + C[k].no + " " : "") + C[k].name : "N°" + k + " " + C[k].name;

  // ---------- Result card ----------
  // The most recent automatic answer's chocoprint, kept so an explicit correction can move its reinforcement to the
  // right chocolate. Since 13 Nov a correction is "Choose the number instead" followed by a tray tap; a plain tray
  // tap is just browsing and leaves the gallery alone (before, any tap counted). reinforcedAs is which gallery mark
  // (if any) this vec was auto-reinforced into, so a correction can undo that specific reinforcement, not just add
  // a new one on top.
  let lastScan = null;   // {key, vec, reinforcedAs}
  let fixing = false;    // "Choose the number instead" was tapped: the next tray tap corrects lastScan (13 Nov; before, any tray tap did)
  function render(key, opts = {}) {
    const c = C[key]; if (!c) return;
    if (opts.scanned) lastScan = { key, vec: opts.vec || null, reinforcedAs: opts.reinforcedAs || null };
    const title = c.z || (c.custom && !c.no)
      ? esc(c.name)
      : c.custom ? `<span class="n"><span class="no">N°</span>${esc(c.no)}</span>${esc(c.name)}`
      : `<span class="n"><span class="no">N°</span>${esc(key)}</span>${esc(c.name)}`;
    const zpick = c.z ? `
      <div class="zpick">
        <p>${opts.scanned ? "Wrong colour? Choose the shell of yours:" : "Which colour is the shell of your Z chocolate?"}</p>
        <div class="zrow">${["dark", "milk", "white"].map(t => `<button class="zbtn" type="button" data-z="${t}" aria-pressed="${"z" + t === key}"><span class="sw" style="background:${COUV[t].sw}"></span>${t}</button>`).join("")}</div>
      </div>` : "";
    const meta = [COUV[c.cv]?.label || "", ...(c.tags || [])].filter(Boolean).map(esc).join(" · ");
    const anatomy = window.Choc3D?.anatomy(key);
    const anatomyHtml = anatomy ? `
        <dl class="anatomy">${anatomy.map(r => `<dt>${esc(r.label)}</dt><dd><i style="background:${r.color}"></i>${esc(r.text)}</dd>`).join("")}</dl>
        <button class="btn btn-outline-dark" type="button" id="cutBtn" aria-pressed="false">Cut it open</button>` : "";
    $("#result").innerHTML = `
      <article class="card">
        <div class="card-photo" id="chocStage">
          <img class="chocphoto" src="${photo(key)}" alt="${esc(c.name)}" onerror="this.onerror=null;this.src='images/${esc(key)}.jpg'">
          ${opts.example ? '<span class="badge">Example</span>' : ""}
        </div>
        <p class="eyebrow dark">${c.z ? "The signature Z chocolates" : c.custom ? "zChocolat" : "The numbered collection"}</p>
        <h2>${title}</h2>
        ${zpick}
        <p class="desc">${esc(c.d)}</p>
        <p class="meta">${meta}</p>
        ${anatomyHtml}
        <div class="card-actions">
          <a class="btn btn-dark" href="${utm(SHOP, key)}" target="_blank" rel="noopener">Shop this flavour</a>
        </div>
        ${opts.scanned ? `<p class="wrong">Not the right chocolate? <button type="button" id="fixBtn">Choose the number instead</button></p>` : ""}
      </article>`;
    // 3D is a display enhancement only, loaded after the card above is already showing the static photo - if it
    // can't load (no model for a custom chocolate, Three.js/WebGL unavailable) the photo just stays as it is.
    if (anatomy) {
      window.Choc3D.show($("#chocStage"), key).then(shown => { if (shown) $(".chocphoto").hidden = true; });
      $("#cutBtn").onclick = () => $("#cutBtn").setAttribute("aria-pressed", String(window.Choc3D.toggleCut()));
    }
    // the three Z chocolates share one gallery mark, so picking a different shell colour here wouldn't actually
    // change what's in the gallery (it would just remove and re-add the identical chocoprint) — nothing to reinforce
    document.querySelectorAll(".zbtn").forEach(b => b.onclick = () => render("z" + b.dataset.z, { ...opts, keepScroll: true }));
    const fix = $("#fixBtn"); if (fix) fix.onclick = () => { fixing = true; $("#grid").scrollIntoView({ behavior: "smooth", block: "center" }); };   // the next tray tap is a correction
    document.querySelectorAll(".key").forEach(k => k.setAttribute("aria-current", String(k.dataset.k === key || (k.dataset.k === "z" && !!c.z))));
    if (!opts.example && !opts.keepScroll) $("#result").scrollIntoView({ behavior: "smooth", block: "start" });
    // for hooks.js (welcome offer, tasting list, corporate counting); repeat = the same result redrawn (e.g. Z colour change)
    if (!opts.example) window.dispatchEvent(new CustomEvent("zfound", { detail: { key, scanned: !!opts.scanned, repeat: !!opts.keepScroll } }));
  }

  // ---------- Number tray ----------
  const grid = $("#grid");
  for (let i = 0; i <= 24; i++) grid.insertAdjacentHTML("beforeend", `<button class="key" type="button" data-k="${i}" aria-label="Chocolate number ${i}">${i}</button>`);
  grid.insertAdjacentHTML("beforeend", `<button class="key z" type="button" data-k="z" aria-label="Z chocolate"><em>z</em><span>Signature Z chocolates</span></button>`);
  grid.onclick = e => {
    const k = e.target.closest(".key"); if (!k) return;
    setStatus(""); $("#suggest").hidden = true;
    const key = k.dataset.k === "z" ? "zdark" : k.dataset.k;
    // 13 Nov: only a tap that follows "Choose the number instead" (#fixBtn) is a correction of the automatic answer.
    // Until now ANY tray tap after an answer counted as one, so a curious tap on another number quietly filed that
    // scan's chocoprint under the tapped number for the rest of the visit. A correction moves the reinforcement
    // rather than adding to it: undo whatever the automatic answer wrongly reinforced, then reinforce the chocolate
    // actually confirmed. A plain tray tap never touches the gallery.
    if (fixing && !DEBUG && lastScan && lastScan.vec && key !== lastScan.key) {
      if (lastScan.reinforcedAs) Recognizer.unreinforce(lastScan.reinforcedAs, lastScan.vec);
      Recognizer.reinforce(key, lastScan.vec);
    }
    fixing = false; lastScan = null;
    render(key);
  };

  // ---------- Model ----------
  async function ensureModel() {
    if (Recognizer.ready) return true;
    setStatus(`<span class="dot"></span><span>Preparing the scanner…</span>`);
    // show how far along it is, so the wait never looks frozen (first visit downloads ~7 MB)
    const prog = p => { if (!Recognizer.ready) setStatus(`<span class="dot"></span><span>Preparing the scanner… ${Math.round(p * 100)}%</span>`); };
    try { await Recognizer.load(prog); setStatus(""); return true; }
    catch (e) { console.error(e); setStatus("The scanner could not start. Please choose your number below.", "err"); return false; }
  }

  // ---------- Tilt sensor ----------
  // The chocolate lies flat on a table, so the phone's own gyroscope tells us how far off-overhead the camera is
  // being held — for free, with no guesswork from the picture itself (unlike the camera-tilt correction attempts
  // that were tried and dropped, see CLAUDE.md). beta/gamma both sit near 0° when the phone lies flat, screen up,
  // which is exactly how it is held to look straight down at a chocolate. Advisory only for now: it nudges the
  // on-screen hint, it never blocks a frame or an answer on its own.
  let tiltAngle = null, tiltGranted = false;
  // 13 Nov: the outcome of the permission request, for the admin test log and hint - "not-asked", "granted", "denied",
  // "no-api" (browser has no motion events), or the error name iOS rejected with. Until now the rejection was swallowed
  // silently, which is how no saved session (test-4 to test-11) ever got a single tilt value: see requestTiltPermission.
  let tiltPermission = "not-asked";
  function onTilt(e) { if (e.beta != null && e.gamma != null) tiltAngle = Math.hypot(e.beta, e.gamma); }
  // 4 Nov: was "ask once per page load, ever" - found via real test sessions that zero tilt data was ever
  // captured, because a single not-granted result (denied, dismissed, or some one-off glitch) permanently
  // disabled the sensor for the whole session with no way back. Now retried on every new scan attempt instead
  // of just once - safe to do even after a real, explicit "Don't Allow": iOS itself remembers that decision and
  // resolves future requestPermission() calls instantly without showing the native prompt again, so a genuine
  // denial never turns into repeated nagging. This only gives a second (or third, etc.) chance to the cases
  // that weren't a deliberate, permanent no - a transient failure, a missed prompt, a timing glitch.
  // WHERE this is called from decides whether it can ever work. iOS only shows the motion-permission prompt when
  // DeviceOrientationEvent.requestPermission() runs inside a user gesture (a tap handler); called anywhere else it
  // rejects with NotAllowedError ("requires a user gesture to prompt"). Version 1 (3 Nov 10:33) asked inside the
  // Scan tap and worked, but queued the motion prompt in front of the camera one; the fix for that delay moved the
  // call to after the camera stream starts - outside the gesture - so from then on every request was refused and the
  // refusal swallowed, and the 4 Nov "retry on every scan" retried from the same wrong place. The admin page now asks
  // inside the Scan tap again (see #camBtn); the client page is left as it was until a real session shows tilt is
  // worth a second system prompt for a gift recipient.
  function requestTiltPermission() {
    if (tiltGranted) return;   // already working this session - nothing to re-ask
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) { tiltPermission = "no-api"; return; }
    if (typeof DOE.requestPermission === "function") {
      DOE.requestPermission()
        .then(s => { tiltPermission = s; if (s === "granted") { tiltGranted = true; window.addEventListener("deviceorientation", onTilt); } })
        .catch(e => { tiltPermission = (e && e.name) || "error"; });
    } else {   // Android, desktop: no prompt, the sensor just reports (or doesn't exist, in which case no events arrive)
      tiltPermission = "granted"; tiltGranted = true;
      window.addEventListener("deviceorientation", onTilt);
    }
  }

  // ---------- Live camera ----------
  const video = $("#video"), viewer = $("#viewer");
  let stream = null, timer = null, lastSeen = 0;
  let videoTrack = null, torchOn = false;   // admin-only flash toggle, see setupTorchButton() below
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
      // advanced constraints are best-effort: a browser/device that doesn't support focusMode just ignores it,
      // never errors - safe to always ask, though iOS Safari's own support for this is known to be unreliable
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1920 }, advanced: [{ focusMode: "continuous" }] }, audio: false });
    } catch (e) {
      noLiveCamera(e.name === "NotAllowedError"
        ? "Live scanning is not available here. Tap “Take a photo” to photograph your chocolate instead."
        : "The camera could not be opened. Tap “Take a photo” instead.");
      return;
    }
    video.srcObject = stream; await video.play();
    videoTrack = stream.getVideoTracks()[0];
    setupTorchButton();
    viewer.hidden = false; viewer.classList.remove("locked");
    $(".actions").hidden = true;
    $("#hint").textContent = "Point the camera at one chocolate";
    setStatus(""); $("#suggest").hidden = true;
    held = []; holdStart = 0; lastSeen = 0; scanStart = performance.now(); lastInfo = null; firstSeen = 0; firstClearSeen = 0; trace = []; rejected = []; lastScan = null; fixing = false;
    loop();
    // client page only, unchanged: asked after the camera is streaming so no second prompt can delay the scan starting -
    // which on iOS also means it is outside the tap and never granted (see requestTiltPermission). The admin page asks
    // inside the tap instead (#camBtn), so it is not repeated here.
    if (!DEBUG) requestTiltPermission();
  }

  function stopCamera(label = "Scan another") {
    clearTimeout(timer); timer = null;
    if (torchOn) try { videoTrack?.applyConstraints({ advanced: [{ torch: false }] }); } catch (e) {}
    stream?.getTracks().forEach(t => t.stop()); stream = null; videoTrack = null; torchOn = false;
    $("#torchBtn").hidden = true;
    viewer.hidden = true; $(".actions").hidden = false; $("#camLabel").textContent = label;
  }

  // Admin-only test control: lets flash-vs-no-flash be compared directly, since a phone's Control Centre torch
  // gets switched off the moment this page's own camera session starts (iOS treats them as competing camera
  // sessions) - the only way to actually light the shot is via the stream's own track. Feature-detected per
  // device; stays hidden for real clients and whenever torch isn't supported.
  function setupTorchButton() {
    const btn = $("#torchBtn");
    torchOn = false; btn.textContent = "Flash: off"; btn.hidden = true;
    if (window.ZADMIN !== true) return;
    let supported = false;
    try { supported = !!videoTrack?.getCapabilities?.().torch; } catch (e) {}
    if (!supported) return;
    btn.hidden = false;
    btn.onclick = async () => {
      try { await videoTrack.applyConstraints({ advanced: [{ torch: !torchOn }] }); torchOn = !torchOn; btn.textContent = `Flash: ${torchOn ? "on" : "off"}`; }
      catch (e) { btn.textContent = "Flash: not supported"; }
    };
  }

  // Live scanning: the person holds the camera over one chocolate for HOLD_MS. A line fills up around the box
  // as a countdown; moving away restarts it. Then every frame from that second is averaged, and the answer is
  // given only if the winner's shell colour matches what most frames saw (the logic check).
  const mark = $("#mark");
  const DEBUG = window.ZADMIN === true;   // live numbers + test log only on the admin page
  let held = [], holdStart = 0;            // frames collected during the current hold
  let scanStart = 0, lastInfo = null;       // for the debug test log: the numbers behind the latest decision
  let firstSeen = 0, trace = [];             // admin only: every readable frame of this scan, so any rule can be replayed offline
  let firstClearSeen = 0;   // live on both pages: first frame that actually passed the quality gate (not just detected) - the deadline clock starts here, not at first detection, so an initial blurry/focus-hunting stretch doesn't eat into the budget
  let rejected = [];   // admin only: frames seen but skipped (too small/blurry/dark/glare), so the quality gates can be checked against real misses too
  const top3 = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([key, p]) => ({ key, p: Math.round(p * 1000) / 10 }));
  function frameShot() {   // what the camera saw (centre square), small, for the test log
    const c = document.createElement("canvas"); c.width = c.height = 320;
    const w = video.videoWidth, h = video.videoHeight, s = Math.min(w, h);
    c.getContext("2d").drawImage(video, (w - s) / 2, (h - s) / 2, s, s, 0, 0, 320, 320);
    return c.toDataURL("image/jpeg", 0.8);
  }
  function report(type, guess) {
    if (!DEBUG || !lastInfo) return;
    window.dispatchEvent(new CustomEvent("zscan", { detail: { type, guess, ...lastInfo, ms: Math.round(performance.now() - scanStart),
      seenMs: firstSeen ? Math.round(performance.now() - firstSeen) : null,
      clearMs: firstClearSeen ? Math.round(performance.now() - firstClearSeen) : null,   // time since the first frame good enough to actually use - compare with seenMs to see how much was lost to initial blur/focus-hunting
      tiltPermission, loadMs: Math.round(Recognizer.loadMs || 0),   // how long the scanner took to be ready this visit (download + warm-up), never saved anywhere before 13 Nov
      trace, rejected, crop: Recognizer.snapshot(), frame: frameShot() } }));
  }
  function showMark(r, progress) {
    if (!r || !r.found) { mark.hidden = true; return; }
    const s = r.box.size * 1.25;
    Object.assign(mark.style, { left: (r.box.cx - s / 2) * 100 + "%", top: (r.box.cy - s / 2) * 100 + "%", width: s * 100 + "%", height: s * 100 + "%" });
    mark.style.setProperty("--progress", Math.min(1, progress));
    mark.hidden = false; mark.dataset.label = "";
  }
  function answer(key, vec, reinforcedAs) {
    report("answer", key);
    viewer.classList.add("locked");
    setTimeout(() => { stopCamera(); render(key, { scanned: true, vec, reinforcedAs }); setStatus(`Found: ${esc(label(key))}`); }, 250);
  }
  function resetHold(t) { held = []; holdStart = t; firstClearSeen = 0; }

  function loop() {
    if (!stream) return;
    const t0 = performance.now();
    if (video.readyState >= 2) {
      const r = Recognizer.scan(video, undefined, { track: true });   // reuse work between frames while holding (admin model)
      const tooSmall = r.found && r.box.size < MIN_SIZE, blurry = r.found && r.sharp < MIN_SHARP;
      // model 6: too dark or a strong reflection → don't read this frame, say what to do (live on both pages)
      const tooDark = !!META.candidate && r.found && r.light && r.light.p90 < MIN_LIGHT;
      const glare = !!META.candidate && r.found && r.light && r.light.glare > MAX_GLARE;
      if (r.found && (tooSmall || blurry || tooDark || glare)) {
        // seen, but not readable: don't count this frame, and say what to do
        lastSeen = t0; showMark(r, 0);
        const reason = tooSmall ? "tooSmall" : tooDark ? "tooDark" : glare ? "glare" : "blurry";
        $("#hint").textContent = tooSmall ? "Move a little closer" : tooDark ? "Too dark, find more light" : glare ? "Move slightly to avoid the reflection" : "Too blurry, hold steady";
        if (DEBUG) {
          $("#hint").textContent += ` | sharp ${Math.round(r.sharp)} size ${Math.round(r.box.size * 100)}% obj ${r.obj.toFixed(2)}`;
          if (rejected.length < 400) rejected.push({ t: Math.round(t0 - scanStart), reason, sharp: Math.round(r.sharp), size: +r.box.size.toFixed(3),
            light: r.light ? Math.round(r.light.p90) : null, glare: r.light ? +r.light.glare.toFixed(3) : null, tilt: tiltAngle != null ? Math.round(tiltAngle) : null, obj: +r.obj.toFixed(3),
            looks: r.looks ?? null, size1: r.size1 != null ? +r.size1.toFixed(3) : null });   // look-again: extra finder passes, and the box size before them
        }
      } else if (r.found) {
        lastSeen = t0;
        // restart the countdown if the chocolate jumped (camera still being moved into place)
        if (held.length) {
          const mx = held.reduce((s, f) => s + f.cx, 0) / held.length, my = held.reduce((s, f) => s + f.cy, 0) / held.length;
          if (Math.hypot(r.box.cx - mx, r.box.cy - my) > MOVE_LIMIT) resetHold(t0);
        } else holdStart = t0;
        held.push({ t: t0, cx: r.box.cx, cy: r.box.cy, size: r.box.size, sharp: r.sharp, qsure: r.qsure ?? 1, psim: r.print?.sim ?? 1,
          p: Object.fromEntries(r.ranked.map(x => [x.key, x.p])), shell: r.shell, mark: r.mark, m4top: r.m4top, pmark: r.print?.mark, tilt: tiltAngle != null ? Math.round(tiltAngle) : null });
        if (!firstClearSeen) firstClearSeen = t0;   // live on both pages - this frame already cleared the quality gate above, so the deadline clock starts counting from here
        if (DEBUG) {
          if (!firstSeen) firstSeen = t0;
          if (trace.length < 400) trace.push({ t: Math.round(t0 - firstSeen), cx: +r.box.cx.toFixed(3), cy: +r.box.cy.toFixed(3), size: +r.box.size.toFixed(3),
            sharp: Math.round(r.sharp), light: r.light ? Math.round(r.light.p90) : null, glare: r.light ? +r.light.glare.toFixed(3) : null, obj: +r.obj.toFixed(3), rot: r.rot != null ? Math.round(r.rot) : null, qsure: r.qsure != null ? +r.qsure.toFixed(2) : null, shell: r.shell, mark: r.mark, m4top: r.m4top, pmark: r.print?.mark, psim: r.print ? +r.print.sim.toFixed(3) : null, tilt: tiltAngle != null ? Math.round(tiltAngle) : null,
            looks: r.looks ?? null, size1: r.size1 != null ? +r.size1.toFixed(3) : null, top: r.ranked.slice(0, 6).map(x => [x.key, +x.p.toFixed(4)]),   // looks/size1: the look-again's extra finder passes and the box size before them
            qraw: r.qraw != null ? +r.qraw.toFixed(2) : null,   // 13 Nov: the which-way-up model's own confidence on the frames it actually ran on (null = rotation reused); qsure is the resolved value
            vec: r.print?.vec ? r.print.vec.map(v => +v.toFixed(3)) : null });   // 13 Nov: this frame's chocoprint, so a replay can rescore the live rule against a changed gallery (e.g. reinforcement on vs off)
        }
        const holdMs = META.holdMs ?? HOLD_MS;   // model 6: 0.4 s (replay: 3 frames already gave 0 wrong)
        held = held.filter((f, i) => t0 - f.t <= holdMs * 1.5 || i >= held.length - 3);   // sliding window (always at least the last 3 frames)
        const progress = (t0 - holdStart) / holdMs;
        showMark(r, progress);
        const tiltedNow = tiltAngle != null && tiltAngle > TILT_HINT_DEG;
        $("#hint").textContent = progress < 1 ? (tiltedNow ? "Hold the phone flatter, straight above the number" : "Hold still over the chocolate") : "Reading the number…";
        // average every frame in the window. Keys come from every frame, not just the first: a custom (admin-added)
        // chocolate's print match can come and go frame to frame, so held[0] alone might not have every key that
        // appears later in the window — missing values default to 0 rather than producing NaN.
        const keys = new Set(); held.forEach(f => Object.keys(f.p).forEach(k => keys.add(k)));
        const avg = {};
        keys.forEach(k => avg[k] = held.reduce((s, f) => s + (f.p[k] || 0), 0) / held.length);
        const sorted = Object.entries(avg).sort((a, b) => b[1] - a[1]);
        const [topKey, topP] = sorted[0], secondP = sorted[1] ? sorted[1][1] : 0;
        const count = v => held.filter(f => f.shell === v).length;
        const shellVote = ["dark", "milk", "white", "milkwhite"].sort((a, b) => count(b) - count(a))[0];
        const mcount = v => held.filter(f => f.mark === v).length;
        lastInfo = { avgTop3: top3(avg), nowTop3: r.ranked.slice(0, 3).map(x => ({ key: x.key, p: Math.round(x.p * 1000) / 10 })), shell: shellVote,
          mark: ["one", "two", "z"].sort((a, b) => mcount(b) - mcount(a))[0], frames: held.length, holdMs: Math.round(t0 - holdStart) };
        // "I don't know": held for a while but still not sure, so say what would help instead of guessing
        const stuck = !!META.candidate && progress >= 1 + IDK_AFTER_MS / holdMs, mean = f => held.reduce((s, h) => s + f(h), 0) / held.length;
        const idk = !stuck ? "" : mean(h => h.size) < 0.2 ? "Hold a little closer"
          : mean(h => h.tilt ?? 0) > TILT_HINT_DEG ? "Hold the phone flatter, straight above the number"
          : mean(h => h.qsure) < 0.8 ? "Hold the phone straight above the number"
          : mean(h => h.sharp) < 80 ? "Hold steady for a moment" : "Hold a little closer, straight above the number";
        if (idk) $("#hint").textContent = idk;
        if (DEBUG) $("#hint").textContent = (idk ? idk + " | " : "") + `${Math.round(progress * 100)}% | now ${r.ranked.slice(0, 2).map(x => x.key + " " + Math.round(x.p * 100)).join(" · ")} | avg ${topKey} ${Math.round(topP * 100)} | ${shellVote} ${r.mark} | ${held.length}f | sharp ${Math.round(r.sharp)} | tilt ${tiltAngle != null ? Math.round(tiltAngle) + "°" : "– (" + tiltPermission + ")"}`;
        const markVote = lastInfo.mark;
        // rule "agree" (model 5): the classifier and the chocoprints, each voting over the held second, must name the same chocolate
        const vote = f => { const c = {}; held.forEach(h => { const k = f(h); if (k) c[k] = (c[k] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0]; };
        // once rule E (printOk) requires the chocoprint to name topKey in >=printShare of the window, its vote here
        // is already guaranteed true whenever printOk passes — this clause only still matters when printShare is
        // unset for some candidate model, so it's kept rather than assumed redundant
        const bothAgree = zm(vote(h => h.m4top)) === zm(topKey) && vote(h => h.pmark) === zm(topKey);
        // rule "agree-or-99" (model 6, Lorcan's choice D+): both agree, or the combined score is at least 99% sure
        const agreed = !META.rule ? true : META.rule === "agree" ? bothAgree : bothAgree || topP >= sureThresh();
        if (DEBUG && META.rule) $("#hint").textContent += ` | agree ${agreed ? "yes" : "no"} (${vote(h => h.m4top)} / ${vote(h => h.pmark)})`;
        // rule E (model 6, after test 4): the chocoprint must name this chocolate in at least META.printShare of the held frames
        // (stops lookalikes like 20/21 flipping through), and the logic check uses the shell colour only (META.logic "shell"):
        // the reader's digit-count vote kept a correctly read Z dark waiting 21 s in test 4.
        const printShare = held.filter(h => h.pmark === zm(topKey)).length / held.length;
        const printOk = !META.printShare || printShare >= META.printShare;
        // N°20's milk+white shell barely shows from above, so the reader's shell vote for it is unreliable (it flips
        // between "dark" and "milk" depending on the moment) — don't let that veto an otherwise clear answer for it.
        const logicOk = C[topKey]?.custom ? true
          : META.shellOf[topKey] === "milkwhite" ? (META.logic === "shell" || META.markOf[topKey] === markVote)
          : META.shellOf[topKey] === shellVote && (META.logic === "shell" || META.markOf[topKey] === markVote);
        if (DEBUG && META.printShare) $("#hint").textContent += ` | print ${Math.round(printShare * 100)}%`;
        const decided = agreed && printOk && logicOk && progress >= 1 && held.length >= 3 && topP >= (META.decide ?? DECIDE) && topP - secondP >= (META.margin ?? MARGIN);
        // Past HARD_DEADLINE_MS since the first frame that actually cleared the quality gate (not first detection -
        // an initial blurry/focus-hunting stretch doesn't eat into this budget): stop WITHOUT answering. From 3 to
        // 13 Nov this answered with whatever was the top guess instead, skipping every check above; replaying the
        // saved traces (training/trace_replay.py, "E + 5s forced guess") shows that made 4 more test-6 scans wrong
        // (8 -> 12) and 11 -> 15 pooled over test-4/5/6/7. Now the camera stops and the likeliest three are offered
        // as chips - the same "Is it one of these?" block the photo path uses - so there is never an automatic
        // answer without rule E passing. Live on both pages (firstClearSeen is tracked unconditionally).
        const pastDeadline = !!firstClearSeen && (t0 - firstClearSeen) >= HARD_DEADLINE_MS && held.length >= 3;
        if (DEBUG && firstClearSeen) $("#hint").textContent += ` | ${Math.max(0, Math.round((HARD_DEADLINE_MS - (t0 - firstClearSeen)) / 100) / 10)}s to deadline`;
        if (decided) {
          // like Face ID folding a good unlock back into its template: at the highest confidence tier, add this
          // chocoprint to the gallery for the rest of this visit, so a second pass over the same box gets easier.
          // Not during admin test sessions (DEBUG) — later test scans must stand on their own, not benefit from
          // earlier ones. If this answer turns out wrong and gets corrected, the correction (grid.onclick) undoes
          // this specific reinforcement rather than just piling another one on top.
          const autoReinforced = !DEBUG && highestConfidence(bothAgree, topP) && !!r.print?.vec;
          if (autoReinforced) Recognizer.reinforce(topKey, r.print.vec);
          lastInfo.forced = false;
          answer(topKey, r.print?.vec, autoReinforced ? topKey : null); return;
        } else if (pastDeadline) {
          lastInfo.forced = false;
          unsure(sorted.slice(0, 3).map(([k]) => k), r.print?.vec); return;
        }
      } else {
        showMark(null);
        if (t0 - lastSeen > 400) resetHold(t0);              // chocolate left the view: start again
        $("#hint").textContent = "Hold the camera above one chocolate, number visible";
        if (DEBUG) $("#hint").textContent += ` | obj ${r.obj.toFixed(2)} (need ≥0.50 to count as found - point at different things to see this move)`;
      }
    }
    timer = setTimeout(loop, Math.max(0, 60 - (performance.now() - t0)));
  }

  // ---------- Single photo (works without live camera access) ----------
  async function fromPhoto(file) {
    if (!file || !(await ensureModel())) return;
    lastScan = null; fixing = false;   // a fresh photo attempt shouldn't let an unrelated earlier scan's correction window stay open
    const url = URL.createObjectURL(file);
    setStatus(`<img class="thumb" src="${url}" alt=""><span class="dot"></span><span>Reading your chocolate…</span>`);
    const img = new Image();
    img.onerror = () => setStatus(`<img class="thumb" src="${url}" alt=""><span>This photo could not be opened. Please try another.</span>`, "err");
    img.onload = () => setTimeout(() => {
      const res = Recognizer.scanPhoto(img);
      const best = res ? res.ranked.filter(b => C[b.key]) : [];
      if (!best.length) {
        setStatus(`<img class="thumb" src="${url}" alt=""><span>We couldn't find a chocolate in this photo. Try again from above, a little closer.</span>`, "err");
        return;
      }
      if (META.candidate && res.light && res.light.p90 < MIN_LIGHT) {
        setStatus(`<img class="thumb" src="${url}" alt=""><span>This photo is too dark to read the number. Please try again with more light.</span>`, "err");
        return;
      }
      // model 6: the same rule as live scanning (both opinions agree, or 99% sure); otherwise offer the likeliest choices
      const bothAgreePhoto = zm(res.m4top) === zm(best[0].key) && res.print?.mark === zm(best[0].key);
      const photoSure = META.rule === "agree-or-99" ? bothAgreePhoto || best[0].p >= sureThresh() : best[0].p >= PHOTO_SURE;
      if (photoSure) {
        // same highest-confidence reinforcement as live scanning, for the same reason
        const autoReinforced = !DEBUG && highestConfidence(bothAgreePhoto, best[0].p) && !!res.print?.vec;
        if (autoReinforced) Recognizer.reinforce(best[0].key, res.print.vec);
        render(best[0].key, { scanned: true, vec: res.print?.vec, reinforcedAs: autoReinforced ? best[0].key : null });
        setStatus(`<img class="thumb" src="${url}" alt=""><span>Found: ${esc(label(best[0].key))}</span>`);
        $("#suggest").hidden = true;
      } else {
        setStatus(`<img class="thumb" src="${url}" alt=""><span>We could not be certain which chocolate this is.</span>`, "err");
        offerChoices(best.slice(0, 3).map(b => b.key), res.print?.vec);
      }
    }, 30);
    img.src = url;
  }

  // "Is it one of these?": the likeliest few as chips, shared by the photo path and the live scan's deadline.
  // Like Face ID learning from a failed match once you enter your passcode: the model wasn't sure, but tapping one
  // of these chips is an explicit, certain answer — a stronger signal than any confidence score — so that scan's
  // chocoprint joins the gallery for it (not during admin test sessions), even though the automatic read wasn't sure.
  function offerChoices(keys, vec) {
    const s = $("#suggest"); s.hidden = false;
    s.innerHTML = `<p>Is it one of these?</p><div class="chips">${keys.map(k => `<button class="chip" type="button" data-k="${k}"><img src="${photo(k)}" alt="" onerror="this.onerror=null;this.src='images/${k}.jpg'">${esc(label(k))}</button>`).join("")}</div>`;
    s.querySelectorAll(".chip").forEach(ch => ch.onclick = () => {
      s.hidden = true; setStatus("");
      const reinforced = !DEBUG && !!vec;
      if (reinforced) Recognizer.reinforce(ch.dataset.k, vec);
      render(ch.dataset.k, { scanned: true, vec, reinforcedAs: reinforced ? ch.dataset.k : null });
    });
  }
  // Live scan not certain by the deadline (13 Nov): no guess. Logged for the admin test log as type "unsure" with
  // its trace, camera off, and the likeliest three offered - the number tray is there as well, as always.
  function unsure(keys, vec) {
    report("unsure", null);
    stopCamera();
    setStatus("We could not be certain which chocolate this is.", "err");
    offerChoices(keys, vec);
  }

  // Admin page (13 Nov): ask for the tilt sensor synchronously INSIDE the tap - the only place iOS grants it. Two
  // system prompts on the first scan is acceptable for staff; clients keep the single camera prompt for now.
  $("#camBtn").onclick = () => { if (canLive && DEBUG) requestTiltPermission(); canLive ? startCamera() : $("#photoInput").click(); };
  $("#stopBtn").onclick = () => { report("noanswer", null); stopCamera("Scan a chocolate"); };
  $("#photoBtn").onclick = () => $("#photoInput").click();
  $("#photoInput").onchange = e => { const f = e.target.files[0]; e.target.value = ""; fromPhoto(f); };
  document.addEventListener("visibilitychange", () => { if (document.hidden && stream) stopCamera("Scan a chocolate"); });

  // Start loading the model straight away so the first scan is quick
  Recognizer.load().catch(() => {});
})();

// Speed: start loading the scanner as soon as the page has opened, so it's ready by the time Scan is pressed
if (window.Recognizer) window.addEventListener("load", () => setTimeout(() => window.Recognizer && Recognizer.load().catch(() => {}), 400));
