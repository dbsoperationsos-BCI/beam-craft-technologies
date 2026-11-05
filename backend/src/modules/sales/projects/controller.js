const { z } = require("zod");
const { workingEmployeeStatuses, salesEmployees } = require("../../../services/employeeOptionLists");
const { snapshotDocumentBranding, brandingForDocument } = require("../../../services/documentBranding");
const prisma = require("../../../config/db");
const { ensureProjectClientStorage, removeProjectClientStorage } = require("../../assets/client-storage.service");
// A project answering "CRD Document: Applicable" raises its document there and then, so the studio
// can quote its CRD ID before the link goes out.
const { ensureProjectCrdDocument } = require("../crd-documents/service");
const { projectClientNames, clientNameOf } = require("../../../services/projectClientNames");
const iamService = require("../../../services/iam.service");
const { fileUrls } = require("../../../services/uploadMetadata");
const { markCrmLeadConverted } = require("../crm-leads/crmLeadService");
/*
 * The Accounts module's own writer, so a booking advance is the same row, validated the same way,
 * as every other cash entry - only the guard on the route differs. See `recordProjectAdvance`.
 */
const { recordCashEntry, formEntrySchema: cashFormEntrySchema, handleError: handleCashEntryError, toRow: cashEntryRow } = require("../../accounts/cash-entries/controller");
const { nextIdentifier, parseIdentifier } = require("../../../services/identifiers");
const { buildQuotationName } = require("../../../services/quotationName");
// The brand a quotation is raised under, and the snapshot of that brand it carries - see the
// module for why the snapshot is built here rather than read from the brand tables later.
const quotationBrands = require("../quotation-brands/service");
const { importTableRows, templateHeaders } = require("../../../services/tableImport");
// Deleting a shoot here also removes its Image Selection footprint (folder tree, photo rows,
// R2 derivatives) — see deleteProjectShoot.
const imageSelectionFolders = require("../../image-selection/folders/service");
// Deleting a booking takes its Image Selection project with it. The purge itself belongs to that
// module and is reused whole from here - this file never learns what a derivative or a selection is.
const imageSelectionProjects = require("../../image-selection/projects/service");
const { normalizePhoneNumber } = require("../../../services/phoneNumber");
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
// The gift a project owes its client starts on the Client Gifts screen's first tab the moment it is marked
// Applicable, so the two screens agree on what "not sent yet" is called without either owning it.
const { GIFT_STATUS_PENDING } = require("../../project-management/client-gifts/service");

const verticals = VERTICAL_CODES;
const groupTypes = ["Dum Dum", "Qua Qua", "Corp"];
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
const projectStatuses = ["Yet to Start", "Work in Progress - Pre & Production", "Work in Progress - Post Production", "Rejected", "Cancelled & Refunded", "Client not Turned", "On Hold", "Delivered", "Duplicated", "Date Elapsed"];
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
const projectShootDeliverableInputSchema = z.object({
  deliverableDefinitionId: z.string().trim().min(1).max(191),
  quantity: z.coerce.number().int().min(1).nullable().optional(),
  numberOfPhotos: z.coerce.number().int().min(0).nullable().optional(),
  sizeOptionValueId: z.string().trim().max(191).nullable().optional(),
  size: optionalText,
  remarks: optionalText,
});

/*
 * A shoot's date, which it may not have yet.
 *
 * A wedding is sold months before the family settles the reception date, so Add Shoot asks whether
 * the date is known before it asks for one. An empty string is what a form sends for a field it
 * never showed, and it means "not scheduled" here rather than an unparseable date.
 */
const optionalShootDate = z.union([z.coerce.date(), z.literal(""), z.null()])
  .optional()
  .transform((value) => (value instanceof Date ? value : null));

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
  gstPercent: z.union([z.coerce.number().finite().min(0).max(100), z.literal(""), z.null()]).optional(),
  subtotal: z.coerce.number().finite().min(0).default(0),
  discount: z.coerce.number().finite().min(0).max(100).default(0),
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
}).passthrough();

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
    shoot: requiredText.max(100),
    shootPlace: requiredText.max(191),
    // The lists are what the dialog sends; the singulars are derived from them and kept only so
    // older readers of a shoot are undisturbed. Either may arrive, and at least one must.
    shootType: z.enum(shootTypeOptions).optional(),
    shootTypes: z.array(z.enum(shootTypeOptions)).min(1).max(shootTypeOptions.length).optional(),
    isMainEvent: z.boolean().default(false),
    district: requiredText.max(191),
    state: requiredText.max(191),
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
  welcomeGift: z.enum(["Applicable", "Not Applicable"]).nullable().optional(),
  welcomeGiftAssignee: optionalText,
  welcomeGiftEmployeeId: optionalPositiveInt,
  shootCompletedGift: z.enum(["Applicable", "Not Applicable"]).nullable().optional(),
  shootCompletedGiftAssignee: optionalText,
  shootCompletedGiftEmployeeId: optionalPositiveInt,
  projectValidityMonths: z.coerce.number().int().min(1).nullable().optional(),
  storageNeeded: z.enum(["Yes", "No"]).nullable().optional(),
  crdDocumentStatus: z.enum(["Applicable", "Not Yet Received", "Groom Side Received", "Bride side Received", "Both Received", "Not Applicable"]).nullable().optional(),
  salesPreProductionRemarks: optionalText,
  salesProductionRemarks: optionalText,
  salesPostProductionRemarks: optionalText,
});

