// Test log (admin page only). After every scan it shows the numbers behind the decision,
// asks Right / Wrong (and the real chocolate if wrong), and saves it with a place/lighting note and the two
// pictures the scanner used. Everything stays on the phone until "Download test log" makes one zip.
(() => {
  if (window.ZADMIN !== true) return;
  const C = window.CHOCOLATES;
  const KEYS = [...Array.from({ length: 25 }, (_, i) => String(i)), "zdark", "zmilk", "zwhite"];
  const name = k => !k ? "nothing" : k.startsWith("z") ? C[k].name : "N°" + k;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- storage (IndexedDB, as plain data so iPhone Safari accepts it) ----------
  const dbp = new Promise((res, rej) => { const r = indexedDB.open("zscanner-tests", 1); r.onupgradeneeded = () => r.result.createObjectStore("scans", { keyPath: "n" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (mode, fn) => { const db = await dbp; return new Promise((res, rej) => { const t = db.transaction("scans", mode); const q = fn(t.objectStore("scans")); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  const memory = new Map();
  const put = async e => { memory.set(e.n, e); try { await tx("readwrite", s => s.put(e)); } catch (err) { console.warn("kept in memory only", err); } };
  const all = async () => { let rows = []; try { rows = await tx("readonly", s => s.getAll()) || []; } catch (e) {} const m = new Map(rows.map(r => [r.n, r])); memory.forEach((v, k) => m.set(k, v)); return [...m.values()].sort((a, b) => a.n - b.n); };
  const clear = async () => { memory.clear(); try { await tx("readwrite", s => s.clear()); } catch (e) {} };
  const noteKey = "zscanner-test-note";
  const getNote = () => { try { return localStorage.getItem(noteKey) || ""; } catch { return ""; } };
  const setNote = v => { try { localStorage.setItem(noteKey, v); } catch {} };

  // ---------- panel ----------
  document.head.insertAdjacentHTML("beforeend", `<style>
  .tl{border:1px solid var(--ink);padding:16px;margin-top:32px;display:flex;flex-direction:column;gap:12px;font-size:14px}
  .tl h3{margin:0;font:500 22px var(--serif);color:var(--ink)}
  .tl label{font:500 10.5px var(--sans);letter-spacing:.2em;text-transform:uppercase;color:var(--muted)}
  .tl input{font:inherit;padding:10px;border:1px solid var(--line);border-radius:0;width:100%}
  .tl .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;text-align:center}
  .tl .stats div{border:1px solid var(--line);padding:8px 4px}
  .tl .stats b{display:block;font:500 22px var(--serif);color:var(--ink)}
  .tl .stats span{font-size:11px;color:var(--muted)}
  .tl-card{border:1px solid var(--line);padding:12px;display:flex;flex-direction:column;gap:10px}
  .tl-pics{display:grid;grid-template-columns:1fr 1fr;gap:6px} .tl-pics img{width:100%;aspect-ratio:1/1;object-fit:cover;background:#eee}
  .tl-pics small{display:block;font-size:11px;color:var(--muted);margin-top:2px}
  .tl table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
  .tl td{padding:4px 0;border-bottom:1px solid var(--line);vertical-align:top} .tl td:first-child{color:var(--muted);width:42%}
  .tl-row{display:flex;gap:8px} .tl-row .btn{flex:1;min-height:46px}
  .tl-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:5px}
  .tl-grid button{appearance:none;border:1px solid var(--line);background:#fff;color:var(--ink);padding:9px 0;font:400 16px var(--serif);cursor:pointer}
  .tl-grid button.w{grid-column:span 2;font:500 10px var(--sans);letter-spacing:.12em;text-transform:uppercase}
  .tl .ok{color:#1f7a3a;font-weight:500} .tl .bad{color:#b4442c;font-weight:500}
  .tl-link{background:none;border:0;padding:0;color:var(--muted);text-decoration:underline;font:inherit;font-size:13px;cursor:pointer;align-self:flex-start}
  </style>`);
  const panel = document.createElement("section"); panel.className = "tl";
  document.querySelector("main.page").prepend(panel);
  panel.innerHTML = `
    <h3>Test log</h3>
    <div><label for="tlNote">Place and light (saved with each scan)</label><input id="tlNote" placeholder="e.g. office desk, daylight, in the box" value="${esc(getNote())}"></div>
    <div class="stats" id="tlStats"></div>
    <p id="tlTally" style="margin:0;font-size:13px;color:var(--text)"></p>
    <div id="tlCurrent"></div>
    <button class="btn btn-dark" id="tlZip" type="button">Download test log (.zip)</button>
    <button class="tl-link" id="tlClear" type="button">Clear the test log</button>`;
  panel.querySelector("#tlNote").oninput = e => setNote(e.target.value);

  async function stats() {
    tallyLine();
    const rows = await all(), labelled = rows.filter(r => r.correct !== undefined && r.correct !== null);
    const right = labelled.filter(r => r.correct).length, wrong = labelled.filter(r => r.type === "answer" && !r.correct).length;
    const none = labelled.filter(r => r.type === "noanswer").length;
    panel.querySelector("#tlStats").innerHTML = `
      <div><b>${labelled.length}</b><span>scans</span></div><div><b>${right}</b><span>right</span></div>
      <div><b>${wrong}</b><span>wrong</span></div><div><b>${labelled.length ? Math.round(100 * right / labelled.length) : 0}%</b><span>accuracy</span></div>`
      + (none ? `<div style="grid-column:1/-1"><span>${none} gave no answer</span></div>` : "");
  }

  // ---------- running total across ALL test sessions on this phone, per model (clearing the log keeps it) ----------
  // "Proven better than 1 wrong in N": with W wrong in A answered, the true error rate is below U/A with 95% confidence
  // (U = 3.0 for 0 wrong, 4.7 for 1, 6.3 for 2, …), so N = A / U. This is how many fair scans a claim needs.
  const TALLY = "zscanner-tally-v1";
  const getTally = () => { try { return JSON.parse(localStorage.getItem(TALLY)) || {}; } catch { return {}; } };
  const record = e => { const t = getTally(), m = (window.Recognizer && Recognizer.model) || "model"; (t[m] = t[m] || {})[e.at] = [e.type === "answer" ? 1 : 0, e.correct ? 1 : 0]; try { localStorage.setItem(TALLY, JSON.stringify(t)); } catch {} };
  function tallyLine() {
    const m = (window.Recognizer && Recognizer.model) || "model", rows = Object.values(getTally()[m] || {});
    const scans = rows.length, answered = rows.filter(r => r[0]).length, wrong = rows.filter(r => r[0] && !r[1]).length;
    const U = [3.0, 4.74, 6.3, 7.75, 9.15, 10.51].at(wrong) ?? (wrong + 2 * Math.sqrt(wrong) + 2);
    const proof = answered < 30 ? "too few scans yet to prove a rate" : `proven better than 1 wrong in ${Math.floor(answered / U)} (95% confidence)`;
    panel.querySelector("#tlTally").innerHTML = scans ? `<b style="font-weight:500;color:var(--ink)">All tests with ${esc(m)} on this phone:</b> ${scans} scans, ${answered} answered (${Math.round(100 * answered / scans)}%), ${wrong} wrong · ${proof}` : "";
  }

  let n = 0;
  all().then(r => { n = r.length ? r[r.length - 1].n : 0; stats(); });

  window.addEventListener("zscan", async e => {
    const d = e.detail;
    const entry = { n: ++n, at: new Date().toISOString(), note: getNote(), type: d.type, guess: d.guess, avgTop3: d.avgTop3, nowTop3: d.nowTop3,
      shell: d.shell, mark: d.mark, frames: d.frames, holdMs: d.holdMs, ms: d.ms, seenMs: d.seenMs, trace: d.trace || [],
      crop: d.crop, frame: d.frame, truth: null, correct: null };
    await put(entry);
    show(entry);
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function numbers(e) {
    const t = a => (a || []).map(x => `${name(x.key)} ${x.p}%`).join(" · ");
    return `<table>
      <tr><td>Answer</td><td>${e.type === "answer" ? `<b>${esc(name(e.guess))}</b>` : e.type === "retry" ? "No answer within 5 s (client is asked to try again)" : "No answer (you closed the camera)"}</td></tr>
      <tr><td>Average over the hold</td><td>${t(e.avgTop3)}</td></tr>
      <tr><td>Last frame alone</td><td>${t(e.nowTop3)}</td></tr>
      <tr><td>Shell colour seen</td><td>${e.shell}</td></tr>
      <tr><td>Mark seen</td><td>${{ one: "one digit", two: "two digits", z: "z" }[e.mark] || e.mark}</td></tr>
      <tr><td>Frames averaged</td><td>${e.frames} over ${(e.holdMs / 1000).toFixed(1)}s</td></tr>
      <tr><td>Time to answer</td><td>${(e.ms / 1000).toFixed(1)}s${e.seenMs != null ? ` (${(e.seenMs / 1000).toFixed(1)}s after the chocolate was first seen)` : ""}</td></tr>
      <tr><td>Frames recorded</td><td>${(e.trace || []).length}</td></tr></table>`;
  }

  function show(e) {
    const cur = panel.querySelector("#tlCurrent");
    cur.innerHTML = `<div class="tl-card">
      <strong>Scan ${e.n}</strong>
      <div class="tl-pics"><div><img src="${e.frame}" alt=""><small>Camera view</small></div><div><img src="${e.crop}" alt=""><small>Close-up it read</small></div></div>
      ${numbers(e)}
      ${e.type === "answer"
        ? `<p style="margin:0">Was it right?</p><div class="tl-row"><button class="btn btn-dark" id="tlRight" type="button">Right</button><button class="btn btn-outline-dark" id="tlWrong" type="button">Wrong</button></div>`
        : `<p style="margin:0">Which chocolate was it?</p>`}
      <div class="tl-grid" id="tlPick" ${e.type === "answer" ? "hidden" : ""}>
        ${KEYS.map(k => `<button type="button" data-k="${k}" class="${k.startsWith("z") ? "w" : ""}">${k.startsWith("z") ? C[k].name.replace(" Chocolate", "") : k}</button>`).join("")}
      </div></div>`;
    const done = async (truth) => {
      e.truth = truth; e.correct = e.type === "answer" && truth === e.guess; await put(e); record(e); await stats();
      cur.innerHTML = `<div class="tl-card"><span class="${e.correct ? "ok" : "bad"}">Scan ${e.n} saved: ${e.correct ? "right" : e.type === "answer" ? `wrong, it was ${esc(name(truth))}` : `no answer, it was ${esc(name(truth))}`}</span>
        <button class="btn btn-dark" id="tlNext" type="button">Scan the next chocolate</button></div>`;
      cur.querySelector("#tlNext").onclick = () => { window.scrollTo({ top: 0, behavior: "smooth" }); document.getElementById("camBtn").click(); };
    };
    const r = cur.querySelector("#tlRight"); if (r) r.onclick = () => done(e.guess);
    const w = cur.querySelector("#tlWrong"); if (w) w.onclick = () => { w.parentElement.hidden = true; cur.querySelector("#tlPick").hidden = false; };
    cur.querySelectorAll("#tlPick button").forEach(b => b.onclick = () => done(b.dataset.k));
  }

  // ---------- download ----------
  panel.querySelector("#tlZip").onclick = async ev => {
    const btn = ev.currentTarget, rows = await all(); if (!rows.length) return;
    btn.textContent = "Preparing…"; btn.disabled = true;
    const zip = new JSZip();
    const data = rows.map(({ crop, frame, ...rest }) => rest);
    zip.file("test-log.json", JSON.stringify(data, null, 2));
    const csv = ["scan,time,note,type,guess,truth,correct,avg1,avg1p,avg2,avg2p,shell,mark,frames,hold_s,time_s"].concat(data.map(r =>
      [r.n, r.at, JSON.stringify(r.note || ""), r.type, r.guess || "", r.truth || "", r.correct, r.avgTop3?.[0]?.key, r.avgTop3?.[0]?.p, r.avgTop3?.[1]?.key, r.avgTop3?.[1]?.p, r.shell, r.mark, r.frames, (r.holdMs / 1000).toFixed(1), (r.ms / 1000).toFixed(1)].join(",")));
    zip.file("test-log.csv", csv.join("\n"));
    const b64 = u => u && u.split(",")[1];
    rows.forEach(r => {
      const folder = r.truth || "unlabelled";
      if (r.frame) zip.file(`camera/${folder}/scan${r.n}.jpg`, b64(r.frame), { base64: true });
      if (r.crop) zip.file(`closeup/${folder}/scan${r.n}.jpg`, b64(r.crop), { base64: true });
    });
    const blob = await zip.generateAsync({ type: "blob" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `zscanner-test-log-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.zip` });
    document.body.append(a); a.click(); a.remove();
    btn.disabled = false; btn.textContent = "Download test log (.zip)";
  };
  let armed = false;
  panel.querySelector("#tlClear").onclick = async ev => {
    if (!armed) { armed = true; ev.target.textContent = "Tap again to clear every test scan"; return; }
    await clear(); n = 0; armed = false; ev.target.textContent = "Clear the test log"; panel.querySelector("#tlCurrent").innerHTML = ""; stats();
  };
})();
