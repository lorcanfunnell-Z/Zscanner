// Test log (admin page only). After every scan it shows the numbers behind the decision,
// asks Right / Wrong (and the real chocolate if wrong), and saves it with a place/lighting note and the two
// pictures the scanner used. Everything stays on the phone until "Download test log" makes one zip.
(() => {
  if (window.ZADMIN !== true) return;
  const C = window.CHOCOLATES;
  const KEYS = [...Array.from({ length: 25 }, (_, i) => String(i)), "zdark", "zmilk", "zwhite"];
  const name = k => !k || k === "none" ? "nothing" : k.startsWith("z") ? C[k].name : "N°" + k;   // "none" (13 Nov): a deliberate not-a-chocolate shot
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- storage (IndexedDB, as plain data so iPhone Safari accepts it) ----------
  const tx = ZIdbStore.openStore("zscanner-tests", "scans", { keyPath: "n" });
  const memory = new Map();
  const put = async e => { memory.set(e.n, e); try { await tx("readwrite", s => s.put(e)); } catch (err) { console.warn("kept in memory only", err); } };
  window.ZTESTLOG = { all: () => all() };   // 23 Nov: for tools/browser_smoke.js, which checks what Exam mode actually stored
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
  .tl-row{display:flex;gap:8px} .tl-row .btn{flex:1;min-height:46px;padding:0 10px;letter-spacing:.08em;line-height:1.25}
  #tlLists .btn{padding:0 6px;min-width:0;letter-spacing:.06em;font-size:11px;line-height:1.25} #tlLists small{font-size:11px;letter-spacing:0;text-transform:none}
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
    <p id="tlBuild" style="margin:-6px 0 0;font-size:13px;color:var(--muted)">Build: reading…</p>
    <div><label for="tlNote">Place and light (saved with each scan)</label><input id="tlNote" placeholder="e.g. office desk, daylight, in the box" value="${esc(getNote())}"></div>
    <div class="stats" id="tlStats"></div>
    <p id="tlTally" style="margin:0;font-size:13px;color:var(--text)"></p>
    <div><label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font:400 14px var(--sans);color:var(--text)"><input type="checkbox" id="tlExam" style="width:auto"> Exam mode: scan from a shuffled list, the truth filled in for you</label>
      <div class="tl-row" id="tlLists" hidden style="margin-top:8px"></div>
      <p id="tlNext" style="margin:6px 0 0;font:500 16px var(--serif);color:var(--ink)"></p></div>
    <div id="tlCurrent"></div>
    <button class="btn btn-dark" id="tlZip" type="button">Download test log (.zip)</button>
    <button class="tl-link" id="tlClear" type="button">Clear the test log</button>
    <button class="tl-link" id="tlExamReset" type="button" hidden>Start the exam again from list 1</button>`;
  panel.querySelector("#tlNote").oninput = e => setNote(e.target.value);
  // which build this phone is running, read from sw.js by app.js (13 Nov): check it before every session
  const showBuild = b => { panel.querySelector("#tlBuild").textContent = `Build: ${b.version || "?"} · ${b.models || "?"} · ${(window.Recognizer && Recognizer.model) || "?"}`; };
  if (window.ZBUILD && window.ZBUILD.version) showBuild(window.ZBUILD);
  window.addEventListener("zbuild", e => showBuild(e.detail));

  // ---------- exam mode (13 Nov, see training/exam-session-brief.md) ----------
  // The truth is entered BEFORE each scan, from shuffled lists the page deals. 23 Nov (Lorcan's plan): THREE lists,
  // one per sitting, each every chocolate EXAM_EACH times in a shuffled order and then EXAM_NOTHING "Nothing" shots
  // (the page says what to point at), 3 x (112 + 8). The lists are dealt together and kept on the phone with each
  // one's position, so a sitting can stop and carry on, and tapping a list's button switches to it. Right or wrong is worked out from the scanner's answer and the scan is saved by itself; the only tap
  // ever needed is "I scanned something else". This replaces tapping the truth after seeing the answer, which is how
  // the test-7 N°21/N°22 mis-tap happened, and it makes a predictable scanning order impossible. The list lives on
  // the phone, so a sitting can stop and the next one carries on where it left off.
  const EXAM = "zscanner-exam-v2", EXAM_LISTS = 3, EXAM_EACH = 4, EXAM_NOTHING = 8;
  const NOTHING_IDEAS = ["the box lid", "a wrapper or the ribbon", "the white card with nothing on it", "the back of your hand", "the bare table", "the QR card", "a pen or your keys", "the closed box from the side"];
  const getExam = () => { try { const x = JSON.parse(localStorage.getItem(EXAM)); return x && Array.isArray(x.lists) ? x : null; } catch { return null; } };
  const setExam = x => { try { localStorage.setItem(EXAM, JSON.stringify(x)); } catch {} };
  const examOn = () => panel.querySelector("#tlExam").checked;
  function dealExam() {
    const lists = [];
    for (let l = 0; l < EXAM_LISTS; l++) {
      const q = []; for (let i = 0; i < EXAM_EACH; i++) q.push(...KEYS);
      for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }   // Fisher-Yates
      for (let i = 0; i < EXAM_NOTHING; i++) q.push("none");   // the Nothing shots close each list
      lists.push({ queue: q, pos: 0 });
    }
    const x = { lists, current: 0, dealt: new Date().toISOString() }; setExam(x); try { localStorage.removeItem("zscanner-exam-v1"); } catch {}
    return x;
  }
  // what to scan next in the current list: {key, pos, total, list (1-based), idea (for a Nothing shot)}, or null when
  // that list is finished / exam mode is off
  function examNext() {
    if (!examOn()) return null;
    const x = getExam() || dealExam(), L = x.lists[x.current];
    if (L.pos >= L.queue.length) return null;
    const key = L.queue[L.pos], firstNothing = L.queue.length - EXAM_NOTHING;
    return { key, pos: L.pos, total: L.queue.length, list: x.current + 1, idea: key === "none" ? NOTHING_IDEAS[(L.pos - firstNothing + EXAM_NOTHING) % NOTHING_IDEAS.length] : null };
  }
  const nextLabel = (nx, short) => `${name(nx.key)}${nx.idea ? (short ? ` - ${nx.idea}` : ` (point at ${nx.idea})`) : ""}`;
  function showNext() {
    const nx = examNext(), p = panel.querySelector("#tlNext"), r = panel.querySelector("#tlExamReset"), lb = panel.querySelector("#tlLists");
    r.hidden = lb.hidden = !examOn();
    if (!examOn()) { p.textContent = ""; return; }
    const x = getExam() || dealExam();
    lb.innerHTML = x.lists.map((L, i) => `<button type="button" class="btn ${i === x.current ? "btn-dark" : "btn-outline-dark"}" data-list="${i}">List ${i + 1}<br><small>${L.pos >= L.queue.length ? "done" : `${L.pos}/${L.queue.length}`}</small></button>`).join("");
    lb.querySelectorAll("button").forEach(b => b.onclick = () => { const y = getExam(); if (y && y.current !== +b.dataset.list) { y.current = +b.dataset.list; setExam(y); panel.querySelector("#tlCurrent").innerHTML = ""; showNext(); } });
    if (nx) p.textContent = `Exam list ${nx.list} · ${nx.pos + 1} of ${nx.total} · Scan next: ${nextLabel(nx)}${nx.key === "none" ? " · if nothing is framed after 10 s, tap ✕ to save it" : ""}`;
    else {
      const l = x.current + 1, nextList = x.lists.findIndex((L, i) => i > x.current && L.pos < L.queue.length);
      p.textContent = x.lists.every(L => L.pos >= L.queue.length) ? "All three exam lists finished. Download the zip."
        : nextList >= 0 ? `Exam list ${l} finished: ${x.lists[x.current].queue.length} scans. Download the zip, then tap Exam list ${nextList + 1}.`
        : `Exam list ${l} finished. Download the zip, then tap an unfinished list above.`;
    }
  }
  const EXAM_ON = "zscanner-exam-on";   // 23 Nov: the tick survives a reload (iOS reloads a backgrounded tab), so a sitting cannot silently drop out of Exam mode
  panel.querySelector("#tlExam").onchange = () => { try { localStorage.setItem(EXAM_ON, examOn() ? "1" : ""); } catch {} showNext(); };
  try { panel.querySelector("#tlExam").checked = !!localStorage.getItem(EXAM_ON); } catch {}
  let examArmed = false;
  panel.querySelector("#tlExamReset").onclick = ev => {
    if (!examArmed) { examArmed = true; ev.target.textContent = "Tap again to deal three fresh lists and forget every position"; return; }
    dealExam(); examArmed = false; ev.target.textContent = "Start the exam again from list 1"; showNext();
  };
  showNext();

  async function stats() {
    tallyLine();
    const rows = await all(), all_labelled = rows.filter(r => r.correct !== undefined && r.correct !== null);
    const nothing = all_labelled.filter(r => r.truth === "none"), labelled = all_labelled.filter(r => r.truth !== "none");   // 23 Nov: Nothing shots are counted apart, as scorecard.py does
    const right = labelled.filter(r => r.correct).length, wrong = labelled.filter(r => r.type === "answer" && !r.correct).length;
    const none = labelled.filter(r => r.type === "noanswer" || r.type === "unsure").length;   // unsure (13 Nov): not certain by the 5 s deadline, choices offered - not an answer, never counts as wrong
    const nothingWrong = nothing.filter(r => r.type === "answer").length;
    panel.querySelector("#tlStats").innerHTML = `
      <div><b>${labelled.length}</b><span>scans</span></div><div><b>${right}</b><span>right</span></div>
      <div><b>${wrong}</b><span>wrong</span></div><div><b>${labelled.length ? Math.round(100 * right / labelled.length) : 0}%</b><span>accuracy</span></div>`
      + (none ? `<div style="grid-column:1/-1"><span>${none} gave no answer</span></div>` : "")
      + (nothing.length ? `<div style="grid-column:1/-1"><span>${nothing.length} Nothing shot${nothing.length === 1 ? "" : "s"}: ${nothingWrong ? `${nothingWrong} answered (wrong)` : "none answered (all right)"}</span></div>` : "");
  }

  // ---------- running total across ALL test sessions on this phone, per model (clearing the log keeps it) ----------
  // "Proven better than 1 wrong in N": with W wrong in A answered, the true error rate is below U/A with 95% confidence
  // (U = 3.0 for 0 wrong, 4.7 for 1, 6.3 for 2, …), so N = A / U. This is how many fair scans a claim needs.
  const TALLY = "zscanner-tally-v1";
  const getTally = () => { try { return JSON.parse(localStorage.getItem(TALLY)) || {}; } catch { return {}; } };
  const saveTally = t => { try { localStorage.setItem(TALLY, JSON.stringify(t)); } catch {} };
  const record = e => { if (!e.truth || e.truth === "none") return unrecord(e);   // 23 Nov: an unlabelled row or a Nothing shot never enters the chocolate tally
    const t = getTally(), m = (window.Recognizer && Recognizer.model) || "model"; (t[m] = t[m] || {})[e.at] = [e.type === "answer" ? 1 : 0, e.correct ? 1 : 0]; saveTally(t); };
  const unrecord = e => { const t = getTally(), m = (window.Recognizer && Recognizer.model) || "model"; if (t[m] && t[m][e.at]) { delete t[m][e.at]; saveTally(t); } };
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
      shell: d.shell, mark: d.mark, frames: d.frames, holdMs: d.holdMs, ms: d.ms, seenMs: d.seenMs, clearMs: d.clearMs, forced: d.forced, tiltPermission: d.tiltPermission, loadMs: d.loadMs, build: d.build,
      trace: d.trace || [], rejected: d.rejected || [], crop: d.crop, frame: d.frame, truth: null, correct: null };
    const nx = examNext();
    if (nx) {   // exam mode: the truth was decided before the scan - save at once, no tap needed
      const x = getExam(); x.lists[nx.list - 1].pos = nx.pos + 1; setExam(x);
      entry.truth = nx.key; entry.exam = nx.pos + 1; entry.examList = nx.list;
      entry.correct = nx.key === "none" ? entry.type !== "answer" : entry.type === "answer" && entry.guess === nx.key;   // a Nothing shot is right when nothing was answered
      await put(entry); record(entry); await stats(); showNext();
      showExam(entry, nx);
    } else {
      await put(entry);
      show(entry);
    }
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function showExam(e, nx) {
    const cur = panel.querySelector("#tlCurrent"), after = examNext();
    cur.innerHTML = `<div class="tl-card">
      <strong>Scan ${e.n} (exam list ${nx.list}, ${nx.pos + 1} of ${nx.total})</strong>
      <div class="tl-pics"><div><img src="${e.frame}" alt=""><small>Camera view</small></div><div><img src="${e.crop}" alt=""><small>Close-up it read</small></div></div>
      ${numbers(e)}
      <span class="${e.correct ? "ok" : "bad"}">Expected ${esc(name(nx.key))}: ${e.correct ? (nx.key !== "none" ? "right" : e.type === "unsure" ? "right, not certain after its full clock" : e.frames ? `right, no answer (camera closed by hand after ${e.frames} frames - better to let it run its clock)` : "right, nothing was ever framed") : e.type === "answer" ? `wrong, it said ${esc(name(e.guess))}` : "no answer"} - saved</span>
      <div class="tl-row"><button class="btn btn-dark" id="tlNext" type="button">${after ? `Next: ${esc(nextLabel(after, true))}` : "List done"}</button><button class="btn btn-outline-dark" id="tlOther" type="button">I scanned something else</button></div></div>`;
    cur.querySelector("#tlNext").onclick = () => { window.scrollTo({ top: 0, behavior: "smooth" }); if (after) document.getElementById("camBtn").click(); };
    cur.querySelector("#tlOther").onclick = () => {   // the expected chocolate still needs scanning: step the list back, and label this scan by hand
      const x = getExam(); x.lists[nx.list - 1].pos = nx.pos; setExam(x); e.truth = null; e.correct = null; e.exam = null; e.examList = null;
      put(e).then(() => { unrecord(e); stats(); });   // 23 Nov: stored as unlabelled straight away, so a reload before the hand label cannot export the exam verdict
      showNext(); show(e);
    };
  }

  function numbers(e) {
    const t = a => (a || []).map(x => `${name(x.key)} ${x.p}%`).join(" · ");
    return `<table>
      <tr><td>Answer</td><td>${e.type === "answer" ? `<b>${esc(name(e.guess))}</b>` : e.type === "unsure" ? "No answer: not certain within 5 s, the likeliest three were offered" : "No answer (you closed the camera)"}</td></tr>
      <tr><td>Average over the hold</td><td>${t(e.avgTop3)}</td></tr>
      <tr><td>Last frame alone</td><td>${t(e.nowTop3)}</td></tr>
      <tr><td>Shell colour seen</td><td>${e.shell || "-"}</td></tr>
      <tr><td>Tilt sensor</td><td>${e.tiltPermission || "not recorded"}</td></tr>
      <tr><td>Mark seen</td><td>${{ one: "one digit", two: "two digits", z: "z" }[e.mark] || e.mark || "-"}</td></tr>
      <tr><td>Frames averaged</td><td>${e.frames ? `${e.frames} over ${((e.holdMs || 0) / 1000).toFixed(1)}s` : "none - nothing was framed"}</td></tr>
      <tr><td>Time to answer</td><td>${(e.ms / 1000).toFixed(1)}s${e.seenMs != null ? ` (${(e.seenMs / 1000).toFixed(1)}s after the chocolate was first seen)` : ""}</td></tr>
      <tr><td>Frames recorded</td><td>${(e.trace || []).length}</td></tr>
      <tr><td>Frames rejected</td><td>${(e.rejected || []).length ? (e.rejected || []).length + " (" + Object.entries((e.rejected || []).reduce((c, f) => (c[f.reason] = (c[f.reason] || 0) + 1, c), {})).map(([k, v]) => `${k} ${v}`).join(", ") + ")" : "0"}</td></tr></table>`;
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
        <button type="button" data-k="none" class="w">Nothing</button>
      </div></div>`;
    // "none" (13 Nov): a deliberate not-a-chocolate shot - the right outcome is no answer, any answer is wrong
    const done = async (truth) => {
      e.truth = truth; e.correct = truth === "none" ? e.type !== "answer" : e.type === "answer" && truth === e.guess; await put(e); record(e); await stats();
      cur.innerHTML = `<div class="tl-card"><span class="${e.correct ? "ok" : "bad"}">Scan ${e.n} saved: ${e.correct ? (truth === "none" ? "right, no answer for a nothing shot" : "right") : e.type === "answer" ? (truth === "none" ? `wrong, it said ${esc(name(e.guess))} but nothing was there` : `wrong, it was ${esc(name(truth))}`) : `no answer, it was ${esc(name(truth))}`}</span>
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
    const csv = ["scan,time,note,type,guess,truth,correct,avg1,avg1p,avg2,avg2p,shell,mark,frames,hold_s,time_s,version,models,model,exam_list,exam_pos"].concat(data.map(r =>
      [r.n, r.at, JSON.stringify(r.note || ""), r.type, r.guess || "", r.truth || "", r.correct, r.avgTop3?.[0]?.key, r.avgTop3?.[0]?.p, r.avgTop3?.[1]?.key, r.avgTop3?.[1]?.p, r.shell, r.mark, r.frames, ((r.holdMs || 0) / 1000).toFixed(1), (r.ms / 1000).toFixed(1), r.build?.version || "", r.build?.models || "", r.build?.model || "", r.examList ?? "", r.exam ?? ""].join(",")));
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
