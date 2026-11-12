#!/usr/bin/env python3
"""Gate simulation, step 1: shrink every held-back close-up to mimic a chocolate further away.

Why: app/app.js refuses any frame whose finder box is under MIN_SIZE (0.13 of the view) with "Move a little closer".
Whether that number can safely drop depends on how the reader and chocoprint cope with fewer camera pixels. The saved
close-ups in tests/test-N/closeup/ are the reader's exact 224x224 input, so shrinking one to n pixels and enlarging it
back to 224 (box filter down, bilinear up - what the phone's canvas does when the crop is smaller than 224) is a faithful
stand-in for a crop that only had n camera pixels to begin with.

How n maps to the chocolate's share of the view (f): the reader's crop is 1.35 x the box, cut from the camera square of
Q pixels, so n = 1.35 * f * Q. Q is about 1080 on most iPhones (the app asks for 1920x1920 and gets 1920x1080); the admin
"Camera test" reports the real number for a given phone.
    f      0.13   0.11   0.09   0.08   0.06      (0.13 = today's gate)
    Q=1080  190    160    131    117     87  px
    Q=1440  253    214    175    156    117  px   (253 > 224: no loss at all)

Writes experiments/gate-sim/n<n>/<session>/closeup/<chocolate>/scanN.jpg (same layout as tests/, so eval_combo.js can
read them with SCAN_DIR=experiments/gate-sim/n<n>) plus experiments/gate-sim/sharpness.json: the app's own sharpness
measure (variance of the Laplacian on the 224 grey image, app/recognizer.js) for every file at every n, so we can see
where MIN_SHARP (45) would start refusing frames as "too blurry".

Usage: python3 training/gate_sim.py            (sessions from training/sessions.json heldBack; n = 224 190 160 131 117 87)
"""
import json, os, sys
import numpy as np
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "experiments", "gate-sim")
NS = [224, 190, 160, 131, 117, 87]
sessions = json.load(open(os.path.join(ROOT, "training", "sessions.json")))["heldBack"]

def laplacian_variance(im):   # same measure as app/recognizer.js sharpness(): grey = .299R+.587G+.114B, 3x3 Laplacian, valid, variance
    g = np.asarray(im.convert("RGB")).astype(np.float64) @ np.array([0.299, 0.587, 0.114])
    lap = -4 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
    return float(lap.var())

sharp = {}
count = 0
for s in sessions:
    base = os.path.join(ROOT, "tests", s, "closeup")
    if not os.path.isdir(base): print(f"{s}: no closeup folder, skipped"); continue
    for cls in sorted(os.listdir(base)):
        d = os.path.join(base, cls)
        if not os.path.isdir(d): continue
        for f in sorted(os.listdir(d)):
            if not f.lower().endswith(".jpg"): continue
            im = Image.open(os.path.join(d, f)).convert("RGB")
            if im.size != (224, 224): im = im.resize((224, 224), Image.BILINEAR)
            rel = f"{s}/closeup/{cls}/{f}"
            for n in NS:
                sim = im if n >= 224 else im.resize((n, n), Image.BOX).resize((224, 224), Image.BILINEAR)
                dst = os.path.join(OUT, f"n{n}", s, "closeup", cls, f)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                sim.save(dst, quality=95)
                sharp.setdefault(rel, {})[str(n)] = round(laplacian_variance(sim), 1)
            count += 1
json.dump(sharp, open(os.path.join(OUT, "sharpness.json"), "w"), indent=1)
print(f"{count} close-ups x {len(NS)} sizes written under {os.path.relpath(OUT, ROOT)}/")
for n in NS:
    v = [sharp[k][str(n)] for k in sharp]
    print(f"  n={n:3d}: sharpness median {np.median(v):6.1f}, under MIN_SHARP=45: {sum(1 for x in v if x < 45):3d}/{len(v)}")
