// Admin page: passcode screen + admin bar (Test scanner / Collect photos / Lock).
// Note: this site is static (GitHub Pages), so the passcode is checked on the phone. It keeps clients out,
// but it is not real security: never put anything confidential on the admin page.
(() => {
  const SALT = "zscanner-admin:";
  const HASHES = [ // SHA-256 of SALT + passcode (the passcode itself is never stored)
    "4763841621c506c5c3ee0bc04eae9f218dbf214f8bb89e5deaaca92ef3862eb7",
    "ab71792c5a869d1a6d6d8520ef89c1f994b15f5b9b74574634ed9ee2f307b39c"
  ];
  const KEY = "zscanner-admin-ok";
  const gate = document.getElementById("gate");
  const ok = () => { try { return HASHES.includes(localStorage.getItem(KEY)); } catch { return false; } };
  async function sha(s) {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
  }
  function unlock() { gate.hidden = true; document.body.style.overflow = ""; }
  if (ok()) unlock();
  else {
    document.body.style.overflow = "hidden";
    const form = gate.querySelector("form"), input = gate.querySelector("input"), msg = gate.querySelector(".gate-msg");
    form.onsubmit = async e => {
      e.preventDefault();
      const h = await sha(SALT + input.value.trim());
      if (HASHES.includes(h)) { try { localStorage.setItem(KEY, h); } catch {} unlock(); }
      else { msg.textContent = "That passcode isn't right."; input.select(); }
    };
    setTimeout(() => input.focus(), 50);
  }

  // admin bar
  document.getElementById("modeTest").onclick = () => { document.querySelector(".tl")?.scrollIntoView({ behavior: "smooth" }); };
  document.getElementById("modeCollect").onclick = () => window.ZCollect && window.ZCollect.open();
  document.getElementById("modeLock").onclick = () => { try { localStorage.removeItem(KEY); } catch {} location.reload(); };
})();
