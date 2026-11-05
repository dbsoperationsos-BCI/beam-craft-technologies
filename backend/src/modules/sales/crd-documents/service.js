const crypto = require("crypto");
const { SHOOT_DATE_ASC } = require("../../../services/shootOrder");
const { snapshotDocumentBranding, brandingForDocument } = require("../../../services/documentBranding");
const { z } = require("zod");
const prisma = require("../../../config/db");
const { eventsForShoots, shootsForEvents } = require("./events");
const { storeImage, storeImages, discardUploads } = require("../../../services/imageStorage");
const { storeDocuments } = require("../../../services/documentStorage");
const { normalizePhoneNumber } = require("../../../services/phoneNumber");
const { verticalCode, verticalName, fillVerticalsFromLeads, VERTICAL_CODES } = require("../../../services/salesVertical");
// `SIDES` alone from the Dum Dum document: the schema, empty shape and completeness checks are
// reached through `verticalDocument` instead, which answers them per vertical.
const { SIDES, liftSideEvent } = require("./document");
const { emptyDocumentFor, documentSchemaFor, missingRequiredFor, completionPercentFor } = require("./verticalDocument");
const { createSettingsService } = require("../crd-terms-settings/service");
const { nextIdentifier } = require("../../../services/identifiers");
const { lookups: referenceLookups } = require("../../../services/referenceMatchers");

const crdTermsSettingsService = createSettingsService();

/**
 * The public CRD document link, and the Customer Identification Document filled through it.
 *
 * Nothing here writes to SalesProject. The link reads the project to name the event and fill the
 * WhatsApp Group Name in, and the client's answers live on the CRD row beside it — so a client
 * correcting their own details cannot silently rewrite what Sales Manager holds. Reconciling the two
 * is a studio decision and stays a studio decision.
 *
 * The document is saved as it is filled in and submitted once at the end, because two different
 * people fill it: the groom side may complete their tab days before the bride side opens the link.
 */

// 12 random bytes as base64url is exactly 16 characters, which is what the column holds. Long
// enough that a link carrying a client's details cannot be guessed by trying tokens.
const TOKEN_BYTES = 12;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16}$/;
// How many times a token collision is retried before giving up. A collision needs two of 2^96
// values to match, so this is a formality rather than an expectation.
const TOKEN_ATTEMPTS = 5;
const CRD_IMAGE_FOLDER = "crd-documents";
const CRD_QQ_REFERENCE_FOLDER = "crd-documents/qua-qua-references";

// How a row on the CRD Documents screen came to exist. A project answered "Applicable" at Start /
// Edit Project and brings its own row; anything else was raised by hand from Create CRD Document.
const TYPE_PROJECT = "Project";
const TYPE_MANUAL = "Manual";
// The answer that keeps a project off this screen. Stored as "Not Applicable"; the project form
// shows it as "Non Applicable" and converts on the way in (crdStatusForPayload in
// StartProjectFormPanel.js).
const CRD_NOT_APPLICABLE = "Not Applicable";

/**
 * The projects with no row of their own on this screen, which is exactly the set a document may be
 * raised against by hand.
 *
 * Two answers put a project here and they are the complement of what `listDocuments` lists below:
 * "Not Applicable", the deliberate opt-out, and *no answer yet* — CRD Document is asked at Start
 * Project, so every booking still waiting to be started holds `null`. Leaving those out is what
 * made Create CRD Document unusable: the dialog offers only the projects in this set, and on a
 * studio where nobody had opted a project out, that set was empty and every vertical read "No
 * project is waiting for a CRD document". A client needing their CRD form before their project is
 * started is the ordinary case, not an edge one.
 */
const NO_OWN_CRD_ROW = { OR: [{ crdDocumentStatus: null }, { crdDocumentStatus: CRD_NOT_APPLICABLE }] };

/*
 * What a document's own `status` column says before anybody has sent its link.
 *
 * The register has always had a **Link Not sent** state, and it used to mean "no document row at
 * all" - the row was created by Send Link, so the identifier did not exist until then either. A
 * project answering "Applicable" now raises its document straight away, so that state has to be
 * carried by the document rather than by its absence, or the moment a project said Applicable it
 * would jump to "Yet To Receive" and the studio would lose the distinction between a link it has
 * sent and one it has not.
 *
 * `Sent` stays the column's default, because every other way a row is created is an issued link.
 */
const CRD_NOT_SENT = "Not Sent";

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function newToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

const projectSelect = {
  id: true,
  eventId: true,
  enquiryId: true,
  whatsappGroupName: true,
  whatsappGroupNameId: true,
  groupNameGeneratorJson: true,
  clientMainNumber: true,
  vertical: true,
  sourceBranch: true,
  crmName: true,
  projectStatus: true,
  /*
   * Who the document is on: the project's **pre-production coordinator**.
   *
   * Not a column on the document. That person is already named on the project and is already one of the
   * five columns `dataScope` narrows the register by - see `NAMED_ON_FIELDS` - which is why the document
   * reaches them at all. A copy of the id here would be the same fact in two rows, for the two to
   * disagree the first time a project's coordinator changed.
   *
   * The relation as well as the text, because the text is a copy (Rule 5): the current name comes back
   * from the employee, and the copy answers only for rows filled in before anybody was linked.
   */
  preProductionCoordinator: true,
  preProductionCoordinatorEmployeeId: true,
  preProductionCoordinatorEmployee: { select: { employeeName: true, employeeId: true } },
};

// Everything the studio side reads off a document row. A standalone document carries its own
// client details, because there is no project to read them from yet.
const documentSelect = {
  id: true,
  documentCode: true,
  projectId: true,
  publicToken: true,
  shareToken: true,
  status: true,
  vertical: true,
  enquiryId: true,
  clientName: true,
  groomName: true,
  brideName: true,
  contactNumber: true,
  submittedAt: true,
  createdAt: true,
  updatedAt: true,
};

const compact = (value) => String(value || "").trim();
const firstFilled = (...values) => values.map(compact).find(Boolean) || "";

/** The event type a vertical implies, for the one required field a blank document cannot answer. */
function eventTypeForVertical(vertical) {
  return verticalCode(vertical) === "WED" ? "Wedding" : verticalName(vertical);
}

/** The name a standalone document goes by in the table: the client, or the couple. */
function standaloneClientName(document) {
  return compact(document.clientName) || [compact(document.groomName), compact(document.brideName)].filter(Boolean).join(" & ");
}

const leadSelect = {
  enquiryId: true,
  name: true,
  phone: true,
  whatsappNumber: true,
  crm: true,
  referredFrom: true,
  referenceName: true,
  referenceContact: true,
  eventPlannedType: true,
  eventPlannedDate: true,
  groomName: true,
  groomContact: true,
  groomLocation: true,
  brideName: true,
  brideContact: true,
  brideLocation: true,
  city: true,
  state: true,
  location: true,
  shootType: true,
  shootCity: true,
  projectType: true,
  companyName: true,
  primaryDecisionMaker: true,
  contactNumber: true,
  alternateMobileNumber: true,
  date: true,
  babyOrMotherName: true,
  shoots: true,
};

function dateTimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

function splitName(value) {
  const parts = compact(value).split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") };
}

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
  } catch {
    return [];
  }
}

