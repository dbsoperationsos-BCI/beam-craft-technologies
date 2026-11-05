#!/usr/bin/env bash
#
# Prints the application version for a commit: <major>.<minor>.<build>, e.g. 1.2.41.
#
#   major.minor   Owned by people. It is whatever the VERSION file at the repository root says,
#                 and editing that file is the entire act of deciding a release is a major or a
#                 minor one. Nothing else writes it.
#   build         Owned by git. The number of promotions to main since the baseline tag below —
#                 one per merge of develop into main, however many pull requests that merge
#                 carried. Nobody types it and nobody can forget it.
#
# The build number is MONOTONIC: it does not reset when major.minor is bumped, so 1.2.41 is
# followed by 1.3.42. That is why the baseline below is a fixed point rather than the current
# minor's tag — the range it counts over only ever grows.
#
# Usage:
#   scripts/app-version.sh            the version of HEAD (what a deploy of this commit produces)
#   scripts/app-version.sh --next     the version the NEXT promotion of develop will produce
#   scripts/app-version.sh --check    verify VERSION and both package.json files agree; print nothing
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The point the build number counts from. Created once, when versioning was introduced.
#
# NEVER move, delete, or re-point this tag. The build number is the distance from it, so moving it
# silently renumbers every release that has ever shipped and every version stamped on a running
# server stops meaning what it said.
BASELINE_TAG="v1.0.0"

git_repo() { git -C "$REPO_ROOT" "$@"; }

read_major_minor() {
  local value
  value="$(tr -d '[:space:]' < "$REPO_ROOT/VERSION")"
  if ! [[ "$value" =~ ^[0-9]+\.[0-9]+$ ]]; then
    echo "VERSION must contain exactly <major>.<minor>, e.g. 1.2 — found '${value}'" >&2
    exit 1
  fi
  printf '%s' "$value"
}

# Promotions between the baseline and a ref. --first-parent walks only main's own line, so a merge
# that brought in twelve pull requests counts once: the build number counts releases, not commits.
#
# Before the baseline tag exists — the very first deploy — there is nothing to count from, so the
# build is 0 and that first deploy is the one that creates the tag.
count_builds() {
  local ref="$1"
  if git_repo rev-parse -q --verify "refs/tags/${BASELINE_TAG}" >/dev/null 2>&1; then
    git_repo rev-list --count --first-parent "${BASELINE_TAG}..${ref}"
  else
    echo 0
  fi
}

# package.json is not the source of truth — the build number moves every release and no commit
# could keep it accurate. What the two files may not do is disagree about major.minor, because
# anyone reading them would take that for the version. CI runs this.
check_package_json() {
  local major_minor="$1" side path declared
  local failed=0
  for side in backend frontend; do
    path="$REPO_ROOT/$side/package.json"
    declared="$(node -p "require('$path').version" 2>/dev/null || echo "")"
    if [[ "$declared" != "${major_minor}."* ]]; then
      echo "${side}/package.json says '${declared}', but VERSION says '${major_minor}'." >&2
      failed=1
    fi
  done
  [ "$failed" -eq 0 ] || exit 1
}

MAJOR_MINOR="$(read_major_minor)"

case "${1:---current}" in
  --current)
    echo "${MAJOR_MINOR}.$(count_builds HEAD)"
    ;;
  --next)
    # What promoting develop right now would produce. A merge of develop into main adds exactly one
    # commit to main's first-parent line, so it is main's count plus one. Read from origin/main
    # rather than the local branch, which is routinely behind.
    ref="origin/main"
    git_repo rev-parse -q --verify "refs/remotes/origin/main" >/dev/null 2>&1 || ref="main"
    echo "${MAJOR_MINOR}.$(( $(count_builds "$ref") + 1 ))"
    ;;
  --check)
    check_package_json "$MAJOR_MINOR"
    ;;
  *)
    echo "usage: $(basename "$0") [--current|--next|--check]" >&2
    exit 2
    ;;
esac
