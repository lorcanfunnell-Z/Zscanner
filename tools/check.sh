#!/bin/bash
# zScanner check: run before every push. One command for everything:
#   1. every JavaScript file parses (no typos that would break the page)
#   2. self-tests of the shared training pieces and the files the phone needs (seconds)
#   3. the quality check for model 6 must match the saved baseline (training/baseline-model6.txt) - an older family
#      of candidate rules from training/eval_combo.js, kept for comparing raw signal strength, NOT what the phone
#      actually decides.
#   4. the LIVE decision rule (the first row of `training/trace_replay.py tests/<S> new` - rule E plus the phone's
#      5 s deadline; until 13 Nov this took plain rule E and so under-counted wrong answers) must match
#      its own saved baseline (training/baseline-ruleE.txt) on every held-back session listed in
#      training/sessions.json. This is the one that actually reflects real answered/wrong behaviour.
#   If you changed the model, gallery or decision logic ON PURPOSE and the new numbers are better, save both
#   baselines: tools/check.sh --update-baseline
#   5. (optional, --browser) the client and admin pages open and identify chocolates in a headless browser
# Usage: tools/check.sh [--browser] [--photo] [--update-baseline]
#   --photo (13 Nov): also runs tools/photo_check.js - the single-photo path over every held-back close-up and camera
#   frame in headless Chromium (about 6 minutes), diffed against training/baseline-photo.txt
cd "$(dirname "$0")/.."
FAIL=0; say() { printf "\n== %s\n" "$1"; }
say "1. JavaScript parses"
for f in app/*.js training/*.js training/lib/*.js tools/*.js; do node --check "$f" 2>/dev/null || { echo "  FAIL  $f"; FAIL=1; }; done
[ $FAIL = 0 ] && echo "  ok    all files"
say "2. Self-tests"
# -E (extended) on purpose: in plain BSD sed on macOS, "\|" is a literal pipe, not "or", so this printed
# nothing at all and the self-test results were invisible. Same macOS-vs-GNU sed trap as the baseline diff bug.
node training/selftest.js 2>/dev/null | sed -nE '/ok|FAIL|passed/p' || FAIL=1
node training/selftest.js >/dev/null 2>&1 || FAIL=1
node tools/pack_gallery.js --check || FAIL=1   # 13 Nov: the phone downloads a 16-bit packed copy of gallery.json - it must never lag behind
say "3. Quality check vs baseline (about a minute)"
tools/fair_check.sh check app/model6/reader/model.json app/model6 >/dev/null 2>&1
NOW=$(sed -n '3,$p' experiments/fair-check-check.txt | sed -E 's/check-(rec|held)/X-\1/')
if [ "$1" = "--update-baseline" ] || [ "$2" = "--update-baseline" ]; then echo "$NOW" > training/baseline-model6.txt; echo "  baseline updated"; 
elif [ ! -f training/baseline-model6.txt ]; then echo "$NOW" > training/baseline-model6.txt; echo "  baseline saved (first run)";
elif diff <(echo "$NOW") training/baseline-model6.txt >/dev/null; then echo "  ok    identical to baseline"; 
else echo "  CHANGED from baseline:"; diff <(echo "$NOW") training/baseline-model6.txt | sed 's/^/    /' | head -20; FAIL=1; fi
say "4. Live decision rule (rule E) vs baseline, every held-back session (about a minute)"
HELD=$(python3 -c "import json;print(' '.join(json.load(open('training/sessions.json'))['heldBack']))")
NOWE=""
for S in $HELD; do
  LINE=$(python3 training/trace_replay.py "tests/$S" new 2>/dev/null | head -1)
  NOWE="$NOWE$S: $LINE
"
done
if [ "$1" = "--update-baseline" ] || [ "$2" = "--update-baseline" ]; then printf '%s' "$NOWE" > training/baseline-ruleE.txt; echo "  baseline updated";
elif [ ! -f training/baseline-ruleE.txt ]; then printf '%s' "$NOWE" > training/baseline-ruleE.txt; echo "  baseline saved (first run)";
elif diff <(printf '%s' "$NOWE") training/baseline-ruleE.txt >/dev/null; then echo "  ok    identical to baseline";
else echo "  CHANGED from baseline:"; diff <(printf '%s' "$NOWE") training/baseline-ruleE.txt | sed 's/^/    /'; FAIL=1; fi
if [ "$1" = "--browser" ] || [ "$2" = "--browser" ]; then
  say "5. Browser smoke test (a few minutes)"
  # Start the little web server the pages are served from, and wait until it actually answers. A flat "sleep 1"
  # was enough on a warm machine and not on a cold one, so the first run of the day could fail for no real
  # reason. $! must also be python's own PID - taken from inside a (cd app && … &) subshell it was the
  # subshell's, so the kill missed and every run left a server behind holding port 8767.
  python3 -m http.server -d app 8767 >/dev/null 2>&1 & SERVER_PID=$!
  for _ in $(seq 1 40); do curl -sf -o /dev/null http://localhost:8767/index.html && break; sleep 0.25; done
  node tools/browser_smoke.js 2>/dev/null || FAIL=1
  kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null
fi
if [ "$1" = "--photo" ] || [ "$2" = "--photo" ] || [ "$3" = "--photo" ]; then
  say "6. Single-photo path vs baseline (about 6 minutes)"
  UPD=""; { [ "$1" = "--update-baseline" ] || [ "$2" = "--update-baseline" ] || [ "$3" = "--update-baseline" ]; } && UPD="--update-baseline"
  node tools/photo_check.js $UPD 2>/dev/null || FAIL=1
fi
echo; [ $FAIL = 0 ] && echo "ALL CHECKS PASSED" || { echo "SOME CHECKS FAILED"; exit 1; }
