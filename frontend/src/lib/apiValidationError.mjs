/**
 * What a refused save actually says, when the server said "Validation failed" and left the reason
 * in the body rather than in the one line every `apiRequest` failure carries as `.message`.
 *
 * Fifteen routes across the backend answer the same shaped 400 on a bad Zod parse:
 * `{ message: "Validation failed", errors: parsed.error.flatten() }`. `apiRequest` throws an Error
 * whose own `.message` is that literal string - useful for nothing, since it names no field - and
 * keeps the body on `.data`, where `errors.fieldErrors` is the part that does: `{ contactNumber:
 * ["Enter a valid phone number with its country code"], ... }`. Nothing read that far before this,
 * so a save refused for one malformed field surfaced as the bare sentence "Validation failed" and
 * the person editing the record had no way to tell which box was wrong.
 *
 * Free of React so it can be called from any screen's own catch block, the way `requestError.message`
 * already is everywhere.
 */

/** camelCase or snake_case to Title Case, for a field this caller has no label of its own for. */
function humanizeFieldName(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());
}

/**
 * The sentence to show for a request that failed, naming the fields a Zod validation error found
 * wrong where there are any - `labelByField` lets a caller show its own field labels ("Mobile
 * Number") rather than the wire key ("contactNumber"); a key missing from it falls back to a
 * humanized version of the key itself, so nothing is ever silently dropped.
 *
 * Anything else - a 401, a 404, a plain refusal with its own sentence already in `.message` - is
 * passed through untouched: this only has something to add when the server's own message was the
 * generic one that names no field.
 */
export function describeValidationError(error, fallback = "Unable to save.", labelByField = {}) {
  if (error?.message !== "Validation failed") return error?.message || fallback;
  const fieldErrors = error?.data?.errors?.fieldErrors;
  const entries =
    fieldErrors && typeof fieldErrors === "object"
      ? Object.entries(fieldErrors).filter(([, messages]) => Array.isArray(messages) && messages.length)
      : [];
  if (!entries.length) return fallback;
  return entries
    .map(([key, messages]) => `${labelByField[key] || humanizeFieldName(key)}: ${messages[0]}`)
    .join(" · ");
}
