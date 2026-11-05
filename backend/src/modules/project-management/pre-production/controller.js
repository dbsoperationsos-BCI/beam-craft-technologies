const { userDisplayName } = require("../../../services/userNames");
const { syncShootLinkedDueDates } = require("../../../services/shootLinkedDueDates");
const { SHOOT_DATE_ASC } = require("../../../services/shootOrder");
const { withProjectHandovers } = require("../../../services/handoverNames");
const { z } = require("zod");
const { Prisma } = require("@prisma/client");
const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const dataScope = require("../../../services/dataScope.service");
const { listPhotoUrl } = require("../../../services/employeeOptionLists");
const { projectClientNames, clientNameOf } = require("../../../services/projectClientNames");
const { crdSummariesByProject, NO_CRD_DOCUMENT } = require("../../sales/crd-documents/summary");
const { saveStartProjectWork, preProductionGeneralSchema } = require("../../sales/projects/controller");
const { projectGroupChoices, linkProjectGroup, autoLinkProjectGroup } = require("./whatsappGroup");
const { isIndoorShoot } = require("../production/steps");
const { respond } = require("../production/http");
const { projectHoldSources, projectPaymentsDue } = require("../../../services/projectHolds");
const { boardsForProjects } = require("../../../services/projectBoards");
const { logProjectActivity } = require("../../../services/projectActivity");
const { buildProjectFlow } = require("../../../services/projectFlow");
const { storeImage, isHttpUrl } = require("../../../services/imageStorage");
const { deleteObject } = require("../../../services/objectStorage");
const clientPush = require("../../../services/clientPush");
const clientPreProduction = require("../../client/portal/preProduction");
const { renderFormPdf } = require("./formPdf");
const { shootVenues, shootVenuesIssue, shootVenueColumns } = require("../../../services/shootLocations");
// How a shoot status set by hand reads in its project's Activity.
const SHOOT_STATUS_WORDS = { WCR: "WCR", HOLD: "Hold", REJECTED: "Rejected" };

const activeEmployeeStatuses = ["Active", "in Training", "PIP"];
// A checklist question being chased: null = not taken up, then Pending, then Completed.
const progressStatuses = ["Pending", "Completed"];

const optionalText = z.string().trim().max(5000).nullable().optional();
const optionalLink = z.string().trim().max(2048).nullable().optional();
// "HH:MM", matching how `ProjectShoot.eventStartTime` has always been typed.
const optionalTime = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time as HH:MM").nullable().optional();
const optionalDate = z.coerce.date().nullable().optional();
// Strict rather than coerced. Zod's boolean coercion reads the *string* "false" as true, which is
// the classic way a toggle ends up permanently on; a cleared value means the field was not touched,
// and anything that is not a real boolean is refused rather than guessed at.
const optionalBoolean = z.preprocess((value) => (value === null ? undefined : value), z.boolean().optional());
const optionalProgress = z.enum(["Pending", "Completed"]).nullable().optional();

/** Where a shoot's hard disk has got to, as the pre production coordinator tracks it. */
const HARD_DISK_STATUSES = ["NOT_RECEIVED", "RECEIVED", "HANDED_OVER"];
const HANDED_OVER = "HANDED_OVER";
/** The first step of the Client Storage flow, and the only one this board sets. */
const STORAGE_NOT_ARRIVED = "Yet to Receive";
const STORAGE_STARTED = "Yet to Start";

const preProductionUpdateSchema = z.object({
  // The shoot's own clock times. They live on `ProjectShoot` rather than here because Production
  // wants them too; pre production is simply the stage that finally knows them.
  eventStartTime: optionalTime,
  eventEndTime: optionalTime,
  // The shoot's own date (`ProjectShoot.dateCreated`) - the one Edit Project shows, so a change here
  // is seen there, and a date here reads there as Shoot Date Known: Yes. Null clears it.
  shootDate: optionalDate,

  locationAddress: optionalText,
  locationLink: optionalLink,
  // A shoot held at several places is asked a venue per name in place of the two above - the whole
  // list at once, in the name's order (`services/shootLocations.js`).
  locations: z.array(z.object({ shoot: z.string().trim().min(1).max(191), locationAddress: optionalText, locationLink: optionalLink })).max(50).optional(),
  reportingTime: optionalTime,
  scheduleRemarks: optionalText,

  // The shoot's concepts, the whole list at once: what is sent replaces what was there. Left out,
  // the list is not touched. `conceptsNeeded` is the Yes / No asked before it - No empties the list.
  conceptsNeeded: optionalBoolean,
  // An indoor shoot's branch - the studio it happens at, in place of a location. Null clears it.
  shootBranchId: z.coerce.number().int().positive().nullable().optional(),
  concepts: z.array(z.object({ reference: optionalLink, remarks: optionalText })).max(50).optional(),

  // How the crew travels is the Production Manager's now, asked on the production plan
  // (production/travel.js); a travel key sent here is dropped like any other unknown key.
  travelAccommodationNeeded: optionalBoolean,
  accommodationAddress: optionalText,
  accommodationLink: optionalLink,
  accommodationRemarks: optionalText,

  // Vertical checklists. Validated for every row whatever its vertical — the vertical decides
  // which questions the form asks, not which answers the server would keep, so a project recoded
  // from one vertical to another loses nothing.
  introCallRemarks: optionalText,
  gettingDressesImages: optionalBoolean,
  shootCompletionMessage: optionalBoolean,
  groomAddress: optionalText,
  brideAddress: optionalText,
  introCallGroom: optionalProgress,
  introCallBride: optionalProgress,
  eventScheduleMeeting: optionalBoolean,
  meetingDate: optionalDate,
  meetingTime: optionalTime,
  meetingLink: optionalLink,
  invitationSoftCopy: optionalBoolean,
  invitationLink: optionalLink,
  gettingDecorImages: optionalBoolean,
  siteVisit: optionalBoolean,
  teamReachedMessage: optionalBoolean,
  postWeddingGift: optionalBoolean,
  introCall: optionalProgress,
  googleReview: optionalBoolean,

  // The shoot's cover picture, optional: a newly picked image as a data URI, the link it already
  // has (left as it is), or null to take it down. Stored as `coverImageUrl` (`storeCover`).
  coverImage: z.string().max(12 * 1024 * 1024).nullable().optional(),
});

// The cover goes to R2 compressed to this, the same ceiling the AI Feature's event cover uses.
const COVER_FOLDER = "projects/pre-production/covers";
const COVER_COMPRESSION = { folder: COVER_FOLDER, maxBytes: 600 * 1024, maxDimension: 2000 };

/**
 * The cover a save writes, uploaded before the transaction so a slow upload holds no row lock.
 * `undefined` leaves the column alone; a link is only ever the one the shoot already has, which is
 * checked against the row inside the transaction - a link from anywhere else is not stored.
 */
