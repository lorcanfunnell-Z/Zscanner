# Replays the phone's frame-by-frame traces from a test log (admin test log, model 6+) under different answering rules.
# Usage: python3 training/trace_replay.py tests/test-4
# Each trace holds only the frames the phone read before it answered, so a stricter rule that hasn't answered by the
# end of a trace is shown as "kept going" (the phone would have kept scanning; we can't know what it would have said).
# NOTE: rules chosen by looking at a session must be confirmed on a NEW session before they count as proven.
#
# Also importable (13 Nov, for training/scorecard.py): load(session_dir) reads a session's traces, run(rule, ..., L=rows)
# replays them, E is the live rule and NEW_RULES the family printed by "new" mode. The command-line behaviour and every
# printed line are unchanged (tools/check.sh step 4 diffs this script's "new" output against training/baseline-ruleE.txt).
import json, os, sys
from collections import Counter
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
L = None   # the loaded session's scans (set by main() or by a caller after load())
META = json.load(open(os.path.join(ROOT, "app/model6/meta.json")))
zm = lambda k: "z" if k and k.startswith("z") else k
E = {"or99": 1, "printshare": .8, "logic": "shell"}   # rule E: the decision rule's checks (app/model6/meta.json)
LIVE = {**E, "stop_usable": 5000, "stop_wall": 10000}   # what the phone really runs (17 Nov): rule E; after 5 s of USABLE frames (a rejected stretch pauses the clock; app.js USABLE_GAP_MS 400), or 10 s on the wall clock, no answer at all
STOP_WALL5 = {**E, "stop": 5000}   # the 13-17 Nov rule: a wall-clock 5 s, checked only on usable frames
# The FIRST row of "new" mode is what tools/check.sh step 4 diffs against training/baseline-ruleE.txt, so it must be
# the rule the phone really runs. Until 13 Nov it was plain E, while the phone had been running E plus a 5 s forced
# guess (live since 3 Nov) - so the baseline was under-counting wrong answers.
NEW_RULES = [("E + 5 s of usable frames, 10 s ceiling: not certain by then = no answer, choices offered (LIVE since 17 Nov)", LIVE),
             ("E + 5s wall-clock stop (live 13-17 Nov)", STOP_WALL5),
             ("E + 5s forced guess (live 3-13 Nov)", {**E, "deadline": 5000}),
             ("E alone, no deadline (step 4 measured this until 13 Nov)", E),
             ("E + A: whole-scan majority", {**E, "scanmajority": 1}),
             ("E + A2: whole-scan chocoprint majority", {**E, "printmajority": 1}),
             ("E + B1: angles steady within 30°", {**E, "anglesteady": 30}),
             ("E + B2: angle matches the scan's main angle", {**E, "anglemain": 45}),
             ("E + A + B2", {**E, "scanmajority": 1, "anglemain": 45}),
             ("LIVE + finder confidence >= 0.75 over the window (23 Nov lead: test-14's Nothing shots sat at 0.56-0.74, every chocolate scan at 1.0)", {**LIVE, "minobj": .75}),
             # 23 Nov, two candidates fair-tested the same day (results in docs/HISTORY.md): the shell colour over the whole scan
             # (test-14 scan 116, N°9 answered as 6 on a two-frame 'dark' window) and the finder's confidence as a quality gate
             # rather than an answer gate (an unsure frame is dropped like a blurry one, so a blank card never starts the clock)
             ("LIVE + shell vote over the whole scan must match", {**LIVE, "shellscan": 1}),
             ("LIVE + answer's shell read in >= 60% of all held frames", {**LIVE, "shellshare": .6}),
             ("LIVE + answer's shell read in >= 70% of all held frames", {**LIVE, "shellshare": .7}),
             ("LIVE + frames with finder confidence < 0.75 rejected like blurry ones", {**LIVE, "objreject": .75}),
             ("LIVE + frames with finder confidence < 0.80 rejected like blurry ones", {**LIVE, "objreject": .8}),
             ("LIVE + late answer at the stop (chocoprint share >= 0.6, gap >= 0.3, whole-scan shell fits)", {**LIVE, "late": .6})]

def load(session_dir):   # the scans a replay can use: labelled with a chocolate, with a trace
    # "none" (a deliberate Nothing shot, 13 Nov) is scored separately - see load_nothing - so it never counts as a
    # chocolate scan the rule failed to answer, nor as a wrong answer among them
    return [r for r in json.load(open(os.path.join(session_dir, "test-log.json"))) if r.get("truth") and r["truth"] != "none" and r.get("trace")]

def load_nothing(session_dir):   # the Nothing shots: the right outcome is no answer, any answer is wrong
    return [r for r in json.load(open(os.path.join(session_dir, "test-log.json"))) if r.get("truth") == "none"]

