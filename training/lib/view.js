// Making training/check pictures from photos: crop around the chocolate, turn, and (for training) vary the light.
const { S, rnd, between } = require("./common.js");
const sharp = require("sharp");

// Crop a square region (centre cx,cy and side, in fractions of the photo; may go past the edge, which is mirrored),
// rotate it, adjust light, and return 224x224 RGB bytes.
async function view(file, cx, cy, side, { angle = 0, light = 1, sat = 1, hue = 0, blur = 0, jpeg = 0, ...fx } = {}) {
  const meta = await sharp(file).metadata(), W = meta.width, H = meta.height, pad = Math.round(Math.max(W, H) * 0.8);
  const grow = angle || fx.tilt ? 1.42 : 1;                       // take a bigger square first so rotating leaves no empty corners
  const ps = Math.max(8, Math.round(side * W * grow));
  const big = await sharp(file).extend({ top: pad, bottom: pad, left: pad, right: pad, extendWith: "mirror" }).raw().toBuffer({ resolveWithObject: true });
  let px = Math.round(cx * W - ps / 2) + pad, py = Math.round(cy * H - ps / 2) + pad;
  px = Math.max(0, Math.min(px, big.info.width - ps)); py = Math.max(0, Math.min(py, big.info.height - ps));
  const R = Math.round(S * grow);
  let out = await sharp(big.data, { raw: big.info }).extract({ left: px, top: py, width: ps, height: ps }).resize(R, R).raw().toBuffer({ resolveWithObject: true });
  if (fx.tilt) {                                        // camera tilted: the chocolate looks squashed along one direction
    const t = await sharp(out.data, { raw: out.info }).affine(fx.tilt, { background: "#808080" }).raw().toBuffer({ resolveWithObject: true });
    out = await sharp(t.data, { raw: t.info }).extract({ left: Math.floor((t.info.width - R) / 2), top: Math.floor((t.info.height - R) / 2), width: R, height: R }).raw().toBuffer({ resolveWithObject: true });
  }
  if (angle) {
    const rot = await sharp(out.data, { raw: out.info }).rotate(angle, { background: "#808080" }).raw().toBuffer({ resolveWithObject: true });
    out = await sharp(rot.data, { raw: rot.info }).extract({ left: Math.floor((rot.info.width - S) / 2), top: Math.floor((rot.info.height - S) / 2), width: S, height: S }).raw().toBuffer({ resolveWithObject: true });
  }
  let img = sharp(out.data, { raw: out.info }).modulate({ brightness: light, saturation: sat, hue: Math.round(hue) });
  if (fx.gamma) img = img.gamma(fx.gamma);                                    // harsh vs flat light
  if (fx.contrast) img = img.linear(fx.contrast, 128 * (1 - fx.contrast));
  if (fx.shadow || fx.glare) {                                                 // hard shadow edge across the chocolate / sun reflection
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">` +
      (fx.shadow ? `<polygon points="${fx.shadow.map(p => p.join(",")).join(" ")}" fill="black" fill-opacity="${fx.shadowAlpha}"/>` : "") +
      (fx.glare ? `<defs><radialGradient id="g"><stop offset="0" stop-color="white" stop-opacity="${fx.glare[3]}"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient></defs><circle cx="${fx.glare[0]}" cy="${fx.glare[1]}" r="${fx.glare[2]}" fill="url(#g)"/>` : "") + `</svg>`;
    const flat = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const done = await sharp(flat.data, { raw: flat.info }).composite([{ input: Buffer.from(svg), blend: "over" }]).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    img = sharp(done.data, { raw: done.info });
  }
  if (fx.lowres) { const small = await img.resize(fx.lowres, fx.lowres).png().toBuffer(); img = sharp(small).resize(S, S); }
  if (fx.sharpen) img = img.sharpen({ sigma: fx.sharpen });
  if (blur > 0.3) img = img.blur(blur);
  if (jpeg) { const j = await img.jpeg({ quality: jpeg }).toBuffer(); img = sharp(j); }
  return img.removeAlpha().resize(S, S).raw().toBuffer();
}
// Random variations used in training: any rotation, light, colour, blur, compression, shadows, glare, low resolution
const jitter = hard => {
  const j = { angle: between(-180, 180), light: between(.55, 1.45), sat: between(.8, 1.2), hue: between(-6, 6), blur: rnd() < .3 ? between(.3, 1.4) : 0, jpeg: rnd() < .4 ? Math.round(between(40, 85)) : 0 };
  if (rnd() < .5) j.gamma = between(1.0, 2.2);                 // sharp's gamma: >1 = harsher, more contrasty light
  if (rnd() < .5) j.contrast = between(.75, 1.6);
  if (rnd() < .4) { const a = between(0, Math.PI * 2), c = [S / 2 + Math.cos(a) * between(-60, 60), S / 2 + Math.sin(a) * between(-60, 60)], d = [Math.cos(a + Math.PI / 2) * 400, Math.sin(a + Math.PI / 2) * 400], o = [Math.cos(a) * 400, Math.sin(a) * 400];
    j.shadow = [[c[0] - d[0], c[1] - d[1]], [c[0] + d[0], c[1] + d[1]], [c[0] + d[0] + o[0], c[1] + d[1] + o[1]], [c[0] - d[0] + o[0], c[1] - d[1] + o[1]]]; j.shadowAlpha = between(.25, .6); }
  if (rnd() < .3) j.glare = [between(40, 184), between(40, 184), between(25, 80), between(.25, .7)];
  if (rnd() < .3) j.lowres = Math.round(between(60, 140));    // a small, far-away chocolate
  else if (rnd() < .5) j.sharpen = between(.8, 2.2);          // the very sharp live camera close-ups
  return j;
};

// A camera tilt of up to ~45°: squash along a random direction by c (0.7-1), done as a stretch of the other direction
// by 1/c so nothing shrinks (the crop is then cut back to size). Returns sharp's 2x2 affine matrix.
function tiltMatrix() {
  const f = between(0, Math.PI), c = between(.7, 1), k = 1 / c, co = Math.cos(f), si = Math.sin(f);
  // R(f) · diag(1, k) · R(-f)
  return [co * co + k * si * si, co * si * (1 - k), co * si * (1 - k), si * si + k * co * co];
}
module.exports = { view, jitter, tiltMatrix };
