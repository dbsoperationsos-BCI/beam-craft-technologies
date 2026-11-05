/*
 * What the current release brought, read from docs/CHANGELOG.md.
 *
 * The changelog is the one account of every change, and its top section is the release this
 * server is running - "Unreleased" on a working copy or a develop build, the version once develop
 * has been promoted to main. Each entry there opens with a bold sentence written for a reader who
 * was not in the conversation; those sentences are the release notes, so nothing has to be
 * written twice and the dialog in the app can never disagree with the record.
 *
 * Read once at boot: the file is part of the checkout and cannot change while the process runs.
 */
const fs = require("fs");
const path = require("path");

const CHANGELOG_PATH = path.resolve(__dirname, "../../../docs/CHANGELOG.md");
/** Sections that are instructions to contributors rather than releases. */
const NON_RELEASE_HEADINGS = new Set(["How to Add an Entry"]);
const MAX_NOTES = 25;

/** Markdown to plain text: links keep their words, code keeps its content, emphasis goes. */
function plainText(markdown) {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The bold opening sentence of an entry, or its first sentence where there is no bold one. */
function leadInOf(entry) {
  const bold = entry.match(/^\*\*(.+?)\*\*/);
  if (bold) return plainText(bold[1]);
  const text = plainText(entry);
  const end = text.search(/[.!?](\s|$)/);
  return end === -1 ? text : text.slice(0, end + 1);
}

/**
 * The first release section of a changelog and the lead-in of each entry in it.
 * Pure - it takes the text - so it can be tested without a file.
 */
function parseReleaseNotes(markdown) {
  const lines = String(markdown || "").split("\n");
  let section = null;
  const entries = [];
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^## (.+?)\s*$/);
    if (heading) {
      if (section) break;
      if (!NON_RELEASE_HEADINGS.has(heading[1])) section = heading[1];
      continue;
    }
    if (!section) continue;
    if (/^- /.test(line)) {
      current = [line.slice(2)];
      entries.push(current);
    } else if (current && /^\s+\S/.test(line)) {
      current.push(line.trim());
    } else {
      current = null;
    }
  }
  const notes = entries.map((parts) => leadInOf(parts.join(" "))).filter(Boolean).slice(0, MAX_NOTES);
  return { section, notes };
}

function readReleaseNotes() {
  try {
    return parseReleaseNotes(fs.readFileSync(CHANGELOG_PATH, "utf8"));
  } catch {
    // A checkout without the docs folder has no notes to show; the dialog says so.
    return { section: null, notes: [] };
  }
}

const releaseNotes = readReleaseNotes();

module.exports = { releaseNotes, parseReleaseNotes };
