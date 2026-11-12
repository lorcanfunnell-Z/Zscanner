#!/usr/bin/env python3
"""zScanner scorecard: honest numbers for the fair test. Python standard library only.

Every keep/reject decision so far rests on 85-112 held-back scans, where a difference of one to three scans is noise.
This tool puts ranges on the numbers, compares two result sets scan by scan, and looks at which logged signals
predict a wrong answer. It never changes a rule, a model or the gallery - it only reads the saved test sessions.

    python3 training/scorecard.py                 the scorecard: rule E replayed on every held-back session, with ranges
    python3 training/scorecard.py --sessions test-4,test-5     ...on a chosen list of sessions

The rule-E replay is training/trace_replay.py's own run() - the same code tools/check.sh step 4 diffs against
training/baseline-ruleE.txt - imported, not copied, so the two can never drift apart.

Ranges are Wilson 95% intervals ("if we repeated this with new scans, the true rate would land in here 19 times out
of 20"). They are wide at this size on purpose: that is the point.
"""
import json, math, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "training"))
import trace_replay as tr

Z95 = 1.959964

def wilson(k, n, z=Z95):
    """95% interval for a proportion k/n (Wilson score). Returns (low, high) as fractions."""
    if n == 0: return (0.0, 1.0)
    p = k / n; d = 1 + z * z / n; c = p + z * z / (2 * n); h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (max(0.0, (c - h) / d), min(1.0, (c + h) / d))

def rule_of_three(p, conf=0.95):
    """How many answered scans with ZERO wrong are needed to claim 'at most p wrong' at this confidence (exact)."""
    return math.ceil(math.log(1 - conf) / math.log(1 - p))

def binom_cdf(k, n, p):
    """P(X <= k) for X ~ Binomial(n, p), exact."""
    return sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(0, k + 1))

def n_needed_with_wrong(k, p, conf=0.95):
    """Smallest n such that seeing k wrong in n answered scans still rejects 'the true rate is p or worse' at this
    confidence (one-sided exact binomial): P(X <= k | n, p) <= 1 - conf."""
    n = k + 1
    while binom_cdf(k, n, p) > 1 - conf: n += 1
    return n

def held_sessions():
    return json.load(open(os.path.join(ROOT, "training", "sessions.json")))["heldBack"]

def replay(session, rule=tr.E):
    """Per-scan outcomes for one session under a rule: list of (truth, said, at)."""
    return tr.run(rule, detail=True, L=tr.load(os.path.join(ROOT, "tests", session)))

def tally(outs):
    ans = [o for o in outs if o[1]]; wrong = [o for o in ans if o[1] != o[0]]
    return {"scans": len(outs), "answered": len(ans), "right": len(ans) - len(wrong), "wrong": len(wrong),
            "wrongs": [f"{t}→{s}" for t, s, _ in wrong]}

def fmt_range(lo, hi, per=100):
    return f"({lo * per:4.1f} - {hi * per:4.1f})"

def row(name, t):
    a, n, w = t["answered"], t["scans"], t["wrong"]
    wl, wh = wilson(w, a); al, ah = wilson(a, n)
    wp = f"{100 * w / a:5.1f}" if a else "    -"
    return (f"{name:22s} {n:5d} {a:5d} ({100 * a / n:3.0f}%) {t['right']:5d} {w:5d}   {wp} {fmt_range(wl, wh):16s}   "
            f"{100 * a / n:5.1f} {fmt_range(al, ah)}")

def scorecard(sessions):
    print(f"zScanner scorecard - rule E (the live decision rule), replayed from the saved traces of {', '.join(sessions)}")
    print("Ranges: Wilson 95% intervals. 'wrong' is per 100 ANSWERED scans; 'answer rate' is per 100 scans attempted.\n")
    hdr = f"{'session':22s} {'scans':>5s} {'answered':>11s} {'right':>5s} {'wrong':>5s}   {'wrong/100 ans (95% range)':28s}   {'answer rate % (95% range)'}"
    print(hdr); print("-" * len(hdr))
    per = {}
    for s in sessions:
        per[s] = tally(replay(s)); print(row(s, per[s]))
        if per[s]["wrongs"]: print(f"{'':22s} wrong: {' '.join(per[s]['wrongs'])}")
    def pool(names):
        return {"scans": sum(per[s]["scans"] for s in names), "answered": sum(per[s]["answered"] for s in names),
                "right": sum(per[s]["right"] for s in names), "wrong": sum(per[s]["wrong"] for s in names), "wrongs": []}
    print("-" * len(hdr))
    allp = pool(sessions); print(row("pooled, all", allp))
    if "test-6" in sessions and len(sessions) > 1:
        rest = [s for s in sessions if s != "test-6"]; print(row("pooled without test-6", pool(rest)))
        print(f"{'':22s} (test-6 deliberately included harder, angled shots - see CLAUDE.md; shown both ways, not dropped)")
    print()
    print("What it takes to CLAIM an error rate at 95% confidence (rule of three: zero wrong answers in n answered scans):")
    for p in (0.01, 0.02):
        n0 = rule_of_three(p)
        print(f"  at most {100 * p:.0f} wrong per 100 answers: {n0} answered scans with zero wrong"
              f"  (allowing 1 wrong: {n_needed_with_wrong(1, p)}; allowing 2 wrong: {n_needed_with_wrong(2, p)})")
    a, w = allp["answered"], allp["wrong"]
    wl, wh = wilson(w, a)
    print(f"\nWhere the current pool stands: {a} answered, {w} wrong - the best it can support is 'under {100 * wh:.0f} wrong per 100 answers'.")
    print(f"  It is not the number of scans that is short: a pool this size with ZERO wrong would already prove 'under {100 * wilson(0, a)[1]:.1f} per 100'.")
    if w:
        print(f"  Carrying its {w} wrong answers, the pool would have to grow to about {n_needed_with_wrong(w, 0.02)} answered scans"
              f" with no further mistakes to claim 2 per 100 (about {n_needed_with_wrong(w, 0.01)} for 1 per 100).")
    if "test-6" in sessions and len(sessions) > 1:
        r = pool([s for s in sessions if s != "test-6"]); rl, rh = wilson(r["wrong"], r["answered"])
        print(f"  Without test-6: {r['answered']} answered, {r['wrong']} wrong - supports 'under {100 * rh:.0f} per 100'.")
    print("  So the honest statement today is a range, not a number; the exam session (training/exam-session-brief.md) is what narrows it.")

def main(argv):
    sessions = held_sessions()
    if "--sessions" in argv:
        sessions = argv[argv.index("--sessions") + 1].split(","); argv = [a for a in argv if a != "--sessions" and a != ",".join(sessions)]
    if not argv:
        scorecard(sessions); return
    print(f"unknown command {argv[0]!r} - see the usage at the top of this file"); sys.exit(1)

if __name__ == "__main__":
    main(sys.argv[1:])
