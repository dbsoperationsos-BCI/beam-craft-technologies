/**
 * Word Chunk Search - how every filter and search box in the application matches what is typed.
 *
 * What is typed is split at spaces into chunks, and a value matches when **every** chunk appears in
 * it somewhere, in any order, ignoring case: "naidu lokesh" and "lok nai" both find "Lokesh Naidu",
 * "dbs 17" finds "DBS-17", "gmail lokesh" finds "lokesh.naidu41@gmail.com", and "lok xyz" finds
 * nothing. Before this a filter matched the typed text as one piece, so the same name typed in the
 * other order, or two halves of it, found nothing.
 *
 * The server asks the same question of the columns it filters (`backend/src/services/wordChunks.js`),
 * so a table filtered there reads the same as one filtered here.
 */

/** The chunks of what was typed, lowercased: "  Lok  NAI " → ["lok", "nai"]. */
export function wordChunks(query) {
  return String(query ?? "").toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Whether `text` holds every chunk of `query`. A blank query matches everything - an empty filter
 * is no filter. `text` may be several values joined, so one search can span a name and an email.
 */
export function matchesWordChunks(text, query) {
  const chunks = wordChunks(query);
  if (!chunks.length) return true;
  const haystack = String(text ?? "").toLocaleLowerCase();
  return chunks.every((chunk) => haystack.includes(chunk));
}