const projectShootSchema = z.object({
  dateCreated: optionalShootDate,
  shoot: requiredText.max(100),
  shootPlace: requiredText.max(191),
  shootType: z.enum(shootTypeOptions).optional(),
  shootTypes: z.array(z.enum(shootTypeOptions)).min(1).max(shootTypeOptions.length).optional(),
  isMainEvent: z.boolean().default(false),
  district: requiredText.max(191),
  state: requiredText.max(191),
  sessionTiming: z.enum(shootSessionTimingOptions).optional(),
  sessionTimings: z.array(z.enum(shootSessionTimingOptions)).min(1).max(shootSessionTimingOptions.length).optional(),
  sessionDurationHours: z.coerce.number().int().min(0).nullable().optional(),
  sessionDurationMinutes: z.coerce.number().int().min(0).max(59).nullable().optional(),
  foodTakenCareBy: z.enum(shootCareOwnerOptions).default("Studio"),
  accommodation: z.enum(shootCareOwnerOptions).default("Studio"),
  travel: z.enum(shootCareOwnerOptions).default("Studio"),
  preference: z.enum(shootPreferenceOptions, { message: "Select a Preference: Groom, Bride, or Both." }),
}).superRefine((data, context) => {
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
  // Whether the service brings deliverables with it - Yes puts a Deliverables list on every
  // pricing row below. Only TRUE brings any; see the model.
  deliverableAdded: z.boolean().optional(),
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
    name: z.string().trim().max(191).nullable().optional(),
    variants: z.array(z.object({
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
   * so Start Project — which never offers the field — cannot blank it by omission. See
   * `saveStartProjectWork`, which ignores `undefined` and writes anything else.
   */
  initialConvertedValue: z.coerce.number().finite().min(0).optional(),
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

function codeFor(prefix, name) {
  return `${prefix}_${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
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
      name: String(brand?.name ?? "").trim(),
      variants: (brand?.variants || [])
        .map((variant) => ({
          size: text(variant?.size, "size"),
          frameInches: text(variant?.frameInches, "frameInches"),
          videoLength: text(variant?.videoLength, "videoLength"),
          price: variant?.price ?? null,
        }))
        .filter((variant) => variant.size || variant.frameInches || variant.videoLength || variant.price !== null),
    }))
    .filter((brand) => brand.name || brand.variants.length);
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
    size: null,
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
    shootPlace: data.shootPlace,
    shootTypes,
    sessionTimings,
    // Kept in step with the lists, as the first of each, for everything that reads a shoot's type or
    // timing one-at-a-time.
    shootType: shootTypes[0] || "Studio / In-House",
    isMainEvent: Boolean(data.isMainEvent),
    district: data.district,
    state: data.state,
    sessionTiming: sessionTimings[0] || null,
    sessionDurationHours,
    sessionDurationMinutes,
    foodTakenCareBy: data.foodTakenCareBy || "Studio",
    accommodation: data.accommodation || "Studio",
    travel: data.travel || "Studio",
    preference: data.preference,
    eventStartTime: null,
    eventEndTime: null,
  };
}

async function syncProjectMainEvent(transaction, projectId, shoot) {
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
      include: {
        shoots: {
          where: { deletedAt: null },
          include: {
            deliverables: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
            postProductionAllocations: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
          },
          orderBy: [{ dateCreated: "asc" }, { createdAt: "asc" }],
        },
        attachments: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: "desc" }],
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return res.json({ data: await fillVerticalsFromLeads(data) });
  } catch (error) {
    console.error("Unable to load sales projects:", error);
    return res.status(500).json({ message: "Unable to load sales projects." });
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
 */
async function resolveFinalizedQuotation(transaction, quotationId) {
  const id = String(quotationId || "").trim();
  if (!id) return null;
  const quotation = await transaction.salesQuotation.findFirst({
    where: { quotationId: id, deletedAt: null },
    select: { quotationId: true },
  });
  if (!quotation) {
    const error = new Error("The selected quotation could not be found.");
    error.status = 400;
    throw error;
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

/*
 * The enquiries a project or a group name can be filed under, searched as they are typed.
 *
 * Sourced from the CRM's leads rather than from existing projects: an enquiry exists the moment a
 * lead does, which is before any project has been created from it - listing project rows here meant
 * the dropdown offered event/project ids and a brand-new lead's enquiry could not be found at all.
 * The lead also carries what the Create Project form can prefill: the client's name, the number
 * they are messaged on, and the branch they enquired at.
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
      ...(search ? {
        OR: [
          { enquiryId: { contains: search } },
          { name: { contains: search } },
          { phone: { contains: search } },
          { whatsappNumber: { contains: search } },
        ],
      } : {}),
      AND: [scope.where],
    };

    const leads = await prisma.salesCrmLead.findMany({
      where,
      select: { enquiryId: true, name: true, phone: true, whatsappNumber: true, assignedBranch: true },
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

    const data = leads.map((lead) => ({
      enquiryId: lead.enquiryId,
      clientName: lead.name || null,
      clientMainNumber: lead.whatsappNumber || lead.phone || null,
      // The lead's branch - not its vertical, which is what this used to send and which the quotation
      // form checks against branch names, so the prefill never matched anything.
      sourceBranch: lead.assignedBranch || null,
      // Carried by the old project-sourced rows; a lead has neither, and the form keeps what it has.
      whatsappGroupName: null,
      initialConvertedValue: null,
    }));
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
  };
}

/** One version, as the version dropdown and the history list need it. */
function serializeQuotationVersion(row) {
  const { linkExpiresAt, linkActive } = quotationLinkState(row);
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
    publicToken: row.publicToken,
    publicPath: `/q/${row.publicToken}`,
    linkExpiresAt,
    linkActive,
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
  if (scope.unlimited) return quotations;
  const reachable = await readableEnquiries(quotations.map((row) => row.enquiryId), req);
  return quotations.filter((row) => scope.allows(row) || reachable.has(row.enquiryId));
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
  return reachable.has(quotation.enquiryId) ? quotation : null;
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
    const rows = await prisma.salesQuotation.findMany({
      where: { deletedAt: null, ...(enquiryId ? { enquiryId } : {}), ...(brand ? { quotationBrand: brand } : {}) },
      orderBy: [{ quotationNumber: "asc" }, { version: "desc" }],
    });
    const quotations = enquiryId ? rows : await narrowQuotations(rows, req);

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

    // Newest chain first, which for a register read top-down is the enquiry quoted for most
    // recently rather than the one with the highest chain number.
    const data = [...chains.values()]
      .map((versions) => ({
        ...serializeQuotation(versions[0]),
        ...finalizedFields(versions[0], finalizedBy),
        versionCount: versions.length,
        versions: versions.map((version) => ({
          ...serializeQuotationVersion(version),
          ...finalizedFields(version, finalizedBy),
        })),
      }))
      .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));

    return res.json({ data });
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
    return res.json({ data: serializeQuotation(quotation) });
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
async function nextVersionFor(quotationNumber) {
  const latest = await prisma.salesQuotation.findFirst({
    where: { quotationNumber },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return (latest?.version || 0) + 1;
}

function parseQuotationPayload(req, res) {
  const parsed = quotationPayloadSchema.safeParse(req.body);
  if (parsed.success) return parsed.data;
  res.status(400).json({ message: "Invalid quotation details.", errors: parsed.error.flatten() });
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
async function insertQuotationVersion(resolveChain, parsed, createdByUserId = null) {
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
  const references = { branchId: refs.branchId(columns.sourceBranch), ownerEmployeeId: refs.employeeId(columns.followedBy), createdByUserId };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const quotationNumber = await resolveChain();
    const version = await nextVersionFor(quotationNumber);
    try {
      return await prisma.salesQuotation.create({
        data: {
          ...columns,
          ...references,
          ...branding,
          quotationName,
          quotationNumber,
          version,
          quotationId: quotationIdFor(quotationNumber, version),
          publicToken: await uniqueQuotationToken(),
          linkExpiresAt: quotationLinkExpiry(),
        },
      });
    } catch (error) {
      if (error?.code !== "P2002") throw error;
    }
  }
  throw new Error("Unable to allocate a quotation version.");
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
    const quotation = await insertQuotationVersion(
      async () => nextQuotationChainNumber(parsed),
      parsed,
      Number(req.user?.id) || null,
    );
    return res.status(201).json({ data: serializeQuotation(quotation) });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to create quotation:", error);
    return res.status(500).json({ message: "Unable to create quotation." });
  }
}

/**
 * Editing a quotation writes the next version of its chain rather than changing what was sent.
 *
 * The version is raised from whichever version was opened - reopening v1 after v3 exists and
 * saving it makes v4, because what the studio just approved is the newest thing said, not a
 * correction to an old one.
 */
async function createQuotationVersion(req, res) {
  const parsed = parseQuotationPayload(req, res);
  if (!parsed) return;
  try {
    const source = await scopedQuotation(req, req.params.id);
    if (!source) return res.status(404).json({ message: "Quotation not found." });
    /*
     * The brand is set at the first version and every later one keeps it - the generator locks the
     * selector, and this is what makes that a rule rather than a convention. The vertical rides
     * along for the same reason; the counter and the name both read it.
     */
    const withBrand = { ...parsed, quotationBrand: source.quotationBrand || quotationBrands.brandCodeOfPayload(source.payload), vertical: source.payload?.vertical || parsed.vertical || null };
    // Lines the earlier version already held stay, whatever has since happened to their master;
    // only a line added on this version has to be one the brand still offers.
    await quotationBrands.assertNewSelectionsOffered(withBrand, source.payload);
    const quotation = await insertQuotationVersion(async () => source.quotationNumber, withBrand, Number(req.user?.id) || null);
    return res.status(201).json({ data: serializeQuotation(quotation) });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
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
    const parsed = quotationPayloadSchema.safeParse({ ...(source.payload || {}), enquiryId });
    if (!parsed.success) {
      return res.status(422).json({ message: "This quotation cannot be duplicated - its saved details are incomplete.", errors: parsed.error.flatten() });
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

/**
 * Deleting one quotation, as the route and the bulk delete both do it.
 *
 * `scopedQuotation` is what narrows the id to one this caller may touch, so an id arriving in the
 * body of a bulk request is refused exactly as the same id in the URL would be. Throws rather than
 * answering, so the bulk runner counts it.
 */
async function deleteQuotationRecord(req, id) {
  if (!(await scopedQuotation(req, id))) throw new Error("Quotation not found.");
  await prisma.salesQuotation.update({ where: { id }, data: { deletedAt: new Date() } });
  return { id };
}

async function deleteQuotation(req, res) {
  try {
    await deleteQuotationRecord(req, req.params.id);
    return res.status(204).send();
  } catch (error) {
    if (error?.message === "Quotation not found.") return res.status(404).json({ message: error.message });
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
async function publicQuotation(req, res) {
  try {
    const token = String(req.params.token || "").trim();
    if (!/^[A-Za-z0-9_-]{8}$/.test(token)) return res.status(404).json({ message: "Quotation not found." });
    const quotation = await prisma.salesQuotation.findUnique({ where: { publicToken: token } });
    if (!quotation || quotation.deletedAt) return res.status(404).json({ message: "Quotation not found." });
    if (quotationLinkState(quotation).linkExpired) {
      return res.status(410).json({ message: "This quotation link has expired. Please contact your Don't Blink Studioz representative for a fresh link." });
    }
    /*
     * What the page prints beyond the rows - the brand's wording and pictures, the studio's name,
     * the branch's website - resolved once here: the version's own snapshot, with today's answer
     * only where a snapshot older than this shape is silent. See `presentationForQuotation`.
     */
    const brandSnapshot = await quotationBrands.presentationForQuotation(quotation);
    /*
     * Whether this client may save the quotation as a file - the brand's own answer, read live.
     * The page hides its download control without it, and `publicQuotationPdf` refuses the request
     * behind it, so the control is a courtesy rather than the protection.
     */
    const allowClientDownload = await quotationBrands.allowsClientDownload(quotation);
    return res.json({ data: { ...serializeQuotation(quotation), brandSnapshot, allowClientDownload } });
  } catch (error) {
    console.error("Unable to load public quotation:", error);
    return res.status(500).json({ message: "Unable to load quotation." });
  }
}

/** Renders one version and answers with the file. Shared by the client's route and the studio's. */
async function sendQuotationPdf(res, quotation) {
  const { renderQuotationPdf } = require("../../../services/quotationPdfService");
  const pdf = await renderQuotationPdf(quotation.publicToken);

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
  try {
    const quotation = await prisma.salesQuotation.findUnique({ where: { publicToken: token } });
    if (!quotation || quotation.deletedAt) return res.status(404).json({ message: "Quotation not found." });
    if (quotationLinkState(quotation).linkExpired) {
      return res.status(410).json({ message: "This quotation link has expired. Please contact your Don't Blink Studioz representative for a fresh link." });
    }
    if (!(await quotationBrands.allowsClientDownload(quotation))) {
      return res.status(403).json({ message: "This quotation is available to read online only. Please contact your Don't Blink Studioz representative for a copy." });
    }

    return await sendQuotationPdf(res, quotation);
  } catch (error) {
    console.error("Unable to render quotation PDF:", error);
    return res.status(500).json({ message: "Unable to build the quotation PDF." });
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
      select: { id: true, employeeId: true, employeeName: true, department: true, designation: true, emailId: true, workEmailId: true },
    });
    return res.json({ data });
  } catch (error) {
    console.error("Unable to load SALES employees:", error);
    return res.status(500).json({ message: "Unable to load SALES employees." });
  }
}

async function listActiveEmployees(req, res) {
  try {
    const data = await prisma.employee.findMany({
      where: { archivedAt: null, employmentStatus: { in: await workingEmployeeStatuses() } },
      // Emails are included so anywhere that invites an employee - the CRM's meeting guest
      // picker, for one - can do it from this list rather than needing its own lookup.
      select: { id: true, employeeId: true, employeeName: true, department: true, designation: true, employmentStatus: true, emailId: true, workEmailId: true },
      orderBy: { employeeName: "asc" },
    });
    return res.json({ data });
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
        select: { id: true, employeeId: true, employeeName: true },
      }),
      prisma.bankAccount.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { name: true } }),
    ]);
    // The same shape the advance form already reads off the Accounts options, so the panel needs no
    // second way of understanding an answer.
    return res.json({ data: { employees, accounts: accounts.map((account) => account.name) } });
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
    const created = await prisma.$transaction((tx) => recordCashEntry(
      {
        ...req.body,
        // From the URL, never the body: the advance belongs to the project that was just created.
        projectId: project.id,
        // Money in. A booking advance is a receipt, and forcing it here is what stops this route
        // being a way to record an expense without `ACCOUNTS / Cash Management`.
        entryType: "Received",
      },
      actorId,
      tx,
      { enforceBranchReach: true, schema: cashFormEntrySchema },
    ));
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

async function createProject(req, res) {
  const parsed = projectSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });

  const normalizedClientNumber = normalizeClientMainNumber(parsed.data.clientMainNumber);
  if (!normalizedClientNumber) return res.status(400).json({ message: "Client Main Number must include an editable country code and exactly 10 digits." });

  try {
    const data = await prisma.$transaction(async (transaction) => {
      // `crmLeadStatus` is about the *lead* being converted, not about the project, so it is taken
      // off here with the other two that are not columns - left in, Prisma refuses the create with
      // "Unknown argument crmLeadStatus". It is read again after the transaction, from `parsed`.
      const { shoots, quotationId, crmLeadStatus, ...raw } = parsed.data;
      // Filled before anything reads it - the payload check, the identifier and the row itself all
      // see the same vertical, which is what stops the booking's code disagreeing with its lead's.
      const projectData = withInferredVertical(raw);
      const { groupName } = await validateProjectPayload(transaction, projectData, { userId: req.user.id });
      const finalizedQuotationId = await resolveFinalizedQuotation(transaction, quotationId);
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
          const { services = [], deliverables = [], ...shootData } = shoot;
          const savedShoot = await transaction.projectShoot.create({
            data: { ...projectShootData(shootData), projectId: project.id, shootId: await nextShootId(transaction, projectData) },
            select: { id: true, projectId: true, dateCreated: true, isMainEvent: true },
          });
          await syncProjectMainEvent(transaction, project.id, savedShoot);

          const seenServices = new Set();
          for (const service of services) {
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
              },
            });
          }

          const seenDeliverables = new Set();
          for (const deliverable of deliverables) {
            if (seenDeliverables.has(deliverable.deliverableDefinitionId)) {
              const error = new Error("Duplicate deliverables are not allowed for the same shoot.");
              error.status = 409;
              throw error;
            }
            seenDeliverables.add(deliverable.deliverableDefinitionId);
            const definition = await transaction.projectDeliverableDefinition.findFirst({ where: { id: deliverable.deliverableDefinitionId, isActive: true }, include: deliverableDefinitionInclude });
            if (!definition) {
              const error = new Error("Select a valid active deliverable.");
              error.status = 400;
              throw error;
            }
            const allocationData = await deliverableAllocationDataForDefinition(transaction, definition, deliverable);
            await transaction.projectShootDeliverable.create({
              data: {
                projectId: savedShoot.projectId,
                shootId: savedShoot.id,
                deliverableDefinitionId: definition.id,
                deliverableName: definition.name,
                ...allocationData,
              },
            });
          }
        }
      }

      return transaction.salesProject.findUnique({
        where: { id: project.id },
        include: { shoots: { where: { deletedAt: null }, orderBy: [{ dateCreated: "asc" }, { createdAt: "asc" }] } },
      });
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

    return res.status(201).json({ data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to save sales project:", error);
    return res.status(500).json({ message: "Unable to save sales project." });
  }
}

async function updateProject(req, res) {
  const parsed = projectSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });
  const normalizedClientNumber = normalizeClientMainNumber(parsed.data.clientMainNumber);
  if (!normalizedClientNumber) return res.status(400).json({ message: "Client Main Number must include an editable country code and exactly 10 digits." });

  try {
    const data = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.salesProject.findFirst({ where: { id: req.params.id, deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id), forWrite: true })] } });
      if (!existing) {
        const error = new Error("Project not found.");
        error.status = 404;
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
       */
      const finalizedQuotationId = quotationId === undefined
        ? existing.quotationId
        : await resolveFinalizedQuotation(transaction, quotationId);
      const groupNameUsedAt = groupName && groupName.id !== existing.whatsappGroupNameId ? new Date() : null;
      const vertical = projectData.vertical || await verticalFromLead(transaction, projectData.enquiryId);
      const refs = await referenceLookups();
      const project = await transaction.salesProject.update({
        where: { id: existing.id },
        data: {
          ...projectData,
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
    return res.json({ data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to update sales project:", error);
    return res.status(500).json({ message: "Unable to update sales project." });
  }
}

/**
 * Deletes a project, and with it the two things it raised elsewhere: the Image Selection presence
 * and the client storage.
 *
 * ── Image Selection ──
 *
 * An Image Selection project raised from a production project is not a thing of its own: the list
 * sync puts it there the moment the project goes in progress, it is named by the project's WhatsApp
 * group name, and it reads its client from the project. Image Selection knows this and refuses to
 * rename, delete or re-address such a project, saying to change it in Project Management instead.
 *
 * So a project deleted here and left behind in Image Selection was a project nothing could reach:
 * still in the sidebar, still showing the client's name on the dashboard, and refusing every one of
 * those instructions because the project they point at is gone. Archiving was the only way out of
 * it. It goes with the project instead.
 *
 * Both sections go - the Projects page and Album Proofing file their projects in one table under a
 * flag, and this matches on the project alone, so neither is left holding a project the other has
 * lost. The published gallery answers 404 by itself once the row is deleted, so a client's link
 * stops working without anything here having to know about publishing.
 *
 * ── Client storage ──
 *
 * The same fault, on a different screen. A project is *soft*-deleted, so its row never actually
 * goes and the foreign key's `onDelete: SetNull` never fires; the storage register filters on its
 * own `isDeleted` and never looked at the project's. A deleted project's hard disc therefore went
 * on being listed in Client Storage, filed against a project that had disappeared from Bookings &
 * Converted and everywhere else - which is exactly what a studio finds when the Client Storage tab
 * holds projects no other tab does.
 *
 * ── Soft, and all in one transaction ──
 *
 * Soft, exactly as the project's own delete is: the photographs, the folders and the client's
 * selections are all still on disk and in their rows afterwards. Image Selection's own delete
 * purges those, but it does that behind a warning that makes somebody confirm the client's
 * submitted selections by hand, and a delete over here is not that confirmation. Nothing here
 * reclaims storage; what it does is stop showing a project that no longer exists.
 *
 * One transaction, and the project first: `updateMany` with the access rule in its `where` is what
 * decides whether this caller may delete this project at all, so nothing else is touched until it
 * has answered.
 */
/**
 * Deleting one project, as the route and the bulk delete both do it.
 *
 * Returns what went with it - the gallery, the client storage records - or `null` for a project
 * that was not this caller's to delete or was already gone.
 *
 * **The photo purge is here rather than in the route handler**, which is the one place both ways in
 * pass through. `DELETE /:id` is not the only way a project is deleted any more - the Projects
 * screen's tick boxes hand forty ids to the bulk route, which reaches `deleteProjectRecord` and
 * then this - so a purge written beside the single route would have left every bulk-deleted
 * booking's photos in the bucket, which is the state this cascade exists to stop.
 */
async function removeProject(req, id) {
  const userId = Number(req.user.id);
  const deletedAt = new Date();
  // Resolved before the transaction opens, not inside it: the rule reads permissions of its own
  // through the plain client, and an unrelated query awaited inside an interactive transaction
  // holds that transaction open across it for no reason.
  const where = { id, deletedAt: null, AND: [await projectAccessWhere({ userId, forWrite: true })] };
  const removed = await prisma.$transaction(async (transaction) => {
    const result = await transaction.salesProject.updateMany({ where, data: { deletedAt } });
    // Not this caller's project, or already deleted: nothing is touched, the gallery included.
    if (result.count !== 1) return null;
    // Read before the update, because `updateMany` answers with a count and the purge below
    // needs the ids. Only the Projects page's own rows are collected: an Album Proofing project
    // is hidden by the same stamp but never purged, because its proof pages carry upload ids
    // that no foreign key protects and emptying the photos out from under them would leave the
    // proofs standing and broken.
    const galleries = await transaction.imageSelectionProject.findMany({ where: { salesProjectId: id, deletedAt: null, albumProofing: false }, select: { id: true } });
    const gallery = await transaction.imageSelectionProject.updateMany({ where: { salesProjectId: id, deletedAt: null }, data: { deletedAt } });
    return { gallery: gallery.count, galleryIds: galleries.map((row) => row.id), storage: await removeProjectClientStorage(transaction, id, { userId }) };
  });
  if (removed === null) return null;

  /*
   * The photos, after the transaction rather than inside it.
   *
   * R2 cannot take part in a MySQL transaction, so one of the two has to go second and the choice
   * is which failure the studio is left holding. This way round the worst case is a project already
   * invisible everywhere whose files are still in the bucket - the state every booking deleted
   * before this cascade existed is already in, and one the cleanup script finishes off. The other
   * way round, a bucket failure after the photos were gone would roll the delete back and leave a
   * live project whose gallery had been emptied, which is not recoverable. So a failure here is
   * logged and the delete still succeeded: the caller asked for the project to go, and it has gone.
   */
  for (const galleryId of removed.galleryIds) {
    try {
      await imageSelectionProjects.purgeData(galleryId);
    } catch (error) {
      console.error(`Sales project ${id} was deleted, but its Image Selection project ${galleryId} could not be purged:`, error?.message || error);
    }
  }
  return removed;
}

/**
 * One ticked project, deleted.
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
        ? `Project deleted successfully. ${removed.storage} client storage record${removed.storage === 1 ? "" : "s"} removed with it.`
        : "Project deleted successfully.",
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
const STARTED_PROJECT_EDIT_REFUSAL = "This project has started, so only its Project Manager or a branch administrator can change it.";

async function mayEditStartedProject(project, user) {
  // Before it starts, planning it is the whole job and the route's own permission is the answer.
  if ((project?.projectStatus || "Yet to Start") === "Yet to Start") return true;
  const linkedEmployeeId = Number(user?.linkedEmployeeId) || null;
  if (linkedEmployeeId && project.projectManagerEmployeeId === linkedEmployeeId) return true;
  if (await iamService.hasPermission(user.id, "ADMIN", "Branch Administration", "READ")) return true;
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

const PROJECT_EDIT_REFUSAL = "Only the people this project is staffed to, a branch administrator, or somebody who may work every project, can change it.";
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

/** Changing the project: anybody it is staffed to, whoever runs the branch, or whoever works every project. */
async function mayEditProject(project, user) {
  if (staffedOn(project, PROJECT_STAFF_FIELDS, Number(user?.linkedEmployeeId) || null)) return true;
  if (await iamService.hasPermission(user.id, "ADMIN", "Branch Administration", "READ")) return true;
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

async function saveStartProjectWork(transaction, projectId, data, { start, userId }) {
  const project = await transaction.salesProject.findFirst({ where: { id: projectId, deletedAt: null, AND: [await projectAccessWhere({ userId, forWrite: true })] }, select: { id: true, projectStatus: true, welcomeGiftStatus: true, shootCompletedGiftStatus: true } });
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
  const { productionServices, postProductionDeliverables, ...identification } = data;
  const resolvedIdentification = applyGiftTracking(await resolveAssignmentEmployees(transaction, identification), project);
  await transaction.salesProject.update({ where: { id: project.id }, data: { ...resolvedIdentification, ...(start ? { projectStatus: "Work in Progress - Pre & Production" } : {}) } });
  if (productionServices !== undefined) {
    await verifyProjectShoots(transaction, project.id, productionServices);
    await transaction.projectPostProductionAllocation.updateMany({ where: { projectId: project.id, deletedAt: null }, data: { deletedAt: new Date() } });
    if (productionServices.length) await transaction.projectPostProductionAllocation.createMany({ data: productionServices.map((item) => ({ ...item, projectId: project.id })) });
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
    const data = await prisma.$transaction((transaction) => saveStartProjectWork(transaction, req.params.id, parsed.data, { start: true, userId: req.user.id }));
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
      orderBy: [{ dateCreated: "asc" }, { createdAt: "asc" }],
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
    /*
     * What the project is now signed for: the figure it was sold at plus every extra its manager
     * has approved. Added here rather than left to the screen to add up, so the one figure the
     * studio quotes back to a client has a single definition — and so it can never disagree with
     * the two rows it is made of. Extras still waiting are not in it: nobody has agreed them yet.
     */
    const totalSigned = totalQuotation + totalExtra;
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
      summary: { totalQuotation, totalExtra, totalSigned, totalReceived, totalSpent },
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
      return createdShoots;
    });
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
    return res.json(data);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message, ...(error.details ? { details: error.details } : {}) });
    console.error("Unable to delete project shoot:", error);
    return res.status(500).json({ message: "Unable to delete project shoot." });
  }
}

async function listProductionDeliverables(req, res) {
  try {
    const project = await prisma.salesProject.findFirst({ where: { id: req.params.id, deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id) })] }, select: { id: true } });
    if (!project) return res.status(404).json({ message: "Project not found." });
    const data = await prisma.projectShootDeliverable.findMany({
      where: { projectId: project.id, deletedAt: null },
      include: { shoot: { select: { id: true, shootId: true, shoot: true, dateCreated: true, shootPlace: true, shootType: true, shootTypes: true, isMainEvent: true, district: true, state: true, sessionTiming: true, sessionTimings: true, sessionDurationHours: true, sessionDurationMinutes: true } } },
      orderBy: [{ shoot: { dateCreated: "asc" } }, { createdAt: "asc" }],
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
        orderBy: [{ shoot: { dateCreated: "asc" } }, { createdAt: "asc" }],
      });
    });
    return res.json({ data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to save production deliverables:", error);
    return res.status(500).json({ message: "Unable to save production deliverables." });
  }
}

async function listServiceDefinitions(req, res) {
  try {
    const data = await prisma.projectServiceDefinition.findMany({
      where: { isActive: true },
      include: serviceDefinitionInclude,
      orderBy: [{ name: "asc" }],
    });
    return res.json({ data: await withPricedSizeOptions(data) });
  } catch (error) {
    console.error("Unable to load service definitions:", error);
    return res.status(500).json({ message: "Unable to load service definitions." });
  }
}

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
        const data = await prisma.projectServiceDefinition.update({
          where: { id: existing.id },
          data: { name, code, isActive: true },
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
      /*
       * The deliverable variants each booking brings with it, kept only where the service says it
       * brings any - a service answered No stores none, so turning the question off is what takes
       * the mapping out rather than leaving it stored and invisible.
       *
       * Every mapping is checked against the deliverables that actually exist, brand and variant
       * together: an id naming nothing, or a variant named under a brand that does not hold it, is
       * dropped rather than stored. There is no foreign key to do this - the mapping rides in the
       * `pricing` JSON, so that it stays attached to its line when the line is edited - so it is
       * done here, once per save, rather than trusted from the form.
       */
      const bringsDeliverables = input.deliverableAdded !== undefined ? input.deliverableAdded === true : existing.deliverableAdded === true;
      const offeredVariants = new Set();
      if (bringsDeliverables) {
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
      const mappedDeliverables = (row) => {
        if (!bringsDeliverables) return {};
        const seenVariants = new Set();
        const kept = (row.deliverables || []).filter((entry) => {
          const key = `${entry.deliverableId}::${entry.brandId}::${entry.variantId}`;
          // A booking brings a variant once; asking for it twice is one line, not two.
          if (seenVariants.has(key) || !offeredVariants.has(key)) return false;
          seenVariants.add(key);
          return true;
        });
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
      orderBy: [{ name: "asc" }],
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
        const data = await prisma.projectDeliverableDefinition.update({
          where: { id: existing.id },
          data: { name, code, isActive: true },
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
      if (brands !== undefined) {
        // The variants go with their brands - `ON DELETE CASCADE` - so only the brands are deleted.
        await transaction.projectDeliverableBrand.deleteMany({ where: { definitionId: existing.id } });
        for (const [index, brand] of brands.entries()) {
          await transaction.projectDeliverableBrand.create({
            data: {
              definitionId: existing.id,
              name: brand.name,
              sortOrder: index,
              variants: { create: brand.variants.map((variant, inner) => ({ ...variant, sortOrder: inner })) },
            },
          });
        }
      }
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
      orderBy: [{ shoot: { dateCreated: "asc" } }, { createdAt: "asc" }],
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
    return res.json({ data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to update service allocation:", error);
    return res.status(500).json({ message: "Unable to update service allocation." });
  }
}

async function deleteServiceAllocation(req, res) {
  try {
    const result = await prisma.$transaction(async (transaction) => {
      const now = new Date();
      const existing = await transaction.projectPostProductionAllocation.findFirst({
        where: { id: req.params.allocationId, projectId: req.params.id, deletedAt: null },
        select: { id: true, projectId: true, shootId: true },
      });
      if (!existing) return { count: 0 };
      const updateResult = await transaction.projectPostProductionAllocation.updateMany({
        where: { id: existing.id, projectId: req.params.id, deletedAt: null },
        data: { deletedAt: now },
      });
      if (updateResult.count === 1) {
        await transaction.projectPostProductionWorkflowAllocation.updateMany({
          where: { serviceAllocationId: existing.id, projectId: req.params.id, deletedAt: null },
          data: { deletedAt: now },
        });
        await syncAutoDeliverablesForShoot(transaction, existing.projectId, existing.shootId);
      }
      return updateResult;
    });
    if (result.count !== 1) return res.status(404).json({ message: "Service allocation not found for this project." });
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
      orderBy: [{ shoot: { dateCreated: "asc" } }, { createdAt: "asc" }],
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
      const duplicate = await transaction.projectShootDeliverable.findFirst({
        where: { projectId: shoot.projectId, shootId: shoot.id, deliverableDefinitionId: definition.id, deletedAt: null },
        select: { id: true },
      });
      if (duplicate) {
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
        },
        include: deliverableAllocationInclude,
      });
    });
    return res.status(201).json({ data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to add deliverable allocation:", error);
    return res.status(500).json({ message: "Unable to add deliverable allocation." });
  }
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
    return res.json({ data });
  } catch (error) {
    console.error("Unable to update deliverable allocation:", error);
    return res.status(500).json({ message: "Unable to update deliverable allocation." });
  }
}

async function deleteDeliverableAllocation(req, res) {
  try {
    const result = await prisma.projectShootDeliverable.updateMany({
      where: { id: req.params.allocationId, projectId: req.params.id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count !== 1) return res.status(404).json({ message: "Deliverable allocation not found for this project." });
    return res.json({ message: "Deliverable allocation removed successfully." });
  } catch (error) {
    console.error("Unable to delete deliverable allocation:", error);
    return res.status(500).json({ message: "Unable to delete deliverable allocation." });
  }
}

module.exports = { codeFor, deliverableBrandsForSave, recordProjectAdvance, projectAdvanceOptions, syncProjectShootDeliverables, requireStartedProjectEditor, mayEditStartedProject, STARTED_PROJECT_EDIT_REFUSAL, SHOW_ALL_PROJECTS_WRITE, requireProjectEditor, requireProjectDeleter, mayEditProject, mayDeleteProject, PROJECT_STAFF_FIELDS, PROJECT_EDIT_REFUSAL, PROJECT_DELETE_REFUSAL, finalizedFields, quotationPayloadSchema, quotationData, startProjectSchema, startProjectDraftSchema, listProjects, listEnquiries, listQuotations, getQuotation, createQuotation, createQuotationVersion, duplicateQuotation, renewQuotationLink, deleteQuotation, deleteQuotationRecord, publicQuotation, quotationLinkState, quotationLinkExpiry, quotationIdFor, QUOTATION_LINK_VALIDITY_DAYS, publicQuotationPdf, quotationPdf, listSourceBranches, listCrmEmployees, listActiveEmployees, createProject, projectImportTemplate, importProjects, updateProject, deleteProject, deleteProjectRecord, startProject, saveStartProjectDraft, listProjectShoots, listProjectPayments, createProjectShoots, updateProjectShoot, deleteProjectShoot, listProductionDeliverables, replaceProductionDeliverables, listProjectOptionSets, createProjectOptionSetValue, updateProjectOptionSetValue, listServiceDefinitions, createServiceDefinition, updateServiceDefinition, listDeliverableDefinitions, createDeliverableDefinition, updateDeliverableDefinition, listServiceAllocations, createServiceAllocation, updateServiceAllocation, deleteServiceAllocation, listDeliverableAllocations, createDeliverableAllocation, updateDeliverableAllocation, deleteDeliverableAllocation, deleteDeliverableDefinition, deleteProjectOptionSetValue, deleteServiceDefinition };
