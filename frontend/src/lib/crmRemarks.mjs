/**
 * A lead's remarks: the two shapes they are stored in, and reading either one.
 *
 * Pure, and in `lib` rather than beside the CRM page, so the rule that decides which column a
 * remark is read from can be held to account by `node --test` without rendering a table. It was
 * inside CRMPage.js and untestable, which is part of why the bug `leadRemarkEntries` describes
 * survived as long as it did.
 */

/**
 * The files carried by a single remark.
 *
 * A remark's attachments travel inside the remark itself rather than in a list beside it, so
 * a file is read together with the note it belongs to. A note with a photo and nothing else
 * is a real remark - "here is the reference they sent" - so a file alone is enough to keep an
 * entry alive.
 */
// How many files one remark can carry. They travel inline on the lead as data URLs, so this
// is a real limit rather than a stylistic one - a note with a dozen photos is a row that will
// not save.
export const MAX_REMARK_ATTACHMENTS = 5;

export function normalizeRemarkAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((file, index) => {
      if (!file) return null;
      const name = String(file.name || "").trim();
      if (!name) return null;
      return {
        id: file.id || `remark-file-${index}-${name}`,
        name,
        type: file.type || file.fileType || "",
        size: Number(file.size) || 0,
        url: String(file.url || ""),
      };
    })
    .filter(Boolean);
}

export function normalizeRemarkEntries(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => {
        if (typeof entry === "string") {
          const text = entry.trim();
          return text ? { id: `remark-${index}-${text.slice(0, 16)}`, text, createdAt: "", editedAt: "", attachments: [] } : null;
        }
        if (!entry) return null;
        const text = String(entry.text || entry.value || "").trim();
        const attachments = normalizeRemarkAttachments(entry.attachments);
        // Kept when it has either - a remark can be a note, a file, or both.
        if (!text && !attachments.length) return null;
        return {
          id: entry.id || `remark-${index}-${text.slice(0, 16)}`,
          text,
          createdAt: entry.createdAt || entry.created_at || "",
          editedAt: entry.editedAt || entry.edited_at || "",
          attachments,
        };
      })
      .filter(Boolean);
  }

  if (typeof value === "string") {
    const text = value.trim();
    // `editedAt` beside the rest, empty, so the entry a flat remark becomes is the same shape as
    // one written in the app. It matters now that they meet: posting a note on an imported lead
    // promotes its sheet remark into the list alongside the new one, and an entry missing a key
    // its neighbours carry reads as a different kind of thing to everything downstream.
    return text ? [{ id: `remark-0-${text.slice(0, 16)}`, text, createdAt: "", editedAt: "", attachments: [] }] : [];
  }

  return [];
}

export function remarkSummary(entries = []) {
  return normalizeRemarkEntries(entries).map((entry) => entry.text).filter(Boolean).join("\n");
}

/**
 * A lead's remarks as entries, from whichever of the two columns actually holds them.
 *
 * Remarks are stored twice over. The app writes `remarkEntries` - a list, each note carrying the
 * time it was written and any files clipped to it. The Google Sheet sync and the CSV import write
 * the flat `remarks` column and nothing else, because a spreadsheet cell is one piece of text with
 * no time against it and nothing to attach to it.
 *
 * So both have to be read, in that order, by everything that shows a lead's remarks - the table
 * cell, the lead popup, and the info panel's Remarks tab. Asking `remarkEntries || remarks` does
 * not do it: the list is *always* an array, because `parseJsonArray` answers `[]` for a NULL
 * column, and `[]` is truthy - so the second half was unreachable, and every lead that arrived
 * from a sheet or a file read as "No remarks yet." while its remark sat in the database.
 *
 * Emptiness is what is tested here rather than presence, and the answer is always a normalised
 * array, so a caller can count it or render it without knowing which column it came from.
 */
export function leadRemarkEntries(...sources) {
  for (const source of sources) {
    const entries = normalizeRemarkEntries(source);
    if (entries.length) return entries;
  }
  return [];
}
