# Stage 4: answer rate vs wrong answers for different deciding rules, on photos/scans the models never trained on.
# Input: dumps written by eval_combo.js (DUMP=...). Usage: python3 training/tradeoff.py dump-rec.json dump-t3.json
import json, sys
def zk(k): return 'z' if k.startswith('z') else k
def top(v, ids):
    o = sorted(range(len(v)), key=lambda i: -v[i]); return ids[o[0]], v[o[0]], v[o[0]] - v[o[1]]
RULES = [("model 4 alone, 65% sure", lambda m, p, b, ids: top(m, ids)[1] >= .65 and top(m, ids)[2] >= .3, "m4"),
         ("combined, 80% sure", lambda m, p, b, ids: top(b, ids)[1] >= .8, "b"),
         ("combined, 95% sure", lambda m, p, b, ids: top(b, ids)[1] >= .95, "b"),
         ("D: both agree", lambda m, p, b, ids: zk(top(m, ids)[0]) == zk(top(p, ids)[0]), "b"),
         ("D, or combined 99% sure", lambda m, p, b, ids: zk(top(m, ids)[0]) == zk(top(p, ids)[0]) or top(b, ids)[1] >= .99, "b"),
         ("D, or combined 95% sure", lambda m, p, b, ids: zk(top(m, ids)[0]) == zk(top(p, ids)[0]) or top(b, ids)[1] >= .95, "b")]
for f in sys.argv[1:]:
    d = json.load(open(f)); ids = d['ids']; rows = d['rows']
    print(f"\n{f.split('/')[-1]}: {len(rows)} photos/scans")
    for name, rule, which in RULES:
        ans = wrong = 0
        for r in rows:
            m, p = r['m4'], r['pp']; prod = [a * c for a, c in zip(m, p)]; s = sum(prod) or 1; b = [v / s for v in prod]
            if rule(m, p, b, ids):
                ans += 1; g = top(m if which == "m4" else b, ids)[0]
                if g != r['truth']: wrong += 1
        print(f"  {name:28s} answers {100*ans/len(rows):5.1f}%   wrong {wrong:3d} ({100*wrong/max(1,ans):.1f} per 100 answers)")
