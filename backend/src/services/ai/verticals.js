/**
 * What each vertical actually shoots.
 *
 * The studio runs three businesses under one CRM, and they have nothing to do with each other:
 *
 *   Dum Dum   weddings and engagements
 *   Qua Qua   newborn, baby and maternity
 *   Corp      corporate work
 *
 * The lead's `vertical` says which one it belongs to, and the CRM has always known this - a Dum Dum
 * lead carries `groomName` and `brideName`, a Qua Qua lead carries `babyOrMotherName` and
 * `dateOfBirthOrEdod`, a Corp lead carries `companyName` and `primaryDecisionMaker`. Nebula did not
 * know it, so it answered every lead as though it were a wedding: a Qua Qua mother booking a
 * newborn shoot was advised on candid coverage of her reception.
 *
 * That is not a prompt-tuning problem. The vertical is a fact on the row, so it is looked up here
 * and handed to the model as an instruction, the same way the language and every figure already
 * are. A model is never asked to work out which business it is talking about.
 */

const VERTICALS = {
  "dum dum": {
    name: "Dum Dum",
    shoots: "weddings and engagements",
    // Named so the model has the right words to hand, and the wrong ones clearly out of bounds.
    covers: "wedding day coverage, engagement and reception shoots, candid and traditional photography, wedding albums, save-the-date and pre-wedding shoots",
    never: "newborn, baby, maternity or corporate work",
  },
  "qua qua": {
    name: "Qua Qua",
    shoots: "newborn, baby and maternity",
    covers: "newborn shoots in the first weeks, baby milestone and birthday shoots, maternity and pre-delivery shoots, family shoots with the baby, baby albums and framed prints",
    never: "weddings, engagements, receptions or corporate work",
  },
  corp: {
    name: "Corp",
    shoots: "corporate work",
    covers: "conferences and company events, product and profile shoots, team and headshot sessions, launches and award nights, corporate video and event coverage",
    never: "weddings, engagements, newborn or baby work",
  },
};

/** The vertical a lead belongs to, or null when the value is empty or unrecognised. */
function verticalFor(value) {
  const key = String(value || "").trim().toLowerCase();
  return VERTICALS[key] || null;
}

/**
 * The instruction that keeps an answer inside the lead's own business.
 *
 * Written as a hard boundary rather than a hint. "This is a Qua Qua lead" leaves the model free to
 * talk about weddings anyway, because weddings are most of what any photography model has read;
 * naming what is out of bounds is what stops it.
 *
 * An unrecognised value produces nothing at all. Inventing a vertical for a blank field would be
 * worse than saying nothing: the model would then confidently advise on the wrong business.
 */
function verticalDirective(value) {
  const vertical = verticalFor(value);
  if (!vertical) return "";
  return [
    `This lead belongs to ${vertical.name}, which shoots ${vertical.shoots} ONLY.`,
    `Everything you suggest must relate to ${vertical.shoots}: ${vertical.covers}.`,
    `Never mention ${vertical.never} for this lead - that is a different business and would be wrong.`,
  ].join("\n");
}

/*
 * Asked about a vertical this session does not cover.
 *
 * The prompt already says to decline these, and the model does not reliably do it: on a Dum Dum
 * board, asked how many Qua Qua leads there were, it answered "Qua Qua leads: 0" - reading the zero
 * off a summary that had been filtered to Dum Dum. No data leaked, and the answer was still wrong in
 * the worst way, because "0" reads as an emptiness rather than an absence of access.
 *
 * So it is answered in code, the way greetings and out-of-scope questions already are. Names only:
 * a question about "weddings" on a Qua Qua board is a question about the work, which the prompt
 * handles well; a question naming another board is a question about data this session cannot see.
 */
const VERTICAL_NAMES = [
  ["dum dum", "Dum Dum"],
  ["dumdum", "Dum Dum"],
  ["qua qua", "Qua Qua"],
  ["ququa", "Qua Qua"],
  ["quaqua", "Qua Qua"],
  ["corp", "Corp"],
  ["corporate vertical", "Corp"],
];

/** The other vertical a question names, or null. */
function otherVerticalNamed(question, currentVertical) {
  const asked = String(question || "").toLowerCase();
  if (!asked) return null;
  const current = verticalFor(currentVertical)?.name || null;
  if (!current) return null;

  for (const [needle, name] of VERTICAL_NAMES) {
    if (name === current) continue;
    // Word-ish boundaries, so "corp" does not match inside "corporate album" or "incorporated".
    if (new RegExp(`(^|[^a-z])${needle}([^a-z]|$)`).test(asked)) return name;
  }
  return null;
}

/** What to say when a question names a vertical this session does not cover. */
function otherVerticalReply(currentVertical, otherName) {
  const current = verticalFor(currentVertical);
  return `I only have ${current?.name || "this vertical"} details here - ${current?.shoots || "this board"}. `
    + `Switch the CRM to ${otherName} and ask me again, and I will answer from there.`;
}

module.exports = { VERTICALS, verticalFor, verticalDirective, otherVerticalNamed, otherVerticalReply };
