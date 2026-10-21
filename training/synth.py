# zScanner synthetic photo generator.
# Turns the official number designs (designs/mark_*.png) into pressed-relief chocolates and photographs them
# under many kinds of light, angle, distance and camera quality. Gives the reader thousands of examples of each
# number on each shell, so it learns the actual shape of the number rather than the lighting of one photo session.
#
# Usage: python3 training/synth.py [per_class=150] [seed=1]
# Writes training-synth/<class>/syn_<n>.jpg and training-synth/boxes.json (same format as training-photos/boxes.json)
import os, sys, json, math, io, random
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
from scipy import ndimage as ndi

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DES = os.path.join(ROOT, "designs")
OUT = os.path.join(ROOT, "training-synth")
PER = int(sys.argv[1]) if len(sys.argv) > 1 else 150
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 1
R = random.Random(SEED); np.random.seed(SEED)
u = R.uniform

IDS = [str(i) for i in range(25)] + ["zdark", "zmilk", "zwhite"]
DARK = {"1", "3", "5", "6", "8", "10", "13", "15", "17", "18", "19", "21", "23", "zdark"}
shell_of = lambda k: "white" if k == "zwhite" else "milkwhite" if k == "20" else "dark" if k in DARK else "milk"
SHELL_RGB = {  # rough colours as phone cameras see them; varied per image
    "dark": (58, 42, 40), "milk": (112, 78, 62), "white": (228, 214, 178), "milkwhite": (112, 78, 62)}

N = 320   # chocolate top face is rendered N x N pixels
_marks = {}
def mark(k):
    name = "z" if k.startswith("z") else k
    if name not in _marks:
        a = np.asarray(Image.open(os.path.join(DES, f"mark_{name}.png")).convert("L"), dtype=np.float32) / 255
        _marks[name] = 1 - a                                   # 1 = ink (raised strokes)
    return _marks[name]

def smooth_noise(n, scale, amp):
    s = max(2, int(n / scale))
    z = np.random.rand(s, s).astype(np.float32)
    return np.asarray(Image.fromarray((z * 255).astype(np.uint8)).resize((n, n), Image.BICUBIC), np.float32) / 255 * amp

def chocolate(k):
    """Render the top face of one chocolate (plus a strip of its front side) as RGBA, upright."""
    sh = shell_of(k)
    # ---- height map ----
    H = np.zeros((N, N), np.float32)
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32) / N
    bev = u(.10, .22)                                          # sloped back edge seen on the real chocolates
    H += np.clip((bev - yy) / bev, 0, 1) * u(.6, 1.4) * -8
    ins = u(.08, .14)                                          # recessed panel
    panel = ((xx > ins) & (xx < 1 - ins) & (yy > bev + .02) & (yy < 1 - ins)).astype(np.float32)
    H -= ndi.gaussian_filter(panel, N * .008) * u(.3, 1.2)
    # the mark
    m = mark(k)
    d = int(N * u(.40, .52))
    mm = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize((d, d), Image.LANCZOS), np.float32) / 255
    if R.random() < .5:
        mm = ndi.grey_dilation(mm, size=(2, 2)) if R.random() < .5 else ndi.grey_erosion(mm, size=(2, 2))
    cx = int(N * (.5 + u(-.04, .04))); cy = int(N * ((bev + 1) / 2 + u(-.03, .05)))
    x0, y0 = cx - d // 2, cy - d // 2
    M = np.zeros((N, N), np.float32); M[y0:y0 + d, x0:x0 + d] = mm[:N - y0, :N - x0][:N, :N]
    H += ndi.gaussian_filter(M, u(.8, 2.2)) * u(1.5, 3.5)
    H += smooth_noise(N, 40, u(0, .3)) + np.random.rand(N, N).astype(np.float32) * u(0, .05)
    # ---- lighting ----
    gy, gx = np.gradient(H)
    nz = np.ones_like(H); n = np.sqrt(gx * gx + gy * gy + nz * nz); nx, ny, nz = -gx / n, -gy / n, nz / n
    az, el = u(0, 2 * math.pi), u(.35, 1.35)                   # light direction (azimuth, elevation)
    L = np.array([math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)])
    lam = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
    hx, hy, hz = L[0], L[1], L[2] + 1; hn = math.sqrt(hx * hx + hy * hy + hz * hz)
    spec = np.clip((nx * hx + ny * hy + nz * hz) / hn, 0, 1) ** u(20, 80) * u(.2, 1.1)   # gloss
    amb = u(.35, .7)
    base = np.array(SHELL_RGB[sh], np.float32) * np.array([u(.94, 1.06), u(.95, 1.05), u(.93, 1.07)]) * u(.8, 1.2)
    shade = amb + (1 - amb) * lam / max(.2, L[2])
    img = base[None, None, :] * shade[..., None] + 255 * spec[..., None] * np.array([1, .98, .95])
    if R.random() < .5:                                        # a window/lamp reflection on the shiny top
        bx, by, br = u(0, 1), u(0, 1), u(.15, .5)
        blob = np.exp(-(((xx - bx) ** 2 + (yy - by) ** 2) / (br * br)))
        img += 255 * blob[..., None] * u(.05, .35)
    if sh == "white" or (k == "zwhite"):
        img += (np.random.rand(N, N, 1) - .5) * 4
    # ---- the front side strip (thickness depends on camera tilt) ----
    side = int(N * u(0, .22))
    out = np.zeros((N + side, N, 4), np.float32); out[:N, :, :3] = img; out[:, :, 3] = 255
    if side:
        sc = np.array(SHELL_RGB["white" if sh == "milkwhite" else sh], np.float32) * u(.5, .85)
        strip = np.repeat(np.repeat(sc[None, None, :], side, 0), N, 1)
        if sh == "milkwhite":                                  # N°20: milk on top, white below
            cut = int(side * u(.2, .5)); strip[:cut] = np.array(SHELL_RGB["milk"]) * u(.5, .85)
        out[N:, :, :3] = strip
    # rounded corners
    a = Image.new("L", (N, N + side), 0); ImageDraw.Draw(a).rounded_rectangle([0, 0, N - 1, N + side - 1], radius=int(N * u(.02, .08)), fill=255)
    out[:, :, 3] = np.asarray(a, np.float32)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")