async function uploadCover(coverImage) {
  if (coverImage === undefined || coverImage === null || isHttpUrl(coverImage)) return null;
  return storeImage(coverImage, COVER_COMPRESSION);
}
// No refusal of an end before the start: that is a shoot running past midnight - 9:00 PM to 2:00 AM
// ends on the next day - which Production's crew check already reads that way (availability.js).

/**
 * Adding a follow-up: the date the client is to be chased next, and why. The project's, not a
 * shoot's. There is no "last" date to give — that is when a follow-up is marked done.
 */
const followupCreateSchema = z.object({
  // Required. A cleared field arrives as null, which date coercion would read as 1970.
  followupDate: z.preprocess((value) => (value === null ? undefined : value), z.coerce.date({ error: "Choose the Next Followup Date." })),
  remarks: optionalText,
}).superRefine((data, context) => {
  // Compared as days in UTC, which is never ahead of the studio's day, so today is always allowed.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (data.followupDate < today) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["followupDate"], message: "Next Followup Date cannot be in the past." });
  }
});

const followupEntrySelect = {
  id: true,
  followupDate: true,
  remarks: true,
  doneAt: true,
  createdAt: true,
  createdByUser: { select: { id: true, name: true } },
  doneByUser: { select: { id: true, name: true } },
};

/**
 * What a project's follow-up list says, in the shape every shoot row of it carries.
 *
 * The next date is the earliest one still pending and the last is the latest one done, so the
 * board's two columns and its overdue colouring read exactly what they read before the list
 * existed. The remarks are the next follow-up's, or the last one's when nothing is pending. The
 * completed ones come back too, most recent first, so the panel can show what has been done.
 */
function followupSummary(entries = []) {
  const pending = entries.filter((entry) => !entry.doneAt)
    .sort((a, b) => new Date(a.followupDate) - new Date(b.followupDate) || new Date(a.createdAt) - new Date(b.createdAt));
  const done = entries.filter((entry) => entry.doneAt).sort((a, b) => new Date(b.doneAt) - new Date(a.doneAt));
  return {
    lastFollowupDate: done[0]?.doneAt || null,
    nextFollowupDate: pending[0]?.followupDate || null,
    followupRemarks: (pending[0] || done[0])?.remarks || null,
    pendingFollowups: pending.map((entry) => ({
      id: entry.id,
      followupDate: entry.followupDate,
      remarks: entry.remarks || null,
      createdAt: entry.createdAt,
      createdBy: entry.createdByUser?.name || null,
    })),
    doneFollowups: done.map((entry) => ({
      id: entry.id,
      followupDate: entry.followupDate,
      remarks: entry.remarks || null,
      doneAt: entry.doneAt,
      doneBy: entry.doneByUser?.name || null,
    })),
  };
}

/** Empty strings arrive from the form for every field the coordinator has not filled in yet. */
function cleanData(data) {
  return Object.fromEntries(Object.entries(data || {}).map(([key, value]) => [key, value === "" ? null : value]));
}

// A shoot's concepts, in the order they were entered.
const conceptInclude = { select: { id: true, reference: true, remarks: true }, orderBy: { position: "asc" } };

/** One line per concept, for the read-back panel and the export: "1. reference — remarks". */
function conceptList(concepts = []) {
  if (!concepts.length) return null;
  return concepts.map((concept, index) => `${index + 1}. ${[concept.reference, concept.remarks].filter(Boolean).join(" — ")}`).join("\n");
}

const shootSelect = {
  id: true,
  shootId: true,
  shoot: true,
  shootType: true,
  shootTypes: true,
  dateCreated: true,
  shootPlace: true,
  district: true,
  state: true,
  shootLocations: true,
  isMainEvent: true,
  eventStartTime: true,
  eventEndTime: true,
  sessionTiming: true,
  travel: true,
  accommodation: true,
  foodTakenCareBy: true,
};

