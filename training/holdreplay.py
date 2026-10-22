# Speed step 4: how many frames does the D+ rule need? Replays consecutive held-back recording frames (0.2 s apart,
# phone moving) through the app's deciding rule with windows of 1..8 frames. Usage: python3 training/holdreplay.py dump.json
import json, sys, collections
d = json.load(open(sys.argv[1])); ids = d['ids']; rows = d['rows']
zk = lambda k: 'z' if k.startswith('z') else k
seqs = collections.OrderedDict()
for r in rows: seqs.setdefault(r['truth'], []).append(r)
def decide(win):
    n = len(ids); avg = [0] * n; m4v = collections.Counter(); pv = collections.Counter()
    for r in win:
        prod = [a * b for a, b in zip(r['m4'], r['pp'])]; s = sum(prod) or 1
        for i in range(n): avg[i] += prod[i] / s / len(win)
        m4v[zk(ids[max(range(n), key=lambda i: r['m4'][i])])] += 1
        pv[zk(ids[max(range(n), key=lambda i: r['pp'][i])])] += 1
    o = sorted(range(n), key=lambda i: -avg[i]); top, p1, p2 = ids[o[0]], avg[o[0]], avg[o[1]]
    agree = m4v.most_common(1)[0][0] == zk(top) and pv.most_common(1)[0][0] == zk(top)
    ok = (agree or p1 >= .99) and p1 >= .5 and p1 - p2 >= .2
    return top if ok else None
print("frames held | answered | wrong")
for w in range(1, 9):
    ans = wrong = tot = 0
    for k, s in seqs.items():
        for i in range(0, len(s) - w + 1):
            tot += 1; g = decide(s[i:i + w])
            if g: ans += 1; wrong += (g != k)
    print(f"{w:11d} | {100*ans/tot:7.1f}% | {wrong} of {ans} ({100*wrong/max(1,ans):.2f}%)")
