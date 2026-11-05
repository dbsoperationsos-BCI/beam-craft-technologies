/*
 * A CRD document's reference rows - Photo, Video and Other Reference Links - as the client form edits
 * them, and what the form keeps of itself when an autosave answers.
 */

export function compactReferenceValue(value) {
  return String(value ?? "").trim();
}

/*
 * A remark is kept exactly as typed while the form is open - trimming it on every keystroke ate the
 * space typed at its end, so two words could only be split by going back. The server trims it when
 * the document is stored, as it does every other answer. Links and images are trimmed: neither holds
 * a space anybody meant.
 */
const remarkValue = (value) => String(value ?? "");
const hasRemark = (row) => remarkValue(row.remark).trim() !== "";

export function parseReferenceRows(value, { allowImages = false } = {}) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => ({
        link: compactReferenceValue(item?.link),
        remark: remarkValue(item?.remark),
        image: allowImages ? compactReferenceValue(item?.image) : "",
      })).filter((item) => item.link || hasRemark(item) || item.image);
    }
  } catch {
    // Older documents stored one pasted link per line. Keep them editable as rows.
  }
  return String(value).split(/\n+/).map((link) => ({ link: compactReferenceValue(link), remark: "", image: "" })).filter((item) => item.link);
}

export function stringifyReferenceRows(rows, { allowImages = false } = {}) {
  const clean = rows.map((row) => ({
    link: compactReferenceValue(row.link),
    remark: remarkValue(row.remark),
    image: allowImages ? compactReferenceValue(row.image) : "",
  })).filter((row) => row.link || hasRemark(row) || row.image);
  return clean.length ? JSON.stringify(clean) : "";
}

const REFERENCE_FIELDS = new Set(["photoReferenceLinks", "videoReferenceLinks", "otherReferenceLinks"]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A reference field's rows: the stored link and image, the remark as it is on screen when only trimmed. */
function mergeReferenceRows(latest, stored) {
  const onScreen = parseReferenceRows(latest, { allowImages: true });
  const kept = parseReferenceRows(stored, { allowImages: true });
  if (onScreen.length !== kept.length) return stored;
  return stringifyReferenceRows(kept.map((row, index) => ({
    ...row,
    remark: row.remark === onScreen[index].remark.trim() ? onScreen[index].remark : row.remark,
  })), { allowImages: true });
}

/**
 * What the form holds once a save answers: the server's stored document, but not at the cost of what
 * is on screen. The server trims every answer as it stores it, and handing that straight back on an
 * autosave ate a space typed at the end of a word the moment the writer paused; anything typed while
 * the save was on its way was lost the same way. So, answer by answer:
 *
 *   - changed on screen since it was sent - the screen's, the writer is still on it;
 *   - stored as the same text trimmed - the screen's, with its spaces;
 *   - otherwise - the stored one (a photo's data turned into its stored link, for one).
 *
 * `latest` is the form now, `sent` what the save sent, `stored` what the server answered.
 */
export function mergeSavedDocument(latest, sent, stored, key = "") {
  if (!same(latest, sent)) {
    if (latest && stored && typeof latest === "object" && typeof stored === "object" && !Array.isArray(latest)) {
      return Object.fromEntries([...new Set([...Object.keys(stored), ...Object.keys(latest)])]
        .map((field) => [field, field in latest ? mergeSavedDocument(latest[field], sent?.[field], stored[field], field) : stored[field]]));
    }
    return latest;
  }
  if (typeof latest === "string" && typeof stored === "string") {
    if (stored === latest.trim()) return latest;
    return REFERENCE_FIELDS.has(key) ? mergeReferenceRows(latest, stored) : stored;
  }
  if (latest && stored && typeof latest === "object" && typeof stored === "object" && !Array.isArray(latest) && !Array.isArray(stored)) {
    return Object.fromEntries([...new Set([...Object.keys(stored), ...Object.keys(latest)])]
      .map((field) => [field, field in stored ? mergeSavedDocument(latest[field], sent?.[field], stored[field], field) : latest[field]]));
  }
  return stored;
}