const projectSelect = {
  id: true,
  // The project's overall Pre Production status set by hand, when it is.
  preProductionStatus: true,
  preProductionStatusRemarks: true,
  preProductionStatusAt: true,
  preProductionStatusByUser: { select: { name: true } },
  eventId: true,
  whatsappGroupNameId: true,
  whatsappGroupName: true,
  clientMainNumber: true,
  sourceBranch: true,
  branchId: true,
  vertical: true,
  crdDocumentStatus: true,
  welcomeGift: true,
  // Who is sending each gift and how far it has got, for the General bar above the shoot cards.
  // The name is read through the employee link; the text beside it only where nothing is linked.
  welcomeGiftAssignee: true,
  welcomeGiftEmployeeId: true,
  welcomeGiftEmployee: { select: { employeeName: true } },
  welcomeGiftStatus: true,
  welcomeGiftSentAt: true,
  welcomeGiftReceivedAt: true,
  shootCompletedGift: true,
  shootCompletedGiftAssignee: true,
  shootCompletedGiftEmployeeId: true,
  shootCompletedGiftEmployee: { select: { employeeName: true } },
  shootCompletedGiftStatus: true,
  shootCompletedGiftSentAt: true,
  shootCompletedGiftReceivedAt: true,
  storageNeeded: true,
  hardDiskStatus: true,
  // Why a gift, the hard disk or the CRD document was switched on or off, newest first.
  applicabilityChanges: {
    select: { id: true, item: true, fromValue: true, toValue: true, remarks: true, createdAt: true, changedByUser: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  },
  salesPreProductionRemarks: true,
  crmName: true,
  preProductionCoordinator: true,
  preProductionCoordinatorEmployeeId: true,
  creativeManager: true,
  postProductionCoordinator: true,
  /*
   * The Production Manager, which the General panel assigns. The linked employee comes with it so the
   * name shown is theirs as it stands now rather than the copy taken when they were assigned - the
   * text is only the fallback for a seat filled before it was a link.
   */
  productionManager: true,
  productionManagerEmployeeId: true,
  productionManagerEmployee: { select: { employeeName: true } },
  mainEventDate: true,
  mainEventDateKnown: true,
  projectStatus: true,
  // The project's WhatsApp group, which production messages are sent into.
  whatsappGroupJid: true,
  whatsappGroupSubject: true,
  whatsappGroupInviteLink: true,
  whatsappGroupLinkedAt: true,
  whatsappGroupLinkedByUser: { select: { name: true } },
  // The project's follow-ups, beside its shoot cards rather than on any single shoot.
  preProductionFollowupEntries: { select: followupEntrySelect },
};

/**
 * One board row: the shoot, the project it belongs to, and pre production's own answers.
 *
 * Flattened rather than nested, because the table sorts, filters and exports on these columns and
 * every one of them has to be a single value it can reach by name.
 */
function toRow(record, clientNames, storage = new Map(), crd = new Map()) {
  const { shoot, project } = record;
  return {
    // Identity — the shoot is the row, so the shoot's id is the row's id.
    id: record.id,
    shootRecordId: shoot.id,
    projectId: project.id,
    // When this shoot came to pre production - the date its Board trend counts.
    createdAt: record.createdAt,

    // Inherited from the project. Read-only on this board.
    eventId: project.eventId,
    clientName: clientNameOf(project, clientNames),
    clientMainNumber: project.clientMainNumber,
    sourceBranch: project.sourceBranch,
    product: project.vertical,
    vertical: project.vertical,
    // The sale's own note, kept because it is the only one that can say "Not Applicable" — no
    // document is ever raised for a project that needs none.
    crdDocumentStatus: project.crdDocumentStatus,
    // …and what the CRD Documents page actually knows, read from the document itself.
    ...(crd.get(project.id) || NO_CRD_DOCUMENT),
    welcomeGift: project.welcomeGift,
    welcomeGiftEmployeeId: project.welcomeGiftEmployeeId,
    welcomeGiftAssignee: project.welcomeGiftEmployee?.employeeName || project.welcomeGiftAssignee || null,
    welcomeGiftStatus: project.welcomeGiftStatus,
    welcomeGiftSentAt: project.welcomeGiftSentAt,
    welcomeGiftReceivedAt: project.welcomeGiftReceivedAt,
    shootCompletedGift: project.shootCompletedGift,
    shootCompletedGiftEmployeeId: project.shootCompletedGiftEmployeeId,
    shootCompletedGiftAssignee: project.shootCompletedGiftEmployee?.employeeName || project.shootCompletedGiftAssignee || null,
    shootCompletedGiftStatus: project.shootCompletedGiftStatus,
    shootCompletedGiftSentAt: project.shootCompletedGiftSentAt,
    shootCompletedGiftReceivedAt: project.shootCompletedGiftReceivedAt,
    storageNeeded: project.storageNeeded,
    // A project saved before the column existed reads as the disk not having come back yet.
    hardDiskStatus: project.hardDiskStatus || "NOT_RECEIVED",
    applicabilityChanges: (project.applicabilityChanges || []).map((change) => ({
      id: change.id,
      item: change.item,
      fromValue: change.fromValue,
      toValue: change.toValue,
      remarks: change.remarks,
      changedAt: change.createdAt,
      changedBy: change.changedByUser?.name || null,
    })),
    salesPreProductionRemarks: project.salesPreProductionRemarks,
    crmName: project.crmName,
    preProductionCoordinator: project.preProductionCoordinator,
    preProductionCoordinatorEmployeeId: project.preProductionCoordinatorEmployeeId,
    creativeManager: project.creativeManager,
    postProductionCoordinator: project.postProductionCoordinator,
    productionManager: project.productionManagerEmployee?.employeeName || project.productionManager || null,
    productionManagerEmployeeId: project.productionManagerEmployeeId,
    mainEventDate: project.mainEventDateKnown ? project.mainEventDate : null,
    projectStatus: project.projectStatus,
    preProductionStatus: project.preProductionStatus || null,
    preProductionStatusRemarks: project.preProductionStatusRemarks || null,
    preProductionStatusAt: project.preProductionStatus ? project.preProductionStatusAt : null,
    preProductionStatusBy: project.preProductionStatus ? project.preProductionStatusByUser?.name || null : null,
    whatsappGroupJid: project.whatsappGroupJid,
    whatsappGroupSubject: project.whatsappGroupSubject,
    whatsappGroupInviteLink: project.whatsappGroupInviteLink || null,
    whatsappGroupLinkedAt: project.whatsappGroupLinkedAt,
    whatsappGroupLinkedBy: project.whatsappGroupLinkedByUser?.name || null,

    // Inherited from the shoot. Read-only, apart from the two clock times below.
    shootId: shoot.shootId,
    shoot: shoot.shoot,
    shootType: shoot.shootType,
    // A Studio / In-House shoot, by the rule Production uses: it asks no travel or location.
    indoor: isIndoorShoot(shoot),
    shootPlace: shoot.shootPlace,
    district: shoot.district,
    state: shoot.state,
    isMainEvent: shoot.isMainEvent,
    subEventDate: shoot.dateCreated,
    sessionTiming: shoot.sessionTiming,
    travelPaidBy: shoot.travel,
    accommodationPaidBy: shoot.accommodation,
    foodTakenCareBy: shoot.foodTakenCareBy,

    // Pre production's own. Everything below is what the coordinator fills in.
    eventStartTime: shoot.eventStartTime,
    eventEndTime: shoot.eventEndTime,
    locationAddress: record.locationAddress,
    locationLink: record.locationLink,
    // One venue per name for a shoot held at several places, else null.
    locations: shootVenues(shoot, record),
    shootBranchId: record.shootBranchId ?? null,
    shootBranchName: record.shootBranch?.name || null,
    // The project's own branch, which an indoor shoot's branch starts on until one is chosen.
    projectBranchId: project.branchId ?? null,
    reportingTime: record.reportingTime,
    scheduleRemarks: record.scheduleRemarks,
    coverImageUrl: record.coverImageUrl || null,
    conceptsNeeded: record.conceptsNeeded,
    concepts: (record.concepts || []).map(({ id, reference, remarks }) => ({ id, reference, remarks })),
    conceptList: conceptList(record.concepts),
    travelAccommodationNeeded: record.travelAccommodationNeeded,
    accommodationAddress: record.accommodationAddress,
    accommodationLink: record.accommodationLink,
    accommodationRemarks: record.accommodationRemarks,
    // The project's, not the shoot's — every shoot of a project reports the same follow-ups.
    ...followupSummary(project.preProductionFollowupEntries),

    // Vertical checklists — the vertical decides which of these the screens show.
    introCallRemarks: record.introCallRemarks,
    gettingDressesImages: record.gettingDressesImages,
    shootCompletionMessage: record.shootCompletionMessage,
    groomAddress: record.groomAddress,
    brideAddress: record.brideAddress,
    introCallGroom: record.introCallGroom,
    introCallBride: record.introCallBride,
    eventScheduleMeeting: record.eventScheduleMeeting,
    meetingDate: record.meetingDate,
    meetingTime: record.meetingTime,
    meetingLink: record.meetingLink,
    invitationSoftCopy: record.invitationSoftCopy,
    invitationLink: record.invitationLink,
    gettingDecorImages: record.gettingDecorImages,
    siteVisit: record.siteVisit,
    teamReachedMessage: record.teamReachedMessage,
    postWeddingGift: record.postWeddingGift,
    introCall: record.introCall,
    googleReview: record.googleReview,

    // Read from Client Storage, never stored here.
    ...(storage.get(`shoot:${shoot.id}`) || storage.get(`project:${project.id}`) || { storageRecordId: null, storageId: null, storageStatus: null, receivedTheStorage: false, storageAssignee: null }),

    updatedByUserId: record.updatedByUserId,
    // The user who last saved it, by their linked employee's name (`services/userNames`).
    updatedBy: userDisplayName(record.updatedByUser),
    // The status set by hand - WCR, HOLD or REJECTED - with its remarks; null is automatic (the
    // details decide: Yet to Start, Work in Progress, Planned).
    shootStatus: record.shootStatus || null,
    shootStatusRemarks: record.shootStatusRemarks || null,
    shootStatusAt: record.shootStatusAt || null,
    shootStatusBy: record.shootStatusByUser?.name || null,
    updatedAt: record.updatedAt,
  };
}

/**
 * The project's Client Storage records, keyed to answer per shoot.
 *
 * "Received The Storage" and "Storage ID" on the sheet are the Client Storage module's facts — the
 * record is raised automatically per project and walks a status ladder that starts at
 * "Yet to Receive" — so they are read from it rather than typed twice. A record naming a shoot
 * answers for that shoot; the project-level record answers for any shoot without one of its own.
 */
async function storageAnswers(projectIds) {
  const ids = [...new Set(projectIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const records = await prisma.clientStorage.findMany({
    where: { projectId: { in: ids }, isDeleted: false },
    select: { id: true, projectId: true, shootId: true, storageId: true, status: true, assignedToName: true, assignedTo: { select: { employeeName: true } } },
    orderBy: { id: "asc" },
  });
  const map = new Map();
  for (const record of records) {
    const entry = {
      // The record's own id, so General can open it and move it along the Client Storage flow.
      storageRecordId: record.id,
      storageId: record.storageId,
      storageStatus: record.status,
      receivedTheStorage: record.status !== "Yet to Receive",
      storageAssignee: record.assignedTo?.employeeName || record.assignedToName || null,
    };
    if (record.shootId && !map.has(`shoot:${record.shootId}`)) map.set(`shoot:${record.shootId}`, entry);
    if (!map.has(`project:${record.projectId}`)) map.set(`project:${record.projectId}`, entry);
  }
  return map;
}

/**
 * The board.
 *
 * Super Admins can monitor the whole board, and so can whoever holds `PROJECT / Show All Projects`
 * at Read / Write - the studio-wide grant that already lets them edit every project, so it lets them
 * work every project's pre production too. Every other account is restricted to projects where
 * its linked employee is the named Pre Production Coordinator; the browser cannot widen this
 * filter by sending a query-string scope.
 */
async function listRows(req, res) {
  try {
    const account = await prisma.user.findUnique({
      where: { id: Number(req.user.id) },
      select: { role: true, linkedEmployeeId: true },
    });

    const seesEveryProject = account?.role === "SUPER_ADMIN"
      || await iamService.hasPermission(Number(req.user.id), "PROJECT", "Show All Projects", "READ_WRITE");
    if (!seesEveryProject && !account?.linkedEmployeeId) {
      return res.json({ data: [], meta: { scope: "mine", scopeUnavailable: true } });
    }

    const records = await prisma.projectPreProduction.findMany({
      where: {
        shoot: { deletedAt: null },
        project: {
          deletedAt: null,
          // Assignment lives on the project, so it is matched by employee id and never by the
          // denormalised name beside it: the name is written from the id and a legacy row can carry
          // a name with no id, which belongs to nobody in particular.
          ...(!seesEveryProject ? { preProductionCoordinatorEmployeeId: account.linkedEmployeeId } : {}),
        },
      },
      include: {
        shoot: { select: shootSelect },
        project: { select: projectSelect },
        updatedByUser: { select: { id: true, name: true, linkedEmployee: { select: { employeeName: true } } } },
        shootStatusByUser: { select: { name: true } },
          shootBranch: { select: { id: true, name: true } },
        concepts: conceptInclude,
      },
      orderBy: [{ shoot: { dateCreated: SHOOT_DATE_ASC } }, { createdAt: "asc" }],
    });

    const clientNames = await projectClientNames(records.map((record) => record.project));
    const projectIds = records.map((record) => record.project.id);
    // `boards` is which of the four boards each project is on, for the row menu's "Jump to" entries:
    // the jump is offered only where the project is really there (`services/projectBoards.js`).
    const [storage, crd, holds, paymentsDue, boards] = await Promise.all([storageAnswers(projectIds), crdSummariesByProject(projectIds), projectHoldSources(projectIds), projectPaymentsDue(projectIds), boardsForProjects(projectIds)]);
    // Each row carries where its project is held ("Pre-Production", "Production"), for the On Hold badge.
    // A role handed over at offboarding reads "New (Old)" while the new holder still has it.
    const rows = await withProjectHandovers(records.map((record) => ({ ...toRow(record, clientNames, storage, crd), holds: holds[record.project.id] || [], paymentsDue: paymentsDue[record.project.id] || null, boards: boards.get(record.project.id) || [] })), (row) => row.projectId);
    return res.json({ data: rows, meta: { scope: seesEveryProject ? "all" : "mine" } });
  } catch (error) {
    console.error("Unable to load pre production rows:", error);
    return res.status(500).json({ message: "Unable to load pre production rows." });
  }
}

/** The vocabulary the form needs: its status list, the employees who may run a shoot, and the branches. */
async function listOptions(req, res) {
  try {
    const employees = await prisma.employee.findMany({
      where: { archivedAt: null, employmentStatus: { in: activeEmployeeStatuses } },
      select: { id: true, employeeId: true, employeeName: true, department: true, designation: true, profilePhotoUrl: true },
      orderBy: { employeeName: "asc" },
    });
    // The branches an indoor shoot can be held at.
    const branches = await prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    return res.json({ data: { progressStatuses, employees: employees.map((row) => ({ ...row, profilePhotoUrl: listPhotoUrl(row.profilePhotoUrl) })), branches } });
  } catch (error) {
    console.error("Unable to load pre production options:", error);
    return res.status(500).json({ message: "Unable to load pre production options." });
  }
}

/**
 * Save one row.
 *
 * Two tables in one transaction: the shoot's clock times go back to `project_shoot`, everything
 * else to the pre production row. `upsert` rather than `update`, so a row for a shoot added before
 * this feature existed is written on first save instead of 404-ing at a coordinator.
 */
async function updateRow(req, res) {
  const parsed = preProductionUpdateSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });

  const { eventStartTime, eventEndTime, shootDate, concepts, conceptsNeeded, coverImage, locations, ...fields } = parsed.data;
  const hasShootTimes = "eventStartTime" in parsed.data || "eventEndTime" in parsed.data || "shootDate" in parsed.data;

  let uploaded = null;
  // The cover this save replaced or took down, deleted from R2 once the save has gone through.
  let replacedCover = null;
  let committed = false;
  try {
    // A picture is compressed and uploaded only for a shoot this save can write: the same two refusals
    // the transaction below makes, asked first so a refused save costs no image work and leaves no object.
    if (coverImage && !isHttpUrl(coverImage)) {
      const target = await prisma.projectShoot.findFirst({ where: { id: req.params.shootId, deletedAt: null }, select: { project: { select: { deletedAt: true, projectStatus: true } } } });
      if (!target || target.project.deletedAt) return res.status(404).json({ message: "Shoot not found." });
      if (target.project.projectStatus === "Yet to Start") return res.status(409).json({ message: "This project has not been started yet." });
    }
    uploaded = await uploadCover(coverImage);
    const row = await prisma.$transaction(async (transaction) => {
      const shoot = await transaction.projectShoot.findFirst({
        where: { id: req.params.shootId, deletedAt: null },
        select: { id: true, projectId: true, shootLocations: true, project: { select: { deletedAt: true, projectStatus: true } } },
      });
      if (!shoot || shoot.project.deletedAt) {
        const error = new Error("Shoot not found.");
        error.status = 404;
        throw error;
      }
      if (shoot.project.projectStatus === "Yet to Start") {
        const error = new Error("This project has not been started yet.");
        error.status = 409;
        throw error;
      }

      const data = { ...fields };
      // A venue per name replaces the one address; one address sent on its own is one place again.
      if (locations) {
        const issue = shootVenuesIssue(shoot, locations);
        if (issue) throw Object.assign(new Error(issue), { status: 400 });
        Object.assign(data, shootVenueColumns(locations));
      } else if ("locationAddress" in fields || "locationLink" in fields) {
        data.locations = Prisma.DbNull;
      }
      // The branch named must be one of the studio's working branches, not any id that was sent.
      if (data.shootBranchId) {
        const branch = await transaction.branch.findFirst({ where: { id: data.shootBranchId, isActive: true }, select: { id: true } });
        if (!branch) throw Object.assign(new Error("Choose one of the studio's branches."), { status: 400 });
      }

      // A row with nothing in it is dropped. Concepts Needed: No empties the list, whatever was sent
      // with it; Yes may stand before any concept is added. Not answered (an older caller), it follows
      // from the list.
      let nextConcepts = concepts?.map((concept) => ({ reference: concept.reference || null, remarks: concept.remarks || null }))
        .filter((concept) => concept.reference || concept.remarks);
      if (conceptsNeeded === false) nextConcepts = [];
      if (conceptsNeeded !== undefined) data.conceptsNeeded = conceptsNeeded;
      else if (nextConcepts) data.conceptsNeeded = nextConcepts.length > 0;

      data.updatedByUserId = Number(req.user.id) || null;

      if (coverImage !== undefined) {
        const current = (await transaction.projectPreProduction.findUnique({ where: { shootId: shoot.id }, select: { coverImageUrl: true } }))?.coverImageUrl || null;
        if (isHttpUrl(coverImage) && coverImage.trim() !== current) {
          throw Object.assign(new Error("Pick the cover image from your device."), { status: 400 });
        }
        const next = uploaded ? uploaded.url : coverImage === null ? null : current;
        if (current && current !== next) replacedCover = current;
        data.coverImageUrl = next;
      }

      if (hasShootTimes) {
        await transaction.projectShoot.update({
          where: { id: shoot.id },
          data: {
            ...("eventStartTime" in parsed.data ? { eventStartTime } : {}),
            ...("eventEndTime" in parsed.data ? { eventEndTime } : {}),
            ...("shootDate" in parsed.data ? { dateCreated: shootDate } : {}),
          },
        });
        // A payment due on this shoot moves with it.
        if ("shootDate" in parsed.data) await syncShootLinkedDueDates(transaction, shoot.projectId);
      }

      const record = await transaction.projectPreProduction.upsert({
        where: { shootId: shoot.id },
        create: { ...data, shootId: shoot.id, projectId: shoot.projectId },
        update: data,
        include: {
          shoot: { select: shootSelect },
          project: { select: projectSelect },
          updatedByUser: { select: { id: true, name: true, linkedEmployee: { select: { employeeName: true } } } },
          shootStatusByUser: { select: { name: true } },
          shootBranch: { select: { id: true, name: true } },
          concepts: conceptInclude,
        },
      });

      if (nextConcepts) {
        await transaction.projectPreProductionConcept.deleteMany({ where: { preProductionId: record.id } });
        if (nextConcepts.length) {
          await transaction.projectPreProductionConcept.createMany({
            data: nextConcepts.map((concept, position) => ({ ...concept, position, preProductionId: record.id })),
          });
        }
        record.concepts = await transaction.projectPreProductionConcept.findMany({ where: { preProductionId: record.id }, ...conceptInclude });
      }
      return record;
    });
    committed = true;

    const clientNames = await projectClientNames([row.project]);
    const [storage, crd, holds, paymentsDue] = await Promise.all([storageAnswers([row.project.id]), crdSummariesByProject([row.project.id]), projectHoldSources([row.project.id]), projectPaymentsDue([row.project.id])]);
    if (replacedCover) await deleteObject(replacedCover);
    await logProjectActivity({ projectId: row.project.id, shootId: req.params.shootId, area: "PRE_PRODUCTION", action: "SHOOT_SAVED", detail: "Shoot details saved", userId: req.user.id });
    const [saved] = await withProjectHandovers([{ ...toRow(row, clientNames, storage, crd), holds: holds[row.project.id] || [], paymentsDue: paymentsDue[row.project.id] || null }], (entry) => entry.projectId);
    return res.json({ data: saved });
  } catch (error) {
    // A cover uploaded for a save that did not go through is not left in the bucket.
    if (uploaded?.url && !committed) await deleteObject(uploaded.url);
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to save pre production row:", error);
    return res.status(500).json({ message: "Unable to save pre production row." });
  }
}

/*
 * ── A shoot's pre production status, set by hand ──────────────────────────────────────────────
 *
 * WCR (waiting for the client's reply), HOLD or REJECTED, or null to go back to automatic - where the
 * details decide (Yet to Start, Work in Progress, Planned). HOLD and REJECTED need their remarks; WCR
 * needs the next follow-up, which is added to the project's follow-ups in the same write, so a shoot
 * waiting on the client is always being chased. These are the shoot's alone: the project's overall
 * pre production status is worked out from the details, whatever its shoots are marked.
 */
const SHOOT_STATUSES = ["WCR", "HOLD", "REJECTED"];
const shootStatusSchema = z.object({
  status: z.enum(SHOOT_STATUSES).nullable(),
  remarks: z.string().trim().max(5000).optional().nullable(),
  followupDate: z.preprocess((value) => (value === null || value === "" ? undefined : value), z.coerce.date().optional()),
}).strict().superRefine((data, context) => {
  if (["HOLD", "REJECTED"].includes(data.status) && !data.remarks) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["remarks"], message: `Write the remarks for ${data.status === "HOLD" ? "Hold" : "Rejected"}.` });
  }
  if (data.status === "WCR") {
    if (!data.followupDate) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["followupDate"], message: "Choose the Next Followup Date for WCR." });
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (data.followupDate < today) context.addIssue({ code: z.ZodIssueCode.custom, path: ["followupDate"], message: "Next Followup Date cannot be in the past." });
    }
  }
});

