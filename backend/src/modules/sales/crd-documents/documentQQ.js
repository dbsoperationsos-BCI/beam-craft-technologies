const { z } = require("zod");
const { normalizePhoneNumber } = require("../../../services/phoneNumber");

/**
 * The shape of the Qua Qua Customer Identification Document.
 *
 * Recreates the studio's Jotform CRD for this vertical, page by page: Identification (who the
 * studio is dealing with, what kind of shoot it is, which branch), then Birthdays, whose questions
 * depend on which Shoot Type was picked in Identification, then References (special notes, uploaded
 * files, one reference link, and the terms & conditions agreement).
 *
 * Everything here is optional at this layer for the same reason document.js is — a half-filled
 * document has to be storable — and "is it complete" stays a separate question, answered by
 * `missingRequired()` and enforced only at submit. Because Birthdays' required fields depend on
 * Shoot Type, `missingRequired`/`completionPercent` read the document rather than working off a
 * fixed list the way document.js's do.
 */

const text = (max) => z.string().trim().max(max).optional().default("");
// A date the client picks from a native date input, so it always arrives as YYYY-MM-DD or blank.
const dateOnly = text(30);

// Same ten-digit rule the Dum Dum document and the CRM match leads by — see the `phone` schema in
// ./document.js for why the *last* ten digits survive a pasted country code.
const phone = z.string().trim().max(40).optional().default("").transform((value) => {
  const raw = String(value).trim();
  if (!raw) return "";
  // The same rule the Dum Dum document keeps — `+<dial code> <national number>`, and a number too
  // incomplete to read stays as typed so a draft still saves. See ./document.js.
  return normalizePhoneNumber(raw) || raw;
});

// A closed choice on the public form: either blank (nothing picked yet — valid mid-draft) or one of
// the studio's own labels. Anything else is a tampered request, not a client's honest answer.
const choice = (options) => z.union([z.enum(options), z.literal("")]).optional().default("");

// A blank link is fine mid-draft; a filled one has to actually be a link, the same rule the Dum Dum
// document's own reference links are held to.
const httpUrlText = (max) => z.string().trim().max(max).optional().default("").refine((value) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}, { message: "Enter a working http or https link." });

// A newly picked file arrives inline as `data`; one already stored comes back as the `url` it was
// uploaded to, and is passed through rather than re-uploaded. Mirrors `documentInput` in
// assets.controller.js.
const referenceFileSchema = z.union([
  z.object({ name: z.string().trim().min(1).max(255), data: z.string().max(7_000_000) }),
  z.object({ name: z.string().trim().min(1).max(255), url: z.string().url().max(2000) }),
]);

const SHOOT_TYPE_OPTIONS = [
  "Baby Shoot",
  "Toddler Shoot",
  "Ear Piercing Ceremony",
  "Naming Ceremony",
  "Puberty Function",
  "Maternity Shoot",
  "Baby Shower",
  "Combo Packages",
  "Other",
];

const BRANCH_OPTIONS = [
  "Erode, TN",
  "Coimbatore, TN",
  "Tiruppur, TN",
  "Bangalore, KA",
  "Vizag, AP",
  "Hyderabad, TS",
];

/**
 * Which Birthdays page a Shoot Type asks. The Jotform this recreates branches into three different
 * pages from the one Shoot Type answer — a baby already born, a baby on the way plus Baby Shower,
 * or a Combo/Other booking that could be either, so it asks for whichever date applies without
 * asking which.
 */
const BIRTHDAYS_CATEGORY_BY_SHOOT_TYPE = {
  "Baby Shoot": "baby",
  "Toddler Shoot": "baby",
  "Ear Piercing Ceremony": "baby",
  "Naming Ceremony": "baby",
  "Puberty Function": "baby",
  "Maternity Shoot": "maternity",
  "Baby Shower": "maternity",
  "Combo Packages": "combo",
  "Other": "combo",
};

function birthdaysCategoryFor(shootType) {
  return BIRTHDAYS_CATEGORY_BY_SHOOT_TYPE[shootType] || "";
}

// What Birthdays requires, per category. Mother's Name, Mother's Date of Birth, Father's Name and
// Father's Birthday are asked in every category — the same four questions under a label that reads
// "Mother's Birthday" for a baby already born and "Mother Date of Birth" everywhere else, which is
// the Jotform's own wording and is reproduced as-is rather than corrected into one consistent phrase.
const BIRTHDAYS_REQUIRED_BY_CATEGORY = {
  baby: ["babyName", "babyDateOfBirth", "motherName", "motherDateOfBirth", "fatherName", "fatherBirthday"],
  maternity: ["motherName", "motherDateOfBirth", "fatherName", "fatherBirthday", "expectedDeliveryDate"],
  combo: ["motherName", "motherDateOfBirth", "fatherName", "fatherBirthday", "childBirthdayOrExpectedDeliveryDate"],
};

