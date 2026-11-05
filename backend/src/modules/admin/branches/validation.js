const { z } = require("zod");

/**
 * What a branch may be given in Settings → Organization → Branches.
 *
 * Two rules run through all of it. Every field but the name is optional, because a studio fills a
 * branch in over time — the register has to accept a branch that is only a name and an address on
 * the day it opens. And every optional field is *nullish* and trimmed to null when empty, so
 * clearing a box in the form actually clears the column rather than storing an empty string that
 * later reads as a value.
 *
 * The identifiers are checked against their real shapes rather than being taken as free text,
 * because these are the numbers that go on an invoice: a PAN with a digit where a letter belongs
 * is caught here rather than by a client's accountant. The patterns are the same ones the browser
 * uses (`frontend/src/constants/fieldValidation.js`), so the form and the server agree on what is
 * valid, and the server is what decides.
 */

/** Trimmed, or null: "  " is not a value, and neither is "". */
const blankToNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
};

/** An optional text column, at most `max` characters once trimmed. */
const optionalText = (max) => z.preprocess(blankToNull, z.string().max(max).nullable());

/**
 * An optional identifier: trimmed, folded to upper case, then matched.
 *
 * Upper case first, so a PAN typed in lower case is accepted rather than refused for a difference
 * that does not exist on the card itself.
 */
const optionalPattern = (pattern, max, message) => z.preprocess(
  (value) => { const text = blankToNull(value); return text === null ? null : text.toUpperCase(); },
  z.string().max(max).regex(pattern, message).nullable(),
);

/**
 * An optional phone number: the punctuation somebody types is dropped, and what is left has to be
 * a plausible number.
 *
 * A branch has two of these and they are the same field twice, so the rule is written once — a
 * second number held to a looser standard than the first would be a difference nobody intended.
 */
const optionalPhone = () => z.preprocess(
  (value) => { const text = blankToNull(value); return text === null ? null : text.replace(/[^\d+]/g, ""); },
  z.string().max(20).regex(/^\+?\d{6,15}$/, "Enter a valid phone number.").nullable(),
);

// A permanent account number: five letters, four digits, a letter.
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
// An IFSC: four letters, a zero, then six of either.
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
// A GSTIN: two state digits, the holder's PAN, an entity digit, "Z", and a checksum character.
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
// An Indian bank account number: digits only, nine to eighteen of them.
const ACCOUNT_NUMBER = /^\d{9,18}$/;

/**
 * The branch code, exactly as the studio writes it.
 *
 * Trimmed of the spaces around it and stored as given: the case, the spacing inside it and the
 * punctuation are the studio's to decide, not this file's. It used to be folded to one upper-case
 * token, which quietly turned somebody's chosen code into a different string — a code the studio
 * had not chosen is a code it cannot look up.
 *
 * Required, and no two branches may hold the same one. That is the whole of the rule.
 */
