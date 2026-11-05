/**
 * Word Chunk Search on the server - the same rule as `frontend/src/lib/wordChunks.mjs`.
 *
 * What is typed is split at spaces, and a row matches when **every** chunk appears in it somewhere,
 * in any order: "naidu lokesh" and "lok nai" find "Lokesh Naidu", "dbs 17" finds "DBS-17". Before
 * this a search matched the typed text as one piece, so the same name in the other order found
 * nothing. MySQL's default collation makes `contains` ignore case, as the screen's rule does.
 *
 *   where.AND = [...(where.AND || []), ...everyChunk(search, (chunk) => ({ OR: [
 *     { name: { contains: chunk } }, { email: { contains: chunk } },
 *   ] }))];
 *
 * `clauseFor(chunk)` is whatever one chunk must satisfy - usually "in any of these columns" - and
 * each chunk may be found in a different column, so "gmail lokesh" finds a name and an email.
 *
 * **A chunk is matched as the characters typed.** Prisma's `contains` becomes MySQL `LIKE '%…%'` and
 * does not escape what it is given, so a typed `%` matched every row and `_` any one character -
 * "file_name" found "fileXname", "100%" found "1000 photos". `everyChunk` hands each clause the chunk
 * with `\`, `%` and `_` escaped (`likeLiteral`), MySQL's default LIKE escape; a raw-SQL search
 * escapes its own pattern the same way. Every other character - quotes, `&`, `#`, brackets, slashes,
 * unicode - was always passed as a bound value and needs nothing.
 */

/** `text` as a LIKE literal: `\`, `%` and `_` escaped, so each matches itself and nothing else. */
function likeLiteral(text) {
  return String(text ?? "").replace(/[\\%_]/g, "\\$&");
}

/** The chunks of what was typed: "  Lok  NAI " → ["Lok", "NAI"]. Capped, so a pasted paragraph is not a 300-clause query. */
function wordChunks(query, max = 8) {
  return String(query ?? "").split(/\s+/).filter(Boolean).slice(0, max);
}

/** One Prisma clause per chunk, to AND together; [] for a blank search (no filter). Each chunk arrives LIKE-escaped. */
function everyChunk(query, clauseFor) {
  return wordChunks(query).map((chunk) => clauseFor(likeLiteral(chunk)));
}

/** The same question asked of text already in memory. */
function matchesWordChunks(text, query) {
  const chunks = wordChunks(query).map((chunk) => chunk.toLowerCase());
  if (!chunks.length) return true;
  const haystack = String(text ?? "").toLowerCase();
  return chunks.every((chunk) => haystack.includes(chunk));
}

module.exports = { wordChunks, everyChunk, matchesWordChunks, likeLiteral };