/**
 * A project's Activity tab on Pre Production: its whole flow, enquiry to feedback, newest first
 * (`services/projectFlow.js`, each stage under its own permission) - for a project the viewer's board holds (theirs as its Pre Production Coordinator, or any for whoever sees
 * every project), the same reach as `listRows`.
 */
async function listProjectActivity(req, res) {
  try {
    const userId = Number(req.user.id);
    const [account, unlimited, allProjects, project] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { linkedEmployeeId: true } }),
      dataScope.bypassesHierarchy(userId),
      iamService.hasPermission(userId, "PROJECT", "Show All Projects", "READ_WRITE"),
      prisma.salesProject.findFirst({ where: { id: String(req.params.projectId || ""), deletedAt: null }, select: { id: true, preProductionCoordinatorEmployeeId: true } }),
    ]);
    const mine = project && account?.linkedEmployeeId && project.preProductionCoordinatorEmployeeId === account.linkedEmployeeId;
    if (!project || !(unlimited || allProjects || mine)) return res.status(404).json({ message: "Project not found." });
    return res.json({ data: await buildProjectFlow({ projectId: project.id, userId }) });
  } catch (error) {
    console.error("Unable to load the project's activity:", error);
    return res.status(500).json({ message: "Unable to load the project's activity." });
  }
}

