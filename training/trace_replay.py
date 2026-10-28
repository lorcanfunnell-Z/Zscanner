# Replays the phone's frame-by-frame traces from a test log (admin test log, model 6+) under different answering rules.
# Usage: python3 training/trace_replay.py tests/test-4
# Each trace holds only the frames the phone read before it answered, so a stricter rule that hasn't answered by the
# end of a trace is shown as "kept going" (the phone would have kept scanning; we can't know what it would have said).
# NOTE: rules chosen by looking at a session must be confirmed on a NEW session before they count as proven.
import json, sys
from collections import Counter
L = [r for r in json.load(open(sys.argv[1] + "/test-log.json")) if r.get("truth") and r.get("trace")]
META = json.load(open("app/model6/meta.json"))
zm = lambda k: "z" if k and k.startswith("z") else k

def jsvote(keys):
    c = {}
    for k in keys:
        if k: c[k] = c.get(k, 0) + 1
    order = sorted((k for k in c if k.isdigit()), key=int) + [k for k in c if not k.isdigit()]
    return sorted(order, key=lambda k: -c[k])[0] if order else None

def adiff(a, b):                                        # smallest gap between two angles, in degrees
    d = abs((a - b) % 360); return min(d, 360 - d)

def run(rule, K=3, detail=False):
    out = []
    for r in L:
        held, said, at = [], None, None
        for f in r["trace"]:
            held.append(f); win = [h for i, h in enumerate(held) if f["t"] - h["t"] <= 600 or i >= len(held) - 3]   # as the phone: last 0.6 s, always at least 3 frames
            if f["t"] - held[0]["t"] < 400: continue
            if len(win) < 3: continue
            avg = Counter()
            for h in win:
                for k, p in h["top"]: avg[k] += p / len(win)
            (top, tp), *rest = avg.most_common(2) + [("", 0)]
            sp = rest[0][1]
            vote = lambda key: jsvote([h.get(key) for h in win])
            agree = zm(vote("m4top")) == zm(top) and vote("pmark") == zm(top)
            ok = agree or (rule.get("or99") and tp >= .99)
            if rule.get("stable"):                              # each of the last K frames, on its own, names the same chocolate
                ok = ok and all(h["top"][0][0] == top for h in held[-K:])
            if rule.get("printshare"):                          # the chocoprint named it in at least this share of frames
                ok = ok and sum(1 for h in win if h.get("pmark") == zm(top)) / len(win) >= rule["printshare"]
            if rule.get("scanmajority"):                        # idea A: don't answer against what most of the whole scan said
                ok = ok and zm(jsvote([h["top"][0][0] for h in held])) == zm(top)
            if rule.get("printmajority"):                       # idea A2: same, using the chocoprint's per-frame answer
                ok = ok and jsvote([h.get("pmark") for h in held]) == zm(top)
            if rule.get("anglesteady"):                         # idea B1: the held frames' side-up angles agree with each other
                rs = [h["rot"] for h in win if h.get("rot") is not None]
                ok = ok and all(adiff(a, b) <= rule["anglesteady"] for a in rs for b in rs)
            if rule.get("anglemain"):                           # idea B2: the held frames match the angle the scan mostly had
                rs = [h["rot"] for h in held if h.get("rot") is not None]
                if rs:
                    main = jsvote([str(int(((a + 22.5) % 360) // 45)) for a in rs])
                    ok = ok and all(adiff(h["rot"], int(main) * 45) <= rule["anglemain"] for h in win if h.get("rot") is not None)
            if rule.get("logic", "full") != "none":            # the phone's logic check: shell (and mark) votes must fit
                # N°20's milk+white shell is read unreliably (28 Oct fix) - the phone skips the shell-match
                # requirement just for it, so this replay has to do the same to actually match app.js
                shell_ok = META["shellOf"].get(top) == "milkwhite" or vote("shell") == META["shellOf"].get(top)
                ok = ok and shell_ok
                if rule.get("logic", "full") == "full": ok = ok and vote("mark") == META["markOf"].get(top)
            if ok and tp >= .5 and tp - sp >= .2: said = top; at = f["t"] - held[0]["t"]; break
        out.append((r["truth"], said, at if said else None))
    if detail: return out
    ans = [o for o in out if o[1]]; wrong = [o for o in ans if o[1] != o[0]]
    ts = sorted(o[2] for o in ans); med = ts[len(ts) // 2] / 1000 if ts else 0
    slow = " ".join(f"{o[0]}:{o[2]/1000:.1f}s" for o in ans if o[2] > 3000)
    return f"answered {len(ans)}/{len(out)}, wrong {len(wrong)} {' '.join(t + '→' + s for t, s, _ in wrong)} | typical {med:.1f}s after first seen | slow: {slow}"

if len(sys.argv) > 2 and sys.argv[2] == "new":
    E = {"or99": 1, "printshare": .8, "logic": "shell"}
    for name, rule in [("E + A (current production rule: model6 meta.json)", {**E, "scanmajority": 1}),
                       ("E (current admin rule)", E),
                       ("E + A: whole-scan majority", {**E, "scanmajority": 1}),
                       ("E + A2: whole-scan chocoprint majority", {**E, "printmajority": 1}),
                       ("E + B1: angles steady within 30°", {**E, "anglesteady": 30}),
                       ("E + B2: angle matches the scan's main angle", {**E, "anglemain": 45}),
                       ("E + A + B2", {**E, "scanmajority": 1, "anglemain": 45})]:
        print(f"{name:45s} {run(rule)}")
    sys.exit()

for name, rule, K in [("D+ and chocoprint 80%, shell check only", {"or99": 1, "printshare": .8, "logic": "shell"}, 3),
                      ("D+, shell check only", {"or99": 1, "logic": "shell"}, 3),("D+ (current: agree, or 99% sure)", {"or99": 1}, 3), ("D (agree only)", {}, 3),
                      ("D+ and last 3 frames all the same", {"or99": 1, "stable": 1}, 3), ("D+ and last 5 frames all the same", {"or99": 1, "stable": 1}, 5),
                      ("D and last 3 frames all the same", {"stable": 1}, 3), ("D+ and chocoprint in 80% of frames", {"or99": 1, "printshare": .8}, 3)]:
    print(f"{name:45s} {run(rule, K)}")
