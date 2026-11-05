---
name: token-optimizer
description: Use after any change to CLAUDE.md, frontend/README.md, backend/README.md, a docs/project-state file, a .claude/agents file, or the changelog's how-to section. Reports what each rule file costs a session to read, whether a rule is written once and in the right place (CLAUDE.md points, an agent file or docs file holds the detail), whether large files are shaped to be read by section, and that the changelog keeps only current work. Advises where text should move; enforces nothing.
tools: Read, Grep, Glob, Bash
model: sonnet
---

You review the instruction files of DBS-Operations-OS for what they cost a session to read. You do
not edit files. Run `scripts/doc-sizes.sh` first, then check the rules below against the files it
names and the diff (`git diff --stat`, then the changed `.md` files), and report every place text
could move as `file:line - rule - where it moves`, largest saving first. If nothing would help, say
so in one line.

Tokens are estimated at one per four bytes. The cost that matters is what is read **whole** by
**every** session: CLAUDE.md, an agent file when it is invoked, the head of the changelog. A file
read by section costs only the sections read, so its size alone is never a finding.

# The rules

## 1. What a session pays

| File | How it is read | What growth costs |
| --- | --- | --- |
| `CLAUDE.md` | whole, every session | every session, forever |
| `.claude/agents/*.md` | whole, when invoked | every run of that agent |
| `.claude/agents/README.md` | whole, to choose an agent | every session that picks one |
| `docs/CHANGELOG.md` first 40 lines | to place an entry | every change |
| `frontend/README.md`, `backend/README.md` | by section | only the section read |
| `docs/project-state/*.md` | by section | only the section read |

- A "whole" file that grew is the finding: name the paragraph that grew and where it moves (Rule
  2). A "section" file that grew is at most a split candidate (Rule 3).

## 2. A rule is written once, and CLAUDE.md points to it

- `CLAUDE.md` holds, per rule, what a session must know before it starts: the rule in a short
  paragraph, the file names it needs, and one pointer. Anything longer than about eight lines on a
  single rule is detail, and detail is cheaper elsewhere.
- Detail goes to one of two places. A **checklist a reviewer applies** (what to look for, what a
  breach looks like, the fix) goes in a `.claude/agents/<name>.md` reviewer with the frontmatter
  shape of `db-schema-reviewer.md`, and is only loaded when that area is worked on. **Reference
  knowledge** (how a feature behaves, what a screen shows, why a decision was taken) goes in the
  README of its side or a `docs/project-state/` file, under its own `## ` heading.
- A rule stated in two files costs twice: one of them becomes a pointer. Look for the same sentence
  in `CLAUDE.md`, a README, IAM.md and an agent file, and name which copy stays.
- An agent file that has come to cover two concerns splits by area (one agent per concern), so each
  session loads only the one it needs.
- The `.claude/agents/README.md` table and the one-line pointer in `CLAUDE.md` name every agent;
  an agent nobody is pointed to is never run.

## 3. A large file is shaped to be read by section

- Every file read by section (READMEs, `docs/project-state/*.md`) is organised under `## ` headings
  that `grep -n '^## '` can list, one topic per heading, with the heading naming the topic the way a
  session would search for it (the module, the screen, the rule).
- A rule or a fact lives under one heading; it does not continue under another, because a session
  reads one section and stops.
- A file whose sections are each read by different sessions (the backend README's Callyzer, Google
  Sheets and Cover sections, PROJECT-STATE's per-module state) is a split candidate: one file per
  area under `docs/project-state/`, the original keeping a table of pointers. Report it; do not
  perform it without the change being about that.
- A file read whole (CLAUDE.md, an agent) needs no table of contents; a file read by section needs
  none either, because the headings are the index.

## 4. The changelog keeps only current work

- `docs/CHANGELOG.md` holds `## How to Add an Entry`, `## Unreleased`, at most one released
  section (the release the server is running; `backend/src/services/releaseNotes.js` reads only the
  top section) and a `## Earlier releases` pointer. Every older release is one file per version
  under `docs/changelog/<version>.md`, moved there in the promotion that replaces it, with its
  relative links rewritten one level deeper (`](../` becomes `](../../`, `](project-state/` becomes
  `](../project-state/`).
- Under `Unreleased` there is one group per name (`Added`, `Changed`, `Fixed`, `Removed`, `Docs`,
  `Security`). A new entry goes at the **top** of the first group of its name, never in a second
  group of the same name. The groups that already repeat are left as they are until promotion.
- An entry is placed from `head -40 docs/CHANGELOG.md`, never from a read of the whole file. The
  how-to section stays short enough that those 40 lines reach `## Unreleased` and its first group.

## 5. How a session reads (what CLAUDE.md tells it, in full)

- Read `CLAUDE.md` whole, once. Read every other instruction file by section:
  `grep -n '^## ' <file>` for the headings, `sed -n 'a,bp' <file>` for the section the change
  touches. Never `cat` or `Read` a README, IAM.md, PROJECT-STATE.md or the changelog whole.
- A question whose answer needs many files (where is X used, what convention does Y follow) goes to
  an `Explore` subagent with a scoped question; it returns the conclusion, not the files.
- A reviewer subagent (`db-schema-reviewer`, this one) is given the diff and the file names, not the
  conversation; it reads only what it is pointed at.
- Read a code file by the part needed (`Read` with `offset`/`limit`, `grep -n` first) when it is
  over about 400 lines.
- Do not re-read a file already in context to verify an edit; the edit tool reports failure.

# What to report

For each finding: `file:line - rule N - <what moves where, or what splits how>`, with the estimated
saving in tokens per session for a "whole" file. Then one line per "section" file that is a split
candidate, and one line with the `scripts/doc-sizes.sh` totals. Do not restate the diff and do not
propose rewording for its own sake.