def background(W):
    kind = R.random()
    if kind < .55: c = np.array([u(195, 250)] * 3) + np.array([u(-8, 8), u(-8, 8), u(-15, 5)])      # white paper / table
    elif kind < .75: g = u(100, 200); c = np.array([g, g * u(.8, .95), g * u(.6, .85)])                  # wood / card
    elif kind < .9: c = np.array([u(60, 160)] * 3)                                                    # grey
    else: c = np.array([u(10, 60)] * 3)                                                              # black box insert
    bg = np.ones((W, W, 3), np.float32) * c
    yy, xx = np.mgrid[0:W, 0:W].astype(np.float32) / W
    a = u(0, 2 * math.pi); bg *= (1 + (np.cos(a) * (xx - .5) + np.sin(a) * (yy - .5)) * u(0, .5))[..., None]
    bg += smooth_noise(W, 8, u(0, 18))[..., None] + np.random.rand(W, W, 1) * u(0, 6)
    return bg

def photo(k, W=448):
    bg = background(W)
    choc = chocolate(k)
    # perspective: squash one axis a little (camera not perfectly above), rotate any amount, size
    w, h = choc.size
    sx, sy = u(.85, 1), u(.8, 1)
    choc = choc.resize((int(w * sx), int(h * sy)), Image.LANCZOS)
    # slight keystone
    w, h = choc.size; kt, kb = max(0, u(-.08, .08)) * w, max(0, u(-.08, .08)) * w   # one edge nearer the camera
    choc = choc.transform((w, h), Image.QUAD, (kt, 0, kb, h, w - kb, h, w - kt, 0), Image.BICUBIC)
    choc = choc.rotate(u(-180, 180), Image.BICUBIC, expand=True)
    target = W * u(.42, .62)                                   # chocolate size in the photo
    bb = choc.getbbox(); choc = choc.crop(bb)
    f = target / max(choc.size); choc = choc.resize((max(8, int(choc.size[0] * f)), max(8, int(choc.size[1] * f))), Image.LANCZOS)
    cw, ch = choc.size
    px = int(W / 2 - cw / 2 + u(-.06, .06) * W); py = int(W / 2 - ch / 2 + u(-.06, .06) * W)
    canvas = Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8))
    # soft drop shadow
    alpha = choc.split()[3]
    sh = Image.new("L", (W, W), 0); off = (int(u(-.05, .05) * W), int(u(-.05, .05) * W))
    sh.paste(alpha, (px + off[0], py + off[1])); sh = sh.filter(ImageFilter.GaussianBlur(u(3, 14)))
    dark = Image.new("RGB", (W, W), (0, 0, 0)); canvas = Image.composite(dark, canvas, sh.point(lambda v: int(v * u(.15, .45))))
    canvas.paste(choc, (px, py), choc)
    a = np.asarray(canvas, np.float32)
    # hard shadow edge from a window frame / phone
    if R.random() < .3:
        yy, xx = np.mgrid[0:W, 0:W].astype(np.float32) / W; t = u(0, 2 * math.pi)
        m = (np.cos(t) * (xx - .5) + np.sin(t) * (yy - .5) > u(-.3, .3)).astype(np.float32)
        a *= 1 - ndi.gaussian_filter(m, u(1, 8))[..., None] * u(.25, .6)
    # exposure, white balance, gamma
    a *= u(.7, 1.3); a *= np.array([u(.95, 1.05), 1, u(.9, 1.06)])
    a = 255 * (np.clip(a, 0, 255) / 255) ** u(.8, 1.3)
    a += np.random.randn(W, W, 1) * u(0, 6)
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    r = R.random()
    if r < .25: img = img.filter(ImageFilter.GaussianBlur(u(.5, 2.0)))                          # slightly out of focus
    elif r < .35: s = int(W * u(.2, .45)); img = img.resize((s, s), Image.BILINEAR).resize((W, W), Image.BILINEAR)  # far away / low res
    elif r < .5: img = img.filter(ImageFilter.UnsharpMask(u(1, 3), int(u(50, 180)), 2))     # phone over-sharpening
    buf = io.BytesIO(); img.save(buf, "JPEG", quality=int(u(45, 92))); img = Image.open(io.BytesIO(buf.getvalue()))
    box = [(px) / W, (py) / W, (px + cw) / W, (py + ch) / W]
    return img, [round(v, 4) for v in box]

if __name__ == "__main__":
    boxes = {}
    for k in IDS:
        os.makedirs(os.path.join(OUT, k), exist_ok=True)
        for i in range(PER):
            img, box = photo(k)
            name = f"syn{SEED}_{i:04d}.jpg"; img.save(os.path.join(OUT, k, name), quality=95)
            boxes[f"{k}/{name}"] = box
        print(k, end=" ", flush=True)
    bp = os.path.join(OUT, "boxes.json")
    old = json.load(open(bp)) if os.path.exists(bp) else {}
    old.update(boxes); json.dump(old, open(bp, "w"))
    print(f"\n{len(boxes)} synthetic photos written")
