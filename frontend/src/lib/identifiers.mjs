/**
 * Every identifier the studio hands out, as the browser needs to read one.
 *
 *     DBS - <what it is> - <vertical> - <branch> - <number>
 *
 * with the middle two present only where they mean something: `DBS-EID-QQ-ERD-000001` for a Qua Qua
 * lead in Erode, `DBS-ASMGMT-ERD-000001` for an asset that lives at a branch but serves every
 * vertical, `DBS-VNMGMT-000001` for a vendor that belongs to the studio itself.
 *
 * The server mints them - `backend/src/services/identifiers.js`, which also owns the counters - and
 * this file is the same rules stated for the screen: what a valid identifier looks like, which
 * branch and vertical one is carrying, and what the next one will read as before it is taken.
 *
 * The two files are held to each other by `frontend/test/identifiers.test.mjs`, which reads both.
 * If they drift, an id the server writes is one a form here refuses - a record that saves and then
 * cannot be edited, which is the hardest kind of fault to see.
 *
 * `.mjs` and no imports, so plain `node --test` can hold the rules to account without a bundler.
 */

/*
 * The branches, and every spelling one arrives under.
 *
 * The physical branch is free text almost everywhere in this application, written by four different
 * producers - the app's own pickers, CSV import, Google Sheets and the Callyzer webhook - so one
 * branch arrives as "Erode", "Erode TN", "erode" and "Erode, Tamil Nadu". Matching is on a folded
 * form so all of them read as the same branch.
 */
export const BRANCHES = [
  { code: "ERD", name: "Erode", aliases: ["erode", "erd", "erodetn", "erodetamilnadu"] },
  { code: "BLR", name: "Bangalore", aliases: ["bangalore", "blr", "bengaluru", "bangaloreka", "bangalorekarnataka", "bengalurukarnataka"] },
  { code: "CBE", name: "Coimbatore", aliases: ["coimbatore", "cbe", "coimbatoretn", "coimbatoretamilnadu"] },
  { code: "HYD", name: "Hyderabad", aliases: ["hyderabad", "hyd", "hyderabadtl", "hyderabadtelangana"] },
  { code: "TUP", name: "Tiruppur", aliases: ["tiruppur", "tup", "tpr", "tirupur", "tiruppurtn", "tiruppurtamilnadu", "tirupurtamilnadu"] },
  // The studio says Vizag; the city is Visakhapatnam, and the HR branch list spells it that way.
  { code: "VIZAG", name: "Vizag", aliases: ["vizag", "visakhapatnam", "vizagap", "visakhapatnamap", "visakhapatnamandhrapradesh"] },
];

// Erode is the head branch, and a deliberate fallback rather than a refusal: a record that names no
// branch still has to be saveable. A wrongly-branched code can be read and corrected.
export const DEFAULT_BRANCH_CODE = "ERD";

export const VERTICALS = [
  { code: "DD", name: "Dum Dum", aliases: ["dumdum", "dd", "wed", "wedding"] },
  { code: "QQ", name: "Qua Qua", aliases: ["quaqua", "qq"] },
  { code: "CORP", name: "Corp", aliases: ["corp", "corporate", "corporation"] },
];

export const DEFAULT_VERTICAL_CODE = "DD";

