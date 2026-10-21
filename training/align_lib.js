// Stage 2 alignment maths, shared by training (the same code is copied into app/recognizer.js).
// The chocolate is square, so its strong edges cluster at one direction modulo 90 degrees.
// edgeAngle returns the angle (degrees, -45..45) to rotate the picture COUNTER-CLOCKWISE by to square the
// chocolate up, plus a 0..1 confidence. rgb = Uint8 array of S*S*3.
function edgeAngle(rgb, S) {
  const g = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) g[i] = 0.299 * rgb[3 * i] + 0.587 * rgb[3 * i + 1] + 0.114 * rgb[3 * i + 2];
  const b = new Float32Array(S * S), c = new Float32Array(S * S);           // two 3x3 box blurs ~ a small gaussian
  for (const [src, dst] of [[g, b], [b, c]]) for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
    let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += src[(y + dy) * S + x + dx]; dst[y * S + x] = s / 9;
  }
  let re = 0, im = 0, tot = 0; const sig = 0.35 * S, c0 = S / 2;
  for (let y = 2; y < S - 2; y++) for (let x = 2; x < S - 2; x++) {
    const i = y * S + x;
    const gx = (c[i - S + 1] + 2 * c[i + 1] + c[i + S + 1]) - (c[i - S - 1] + 2 * c[i - 1] + c[i + S - 1]);
    const gy = (c[i + S - 1] + 2 * c[i + S] + c[i + S + 1]) - (c[i - S - 1] + 2 * c[i - S] + c[i - S + 1]);
    const m = Math.hypot(gx, gy); if (m < 1e-3) continue;
    const w = m * Math.exp(-((x - c0) ** 2 + (y - c0) ** 2) / (2 * sig * sig));
    const phi = Math.atan2(gy, gx); re += w * Math.cos(4 * phi); im += w * Math.sin(4 * phi); tot += w;
  }
  return { angle: (Math.atan2(im, re) * 180 / Math.PI) / 4, conf: Math.hypot(re, im) / (tot || 1) };
}
if (typeof module !== "undefined") module.exports = { edgeAngle };