const documentSchema = z.object({
  // Identification
  /*
   * The booking this document is about, as the studio's own Event ID. Prefilled from the project
   * and shown read-only - the same field the Dum Dum document carries, for the same reason: the
   * client sees which booking they are filling in for. Never asked for, so it is not among
   * `IDENTIFICATION_REQUIRED` and cannot block a submission.
   */
  eventId: text(40),
  whatsappGroupName: text(500),
  firstName: text(120),
  phoneNumber: phone,
  shootType: choice(SHOOT_TYPE_OPTIONS),
  branch: choice(BRANCH_OPTIONS),
  referredBy: text(191),
  // Birthdays — every field every category could ask for; only the ones its category actually asks
  // for count towards `missingRequired`.
  babyName: text(150),
  babyDateOfBirth: dateOnly,
  motherName: text(150),
  motherDateOfBirth: dateOnly,
  fatherName: text(150),
  fatherBirthday: dateOnly,
  expectedDeliveryDate: dateOnly,
  childBirthdayOrExpectedDeliveryDate: dateOnly,
  // References
  specialNotes: text(2000),
  photoReferenceLinks: text(8_000_000),
  videoReferenceLinks: text(5000),
  otherReferenceLinks: text(5000),
  referenceFiles: z.array(referenceFileSchema).max(10).optional().default([]),
  referenceLink: httpUrlText(1000),
  // The client's agreement to the terms. Required to submit, and stored as the plain fact that it
  // was ticked — `submittedAt` on the row is when.
  termsAccepted: z.boolean().optional().default(false),
});

/*
 * Identification's own required fields. Last Name and Referred By are optional, the same way they
 * are on the Dum Dum document.
 *
 * The WhatsApp Group Name is not among them, and that follows from its being read-only rather than
 * being a judgement about how important it is. It is the studio's name for the booking, prefilled
 * from the project and shown to be checked - the same treatment it has always had on the Dum Dum
 * document - and a field the form will not let anybody type in cannot be a field that blocks
 * submission. A document raised by hand has no project to take a name from, so requiring it would
 * strand that document with no screen anywhere able to fix it.
 */
const IDENTIFICATION_REQUIRED = ["firstName", "phoneNumber", "shootType", "branch"];
// Ticked, not filled in — a checkbox is answered by being true, and `false` is a perfectly good
// string, so it cannot go through the same emptiness test as the text fields. Special Notes, the
// uploaded files and the reference link are all optional.
const REFERENCES_REQUIRED_CHECKED = ["termsAccepted"];

const filled = (value) => String(value ?? "").trim() !== "";

/** Every required answer still missing, as a `field` name — Identification's, whichever Birthdays
 *  category the chosen Shoot Type asks for, and References' own terms agreement. */
function missingRequired(document = {}) {
  const missing = IDENTIFICATION_REQUIRED.filter((field) => !filled(document?.[field]));
  const category = birthdaysCategoryFor(document?.shootType);
  if (category) missing.push(...BIRTHDAYS_REQUIRED_BY_CATEGORY[category].filter((field) => !filled(document?.[field])));
  REFERENCES_REQUIRED_CHECKED.forEach((field) => { if (document?.[field] !== true) missing.push(field); });
  return missing;
}

/** How far along the document is, 0–100. The total grows once a Shoot Type is picked and Birthdays'
 *  own required fields become known. */
function completionPercent(document = {}) {
  const category = birthdaysCategoryFor(document?.shootType);
  const total = IDENTIFICATION_REQUIRED.length + (category ? BIRTHDAYS_REQUIRED_BY_CATEGORY[category].length : 0) + REFERENCES_REQUIRED_CHECKED.length;
  const done = total - missingRequired(document).length;
  return total === 0 ? 100 : Math.round((done / total) * 100);
}

function emptyDocument() {
  return documentSchema.parse({});
}

module.exports = {
  documentSchema,
  emptyDocument,
  missingRequired,
  completionPercent,
  IDENTIFICATION_REQUIRED,
  BIRTHDAYS_REQUIRED_BY_CATEGORY,
  REFERENCES_REQUIRED_CHECKED,
  birthdaysCategoryFor,
  SHOOT_TYPE_OPTIONS,
  BRANCH_OPTIONS,
};