async function setShootStatus(req, res) {
  const parsed = shootStatusSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Validation failed" });
  const { status, remarks, followupDate } = parsed.data;
  const userId = Number(req.user.id) || null;
  try {
    const row = await prisma.$transaction(async (transaction) => {
      const shoot = await transaction.projectShoot.findFirst({
        where: { id: req.params.shootId, deletedAt: null },
        select: { id: true, projectId: true, project: { select: { deletedAt: true, projectStatus: true } } },
      });
      if (!shoot || shoot.project.deletedAt) throw Object.assign(new Error("Shoot not found."), { status: 404 });
      if (shoot.project.projectStatus === "Yet to Start") throw Object.assign(new Error("This project has not been started yet."), { status: 409 });

      const data = status
        ? { shootStatus: status, shootStatusRemarks: remarks || null, shootStatusAt: new Date(), shootStatusByUserId: userId }
        : { shootStatus: null, shootStatusRemarks: null, shootStatusAt: new Date(), shootStatusByUserId: userId };
      if (status === "WCR") {
        await transaction.projectPreProductionFollowupEntry.create({
          data: { projectId: shoot.projectId, followupDate, remarks: remarks || null, createdByUserId: userId },
        });
      }
      return transaction.projectPreProduction.upsert({
        where: { shootId: shoot.id },
        create: { ...data, shootId: shoot.id, projectId: shoot.projectId },
        update: data,
        include: {
          shoot: { select: shootSelect },
          project: { select: projectSelect },
          updatedByUser: { select: { id: true, name: true, linkedEmployee: { select: { employeeName: true } } } },
          shootStatusByUser: { select: { name: true } },
          shootBranch: { select: { id: true, name: true } },
          concepts: conceptInclude,
        },
      });
    });
    const clientNames = await projectClientNames([row.project]);
    const [storage, crd, holds, followups, paymentsDue] = await Promise.all([
      storageAnswers([row.project.id]), crdSummariesByProject([row.project.id]), projectHoldSources([row.project.id]), projectFollowupSummary(row.project.id), projectPaymentsDue([row.project.id]),
    ]);
    await logProjectActivity({ projectId: row.project.id, shootId: req.params.shootId, area: "PRE_PRODUCTION", action: "STATUS_CHANGED", detail: [status ? `Status set to ${SHOOT_STATUS_WORDS[status] || status}` : "Status back to automatic", status === "WCR" && followupDate && `next follow-up ${new Date(followupDate).toISOString().slice(0, 10)}`, remarks].filter(Boolean).join(" · "), userId: req.user.id });
    const [saved] = await withProjectHandovers([{ ...toRow(row, clientNames, storage, crd), holds: holds[row.project.id] || [], paymentsDue: paymentsDue[row.project.id] || null }], (entry) => entry.projectId);
    return res.json({ data: saved, followups });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to set the shoot's pre production status:", error);
    return res.status(500).json({ message: "Unable to set the shoot's status." });
  }
}

