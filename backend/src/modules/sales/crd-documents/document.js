const { z } = require("zod");
const { normalizePhoneNumber } = require("../../../services/phoneNumber");

/**
 * The shape of a Customer Identification Document.
 *
 * One document per project, filled through a single public link. The common block describes the
 * event and is asked once; `groom` and `bride` are the same set of questions asked of each side,
 * because both sides give their own details through the one link.
 *
 * Everything is optional at this layer. A half-finished document has to be storable — the client
 * saves progress and comes back, and the groom side may fill their tab days before the bride side —
 * so "is it complete" is a separate question, answered by `missingRequired()` and only enforced when
 * the document is finally submitted.
 */

// Caps on the repeatable parts. These are the only fields a public caller can grow without bound,
// so each is bounded rather than trusted; the browser caps the same lists at the same numbers.
const MAX_FAMILY_IMAGES = 10;
const MAX_FAMILY_DETAILS = 20;
const MAX_HELP_WITH = 40;

const text = (max) => z.string().trim().max(max).optional().default("");

/**
 * A contact number, kept to the ten digits the studio actually dials.
 *
 * Anything that is not a digit is stripped rather than refused — a number pasted as
 * "+91 98765 43210" is recognisably correct, and rejecting it only teaches people to fight the
 * form. When more than ten digits survive, the *last* ten are kept, so a pasted country code drops
 * off the front instead of the subscriber number dropping off the end. This is the same rule the
 * CRM matches leads by (`RIGHT(..., 10)` in crm-leads/crmLeadService.js).
 */
const phone = z.string().trim().max(40).optional().default("").transform((value) => {
  const raw = String(value).trim();
  if (!raw) return "";
  // Kept in the studio's one stored shape, `+<dial code> <national number>` — see
  // services/phoneNumber.js. It used to keep the last ten digits and throw the rest away, which
  // silently turned a client's own country code into an Indian number.
  //
  // A number that cannot be read yet is kept as typed rather than refused: this document saves as
  // it is filled in, so half a number has to survive a draft save. Submit is where a complete one
  // is insisted on.
  return normalizePhoneNumber(raw) || raw;
});

// A stored image is either a link R2 already holds or a data URI the browser has just compressed.
// Both are accepted here and normalised to a link before storage.
const image = z.string().max(8_000_000).optional().default("");

const familyMemberSchema = z.object({
  name: text(191),
  relationship: text(120),
});

const sideSchema = z.object({
  firstName: text(120),
  lastName: text(120),
  nickname: text(120),
  nameToBeUsedInProject: text(191),
  instaId: text(120),
  dateOfBirth: text(30),
  photo: image,
  contactNumber: phone,
  streetAddress: text(500),
  city: text(120),
  state: text(120),
  postalCode: text(20),
  familyImages: z.array(image).max(MAX_FAMILY_IMAGES).optional().default([]),
  familyDetails: z.array(familyMemberSchema).max(MAX_FAMILY_DETAILS).optional().default([]),
  /*
   * The event used to be asked of each side, and it is not a side's question.
   *
   * One wedding has one start, one end and one venue, and asking the groom and the bride separately
   * produced two answers to each with nothing to say which was right - a document that could
   * disagree with itself about when the event was. They are on the common block now, where the rest
   * of the event already lives.
   *
   * Kept in this schema as well, and only as a doorway: documents saved before the move hold them
   * here, and `liftSideEvent` reads them up onto the common block once. Dropping them outright would
   * have made the parser discard the very fields the lift needs to find.
   */
  eventStartAt: text(40),
  eventEndAt: text(40),
  eventAddressLink: text(1000),
  helpWith: z.array(z.string().trim().max(191)).max(MAX_HELP_WITH).optional().default([]),
});

const commonSchema = z.object({
  /*
   * The booking this document is about, as the studio's own Event ID.
   *
   * Prefilled from the project and shown read-only, like everything else on this block: it is what
   * Sales already knows, printed so the client can see which booking they are filling in for - a
   * client with two shoots on the go was being handed two identical-looking forms. Never asked for,
   * so it is not among the required fields and cannot block a submission; a document raised by hand
   * before its project exists has no Event ID and leaves the box empty rather than inventing one.
   */
  eventId: text(40),
  whatsappGroupName: text(500),
  eventType: text(100),
  pointOfContactName: text(191),
  pointOfContactPhone: phone,
  referredBy: text(191),
  /*
   * The event: when it starts, when it ends, where it is, and what else the studio can help with.
   *
   * Asked once, because there is one event. These four were on each side - see `sideSchema` - which
   * asked the groom and the bride the same question and stored two answers to it.
   */
  eventStartAt: text(40),
  eventEndAt: text(40),
  eventAddressLink: text(1000),
  helpWith: z.array(z.string().trim().max(191)).max(MAX_HELP_WITH).optional().default([]),
  // Free text rather than a list of links: the client pastes what they have, one reference per
  // line, and the studio reads them. Generous ceilings because a mood board can run long.
  photoReferenceLinks: text(8_000_000),
  videoReferenceLinks: text(5000),
  otherReferenceLinks: text(5000),
  // The client's agreement to the terms. Required to submit, and stored as the plain fact that it
  // was ticked — `submittedAt` on the row is when.
  termsAccepted: z.boolean().optional().default(false),
});

const documentSchema = z.object({
  common: commonSchema.optional().default({}),
  groom: sideSchema.optional().default({}),
  bride: sideSchema.optional().default({}),
});

