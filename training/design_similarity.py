# Objective, model-free check of how much the official number designs (designs/mark_*.png) overlap each other -
# independent of any trained model or test session. Useful for explaining a real confusion once a test or the
# synthetic stress test (training/eval_synth.js) flags one, and for spotting the next one before it shows up live.
#
# Usage: python3 training/design_similarity.py
import os, itertools
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DES = os.path.join(ROOT, "designs")
IDS = [str(i) for i in range(25)] + ["z"]   # the three Z chocolates share one design (mark_z.png)
TWO_DIGIT = [k for k in IDS if len(k) == 2]
SIZE = 160          # common canvas for comparison
THRESHOLD = 0.78    # "similar enough to be a real lookalike risk" - picked from the 3 Nov N13 finding, not a hard law

def load(k):
    img = Image.open(os.path.join(DES, f"mark_{k}.png")).convert("L").resize((SIZE, SIZE), Image.BILINEAR)
    a = np.asarray(img, dtype=np.float32) / 255
    return (1 - a) > 0.5   # black strokes = ink, matching training/synth.py's convention

def iou(a, b):
    inter = (a & b).sum(); union = (a | b).sum()
    return inter / union if union else 0

if __name__ == "__main__":
    marks = {k: load(k) for k in IDS}
    sims = {(a, b): iou(marks[a], marks[b]) for a, b in itertools.permutations(IDS, 2)}

    print("Top 25 most similar design pairs (intersection-over-union of the ink pixels, same canvas position/scale):")
    pairs = sorted({(a, b): v for (a, b), v in sims.items() if a < b}.items(), key=lambda x: -x[1])
    for (a, b), v in pairs[:25]: print(f"  {a:>3} <-> {b:<3} IoU={v:.3f}")

    print(f"\nHow many other designs each two-digit number overlaps above {THRESHOLD} (higher = less distinctive):")
    counts = sorted(((sum(1 for j in IDS if j != k and sims[(k, j)] > THRESHOLD), k) for k in TWO_DIGIT), reverse=True)
    for n, k in counts: print(f"  {k:>3}: {n} neighbours above {THRESHOLD}")

    print("\nAverage overlap against every other two-digit number (higher = more generic-looking among its peers):")
    avgs = sorted(((sum(sims[(k, j)] for j in TWO_DIGIT if j != k) / (len(TWO_DIGIT) - 1), k) for k in TWO_DIGIT), reverse=True)
    for avg, k in avgs: print(f"  {k:>3}: avg IoU {avg:.3f}")
