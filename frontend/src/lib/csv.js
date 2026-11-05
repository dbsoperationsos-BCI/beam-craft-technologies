/**
 * A CSV file read into rows.
 *
 * Quoted values are honoured, including the doubled quote that escapes one inside a quoted field,
 * and both line endings are accepted - a file saved out of Excel on Windows arrives with `\r\n`.
 * The leading byte-order mark Excel writes is stripped, or the first heading would come back as
 * `﻿Name` and match nothing.
 *
 * Blank rows are dropped rather than returned as empty arrays: a trailing newline is how every CSV
 * ends and is not a row.
 *
 * For a file too large to hold as one string there is `streamCsvRows` below, which reads off the
 * stream a row at a time. This one is for the small files - a list of numbers, a template - where
 * holding the text is not the problem.
 */
export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const input = String(text || "").replace(/^﻿/, "");

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === "\"") {
      if (quoted && input[index + 1] === "\"") { value += "\""; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value.trim()); value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; value = "";
    } else value += character;
  }
  if (quoted) throw new Error(`CSV row ${rows.length + 1} has an unterminated quoted value.`);
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}


/*
 * ── Reading a file too large to hold as a string ────────────────────────────────────────────────
 *
 * `parseCsvRows` above takes the whole file as text, which is right for a list of numbers or a
 * template and wrong for a CRM export of half a million leads. This yields one row at a time
 * straight off the file stream, so the file is never held as a single string or a single parsed
 * array. `onBytesRead` reports how much has been consumed, which is what lets the import dialog
 * project a total while the file is still streaming instead of sitting on "calculating…".
 *
 * ── Why it is lenient ──
 *
 * Exported CSVs routinely contain quotes nobody escaped: `5" x 7"`, `Bad "quote here`, or a lone
 * `"` somebody typed at the start of a remark. A strict reader takes one of those as the start of a
 * quoted field and reads on to the next quote - or to the end of the file - swallowing every row in
 * between. Two rules keep one bad quote from costing more than its own row:
 *
 *   1. A quote only *opens* a field at the start of one, and a quote inside a quoted field only
 *      *closes* it when the next character is a comma, a line break or end-of-file. Anywhere else it
 *      is kept as literal text, so `5" x 7"` never opens anything.
 *   2. A line break inside a quoted field that **never closes** ends the row there, and the run
 *      gathered so far is re-split on commas - because those commas were separators after all.
 *
 * ── Rule 2 has to know, not guess ──
 *
 * A line break inside a *properly* quoted field is legal and ordinary - a remark typed over several
 * lines - so rule 2 turns on one question: does this quoted field ever close? It used to guess, from
 * a row-completeness test: if the fields already gathered plus the comma-pieces of the current value
 * reached the header's column count, the row was cut at the line break. That is true of almost every
 * genuine multi-line value, because Remarks is the second-to-last column of all three CRM templates,
 * so a single comma in a two-line remark was enough to cut the row - and a line break in the final
 * column needed no comma at all. It also meant the reverse: a quote that never closed and held few
 * commas failed the test at every line break and merged the rows after it into itself until the
 * count happened to add up, taking those rows out of the import entirely.
 *
 * Both halves of that showed up in one 32,880-row export. It imported as 33,569 leads - every
 * multi-line remark cut in two, the half after the break arriving as a lead of its own with the
 * remark's tail for a name - while individual days came up short, because rows had been swallowed by
 * a quote that opened above them.
 *
 * So the question is now answered by reading ahead for the closing quote rather than by counting
 * columns, and `MAX_LOOKAHEAD` bounds how far, so a file is still streamed rather than buffered.
 */

// How far ahead the reader will look for a closing quote before calling the field unclosed. Orders
// of magnitude more than any real cell, and small enough that one unclosed quote cannot pull the
// file into memory.
const MAX_LOOKAHEAD = 65536;

/**
 * Does the quoted field being read close somewhere ahead?
 *
 * `true` it closes, `false` it does not, and `null` for "there is not enough text buffered to say" -
 * which the caller answers by reading more of the file and asking again.
 *
 * A closing quote is one followed by a comma, a line break or the end of the file; `""` is the
 * escape for a literal quote and is stepped over rather than mistaken for one.
 */
