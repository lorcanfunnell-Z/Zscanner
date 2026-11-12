#!/usr/bin/env python3
"""Gate simulation, step 2: one table across chocolate sizes, from the eval_combo.js dumps written for each shrunk set.

Usage: python3 training/gate_sim_report.py            (reads experiments/gate-sim/dump-n*.json and sharpness.json)

Columns, per set (n = camera pixels the reader's crop had; f = the chocolate's share of the view at Q=1080 / Q=1440):
  reader / print / both : single-photo top-1 accuracy of the reader alone, the chocoprint alone, and their product
  80% / agree / agree|99: the standing answering rules from training/tradeoff.py - answered and wrong, so a drop in
                          answers or a rise in wrong answers both show
  blurry                : how many of these crops the app would refuse before reading (sharpness < MIN_SHARP = 45)
Same single-photo method as the 3 Nov synthetic stress test and the three-signal trial; the live phone averages several
frames (rule E), so these are "best single glance" numbers - compare each row with the n=224 control, not with the live
answer rate.
"""
import glob, json, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, "experiments", "gate-sim")
MIN_SHARP = 45
def zk(k): return "z" if k.startswith("z") else k
def top(v, ids):
    o = sorted(range(len(v)), key=lambda i: -v[i]); return ids[o[0]], v[o[0]]
sharp = json.load(open(os.path.join(D, "sharpness.json")))
dumps = sorted(glob.glob(os.path.join(D, "dump-n*.json")), key=lambda p: -int(re.search(r"n(\d+)", p).group(1)))
print(f"{'n px':>5s} {'f@1080':>7s} {'f@1440':>7s} {'scans':>5s} | {'reader':>7s} {'print':>7s} {'both':>7s} | {'80%: ans/wrong':>15s} {'agree: ans/wrong':>17s} {'agree|99: ans/wrong':>20s} | {'blurry':>6s}")
for p in dumps:
    n = int(re.search(r"n(\d+)", p).group(1)); d = json.load(open(p)); ids, rows = d["ids"], d["rows"]
    rr = pr = br = 0; rules = {"80": [0, 0], "agree": [0, 0], "agree99": [0, 0]}
    for r in rows:
        m, pp, t = r["m4"], r["pp"], r["truth"]
        prod = [a * c for a, c in zip(m, pp)]; s = sum(prod) or 1; b = [v / s for v in prod]
        tm, tp, tb = top(m, ids), top(pp, ids), top(b, ids)
        rr += tm[0] == t; pr += tp[0] == t; br += tb[0] == t
        for name, ok in (("80", tb[1] >= .8), ("agree", zk(tm[0]) == zk(tp[0])), ("agree99", zk(tm[0]) == zk(tp[0]) or tb[1] >= .99)):
            if ok: rules[name][0] += 1; rules[name][1] += tb[0] != t
    N = len(rows)
    blurry = sum(1 for k in sharp if sharp[k].get(str(n), 99) < MIN_SHARP)
    f1, f2 = n / (1.35 * 1080), n / (1.35 * 1440)
    pct = lambda x: f"{100 * x / N:5.1f}%"
    print(f"{n:5d} {f1:7.3f} {f2:7.3f} {N:5d} | {pct(rr):>7s} {pct(pr):>7s} {pct(br):>7s} | {rules['80'][0]:3d}/{rules['80'][1]:<3d}{'':>8s} {rules['agree'][0]:3d}/{rules['agree'][1]:<3d}{'':>10s} {rules['agree99'][0]:3d}/{rules['agree99'][1]:<3d}{'':>13s} | {blurry:3d}/{len(sharp)}")
