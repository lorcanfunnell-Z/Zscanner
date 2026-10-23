#!/bin/bash
# zScanner check: run before every push. One command for everything:
#   1. every JavaScript file parses (no typos that would break the page)
#   2. self-tests of the shared training pieces and the files the phone needs (seconds)
#   3. the quality check for model 6 must match the saved baseline (training/baseline-model6.txt). If you changed
#      the model or gallery ON PURPOSE and the new numbers are better, save them: tools/check.sh --update-baseline
#   4. (optional, --browser) the client and admin pages open and identify chocolates in a headless browser
# Usage: tools/check.sh [--browser] [--update-baseline]
cd "$(dirname "$0")/.."
FAIL=0; say() { printf "\n== %s\n" "$1"; }
say "1. JavaScript parses"
for f in app/*.js training/*.js training/lib/*.js tools/*.js; do node --check "$f" 2>/dev/null || { echo "  FAIL  $f"; FAIL=1; }; done
[ $FAIL = 0 ] && echo "  ok    all files"
say "2. Self-tests"
node training/selftest.js 2>/dev/null | sed -n '/ok\|FAIL\|passed/p' || FAIL=1
node training/selftest.js >/dev/null 2>&1 || FAIL=1
say "3. Quality check vs baseline (about a minute)"
tools/fair_check.sh check app/model6/reader/model.json app/model6 >/dev/null 2>&1
NOW=$(sed -n '3,$p' experiments/fair-check-check.txt | sed 's/check-\(rec\|held\)/X-\1/')
if [ "$1" = "--update-baseline" ] || [ "$2" = "--update-baseline" ]; then echo "$NOW" > training/baseline-model6.txt; echo "  baseline updated"; 
elif [ ! -f training/baseline-model6.txt ]; then echo "$NOW" > training/baseline-model6.txt; echo "  baseline saved (first run)";
elif diff <(echo "$NOW") training/baseline-model6.txt >/dev/null; then echo "  ok    identical to baseline"; 
else echo "  CHANGED from baseline:"; diff <(echo "$NOW") training/baseline-model6.txt | sed 's/^/    /' | head -20; FAIL=1; fi
if [ "$1" = "--browser" ] || [ "$2" = "--browser" ]; then
  say "4. Browser smoke test (a few minutes)"
  (cd app && python3 -m http.server 8767 >/dev/null 2>&1 & echo $! > /tmp/zcheck-server.pid); sleep 1
  node tools/browser_smoke.js 2>/dev/null || FAIL=1
  kill "$(cat /tmp/zcheck-server.pid)" 2>/dev/null
fi
echo; [ $FAIL = 0 ] && echo "ALL CHECKS PASSED" || { echo "SOME CHECKS FAILED"; exit 1; }
