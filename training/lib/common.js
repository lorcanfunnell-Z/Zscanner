// Shared basics for zScanner training and checking: settings, what we know about each chocolate, a repeatable random
// generator, and small picture helpers. Every script uses these, so a fix here applies everywhere.
const fs = require("fs"), path = require("path"), tf = require("@tensorflow/tfjs-node");
const ROOT = path.join(__dirname, "..", "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "training", "config.json")));
const S = CONFIG.inputSize;
const PAD = +(process.env.READER_PAD || CONFIG.readerPad);   // how much around the chocolate the reader sees
const ZOOM = +(process.env.ZOOM || CONFIG.printZoom);         // the chocoprint's zoom on the number
const at = p => path.join(ROOT, p);

// ---- what we know about each chocolate ----
const IDS = [...Array.from({ length: 25 }, (_, i) => String(i)), "zdark", "zmilk", "zwhite"];
const DARK = new Set(["1", "3", "5", "6", "8", "10", "13", "15", "17", "18", "19", "21", "23", "zdark"]);
const SHELLS = ["dark", "milk", "white", "milkwhite"], MARKS = ["one", "two", "z"];
const shellOf = k => k === "zwhite" ? "white" : k === "20" ? "milkwhite" : DARK.has(k) ? "dark" : "milk";
const markOf = k => k.startsWith("z") ? "z" : k.length === 2 ? "two" : "one";
const MKS = ["z", ...Array.from({ length: 25 }, (_, i) => String(i))];   // chocoprint marks: the three Z chocolates share one
const mk = cls => cls.startsWith("z") ? "z" : cls;

// ---- repeatable randomness (same seed → same training run) ----
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296), between = (a, b) => a + (b - a) * rnd();
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---- pictures ----
const toTensor = bufs => tf.tidy(() => tf.stack(bufs.map(b => tf.tensor3d(new Uint8Array(b), [S, S, 3]))).toFloat().div(127.5).sub(1));
// Shape only: black-and-white copy (used by the chocoprint so it can't take colour shortcuts)
function toGray(b) { const o = Buffer.alloc(b.length); for (let i = 0; i < b.length; i += 3) { const g = Math.round(0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2]); o[i] = o[i + 1] = o[i + 2] = g; } return o; }
// A dim, grainy room
function dimGrain(b, { dim, grain }) { const o = Buffer.alloc(b.length); for (let i = 0; i < b.length; i += 3) { const n = (rnd() + rnd() + rnd() - 1.5) * grain; for (let c = 0; c < 3; c++) o[i + c] = Math.max(0, Math.min(255, Math.round(b[i + c] * dim + n))); } return o; }

module.exports = { fs, path, tf, ROOT, CONFIG, S, PAD, ZOOM, at, IDS, DARK, SHELLS, MARKS, shellOf, markOf, MKS, mk, rnd, between, shuffle, toTensor, toGray, dimGrain };