/**
 * The started, live project a follow-up request names, or an error carrying its status.
 */
async function followupProject(projectId) {
  const project = await prisma.salesProject.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, projectStatus: true },
  });
  if (!project) return { status: 404, message: "Project not found." };
  if (project.projectStatus === "Yet to Start") return { status: 409, message: "This project has not been started yet." };
  return { project };
}

/** The project's follow-ups after a change, summarised the way its board rows carry them. */
async function projectFollowupSummary(projectId) {
  const entries = await prisma.projectPreProductionFollowupEntry.findMany({ where: { projectId }, select: followupEntrySelect });
  return { projectId, ...followupSummary(entries) };
}

/**
 * Add a follow-up to a project. It joins the project's pending list; the earliest pending date is
 * the project's next follow-up.
 */
async function addProjectFollowup(req, res) {
  const parsed = followupCreateSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });

  try {
    const { project, status, message } = await followupProject(req.params.projectId);
    if (!project) return res.status(status).json({ message });

    await prisma.projectPreProductionFollowupEntry.create({
      data: {
        projectId: project.id,
        followupDate: parsed.data.followupDate,
        remarks: parsed.data.remarks || null,
        createdByUserId: Number(req.user.id) || null,
      },
    });
    await logProjectActivity({ projectId: project.id, area: "PRE_PRODUCTION", action: "FOLLOWUP_ADDED", detail: [`Follow-up added for ${new Date(parsed.data.followupDate).toISOString().slice(0, 10)}`, parsed.data.remarks].filter(Boolean).join(" · "), userId: req.user.id });
    return res.status(201).json({ data: await projectFollowupSummary(project.id) });
  } catch (error) {
    console.error("Unable to add pre production follow-up:", error);
    return res.status(500).json({ message: "Unable to add the follow-up." });
  }
}

/**
 * Mark one of a project's pending follow-ups done. The follow-up is looked up under the project in
 * the URL, so an id belonging to another project is not found rather than closed.
 */
async function completeProjectFollowup(req, res) {
  try {
    const { project, status, message } = await followupProject(req.params.projectId);
    if (!project) return res.status(status).json({ message });

    const result = await prisma.projectPreProductionFollowupEntry.updateMany({
      where: { id: req.params.followupId, projectId: project.id, doneAt: null },
      data: { doneAt: new Date(), doneByUserId: Number(req.user.id) || null },
    });
    if (!result.count) return res.status(404).json({ message: "Pending follow-up not found." });
    await logProjectActivity({ projectId: project.id, area: "PRE_PRODUCTION", action: "FOLLOWUP_DONE", detail: "Follow-up marked done", userId: req.user.id });
    return res.json({ data: await projectFollowupSummary(project.id) });
  } catch (error) {
    console.error("Unable to complete pre production follow-up:", error);
    return res.status(500).json({ message: "Unable to mark the follow-up done." });
  }
}

