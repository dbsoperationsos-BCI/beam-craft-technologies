const prisma = require("../config/db");

/*
 * ── Every identifier the studio hands out ──────────────────────────────────────────────────────
 *
 * A lead, a booking, a quotation, an asset, a cash entry: each is known by a code somebody reads
 * out over the phone, and until now each module invented its own - `DBS-DD-EID-4867`, `DBS-EVT-
 * 00005`, `QT-00001`, `AST-000001`, `VEN-000001`, `SM-000001`, `RCP-000001`. Seven shapes for one
 * idea, none of which said which branch or which vertical the record belonged to.
 *
 * They are now one shape, defined once here:
 *
 *     DBS - <what it is> - <vertical> - <branch> - <number>
 *
 * with the middle two present only where they mean something. A vendor belongs to the studio rather
 * than to a vertical, so it is `DBS-VNMGMT-000001`; an asset lives at a branch but serves every
 * vertical, so it is `DBS-ASMGMT-ERD-000001`; a lead is both, so it is `DBS-EID-QQ-ERD-000001`.
 *
 * ── Why one module ──
 *
 * Because the number is per *vertical*, not per module. Qua Qua's leads run 1, 2, 3 … across every
 * branch it sells from, and the only way that stays true is for one counter to be addressed by the
 * same key every time it is asked. Eleven modules each deriving their own key from their own idea of
 * what "Qua Qua" is called is how one vertical quietly ends up with two sequences - and a duplicate
 * identifier is not something the studio finds out about gently.
 *
 * The branch is shown in the identifier but never counted by; see `countedParts` below for why.
 *
 * So: the branch aliases, the vertical aliases, the templates and the counter all live here, and a
 * module asks for `nextIdentifier("CRM_LEAD", { vertical, branch })` and is handed a string.
 *
 * `frontend/src/lib/identifiers.mjs` states the same rules for the browser - it has to know what a
 * valid identifier looks like to validate one and how to read a branch out of one to show it -
 * and `identifiers.test.js` holds the two files to each other.
 */

/*
 * ── The branches, and every spelling one arrives under ────────────────────────────────────────
 *
 * The physical branch is free text almost everywhere in this application (see the note in
 * CLAUDE.md: only `User` and `Asset` carry a real `branchId`), and four different producers write
 * it - the app's own pickers, CSV import, Google Sheets and the Callyzer webhook. So one branch
 * arrives as "Erode", "Erode TN", "erode", "Erode, Tamil Nadu" and as its own code "ERD", and all
 * five have to reach the same counter.
 *
 * Matching is on a folded form - lowercased, and everything that is not a letter or digit removed -
 * so "Erode, Tamil Nadu" and "erodetamilnadu" are the same key and a new punctuation habit in some
 * other module cannot quietly open a second sequence.
 */
const BRANCHES = [
  { code: "ERD", name: "Erode", aliases: ["erode", "erd", "erodetn", "erodetamilnadu"] },
  { code: "BLR", name: "Bangalore", aliases: ["bangalore", "blr", "bengaluru", "bangaloreka", "bangalorekarnataka", "bengalurukarnataka"] },
  { code: "CBE", name: "Coimbatore", aliases: ["coimbatore", "cbe", "coimbatoretn", "coimbatoretamilnadu"] },
  { code: "HYD", name: "Hyderabad", aliases: ["hyderabad", "hyd", "hyderabadtl", "hyderabadtelangana"] },
  { code: "TUP", name: "Tiruppur", aliases: ["tiruppur", "tup", "tpr", "tirupur", "tiruppurtn", "tiruppurtamilnadu", "tirupurtamilnadu"] },
  // The studio says Vizag; the city is Visakhapatnam, and the HR branch list spells it that way.
  { code: "VIZAG", name: "Vizag", aliases: ["vizag", "visakhapatnam", "vizagap", "visakhapatnamap", "visakhapatnamandhrapradesh"] },
];

/*
 * The branch a record falls back to when it names none.
 *
 * Erode is the head branch, and it is a deliberate fallback rather than a refusal: a lead can reach
 * this application from the Callyzer webhook with nothing on it at all, and an identifier that
 * cannot be minted is a record that cannot be saved. A wrongly-branched code can be read and
 * corrected; a lost enquiry cannot.
 */
const DEFAULT_BRANCH_CODE = "ERD";

/*
 * ── The verticals ──
 *
 * The same three the CRM board is split by, folded the same way `VERTICAL_SQL` in
 * leadQueryService.js folds them - so a lead's identifier and the board it sits on cannot disagree
 * about which vertical it is.
 */
