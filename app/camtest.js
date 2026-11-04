// Camera test (admin page only): checks what resolution the phone's camera will actually give a web page.
// Two separate measurements, neither changes how the live scanner works:
//  1. The live video feed - the scanner normally asks for 1920x1920; this asks for far more than any phone
//     camera can give, so whatever comes back is the real ceiling, not just what we happened to ask for.
//  2. ImageCapture.takePhoto() - a newer, separately-supported browser feature that (if the phone allows it)
//     grabs a single full-resolution still photo from the same running camera, rather than being limited to
//     the live feed's lower resolution. Support is inconsistent across iOS versions, so this is a feature
//     test, not an assumption.
// Uses the .cl/.cl-screen CSS that collect.js injects into <head> - needs collect.js loaded first.
(() => {
  if (window.ZADMIN !== true) return;
  const $ = s => document.querySelector(s);
  document.body.insertAdjacentHTML("beforeend", `
  <div class="cl" id="ct" hidden>
    <div class="cl-screen">
      <div style="display:flex;justify-content:space-between;align-items:center"><p class="eyebrow" style="color:#fff">Camera test</p>
        <button class="btn btn-light" type="button" id="ctClose" style="padding:10px 14px">Close</button></div>
      <h3>How much real detail can the camera give us?</h3>
      <p class="muted">Checks the sharpest picture this phone's camera will hand to a web page - the live preview the scanner normally uses, and (if the phone allows it) one much higher-resolution still photo from the same camera. Doesn't change the scanner itself.</p>
      <button class="btn btn-light" type="button" id="ctGo">Start</button>
      <div id="ctOut" style="font:400 14px/1.6 var(--sans);white-space:pre-wrap"></div>
      <div id="ctImgs" style="display:flex;gap:10px;flex-wrap:wrap"></div>
      <button class="btn btn-light" type="button" id="ctCopy" hidden>Copy results</button>
    </div>
  </div>`);
  let stream = null;
  function stop() { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } }
  const close = () => { stop(); $("#ct").hidden = true; document.body.style.overflow = ""; };
  $("#ctClose").onclick = close;
  const blobToImg = blob => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(blob); });
  let summary = "";
  $("#ctGo").onclick = async () => {
    stop();
    const out = $("#ctOut"), imgs = $("#ctImgs"); $("#ctGo").disabled = true; $("#ctCopy").hidden = true; imgs.innerHTML = "";
    const lines = [];
    out.textContent = "Asking for the camera…";
    try {
      // ask for far more than any phone camera can give, so whatever comes back is the real ceiling
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 4096 }, height: { ideal: 4096 } }, audio: false });
      const track = stream.getVideoTracks()[0], settings = track.getSettings();
      lines.push(`Live video feed: ${settings.width}x${settings.height} (the scanner normally asks for 1920x1920 - this asked for 4096x4096 to find the real ceiling)`);
      out.textContent = lines.join("\n");

      const video = document.createElement("video"); video.srcObject = stream; video.muted = true; video.playsInline = true;
      await video.play().catch(() => {});
      await new Promise(r => { if (video.readyState >= 2) r(); else video.onloadeddata = r; });
      const fc = document.createElement("canvas"); fc.width = video.videoWidth; fc.height = video.videoHeight;
      fc.getContext("2d").drawImage(video, 0, 0);
      const frameMP = video.videoWidth * video.videoHeight / 1e6;
      lines.push(`Live frame grab: ${video.videoWidth}x${video.videoHeight} (${frameMP.toFixed(1)} MP)`);
      imgs.insertAdjacentHTML("beforeend", `<div><p class="muted">Live frame</p><img src="${fc.toDataURL("image/jpeg", 0.85)}" style="max-width:160px;border:1px solid rgba(255,255,255,.3)"></div>`);
      out.textContent = lines.join("\n");

      if ("ImageCapture" in window) {
        try {
          const capture = new ImageCapture(track);
          try {
            const caps = await capture.getPhotoCapabilities();
            if (caps?.imageWidth) lines.push(`Still-photo capability reported: up to ${caps.imageWidth.max}x${caps.imageHeight.max}`);
          } catch (e) { lines.push(`getPhotoCapabilities() not available (${e.message || e})`); }
          const photoBlob = await capture.takePhoto();
          const img = await blobToImg(photoBlob);
          const stillMP = img.naturalWidth * img.naturalHeight / 1e6;
          lines.push(`takePhoto() worked: ${img.naturalWidth}x${img.naturalHeight} (${stillMP.toFixed(1)} MP) - ${(stillMP / frameMP).toFixed(1)}x the live frame's pixels`);
          imgs.insertAdjacentHTML("beforeend", `<div><p class="muted">takePhoto() still</p><img src="${img.src}" style="max-width:160px;border:1px solid rgba(255,255,255,.3)"></div>`);
        } catch (e) { lines.push(`takePhoto() failed: ${e.message || e}`); }
      } else {
        lines.push(`ImageCapture isn't available on this phone/browser at all.`);
      }
    } catch (e) {
      lines.push(`Camera failed to start: ${e.message || e}`);
    }
    out.textContent = lines.join("\n");
    summary = `zScanner camera test\n${navigator.userAgent.replace(/^.*?\(([^)]*)\).*$/, "$1")}\n` + lines.join("\n");
    $("#ctCopy").hidden = false; $("#ctGo").disabled = false; $("#ctGo").textContent = "Run again";
  };
  $("#ctCopy").onclick = async () => { try { await navigator.clipboard.writeText(summary); $("#ctCopy").textContent = "Copied, paste it in the chat"; } catch (e) { prompt("Copy this:", summary); } };
  window.ZCamTest = { open: () => { $("#ct").hidden = false; document.body.style.overflow = "hidden"; } };
})();
