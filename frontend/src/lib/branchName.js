import { matchesWordChunks } from "./wordChunks.mjs";

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
];

/**
 * And the fields of every account the branch holds, which are rows rather than columns on it.
 *
 * The four bank fields were on the branch itself and were simply four more names in the list above.
 * They are a list of accounts now, so a search has to read into the rows - without this, searching
 * the register by an account number or an IFSC stopped finding anything, silently, which is one of
 * the two things somebody searches a bank account by.
 */
const ACCOUNT_SEARCHABLE = ["accountHolderName", "bankName", "accountNumber", "ifscCode"];
const accountValuesOf = (branch) => (Array.isArray(branch?.bankAccounts) ? branch.bankAccounts : [])
  .flatMap((account) => ACCOUNT_SEARCHABLE.map((field) => account?.[field]));

const foldSpaces = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const digitsOf = (text) => String(text ?? "").replace(/\D/g, "");

/**
 * Whether one branch answers a search.
 *
 * Two passes, because two kinds of thing are being searched for. Text is matched by Word Chunk
 * Search across every field, so "erode  tn" and "tn erode" find "Erode TN". A query that is only digits and
 * punctuation is *also* matched against the digits of every field, so "98765 43210" finds a phone
 * stored as "9876543210" and a part of an account number finds the account — the way somebody
 * reads a number off a statement rather than the way it happens to be stored.
 *
 * An empty query matches everything: a search box nobody has typed in hides nothing.
 */
export function branchMatchesSearch(branch, query) {
  const wanted = foldSpaces(query);
  if (!wanted) return true;
  const values = [...SEARCHABLE.map((field) => branch?.[field]), ...accountValuesOf(branch)].filter(Boolean);
  // Word Chunk Search across every field: "erode tn", "tn erode" and "erode hdfc" all find it.
  if (matchesWordChunks(values.join(" "), wanted)) return true;
  const wantedDigits = digitsOf(query);
  if (!wantedDigits || /[a-z]/i.test(query)) return false;
  return values.some((value) => digitsOf(value).includes(wantedDigits));
}

/** The branches a search keeps, in the order they came. */
export const branchesMatchingSearch = (branches, query) => (branches || []).filter((branch) => branchMatchesSearch(branch, query));

/*
 * ── Matching text to the register ──────────────────────────────────────────────────────────────
 *
 * The short forms the studio has always written for its branches. These are *spellings of a city*,
 * not branch names: the branch they land on is whichever row of the register is in that city, read
 * at the moment of asking. Holding branch names here instead was the fault this replaces - a map
 * of six names typed into the browser, so a branch renamed in Settings went on being "translated"
 * to what it used to be called, and Create Project's dropdown then refused it.
 */
const CITY_SHORTHAND = {
  cbe: "coimbatore",
  blr: "bangalore",
  hyd: "hyderabad",
  tpr: "tiruppur",
  vskp: "visakhapatnam",
  vizag: "visakhapatnam",
};

/**
 * The register's own spelling for a piece of branch text, or "" when the register has no single
 * answer.
 *
 * `names` is the list a picker offers - branch names, or `{ name }` rows. The text is taken as the
 * full name, then as the name without its state ("Erode" for "Erode TN"), then as a city or one of
 * the short forms above. Two branches in one city are ambiguous and answer "", the way the backend
 * matcher treats two employees with one name: a blank the person fills in beats a guess.
 */
export function resolveBranchName(text, names = []) {
  const wanted = foldSpaces(text);
  if (!wanted) return "";
  const list = (names || []).map((item) => String(item?.name ?? item ?? "").trim()).filter(Boolean);
  const exact = list.find((name) => foldSpaces(name) === wanted);
  if (exact) return exact;
  const byLabel = list.find((name) => foldSpaces(branchLabel(name)) === wanted);
  if (byLabel) return byLabel;
  const city = CITY_SHORTHAND[wanted] || wanted;
  const inCity = list.filter((name) => foldSpaces(branchLabel(name)) === city || foldSpaces(name).startsWith(`${city} `));
  return inCity.length === 1 ? inCity[0] : "";
}