const VERTICALS = [
  { code: "DD", name: "Dum Dum", aliases: ["dumdum", "dd", "wed", "wedding"] },
  { code: "QQ", name: "Qua Qua", aliases: ["quaqua", "qq"] },
  { code: "CORP", name: "Corp", aliases: ["corp", "corporate", "corporation"] },
];

// Dum Dum, for the same reason `VERTICAL_SQL` answers Dum Dum for a blank branch: it is what the
// rest of the application already reads an unnamed vertical as.
const DEFAULT_VERTICAL_CODE = "DD";

/** Lowercased with every separator dropped, so one branch cannot open two sequences. */
function fold(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function lookup(table, value, fallback) {
  const key = fold(value);
  if (!key) return fallback;
  const found = table.find((entry) => fold(entry.code) === key || fold(entry.name) === key || entry.aliases.includes(key));
  return found ? found.code : fallback;
}

/** The branch code for whatever the record calls its branch. Never throws, never blank. */
function branchCode(value) {
  return lookup(BRANCHES, value, DEFAULT_BRANCH_CODE);
}

/** The vertical code for whatever the record calls its vertical. Never throws, never blank. */
function verticalCode(value) {
  return lookup(VERTICALS, value, DEFAULT_VERTICAL_CODE);
}

const branchName = (code) => BRANCHES.find((entry) => entry.code === code)?.name || "";
const verticalName = (code) => VERTICALS.find((entry) => entry.code === code)?.name || "";

/*
 * ── The schemes ───────────────────────────────────────────────────────────────────────────────
 *
 * `parts` is what goes between the tag and the number: the vertical, the branch, or neither.
 *
 * `width` is the zero padding. Employees are the one exception in the studio's own hand: DBS-1,
 * DBS-2, unpadded, because that is how the staff list has always been read out.
 */
const SCHEMES = {
  // (i) Employee Repository. No vertical, no branch: a person is the studio's, not a board's.
  EMPLOYEE: { tag: "", parts: [], width: 0, model: "employee", field: "employeeId" },
  // (ii) Leads & Followups.
  CRM_LEAD: { tag: "EID", parts: ["vertical", "branch"], width: 6, model: "salesCrmLead", field: "enquiryId" },
  /*
   * (ii-a) A Callyzer call, which is not an enquiry yet.
   *
   * Calls used to be minted an `EID` on arrival, because the webhook turned every one of them into
   * a lead - so the studio's enquiry numbers counted its missed calls, and a number quoted to a
   * client stood beside a hundred that named nobody. A call now gets a code of its own and keeps it
   * for life; the `EID` is minted only when somebody reads the caller and adds them as a lead.
   *
   * No vertical and no branch: which of the three businesses a call belongs to is precisely the
   * question the Calls board exists to answer, and a code that guessed would be guessing in the one
   * place the studio reads out loud.
   */
  /*
   * `CLID`, not `CID`. It was `CID` and it read too close to the `EID` beside it in the one place
   * both are read out loud - "see-eye-dee" against "ee-eye-dee" over a phone - and a Call ID quoted
   * as an Enquiry ID sends whoever heard it looking for a lead that does not exist. `CLID` is the
   * call it names. Every code already minted is rewritten to it once, by `renameCallIdTag` in
   * ../modules/sales/crm-leads/callLogService.js, so there is one format on the board and not two.
   */
  CALL_LOG: { tag: "CLID", parts: [], width: 6, model: "", field: "" },
  /*
   * (iii) Bookings & Converted - a project, which is a booking that came off a lead.
   *
   * The same record Project Management calls a Project: Sales Manager books it and Project
   * Management works it, and both read this one identifier off the one row. There is no separate
   * project number, and there should not be - the studio quotes one code from the sale to delivery.
   */
  SALES_PROJECT: { tag: "BK", parts: ["vertical", "branch"], width: 6, model: "salesProject", field: "eventId" },
  // A shoot - one day's work inside a project. Its own run per vertical, because the studio counts
  // and rosters shoots rather than projects, and reads this code out on the floor.
  PROJECT_SHOOT: { tag: "SID", parts: ["vertical", "branch"], width: 6, model: "projectShoot", field: "shootId" },
  // (iv) Quotations.
  QUOTATION: { tag: "QO", parts: ["vertical", "branch"], width: 6, model: "salesQuotation", field: "quotationNumber" },
  /*
   * (v) CRD Documents. Vertical but no branch, and only ever Dum Dum or Qua Qua - a Customer
   * Identification Document is asked of a wedding or a child's shoot, never of a company.
   */
  CRD_DOCUMENT: { tag: "CRD", parts: ["vertical"], width: 6, model: "salesProjectCrdDocument", field: "documentCode" },
  // (vi) Image Selection. One studio-wide run of numbers: a gallery belongs to the client, and the
  // project behind it already says which branch and vertical it came from.
  IMAGE_SELECTION: { tag: "VCIS", parts: [], width: 6, model: "imageSelectionProject", field: "projectCode" },
  // (vii) and (viii) Accounts. Money Spent and Money Received, counted apart.
  CASH_SPENT: { tag: "MS", parts: ["vertical", "branch"], width: 6, model: "cashEntry", field: "entryId" },
  CASH_RECEIVED: { tag: "MR", parts: ["vertical", "branch"], width: 6, model: "cashEntry", field: "entryId" },
  // (ix) Asset Management. An asset sits at a branch and serves every vertical there.
  ASSET: { tag: "ASMGMT", parts: ["branch"], width: 6, model: "asset", field: "assetCode" },
  /*
   * (ix-a) Employee Referral. Neither a vertical nor a branch: a referral is one employee
   * introducing another, and both belong to the studio rather than to a board or an office. One run
   * of numbers for the whole studio, in the order the referrals were recorded, which is what the
   * register is read in.
   */
  EMPLOYEE_REFERRAL: { tag: "REF", parts: [], width: 6, model: "employeeReferral", field: "referralId" },
  // (x) Vendor Management, and (xi) Client Storage. Neither belongs to a branch or a vertical.
  VENDOR: { tag: "VNMGMT", parts: [], width: 6, model: "assetVendor", field: "vendorId" },
  CLIENT_STORAGE: { tag: "STOMGMT", parts: [], width: 6, model: "clientStorage", field: "storageId" },
};

/*
 * ── What the number counts, which is not what the identifier shows ────────────────────────────
 *
 * The branch is **shown** but never **counted by**. A vertical runs one sequence across all of its
 * branches, so Dum Dum reads
 *
 *     DBS-EID-DD-ERD-000001
 *     DBS-EID-DD-ERD-000002
 *     DBS-EID-DD-CBE-000003      <- a Coimbatore lead, carrying on the same run
 *     DBS-EID-DD-VIZAG-000004
 *
 * rather than each branch restarting at 000001. The number then says how many enquiries that
 * vertical has taken, which is the question the studio actually asks of it, and the branch code
 * beside it still says where each one came from. Counting per branch instead gave five leads all
 * numbered 000001, which reads as five copies of the same record.
 *
 * So: drop the branch, keep everything else. Derived here rather than listed on each scheme,
 * because a second list is a second thing to forget - a scheme that showed a branch and quietly
 * counted by it would put two leads on the same number, and nothing on screen would say so.
 *
 * A scheme with no vertical either - an asset, which lives at a branch and serves every vertical
 * there - is left counting once for the whole studio, which is the same statement made at the top.
 */
function countedParts(scheme) {
  return SCHEMES[scheme].parts.filter((part) => part !== "branch");
}

/**
 * The codes a scheme's identifier actually carries, in order.
 *
 * Read through `branchCode` / `verticalCode` rather than taken as given, so a caller may hand this
 * whatever the record holds - "Coimbatore, Tamil Nadu", "quaqua", null - and get back the two
 * letters the identifier is built from.
 */
function schemeParts(scheme, { vertical, branch } = {}) {
  const definition = SCHEMES[scheme];
  if (!definition) throw new Error(`Unknown identifier scheme: ${scheme}`);
  return definition.parts.map((part) => (part === "vertical" ? verticalCode(vertical) : branchCode(branch)));
}

/**
 * One identifier, at a given number.
 *
 * Separate from the counter so the same rule renders an existing row's new code during a backfill,
 * previews the next one on screen, and mints a live one - three callers that must not be able to
 * disagree about what the string looks like.
 */
function formatIdentifier(scheme, context, value) {
  const definition = SCHEMES[scheme];
  if (!definition) throw new Error(`Unknown identifier scheme: ${scheme}`);
  const number = definition.width ? String(value).padStart(definition.width, "0") : String(value);
  return ["DBS", definition.tag, ...schemeParts(scheme, context), number].filter(Boolean).join("-");
}

/**
 * The counter this identifier is drawn from.
 *
 * The scheme and the codes it counts by - which is `countedParts`, the identifier's parts without
 * the branch. So all of Qua Qua draws from one counter however many branches its leads come from.
 * Built from the folded codes rather than from the caller's raw text for the reason at the top of
 * this file: two spellings of one vertical must reach one key.
 */
function sequenceKey(scheme, context = {}) {
  const codes = countedParts(scheme).map((part) => (part === "vertical" ? verticalCode(context.vertical) : branchCode(context.branch)));
  return [scheme, ...codes].join(":");
}

/** Every counter this scheme could be drawing from, one per combination it counts by. */
function sequenceKeysFor(scheme) {
  const axes = countedParts(scheme).map((part) => (part === "vertical" ? VERTICALS : BRANCHES).map((entry) => entry.code));
  return axes.reduce(
    (keys, codes) => keys.flatMap((key) => codes.map((code) => `${key}:${code}`)),
    [scheme],
  );
}

/**
 * The context a counter key stands for - the inverse of `sequenceKey`.
 *
 * For the two callers that hold a key and need to advance the counter it names: the sheet sync's
 * allocator, and the renumbering script. Reading the codes back out beats rebuilding them from the
 * scheme by hand, which is how one of them would come to disagree with `countedParts` after a
 * scheme changed shape.
 */
function contextFromKey(scheme, key) {
  const codes = String(key).split(":").slice(1);
  return Object.fromEntries(countedParts(scheme).map((part, index) => [part, codes[index]]));
}

/**
 * The next identifier for this scheme and this combination.
 *
 * `client` is a Prisma client or an open transaction. Pass the transaction wherever the record is
 * written inside one: the counter has to move with the row, or a failed create leaves a number
 * spent and the studio reading a gap in its own books.
 *
 * The upsert is one statement, so two people saving at the same moment take two numbers rather than
 * the same one - the property this whole module exists to keep.
 */
async function nextIdentifier(scheme, context = {}, client = prisma) {
  const key = sequenceKey(scheme, context);
  const row = await client.appSequence.upsert({
    where: { key },
    create: { key, currentValue: 1 },
    update: { currentValue: { increment: 1 } },
  });
  return formatIdentifier(scheme, context, row.currentValue);
}

/**
 * What the next identifier would be, without taking it.
 *
 * For the screens that show somebody their new Employee ID before they have finished typing the
 * name. Deliberately not a reservation: two people opening the form at once are shown the same
 * number, and whichever saves first gets it. Reserving instead would burn a number every time
 * somebody opened a form and changed their mind, and the studio reads these numbers as a count.
 */
async function peekIdentifier(scheme, context = {}, client = prisma) {
  const row = await client.appSequence.findUnique({ where: { key: sequenceKey(scheme, context) }, select: { currentValue: true } });
  return formatIdentifier(scheme, context, (row?.currentValue || 0) + 1);
}

/**
 * Moves a counter up to `value` if it is behind, and never back.
 *
 * Used by the backfill, which writes a run of identifiers itself and then has to leave the counter
 * where the live path can carry on from. Never lowers one: a counter that went backwards would hand
 * out a number that is already on a record.
 */
async function advanceSequence(scheme, context, value, client = prisma) {
  const key = sequenceKey(scheme, context);
  const next = Math.max(0, Math.trunc(Number(value) || 0));
  const row = await client.appSequence.upsert({
    where: { key },
    create: { key, currentValue: next },
    update: {},
  });
  if (row.currentValue >= next) return row.currentValue;
  const raised = await client.appSequence.update({ where: { key }, data: { currentValue: next } });
  return raised.currentValue;
}

/**
 * Whether a string is an identifier of this scheme, and what it is made of.
 *
 * `null` when it is not one - which is how the backfill tells a code it has already written from
 * one of the old shapes still to be replaced, and how a route refuses an id it was never given.
 */
function parseIdentifier(scheme, value) {
  const definition = SCHEMES[scheme];
  if (!definition) throw new Error(`Unknown identifier scheme: ${scheme}`);
  const parts = String(value ?? "").trim().split("-");
  // "DBS", the tag where the scheme has one, one segment per part, and the number.
  const expected = 1 + (definition.tag ? 1 : 0) + definition.parts.length + 1;
  if (parts.length !== expected) return null;
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

/** A loose test that a string is an identifier of *some* scheme, for the routes that take an id. */
const IDENTIFIER_PATTERN = /^DBS(-[A-Z]+)*-\d+$/;

module.exports = {
  BRANCHES,
  VERTICALS,
  SCHEMES,
  DEFAULT_BRANCH_CODE,
  DEFAULT_VERTICAL_CODE,
  IDENTIFIER_PATTERN,
  fold,
  branchCode,
  verticalCode,
  branchName,
  verticalName,
  schemeParts,
  countedParts,
  formatIdentifier,
  sequenceKey,
  contextFromKey,
  sequenceKeysFor,
  nextIdentifier,
  peekIdentifier,
  advanceSequence,
  parseIdentifier,
};
