// "Add to home screen": registers offline support and offers installation.
// Android/Chrome: a one-tap Install button (the browser's own install prompt).
// iPhone/iPad Safari: websites can't install themselves, so we show a short two-tap guide.
(() => {
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (standalone) return;

  const box = document.getElementById("install");
  const remember = k => { try { localStorage.setItem(k, "1"); } catch {} };
  const seen = k => { try { return localStorage.getItem(k) === "1"; } catch { return false; } };
  if (!box || seen("installDismissed")) return;

  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);

  function show(html) {
    box.innerHTML = `<div class="install-text">${html}</div><button class="install-close" type="button" aria-label="Not now"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
    box.hidden = false;
    box.querySelector(".install-close").onclick = () => { box.hidden = true; remember("installDismissed"); };
  }

  // Android / desktop Chrome and Edge
  let deferred = null;
  addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); deferred = e;
    show(`<strong>Keep zScanner on your phone</strong><span>Add it to your home screen for your next box.</span>
          <button class="btn btn-dark install-go" type="button">Add to home screen</button>`);
    box.querySelector(".install-go").onclick = async () => {
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null; box.hidden = true;
      if (outcome === "accepted") remember("installDismissed");
    };
  });
  addEventListener("appinstalled", () => { box.hidden = true; remember("installDismissed"); });

  // iPhone / iPad Safari: show the guide after the first result, so it doesn't get in the way of scanning
  if (isSafari) {
    const share = `<svg class="ios-share" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-label="Share"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v8h14v-8"/></svg>`;
    const guide = () => show(`<strong>Keep zScanner on your phone</strong>
      <ol class="ios-steps"><li>Tap ${share} <b>Share</b> at the bottom of Safari</li><li>Choose <b>Add to Home Screen</b></li></ol>`);
    const result = document.getElementById("result");
    let shown = false;
    new MutationObserver(() => {
      if (!shown && result.querySelector(".wrong")) { shown = true; setTimeout(guide, 1500); }
    }).observe(result, { childList: true });
  }
})();