const branchCode = z.preprocess(
  blankToNull,
  z.string().min(2, "Branch code is required.").max(50).nullable(),
);
const branchFields = {
  code: branchCode,
  name: z.preprocess(blankToNull, z.string().min(2, "Branch name is required.").max(120)),
  // The address in its parts. Each is optional on its own: a branch may be a name and a city, or a
  // full address, and both have to be storable.
  addressLine1: optionalText(255),
  addressLine2: optionalText(255),
  city: optionalText(120),
  state: optionalText(120),
  // An Indian PIN code, and the digits are all of it — a person typing "638 011" means 638011.
  postalCode: z.preprocess(
    (value) => { const text = blankToNull(value); return text === null ? null : text.replace(/\D/g, ""); },
    z.string().regex(/^\d{6}$/, "Enter a valid 6-digit PIN code.").nullable(),
  ),
  description: optionalText(2000),
  phone: optionalPhone(),
  alternatePhone: optionalPhone(),
  email: z.preprocess(blankToNull, z.string().max(150).email("Enter a valid email address.").nullable()),
  /*
   * The branch's web address. Optional, and stored exactly as it is written.
   *
   * Checked loosely on purpose: enough to catch a sentence typed into the wrong box, not enough
   * to argue with a real address. A scheme is not insisted on, because "beamcraft.in" is how
   * somebody writes their own site, and adding one for them would put a link on a document that
   * the studio did not write.
   */
  websiteUrl: z.preprocess(
    blankToNull,
    z.string().max(255).regex(/^(https?:\/\/)?[^\s/?#]+\.[^\s]*$/i, "Enter a valid web address, for example beamcraft.in.").nullable(),
  ),
  gstNumber: optionalPattern(GSTIN, 15, "Enter a valid 15-character GSTIN."),
  panNumber: optionalPattern(PAN, 10, "Enter a valid 10-character PAN."),
  bankAccountName: optionalText(150),
  bankName: optionalText(120),
  bankAccountNumber: optionalPattern(ACCOUNT_NUMBER, 18, "Enter a valid account number (9 to 18 digits)."),
  bankIfsc: optionalPattern(IFSC, 11, "Enter a valid 11-character IFSC."),
  /*
   * The picture of the QR a client scans to pay this branch.
   *
   * Arrives either as the compressed data URI the browser made when somebody picked a file, or as
   * the link this branch already holds when a save touched something else entirely. Both are just
   * a string here: which one it is, and what has to happen to it, is the controller's to work out
   * (see `withStoredQrCode`) — this file's job is to accept it and to turn an empty box into the
   * null that clears the column.
   *
   * The ceiling is the length of a data URI rather than of a link, for the same reason the column
   * is a MEDIUMTEXT: on a machine without object storage the picture itself is what gets stored.
   */
  qrCodeUrl: z.preprocess(blankToNull, z.string().max(10_000_000).nullable()),
  isHeadOffice: z.boolean(),
  isActive: z.boolean(),
};

/*
 * What a branch must have before it is a branch.
 *
 * A branch is named on documents — an invoice, a quotation, a receipt — and every one of these is
 * something such a document has to carry: where it trades from, how to reach it, what it is
 * registered as, and where money is paid to it. A branch missing any of them is a branch nobody can
 * bill from, so it is refused rather than stored half-finished.
 *
 * Deliberately not on the list: the second address line, the alternate phone and the email. Each is
 * a *second* way to say something the branch already says, and requiring a landline from a branch
 * that has only a mobile would be asking for a number that does not exist.
 *
 * Nor the GSTIN and the PAN, which were on it and are not any more. A branch is not always a
 * registration: a new place trades before its GSTIN comes through, and a studio that is not
 * registered at all still has branches to bill from. Insisting on them meant such a branch could
 * not be added until somebody typed a number that did not exist yet. They are still checked
 * against their real shapes the moment there is something in the box — an invalid GSTIN is still
 * refused; a missing one is not.
 */
const REQUIRED = [
  "code", "name",
  "addressLine1", "city", "state", "postalCode",
  "phone",
  "bankAccountName", "bankName", "bankAccountNumber", "bankIfsc",
];

/** What each one is called when it is the thing that is missing. */
const LABELS = {
  code: "Branch code", name: "Branch name", addressLine1: "Address Line 1", city: "City", state: "State",
  postalCode: "Postal code", phone: "Phone",
  bankAccountName: "Account holder name", bankName: "Bank name", bankAccountNumber: "Account number",
  bankIfsc: "IFSC",
};

/** A field that must be there, reported against the field itself so the form can point at it. */
const requireField = (context, field) => context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${LABELS[field]} is required.` });

/**
 * A new branch: everything above, plus open and not the head office unless it says otherwise.
 */
const createBranchSchema = z.object({
  ...branchFields,
  isHeadOffice: branchFields.isHeadOffice.default(false),
  isActive: branchFields.isActive.default(true),
}).strict().superRefine((value, context) => {
  for (const field of REQUIRED) if (value[field] === null || value[field] === undefined) requireField(context, field);
});

/**
 * An edit: every field optional, so a form may send only what it changed.
 *
 * The two flags carry no default *here*, deliberately. A default survives `.partial()` — the field
 * is optional, and absent still produces the default — so a request saying only "this is now the
 * head office" would have carried `isActive: true` with it and quietly reopened a closed branch.
 * An edit changes what it names and nothing else.
 *
 * `.strict()` on both, so a key nobody recognises is refused rather than silently dropped.
 */
/*
 * An edit, the code included.
 *
 * Changing a code is a real change, not a rename: the database seed updates branches by code, and
 * the asset importer accepts a code in the Branch column of a spreadsheet. A branch given a new
 * code is a branch those two no longer recognise by the old one — which is the studio's call to
 * make, and it is made here. What is still refused is emptying it, or taking one another branch
 * already holds; the second is the service's to catch, since only it can see the other branches.
 */
const updateBranchSchema = z.object(branchFields).partial().strict().superRefine((value, context) => {
  /*
   * An edit may leave a required field out, but it may not empty one.
   *
   * Left out means "not changing this", which is what makes a one-field edit possible at all. Sent
   * as empty means "clear it", and clearing something a branch must have would leave the register
   * holding a branch that could never have been created — the rule has to hold on the way out as
   * well as on the way in.
   */
  for (const field of REQUIRED) if (field in value && value[field] === null) requireField(context, field);
});

module.exports = { createBranchSchema, updateBranchSchema, REQUIRED, PAN, IFSC, GSTIN, ACCOUNT_NUMBER };
