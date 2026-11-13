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
    python3 training/scorecard.py risk                   risk-coverage report: for each logged signal, how many scans stay
                                                         answered and how many are wrong as its threshold tightens; then one
                                                         logistic model on all signals, scored leave-one-session-out; test-8
                                                         (torch) shown separately. Report only - no rule is changed
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

def replay(session, rule=tr.LIVE):
    """Per-scan outcomes for one session under a rule (default: the rule the phone really runs): list of (truth, said, at)."""
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
    print(f"zScanner scorecard - the live rule (E, no answer past the 5 s deadline), replayed from the saved traces of {', '.join(sessions)}")
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
RULE_NAMES = {"LIVE": tr.LIVE, "E": tr.E, "E+stop5": tr.LIVE, "E+forced5": {**tr.E, "deadline": 5000},   # E+stop5 = LIVE since 13 Nov; E+forced5 was live 3-13 Nov
              "E+A": {**tr.E, "scanmajority": 1}, "E+A2": {**tr.E, "printmajority": 1}, "E+B1": {**tr.E, "anglesteady": 30},
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

# ---------------------------------------------------------------- risk and coverage ----------------------------------------------------------------
import statistics
# (name, direction, description): direction "high" = a higher value should be safer, "low" = a lower value should be safer
SIGNALS = [("psim_med", "high", "median chocoprint similarity over the frames held"),
           ("psim_min", "high", "lowest chocoprint similarity over the frames held"),
           ("share_final", "high", "share of held frames whose own top guess was the final answer"),
           ("print_share", "high", "share of window frames where the chocoprint named the answer (what rule E's printShare checks)"),
           ("m4_share", "high", "share of window frames where the reader named the answer"),
           ("margin", "high", "top-1 minus top-2 of the window average at the moment of answering"),
           ("duration", "low", "ms from first seen to the answer"),
           ("frames", "low", "frames held before answering"),
           ("rejected", "low", "frames the quality gates threw away during the scan (not logged before 28 Oct: test-4/5 show 0)"),
           ("qsure_min", "high", "lowest 'which way up' confidence in the window"),
           ("size_med", "high", "median box size (share of the view)"),
           ("sharp_min", "high", "lowest sharpness in the window"),
           ("looks", "low", "extra finder passes (look-again, 12 Nov) - only in sessions scanned after it shipped"),
           ("size1", "high", "box size before the look-again - only in sessions scanned after it shipped")]
MODEL_EXCLUDE = {"rejected"}   # a session marker, not a signal: zero for every test-4/5 scan simply because it was not logged then

def scan_signals(f):
    """Per-scan signals for one answered scan, from trace_replay's detail='full' entry: what the phone had at the moment it answered."""
    seen, said = f["seen"], f["said"]; held, win = seen["held"], seen["win"]
    med = lambda xs: statistics.median(xs) if xs else None
    ps = [h["psim"] for h in held if h.get("psim") is not None]
    q = [h["qsure"] for h in win if h.get("qsure") is not None]
    lk = [h["looks"] for h in held if h.get("looks") is not None]; s1 = [h["size1"] for h in held if h.get("size1") is not None]
    return {"psim_med": med(ps), "psim_min": min(ps) if ps else None,
            "share_final": sum(1 for h in held if h["top"][0][0] == said) / len(held),
            "print_share": sum(1 for h in win if h.get("pmark") == tr.zm(said)) / len(win),
            "m4_share": sum(1 for h in win if tr.zm(h.get("m4top")) == tr.zm(said)) / len(win),
            "margin": seen["tp"] - seen["sp"], "duration": f["at"], "frames": len(held), "rejected": len(f["scan"].get("rejected") or []),
            "qsure_min": min(q) if q else None, "size_med": med([h["size"] for h in held]), "sharp_min": min(h["sharp"] for h in win),
            "looks": max(lk) if lk else None, "size1": med(s1) if s1 else None}

def answered_scans(sessions):
    """Every rule-E-answered scan of these sessions with its signals and whether it was wrong."""
    out = []
    for s in sessions:
        for f in tr.run(tr.LIVE, detail="full", L=tr.load(os.path.join(ROOT, "tests", s))):
            if f["said"]: out.append({"session": s, "id": f"{s}#{f['scan'].get('n', '?')}", "truth": f["truth"], "said": f["said"], "wrong": f["said"] != f["truth"], **scan_signals(f)})
    return out

def coverage_table(items, name, direction, attempted, steps=(1.0, .9, .8, .7, .6, .5, .4, .3)):
    """items: [(value, wrong)] for answered scans. Walk from the loosest cut (everyone answered) to tighter ones; at each
    cut report how many scans are still answered and how many of those are wrong. Ties are never split."""
    pts = sorted([(v, w) for v, w in items if v is not None], key=lambda t: (-t[0] if direction == "high" else t[0]))
    if not pts: print(f"  (no values logged)"); return None
    n = len(pts)
    # valid cut points: after the k-th scan only if the (k+1)-th has a different value
    cuts = [k for k in range(1, n + 1) if k == n or pts[k][0] != pts[k - 1][0]]
    cum = [0]
    for v, w in pts: cum.append(cum[-1] + w)
    sym = ">=" if direction == "high" else "<="
    num = lambda v: f"{int(v):11d}" if float(v).is_integer() else f"{v:11.3f}"
    print(f"  {'threshold':>14s} {'answered':>14s} {'wrong':>6s} {'wrong/100':>10s}")
    shown = set()
    for frac in steps:
        target = round(frac * n); ks = [k for k in cuts if k <= target]
        if not ks or ks[-1] in shown: continue
        k = ks[-1]; shown.add(k); v = pts[k - 1][0]
        print(f"  {sym} {num(v)} {k:5d} ({100 * k / attempted:3.0f}%) {cum[k]:6d} {100 * cum[k] / k:10.1f}")
    best2 = max((k for k in cuts if cum[k] / k <= 0.02), default=None); best0 = max((k for k in cuts if cum[k] == 0), default=None)
    note = (f"  at most 2 wrong/100: {sym} {num(pts[best2 - 1][0]).strip()} keeps {best2} answered ({100 * best2 / attempted:.0f}% of attempted), {cum[best2]} wrong"
            if best2 else "  no cut reaches 2 wrong per 100 answered")
    if best0: note += f"; zero wrong: {sym} {num(pts[best0 - 1][0]).strip()} keeps {best0} ({100 * best0 / attempted:.0f}%)"
    print(note)
    # the assumed direction may be wrong - say so if cutting the other way does better
    rev = sorted(pts, key=lambda t: (t[0] if direction == "high" else -t[0])); rcum = 0; rbest = None
    for k, (v, w) in enumerate(rev, 1):
        rcum += w
        if (k == n or rev[k][0] != v) and rcum / k <= 0.02: rbest = k
    if rbest and rbest > (best2 or 0):
        print(f"  note: the OPPOSITE direction works better on these scans ({'lower' if direction == 'high' else 'higher'} = safer): "
              f"{'<=' if direction == 'high' else '>='} {num(rev[rbest - 1][0]).strip()} keeps {rbest} ({100 * rbest / attempted:.0f}%) at 2 wrong/100 or better")
    return best2

# --- a small logistic model on all signals, pure Python: standardise, L2 penalty, gradient descent ---
def fit_logistic(X, y, l2=1.0, iters=4000, lr=0.3):
    n, d = len(X), len(X[0]); w = [0.0] * d; b = 0.0
    for _ in range(iters):
        gw = [0.0] * d; gb = 0.0
        for xi, yi in zip(X, y):
            z = b + sum(wj * xj for wj, xj in zip(w, xi)); p = 1 / (1 + math.exp(-max(-30, min(30, z)))); e = p - yi
            for j in range(d): gw[j] += e * xi[j]
            gb += e
        w = [wj - lr * (gj / n + l2 * wj / n) for wj, gj in zip(w, gw)]; b -= lr * gb / n
    return w, b

def standardiser(rows, names):
    mu = {k: statistics.mean(r[k] for r in rows) for k in names}
    sd = {k: (statistics.pstdev([r[k] for r in rows]) or 1.0) for k in names}
    return lambda r: [(r[k] - mu[k]) / sd[k] for k in names]

def risk_score(w, b, x):
    return 1 / (1 + math.exp(-max(-30, min(30, b + sum(wj * xj for wj, xj in zip(w, x))))))

def risk_report(sessions, extra=("test-8",)):
    attempted = {s: len(tr.load(os.path.join(ROOT, "tests", s))) for s in sessions + list(extra)}
    rows = answered_scans(sessions); n_att = sum(attempted[s] for s in sessions)
    nw = sum(r["wrong"] for r in rows)
    print(f"Risk and coverage - which logged signals predict a wrong answer?  the live rule on {', '.join(sessions)}: {n_att} scans attempted, {len(rows)} answered, {nw} wrong")
    print("Each table tightens one signal's threshold step by step: 'answered' = scans still answered (and % of all attempted), 'wrong' among them.")
    print("The goal line is 2 wrong per 100 answered. Signals are what the phone had at the moment it answered, taken from the saved trace.\n")
    present = [s for s in SIGNALS if any(r[s[0]] is not None for r in rows)]
    missing = [s[0] for s in SIGNALS if s not in present]
    for name, direction, desc in present:
        print(f"{name}  ({desc}; {'higher' if direction == 'high' else 'lower'} = safer)")
        coverage_table([(r[name], r["wrong"]) for r in rows], name, direction, n_att); print()
    if missing: print(f"not present in any saved session, so not tabulated: {', '.join(missing)}\n")
    # the known starting point: raw psim does not separate the tilted test-6 errors
    t6 = [r for r in rows if r["session"] == "test-6" and r["wrong"]]
    if t6:
        print("Starting point to reproduce - the test-6 wrong answers' chocoprint similarity (median over the scan):")
        print("  " + "  ".join(f"{r['truth']}→{r['said']} {r['psim_med']:.2f}" for r in t6))
        rights = sorted(r["psim_med"] for r in rows if not r["wrong"] and r["psim_med"] is not None)
        print(f"  right answers' psim_med: median {statistics.median(rights):.2f}, lowest quarter under {rights[len(rights) // 4]:.2f} - "
              f"the tilted errors sit among the most confident right answers, so no psim cut removes them cheaply\n")
    # the combined model
    feats = [s[0] for s in present if s[0] not in MODEL_EXCLUDE and all(r[s[0]] is not None for r in rows)]
    print(f"Combined: one logistic model on {len(feats)} signals ({', '.join(feats)}), L2-regularised, scored leave-one-session-out")
    print("  (each session is scored by a model that never saw it; the scores below are those out-of-sample risks)")
    oof = []
    for s in sessions:
        train = [r for r in rows if r["session"] != s]; test = [r for r in rows if r["session"] == s]
        if not test: continue
        std = standardiser(train, feats); w, b = fit_logistic([std(r) for r in train], [1.0 if r["wrong"] else 0.0 for r in train])
        for r in test: oof.append((risk_score(w, b, std(r)), r["wrong"], r))
    best = coverage_table([(p, w) for p, w, _ in oof], "risk", "low", n_att)
    ranked = sorted(oof, key=lambda t: -t[0])
    print("  the 11 riskiest scans by the model: " + "  ".join(f"{r['id']}({'WRONG' if w else 'right'} {p:.2f})" for p, w, r in ranked[:11]))
    std = standardiser(rows, feats); w, b = fit_logistic([std(r) for r in rows], [1.0 if r["wrong"] else 0.0 for r in rows])
    print("  weights on the standardised signals, full fit (positive = more risk): " + ", ".join(f"{k} {v:+.2f}" for k, v in sorted(zip(feats, w), key=lambda t: -abs(t[1]))))
    print()
    # the plain statement
    per_signal = {}
    for name, direction, desc in present:
        pts = [(r[name], r["wrong"]) for r in rows if r[name] is not None]
        pts.sort(key=lambda t: (-t[0] if direction == "high" else t[0])); cum = 0; bestk = None
        for k, (v, wr) in enumerate(pts, 1):
            cum += wr
            if (k == len(pts) or pts[k][0] != v) and cum / k <= 0.02: bestk = k
        per_signal[name] = bestk
    reach = {k: v for k, v in per_signal.items() if v}
    print("PLAIN STATEMENT")
    if reach:
        bestname = max(reach, key=reach.get)
        print(f"  Single signals that reach 2 or fewer wrong per 100 answered: " + ", ".join(f"{k} (keeping {v} of {n_att} attempted = {100 * v / n_att:.0f}%)" for k, v in sorted(reach.items(), key=lambda t: -t[1])))
        print(f"  The best of them, {bestname}, does it by answering only {100 * reach[bestname] / n_att:.0f}% of scans - and a cut chosen by looking at these same scans will look better here than on new ones.")
    else:
        print("  No single signal reaches 2 wrong per 100 answered at any threshold on these scans.")
    if best: print(f"  The combined model (out-of-sample) reaches 2 wrong per 100 by answering {best} of {n_att} attempted ({100 * best / n_att:.0f}%).")
    else: print("  The combined model (out-of-sample) does not reach 2 wrong per 100 answered at any answer rate.")
    print(f"  With only {nw} wrong answers in the pool, every one of these cuts rests on a handful of scans; treat them as leads to test on the exam session, not as rules.\n")
    # test-8 separately: the flash session, a different lighting condition
    for s in extra:
        if not os.path.exists(os.path.join(ROOT, "tests", s, "test-log.json")): continue
        r8 = answered_scans([s]); w8 = sum(r["wrong"] for r in r8)
        print(f"{s} (shown separately - torch on, a condition real clients never use): {attempted[s]} attempted, {len(r8)} answered, {w8} wrong")
        for name, direction, desc in present:
            if name in MODEL_EXCLUDE or not all(r[name] is not None for r in r8): continue
            pts = sorted([(r[name], r["wrong"]) for r in r8], key=lambda t: (-t[0] if direction == "high" else t[0]))
            print(f"  {name:12s} wrong answers' values: {', '.join((str(int(v)) if float(v).is_integer() else f'{v:.3f}') for v, wr in pts if wr) or '-'};  safest-to-riskiest rank of the wrong ones: "
                  + ", ".join(str(i + 1) for i, (v, wr) in enumerate(pts) if wr) + f" of {len(pts)}")
        sc8 = [(risk_score(w, b, std(r)), r["wrong"]) for r in r8 if all(r[k] is not None for k in feats)]
        if sc8:
            print(f"  combined model trained on {', '.join(sessions)}, applied to {s}:")
            coverage_table(sc8, "risk", "low", attempted[s])
        print()

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
    if argv[0] == "risk": risk_report(sessions); return
    print(f"unknown command {' '.join(argv)!r} - see the usage at the top of this file"); sys.exit(1)

if __name__ == "__main__":
    main(sys.argv[1:])
