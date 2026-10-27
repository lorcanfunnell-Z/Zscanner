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
  const IDK_AFTER_MS = 2000; // candidate model (admin): after the hold, this long without an answer → say what would help
  const PHOTO_SURE = 0.55;  // single photos: show the top match above this, else offer choices

  const $ = s => document.querySelector(s);
  let META = { shellOf: {}, markOf: {} };
  fetch("model6/meta.json").then(r => r.json()).then(m => META = m).catch(() => {});
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
  const label = k => C[k].z || C[k].custom ? (C[k].custom && C[k].no ? "N°" + C[k].no + " " : "") + C[k].name : "N°" + k + " " + C[k].name;

  // ---------- Result card ----------
  function render(key, opts = {}) {
    const c = C[key]; if (!c) return;
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
    $("#result").innerHTML = `
      <article class="card">
        <div class="card-photo">
          <img src="${photo(key)}" alt="${esc(c.name)}" onerror="this.onerror=null;this.src='images/${esc(key)}.jpg'">
          ${opts.example ? '<span class="badge">Example</span>' : ""}
        </div>
        <p class="eyebrow dark">${c.z ? "The signature Z chocolates" : c.custom ? "zChocolat" : "The numbered collection"}</p>
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
    render(k.dataset.k === "z" ? "zdark" : k.dataset.k);
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

  // ---------- Live camera ----------
  const video = $("#video"), viewer = $("#viewer");
  let stream = null, timer = null, lastSeen = 0;
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
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1920 } }, audio: false });
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
    held = []; holdStart = 0; lastSeen = 0; scanStart = performance.now(); lastInfo = null; firstSeen = 0; trace = []; rejected = []; scanTops = {};
    loop();
  }

  function stopCamera(label = "Scan another") {
    clearTimeout(timer); timer = null;
    stream?.getTracks().forEach(t => t.stop()); stream = null;
    viewer.hidden = true; $(".actions").hidden = false; $("#camLabel").textContent = label;
  }

  // Live scanning: the person holds the camera over one chocolate for HOLD_MS. A line fills up around the box
  // as a countdown; moving away restarts it. Then every frame from that second is averaged, and the answer is
  // given only if the winner's shell colour matches what most frames saw (the logic check).
  const mark = $("#mark");
  const DEBUG = window.ZADMIN === true;   // live numbers + test log only on the admin page
  let held = [], holdStart = 0;            // frames collected during the current hold
  let scanStart = 0, lastInfo = null;       // for the debug test log: the numbers behind the latest decision
  let scanTops = {};                          // rule A: how often each chocolate topped a frame since this scan began
  let firstSeen = 0, trace = [];             // admin only: every readable frame of this scan, so any rule can be replayed offline
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
      seenMs: firstSeen ? Math.round(performance.now() - firstSeen) : null, trace, rejected, crop: Recognizer.snapshot(), frame: frameShot() } }));
  }
  function showMark(r, progress) {
    if (!r || !r.found) { mark.hidden = true; return; }
    const s = r.box.size * 1.25;
    Object.assign(mark.style, { left: (r.box.cx - s / 2) * 100 + "%", top: (r.box.cy - s / 2) * 100 + "%", width: s * 100 + "%", height: s * 100 + "%" });
    mark.style.setProperty("--progress", Math.min(1, progress));
    mark.hidden = false; mark.dataset.label = "";
  }
  function answer(key) {
    report("answer", key);
    viewer.classList.add("locked");
    setTimeout(() => { stopCamera(); render(key, { scanned: true }); setStatus(`Found: ${esc(label(key))}`); }, 250);
  }
  function resetHold(t) { held = []; holdStart = t; }

  function loop() {
    if (!stream) return;
    const t0 = performance.now();
    if (video.readyState >= 2) {
      const r = Recognizer.scan(video, undefined, { track: true });   // reuse work between frames while holding (admin model)
      const tooSmall = r.found && r.box.size < MIN_SIZE, blurry = r.found && r.sharp < MIN_SHARP;
      // model 6 (admin): too dark or a strong reflection → don't read this frame, say what to do
      const tooDark = !!META.candidate && r.found && r.light && r.light.p90 < MIN_LIGHT;
      const glare = !!META.candidate && r.found && r.light && r.light.glare > MAX_GLARE;
      if (r.found && (tooSmall || blurry || tooDark || glare)) {
        // seen, but not readable: don't count this frame, and say what to do
        lastSeen = t0; showMark(r, 0);
        const reason = tooSmall ? "tooSmall" : tooDark ? "tooDark" : glare ? "glare" : "blurry";
        $("#hint").textContent = tooSmall ? "Move a little closer" : tooDark ? "Too dark, find more light" : glare ? "Tilt slightly to avoid the reflection" : "Too blurry, hold steady";
        if (DEBUG) {
          $("#hint").textContent += ` | sharp ${Math.round(r.sharp)} size ${Math.round(r.box.size * 100)}%`;
          if (rejected.length < 400) rejected.push({ t: Math.round(t0 - scanStart), reason, sharp: Math.round(r.sharp), size: +r.box.size.toFixed(3),
            light: r.light ? Math.round(r.light.p90) : null, glare: r.light ? +r.light.glare.toFixed(3) : null });
        }
      } else if (r.found) {
        lastSeen = t0;
        // restart the countdown if the chocolate jumped (camera still being moved into place)
        if (held.length) {
          const mx = held.reduce((s, f) => s + f.cx, 0) / held.length, my = held.reduce((s, f) => s + f.cy, 0) / held.length;
          if (Math.hypot(r.box.cx - mx, r.box.cy - my) > MOVE_LIMIT) resetHold(t0);
        } else holdStart = t0;
        held.push({ t: t0, cx: r.box.cx, cy: r.box.cy, size: r.box.size, sharp: r.sharp, qsure: r.qsure ?? 1, psim: r.print?.sim ?? 1,
          p: Object.fromEntries(r.ranked.map(x => [x.key, x.p])), shell: r.shell, mark: r.mark, m4top: r.m4top, pmark: r.print?.mark });
        if (r.ranked[0]) scanTops[r.ranked[0].key] = (scanTops[r.ranked[0].key] || 0) + 1;
        if (DEBUG) {
          if (!firstSeen) firstSeen = t0;
          if (trace.length < 400) trace.push({ t: Math.round(t0 - firstSeen), cx: +r.box.cx.toFixed(3), cy: +r.box.cy.toFixed(3), size: +r.box.size.toFixed(3),
            sharp: Math.round(r.sharp), light: r.light ? Math.round(r.light.p90) : null, glare: r.light ? +r.light.glare.toFixed(3) : null, rot: r.rot != null ? Math.round(r.rot) : null, qsure: r.qsure != null ? +r.qsure.toFixed(2) : null, shell: r.shell, mark: r.mark, m4top: r.m4top, pmark: r.print?.mark, psim: r.print ? +r.print.sim.toFixed(3) : null, top: r.ranked.slice(0, 6).map(x => [x.key, +x.p.toFixed(4)]) });
        }
        const holdMs = META.holdMs ?? HOLD_MS;   // model 6: 0.4 s (replay: 3 frames already gave 0 wrong)
        held = held.filter((f, i) => t0 - f.t <= holdMs * 1.5 || i >= held.length - 3);   // sliding window (always at least the last 3 frames)
        const progress = (t0 - holdStart) / holdMs;
        showMark(r, progress);
        $("#hint").textContent = progress < 1 ? "Hold still over the chocolate" : "Reading the number…";
        // average every frame in the window
        const keys = Object.keys(held[0].p), avg = {};
        keys.forEach(k => avg[k] = held.reduce((s, f) => s + f.p[k], 0) / held.length);
        const sorted = Object.entries(avg).sort((a, b) => b[1] - a[1]);
        const [topKey, topP] = sorted[0], secondP = sorted[1] ? sorted[1][1] : 0;
        const count = v => held.filter(f => f.shell === v).length;
        const shellVote = ["dark", "milk", "white", "milkwhite"].sort((a, b) => count(b) - count(a))[0];
        const mcount = v => held.filter(f => f.mark === v).length;
        lastInfo = { avgTop3: top3(avg), nowTop3: r.ranked.slice(0, 3).map(x => ({ key: x.key, p: Math.round(x.p * 1000) / 10 })), shell: shellVote,
          mark: ["one", "two", "z"].sort((a, b) => mcount(b) - mcount(a))[0], frames: held.length, holdMs: Math.round(t0 - holdStart) };
        // "I don't know": held for a while but still not sure, so say what would help instead of guessing
        const stuck = !!META.candidate && progress >= 1 + IDK_AFTER_MS / holdMs, mean = f => held.reduce((s, h) => s + f(h), 0) / held.length;
        const idk = !stuck ? "" : mean(h => h.size) < 0.2 ? "Hold a little closer" : mean(h => h.qsure) < 0.8 ? "Hold the phone straight above the number"
          : mean(h => h.sharp) < 80 ? "Hold steady for a moment" : "Hold a little closer, straight above the number";
        if (idk) $("#hint").textContent = idk;
        if (DEBUG) $("#hint").textContent = (idk ? idk + " | " : "") + `${Math.round(progress * 100)}% | now ${r.ranked.slice(0, 2).map(x => x.key + " " + Math.round(x.p * 100)).join(" · ")} | avg ${topKey} ${Math.round(topP * 100)} | ${shellVote} ${r.mark} | ${held.length}f | sharp ${Math.round(r.sharp)}`;
        const markVote = lastInfo.mark;
        // rule "agree" (model 5): the classifier and the chocoprints, each voting over the held second, must name the same chocolate
        const vote = f => { const c = {}; held.forEach(h => { const k = f(h); if (k) c[k] = (c[k] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0]; };
        const zm = k => k && k.startsWith("z") ? "z" : k;
        const bothAgree = zm(vote(h => h.m4top)) === zm(topKey) && vote(h => h.pmark) === zm(topKey);
        // rule "agree-or-99" (model 6, Lorcan's choice D+): both agree, or the combined score is at least 99% sure
        const agreed = !META.rule ? true : META.rule === "agree" ? bothAgree : bothAgree || topP >= (META.sure ?? 0.99);
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
        // rule A (model 6, after test 5): don't answer against what most of the whole scan said. The answer must be the
        // chocolate that topped the most frames since this scan began, not just the last 0.6 s (stops a late misreading,
        // e.g. test 5's N°20 read as 24 once the which-side-up step turned it sideways).
        const scanTop = Object.entries(scanTops).sort((a, b) => b[1] - a[1])[0]?.[0];
        const scanOk = !META.scanMajority || scanTop === topKey;
        if (DEBUG && META.scanMajority) $("#hint").textContent += ` | scan ${scanTop}`;
        if (agreed && printOk && scanOk && logicOk && progress >= 1 && held.length >= 3 && topP >= (META.decide ?? DECIDE) && topP - secondP >= (META.margin ?? MARGIN)) {
          // like Face ID folding a good unlock back into its template: at the highest confidence tier (both signals
          // agree AND the combined score is itself 99% sure, not just one or the other), add this chocoprint to the
          // gallery for the rest of this visit, so a second pass over the same box gets easier. Not during admin
          // test sessions (DEBUG) — later test scans must stand on their own, not benefit from earlier ones.
          if (!DEBUG && bothAgree && topP >= (META.sure ?? 0.99) && r.print?.vec) Recognizer.reinforce(topKey, r.print.vec);
          answer(topKey); return;
        }
      } else {
        showMark(null);
        if (t0 - lastSeen > 400) resetHold(t0);              // chocolate left the view: start again
        $("#hint").textContent = "Hold the camera above one chocolate, number visible";
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
      if (META.candidate && res.light && res.light.p90 < MIN_LIGHT) {
        setStatus(`<img class="thumb" src="${url}" alt=""><span>This photo is too dark to read the number. Please try again with more light.</span>`, "err");
        return;
      }
      // model 6: the same rule as live scanning (both opinions agree, or 99% sure); otherwise offer the likeliest choices
      const zk = k => k && k.startsWith("z") ? "z" : k;
      const photoSure = META.rule === "agree-or-99"
        ? (zk(res.m4top) === zk(best[0].key) && res.print?.mark === zk(best[0].key)) || best[0].p >= (META.sure ?? 0.99)
        : best[0].p >= PHOTO_SURE;
      if (photoSure) {
        render(best[0].key, { scanned: true });
        setStatus(`<img class="thumb" src="${url}" alt=""><span>Found: ${esc(label(best[0].key))}</span>`);
        $("#suggest").hidden = true;
      } else {
        setStatus(`<img class="thumb" src="${url}" alt=""><span>We could not be certain which chocolate this is.</span>`, "err");
        const s = $("#suggest"); s.hidden = false;
        s.innerHTML = `<p>Is it one of these?</p><div class="chips">${best.slice(0, 3).map(b => `<button class="chip" type="button" data-k="${b.key}"><img src="${photo(b.key)}" alt="" onerror="this.onerror=null;this.src='images/${b.key}.jpg'">${esc(label(b.key))}</button>`).join("")}</div>`;
        // like Face ID learning from a failed match once you enter your passcode: the model wasn't sure, but tapping
        // one of these chips is an explicit, certain answer — a stronger signal than any confidence score — so this
        // photo's chocoprint joins the gallery for it, even though the automatic read wasn't sure (or picked wrong)
        s.querySelectorAll(".chip").forEach(ch => ch.onclick = () => {
          s.hidden = true; setStatus("");
          if (!DEBUG && res.print?.vec) Recognizer.reinforce(ch.dataset.k, res.print.vec);
          render(ch.dataset.k, { scanned: true });
        });
      }
    }, 30);
    img.src = url;
  }

  $("#camBtn").onclick = () => canLive ? startCamera() : $("#photoInput").click();
  $("#stopBtn").onclick = () => { report("noanswer", null); stopCamera("Scan a chocolate"); };
  $("#photoBtn").onclick = () => $("#photoInput").click();
  $("#photoInput").onchange = e => { const f = e.target.files[0]; e.target.value = ""; fromPhoto(f); };
  document.addEventListener("visibilitychange", () => { if (document.hidden && stream) stopCamera("Scan a chocolate"); });

  // Start loading the model straight away so the first scan is quick
  Recognizer.load().catch(() => {});
})();

// Speed: start loading the scanner as soon as the page has opened, so it's ready by the time Scan is pressed
if (window.Recognizer) window.addEventListener("load", () => setTimeout(() => window.Recognizer && Recognizer.load().catch(() => {}), 400));