/**
 * Change a pending follow-up's date or remarks. Looked up under the project in the URL, and only
 * while still pending: a follow-up already made is the record of what was done, not a plan to fix.
 */
async function updateProjectFollowup(req, res) {
  const parsed = followupCreateSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });

  try {
    const { project, status, message } = await followupProject(req.params.projectId);
    if (!project) return res.status(status).json({ message });

    const result = await prisma.projectPreProductionFollowupEntry.updateMany({
      where: { id: req.params.followupId, projectId: project.id, doneAt: null },
      data: { followupDate: parsed.data.followupDate, remarks: parsed.data.remarks || null },
    });
    if (!result.count) return res.status(404).json({ message: "Pending follow-up not found." });
    await logProjectActivity({ projectId: project.id, area: "PRE_PRODUCTION", action: "FOLLOWUP_EDITED", detail: [`Follow-up changed to ${new Date(parsed.data.followupDate).toISOString().slice(0, 10)}`, parsed.data.remarks].filter(Boolean).join(" · "), userId: req.user.id });
    return res.json({ data: await projectFollowupSummary(project.id) });
  } catch (error) {
    console.error("Unable to update pre production follow-up:", error);
    return res.status(500).json({ message: "Unable to save the follow-up." });
  }
}

/**
 * Remove a pending follow-up added by mistake. Only a pending one, and only under the project in the
 * URL; the project's Activity keeps what was removed.
 */
async function deleteProjectFollowup(req, res) {
  try {
    const { project, status, message } = await followupProject(req.params.projectId);
    if (!project) return res.status(status).json({ message });

    const entry = await prisma.projectPreProductionFollowupEntry.findFirst({
      where: { id: req.params.followupId, projectId: project.id, doneAt: null },
      select: { id: true, followupDate: true, remarks: true },
    });
    if (!entry) return res.status(404).json({ message: "Pending follow-up not found." });
    await prisma.projectPreProductionFollowupEntry.delete({ where: { id: entry.id } });
    await logProjectActivity({ projectId: project.id, area: "PRE_PRODUCTION", action: "FOLLOWUP_DELETED", detail: [`Follow-up for ${new Date(entry.followupDate).toISOString().slice(0, 10)} removed`, entry.remarks].filter(Boolean).join(" · "), userId: req.user.id });
    return res.json({ data: await projectFollowupSummary(project.id) });
  } catch (error) {
    console.error("Unable to delete pre production follow-up:", error);
    return res.status(500).json({ message: "Unable to delete the follow-up." });
  }
}

/**
 * Save the General panel: the Production Manager, the two gifts and who takes care of them, Storage
 * Needed and the CRD Document, with the reason for any item switched on or off.
 *
 * Here, under `PROJECT / Pre Production`, because these are on the pre production screen and whoever
 * may write that screen may change what it shows. The write itself is the project's own, the same
 * `saveStartProjectWork` Edit Project uses - so switching storage on raises the disk, CRD on raises
 * the document, and a switch keeps its reason - but scoped by this screen's permission and held to
 * the fields above, so none of the rest of the project is reachable from here.
 */
/**
 * Handing the disk over starts its Client Storage record.
 *
 * Pre production's three answers are its own tracking; this is the one that reaches the rest of the
 * studio. A record still sitting at "Yet to Receive" moves to "Yet to Start" - the first step of
 * the storage flow - and one that has gone further is left exactly where it is: from there the disk
 * is Client Storage's, and a status corrected on this board must not pull a backed-up disk back to
 * the beginning. Nothing is raised here either: a storage record exists because the project asked
 * for storage and was started (`ensureProjectClientStorage`).
 */
async function startStorageForHandover(transaction, projectId, userId) {
  const record = await transaction.clientStorage.findFirst({
    where: { projectId, isDeleted: false, status: STORAGE_NOT_ARRIVED },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (!record) return;
  await transaction.clientStorage.update({ where: { id: record.id }, data: { status: STORAGE_STARTED } });
  // Logged on the project the way the status change on this board always was, so the record's
  // history still says who started it and when.
  await logProjectActivity({
    projectId,
    area: "PRE_PRODUCTION",
    action: "STORAGE_STATUS_CHANGED",
    detail: `Hard disk handed over; storage status set to ${STORAGE_STARTED}`,
    userId,
  }, { client: transaction });
}

async function saveGeneral(req, res) {
  const parsed = preProductionGeneralSchema.safeParse(cleanData(req.body));
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });
  try {
    const { project, status, message } = await followupProject(req.params.projectId);
    if (!project) return res.status(status).json({ message });
    const data = await prisma.$transaction(async (transaction) => {
      const saved = await saveStartProjectWork(transaction, project.id, parsed.data, { start: false, userId: req.user.id, permissions: req.permission });
      // In the same transaction as the answer itself: the disk is handed over and its record has
      // started, or neither happened.
      if (parsed.data.hardDiskStatus === HANDED_OVER) await startStorageForHandover(transaction, project.id, req.user.id);
      return saved;
    });
    await logProjectActivity({ projectId: project.id, area: "PRE_PRODUCTION", action: "GENERAL_SAVED", detail: "General details saved", userId: req.user.id });
    return res.json({ data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Unable to save pre production general:", error);
    return res.status(500).json({ message: "Unable to save General." });
  }
}

/**
 * Holds a storage route to the project in its URL: the disk must be that project's, so a storage
 * id from another project is not found here even where the caller could reach it elsewhere.
 */
async function storageOfProject(req, res, next) {
  try {
    const value = req.params.storageId;
    const where = /^\d+$/.test(value) ? { id: Number(value) } : { storageId: value };
    const record = await prisma.clientStorage.findFirst({ where: { ...where, isDeleted: false, OR: [{ projectId: req.params.projectId }, { shoot: { projectId: req.params.projectId } }] }, select: { id: true } });
    if (!record) return res.status(404).json({ message: "Client storage record not found." });
    return next();
  } catch (error) {
    console.error("Unable to find the project's storage record:", error);
    return res.status(500).json({ message: "Unable to find the storage record." });
  }
}

const whatsappGroupLinkSchema = z.object({ jid: z.string().trim().min(1).max(64) }).strict();
// The group's invite link for the client, or "" to take it off.
const inviteLinkSchema = z.object({
  link: z.string().trim().max(255).refine((value) => !value || /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+\/?$/.test(value), "Paste the group's invite link - it starts with https://chat.whatsapp.com/"),
}).strict();

/** Saves the WhatsApp group's invite link, which the client's app offers beside the booking's payments. */
async function saveWhatsappInviteLink(req, res) {
  const parsed = inviteLinkSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Validation failed" });
  try {
    const project = await prisma.salesProject.findFirst({ where: { id: req.params.projectId, deletedAt: null }, select: { id: true } });
    if (!project) return res.status(404).json({ message: "Project not found." });
    await prisma.salesProject.update({ where: { id: project.id }, data: { whatsappGroupInviteLink: parsed.data.link || null } });
    return res.json({ data: { whatsappGroupInviteLink: parsed.data.link || null }, message: parsed.data.link ? "Invite link saved - the client can join from their app." : "Invite link removed." });
  } catch (error) {
    return respond(res, error, "Unable to save the invite link.");
  }
}

/** The caller's own WhatsApp groups, for the General panel's picker. */
async function listWhatsappGroups(req, res) {
  try {
    return res.json({ data: await projectGroupChoices(req.params.projectId, req.user.id) });
  } catch (error) {
    return respond(res, error, "Unable to load your WhatsApp groups.");
  }
}

/** Link one of them to the project; production sends from this caller's WhatsApp from now on. */
async function linkWhatsappGroup(req, res) {
  const parsed = whatsappGroupLinkSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });
  try {
    return res.json({ data: await linkProjectGroup(req.params.projectId, req.user.id, parsed.data.jid) });
  } catch (error) {
    return respond(res, error, "Unable to link the WhatsApp group.");
  }
}

