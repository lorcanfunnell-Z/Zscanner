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

def run(rule, K=3):
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
            vote = lambda key: Counter(h[key] for h in win if h.get(key)).most_common(1)[0][0] if any(h.get(key) for h in win) else None
            agree = zm(vote("m4top")) == zm(top) and vote("pmark") == zm(top)
            ok = agree or (rule.get("or99") and tp >= .99)
            if rule.get("stable"):                              # each of the last K frames, on its own, names the same chocolate
                ok = ok and all(h["top"][0][0] == top for h in held[-K:])
            if rule.get("printshare"):                          # the chocoprint named it in at least this share of frames
                ok = ok and sum(1 for h in win if h.get("pmark") == zm(top)) / len(win) >= rule["printshare"]
            if rule.get("logic", "full") != "none":            # the phone's logic check: shell (and mark) votes must fit
                ok = ok and vote("shell") == META["shellOf"].get(top)
                if rule.get("logic", "full") == "full": ok = ok and vote("mark") == META["markOf"].get(top)
            if ok and tp >= .5 and tp - sp >= .2: said = top; at = f["t"] - held[0]["t"]; break
        out.append((r["truth"], said, at if said else None))
    ans = [o for o in out if o[1]]; wrong = [o for o in ans if o[1] != o[0]]
    ts = sorted(o[2] for o in ans); med = ts[len(ts) // 2] / 1000 if ts else 0
    slow = " ".join(f"{o[0]}:{o[2]/1000:.1f}s" for o in ans if o[2] > 3000)
    return f"answered {len(ans)}/{len(out)}, wrong {len(wrong)} {' '.join(t + '→' + s for t, s, _ in wrong)} | typical {med:.1f}s after first seen | slow: {slow}"

for name, rule, K in [("D+ and chocoprint 80%, shell check only", {"or99": 1, "printshare": .8, "logic": "shell"}, 3),
                      ("D+, shell check only", {"or99": 1, "logic": "shell"}, 3),("D+ (current: agree, or 99% sure)", {"or99": 1}, 3), ("D (agree only)", {}, 3),
                      ("D+ and last 3 frames all the same", {"or99": 1, "stable": 1}, 3), ("D+ and last 5 frames all the same", {"or99": 1, "stable": 1}, 5),
                      ("D and last 3 frames all the same", {"stable": 1}, 3), ("D+ and chocoprint in 80% of frames", {"or99": 1, "printshare": .8}, 3)]:
    print(f"{name:45s} {run(rule, K)}")
