#!/usr/bin/env python3
"""zScanner scorecard: honest numbers for the fair test. Python standard library only.

Every keep/reject decision so far rests on 85-112 held-back scans, where a difference of one to three scans is noise.
This tool puts ranges on the numbers, compares two result sets scan by scan, and looks at which logged signals
predict a wrong answer. It never changes a rule, a model or the gallery - it only reads the saved test sessions.

    python3 training/scorecard.py                        the scorecard: rule E replayed on every held-back session, with ranges
    python3 training/scorecard.py compare <before> <after>   scan-by-scan comparison of two result sets on the SAME scans:
                                                         flips, exact McNemar p-value, one-line verdict. Each side is either
                                                         a replay rule (E, E+A, E+A2, E+B1, E+B2, E+A+B2, E+deadline, or a
                                                         JSON rule like '{"or99":1,"printshare":0.9,"logic":"shell"}'),
                                                         or a DUMP file written by eval_combo.js via tools/fair_check.sh
                                                         (then --rule picks the answering rule: agree99 [default], agree,
                                                         agree95, combined80, combined95, m4, top1)
    python3 training/scorecard.py verdict <right-to-wrong> <wrong-to-right>   the verdict for raw flip counts
    python3 training/scorecard.py selftest               known cases: 14 vs 0 must be real, 8 vs 6 must be "can't tell"
    --sessions test-4,test-5                             use these sessions instead of training/sessions.json's held-back list

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
ALPHA = 0.05   # "real" means an exact McNemar p-value under this

# ---------------------------------------------------------------- statistics ----------------------------------------------------------------
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

def mcnemar_exact(b, c):
    """Exact (binomial) McNemar test on discordant counts b and c: two-sided p-value. Only the scans that CHANGED
    between the two result sets carry information; with b + c under 6 no result can be significant."""
    n = b + c
    if n == 0: return 1.0
    return min(1.0, 2 * binom_cdf(min(b, c), n, 0.5))

# ---------------------------------------------------------------- scorecard ----------------------------------------------------------------
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

# ---------------------------------------------------------------- compare ----------------------------------------------------------------
# A result set is a list of {"id", "truth", "said", "outcome"} with outcome in {"right", "wrong", "none"} (none = not answered).
RULE_NAMES = {"E": tr.E, "E+A": {**tr.E, "scanmajority": 1}, "E+A2": {**tr.E, "printmajority": 1}, "E+B1": {**tr.E, "anglesteady": 30},
              "E+B2": {**tr.E, "anglemain": 45}, "E+A+B2": {**tr.E, "scanmajority": 1, "anglemain": 45}, "E+deadline": {**tr.E, "deadline": 5000}}

def outcome(truth, said):
    return "none" if not said else ("right" if said == truth else "wrong")

def outcomes_from_rule(rule, sessions):
    out = []
    for s in sessions:
        rows = tr.load(os.path.join(ROOT, "tests", s))
        for i, (truth, said, at) in enumerate(tr.run(rule, detail=True, L=rows)):
            out.append({"id": f"{s}#{rows[i].get('n', i + 1)}", "truth": truth, "said": said, "outcome": outcome(truth, said)})
    return out

# the answering rules tools/fair_check.sh reports on a DUMP (same definitions as training/tradeoff.py), plus plain top-1
def _top(v, ids):
    o = sorted(range(len(v)), key=lambda i: -v[i]); return ids[o[0]], v[o[0]], v[o[0]] - v[o[1]]
def _zk(k): return "z" if k.startswith("z") else k
DUMP_RULES = {
    "m4": ("model 4 alone, 65% sure", lambda m, p, b, ids: _top(m, ids)[1] >= .65 and _top(m, ids)[2] >= .3, "m4"),
    "combined80": ("combined, 80% sure", lambda m, p, b, ids: _top(b, ids)[1] >= .8, "b"),
    "combined95": ("combined, 95% sure", lambda m, p, b, ids: _top(b, ids)[1] >= .95, "b"),
    "agree": ("D: both agree", lambda m, p, b, ids: _zk(_top(m, ids)[0]) == _zk(_top(p, ids)[0]), "b"),
    "agree99": ("D, or combined 99% sure", lambda m, p, b, ids: _zk(_top(m, ids)[0]) == _zk(_top(p, ids)[0]) or _top(b, ids)[1] >= .99, "b"),
    "agree95": ("D, or combined 95% sure", lambda m, p, b, ids: _zk(_top(m, ids)[0]) == _zk(_top(p, ids)[0]) or _top(b, ids)[1] >= .95, "b"),
    "top1": ("top-1 of reader x chocoprint (always answers)", lambda m, p, b, ids: True, "b"),
}

def outcomes_from_dump(path, rule_name):
    d = json.load(open(path)); ids, rows = d["ids"], d["rows"]
    name, rule, which = DUMP_RULES[rule_name]
    out = []
    for i, r in enumerate(rows):
        m, p = r["m4"], r["pp"]; prod = [a * c for a, c in zip(m, p)]; s = sum(prod) or 1; b = [v / s for v in prod]
        said = _top(m if which == "m4" else b, ids)[0] if rule(m, p, b, ids) else None
        out.append({"id": f"row{i}:{r['truth']}", "truth": r["truth"], "said": said, "outcome": outcome(r["truth"], said)})
    return out

def parse_result_set(arg, sessions, dump_rule):
    if os.path.isfile(arg):
        return f"{os.path.relpath(arg, ROOT)} [{DUMP_RULES[dump_rule][0]}]", outcomes_from_dump(arg, dump_rule)
    if arg in RULE_NAMES: return f"rule {arg}", outcomes_from_rule(RULE_NAMES[arg], sessions)
    try: rule = json.loads(arg)
    except Exception: sys.exit(f"'{arg}' is not a file, a known rule name ({', '.join(RULE_NAMES)}) or a JSON rule")
    return f"rule {arg}", outcomes_from_rule(rule, sessions)

def verdict_for(before, after):
    """The verdict and its supporting counts for two aligned outcome lists.
    Accuracy comes first (the project's own order): is the change making more or fewer WRONG answers? If that is not
    decidable, is it answering RIGHT more or less often? Otherwise the scans cannot tell."""
    b = [o["outcome"] for o in before]; a = [o["outcome"] for o in after]
    pairs = list(zip(b, a))
    cell = lambda x, y: sum(1 for p in pairs if p == (x, y))
    rw = cell("right", "wrong"); wr = cell("wrong", "right")
    nw = sum(1 for x, y in pairs if x != "wrong" and y == "wrong"); wn = sum(1 for x, y in pairs if x == "wrong" and y != "wrong")
    rn = sum(1 for x, y in pairs if x == "right" and y != "right"); nr = sum(1 for x, y in pairs if x != "right" and y == "right")
    an = sum(1 for x, y in pairs if x != "none" and y == "none"); na = sum(1 for x, y in pairs if x == "none" and y != "none")
    p_wrong, p_right, p_ans = mcnemar_exact(nw, wn), mcnemar_exact(rn, nr), mcnemar_exact(an, na)
    if p_wrong < ALPHA: v = ("real regression" if nw > wn else "real improvement") + f" (wrong answers {b.count('wrong')} -> {a.count('wrong')}, p = {p_wrong:.4f})"
    elif p_right < ALPHA: v = ("real improvement" if nr > rn else "real regression") + f" (answered right {b.count('right')} -> {a.count('right')}, wrong answers not significantly different, p = {p_right:.4f})"
    else: v = "can't tell from this many scans"
    return {"pairs": pairs, "rw": rw, "wr": wr, "nw": nw, "wn": wn, "rn": rn, "nr": nr, "an": an, "na": na,
            "p_wrong": p_wrong, "p_right": p_right, "p_ans": p_ans, "verdict": v, "cell": cell}

def compare(before_arg, after_arg, sessions, dump_rule):
    lb, before = parse_result_set(before_arg, sessions, dump_rule); la, after = parse_result_set(after_arg, sessions, dump_rule)
    if len(before) != len(after) or any(x["truth"] != y["truth"] for x, y in zip(before, after)):
        sys.exit(f"these are not the same scans: {len(before)} vs {len(after)} entries, or the chocolates differ - a paired comparison needs the same scans in the same order")
    r = verdict_for(before, after)
    print(f"compare: before = {lb}\n         after  = {la}\n         {len(before)} scans" + (f" from {', '.join(sessions)}" if not os.path.isfile(before_arg) else ""))
    print(f"\n{'before \\ after':16s}{'right':>7s}{'wrong':>7s}{'none':>7s}")
    for x in ("right", "wrong", "none"): print(f"{x:16s}" + "".join(f"{r['cell'](x, y):7d}" for y in ("right", "wrong", "none")))
    print(f"\nright->wrong flips: {r['rw']}    wrong->right flips: {r['wr']}")
    bo = [o["outcome"] for o in before]; ao = [o["outcome"] for o in after]
    print(f"wrong answers  {bo.count('wrong'):3d} -> {ao.count('wrong'):3d}   became wrong {r['nw']}, stopped being wrong {r['wn']}   exact McNemar p = {r['p_wrong']:.4f}")
    print(f"answered right {bo.count('right'):3d} -> {ao.count('right'):3d}   lost {r['rn']}, gained {r['nr']}                 exact McNemar p = {r['p_right']:.4f}")
    print(f"answered       {len(bo) - bo.count('none'):3d} -> {len(ao) - ao.count('none'):3d}   lost {r['an']}, gained {r['na']}                 exact McNemar p = {r['p_ans']:.4f}")
    changed = [(x["id"], x["outcome"], y["outcome"], x["truth"], x["said"], y["said"]) for x, y in zip(before, after) if x["outcome"] != y["outcome"]]
    if changed:
        print("\nscans that changed:")
        for id_, xo, yo, t, xs, ys in changed: print(f"  {id_:16s} {xo:5s} -> {yo:5s}   truth {t}, said {xs or '-'} -> {ys or '-'}")
    print(f"\nverdict: {r['verdict']}")
    if r["verdict"].startswith("can't"):
        print("  (a real difference needs at least 6 changed scans all going one way, or 8 vs 1, 10 vs 2, 12 vs 3 - "
              "the total number of scans does not help, only the ones that changed count)")

def verdict_cmd(rw, wr):
    """Verdict from raw flip counts: rw scans went right->wrong, wr went wrong->right, everything else unchanged."""
    before = [{"id": str(i), "truth": "x", "said": "x", "outcome": "right"} for i in range(rw)] + [{"id": str(i), "truth": "x", "said": "y", "outcome": "wrong"} for i in range(wr)]
    after = [{"id": str(i), "truth": "x", "said": "y", "outcome": "wrong"} for i in range(rw)] + [{"id": str(i), "truth": "x", "said": "x", "outcome": "right"} for i in range(wr)]
    r = verdict_for(before, after)
    print(f"{rw} right->wrong vs {wr} wrong->right: exact McNemar p = {r['p_wrong']:.4f} -> {r['verdict']}")
    return r["verdict"]

def selftest():
    cases = [((14, 0), "real regression"), ((0, 14), "real improvement"), ((8, 6), "can't tell"), ((6, 8), "can't tell"),
             ((6, 0), "real regression"), ((5, 0), "can't tell"), ((0, 0), "can't tell"), ((1, 8), "real improvement"), ((10, 2), "real regression"),
             ((9, 2), "can't tell"), ((1, 7), "can't tell")]   # the last two: p = 0.065 and 0.070 - close, but not under 0.05
    fails = 0
    for (rw, wr), want in cases:
        got = verdict_cmd(rw, wr)
        ok = got.startswith(want); fails += not ok
        print(f"  {'ok  ' if ok else 'FAIL'} expected '{want}'")
    # the p-values themselves, against hand calculation: 14 vs 0 -> 2 * 0.5^14; 8 vs 6 -> 2 * P(X <= 6 | 14, 0.5)
    checks = [(mcnemar_exact(14, 0), 2 * 0.5 ** 14), (mcnemar_exact(8, 6), 2 * sum(math.comb(14, i) for i in range(7)) / 2 ** 14), (mcnemar_exact(0, 0), 1.0)]
    for got, want in checks:
        ok = abs(got - want) < 1e-12; fails += not ok; print(f"  {'ok  ' if ok else 'FAIL'} p-value {got:.6f} (expected {want:.6f})")
    print("selftest: " + ("all passed" if not fails else f"{fails} FAILED")); return fails

def main(argv):
    sessions = held_sessions(); dump_rule = "agree99"
    if "--sessions" in argv:
        i = argv.index("--sessions"); sessions = argv[i + 1].split(","); argv = argv[:i] + argv[i + 2:]
    if "--rule" in argv:
        i = argv.index("--rule"); dump_rule = argv[i + 1]; argv = argv[:i] + argv[i + 2:]
        if dump_rule not in DUMP_RULES: sys.exit(f"--rule must be one of {', '.join(DUMP_RULES)}")
    if not argv: scorecard(sessions); return
    if argv[0] == "compare" and len(argv) == 3: compare(argv[1], argv[2], sessions, dump_rule); return
    if argv[0] == "verdict" and len(argv) == 3: verdict_cmd(int(argv[1]), int(argv[2])); return
    if argv[0] == "selftest": sys.exit(selftest())
    print(f"unknown command {' '.join(argv)!r} - see the usage at the top of this file"); sys.exit(1)

if __name__ == "__main__":
    main(sys.argv[1:])
