#!/usr/bin/env python3
"""Score an exam sitting (training/exam-session-brief.md): one list per sitting, every chocolate 4 times then 8 Nothing shots.

Usage: python3 training/exam_report.py tests/test-14 [tests/test-15 ...]

A scan can be redone on the admin page: "I scanned something else" steps the list back and the redone scan is labelled by
hand. When that hand label is the very chocolate the list asked for, the redo was a RETAKE of the same position, not a
different chocolate, so the chocolate scans get two scores:
  as planned  - each list position counted once, by its FIRST attempt (a retaken position scores its first scan)
  every scan  - every labelled scan counted, retakes and all
Nothing shots are scored on their own line (right = no answer). Scans of a position dealt before a restart of the exam
are "warm-up" and count only under "every scan".
"""
import json, math, os, statistics, sys
from collections import Counter, OrderedDict

def wilson(k, n, z=1.96):
    if n == 0: return (0.0, 0.0)
    p = k / n; d = 1 + z * z / n; c = p + z * z / (2 * n); h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - h) / d, (c + h) / d)

def name(k): return "Nothing" if k == "none" else "?" if k is None else str(k) if str(k).startswith("z") else f"N°{k}"

def outcome(r):
    if r["truth"] == "none":
        if r["type"] == "answer": return "answered"
        if r["type"] == "unsure": return "held out"
        return "closed early" if r.get("frames") else "never framed"
    if r["type"] == "answer": return "right" if r["guess"] == r["truth"] else "wrong"
    return "not certain" if r["type"] == "unsure" else "no answer"

def mark(r):
    o = outcome(r)
    return {"right": "✓", "wrong": f"✗{name(r['guess'])}", "not certain": "?", "no answer": "–", "answered": f"✗{name(r['guess'])}", "held out": "✓?", "never framed": "✓–", "closed early": "✓–"}[o]

def sort_out(rows):
    """(positions, extras, warmup): positions maps (list, pos) -> {truth, attempts} in scan order, first attempt first;
    extras are hand-labelled scans of a DIFFERENT chocolate than the list asked for (or unlabelled ones)."""
    rows = sorted(rows, key=lambda r: r["n"])
    last = {}
    for r in rows:
        if r.get("examList"): last[(r["examList"], r["exam"])] = r["n"]
    positions, extras, warmup, pending = OrderedDict(), [], [], []
    for r in rows:
        if not r.get("examList"): pending.append(r); continue
        key = (r["examList"], r["exam"])
        if last[key] != r["n"]: warmup.append(r); continue      # the list was dealt again later: a warm-up scan
        positions[key] = {"truth": r["truth"], "attempts": [p for p in pending if p["truth"] == r["truth"]] + [r]}
        extras += [p for p in pending if p["truth"] != r["truth"]]; pending = []
    return positions, extras + pending, warmup

def choc_line(label, rows_):
    choc = [r for r in rows_ if r["truth"] not in (None, "none")]
    o = Counter(outcome(r) for r in choc); n = len(choc); ans = o["right"] + o["wrong"]
    lo, hi = wilson(o["wrong"], ans)
    print(f"  {label:<11}{n:>4} scans   answered {ans:>3} ({100 * ans / n if n else 0:3.0f}%)   right {o['right']:>3}   wrong {o['wrong']:>2}   not certain {o['not certain']:>3}   no answer {o['no answer']:>2}   wrong per 100 answers {100 * o['wrong'] / ans if ans else 0:4.1f} ({100 * lo:.1f}-{100 * hi:.1f})")
    return choc

def nothing_line(label, rows_):
    sh = [r for r in rows_ if r["truth"] == "none"]
    o = Counter(outcome(r) for r in sh); n = len(sh); lo, hi = wilson(o["answered"], n)
    print(f"  {label:<11}{n:>4} shots   answered (wrong) {o['answered']:>2}   held out {o['held out']:>2}   never framed {o['never framed']:>2}   closed early {o['closed early']:>2}   answered per 100 shots {100 * o['answered'] / n if n else 0:4.1f} ({100 * lo:.1f}-{100 * hi:.1f})")

