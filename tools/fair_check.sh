#!/bin/bash
# zScanner fair check: one command for the before/after report every change must pass.
# Runs the reader + chocoprints on photos and test scans they were never trained on (the held-back recording photos
# and the held-back test session), then prints: the answering rules (answered / wrong), and how many held frames
# the D+ rule needs (replay of recorded sequences).
#
# Usage: tools/fair_check.sh <name> <reader model.json> <chocoprint folder (has print/ and gallery.json)> [held test, default test-3]
# Example (model 6): tools/fair_check.sh model6 app/model4/reader/model.json app/model6
# Results also saved in experiments/fair-check-<name>.txt
set -e
cd "$(dirname "$0")/.."
NAME=$1; READER=$2; PRINT=$3; HOLD=${4:-test-3}
[ -z "$PRINT" ] && { sed -n 2,9p "$0"; exit 1; }
GRAY=$(python3 -c "import json;print(1 if json.load(open('$PRINT/gallery.json')).get('gray') else 0)")
OUT=experiments/fair-check-$NAME.txt; mkdir -p experiments /tmp/zfair
for S in rec held; do
  E=""; [ $S = rec ] && E=rec
  EVAL_SET=$E DUMP=/tmp/zfair/$NAME-$S.json READER=$READER GRAY=$GRAY HOLD_TEST=$HOLD SYNTH=0 TESTS=0 PRINT=$PRINT \
    node training/eval_combo.js > /dev/null 2>&1
done
{
  echo "zScanner fair check: $NAME   ($(date '+%Y-%m-%d %H:%M'))"
  echo "reader: $READER   chocoprints: $PRINT   held-back test: $HOLD"
  python3 training/tradeoff.py /tmp/zfair/$NAME-rec.json /tmp/zfair/$NAME-held.json
  echo; echo "Hold replay (recorded sequences, rule D+):"
  python3 training/holdreplay.py /tmp/zfair/$NAME-rec.json
} | tee $OUT
rm -f "$PRINT/combo-report.json"; echo "saved: $OUT"
