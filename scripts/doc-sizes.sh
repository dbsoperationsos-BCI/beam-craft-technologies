#!/usr/bin/env bash
#
# Reports what the rule files cost an AI session to read, so a rule that has grown can be moved
# to where only the sessions that need it pay for it. Informational only: it enforces nothing and
# always exits 0. Tokens are estimated at one per four bytes, close enough for English prose.
#
#   whole     read in full by every session (CLAUDE.md) or every time the agent is invoked.
#   section   read by heading: `grep -n '^## ' <file>` then `sed -n 'a,bp'`. The "sections"
#             column says how many headings there are to pick from; the cost of a section read
#             is the section, not the file.
#   head      the changelog: an entry is placed from its first 40 lines.
#
# Usage:  scripts/doc-sizes.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CHANGELOG_HEAD_LINES=40

tokens_of() { echo $(( $(wc -c < "$1") / 4 )); }
kb_of() { echo $(( ($(wc -c < "$1") + 1023) / 1024 )); }
sections_of() { grep -c '^## ' "$1" 2>/dev/null || echo 0; }

row() { printf "%-8s %6sKB %8s tok %5s  %s\n" "$1" "$2" "$3" "$4" "$5"; }

echo "What a session pays to read each rule file (1 token ~ 4 bytes)"
echo
printf "%-8s %8s %12s %5s  %s\n" "how" "size" "whole read" "sect." "file"

for f in CLAUDE.md frontend/AGENTS.md .claude/agents/README.md; do
  [ -f "$f" ] && row whole "$(kb_of "$f")" "$(tokens_of "$f")" "-" "$f"
done
for f in .claude/agents/*.md; do
  [ "$(basename "$f")" = "README.md" ] && continue
  row whole "$(kb_of "$f")" "$(tokens_of "$f")" "-" "$f"
done
for f in frontend/README.md backend/README.md docs/project-state/*.md; do
  [ -f "$f" ] || continue
  [ "$(basename "$f")" = "README.md" ] && [[ "$f" == docs/* ]] && continue
  row section "$(kb_of "$f")" "$(tokens_of "$f")" "$(sections_of "$f")" "$f"
done

if [ -f docs/CHANGELOG.md ]; then
  head_bytes="$(head -n "$CHANGELOG_HEAD_LINES" docs/CHANGELOG.md | wc -c | tr -d ' ')"
  row head "$(kb_of docs/CHANGELOG.md)" "$(tokens_of docs/CHANGELOG.md)" "-" \
    "docs/CHANGELOG.md  (first $CHANGELOG_HEAD_LINES lines: $(( head_bytes / 4 )) tok - that is what placing an entry costs)"
fi

echo
echo "Notes"
if [ -f docs/CHANGELOG.md ]; then
  releases="$(grep -c '^## [0-9]' docs/CHANGELOG.md || true)"
  [ "${releases:-0}" -gt 1 ] && echo "- docs/CHANGELOG.md holds $releases released sections; older ones can move to docs/changelog/<version>.md."
  repeated="$(awk '/^## Unreleased/{u=1;next} /^## /{u=0} u && /^### /' docs/CHANGELOG.md | sort | uniq -d | wc -l | tr -d ' ')"
  [ "${repeated:-0}" -gt 0 ] && echo "- $repeated group names repeat under Unreleased; a new entry goes at the top of the first group of its name."
fi
echo "- A 'whole' file is paid by every session that loads it; if one has grown, the detail moves to an agent or docs file."
echo "- A 'section' file costs only the sections read; a large one with many unrelated sections is a candidate to split by area."
exit 0
