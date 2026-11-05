/**
 * A branch written the way the studio says it, without the state the master data appends.
 *
 * The locations table stores "Erode TN" and "Bangalore KA". The state belongs in the record — the
 * row's `code` (ERODE_TN) is built from it, and two branches could one day share a city name — but
 * nobody says it out loud, and a picker of six branches does not need it to tell them apart.
 *
 * Display only. The stored value is never rewritten, so every filter, saved record, generated
 * identifier and branch-scoped query still matches on exactly what the database holds. Anything
 * that travels back to the server must be the original name, not this.
 *
 * Only a trailing token that is a real state code is dropped, checked against the list below rather
 * than against "any two capitals" — that looser rule would quietly turn a branch called "Head
 * Office HQ" into "Head Office".
 */

/** The state and union-territory codes an Indian branch name may end with. */
const STATE_CODES = new Set([
  "AN", "AP", "AR", "AS", "BR", "CG", "CH", "DD", "DL", "DN", "GA", "GJ", "HP", "HR", "JH", "JK",
  "KA", "KL", "LA", "LD", "MH", "ML", "MN", "MP", "MZ", "NL", "OD", "OR", "PB", "PY", "RJ", "SK",
  "TG", "TL", "TN", "TR", "UK", "UP", "UT", "WB",
]);

/** "Erode TN" reads as "Erode"; "Remote" and "Head Office HQ" are left exactly as they are. */
export function branchLabel(name) {
  const text = String(name ?? "").trim();
  const match = text.match(/^(.*\S)\s+([A-Za-z]{2})$/);
  if (!match) return text;
  return STATE_CODES.has(match[2].toUpperCase()) ? match[1] : text;
}

/** The same, for a `{ id, name }` row from the locations master data. */
export const branchOptionLabel = (branch) => branchLabel(branch?.name);

/*
 * ── Searching the branch register ─────────────────────────────────────────────────────────────
 *
 * Settings → Organization → Branches holds the whole register in the browser — a studio has a
 * handful of branches, not thousands — so the search narrows what is already there rather than
 * asking the server again. Every field a person might look a branch up by is searched, not just
 * the name: somebody with an IFSC on a bank statement, or a GSTIN on an invoice, is trying to find
 * out which branch it belongs to.
 */

/** The fields a search reads. `code` is included: it is what the rest of the application matches on. */
const SEARCHABLE = [
  "name", "code", "address", "description",
  "gstNumber", "panNumber", "phone", "alternatePhone", "email",
  "bankAccountName", "bankName", "bankAccountNumber", "bankIfsc",
];

const foldSpaces = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const digitsOf = (text) => String(text ?? "").replace(/\D/g, "");

/**
 * Whether one branch answers a search.
 *
 * Two passes, because two kinds of thing are being searched for. Text is matched case-insensitively
 * with runs of whitespace folded, so "erode  tn" finds "Erode TN". A query that is only digits and
 * punctuation is *also* matched against the digits of every field, so "98765 43210" finds a phone
 * stored as "9876543210" and a part of an account number finds the account — the way somebody
 * reads a number off a statement rather than the way it happens to be stored.
 *
 * An empty query matches everything: a search box nobody has typed in hides nothing.
 */
export function branchMatchesSearch(branch, query) {
  const wanted = foldSpaces(query);
  if (!wanted) return true;
  const values = SEARCHABLE.map((field) => branch?.[field]).filter(Boolean);
  if (values.some((value) => foldSpaces(value).includes(wanted))) return true;
  const wantedDigits = digitsOf(query);
  if (!wantedDigits || /[a-z]/i.test(query)) return false;
  return values.some((value) => digitsOf(value).includes(wantedDigits));
}

/** The branches a search keeps, in the order they came. */
export const branchesMatchingSearch = (branches, query) => (branches || []).filter((branch) => branchMatchesSearch(branch, query));
