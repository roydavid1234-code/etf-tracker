#!/usr/bin/env zsh
# ETF daily sync — runs Mon-Fri 18:30 via crontab.
# Fetches today's snapshot, commits SQLite, pushes to GitHub which triggers
# Render to redeploy with the new DB.

set -u

# Cron strips PATH; bake in everything we need.
export PATH="/Users/roy/.nvm/versions/node/v24.13.1/bin:/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

REPO="/Users/roy/ETF"
LOG="$REPO/scripts/sync.log"

{
  echo ""
  echo "==================== $(date '+%Y-%m-%d %H:%M:%S') ===================="
  cd "$REPO" || { echo "[fatal] cd $REPO failed"; exit 1; }

  echo "[step 1] npm run fetch"
  if ! npm run fetch; then
    echo "[error] fetch failed, abort sync"
    exit 1
  fi

  echo "[step 2] check db change"
  if git diff --quiet data/etf.sqlite 2>/dev/null && \
     ! git status --porcelain data/etf.sqlite | grep -q .; then
    echo "[info] no DB change, nothing to push"
    exit 0
  fi

  echo "[step 3] git add + commit"
  git add data/etf.sqlite
  git commit -m "auto: ETF db $(date '+%Y-%m-%d %H:%M')" || {
    echo "[info] nothing staged, exit"
    exit 0
  }

  echo "[step 4] git push"
  git push origin main || { echo "[error] push failed"; exit 1; }

  echo "[done] synced to Render"
} >> "$LOG" 2>&1