/** Lowercased with every separator dropped, so one branch cannot read as two. */
export function fold(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function lookup(table, value, fallback) {
  const key = fold(value);
  if (!key) return fallback;
  const found = table.find((entry) => fold(entry.code) === key || fold(entry.name) === key || entry.aliases.includes(key));
  return found ? found.code : fallback;
}

/** The branch code for whatever the record calls its branch. Never throws, never blank. */
export const branchCode = (value) => lookup(BRANCHES, value, DEFAULT_BRANCH_CODE);

/** The vertical code for whatever the record calls its vertical. Never throws, never blank. */
export const verticalCode = (value) => lookup(VERTICALS, value, DEFAULT_VERTICAL_CODE);

export const branchName = (code) => BRANCHES.find((entry) => entry.code === code)?.name || "";
export const verticalName = (code) => VERTICALS.find((entry) => entry.code === code)?.name || "";

/*
 * The schemes.
 *
 * `parts` is what goes between the tag and the number: the vertical, the branch, or neither.
 * `width` is the zero padding - employees are the one exception, unpadded, because DBS-1 is how the
 * staff list has always been read out.
 *
 * The branch is **shown but not counted by**. A vertical runs one sequence across all of its
 * branches, so Dum Dum reads `…-DD-ERD-000001`, `…-DD-ERD-000002`, `…-DD-CBE-000003` - the
 * Coimbatore lead carrying on the same run rather than restarting at one. The number then says how
 * many enquiries that vertical has taken, and the branch code beside it still says where each came
 * from. The counters live on the server (`countedParts` in `backend/src/services/identifiers.js`);
 * this file only has to render and read the strings.
 */
export const SCHEMES = {
  EMPLOYEE: { tag: "", parts: [], width: 0, label: "Employee ID" },
  CRM_LEAD: { tag: "EID", parts: ["vertical", "branch"], width: 6, label: "Enquiry ID" },
  // A Callyzer call, before anybody has said which vertical it is - so neither part is carried.
  // It becomes an enquiry, and takes an `EID`, only when somebody adds the caller as a lead.
  // `CLID` rather than `CID`: read aloud beside `EID` the old tag was one syllable from it, and a
  // Call ID heard as an Enquiry ID sends somebody looking for a lead nobody ever created.
  CALL_LOG: { tag: "CLID", parts: [], width: 6, label: "Call ID" },
  // Sales Manager's Booking and Project Management's Project are one record with one identifier;
  // there is no separate project number, and the studio quotes this from the sale to delivery.
  SALES_PROJECT: { tag: "BK", parts: ["vertical", "branch"], width: 6, label: "Event ID" },
  PROJECT_SHOOT: { tag: "SID", parts: ["vertical", "branch"], width: 6, label: "Shoot ID" },
  QUOTATION: { tag: "QO", parts: ["vertical", "branch"], width: 6, label: "Quotation No." },
  CRD_DOCUMENT: { tag: "CRD", parts: ["vertical"], width: 6, label: "CRD ID" },
  IMAGE_SELECTION: { tag: "VCIS", parts: [], width: 6, label: "Project ID" },
  CASH_SPENT: { tag: "MS", parts: ["vertical", "branch"], width: 6, label: "Entry ID" },
  CASH_RECEIVED: { tag: "MR", parts: ["vertical", "branch"], width: 6, label: "Entry ID" },
  ASSET: { tag: "ASMGMT", parts: ["branch"], width: 6, label: "Asset ID" },
  // One employee introducing another: neither a vertical nor a branch, since both people belong to
  // the studio rather than to a board or an office.
  EMPLOYEE_REFERRAL: { tag: "REF", parts: [], width: 6, label: "Referral ID" },
  VENDOR: { tag: "VNMGMT", parts: [], width: 6, label: "Vendor ID" },
  CLIENT_STORAGE: { tag: "STOMGMT", parts: [], width: 6, label: "Storage ID" },
  // Neither a vertical nor a branch: confidential to HR, studio-wide. Five digits, not six.
  SPEAK_UP: { tag: "SPK", parts: [], width: 5, label: "Speak-up ID" },
};

/** The codes a scheme's identifier carries, in order, read through the aliases above. */
export function schemeParts(scheme, { vertical, branch } = {}) {
  const definition = SCHEMES[scheme];
  if (!definition) throw new Error(`Unknown identifier scheme: ${scheme}`);
  return definition.parts.map((part) => (part === "vertical" ? verticalCode(vertical) : branchCode(branch)));
}

/** One identifier, at a given number - what the server will write, rendered here. */
export function formatIdentifier(scheme, context, value) {
  const definition = SCHEMES[scheme];
  if (!definition) throw new Error(`Unknown identifier scheme: ${scheme}`);
  const number = definition.width ? String(value).padStart(definition.width, "0") : String(value);
  return ["DBS", definition.tag, ...schemeParts(scheme, context), number].filter(Boolean).join("-");
}

/**
 * Whether a string is an identifier of this scheme, and what it is made of.
 *
 * `null` when it is not one, which is what a form validates against and what lets a screen show the
 * branch a record belongs to without having to fetch it.
 */
export function parseIdentifier(scheme, value) {
  const definition = SCHEMES[scheme];
  if (!definition) throw new Error(`Unknown identifier scheme: ${scheme}`);
  const parts = String(value ?? "").trim().split("-");
  // "DBS", the tag where the scheme has one, one segment per part, and the number.
  if (parts.length !== 1 + (definition.tag ? 1 : 0) + definition.parts.length + 1) return null;
  if (parts[0] !== "DBS") return null;
  let index = 1;
  if (definition.tag) {
    if (parts[index] !== definition.tag) return null;
    index += 1;
  }
  const context = {};
  for (const part of definition.parts) {
    const codes = (part === "vertical" ? VERTICALS : BRANCHES).map((entry) => entry.code);
    if (!codes.includes(parts[index])) return null;
    context[part] = parts[index];
    index += 1;
  }
  const number = parts[index];
  if (!/^\d+$/.test(number)) return null;
  if (definition.width && number.length !== definition.width) return null;
  return { ...context, value: Number(number) };
}

/**
 * A loose test that a string is one of the studio's identifiers, whichever scheme it belongs to.
 *
 * For the places that take an id without caring which kind it is - a search box, a route parameter,
 * a bulk selection. Where the kind is known, `parseIdentifier` is the stricter answer.
 */
export const IDENTIFIER_PATTERN = /^DBS(-[A-Z]+)*-\d+$/;

export const isIdentifier = (value) => IDENTIFIER_PATTERN.test(String(value ?? "").trim());

/** The example an empty field shows, so a form says what shape it wants. */
export const identifierPlaceholder = (scheme, context) => formatIdentifier(scheme, context, 1);