def jsvote(keys):
    c = {}
    for k in keys:
        if k: c[k] = c.get(k, 0) + 1
    order = sorted((k for k in c if k.isdigit()), key=int) + [k for k in c if not k.isdigit()]
    return sorted(order, key=lambda k: -c[k])[0] if order else None

def adiff(a, b):                                        # smallest gap between two angles, in degrees
    d = abs((a - b) % 360); return min(d, 360 - d)

def colour_fits(r, top, rule):
    # 25 Nov experiment: a number-blind colour model's milk probability for this scan (rule["colour"] = {session: {scan n: p}},
    # from the saved close-up, a proxy for a per-frame value), counted as a second shell vote when it is sure either way
    c = rule.get("colour")
    if not c or r is None: return False
    p = c.get(r.get("_sess"), {}).get(str(r.get("n")))
    if p is None: return False
    want = META["shellOf"].get(top); th = rule.get("colourth", .9)
    return (want == "milk" and p >= th) or (want == "dark" and p <= 1 - th)

def late_pick(held, rule, r=None):
    # 24 Nov, the "late answer": when the stop comes with no certain answer, the whole scan is looked at once more. If the
    # chocoprint named the scan's likeliest chocolate on most held frames, the likeliest is well clear of the runner-up and
    # the shell colour over the whole scan fits, that chocolate is the answer; otherwise "not certain" and the chips as now.
    # Why: on the not-certain scans the truth was the first chip about two times in three, and these three signals together
    # picked out only right ones on test-4..13 (chosen there) and on test-14 (confirmation).
    if not held: return None
    avg = Counter()
    for h in held:
        for k, p in h["top"]: avg[k] += p / len(held)
    (top, p1), *rest = avg.most_common(2) + [("", 0)]
    pshare = sum(1 for h in held if h.get("pmark") == zm(top)) / len(held)
    sfit = META["shellOf"].get(top) == "milkwhite" or jsvote([h.get("shell") for h in held]) == META["shellOf"].get(top) or colour_fits(r, top, rule)
    return top if pshare >= rule["late"] and p1 - rest[0][1] >= rule.get("lategap", .3) and sfit else None