function dateOnlyLocalValue(value) {
  const raw = compact(value);
  if (!raw) return "";
  const iso = raw.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso) return `${iso}T00:00`;
  const slash = raw.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (slash) {
    const [, day, month, year] = slash;
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00`;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 16);
  return "";
}

function dumDumNamesFromGeneratedName(value) {
  const firstPart = compact(value).split("|")[0] || "";
  const match = firstPart.match(/\b(.+?)\s*&\s*(.+)$/);
  if (!match) return {};
  return { groomName: compact(match[1]).split(/\s+/).slice(3).join(" "), brideName: compact(match[2]) };
}

/**
 * Fills a field the document has not answered, and says whether it did.
 *
 * The answer is what tells a value the studio knew from one the client typed - see
 * `prefilledCommonFields`, which the public read works out by comparing the stored document against
 * this one.
 */
function fillBlank(target, field, value) {
  if (compact(target[field]) || !compact(value)) return false;
  target[field] = compact(value);
  return true;
}

function parseReferenceRows(value) {
  try {
    const parsed = JSON.parse(compact(value));
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
  } catch {
    return [];
  }
}

function stringifyReferenceRows(rows) {
  const clean = rows.map((row) => ({
    link: compact(row.link),
    remark: compact(row.remark),
    image: compact(row.image),
  })).filter((row) => row.link || row.remark || row.image);
  return clean.length ? JSON.stringify(clean) : "";
}

function validHttpUrl(value) {
  const link = compact(value);
  if (!link) return true;
  try {
    const url = new URL(link);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function invalidReferenceFields(document) {
  return ["photoReferenceLinks", "videoReferenceLinks", "otherReferenceLinks"].filter((field) => {
    const value = document?.common?.[field] ?? document?.[field];
    const rows = parseReferenceRows(value);
    if (rows.length) return rows.some((row) => row.link && !validHttpUrl(row.link));
    return compact(value).split(/\n+/).filter(Boolean).some((link) => !validHttpUrl(link));
  });
}

function mergeSidePrefill(document, side, { name, phone }) {
  const sideData = { ...(document[side] || {}) };
  const split = splitName(name);
  fillBlank(sideData, "firstName", split.firstName);
  fillBlank(sideData, "lastName", split.lastName);
  fillBlank(sideData, "nameToBeUsedInProject", name);
  fillBlank(sideData, "contactNumber", phone);
  // No event here any more. It was filled onto both sides, which asked the groom and the bride the
  // same question and stored two answers to it; it is one event, so it is filled once, onto the
  // common block - see `documentWithPrefill`.
  return sideData;
}

/**
 * Everything the public form starts out filled with.
 *
 * `subject` is a project, or the project-shaped stand-in a standalone document describes itself
 * with; `row` is the document itself, whose own details - the names and number the create dialog
 * asked for - lead every chain below, because they are the most recent thing anybody typed.
 */
async function prefillForProject(project, row = null) {
  const [groupName, lead, mainShoot, firstShoot] = await Promise.all([
    project.whatsappGroupNameId
      ? prisma.salesWhatsappGroupName.findUnique({ where: { id: project.whatsappGroupNameId } })
      : null,
    project.enquiryId
      ? prisma.salesCrmLead.findFirst({ where: { enquiryId: project.enquiryId, deletedAt: null }, select: leadSelect })
      : null,
    // No project means no shoots to read: a standalone document is issued before any exist.
    project.id ? prisma.projectShoot.findFirst({
      where: { projectId: project.id, deletedAt: null, isMainEvent: true },
      orderBy: [{ dateCreated: SHOOT_DATE_ASC }, { createdAt: "asc" }],
    }) : null,
    project.id ? prisma.projectShoot.findFirst({
      where: { projectId: project.id, deletedAt: null },
      orderBy: [{ dateCreated: SHOOT_DATE_ASC }, { createdAt: "asc" }],
    }) : null,
  ]);
  const snapshot = project.groupNameGeneratorJson && typeof project.groupNameGeneratorJson === "object" ? project.groupNameGeneratorJson : {};
  const generatedFallback = dumDumNamesFromGeneratedName(project.whatsappGroupName);
  const shoot = mainShoot || firstShoot;
  const leadShoots = parseJsonArray(lead?.shoots);
  const leadShoot = leadShoots[0] || {};
  const leadEventDate = firstFilled(lead?.eventPlannedDate, lead?.date, leadShoot.dateCreated, leadShoot.date);
  const leadEventLocation = firstFilled(lead?.location, leadShoot.shootPlace, lead?.shootCity, lead?.city);
  const leadPrimaryContact = firstFilled(row?.contactNumber, lead?.whatsappNumber, lead?.phone, lead?.contactNumber, lead?.alternateMobileNumber, project.clientMainNumber);
  const companyOrDecisionMaker = firstFilled(lead?.primaryDecisionMaker, lead?.companyName);

  return {
    groupName,
    shoot,
    lead,
    groomName: firstFilled(row?.groomName, groupName?.groomName, snapshot.groomName, generatedFallback.groomName, lead?.groomName),
    groomPhone: firstFilled(lead?.groomContact, leadPrimaryContact),
    groomLocation: firstFilled(lead?.groomLocation, leadEventLocation),
    brideName: firstFilled(row?.brideName, groupName?.brideName, snapshot.brideName, generatedFallback.brideName, lead?.brideName),
    bridePhone: firstFilled(lead?.brideContact),
    brideLocation: firstFilled(lead?.brideLocation, leadEventLocation),
    clientName: firstFilled(row?.clientName, groupName?.clientName, snapshot.clientName, lead?.name, companyOrDecisionMaker, lead?.babyOrMotherName),
    eventType: firstFilled(groupName?.eventName, snapshot.eventName, lead?.eventPlannedType, lead?.shootType, leadShoot.shoot, lead?.projectType, groupName?.groupType === "Dum Dum" ? "Wedding" : groupName?.groupType, eventTypeForVertical(project.vertical)),
    eventStartAt: dateOnlyLocalValue(leadEventDate),
    pointOfContactName: companyOrDecisionMaker,
    pointOfContactPhone: firstFilled(row?.contactNumber, lead?.contactNumber, lead?.alternateMobileNumber),
    referredBy: firstFilled(lead?.referenceName, lead?.referredFrom, lead?.referenceContact),
  };
}

async function documentWithPrefill(project, document, row = null) {
  const prefill = await prefillForProject(project, row);
  const next = {
    ...document,
    common: { ...(document.common || {}) },
  };

  // The booking's own Event ID, so the client can see which shoot this form is for. Blank for a
  // document raised by hand, whose project does not exist yet - `subjectForDocument` answers "".
  fillBlank(next.common, "eventId", project.eventId);
  fillBlank(next.common, "whatsappGroupName", project.whatsappGroupName);
  fillBlank(next.common, "eventType", prefill.eventType || eventTypeForVertical(project.vertical));
  fillBlank(next.common, "pointOfContactName", prefill.pointOfContactName);
  fillBlank(next.common, "pointOfContactPhone", prefill.pointOfContactPhone);
  fillBlank(next.common, "referredBy", prefill.referredBy);

  /*
   * When the event starts, from the booking's own main shoot.
   *
   * On the common block, because there is one event. The lead's planned date leads the shoot's, the
   * way every other chain here does: it is what somebody typed most recently about this event. The
   * client's form shows it read back where this fills it in, and asks for it where it does not - a
   * booking taken before the date was settled leaves it blank, and the client is the one who knows.
   *
   * ── Why the end is not filled from the start ──
   *
   * It was: `eventEndAt` took the same value, so every document arrived claiming the wedding ended
   * the moment it began. Nothing in the studio's data answers when an event *ends* - the lead has a
   * planned date and the shoot has a created date, and neither is an end time - so that was a
   * fabricated answer, and a fabricated answer is worse than a blank one now that the form reads
   * "the studio has filled this in" as "do not ask the client". It left the box holding a wrong
   * time that nobody could correct. Blank, it is a question, which is what it always was.
   */
  const shootAt = dateTimeLocalValue(prefill.shoot?.dateCreated);
  const startFromBooking = prefill.eventStartAt || shootAt;
  fillBlank(next.common, "eventStartAt", startFromBooking);

  /*
   * Which of the two dates the *booking* answers, which is not the same question as which one this
   * call happened to fill in.
   *
   * The client's form reads this: a date the studio knows is read back, and one it does not is the
   * client's to give. It has to be answered from the booking rather than from the document, because
   * the document loses the distinction the moment anything is saved - the prefilled start date is
   * written back with the rest and is then indistinguishable from a date the client typed. Asked of
   * the booking it is stable: the same answer on the client's first visit and their fifth.
   *
   * `eventEndAt` is never on this list. Nothing in the studio's data says when an event ends - the
   * lead has a planned date and the shoot a created date, neither of which is one - so the end time
   * is the client's question every time, and their answer stays theirs.
   */
  next.studioAnswered = compact(startFromBooking) ? ["eventStartAt"] : [];

  // One event per shoot of the project, the client's answers kept per shoot (`events.js`).
  next.common.events = eventsForShoots(await shootsForEvents(prisma, project.id), next.common.events, next.common);

  next.groom = mergeSidePrefill(next, "groom", { name: prefill.groomName, phone: prefill.groomPhone || project.clientMainNumber });
  next.bride = mergeSidePrefill(next, "bride", { name: prefill.brideName, phone: prefill.bridePhone });
  return next;
}

// Mirrors the CRM lead's own Shoot Type choices (`shootOptions` in
// frontend/src/components/sales/CRMPage.js) against Qua Qua's closed set of options. Only mapped
// where the match is unambiguous - a lead logged as "Birthday Shoot", say, could be any of Qua
// Qua's own birthday-adjacent options, and guessing wrong would be worse than leaving the field for
// the client to answer, because Shoot Type decides which Birthdays questions they are asked next.
const QQ_SHOOT_TYPE_FROM_LEAD = {
  "baby shoot ih": "Baby Shoot",
  "baby shoot oh": "Baby Shoot",
  "new born": "Baby Shoot",
  "baby shower": "Baby Shower",
  "maternity ih": "Maternity Shoot",
  "maternity oh": "Maternity Shoot",
  "naming ceremony": "Naming Ceremony",
};

function quaQuaShootTypeFromLead(leadShootType) {
  return QQ_SHOOT_TYPE_FROM_LEAD[compact(leadShootType).toLowerCase()] || "";
}

// Mirrors the branch spellings already in use elsewhere (`fallbackSourceBranches` in
// projects/controller.js, `assignedBranchOptions` in quotationVerticalConfig.js) against Qua Qua's
// own "City, ST" labels. Matched on the city name alone, so "Erode TN", "Erode" and "Erode, TN"
// all resolve to the same option.
const QQ_BRANCH_BY_CITY = {
  erode: "Erode, TN",
  coimbatore: "Coimbatore, TN",
  tiruppur: "Tiruppur, TN",
  bangalore: "Bangalore, KA",
  bengaluru: "Bangalore, KA",
  vizag: "Vizag, AP",
  visakhapatnam: "Vizag, AP",
  hyderabad: "Hyderabad, TS",
};

function quaQuaBranchFromCity(value) {
  const city = compact(value).toLowerCase().split(/[\s,]+/)[0];
  return QQ_BRANCH_BY_CITY[city] || "";
}

/**
 * Qua Qua's own prefill: WhatsApp Group Name, Branch and Shoot Type, read from the project this
 * document is linked to (when it has one) and the CRM lead behind its Enquiry ID (project-backed or
 * standalone alike - `subject` carries the Enquiry ID either way, see `subjectForDocument`).
 *
 * Deliberately smaller than Dum Dum's own prefill: Qua Qua's Identification page asks nothing else
 * a project or lead could answer with confidence, and every field here only fills in where blank -
 * see `fillBlank` - so nothing already typed is overwritten.
 */
async function documentWithPrefillQuaQua(project, document) {
  const next = { ...document };
  const lead = project.enquiryId
    ? await prisma.salesCrmLead.findFirst({ where: { enquiryId: project.enquiryId, deletedAt: null }, select: { shootType: true, city: true, shootCity: true } })
    : null;

  fillBlank(next, "eventId", project.eventId);
  fillBlank(next, "whatsappGroupName", project.whatsappGroupName);
  fillBlank(next, "branch", quaQuaBranchFromCity(project.sourceBranch) || quaQuaBranchFromCity(lead?.city) || quaQuaBranchFromCity(lead?.shootCity));
  fillBlank(next, "shootType", quaQuaShootTypeFromLead(lead?.shootType));
  // One event per shoot of the project, the client's answers kept per shoot (`events.js`).
  next.events = eventsForShoots(await shootsForEvents(prisma, project.id), next.events);
  return next;
}

/**
 * Every document belongs to a project - the one it hangs off, or for a document raised by hand, the
 * one that answered Not Applicable and shares its enquiry. So a document is readable exactly when
 * that project is, under `projectAccessWhere` (DATA-SCOPE.md D16): `access` is that rule, resolved
 * by the controller for the signed-in user and passed down. Out of reach reads as not found, on
 * purpose - whether the project exists is itself something the scope hides.
 */
async function readProject(projectId, where = {}) {
  return prisma.salesProject.findFirst({
    where: { id: String(projectId || "").trim(), deletedAt: null, ...where },
    select: projectSelect,
  });
}

async function findLiveProject(projectId, access) {
  const project = await readProject(projectId, { AND: [accessOrNothing(access)] });
  if (!project) throw httpError(404, "Project not found.");
  return project;
}

/**
 * A project-shaped view of whatever a document belongs to.
 *
 * A document created from the CRD Documents screen has no project behind it yet - the studio needs
 * the client's details before the project exists, not after - so the details the create dialog
 * asked for stand in for one. Every reader below then works the same way whether or not a project
 * exists, instead of testing for it in a dozen places.
 *
 * Read without an access rule, and that is the whole point of it being its own function. Every
 * caller has already settled who may read this document before getting here: the public form and
 * the response share link are authenticated by their token, and the studio-side readers went
 * through `readableDocumentById` first. Passing no `access` down to `findLiveProject` instead
 * resolves to "no access at all" (`accessOrNothing`), which is what made every project-backed CRD
 * link answer the client "Project not found." rather than opening their form.
 */
async function subjectForDocument(row) {
  if (row.projectId) {
    const project = await readProject(row.projectId);
    if (!project) throw httpError(404, "Project not found.");
    return project;
  }
  return {
    id: null,
    eventId: "",
    enquiryId: compact(row.enquiryId),
    whatsappGroupName: "",
    whatsappGroupNameId: null,
    groupNameGeneratorJson: null,
    clientMainNumber: compact(row.contactNumber),
    vertical: row.vertical || null,
    sourceBranch: "",
    crmName: "",
    projectStatus: "",
  };
}

/** Where a submitted response is read, given the share token that opens it. */
const responsePath = (shareToken) => `/crd/response/${shareToken}`;

function serialize(document) {
  return {
    id: document.id,
    projectId: document.projectId,
    vertical: document.vertical || null,
    // What the studio calls this document: DBS-CRD-DD-000001. Null on the handful issued before
    // documents were given an identifier of their own.
    documentCode: document.documentCode || "",
    publicToken: document.publicToken,
    // The origin is the browser's to add, the same way the public quotation link is composed.
    publicPath: `/crd/${document.publicToken}`,
    // Only once one has been asked for — the row shows Share Response either way, and issuing it is
    // what fills this in.
    sharePath: document.shareToken ? responsePath(document.shareToken) : "",
    status: document.status,
    submittedAt: document.submittedAt,
    createdAt: document.createdAt,
  };
}

function statusForDocument(document) {
  if (document?.submittedAt || document?.status === "Submitted") return "Submitted";
  // A document raised by the project answering "Applicable", whose link nobody has sent yet. It
  // exists - and so does its CRD ID - but the client has not been given it, which is the same thing
  // the studio read when no row existed at all.
  if (document?.status === CRD_NOT_SENT) return "Link Not sent";
  if (document) return "Yet To Receive";
  return "Link Not sent";
}

function receivedAtForDocument(document) {
  return document?.submittedAt || null;
}

/**
 * Every CRD document the studio has on the go: one row per project that needs one, plus every
 * document created on its own from this screen before its project existed.
 *
 * The vertical decides which form the client's link renders, so it is answered for both kinds of
 * row - from the project, or from the CRM lead behind the enquiry when the project was saved
 * without one.
 */
/** No access resolved is no access - never the whole register. */
function accessOrNothing(access) {
  return access || { id: { in: [] } };
}

/** The project a document answers to, if the caller may see it. */
async function readableProjectFor(document, access) {
  const where = document.projectId
    ? { id: document.projectId, AND: [accessOrNothing(access)] }
    : { enquiryId: compact(document.enquiryId) || "", AND: [NO_OWN_CRD_ROW, accessOrNothing(access)] };
  return prisma.salesProject.findFirst({ where: { ...where, deletedAt: null }, select: { id: true } });
}

/**
 * The extra narrowing behind the screen's **My Documents** switch, or nothing.
 *
 * `mine` is `{ employeeId, userId, seesUnassigned }` - the shape the CRM board's own toggle uses. A
 * document is mine when its project's **pre-production coordinator is me**, which is the owner the
 * Assigned To column names: narrowing on all five named-on columns would answer "projects I am involved
 * in", a different question, and would leave the column and the switch disagreeing about whose row it is.
 *
 * A project with **no coordinator** belongs to nobody, and most do not have one yet. Such a row has to
 * surface somewhere or it is only ever found by turning the switch off, so it surfaces for a reader who
 * sees everything - they are the ones who staff projects, and an unowned document is work waiting to be
 * given out. A coordinator reading their own work is not shown other people's unstaffed documents.
 */
function mineWhere(mine) {
  if (!mine?.employeeId) return null;
  const own = [{ preProductionCoordinatorEmployeeId: mine.employeeId }];
  if (mine.seesUnassigned) own.push({ preProductionCoordinatorEmployeeId: null });
  return { OR: own };
}

async function listDocuments({ access, mine } = {}) {
  const [projects, documents] = await Promise.all([
    prisma.salesProject.findMany({
      where: {
        deletedAt: null,
        crdDocumentStatus: { not: null },
        NOT: { crdDocumentStatus: CRD_NOT_APPLICABLE },
        // The scope first, then the switch: "only mine" narrows what the reader may see and can never
        // widen it.
        AND: [accessOrNothing(access), ...(mineWhere(mine) ? [mineWhere(mine)] : [])],
      },
      select: {
        ...projectSelect,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    // `documentSelect` already names every column both sides read, `documentCode` included.
    prisma.salesProjectCrdDocument.findMany({ select: documentSelect }),
  ]);

  const documentsByProjectId = new Map(documents.filter((document) => document.projectId).map((document) => [document.projectId, document]));

  const projectRows = projects.map((project) => {
    const document = documentsByProjectId.get(project.id) || null;
    return {
      ...project,
      clientName: project.whatsappGroupName,
      // Read through the relation, with the project's own copy behind it - see `projectSelect`.
      assignedTo: project.preProductionCoordinatorEmployee?.employeeName || project.preProductionCoordinator || "",
      assignedToEmployeeCode: project.preProductionCoordinatorEmployee?.employeeId || "",
      // Where the row came from: a project carries its own, which is what Start / Edit Project
      // created. See TYPE_MANUAL for the other kind.
      type: TYPE_PROJECT,
      // The identifier the studio calls this document by. Empty until the link is issued, which is
      // the moment the document exists at all - before that there is a project and no document.
      documentCode: document?.documentCode || "",
      status: statusForDocument(document),
      receivedAt: receivedAtForDocument(document),
      crdDocument: document ? serialize(document) : null,
    };
  });

  // A standalone document describes itself. It has no Event ID and no branch because there is no
  // project to take them from - the row is deliberately sparse rather than filled with guesses.
  // Listed only where the project it was raised for is readable and still has no row of its own
  // (`NO_OWN_CRD_ROW`): a document whose enquiry answers to no project the caller may see is
  // nobody's here, and one whose project has since been started as "Applicable" is shown through
  // that project's own row instead - see `ensureLink`, which adopts it rather than issuing a second.
  // Every document not shown through a project row above: linked to a project that answered "Not
  // Applicable" (raised by hand since 20260924150000), or, from before that, linked to nothing and
  // found through its enquiry.
  const projectRowIds = new Set(projects.map((project) => project.id));
  const standalone = documents.filter((document) => !projectRowIds.has(document.projectId));
  const linkedIds = standalone.map((document) => document.projectId).filter(Boolean);
  const enquiries = standalone.filter((document) => !document.projectId).map((document) => compact(document.enquiryId)).filter(Boolean);
  const readableProjects = linkedIds.length || enquiries.length
    ? await prisma.salesProject.findMany({
      where: { deletedAt: null, OR: [{ id: { in: linkedIds } }, { enquiryId: { in: enquiries } }], AND: [NO_OWN_CRD_ROW, accessOrNothing(access)] },
      select: { id: true, enquiryId: true },
    })
    : [];
  const readableIds = new Set(readableProjects.map((project) => project.id));
  const readableEnquiries = new Set(readableProjects.map((project) => compact(project.enquiryId)));
  const standaloneRows = standalone
    .filter((document) => (document.projectId ? readableIds.has(document.projectId) : readableEnquiries.has(compact(document.enquiryId))))
    .map((document) => ({
    id: `crd-${document.id}`,
    standalone: true,
    // Raised by hand from Create CRD Document, for a project whose CRD Document was answered
    // "Not Applicable" when it was started — those projects are filtered out of the list above,
    // so this row is the only place their document appears.
    type: TYPE_MANUAL,
    // Read off the row itself, because that is the column the register renders - `crdDocument`
    // beside it is what the row's actions use. A project row has said this all along; a standalone
    // one did not, so even a document holding a perfectly good identifier showed a blank CRD ID.
    documentCode: document.documentCode || "",
    eventId: "",
    enquiryId: compact(document.enquiryId),
    whatsappGroupName: "",
    clientName: standaloneClientName(document),
    clientMainNumber: compact(document.contactNumber),
    /*
     * Nobody. A document raised by hand against an enquiry that answers to no project has no
     * pre-production coordinator to take, and naming one would be a claim about who is responsible for
     * work that has not been staffed. Blank is the true answer.
     */
    assignedTo: "",
    assignedToEmployeeCode: "",
    sourceBranch: "",
    vertical: document.vertical || null,
    crmName: "",
    projectStatus: "",
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    status: statusForDocument(document),
    receivedAt: receivedAtForDocument(document),
    crdDocument: serialize(document),
  }));

  /*
   * A standalone document has no project and so no coordinator: with **My Documents** on it belongs to
   * nobody, exactly like a project with nobody staffed on it, and it is shown on the same rule - to a
   * reader who sees everything, and to nobody else.
   */
  const ownedStandalone = mine?.employeeId && !mine.seesUnassigned ? [] : standaloneRows;
  const rows = [...projectRows, ...ownedStandalone].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  return fillVerticalsFromLeads(rows);
}

/**
 * The Enquiry IDs a manual document may be raised against: the projects with no row of their own on
 * this screen, which is what makes this dialog the only way to give them a link — `NO_OWN_CRD_ROW`.
 *
 * Already-issued ones are dropped rather than shown and refused — a manual document is a new link
 * for a client each time it is pressed, so offering an Enquiry ID that already has one invites a
 * second link to the same event.
 *
 * A project with no Enquiry ID is left out. The Enquiry ID is not paperwork here: it is what the
 * client's form prefills from, and it is how the document finds its way back to the project once
 * that project is started.
 */
async function listAvailableEnquiryIds({ access } = {}) {
  const [projects, documents] = await Promise.all([
    prisma.salesProject.findMany({
      // Only projects the caller may see: a document may only be raised for one of those.
      where: { deletedAt: null, AND: [NO_OWN_CRD_ROW, accessOrNothing(access)] },
      select: { id: true, enquiryId: true, eventId: true, whatsappGroupName: true, vertical: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.salesProjectCrdDocument.findMany({ select: { enquiryId: true, projectId: true } }),
  ]);

  // Taken: a project already holding a document (linked), or - for documents from before the link
  // existed - an enquiry a document was raised against.
  const linkedProjects = new Set(documents.map((document) => document.projectId).filter(Boolean));
  const taken = new Set(documents.filter((document) => !document.projectId).map((document) => compact(document.enquiryId)).filter(Boolean));
  const rows = projects
    .filter((project) => compact(project.enquiryId) && !linkedProjects.has(project.id) && !taken.has(compact(project.enquiryId)))
    .map((project) => ({
      enquiryId: project.enquiryId,
      eventId: project.eventId || "",
      clientName: project.whatsappGroupName || "",
      vertical: project.vertical || null,
    }));

  // The dialog offers these under the vertical being created, so a project saved without one would
  // otherwise be missing from both lists rather than just the wrong one. Answered from the CRM lead
  // behind the enquiry, exactly as the table above answers it.
  return fillVerticalsFromLeads(rows);
}

/**
 * The details a document is created with from the CRD Documents screen.
 *
 * The vertical is what the client's link renders, so it is the one answer with no default: Dum Dum
 * asks for the couple, Qua Qua and Corp for the client. Everything else the form needs is the
 * client's to fill in through the link.
 */
const createDocumentSchema = z.object({
  vertical: z.enum(VERTICAL_CODES, { message: "Select a vertical." }),
  // Defaulted rather than required at the type level, so a request that leaves the key out is
  // answered with "Enquiry ID is required." from the refinement below rather than Zod's own
  // complaint about a missing string — the same shape every other required field here takes.
  enquiryId: z.string().trim().max(100).optional().default(""),
  clientName: z.string().trim().max(191).optional().default(""),
  groomName: z.string().trim().max(150).optional().default(""),
  brideName: z.string().trim().max(150).optional().default(""),
  contactNumber: z.string().trim().max(30).optional().default(""),
}).superRefine((data, context) => {
  if (data.vertical === "WED") {
    if (!data.groomName) context.addIssue({ code: z.ZodIssueCode.custom, path: ["groomName"], message: "Groom Name is required." });
    if (!data.brideName) context.addIssue({ code: z.ZodIssueCode.custom, path: ["brideName"], message: "Bride Name is required." });
  } else if (!data.clientName) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["clientName"], message: "Client Name is required." });
  }
  if (!data.contactNumber) context.addIssue({ code: z.ZodIssueCode.custom, path: ["contactNumber"], message: "Contact Number is required." });
  // A manual document is always raised against a project that opted out of collecting one, so the
  // Enquiry ID naming that project is what makes it possible at all — see createDocument.
  if (!data.enquiryId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["enquiryId"], message: "Enquiry ID is required." });
});

/**
 * Creates a CRD document and its link in one go, for a project that opted out of collecting one.
 *
 * A fresh token every time is right here, and wrong in `ensureLink`: this is a client being given
 * their own document, not the same project's link being re-copied. The Enquiry ID names the project
 * the document is raised for, and the document is linked to that project.
 */
async function createDocument(input, userId, { access } = {}) {
  const parsed = createDocumentSchema.safeParse(input || {});
  if (!parsed.success) {
    const error = httpError(400, parsed.error.issues[0]?.message || "Check these details and try again.");
    error.errors = parsed.error.flatten();
    throw error;
  }
  const data = parsed.data;

  const contactNumber = normalizePhoneNumber(data.contactNumber);
  if (!contactNumber) throw httpError(400, "Contact Number must include a country code and a full national number.");

  // The Enquiry ID has to be one this screen cannot already show. A project that answered
  // "Applicable" brings its own row and its own Send Link, so raising a second document by hand
  // for it would leave the client holding two links to the same event. Anything else - the
  // deliberate "Not Applicable", or a booking that has not been started and so has not been asked
  // yet - has no row at all, which is exactly what this button is for. See `NO_OWN_CRD_ROW`.
  const project = await prisma.salesProject.findFirst({
    where: { enquiryId: data.enquiryId, deletedAt: null, AND: [accessOrNothing(access)] },
    select: { id: true, crdDocumentStatus: true },
  });
  if (!project) throw httpError(404, "No project was found for that Enquiry ID.");
  if (project.crdDocumentStatus && project.crdDocumentStatus !== CRD_NOT_APPLICABLE) {
    throw httpError(409, "That project already collects a CRD document. Use Send Link on its own row instead.");
  }

  // The link is the document being issued, so this is where it takes the studio's logo - once,
  // and for good. See `src/services/documentBranding.js`.
  const branding = await snapshotDocumentBranding();
  // The reference beside the text, resolved the way every other writer of a vertical resolves it.
  // Written here rather than left for a backfill: a row whose `verticalId` disagrees with its
  // `vertical` is what `data-scope-backfill.test.js` fails on, and this create path was leaving
  // every manual document behind at null.
  const verticalId = (await referenceLookups()).verticalId(data.vertical);
  for (let attempt = 0; attempt < TOKEN_ATTEMPTS; attempt += 1) {
    try {
      const created = await prisma.salesProjectCrdDocument.create({
        data: {
          // The project it was raised for, since 20260924150000 - a document is the project's, and
          // goes with it. It used to be left null and found again through the enquiry every time;
          // the register still tells this kind of row apart by the project's own answer, not by
          // whether the link is there (see `listDocuments`).
          projectId: project.id,
          ...branding,
          publicToken: newToken(),
          /*
           * DBS-CRD-QQ-000001, counted per vertical - the same identifier `ensureLink` takes when a
           * project's own link is issued, and taken here for the same reason: this call *is* the
           * document being issued, and the studio quotes the identifier from the moment the link
           * goes out.
           *
           * It was left null, and nothing else ever filled it in: `ensureLink`'s adoption path
           * gives a code to a document a project later takes over, but a document raised for a
           * project answered "Not Applicable" is never adopted - that is the whole case this button
           * exists for. So those documents stood on the register with the CRD ID column blank for
           * good, which is most visible on Qua Qua, where the projects are the ones being answered
           * "Not Applicable" and then given a document by hand.
           */
          documentCode: await nextIdentifier("CRD_DOCUMENT", { vertical: data.vertical }),
          vertical: data.vertical,
          verticalId,
          enquiryId: data.enquiryId || null,
          clientName: data.clientName || null,
          groomName: data.groomName || null,
          brideName: data.brideName || null,
          contactNumber,
          createdByUserId: userId ?? null,
        },
        select: documentSelect,
      });
      return serialize(created);
    } catch (error) {
      // Only a token collision is worth another go, and it needs two of 2^96 values to match.
      if (error?.code !== "P2002" || !String(error.meta?.target || "").includes("publicToken")) throw error;
    }
  }
  throw httpError(500, "Unable to issue a CRD document link. Please try again.");
}

/**
 * A project that says it needs a CRD document gets one, the moment it says so.
 *
 * Called from the project save, beside `ensureProjectClientStorage`, and safe to call repeatedly:
 * it is the same call behind starting a project as "Applicable" and behind turning it Applicable
 * later from Edit Project on one already running.
 *
 * ── Why not wait for Send Link ──
 *
 * It used to. The document row was created by Send Link, so the CRD ID did not exist until somebody
 * pressed it - and the register, which lists every project answering "Applicable", showed those
 * projects with the identifier column reading "-". A project that has committed to collecting a CRD
 * document is a document the studio wants to be able to quote, whether or not the link has gone out
 * yet, so the identifier is taken here and the *sending* stays a separate act. `CRD_NOT_SENT` is
 * what keeps those two apart on the register.
 *
 * Nothing about this is per-vertical. The identifier counts within the vertical it names - Dum Dum
 * runs `DBS-CRD-DD-`, Qua Qua `DBS-CRD-QQ-` - and which vertical a project is on has never decided
 * *whether* it gets one. It only ever looked that way because the projects with an identifier were
 * the ones somebody had pressed Send Link on.
 *
 * ── What it will not do ──
 *
 * Nothing for a project that answered "Not Applicable" or has not been asked yet: those are the
 * projects `NO_OWN_CRD_ROW` describes, and raising a document for one would spend an identifier on
 * a document the studio has said it does not want - and would take the project out of the Create
 * CRD Document dialog, which is the only way such a project can be given a link at all.
 *
 * A document raised by hand for this project's enquiry is adopted rather than duplicated, exactly
 * as `ensureLink` adopts one: the client may already be filling it in.
 *
 * Runs inside the caller's transaction, so a project save that fails does not leave a document -
 * and does not spend an identifier - behind it.
 */
async function ensureProjectCrdDocument(client, projectId, options = {}) {
  const userId = Number(options.userId) || null;
  const project = await client.salesProject.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, vertical: true, enquiryId: true, crdDocumentStatus: true },
  });
  if (!project || !project.crdDocumentStatus || project.crdDocumentStatus === CRD_NOT_APPLICABLE) return null;

  const existing = await client.salesProjectCrdDocument.findUnique({ where: { projectId: project.id } });
  if (existing) return existing;

  // The same adoption `ensureLink` does, for the same reason: a second row here would strand the
  // URL the client is already holding. It keeps its token and its answers, and takes an identifier
  // if it somehow has none.
  const raisedByHand = compact(project.enquiryId)
    ? await client.salesProjectCrdDocument.findFirst({ where: { projectId: null, enquiryId: compact(project.enquiryId) } })
    : null;
  if (raisedByHand) {
    return client.salesProjectCrdDocument.update({
      where: { id: raisedByHand.id },
      data: {
        projectId: project.id,
        documentCode: raisedByHand.documentCode || await nextIdentifier("CRD_DOCUMENT", { vertical: raisedByHand.vertical || project.vertical }, client),
      },
    });
  }

  // The document takes the studio's logo as it is created, once and for good - the same snapshot
  // `ensureLink` took when it was the thing creating the row. See `services/documentBranding.js`.
  const branding = await snapshotDocumentBranding();
  for (let attempt = 0; attempt < TOKEN_ATTEMPTS; attempt += 1) {
    try {
      return await client.salesProjectCrdDocument.create({
        data: {
          projectId: project.id,
          ...branding,
          documentCode: await nextIdentifier("CRD_DOCUMENT", { vertical: project.vertical }, client),
          publicToken: newToken(),
          // The link exists but has not been handed to anybody. Send Link is what changes this.
          status: CRD_NOT_SENT,
          createdByUserId: userId,
        },
      });
    } catch (error) {
      if (error?.code !== "P2002") throw error;
      // Two saves racing for the same project: the loser reads what the winner wrote.
      const target = String(error.meta?.target || "");
      if (target.includes("projectId")) {
        const raced = await client.salesProjectCrdDocument.findUnique({ where: { projectId: project.id } });
        if (raced) return raced;
      }
    }
  }
  throw httpError(500, "Unable to raise the CRD document for this project. Please try again.");
}

/**
 * The link for a project, issued once and handed back unchanged afterwards.
 *
 * Send Link is pressed more than once — to re-copy it, or because nobody is sure it went out — and
 * each press must produce the same URL. A fresh token every time would quietly invalidate the link
 * the client is already holding.
 */
async function ensureLink(projectId, userId, { access } = {}) {
  const project = await findLiveProject(projectId, access);

  const existing = await prisma.salesProjectCrdDocument.findUnique({ where: { projectId: project.id } });
  if (existing) {
    // The document was raised when the project answered "Applicable" and is still marked as never
    // sent. This press is the sending, so it is recorded - otherwise the row would sit on "Link Not
    // sent" for good and the studio could not tell it from a project whose link nobody had issued.
    // Anything further along - Sent already, In Progress, Submitted - is left exactly as it is.
    if (existing.status === CRD_NOT_SENT) {
      return serialize(await prisma.salesProjectCrdDocument.update({ where: { id: existing.id }, data: { status: "Sent" } }));
    }
    return serialize(existing);
  }

  /*
   * A link raised by hand before this project was started is this project's link.
   *
   * Create CRD Document issues a document against an Enquiry ID rather than a project, for the
   * projects with no row here yet - see `NO_OWN_CRD_ROW`. When such a project is then started as
   * "Applicable" it gains a row of its own, and Send Link on that row would otherwise mint a
   * second token and quietly strand the URL the client is already filling in. So the document is
   * adopted instead: it becomes this project's, keeps its token and everything the client has
   * saved, and takes the identifier it never had as a standalone document.
   */
  const raisedByHand = compact(project.enquiryId)
    ? await prisma.salesProjectCrdDocument.findFirst({ where: { projectId: null, enquiryId: compact(project.enquiryId) } })
    : null;
  if (raisedByHand) {
    const adopted = await prisma.salesProjectCrdDocument.update({
      where: { id: raisedByHand.id },
      data: {
        projectId: project.id,
        documentCode: raisedByHand.documentCode || await nextIdentifier("CRD_DOCUMENT", { vertical: raisedByHand.vertical || project.vertical }),
      },
    });
    return serialize(adopted);
  }

  // The link is the document being issued, so this is where it takes the studio's logo - once,
  // and for good. Re-pressing Send Link returns the existing row above and never re-snapshots.
  const branding = await snapshotDocumentBranding();
  for (let attempt = 0; attempt < TOKEN_ATTEMPTS; attempt += 1) {
    try {
      const created = await prisma.salesProjectCrdDocument.create({
        data: {
          projectId: project.id,
          ...branding,
          // DBS-CRD-DD-000001, counted per vertical. Taken here rather than when the client submits,
          // because the studio quotes this identifier from the moment the link goes out - and a
          // document only ever reaches this line once, since a second press reads back the first.
          documentCode: await nextIdentifier("CRD_DOCUMENT", { vertical: project.vertical }),
          publicToken: newToken(),
          createdByUserId: userId ?? null,
        },
      });
      return serialize(created);
    } catch (error) {
      if (error?.code !== "P2002") throw error;
      // Two presses racing for the same project: the loser reads what the winner wrote rather than
      // issuing a second link.
      const target = String(error.meta?.target || "");
      if (target.includes("projectId")) {
        const raced = await prisma.salesProjectCrdDocument.findUnique({ where: { projectId: project.id } });
        if (raced) return serialize(raced);
      }
    }
  }
  throw httpError(500, "Unable to issue a CRD document link. Please try again.");
}

/** A document row by the id the studio side holds — either the row's own id, or the `crd-<id>` a
 *  standalone row is listed under. */
async function findDocumentById(documentId) {
  const id = compact(documentId).replace(/^crd-/, "");
  if (!id) throw httpError(404, "This CRD document was not found.");
  const row = await prisma.salesProjectCrdDocument.findUnique({ where: { id } });
  if (!row) throw httpError(404, "This CRD document was not found.");
  return row;
}

/** The submitted answers plus what names the document, shared by the studio's own view and the
 *  public share link so both read exactly the same thing. */
async function responseFor(row) {
  // Refused until it has actually been submitted: a half-filled document is the client still
  // working, and showing it as their answer invites the studio to act on a draft.
  if (!row.submittedAt) throw httpError(409, "This CRD document has not been submitted yet.");
  const subject = await subjectForDocument(row);
  const vertical = row.vertical || subject.vertical || "";
  return {
    vertical,
    eventId: subject.eventId || "",
    clientName: subject.whatsappGroupName || standaloneClientName(row),
    enquiryId: compact(row.enquiryId) || compact(subject.enquiryId),
    submittedAt: row.submittedAt,
    status: row.status,
    // The logo the document was issued under, so the response reads under the same mark the form
    // did - the row's own, never today's Settings.
    ...brandingForDocument(row),
    // Stored as submitted, with no prefill merged over it — this is the client's answer, not the
    // form they were handed.
    document: storedDocument(row, vertical),
  };
}

/** What the client sent back, as the studio reads it from the row's own View. */
async function readResponse(documentId, { access } = {}) {
  return responseFor(await readableDocumentById(documentId, access));
}

/** `findDocumentById`, held to the caller's access: a document whose project is out of reach is not found. */
async function readableDocumentById(documentId, access) {
  const row = await findDocumentById(documentId);
  if (!(await readableProjectFor(row, access))) throw httpError(404, "This CRD document was not found.");
  return row;
}

/**
 * The read-only link to a submitted response, issued once and handed back unchanged afterwards.
 *
 * A second token rather than the one that opens the form: `publicToken` is what lets a client fill
 * and submit the document, so forwarding it to whoever wants to read the answers would hand them
 * that too. This one opens the response and nothing else.
 */
async function ensureResponseLink(documentId, { access } = {}) {
  const row = await readableDocumentById(documentId, access);
  if (!row.submittedAt) throw httpError(409, "This CRD document has not been submitted yet.");
  if (row.shareToken) return { shareToken: row.shareToken, sharePath: responsePath(row.shareToken) };

  for (let attempt = 0; attempt < TOKEN_ATTEMPTS; attempt += 1) {
    try {
      const saved = await prisma.salesProjectCrdDocument.update({ where: { id: row.id }, data: { shareToken: newToken() } });
      return { shareToken: saved.shareToken, sharePath: responsePath(saved.shareToken) };
    } catch (error) {
      // Only a token collision is worth another go, and it needs two of 2^96 values to match.
      if (error?.code !== "P2002" || !String(error.meta?.target || "").includes("share")) throw error;
    }
  }
  throw httpError(500, "Unable to issue a response link. Please try again.");
}

/** The response as anyone holding the share link reads it. */
async function readResponseByShareToken(token) {
  const value = compact(token);
  // An unparseable token is answered exactly like an unknown one, so nothing can be learned by
  // probing the shape of a valid link.
  if (!TOKEN_PATTERN.test(value)) throw httpError(404, "This response link is not valid.");
  const row = await prisma.salesProjectCrdDocument.findUnique({ where: { shareToken: value } });
  if (!row) throw httpError(404, "This response link is not valid.");
  return responseFor(row);
}

async function findByToken(token) {
  const value = String(token || "").trim();
  // An unparseable token is answered exactly like an unknown one, so nothing can be learned by
  // probing the shape of a valid link.
  if (!TOKEN_PATTERN.test(value)) throw httpError(404, "This CRD document link is not valid.");
  const document = await prisma.salesProjectCrdDocument.findUnique({ where: { publicToken: value } });
  if (!document) throw httpError(404, "This CRD document link is not valid.");
  return document;
}

/**
 * The document as stored, merged onto the empty shape for its vertical so a field added later reads
 * as blank.
 *
 * Dum Dum's is then lifted: the event was asked of each side and is now asked once on the common
 * block, so a document saved before that move holds its dates and venue on `groom` / `bride`. See
 * `liftSideEvent`. Done on every read rather than once by a migration, because it only ever fills a
 * blank - a document already carrying the event on its common block passes through untouched, and a
 * lifted document keeps the new shape the next time it is saved.
 *
 * Qua Qua's document has no sides and never asked the event per side, so there is nothing to lift.
 */
function storedDocument(row, vertical) {
  const saved = row?.submission && typeof row.submission === "object" && !Array.isArray(row.submission) ? row.submission : {};
  const parsed = documentSchemaFor(vertical).safeParse(saved);
  const document = parsed.success ? parsed.data : emptyDocumentFor(vertical);
  return vertical === "QQ" ? document : liftSideEvent(document);
}

/**
 * Pushes any newly picked image to R2 and swaps in the link that gets stored.
 *
 * `storeImage` returns an existing `http(s)` value untouched, so re-saving a document that already
 * carries uploaded photos never uploads them a second time. A failure part-way rolls back whatever
 * this call had already uploaded, so a failed save leaves no orphans in the bucket.
 */
async function storeDocumentImages(document) {
  const uploads = [];
  try {
    const next = { ...document };
    const common = { ...(document.common || {}) };
    const photoReferenceRows = parseReferenceRows(common.photoReferenceLinks);
    if (photoReferenceRows.length) {
      const referenceImages = await storeImages(photoReferenceRows.map((row) => row.image || ""), { folder: CRD_IMAGE_FOLDER });
      uploads.push(...referenceImages);
      let imageIndex = 0;
      const storedPhotoReferenceRows = photoReferenceRows.map((row) => {
        if (!row.image) return row;
        const image = referenceImages[imageIndex];
        imageIndex += 1;
        return { ...row, image: image ? image.url : "" };
      });
      common.photoReferenceLinks = stringifyReferenceRows(storedPhotoReferenceRows);
    }
    next.common = common;

    for (const side of SIDES) {
      const sideData = { ...(document[side] || {}) };

      const photo = await storeImage(sideData.photo || "", { folder: CRD_IMAGE_FOLDER });
      if (photo) uploads.push(photo);
      sideData.photo = photo ? photo.url : "";

      const family = await storeImages(sideData.familyImages || [], { folder: CRD_IMAGE_FOLDER });
      uploads.push(...family);
      sideData.familyImages = family.map((item) => item.url);

      next[side] = sideData;
    }
    return next;
  } catch (error) {
    await discardUploads(uploads);
    throw error;
  }
}

/**
 * Pushes any newly picked reference file to R2 and swaps in the record that gets stored.
 *
 * `storeDocuments` returns a file that already carries a `url` untouched, so re-saving a document
 * that already has uploaded references never uploads them a second time. Documents, unlike images,
 * are stored without a rollback on a part-way failure — the same choice the assets module already
 * made for its own document uploads.
 */
async function storeQuaQuaReferenceFiles(document) {
  const uploads = [];
  try {
    const next = { ...document };
    const photoReferenceRows = parseReferenceRows(next.photoReferenceLinks);
    if (photoReferenceRows.length) {
      const referenceImages = await storeImages(photoReferenceRows.map((row) => row.image || ""), { folder: CRD_QQ_REFERENCE_FOLDER });
      uploads.push(...referenceImages);
      let imageIndex = 0;
      const storedPhotoReferenceRows = photoReferenceRows.map((row) => {
        if (!row.image) return row;
        const image = referenceImages[imageIndex];
        imageIndex += 1;
        return { ...row, image: image ? image.url : "" };
      });
      next.photoReferenceLinks = stringifyReferenceRows(storedPhotoReferenceRows);
    }
    const stored = await storeDocuments(next.referenceFiles || [], { folder: CRD_QQ_REFERENCE_FOLDER });
    next.referenceFiles = stored.map((file) => ({ name: file.name, ...(file.url ? { url: file.url } : { data: file.data }) }));
    return next;
  } catch (error) {
    await discardUploads(uploads);
    throw error;
  }
}

function parseDocument(input, vertical) {
  const parsed = documentSchemaFor(vertical).safeParse(input || {});
  if (!parsed.success) throw httpError(400, "Some of these details could not be accepted. Check them and try again.");
  // A no-op for a vertical whose document has no `common` block — Qua Qua's page one has no
  // reference links to check yet.
  if (invalidReferenceFields(parsed.data).length) throw httpError(400, "Only working http or https reference links are accepted.");
  return parsed.data;
}

/**
 * What the public page renders: the document as far as it has been filled, with what the project
 * or CRM lead already knows filled in the first time so the client confirms it rather than typing
 * it from scratch. Each vertical reads its own shape — `documentWithPrefill` reads Dum Dum's
 * `groom`/`bride`/`common`, `documentWithPrefillQuaQua` reads Qua Qua's flat one — and a document
 * whose vertical is unresolved falls back to Dum Dum's (see `verticalDocument.js`), so that prefill
 * still runs for it too.
 */
async function readByToken(token) {
  const row = await findByToken(token);
  const subject = await subjectForDocument(row);
  const vertical = row.vertical || subject.vertical || "";
  const stored = storedDocument(row, vertical);
  const prefilled = vertical === "QQ" ? await documentWithPrefillQuaQua(subject, stored) : await documentWithPrefill(subject, stored, row);
  // Lifted off the document and sent beside it, so it can never be saved back or reach the schema.
  const { studioAnswered = [], ...document } = prefilled;
  const termsSettings = await crdTermsSettingsService.read();

  return {
    status: row.status,
    submittedAt: row.submittedAt,
    // The logo this link was issued under - the row's own, never today's Settings. Null on a link
    // older than the snapshot, which the form shows with the bundled default mark.
    ...brandingForDocument(row),
    // Context only, never editable and never taken back from the client. A standalone document has
    // no Event ID to show yet, and the page already renders without one.
    eventId: subject.eventId || "",
    projectStatus: subject.projectStatus || "",
    vertical,
    completion: completionPercentFor(vertical, document),
    /*
     * Which fields on the common block the booking answers, rather than the client.
     *
     * The client's form draws the two event dates from this: read back where the studio knows when
     * the event is, asked for where it does not. Answered from the booking rather than from the
     * document, because the document cannot answer it - the prefilled start date is written back on
     * the first save and is indistinguishable from a date the client typed thereafter. See
     * `documentWithPrefill`.
     */
    prefilledCommonFields: studioAnswered,
    // Configured from the CRD Documents screen rather than hardcoded — see crd-terms-settings.
    termsText: vertical === "QQ" ? termsSettings.quaQuaTerms : termsSettings.dumDumTerms,
    document,
  };
}

function refuseIfSubmitted(row) {
  if (row.submittedAt) throw httpError(409, "This CRD document has already been submitted.");
}

/** Saves progress without closing the document, so the other side can carry on through the link. */
async function saveDraftByToken(token, input) {
  const row = await findByToken(token);
  const subject = await subjectForDocument(row);
  const vertical = row.vertical || subject.vertical || "";
  refuseIfSubmitted(row);

  const parsed = parseDocument(input, vertical);
  const document = vertical === "QQ" ? await storeQuaQuaReferenceFiles(parsed) : await storeDocumentImages(parsed);
  const saved = await prisma.salesProjectCrdDocument.update({
    where: { id: row.id },
    data: { submission: document, status: "In Progress" },
  });

  return { status: saved.status, submittedAt: saved.submittedAt, completion: completionPercentFor(vertical, document), document };
}

async function submitByToken(token, input) {
  const row = await findByToken(token);
  const subject = await subjectForDocument(row);
  const vertical = row.vertical || subject.vertical || "";
  refuseIfSubmitted(row);

  const document = parseDocument(input, vertical);
  const missing = missingRequiredFor(vertical, document);
  // The browser disables Submit until the document is complete; this is the copy that decides,
  // and it names what is outstanding so the page can point at it rather than just refusing.
  if (missing.length) {
    const error = httpError(400, `${missing.length} required ${missing.length === 1 ? "answer is" : "answers are"} still missing.`);
    error.missing = missing;
    throw error;
  }

  const stored = vertical === "QQ" ? await storeQuaQuaReferenceFiles(document) : await storeDocumentImages(document);
  const saved = await prisma.salesProjectCrdDocument.update({
    where: { id: row.id },
    data: { submission: stored, submittedAt: new Date(), status: "Submitted" },
  });

  return { status: saved.status, submittedAt: saved.submittedAt, completion: 100, document: stored };
}

module.exports = {
  ensureLink,
  findLiveProject,
  ensureProjectCrdDocument,
  ensureResponseLink,
  createDocument,
  listDocuments,
  listAvailableEnquiryIds,
  readByToken,
  readResponse,
  readResponseByShareToken,
  saveDraftByToken,
  submitByToken,
  TOKEN_PATTERN,
};
