/**
 * Filling a studio-written message from the record in front of it.
 *
 * The browser's half of `backend/src/services/messageTemplate.js`, and deliberately the same rules:
 * `{ this }` and `{this}` are one placeholder, names are matched folded, and a placeholder nothing
 * answers is **left exactly as typed** rather than blanked. A template still mentioning
 * `{invoice number}` is somebody mid-edit, and a sentence with a hole in it hides that in the one
 * place it is going to be read.
 *
 * Here rather than on the server because the two screens that use it - the onboarding invite and the
 * login credentials - already hold every fact the message needs at the moment they show it. Asking
 * the server to render would be a round-trip to be told what the dialog already knows. The cash
 * receipt is rendered server-side for the opposite reason: its figures are a query, not a prop.
 *
 * A pure helper with no API call in it, so it belongs in `lib` rather than `services`.
 */

/** `{ this }` and `{this}` are the same placeholder: names are matched folded and spaces collapsed. */
const fold = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Fills `body` from `values`, keyed by placeholder name.
 *
 * Values are read folded, so a template typed `{Candidate Name}` finds `candidate name`. A value of
 * `0` or an empty string is an answer and is used; only a placeholder nothing answers is left alone.
 *
 * The scan is a plain pass for `{name}` rather than a regular expression built out of the studio's
 * own text, so a stray `(`, `*` or `\` somebody types is text like everything else.
 */
export function renderTemplate(body, values = {}) {
  const answers = new Map(Object.entries(values || {}).map(([name, value]) => [fold(name), value]));
  return String(body || "").replace(/\{([^{}]+)\}/g, (whole, name) => {
    const answer = answers.get(fold(name));
    return answer === undefined || answer === null ? whole : String(answer);
  });
}

/**
 * The studio's wording filled in, or the built-in wording where there is none.
 *
 * The fallback is the point. A template row can be missing - a studio that migrated before this
 * shipped, a key somebody deleted - and a dialog whose whole purpose is handing over a link must not
 * answer with an empty box in that case. So the message the screen printed before it was a template
 * stays in the screen as what it falls back to.
 */
export function renderMessageOr(fallback, template, values) {
  const body = template?.body;
  return body ? renderTemplate(body, values) : fallback;
}
