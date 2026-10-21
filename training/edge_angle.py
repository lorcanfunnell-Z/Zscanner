# Classical alignment step 1: the chocolate is a square, so its edges give the rotation modulo 90 degrees.
# Average of exp(4i*phi) over image gradients (weighted by strength): the 4-fold symmetric direction.
import numpy as np
from scipy import ndimage as ndi
def edge_angle(gray):
    g = ndi.gaussian_filter(gray.astype(np.float32), 1.5)
    gx, gy = ndi.sobel(g, 1), ndi.sobel(g, 0)
    mag = np.hypot(gx, gy); phi = np.arctan2(gy, gx)
    h, w = gray.shape; yy, xx = np.mgrid[0:h, 0:w]
    win = np.exp(-(((xx - w / 2) ** 2 + (yy - h / 2) ** 2) / (2 * (0.35 * w) ** 2)))   # focus on the middle
    z = np.sum(mag * win * np.exp(4j * phi))
    return (np.degrees(np.angle(z)) / 4) % 90, abs(z) / (np.sum(mag * win) + 1e-6)
if __name__ == "__main__":
    import json, glob, sys
    from PIL import Image
    b = json.load(open('training-synth/boxes.json')); a = {}
    [a.update(json.load(open(f))) for f in glob.glob('training-synth/angles_*.json')]
    errs = []
    for k in list(a)[:300]:
        im = Image.open('training-synth/' + k).convert('L'); w = im.size[0]
        x0, y0, x1, y1 = [v * w for v in b[k]]; cx, cy = (x0 + x1) / 2, (y0 + y1) / 2; sd = max(x1 - x0, y1 - y0) * 1.35
        c = np.asarray(im.crop((int(cx - sd / 2), int(cy - sd / 2), int(cx + sd / 2), int(cy + sd / 2))).resize((224, 224)))
        est, conf = edge_angle(c)
        truth = (-a[k]) % 90       # image y axis points down, so the CCW angle shows as negative in image coords
        d = abs(est - truth); d = min(d, 90 - d); errs.append(d)
    errs = np.array(errs); print('mod-90 error: median %.1f°, within 10°: %d%%, within 20°: %d%%' % (np.median(errs), 100 * np.mean(errs <= 10), 100 * np.mean(errs <= 20)))
