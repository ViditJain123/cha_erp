#!/bin/zsh
# Keeps the CBIC knowledge base current: what CBIC published or amended since the
# last run -> page text -> OCR of new scans -> embeddings in reference_chunks.
#
#   packages/core/scripts/refresh-corpus.sh [--max-usd=N]
#
# Run daily by launchd (packages/core/scripts/in.kuberr.corpus-refresh.plist).
# Every step is incremental, so a normal day costs a few requests and cents.
# Embedding stops short if the dry-run estimate exceeds --max-usd (default 3):
# a large bill on an unattended run means something changed shape, and a person
# should look first. OCR is capped at 100 pages a run for the same reason.
#
# Only one run at a time, including a manual backfill: the steps rewrite the
# same text files.

set -u
ROOT=${0:A:h:h:h:h}
LIB=$ROOT/packages/library
MAX_USD=3
for arg in "$@"; do
  case $arg in --max-usd=*) MAX_USD=${arg#*=} ;; esac
done

LOCK=/tmp/checklist-corpus-refresh.lock
if ! mkdir $LOCK 2>/dev/null; then
  echo "$(date '+%F %T') another refresh holds $LOCK; skipping"
  exit 0
fi
trap 'rmdir $LOCK' EXIT

for other in fetch-loop.sh cli/extract-corpus cli/ocr-corpus cli/index-corpus fetch-corpus.py; do
  if pgrep -f $other >/dev/null; then
    echo "$(date '+%F %T') $other is already running; skipping this refresh"
    exit 0
  fi
done

step() { echo "\n=== $1 $(date '+%F %T')"; }

step "fetch updates"
python3 -u $ROOT/packages/core/scripts/fetch-corpus.py update || echo "fetch reported failures; continuing with what arrived"

cd $LIB
# One type per process throughout: the notification text alone is ~55 MB of
# JSON, and planning every type in one process ran a busy Mac out of memory.
TYPES=(form rule regulation instruction order circular notification)

step "extract"
for t in $TYPES; do
  ./node_modules/.bin/tsx cli/extract-corpus.ts $t || { echo "extract $t failed"; exit 1; }
done

step "ocr new scans"
./node_modules/.bin/tsx cli/ocr-corpus.ts --yes --max-pages=100 || echo "ocr had errors; continuing"

TOTAL=0
for t in $TYPES; do
  step "index $t (dry run)"
  DRY=$(./node_modules/.bin/tsx cli/index-corpus.ts $t 2>&1)
  echo $DRY
  USD=$(echo $DRY | grep -oE 'US\$[0-9.]+' | head -1 | tr -d 'US$')
  if [[ -z $USD ]]; then
    echo "no estimate for $t; not embedding it"
    continue
  fi
  TOTAL=$(echo "$TOTAL + $USD" | bc)
  if (( $(echo "$TOTAL > $MAX_USD" | bc) )); then
    echo "running estimate US\$$TOTAL exceeds --max-usd=$MAX_USD at $t; stopping. Run index-corpus --yes by hand after a look."
    exit 2
  fi
  [[ $DRY == *"total: 0 chunks"* ]] && continue
  step "index $t (~US\$$USD)"
  ./node_modules/.bin/tsx cli/index-corpus.ts $t --yes || { echo "index $t failed"; exit 1; }
done
step "done"
