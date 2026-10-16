#!/usr/bin/env bash
# scripts/deploy-pages.sh — build the static site and publish it to the
# `gh-pages` branch of github.com/auryxn/site-admin.
#
# Usage:  ./scripts/deploy-pages.sh [repo]
# Requires: clean working tree, `gh` authenticated, local API running on :4200
#           (only if you want to refresh site-data.json first).
set -euo pipefail

REPO="${1:-auryxn/site-admin}"
BASE="/site-admin/"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> 1/5 refresh static data snapshot (needs API on :4200)"
node scripts/build-static-data.mjs

echo "==> 2/5 build static Pages bundle (base $BASE, VITE_STATIC=1)"
rm -rf dist-pages
PAGES_BASE="$BASE" VITE_STATIC=1 npx vite build --outDir dist-pages

echo "==> 3/5 copy project screenshots into the bundle"
mkdir -p dist-pages/uploads
cp -f uploads/*.png dist-pages/uploads/ 2>/dev/null || true
# GitHub Pages: disable Jekyll so files/folders starting with _ are served.
touch dist-pages/.nojekyll

echo "==> 4/5 push dist-pages/ to branch gh-pages"
(
  cd dist-pages
  rm -rf .git
  git init -q
  git checkout -q -b gh-pages
  git add -A
  git -c user.name="auryxn" -c user.email="auryxn@users.noreply.github.com" \
      commit -qm "deploy: static site-admin build $(date -u +%Y-%m-%dT%H:%MZ)"
  git remote add origin "https://github.com/${REPO}.git"
  git push -f -q origin gh-pages
)

echo "==> 5/5 enable GitHub Pages (gh-pages branch, /)"
gh api "repos/${REPO}/pages" -X POST \
  -f "source[branch]=gh-pages" -f "source[path]=/" 2>/dev/null \
  || gh api "repos/${REPO}/pages" -X PUT \
       -f "source[branch]=gh-pages" -f "source[path]=/" 2>/dev/null \
  || echo "(Pages build type set, or already enabled)"

echo
echo "URL: https://auryxn.github.io/site-admin/"
echo "Note: first publish can take 1-3 minutes."