// The two sides are asked the same questions, so the document is described once and both read from
// it — a field added here appears on both tabs by construction rather than by remembering to.
const SIDES = ["groom", "bride"];

/**
 * What must be answered before the document can be submitted.
 *
 * Nickname and Referred By are optional because the spec says so. The three collections —
 * relatives' photos, family details and the "what else can we help with" list — are deliberately
 * optional too: a client who cannot lay hands on a relative's photograph must still be able to
 * finish, and blocking on it would strand the document. They still count towards progress.
 */
/*
 * Nothing on the common block is required of the client, and that is the list rather than a gap.
 *
 * These four were: the group name, the event type, and the two point-of-contact fields. Every one of
 * them is prefilled from the project and the lead it came from, and the client's form now shows the
 * whole Event Details block **read-only** - it is what Sales already knows about the booking, shown
 * to be checked rather than asked.
 *
 * A field the form will not let anybody type in cannot be a field that blocks submission. Point of
 * Contact Name comes from the lead's primary decision maker or company name, both of which are
 * routinely blank on a wedding lead; required and unfillable, that one blank would have made the
 * document unsubmittable by the client and by the studio alike, with no screen anywhere able to fix
 * it. What the client must still answer is both sides in full and the terms - which is everything
 * this document exists to collect.
 */
const REQUIRED_COMMON = [];
// Ticked, not filled in — a checkbox is answered by being true, and `false` is a perfectly good
// string, so these cannot go through the same emptiness test as the text fields.
const REQUIRED_COMMON_CHECKED = ["termsAccepted"];
/*
 * The event fields are required of nobody, and that is the change rather than an oversight.
 *
 * They were required of each side, when each side was asked them. They are now on the common block
 * and the client's own form shows that block **read-only** - the event is what Sales already knows
 * about the booking, and the client is being asked to identify themselves rather than to tell the
 * studio when its own shoot is. A field the form will not let anybody type in cannot be one that
 * blocks submission, or a document whose prefill came up short could never be submitted by anyone.
 */
const REQUIRED_SIDE = [
  "firstName",
  "nameToBeUsedInProject",
  "instaId",
  "dateOfBirth",
  "photo",
  "contactNumber",
  "streetAddress",
  "city",
  "state",
  "postalCode",
];

/*
 * The event fields, in one place, for the readers that have to move them.
 *
 * `helpWith` is a list rather than a string, so it is carried separately - the lift below has to
 * test each kind for emptiness in its own way.
 */
const SIDE_EVENT_TEXT = ["eventStartAt", "eventEndAt", "eventAddressLink"];

/**
 * A document saved before the event moved, read as one saved after it.
 *
 * The four fields sat on `groom` and `bride`; they sit on `common` now. A document already stored
 * holds them where they were, so they are lifted on read - the groom's answers first, because that
 * side is what the prefill filled in and what the studio filled in from the booking, falling back to
 * the bride's where the groom's is blank.
 *
 * Only ever fills a blank. A common value that is already set is what somebody has actually said
 * about this event, and an old side value must never overwrite it.
 *
 * Idempotent, and pure: it hands back a new document rather than editing the one it was given, so
 * the same call is safe on a document that has already been lifted and on one that never needed it.
 */
function liftSideEvent(document = {}) {
  const common = { ...(document.common || {}) };
  const sides = SIDES.map((side) => document?.[side] || {});
  for (const field of SIDE_EVENT_TEXT) {
    if (filled(common[field])) continue;
    const found = sides.find((side) => filled(side?.[field]));
    if (found) common[field] = found[field];
  }
  if (!Array.isArray(common.helpWith) || common.helpWith.length === 0) {
    const found = sides.find((side) => Array.isArray(side?.helpWith) && side.helpWith.length > 0);
    if (found) common.helpWith = [...found.helpWith];
  }
  return { ...document, common };
}

const filled = (value) => String(value ?? "").trim() !== "";

/** Every required answer still missing, as `common.eventType` / `groom.firstName` style paths. */
function missingRequired(document = {}) {
  const missing = [];
  for (const field of REQUIRED_COMMON) {
    if (!filled(document?.common?.[field])) missing.push(`common.${field}`);
  }
  for (const field of REQUIRED_COMMON_CHECKED) {
    if (document?.common?.[field] !== true) missing.push(`common.${field}`);
  }
  for (const side of SIDES) {
    for (const field of REQUIRED_SIDE) {
      if (!filled(document?.[side]?.[field])) missing.push(`${side}.${field}`);
    }
  }
  return missing;
}

/** How far along the whole document is, 0–100, across the common block and both sides together. */
function completionPercent(document = {}) {
  const total = REQUIRED_COMMON.length + REQUIRED_COMMON_CHECKED.length + REQUIRED_SIDE.length * SIDES.length;
  const done = total - missingRequired(document).length;
  return total === 0 ? 100 : Math.round((done / total) * 100);
}

function emptyDocument() {
  return documentSchema.parse({});
}

module.exports = {
  documentSchema,
  sideSchema,
  commonSchema,
  emptyDocument,
  missingRequired,
  completionPercent,
  liftSideEvent,
  SIDE_EVENT_TEXT,
  SIDES,
  REQUIRED_COMMON,
  REQUIRED_COMMON_CHECKED,
  REQUIRED_SIDE,
  MAX_FAMILY_IMAGES,
  MAX_FAMILY_DETAILS,
  MAX_HELP_WITH,
};
