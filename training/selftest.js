// Quick self-test of the shared pieces (seconds, no training): run by tools/check.sh. Exits with an error if anything is off.
const { fs, path, ROOT, IDS, shellOf, markOf, mk, CONFIG, at } = require("./lib/common.js");
const { combine, printScores } = require("./lib/evaluate.js");
const { edgeAngle } = require("./align_lib.js");
const { sessions } = require("./lib/data.js");
let fails = 0; const ok = (cond, what) => { console.log(`${cond ? "  ok  " : "  FAIL"}  ${what}`); if (!cond) fails++; };

// what we know about the chocolates
ok(shellOf("20") === "milkwhite" && shellOf("zwhite") === "white" && shellOf("18") === "dark" && shellOf("16") === "milk", "shell colours (20 milk+white, Z white, 18 dark, 16 milk)");
ok(markOf("7") === "one" && markOf("12") === "two" && markOf("zdark") === "z", "marks (one digit / two digits / Z)");
ok(IDS.length === 28 && mk("zmilk") === "z", "28 chocolates; the Z chocolates share one chocoprint mark");
// the logic step: a two-digit dark reading must rule out one-digit and milk chocolates
const flat = IDS.map(() => 1 / 28), c = combine(flat, [1, 0, 0, 0], [0, 1, 0]);
ok(Math.abs(c.reduce((a, b) => a + b, 0) - 1) < 1e-9, "logic step adds up to 100%");
ok(c[IDS.indexOf("7")] === 0 && c[IDS.indexOf("16")] === 0 && c[IDS.indexOf("18")] > 0, "logic step: 'dark + two digits' rules out N°7 and N°16, keeps N°18");
// straightening maths on a drawn square turned by a known angle
const S = 224, img = new Uint8Array(S * S * 3).fill(230), ang = 20 * Math.PI / 180;
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const dx = x - 112, dy = y - 112, u = dx * Math.cos(ang) + dy * Math.sin(ang), v = -dx * Math.sin(ang) + dy * Math.cos(ang); if (Math.abs(u) < 60 && Math.abs(v) < 60) img.fill(60, 3 * (y * S + x), 3 * (y * S + x) + 3); }
const e = edgeAngle(img, S).angle; ok(Math.abs(Math.abs(e) - 20) < 3, `straightening maths finds a 20° turn (found ${e.toFixed(1)}°)`);
// gallery comparison: a print identical to a reference must pick that reference's chocolate
const v = Array.from({ length: 128 }, (_, i) => Math.sin(i)), n = Math.hypot(...v), u = v.map(x => x / n), w = v.map((x, i) => (i % 2 ? -x : x) / n);
const ps = printScores(u, [["18", u], ["19", w]]); ok(ps.perChocolate[IDS.indexOf("18")] > 0.99, "gallery comparison picks the matching reference");
// fair-testing safeguard and files the phone needs
const se = sessions(); ok(Array.isArray(se.heldBack) && se.heldBack.length >= 1 && !se.heldBack.some(s => se.inGallery.includes(s)), `at least one test session held back and not in the gallery (${se.heldBack.join(", ")})`);
for (const m of ["model4", "model6"]) { const meta = path.join(ROOT, "app", m, "meta.json"); ok(fs.existsSync(meta), `app/${m}/meta.json exists`); }
const gal = JSON.parse(fs.readFileSync(path.join(ROOT, "app/model6/gallery.json")));
ok(gal.entries.length > 0 && gal.entries.every(([m, vv]) => vv.length === 128), `model 6 gallery: ${gal.entries.length} references, all 128 numbers`);
for (const d of ["finder", "reader", "quarter", "print"]) ok(fs.existsSync(path.join(ROOT, "app/model6", d, "model.json")), `app/model6/${d} present`);
console.log(fails ? `\n${fails} check(s) FAILED` : "\nall self-tests passed"); process.exit(fails ? 1 : 0);