def keyorder(k): return (1, k) if str(k).startswith("z") else (0, int(k)) if str(k).isdigit() else (2, str(k))

def report(folder):
    rows = json.load(open(os.path.join(folder, "test-log.json")))
    positions, extras, warmup = sort_out(rows)
    lists = sorted({k[0] for k in positions})
    builds = Counter(json.dumps(r.get("build")) for r in rows)
    print(f"== {folder}: exam list{'s' if len(lists) > 1 else ''} {', '.join(map(str, lists))} - {len(positions)} positions "
          f"({sum(1 for p in positions.values() if p['truth'] != 'none')} chocolate + {sum(1 for p in positions.values() if p['truth'] == 'none')} Nothing), "
          f"{len(rows)} scans in all; build {', '.join(builds)}")
    retaken = [(k, p) for k, p in positions.items() if len(p["attempts"]) > 1]
    print(f"   retaken positions {len(retaken)} ({sum(len(p['attempts']) - 1 for _, p in retaken)} extra scans), other chocolate than asked {len([e for e in extras if e['truth']])}, unlabelled {len([e for e in extras if not e['truth']])}, warm-up before a restart {len(warmup)}")
    planned = [p["attempts"][0] for p in positions.values()]
    every = [r for r in rows if r["truth"]]
    print("Chocolate scans:")
    choc_line("as planned", planned); choc_line("every scan", every)
    print("Nothing shots:")
    nothing_line("as planned", planned); nothing_line("every scan", every)
    wrong = Counter((r["truth"], r["guess"]) for r in every if outcome(r) in ("wrong", "answered"))
    print("Confusions (every scan): " + (", ".join(f"{name(t)} → {name(g)} ×{c}" if c > 1 else f"{name(t)} → {name(g)}" for (t, g), c in sorted(wrong.items(), key=lambda x: (keyorder(x[0][0]), str(x[0][1])))) or "none"))
    rt = sorted(r["ms"] for r in planned if outcome(r) == "right" and r.get("ms"))
    if rt: print(f"Time to a right answer (as planned, from camera start): median {statistics.median(rt) / 1000:.1f} s, nine in ten within {rt[min(len(rt) - 1, int(math.ceil(0.9 * len(rt))) - 1)] / 1000:.1f} s")
    if retaken:
        print("Retakes (first attempt first; the planned score keeps the first):")
        for (l, pos), p in retaken: print(f"   list {l} pos {pos:>3} {name(p['truth']):<8} " + ", ".join(f"scan {r['n']} {mark(r)}" for r in p["attempts"]))
    if extras or warmup:
        print("Outside the lists: " + "; ".join(f"scan {r['n']} {name(r['truth'])} {mark(r) if r['truth'] else 'unlabelled'}" for r in sorted(extras + warmup, key=lambda r: r["n"])))
    print("Per chocolate (as planned | every scan):")
    bykey = OrderedDict()
    for p in positions.values(): bykey.setdefault(p["truth"], []).append(p)
    for k in sorted(bykey, key=keyorder):
        ps = bykey[k]; allrows = sorted([r for r in every if r["truth"] == k], key=lambda r: r["n"])
        a = " ".join(mark(p["attempts"][0]) for p in ps); b = " ".join(mark(r) for r in allrows)
        print(f"   {name(k):<8} {a:<22} | {b}")
    print()
    return planned, every

if __name__ == "__main__":
    folders = sys.argv[1:] or ["tests/test-14"]
    P, E = [], []
    for f in folders:
        p, e = report(f); P += p; E += e
    if len(folders) > 1:
        print(f"== Pooled over {len(folders)} sittings")
        print("Chocolate scans:"); choc_line("as planned", P); choc_line("every scan", E)
        print("Nothing shots:"); nothing_line("as planned", P); nothing_line("every scan", E)
