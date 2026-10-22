// zScanner hooks (ideas 1, 2 and 4). Shown after a successful scan, in the site's style, never as a pop-up.
// Off for recipients until switched on in hooks-config.js; the admin page always shows a preview.
//   1. Welcome offer: an invitation under the result card linking to sign-up (zs=1 tells zchocolat.com to tag the account).
//   2. My tasting: hearts on result cards, a tasting list kept on this phone, and "Email me my favourites".
//   4. Corporate: the QR card's ?o= code, anonymous scan counting and a "Say thank you" button.
// Requests to the module are sent as text (JSON inside), which browsers send without a pre-check, so the module
// only has to allow zScanner's address; it should read the raw body as JSON.
(() => {
  const H = window.ZHOOKS || { enabled: {}, welcome: {}, endpoints: {} };
  const ADMIN = window.ZADMIN === true;
  const on = k => ADMIN || !!H.enabled?.[k];
  if (!on("welcome") && !on("tasting") && !on("corporate")) return;   // client page today: nothing at all
  const C = window.CHOCOLATES, $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const store = { get: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
                  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const label = k => C[k] ? (C[k].z ? C[k].name : `N°${k} ${C[k].name}`) : k;
  const photo = k => C[k]?.img || "https://www.zchocolat.com/img/cms/flavors/" + (k.startsWith("z") ? "z-" + k.slice(1) : "n" + k.padStart(2, "0")) + ".jpg";

  document.head.insertAdjacentHTML("beforeend", `<style>
  .hk{border:1px solid var(--line);padding:20px;display:flex;flex-direction:column;gap:12px}
  .hk p{margin:0;font-size:14.5px;color:var(--text)}
  .hk .btn{min-height:46px}
  .hk-heart{appearance:none;background:none;border:1px solid var(--line);color:var(--ink);font:500 10.5px/1 var(--sans);letter-spacing:.22em;text-transform:uppercase;padding:12px 14px;cursor:pointer;align-self:flex-start;display:flex;gap:8px;align-items:center}
  .hk-heart[aria-pressed="true"]{border-color:var(--ink)}
  .hk-heart span{font:400 16px/1 var(--serif)}
  .hk-tasting{max-width:560px;margin:0 auto;padding:40px var(--gutter-r) 8px var(--gutter-l);display:flex;flex-direction:column;gap:16px}
  .hk-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;border-top:1px solid var(--line)}
  .hk-list li{display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid var(--line)}
  .hk-list img{width:48px;height:48px;object-fit:cover;background:var(--paper)}
  .hk-list .nm{flex:1;font:400 18px/1.2 var(--serif);color:var(--ink)}
  .hk-list button{appearance:none;background:none;border:0;font:400 20px/1 var(--serif);color:var(--ink);cursor:pointer;padding:6px}
  .hk input[type=email]{font:16px var(--sans);padding:13px 14px;border:1px solid var(--line);border-radius:0;background:var(--white);color:var(--ink)}
  .hk label{display:flex;gap:10px;align-items:flex-start;font-size:13.5px;color:var(--text)}
  .hk small{font-size:12px;color:var(--muted)}
  .hk-preview{font:12px/1.5 ui-monospace,Menlo,monospace;color:var(--muted);white-space:pre-wrap;word-break:break-all;background:var(--paper);padding:10px}
  </style>`);

  // ---------- sending to the module ----------
  async function send(kind, data) {
    const url = H.endpoints?.[kind], body = JSON.stringify(data);
    if (!url) { console.info("[zScanner hooks] would send to", kind, data); return { preview: true, body }; }
    try {
      if (kind === "scan" && navigator.sendBeacon) { navigator.sendBeacon(url, new Blob([body], { type: "text/plain" })); return { ok: true }; }
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body, mode: "cors" });
      return r.status === 204 ? { ok: true } : await r.json().catch(() => ({ ok: r.ok }));
    } catch (e) { return { ok: false, error: "network" }; }
  }

  // ---------- idea 4: the box's code and an anonymous device number ----------
  const code = (() => {
    const q = new URLSearchParams(location.search).get("o");
    if (q && /^[A-Za-z0-9]{4,12}$/.test(q)) { store.set("zscanner-order", q.toUpperCase()); return q.toUpperCase(); }
    return store.get("zscanner-order", null);
  })();
  const device = store.get("zscanner-device", null) || (() => { const d = "d-" + Math.random().toString(36).slice(2, 10); store.set("zscanner-device", d); return d; })();

  // ---------- idea 2: tasting list on this phone ----------
  let tasting = store.get("zscanner-tasting", { items: [], favs: [] });
  const save = () => store.set("zscanner-tasting", tasting);
  const isFav = k => tasting.favs.includes(k);
  function toggleFav(k) { tasting.favs = isFav(k) ? tasting.favs.filter(x => x !== k) : [...tasting.favs, k]; save(); drawList(); }

  let section = null;
  function drawList() {
    if (!on("tasting") || !tasting.items.length) { if (section) section.hidden = true; return; }
    if (!section) {
      section = document.createElement("section"); section.className = "hk-tasting"; section.setAttribute("aria-labelledby", "hkTitle");
      $("#result").insertAdjacentElement("afterend", section);
    }
    section.hidden = false;
    const order = [...tasting.items].sort((a, b) => (isFav(b.key) - isFav(a.key)) || a.t - b.t);
    const n = tasting.favs.length;
    section.innerHTML = `
      <p class="eyebrow dark">My tasting</p>
      <h2 id="hkTitle">Your tasting so far</h2>
      <ul class="hk-list">${order.map(i => `<li><img src="${photo(i.key)}" alt="" onerror="this.onerror=null;this.src='images/${esc(i.key)}.jpg'"><span class="nm">${esc(label(i.key))}</span>
        <button type="button" data-k="${esc(i.key)}" aria-pressed="${isFav(i.key)}" aria-label="Favourite">${isFav(i.key) ? "♥" : "♡"}</button></li>`).join("")}</ul>
      <form class="hk" id="hkForm" novalidate>
        <p><b style="color:var(--ink);font-weight:500">${n ? `Email me my ${n === 1 ? "favourite" : n + " favourites"}` : "Email me my tasting"}</b></p>
        <input type="email" id="hkEmail" placeholder="Your email address" autocomplete="email" required>
        <label><input type="checkbox" id="hkNews"> Send me zChocolat news and offers</label>
        <small>We'll use your email to send this list${H.privacyUrl ? `; see our <a href="${esc(H.privacyUrl)}" target="_blank" rel="noopener">privacy policy</a>` : ""}.</small>
        <button class="btn btn-dark" type="submit">Send</button>
        <p id="hkMsg" role="status"></p>
      </form>`;
    section.querySelectorAll(".hk-list button").forEach(b => b.onclick = () => { toggleFav(b.dataset.k); syncHeart(); });
    section.querySelector("#hkForm").onsubmit = async e => {
      e.preventDefault();
      const email = section.querySelector("#hkEmail").value.trim(), msg = section.querySelector("#hkMsg");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = "Please check your email address."; return; }
      const favs = tasting.favs.length ? tasting.favs : tasting.items.map(i => i.key);
      const r = await send("favourites", { email, favourites: favs, newsletter: section.querySelector("#hkNews").checked, lang: "en" });
      msg.innerHTML = r.preview ? `<span class="hk-preview">Preview (module not connected yet), would send:\n${esc(r.body)}</span>`
        : r.ok ? "Sent, check your inbox." : "Sorry, that didn't send. Please try again in a moment.";
    };
  }
  function syncHeart() { const b = $("#hkHeart"); if (b) { const k = b.dataset.k; b.setAttribute("aria-pressed", isFav(k)); b.innerHTML = `<span>${isFav(k) ? "♥" : "♡"}</span>${isFav(k) ? "In your favourites" : "Add to favourites"}`; } }

  // ---------- after each result ----------
  let welcomeShown = false;
  try { welcomeShown = sessionStorage.getItem("zscanner-welcome") === "1"; } catch (e) {}
  window.addEventListener("zfound", e => {
    const { key, scanned, repeat } = e.detail, card = $("#result .card"); if (!card || !C[key]) return;
    const actions = card.querySelector(".card-actions");
    if (scanned && !repeat && on("tasting") && !tasting.items.some(i => i.key === key)) { tasting.items.push({ key, t: Date.now() }); save(); }
    if (scanned && !repeat && on("corporate") && code) send("scan", { o: code, device, choc: key });

    if (on("tasting") && scanned) {
      actions.insertAdjacentHTML("beforebegin", `<button class="hk-heart" id="hkHeart" type="button" data-k="${esc(key)}"></button>`);
      syncHeart(); $("#hkHeart").onclick = () => { toggleFav(key); syncHeart(); };
    }
    if (on("corporate") && code && scanned) {
      const sent = store.get("zscanner-thanked-" + code, false);
      actions.insertAdjacentHTML("afterend", `<div class="hk"><p>${sent ? "Your thank-you has been sent to the person who gave you these chocolates." : "Enjoying your gift? Let the sender know."}</p>
        ${sent ? "" : `<button class="btn btn-outline-dark" type="button" id="hkThanks">Say thank you</button>`}<p id="hkThanksMsg" role="status"></p></div>`);
      const b = $("#hkThanks");
      if (b) b.onclick = async () => {
        b.disabled = true; const r = await send("thanks", { o: code, device });
        if (r.preview) $("#hkThanksMsg").innerHTML = `<span class="hk-preview">Preview, would send:\n${esc(r.body)}</span>`;
        else if (r.ok) { store.set("zscanner-thanked-" + code, true); b.remove(); $("#hkThanksMsg").textContent = "Thank you sent."; }
        else { b.disabled = false; $("#hkThanksMsg").textContent = "Sorry, that didn't send. Please try again."; }
      };
    }
    if (on("welcome") && scanned && (!welcomeShown || ADMIN || repeat)) {
      const u = new URL(H.welcome.signupUrl); u.searchParams.set("zs", "1");
      u.searchParams.set("utm_source", "zscanner"); u.searchParams.set("utm_medium", "gift_recipient"); u.searchParams.set("utm_campaign", "welcome_offer"); u.searchParams.set("utm_content", key);
      const name = C[key].z ? C[key].name : `N°${key}`;
      card.insertAdjacentHTML("beforeend", `<div class="hk"><p class="eyebrow dark">Welcome offer</p>
        <p>Enjoying ${esc(name)}? Create your zChocolat account and enjoy ${esc(H.welcome.offer)}.</p>
        <a class="btn btn-outline-dark" href="${esc(u.toString())}" target="_blank" rel="noopener">Create my account</a></div>`);
      welcomeShown = true; try { sessionStorage.setItem("zscanner-welcome", "1"); } catch (e) {}
    }
    drawList();
  });
  drawList();
})();
