const { withUserNames, userNamesById } = require("../../../services/userNames");
const { syncShootLinkedDueDates } = require("../../../services/shootLinkedDueDates");
const { SHOOT_DATE_ASC } = require("../../../services/shootOrder");
const { withProjectHandovers } = require("../../../services/handoverNames");
const { z } = require("zod");
const { EXPIRED_LINK_MESSAGE, expiredLink } = require("../../../services/expiredLink");
const { workingEmployeeStatuses, salesEmployees, listPhotoUrl } = require("../../../services/employeeOptionLists");
const quotationShares = require("../../../services/quotationShares");
const { snapshotDocumentBranding, brandingForDocument } = require("../../../services/documentBranding");
const prisma = require("../../../config/db");
const { DEFINITION_ORDER } = require("../../../services/definitionOrder");
const { shootLocationsSchema, shootLocationsIssue, shootLocationColumns } = require("../../../services/shootLocations");
const { ensureProjectClientStorage, removeProjectClientStorage } = require("../../assets/client-storage.service");
const clientPush = require("../../../services/clientPush");
// A project answering "CRD Document: Applicable" raises its document there and then, so the studio
// can quote its CRD ID before the link goes out.
const { ensureProjectCrdDocument } = require("../crd-documents/service");
const { ensureProjectPreProduction } = require("../../project-management/pre-production/service");
const { ensureProjectProduction } = require("../../project-management/production/service");
const { projectHoldSources, projectPaymentsDue } = require("../../../services/projectHolds");
const { boardsForProjects } = require("../../../services/projectBoards");
const { logProjectActivity } = require("../../../services/projectActivity");
const { fieldChanges } = require("../../../services/recordChanges");
const { describeChanges } = require("../../../services/activityLog");
const { projectSchedule, projectAccountsStatus } = require("../../accounts/scheduled-payments/service");
const { projectClientNames, clientNameOf } = require("../../../services/projectClientNames");
const iamService = require("../../../services/iam.service");
const bcrypt = require("bcryptjs");
const { loginCredentialFields, CLIENT_ROLE, generatedTemporaryPassword, takenLoginField } = require("../../../services/loginCredentials");
const { sendWhatsAppToPerson } = require("../whatsapp-chat/directSend");
const whatsappActivity = require("../../../services/whatsappActivity");
const { MAX_MESSAGE_LENGTH } = require("../whatsapp-chat/security");
const { fileUrls } = require("../../../services/uploadMetadata");
const { markCrmLeadConverted } = require("../crm-leads/crmLeadService");
/*
 * The Accounts module's own writer, so a booking advance is the same row, validated the same way,
 * as every other cash entry - only the guard on the route differs. See `recordProjectAdvance`.
 */
const { recordCashEntry, formEntrySchema: cashFormEntrySchema, settlesSchema: cashSettlesSchema, handleError: handleCashEntryError, toRow: cashEntryRow } = require("../../accounts/cash-entries/controller");
// Required when used: the scheduled-payments service requires the cash-entries controller in turn.
const settleScheduledPayment = (...args) => require("../../accounts/scheduled-payments/service").settleInTx(...args);
const { nextIdentifier, parseIdentifier } = require("../../../services/identifiers");
const { buildQuotationName } = require("../../../services/quotationName");
// The brand a quotation is raised under, and the snapshot of that brand it carries - see the
// module for why the snapshot is built here rather than read from the brand tables later.
const quotationBrands = require("../quotation-brands/service");
const saleExtrasBooking = require("../sale-extras/booking");
const saleExtrasTotals = require("../sale-extras/totals");
const { hasPrintPass } = require("../../../services/quotationPrintPass");
const { importTableRows, templateHeaders } = require("../../../services/tableImport");
// Deleting a shoot here also removes its Image Selection footprint (folder tree, photo rows,
// R2 derivatives) — see deleteProjectShoot.
const imageSelectionFolders = require("../../image-selection/folders/service");
const { normalizePhoneNumber } = require("../../../services/phoneNumber");
const { everyChunk } = require("../../../services/wordChunks");
const { verticalCode, fillVerticalsFromLeads, VERTICAL_CODES } = require("../../../services/salesVertical");
const { projectAccessWhere, REGISTER_READERS } = require("../../../services/projectScope");
const { readableEnquiryIds, leadScopeFor, CRM_LEADS } = require("../../../services/leadScope");
// `BOARD_KEY.Calls` is the value the lead table's stored `board_key` column holds for an untriaged
// Callyzer call. Read from there rather than written out, so the picker's idea of "this is a call,
// not an enquiry" cannot drift from the board's. See `listEnquiries`.
const { BOARD_KEY } = require("../crm-leads/leadQueryService");
const dataScope = require("../../../services/dataScope.service");
// A deliverable's No. of Count, Image Selection and Remarks are typed words now rather than a
// Yes/No pair, and these read the words back into the answer the allocations and Image Selection
// still need. See the module for the one rule they all follow.
const { deliverableAnswerText, deliverableAnswerNotOff } = require("../../../services/deliverableAnswers");
const { lookups: referenceLookups } = require("../../../services/referenceMatchers");
// One rule for every branch picker in the application - the CRM reads the same list. See the
// note in branchOptions.js for what the CRM was offering instead.
const { branchOptions } = require("../../../services/branchOptions");
const { wantsPage, backToPage } = require("../../../services/downloadNavigation");
// The gift a project owes its client starts on the Client Gifts screen's first tab the moment it is marked
// Applicable, so the two screens agree on what "not sent yet" is called without either owning it.
const { GIFT_STATUS_PENDING } = require("../../project-management/client-gifts/service");
const { receivedIntoOptions } = require("../../../services/branchBankAccounts");

const verticals = VERTICAL_CODES;
const groupTypes = ["Dum Dum", "Qua Qua", "Corp"];
// The generator's own Group Type → vertical mapping (see whatsapp-group-names/controller.js). A
// project made with a *manual* group name has no reserved name to inherit a vertical from, so the
// form asks for the group type and the vertical is derived here — the same way, so the two paths
// can never disagree about what "Dum Dum" means.
const verticalForGroupType = { "Dum Dum": "WED", "Qua Qua": "QQ", Corp: "CORP" };
const shootSessionTimingOptions = ["Hourly", "Half Session", "Full Session"];
const shootCareOwnerOptions = ["Studio", "Client"];
// Who the shoot is for. Required on every shoot - a wedding covers one side or both, and which
// it is decides who the crew follows, so there is no sensible default to fall back on.
const shootPreferenceOptions = ["Groom", "Bride", "Both"];
const shootTypeOptions = ["Studio / In-House", "Outdoor / On-Location"];

/**
 * The shoot types and session timings a shoot carries, as lists.
 *
 * A shoot may run in more than one place and over more than one session length - a wedding that
 * starts in the studio and moves outdoors, a day booked partly by the hour. The singular columns are
 * kept in step, holding the first of each list, so everything that reads a shoot one-at-a-time keeps
 * working; these read the list and fall back to the singular for a shoot saved before it existed.
 */
function listOr(list, single) {
  const values = Array.isArray(list) ? [...new Set(list.filter(Boolean))] : [];
  if (values.length) return values;
  return single ? [single] : [];
}

function shootTypesOf(data) {
  return listOr(data?.shootTypes, data?.shootType);
}

function shootTimingsOf(data) {
  return listOr(data?.sessionTimings, data?.sessionTiming);
}
const autoDeliverablesByService = {
  "Indoor Photo Only": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Retouches", "Signature Album (Soft copy)", "Final Files Out"],
  "Outdoor Photo Only": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Retouches", "Signature Album (Soft copy)", "Final Files Out"],
  "Indoor Photo Shoot + Reels": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Retouches", "Reels", "Signature Album (Soft copy)", "Final Files Out"],
  "Outdoor Photo + Reels": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Retouches", "Reels", "Signature Album (Soft copy)", "Final Files Out"],
  "Traditional Photo": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Bulk Edited Images", "Signature Album (Soft copy)", "Album Printing", "Final Files Out"],
  "Traditional Video": ["Raw - File IN", "Traditional Full Length", "Traditional Highlights", "Final Files Out"],
  "Candid Photo": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Bulk Edited Images", "Retouches", "Signature Album (Soft copy)", "Album Printing", "Final Files Out"],
  "Candid Video": ["Raw - File IN", "Reels", "Cinematic Teaser", "Cinematic Highlights", "Cinematic Full Length", "Final Files Out"],
  Drone: ["Raw - File IN", "Final Files Out"],
  "Al Feature": ["QR Genration", "QR Publishing"],
  "Semi Candid Photo": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Bulk Edited Images", "Retouches", "Signature Album (Soft copy)", "Album Printing", "Final Files Out"],
  "Semi Candid Video": ["Raw - File IN", "Reels", "Cinematic Teaser", "Cinematic Highlights", "Cinematic Full Length", "Final Files Out"],
  "360 Video Camera": ["Raw - File IN", "Full length", "Final Files Out"],
  "Pre/ Post Wedding Photography": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Retouches", "Final Files Out"],
  "Pre/ Post Wedding Videography": ["Raw - File IN", "Reels", "Cinematic Highlights", "Final Files Out"],
  "Pre/ Post Wedding Candid Photography": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Retouches", "Final Files Out"],
  "Pre/ Post Wedding Candid Videography": ["Raw - File IN", "Reels", "Cinematic Highlights", "Final Files Out"],
  "Corporate Video": ["Raw - File IN", "Final Files Out"],
  "Corporate Photo": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Final Files Out"],
  Headshots: ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Retouches", "Final Files Out"],
  "Product Photography": ["Raw - File IN", "Photo Selection", "Retouches", "Final Files Out"],
  "Product Videography": ["Raw - File IN", "Final Files Out"],
  "Semi Candid Photo + reel": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Retouches", "Reels", "Signature Album (Soft copy)", "Final Files Out"],
  "Candid Photo + Reels": ["Raw - File IN", "Photo Selection", "Retouches", "Reels", "Signature Album (Soft copy)", "Final Files Out"],
  "Complementary Drone": ["Raw - File IN", "Final Files Out"],
  "Comp Drone": ["Raw - File IN", "Final Files Out"],
  "Only Post Production": ["Raw - File IN", "Final Files Out"],
};
/*
 * The statuses a project may be given, by bulk Update, Start Project or an import. Projects saved
 * before 14 Oct 2026 can still read one of the old ones - "Work in Progress - Pre & Production",
 * "Work in Progress - Post Production", "Delivered", "Cancelled & Refunded" and the rest - and keep
 * it; every check that reads a status accepts both (`IN_PROGRESS_STATUSES`, `COMPLETED_STATUSES`).
 */
const projectStatuses = ["Yet to Start", "In Progress", "Completed", "On Hold", "Rejected"];
/*
 * The employment statuses that still count as working here.
 *
 * Read off the status list rather than written out: the studio maintains it in Settings →
 * Field Settings, and each status carries whether it means somebody is working. Written out, this
 * array had no way of hearing about a status being renamed or added, so the list was editable and
 * the meaning of it was not. See `services/employeeOptionLists`.
 */
const requiredText = z.string().trim().min(1).max(5000);
const optionalText = z.string().trim().max(5000).nullable().optional();
const optionalPositiveInt = z.coerce.number().int().positive().nullable().optional();
const projectShootServiceInputSchema = z.object({
  serviceDefinitionId: z.string().trim().min(1).max(191),
  quantity: z.coerce.number().int().positive().nullable().optional(),
  sessionOptionId: z.string().trim().max(191).nullable().optional(),
  durationHours: z.coerce.number().int().min(0).nullable().optional(),
  durationMinutes: z.coerce.number().int().min(0).max(59).nullable().optional(),
  workDays: z.coerce.number().int().positive().nullable().optional(),
  timingMinutes: z.coerce.number().int().positive().nullable().optional(),
  sizeOptionValueId: z.string().trim().max(191).nullable().optional(),
  remarks: optionalText,
});
/*
 * The variant of the deliverable a line is added as. `variantId` is looked up against the
 * deliverable's brands as they stand, and what that variant holds is what is saved; the words beside
 * it are only for a variant that no longer exists - removed in Settings since, or replaced by a
 * save from before `saveDeliverableBrands` kept ids - so a quotation raised last month still knows
 * what it was sold as. See `deliverableVariantSnapshotFor`.
 */
const deliverableVariantInputSchema = z.object({
  variantId: z.string().trim().max(191).nullable().optional(),
  brandName: z.string().trim().max(191).nullable().optional(),
  size: z.string().trim().max(100).nullable().optional(),
  frameInches: z.string().trim().max(60).nullable().optional(),
  videoLength: z.string().trim().max(100).nullable().optional(),
}).nullable().optional();

const projectShootDeliverableInputSchema = z.object({
  deliverableDefinitionId: z.string().trim().min(1).max(191),
  quantity: z.coerce.number().int().min(1).nullable().optional(),
  numberOfPhotos: z.coerce.number().int().min(0).nullable().optional(),
  sizeOptionValueId: z.string().trim().max(191).nullable().optional(),
  size: optionalText,
  remarks: optionalText,
  variant: deliverableVariantInputSchema,
});

/*
 * A shoot's date, which it may not have yet.
 *
 * A wedding is sold months before the family settles the reception date, so Add Shoot asks whether
 * the date is known before it asks for one. An empty string is what a form sends for a field it
 * never showed, and it means "not scheduled" here rather than an unparseable date.
 */
const optionalShootDate = z.preprocess(
  // Emptied **before** anything is coerced, which is the whole point of the preprocess.
  //
  // It was a union with `z.coerce.date()` first, and a union takes its first match: `new Date(null)`
  // is 1 January 1970, a perfectly valid Date, so a shoot saved with "Shoot Date Known: No" - which
  // sends exactly `null` - was stored as 1970 rather than as no date at all. That reads as a
  // scheduled shoot everywhere a date is only tested for being there. `""` escaped it only because
  // `new Date("")` is an Invalid Date and the branch happened to fail.
  (value) => (value === null || value === "" ? undefined : value),
  z.coerce.date().optional(),
).transform((value) => value ?? null);

/**
 * The main event date, as forgiving as the thing that supplies it.
 *
 * `z.coerce.date()` alone runs `new Date(value)` and hands whatever comes back to a date check, so
 * a cell it cannot read becomes an Invalid Date and the request is refused with **"mainEventDate:
 * Invalid input: expected date, received Date"**. Three things were wrong with that at once: it
 * names a field the Create Project form has no control for, it is written for whoever wrote the
 * schema rather than for whoever is trying to book a project, and it is unanswerable - there is
 * nowhere on the form to go and correct it. A lead converted from a date the CRM had stored as
 * free text therefore could not become a project at all.
 *
 * A date that cannot be read is not a date, so it reads as **not decided** - the same answer "" and
 * null already gave. If the caller insisted the date is known, `mainEventDateKnown` catches it in
 * `superRefine` below and says so in words somebody can act on.
 */
const optionalEventDate = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}, z.date().nullable()).optional();

const quotationLineSchema = z.object({
  quantity: z.union([z.coerce.number().finite().min(1), z.literal(""), z.null()]).optional(),
  unitPrice: z.union([z.coerce.number().finite().min(0), z.literal(""), z.null()]).optional(),
}).passthrough();

/**
 * The most the Discount may take off a quotation: 15% of what it comes off (the services and
 * deliverables plus the Performance Cost). The Discount only - the extra discounts are not held to
 * it, only to keeping the total above nothing (the last rule of `quotationPayloadSchema`). The
 * generator says the same number (`MAX_DISCOUNT_PERCENT` in `frontend/src/lib/quotationDiscount.mjs`)
 * and refuses first; this is what holds it for a request made any other way. In rupees it is rounded
 * to the whole rupee exactly as the generator rounds a percentage, so exactly 15% is always within it.
 *
 * Checked on every write - a new quotation, the next version, a duplicate, a draft saved or
 * generated - and on nothing already stored: a quotation raised under the old limit is never
 * rewritten, only an edit of it is held to this one.
 */
const MAX_DISCOUNT_PERCENT = 15;

/** What the Discount comes off, and the rupees it may come to. */
function discountLimitOf(payload) {
  const cost = (payload.subtotal || 0) + (payload.performanceCost || 0);
  return { cost, cap: Math.round(cost * (MAX_DISCOUNT_PERCENT / 100)) };
}

/** The rupees the Discount box takes off: as typed, or the percentage of the cost, whole rupees. */
function discountRupeesOf(payload) {
  const { cost } = discountLimitOf(payload);
  return payload.discountInputSource === "AMOUNT" ? (payload.discountAmount || 0) : Math.round(cost * ((payload.discount || 0) / 100));
}

const extraDiscountRupeesOf = (payload) => (Array.isArray(payload.extraDiscounts)
  ? payload.extraDiscounts.reduce((sum, entry) => sum + entry.amount, 0)
  : (payload.extraDiscountAmount || 0));

const quotationPayloadSchema = z.object({
  enquiryId: z.string().trim().max(100).nullable().optional(),
  clientName: z.string().trim().max(191).nullable().optional(),
  clientMainNumber: z.string().trim().max(30).nullable().optional(),
  contactNumber: z.string().trim().max(30).nullable().optional(),
  sourceBranch: z.string().trim().max(30).nullable().optional(),
  nearestBranch: z.string().trim().max(30).nullable().optional(),
  eventVenue: z.string().trim().max(500).nullable().optional(),
  followedBy: z.string().trim().max(191).nullable().optional(),
  referredBy: z.string().trim().max(191).nullable().optional(),
  secondaryContactNumber: z.string().trim().max(30).nullable().optional(),
  /*
   * Prose, and the client reads it, so it is capped rather than left to the column's own
   * limit: 2000 characters is several paragraphs, and the field in the generator refuses
   * more, so anything longer arriving here is not somebody typing.
   */
  additionalNotes: z.string().trim().max(2000).nullable().optional(),
  /*
   * The brand, as the generator names it - `DUM_DUM`, `QUA_QUA`, `CORP` - or nothing from a client
   * that predates brands, in which case `vertical` below decides. Resolved and stamped by
   * `insertQuotationVersion`; it is never trusted to be a brand that exists.
   */
  quotationBrand: z.string().trim().max(20).nullable().optional(),
  vertical: z.string().trim().max(50).nullable().optional(),
  /*
   * Who this quotation is shared with, as employee ids: people who may read and change it although
   * their own scope does not reach it. Sent with the quotation rather than through a route of its
   * own, because it is answered in the same form; left out entirely, the shares are untouched.
   */
  sharedEmployeeIds: z.array(z.coerce.number().int().positive()).max(50).optional(),
  gstPercent: z.union([z.coerce.number().finite().min(0).max(100), z.literal(""), z.null()]).optional(),
  subtotal: z.coerce.number().finite().min(0).default(0),
  discount: z.coerce.number().finite().min(0).max(100).default(0),
  /*
   * Which of the Summary's two discount boxes was typed - the percentage, or the rupees - and the
   * rupees it came to. `discount` above stays the percentage the column holds (for typed rupees,
   * what they came to), so the register reads every quotation alike; a quotation typed in rupees
   * reopens on `discountAmount`. An older quotation carries no source and reads as a percentage.
   */
  discountInputSource: z.enum(["PERCENTAGE", "AMOUNT"]).optional(),
  discountAmount: z.coerce.number().finite().min(0).optional(),
  /*
   * The Performance Cost added before the discount, and the extra discounts - up to three, each a
   * reason and a rupee amount, never a percentage - taken off after it. Kept in the payload beside
   * the discount; an older quotation has none of them, which reads as none. `extraDiscountReason`
   * and `extraDiscountAmount` are how a quotation raised when there could be only one extra
   * discount carries it, and are still read. Together the extra discounts never come to more than
   * the cost, since they cannot take the total below nothing.
   */
  performanceCost: z.coerce.number().finite().min(0).optional(),
  extraDiscounts: z.array(z.object({
    reason: z.string().trim().max(191).optional().default(""),
    amount: z.coerce.number().finite().min(0),
  })).max(3).optional(),
  extraDiscountReason: z.string().trim().max(191).nullable().optional(),
  extraDiscountAmount: z.coerce.number().finite().min(0).optional(),
  /*
   * The Round Off Discount: rupees only, never a percentage, taken off last to bring the total to a
   * round number. Already out of `amount`; the client's copy lists no line for it, and
   * `clientFacingQuotation` does not send it. An older quotation has none, which reads as none.
   */
  roundOffDiscount: z.coerce.number().finite().min(0).optional(),
  amount: z.coerce.number().finite().min(0).default(0),
  serviceCount: z.coerce.number().int().min(0).default(0),
  deliverableCount: z.coerce.number().int().min(0).default(0),
  shoots: z.array(z.any()).default([]),
  /*
   * A line's quantity and price are checked, and nothing else about it is: the rows carry whatever
   * the service table drew, and a field it did not have yesterday must still load today. A quantity
   * that is present has to be at least one - a line for nothing is not a line - and a price that is
   * present has to be a number that is not negative. Absent, blank and null are how older payloads
   * spell "not answered", and they still pass.
   */
  services: z.array(quotationLineSchema).default([]),
  deliverables: z.array(quotationLineSchema).default([]),
  // Which packages were applied to which shoot, recorded for the snapshot; the rows are the truth.
  packages: z.array(z.any()).default([]),
}).passthrough().refine((payload) => {
  // Typed rupees are out of the cost they come off, Performance Cost included.
  if (payload.discountInputSource !== "AMOUNT") return true;
  return !(payload.discountAmount > payload.subtotal + (payload.performanceCost || 0));
}, { message: "The discount cannot be more than the quotation's cost.", path: ["discountAmount"] }).refine((payload) => {
  const cost = payload.subtotal + (payload.performanceCost || 0);
  const listed = Array.isArray(payload.extraDiscounts) ? payload.extraDiscounts.reduce((sum, entry) => sum + entry.amount, 0) : 0;
  return !(listed > cost) && !(payload.extraDiscountAmount > cost);
}, { message: "The extra discounts cannot come to more than the quotation's cost.", path: ["extraDiscounts"] }).refine((payload) => {
  /*
   * The percentage the quotation is saved at. Typed as a percentage it is what was typed; typed in
   * rupees it is what they came to, to two places - so it is held to the cap with the rounding of
   * the rupees allowed for, and the rupees themselves are held below.
   */
  if (payload.discountInputSource !== "AMOUNT") return !(payload.discount > MAX_DISCOUNT_PERCENT);
  const { cost, cap } = discountLimitOf(payload);
  return !(payload.discount > Math.max(MAX_DISCOUNT_PERCENT, cost > 0 ? Math.ceil((cap / cost) * 10000) / 100 : 0));
}, { message: `The discount cannot be more than ${MAX_DISCOUNT_PERCENT}%.`, path: ["discount"] }).refine((payload) => {
  const { cap } = discountLimitOf(payload);
  // The rupees stored beside a percentage are what the client's copy prints, so they are held too.
  return !(discountRupeesOf(payload) > cap) && !(payload.discountAmount > cap);
}, { message: `The discount cannot be more than ${MAX_DISCOUNT_PERCENT}% of the quotation's cost.`, path: ["discountAmount"] }).refine((payload) => {
  // The extra discounts are not held to the 15%; together with the Discount they take the total to
  // nothing and no further, as the generator holds them.
  const { cost } = discountLimitOf(payload);
  return !(discountRupeesOf(payload) + extraDiscountRupeesOf(payload) > cost);
}, { message: "The discount and extra discounts together cannot be more than the quotation's cost.", path: ["extraDiscounts"] }).refine((payload) => {
  // The Round Off Discount comes off what the others leave, and no further than nothing.
  const { cost } = discountLimitOf(payload);
  return !(discountRupeesOf(payload) + extraDiscountRupeesOf(payload) + (payload.roundOffDiscount || 0) > cost);
}, { message: "The round off discount cannot take the quotation below nothing.", path: ["roundOffDiscount"] });

const projectSchema = z.object({
  enquiryId: requiredText.max(100),
  whatsappGroupNameId: z.string().trim().min(1).max(191).nullable().optional(),
  whatsappGroupName: requiredText.max(500),
  clientMainNumber: requiredText.max(30),
  vertical: z.enum(verticals).nullable().optional(),
  sourceBranch: requiredText.max(30),
  quotationId: z.string().trim().max(191).nullable().optional(),
  deliverables: z.enum(["As per Quote", "Others"]).default("As per Quote"),
  deliverablesDetails: optionalText,
  salesPreProductionRemarks: optionalText,
  salesProductionRemarks: optionalText,
  salesPostProductionRemarks: optionalText,
  mainEventDateKnown: z.boolean().default(false),
  mainEventDate: optionalEventDate,
  /*
   * Which converted status the lead that is being converted should end up reading as.
   *
   * Sent only by a conversion started from the CRM's status pills, where Qua Qua offers
   * "Converted & Followup" beside "Converted". Not validated as an enum here: `markCrmLeadConverted`
   * checks it against the one list of converted statuses it already keeps, and ignores anything
   * else - so a second list here could only drift from that one.
   */
  crmLeadStatus: z.string().trim().max(50).nullable().optional(),
  initialConvertedValue: z.coerce.number().finite().min(0),
  groupType: z.enum(groupTypes).nullable().optional(),
  shoots: z.array(z.object({
    dateCreated: optionalShootDate,
    shoot: requiredText.max(191),
    shootPlace: requiredText.max(191),
    // The lists are what the dialog sends; the singulars are derived from them and kept only so
    // older readers of a shoot are undisturbed. Either may arrive, and at least one must.
    shootType: z.enum(shootTypeOptions).optional(),
    shootTypes: z.array(z.enum(shootTypeOptions)).min(1).max(shootTypeOptions.length).optional(),
    isMainEvent: z.boolean().default(false),
    /*
     * Both optional: where a shoot happens is often settled long after it is booked - a quotation is
     * raised with a city in mind at most - so the dialog asks for them and neither holds the save.
     */
    district: z.string().trim().max(191).nullable().optional(),
    state: z.string().trim().max(191).nullable().optional(),
    // One place per name of a "Haldi + Mehandi" shoot held at several - `services/shootLocations.js`.
    shootLocations: shootLocationsSchema,
    sessionTiming: z.enum(shootSessionTimingOptions).optional(),
    sessionTimings: z.array(z.enum(shootSessionTimingOptions)).min(1).max(shootSessionTimingOptions.length).optional(),
    sessionDurationHours: z.coerce.number().int().min(0).nullable().optional(),
    sessionDurationMinutes: z.coerce.number().int().min(0).max(59).nullable().optional(),
    foodTakenCareBy: z.enum(shootCareOwnerOptions).default("Studio"),
    accommodation: z.enum(shootCareOwnerOptions).default("Studio"),
    travel: z.enum(shootCareOwnerOptions).default("Studio"),
    // No `.default()`: a field with one is never missing, and this one has to be answered.
    preference: z.enum(shootPreferenceOptions, { message: "Select a Preference: Groom, Bride, or Both." }),
    services: z.array(projectShootServiceInputSchema).optional(),
    deliverables: z.array(projectShootDeliverableInputSchema).optional(),
    // Laid down by the finalized quotation (Sale Extras' baseline) - see `sale-extras/booking.js`.
    fromQuotation: z.boolean().optional(),
  })).optional(),
}).superRefine((data, context) => {
  if (data.deliverables === "Others" && !data.deliverablesDetails?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["deliverablesDetails"], message: "Deliverables Details is required when Deliverables is Others." });
  }
  if (data.mainEventDateKnown && !data.mainEventDate) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["mainEventDate"], message: "Main Event Date is required when its status is Yes." });
  }
  if (data.whatsappGroupNameId && (!data.vertical || !data.groupType)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["whatsappGroupNameId"], message: "Selected WhatsApp group name details are incomplete." });
  }
  (data.shoots || []).forEach((shoot, index) => {
    const locationIssue = shootLocationsIssue(shoot);
    if (locationIssue) context.addIssue({ code: z.ZodIssueCode.custom, path: ["shoots", index, "shootLocations"], message: locationIssue });
    if (!shootTypesOf(shoot).length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["shoots", index, "shootTypes"], message: "Select at least one Shoot Type." });
    }
    const timings = shootTimingsOf(shoot);
    if (!timings.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["shoots", index, "sessionTimings"], message: "Select at least one Session Timing." });
      return;
    }
    // Only Hourly is typed, so it is the only timing that can be left blank by mistake.
    if (!timings.includes("Hourly")) return;
    const hours = Number(shoot.sessionDurationHours || 0);
    const minutes = Number(shoot.sessionDurationMinutes || 0);
    if (hours === 0 && minutes === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["shoots", index, "sessionDurationHours"], message: "Enter duration for hourly session timing." });
    }
  });
});

const projectIdentificationSchema = z.object({
  projectManager: optionalText,
  projectManagerEmployeeId: optionalPositiveInt,
  preProductionCoordinator: optionalText,
  preProductionCoordinatorEmployeeId: optionalPositiveInt,
  creativeManager: optionalText,
  creativeManagerEmployeeId: optionalPositiveInt,
  postProductionCoordinator: optionalText,
  postProductionCoordinatorEmployeeId: optionalPositiveInt,
  productionManager: optionalText,
  productionManagerEmployeeId: optionalPositiveInt,
  welcomeGift: z.enum(["Applicable", "Not Applicable"]).nullable().optional(),
  welcomeGiftAssignee: optionalText,
  welcomeGiftEmployeeId: optionalPositiveInt,
  shootCompletedGift: z.enum(["Applicable", "Not Applicable"]).nullable().optional(),
  shootCompletedGiftAssignee: optionalText,
  shootCompletedGiftEmployeeId: optionalPositiveInt,
  projectValidityMonths: z.coerce.number().int().min(1).nullable().optional(),
  storageNeeded: z.enum(["Yes", "No"]).nullable().optional(),
  /*
   * Where the project's hard disk has got to, answered on Pre Production → General. Three answers,
   * not the eight Client Storage runs on: pre production's part is the disk coming back and being
   * handed on, and handing it over starts the storage record (`startStorageForHandover`).
   */
  hardDiskStatus: z.enum(["NOT_RECEIVED", "RECEIVED", "HANDED_OVER"]).nullable().optional(),
  crdDocumentStatus: z.enum(["Applicable", "Not Yet Received", "Groom Side Received", "Bride side Received", "Both Received", "Not Applicable"]).nullable().optional(),
  salesPreProductionRemarks: optionalText,
  salesProductionRemarks: optionalText,
  salesPostProductionRemarks: optionalText,
});

const projectShootSchema = z.object({
  dateCreated: optionalShootDate,
  shoot: requiredText.max(191),
  shootPlace: requiredText.max(191),
  shootType: z.enum(shootTypeOptions).optional(),
  shootTypes: z.array(z.enum(shootTypeOptions)).min(1).max(shootTypeOptions.length).optional(),
  isMainEvent: z.boolean().default(false),
  // Optional, for the reason on the booking's own shoots above.
  // Both optional, as on the shoot dialog they are typed in.
  district: z.string().trim().max(191).nullable().optional(),
  state: z.string().trim().max(191).nullable().optional(),
  shootLocations: shootLocationsSchema,
  sessionTiming: z.enum(shootSessionTimingOptions).optional(),
  sessionTimings: z.array(z.enum(shootSessionTimingOptions)).min(1).max(shootSessionTimingOptions.length).optional(),
  sessionDurationHours: z.coerce.number().int().min(0).nullable().optional(),
  sessionDurationMinutes: z.coerce.number().int().min(0).max(59).nullable().optional(),
  foodTakenCareBy: z.enum(shootCareOwnerOptions).default("Studio"),
  accommodation: z.enum(shootCareOwnerOptions).default("Studio"),
  travel: z.enum(shootCareOwnerOptions).default("Studio"),
  preference: z.enum(shootPreferenceOptions, { message: "Select a Preference: Groom, Bride, or Both." }),
}).superRefine((data, context) => {
  const locationIssue = shootLocationsIssue(data);
  if (locationIssue) context.addIssue({ code: z.ZodIssueCode.custom, path: ["shootLocations"], message: locationIssue });
  if (!shootTypesOf(data).length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["shootTypes"], message: "Select at least one Shoot Type." });
  }
  const timings = shootTimingsOf(data);
  if (!timings.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sessionTimings"], message: "Select at least one Session Timing." });
    return;
  }
  if (!timings.includes("Hourly")) return;
  const hours = Number(data.sessionDurationHours || 0);
  const minutes = Number(data.sessionDurationMinutes || 0);
  if (hours === 0 && minutes === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sessionDurationHours"], message: "Enter duration for hourly session timing." });
  }
});

const projectShootsSchema = z.array(projectShootSchema).min(1, "Add at least one shoot.");

// This belongs to the durable deliverable allocation. Retaining its row preserves Image Selection
// selections when Project Management changes only a quantity.
const deliverableSelectionLimitSchema = z.coerce.number().int().min(1).max(100000).nullable().optional();

const productionDeliverableSchema = z.object({
  shootId: z.string().trim().min(1).max(191),
  deliverableName: requiredText.max(191),
  quantity: z.coerce.number().int().min(1),
  selectionLimit: deliverableSelectionLimitSchema,
});

async function syncProjectShootDeliverables(transaction, projectId, items) {
  const keyOf = (shootId, deliverableName) => `${shootId}:${String(deliverableName).trim().toLowerCase()}`;
  const existing = await transaction.projectShootDeliverable.findMany({
    where: { projectId, deletedAt: null },
    select: { id: true, shootId: true, deliverableName: true },
  });
  const byKey = new Map(existing.map((row) => [keyOf(row.shootId, row.deliverableName), row]));
  const kept = new Set();
  for (const item of items) {
    const match = byKey.get(keyOf(item.shootId, item.deliverableName));
    if (match) {
      kept.add(match.id);
      // Callers that omit this field must not clear a limit configured in Image Selection.
      await transaction.projectShootDeliverable.update({
        where: { id: match.id },
        data: { quantity: item.quantity, ...(item.selectionLimit === undefined ? {} : { selectionLimit: item.selectionLimit }) },
      });
    } else {
      await transaction.projectShootDeliverable.create({ data: { ...item, projectId } });
    }
  }
  const retired = existing.filter((row) => !kept.has(row.id)).map((row) => row.id);
  if (retired.length) await transaction.projectShootDeliverable.updateMany({ where: { id: { in: retired } }, data: { deletedAt: new Date() } });
}

const productionDeliverablesSchema = z.object({
  items: z.array(productionDeliverableSchema).min(1, "Add at least one deliverable."),
}).superRefine((data, context) => {
  const seen = new Set();
  data.items.forEach((item, index) => {
    const key = `${item.shootId}:${item.deliverableName.trim().toLowerCase()}`;
    if (seen.has(key)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index, "deliverableName"], message: "Duplicate deliverables are not allowed for the same shoot." });
    seen.add(key);
  });
});

const postProductionAllocationSchema = z.object({
  shootId: z.string().trim().min(1).max(191),
  serviceName: requiredText.max(191),
  serviceDetails: optionalText,
  selectionLimit: z.coerce.number().int().min(1).max(100000).nullable().optional(),
});

const serviceAllocationCreateSchema = z.object({
  serviceDefinitionId: z.string().trim().min(1).max(191),
  quantity: z.coerce.number().int().positive().nullable().optional(),
  sessionOptionId: z.string().trim().max(191).nullable().optional(),
  durationHours: z.coerce.number().int().min(0).nullable().optional(),
  durationMinutes: z.coerce.number().int().min(0).max(59).nullable().optional(),
  workDays: z.coerce.number().int().positive().nullable().optional(),
  timingMinutes: z.coerce.number().int().positive().nullable().optional(),
  sizeOptionValueId: z.string().trim().max(191).nullable().optional(),
  remarks: optionalText,
});

const serviceAllocationUpdateSchema = z.object({
  quantity: z.coerce.number().int().positive().nullable().optional(),
  sessionOptionId: z.string().trim().max(191).nullable().optional(),
  durationHours: z.coerce.number().int().min(0).nullable().optional(),
  durationMinutes: z.coerce.number().int().min(0).max(59).nullable().optional(),
  workDays: z.coerce.number().int().positive().nullable().optional(),
  timingMinutes: z.coerce.number().int().positive().nullable().optional(),
  sizeOptionValueId: z.string().trim().max(191).nullable().optional(),
  remarks: optionalText,
});

const deliverableAllocationCreateSchema = z.object({
  deliverableDefinitionId: z.string().trim().min(1).max(191),
  quantity: z.coerce.number().int().min(1).nullable().optional(),
  numberOfPhotos: z.coerce.number().int().min(0).nullable().optional(),
  selectionLimit: deliverableSelectionLimitSchema,
  sizeOptionValueId: z.string().trim().max(191).nullable().optional(),
  size: optionalText,
  remarks: optionalText,
  variant: deliverableVariantInputSchema,
});

const deliverableAllocationUpdateSchema = z.object({
  quantity: z.coerce.number().int().min(1).nullable().optional(),
  numberOfPhotos: z.coerce.number().int().min(0).nullable().optional(),
  selectionLimit: deliverableSelectionLimitSchema,
  sizeOptionValueId: z.string().trim().max(191).nullable().optional(),
  size: optionalText,
  remarks: optionalText,
});

const masterDefinitionSchema = z.object({
  name: requiredText.max(191),
});
const TIMING_MODES = ["NONE", "HALF_SESSION", "FULL_SESSION", "HOURS_MINUTES"];

/*
 * The two halves of the studio's session scale, and the option value codes they pick.
 *
 * A service may offer one, the other, or both, so the session dropdown on a shoot is narrowed to
 * what the service actually allows rather than showing the whole set.
 */
const SESSION_TIMING_MODES = ["HALF_SESSION", "FULL_SESSION"];
const SHOOT_TYPES = ["STUDIO", "OUTDOOR"];
// The timings a price can be set against - every real timing; "NONE" is the absence of one.
const PRICED_TIMING_MODES = TIMING_MODES.filter((mode) => mode !== "NONE");

/*
 * What a deliverable is, and how each kind is priced.
 *
 * An image kind is priced per size, from the kind's own size list - the seeded option set named
 * here by code, which `sizeOptionSetId` is pointed at when the kind is chosen. A full-length video
 * is priced per session; a teaser or a candid is one figure.
 */
const DELIVERABLE_MEDIA_TYPES = ["IMAGE", "VIDEO"];
const DELIVERABLE_KINDS = { IMAGE: ["FRAMES", "ALBUM", "CALENDAR"], VIDEO: ["TEASER", "FULL_LENGTH", "CANDID"] };
const DELIVERABLE_SIZE_SET_CODE = { FRAMES: "DELIVERABLE_FRAME_SIZE", ALBUM: "DELIVERABLE_ALBUM_SIZE", CALENDAR: "DELIVERABLE_PRINT_SIZE" };
const deliverablePricingShape = (kind) => (DELIVERABLE_SIZE_SET_CODE[kind] ? "SIZE" : kind === "FULL_LENGTH" ? "SESSION" : kind ? "SINGLE" : null);
const DELIVERABLE_ALL_KINDS = [...DELIVERABLE_KINDS.IMAGE, ...DELIVERABLE_KINDS.VIDEO];

/** The size ids a deliverable's pricing names, whatever kind they are priced under. */
const pricedSizeIds = (definition) => [...new Set((Array.isArray(definition?.pricing) ? definition.pricing : []).map((row) => row?.sizeOptionValueId).filter(Boolean))];

/**
 * The sizes a definition's pricing names, as option value rows, attached to each definition the
 * list answers with - deliverables and services alike. A deliverable priced under Frames and Album
 * is sized from both lists, a service sold by size from the studio's service size lists, and the
 * project and quotation pickers offer every priced size together - so the values are read here,
 * once for the page, rather than left for each screen to look up by id.
 */
async function withPricedSizeOptions(definitions) {
  const ids = [...new Set(definitions.flatMap(pricedSizeIds))];
  const values = ids.length
    ? await prisma.projectOptionSetValue.findMany({ where: { id: { in: ids }, isActive: true }, orderBy: [{ label: "asc" }] })
    : [];
  const byId = new Map(values.map((value) => [value.id, value]));
  return definitions.map((definition) => ({
    ...definition,
    // A row saved while a deliverable had one kind carries none of its own; it reads as that kind.
    pricing: Array.isArray(definition.pricing) ? definition.pricing.map((row) => ({ kind: definition.kind || null, ...row })) : definition.pricing,
    pricedSizeOptions: pricedSizeIds(definition).map((id) => byId.get(id)).filter(Boolean),
  }));
}

/**
 * A deliverable line's size: any size its pricing names, or one from the list it is pointed at.
 *
 * The definition's list is one list; its pricing may span several - Frames sizes and Album sizes
 * on one deliverable - and the line's picker offers all of them, so this accepts all of them.
 */
async function validateDeliverableSize(transaction, definition, optionValueId) {
  if (!optionValueId) return null;
  if (pricedSizeIds(definition).includes(optionValueId)) {
    const value = await transaction.projectOptionSetValue.findFirst({ where: { id: optionValueId, isActive: true }, select: { id: true } });
    if (value) return value.id;
  }
  return validateOptionValue(transaction, definition?.sizeOptionSetId, optionValueId, "Select a valid deliverable size.");
}

const serviceDefinitionUpdateSchema = z.object({
  /*
   * What the studio charges, to two decimal places.
   *
   * Nullable rather than defaulted to zero: a service nobody has priced yet is a real state, and a
   * zero would claim it is free. Cleared is an answer, which is why null is accepted.
   */
  price: z.coerce.number().min(0).max(99999999).nullable().optional(),
  name: requiredText.max(191).optional(),
  quantityMode: z.enum(["NONE", "INTEGER"]).nullable().optional(),
  /*
   * How many of this service a project starts with, or null for a service that is not counted.
   *
   * Nullable on purpose: null is the answer, not the absence of one. A drone either comes or it
   * does not, and clearing the box has to be able to say so.
   */
  defaultQuantity: z.coerce.number().int().min(0).max(9999).nullable().optional(),
  /*
   * The duration a shoot starts with when this service is added, in the same two parts the shoot
   * itself stores. Nullable for the same reason as the quantity: cleared is an answer.
   *
   * Minutes are bounded at 59 because they are the remainder of an hour, not a duration of their
   * own - "90 minutes" is an hour and a half, and a form that let it through would produce a
   * shoot reading "2h 90m".
   */
  defaultDurationHours: z.coerce.number().int().min(0).max(999).nullable().optional(),
  defaultDurationMinutes: z.coerce.number().int().min(0).max(59).nullable().optional(),
  timingMode: z.enum(TIMING_MODES).nullable().optional(),
  // Every timing the service may be booked with. Deduplicated so a form cannot write the same one
  // twice, and bounded by the enum so it cannot write one that does not exist.
  timingModes: z.array(z.enum(TIMING_MODES)).max(TIMING_MODES.length).nullable().optional(),
  shootTypes: z.array(z.enum(SHOOT_TYPES)).max(SHOOT_TYPES.length).nullable().optional(),
  /*
   * The price per shoot type and session timing - see `pricing` on the model. Bounded like `price`
   * above; a null price is a row cleared on the form and is dropped below rather than stored.
   */
  // Whether the service is sold by size - Yes puts a Size on every pricing row below.
  sizeEnabled: z.boolean().optional(),
  // Whether the service brings deliverables with it. Only TRUE brings any; see the model.
  deliverableAdded: z.boolean().optional(),
  /*
   * The deliverable variants the service brings whenever it is added to a shoot, each named by its
   * three ids. Checked against the deliverables that exist in the handler, as a pricing row's are.
   */
  deliverables: z.array(z.object({
    deliverableId: z.string().trim().max(191),
    brandId: z.string().trim().max(191),
    variantId: z.string().trim().max(191),
  })).max(50).optional(),
  // Whether the service is given rather than charged for. Only TRUE is; see the model.
  complimentary: z.boolean().optional(),
  pricing: z.array(z.object({
    shootType: z.enum(SHOOT_TYPES),
    timingMode: z.enum(PRICED_TIMING_MODES),
    // The size as typed on the line, with the list entry's id beside it where the words match one
    // of the studio's service size lists; only read where the service is sold by size.
    size: z.string().trim().max(100).nullable().optional(),
    sizeOptionValueId: z.string().trim().max(191).nullable().optional(),
    // The whole hours an Hours / Minutes row prices - "3 hours at ₹3,000" - and nothing on a
    // session row. Several hourly rows may stand beside each other, each for a different length.
    hours: z.coerce.number().int().min(1).max(999).nullable().optional(),
    // What a session row says its booking runs, as typed - "4-5 Hours (Half)" unless the studio
    // wrote its own. Words for the screen, read by nothing else.
    duration: z.string().trim().max(60).nullable().optional(),
    price: z.coerce.number().min(0).max(99999999).nullable(),
    /*
     * The deliverable variants this booking brings with it, each named by its three ids. Checked
     * against the deliverables that actually exist in the handler, where the database is - an id
     * naming nothing is dropped rather than stored, so a variant deleted in Settings cannot leave
     * a service quoting something that is no longer sold.
     */
    deliverables: z.array(z.object({
      deliverableId: z.string().trim().max(191),
      brandId: z.string().trim().max(191),
      variantId: z.string().trim().max(191),
    })).max(50).optional(),
  })).max(100).nullable().optional(),
  timingOptionSetId: z.string().trim().max(191).nullable().optional(),
  sizeOptionSetId: z.string().trim().max(191).nullable().optional(),
  /*
   * A note about the service, typed, deciding nothing. A boolean is still accepted so a caller that
   * predates this - and the fakes in the test suites - go on working; it is written out as the Yes
   * or No it meant.
   */
  remarksEnabled: z.union([z.string().trim().max(2000), z.boolean()]).nullable().optional(),
});
/** One of a deliverable's three typed answers: words, or the boolean they used to be. */
const deliverableAnswer = z.union([z.string().trim().max(191), z.boolean()]).nullable();

const deliverableDefinitionUpdateSchema = z.object({
  /*
   * What the studio charges, to two decimal places.
   *
   * Nullable rather than defaulted to zero: a service nobody has priced yet is a real state, and a
   * zero would claim it is free. Cleared is an answer, which is why null is accepted.
   */
  price: z.coerce.number().min(0).max(99999999).nullable().optional(),
  name: requiredText.max(191).optional(),
  /*
   * No. of Count, Image Selection and Remarks: typed words, not a Yes or a No.
   *
   * They still decide things - Image Selection admits a deliverable to that module, the other two
   * decide whether an allocation stores a photo count and remarks - and the words are read back
   * into an answer by `deliverableAnswers`. A boolean is still accepted so a caller that predates
   * this, and the fakes in the test suites, go on working; it is written out as Yes or No below.
   */
  photoCountEnabled: deliverableAnswer.optional(),
  imageSelectionEnabled: deliverableAnswer.optional(),
  // Whether the deliverable is given rather than charged for - its own answer, independent of any
  // service's. Only TRUE is; see the model.
  complimentary: z.boolean().optional(),
  sizeOptionSetId: z.string().trim().max(191).nullable().optional(),
  // Remarks is a textarea rather than a box, so it takes more than a line.
  remarksEnabled: z.union([z.string().trim().max(2000), z.boolean()]).nullable().optional(),
  /*
   * The companies this deliverable is sold by, and the variants each sells it in - the whole list,
   * replacing whatever it holds. A brand with nothing in it and a variant with nothing in it are
   * dropped rather than stored; what the deliverable's type does not ask for is cleared, so a video
   * variant can never be left carrying a frame size.
   *
   * Omitted entirely means "leave the brands alone", which is what every caller that predates this
   * does - and what a deliverable whose type has not been answered yet sends, since the dialog
   * cannot show the variant boxes until it knows which ones to show.
   */
  brands: z.array(z.object({
    // The row being kept, where the form opened on one - see `saveDeliverableBrands`.
    id: z.string().trim().max(191).optional(),
    name: z.string().trim().max(191).nullable().optional(),
    variants: z.array(z.object({
      id: z.string().trim().max(191).optional(),
      size: z.string().trim().max(100).nullable().optional(),
      frameInches: z.string().trim().max(60).nullable().optional(),
      videoLength: z.string().trim().max(100).nullable().optional(),
      price: z.coerce.number().min(0).max(99999999).nullable().optional(),
    })).max(100).optional(),
  })).max(50).nullable().optional(),
  // How the deliverable is described, as typed - words for the screen and the table. `imageSize`
  // and `frameInches` belong to an image, `videoLength` to a video; the type decides which survive.
  brandName: z.string().trim().max(191).nullable().optional(),
  imageSize: z.string().trim().max(100).nullable().optional(),
  videoLength: z.string().trim().max(100).nullable().optional(),
  frameInches: z.string().trim().max(60).nullable().optional(),
  // Image or video, and the pricing under it - see `pricing` on the model. `kind` and `pricing`
  // are checked against `mediaType` in the handler, where the answer lives.
  mediaType: z.enum(DELIVERABLE_MEDIA_TYPES).nullable().optional(),
  kind: z.enum([...DELIVERABLE_KINDS.IMAGE, ...DELIVERABLE_KINDS.VIDEO]).nullable().optional(),
  pricing: z.array(z.object({
    kind: z.enum(DELIVERABLE_ALL_KINDS),
    // The size as typed on the line; `sizeOptionValueId` rides along where the words match an
    // entry of the kind's list, and is worked out here where the form did not send it.
    size: z.string().trim().max(100).nullable().optional(),
    sizeOptionValueId: z.string().trim().max(191).nullable().optional(),
    timingMode: z.enum(SESSION_TIMING_MODES).nullable().optional(),
    price: z.coerce.number().min(0).max(99999999).nullable(),
  })).max(200).nullable().optional(),
  // The shoot type, timings and duration, bounded exactly as a service's are above: a deliverable
  // is configured the way a service is, and the same project screens read both.
  shootTypes: z.array(z.enum(SHOOT_TYPES)).max(SHOOT_TYPES.length).nullable().optional(),
  timingModes: z.array(z.enum(TIMING_MODES)).max(TIMING_MODES.length).nullable().optional(),
  defaultDurationHours: z.coerce.number().int().min(0).max(999).nullable().optional(),
  defaultDurationMinutes: z.coerce.number().int().min(0).max(59).nullable().optional(),
});
const optionSetValueCreateSchema = z.object({
  label: requiredText.max(191),
  /*
   * Where in the list it goes, when the form says. Optional, because it usually does not: an option
   * added without one is appended, which is what somebody typing a name and pressing Add means.
   */
  /*
   * What one unit of this size costs. A 12x6 album is not priced like a 36x18 one, so the price
   * belongs to the size rather than to the deliverable offering it.
   *
   * Nullable rather than zero, for the same reason a service's price is: unpriced is not free.
   */
  pricePerQuantity: z.coerce.number().min(0).max(99999999).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
});
const optionSetValueUpdateSchema = z.object({
  /*
   * What one unit of this size costs. A 12x6 album is not priced like a 36x18 one, so the price
   * belongs to the size rather than to the deliverable offering it.
   *
   * Nullable rather than zero, for the same reason a service's price is: unpriced is not free.
   */
  pricePerQuantity: z.coerce.number().min(0).max(99999999).nullable().optional(),
  label: requiredText.max(191).optional(),
});

const startProjectDraftSchema = projectIdentificationSchema.extend({
  productionServices: z.array(postProductionAllocationSchema).optional(),
  postProductionDeliverables: z.array(productionDeliverableSchema).optional(),
  /*
   * What the project was signed for, correctable from Edit Project.
   *
   * It is a *sale* field, and every other sale field on a started project stays Sales Manager's
   * through `PATCH /projects/:id`. This one is here because it is the figure the whole Shedule
   * Payment section plans against — every amount below it is a share of it — and the person running
   * the project is the one who finds out it is wrong, at the point they are scheduling against it.
   * Sending them to another screen under another permission to correct one number was the reason it
   * went uncorrected.
   *
   * Optional, so the autosave that writes this schema on every pause does not have to carry it, and
   * so Start or Edit Project with the box left empty cannot blank it by omission. See
   * `saveStartProjectWork`, which ignores `undefined` and writes anything else.
   */
  initialConvertedValue: z.coerce.number().finite().min(0).optional(),
  /*
   * The reason for switching Welcome Kit, Shoot Completed Gift, Storage Needed or CRD Document
   * between applicable and not, keyed by the field. Kept by `recordApplicabilityChanges` beside the
   * switch itself; Pre Production's General panel asks for it, and a save that switches nothing
   * writes nothing.
   */
  applicabilityRemarks: z.object({
    welcomeGift: optionalText,
    shootCompletedGift: optionalText,
    storageNeeded: optionalText,
    crdDocumentStatus: optionalText,
  }).optional(),
});

/**
 * The Project Setup answers a project must carry before it may be *started*, as opposed to saved.
 *
 * Deliberately not on `startProjectDraftSchema`: that schema is also what the autosave writes every
 * time the form pauses, and a half-typed form is exactly what a draft is for. The strictness
 * belongs to the one endpoint that moves a project out of "Yet to Start", after which nothing asks
 * these questions again.
 *
 * The same rules the form marks its fields with — `projectSetupProblems` in
 * `frontend/src/lib/projectSetupValidation.mjs`. The form is what makes them readable; this is what
 * makes them true, since the endpoint is reachable without it. Keep the two in step: a rule only
 * here refuses a save the form said was fine, and a rule only there is not a rule.
 *
 * The four assignment fields above these — Project Manager, the coordinators, Creative Manager —
 * are intentionally absent. A project is routinely started before the studio has settled who runs
 * it, and they are not marked required on the form either.
 */
/*
 * What Pre Production's General panel may change: the items it shows, and the reason for any it
 * switches on or off. Nothing else of the project is reachable through it - not the people it is
 * staffed to, its sale or its plan.
 *
 * `productionManagerEmployeeId` was here while General was the screen that assigned that seat. It
 * is asked for on Edit Project with the other four now, so Pre Production write no longer carries
 * it: a field dropped from the panel but left in this list stays reachable to anyone who can post
 * to the route.
 */
const preProductionGeneralSchema = startProjectDraftSchema.pick({
  welcomeGift: true,
  welcomeGiftEmployeeId: true,
  shootCompletedGift: true,
  shootCompletedGiftEmployeeId: true,
  storageNeeded: true,
  hardDiskStatus: true,
  crdDocumentStatus: true,
  applicabilityRemarks: true,
}).strict();

const startProjectSchema = startProjectDraftSchema.superRefine((data, context) => {
  const missing = (path, message) => context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

  // A gift that is being given is somebody's job. Starting one with nobody named puts a row on
  // Client Gifts that nothing will ever move along, so it is refused now rather than chased later.
  const gifts = [["welcomeGift", "welcomeGiftEmployeeId", "Welcome Gift"], ["shootCompletedGift", "shootCompletedGiftEmployeeId", "Shoot Completed Gift"]];
  for (const [giftField, assigneeField, label] of gifts) {
    if (!data[giftField]) missing(giftField, `Answer ${label}.`);
    else if (data[giftField] === "Applicable" && !data[assigneeField]) missing(assigneeField, `Assign an employee to take care of the ${label}.`);
  }

  if (!data.projectValidityMonths) missing("projectValidityMonths", "Enter Project Validity (In Months).");
  if (!data.storageNeeded) missing("storageNeeded", "Answer Storage Needed.");
  /*
   * The one that used to be marked required on the form and checked by nobody.
   *
   * Null is not a third answer: `listDocuments` shows the projects whose status is set and not
   * "Not Applicable", and `listAvailableEnquiryIds` offers the ones that are "Not Applicable", so a
   * project started without an answer appears on neither and its CRD is collected by no route at
   * all.
   */
  if (!data.crdDocumentStatus) missing("crdDocumentStatus", "Answer CRD Document.");
});

/** The refusal as one sentence, since the panel shows `message` rather than the field map. */
function validationMessage(error, fallback) {
  const issues = error?.issues || [];
  const messages = [...new Set(issues.map((issue) => issue.message).filter(Boolean))];
  return messages.length ? messages.join(" ") : fallback;
}

function cleanData(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value === "" ? null : value]));
}

function normalizeRuleName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** The longest a master-data code may be: every `code` column it is written to is VARCHAR(100). */
const CODE_MAX_LENGTH = 100;

/*
 * A master row's code, built from its name. A name may be up to 191 characters and the code column
 * holds 100, so a long name made a code the database refused ("value too long", P2000) and the add
 * failed with "Unable to add deliverable." - only for long names, which is why it looked
 * intermittent. A code that fits is exactly what it always was; one that does not is cut short and
 * ends in a fingerprint of the whole name, so the same name always gives the same code (the
 * duplicate check still finds it) and two long names that begin alike still differ.
 */
function codeFor(prefix, name) {
  const code = `${prefix}_${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
  if (code.length <= CODE_MAX_LENGTH) return code;
  const fingerprint = require("crypto").createHash("sha256").update(code).digest("hex").slice(0, 8).toUpperCase();
  return `${code.slice(0, CODE_MAX_LENGTH - fingerprint.length - 1).replace(/_+$/, "")}_${fingerprint}`;
}

const autoDeliverablesByServiceKey = new Map(Object.entries(autoDeliverablesByService).map(([serviceName, deliverables]) => [normalizeRuleName(serviceName), deliverables]));
const autoDeliverableNameKeys = new Set(Object.values(autoDeliverablesByService).flat().map(normalizeRuleName));

function autoDeliverableNamesForServices(serviceNames) {
  const seen = new Set();
  const names = [];
  for (const serviceName of serviceNames || []) {
    for (const deliverableName of autoDeliverablesByServiceKey.get(normalizeRuleName(serviceName)) || []) {
      const key = normalizeRuleName(deliverableName);
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(deliverableName);
    }
  }
  return names;
}

function blockedDeliverableNamesForServices(serviceNames) {
  const selected = new Set((serviceNames || []).map(normalizeRuleName));
  const blocked = new Set();
  if (selected.has("traditional video") && selected.has("candid video")) {
    blocked.add("Traditional Full Length");
    blocked.add("Traditional Highlights");
  }
  if (selected.has("traditional video") && selected.has("traditional photo")) {
    blocked.add("Traditional Highlights");
  }
  return blocked;
}

const serviceDefinitionInclude = {
  timingOptionSet: { include: { values: { where: { isActive: true }, orderBy: [{ label: "asc" }] } } },
  sizeOptionSet: { include: { values: { where: { isActive: true }, orderBy: [{ label: "asc" }] } } },
};

const serviceAllocationInclude = {
  serviceDefinition: { include: serviceDefinitionInclude },
  sessionOption: true,
  sizeOptionValue: true,
};

const deliverableDefinitionInclude = {
  sizeOptionSet: { include: { values: { where: { isActive: true }, orderBy: [{ label: "asc" }] } } },
  // In the order they were entered, both levels, so the dialog reopens on the form as it was left
  // and the Deliverables table lists a deliverable's brands the way the studio typed them.
  brands: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { variants: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  },
};

const deliverableAllocationInclude = {
  deliverableDefinition: { include: deliverableDefinitionInclude },
  sizeOptionValue: true,
};

/**
 * Every timing a service may be booked with.
 *
 * A service used to carry one. It now carries a list, because "Candid Photo" is genuinely booked
 * both hourly and by the session and a single mode forced the studio to pick one when setting it
 * up. `timingModes` is the list; `timingMode` is the first of it, kept so anything that only knows
 * about one still works, and read here as the fallback for every row written before the list
 * existed.
 *
 * Never empty: a service with nothing set is "NONE", which is what the branches below expect.
 */
function serviceTimingModes(definition) {
  const listed = Array.isArray(definition?.timingModes) ? definition.timingModes.filter(Boolean) : [];
  if (listed.length) return listed;
  return [definition?.timingMode || "NONE"];
}

/** The primary timing, for callers that can only act on one. */
function serviceTimingMode(definition) {
  return serviceTimingModes(definition)[0] || "NONE";
}

/** Whether a service may be booked with this timing at all. */
function serviceAllowsTiming(definition, mode) {
  return serviceTimingModes(definition).includes(mode);
}

async function validateOptionValue(transaction, optionSetId, optionValueId, message) {
  if (!optionSetId || !optionValueId) return null;
  const value = await transaction.projectOptionSetValue.findFirst({
    where: { id: optionValueId, optionSetId, isActive: true },
    select: { id: true },
  });
  if (value) return value.id;
  const error = new Error(message);
  error.status = 400;
  throw error;
}

/**
 * A session choice that is both in the set and one this service offers.
 *
 * `allowed` are the timing modes the definition carries, and they are the option values' own codes -
 * `HALF_SESSION`, `FULL_SESSION` - so the two line up without a lookup table between them.
 */
async function validateSessionOptionValue(transaction, optionSetId, optionValueId, allowed) {
  if (!optionSetId || !optionValueId) return null;
  const value = await transaction.projectOptionSetValue.findFirst({
    where: { id: optionValueId, optionSetId, isActive: true },
    select: { id: true, code: true },
  });
  if (value && allowed.includes(value.code)) return value.id;
  const error = new Error("Select a valid session timing.");
  error.status = 400;
  throw error;
}

async function validateOptionSet(transaction, optionSetId, message) {
  const set = await transaction.projectOptionSet.findFirst({
    where: { id: optionSetId, isActive: true },
    select: { id: true },
  });
  if (set) return set.id;
  const error = new Error(message);
  error.status = 400;
  throw error;
}

async function serviceAllocationDataForDefinition(transaction, definition, input = {}) {
  /*
   * There is deliberately no `remarksEnabled` here any more. A service's Remarks is a note the
   * studio writes about it, not a switch: it used to decide whether this line stored a remark at
   * all, which made a note beginning "Not applicable" silently turn the line's remarks box off
   * across every project using that service. A line always keeps its own remarks now, which is
   * what every service but one already did.
   */
  const data = {
    // The service's own default when the caller did not say, falling back to one.
    quantity: input.quantity ?? definition?.defaultQuantity ?? 1,
    sessionOptionId: null,
    durationHours: null,
    durationMinutes: null,
    workDays: null,
    timingMinutes: null,
    sizeOptionValueId: null,
    // The line's own remark, always kept - see above.
    remarks: input.remarks || null,
  };

  /*
   * Each timing fills its own fields, and they no longer exclude one another.
   *
   * These were a single `if/else` on the service's one mode. A service may now name several, so the
   * branches are independent and each runs when the service allows that timing - the allocation
   * itself is what says which was used, by which fields it carries. A timing the service does not
   * allow is ignored rather than rejected, because the definition is the authority on what may be
   * booked and a stale form should not be able to write past it.
   */
  const sessions = SESSION_TIMING_MODES.filter((mode) => serviceAllowsTiming(definition, mode));
  if (sessions.length) {
    /*
     * Valid for the set, and one of the sessions this service offers.
     *
     * The set holds both Half Session and Full Session, so validating against it alone would let a
     * full-session choice through on a service offered only as a half - which the settings screen
     * plainly refuses to show. The definition is the authority, so it is checked here too rather
     * than trusted from the form.
     */
    data.sessionOptionId = await validateSessionOptionValue(transaction, definition.timingOptionSetId, input.sessionOptionId || null, sessions);
  }
  if (serviceAllowsTiming(definition, "HOURS_MINUTES")) {
    /*
     * What the form sent, or the service's own default when it sent nothing.
     *
     * The default is the whole point of storing one - a service booked at two hours should arrive
     * on the shoot saying two hours rather than empty. `??` rather than `||` so a deliberate zero
     * is kept: 0h 45m is a real duration.
     */
    const hours = input.durationHours ?? definition?.defaultDurationHours ?? null;
    const minutes = input.durationMinutes ?? definition?.defaultDurationMinutes ?? null;
    const hasAny = hours != null || minutes != null;
    data.durationHours = hasAny ? hours || 0 : null;
    data.durationMinutes = hasAny ? minutes || 0 : null;
  }
  // No Days or Minutes branch: neither is a timing a service can be given any more. The columns
  // stay, so the allocations that used them still read correctly.

  // Any size the service's pricing names, from whichever list, or one from the list it is pointed at.
  data.sizeOptionValueId = await validateDeliverableSize(transaction, definition, input.sizeOptionValueId || null);
  return data;
}

/**
 * A deliverable's brands as they are stored: only what is worth storing, and only what its type
 * asks for.
 *
 * A brand still being filled in is not a brand and a variant with nothing in it is not a variant -
 * both are dropped rather than written, and neither is an error, because a form with an empty row
 * at the bottom is the normal way one looks. The boxes the type does not ask for are written null
 * here rather than trusted from the form: a video carrying a frame size would be a value no screen
 * shows and every reader of the row would have to know to ignore.
 *
 * An unanswered type asks for nothing in particular, so it keeps whatever it is given - nothing has
 * decided yet which of the two a variant is.
 */
function deliverableBrandsForSave(brands, mediaType) {
  const asks = (field) => {
    if (mediaType === "VIDEO") return field === "videoLength";
    if (mediaType === "IMAGE") return field === "size" || field === "frameInches";
    return true;
  };
  const text = (value, field) => (asks(field) ? String(value ?? "").trim() || null : null);
  return (brands || [])
    .map((brand) => ({
      // The id of a row being kept rides along, untouched, for `saveDeliverableBrands` to match.
      ...(brand?.id ? { id: String(brand.id) } : {}),
      name: String(brand?.name ?? "").trim(),
      variants: (brand?.variants || [])
        .map((variant) => ({
          ...(variant?.id ? { id: String(variant.id) } : {}),
          size: text(variant?.size, "size"),
          frameInches: text(variant?.frameInches, "frameInches"),
          videoLength: text(variant?.videoLength, "videoLength"),
          price: variant?.price ?? null,
        }))
        .filter((variant) => variant.size || variant.frameInches || variant.videoLength || variant.price !== null),
    }))
    .filter((brand) => brand.name || brand.variants.length);
}

/**
 * Writes a deliverable's brands and variants as the form left them, keeping every row it kept.
 *
 * A service maps each of its bookings to the variants it brings by id - deliverable, brand,
 * variant - and so do quotation lines. This used to delete every brand and write the list again,
 * which gave every brand and variant a new id on every save: renaming a deliverable, or repricing
 * one of its sizes, left every service mapped to it reading "This deliverable is no longer
 * offered", and a quotation could no longer find the variant it was priced on.
 *
 * So a row the form opened on comes back with its id, and is updated in place - its id, and every
 * mapping to it, survive. A row with no id, or with an id that is not this deliverable's own (a
 * duplicate's copy, a stale page), is created new. A row the form no longer holds is deleted, which
 * is the only way a variant stops being offered - and then the services mapped to it do say so.
 */
async function saveDeliverableBrands(transaction, definitionId, input) {
  // An id named twice keeps one row: the first to name it. Any later one is a new row.
  const claim = (seen, id) => (id && !seen.has(id) ? (seen.add(id), id) : undefined);
  const seenBrands = new Set();
  const seenVariants = new Set();
  const brands = input.map((brand) => ({
    ...brand,
    id: claim(seenBrands, brand.id),
    variants: brand.variants.map((variant) => ({ ...variant, id: claim(seenVariants, variant.id) })),
  }));
  const held = await transaction.projectDeliverableBrand.findMany({ where: { definitionId }, select: { id: true, variants: { select: { id: true } } } });
  const heldBrands = new Map(held.map((brand) => [brand.id, new Set(brand.variants.map((variant) => variant.id))]));
  const keptBrandIds = new Set(brands.map((brand) => brand.id).filter((id) => heldBrands.has(id)));
  // The variants go with their brands - `ON DELETE CASCADE` - so a removed brand takes its own.
  const removed = held.map((brand) => brand.id).filter((id) => !keptBrandIds.has(id));
  if (removed.length) await transaction.projectDeliverableBrand.deleteMany({ where: { id: { in: removed }, definitionId } });
  const valuesOf = ({ id, ...variant }, sortOrder) => ({ ...variant, sortOrder });
  for (const [index, brand] of brands.entries()) {
    if (!keptBrandIds.has(brand.id)) {
      await transaction.projectDeliverableBrand.create({
        data: { definitionId, name: brand.name, sortOrder: index, variants: { create: brand.variants.map((variant, inner) => valuesOf(variant, inner)) } },
      });
      continue;
    }
    const heldVariants = heldBrands.get(brand.id);
    const keptVariantIds = new Set(brand.variants.map((variant) => variant.id).filter((id) => heldVariants.has(id)));
    const gone = [...heldVariants].filter((id) => !keptVariantIds.has(id));
    if (gone.length) await transaction.projectDeliverableVariant.deleteMany({ where: { id: { in: gone }, brandId: brand.id } });
    await transaction.projectDeliverableBrand.update({ where: { id: brand.id }, data: { name: brand.name, sortOrder: index } });
    for (const [inner, variant] of brand.variants.entries()) {
      if (keptVariantIds.has(variant.id)) await transaction.projectDeliverableVariant.update({ where: { id: variant.id }, data: valuesOf(variant, inner) });
      else await transaction.projectDeliverableVariant.create({ data: { brandId: brand.id, ...valuesOf(variant, inner) } });
    }
  }
}

/**
 * The variant columns a new deliverable line is saved with: whose it is and what distinguishes it,
 * as it reads now - or all null for a line added as the deliverable alone.
 *
 * The variant the client names is found among the deliverable's own brands, and where it is found
 * its values are the ones saved, whatever words came with it. Where it is not found - a quotation's
 * variant since removed, or replaced by a save from before `saveDeliverableBrands` kept ids - the
 * words the quotation kept are saved instead,
 * bounded by the schema and held to what the deliverable's type asks for exactly as
 * `deliverableBrandsForSave` holds a variant. Those words are trusted as far as the quotation line
 * they came from is - it stamped them itself - and no further: they are a record of what was sold,
 * and nothing prices, filters or links by them. Written once, on create: an edit to the line's
 * quantity or remarks never touches what it was sold as.
 */
function deliverableVariantSnapshotFor(definition, variant) {
  const empty = { brandName: null, size: null, frameInches: null, videoLength: null };
  if (!variant) return empty;
  let source = null;
  if (variant.variantId) {
    for (const brand of definition?.brands || []) {
      const match = (brand.variants || []).find((item) => item.id === variant.variantId);
      if (match) { source = { brandName: brand.name, size: match.size, frameInches: match.frameInches, videoLength: match.videoLength }; break; }
    }
  }
  const [kept] = deliverableBrandsForSave([{ name: (source || variant).brandName, variants: [{ ...(source || variant), price: null }] }], definition?.mediaType ?? null);
  if (!kept) return empty;
  const values = kept.variants[0] || {};
  return { brandName: kept.name || null, size: values.size ?? null, frameInches: values.frameInches ?? null, videoLength: values.videoLength ?? null };
}

/*
 * What makes two lines on one shoot the same line: the deliverable and the variant it was added
 * as, ignoring case and spacing. Two brands of one album are two lines; the same variant twice is
 * one. The frontend holds the same rule in `deliverableIdentityKey`
 * (`frontend/src/lib/deliverableBrands.mjs`), so what the picker stops offering is what is refused here.
 */
function deliverableLineKey(deliverableDefinitionId, snapshot = {}) {
  const norm = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const parts = [snapshot.brandName, snapshot.size, snapshot.frameInches, snapshot.videoLength].map(norm);
  return [String(deliverableDefinitionId || ""), ...(parts.some(Boolean) ? parts : [])].join("::");
}

async function deliverableAllocationDataForDefinition(transaction, definition, input = {}) {
  /*
   * Whether the line is asked for a photo count. `!== false` as it always was, spelled for words:
   * only an answer of No stops it, and a deliverable never asked still stores one.
   *
   * There is deliberately no `remarksEnabled` beside it any more. A deliverable's Remarks is a note
   * the studio writes about it, not a switch: it used to decide whether this line stored a remark
   * at all, which made a note beginning "Not applicable" or "No frames" silently turn the line's
   * remarks box off across every project using that deliverable. A line always keeps its own
   * remarks now, which is what every deliverable already did - all of them answered Yes.
   */
  const photoCountEnabled = deliverableAnswerNotOff(definition?.photoCountEnabled);
  const sizeOptionValueId = await validateDeliverableSize(transaction, definition, input.sizeOptionValueId || null);
  return {
    quantity: input.quantity || 1,
    numberOfPhotos: photoCountEnabled ? input.numberOfPhotos ?? null : null,
    // Update callers spread the existing allocation into input, so omission retains its limit;
    // create callers receive null unless a limit was explicitly provided.
    selectionLimit: input.selectionLimit ?? null,
    sizeOptionValueId,
    // The line's own remark, always kept - see above.
    remarks: input.remarks || null,
  };
}

async function syncAutoDeliverablesForShoot(transaction, projectId, shootId) {
  const serviceRows = await transaction.projectPostProductionAllocation.findMany({
    where: { projectId, shootId, deletedAt: null },
    select: { serviceName: true },
  });
  const serviceNames = serviceRows.map((row) => row.serviceName).filter(Boolean);
  const expectedNames = autoDeliverableNamesForServices(serviceNames);
  const expectedKeys = new Set(expectedNames.map(normalizeRuleName));
  const blockedKeys = new Set([...blockedDeliverableNamesForServices(serviceNames)].map(normalizeRuleName));
  const currentRows = await transaction.projectShootDeliverable.findMany({
    where: { projectId, shootId, deletedAt: null },
    select: { id: true, deliverableName: true, deliverableDefinitionId: true },
  });

  for (const row of currentRows) {
    const key = normalizeRuleName(row.deliverableName);
    if (autoDeliverableNameKeys.has(key) && (!expectedKeys.has(key) || blockedKeys.has(key))) {
      await transaction.projectShootDeliverable.update({
        where: { id: row.id },
        data: { deletedAt: new Date() },
      });
    }
  }

  const activeRows = currentRows.filter((row) => {
    const key = normalizeRuleName(row.deliverableName);
    return !(autoDeliverableNameKeys.has(key) && (!expectedKeys.has(key) || blockedKeys.has(key)));
  });
  const activeDefinitionIds = new Set(activeRows.map((row) => row.deliverableDefinitionId).filter(Boolean));
  const activeNameKeys = new Set(activeRows.map((row) => normalizeRuleName(row.deliverableName)).filter(Boolean));

  for (const deliverableName of expectedNames.filter((name) => !blockedKeys.has(normalizeRuleName(name)))) {
    const definition = await transaction.projectDeliverableDefinition.findFirst({
      where: { isActive: true, name: { equals: deliverableName } },
      include: deliverableDefinitionInclude,
    });
    if (!definition) continue;
    const key = normalizeRuleName(definition.name);
    if (activeDefinitionIds.has(definition.id) || activeNameKeys.has(key)) continue;
    const allocationData = await deliverableAllocationDataForDefinition(transaction, definition, {});
    await transaction.projectShootDeliverable.create({
      data: {
        projectId,
        shootId,
        deliverableDefinitionId: definition.id,
        deliverableName: definition.name,
        ...allocationData,
      },
    });
    activeDefinitionIds.add(definition.id);
    activeNameKeys.add(key);
  }
}

// Who may do what here is decided by the route, which mounts the permission the screen answers to -
// Sales Manager for the sale, Quotation Management for quotations, PROJECT / Projects for the plan,
// and a shared read across all of them for the register. This file used to refuse everybody whose
// legacy `role` column was not SUPER_ADMIN, in all 37 handlers, below those guards: the permissions
// were checked, passed, and then overruled. Granting somebody Sales Manager changed nothing, and
// the refusal named Sales Manager whichever screen you were on - which is how it surfaced on CRD
// Documents, whose project list is served from here.

const normalizeClientMainNumber = (value) => normalizePhoneNumber(value);

/**
 * The branches a project can be sold out of: the application's one branch list.
 *
 * Kept as a name here because this file reads it in four places, but it is `branchOptions` and
 * nothing else - the CRM's Assigned Branch, the quotation's Source Branch and this all answer from
 * the same rows now.
 */
const sourceBranchOptions = branchOptions;

/*
 * The permissions this screen's branch picker belongs to.
 *
 * Branch reach is per-permission, so a picker has to say which permission it is filling - and the
 * honest answer is **the same list the routes are guarded by**, `REGISTER_READERS`. Both
 * `GET /source-branches` and the writes that validate against it admit any of the register's
 * readers, so scoping to `SALES / Sales Manager` alone handed an empty list, and a 403 on every
 * edit, to everybody who reaches the register through Projects or Show All Projects instead.
 */
const SOURCE_BRANCH_READERS = { permissions: REGISTER_READERS };

/*
 * And the **writes** are a different question, which is why they do not share the constant above.
 *
 * `GET /source-branches` admits any of the register's readers, so its picker is drawn from all of
 * them. Creating, importing or editing a project admits far fewer - `SALES / Sales Manager`,
 * `PROJECT / Projects`, or the widening one - and at Read / Write. Validating a write against the
 * readers' list would let somebody file a project into a branch that only a **read-only** role of
 * theirs reaches: they pass the write guard on one role and take the branch from another.
 */
const SOURCE_BRANCH_WRITERS = {
  permissions: [
    { module: "SALES", feature: "Sales Manager" },
    { module: "PROJECT", feature: "Projects" },
    { module: "PROJECT", feature: "Show All Projects" },
  ],
  level: "READ_WRITE",
};

/**
 * The source branch is a real, active branch — and one the person saving may actually use.
 *
 * Two questions, and they fail differently on purpose: a branch that does not exist is a stale form,
 * while a branch that exists but is out of reach is somebody sending a value the picker never
 * offered them. Narrowing the dropdown alone would leave that request perfectly acceptable.
 */
async function validateSourceBranch(transaction, value, userId) {
  const existing = await sourceBranchOptions(transaction);
  if (!existing.includes(value)) {
    const error = new Error("Select a valid active Source Branch.");
    error.status = 400;
    throw error;
  }
  // The **writers'** list: this runs on create, import and edit, none of which is guarded by the
  // register's readers. See `SOURCE_BRANCH_WRITERS`.
  const allowed = await sourceBranchOptions(transaction, userId, SOURCE_BRANCH_WRITERS);
  if (allowed.includes(value)) return;
  const error = new Error("You cannot file a project against that branch.");
  error.status = 403;
  throw error;
}

async function resolveAuthenticatedCreator(transaction, req) {
  const user = await transaction.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, name: true, linkedEmployeeId: true },
  });
  if (!user) {
    const error = new Error("Authenticated user was not found.");
    error.status = 401;
    throw error;
  }
  if (!user.linkedEmployeeId) return { crmName: user.name, crmEmployeeId: null };
  const employee = await transaction.employee.findUnique({
    where: { id: user.linkedEmployeeId },
    select: { id: true, employeeName: true },
  });
  return { crmName: employee?.employeeName || user.name, crmEmployeeId: employee?.id || null };
}

function projectShootData(data) {
  const shootTypes = shootTypesOf(data);
  const sessionTimings = shootTimingsOf(data);

  /*
   * How long the shoot runs, from whichever timing decides it.
   *
   * Hourly is the only one a person types, so when it is among the timings the typed figure is what
   * is kept - taking the first of the list instead would throw away what they had just entered. With
   * no Hourly, the longest session booked is the day's length: a full session covers a half.
   */
  const hourly = sessionTimings.includes("Hourly");
  const sessionDurationHours = hourly
    ? data.sessionDurationHours || 0
    : sessionTimings.includes("Full Session") ? 12 : sessionTimings.includes("Half Session") ? 5 : 0;
  const sessionDurationMinutes = hourly ? data.sessionDurationMinutes || 0 : 0;

  return {
    dateCreated: data.dateCreated,
    shoot: data.shoot,
    // The place, district and state - or, for a shoot at several places, each name's own and the
    // three columns joined from them, so a shoot saved as one place loses any it held before.
    ...shootLocationColumns(data),
    shootTypes,
    sessionTimings,
    // Kept in step with the lists, as the first of each, for everything that reads a shoot's type or
    // timing one-at-a-time.
    shootType: shootTypes[0] || "Studio / In-House",
    isMainEvent: Boolean(data.isMainEvent),
    sessionTiming: sessionTimings[0] || null,
    sessionDurationHours,
    sessionDurationMinutes,
    foodTakenCareBy: data.foodTakenCareBy || "Studio",
    accommodation: data.accommodation || "Studio",
    travel: data.travel || "Studio",
    preference: data.preference,
    // Event Start/End Time are deliberately absent: they belong to the Pre Production board, and
    // writing null here erased what its coordinator had entered.
  };
}

/*
 * After any shoot is added, moved, made the main event or removed: the project's main-event date, and
 * every scheduled payment whose due date follows a shoot (`shootLinkedDueDates`).
 */
async function syncProjectMainEvent(transaction, projectId, shoot) {
  await syncMainEventDate(transaction, projectId, shoot);
  await syncShootLinkedDueDates(transaction, projectId);
}

async function syncMainEventDate(transaction, projectId, shoot) {
  if (shoot?.isMainEvent) {
    await transaction.projectShoot.updateMany({
      where: { projectId, deletedAt: null, id: { not: shoot.id } },
      data: { isMainEvent: false },
    });
    await transaction.salesProject.update({
      where: { id: projectId },
      // Known only if the shoot actually carries one: a main event booked before its date is
      // fixed would otherwise set the project's date to null while insisting it was known.
      data: { mainEventDateKnown: Boolean(shoot.dateCreated), mainEventDate: shoot.dateCreated || null },
    });
    return;
  }

  const mainShoot = await transaction.projectShoot.findFirst({
    where: { projectId, deletedAt: null, isMainEvent: true },
    select: { dateCreated: true },
    orderBy: [{ dateCreated: "asc" }, { createdAt: "asc" }],
  });
  await transaction.salesProject.update({
    where: { id: projectId },
    data: {
      mainEventDateKnown: Boolean(mainShoot?.dateCreated),
      mainEventDate: mainShoot?.dateCreated || null,
    },
  });
}

function groupNameSnapshot(groupName, usedAt = groupName?.usedAt) {
  if (!groupName) return null;
  return {
    vertical: groupName.vertical || null,
    branch: groupName.branch || null,
    offerName: groupName.offerName || null,
    clientName: groupName.clientName || null,
    place: groupName.place || null,
    mainEventDate: groupName.mainEventDate || null,
    gou: typeof groupName.gou === "boolean" ? groupName.gou : null,
    houseType: groupName.houseType || null,
    socialMediaPosting: groupName.socialMediaPosting || null,
    generatedWhatsAppGroupName: groupName.generatedName,
    generatorCreatedAt: groupName.createdAt || null,
    generatorExpiresAt: groupName.expiresAt || null,
    generatorUsedAt: usedAt || null,
    generatorUsedStatus: usedAt ? "Used" : groupName.status || "Available",
  };
}

/**
 * Which vertical a booking belongs to.
 *
 * The project's own field where it has one - and the enquiry it was booked against where it has
 * not, which is the case this exists for.
 *
 * `vertical` is optional on a project and the Create Project form does not always carry it, so it
 * arrives null often enough to matter. `verticalCode` then falls back to `DD` - the default for a
 * record that names no vertical - and a Qua Qua booking came out `DBS-BK-DD-CBE-000005` sitting
 * beside its own lead's `DBS-EID-QQ-CBE-000001`. The identifier said Dum Dum about a job the
 * enquiry beside it said was Qua Qua, which is exactly the disagreement these codes exist to
 * prevent.
 *
 * The enquiry id is the right answer rather than a guess: it was minted for that lead, under that
 * lead's vertical, and it carries the code in the middle of it. A booking is what a converted lead
 * becomes, so the two cannot honestly differ.
 *
 * Falls through to nothing when there is neither, which leaves `verticalCode` to its own default -
 * a booking with no lead and no vertical has nothing better to be than the studio's fallback, and
 * an identifier that cannot be minted is a project that cannot be saved.
 */
function verticalForProject(project) {
  const named = String(project?.vertical || "").trim();
  if (named) return named;
  return parseIdentifier("CRM_LEAD", project?.enquiryId)?.vertical || "";
}

/*
 * The same answer, in the words this table stores verticals in.
 *
 * Two vocabularies meet here and they disagree on one of the three. An identifier writes Dum Dum as
 * `DD`; this table writes it as `WED`, because that is what the studio calls the wedding vertical on
 * a project. `QQ` and `CORP` are the same in both. Mapped rather than assumed - storing `DD` in a
 * column whose enum is `WED`/`QQ`/`CORP` would be a value no filter, report or group-name check
 * could match, which is a quieter fault than the one this is fixing.
 */
const PROJECT_VERTICAL_BY_CODE = { DD: "WED", QQ: "QQ", CORP: "CORP" };

/**
 * A project's own data, with the vertical filled in from its enquiry where the form left it blank.
 *
 * This is the fault at its source. `vertical` is optional and Create Project does not always carry
 * it, so the column sat empty - which is why the booking's identifier fell back to Dum Dum, and why
 * the Vertical column on Bookings & Converted read "—" on the very rows that went wrong.
 *
 * Only ever fills a blank. A vertical somebody actually chose is theirs, even where it differs from
 * the lead's - a booking can be sold across verticals, and second-guessing that from an id would be
 * the same class of mistake in the other direction.
 */
function withInferredVertical(projectData) {
  if (String(projectData?.vertical || "").trim()) return projectData;
  const code = parseIdentifier("CRM_LEAD", projectData?.enquiryId)?.vertical || "";
  const vertical = PROJECT_VERTICAL_BY_CODE[code];
  return vertical ? { ...projectData, vertical } : projectData;
}

/*
 * The vertical a project belongs to, when the project itself was never told.
 *
 * `vertical` only reaches the payload when the WhatsApp group name came from the generator, which
 * is where WED / QQ / CORP is chosen. A name typed by hand skips the generator, and the project is
 * left with a blank vertical - while the CRM lead behind the enquiry has known which business it is
 * all along, under its own spelling. So the lead is the fallback.
 */
async function verticalFromLead(client, enquiryId) {
  const id = String(enquiryId || "").trim();
  if (!id) return null;
  const lead = await client.salesCrmLead.findFirst({ where: { enquiryId: id, deletedAt: null }, select: { verticalName: true } });
  return verticalCode(lead?.verticalName);
}

/*
 * DBS-BK-DD-ERD-000001 - a booking, counted per vertical and per branch.
 *
 * A project *is* the booking: it is what a converted lead becomes, and the studio reads its
 * identifier off a WhatsApp group name and a quotation for months afterwards. So it names the
 * vertical it was sold in and the branch that sold it, and each pair of those counts from one.
 *
 * The counter and the shape both live in `services/identifiers.js`, and the counter moves inside
 * this transaction - so a project whose creation fails does not spend a number, and the studio
 * never reads a gap in its own books.
 */
const nextEventId = (transaction, project) => nextIdentifier(
  "SALES_PROJECT",
  { vertical: verticalForProject(project), branch: project?.sourceBranch },
  transaction,
);

/*
 * DBS-SID-DD-ERD-000001 - a shoot, counted per vertical like the project it belongs to.
 *
 * A shoot takes its vertical and its branch from its project, because that is where they are
 * recorded and a shoot cannot be sold to a different one. The studio reads this code out on the
 * floor - it is what a call sheet and a day's rota are headed with - so it says which vertical's
 * work the day is, the same way the booking above it does.
 */
const nextShootId = (transaction, project) => nextIdentifier(
  "PROJECT_SHOOT",
  // Read the same way the booking's own is, so a shoot cannot end up on a different vertical from
  // the project it belongs to - which is the fault above, one level down.
  { vertical: verticalForProject(project), branch: project?.sourceBranch },
  transaction,
);

/*
 * What the register shows of a project: its shoots with their deliverables and services. One shape
 * for the whole register and for a single project read again after an edit, so a row patched in
 * place is exactly the row the register would have drawn.
 *
 * No attachments: no screen reads them from the register (a project's files have their own route),
 * and they were sent with every project on every load.
 */
const PROJECT_REGISTER_INCLUDE = {
  shoots: {
    where: { deletedAt: null },
    include: {
      deliverables: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
      postProductionAllocations: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ dateCreated: SHOOT_DATE_ASC }, { createdAt: "asc" }],
  },
};
/*
 * `?view=summary`: each shoot's own fields without its deliverables and services - about two thirds
 * of the register's weight. For the screens that list projects but show no service or deliverable
 * (Sales Manager, Meetings, Album Proofing); Projects and Post Production show both in columns, so
 * they read the full shape.
 */
const PROJECT_SUMMARY_INCLUDE = {
  shoots: { where: { deletedAt: null }, orderBy: PROJECT_REGISTER_INCLUDE.shoots.orderBy },
};

/** The register's rows as read, with their holds, payments due, boards, names and handovers. */
async function registerRows(data) {
  // Where each project is being held, by department, for its "On Hold (…)" badge.
  const ids = data.map((project) => project.id);
  // `boards` is which of the four boards each project is on, for the row menu's "Jump to"
  // entries: the jump is offered only where the project is really there.
  const [holds, paymentsDue, boards] = await Promise.all([projectHoldSources(ids), projectPaymentsDue(ids), boardsForProjects(ids)]);
  // Who recorded each project, and who last set its statuses, by name (`services/userNames`).
  // A role handed over at offboarding reads "New (Old)" while the new holder still has it.
  return withProjectHandovers(await withUserNames((await fillVerticalsFromLeads(data)).map((project) => ({ ...project, holds: holds[project.id] || [], paymentsDue: paymentsDue[project.id] || null, boards: boards.get(project.id) || [] }))));
}

async function listProjects(req, res) {
  try {
    /*
     * What this reader may see, resolved per request.
     *
     * The permission guard on the route answers "may you open the project screens"; this answers
     * "which projects", which is a different question and the one the guard cannot reach. Somebody
     * without All Projects is served the projects they are named on, inside the branches their
     * roles reach. See `src/services/projectScope.js`.
     */
    const access = await projectAccessWhere({ userId: Number(req.user.id) });
    const data = await prisma.salesProject.findMany({
      where: { deletedAt: null, ...access },
      include: req.query?.view === "summary" ? PROJECT_SUMMARY_INCLUDE : PROJECT_REGISTER_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return res.json({ data: await registerRows(data) });
  } catch (error) {
    console.error("Unable to load sales projects:", error);
    return res.status(500).json({ message: "Unable to load sales projects." });
  }
}

/**
 * One project as the register shows it, by its id or its Event ID ("DBS-BK-DD-ERD-000001").
 *
 * What a screen reads after editing one project, or to open one, instead of the whole register -
 * which carries every project with all its shoots and grows with the studio. The same reach as
 * the register (`projectAccessWhere`): a project this reader could not see there is a 404 here,
 * not a different answer.
 */
async function getProject(req, res) {
  try {
    const ref = String(req.params.id || "").trim();
    // An id or an Event ID is a few dozen characters; anything longer names no project.
    if (!ref || ref.length > 64) return res.status(400).json({ message: "Choose a project." });
    const access = await projectAccessWhere({ userId: Number(req.user.id) });
    // Side by side under AND, so the reach - which may carry an OR of its own - is never overwritten.
    const project = await prisma.salesProject.findFirst({
      where: { deletedAt: null, AND: [{ OR: [{ id: ref }, { eventId: ref }] }, access] },
      include: PROJECT_REGISTER_INCLUDE,
    });
    if (!project) return res.status(404).json({ message: "That project could not be found." });
    const [row] = await registerRows([project]);
    return res.json({ data: row });
  } catch (error) {
    console.error("Unable to load the sales project:", error);
    return res.status(500).json({ message: "Unable to load the project." });
  }
}

/**
 * The quotation version a project is converting at, checked before it is stored.
 *
 * The picker sends `SalesQuotation.quotationId` - "QUT039-02" - so the value is verified to name a
 * live quotation rather than trusted because it arrived in the body. An id naming nothing is
 * refused rather than stored: the register would show no marker for it, which reads as "nobody has
 * finalized a version" and is a different statement from "this project points at a version that
 * does not exist".
 *
 * Blank is a valid answer and stores null - a project may convert without a quotation, on a figure
 * typed straight into Initial Converted Value.
 *
 * A project is booked only at a version that is **finalized now** (`isFinalizedQuotation`: finalized
 * and not since unfinalized) and that was raised for the enquiry the project is booked against. The
 * picker offers nothing else, and this is what holds when a request is sent by hand. The row is
 * read `FOR UPDATE`, so an Unfinalize pressed at the same moment waits for the booking to commit
 * rather than slipping in between this check and the insert.
 */
async function resolveFinalizedQuotation(transaction, quotationId, enquiryId) {
  const id = String(quotationId || "").trim();
  if (!id) return null;
  const refuse = (status, message) => {
    const error = new Error(message);
    error.status = status;
    throw error;
  };
  const [quotation] = await transaction.$queryRaw`SELECT quotation_id AS quotationId, enquiry_id AS enquiryId, status, finalized_at AS finalizedAt, unfinalized_at AS unfinalizedAt FROM sales_quotation WHERE quotation_id = ${id} AND deleted_at IS NULL LIMIT 1 FOR UPDATE`;
  if (!quotation) refuse(400, "The selected quotation could not be found.");
  const sameEnquiry = String(quotation.enquiryId || "").trim().toLowerCase() === String(enquiryId || "").trim().toLowerCase();
  if (!sameEnquiry) refuse(400, `${quotation.quotationId} was raised for a different enquiry. Choose a finalized quotation of this enquiry.`);
  // A draft has been sent to nobody, so no project can say it converted at one.
  if (quotation.status === QUOTATION_STATUS.DRAFT) refuse(409, `${quotation.quotationId} is a draft. Finalize the quotation before creating a project.`);
  if (!isFinalizedQuotation(quotation)) {
    refuse(409, quotation.finalizedAt
      ? `${quotation.quotationId} has been unfinalized. Finalize it again, or choose another finalized quotation, before creating a project.`
      : `${quotation.quotationId} is not finalized. Finalize the quotation before creating a project.`);
  }
  return quotation.quotationId;
}

async function validateProjectPayload(transaction, data, { existingWhatsappGroupNameId = null, userId = null } = {}) {
  await validateSourceBranch(transaction, data.sourceBranch, userId);

  let groupName = null;
  if (data.whatsappGroupNameId) {
    groupName = await transaction.salesWhatsappGroupName.findUnique({ where: { id: data.whatsappGroupNameId } });
    if (!groupName) {
      const error = new Error("Selected WhatsApp group name was not found.");
      error.status = 404;
      throw error;
    }
    const isCurrentProjectGroupName = groupName.id === existingWhatsappGroupNameId;
    if (!isCurrentProjectGroupName && (groupName.status !== "Available" || groupName.usedAt || (groupName.expiresAt && groupName.expiresAt <= new Date()))) {
      const error = new Error("Selected WhatsApp group name is no longer available.");
      error.status = 409;
      throw error;
    }
    if (groupName.generatedName !== data.whatsappGroupName || groupName.vertical !== data.vertical || groupName.groupType !== data.groupType) {
      const error = new Error("Selected WhatsApp group name does not match the submitted project details.");
      error.status = 400;
      throw error;
    }
  }

  return { groupName };
}

/**
 * The vertical a CRM lead belongs to.
 *
 * `SalesCrmLead.branch` holds it — "Dum Dum" / "Qua Qua" / "Corp" — which is a different column
 * from `assignedBranch`, the physical branch the lead is worked from. Spellings vary across leads
 * imported at different times, so it is normalised the way the CRM screens normalise it.
 */
function verticalForLeadBranch(branch) {
  const value = String(branch || "").trim().toLowerCase();
  if (value === "dum dum" || value === "dumdum") return { groupType: "Dum Dum", vertical: "WED" };
  if (value === "qua qua" || value === "quaqua") return { groupType: "Qua Qua", vertical: "QQ" };
  if (value === "corp" || value === "corporate" || value === "corporation") return { groupType: "Corp", vertical: "CORP" };
  return { groupType: null, vertical: null };
}

/**
 * The enquiries a project or a group name can be filed under, searched as they are typed: CRM leads.
 *
 * This used to search `salesProject`, which is circular — an enquiry exists the moment a lead does,
 * which is before any project has been created from it, so listing project rows meant the dropdown
 * offered event/project ids and a brand-new lead's enquiry could not be found at all. Leads are the
 * source of an enquiry, so they are what it lists.
 *
 * A lead that already has a project **is** offered, carrying a count of the ones it has. The studio
 * books the same client again and the enquiry id is how the two are tied together, so hiding those
 * ids left no way to do it at all - the id cannot be typed past a filter that excludes it. The count
 * is what makes a second booking deliberate rather than accidental.
 *
 * The lead also carries what the Create Project form can prefill: the client's name, the number
 * they are messaged on, the branch they enquired at, and its vertical — the answer the studio
 * already gave when the lead was taken, which the form turns into the project's vertical.
 *
 * ── This list is Leads & Followups, and nothing else ──────────────────────────────────────────
 *
 * Whatever is on that board is offerable here, and whatever is not on it is not - because an
 * enquiry id that cannot be opened in the CRM is one a project must not be booked against. Three
 * things were needed to make that true, and each was its own bug:
 *
 *   1. Deleted leads were offered. `deletedAt` was not in the query at all, so a studio that had
 *      cleared its leads out saw an empty board and a full picker.
 *   2. Leads the reader may not see were offered. The board narrows by `leadScope` - a lead is
 *      yours if you are its CRM, if somebody reporting to you is, if you entered it, or if you
 *      administer the branch it was enquired into - and this query narrowed by nothing, so the
 *      picker could show enquiries their own board hides.
 *   3. Most of the board was missing from it. See the ordering note below.
 *   4. Callyzer's calls were offered as enquiries. See below.
 *
 * ── A call is not an enquiry ──────────────────────────────────────────────────────────────────
 *
 * The Callyzer webhook used to mint a `sales_crm_lead` for every call it was delivered, out of the
 * same run the studio counts its real enquiries in. It does not any more - a call is stored under a
 * Call ID and waits on the Calls board until somebody reads the caller and adds them - but the rows
 * the old behaviour wrote are still there, and they are exactly what this picker was filling up
 * with: `DBS-EID-DD-ERD-000260`, "Unknown", a bare mobile number, one per wrong number and misdial.
 * Every one of them pushed a real enquiry off the fifty the picker shows.
 *
 * They are on the Calls board, not on Leads & Followups, so by this file's one rule they are not
 * offerable - and a project must not be bookable against a caller nobody has even triaged, let alone
 * quoted. Excluded by `board_key`, the stored column the CRM's own boards are read by, so the two
 * agree by construction: a call that somebody *does* add to a vertical gets a real enquiry id and a
 * board of its own, and appears here from that moment.
 */
const ENQUIRY_PAGE = 50;

async function listEnquiries(req, res) {
  const search = String(req.query.search || "").trim();
  try {
    /*
     * The same rule the board answers to, resolved against whichever of the two permissions this
     * caller holds.
     *
     * `SALES / CRM Leads` first, because that is the board's own and this list has to agree with it.
     * `SALES / Sales Manager` is named beside it because that is what guards this route: resolving
     * on CRM Leads alone would answer "closed" - no rows at all - for a sales manager who does not
     * hold the CRM, and lock them out of creating a project. Both narrow on the same columns, so
     * either answer is a lead scope; what changes is only which permission's grant it is read from.
     */
    const scope = await leadScopeFor({
      userId: Number(req.user.id),
      permissions: [CRM_LEADS, { module: "SALES", feature: "Sales Manager" }],
    });

    const where = {
      deletedAt: null,
      // An untriaged Callyzer call, which is on the Calls board and is not an enquiry. Indexed, and
      // NULL only for a deleted lead - which `deletedAt` above has already excluded.
      boardKey: { not: BOARD_KEY.Calls },
      /*
       * **An enquiry that already has a project is still offered.** The studio books the same client
       * again - a second wedding, a second event on the same enquiry - and a picker that hid those
       * ids left no way to do it: the id is not typeable past a filter that excludes it.
       *
       * It used to be excluded here, on a one-project-per-enquiry rule. Nothing in the database said
       * so - `SalesCrmLead.projects` is one-to-many with a plain index - so the rule lived only in
       * this clause, which is to say it was never enforced: a stale tab or two people booking at once
       * already produced a second project. What replaces it is saying how many each enquiry has
       * (`projectCount` below), so a second booking is a choice somebody makes rather than one they
       * make by accident.
       */
      // Word Chunk Search: every word typed, any order - beside the scope, never replacing it.
      AND: [scope.where, ...everyChunk(search, (chunk) => ({
        OR: [
          { enquiryId: { contains: chunk } },
          { name: { contains: chunk } },
          { phone: { contains: chunk } },
          { whatsappNumber: { contains: chunk } },
        ],
      }))],
    };

    const leads = await prisma.salesCrmLead.findMany({
      where,
      select: {
        enquiryId: true, name: true, phone: true, whatsappNumber: true, branch: true,
        assignedBranch: true, crm: true, status: true, preferredBudget: true,
        groomName: true, brideName: true, eventPlannedDate: true,
        // How many live projects this enquiry already has, so the picker can say so. Counted in the
        // same query rather than per row: fifty rows would otherwise be fifty more reads.
        _count: { select: { projects: { where: { deletedAt: null } } } },
      },
      /*
       * Newest first, by when the lead was actually made.
       *
       * It ordered by `enquiryId` descending on the reasoning that ids are issued in sequence. They
       * are - but only *within* a vertical and a branch, and this is a text sort across all of them:
       * `DBS-EID-QQ-...` sorts above `DBS-EID-DD-...` above `DBS-EID-CORP-...`, so the first page was
       * not the newest enquiries at all but the whole of Qua Qua, then as much of Dum Dum as fitted.
       * On a studio with 30 live leads and a page of 20, every single Corp enquiry was unreachable
       * by scrolling - the studio's complaint was "I have many enquiries and get only a few".
       *
       * `createdAt` is what "newest" meant all along, and the id is the tiebreaker for the rows a
       * bulk sheet import stamps with the same instant.
       */
      orderBy: [{ createdAt: "desc" }, { enquiryId: "desc" }],
      take: ENQUIRY_PAGE,
    });

    /*
     * Whether there is more than this behind the search box.
     *
     * A picker that silently stops at its page reads as a list that has lost entries - which is
     * exactly how the old cap was experienced. Counted only when the page came back full, so the
     * common case costs one query.
     */
    const total = leads.length < ENQUIRY_PAGE ? leads.length : await prisma.salesCrmLead.count({ where });

    const data = leads.map((lead) => {
      const { groupType, vertical } = verticalForLeadBranch(lead.branch);
      return {
        enquiryId: lead.enquiryId,
        clientName: lead.name || null,
        /*
         * The live projects this enquiry already has - 0 for nearly all of them.
         *
         * Booking a client again is allowed, so this is not a refusal; it is what the picker shows
         * beside the id so that booking the same enquiry twice is deliberate. Deleted projects are
         * not counted: a booking somebody undid is not a booking this enquiry has.
         */
        projectCount: lead._count?.projects || 0,
        // The number the client is messaged on when there is one; the enquiry number otherwise.
        clientMainNumber: lead.whatsappNumber?.trim() || lead.phone || null,
        // The lead's vertical, which the form turns into the project's vertical.
        groupType,
        vertical,
        leadBranch: lead.branch || null,
        // The lead's branch - not its vertical, which is what this used to send and which the quotation
        // form checks against branch names, so the prefill never matched anything.
        sourceBranch: lead.assignedBranch || null,
        crmName: lead.crm || null,
        leadStatus: lead.status || null,
        groomName: lead.groomName || null,
        brideName: lead.brideName || null,
        eventPlannedDate: lead.eventPlannedDate || null,
        preferredBudget: lead.preferredBudget || null,
        // Carried by the old project-sourced rows; a lead has neither, and the form keeps what it has.
        whatsappGroupName: null,
        initialConvertedValue: null,
      };
    });
    return res.json({ data, total, capped: total > data.length });
  } catch (error) {
    console.error("Unable to search enquiries:", error);
    return res.status(500).json({ message: "Unable to search enquiries." });
  }
}

/*
 * ---- quotations, and the versions of them ----
 *
 * A chain is one quotation's own history, not the enquiry's. A new quotation - for an enquiry that
 * has never been quoted or one that has three already - starts a chain of its own, and only Edit
 * adds to a chain that exists. One enquiry can be quoted for Dum Dum, Qua Qua and Corp at once, and
 * none of those three is a revision of the other two.
 *
 * A quotation is never rewritten. Every edit writes the next version of the same chain, so the
 * document a client was sent stays exactly as it was sent and the price history of a negotiation
 * is readable rather than lost. The chain is named "QUT039" and the reference anybody quotes is
 * chain and version together — "QUT039-02".
 *
 * Each version carries its own public link on its own five-day clock. Raising a new version does
 * not kill the links already sent: a client holding v1 can still open it until its own five days
 * run out, which is what lets two versions be compared. A lapsed link can be re-enabled for five
 * more days, as often as the negotiation needs.
 */

/** How long a quotation link opens for, from the moment it is generated or re-enabled. */
const QUOTATION_LINK_VALIDITY_DAYS = 5;

/**
 * Where a version stands, on the `status` column every version already has.
 *
 * `Generated` is what every version has always been - raised, linked and sendable. `Draft` is a
 * quotation saved from the generator before it was generated: it holds a stable number and every
 * answer typed so far, but no live link, so no client can open it, no PDF is rendered from it, no
 * project can be booked against it and no later version can be raised on it. A draft becomes
 * `Generated` in place, under the same number - `generateQuotationDraft` - and is never anything
 * else. Only a new quotation is drafted; a version raised on a generated chain is generated at once.
 */
const QUOTATION_STATUS = Object.freeze({ DRAFT: "Draft", GENERATED: "Generated" });

const isDraftQuotation = (row) => row?.status === QUOTATION_STATUS.DRAFT;

/*
 * Finalize / Unfinalize, on four columns beside the status (`finalizedAt` / `finalizedByUserId`,
 * `unfinalizedAt` / `unfinalizedByUserId`). Not the save state: `status` keeps saying Draft or
 * Generated, which every other path already reads. And not the register's `finalized` either - that
 * one says which version a *project* was booked at (`finalizedFields`) and is left exactly as it was.
 *
 * Every version is one of exactly two things, each version on its own:
 *
 * - FINALIZED: `finalizedAt` set, `unfinalizedAt` not. Read-only - never edited, raised from or
 *   deleted - and its public link never expires. **At most one version of a quotation is finalized
 *   at a time**: finalizing another is refused until this one is unfinalized by hand
 *   (`finalizeQuotation`), and the database holds the same rule (`finalized_chain_key`, unique).
 * - UNFINALIZED: every other version - never finalized, or finalized once and since unfinalized.
 *   Editable: saving it raises the next version. Its link runs on the five-day clock.
 *
 * Neither move raises a version, touches the document or changes any other version: the version's
 * figures, payload, token and PIN are what they were.
 */
const QUOTATION_FINALIZATION = Object.freeze({ FINALIZED: "FINALIZED", UNFINALIZED: "UNFINALIZED" });
const isFinalizedQuotation = (row) => Boolean(row?.finalizedAt) && !row?.unfinalizedAt;
const FINALIZED_LOCKED = "This version is finalized. Unfinalize it before editing it or creating a new version from it.";
const ANOTHER_FINALIZED = "Another quotation version is already finalized. Please unfinalize that version before finalizing this one.";

/** What the generator and the register show about it: the state, and when and by whom it was last finalized. */
function quotationFinalization(row) {
  return {
    state: isFinalizedQuotation(row) ? QUOTATION_FINALIZATION.FINALIZED : QUOTATION_FINALIZATION.UNFINALIZED,
    finalizedAt: row?.finalizedAt ?? null,
    finalizedByUserId: row?.finalizedByUserId ?? null,
    finalizedByName: row?.finalizedByUser?.name ?? null,
    unfinalizedAt: row?.unfinalizedAt ?? null,
    unfinalizedByUserId: row?.unfinalizedByUserId ?? null,
    unfinalizedByName: row?.unfinalizedByUser?.name ?? null,
  };
}

/** Whether any live version of a chain is finalized - what refuses deleting the whole chain. */
async function chainIsFinalized(quotationNumber, db = prisma) {
  return Boolean(await db.salesQuotation.findFirst({ where: { quotationNumber, deletedAt: null, finalizedAt: { not: null }, unfinalizedAt: null }, select: { id: true } }));
}

/** A row with the names of who finalized and unfinalized it, for the generator's badge. */
async function withFinalizationNames(row) {
  if (!row?.finalizedAt) return row;
  const ids = [row.finalizedByUserId, row.unfinalizedByUserId].filter(Boolean);
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nameOf = (id) => users.find((user) => user.id === id) || null;
  return { ...row, finalizedByUser: nameOf(row.finalizedByUserId), unfinalizedByUser: nameOf(row.unfinalizedByUserId) };
}

function quotationLinkExpiry(from = new Date()) {
  return new Date(from.getTime() + QUOTATION_LINK_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Whether this version's link still opens, and when it stops.
 *
 * Expiry is read rather than written: nothing has to sweep the table to close a link, and a row
 * from before links had a clock (`linkExpiresAt` null) reads as expired rather than as open
 * forever — re-enabling it is one click and is the honest way back.
 */
function quotationLinkState(row, now = new Date()) {
  // A finalized version's link does not expire (and was open when it was finalized - `finalizeQuotation`
  // refuses a lapsed one, which is re-enabled first). Unfinalized, it is back on its own clock.
  if (isFinalizedQuotation(row)) return { linkExpiresAt: null, linkActive: true, linkExpired: false, linkNeverExpires: true };
  const expiresAt = row?.linkExpiresAt || null;
  const active = Boolean(expiresAt) && expiresAt.getTime() > now.getTime();
  return { linkExpiresAt: expiresAt, linkActive: active, linkExpired: !active };
}

function serializeQuotation(row) {
  return {
    ...row,
    /*
     * The name it was raised under, or one built now for a row from before the column existed.
     *
     * The fallback is for reading only - it never writes - so a quotation the backfill has not
     * reached still reads correctly in the register instead of showing a gap. Once named, the
     * stored one is what is shown, and it is not recomputed.
     */
    quotationName: row.quotationName || buildQuotationName(row),
    // The logo this version was issued under - the row's own, never today's Settings. Null on a
    // version older than the snapshot, which the page shows with the bundled default mark.
    ...brandingForDocument(row),
    /*
     * The brand, and what the brand was when this version was raised.
     *
     * The column is read first; a row from before the column existed answers from its payload's
     * vertical, which is what the backfill read too. The snapshot is the version's own copy of the
     * brand's terms, wording and logo - the page prints from it and never from the brand tables -
     * and is null on a version raised before snapshots, which the page prints with its defaults.
     */
    quotationBrand: row.quotationBrand || quotationBrands.brandCodeOfPayload(row.payload),
    brandSnapshot: row.payload?.brandSnapshot || null,
    subtotal: Number(row.subtotal || 0),
    discount: Number(row.discount || 0),
    amount: Number(row.amount || 0),
    publicPath: `/q/${row.publicToken}`,
    ...quotationLinkState(row),
    finalization: quotationFinalization(row),
  };
}

/** One version, as the version dropdown and the history list need it. */
function serializeQuotationVersion(row) {
  // `linkNeverExpires` too: without it a finalized version's history card read its link as expired.
  const { linkExpiresAt, linkActive, linkNeverExpires } = quotationLinkState(row);
  return {
    id: row.id,
    quotationId: row.quotationId,
    quotationNumber: row.quotationNumber,
    quotationName: row.quotationName || buildQuotationName(row),
    version: row.version,
    enquiryId: row.enquiryId,
    /*
     * What the quotation says about the client, carried so Create Project can fill the sale from
     * the version that was picked rather than from the chain's current one. They are the version's
     * own answers: a later version raised after the client changed number holds the new one, and
     * reading the chain would put that number on a project converted at the older version.
     */
    clientName: row.clientName,
    clientMainNumber: row.clientMainNumber,
    sourceBranch: row.sourceBranch,
    /*
     * The version's own note, not the chain's. The history rows are built by laying a version over
     * the chain's fields, so a version left without one would show whatever the current version
     * says - which is the one place a note can be read against a price it was never written for.
     */
    additionalNotes: row.additionalNotes ?? null,
    // Carried so a version can be duplicated straight from the history without first fetching its
    // whole payload for the one field the enquiry picker needs.
    vertical: row.payload?.vertical || null,
    quotationBrand: row.quotationBrand || quotationBrands.brandCodeOfPayload(row.payload),
    amount: Number(row.amount || 0),
    subtotal: Number(row.subtotal || 0),
    discount: Number(row.discount || 0),
    status: row.status,
    createdAt: row.createdAt,
    // Who raised it, for the version history (named by `listQuotations`).
    createdByUserId: row.createdByUserId ?? null,
    publicToken: row.publicToken,
    publicPath: `/q/${row.publicToken}`,
    linkExpiresAt,
    linkActive,
    ...(linkNeverExpires ? { linkNeverExpires } : {}),
    finalization: quotationFinalization(row),
  };
}

/**
 * Whether one version is the one a project converted at, and which project that was.
 *
 * `finalized` is the flag the register's own column reads; `finalizedByEventId` names the project,
 * for the info panel and for anybody asking why a version is marked. Both are written on every
 * version so the answer is per version rather than per chain - a chain's later versions are often
 * raised *after* the sale closed on an earlier one, and marking the whole chain would say the
 * studio sold at a price it never sold at.
 */
function finalizedFields(row, finalizedBy) {
  // A quotation with no id of its own matches nothing, rather than whatever a blank key holds.
  // The lookup is built from ids the database returned, so a blank key does not arise there - but
  // a row predating quotation ids asking the question must be answered "no", not "whatever is
  // first".
  const quotationId = row?.quotationId;
  if (!quotationId) return { finalized: false, finalizedByEventId: null };
  const eventId = finalizedBy.get(quotationId) || null;
  return { finalized: Boolean(eventId), finalizedByEventId: eventId };
}

/**
 * The register lists chains, not versions: the current version of each, with its history attached.
 *
 * Six versions of one negotiation as six rows would bury the other enquiries; the versions ride
 * along on the row so the screen can open them without a second request.
 */
/**
 * Whose quotations: the grant's scope on the permission this route was guarded with (Quotation
 * Management, on `req.permission`), on the quotation's own branch and the person who followed it up.
 */
const QUOTATION_SCOPE_COLUMNS = { branch: "branchId", employee: "ownerEmployeeId", user: "createdByUserId" };
const quotationScope = (req) => dataScope.resolve({ userId: Number(req.user.id), module: req.permission.module, feature: req.permission.feature, columns: QUOTATION_SCOPE_COLUMNS });

/**
 * A quotation belongs to an **enquiry**, not to the person who typed it.
 *
 * One enquiry is quoted, re-quoted, and eventually booked as a project, and the four or five people
 * who touch it along the way are rarely the same person. Scoped on the quotation's own columns
 * alone, whoever books the project could not read the quotation it was sold on - which is the whole
 * point of having one. So the enquiry counts as a name: a quotation is yours if you may read the
 * lead it was raised against, or the project it became.
 *
 * Answered per row rather than as a `where`, because a quotation names its enquiry with a string
 * rather than a foreign key and cannot be filtered through a relation (the same reason meetings and
 * conversations are answered this way - see `leadScope.js`).
 */
async function readableEnquiries(enquiryIds, req) {
  const wanted = [...new Set((Array.isArray(enquiryIds) ? enquiryIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!wanted.length) return new Set();
  const reader = { userId: Number(req.user.id), permissions: req.permission };
  const [fromLeads, fromProjects] = await Promise.all([
    readableEnquiryIds(wanted, reader),
    prisma.salesProject.findMany({
      where: { enquiryId: { in: wanted }, deletedAt: null, AND: [await projectAccessWhere(reader)] },
      select: { enquiryId: true },
    }),
  ]);
  return new Set([...fromLeads, ...fromProjects.map((row) => row.enquiryId)]);
}

/** The rows of `quotations` this request may see: its own names, or an enquiry it can reach. */
async function narrowQuotations(quotations, req) {
  const scope = await quotationScope(req);
  // `own` is the narrower question the register also needs an answer to: reached on this person's
  // own names rather than through a share, which is who may change who it is shared with.
  if (scope.unlimited) return { rows: quotations, own: () => true };
  const [reachable, shared] = await Promise.all([readableEnquiries(quotations.map((row) => row.enquiryId), req), quotationShares.sharedChainNumbers(scope)]);
  const own = (row) => scope.allows(row) || reachable.has(row.enquiryId);
  // ...or a chain somebody shared with them, which brings every version of it.
  return { rows: quotations.filter((row) => own(row) || shared.has(row.quotationNumber)), own };
}

/**
 * One live quotation the request may see, or null.
 *
 * Deliberately not narrowed: this is what the project form reads after picking a version from the
 * enquiry's dropdown, and the dropdown offers every version raised for that enquiry (see
 * `listQuotations`). Narrowing it would hand somebody a version they may choose and then refuse to
 * read it back, which is the flow this change exists to fix. The register is what is narrowed;
 * reading one document by id is not. Writing to it still is - see the four handlers below.
 */
async function quotationById(id) {
  const quotation = await prisma.salesQuotation.findUnique({ where: { id } });
  return quotation && !quotation.deletedAt ? quotation : null;
}

/** One live quotation this request may *change* - the narrower question, for the write paths. */
async function scopedQuotation(req, id) {
  const [scope, quotation] = await Promise.all([quotationScope(req), quotationById(id)]);
  if (!quotation) return null;
  if (scope.allows(quotation)) return quotation;
  const reachable = await readableEnquiries([quotation.enquiryId], req);
  if (reachable.has(quotation.enquiryId)) return quotation;
  // Shared with them: they may raise the next version and edit the draft, as the owner may.
  const shared = await quotationShares.sharedChainNumbers(scope);
  return shared.has(quotation.quotationNumber) ? quotation : null;
}

/*
 * Sharing a quotation (`services/quotationShares.js`, which holds the rules).
 *
 * The register is widened by a share, and so is the write gate: somebody a quotation is shared with
 * raises its next version and edits its draft as its owner does. Who it is shared *with* is the
 * owner's to set - `maySetShares` - so a sharee cannot drop the colleagues already on it.
 */

/** Whether this request reaches the chain on its **own** names, rather than through a share. */
async function maySetShares(req, quotation) {
  const scope = await quotationScope(req);
  if (scope.unlimited || scope.allows(quotation)) return true;
  const reachable = await readableEnquiries([quotation.enquiryId], req);
  return reachable.has(quotation.enquiryId);
}

/**
 * Writes the share list a save carried, where the saver is one who may set it.
 *
 * Never turns a saved quotation into a failed request: the version or the draft is already written
 * by the time this runs, and answering 500 would have the form save it again as another version.
 * A list that cannot be written is logged, and the form reopens showing what is actually shared.
 */
async function applyQuotationShares(req, quotation, people) {
  if (!people) return;
  try {
    if (!(await maySetShares(req, quotation))) return;
    await quotationShares.writeShares({ quotationNumber: quotation.quotationNumber, people, sharedByUserId: Number(req.user?.id) || null });
  } catch (error) {
    console.error("Unable to save who the quotation is shared with:", error);
  }
}

/**
 * Saves who a quotation is shared with, on its own, without raising a version.
 *
 * A version means "this replaces what I sent you" - a document the client receives. Who at the
 * studio can open it is not part of that document at all, so sharing writes the list and nothing
 * else: the quotation stays on the version it was on, and the people chosen get every version of
 * it, past and future, because the share is of the chain.
 */
async function saveQuotationShares(req, res) {
  const parsed = z.object({ sharedEmployeeIds: z.array(z.coerce.number().int().positive()).max(50) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid share list." });
  try {
    const quotation = await scopedQuotation(req, req.params.id);
    if (!quotation) return res.status(404).json({ message: "Quotation not found." });
    if (!(await maySetShares(req, quotation))) {
      return res.status(403).json({ message: "This quotation was shared with you, so who else it reaches is not yours to change." });
    }
    const people = await quotationShares.shareablePeople(parsed.data.sharedEmployeeIds);
    await quotationShares.writeShares({ quotationNumber: quotation.quotationNumber, people, sharedByUserId: Number(req.user?.id) || null });
    const shares = await quotationShares.sharesByChain([quotation.quotationNumber]);
    return res.json({ data: shares.get(quotation.quotationNumber) || [] });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to save who the quotation is shared with:", error);
    return res.status(500).json({ message: "Unable to save who the quotation is shared with." });
  }
}

/**
 * The Share with picker's list: the working employees who can open Quotations, and nobody else.
 *
 * A share widens *which* quotations somebody reaches; it cannot put them on the screen, which is
 * `SALES / Quotation Management` on the route. So sharing with somebody whose roles do not grant it
 * reaches nobody and tells nobody - the quotation simply never appears for them. The list used to
 * carry those people marked "no access to Quotations", on the reasoning that the studio often
 * shares with a colleague about to be given the screen; offering a choice that does nothing is the
 * worse half of that trade, so they are left out until their role actually grants it.
 */
async function listQuotationShareCandidates(req, res) {
  try {
    const [people, readers] = await Promise.all([salesEmployeeOptions(), quotationShares.readerEmployeeIds()]);
    return res.json({ data: people.filter((row) => readers.has(row.id)) });
  } catch (error) {
    console.error("Unable to load the quotation share list:", error);
    return res.status(500).json({ message: "Unable to load the quotation share list." });
  }
}

/** Chain ascending, then the newest version of each first - the register's reading order. */
function byChainThenNewestVersion(a, b) {
  const chain = String(a.quotationNumber || "").localeCompare(String(b.quotationNumber || ""), "en", { sensitivity: "base" });
  return chain || (Number(b.version) || 0) - (Number(a.version) || 0);
}

async function listQuotations(req, res) {
  try {
    const enquiryId = String(req.query.enquiryId || "").trim();
    // A brand to narrow to, for a caller that wants one brand's register. The screen filters the
    // rows it already holds; this is for anything asking the API directly.
    const brand = req.query.brand ? quotationBrands.brandCodeOfPayload({ quotationBrand: req.query.brand }) : null;
    /*
     * Two screens, one endpoint, and they ask different questions.
     *
     * **Asked for one enquiry, this is a picker** - the version dropdown on the project form - and
     * it answers with every version raised for that enquiry, whoever raised them. A project is
     * booked against a quotation somebody else usually wrote, so a narrowed dropdown means the
     * person booking it cannot bring the quoted shoots across.
     *
     * **Asked for nothing, this is the register**, and it answers with the reader's own rows: the
     * quotations naming them, and those raised against an enquiry they can reach through its lead
     * or its project.
     *
     * The picker cannot be used to read the table: it answers for one enquiry at a time, and an
     * enquiry has to be named to be asked about.
     */
    /*
     * Read unsorted and put in order here - chain ascending, newest version first, the order the
     * query used to ask MySQL for. Every row carries its whole `payload`, and an ORDER BY over every
     * row made MySQL copy those payloads into its sort buffer: once the register grew past what the
     * buffer holds, the query failed outright ("Out of sort memory", MySQL 1038) and the register
     * read as empty. The rows are the same; only who sorts them has changed.
     */
    /*
     * The picker never offers a draft: a project is booked against what the client was sent, and a
     * draft has been sent to nobody. The register lists drafts beside everything else, and the
     * screen keeps them under a tab of their own.
     *
     * `withDrafts=1` lists an enquiry's drafts too, for Create Project's picker, which shows every
     * version with its status and lets only a finalized one be chosen - a draft is shown there, never
     * offered. Booking one is still refused on save (`resolveFinalizedQuotation`).
     */
    const withDrafts = Boolean(enquiryId) && req.query.withDrafts === "1";
    const rows = (await prisma.salesQuotation.findMany({
      where: { deletedAt: null, ...(enquiryId ? { enquiryId, ...(withDrafts ? {} : { status: { not: QUOTATION_STATUS.DRAFT } }) } : {}), ...(brand ? { quotationBrand: brand } : {}) },
    })).sort(byChainThenNewestVersion);
    const narrowed = enquiryId ? { rows, own: () => true } : await narrowQuotations(rows, req);
    const quotations = narrowed.rows;

    const chains = new Map();
    for (const row of quotations) {
      const chain = chains.get(row.quotationNumber) || [];
      chain.push(row);
      chains.set(row.quotationNumber, chain);
    }

    /*
     * Which of these versions a project actually converted at.
     *
     * One query for the whole page rather than one per version, and it answers with the project's
     * own event id so the register can say *which* project finalized it rather than only that
     * something did. A version nobody converted at is simply absent from the map, which is what
     * leaves its cell empty.
     */
    const finalizedBy = new Map();
    const quotationIds = quotations.map((row) => row.quotationId).filter(Boolean);
    if (quotationIds.length) {
      const converted = await prisma.salesProject.findMany({
        where: { deletedAt: null, quotationId: { in: quotationIds } },
        select: { quotationId: true, eventId: true },
        // Oldest first, so a version somehow claimed by two projects names the one that claimed it
        // first rather than whichever the database happened to return.
        orderBy: { createdAt: "asc" },
      });
      for (const project of converted) {
        if (!finalizedBy.has(project.quotationId)) finalizedBy.set(project.quotationId, project.eventId);
      }
    }

    // Who each chain is shared with, for the form to reopen on (one query for the page).
    const shares = await quotationShares.sharesByChain([...chains.keys()]);

    // Newest chain first, which for a register read top-down is the enquiry quoted for most
    // recently rather than the one with the highest chain number.
    // Who raised and who finalized each version, for the version history - one read for the page.
    const versionNames = await userNamesById(quotations.flatMap((row) => [row.createdByUserId, row.finalizedByUserId]));
    const nameOf = (id) => (id ? versionNames.get(Number(id)) || null : null);
    const data = [...chains.values()]
      .map((versions) => ({
        ...serializeQuotation(versions[0]),
        ...finalizedFields(versions[0], finalizedBy),
        sharedWith: shares.get(versions[0].quotationNumber) || [],
        // Whose list it is to change: a sharee reads it and edits the quotation, and the people it
        // is shared with stay the owner's to set.
        canShare: narrowed.own(versions[0]),
        versionCount: versions.length,
        versions: versions.map((version) => {
          const serialized = serializeQuotationVersion(version);
          return {
            ...serialized,
            ...finalizedFields(version, finalizedBy),
            createdByName: nameOf(version.createdByUserId),
            finalization: { ...serialized.finalization, finalizedByName: nameOf(version.finalizedByUserId) },
          };
        }),
      }))
      .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));

    // Who raised each quotation, by name (`services/userNames`).
    return res.json({ data: await withUserNames(data) });
  } catch (error) {
    console.error("Unable to load quotations:", error);
    return res.status(500).json({ message: "Unable to load quotations." });
  }
}

/** One version in full, payload and all: what the generator reloads when a version is picked. */
async function getQuotation(req, res) {
  try {
    const quotation = await quotationById(req.params.id);
    if (!quotation) return res.status(404).json({ message: "Quotation not found." });
    const [shares, canShare, named] = await Promise.all([quotationShares.sharesByChain([quotation.quotationNumber]), maySetShares(req, quotation), withFinalizationNames(quotation)]);
    return res.json({ data: { ...serializeQuotation(named), sharedWith: shares.get(quotation.quotationNumber) || [], canShare } });
  } catch (error) {
    console.error("Unable to load quotation:", error);
    return res.status(500).json({ message: "Unable to load quotation." });
  }
}

function shortToken() {
  return require("crypto").randomBytes(6).toString("base64url");
}

/** A token no quotation is already using. */
async function uniqueQuotationToken() {
  let token = shortToken();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const exists = await prisma.salesQuotation.findUnique({ where: { publicToken: token } });
    if (!exists) return token;
    token = shortToken();
  }
  return token;
}

/**
 * The next chain: DBS-QO-DD-ERD-000001, counted per vertical alongside every other identifier the
 * studio hands out.
 *
 * A *chain* rather than a document. One enquiry is quoted for once and then re-quoted, and every
 * version of that conversation shares this number - which is why it is the enquiry's identifier and
 * `quotationId` below is the individual document's.
 *
 * It used to be `QUT` plus the highest existing chain, read back off the table. The counter in
 * `services/identifiers.js` replaces that scan, only ever goes up, and says which vertical and
 * branch the quotation was raised in. The vertical is the one the generator was filled in for,
 * which lives in the saved payload - a quotation's client fields differ per vertical, so it is the
 * one thing every quotation has.
 */
const nextQuotationChainNumber = (quotation) => nextIdentifier("QUOTATION", {
  vertical: quotation?.payload?.vertical || quotation?.vertical,
  branch: quotation?.sourceBranch || quotation?.nearestBranch,
});

/** "DBS-QO-DD-ERD-000001" + 2 -> "DBS-QO-DD-ERD-000001-02". */
function quotationIdFor(quotationNumber, version) {
  return `${quotationNumber}-${String(version).padStart(2, "0")}`;
}

/**
 * The next free version of a chain.
 *
 * Deleted versions count: reusing the number of one somebody removed would give two different
 * documents the same reference, and the client holding the first still has it in writing.
 */
async function nextVersionFor(quotationNumber, db = prisma) {
  const latest = await db.salesQuotation.findFirst({
    where: { quotationNumber },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return (latest?.version || 0) + 1;
}

function parseQuotationPayload(req, res) {
  const parsed = quotationPayloadSchema.safeParse(req.body);
  if (parsed.success) return parsed.data;
  // A rule about the figures (the discount limit, the cost) is said in its own words, so the reason
  // reaches whoever sent it; a malformed field is still the general refusal.
  const rule = parsed.error.issues.find((issue) => issue.code === "custom");
  res.status(400).json({ message: rule?.message || "Invalid quotation details.", errors: parsed.error.flatten() });
  return null;
}

function quotationData(parsed) {
  return {
    enquiryId: parsed.enquiryId || null,
    clientName: parsed.clientName || null,
    clientMainNumber: parsed.clientMainNumber || parsed.contactNumber || null,
    sourceBranch: parsed.sourceBranch || parsed.nearestBranch || null,
    eventVenue: parsed.eventVenue || null,
    followedBy: parsed.followedBy || null,
    referredBy: parsed.referredBy || null,
    secondaryContactNumber: parsed.secondaryContactNumber || null,
    additionalNotes: parsed.additionalNotes || null,
    subtotal: parsed.subtotal || 0,
    discount: parsed.discount || 0,
    amount: parsed.amount || 0,
    serviceCount: parsed.serviceCount || 0,
    deliverableCount: parsed.deliverableCount || 0,
    payload: parsed,
  };
}

/**
 * Writes one version, retrying if another request took the number first.
 *
 * Two people quoting for the same enquiry at the same moment both read the same "next version"; the
 * unique key on (chain, version) is what stops the second one overwriting the first, and this is
 * what turns that collision into the next number rather than an error on somebody's screen.
 *
 * The chain is resolved again on every attempt rather than once up front, because the collision
 * that matters most is on a *new* chain: two enquiries quoted for at the same moment both read
 * "QUT040" as free, and re-resolving is what sends the loser to QUT041 instead of quietly filing
 * its quotation as version two of the winner's enquiry.
 */
// `db` is the transaction a caller already holds - Save as New Version's, with the chain locked.
async function insertQuotationVersion(resolveChain, parsed, createdByUserId = null, { draft = false, db = prisma } = {}) {
  const data = await quotationVersionColumns(parsed);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const quotationNumber = await resolveChain();
    const version = await nextVersionFor(quotationNumber, db);
    try {
      return await db.salesQuotation.create({
        data: {
          ...data,
          createdByUserId,
          quotationNumber,
          version,
          quotationId: quotationIdFor(quotationNumber, version),
          publicToken: await uniqueQuotationToken(),
          /*
           * A draft has no live link and no clock: nothing has been sent. Its token is minted now
           * only because the column is required, and every public route refuses a draft by status
           * (`isDraftQuotation`). The five days start when the draft is generated.
           */
          ...(draft ? { status: QUOTATION_STATUS.DRAFT, linkExpiresAt: null } : { linkExpiresAt: quotationLinkExpiry() }),
        },
      });
    } catch (error) {
      if (error?.code !== "P2002") throw error;
    }
  }
  throw new Error("Unable to allocate a quotation version.");
}

/**
 * Everything a version stores that is worked out from its answers: the columns, the brand and its
 * snapshot, the Global Logo, the name, and the branch and employee references.
 *
 * One place for every way a version is written - a new quotation, the next version, a duplicate,
 * and a draft saved or generated - so they cannot come to disagree about what a version holds.
 * Whoever created the row is not here: a draft keeps the person who started it however often it is
 * saved, so only an insert stamps it.
 */
async function quotationVersionColumns(parsed) {
  // Every version is a new document, so every version takes the Global Logo current at the moment
  // *it* is raised - and keeps it. Read once, outside the retry loop: a collision on the version
  // number changes nothing about what the studio's logo was.
  const branding = await snapshotDocumentBranding();
  /*
   * The brand this version is raised under, frozen with it.
   *
   * Read once here, beside the logo and for the same reason: a version is a document, and the
   * terms, the wording, the GST rate and the mark it is sent with are facts about *this* version.
   * They go into the payload as `brandSnapshot`, which the public page and the PDF read instead of
   * the brand tables - so a brand's settings can change every week and `DBS-QO-DD-ERD-000001`
   * keeps printing what it printed the day it was sent. A brand with a mark of its own overrides
   * the Global Logo; one without keeps it, exactly as before brands existed.
   */
  const brand = await quotationBrands.snapshotForQuotation(parsed, { globalLogoUrl: branding.logoUrl });
  // The references beside the text, resolved the way the backfill resolved them, so a quotation
  // raised today is narrowed like one that was backfilled.
  const columns = quotationData({ ...parsed, quotationBrand: brand.quotationBrand, brandSnapshot: brand.brandSnapshot });
  columns.quotationBrand = brand.quotationBrand;
  /*
   * The name this version is raised under, stamped once here.
   *
   * One place for all three ways a version is written - a new quotation, an edit that raises the
   * next version, and a duplicate onto another enquiry - because a name built in three handlers is
   * a name that differs in one of them. Built from what is about to be stored rather than from the
   * row afterwards, so it describes this version's own answers.
   */
  const quotationName = buildQuotationName({ ...columns, payload: columns.payload });
  const refs = await referenceLookups();
  // Whoever raised it is one of the names the scope reads, so a quotation with nobody following it
  // up is still visible to the person who wrote it.
  const references = { branchId: refs.branchId(columns.sourceBranch), ownerEmployeeId: refs.employeeId(columns.followedBy) };
  return { ...columns, ...references, ...branding, quotationName };
}

/**
 * A quotation for an enquiry: version one of a new chain, or the next version of the one the
 * enquiry already has. An enquiry is quoted for once and then re-quoted; it does not collect
 * chains.
 */
async function createQuotation(req, res) {
  const parsed = parseQuotationPayload(req, res);
  if (!parsed) return;
  try {
    /*
     * A new quotation is a new chain, always - even for an enquiry that already has one.
     *
     * It used to join the enquiry's existing chain, on the reading that an enquiry is quoted and
     * then re-quoted. That is one thing an enquiry does and not the only one: a single enquiry is
     * regularly quoted for Dum Dum, Qua Qua and Corp - three different packages, three different
     * prices, none of them a revision of another - and folding them into one chain made version 2
     * of a wedding quotation out of a corporate one. A version means "this replaces what I sent
     * you", and that is a claim only an edit can make.
     */
    // Every service and deliverable on a new quotation is newly chosen, so every one naming a brand
    // master has to be one that brand still offers.
    await quotationBrands.assertNewSelectionsOffered(parsed, null);
    // Checked before the quotation is written, so a name that cannot be shared with refuses the
    // save rather than leaving a version raised and its shares unwritten.
    const people = parsed.sharedEmployeeIds ? await quotationShares.shareablePeople(parsed.sharedEmployeeIds) : null;
    const quotation = await insertQuotationVersion(
      async () => nextQuotationChainNumber(parsed),
      parsed,
      Number(req.user?.id) || null,
    );
    await applyQuotationShares(req, quotation, people);
    return res.status(201).json({ data: serializeQuotation(quotation) });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    const refusal = quotationSaveRefusal(error);
    if (refusal) {
      // The code and the constraint, which is what says why; never the payload, which carries the
      // client's own details.
      console.error("Unable to create quotation:", error.code, error.meta);
      return res.status(400).json({ message: refusal });
    }
    console.error("Unable to create quotation:", error);
    return res.status(500).json({ message: "Unable to create quotation." });
  }
}

/**
 * A quotation that MySQL refused, said in words the studio can act on.
 *
 * `enquiry_id` is a real foreign key onto the CRM lead (`schema.prisma`, `SalesQuotationLead`,
 * `onDelete: Restrict`), and the Enquire ID box on the generator is a **suggestion** box rather
 * than a closed list - a quotation is often raised for an enquiry the CRM has not been given yet,
 * so an id can be typed straight in. Type one that is not a lead and the insert is refused with
 * P2003.
 *
 * That refusal used to reach the studio as "Unable to save quotation." and nothing else: the retry
 * loop around the insert rethrows anything that is not a duplicate key, and the catch below turned
 * every one of those into the same 500. So the one thing the person had to change was the one
 * thing they were not told - and the field it is about is required, sits at the top of a long form,
 * and is scrolled well out of view by the time Generate Quotation is pressed.
 *
 * Only the constraint is named, never the value or the query: what comes back says which answer to
 * fix and nothing about what else is in the database. `null` for anything this does not recognise,
 * which stays a 500 and is logged in full.
 */
function quotationSaveRefusal(error) {
  if (error?.code !== "P2003") return null;
  const constraint = String(error?.meta?.field_name || error?.meta?.constraint || "");
  if (/enquiry/i.test(constraint)) {
    return "That Enquire ID does not belong to any lead in the CRM. Pick one from the list, or add the lead first.";
  }
  return "This quotation names a record that no longer exists. Check the Identification details and try again.";
}

/**
 * Editing a quotation writes the next version of its chain rather than changing what was sent.
 *
 * The version is raised from whichever version was opened - reopening v1 after v3 exists and
 * saving it makes v4, because what the studio just approved is the newest thing said, not a
 * correction to an old one.
 */
/*
 * Whether a save would raise a version that says nothing new.
 *
 * A version means "this replaces what I sent you", so it is worth raising only when the document
 * changed: the client's details, the lines, the figures, the notes. Opening a quotation, changing
 * who at the studio it is shared with and saving used to raise one all the same, which left a chain
 * of identical documents and a client link pointing at the newest of them.
 *
 * `brandSnapshot` is left out of the comparison on purpose - it is this version's frozen copy of the
 * brand's terms and wording, re-taken every time the form is opened, so comparing it would make
 * every save look like a change. The keys are sorted, because two readings of the same answers can
 * come back in a different order.
 */
const COMPARED_COLUMNS = ["enquiryId", "clientName", "clientMainNumber", "sourceBranch", "eventVenue", "followedBy", "referredBy", "secondaryContactNumber", "additionalNotes", "quotationBrand"];
/** The figures, read as numbers: a stored one comes back as a Decimal and a typed one as a number. */
const COMPARED_FIGURES = ["subtotal", "discount", "amount", "serviceCount", "deliverableCount"];
function documentAnswers(row) {
  /*
   * Empty is empty, however it is spelled. A field the form sends as null, "" or an empty list, and
   * one the stored payload simply does not have, are the same answer: nothing. Comparing them
   * literally made a save look like a change whenever the form had learned a field the quotation
   * was raised without - which is most saves on an older quotation.
   */
  /*
   * What is compared is the quotation as the client reads it - its lines, their quantities and
   * sizes, the words on them and the money - never the form's own working: the catalogue row each
   * line was chosen from, and the per-line rates the form fills in from it when the quotation is
   * reopened. Those arrive on an old quotation simply because the form knows more than it did when
   * it was raised, and comparing them made every save look like a change. A rate that genuinely
   * moved shows up in the figures, which are compared, and in the quantity beside it.
   *
   * `discountInputSource` is here for the same reason: it says which of the two discount boxes was
   * typed into, so the form can reopen on it, and a quotation raised before the app asked gains it
   * the first time it is opened. What the client reads is the discount itself, which is compared.
   */
  const ignored = new Set(["brandSnapshot", "deliverableDefinition", "serviceDefinition", "packageDefinition", "definition", "pricing", "discountInputSource", "unitPrice", "price", "rate", "lineTotal", "total", "amount", "subtotal"]);
  const empty = (value) => value === null || value === undefined || value === ""
    || (Array.isArray(value) && !value.length)
    || (value && typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length);
  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort()
        .filter((key) => !ignored.has(key) && !empty(value[key]))
        .map((key) => [key, stable(value[key])]));
    }
    return value;
  };
  return JSON.stringify(stable({
    ...Object.fromEntries(COMPARED_COLUMNS.map((column) => [column, row[column] ?? null])),
    // The figures are compared even when they are zero: a quotation that came down to nothing is a
    // different document from one that was never priced.
    figures: COMPARED_FIGURES.map((column) => Number(row[column] || 0)),
    payload: row.payload || {},
  }));
}

async function createQuotationVersion(req, res) {
  const parsed = parseQuotationPayload(req, res);
  if (!parsed) return;
  try {
    const source = await scopedQuotation(req, req.params.id);
    if (!source) return res.status(404).json({ message: "Quotation not found." });
    // A draft is finished by generating it, not by raising a second version over it.
    if (isDraftQuotation(source)) return res.status(409).json({ message: DRAFT_NOT_GENERATED });
    // A finalized version is read-only: it is unfinalized first, then edited. Any unfinalized version
    // may be saved as the next one - another version being finalized does not stop it.
    if (isFinalizedQuotation(source)) return res.status(409).json({ message: FINALIZED_LOCKED });
    /*
     * The brand is set at the first version and every later one keeps it - the generator locks the
     * selector, and this is what makes that a rule rather than a convention. The vertical rides
     * along for the same reason; the counter and the name both read it.
     */
    const withBrand = { ...parsed, quotationBrand: source.quotationBrand || quotationBrands.brandCodeOfPayload(source.payload), vertical: source.payload?.vertical || parsed.vertical || null };
    // The share list is not part of a version: it is written by `PUT /quotations/:id/shares`, which
    // is why raising one here carries no `sharedEmployeeIds`.
    // Lines the earlier version already held stay, whatever has since happened to their master;
    // only a line added on this version has to be one the brand still offers.
    await quotationBrands.assertNewSelectionsOffered(withBrand, source.payload);
    const columns = await quotationVersionColumns(withBrand);
    // Nothing in the document changed, so there is nothing to replace: the quotation stays on the
    // version it is on. Sharing it, which is not part of the document, saves itself elsewhere.
    if (documentAnswers(columns) === documentAnswers(source)) {
      return res.json({ data: serializeQuotation(source), unchanged: true });
    }
    /*
     * One transaction, the quotation's versions locked `FOR UPDATE` first, so saves and finalizes of
     * one quotation take turns. Under the lock the source is asked again whether it is finalized - a
     * finalize that landed meanwhile wins - and the same document pressed twice (a double click, two
     * tabs) raises one version: the second press finds it already the newest and gets it back as
     * unchanged. No other version's status is touched. If anything fails, nothing is written.
     */
    const saved = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM sales_quotation WHERE quotation_number = ${source.quotationNumber} FOR UPDATE`;
      const current = await transaction.salesQuotation.findUnique({ where: { id: source.id } });
      if (!current || current.deletedAt) throw Object.assign(new Error("Quotation not found."), { status: 404 });
      if (isFinalizedQuotation(current)) throw Object.assign(new Error(FINALIZED_LOCKED), { status: 409 });
      const newest = await transaction.salesQuotation.findFirst({ where: { quotationNumber: source.quotationNumber, deletedAt: null }, orderBy: { version: "desc" } });
      if (newest && newest.id !== source.id && documentAnswers(columns) === documentAnswers(newest)) return { quotation: newest, unchanged: true };
      return { quotation: await insertQuotationVersion(async () => source.quotationNumber, withBrand, Number(req.user?.id) || null, { db: transaction }) };
    }, { timeout: 20000 });
    if (saved.unchanged) return res.json({ data: serializeQuotation(saved.quotation), unchanged: true });
    return res.status(201).json({ data: serializeQuotation(saved.quotation) });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    // Lost a race with another save or a finalize of the same quotation (deadlock / write conflict):
    // nothing was written, so it is safe to say so and let the person reload.
    if (error?.code === "P2034") return res.status(409).json({ message: "This quotation was changed at the same moment. Reload it and try again." });
    const refusal = quotationSaveRefusal(error);
    if (refusal) {
      // The code and the constraint, which is what says why; never the payload, which carries the
      // client's own details.
      console.error("Unable to create the next quotation version:", error.code, error.meta);
      return res.status(400).json({ message: refusal });
    }
    console.error("Unable to create the next quotation version:", error);
    return res.status(500).json({ message: "Unable to create the next quotation version." });
  }
}

/**
 * Copies one version into a quotation of its own.
 *
 * The same package quoted for a second client is the ordinary case this exists for: the services,
 * deliverables, shoots and rates come across exactly as they were priced. The copy starts its own
 * chain at version 1, with a token and a five-day clock of its own. The version it was copied from
 * is not touched, and the link already sent for it keeps working.
 *
 * **The target may be the enquiry it already belongs to.** That used to be refused, because under
 * the old rule a copy onto its own enquiry could only have become the next version of its own
 * chain - which is Edit's job, and confusing it with this one was worth a refusal. Now that a
 * quotation is its own chain, copying within an enquiry is a plain second quotation for it: the
 * Dum Dum package as the starting point for the Corp one is the case, and it is exactly what a
 * copy onto any other enquiry does. Edit still means "this replaces what I sent"; this still means
 * "start another one from this".
 *
 * The saved payload is put back through the same schema every other write goes through, so a
 * quotation stored before a field existed cannot be copied into a shape the register cannot read.
 */
async function duplicateQuotation(req, res) {
  const enquiryId = String(req.body?.enquiryId || "").trim();
  if (!enquiryId) return res.status(400).json({ message: "Choose the enquiry to duplicate this quotation to." });
  try {
    const source = await scopedQuotation(req, req.params.id);
    if (!source) return res.status(404).json({ message: "Quotation not found." });
    // This raises a generated quotation straight off the saved answers, which a draft's have not
    // yet been checked as being.
    if (isDraftQuotation(source)) return res.status(409).json({ message: DRAFT_NOT_GENERATED });
    const parsed = quotationPayloadSchema.safeParse({ ...(source.payload || {}), enquiryId });
    if (!parsed.success) {
      // A rule about the figures - a quotation saved above today's discount limit - says itself.
      const rule = parsed.error.issues.find((issue) => issue.code === "custom");
      return res.status(422).json({ message: rule?.message || "This quotation cannot be duplicated - its saved details are incomplete.", errors: parsed.error.flatten() });
    }
    const quotation = await insertQuotationVersion(
      // Its own chain, counted under the duplicate's own vertical and branch. A copy is a new
      // document rather than a revision of whatever the target enquiry happened to be quoted
      // before - it is not replacing anything anybody was sent.
      async () => nextQuotationChainNumber(parsed.data),
      parsed.data,
      Number(req.user?.id) || null,
    );
    return res.status(201).json({ data: serializeQuotation(quotation) });
  } catch (error) {
    console.error("Unable to duplicate quotation:", error);
    return res.status(500).json({ message: "Unable to duplicate quotation." });
  }
}

/*
 * ── Drafts ─────────────────────────────────────────────────────────────────────────────────────
 *
 * Save Draft on the generator keeps a quotation that is not ready to send. The first save numbers
 * it - version 01 of a new chain, exactly as Generate Quotation would - so the draft has the
 * reference it will keep; every later save rewrites that same row; and Generate Quotation turns it
 * into a generated version in place, under the same number, starting its link's five days. Nothing
 * reaches a client before that: the public page, the PDF and the payment page all refuse a draft.
 *
 * A draft is rewritten in place, which no generated version ever is, and that is safe only because
 * nobody has been sent it. The `status: Draft` in every write's `where` is what keeps it that way: a
 * save that lands after the draft was generated - a second tab, a slow request - changes nothing
 * rather than rewriting a quotation already in a client's hands.
 */

/** What every write refuses a draft with, where only generating it would make sense. */
const DRAFT_NOT_GENERATED = "This quotation is still a draft. Open it and press Generate Quotation first.";
const DRAFT_ALREADY_GENERATED = "This quotation has already been generated, so it is no longer a draft. Edit it from the register to raise the next version.";
const DRAFT_UNOPENED = "Reopen this draft from the Draft tab and save it again.";
const DRAFT_CHANGED = "This draft was changed or generated somewhere else since you opened it. Close it and open it again from the Draft tab to carry on.";

/**
 * What a draft must hold before it is saved at all: the Assigned Branch, because the quotation
 * number is drawn from the brand and the branch on the first save and never changes after. Nothing
 * else is asked for - a draft is somewhere to stop half-way, and the rest is checked on Generate.
 */
function draftRefusal(parsed) {
  return String(parsed.sourceBranch || parsed.nearestBranch || "").trim()
    ? null
    : "Choose the Assigned Branch before saving the draft - the quotation number is drawn from it.";
}

/**
 * The answers to save, without the one field that is about the save rather than the quotation.
 *
 * `draftUpdatedAt` is the draft's `updatedAt` as the generator opened it, sent back so a save
 * written over somebody else's newer one is refused rather than silently undoing it. The schema
 * passes unknown fields through into the payload, so it is taken out here.
 */
function draftAnswers(parsed) {
  const { draftUpdatedAt, ...answers } = parsed;
  const opened = draftUpdatedAt ? new Date(draftUpdatedAt) : null;
  return { answers, openedAt: opened && !Number.isNaN(opened.getTime()) ? opened : null };
}

/** The draft named in the URL, if this caller may change it and it is still a draft. */
async function draftForWrite(req, res) {
  const draft = await scopedQuotation(req, req.params.id);
  if (!draft) {
    res.status(404).json({ message: "Quotation not found." });
    return null;
  }
  if (!isDraftQuotation(draft)) {
    res.status(409).json({ message: DRAFT_ALREADY_GENERATED });
    return null;
  }
  return draft;
}

/**
 * The brand and vertical the draft was numbered under, whatever the save says.
 *
 * Its number reads them (`DBS-QO-DD-…`), so a draft keeps the brand it was first saved with - the
 * generator locks the selector, and this is what makes that a rule, as it is for a later version.
 */
const lockedToDraft = (answers, draft) => ({
  ...answers,
  quotationBrand: draft.quotationBrand || quotationBrands.brandCodeOfPayload(draft.payload),
  vertical: draft.payload?.vertical || answers.vertical || null,
});

/**
 * Writes onto the draft only while it is still the draft the caller opened, and answers with the
 * row as saved - or null when it has since been generated, deleted or saved by somebody else.
 */
async function writeDraft(draft, openedAt, data) {
  const where = { id: draft.id, status: QUOTATION_STATUS.DRAFT, deletedAt: null, updatedAt: openedAt };
  const { count } = await prisma.salesQuotation.updateMany({ where, data });
  return count ? prisma.salesQuotation.findUnique({ where: { id: draft.id } }) : null;
}

/** A failed draft save, in the same words a failed Generate gives for the same refusal. */
function sendDraftSaveError(res, error, fallback) {
  if (error?.status) return res.status(error.status).json({ message: error.message });
  const refusal = quotationSaveRefusal(error);
  if (refusal) {
    // The code and the constraint, never the payload, which carries the client's own details.
    console.error(fallback, error.code, error.meta);
    return res.status(400).json({ message: refusal });
  }
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
}

/**
 * Preview: the client's copy of a quotation that has not been saved, so the studio can read it
 * before generating it.
 *
 * The generator's form as it stands - unsaved edits included - goes through exactly what a save
 * does to it (`quotationPayloadSchema`, then `quotationVersionColumns` for the brand snapshot, the
 * logo, the name) and comes back exactly as the client's page receives a version
 * (`clientFacingQuotation`, the brand's presentation, whether a payment page exists) - but nothing
 * is written. No row, no quotation number, no version, no link: the version below lives only in
 * this response, so opening a preview a hundred times changes nothing in the register.
 *
 * Behind the screen's own guard (`SALES / Quotation Management`, READ_WRITE as a POST), the one
 * that saves the quotation it previews. An incomplete quotation previews as far as it goes, the way
 * a draft saves: only the figures' own rules refuse.
 */
async function previewQuotation(req, res) {
  const parsed = parseQuotationPayload(req, res);
  if (!parsed) return;
  try {
    const columns = await quotationVersionColumns(parsed);
    const now = new Date();
    const row = {
      ...columns,
      id: null,
      quotationNumber: null,
      version: null,
      // Not a quotation yet: it is given its number when it is generated.
      quotationId: "Preview",
      publicToken: null,
      status: QUOTATION_STATUS.DRAFT,
      quotationDate: now,
      createdAt: now,
      updatedAt: now,
      linkExpiresAt: null,
      deletedAt: null,
    };
    const [brandSnapshot, paymentDetails] = await Promise.all([
      quotationBrands.presentationForQuotation(row),
      quotationBrands.paymentDetailsForQuotation(row),
    ]);
    // A preview is not a link: nothing to download, no expiry, and no public path to reach.
    const { publicPath: _path, ...shown } = serializeQuotation(row);
    return res.json({ data: { ...clientFacingQuotation({ ...shown, brandSnapshot, allowClientDownload: false, paymentDetailsAvailable: Boolean(paymentDetails) }), preview: true } });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to preview quotation:", error);
    return res.status(500).json({ message: "Unable to preview the quotation." });
  }
}

/** Save Draft on a new quotation: version 01 of a new chain, kept as a draft. */
async function createQuotationDraft(req, res) {
  const parsed = parseQuotationPayload(req, res);
  if (!parsed) return;
  const { answers } = draftAnswers(parsed);
  const missing = draftRefusal(answers);
  if (missing) return res.status(400).json({ message: missing });
  try {
    const people = parsed.sharedEmployeeIds ? await quotationShares.shareablePeople(parsed.sharedEmployeeIds) : null;
    const quotation = await insertQuotationVersion(
      async () => nextQuotationChainNumber(answers),
      answers,
      Number(req.user?.id) || null,
      { draft: true },
    );
    await applyQuotationShares(req, quotation, people);
    return res.status(201).json({ data: serializeQuotation(quotation) });
  } catch (error) {
    return sendDraftSaveError(res, error, "Unable to save the draft.");
  }
}

/** Save Draft on a draft: the same row, same number, rewritten with what is on screen now. */
async function updateQuotationDraft(req, res) {
  const parsed = parseQuotationPayload(req, res);
  if (!parsed) return;
  const { answers, openedAt } = draftAnswers(parsed);
  // Without the version it was opened at, a save could not tell whether it is overwriting a newer one.
  if (!openedAt) return res.status(400).json({ message: DRAFT_UNOPENED });
  const missing = draftRefusal(answers);
  if (missing) return res.status(400).json({ message: missing });
  try {
    const people = parsed.sharedEmployeeIds ? await quotationShares.shareablePeople(parsed.sharedEmployeeIds) : null;
    const draft = await draftForWrite(req, res);
    if (!draft) return undefined;
    const saved = await writeDraft(draft, openedAt, await quotationVersionColumns(lockedToDraft(answers, draft)));
    if (!saved) return res.status(409).json({ message: DRAFT_CHANGED });
    await applyQuotationShares(req, saved, people);
    return res.json({ data: serializeQuotation(saved) });
  } catch (error) {
    return sendDraftSaveError(res, error, "Unable to save the draft.");
  }
}

/**
 * Generate Quotation on a draft: the draft becomes a generated version in place.
 *
 * Same row, same number, same token - the quotation the studio has been calling by that number
 * is the one the client now receives. Checked as a new quotation is (every line one the brand
 * still offers), stamped with today's logo and brand snapshot, dated now, and its link opens for
 * five days from this moment. From here it is a generated version like any other.
 */
async function generateQuotationDraft(req, res) {
  const parsed = parseQuotationPayload(req, res);
  if (!parsed) return;
  const { answers, openedAt } = draftAnswers(parsed);
  if (!openedAt) return res.status(400).json({ message: DRAFT_UNOPENED });
  // The branch the number was drawn from cannot be emptied on the way out either.
  const missing = draftRefusal(answers);
  if (missing) return res.status(400).json({ message: missing });
  try {
    const people = parsed.sharedEmployeeIds ? await quotationShares.shareablePeople(parsed.sharedEmployeeIds) : null;
    const draft = await draftForWrite(req, res);
    if (!draft) return undefined;
    const withBrand = lockedToDraft(answers, draft);
    await quotationBrands.assertNewSelectionsOffered(withBrand, null);
    const now = new Date();
    const saved = await writeDraft(draft, openedAt, {
      ...(await quotationVersionColumns(withBrand)),
      status: QUOTATION_STATUS.GENERATED,
      quotationDate: now,
      linkExpiresAt: quotationLinkExpiry(now),
    });
    if (!saved) return res.status(409).json({ message: DRAFT_CHANGED });
    await applyQuotationShares(req, saved, people);
    return res.json({ data: serializeQuotation(saved) });
  } catch (error) {
    return sendDraftSaveError(res, error, "Unable to generate the quotation.");
  }
}

/**
 * Re-enables a version's public link for another five days.
 *
 * The same link rather than a new one: the client already has the URL, and handing them a second
 * one for the same document is how two people end up reading different pages. Renewing a link
 * that has not lapsed yet is allowed and simply restarts its five days.
 */
async function renewQuotationLink(req, res) {
  try {
    const quotation = await scopedQuotation(req, req.params.id);
    if (!quotation) return res.status(404).json({ message: "Quotation not found." });
    // A draft's link starts its five days when the draft is generated, and not before.
    if (isDraftQuotation(quotation)) return res.status(409).json({ message: DRAFT_NOT_GENERATED });
    const now = new Date();
    const updated = await prisma.salesQuotation.update({
      where: { id: quotation.id },
      data: { linkExpiresAt: quotationLinkExpiry(now), linkRenewedAt: now },
    });
    return res.json({ message: "Quotation link re-enabled for 5 days.", data: serializeQuotation(updated) });
  } catch (error) {
    console.error("Unable to re-enable the quotation link:", error);
    return res.status(500).json({ message: "Unable to re-enable the quotation link." });
  }
}

const FINALIZED_DELETE_REFUSAL = "A finalized quotation cannot be deleted. Unfinalize it first.";

/**
 * Finalize: the version open in the generator becomes the finalized one - locked, its link open for
 * good. No version is raised and nothing in the document is touched.
 *
 * Refused for a draft (nothing has been sent), for a version that is not its chain's current one
 * (what the client has is the latest), and for a version whose link has lapsed - a lapsed link is
 * reopened by Re-enable, the explicit and permissioned way back, never as a side effect of this. When
 * the generator sends what it has on screen (`payload`) and that differs from the saved version, it
 * is refused too: what would be finalized is not what the person is looking at, so they save it as a
 * new version first.
 *
 * Idempotent and safe under a double press: one conditional update takes it; a second finds it
 * already finalized and answers with it unchanged. Run Serializable, re-checking that no later version
 * was raised meanwhile - with `createQuotationVersion` checking the other way, one of the two wins.
 */
async function finalizeQuotation(req, res) {
  try {
    const quotation = await scopedQuotation(req, req.params.id);
    if (!quotation) return res.status(404).json({ message: "Quotation not found." });
    if (isDraftQuotation(quotation)) return res.status(409).json({ message: DRAFT_NOT_GENERATED });
    if (isFinalizedQuotation(quotation)) return res.json({ message: "This quotation is already finalized.", data: serializeQuotation(await withFinalizationNames(quotation)), unchanged: true });
    if (quotationLinkState(quotation).linkExpired) return res.status(409).json({ message: "This version's link has expired. Re-enable the link first, then finalize it." });
    if (req.body?.payload !== undefined) {
      const parsed = quotationPayloadSchema.safeParse(req.body.payload);
      // What is on screen is not a quotation that could be saved: it cannot be what was saved either.
      if (!parsed.success) return res.status(409).json({ message: FINALIZE_UNSAVED });
      const onScreen = await quotationVersionColumns({ ...parsed.data, quotationBrand: quotation.quotationBrand || quotationBrands.brandCodeOfPayload(quotation.payload), vertical: quotation.payload?.vertical || parsed.data.vertical || null });
      if (documentAnswers(onScreen) !== documentAnswers(quotation)) return res.status(409).json({ message: FINALIZE_UNSAVED });
    }
    const now = new Date();
    const userId = Number(req.user?.id) || null;
    /*
     * One finalized version per quotation, and never by unfinalizing another: the quotation's
     * versions are locked `FOR UPDATE`, and if a *different* version is finalized the request is
     * refused and nothing is written. Two finalizes of two versions at once take turns on the lock,
     * so only the first succeeds; the unique `finalized_chain_key` refuses a second one even so.
     * Only this version's row is written.
     */
    const taken = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sales_quotation WHERE quotation_number = ${quotation.quotationNumber} FOR UPDATE`;
      const other = await tx.salesQuotation.findFirst({ where: { quotationNumber: quotation.quotationNumber, deletedAt: null, id: { not: quotation.id }, finalizedAt: { not: null }, unfinalizedAt: null }, select: { id: true } });
      if (other) throw Object.assign(new Error(ANOTHER_FINALIZED), { status: 409 });
      const { count } = await tx.salesQuotation.updateMany({
        where: { id: quotation.id, deletedAt: null, OR: [{ finalizedAt: null }, { unfinalizedAt: { not: null } }] },
        data: { finalizedAt: now, finalizedByUserId: userId, unfinalizedAt: null, unfinalizedByUserId: null },
      });
      return count;
    }, { timeout: 20000 });
    const fresh = await withFinalizationNames(await prisma.salesQuotation.findUnique({ where: { id: quotation.id } }));
    return res.json({ message: taken ? "Quotation finalized. Its link no longer expires." : "This quotation is already finalized.", data: serializeQuotation(fresh), ...(taken ? {} : { unchanged: true }) });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    // The database's own guard: another version was finalized at the same moment.
    if (error?.code === "P2002") return res.status(409).json({ message: ANOTHER_FINALIZED });
    if (error?.code === "P2034") return res.status(409).json({ message: "This quotation was changed at the same moment. Please try again." });
    console.error("Unable to finalize the quotation:", error);
    return res.status(500).json({ message: "Unable to finalize the quotation." });
  }
}

/**
 * Unfinalize: the version stays exactly as it was finalized, and is marked previously finalized. Its
 * link goes back on a five-day clock from now - neither cut off at once nor open for good - and the
 * chain is open again, so the next edit raises the next version as always. No version is raised.
 * Idempotent: a version that is not finalized answers with itself unchanged.
 */
async function unfinalizeQuotation(req, res) {
  try {
    const quotation = await scopedQuotation(req, req.params.id);
    if (!quotation) return res.status(404).json({ message: "Quotation not found." });
    /*
     * A version a project has published Sale Extras onto stays finalized: the revisions are measured
     * from it and the client's link shows them on it. Drafts alone do not hold it. Checked under a
     * lock on the version, which publishing takes too.
     */
    const now = new Date();
    // The check and the write are one step under the version's lock, which publishing takes too.
    const { count, heldByExtras } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sales_quotation WHERE id = ${quotation.id} FOR UPDATE`;
      if (await tx.projectSaleExtraRevision.count({ where: { salesQuotationId: quotation.id } })) return { count: 0, heldByExtras: true };
      const written = await tx.salesQuotation.updateMany({
        where: { id: quotation.id, deletedAt: null, finalizedAt: { not: null }, unfinalizedAt: null },
        data: { unfinalizedAt: now, unfinalizedByUserId: Number(req.user?.id) || null, linkExpiresAt: quotationLinkExpiry(now) },
      });
      return { count: written.count, heldByExtras: false };
    });
    if (heldByExtras) {
      return res.status(409).json({ message: "This quotation has published extras on its project. Unfinalizing it would leave the client's quotation inconsistent with what has been published, so it cannot be unfinalized." });
    }
    const fresh = await withFinalizationNames(await prisma.salesQuotation.findUnique({ where: { id: quotation.id } }));
    return res.json({ message: count ? "Version unfinalized. It is kept exactly as it was and can be edited again; saving raises a new version." : "This version is not finalized.", data: serializeQuotation(fresh), ...(count ? {} : { unchanged: true }) });
  } catch (error) {
    console.error("Unable to unfinalize the quotation:", error);
    return res.status(500).json({ message: "Unable to unfinalize the quotation." });
  }
}

const FINALIZE_UNSAVED = "You have changes that are not saved. Save them as a new version first, then finalize that version.";

/**
 * Deleting one version of a quotation, as the row menu's Delete does it. Earlier versions of the
 * chain are kept; the bulk delete takes the whole chain - see `deleteQuotationChainRecord`.
 *
 * `scopedQuotation` is what narrows the id to one this caller may touch.
 */
async function deleteQuotationRecord(req, id) {
  const quotation = await scopedQuotation(req, id);
  if (!quotation) throw new Error("Quotation not found.");
  if (isFinalizedQuotation(quotation)) throw Object.assign(new Error(FINALIZED_DELETE_REFUSAL), { status: 409 });
  await prisma.salesQuotation.update({ where: { id }, data: { deletedAt: new Date() } });
  return { id };
}

/**
 * Deleting a whole quotation - every live version of its chain - as the register's bulk delete does.
 *
 * A register row is a chain, and its id is the chain's current version. Deleting only that version,
 * as the row menu does, brings the chain straight back as its previous version, so a register of
 * nine ticked and deleted still read nine. The tick boxes mean the rows themselves.
 *
 * The id must still be the chain's **current** version: a version raised since the register was
 * read is one the reader never saw, and is not deleted on their behalf. Every version is put through
 * `scopedQuotation`, and one the caller may not change refuses the whole chain rather than leaving
 * half of it. Throws rather than answering, so the bulk runner counts it.
 */
async function deleteQuotationChainRecord(req, id) {
  const current = await scopedQuotation(req, id);
  if (!current) throw new Error("Quotation not found.");
  const versions = await prisma.salesQuotation.findMany({
    where: { quotationNumber: current.quotationNumber, deletedAt: null },
    select: { id: true, version: true },
  });
  if (versions.some((version) => version.version > current.version)) throw new Error("Quotation has a newer version.");
  if (await chainIsFinalized(current.quotationNumber)) throw new Error(FINALIZED_DELETE_REFUSAL);
  const reachable = await Promise.all(versions.map((version) => (version.id === current.id ? current : scopedQuotation(req, version.id))));
  if (reachable.some((version) => !version)) throw new Error("Quotation not found.");
  await prisma.salesQuotation.updateMany({
    where: { id: { in: versions.map((version) => version.id) }, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return { id };
}

async function deleteQuotation(req, res) {
  try {
    await deleteQuotationRecord(req, req.params.id);
    return res.status(204).send();
  } catch (error) {
    if (error?.message === "Quotation not found.") return res.status(404).json({ message: error.message });
    if (error?.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to delete quotation:", error);
    return res.status(500).json({ message: "Unable to delete quotation." });
  }
}

/**
 * The quotation behind a public link, if the link is still open.
 *
 * An expired link answers 410 rather than 404: the client is not looking at a wrong address, they
 * are looking at one that has lapsed, and the page tells them so and says who to ask.
 */
/**
 * The answer every public quotation endpoint gives a link that has lapsed: the 410 it always was,
 * and nothing about the quotation (`expiredLink`) - not whose it was, not when it lapsed.
 */
function sendQuotationExpired(res) {
  return res.status(410).json({ message: EXPIRED_LINK_MESSAGE, expiredLink: expiredLink() });
}

/**
 * A quotation as the client is sent it: the rupees the discount came to, and no percentage at all.
 *
 * The client's page prints the discount as an amount (`quotationDiscountBreakdown`), and the record
 * behind it must not carry what the page leaves out - a client reading the response would otherwise
 * find the share of the price the studio took off. So the quotation's own percentage (the `discount`
 * column, and `discount` in its payload) goes, and so does every default discount rate riding along
 * in a snapshot (`defaultDiscountPercent`, on the brand and the studio's rates). In its place the
 * payload always holds `discountAmount`: as saved, or - for a quotation saved before it was - worked
 * out from the percentage exactly as the page used to, so an old quotation prints the same rupees.
 */
// Any field that could say the percentage, by any spelling - `discount` itself, `defaultDiscountPercent`,
// `discountPercentage`, `discountPct`, `discountRate` - wherever it sits in the record.
const CLIENT_HIDDEN_DISCOUNT_KEY = /^discount$|discount.*(percent|pct|rate)/i;

function clientFacingQuotation(data) {
  const payload = data.payload && typeof data.payload === "object" ? data.payload : {};
  const number = (value) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));
  const percent = Math.min(100, Math.max(0, number(payload.discount) ?? number(data.discount) ?? 0));
  const cost = (number(payload.subtotal) ?? number(data.subtotal) ?? 0) + Math.max(0, number(payload.performanceCost) ?? 0);
  const saved = number(payload.discountAmount);
  const discountAmount = saved ?? (percent > 0 ? Math.round(cost * (percent / 100)) : 0);
  const withoutRates = (value) => {
    if (Array.isArray(value)) return value.map(withoutRates);
    if (!value || typeof value !== "object" || value instanceof Date) return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !CLIENT_HIDDEN_DISCOUNT_KEY.test(key)).map(([key, entry]) => [key, withoutRates(entry)]));
  };
  // The Round Off Discount is folded into the total and never shown to the client, so it is not sent.
  const { discount: _payloadPercent, roundOffDiscount: _roundOff, ...rest } = payload;
  // Who finalized or unfinalized it is the studio's business; the client is told only that the link holds.
  const { discount: _percent, finalization: _finalization, finalizedChainKey: _chainKey, finalizedByUserId: _by, unfinalizedByUserId: _unBy, unfinalizedAt: _unAt, finalizedByUser: _byUser, unfinalizedByUser: _unByUser, ...quotation } = data;
  return withoutRates({ ...quotation, payload: { ...rest, discountAmount } });
}

async function publicQuotation(req, res) {
  try {
    const token = String(req.params.token || "").trim();
    if (!/^[A-Za-z0-9_-]{8}$/.test(token)) return res.status(404).json({ message: "Quotation not found." });
    const quotation = await prisma.salesQuotation.findUnique({ where: { publicToken: token } });
    // A draft is not there at all to a client - not "expired", which would say it was once sent.
    if (!quotation || quotation.deletedAt || isDraftQuotation(quotation)) return res.status(404).json({ message: "Quotation not found." });
    // A lapsed link stays lapsed, except for the PDF renderer printing a client portal download,
    // which carries a one-time pass for exactly this quotation (`services/quotationPrintPass.js`).
    if (quotationLinkState(quotation).linkExpired && !hasPrintPass(req, token)) {
      return sendQuotationExpired(res);
    }
    /*
     * What the page prints beyond the rows - the brand's wording and pictures, the studio's name,
     * the branch's website - resolved once here: the version's own snapshot, with today's answer
     * only where a snapshot older than this shape is silent. See `presentationForQuotation`.
     */
    /*
     * Three independent reads, together rather than in turn. Beside the presentation:
     *
     * Whether this client may save the quotation as a file - the brand's own answer, read live.
     * The page hides its download control without it, and `publicQuotationPdf` refuses the request
     * behind it, so the control is a courtesy rather than the protection.
     *
     * And whether there is a payment page to link to: the Assigned Branch holds some way to be
     * paid. The details themselves are served by `GET /:token/payment` and never ride on the
     * record; this only decides whether the pricing card prints **For Payment**. False on a branch
     * the register cannot place, so the quotation opens exactly as it always has.
     */
    /*
     * And the project's latest published Sale Extras revision on this exact finalized version
     * (`sale-extras/totals.js`), added after `clientFacingQuotation` - whose key-stripping is for the
     * quotation's own fields - and only when there is one, so a quotation without extras answers
     * exactly as it always has.
     */
    const [brandSnapshot, allowClientDownload, paymentDetails, saleExtras] = await Promise.all([
      quotationBrands.presentationForQuotation(quotation),
      quotationBrands.allowsClientDownload(quotation),
      quotationBrands.paymentDetailsForQuotation(quotation),
      saleExtrasTotals.publicSaleExtrasFor(quotation),
    ]);
    const data = clientFacingQuotation({ ...serializeQuotation(quotation), brandSnapshot, allowClientDownload, paymentDetailsAvailable: Boolean(paymentDetails) });
    return res.json({ data: saleExtras ? { ...data, saleExtras } : data });
  } catch (error) {
    console.error("Unable to load public quotation:", error);
    return res.status(500).json({ message: "Unable to load quotation." });
  }
}

/** Renders one version and answers with the file. Shared by the client's routes (the link and the client portal) and the studio's. */
async function sendQuotationPdf(res, quotation, renderOptions = {}) {
  const { renderQuotationPdf } = require("../../../services/quotationPdfService");
  const pdf = await renderQuotationPdf(quotation.publicToken, renderOptions);

  // Named for the version rather than the token, so a client who saves several can tell them
  // apart in a downloads folder - and can tell v1 from v2 of the same quotation.
  const fileName = `${quotation.quotationId || quotation.quotationNumber || "quotation"}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Content-Length", pdf.length);
  return res.end(pdf);
}

/*
 * The same quotation as a PDF, rendered from the page the client would otherwise read online.
 *
 * The token is checked against the database before a browser is started: rendering is expensive,
 * and an unknown or lapsed token should cost a lookup rather than a page load.
 *
 * And then the brand is asked whether this client may have the file at all. Hiding the control on
 * the page is not the protection - the address is in the page's own markup and a client who saved
 * it once keeps it - so the refusal is here, live off the brand, and a brand switched back to No
 * stops serving the links it has already sent. The studio's own download goes through
 * `quotationPdf` below, which is signed in and not governed by this.
 */
async function publicQuotationPdf(req, res) {
  const token = String(req.params.token || "").trim();
  if (!/^[A-Za-z0-9_-]{8}$/.test(token)) return res.status(404).json({ message: "Quotation not found." });
  // The page's Download points the browser here as a page load: a refusal sends it back to the
  // quotation (which then shows its own expired or not-found page where that is the reason)
  // rather than replacing the quotation with JSON. A fetch keeps the JSON answers below.
  const page = wantsPage(req);
  const { frontendOrigin } = require("../../../services/quotationPdfService");
  // A refusal sent back as a page redirect is still a miss to the link limiter, which would
  // otherwise read the 303 as success and let guesses through for free.
  const refuse = (status, body, send = () => res.status(status).json(body)) => {
    res.locals.linkMiss = true;
    return page ? backToPage(res, `${frontendOrigin()}/q/${token}`) : send();
  };
  try {
    const quotation = await prisma.salesQuotation.findUnique({ where: { publicToken: token } });
    if (!quotation || quotation.deletedAt || isDraftQuotation(quotation)) return refuse(404, { message: "Quotation not found." });
    if (quotationLinkState(quotation).linkExpired) {
      return refuse(410, null, () => sendQuotationExpired(res));
    }
    if (!(await quotationBrands.allowsClientDownload(quotation))) {
      return refuse(403, { message: "This quotation is available to read online only. Please contact your Don't Blink Studioz representative for a copy." });
    }

    return await sendQuotationPdf(res, quotation);
  } catch (error) {
    console.error("Unable to render quotation PDF:", error);
    if (res.headersSent) return undefined;
    return refuse(500, { message: "Unable to build the quotation PDF." });
  }
}

/**
 * The studio's own copy of a version, for whoever may read the quotation register.
 *
 * The same file, by quotation id and behind the login, because Allow Client Download is a decision
 * about the *client's* copy: a salesperson sending the proposal on by email must still be able to
 * save it from a brand that does not let its clients. Scoped like every other read here, so a
 * quotation the caller may not reach answers 404 rather than a file.
 *
 * A lapsed link still refuses, as it always has on this file: the renderer prints the public page,
 * and that page has nothing to print once the link has run out. Re-enable the link and download.
 */
async function quotationPdf(req, res) {
  try {
    const quotation = await scopedQuotation(req, req.params.id);
    if (!quotation) return res.status(404).json({ message: "Quotation not found." });
    if (isDraftQuotation(quotation)) return res.status(409).json({ message: DRAFT_NOT_GENERATED });
    if (!quotation.publicToken) return res.status(409).json({ message: "This quotation has no link to render from yet." });
    if (quotationLinkState(quotation).linkExpired) {
      return res.status(410).json({ message: "This quotation's link has expired. Re-enable it to download the PDF." });
    }
    return await sendQuotationPdf(res, quotation);
  } catch (error) {
    console.error("Unable to render quotation PDF:", error);
    return res.status(500).json({ message: "Unable to build the quotation PDF." });
  }
}

async function listSourceBranches(req, res) {
  try {
    const branches = await sourceBranchOptions(prisma, req.user.id, SOURCE_BRANCH_READERS);
    return res.json({ data: branches.map((name) => ({ name, value: name })) });
  } catch (error) {
    console.error("Unable to load source branches:", error);
    return res.status(500).json({ message: "Unable to load source branches." });
  }
}

async function listCrmEmployees(req, res) {
  try {
    const data = await salesEmployees({
      select: { id: true, employeeId: true, employeeName: true, department: true, designation: true, emailId: true, workEmailId: true, profilePhotoUrl: true },
    });
    return res.json({ data: data.map((row) => ({ ...row, profilePhotoUrl: listPhotoUrl(row.profilePhotoUrl) })) });
  } catch (error) {
    console.error("Unable to load SALES employees:", error);
    return res.status(500).json({ message: "Unable to load SALES employees." });
  }
}

/**
 * The working employees a picker offers, with their photos through `listPhotoUrl`.
 *
 * One list for every picker on this router - whoever is invited to a meeting, whoever a quotation
 * is shared with - so two screens cannot come to disagree about who is still at the studio.
 * Emails are included so anywhere that invites somebody can do it without a second lookup.
 */
async function salesEmployeeOptions() {
  const rows = await prisma.employee.findMany({
    where: { archivedAt: null, employmentStatus: { in: await workingEmployeeStatuses() } },
    select: { id: true, employeeId: true, employeeName: true, department: true, designation: true, employmentStatus: true, emailId: true, workEmailId: true, profilePhotoUrl: true },
    orderBy: { employeeName: "asc" },
  });
  return rows.map((row) => ({ ...row, profilePhotoUrl: listPhotoUrl(row.profilePhotoUrl) }));
}

async function listActiveEmployees(req, res) {
  try {
    return res.json({ data: await salesEmployeeOptions() });
  } catch (error) {
    console.error("Unable to load active employee options:", error);
    return res.status(500).json({ message: "Unable to load active employee options." });
  }
}

/*
 * ── Importing bookings from a spreadsheet ─────────────────────────────────────────────────────
 *
 * A booking - the record Sales Manager calls a booking and Project Management calls a project - as
 * far as a spreadsheet can carry one. Its shoots are not here: a shoot is a row of its own with its
 * own services and deliverables, and flattening a variable number of them into one line is how a
 * template becomes unusable. They are added to the project afterwards, which is where the form adds
 * them too.
 *
 * The WhatsApp group name is taken as written rather than claimed from the generator. A generated
 * name is held for one project and consumed by it, and an import has no way to say which held name
 * a row meant - so an imported booking carries its name and leaves the generator's rows alone.
 */
const PROJECT_IMPORT_COLUMNS = [
  { field: "enquiryId", label: "Enquiry ID", required: true },
  { field: "whatsappGroupName", label: "WhatsApp Group Name", required: true },
  { field: "clientMainNumber", label: "Client Main Number", required: true },
  { field: "sourceBranch", label: "Source Branch", required: true },
  { field: "initialConvertedValue", label: "Initial Converted Value", required: true },
  { field: "vertical", label: "Vertical" },
  { field: "mainEventDate", label: "Main Event Date" },
  { field: "deliverables", label: "Deliverables" },
  { field: "deliverablesDetails", label: "Deliverables Details" },
  { field: "salesPreProductionRemarks", label: "Sales Pre Production Remarks" },
  { field: "salesProductionRemarks", label: "Sales Production Remarks" },
  { field: "salesPostProductionRemarks", label: "Sales Post Production Remarks" },
];

/*
 * A file's row as `projectSchema` expects it.
 *
 * Two shapes a spreadsheet cannot hold directly. `mainEventDateKnown` is a checkbox on the form and
 * is simply whether a date was given here. `shoots` is required by the schema as an array and is
 * always empty on an import - see above.
 */
const projectImportInput = z.object({}).passthrough().transform((row) => ({
  ...row,
  shoots: [],
  mainEventDateKnown: Boolean(row.mainEventDate),
})).pipe(projectSchema);

async function projectImportTemplate(req, res) {
  return res.json({ data: { columns: templateHeaders(PROJECT_IMPORT_COLUMNS) } });
}

async function importProjects(req, res) {
  try {
    const data = await importTableRows({
      headers: req.body?.headers,
      rows: req.body?.rows,
      startRow: Number(req.body?.startRow) || 2,
      columns: PROJECT_IMPORT_COLUMNS,
      schema: projectImportInput,
      create: async (input) => {
        const clientMainNumber = normalizeClientMainNumber(input.clientMainNumber);
        if (!clientMainNumber) throw new Error("Client Main Number must include a country code and exactly 10 digits.");
        await prisma.$transaction(async (transaction) => {
          const { shoots, quotationId, ...raw } = input;
          // Filled before anything reads it, so the row and its identifier cannot disagree.
          const projectData = withInferredVertical(raw);
          // The same branch check a typed project answers to: an import must not be a way to file a
          // booking against a branch this person's roles do not reach.
          await validateProjectPayload(transaction, projectData, { userId: req.user.id });
          const creator = await resolveAuthenticatedCreator(transaction, req);
          const refs = await referenceLookups();
          await transaction.salesProject.create({
            data: {
              ...projectData,
              branchId: refs.branchId(projectData.sourceBranch),
              verticalId: refs.verticalId(projectData.vertical),
              eventId: await nextEventId(transaction, projectData),
              whatsappGroupNameId: null,
              clientMainNumber,
              mainEventDate: projectData.mainEventDateKnown ? projectData.mainEventDate : null,
              crmName: creator.crmName,
              crmEmployeeId: creator.crmEmployeeId,
              groupNameGeneratorJson: null,
              createdByUserId: req.user.id,
            },
          });
        });
      },
    });
    return res.json({ data });
  } catch (error) {
    if (error?.status === 400) return res.status(400).json({ message: error.message });
    console.error("Unable to import projects:", error);
    return res.status(500).json({ message: "Unable to import projects." });
  }
}

/**
 * The advance a project is booked with.
 *
 * ── Why this is here and not on the Accounts route ───────────────────────────────────────────
 *
 * It is a cash entry and it is written by the Accounts module's own `recordCashEntry`, so the row,
 * its validation and its branch check are the ones Accounts applies to everything else. What
 * differs is who may write *this* one.
 *
 * `POST /api/accounts/cash-entries` is behind `ACCOUNTS / Cash Management`, which is the right guard
 * for the cash book: somebody who may record any entry against any project is being trusted with the
 * studio's books. But the person booking a project is not asking for that. They are typing the
 * amount the client just handed over, against the project they are creating, in the form that
 * creates it - and requiring the whole of Accounts for that meant either handing out the books or
 * booking projects with the advance left off and typed in later by somebody else.
 *
 * So the *act* keeps its own guard: this route answers to `SALES / Sales Manager`, the same
 * permission that just created the project, and nothing else about Accounts moves. `hrm/payment-
 * requests` already writes a cash entry this way under its own permission, which is the pattern.
 *
 * Narrow on purpose. It takes the project from the URL rather than the body, so an advance can only
 * ever be filed against a project this caller can reach; `enforceBranchReach` stays on, so it cannot
 * be filed into a branch they do not reach; and it is money **in** - `entryType` is forced, so this
 * cannot become a way to record studio spending without the permission for it.
 */
/**
 * The two lists the booking advance's own dropdowns need: who received the money, and which studio
 * account it landed in.
 *
 * ── Why not the Accounts options endpoint ────────────────────────────────────────────────────
 *
 * Because that one is behind `ACCOUNTS / Cash Management` like the rest of its router, so the moment
 * Payment Received was shown to whoever may book a project, the Receiver dropdown came back empty
 * for exactly those people - a required field with nothing in it, which stopped the project being
 * created at all. Worse than before the section was shown to them.
 *
 * Deliberately narrower than the Accounts one, which also returns every project and every shoot in
 * the studio for its own pickers. The advance needs neither - it is filed against the project being
 * created, from the URL - so those lists are not served here. Widening a permission is not a reason
 * to hand over everything the other screen happens to read.
 */
async function projectAdvanceOptions(req, res) {
  try {
    const [employees, accounts] = await Promise.all([
      prisma.employee.findMany({
        where: { archivedAt: null, employmentStatus: { in: await workingEmployeeStatuses() } },
        orderBy: { employeeName: "asc" },
        select: { id: true, employeeId: true, employeeName: true, profilePhotoUrl: true },
      }),
      /*
       * The studio's accounts, from the branch register - the one place they are kept since the
       * Accounts module's own bank-account list was retired. The label is the value stored on the
       * record, so it is built in `services/branchBankAccounts.js` and nowhere else.
       */
      receivedIntoOptions(),
    ]);
    // The same shape the advance form already reads off the Accounts options, so the panel needs no
    // second way of understanding an answer.
    // Already the labels the form offers and the record keeps - see `receivedIntoOptions`.
    return res.json({ data: { employees: employees.map((row) => ({ ...row, profilePhotoUrl: listPhotoUrl(row.profilePhotoUrl) })), accounts } });
  } catch (error) {
    console.error("Unable to load the advance options:", error);
    return res.status(500).json({ message: "Unable to load the advance options." });
  }
}

async function recordProjectAdvance(req, res) {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ message: "A project id is required." });
  try {
    /*
     * Through the caller's own data scope, like every other read of a project by id in this file.
     *
     * It used to be `findFirst({ where: { id, deletedAt: null } })` - any id, no question asked -
     * while the comment above claimed an advance "can only ever be filed against a project this
     * caller can reach". Taking the id from the URL rather than the body is not a reachability
     * check: it only says *which* id, not *whose*. So a holder of `SALES / Sales Manager`
     * `READ_WRITE` could post an advance against a project belonging to somebody else - a Received
     * cash entry on their Payments tab, in the Accounts cash book, moving their outstanding balance -
     * and the 404-versus-201 split was an oracle for whether a project id exists.
     *
     * `forWrite` because this writes: it must not be reachable through the read-only half of
     * `PROJECT / Show All Projects`.
     */
    const project = await prisma.salesProject.findFirst({
      where: { id, deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id), forWrite: true })] },
      select: { id: true },
    });
    if (!project) return res.status(404).json({ message: "That project could not be found." });

    const actorId = Number(req.user.id) || null;
    const { settles: settlesBody, ...body } = req.body || {};
    const settles = settlesBody ? cashSettlesSchema.safeParse(settlesBody) : null;
    if (settles && !settles.success) return res.status(400).json({ message: settles.error.issues[0]?.message || "Check which payment this settles." });
    const entry = {
      ...body,
      // From the URL, never the body: the advance belongs to the project that was just created.
      projectId: project.id,
      // Money in. A booking advance is a receipt, and forcing it here is what stops this route
      // being a way to record an expense without `ACCOUNTS / Cash Management`.
      entryType: "Received",
    };
    // Tied to the schedule saved with the booking, through Accounts' own rule: full clears that
    // payment, partial splits the rest off with its due date. The payment must be this project's.
    const created = await prisma.$transaction((tx) => (settles
      ? settleScheduledPayment(tx, settles.data.paymentScheduleId, { ...settles.data, projectId: project.id }, entry, actorId, { schema: cashFormEntrySchema })
      : recordCashEntry(entry, actorId, tx, { enforceBranchReach: true, schema: cashFormEntrySchema })));
    clientPush.notifyPaymentReceived(created);
    await logProjectActivity({ projectId: project.id, area: "PROJECT", action: "ADVANCE_RECORDED", detail: `Advance of ₹${created.amount} recorded (${created.entryId})`, userId: Number(req.user.id) });
    return res.status(201).json({ data: cashEntryRow(created) });
  } catch (error) {
    /*
     * Answered by the Accounts module's own reporter rather than by hand.
     *
     * `recordCashEntry` refuses a bad entry with `fieldErrors`, and a catch that checks `status`
     * first never looks at them - so the response carried "Validation failed" and nothing else, and
     * `validationDetail` on the booking panel had no field to name. That check is a two-line thing
     * to get subtly wrong, and it is already written once next door.
     */
    return handleCashEntryError(res, error, "Unable to record this advance.");
  }
}

/*
 * Create Project → Client Credentials: the client's own sign-in, made with the project.
 *
 * Read on its own rather than as a field of `projectSchema`, which the edit and import paths share -
 * a client login is made once, here, and never by an update or a sheet row. Only the generated
 * password is taken from the browser: the **username is the client's mobile number** - the project's
 * Client Main Number, its ten digits without the country code (`clientUsernameFor`) - so it is never
 * typed, and a username sent anyway is ignored. No email: a client signs in by username, and their
 * account holds no login email (NULL). What the account is: `role` CLIENT, no IAM roles, linked to
 * this project, and refused by `protect` everywhere but its own account.
 */
const clientLoginSchema = z.object({ temporaryPassword: generatedTemporaryPassword });

/**
 * A client's username: the ten digits of their mobile number, without the country code - what they
 * would type to sign in - or null for a number that is not a valid one. Held to the username rule
 * every login shares (`loginCredentials`), which ten digits always meet.
 */
function clientUsernameFor(clientMainNumber) {
  const normalized = normalizeClientMainNumber(clientMainNumber);
  if (!normalized) return null;
  const username = normalized.replace(/\D/g, "").slice(-10);
  return loginCredentialFields.username.safeParse(username).success && username.length === 10 ? username : null;
}

/**
 * The client login asked for, checked and with its password hashed, or `null` when none was.
 *
 * **On the booking's own permission.** It used to ask for `ADMIN / User Management` as well, on the
 * reading that making an account is User Management's act wherever it happens. That is true of a
 * *staff* account, which reaches the studio's own screens; a client login reaches one project's
 * portal and nothing else, and it is part of booking that project rather than an errand belonging
 * to somebody else. Asking for the admin permission meant the person booking could not finish the
 * booking: they filled the Client Credentials section in, pressed save, and the whole project was
 * refused with a 403 about a permission the Sales screen never mentions.
 *
 * So the guard on the route is the whole of it - `SALES / Sales Manager` here, and the project's
 * own editor on `POST /projects/:id/client-login`. Thrown errors carry their status for the route
 * to answer with.
 */
/**
 * The client login a mobile number already has, or null. One person, one login: a client who comes
 * back for another event keeps the login made with their first project, and reaches the new one
 * through the number (the client portal reads every project saved with it). Only a CLIENT account
 * counts - a staff username that happens to be the same ten digits is not this client's login.
 */
async function existingClientLoginFor(clientMainNumber) {
  const username = clientUsernameFor(clientMainNumber);
  if (!username) return null;
  const user = await prisma.user.findUnique({ where: { username }, select: { username: true, role: true, status: true, mustChangePassword: true } });
  return user && user.role === CLIENT_ROLE ? { username: user.username, active: user.status === "ACTIVE", passwordChanged: !user.mustChangePassword } : null;
}

async function clientLoginFor(req, { clientMainNumber } = {}) {
  const input = req.body?.clientLogin;
  if (input === undefined || input === null) return null;
  const parsed = clientLoginSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = { temporaryPassword: "Temporary Password" }[issue?.path?.[0]] || "Client Credentials";
    throw Object.assign(new Error(`Client Credentials - ${field}: ${issue?.message || "is not valid"}`), { status: 400 });
  }
  const username = clientUsernameFor(clientMainNumber);
  if (!username) throw Object.assign(new Error("Client Credentials - Username: Add the client's 10-digit mobile number as the Client Main Number first."), { status: 400 });
  // A returning client: their login already exists, so none is made - the project is saved without
  // its own, and the client sees it in the app through the number.
  if (await existingClientLoginFor(clientMainNumber)) return null;
  const taken = await takenLoginField({ username });
  // Only a staff username can hold the number here (a client's own login was taken care of above).
  if (taken === "username") throw Object.assign(new Error(`Client Credentials: The mobile number ${username} is already used as a login username.`), { status: 409 });
  return { username, passwordHash: await bcrypt.hash(parsed.data.temporaryPassword, 12) };
}

/**
 * The client's account itself, made for `project` - on Create Project inside the project's own
 * transaction, and from Edit Sale Details for a project booked without one. `role` is set here,
 * always: the column's default is SUPER_ADMIN. Made with `mustChangePassword`: the Beam Craft app asks
 * the client, on their first sign-in, to set their own in place of the one the studio sent
 * (`POST /api/user/change-password`, which clears it); Client Credentials shows which it is.
 */
function createClientLoginUser(client, project, clientLogin) {
  return client.user.create({
    data: {
      // The project's name, cut to fit `user.name` (191) - the group name may run to 500, and a
      // name too long for the column would otherwise refuse the save.
      name: String(project.whatsappGroupName || "Client").slice(0, 191),
      // No login email: a client signs in by username (`user.email` is nullable for this).
      email: null,
      username: clientLogin.username,
      password: clientLogin.passwordHash,
      role: CLIENT_ROLE,
      status: "ACTIVE",
      clientProjectId: project.id,
      branchId: project.branchId,
      mustChangePassword: true,
      whatsappRequired: false,
    },
    select: { id: true },
  });
}

/**
 * Edit Sale Details → Client Credentials: the login a project already has, if any - its username
 * and whether it is live. Never the password, which is held only as a hash.
 *
 * Read by whoever may read the project, which is what the route already asks for: the username is
 * the client's own mobile number, written on the booking a line above. It asked for
 * `ADMIN / User Management` until the booking's permission was made the whole of this.
 */
/**
 * Create Project → Client Credentials, asked as the number is typed: whether that mobile number
 * already has a client login (a returning client). The form then shows it instead of making a new one.
 */
async function getClientLoginByNumber(req, res) {
  try {
    return res.json({ data: await existingClientLoginFor(String(req.query.number || "")) });
  } catch (error) {
    console.error("Unable to look up the client login:", error);
    return res.status(500).json({ message: "Unable to look up the client login." });
  }
}

async function getClientLogin(req, res) {
  try {
    const project = await prisma.salesProject.findFirst({
      where: { id: String(req.params.id), deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id) })] },
      select: { clientMainNumber: true, clientLogin: { select: { username: true, status: true, mustChangePassword: true } } },
    });
    if (!project) return res.status(404).json({ message: "Project not found." });
    const login = project.clientLogin;
    // `passwordChanged`: the client has set their own password in the app, in place of the studio's.
    if (login) return res.json({ data: { username: login.username, active: login.status === "ACTIVE", passwordChanged: !login.mustChangePassword, shared: false } });
    // No login of its own: the client may already have one from an earlier event, which reaches this
    // project too (`shared`).
    const existing = await existingClientLoginFor(project.clientMainNumber);
    return res.json({ data: existing ? { ...existing, shared: true } : null });
  } catch (error) {
    console.error("Unable to read the client login:", error);
    return res.status(500).json({ message: "Unable to read the client login." });
  }
}

/**
 * Edit Sale Details → Client Credentials → Create Client Login: a login for a project booked
 * without one. The same checks as Create Project's (`clientLoginFor`: the username rule, the
 * generated password), on a project this caller may change; one login per project.
 *
 * Whoever may change the booking may give its client a login - the route's own guard
 * (`answersForAProject` plus `requireProjectEditor`) is the whole of it.
 */
async function createClientLogin(req, res) {
  try {
    const project = await prisma.salesProject.findFirst({
      where: { id: String(req.params.id), deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id), forWrite: true })] },
      select: { id: true, whatsappGroupName: true, branchId: true, clientMainNumber: true, clientLogin: { select: { id: true } } },
    });
    if (!project) return res.status(404).json({ message: "Project not found." });
    if (project.clientLogin) return res.status(409).json({ message: "Client Credentials: This project already has a client login." });
    // The project's own number as it is saved - a number changed on the form and not yet saved is not it.
    // A returning client already signs in with this number, and that login reaches this project too.
    const existing = await existingClientLoginFor(project.clientMainNumber);
    if (existing) return res.status(409).json({ message: `Client Credentials: This client already signs in with ${existing.username} - this project shows in their app.` });
    const clientLogin = await clientLoginFor(req, { clientMainNumber: project.clientMainNumber });
    if (!clientLogin) return res.status(400).json({ message: "Client Credentials: Generate the client's temporary password." });
    await createClientLoginUser(prisma, project, clientLogin);
    return res.status(201).json({ data: { username: clientLogin.username, projectName: project.whatsappGroupName } });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    // Taken between the check and the save - the username, or this project's one login.
    if (error.code === "P2002") return res.status(409).json({ message: "Client Credentials: That username was just taken, or the project was just given a login. Reload and try again." });
    console.error("Unable to create the client login:", error);
    return res.status(500).json({ message: "Unable to create the client login." });
  }
}

const clientLoginWhatsAppSchema = z.object({ message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) });

/**
 * Sends a client their login on WhatsApp, from the sender's own WhatsApp - the "Client Login Ready"
 * dialog's Send WhatsApp, the way an employee's new login is sent (`sendCredentialsWhatsApp`).
 *
 * The message comes from the dialog, because the temporary password is readable only there - the
 * server never sends one back. The **number** is not sent: it is read off the project, so this can
 * only reach that project's client, and only while the project has a live client login.
 *
 * On the booking's permission, like making the login itself: handing a client the credentials for
 * their own project is the last step of booking it, and the route is already narrowed to projects
 * this caller may reach (`projectAccessWhere` with `SALES / Sales Manager` below).
 */
async function sendClientLoginWhatsApp(req, res) {
  const parsed = clientLoginWhatsAppSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Write the message to send.", errors: parsed.error.flatten() });
  try {
    const project = await prisma.salesProject.findFirst({
      where: { id: String(req.params.id), deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id), permissions: { module: "SALES", feature: "Sales Manager" } })] },
      select: { clientMainNumber: true, whatsappGroupName: true, clientLogin: { select: { status: true } } },
    });
    if (!project) return res.status(404).json({ message: "Project not found." });
    if (project.clientLogin?.status !== "ACTIVE") return res.status(404).json({ message: "This project has no client login to send." });
    // Recorded in Settings → WhatsApp Activity Log as a redacted preview: the message holds a
    // password, so it is never kept and never resent from there - only from this dialog.
    await whatsappActivity.track({
      mode: "MANUAL", provider: "baileys", trigger: "CLIENT_LOGIN_CREDENTIALS", eventRef: `client-login:${req.params.id}`,
      initiatedByUserId: req.user.id, senderUserId: req.user.id, links: { salesProjectId: String(req.params.id) },
      recipient: { kind: "PERSON", address: project.clientMainNumber, name: project.whatsappGroupName },
      body: parsed.data.message, preview: "Client login credentials (password withheld)", resendable: false,
    }, () => sendWhatsAppToPerson({
      userId: req.user.id,
      phone: project.clientMainNumber,
      body: parsed.data.message,
      noNumberMessage: "This project has no client number. Add one before sending on WhatsApp.",
    }));
    return res.json({ message: `Client login sent on WhatsApp to ${project.whatsappGroupName}.` });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    console.error(`[sales] Client login WhatsApp refused for project ${req.params.id}:`, error.message);
    return res.status(502).json({ message: "Unable to send the client login on WhatsApp." });
  }
}

async function createProject(req, res) {
  const parsed = projectSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });
  if (parsed.data.groupType && !parsed.data.vertical) parsed.data.vertical = verticalForGroupType[parsed.data.groupType] || null;

  const normalizedClientNumber = normalizeClientMainNumber(parsed.data.clientMainNumber);
  if (!normalizedClientNumber) return res.status(400).json({ message: "Client Main Number must include an editable country code and exactly 10 digits." });

  try {
    // Checked before anything is written, so a refused login leaves no project behind it. The
    // username is the client's mobile number, the Client Main Number this project is saved with.
    const clientLogin = await clientLoginFor(req, { clientMainNumber: normalizedClientNumber });
    const createdShootIds = [];
    const data = await prisma.$transaction(async (transaction) => {
      // `crmLeadStatus` is about the *lead* being converted, not about the project, so it is taken
      // off here with the other two that are not columns - left in, Prisma refuses the create with
      // "Unknown argument crmLeadStatus". It is read again after the transaction, from `parsed`.
      const { shoots, quotationId, crmLeadStatus, ...raw } = parsed.data;
      // Filled before anything reads it - the payload check, the identifier and the row itself all
      // see the same vertical, which is what stops the booking's code disagreeing with its lead's.
      const projectData = withInferredVertical(raw);
      const { groupName } = await validateProjectPayload(transaction, projectData, { userId: req.user.id });
      const finalizedQuotationId = await resolveFinalizedQuotation(transaction, quotationId, projectData.enquiryId);
      // Sale Extras: the shoots the quotation laid down, and the lines it lists under them, are the baseline.
      const quotedShoots = await saleExtrasBooking.quotedPlan(transaction, finalizedQuotationId);
      let quotedShootIndex = 0;
      const creator = await resolveAuthenticatedCreator(transaction, req);

      const eventId = await nextEventId(transaction, projectData);
      const groupNameUsedAt = groupName ? new Date() : null;
      const vertical = projectData.vertical || await verticalFromLead(transaction, projectData.enquiryId);
      const refs = await referenceLookups();
      const project = await transaction.salesProject.create({
        data: {
          ...projectData,
          vertical,
          // The references beside the text, resolved the way the backfill resolved them.
          branchId: refs.branchId(projectData.sourceBranch),
          verticalId: refs.verticalId(vertical),
          // Kept, not dropped. Until this column existed the chosen version was destructured out
          // here and thrown away, so the only trace of it was the amount it had copied into
          // Initial Converted Value - and the quotation register could not say which version a
          // project had actually converted at.
          quotationId: finalizedQuotationId,
          eventId,
          // A used generator row is deleted below, so the project carries the name itself and the
          // generator snapshot - never a pointer at a row that no longer exists.
          whatsappGroupNameId: null,
          clientMainNumber: normalizedClientNumber,
          mainEventDate: projectData.mainEventDateKnown ? projectData.mainEventDate : null,
          crmName: creator.crmName,
          crmEmployeeId: creator.crmEmployeeId,
          groupNameGeneratorJson: groupNameSnapshot(groupName, groupNameUsedAt),
          createdByUserId: req.user.id,
        },
      });

      if (clientLogin) {
        // The client's sign-in, in the project's own transaction: a project that fails to save takes
        // the login with it, and a login that clashes with one made a moment ago (the unique
        // username) takes the project.
        await createClientLoginUser(transaction, project, clientLogin);
      }

      if (groupName) {
        /*
         * Claimed by deleting it: the row's job - holding a name until a project takes it - is
         * done, and the snapshot above is what the project keeps. The same atomic guard the old
         * status flip had: only one create can delete the Available row, so a concurrent create
         * of the same name still gets the 409 rather than a duplicate.
         */
        const claim = await transaction.salesWhatsappGroupName.deleteMany({
          where: { id: groupName.id, status: "Available", usedAt: null, expiresAt: { gt: groupNameUsedAt } },
        });
        if (claim.count !== 1) {
          const error = new Error("Selected WhatsApp group name is no longer available.");
          error.status = 409;
          throw error;
        }
      }
      // Every other name generated for this enquiry goes with it: they were candidates for the
      // project that now exists, and leaving them would offer stale names for a settled enquiry.
      if (projectData.enquiryId) {
        await transaction.salesWhatsappGroupName.deleteMany({ where: { enquiryId: projectData.enquiryId } });
      }

      if (Array.isArray(shoots) && shoots.length) {
        for (const shoot of shoots) {
          const { services = [], deliverables = [], fromQuotation = false, ...shootData } = shoot;
          const quotedLines = fromQuotation === true ? quotedShoots[quotedShootIndex] : null;
          if (quotedLines) quotedShootIndex += 1;
          const quoted = Boolean(quotedLines);
          const savedShoot = await transaction.projectShoot.create({
            // `sortOrder` only when the form's Shoot List was dragged into an order of its own; a whole
            // number or nothing, so a project created without dragging keeps its shoots in date order.
            data: { ...projectShootData(shootData), ...(Number.isInteger(shootData.sortOrder) && shootData.sortOrder >= 0 && shootData.sortOrder < 1000 ? { sortOrder: shootData.sortOrder } : {}), projectId: project.id, shootId: await nextShootId(transaction, projectData), ...saleExtrasBooking.baselineFor(quoted, "SHOOT") },
            select: { id: true, projectId: true, dateCreated: true, isMainEvent: true },
          });
          createdShootIds.push(savedShoot.id);
          await syncProjectMainEvent(transaction, project.id, savedShoot);

          const seenServices = new Set();
          for (const [serviceIndex, service] of services.entries()) {
            if (seenServices.has(service.serviceDefinitionId)) {
              const error = new Error("Duplicate services are not allowed for the same shoot.");
              error.status = 409;
              throw error;
            }
            seenServices.add(service.serviceDefinitionId);
            const definition = await transaction.projectServiceDefinition.findFirst({ where: { id: service.serviceDefinitionId, isActive: true }, include: serviceDefinitionInclude });
            if (!definition) {
              const error = new Error("Select a valid active service.");
              error.status = 400;
              throw error;
            }
            const allocationData = await serviceAllocationDataForDefinition(transaction, definition, service);
            await transaction.projectPostProductionAllocation.create({
              data: {
                projectId: savedShoot.projectId,
                shootId: savedShoot.id,
                serviceDefinitionId: definition.id,
                serviceName: definition.name,
                serviceDetails: null,
                quantitySessionTiming: null,
                ...allocationData,
                // The order the lines were arranged in on Create Project, kept as sent.
                sortOrder: serviceIndex,
                ...saleExtrasBooking.baselineFor(quoted && saleExtrasBooking.takeQuoted(quotedLines.services, definition.id), "SERVICE", { quantitySessionTiming: null, ...allocationData }),
              },
            });
          }

          const seenDeliverables = new Set();
          for (const [deliverableIndex, deliverable] of deliverables.entries()) {
            const definition = await transaction.projectDeliverableDefinition.findFirst({ where: { id: deliverable.deliverableDefinitionId, isActive: true }, include: deliverableDefinitionInclude });
            if (!definition) {
              const error = new Error("Select a valid active deliverable.");
              error.status = 400;
              throw error;
            }
            // One line per variant of a deliverable, not per deliverable - see `deliverableLineKey`.
            const variantData = deliverableVariantSnapshotFor(definition, deliverable.variant);
            const lineKey = deliverableLineKey(definition.id, variantData);
            if (seenDeliverables.has(lineKey)) {
              const error = new Error("Duplicate deliverables are not allowed for the same shoot.");
              error.status = 409;
              throw error;
            }
            seenDeliverables.add(lineKey);
            const allocationData = await deliverableAllocationDataForDefinition(transaction, definition, deliverable);
            await transaction.projectShootDeliverable.create({
              data: {
                projectId: savedShoot.projectId,
                shootId: savedShoot.id,
                deliverableDefinitionId: definition.id,
                deliverableName: definition.name,
                ...allocationData,
                ...variantData,
                sortOrder: deliverableIndex,
                ...saleExtrasBooking.baselineFor(quoted && saleExtrasBooking.takeQuoted(quotedLines.deliverables, definition.id), "DELIVERABLE", { ...allocationData, ...variantData }),
              },
            });
          }
        }
      }

      const created = await transaction.salesProject.findUnique({
        where: { id: project.id },
        include: { shoots: { where: { deletedAt: null }, orderBy: [{ dateCreated: SHOOT_DATE_ASC }, { createdAt: "asc" }] } },
      });
      // The new shoots' ids in the order they were sent, for the Schedule Payment rows the form saves
      // next to name the shoot they follow - `shoots` above is in date order, not the form's.
      return { ...created, createdShootIds };
    });

    /*
     * A project saved against an enquiry is what converts that lead, so the CRM is told here
     * rather than by the click that opened this form - a Create Project tab closed without
     * saving leaves the lead exactly where it was.
     *
     * Outside the transaction, and never fatal: this reaches Google Sheets, and a project that
     * is already committed must not fail on a sheet that is unreachable. The lead can be moved
     * by hand; a rolled-back project could not be.
     */
    if (data?.enquiryId) {
      try {
        await markCrmLeadConverted(data.enquiryId, { actorUserId: req.user?.id ?? null, source: "app" }, parsed.data.crmLeadStatus);
      } catch (error) {
        console.error("Project saved, but its CRM lead could not be marked Converted:", error.message);
      }
    }

    await logProjectActivity({ projectId: data?.id, area: "PROJECT", action: "PROJECT_CREATED", detail: `Project ${data?.eventId || ""} created`, userId: Number(req.user.id) });
    return res.status(201).json({ data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    // A client login whose username was taken between the check and the save.
    if (error.code === "P2002" && /username/.test(String(error.meta?.target || ""))) {
      return res.status(409).json({ message: "Client Credentials: That mobile number was just given a login by another save. Reload and try again." });
    }
    console.error("Unable to save sales project:", error);
    return res.status(500).json({ message: "Unable to save sales project." });
  }
}

/** Whether this login plans projects - PROJECT / Projects, or Show All Projects, at Read / Write. */
/**
 * Whether this caller edits a project whether or not it has been sent back: by any way into
 * `mayEditProject` other than SALES / Booking Edit, or by planning projects. Only the CRM side - the
 * booking editor and nothing more - waits for Send Back.
 */
async function mayEditOutsideSendBack(project, user) {
  if (staffedOn(project, PROJECT_STAFF_FIELDS, Number(user?.linkedEmployeeId) || null)) return true;
  if (await iamService.hasPermission(user.id, "ADMIN", "Branch Administration", "READ")) return true;
  if (await worksEveryProject(user)) return true;
  return mayPlanProjects(user.id);
}

async function mayPlanProjects(userId) {
  for (const { module, feature, level } of [{ module: "PROJECT", feature: "Projects", level: "READ_WRITE" }, SHOW_ALL_PROJECTS_WRITE]) {
    if (await iamService.hasPermission(Number(userId), module, feature, level)) return true;
  }
  return false;
}

/*
 * What returning a sent-back project to Projects writes - Edit Sale Details' Update to Project, by
 * `updateProject` or, with nothing on the form changed, `returnToProjects`. It is no longer sent back,
 * and it goes to Projects → Yet to Start to be started again whatever status it left with (the
 * studio's rule): its shoots, payments and history stay as they are.
 */
const RETURNED_TO_PROJECTS = { sentBackAt: null, sentBackByUserId: null, projectStatus: "Yet to Start" };
const RETURNED_TO_PROJECTS_DETAIL = "Updated to Project from Bookings & Converted - back on Projects under Yet to Start";

async function updateProject(req, res) {
  const parsed = projectSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });
  if (parsed.data.groupType && !parsed.data.vertical) parsed.data.vertical = verticalForGroupType[parsed.data.groupType] || null;
  const normalizedClientNumber = normalizeClientMainNumber(parsed.data.clientMainNumber);
  if (!normalizedClientNumber) return res.status(400).json({ message: "Client Main Number must include an editable country code and exactly 10 digits." });

  /*
   * `?draft=true` is Edit Sale Details' Save Draft on a sent-back project: the sale details are saved
   * and the project stays under Sent Back, still the CRM side's to edit. Without it the save is
   * Update to Project, which returns it to Projects in the same write. Only a sent-back project has
   * a draft to keep.
   */
  const savesDraft = req.query.draft === "true";
  try {
    // Whether this save returns a sent-back project to Projects - said in its Activity afterwards.
    let returnedFromSendBack = false;
    /*
     * The record as it stood, kept from the read the save already makes rather than fetched again -
     * so the activity line can say which fields moved and to what. Inside the transaction, so the
     * before it reports is the before it actually wrote over.
     */
    let saleBefore = null;
    const data = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.salesProject.findFirst({ where: { id: req.params.id, deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id), forWrite: true })] } });
      saleBefore = existing;
      if (!existing) {
        const error = new Error("Project not found.");
        error.status = 404;
        throw error;
      }
      if (savesDraft && !existing.sentBackAt) {
        const error = new Error("Only a project sent back to Bookings & Converted can be saved as a draft.");
        error.status = 409;
        throw error;
      }
      returnedFromSendBack = Boolean(existing.sentBackAt) && !savesDraft;
      /*
       * The CRM side - somebody who may change this booking only through SALES / Booking Edit - changes
       * it only while Projects has sent it back, and that one save takes it out of Sent Back, after
       * which it is locked to them again until it is sent back once more (the studio's rule). Everybody
       * else who may edit a project edits it as they always could, sent back or not: the people it is
       * staffed to, a branch administrator, whoever works every project, and whoever plans projects
       * (`mayEditOutsideSendBack`). Held here and not only by the hidden button.
       */
      if (!existing.sentBackAt && !(await mayEditOutsideSendBack(existing, req.user))) {
        const error = new Error("This booking can be edited only after Projects sends it back to Bookings & Converted.");
        error.status = 403;
        throw error;
      }
      const { shoots, quotationId, ...projectData } = parsed.data;
      const { groupName } = await validateProjectPayload(transaction, projectData, { existingWhatsappGroupNameId: existing.whatsappGroupNameId, userId: req.user.id });
      /*
       * Absent means "not sent", not "cleared".
       *
       * The form sends the field on every save, so a person clearing the picker still reaches here
       * with an empty string and the selection is dropped as they asked. A caller that omits the
       * key entirely - a partial save from somewhere else - keeps whatever the project already
       * had, rather than silently unfinalizing a quotation it never mentioned.
       *
       * The version the project already holds is kept as it is, without asking again whether it is
       * finalized: unfinalizing a quotation later must never take it off a project booked at it, nor
       * stop that project's other details being saved. Only a different version is checked.
       */
      const keepsItsQuotation = quotationId === undefined || (Boolean(existing.quotationId) && String(quotationId || "").trim() === existing.quotationId);
      // Published Sale Extras are measured from the quotation the project is booked on; moving it to
      // another would leave the client's link showing extras against a figure they no longer follow.
      // Under the project lock Sale Extras publishes under, so a publish cannot land between the check and the move.
      if (!keepsItsQuotation) await transaction.$queryRaw`SELECT id FROM sales_project WHERE id = ${existing.id} FOR UPDATE`;
      if (!keepsItsQuotation && await transaction.projectSaleExtraRevision.count({ where: { projectId: existing.id } })) {
        const error = new Error("This project has published extras on its quotation, so it cannot be moved to a different quotation.");
        error.status = 409;
        throw error;
      }
      const finalizedQuotationId = keepsItsQuotation
        ? existing.quotationId
        : await resolveFinalizedQuotation(transaction, quotationId, projectData.enquiryId);
      // Sale Extras: a newly linked quotation describes the plan as it stands now - its baseline.
      if (!keepsItsQuotation && finalizedQuotationId) await saleExtrasBooking.rebaselineProject(transaction, existing.id);
      const groupNameUsedAt = groupName && groupName.id !== existing.whatsappGroupNameId ? new Date() : null;
      const vertical = projectData.vertical || await verticalFromLead(transaction, projectData.enquiryId);
      const refs = await referenceLookups();
      const project = await transaction.salesProject.update({
        where: { id: existing.id },
        data: {
          ...projectData,
          // A project sent back to Bookings & Converted goes back to Projects, as Yet to Start, once it
          // is updated to Project - in the same write as the save, so the two cannot disagree (the
          // studio's rule). Save Draft leaves it under Sent Back.
          ...(returnedFromSendBack ? RETURNED_TO_PROJECTS : {}),
          vertical,
          branchId: refs.branchId(projectData.sourceBranch),
          verticalId: refs.verticalId(vertical),
          quotationId: finalizedQuotationId,
          // A claimed generator row is deleted below; the project keeps the name and the snapshot.
          whatsappGroupNameId: null,
          clientMainNumber: normalizedClientNumber,
          mainEventDate: projectData.mainEventDateKnown ? projectData.mainEventDate : null,
          deliverables: existing.deliverables,
          deliverablesDetails: existing.deliverablesDetails,
          crmName: existing.crmName,
          crmEmployeeId: existing.crmEmployeeId,
          groupNameGeneratorJson: groupName ? groupNameSnapshot(groupName, groupNameUsedAt || groupName.usedAt) : null,
        },
      });
      if (groupName && groupName.id !== existing.whatsappGroupNameId) {
        // Claimed by deleting it, under the same atomic guard the create path uses.
        const claim = await transaction.salesWhatsappGroupName.deleteMany({ where: { id: groupName.id, status: "Available", usedAt: null, expiresAt: { gt: groupNameUsedAt } } });
        if (claim.count !== 1) {
          const error = new Error("Selected WhatsApp group name is no longer available.");
          error.status = 409;
          throw error;
        }
      }
      /*
       * CRD Document is answered on this form as well as on Start Project, so the document is
       * raised from both. This is the path Edit Sale Details takes, and it is where the answer is
       * most often corrected - a booking saved as "Not Applicable" and put right later. Raising it
       * only on the Start Project path left exactly those projects on the register with the CRD ID
       * column reading "-".
       *
       * Reads the answer just written, and does nothing unless it is "Applicable". See
       * `ensureProjectCrdDocument`.
       */
      await ensureProjectCrdDocument(transaction, project.id, { userId: Number(req.user.id) });
      return project;
    });
    const saleChanges = fieldChanges(saleBefore, parsed.data);
    describeChanges(req, saleChanges);
    await logProjectActivity({
      projectId: req.params.id,
      area: "PROJECT",
      action: "SALE_EDITED",
      detail: [
        savesDraft ? "Saved as a draft - still under Sent Back" : null,
        ...(saleChanges.length ? saleChanges : ["Sale details saved"]),
      ].filter(Boolean).join(" · "),
      userId: Number(req.user.id),
    });
    if (returnedFromSendBack) await logProjectActivity({ projectId: req.params.id, area: "PROJECT", action: "SEND_BACK_RESOLVED", detail: RETURNED_TO_PROJECTS_DETAIL, userId: Number(req.user.id) });
    return res.json({ data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to update sales project:", error);
    return res.status(500).json({ message: "Unable to update sales project." });
  }
}

/**
 * Everything that goes with a project once it has been stamped deleted, inside the caller's
 * transaction: the client's sign-in, its galleries and its client storage - and who deleted it.
 * Written once so the Delete button, the tick boxes' bulk delete and Pre Production → Import's
 * replace all delete a project the same way.
 *
 * A delete only moves the project to Resource Management → Recycling Bin, so everything here is
 * recorded the way Restore (`assets/recycling-bin.service.js`) reads it back: the galleries carry the
 * project's own `deletedAt`, the storage records the project's reason and time, and a login this
 * delete switched off carries the same time in `deactivatedWithProjectAt`. Nothing
 * is erased - the photos included; Delete permanently in the bin is what purges them.
 */
async function retireProjectWithin(transaction, id, { userId, deletedAt }) {
  const deletedByUserId = Number.isInteger(Number(userId)) && Number(userId) > 0 ? Number(userId) : null;
  // The client's sign-in goes with its project: refused at login from now on, and by `protect` on
  // the next request of a session already open. A login this delete switches off is stamped with the
  // project's deletion time, so Restore turns back on exactly that login - never one somebody had
  // already switched off on their own, which is left as it was and carries no stamp.
  await transaction.user.updateMany({ where: { clientProjectId: id, role: CLIENT_ROLE, status: "ACTIVE" }, data: { status: "INACTIVE", deactivatedWithProjectAt: deletedAt } });
  await transaction.user.updateMany({ where: { clientProjectId: id, role: CLIENT_ROLE, status: { not: "INACTIVE" } }, data: { status: "INACTIVE" } });
  await transaction.salesProject.update({ where: { id }, data: { deletedByUserId } });
  // Both sections go - the Projects page and Album Proofing file their projects in one table under a
  // flag - stamped with the project's own time, which is how Restore finds exactly these.
  const gallery = await transaction.imageSelectionProject.updateMany({ where: { salesProjectId: id, deletedAt: null }, data: { deletedAt } });
  return { gallery: gallery.count, storage: await removeProjectClientStorage(transaction, id, { userId, deletedAt }) };
}

/**
 * Deletes a project - that is, moves it to Resource Management → Recycling Bin - and with it the two
 * things it raised elsewhere: the Image Selection presence and the client storage.
 *
 * ── Image Selection ──
 *
 * An Image Selection project raised from a production project is not a thing of its own: the list
 * sync puts it there the moment the project goes in progress, it is named by the project's WhatsApp
 * group name, and it reads its client from the project. So it is hidden with the project, or it
 * would stay in the sidebar refusing every instruction because the project it points at is gone.
 * The published gallery answers 404 by itself once the row is hidden.
 *
 * **Its photos are not purged here.** A project in the bin can be restored, and a restore that came
 * back without its photographs would not be one. Recycling Bin → Delete permanently runs Image
 * Selection's own purge (`purgeData`).
 *
 * ── Client storage ──
 *
 * A project is *soft*-deleted, so its row never goes and the foreign key's `onDelete: SetNull` never
 * fires; the storage register filters on its own `isDeleted`. Its records are marked removed with
 * the project's reason, so the disc stops being listed against a project nothing else shows.
 *
 * ── All in one transaction ──
 *
 * The project first: `updateMany` with the access rule in its `where` is what decides whether this
 * caller may delete this project at all, so nothing else is touched until it has answered.
 *
 * Returns what went with it - the gallery, the client storage records - or `null` for a project
 * that was not this caller's to delete or was already gone.
 */
async function removeProject(req, id) {
  const userId = Number(req.user.id);
  const deletedAt = new Date();
  // Resolved before the transaction opens, not inside it: the rule reads permissions of its own
  // through the plain client, and an unrelated query awaited inside an interactive transaction
  // holds that transaction open across it for no reason.
  const where = { id, deletedAt: null, AND: [await projectAccessWhere({ userId, forWrite: true })] };
  return prisma.$transaction(async (transaction) => {
    const result = await transaction.salesProject.updateMany({ where, data: { deletedAt } });
    // Not this caller's project, or already deleted: nothing is touched, the gallery included.
    if (result.count !== 1) return null;
    return retireProjectWithin(transaction, id, { userId, deletedAt });
  });
}

/**
 * One ticked project, moved to the Recycling Bin - the bulk delete on Projects and Bookings &
 * Converted.
 *
 * **This carries `requireProjectDeleter`'s rule itself, and that is the whole point of it.** That
 * guard is middleware reading `req.params.id`, so a bulk route cannot mount it - the ids are in the
 * body and there are forty of them. Running the delete without it would hand anybody who can reach
 * the Projects screen a way to remove projects they do not manage, which is exactly what
 * `mayDeleteProject` exists to prevent. So the rule is asked here, per project, against the same
 * lookup `requireProjectRole` does: found through the caller's own data scope, then `mayDeleteProject`.
 *
 * Throws on refusal, so the bulk runner counts the project as one it could not take and the row
 * stays ticked.
 */
async function deleteProjectRecord(req, id) {
  const project = await prisma.salesProject.findFirst({
    where: { id, deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id), forWrite: true })] },
    select: Object.fromEntries(PROJECT_STAFF_FIELDS.map((field) => [field, true])),
  });
  if (!project) throw new Error("Project not found.");
  if (!await mayDeleteProject(project, req.user)) throw new Error(PROJECT_DELETE_REFUSAL);
  const removed = await removeProject(req, id);
  if (removed === null) throw new Error("Project not found.");
  return { id, ...removed };
}

/*
 * ── Projects → Update status, over the ticked projects ─────────────────────────────────────────
 *
 * Sets one Project Status on every project ticked, under the same rule as changing one project: the
 * route asks for `PROJECT / Projects` (or Show All Projects) at Read / Write, and each project must be
 * in the caller's own reach and - once started - theirs to change (`mayEditStartedProject`). A project
 * that fails either is left alone and counted, never an error for the rest.
 *
 * Only the project's own status is written - never a shoot, and never a department's status: Pre
 * Production, Production and Accounts each read their own from their shoots and payments.
 */
const bulkStatusSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(191)).min(1, "Select at least one project.").max(500),
  status: z.enum(projectStatuses, { message: "Choose a project status." }),
}).strict();

async function bulkUpdateProjectStatus(req, res) {
  const parsed = bulkStatusSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Choose a project status." });
  const { status } = parsed.data;
  const ids = [...new Set(parsed.data.ids)];
  try {
    const userId = Number(req.user.id);
    const found = await prisma.salesProject.findMany({
      where: { id: { in: ids }, deletedAt: null, AND: [await projectAccessWhere({ userId, forWrite: true })] },
      select: { id: true, projectStatus: true, projectManagerEmployeeId: true },
    });
    const allowed = [];
    for (const project of found) if (await mayEditStartedProject(project, req.user)) allowed.push(project.id);
    if (allowed.length) await prisma.salesProject.updateMany({ where: { id: { in: allowed } }, data: { projectStatus: status } });

    const refused = found.length - allowed.length;
    const missing = ids.length - found.length;
    for (const projectId of allowed) await logProjectActivity({ projectId, area: "PROJECT", action: "STATUS_CHANGED", detail: `Project status set to ${status} (Update over ticked projects)`, userId: Number(req.user.id) });
    return res.json({ data: { updated: allowed.length, refused, missing } });
  } catch (error) {
    console.error("Unable to update the selected projects' status:", error);
    return res.status(500).json({ message: "Unable to update the selected projects' status." });
  }
}

async function deleteProject(req, res) {
  try {
    const removed = await removeProject(req, req.params.id);
    if (removed === null) return res.status(404).json({ message: "Project not found." });
    /*
     * The storage is said rather than left to be noticed. A hard disc is a real object somebody may
     * be holding, and a record leaving the storage register is worth a sentence at the moment it
     * happens - "deleted successfully" alone would have the disc quietly vanish from the one screen
     * the studio tracks it on. The gallery is not counted out loud: it is the same project under
     * another name, not a second thing that went.
     */
    return res.json({
      message: removed.storage
        ? `Project moved to the Project Vault. ${removed.storage} client storage record${removed.storage === 1 ? "" : "s"} removed with it.`
        : "Project moved to the Project Vault.",
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to delete sales project:", error);
    return res.status(500).json({ message: "Unable to delete sales project." });
  }
}

async function verifyProjectShoots(transaction, projectId, items) {
  const shootIds = [...new Set(items.map((item) => item.shootId))];
  if (!shootIds.length) return;
  const shoots = await transaction.projectShoot.findMany({ where: { id: { in: shootIds }, projectId, deletedAt: null }, select: { id: true } });
  if (shoots.length !== shootIds.length) {
    const error = new Error("One or more selected shoots do not belong to this project.");
    error.status = 400;
    throw error;
  }
}

async function resolveAssignmentEmployees(transaction, identification) {
  const assignments = [
    ["projectManagerEmployeeId", "projectManager"],
    ["preProductionCoordinatorEmployeeId", "preProductionCoordinator"],
    ["creativeManagerEmployeeId", "creativeManager"],
    ["postProductionCoordinatorEmployeeId", "postProductionCoordinator"],
    ["productionManagerEmployeeId", "productionManager"],
    // The two client gifts are assignments like any other: whoever is named has to be an active
    // employee, and the name stored beside the id is theirs at the time it was assigned.
    ["welcomeGiftEmployeeId", "welcomeGiftAssignee"],
    ["shootCompletedGiftEmployeeId", "shootCompletedGiftAssignee"],
  ];
  const employeeIds = [...new Set(assignments.map(([idField]) => identification[idField]).filter(Boolean))];
  if (!employeeIds.length) return identification;

  const employees = await transaction.employee.findMany({
    where: { id: { in: employeeIds }, archivedAt: null, employmentStatus: { in: await workingEmployeeStatuses() } },
    select: { id: true, employeeName: true },
  });
  if (employees.length !== employeeIds.length) {
    const error = new Error("Select only active employees for project assignments.");
    error.status = 400;
    throw error;
  }

  const employeesById = new Map(employees.map((employee) => [employee.id, employee]));
  const resolved = { ...identification };
  assignments.forEach(([idField, nameField]) => {
    if (resolved[idField]) resolved[nameField] = employeesById.get(resolved[idField]).employeeName;
  });
  return resolved;
}

/**
 * Keeps a gift's Client Gifts status honest with the answer just given.
 *
 * Marking a gift Applicable puts it on the first Client Gifts tab, so it is a thing somebody owes
 * the client rather than a fact nobody is looking at. Marking it Not Applicable takes it off the
 * screen entirely and clears what was tracked against it - a gift that is not being given has no
 * assignee and no "Sent" date. A gift already on its way is left where it is: re-saving the
 * project must not walk a "Received by Client" row back to the start.
 */
function applyGiftTracking(identification, project) {
  const gifts = [
    ["welcomeGift", "welcomeGiftStatus", "welcomeGiftSentAt", "welcomeGiftReceivedAt", "welcomeGiftAssignee", "welcomeGiftEmployeeId"],
    ["shootCompletedGift", "shootCompletedGiftStatus", "shootCompletedGiftSentAt", "shootCompletedGiftReceivedAt", "shootCompletedGiftAssignee", "shootCompletedGiftEmployeeId"],
  ];
  const next = { ...identification };
  gifts.forEach(([giftField, statusField, sentField, receivedField, assigneeField, employeeIdField]) => {
    if (next[giftField] === undefined) return;
    if (next[giftField] === "Applicable") {
      if (!project[statusField]) next[statusField] = GIFT_STATUS_PENDING;
      return;
    }
    next[statusField] = null;
    next[sentField] = null;
    next[receivedField] = null;
    next[assigneeField] = null;
    next[employeeIdField] = null;
  });
  return next;
}

/*
 * ── Who may change a project once it has started ──────────────────────────────────────────────
 *
 * Planning a project is `PROJECT / Projects` `READ_WRITE`, and that is the right question right up
 * until the project starts. After that the plan is being worked to: shoots are rostered against it,
 * services are allocated, money is scheduled and received. A change to it then is not the same act
 * as making it, and it belongs to the person answerable for the work.
 *
 * So a started project is editable by:
 *
 *   - its **Project Manager**, matched on the employee behind the signed-in login, and
 *   - anyone holding **`ADMIN / Branch Administration`**, the permission the studio gives whoever
 *     runs a branch - which a Super Admin holds along with everything else, so they are covered by
 *     this and need no check of their own.
 *
 * Deliberately not a `req.user.role` test. A role check inside a controller sits below the guard on
 * the route, silently overrules it, and cannot be granted to anybody - the permission above is the
 * only thing that decides access (CLAUDE.md, Rule 4).
 */
const STARTED_PROJECT_EDIT_REFUSAL = "This project has started, so only its Project Manager, a branch administrator or somebody who plans projects can change it.";

async function mayEditStartedProject(project, user) {
  // Before it starts, planning it is the whole job and the route's own permission is the answer.
  if ((project?.projectStatus || "Yet to Start") === "Yet to Start") return true;
  const linkedEmployeeId = Number(user?.linkedEmployeeId) || null;
  if (linkedEmployeeId && project.projectManagerEmployeeId === linkedEmployeeId) return true;
  if (await iamService.hasPermission(user.id, "ADMIN", "Branch Administration", "READ")) return true;
  // Whoever plans projects (PROJECT / Projects Read / Write) changes a started one too - the studio's
  // rule: that permission is enough to edit a project's plan and its sale from the Projects screen.
  if (await mayPlanProjects(user.id)) return true;
  // And whoever may work every project, which is what lets somebody who is not a branch
  // administrator start and run a project nobody is staffed to yet.
  return worksEveryProject(user);
}

/*
 * ── Who answers for a project as a record ─────────────────────────────────────────────────────
 *
 * Two questions, not one, and the difference between them is the difference between working on a
 * project and undoing it.
 *
 * Both are narrower than `mayEditStartedProject` above, and deliberately without its escape: that
 * one waves through every **Yet to Start** project, because until a project starts, planning it *is*
 * the job. These ask who the project belongs to, and the answer does not change when it starts.
 *
 * **Changing it** - the booking it was created from - belongs to the people the project is *staffed
 * to*: its Project Manager, its Pre Production Coordinator, its Creative Manager, its Post
 * Production Coordinator. Each of them is working to this project and each has reason to correct
 * what it says.
 *
 * **Deleting it** belongs to its **Project Manager** alone. A coordinator runs a stage of the work;
 * removing the project out from under everybody else working to it is not a stage of anything, and
 * a permission that let four people do it is four ways to lose a project.
 *
 * A holder of **`ADMIN / Branch Administration`** passes either, which a Super Admin holds along
 * with everything else, so they are covered without a check of their own.
 *
 * Not the CRM. Creating a project is a sale, and `SALES / Sales Manager` `READ_WRITE` is the right
 * question for making one; it is the wrong question for unmaking one. Left as it was, the same
 * permission that books a project also deleted it and went on editing it forever, so the person who
 * typed a booking could quietly rewrite or remove it long after the studio began working to it.
 *
 * A **Yet to Start project is staffed to nobody** - every one of these fields is filled in on the
 * Start Project form, not on the booking form - so until somebody is named this is the branch
 * administrator alone, for both questions. That is the honest reading of the data rather than a gap:
 * nothing here pretends a project has people on it before anybody has put them there.
 *
 * Deliberately not a `req.user.role` test, for the reason given above `mayEditStartedProject`: a
 * role check inside a controller sits below the guard on the route, silently overrules it, and
 * cannot be granted to anybody (CLAUDE.md, Rule 4).
 */
/**
 * The studio-wide way through, for somebody a project is not staffed to.
 *
 * `PROJECT / Show All Projects` `READ_WRITE`. Its Read half is a visibility grant and is answered in
 * `projectScope.js`, which decides *which rows* somebody sees; this is the other half - being
 * allowed to act on them. A person can hold Read alone and be shown the whole register while being
 * able to change none of it, which is exactly what Read alone is for.
 *
 * It exists because the staffing rules leave a real gap: a **Yet to Start project is staffed to
 * nobody**, since those seats are filled in on the Start Project form rather than the booking form -
 * so a freshly booked project could be started only by a branch administrator, and the studio has
 * people whose job is exactly that and who are not administrators. Granted rather than coded: it
 * reads as a permission beside `ADMIN / Branch Administration`, and nothing here reads a role.
 *
 * Permissions add and never subtract: holding this at Read takes nothing away from what somebody
 * already holds through `PROJECT / Projects` or through being staffed on a project.
 */
const SHOW_ALL_PROJECTS_WRITE = { module: "PROJECT", feature: "Show All Projects", level: "READ_WRITE" };

const worksEveryProject = (user) =>
  iamService.hasPermission(user.id, SHOW_ALL_PROJECTS_WRITE.module, SHOW_ALL_PROJECTS_WRITE.feature, SHOW_ALL_PROJECTS_WRITE.level);

/*
 * Editing a **booking** - this project's sale record and its client login - as its own grant.
 *
 * Changing one answered only to the record: staffed on it, a branch administrator, or Show All
 * Projects. So the one grantable way to let a CRM edit a booking they are not staffed on also handed
 * them every project on three other boards. This is that act alone, and it **adds**: everybody who
 * may edit a booking today still may. It widens no reading - `requireProjectRole` looks the project
 * up through `projectAccessWhere`, so this reaches the bookings the caller can already see. Deleting one is still its Project Manager's (`mayDeleteProject`),
 * and the plan is still `mayEditStartedProject`'s.
 */
const BOOKING_EDIT_WRITE = { module: "SALES", feature: "Booking Edit", level: "READ_WRITE" };

const mayEditBookings = (user) =>
  iamService.hasPermission(user.id, BOOKING_EDIT_WRITE.module, BOOKING_EDIT_WRITE.feature, BOOKING_EDIT_WRITE.level);

const PROJECT_EDIT_REFUSAL = "Only the people this project is staffed to, somebody who plans projects or may edit bookings, a branch administrator, or somebody who may work every project, can change it.";
const PROJECT_DELETE_REFUSAL = "Only this project's Project Manager, a branch administrator, or somebody who may work every project, can delete it.";

/**
 * Everybody a project is staffed to, in the order the Start Project form asks for them.
 *
 * The Project Manager leads it and is the only one of the four that `mayDeleteProject` reads, which
 * is why the list is written once here and sliced rather than repeated: a fifth role added to the
 * Start Project form is a name that has to appear in exactly one place for both rules to know it.
 */
const PROJECT_STAFF_FIELDS = [
  "projectManagerEmployeeId",
  "preProductionCoordinatorEmployeeId",
  "creativeManagerEmployeeId",
  "postProductionCoordinatorEmployeeId",
];

/**
 * Whether the employee behind this login is named in any of `fields` on this project.
 *
 * A login with no employee behind it is nobody, rather than a match against the projects that have
 * nobody in that seat: `null === null` is true in JavaScript, and without the guard on
 * `linkedEmployeeId` every unstaffed project in the studio would answer to every such login.
 */
const staffedOn = (project, fields, linkedEmployeeId) =>
  Boolean(linkedEmployeeId) && fields.some((field) => project?.[field] === linkedEmployeeId);

/** Changing the project: anybody it is staffed to, whoever may edit bookings, whoever runs the branch, or whoever works every project. */
async function mayEditProject(project, user) {
  if (staffedOn(project, PROJECT_STAFF_FIELDS, Number(user?.linkedEmployeeId) || null)) return true;
  if (await mayEditBookings(user)) return true;
  if (await iamService.hasPermission(user.id, "ADMIN", "Branch Administration", "READ")) return true;
  // Whoever plans projects edits a project's sale details too, from the Projects screen beside its plan.
  if (await mayPlanProjects(user.id)) return true;
  return worksEveryProject(user);
}

/** Deleting it: its Project Manager, whoever runs the branch, or whoever works every project. A coordinator may not. */
async function mayDeleteProject(project, user) {
  if (staffedOn(project, PROJECT_STAFF_FIELDS.slice(0, 1), Number(user?.linkedEmployeeId) || null)) return true;
  if (await iamService.hasPermission(user.id, "ADMIN", "Branch Administration", "READ")) return true;
  return worksEveryProject(user);
}

/**
 * Either rule as middleware, for the two writes that act on a project as a whole.
 *
 * One factory rather than two near-identical handlers, so the pair cannot drift in how they *look a
 * project up* while differing only in what they then ask of it. Read through the caller's own data
 * scope for the reason `requireStartedProjectEditor` is: a project outside it is answered 404 here
 * rather than 403, so this never becomes a way to learn that a project exists.
 */
const requireProjectRole = (allows, refusal) => async (req, res, next) => {
  try {
    const project = await prisma.salesProject.findFirst({
      where: { id: req.params.id, deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id), forWrite: true })] },
      select: Object.fromEntries(PROJECT_STAFF_FIELDS.map((field) => [field, true])),
    });
    if (!project) return res.status(404).json({ message: "Project not found." });
    if (await allows(project, req.user)) return next();
    return res.status(403).json({ message: refusal });
  } catch (error) {
    console.error("Unable to check who answers for this project:", error);
    return res.status(500).json({ message: "Unable to check who answers for this project." });
  }
};

const requireProjectEditor = requireProjectRole(mayEditProject, PROJECT_EDIT_REFUSAL);
const requireProjectDeleter = requireProjectRole(mayDeleteProject, PROJECT_DELETE_REFUSAL);

/**
 * The same rule as middleware, mounted on every route that writes to one project.
 *
 * One place rather than a line in each handler: the plan is written through a dozen endpoints -
 * the start-project pair, shoots, allocations, production deliverables - and a rule repeated in
 * twelve handlers is a rule that will be missing from the thirteenth.
 *
 * A project this request cannot find is left to the handler, which looks it up through the caller's
 * own data scope and answers 404 - so this never becomes a way to learn that a project exists.
 */
async function requireStartedProjectEditor(req, res, next) {
  try {
    /*
     * Read through the caller's own data scope, like every other read of a project by id.
     *
     * Without it this would answer 403 for a started project the caller may not even see, while
     * the handler behind it answers 404 - and the difference between the two is a way to learn that
     * a project exists. Outside the scope it finds nothing, and answers the 404 itself.
     *
     * Itself, rather than leaving it to the handler: the shoot and allocation writes behind this
     * look their rows up by project id alone, so a project this person may not see could still have
     * its shoots edited and deleted by them - with the started-project check skipped on the way,
     * since a project this found nothing for was waved through as "the handler will refuse it".
     */
    const project = await prisma.salesProject.findFirst({
      where: { id: req.params.id, deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id), forWrite: true })] },
      select: { projectStatus: true, projectManagerEmployeeId: true },
    });
    if (!project) return res.status(404).json({ message: "Project not found." });
    if (await mayEditStartedProject(project, req.user)) return next();
    return res.status(403).json({ message: STARTED_PROJECT_EDIT_REFUSAL });
  } catch (error) {
    console.error("Unable to check who may edit this project:", error);
    return res.status(500).json({ message: "Unable to check who may edit this project." });
  }
}

/*
 * Whether each of the four "does it apply" answers counts as applying. CRD Document carries more
 * than yes and no — which sides have been received — so anything but "Not Applicable" applies.
 */
const APPLICABILITY_ITEMS = {
  welcomeGift: (value) => value === "Applicable",
  shootCompletedGift: (value) => value === "Applicable",
  storageNeeded: (value) => value === "Yes",
  crdDocumentStatus: (value) => Boolean(value) && value !== "Not Applicable",
};

/**
 * One history row for each of the four answers this save switched between applicable and not, with
 * the reason given. A change within "applicable" — CRD moving from Applicable to Groom Side Received
 * — is not a switch and records nothing; neither does a field the save did not send.
 */
function applicabilityChanges(before, after, remarks = {}) {
  return Object.entries(APPLICABILITY_ITEMS)
    .filter(([item, applies]) => after[item] !== undefined && applies(before[item]) !== applies(after[item]))
    .map(([item]) => ({ item, fromValue: before[item] || null, toValue: after[item] || null, remarks: remarks[item] || null }));
}

/*
 * `permissions` is the permission the calling route was guarded with, which is what the project is
 * scoped by - the project register's own list when left out. Pre Production's General panel passes
 * `PROJECT / Pre Production`, so it reaches the projects that screen reaches and no others.
 */
async function saveStartProjectWork(transaction, projectId, data, { start, userId, permissions }) {
  const project = await transaction.salesProject.findFirst({ where: { id: projectId, deletedAt: null, AND: [await projectAccessWhere({ userId, forWrite: true, permissions })] }, select: { id: true, projectStatus: true, welcomeGiftStatus: true, shootCompletedGiftStatus: true, welcomeGift: true, shootCompletedGift: true, storageNeeded: true, crdDocumentStatus: true } });
  if (!project) {
    const error = new Error("Project not found.");
    error.status = 404;
    throw error;
  }
  if (start && project.projectStatus !== "Yet to Start") {
    const error = new Error("Only Yet to Start projects can be started.");
    error.status = 409;
    throw error;
  }
  const { productionServices, postProductionDeliverables, applicabilityRemarks, ...identification } = data;
  const resolvedIdentification = applyGiftTracking(await resolveAssignmentEmployees(transaction, identification), project);
  await transaction.salesProject.update({ where: { id: project.id }, data: { ...resolvedIdentification, ...(start ? { projectStatus: "In Progress" } : {}) } });
  const switched = applicabilityChanges(project, identification, applicabilityRemarks);
  if (switched.length) {
    await transaction.projectApplicabilityChange.createMany({
      data: switched.map((change) => ({ ...change, projectId: project.id, changedByUserId: Number(userId) || null })),
    });
  }
  if (productionServices !== undefined) {
    await verifyProjectShoots(transaction, project.id, productionServices);
    await transaction.projectPostProductionAllocation.updateMany({ where: { projectId: project.id, deletedAt: null }, data: { deletedAt: new Date() } });
    if (productionServices.length) await transaction.projectPostProductionAllocation.createMany({ data: productionServices.map((item, index) => ({ ...item, projectId: project.id, sortOrder: index })) });
  }
  if (postProductionDeliverables !== undefined) {
    await verifyProjectShoots(transaction, project.id, postProductionDeliverables);
    await syncProjectShootDeliverables(transaction, project.id, postProductionDeliverables);
  }
  // Raised after the update so it reads the answer just given. This covers both starting the
  // project with Storage Needed = Yes and turning it on later for an already started project;
  // saving a draft on a Yet to Start project raises nothing.
  await ensureProjectClientStorage(transaction, project.id, { userId });
  /*
   * The same, for the other question Start Project asks that raises a record elsewhere: answering
   * CRD Document "Applicable" is what makes the document exist, rather than Send Link being what
   * creates it.
   *
   * Here rather than only on the start path, because Edit Project is where the answer is most often
   * changed - a project started as "Not Applicable" and corrected later has to raise its document
   * too, and that is exactly the case that was showing "-" in the register's CRD ID column.
   *
   * Unlike storage this does not wait for the project to be started: the CRD register already lists
   * a booking that has answered Applicable, and it listed it with a blank identifier.
   */
  await ensureProjectCrdDocument(transaction, project.id, { userId });

  // And the pre production board, on the same terms: raised after the update so it reads the
  // coordinator just named. This covers starting a project with a Pre Production Coordinator and
  // naming one later on an already started project; a draft on a Yet to Start project raises none.
  await ensureProjectPreProduction(transaction, project.id, { userId });
  // And the production board, on the same terms: raised once the project has a Production Manager,
  // named on Edit Project beside the other four seats, so naming one later raises the rows then.
  await ensureProjectProduction(transaction, project.id);
  return transaction.salesProject.findUnique({ where: { id: project.id } });
}

async function saveStartProjectDraft(req, res) {
  const parsed = startProjectDraftSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });
  try {
    const data = await prisma.$transaction((transaction) => saveStartProjectWork(transaction, req.params.id, parsed.data, { start: false, userId: req.user.id }));
    return res.json({ data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to save start project draft:", error);
    return res.status(500).json({ message: "Unable to save draft." });
  }
}

async function startProject(req, res) {
  const parsed = startProjectSchema.safeParse(cleanData(req.body));
  // Named fields rather than "Validation failed": this endpoint now refuses for reasons the person
  // pressing Start can act on, so the reason is what it answers with.
  if (!parsed.success) return res.status(400).json({ message: validationMessage(parsed.error, "Validation failed"), errors: parsed.error.flatten() });
  try {
    /*
     * Read before the save, so the activity line can say **what** changed rather than that something
     * did. One query, and only on a save that is about to happen - "he says he updated it and it is
     * not reflecting" is otherwise unanswerable from the log, which until now recorded that a request
     * succeeded and nothing about its contents.
     */
    const before = await prisma.salesProject.findUnique({ where: { id: req.params.id } });
    const data = await prisma.$transaction((transaction) => saveStartProjectWork(transaction, req.params.id, parsed.data, { start: true, userId: req.user.id }));
    const changes = fieldChanges(before, parsed.data);
    describeChanges(req, changes);
    await logProjectActivity({
      projectId: req.params.id,
      area: "PROJECT",
      action: "PROJECT_SAVED",
      // The fields where there are some, so the project's own tab reads as the admin log does.
      detail: changes.length ? changes.join(" · ") : "Project details saved (Start / Edit Project)",
      userId: Number(req.user.id),
    });
    return res.json({ data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to start project:", error);
    return res.status(500).json({ message: "Unable to start project." });
  }
}

async function listProjectShoots(req, res) {
  try {
    const project = await prisma.salesProject.findFirst({ where: { id: req.params.id, deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id) })] }, select: { id: true } });
    if (!project) return res.status(404).json({ message: "Project not found." });
    const data = await prisma.projectShoot.findMany({
      where: { projectId: project.id, deletedAt: null },
      orderBy: [{ dateCreated: SHOOT_DATE_ASC }, { createdAt: "asc" }],
    });
    return res.json({ data });
  } catch (error) {
    console.error("Unable to load project shoots:", error);
    return res.status(500).json({ message: "Unable to load project shoots." });
  }
}

/**
 * What the project has taken in and what it has paid out, as the Payments tab of the project panel
 * reads it.
 *
 * The rows are Accounts' own cash entries filed against this project — money in for the project as
 * a whole, money out per shoot — rather than a second set of figures Projects keeps for itself. A
 * payment recorded once in Accounts is therefore the payment Projects shows, and the read is
 * read-only for that reason: entering or correcting one is ACCOUNTS / Cash Management's job, and
 * asks for that permission.
 *
 * Withdrawn entries are left out. A withdrawn entry is money the project never had, so counting it
 * would make the summary here disagree with the Accounts Manager it is drawn from.
 *
 * The project comes back beside its entries in the shape the cash entry form's own project picker
 * uses. Recording a payment from this tab has to arrive at that form with the project already
 * filled in, and the form's picker holds only the most recent projects — so the one being read is
 * handed over rather than looked for in a list it may have aged out of.
 */
/** A project's Accounts status, from its scheduled payments. */
async function accountsOf(projectId) {
  const schedule = await projectSchedule(projectId);
  return { accountsStatus: projectAccountsStatus(schedule.map((payment) => payment.status)) };
}

/**
 * Send Back: the project returned from Projects to Bookings & Converted to be corrected.
 *
 * The project itself, not a copy: its id, shoots, quotation, payments and history stay as they are.
 * It is marked sent back - when and by whom - which lists it under Bookings & Converted's Sent Back
 * tab and leaves it off the Projects page until its sale details are next edited and saved there
 * (`updateProject` clears it). One conditional write, so a second Send Back - two people, or one
 * double-click - finds it already sent back and is told so rather than writing twice. Only a project
 * in the sender's reach (`projectAccessWhere`, for a write) can be sent back.
 */
async function sendBackProject(req, res) {
  try {
    const project = await prisma.salesProject.findFirst({
      where: { id: req.params.id, deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id), forWrite: true })] },
      select: { id: true, sentBackAt: true },
    });
    if (!project) return res.status(404).json({ message: "Project not found." });
    const { count } = await prisma.salesProject.updateMany({
      where: { id: project.id, deletedAt: null, sentBackAt: null },
      data: { sentBackAt: new Date(), sentBackByUserId: Number(req.user.id) || null },
    });
    if (!count) return res.status(409).json({ message: "This project has already been sent back to Bookings & Converted." });
    await logProjectActivity({ projectId: project.id, area: "PROJECT", action: "SENT_BACK", detail: "Sent back to Bookings & Converted", userId: Number(req.user.id) });
    const data = await prisma.salesProject.findUnique({ where: { id: project.id }, select: { id: true, sentBackAt: true, sentBackByUserId: true } });
    return res.json({ data });
  } catch (error) {
    console.error("Unable to send the project back:", error);
    return res.status(500).json({ message: "Unable to send the project back." });
  }
}

/**
 * Update to Project on a sent-back project whose form was not changed: nothing to save, only the
 * return - `RETURNED_TO_PROJECTS`, as `updateProject` writes it when there is. Guarded as the edit is
 * (the route), for a project in the caller's reach, in one conditional write, so a second click - or
 * somebody else returning it first - is told so rather than written twice.
 */
async function returnToProjects(req, res) {
  try {
    const project = await prisma.salesProject.findFirst({
      where: { id: req.params.id, deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id), forWrite: true })] },
      select: { id: true },
    });
    if (!project) return res.status(404).json({ message: "Project not found." });
    const { count } = await prisma.salesProject.updateMany({ where: { id: project.id, deletedAt: null, sentBackAt: { not: null } }, data: RETURNED_TO_PROJECTS });
    if (!count) return res.status(409).json({ message: "This project is no longer sent back - it is already on Projects." });
    await logProjectActivity({ projectId: project.id, area: "PROJECT", action: "SEND_BACK_RESOLVED", detail: RETURNED_TO_PROJECTS_DETAIL, userId: Number(req.user.id) });
    const data = await prisma.salesProject.findUnique({ where: { id: project.id }, select: { id: true, sentBackAt: true, projectStatus: true } });
    return res.json({ data });
  } catch (error) {
    console.error("Unable to return the project to Projects:", error);
    return res.status(500).json({ message: "Unable to return the project to Projects." });
  }
}

async function listProjectPayments(req, res) {
  try {
    const project = await prisma.salesProject.findFirst({
      where: { id: req.params.id, deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id) })] },
      select: { id: true, eventId: true, whatsappGroupNameId: true, whatsappGroupName: true, projectStatus: true, mainEventDate: true, sourceBranch: true, crmName: true, initialConvertedValue: true, projectManagerEmployeeId: true, projectManager: true },
    });
    if (!project) return res.status(404).json({ message: "Project not found." });
    const clientNames = await projectClientNames([project]);
    const entries = await prisma.cashEntry.findMany({
      where: { projectId: project.id, deletedAt: null },
      select: {
        id: true,
        entryId: true,
        entryType: true,
        category: true,
        description: true,
        amount: true,
        entryDate: true,
        paymentMode: true,
        paidTo: true,
        shoot: { select: { shootId: true, shoot: true } },
      },
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
    });
    /*
     * The extra work agreed on this project: extra quotation requests its manager has approved.
     *
     * Read from the extra quotations themselves rather than kept a second time here — an extra is
     * agreed once, where it was asked for, and this tab reports that record rather than a copy of
     * it. Only approved ones count: one still waiting is a proposal, not an extra.
     */
    const extraRows = await prisma.projectExtraQuotation.findMany({
      where: { projectId: project.id, status: { in: ["PENDING", "APPROVED"] }, deletedAt: null },
      select: {
        id: true,
        requestCode: true,
        service: true,
        remarks: true,
        amount: true,
        status: true,
        shootId: true,
        requestedByName: true,
        decidedAt: true,
        createdAt: true,
        proof: true,
        shoot: { select: { shootId: true, shoot: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    const toExtra = (extra) => ({
      id: extra.id,
      requestCode: extra.requestCode,
      // Enough to open the edit form on it without a second read: which project and shoot it is
      // filed against, named as the form's own pickers name them.
      projectId: project.id,
      projectCode: project.eventId,
      projectName: project.whatsappGroupName || "",
      shootId: extra.shootId || null,
      service: extra.service,
      remarks: extra.remarks || "",
      addedBy: extra.requestedByName,
      shootCode: extra.shoot?.shootId || "",
      shootName: extra.shoot?.shoot || "",
      status: extra.status,
      raisedAt: extra.createdAt,
      approvedAt: extra.decidedAt || extra.createdAt,
      proofUrls: fileUrls(extra.proof),
      amount: Number(extra.amount),
    });
    // Approved ones are the project's extras and are what the summary totals. The ones still
    // waiting travel beside them rather than among them: they are proposals, and showing them in
    // the same list would read as work the studio has agreed to.
    const extras = extraRows.filter((extra) => extra.status === "APPROVED").map(toExtra);
    const pendingExtras = extraRows.filter((extra) => extra.status === "PENDING").map(toExtra);

    /*
     * Whether the person reading this may decide those pending ones — the manager named on this
     * project, or a super admin. The screen shows the Approve and Reject controls only to somebody
     * this answers yes for, so nobody is offered a decision the server would refuse.
     */
    const account = await prisma.user.findUnique({ where: { id: Number(req.user.id) }, select: { role: true, linkedEmployeeId: true } });
    const canDecideExtras = account?.role === "SUPER_ADMIN"
      || (Boolean(project.projectManagerEmployeeId) && project.projectManagerEmployeeId === account?.linkedEmployeeId);

    const rows = entries.map(({ shoot, amount, ...entry }) => ({
      ...entry,
      amount: Number(amount),
      shootCode: shoot?.shootId || "",
      shootName: shoot?.shoot || "",
    }));
    const received = rows.filter((row) => row.entryType === "Received");
    const spent = rows.filter((row) => row.entryType === "Spent");
    const total = (items) => items.reduce((sum, row) => sum + row.amount, 0);
    const totalReceived = total(received);
    const totalSpent = total(spent);
    /*
     * What was sold, and what was agreed on top of it.
     *
     * The quotation is the project's Initial Converted Value — the figure the sale was converted
     * at. Extra is the total of the extra work its manager has approved, which is agreed work
     * whether or not the money has arrived yet: an add-on shoot approved today counts from today,
     * and the receipt for it turns up whenever the client pays.
     *
     * It was briefly the cash taken above the quotation, which is a different question — that
     * figure moved when somebody paid rather than when the studio agreed to the work, and read as
     * an extra on a project that had merely been paid early.
     */
    const totalQuotation = Number(project.initialConvertedValue || 0);
    const totalExtra = extras.reduce((sum, extra) => sum + extra.amount, 0);
    // The published Sale Extras (Edit Sale Details' Extra section), beside the approved extras.
    const totalSaleExtras = await saleExtrasTotals.publishedSaleExtrasTotal(project.id);
    /*
     * What the project is now signed for: the figure it was sold at plus every extra its manager
     * has approved. Added here rather than left to the screen to add up, so the one figure the
     * studio quotes back to a client has a single definition — and so it can never disagree with
     * the two rows it is made of. Extras still waiting are not in it: nobody has agreed them yet.
     */
    const totalSigned = totalQuotation + totalExtra + totalSaleExtras;
    return res.json({ data: {
      project: {
        id: project.id,
        eventId: project.eventId,
        clientName: clientNameOf(project, clientNames),
        projectStatus: project.projectStatus,
        mainEventDate: project.mainEventDate,
        sourceBranch: project.sourceBranch,
        crmName: project.crmName,
      },
      extras,
      pendingExtras,
      canDecideExtras,
      projectManager: project.projectManager || "",
      received,
      spent,
      // The two totals and no figure derived from them: the tab shows what moved, and what the
      // project made is a question for Accounts, who know what else it cost.
      // The project's Accounts status, from its scheduled payments - shown above the signed quotation.
      ...(await accountsOf(project.id)),
      summary: { totalQuotation, totalExtra, totalSaleExtras, totalSigned, totalReceived, totalSpent },
    } });
  } catch (error) {
    console.error("Unable to load project payments:", error);
    return res.status(500).json({ message: "Unable to load project payments." });
  }
}

async function createProjectShoots(req, res) {
  const parsed = projectShootsSchema.safeParse(req.body?.shoots);
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });

  try {
    const data = await prisma.$transaction(async (transaction) => {
      // The vertical and the branch come with it: a shoot's identifier is its project's, and
      // selecting the id alone would silently file every shoot added here under Dum Dum / Erode.
      const project = await transaction.salesProject.findFirst({ where: { id: req.params.id, deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id), forWrite: true })] }, select: { id: true, vertical: true, sourceBranch: true } });
      if (!project) {
        const error = new Error("Project not found.");
        error.status = 404;
        throw error;
      }
      const shootsToCreate = [];
      for (const shoot of parsed.data) {
        shootsToCreate.push({ ...projectShootData(shoot), projectId: project.id, shootId: await nextShootId(transaction, project) });
      }
      const createdShoots = [];
      for (const shoot of shootsToCreate) {
        const createdShoot = await transaction.projectShoot.create({ data: shoot });
        await syncProjectMainEvent(transaction, project.id, createdShoot);
        createdShoots.push(createdShoot);
      }
      // A started project that wants storage but had no shoots yet gets its record now, or has
      // its existing record pointed at the shoot that just appeared.
      await ensureProjectClientStorage(transaction, project.id, { userId: req.user.id });
      // Each new shoot is a new row on the pre production board, so a shoot added months later
      // reaches its coordinator the same way the first ones did.
      await ensureProjectPreProduction(transaction, project.id, { userId: req.user.id });
      await ensureProjectProduction(transaction, project.id);
      return createdShoots;
    });
    await logProjectActivity({ projectId: req.params.id, area: "PROJECT", action: "SHOOTS_ADDED", detail: `Shoots added: ${(Array.isArray(data) ? data : []).map((shoot) => [shoot.shootId, shoot.shoot].filter(Boolean).join(" ")).join(", ") || "-"}`, userId: Number(req.user.id) });
    return res.status(201).json({ data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to save project shoots:", error);
    return res.status(500).json({ message: "Unable to save project shoots." });
  }
}

async function updateProjectShoot(req, res) {
  const parsed = projectShootSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });

  try {
    const data = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.projectShoot.findFirst({
        where: { id: req.params.shootId, projectId: req.params.id, deletedAt: null },
        select: { id: true, dateCreated: true },
      });
      if (!existing) {
        const error = new Error("Shoot not found for this project.");
        error.status = 404;
        throw error;
      }
      const updatedShoot = await transaction.projectShoot.update({
        where: { id: existing.id },
        data: {
          ...projectShootData(parsed.data),
        },
      });
      await syncProjectMainEvent(transaction, req.params.id, updatedShoot);
      return updatedShoot;
    });
    await logProjectActivity({ projectId: req.params.id, shootId: req.params.shootId, area: "PROJECT", action: "SHOOT_EDITED", detail: "Shoot details saved", userId: Number(req.user.id) });
    return res.json({ data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to update project shoot:", error);
    return res.status(500).json({ message: "Unable to update project shoot." });
  }
}

async function deleteProjectShoot(req, res) {
  try {
    const shoot = await prisma.projectShoot.findFirst({ where: { id: req.params.shootId, projectId: req.params.id, deletedAt: null }, select: { id: true } });
    if (!shoot) return res.status(404).json({ message: "Shoot not found for this project." });
    // The shoot's Image Selection footprint goes with it: its root folder, subfolders, photo
    // rows, selections and R2 derivatives — never the originals on the studio's own storage.
    // Cleaned BEFORE the soft delete, and strictly: a bucket failure aborts the whole request
    // with the shoot still standing, so retrying the delete retries the cleanup. Without this,
    // the folder lingered forever — undeletable, its derivatives orphaned in the bucket.
    // A shoot whose gallery holds client-SUBMITTED selections answers 409 with the counts until
    // the caller acknowledges the high-impact warning (`acknowledgeSubmitted=true`).
    await imageSelectionFolders.removeForShoot(req.params.shootId, { acknowledgeSubmitted: req.query.acknowledgeSubmitted === "true" });
    const data = await prisma.$transaction(async (transaction) => {
      const result = await transaction.projectShoot.updateMany({
        where: { id: req.params.shootId, projectId: req.params.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (result.count !== 1) {
        const error = new Error("Shoot not found for this project.");
        error.status = 404;
        throw error;
      }
      await transaction.projectShootDeliverable.updateMany({ where: { projectId: req.params.id, shootId: req.params.shootId, deletedAt: null }, data: { deletedAt: new Date() } });
      await transaction.projectPostProductionAllocation.updateMany({ where: { projectId: req.params.id, shootId: req.params.shootId, deletedAt: null }, data: { deletedAt: new Date() } });
      await transaction.projectPostProductionWorkflowAllocation.updateMany({ where: { projectId: req.params.id, shootId: req.params.shootId, deletedAt: null }, data: { deletedAt: new Date() } });
      await syncProjectMainEvent(transaction, req.params.id, null);
      return { message: "Shoot deleted successfully." };
    });
    await logProjectActivity({ projectId: req.params.id, shootId: req.params.shootId, area: "PROJECT", action: "SHOOT_REMOVED", detail: "Shoot removed", userId: Number(req.user.id) });
    return res.json(data);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message, ...(error.details ? { details: error.details } : {}) });
    console.error("Unable to delete project shoot:", error);
    return res.status(500).json({ message: "Unable to delete project shoot." });
  }
}

/*
 * A project's lines, shoot by shoot, in the order they were dragged to - and, for lines nobody has
 * dragged (`sortOrder` NULL), the order they were added in, after the ones that were.
 */
const PROJECT_LINE_ORDER = [{ shoot: { dateCreated: SHOOT_DATE_ASC } }, { sortOrder: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }];

async function listProductionDeliverables(req, res) {
  try {
    const project = await prisma.salesProject.findFirst({ where: { id: req.params.id, deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id) })] }, select: { id: true } });
    if (!project) return res.status(404).json({ message: "Project not found." });
    const data = await prisma.projectShootDeliverable.findMany({
      where: { projectId: project.id, deletedAt: null },
      include: { shoot: { select: { id: true, shootId: true, shoot: true, dateCreated: true, shootPlace: true, shootType: true, shootTypes: true, isMainEvent: true, district: true, state: true, sessionTiming: true, sessionTimings: true, sessionDurationHours: true, sessionDurationMinutes: true } } },
      orderBy: PROJECT_LINE_ORDER,
    });
    return res.json({ data });
  } catch (error) {
    console.error("Unable to load production deliverables:", error);
    return res.status(500).json({ message: "Unable to load production deliverables." });
  }
}

async function replaceProductionDeliverables(req, res) {
  const parsed = productionDeliverablesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });

  try {
    const data = await prisma.$transaction(async (transaction) => {
      // The vertical and the branch come with it: a shoot's identifier is its project's, and
      // selecting the id alone would silently file every shoot added here under Dum Dum / Erode.
      const project = await transaction.salesProject.findFirst({ where: { id: req.params.id, deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id), forWrite: true })] }, select: { id: true, vertical: true, sourceBranch: true } });
      if (!project) {
        const error = new Error("Project not found.");
        error.status = 404;
        throw error;
      }
      const shootIds = [...new Set(parsed.data.items.map((item) => item.shootId))];
      const shoots = await transaction.projectShoot.findMany({ where: { id: { in: shootIds }, projectId: project.id, deletedAt: null }, select: { id: true } });
      if (shoots.length !== shootIds.length) {
        const error = new Error("One or more selected shoots do not belong to this project.");
        error.status = 400;
        throw error;
      }
      await syncProjectShootDeliverables(transaction, project.id, parsed.data.items);
      return transaction.projectShootDeliverable.findMany({
        where: { projectId: project.id, deletedAt: null },
        include: { shoot: { select: { id: true, shootId: true, shoot: true, dateCreated: true, shootPlace: true, shootType: true, shootTypes: true, isMainEvent: true, district: true, state: true, sessionTiming: true, sessionTimings: true, sessionDurationHours: true, sessionDurationMinutes: true } } },
        orderBy: PROJECT_LINE_ORDER,
      });
    });
    await logProjectActivity({ projectId: req.params.id, area: "PROJECT", action: "DELIVERABLES_UPDATED", detail: "Production deliverables saved", userId: Number(req.user.id) });
    return res.json({ data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to save production deliverables:", error);
    return res.status(500).json({ message: "Unable to save production deliverables." });
  }
}

// `DEFINITION_ORDER` (services/definitionOrder.js): the order Settings drags the rows into. A new
// or restored row is given the next number, so it lands at the end.
async function listServiceDefinitions(req, res) {
  try {
    const data = await prisma.projectServiceDefinition.findMany({
      where: { isActive: true },
      include: serviceDefinitionInclude,
      orderBy: DEFINITION_ORDER,
    });
    return res.json({ data: await withPricedSizeOptions(data) });
  } catch (error) {
    console.error("Unable to load service definitions:", error);
    return res.status(500).json({ message: "Unable to load service definitions." });
  }
}

/*
 * `{ ids }`: the active services, or deliverables, in their new order - what Settings sends after a
 * row is dragged. Only the order is written; nothing else about a row changes.
 *
 * Ids that are not active rows are ignored, and active rows the list left out keep their place
 * after the ones it named, so a list read before somebody else added a row cannot lose it or push
 * it out of order. Written in one transaction, so the order is never half saved.
 */
const definitionOrderSchema = z.object({ ids: z.array(z.string().trim().min(1).max(191)).max(1000) });

/** The full order to write: the ids sent that are active rows, then every active row left out, as it was. */
function orderedDefinitionIds(activeIds, sentIds) {
  const known = new Set(activeIds);
  const named = [...new Set(sentIds)].filter((id) => known.has(id));
  const sent = new Set(named);
  return [...named, ...activeIds.filter((id) => !sent.has(id))];
}

function definitionReorder(model, label) {
  return async function reorderDefinitions(req, res) {
    const parsed = definitionOrderSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ message: "Send the ids in their new order." });
    try {
      const rows = await model().findMany({ where: { isActive: true }, select: { id: true }, orderBy: DEFINITION_ORDER });
      const ordered = orderedDefinitionIds(rows.map((row) => row.id), parsed.data.ids);
      await prisma.$transaction(ordered.map((id, index) => model().update({ where: { id }, data: { sortOrder: index } })));
      return res.json({ message: "Order saved." });
    } catch (error) {
      console.error(`Unable to reorder ${label}:`, error);
      return res.status(500).json({ message: `Unable to save the order of the ${label}.` });
    }
  };
}

const reorderServiceDefinitions = definitionReorder(() => prisma.projectServiceDefinition, "services");
const reorderDeliverableDefinitions = definitionReorder(() => prisma.projectDeliverableDefinition, "deliverables");

async function listProjectOptionSets(req, res) {
  try {
    const data = await prisma.projectOptionSet.findMany({
      where: { isActive: true },
      include: { values: { where: { isActive: true }, orderBy: [{ label: "asc" }] } },
      orderBy: [{ name: "asc" }],
    });
    return res.json({ data });
  } catch (error) {
    console.error("Unable to load project option sets:", error);
    return res.status(500).json({ message: "Unable to load project option sets." });
  }
}

async function createProjectOptionSetValue(req, res) {
  const parsed = optionSetValueCreateSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Enter a valid option value." });
  const label = parsed.data.label.trim();
  const code = codeFor("OPTION", label);
  try {
    const optionSet = await validateOptionSet(prisma, req.params.optionSetId, "Option set not found.");
    const existing = await prisma.projectOptionSetValue.findFirst({
      where: { optionSetId: optionSet, OR: [{ code }, { label }] },
    });
    if (existing) {
      if (!existing.isActive) {
        const data = await prisma.projectOptionSetValue.update({
          where: { id: existing.id },
          data: {
            label,
            value: label,
            isActive: true,
            ...(parsed.data.pricePerQuantity === undefined ? {} : { pricePerQuantity: parsed.data.pricePerQuantity }),
            ...(parsed.data.sortOrder === undefined ? {} : { sortOrder: parsed.data.sortOrder }),
          },
        });
        return res.status(200).json({ data, message: "Option restored successfully." });
      }
      return res.status(409).json({ message: "This option already exists." });
    }
    /*
     * The given position, or the end of the list.
     *
     * The aggregate is only needed for the fallback, so it is skipped when a position was given -
     * and a given position is honoured rather than quietly replaced by the append, which is what
     * used to happen: the dialog offers a Sort Order box, and a number typed into it vanished.
     */
    let sortOrder = parsed.data.sortOrder;
    if (sortOrder === undefined) {
      const max = await prisma.projectOptionSetValue.aggregate({
        where: { optionSetId: optionSet },
        _max: { sortOrder: true },
      });
      sortOrder = (max._max.sortOrder || 0) + 1;
    }
    const data = await prisma.projectOptionSetValue.create({
      data: {
        optionSetId: optionSet,
        code,
        label,
        value: label,
        sortOrder,
        // Carried on the create, so a size added with a price does not have to be edited to keep it.
        pricePerQuantity: parsed.data.pricePerQuantity ?? null,
      },
    });
    return res.status(201).json({ data, message: "Option added successfully." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to add option set value:", error);
    return res.status(500).json({ message: "Unable to add option." });
  }
}

async function updateProjectOptionSetValue(req, res) {
  const parsed = optionSetValueUpdateSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Enter valid option settings." });
  const input = parsed.data;
  try {
    await validateOptionSet(prisma, req.params.optionSetId, "Option set not found.");
    const existing = await prisma.projectOptionSetValue.findFirst({
      where: { id: req.params.valueId, optionSetId: req.params.optionSetId, isActive: true },
    });
    if (!existing) return res.status(404).json({ message: "Option value not found." });
    const data = { ...input };
    if (input.label) {
      data.code = codeFor("OPTION", input.label);
      data.value = input.label;
    }
    const updated = await prisma.projectOptionSetValue.update({ where: { id: existing.id }, data });
    return res.json({ data: updated, message: "Option saved successfully." });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ message: "This option already exists." });
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to update option set value:", error);
    return res.status(500).json({ message: "Unable to update option." });
  }
}

async function createServiceDefinition(req, res) {
  const parsed = masterDefinitionSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Enter a valid service name." });
  const name = parsed.data.name.trim();
  const code = codeFor("SERVICE", name);
  try {
    const existing = await prisma.projectServiceDefinition.findFirst({
      where: { OR: [{ name }, { code }] },
      include: serviceDefinitionInclude,
    });
    if (existing) {
      if (!existing.isActive) {
        // Back at the end of the list, as a new row would be, rather than wherever it once stood.
        const max = await prisma.projectServiceDefinition.aggregate({ _max: { sortOrder: true } });
        const data = await prisma.projectServiceDefinition.update({
          where: { id: existing.id },
          data: { name, code, isActive: true, sortOrder: (max._max.sortOrder || 0) + 1 },
          include: serviceDefinitionInclude,
        });
        return res.status(200).json({ data, message: "Service restored successfully." });
      }
      return res.status(409).json({ message: "This service already exists." });
    }
    const max = await prisma.projectServiceDefinition.aggregate({ _max: { sortOrder: true } });
    const data = await prisma.projectServiceDefinition.create({
      data: {
        code,
        name,
        quantityMode: "NONE",
        timingMode: "NONE",
        // No note to begin with: Remarks is written, not answered, so a new service starts blank.
        sortOrder: (max._max.sortOrder || 0) + 1,
      },
      include: serviceDefinitionInclude,
    });
    return res.status(201).json({ data, message: "Service added successfully." });
  } catch (error) {
    // Two adds of one name at once both pass the check above; the unique name and code columns
    // refuse the second, and it is said as the same refusal rather than as a failure.
    if (error?.code === "P2002") return res.status(409).json({ message: "This service already exists." });
    console.error("Unable to add service definition:", error);
    return res.status(500).json({ message: "Unable to add service." });
  }
}

/**
 * Retires a service, rather than removing it.
 *
 * `isActive: false` is already how this table means "gone" - every lookup filters on it, and
 * creating a service by the same name restores it, which is why that path answers "Service restored
 * successfully". The endpoint was simply missing.
 *
 * A hard delete would be worse than missing. `ProjectPostProductionAllocation.serviceDefinitionId`
 * points here with `onDelete: SetNull`, so removing the row would quietly blank the service on every
 * project that had already used it - the history of finished work, edited to say the work had no
 * service. Retiring keeps those projects intact and takes the service out of every list from now on.
 */
async function deleteServiceDefinition(req, res) {
  try {
    const existing = await prisma.projectServiceDefinition.findFirst({ where: { id: req.params.definitionId, isActive: true } });
    if (!existing) return res.status(404).json({ message: "Service not found." });
    await prisma.projectServiceDefinition.update({ where: { id: existing.id }, data: { isActive: false } });
    return res.json({ message: "Service removed successfully." });
  } catch (error) {
    console.error("Unable to remove service definition:", error);
    return res.status(500).json({ message: "Unable to remove service." });
  }
}

/**
 * Retires a deliverable, the way a service is retired.
 *
 * Marked inactive rather than deleted: the projects that already used it keep it, and re-adding the
 * same name restores this row instead of creating a second one with the same spelling.
 */
async function deleteDeliverableDefinition(req, res) {
  try {
    const existing = await prisma.projectDeliverableDefinition.findFirst({ where: { id: req.params.definitionId, isActive: true } });
    if (!existing) return res.status(404).json({ message: "Deliverable not found." });
    await prisma.projectDeliverableDefinition.update({ where: { id: existing.id }, data: { isActive: false } });
    return res.json({ message: "Deliverable removed successfully." });
  } catch (error) {
    console.error("Unable to remove deliverable definition:", error);
    return res.status(500).json({ message: "Unable to remove deliverable." });
  }
}

/**
 * Retires one value from a size option set.
 *
 * Inactive rather than deleted, and for a harder reason than the definitions: an option value is
 * pointed at by the service and deliverable allocations that chose it, so deleting it would blank
 * the size on work already done. `activeOptionValues` on the browser side already filters these
 * out of the pickers, so a retired value stops being offered while the rows that used it still read
 * correctly.
 */
async function deleteProjectOptionSetValue(req, res) {
  try {
    const existing = await prisma.projectOptionSetValue.findFirst({
      where: { id: req.params.valueId, optionSetId: req.params.optionSetId, isActive: true },
    });
    if (!existing) return res.status(404).json({ message: "Option value not found." });
    await prisma.projectOptionSetValue.update({ where: { id: existing.id }, data: { isActive: false } });
    return res.json({ message: "Option value removed successfully." });
  } catch (error) {
    console.error("Unable to remove option set value:", error);
    return res.status(500).json({ message: "Unable to remove option value." });
  }
}

async function updateServiceDefinition(req, res) {
  const parsed = serviceDefinitionUpdateSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Enter valid service settings." });
  const input = parsed.data;
  try {
    const existing = await prisma.projectServiceDefinition.findFirst({ where: { id: req.params.definitionId, isActive: true } });
    if (!existing) return res.status(404).json({ message: "Service not found." });
    const data = { ...input };
    if (input.name) data.code = codeFor("SERVICE", input.name);
    // The note, as words. A boolean from a caller that predates this is written out as the Yes or
    // No it meant, and a note cleared to nothing is stored as null.
    if (input.remarksEnabled !== undefined) data.remarksEnabled = deliverableAnswerText(input.remarksEnabled) || null;

    /*
     * The list is the authority; the single mode is kept in step with it.
     *
     * Everything that only knows about one timing - the quotation calculator, older rows - reads
     * `timingMode`, so it is always the first of the list rather than something that can disagree
     * with it. Deduplicated here rather than trusted from the form.
     */
    if (Array.isArray(input.timingModes)) {
      const unique = [...new Set(input.timingModes)];
      data.timingModes = unique;
      data.timingMode = unique[0] || "NONE";
    }

    /*
     * The same for quantity, in the other direction: the number is what a person fills in, and the
     * mode follows from whether there is one. Keeping both in step means nothing downstream has to
     * learn about the new column to keep working.
     */
    if (input.defaultQuantity !== undefined) {
      data.quantityMode = input.defaultQuantity === null ? "NONE" : "INTEGER";
    }

    /*
     * A timing option set only means anything for a service booked by the session, and now that a
     * service can name several timings the test is whether the list contains that one - not whether
     * it is the only one.
     */
    const timings = Array.isArray(data.timingModes) ? data.timingModes : [data.timingMode ?? existing.timingMode];
    if (!timings.some((mode) => SESSION_TIMING_MODES.includes(mode))) data.timingOptionSetId = null;
    /*
     * Every brand-and-variant a mapping may name, read once for the save and only when something
     * is being mapped. There is no foreign key behind a mapping - it rides in JSON - so an id naming
     * nothing, or a variant named under a brand that does not hold it, is dropped here rather than
     * stored, and a variant deleted in Settings cannot leave a service quoting what is not sold.
     */
    const bringsDeliverables = input.deliverableAdded !== undefined ? input.deliverableAdded === true : existing.deliverableAdded === true;
    const offeredVariants = new Set();
    if (bringsDeliverables && (Array.isArray(input.pricing) || Array.isArray(input.deliverables))) {
      const definitions = await prisma.projectDeliverableDefinition.findMany({
        where: { isActive: true },
        select: { id: true, brands: { select: { id: true, variants: { select: { id: true } } } } },
      });
      for (const definition of definitions) {
        for (const brand of definition.brands) {
          for (const variant of brand.variants) offeredVariants.add(`${definition.id}::${brand.id}::${variant.id}`);
        }
      }
    }
    // A service or a booking brings a variant once; asking for it twice is one line, not two.
    const offeredOnce = (entries) => {
      const seenVariants = new Set();
      return (entries || []).filter((entry) => {
        const key = `${entry.deliverableId}::${entry.brandId}::${entry.variantId}`;
        if (seenVariants.has(key) || !offeredVariants.has(key)) return false;
        seenVariants.add(key);
        return true;
      });
    };
    /*
     * The service's own list. A service answered No stores none, so turning the question off is
     * what takes the list out rather than leaving it stored and invisible.
     */
    if (!bringsDeliverables && (input.deliverableAdded === false || Array.isArray(input.deliverables))) data.deliverables = [];
    else if (Array.isArray(input.deliverables)) data.deliverables = offeredOnce(input.deliverables);

    /*
     * The pricing lines are the studio's own list and are not tied to the service's shoot type or
     * timings above - a studio service may carry an outdoor price. Three rules hold whatever the
     * form sent: Hours / Minutes is a studio timing, so an outdoor hourly row is dropped; an hourly
     * row prices a stated number of hours, so one without them is dropped and a session row
     * carries none; and a booking is priced once, so a second row for the same shoot type, timing
     * and hours is dropped. A row with no figure is not a price.
     */
    /*
     * A service sold by size keeps the size as typed on each row and, where the words name an
     * entry of one of the studio's service size lists (by label, whatever the case), that entry's
     * id beside them - which is what lets a project or quotation line offer the size in its picker.
     * A row with no size is not a booking on such a service; a booking is priced once per size. A
     * service not sold by size carries no size on its rows at all.
     */
    if (Array.isArray(input.pricing)) {
      const sized = input.sizeEnabled !== undefined ? input.sizeEnabled : existing.sizeEnabled === true;
      // The variants a booking carried, kept only where the service says it brings any.
      const mappedDeliverables = (row) => {
        if (!bringsDeliverables) return {};
        const kept = offeredOnce(row.deliverables);
        return kept.length ? { deliverables: kept } : {};
      };
      const sizeValues = sized
        ? await prisma.projectOptionSetValue.findMany({
          where: { isActive: true, optionSet: { isActive: true, code: { startsWith: "SERVICE_", contains: "SIZE" } } },
          select: { id: true, label: true, value: true, optionSetId: true },
        })
        : [];
      const fold = (text) => String(text || "").trim().toLowerCase();
      const seen = new Set();
      let firstSet = null;
      data.pricing = input.pricing.flatMap((row) => {
        const hourly = row.timingMode === "HOURS_MINUTES";
        if (row.price === null) return [];
        if (hourly && (row.shootType !== "STUDIO" || !row.hours)) return [];
        let sizeFields = {};
        let sizeKey = "";
        if (sized) {
          const size = String(row.size || "").trim();
          const matched = sizeValues.find((value) => value.id === row.sizeOptionValueId)
            || sizeValues.find((value) => fold(value.label) === fold(size) || fold(value.value) === fold(size))
            || null;
          if (!size && !matched) return [];
          if (row.sizeOptionValueId && !matched) return [];
          firstSet ??= matched?.optionSetId || null;
          sizeFields = { size: size || matched.label, ...(matched ? { sizeOptionValueId: matched.id } : {}) };
          sizeKey = `:${matched ? matched.id : fold(size)}`;
        }
        const key = (hourly ? `${row.shootType}:${row.timingMode}:${row.hours}` : `${row.shootType}:${row.timingMode}`) + sizeKey;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ shootType: row.shootType, timingMode: row.timingMode, ...(hourly ? { hours: row.hours } : { duration: row.duration || null }), ...sizeFields, price: row.price, ...mappedDeliverables(row) }];
      });
      // The list the line pickers read, pointed at the first list a priced size came from.
      if (sized && firstSet) data.sizeOptionSetId = firstSet;
    }
    if (input.timingOptionSetId) await validateOptionSet(prisma, input.timingOptionSetId, "Select a valid timing option set.");
    if (input.sizeOptionSetId) await validateOptionSet(prisma, input.sizeOptionSetId, "Select a valid size option set.");
    const updated = await prisma.projectServiceDefinition.update({
      where: { id: existing.id },
      data,
      include: serviceDefinitionInclude,
    });
    return res.json({ data: updated, message: "Service settings saved successfully." });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ message: "This service already exists." });
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to update service definition:", error);
    return res.status(500).json({ message: "Unable to update service." });
  }
}

async function listDeliverableDefinitions(req, res) {
  try {
    const data = await prisma.projectDeliverableDefinition.findMany({
      where: { isActive: true },
      include: deliverableDefinitionInclude,
      orderBy: DEFINITION_ORDER,
    });
    return res.json({ data: await withPricedSizeOptions(data) });
  } catch (error) {
    console.error("Unable to load deliverable definitions:", error);
    return res.status(500).json({ message: "Unable to load deliverable definitions." });
  }
}

async function createDeliverableDefinition(req, res) {
  const parsed = masterDefinitionSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Enter a valid deliverable name." });
  const name = parsed.data.name.trim();
  const code = codeFor("DELIVERABLE", name);
  try {
    const existing = await prisma.projectDeliverableDefinition.findFirst({
      where: { OR: [{ name }, { code }] },
      include: deliverableDefinitionInclude,
    });
    if (existing) {
      if (!existing.isActive) {
        // Back at the end of the list, as a new row would be.
        const max = await prisma.projectDeliverableDefinition.aggregate({ _max: { sortOrder: true } });
        const data = await prisma.projectDeliverableDefinition.update({
          where: { id: existing.id },
          data: { name, code, isActive: true, sortOrder: (max._max.sortOrder || 0) + 1 },
          include: deliverableDefinitionInclude,
        });
        return res.status(200).json({ data, message: "Deliverable restored successfully." });
      }
      return res.status(409).json({ message: "This deliverable already exists." });
    }
    const max = await prisma.projectDeliverableDefinition.aggregate({ _max: { sortOrder: true } });
    const data = await prisma.projectDeliverableDefinition.create({
      data: {
        code,
        name,
        photoCountEnabled: "Yes",
        remarksEnabled: "Yes",
        sortOrder: (max._max.sortOrder || 0) + 1,
      },
      include: deliverableDefinitionInclude,
    });
    return res.status(201).json({ data, message: "Deliverable added successfully." });
  } catch (error) {
    // Two adds of one name at once both pass the check above; the unique name and code columns
    // refuse the second, and it is said as the same refusal rather than as a failure.
    if (error?.code === "P2002") return res.status(409).json({ message: "This deliverable already exists." });
    console.error("Unable to add deliverable definition:", error);
    return res.status(500).json({ message: "Unable to add deliverable." });
  }
}

async function updateDeliverableDefinition(req, res) {
  const parsed = deliverableDefinitionUpdateSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Enter valid deliverable settings." });
  const input = parsed.data;
  try {
    const existing = await prisma.projectDeliverableDefinition.findFirst({ where: { id: req.params.definitionId, isActive: true } });
    if (!existing) return res.status(404).json({ message: "Deliverable not found." });
    const data = { ...input };
    if (input.name) data.code = codeFor("DELIVERABLE", input.name);
    /*
     * The three answers, as words. A boolean from a caller that predates this is written out as the
     * Yes or No it meant, and an answer cleared to nothing is stored as null - unanswered, which for
     * Image Selection is a real state and not the same as No.
     */
    for (const field of ["photoCountEnabled", "imageSelectionEnabled", "remarksEnabled"]) {
      if (input[field] !== undefined) data[field] = deliverableAnswerText(input[field]) || null;
    }
    // Deduplicated here rather than trusted from the form, as a service's list is.
    if (Array.isArray(input.timingModes)) data.timingModes = [...new Set(input.timingModes)];
    if (input.sizeOptionSetId) await validateOptionSet(prisma, input.sizeOptionSetId, "Select a valid size option set.");
    /*
     * Image or video, and the pricing under it - settled together, because each row only means
     * something against the media type. Every row names its kind, which has to belong to the media
     * type; an image kind's row is priced per size from that kind's own list, a full-length video's
     * per session, a teaser's or a candid's as one figure. A row the kind's shape does not call
     * for, or a repeat of a booking, is dropped rather than stored; a size not on its kind's list
     * is refused. The definition's own size list is pointed at the first priced image kind's, for
     * the screens that read one list; `kind` on the definition is no longer written.
     */
    if (input.mediaType !== undefined) {
      const mediaType = input.mediaType;
      data.mediaType = mediaType;
      data.kind = null;
      /*
       * What the type does not ask for is cleared here rather than trusted from the form: a video
       * carrying a frame size, or an image carrying a running time, would be a value no screen
       * shows and every reader of the row would have to know to ignore.
       */
      if (mediaType === "VIDEO") { data.imageSize = null; data.frameInches = null; }
      if (mediaType === "IMAGE") { data.videoLength = null; }
      if (Array.isArray(input.pricing) || input.pricing === null) {
        const rows = input.pricing || [];
        const setByKind = new Map();
        const seen = new Set();
        const kept = [];
        for (const row of rows) {
          if (row.price === null || !mediaType || !DELIVERABLE_KINDS[mediaType].includes(row.kind)) continue;
          const shape = deliverablePricingShape(row.kind);
          if (shape === "SIZE") {
            const size = String(row.size || "").trim();
            if (!size && !row.sizeOptionValueId) continue;
            if (!setByKind.has(row.kind)) {
              const set = await prisma.projectOptionSet.findFirst({
                where: { code: DELIVERABLE_SIZE_SET_CODE[row.kind], isActive: true },
                select: { id: true, values: { where: { isActive: true }, select: { id: true, label: true, value: true } } },
              });
              setByKind.set(row.kind, set || null);
            }
            const set = setByKind.get(row.kind);
            /*
             * The size is the words typed. Where they name an entry of the kind's list - by label,
             * whatever the case - the entry's id is kept beside them, so a project or quotation
             * line can offer the size in its dropdown; a size the list does not hold is kept as
             * typed and priced by its words. An id the form sent has to be a real entry of the list.
             */
            const matched = set?.values.find((value) => value.id === row.sizeOptionValueId)
              || set?.values.find((value) => [value.label, value.value].some((text) => String(text || "").trim().toLowerCase() === size.toLowerCase()))
              || null;
            if (row.sizeOptionValueId && !matched) return res.status(400).json({ message: "Select a valid size for this deliverable." });
            const label = size || matched.label;
            const key = `${row.kind}:${matched ? matched.id : label.toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            kept.push({ kind: row.kind, size: label, ...(matched ? { sizeOptionValueId: matched.id } : {}), price: row.price });
          } else if (shape === "SESSION") {
            const key = `${row.kind}:${row.timingMode}`;
            if (!row.timingMode || seen.has(key)) continue;
            seen.add(key);
            kept.push({ kind: row.kind, timingMode: row.timingMode, price: row.price });
          } else {
            if (seen.has(row.kind)) continue;
            seen.add(row.kind);
            kept.push({ kind: row.kind, price: row.price });
          }
        }
        data.pricing = mediaType ? kept : null;
        const firstSized = kept.find((row) => row.sizeOptionValueId);
        data.sizeOptionSetId = firstSized ? setByKind.get(firstSized.kind)?.id || existing.sizeOptionSetId : (mediaType === "VIDEO" ? null : existing.sizeOptionSetId);
      }
    }
    /*
     * The brands, and the five columns the deliverable itself still carries.
     *
     * The list replaces whatever the deliverable holds - it is one form's worth of answer, and a
     * brand or a variant removed on the form has to be removed here. Omitted means the caller is
     * not talking about brands at all, and the deliverable keeps every one of them.
     *
     * `brandName`, `imageSize`, `frameInches`, `videoLength` and `price` are then rewritten from
     * the first brand's first variant. They are no longer what the dialog fills in, but the CRM
     * Quotation Calculator quotes one figure per deliverable and reads them, so they have to go on
     * describing the deliverable rather than drifting into whatever it was last saved with. A
     * deliverable saved with no brands at all clears them, which is what having no brands means.
     */
    const brands = input.brands === undefined ? undefined : deliverableBrandsForSave(input.brands, data.mediaType !== undefined ? data.mediaType : existing.mediaType);
    delete data.brands;
    if (brands !== undefined) {
      const [first] = brands;
      const firstVariant = first?.variants?.[0] || null;
      data.brandName = first?.name || null;
      data.imageSize = firstVariant?.size || null;
      data.frameInches = firstVariant?.frameInches || null;
      data.videoLength = firstVariant?.videoLength || null;
      data.price = firstVariant?.price ?? null;
    }

    // One transaction, so a deliverable can never be left holding half a list: the brands go, the
    // new ones are written, and the deliverable's own columns are saved together or not at all.
    const updated = await prisma.$transaction(async (transaction) => {
      if (brands !== undefined) await saveDeliverableBrands(transaction, existing.id, brands);
      return transaction.projectDeliverableDefinition.update({
        where: { id: existing.id },
        data,
        include: deliverableDefinitionInclude,
      });
    });
    return res.json({ data: updated, message: "Deliverable settings saved successfully." });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ message: "This deliverable already exists." });
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to update deliverable definition:", error);
    return res.status(500).json({ message: "Unable to update deliverable." });
  }
}

async function findProjectShoot(transaction, projectId, shootId) {
  const shoot = await transaction.projectShoot.findFirst({
    where: { id: shootId, projectId, deletedAt: null },
    select: { id: true, projectId: true },
  });
  if (!shoot) {
    const error = new Error("Shoot not found for this project.");
    error.status = 404;
    throw error;
  }
  return shoot;
}

/**
 * Puts one shoot's service - or deliverable - lines in the order sent, by the rule the Settings
 * lists reorder by (`orderedDefinitionIds`): the ids sent that are this shoot's live lines, then any
 * line left out, where it stood. Only `sortOrder` is written; nothing is repriced.
 */
function lineReorder(model, label, action) {
  return async function reorderLines(req, res) {
    const parsed = definitionOrderSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ message: "Send the ids in their new order." });
    try {
      const shoot = await findProjectShoot(prisma, req.params.id, req.params.shootId);
      const rows = await model().findMany({ where: { projectId: shoot.projectId, shootId: shoot.id, deletedAt: null }, select: { id: true }, orderBy: [{ sortOrder: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }] });
      const ordered = orderedDefinitionIds(rows.map((row) => row.id), parsed.data.ids);
      await prisma.$transaction(ordered.map((id, index) => model().update({ where: { id }, data: { sortOrder: index } })));
      await logProjectActivity({ projectId: shoot.projectId, shootId: shoot.id, area: "PROJECT", action, detail: `${label} reordered`, userId: Number(req.user.id) });
      return res.json({ message: "Order saved." });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ message: error.message });
      console.error(`Unable to reorder ${label.toLowerCase()}:`, error);
      return res.status(500).json({ message: `Unable to save the order of the ${label.toLowerCase()}.` });
    }
  };
}

const reorderServiceAllocations = lineReorder(() => prisma.projectPostProductionAllocation, "Services", "SERVICES_REORDERED");

/**
 * Puts a project's shoots in the order dragged in its Shoot List, by the same rule the service and
 * deliverable lines reorder by (`orderedDefinitionIds`): the ids sent that are this project's live
 * shoots, then any shoot left out, where it stood. Only `sortOrder` is written - no date, Shoot ID or
 * anything else changes - and nothing but the Shoot List forms reads it.
 */
async function reorderProjectShoots(req, res) {
  const parsed = definitionOrderSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Send the shoot ids in their new order." });
  try {
    const project = await prisma.salesProject.findFirst({ where: { id: req.params.id, deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id), forWrite: true })] }, select: { id: true } });
    if (!project) return res.status(404).json({ message: "Project not found." });
    const rows = await prisma.projectShoot.findMany({ where: { projectId: project.id, deletedAt: null }, select: { id: true }, orderBy: [{ sortOrder: { sort: "asc", nulls: "last" } }, { dateCreated: "asc" }, { createdAt: "asc" }] });
    const ordered = orderedDefinitionIds(rows.map((row) => row.id), parsed.data.ids);
    await prisma.$transaction(ordered.map((id, index) => prisma.projectShoot.update({ where: { id }, data: { sortOrder: index } })));
    await logProjectActivity({ projectId: project.id, area: "PROJECT", action: "SHOOTS_REORDERED", detail: "Shoots reordered", userId: Number(req.user.id) });
    return res.json({ message: "Order saved." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to reorder shoots:", error);
    return res.status(500).json({ message: "Unable to save the order of the shoots." });
  }
}
const reorderDeliverableAllocations = lineReorder(() => prisma.projectShootDeliverable, "Deliverables", "DELIVERABLES_REORDERED");

async function listServiceAllocations(req, res) {
  try {
    const project = await prisma.salesProject.findFirst({ where: { id: req.params.id, deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id) })] }, select: { id: true } });
    if (!project) return res.status(404).json({ message: "Project not found." });
    const data = await prisma.projectPostProductionAllocation.findMany({
      where: { projectId: project.id, deletedAt: null },
      include: {
        ...serviceAllocationInclude,
        shoot: { select: { id: true, shootId: true, shoot: true, dateCreated: true, shootPlace: true, shootType: true, shootTypes: true, isMainEvent: true, district: true, state: true, sessionTiming: true, sessionTimings: true, sessionDurationHours: true, sessionDurationMinutes: true } },
      },
      orderBy: PROJECT_LINE_ORDER,
    });
    return res.json({ data });
  } catch (error) {
    console.error("Unable to load service allocations:", error);
    return res.status(500).json({ message: "Unable to load service allocations." });
  }
}

async function createServiceAllocation(req, res) {
  const parsed = serviceAllocationCreateSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });
  try {
    const data = await prisma.$transaction(async (transaction) => {
      const shoot = await findProjectShoot(transaction, req.params.id, req.params.shootId);
      const definition = await transaction.projectServiceDefinition.findFirst({ where: { id: parsed.data.serviceDefinitionId, isActive: true }, include: serviceDefinitionInclude });
      if (!definition) {
        const error = new Error("Select a valid active service.");
        error.status = 400;
        throw error;
      }
      const duplicate = await transaction.projectPostProductionAllocation.findFirst({
        where: { projectId: shoot.projectId, shootId: shoot.id, serviceDefinitionId: definition.id, deletedAt: null },
        select: { id: true },
      });
      if (duplicate) {
        const error = new Error("This service is already added to the selected shoot.");
        error.status = 409;
        throw error;
      }
      const allocationData = await serviceAllocationDataForDefinition(transaction, definition, parsed.data);
      const allocation = await transaction.projectPostProductionAllocation.create({
        data: {
          projectId: shoot.projectId,
          shootId: shoot.id,
          serviceDefinitionId: definition.id,
          serviceName: definition.name,
          serviceDetails: null,
          quantitySessionTiming: null,
          ...allocationData,
        },
        include: serviceAllocationInclude,
      });
      await syncAutoDeliverablesForShoot(transaction, shoot.projectId, shoot.id);
      return allocation;
    });
    await logProjectActivity({ projectId: req.params.id, shootId: req.params.shootId, area: "PROJECT", action: "SERVICE_ADDED", detail: `Service added: ${data?.serviceName || "-"}`, userId: Number(req.user.id) });
    return res.status(201).json({ data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to add service allocation:", error);
    return res.status(500).json({ message: "Unable to add service allocation." });
  }
}

async function updateServiceAllocation(req, res) {
  const parsed = serviceAllocationUpdateSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });
  try {
    const existing = await prisma.projectPostProductionAllocation.findFirst({
      where: { id: req.params.allocationId, projectId: req.params.id, deletedAt: null },
      include: { serviceDefinition: { include: serviceDefinitionInclude } },
    });
    if (!existing) return res.status(404).json({ message: "Service allocation not found for this project." });
    const allocationData = await serviceAllocationDataForDefinition(prisma, existing.serviceDefinition, { ...existing, ...parsed.data });
    const data = await prisma.projectPostProductionAllocation.update({ where: { id: existing.id }, data: { serviceDetails: null, quantitySessionTiming: null, ...allocationData }, include: serviceAllocationInclude });
    await logProjectActivity({ projectId: req.params.id, shootId: data?.shootId || null, area: "PROJECT", action: "SERVICE_EDITED", detail: `Service edited: ${data?.serviceName || "-"}`, userId: Number(req.user.id) });
    return res.json({ data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to update service allocation:", error);
    return res.status(500).json({ message: "Unable to update service allocation." });
  }
}

/**
 * A service taken off its shoot, inside the caller's transaction: the line, the post-production work
 * rows it opened (closed at the same moment, so putting it back can reopen exactly those), and the
 * deliverables it brought with it (`syncAutoDeliverablesForShoot`). Resolves to `{ count }`, 0 where it
 * was not on the project. Service Creation's delete and Sale Extras' Remove both take a service off here.
 */
async function removeServiceAllocationInTx(transaction, projectId, allocationId) {
  const now = new Date();
  const existing = await transaction.projectPostProductionAllocation.findFirst({
    where: { id: allocationId, projectId, deletedAt: null },
    select: { id: true, projectId: true, shootId: true },
  });
  if (!existing) return { count: 0 };
  const updateResult = await transaction.projectPostProductionAllocation.updateMany({
    where: { id: existing.id, projectId, deletedAt: null },
    data: { deletedAt: now },
  });
  if (updateResult.count === 1) {
    await transaction.projectPostProductionWorkflowAllocation.updateMany({
      where: { serviceAllocationId: existing.id, projectId, deletedAt: null },
      data: { deletedAt: now },
    });
    await syncAutoDeliverablesForShoot(transaction, existing.projectId, existing.shootId);
  }
  return updateResult;
}

/** A deliverable taken off its shoot, inside the caller's transaction. Resolves to `{ count }`. */
function removeDeliverableAllocationInTx(transaction, projectId, allocationId) {
  return transaction.projectShootDeliverable.updateMany({
    where: { id: allocationId, projectId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}

async function deleteServiceAllocation(req, res) {
  try {
    const result = await prisma.$transaction((transaction) => removeServiceAllocationInTx(transaction, req.params.id, req.params.allocationId));
    if (result.count !== 1) return res.status(404).json({ message: "Service allocation not found for this project." });
    await logProjectActivity({ projectId: req.params.id, area: "PROJECT", action: "SERVICE_REMOVED", detail: "Service removed", userId: Number(req.user.id) });
    return res.json({ message: "Service allocation removed successfully." });
  } catch (error) {
    console.error("Unable to delete service allocation:", error);
    return res.status(500).json({ message: "Unable to delete service allocation." });
  }
}

async function listDeliverableAllocations(req, res) {
  try {
    const project = await prisma.salesProject.findFirst({ where: { id: req.params.id, deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id) })] }, select: { id: true } });
    if (!project) return res.status(404).json({ message: "Project not found." });
    const data = await prisma.projectShootDeliverable.findMany({
      where: { projectId: project.id, deletedAt: null },
      include: {
        ...deliverableAllocationInclude,
        shoot: { select: { id: true, shootId: true, shoot: true, dateCreated: true, shootPlace: true, shootType: true, shootTypes: true, isMainEvent: true, district: true, state: true, sessionTiming: true, sessionTimings: true, sessionDurationHours: true, sessionDurationMinutes: true } },
      },
      orderBy: PROJECT_LINE_ORDER,
    });
    return res.json({ data });
  } catch (error) {
    console.error("Unable to load deliverable allocations:", error);
    return res.status(500).json({ message: "Unable to load deliverable allocations." });
  }
}

async function createDeliverableAllocation(req, res) {
  const parsed = deliverableAllocationCreateSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });
  try {
    const data = await prisma.$transaction(async (transaction) => {
      const shoot = await findProjectShoot(transaction, req.params.id, req.params.shootId);
      const definition = await transaction.projectDeliverableDefinition.findFirst({ where: { id: parsed.data.deliverableDefinitionId, isActive: true }, include: deliverableDefinitionInclude });
      if (!definition) {
        const error = new Error("Select a valid active deliverable.");
        error.status = 400;
        throw error;
      }
      // The same variant twice is refused; another variant of the same deliverable is its own line.
      const variantData = deliverableVariantSnapshotFor(definition, parsed.data.variant);
      const lineKey = deliverableLineKey(definition.id, variantData);
      const held = await transaction.projectShootDeliverable.findMany({
        where: { projectId: shoot.projectId, shootId: shoot.id, deliverableDefinitionId: definition.id, deletedAt: null },
        select: { brandName: true, size: true, frameInches: true, videoLength: true },
      });
      if (held.some((row) => deliverableLineKey(definition.id, row) === lineKey)) {
        const error = new Error("This deliverable is already added to the selected shoot.");
        error.status = 409;
        throw error;
      }
      const allocationData = await deliverableAllocationDataForDefinition(transaction, definition, parsed.data);
      return transaction.projectShootDeliverable.create({
        data: {
          projectId: shoot.projectId,
          shootId: shoot.id,
          deliverableDefinitionId: definition.id,
          deliverableName: definition.name,
          ...allocationData,
          ...variantData,
        },
        include: deliverableAllocationInclude,
      });
    });
    await logProjectActivity({ projectId: req.params.id, shootId: req.params.shootId, area: "PROJECT", action: "DELIVERABLE_ADDED", detail: `Deliverable added: ${data?.deliverableName || data?.name || "-"}`, userId: Number(req.user.id) });
    return res.status(201).json({ data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to add deliverable allocation:", error);
    return res.status(500).json({ message: "Unable to add deliverable allocation." });
  }
}

/**
 * A client's request approved (Client Management -> Client Requests: paid and approved, or given free):
 * the service or deliverable added to its shoot exactly as Edit Project adds one - the same defaults,
 * the same refusal of one already there (then nothing is added), the automatic deliverables a service
 * brings, and a line in the project's activity. `itemType` is "service" or "deliverable";
 * `definitionId` the Settings entry. Resolves to `{ name, added }`, or null for an entry no longer offered.
 */
async function addApprovedLine({ projectId, shootId, itemType, definitionId, quantity = 1, remarks = null, userId = null }) {
  const result = await prisma.$transaction(async (transaction) => {
    const shoot = await findProjectShoot(transaction, projectId, shootId);
    if (itemType === "service") {
      const definition = await transaction.projectServiceDefinition.findFirst({ where: { id: definitionId, isActive: true }, include: serviceDefinitionInclude });
      if (!definition) return null;
      const held = await transaction.projectPostProductionAllocation.findFirst({ where: { projectId: shoot.projectId, shootId: shoot.id, serviceDefinitionId: definition.id, deletedAt: null }, select: { id: true } });
      if (held) return { name: definition.name, added: false };
      const allocationData = await serviceAllocationDataForDefinition(transaction, definition, { serviceDefinitionId: definition.id, quantity, remarks });
      await transaction.projectPostProductionAllocation.create({
        data: { projectId: shoot.projectId, shootId: shoot.id, serviceDefinitionId: definition.id, serviceName: definition.name, serviceDetails: null, quantitySessionTiming: null, ...allocationData },
      });
      await syncAutoDeliverablesForShoot(transaction, shoot.projectId, shoot.id);
      return { name: definition.name, added: true };
    }
    const definition = await transaction.projectDeliverableDefinition.findFirst({ where: { id: definitionId, isActive: true }, include: deliverableDefinitionInclude });
    if (!definition) return null;
    const variantData = deliverableVariantSnapshotFor(definition, null);
    const lineKey = deliverableLineKey(definition.id, variantData);
    const held = await transaction.projectShootDeliverable.findMany({ where: { projectId: shoot.projectId, shootId: shoot.id, deliverableDefinitionId: definition.id, deletedAt: null }, select: { brandName: true, size: true, frameInches: true, videoLength: true } });
    if (held.some((row) => deliverableLineKey(definition.id, row) === lineKey)) return { name: definition.name, added: false };
    const allocationData = await deliverableAllocationDataForDefinition(transaction, definition, { deliverableDefinitionId: definition.id, quantity, remarks });
    await transaction.projectShootDeliverable.create({ data: { projectId: shoot.projectId, shootId: shoot.id, deliverableDefinitionId: definition.id, deliverableName: definition.name, ...allocationData, ...variantData } });
    return { name: definition.name, added: true };
  });
  if (result?.added) {
    await logProjectActivity({ projectId, shootId, area: "PROJECT", action: itemType === "service" ? "SERVICE_ADDED" : "DELIVERABLE_ADDED", detail: `${itemType === "service" ? "Service" : "Deliverable"} added from the client's request: ${result.name}`, userId });
  }
  return result;
}

/**
 * A raised request decided (Client Management -> Client Requests -> Raised Requests): its approved
 * shoot, services and deliverables written into the project inside the caller's transaction, by the
 * same helpers Create Project and Edit Project write them with - each line's configuration as it was
 * asked for, one deliverable line per variant.
 *
 * `shoot` is a new shoot's fields (`projectShootSchema`), or null to add to the existing `shootId`.
 * A new shoot is laid down the way Create Project lays one down: its deliverables are the ones the
 * request listed (each decided on its own), so nothing more is added. Lines added to a shoot the
 * project already has follow Edit Project: a service brings its automatic deliverables with it.
 *
 * A line already on the shoot is never added twice - it is reported `{ id: null, note }` instead.
 *
 * Every row written carries a Sale Extras baseline: its price travels on the request's own extra
 * quotation, so Sale Extras must not offer it to be priced and published a second time.
 *
 * `services` / `deliverables` are `[{ key, line }]`, the line as `projectShootServiceInputSchema` /
 * `projectShootDeliverableInputSchema` take it. Resolves to `{ shootId, shootCode, created, applied }`,
 * `applied` a Map of each key to `{ id, note }`.
 */
async function applyRequestedPlan(transaction, { projectId, shoot = null, shootId = null, services = [], deliverables = [], userId = null }) {
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const project = await transaction.salesProject.findFirst({ where: { id: String(projectId), deletedAt: null }, select: { id: true, vertical: true, sourceBranch: true } });
  if (!project) throw fail(404, "Project not found.");

  let target;
  if (shoot) {
    const parsed = projectShootSchema.safeParse(shoot);
    if (!parsed.success) throw fail(400, `The requested shoot cannot be added: ${parsed.error.issues?.[0]?.message || "its details are incomplete"}.`);
    target = await transaction.projectShoot.create({
      data: { ...projectShootData(parsed.data), projectId: project.id, shootId: await nextShootId(transaction, project) },
      select: { id: true, shootId: true, projectId: true, dateCreated: true, isMainEvent: true },
    });
    await syncProjectMainEvent(transaction, project.id, target);
  } else {
    const found = await findProjectShoot(transaction, project.id, shootId);
    target = await transaction.projectShoot.findUnique({ where: { id: found.id }, select: { id: true, shootId: true, projectId: true } });
  }

  const lineWhere = { projectId: project.id, shootId: target.id, deletedAt: null };
  const before = {
    services: new Set((await transaction.projectPostProductionAllocation.findMany({ where: lineWhere, select: { id: true } })).map((row) => row.id)),
    deliverables: new Set((await transaction.projectShootDeliverable.findMany({ where: lineWhere, select: { id: true } })).map((row) => row.id)),
  };
  const applied = new Map();
  let serviceAdded = false;

  for (const { key, line } of services) {
    const definition = await transaction.projectServiceDefinition.findFirst({ where: { id: line.serviceDefinitionId, isActive: true }, include: serviceDefinitionInclude });
    if (!definition) { applied.set(key, { id: null, note: "No longer offered in Settings" }); continue; }
    const held = await transaction.projectPostProductionAllocation.findFirst({ where: { ...lineWhere, serviceDefinitionId: definition.id }, select: { id: true } });
    if (held) { applied.set(key, { id: null, note: "Already on the shoot" }); continue; }
    const allocationData = await serviceAllocationDataForDefinition(transaction, definition, { ...line, serviceDefinitionId: definition.id });
    const row = await transaction.projectPostProductionAllocation.create({
      data: { projectId: project.id, shootId: target.id, serviceDefinitionId: definition.id, serviceName: definition.name, serviceDetails: null, quantitySessionTiming: null, ...allocationData },
      select: { id: true },
    });
    applied.set(key, { id: row.id, note: null });
    serviceAdded = true;
  }
  if (serviceAdded && !shoot) await syncAutoDeliverablesForShoot(transaction, project.id, target.id);

  for (const { key, line } of deliverables) {
    const definition = await transaction.projectDeliverableDefinition.findFirst({ where: { id: line.deliverableDefinitionId, isActive: true }, include: deliverableDefinitionInclude });
    if (!definition) { applied.set(key, { id: null, note: "No longer offered in Settings" }); continue; }
    const variantData = deliverableVariantSnapshotFor(definition, line.variant);
    const lineKey = deliverableLineKey(definition.id, variantData);
    const held = await transaction.projectShootDeliverable.findMany({ where: { ...lineWhere, deliverableDefinitionId: definition.id }, select: { brandName: true, size: true, frameInches: true, videoLength: true } });
    if (held.some((row) => deliverableLineKey(definition.id, row) === lineKey)) { applied.set(key, { id: null, note: "Already on the shoot" }); continue; }
    const allocationData = await deliverableAllocationDataForDefinition(transaction, definition, { ...line, deliverableDefinitionId: definition.id });
    const row = await transaction.projectShootDeliverable.create({
      data: { projectId: project.id, shootId: target.id, deliverableDefinitionId: definition.id, deliverableName: definition.name, ...allocationData, ...variantData },
      select: { id: true },
    });
    applied.set(key, { id: row.id, note: null });
  }

  // The rows this wrote - the lines asked for and any automatic deliverable they brought - become
  // baseline, so the extra quotation is the one place their price is counted.
  const writtenServices = await transaction.projectPostProductionAllocation.findMany({ where: { ...lineWhere, id: { notIn: [...before.services] } } });
  for (const row of writtenServices) await transaction.projectPostProductionAllocation.update({ where: { id: row.id }, data: saleExtrasBooking.baselineFor(true, "SERVICE", row) });
  const writtenDeliverables = await transaction.projectShootDeliverable.findMany({ where: { ...lineWhere, id: { notIn: [...before.deliverables] } } });
  for (const row of writtenDeliverables) await transaction.projectShootDeliverable.update({ where: { id: row.id }, data: saleExtrasBooking.baselineFor(true, "DELIVERABLE", row) });

  if (shoot) {
    await transaction.projectShoot.update({ where: { id: target.id }, data: saleExtrasBooking.baselineFor(true, "SHOOT") });
    // A new shoot reaches its client storage, pre production and production boards as one added on
    // Edit Project does (`createProjectShoots`).
    await ensureProjectClientStorage(transaction, project.id, { userId });
    await ensureProjectPreProduction(transaction, project.id, { userId });
    await ensureProjectProduction(transaction, project.id);
  }
  return { shootId: target.id, shootCode: target.shootId, created: Boolean(shoot), applied };
}

async function updateDeliverableAllocation(req, res) {
  const parsed = deliverableAllocationUpdateSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });
  try {
    const existing = await prisma.projectShootDeliverable.findFirst({
      where: { id: req.params.allocationId, projectId: req.params.id, deletedAt: null },
      include: { deliverableDefinition: { include: deliverableDefinitionInclude } },
    });
    if (!existing) return res.status(404).json({ message: "Deliverable allocation not found for this project." });
    const allocationData = await deliverableAllocationDataForDefinition(prisma, existing.deliverableDefinition, { ...existing, ...parsed.data });
    const data = await prisma.projectShootDeliverable.update({ where: { id: existing.id }, data: allocationData, include: deliverableAllocationInclude });
    await logProjectActivity({ projectId: req.params.id, shootId: data?.shootId || null, area: "PROJECT", action: "DELIVERABLE_EDITED", detail: `Deliverable edited: ${data?.deliverableName || data?.name || "-"}`, userId: Number(req.user.id) });
    return res.json({ data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to update deliverable allocation:", error);
    return res.status(500).json({ message: "Unable to update deliverable allocation." });
  }
}

async function deleteDeliverableAllocation(req, res) {
  try {
    const result = await removeDeliverableAllocationInTx(prisma, req.params.id, req.params.allocationId);
    if (result.count !== 1) return res.status(404).json({ message: "Deliverable allocation not found for this project." });
    await logProjectActivity({ projectId: req.params.id, area: "PROJECT", action: "DELIVERABLE_REMOVED", detail: "Deliverable removed", userId: Number(req.user.id) });
    return res.json({ message: "Deliverable allocation removed successfully." });
  } catch (error) {
    console.error("Unable to delete deliverable allocation:", error);
    return res.status(500).json({ message: "Unable to delete deliverable allocation." });
  }
}

module.exports = { getProject, BOOKING_EDIT_WRITE, resolveFinalizedQuotation, ANOTHER_FINALIZED, FINALIZED_LOCKED, narrowQuotations, listQuotationShareCandidates, saveQuotationShares, mayEditBookings, bulkStatusSchema, bulkUpdateProjectStatus, applyGiftTracking, retireProjectWithin, saveDeliverableBrands, deliverableVariantSnapshotFor, deliverableLineKey, projectShootServiceInputSchema, projectShootDeliverableInputSchema, validateSourceBranch, nextEventId, nextShootId, projectShootData, syncProjectMainEvent, projectShootSchema, normalizeClientMainNumber, projectStatuses, saveStartProjectWork, preProductionGeneralSchema, sendQuotationExpired, applicabilityChanges, codeFor, deliverableBrandsForSave, recordProjectAdvance, projectAdvanceOptions, syncProjectShootDeliverables, requireStartedProjectEditor, mayEditStartedProject, STARTED_PROJECT_EDIT_REFUSAL, SHOW_ALL_PROJECTS_WRITE, requireProjectEditor, requireProjectDeleter, mayEditProject, mayDeleteProject, PROJECT_STAFF_FIELDS, PROJECT_EDIT_REFUSAL, PROJECT_DELETE_REFUSAL, finalizedFields, quotationPayloadSchema, quotationData, startProjectSchema, startProjectDraftSchema, listProjects, listEnquiries, listQuotations, getQuotation, createQuotation, createQuotationVersion, duplicateQuotation, createQuotationDraft, previewQuotation, updateQuotationDraft, generateQuotationDraft, clientFacingQuotation, MAX_DISCOUNT_PERCENT, QUOTATION_STATUS, isDraftQuotation, draftRefusal, draftAnswers, renewQuotationLink, finalizeQuotation, unfinalizeQuotation, QUOTATION_FINALIZATION, isFinalizedQuotation, quotationFinalization, deleteQuotation, deleteQuotationRecord, deleteQuotationChainRecord, publicQuotation, quotationLinkState, quotationLinkExpiry, quotationIdFor, QUOTATION_LINK_VALIDITY_DAYS, publicQuotationPdf, quotationPdf, listSourceBranches, listCrmEmployees, listActiveEmployees, createProject, projectImportTemplate, importProjects, updateProject, deleteProject, deleteProjectRecord, startProject, saveStartProjectDraft, listProjectShoots, listProjectPayments, sendBackProject, returnToProjects, createProjectShoots, updateProjectShoot, deleteProjectShoot, listProductionDeliverables, replaceProductionDeliverables, listProjectOptionSets, createProjectOptionSetValue, updateProjectOptionSetValue, listServiceDefinitions, createServiceDefinition, updateServiceDefinition, reorderServiceDefinitions, listDeliverableDefinitions, createDeliverableDefinition, updateDeliverableDefinition, reorderDeliverableDefinitions, DEFINITION_ORDER, orderedDefinitionIds, definitionOrderSchema, listServiceAllocations, createServiceAllocation, updateServiceAllocation, deleteServiceAllocation, reorderServiceAllocations, listDeliverableAllocations, createDeliverableAllocation, updateDeliverableAllocation, deleteDeliverableAllocation, reorderDeliverableAllocations, addApprovedLine, applyRequestedPlan, syncAutoDeliverablesForShoot, removeServiceAllocationInTx, removeDeliverableAllocationInTx, deleteDeliverableDefinition, deleteProjectOptionSetValue, deleteServiceDefinition, APPLICABILITY_ITEMS, clientLoginFor, sendClientLoginWhatsApp, getClientLogin, createClientLogin, getClientLoginByNumber, existingClientLoginFor, sendQuotationPdf, reorderProjectShoots };
