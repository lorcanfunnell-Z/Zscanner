// The three views the models see, matching the phone exactly:
//   readerCrop: the close-up around the chocolate (box × PAD), what the reader sees
//   finderCrop: the whole camera square, what the finder sees
//   zoomView:   the straightened, zoomed-in number, what the chocoprint sees (black and white by default)
const { PAD, ZOOM, between, rnd, toGray, dimGrain } = require("./common.js");
const { view, jitter } = require("./view.js");

function readerCrop(a, aug, pad = PAD) {
  const [x0, y0, x1, y1] = a.box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, side = Math.max(x1 - x0, y1 - y0);
  return aug ? [cx + between(-.12, .12) * side * pad / 1.35, cy + between(-.12, .12) * side * pad / 1.35, side * pad * between(.85, 1.18)] : [cx, cy, side * pad];
}
// Collect-mode photos are 85% of the camera square, so zoom out to ~1/0.85 and vary it
function finderCrop(a, aug) {
  const z = aug ? between(.75, 1.5) : 1 / 0.85;
  return [0.5 + (aug ? between(-.22, .22) : 0), 0.5 + (aug ? between(-.22, .22) : 0), z];
}
// a.rot = the turn (degrees clockwise) that stands the number upright (from the rotation cache or the design's angle)
function zoomView(a, aug, { gray = true, harsh = false, pad = PAD, zoom = ZOOM } = {}) {
  const [x0, y0, x1, y1] = a.box, side = Math.max(x1 - x0, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const z = side * pad * zoom * (aug ? between(.88, 1.15) : 1);
  const j = aug ? jitter(false) : {}; j.angle = (a.rot || 0) + (aug ? between(-10, 10) : 0);
  if (aug) { delete j.lowres; }
  const buf = view(a.file, cx + (aug ? between(-.07, .07) * side : 0), cy + (aug ? between(-.07, .07) * side : 0), z, j);
  const dark = aug && harsh && rnd() < .3 ? { dim: between(.3, .7), grain: between(4, 16) } : null;
  return (gray ? buf.then(toGray) : buf).then(b => dark ? dimGrain(b, dark) : b);
}
module.exports = { readerCrop, finderCrop, zoomView };