def run(rule, K=3, detail=False, L=None):
    # detail=True returns (truth, said, at) per scan; detail="full" adds what the rule saw at the moment it answered
    rows = L if L is not None else globals()["L"]
    out, full = [], []
    for r in rows:
        held, said, at, seen = [], None, None, None
        tu, prev_t = 0, None   # the usable-frame clock: the phone's own value when logged (u, since scanner-v60), else rebuilt from the gaps between held frames
        frames = r["trace"]
        if rule.get("objreject"):                               # 23 Nov: a frame the finder was unsure of is thrown out like a blurry one - it never joins the hold, so the phone's logged clock no longer applies and the usable clock is rebuilt below from the kept frames' gaps (test-14's Nothing shots sat at 0.5-0.74); a frame logged without obj (test-4..7) is kept as it was
            frames = [f for f in frames if f.get("obj") is None or f["obj"] >= rule["objreject"]]
        for f in frames:
            tu = f["u"] if f.get("u") is not None and not rule.get("objreject") else (tu + min(f["t"] - prev_t, 400) if prev_t is not None else 0); prev_t = f["t"]
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
            if rule.get("minobj"):                              # 23 Nov lead (test-14's Nothing shots): the finder's own confidence over the window must reach this; a trace without obj (before scanner-v5x) is left alone
                obs = sorted(h["obj"] for h in win if h.get("obj") is not None)
                ok = ok and (not obs or obs[len(obs) // 2] >= rule["minobj"])
            if rule.get("logic", "full") != "none":            # the phone's logic check: shell (and mark) votes must fit
                # N°20's milk+white shell is read unreliably (28 Oct fix) - the phone skips the shell-match
                # requirement just for it, so this replay has to do the same to actually match app.js
                shell_ok = META["shellOf"].get(top) == "milkwhite" or vote("shell") == META["shellOf"].get(top) or colour_fits(r, top, rule)
                ok = ok and shell_ok
                if rule.get("logic", "full") == "full": ok = ok and vote("mark") == META["markOf"].get(top)
            # 23 Nov: the shell colour over EVERY held frame of the scan, not just the 0.6 s window. Why: on test-14 scan 116 the
            # reader read N°9's shell as milk on 19 of 22 frames and dark on the last two, and those two were the whole window
            # when the chocoprint settled on 6 (a dark chocolate) - so the window's shell vote let a wrong answer through.
            # N°20 (milkwhite) is skipped exactly as the window check above skips it.
            if rule.get("shellscan"):                           # the whole-scan shell vote must match the answer's shell
                ok = ok and (META["shellOf"].get(top) == "milkwhite" or jsvote([h.get("shell") for h in held]) == META["shellOf"].get(top))
            if rule.get("shellshare"):                          # the answer's shell must have been read in at least this share of all held frames
                ok = ok and (META["shellOf"].get(top) == "milkwhite" or sum(1 for h in held if h.get("shell") == META["shellOf"].get(top)) / len(held) >= rule["shellshare"])
            forced =rule.get("deadline") and f["t"] >= rule["deadline"] and len(win) >= 3   # 3-13 Nov: hard cutoff, answer with the current top guess
            if (ok and tp >= .5 and tp - sp >= .2) or forced:
                said = top; at = f["t"] - held[0]["t"]
                seen = {"top": top, "tp": tp, "sp": sp, "win": list(win), "held": list(held), "agree": bool(agree), "forced": bool(forced)}
                break
            # 13 Nov: past the deadline the phone stops WITHOUT answering (camera off, likeliest three offered as chips) -
            # the same cutoff as "deadline" above, but counted as not answered. As with "deadline", the clock here runs
            # from the first held frame of the trace; the phone's restarts if the chocolate jumps (resetHold), a small
            # difference the replay has never modelled.
            if rule.get("stop") and f["t"] >= rule["stop"] and len(win) >= 3:
                if rule.get("late") and late_pick(held, rule, r): said = late_pick(held, rule, r); at = f["t"] - held[0]["t"]; seen = {"late": True, "held": list(held)}
                break
            # 17 Nov: the live stop - 5 s of usable frames, or 10 s on the wall clock. The phone checks both on every frame,
            # rejected ones included; the trace holds only usable frames, so this replay stops at the next one - the same
            # outcome (no answer can come from a rejected frame), only the chips may differ by a frame
            if rule.get("stop_usable") and tu >= rule["stop_usable"] and len(win) >= 3:
                if rule.get("late") and late_pick(held, rule, r): said = late_pick(held, rule, r); at = f["t"] - held[0]["t"]; seen = {"late": True, "held": list(held)}
                break
            if rule.get("stop_wall") and f["t"] >= rule["stop_wall"] and len(win) >= 3:
                if rule.get("late") and late_pick(held, rule, r): said = late_pick(held, rule, r); at = f["t"] - held[0]["t"]; seen = {"late": True, "held": list(held)}
                break
        out.append((r["truth"], said, at if said else None))
        full.append({"truth": r["truth"], "said": said, "at": at if said else None, "scan": r, "held": list(held), "seen": seen})
    if detail == "full": return full
    if detail: return out
    ans = [o for o in out if o[1]]; wrong = [o for o in ans if o[1] != o[0]]
    ts = sorted(o[2] for o in ans); med = ts[len(ts) // 2] / 1000 if ts else 0
    slow = " ".join(f"{o[0]}:{o[2]/1000:.1f}s" for o in ans if o[2] > 3000)
    return f"answered {len(ans)}/{len(out)}, wrong {len(wrong)} {' '.join(t + '→' + s for t, s, _ in wrong)} | typical {med:.1f}s after first seen | slow: {slow}"

def main():
    global L
    L = load(sys.argv[1])
    if len(sys.argv) > 2 and sys.argv[2] == "sweep":
        # sweeps printShare (currently 0.8 in app/model6/meta.json) against the usual held-back sessions, rule E
        # otherwise unchanged (or99 + shell-only logic). No new photos needed: same logged traces, just a different cutoff.
        for ps in [0.5, 0.6, 0.7, 0.8, 0.9, 1.0]:
            tag = f"printShare={ps}" + (" (current)" if ps == META.get("printShare") else "")
            print(f"{tag:28s} {run({'or99': 1, 'printshare': ps, 'logic': 'shell'})}")
        sys.exit()

    if len(sys.argv) > 2 and sys.argv[2] == "new":
        for name, rule in NEW_RULES:
            print(f"{name:45s} {run(rule)}")
        sys.exit()

    for name, rule, K in [("D+ and chocoprint 80%, shell check only", {"or99": 1, "printshare": .8, "logic": "shell"}, 3),
                          ("D+, shell check only", {"or99": 1, "logic": "shell"}, 3),("D+ (current: agree, or 99% sure)", {"or99": 1}, 3), ("D (agree only)", {}, 3),
                          ("D+ and last 3 frames all the same", {"or99": 1, "stable": 1}, 3), ("D+ and last 5 frames all the same", {"or99": 1, "stable": 1}, 5),
                          ("D and last 3 frames all the same", {"stable": 1}, 3), ("D+ and chocoprint in 80% of frames", {"or99": 1, "printshare": .8}, 3)]:
        print(f"{name:45s} {run(rule, K)}")

if __name__ == "__main__":
    main()
