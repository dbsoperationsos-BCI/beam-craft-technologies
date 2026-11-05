/**
 * How a quotation's shoot is named where its own details are shown - the shoot cards in the
 * Quotation Generator, the client's quotation and its PDF: the shoot, then the text added to it in
 * Add Shoot in brackets - "Rituals (Bride Varatham)" - or the shoot alone where none was added.
 *
 * The two are stored apart (`shoot` and `customText`) and only ever joined here, so the shoot's own
 * name is never rewritten: the Event Type header, packages, pricing and everything that matches on
 * the shoot keep reading `shoot` as they always have. A shoot saved before the field existed has no
 * `customText` and reads as it always did. Kept free of React so `node --test` can hold it.
 */

/** The custom text, trimmed, or "" where there is none - whitespace alone is none. */
export function shootCustomText(shoot) {
  return String(shoot?.customText ?? "").trim();
}

/** "Rituals (Bride Varatham)", or "Rituals" - never "Rituals ()". `fallback` names a shoot with no name. */
export function shootDisplayName(shoot, fallback = "") {
  const name = String(shoot?.shoot ?? "").trim() || fallback;
  const text = shootCustomText(shoot);
  return name && text ? `${name} (${text})` : name;
}