function quoteClosesAhead(text, from, done) {
  const limit = Math.min(text.length, from + MAX_LOOKAHEAD);
  for (let at = from; at < limit; at += 1) {
    if (text[at] !== "\"") continue;
    const next = text[at + 1];
    if (next === "\"") { at += 1; continue; }
    // A quote at the very end of what has been read closes the field if the file ends there, and
    // says nothing at all if more is still coming.
    if (next === undefined) return done ? true : null;
    if (next === "," || next === "\n" || next === "\r") return true;
  }
  // The whole window went by without one, so nothing further along is going to change the answer.
  if (limit === from + MAX_LOOKAHEAD) return false;
  return done ? false : null;
}

export async function* streamCsvRows(file, onBytesRead) {
  const decoder = new TextDecoder("utf-8");
  const reader = file.stream().getReader();
  let bytesRead = 0;

  let buffer = "";
  let done = false;
  let row = [];
  let field = "";
  let inQuotes = false;
  // Set when the quoted field being read has absorbed a quote that closed nothing - the
  // `Bad "quote here` signature. Reset every time a quoted field opens. Read ahead alone cannot see
  // this one: the next properly quoted field further down the file would answer "yes, it closes".
  let strayQuote = false;

  const finishRow = () => {
    row.push(field);
    field = "";
    const value = row;
    row = [];
    return value;
  };

  for (;;) {
    if (!done) {
      const result = await reader.read();
      done = result.done;
      buffer += done ? decoder.decode() : decoder.decode(result.value, { stream: true });
      if (!done) {
        bytesRead += result.value?.byteLength || 0;
        onBytesRead?.(bytesRead);
      }
    }

    let index = 0;
    while (index < buffer.length) {
      const char = buffer[index];

      if (inQuotes) {
        if (char === "\"") {
          // Needs one character of lookahead; wait for more data unless this is the end.
          if (index + 1 >= buffer.length && !done) break;
          const next = buffer[index + 1];
          if (next === "\"") {
            // The doubled quote that escapes one inside a quoted field: well-formed, and so no
            // evidence at all about whether this field is broken.
            field += "\"";
            index += 2;
            continue;
          }
          if (next === undefined || next === "," || next === "\n" || next === "\r") {
            inQuotes = false;
            index += 1;
            continue;
          }
          // Stray quote in the middle of a quoted value: keep it as text, and remember it.
          field += "\"";
          strayQuote = true;
          index += 1;
          continue;
        }
        if (char === "\n" || char === "\r") {
          // The same one character of lookahead the unquoted branch takes, so a `\r\n` split across
          // two chunks is not read as two line breaks.
          if (char === "\r" && index + 1 >= buffer.length && !done) break;
          const closes = strayQuote ? false : quoteClosesAhead(buffer, index, done);
          // Undecided: leave `index` on the line break, read more of the file, and ask again.
          if (closes === null) break;
          if (!closes) {
            // Rule 2. The field's opening quote was never a quote, so every comma in the run was a
            // separator and the line break is the end of the row.
            const parts = field.split(",");
            for (let part = 0; part < parts.length - 1; part += 1) row.push(parts[part]);
            field = parts[parts.length - 1];
            inQuotes = false;
            if (char === "\r" && buffer[index + 1] === "\n") index += 1;
            index += 1;
            yield finishRow();
            continue;
          }
        }
        field += char;
        index += 1;
        continue;
      }

      if (char === "\"" && field === "") {
        inQuotes = true;
        strayQuote = false;
        index += 1;
        continue;
      }
      if (char === ",") {
        row.push(field);
        field = "";
        index += 1;
        continue;
      }
      if (char === "\r" || char === "\n") {
        if (char === "\r" && index + 1 >= buffer.length && !done) break;
        if (char === "\r" && buffer[index + 1] === "\n") index += 1;
        index += 1;
        yield finishRow();
        continue;
      }
      field += char;
      index += 1;
    }

    buffer = buffer.slice(index);
    if (done && buffer.length === 0) break;
    if (done && index === 0) break;
  }

  reader.releaseLock?.();

  if (field !== "" || row.length > 0) {
    const last = finishRow();
    if (last.some((cell) => String(cell || "").trim() !== "")) yield last;
  }
}