/** Link the group named like the project from the caller's WhatsApp, when exactly one is. */
async function autoLinkWhatsappGroup(req, res) {
  try {
    return res.json({ data: await autoLinkProjectGroup(req.params.projectId, req.user.id) });
  } catch (error) {
    return respond(res, error, "Unable to link the WhatsApp group.");
  }
}

/*
 * ── The shoot's details, sent to the client ───────────────────────────────────────────────────
 *
 * Send to client asks the project's client to fill in this shoot's details in the Beam Craft app
 * (the venue, times, concepts, stay, addresses and photos - `client/portal/preProduction.js`). Their
 * answers land in this shoot's own fields as they save them. Sending again reminds them; the push
 * goes once in ten minutes.
 */
async function sendToClient(req, res) {
  try {
    const shoot = await prisma.projectShoot.findFirst({
      where: { id: req.params.shootId, deletedAt: null },
      select: { id: true, shoot: true, projectId: true, project: { select: { deletedAt: true, projectStatus: true } } },
    });
    if (!shoot || shoot.project.deletedAt) return res.status(404).json({ message: "Shoot not found." });
    if (shoot.project.projectStatus === "Yet to Start") return res.status(409).json({ message: "This project has not been started yet." });
    const sentAt = new Date();
    await prisma.projectPreProduction.upsert({
      where: { shootId: shoot.id },
      create: { shootId: shoot.id, projectId: shoot.projectId, clientFormSentAt: sentAt, updatedByUserId: Number(req.user.id) || null },
      update: { clientFormSentAt: sentAt },
    });
    const phones = await clientPush.notifyProjectRecorded(shoot.projectId, {
      title: `Please add your ${shoot.shoot} details`,
      body: "Venue, timing and photos - open Action Needed in the app",
      data: { type: "preproduction", shootId: shoot.id },
    });
    await logProjectActivity({ projectId: shoot.projectId, shootId: shoot.id, area: "PRE_PRODUCTION", action: "SENT_TO_CLIENT", detail: "Shoot details sent to the client to fill in", userId: req.user.id });
    return res.json({ data: { sentAt: sentAt.toISOString(), phones }, message: "Sent to the client's app." });
  } catch (error) {
    console.error("Unable to send the shoot details to the client:", error);
    return res.status(500).json({ message: "Unable to send to the client." });
  }
}

/** What the client has filled in for this shoot: whether it was sent, their photos and what is still owed. */
async function clientForm(req, res) {
  try {
    const shoot = await prisma.projectShoot.findFirst({ where: { id: req.params.shootId, deletedAt: null, project: { deletedAt: null } }, select: { id: true, projectId: true } });
    if (!shoot) return res.status(404).json({ message: "Shoot not found." });
    const form = (await clientPreProduction.formsOfProject(shoot.projectId)).find((entry) => entry.shootId === shoot.id) || null;
    if (!form) return res.json({ data: { sentAt: null } });
    // The files without their contents (a photo kept inline locally would be megabytes): the team
    // downloads each one by its id.
    const files = form.sections.flatMap((section) => section.fields).filter((field) => field.type === "files")
      .map((field) => ({ kind: field.kind, label: field.label, notAvailable: field.notAvailable, files: field.value.map(({ id, name, mimeType, url }) => ({ id, name, mimeType, previewUrl: /^https?:/i.test(url) && /^image\//.test(mimeType || "") ? url : null })) }));
    return res.json({ data: { sentAt: form.sentAt, done: form.done, pending: form.pending, files } });
  } catch (error) {
    console.error("Unable to read the client's shoot details:", error);
    return res.status(500).json({ message: "Unable to read what the client filled in." });
  }
}

/** Download one file the client uploaded to this shoot, under the name they gave it. */
async function downloadClientFile(req, res) {
  try {
    const file = await clientPreProduction.fileOfShoot(req.params.shootId, req.params.fileId);
    if (!file) return res.status(404).json({ message: "File not found." });
    const name = String(file.fileName).replace(/[\r\n"]/g, "").slice(0, 200) || "file";
    res.set("Content-Type", file.mimeType);
    res.set("Content-Disposition", `attachment; filename="${name.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    return res.send(file.buffer);
  } catch (error) {
    console.error("Unable to download the client's file:", error);
    return res.status(500).json({ message: "Unable to download this file." });
  }
}

/** Download the shoot's whole pre production form as a PDF (every section and answer). */
async function downloadFormPdf(req, res) {
  try {
    const rendered = await renderFormPdf(req.params.shootId);
    if (!rendered) return res.status(404).json({ message: "Shoot not found." });
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `attachment; filename="${rendered.fileName.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(rendered.fileName)}`);
    return res.send(Buffer.from(rendered.pdf));
  } catch (error) {
    console.error("Unable to make the pre production PDF:", error);
    return res.status(500).json({ message: "Unable to make the PDF. Please try again." });
  }
}

module.exports = {
  sendToClient, clientForm, downloadClientFile, downloadFormPdf,
  listProjectActivity,
  setShootStatus, shootStatusSchema, autoLinkWhatsappGroup, saveGeneral, storageOfProject, listRows, listOptions, updateRow, addProjectFollowup, completeProjectFollowup, updateProjectFollowup, deleteProjectFollowup, progressStatuses, preProductionUpdateSchema, followupCreateSchema, followupSummary, conceptList, listWhatsappGroups, linkWhatsappGroup, saveWhatsappInviteLink };
