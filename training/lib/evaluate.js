// The logic step and the chocoprint comparison, exactly as the phone does them.
const { IDS, SHELLS, MARKS, shellOf, markOf, mk } = require("./common.js");
// chocolate score × shell score × mark score, renormalised (sw/mw = how much the logic trusts shell/mark)
function combine(pid, psh, pmk, sw = 1, mw = 1) {
  const r = IDS.map((k, i) => pid[i] * psh[SHELLS.indexOf(shellOf(k))] ** sw * pmk[MARKS.indexOf(markOf(k))] ** mw);
  const s = r.reduce((a, b) => a + b, 0); return r.map(v => v / s);
}
const argmax = a => a.indexOf(Math.max(...a));
// chocoprint vs gallery: mean of the k closest references per mark → confidence per chocolate (Z variants share it)
// k defaults to 3 to match the live app (app/recognizer.js computePrint); override via TOPK env var for sweeps.
function printScores(vec, entries, T = 20, k = 3) {
  const per = {};
  entries.forEach(([m, v]) => { const s = v.reduce((acc, x, k) => acc + x * vec[k], 0); (per[m] = per[m] || []).push(s); });
  const ms = {}; for (const [m, ss] of Object.entries(per)) { const top = ss.sort((u, w) => w - u).slice(0, k); ms[m] = top.reduce((u, w) => u + w, 0) / top.length; }
  const mx = Math.max(...Object.values(ms)), ex = Object.fromEntries(Object.entries(ms).map(([m, s]) => [m, Math.exp(T * (s - mx))]));
  const z = Object.values(ex).reduce((u, w) => u + w, 0);
  return { byMark: ms, perChocolate: IDS.map(k => ex[mk(k)] / z) };
}
module.exports = { combine, argmax, printScores };
