const prisma = require("../../../config/db");
const { SHOOT_DATE_ASC } = require("../../../services/shootOrder");
const { keyFromUrl } = require("../../../services/objectStorage");
const { projectClientNames, clientNameOf } = require("../../../services/projectClientNames");
const { workingEmployeeStatuses, listPhotoUrl } = require("../../../services/employeeOptionLists");
const { TRAVEL_MODES, VEHICLE_WHERE } = require("./travel");
const { callerOf, accessFor, boardWhere, liveWhere, fail } = require("./access");
const { isAdministrator } = require("../../../services/administrator");
const { rolesFor, isShooter } = require("./crew");
const S = require("./steps");
const { studioDateKey } = require("../../../services/studioTime");
const { busyCrew } = require("./availability");
const { shootVenues } = require("../../../services/shootLocations");
const { projectHandedFrom, productionHandedFrom, withHandedFrom } = require("../../../services/handoverNames");
const { disabledMessages } = require("../../../services/messageTemplate");
// Which template each step's message is, so a message switched off can be left off the step.
const { TEMPLATE_FOR } = require("./messages");
const { projectHoldSources, projectPaymentsDue } = require("../../../services/projectHolds");
const { planMissing, planProgress } = require("./planCompleteness");
const { inStudioOrder } = require("./serviceOrder");
const { boardsForProjects } = require("../../../services/projectBoards");
const { VENDOR_LABEL_SELECT, vendorLabel } = require("../../../services/vendorLabel");

/** Asset Management's cameras still in circulation - what a plan may name. */
const CAMERA_CATEGORY_NAMES = ["Cameras"];
const CAMERA_WHERE = { isDeleted: false, status: { in: ["ACTIVE", "UNASSIGNED", "UNDER_REPAIR"] }, category: { name: { in: CAMERA_CATEGORY_NAMES } } };

const nameOnly = { select: { employeeName: true } };

const boardInclude = {
  shoot: { select: {
    id: true, shootId: true, shoot: true, dateCreated: true, shootPlace: true, district: true, state: true, shootType: true, shootTypes: true, isMainEvent: true, eventStartTime: true, eventEndTime: true,
    // The shoot's services, for what its plan still lacks (`planMissing`) and the board's Services view.
    postProductionAllocations: { where: { deletedAt: null }, select: { serviceDefinitionId: true, serviceName: true, serviceDefinition: { select: { sortOrder: true } } }, orderBy: { createdAt: "asc" } },
  } },
  // Who is on each service, and their camera - the same, named for the Services view.
  serviceCrew: { select: { serviceDefinitionId: true, role: true, employeeId: true, employee: nameOnly, vendorId: true, vendor: { select: VENDOR_LABEL_SELECT }, cameras: { select: { cameraAssetId: true } }, vendorStatus: true } },
  // The shoot's Assist, named for the Services view.
  teamMembers: { select: { employeeId: true, employee: nameOnly, employeeName: true, vendorId: true, vendor: { select: VENDOR_LABEL_SELECT } } },
  salesProject: { select: { id: true, eventId: true, projectStatus: true, productionStatus: true, productionStatusRemarks: true, productionStatusAt: true, productionStatusByUser: { select: { name: true } }, vertical: true, whatsappGroupName: true, whatsappGroupNameId: true, productionManager: true, projectManagerEmployeeId: true, productionManagerEmployeeId: true, productionManagerEmployee: nameOnly } },
  productionCoordinatorEmployee: nameOnly,
  // Whether anything is on the plan yet - the difference between Yet to Start and Work in Progress.
  _count: { select: { teamMembers: true, serviceCrew: true, files: { where: { kind: "TICKET" } } } },
};

const detailInclude = {
  ...boardInclude,
  // The services are the shoot's own, as Edit Project books them: shown, never picked again here.
  shoot: { select: { ...boardInclude.shoot.select, eventStartTime: true, eventEndTime: true, state: true, sessionTiming: true, travel: true, accommodation: true, shootLocations: true, preProduction: { select: { locationAddress: true, locationLink: true, locations: true, reportingTime: true } }, postProductionAllocations: { where: { deletedAt: null }, select: { id: true, serviceDefinitionId: true, serviceName: true, serviceDetails: true, serviceDefinition: { select: { deliverableAdded: true, sortOrder: true } } }, orderBy: { createdAt: "asc" } } } },
  salesProject: { select: {
    ...boardInclude.salesProject.select, whatsappGroupSubject: true,
    // The project as the studio already knows it, for the Plan tab's read-only summary.
    clientMainNumber: true, mainEventDateKnown: true, mainEventDate: true,
    crmName: true, crmEmployee: nameOnly, projectManager: true, projectManagerEmployee: nameOnly,
    preProductionCoordinator: true, preProductionCoordinatorEmployee: nameOnly, creativeManager: true, creativeManagerEmployee: nameOnly,
  } },
  planSubmittedByUser: { select: { name: true } },
  travelVehicleAsset: { select: { assetName: true, assetCode: true } },
  footageBackupByEmployee: nameOnly,
  // Photo copy, per service. The service and the backup person are read through their links.
  footage: {
    select: { serviceDefinitionId: true, serviceDefinition: { select: { name: true } }, footageUrl: true, backedUpByEmployeeId: true, backedUpByEmployee: nameOnly, backedUpByName: true, fileCount: true, size: true, firstFileName: true, lastFileName: true, remarks: true },
    orderBy: { createdAt: "asc" },
  },
  serviceCrew: { select: { serviceDefinitionId: true, role: true, employeeId: true, employee: nameOnly, vendorId: true, vendor: { select: VENDOR_LABEL_SELECT }, cameras: { select: { cameraAssetId: true, cameraAsset: { select: { assetName: true, assetCode: true } } }, orderBy: { id: "asc" } }, vendorStatus: true } },
  files: { select: { id: true, kind: true, url: true, fileName: true, mimeType: true, createdAt: true, uploadedByUser: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
  // `error` is never selected here: it is the raw WhatsApp send error, and read.js answers for
  // anyone holding plain PROJECT:Production READ, not only the coordinator who sent it. Only the
  // short, safe `reason` (messages.js) reaches a response.
  messages: { select: { step: true, status: true, reason: true, sentAt: true } },
};

/**
 * Whether the viewer runs this project rather than only working on it: its Production Manager, its
 * Project Manager or this shoot's Production Coordinator - or somebody who runs every project (a Super
 * Admin, an administrator, `PROJECT / Show All Projects` at Read / Write). The board shows a project the
 * viewer runs at every status; one they are only crew on (Production Team, a service's crew) only from
 * Planned on - Planned, Execution, Hold, Rejected, Completed (`lib/productionBoard`).
 */
function viewerManages(record, caller) {
  if (caller?.superAdmin || caller?.allProjects || caller?.administrator) return true;
  const me = caller?.employeeId || null;
  if (!me) return false;
  const project = record.salesProject || {};
  return [project.productionManagerEmployeeId, project.projectManagerEmployeeId, record.productionCoordinatorEmployeeId].includes(me);
}

/**
 * Whether the viewer is on this shoot - its Production Coordinator, a service's crew or the
 * Production Team. The board shows a crew member a shoot of theirs once that shoot is planned, though
 * the project's other shoots are still being planned (`boardForViewer`).
 */
function viewerOnShoot(record, caller) {
  const me = caller?.employeeId || null;
  if (!me) return false;
  return record.productionCoordinatorEmployeeId === me
    || (record.serviceCrew || []).some((seat) => seat.employeeId === me)
    || (record.teamMembers || []).some((member) => member.employeeId === me);
}

/**
 * Whether the viewer leads this project - its Production Manager or Project Manager, or somebody who
 * runs every project - which is what offers the board's every status tab (`boardForViewer`). A shoot's
 * Production Coordinator runs it (`viewerManages`, so it is listed at every status under All) but is
 * offered the crew's tabs: the full status bar is the leads'.
 */
function viewerLeads(record, caller) {
  if (caller?.superAdmin || caller?.allProjects || caller?.administrator) return true;
  const me = caller?.employeeId || null;
  if (!me) return false;
  const project = record.salesProject || {};
  return [project.productionManagerEmployeeId, project.projectManagerEmployeeId].includes(me);
}

/*
 * The shoot's services in the studio's order, each with its own person by linked name (Rule 5):
 * `person` null while nobody is on it, and a vendor's `vendorStatus` Waiting until they confirm.
 */
function serviceSeats(record) {
  return inStudioOrder(record.shoot?.postProductionAllocations).map((service) => {
    const seat = (record.serviceCrew || []).find((row) => row.role === "LEAD" && row.serviceDefinitionId && row.serviceDefinitionId === service.serviceDefinitionId);
    return {
      definitionId: service.serviceDefinitionId || null,
      name: service.serviceName,
      employeeId: seat?.employeeId || null,
      vendorId: seat?.vendorId || null,
      person: seat?.employee?.employeeName || vendorLabel(seat?.vendor) || null,
      vendor: Boolean(seat?.vendorId),
      vendorStatus: seat?.vendorId ? seat.vendorStatus || "WAITING" : null,
    };
  });
}

function toBoardRow(record, clientNames) {
  const { shoot, salesProject: project } = record;
  return {
    id: record.id,
    shootRecordId: record.shootId,
    projectId: project.id,
    eventId: project.eventId,
    // Its project's status - "On Hold" is shown beside the shoot's title.
    projectStatus: project.projectStatus || null,
    // The project's overall Production status set by hand, when it is.
    productionStatus: project.productionStatus || null,
    productionStatusRemarks: project.productionStatusRemarks || null,
    productionStatusAt: project.productionStatus ? project.productionStatusAt : null,
    productionStatusBy: project.productionStatus ? project.productionStatusByUser?.name || null : null,
    clientName: clientNameOf(project, clientNames),
    shootId: shoot.shootId,
    shoot: shoot.shoot,
    shootDate: shoot.dateCreated,
    shootPlace: shoot.shootPlace,
    // Where and what kind of shoot, for the Schedule's optional columns.
    district: shoot.district || null,
    state: shoot.state || null,
    shootType: shoot.shootType || null,
    // For the board's project rows and their shoot tiles.
    isMainEvent: Boolean(shoot.isMainEvent),
    startTime: shoot.eventStartTime || null,
    endTime: shoot.eventEndTime || null,
    vertical: project.vertical || null,
    productionManagerEmployeeId: project.productionManagerEmployeeId,
    // The linked name first; the copy only where nothing is linked (Rule 5).
    productionManager: project.productionManagerEmployee?.employeeName || project.productionManager || null,
    productionCoordinatorEmployeeId: record.productionCoordinatorEmployeeId,
    productionCoordinator: record.productionCoordinatorEmployee?.employeeName || record.productionCoordinatorName || null,
    planSubmittedAt: record.planSubmittedAt,
    // The plan set to Hold / Rejected by hand (null: automatic), and whether anything is on it yet.
    planStatus: record.planStatus || null,
    planStatusRemarks: record.planStatusRemarks || null,
    // WCR's next follow-up with the client, YYYY-MM-DD.
    planFollowupDate: record.planFollowupDate ? record.planFollowupDate.toISOString().slice(0, 10) : null,
    // What the plan still lacks before it reads Planned; empty once it is complete.
    planMissing: planMissing(record),
    // How much of the plan is filled - the tile's progress until the shoot reads Planned.
    planProgress: planProgress(record),
    // Each service with its own person, and the shoot's Assist - the Services view (`productionServiceView`).
    services: serviceSeats(record),
    assist: (record.teamMembers || []).map((member) => (member.employeeId ? member.employee?.employeeName : member.vendorId ? vendorLabel(member.vendor) : member.employeeName)).filter(Boolean),
    /*
     * The same Assist as the Schedule's picker holds it: `emp:<id>` / `ven:<id>`, **with the name
     * beside it**. Somebody kept by name alone (since left) has no id to pick and is not listed; a
     * save keeps them (`saveTeam`).
     *
     * The name is here because the picker cannot always work it out: its list is who may be put on
     * a shoot *now*, and somebody already on this one may not be on that list any more - they have
     * left, or their department has changed. The chip then read `emp:27068`, which names nobody.
     */
    assistPeople: (record.teamMembers || []).filter((member) => member.employeeId || member.vendorId)
      .map((member) => ({
        value: member.employeeId ? `emp:${member.employeeId}` : `ven:${member.vendorId}`,
        label: (member.employeeId ? member.employee?.employeeName : vendorLabel(member.vendor)) || member.employeeName || "",
      })),
    planStarted: Boolean(record.productionCoordinatorEmployeeId || record.travelMode || record.remarks || record._count?.teamMembers || record._count?.serviceCrew),
    // An indoor shoot (Shoot Type Studio / In-House) has no travel steps or pineapple meeting; its step is read
    // past any it skips.
    indoor: S.indoorOf(record),
    currentStep: S.effectiveStep(record.currentStep, S.indoorOf(record)),
    shootStatus: record.shootStatus,
    pending: S.pendingLabel(record),
    status: S.boardStatus(record),
    updatedAt: record.updatedAt,
  };
}

/**
 * The project and shoot as the studio already knows them, shown read-only above the plan as Pre
 * Production shows them above its form - never edited here. Each person is the linked name first, the
 * copy only where nothing is linked (Rule 5).
 */
function contextSummary(record) {
  const { shoot, salesProject: project } = record;
  const person = (linked, copy) => linked?.employeeName || copy || null;
  return {
    clientMainNumber: project.clientMainNumber || null,
    mainEventDate: project.mainEventDateKnown ? project.mainEventDate : null,
    crm: person(project.crmEmployee, project.crmName),
    projectManager: person(project.projectManagerEmployee, project.projectManager),
    preProductionCoordinator: person(project.preProductionCoordinatorEmployee, project.preProductionCoordinator),
    creativeManager: person(project.creativeManagerEmployee, project.creativeManager),
    shootType: shoot.shootType || null,
    state: shoot.state || null,
    sessionTiming: shoot.sessionTiming || null,
    travelPaidBy: shoot.travel || null,
    accommodationPaidBy: shoot.accommodation || null,
  };
}

function toDetail(record, clientNames, caller, messagesOff = new Set()) {
  const access = accessFor(record, caller);
  const pre = record.shoot?.preProduction || null;
  return {
    ...toBoardRow(record, clientNames),
    district: record.shoot.district,
    location: pre?.locationAddress || null,
    locationLink: pre?.locationLink || null,
    // A shoot held at several places: each name's venue, as Pre Production found it. Else null.
    locations: shootVenues(record.shoot, pre),
    reportingTime: pre?.reportingTime || null,
    whatsappGroupSubject: record.salesProject.whatsappGroupSubject || null,
    summary: contextSummary(record),
    plan: {
      productionCoordinatorEmployeeId: record.productionCoordinatorEmployeeId,
      productionCoordinator: record.productionCoordinatorEmployee?.employeeName || record.productionCoordinatorName || null,
      team: (record.teamMembers || []).map((member) => ({ employeeId: member.employeeId, vendorId: member.vendorId, name: member.employeeId ? member.employee?.employeeName || null : member.vendorId ? vendorLabel(member.vendor) : member.employeeName || null })),
      travelMode: record.travelMode,
      travelModeOther: record.travelModeOther || null,
      ticketStatus: record.ticketStatus || null,
      vehicleNumberPlate: record.vehicleNumberPlate || null,
      // Read through the link, so the name never drifts from the asset; a vehicle retired since it
      // was planned still reads, as a camera does.
      travelVehicle: record.travelVehicleAssetId
        ? { id: record.travelVehicleAssetId, name: record.travelVehicleAsset ? `${record.travelVehicleAsset.assetName} (${record.travelVehicleAsset.assetCode})` : null }
        : null,
      // Each of the shoot's own services, with who works it, in the studio's order. A person or
      // camera retired since it was named still reads, by name, as the rest of the plan does.
      services: inStudioOrder(record.shoot?.postProductionAllocations).map((service) => ({
        id: service.id,
        definitionId: service.serviceDefinitionId || null,
        name: service.serviceName,
        details: service.serviceDetails || null,
        /*
         * Whether this service hands files over - Settings → Project → Services, "Deliverable
         * added". Only an explicit Yes counts, as the quotation generator and the Settings table
         * already read it; a service that was never answered is a No. File in asks for a copy of
         * this service's files only where it is true (`photoCopyKeys`).
         */
        deliverableAdded: service.serviceDefinition?.deliverableAdded === true,
        roles: rolesFor(service.serviceName),
        crew: Object.fromEntries((record.serviceCrew || [])
          .filter((row) => row.serviceDefinitionId && row.serviceDefinitionId === service.serviceDefinitionId)
          .map((row) => [row.role, {
            employeeId: row.employeeId,
            employeeName: row.employee?.employeeName || null,
            vendorId: row.vendorId,
            vendorName: vendorLabel(row.vendor),
            // Every camera the seat takes, in the order they were given, each with the name the
            // pickers show - so one kept by name (an asset since retired) still reads as itself.
            cameras: (row.cameras || []).map((camera) => ({ cameraAssetId: camera.cameraAssetId, cameraName: camera.cameraAsset ? `${camera.cameraAsset.assetName} (${camera.cameraAsset.assetCode})` : null })),
            // A vendor's own answer in place of a camera: Waiting until they confirm the shoot.
            vendorStatus: row.vendorStatus || null,
          }])),
      })),
      // When the crew leaves the studio; the day as YYYY-MM-DD, the form's own shape.
      studioStartDate: record.studioStartDate ? record.studioStartDate.toISOString().slice(0, 10) : null,
      studioStartTime: record.studioStartTime || null,
      remarks: record.remarks,
      planSubmittedAt: record.planSubmittedAt,
      planSubmittedBy: record.planSubmittedByUser?.name || null,
    },
    execution: {
      // Whether the steps can be worked today, and the day they open: three days before the shoot,
      // once the plan is in (`steps.executionRefusal`). The screen says which; the server refuses the same.
      closedReason: S.executionRefusal(record, studioDateKey()),
      opensOn: S.executionOpensOn(record),
      currentStep: S.effectiveStep(record.currentStep, S.indoorOf(record)),
      // The steps this shoot has, in order: seven, or four for an indoor shoot, which also calls
      // Shoot started "Ready" - so the screens are told which kind of shoot this is.
      indoor: S.indoorOf(record),
      steps: S.stepsFor(S.indoorOf(record)),
      stepTimes: Object.fromEntries(S.STEPS.map((step) => [step, record[S.STEP_TIME_FIELDS[step]] || null])),
      pineappleRemarks: record.pineappleRemarks || null,
      // Each step's own remarks, optional or required, keyed by step.
      stepRemarks: Object.fromEntries(Object.entries(S.OPTIONAL_REMARK_FIELDS).map(([step, field]) => [step, record[field] || null])),
      shootStatus: record.shootStatus,
      // The messages the studio has switched off (Settings → Templates), by the message they are:
      // the step says nothing about posting one, and asks for no confirmation before it.
      messagesOff: S.MESSAGE_STEPS.filter((messageStep) => messagesOff.has(TEMPLATE_FOR[messageStep])),
      // Whether the shoot has stopped where it stands, and whether it can be stopped - or started
      // again - at all right now: the step's own title bar carries the Pause / Resume, and
      // `steps.pauseRefusal` is the one answer on both sides. Why it stopped is `shootStatusRemarks`.
      paused: S.isPaused(record),
      canPause: S.pauseRefusal(record, !S.isPaused(record)) === null,
      shootStatusRemarks: record.shootStatusRemarks || null,
      footageUrl: record.footageUrl || null,
      footageBackupByEmployeeId: record.footageBackupByEmployeeId || null,
      footageBackupBy: record.footageBackupByEmployee?.employeeName || null,
      footageRemarks: record.footageRemarks || null,
      // One per service of the shoot (or one with no service, for a shoot with none booked); empty
      // for shoots that finished Photo copy before it was per service - they read the three above.
      footage: (record.footage || []).map((entry) => ({
        serviceDefinitionId: entry.serviceDefinitionId,
        serviceName: entry.serviceDefinitionId ? entry.serviceDefinition?.name || null : null,
        footageUrl: entry.footageUrl,
        backedUpByEmployeeId: entry.backedUpByEmployeeId,
        backedUpBy: entry.backedUpByEmployee?.employeeName || entry.backedUpByName || null,
        fileCount: entry.fileCount,
        size: entry.size,
        firstFileName: entry.firstFileName,
        lastFileName: entry.lastFileName,
        remarks: entry.remarks,
      })),
    },
    files: (record.files || []).map((file) => ({ id: file.id, kind: file.kind, url: file.url, fileName: file.fileName, mimeType: file.mimeType, uploadedBy: file.uploadedByUser?.name || null, createdAt: file.createdAt })),
    // A message closed as OFF - switched off while it was still waiting to be sent - says nothing on
    // the step: there is no failure left to act on (`messages.closeOpenMessages`).
    messages: (record.messages || []).filter((message) => message.status !== "OFF").map((message) => ({ step: message.step, status: message.status, reason: message.reason, sentAt: message.sentAt })),
    canEditPlan: access.canEditPlan,
    canRunSteps: access.canRunSteps,
  };
}

/*
 * The Production Schedule asks for the days it shows rather than every shoot the studio has ever had:
 * `dates` `{ from, to }` (YYYY-MM-DD; `to` may be left open, as Upcoming is) or `{ undated: true }` for
 * the shoots with no date yet. A shoot's day is stored at UTC midnight or at the studio's (18:30 the day
 * before), so the window is widened by a day at each end and the page keeps the exact days it shows.
 * Without `dates` - the Production board - every shoot, as before.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
function shootDateWhere(dates) {
  if (!dates) return null;
  if (dates.undated) return { shoot: { dateCreated: null } };
  const day = (key) => (/^\d{4}-\d{2}-\d{2}$/.test(String(key || "")) ? new Date(`${key}T00:00:00.000Z`) : null);
  const from = day(dates.from);
  const to = day(dates.to);
  if (!from && !to) return null;
  return { shoot: { dateCreated: {
    ...(from ? { gte: new Date(from.getTime() - DAY_MS) } : {}),
    ...(to ? { lt: new Date(to.getTime() + 2 * DAY_MS) } : {}),
  } } };
}

async function listShoots(userId, { client = prisma, scope, iam, dates = null } = {}) {
  const dated = shootDateWhere(dates);
  const [where, caller, administrator] = await Promise.all([
    boardWhere(userId, { scope, iam }),
    callerOf(userId, { client, scope, iam }),
    isAdministrator(userId),
  ]);
  const viewer = { ...caller, administrator };
  const records = await client.projectProduction.findMany({
    where: { ...liveWhere, AND: [where, ...(dated ? [dated] : [])] },
    include: boardInclude,
    orderBy: [{ shoot: { dateCreated: SHOOT_DATE_ASC } }, { createdAt: "asc" }],
  });
  const [clientNames, boards] = await Promise.all([
    projectClientNames(records.map((record) => record.salesProject)),
    // Which boards each project is on, for the row menu's "Jump to" entries: offered only where the
    // project is really there (`services/projectBoards.js`).
    boardsForProjects(records.map((record) => record.salesProject?.id), { client }),
  ]);
  // `canEditPlan`: whether the viewer may change this shoot's plan - the Production Schedule offers
  // its services' people to change only where it is true; the save asks the same (`plan.js`).
  const rows = records.map((record) => ({ ...toBoardRow(record, clientNames), boards: boards.get(record.salesProject?.id) || [], viewerManages: viewerManages(record, viewer), viewerLeads: viewerLeads(record, viewer), viewerOnShoot: viewerOnShoot(record, viewer), canEditPlan: accessFor(record, viewer).canEditPlan }));
  return withHandovers(rows, client);
}

/**
 * A role handed over at offboarding reads "New (Old)" while the new holder still has it: the
 * project's Production Manager and the shoot's Production Coordinator on a board row, and on a
 * shoot's detail its context card too (`summary`).
 */
async function withHandovers(rows, client = prisma) {
  const [byProject, byProduction] = await Promise.all([
    projectHandedFrom(rows.map((row) => row.projectId), client),
    productionHandedFrom(rows.map((row) => row.id), client),
  ]);
  if (!byProject.size && !byProduction.size) return rows;
  return rows.map((row) => {
    const project = byProject.get(row.projectId) || {};
    const named = {
      ...row,
      productionManager: withHandedFrom(row.productionManager, project.productionManager),
      productionCoordinator: withHandedFrom(row.productionCoordinator, byProduction.get(row.id)?.coordinator),
    };
    if (row.summary) {
      named.summary = { ...row.summary };
      for (const key of ["projectManager", "preProductionCoordinator", "creativeManager"]) named.summary[key] = withHandedFrom(row.summary[key], project[key]);
    }
    return named;
  });
}

/** One shoot, if it is on this viewer's board. Keyed by the shoot's internal id. */
async function getShoot(userId, shootId, { client = prisma, scope, iam } = {}) {
  const [caller, where] = await Promise.all([callerOf(userId, { client, scope, iam }), boardWhere(userId, { scope, iam })]);
  const record = await client.projectProduction.findFirst({ where: { shootId: String(shootId || ""), ...liveWhere, AND: [where] }, include: detailInclude });
  if (!record) throw fail(404, "Production record not found.");
  const [clientNames, busy, holds, paymentsDue, messagesOff] = await Promise.all([projectClientNames([record.salesProject]), busyCrew(client, record), projectHoldSources([record.salesProject.id], { client }), projectPaymentsDue([record.salesProject.id], { client }), disabledMessages(Object.values(TEMPLATE_FOR), client)]);
  // Employees on another shoot's crew at an overlapping time: the crew dropdowns leave them out
  // (`availability.js`), save the ones already on this plan.
  // Where its project is held, by department, for the "On Hold (…)" badge beside the title.
  const [detail] = await withHandovers([toDetail(record, clientNames, caller, messagesOff)], client);
  return { ...detail, busyCrewEmployeeIds: busy.employeeIds, busyCameraAssetIds: busy.cameraAssetIds, holds: holds[record.salesProject.id] || [], paymentsDue: paymentsDue[record.salesProject.id] || null };
}

/**
 * The plan form's vocabulary. Vendors are read here rather than from `/api/vendors/options`, which
 * answers to ASSET permissions a production role need not hold - and returns vocabulary, not vendors.
 * Every active vendor is offered for a service's Person and Assistants, as `vendorLabel` names one. Each still
 * carries `canBeProductionTeamMember` - what the vendor's record says about them - but the lists no
 * longer narrow by it: the studio hires whoever is free for the shoot.
 */
async function listOptions({ client = prisma, statuses = workingEmployeeStatuses } = {}) {
  const [employees, cameras, vehicles, vendors] = await Promise.all([
    client.employee.findMany({ where: { archivedAt: null, employmentStatus: { in: await statuses() } }, select: { id: true, employeeId: true, employeeName: true, profilePhotoUrl: true, departments: { select: { department: { select: { name: true } } } } }, orderBy: { employeeName: "asc" } }),
    client.asset.findMany({ where: CAMERA_WHERE, select: { id: true, assetCode: true, assetName: true }, orderBy: { assetName: "asc" } }),
    client.asset.findMany({ where: VEHICLE_WHERE, select: { id: true, assetCode: true, assetName: true }, orderBy: { assetName: "asc" } }),
    client.vendor.findMany({ where: { isDeleted: false, status: "ACTIVE" }, select: { id: true, vendorId: true, ...VENDOR_LABEL_SELECT, vendorType: true, canBeProductionTeamMember: true, contactPerson: true, mobileNumber: true, whatsappNumber: true }, orderBy: { vendorName: "asc" }, take: 500 }),
  ]);
  // `shooter`: in the Technical department, so may work a service (crew.js) - the Person and
  // Assistant lists offer only them; which departments somebody is in stays on the server.
  const people = employees.map(({ departments, ...row }) => ({ ...row, profilePhotoUrl: listPhotoUrl(row.profilePhotoUrl), shooter: isShooter((departments || []).map((link) => link.department?.name)) }));
  return { travelModes: TRAVEL_MODES, employees: people, cameras, vehicles, vendors };
}

/**
 * The log, newest first, for the Production Manager and above (`canEditPlan`: the project's
 * manager, a Super Admin, `PROJECT / Show All Projects` at Read / Write) - the same people who see
 * the WhatsApp status. The coordinator works the steps and does not read the log.
 */
async function listActivity(userId, shootId, { client = prisma, scope, iam } = {}) {
  const [caller, where] = await Promise.all([callerOf(userId, { client, scope, iam }), boardWhere(userId, { scope, iam })]);
  const production = await client.projectProduction.findFirst({
    where: { shootId: String(shootId || ""), ...liveWhere, AND: [where] },
    select: { id: true, productionCoordinatorEmployeeId: true, salesProject: { select: { productionManagerEmployeeId: true } } },
  });
  if (!production) throw fail(404, "Production record not found.");
  if (!accessFor(production, caller).canEditPlan) throw fail(403, "Only this project's Production Manager can see the activity.");
  return client.projectProductionActivity.findMany({
    where: { productionId: production.id },
    select: { id: true, action: true, detail: true, userName: true, createdAt: true },
    // Newest first: the latest action is the one somebody opens the tab to see.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

/**
 * One of a shoot's files as bytes to save, for anybody who can see the shoot. A link to the public
 * bucket cannot be saved by the browser itself (across origins it opens instead), so the server
 * reads it - and only from our own bucket (`keyFromUrl`), never an address a row happens to hold.
 * A file kept inline as a data URI is decoded as it is.
 */
async function fileDownload(userId, shootId, fileId, { client = prisma, scope, iam, fetchUrl = fetch } = {}) {
  const where = await boardWhere(userId, { scope, iam });
  const production = await client.projectProduction.findFirst({ where: { shootId: String(shootId), ...liveWhere, AND: [where] }, select: { id: true } });
  if (!production) throw fail(404, "Production record not found.");
  const file = await client.projectProductionFile.findFirst({ where: { id: String(fileId), productionId: production.id }, select: { url: true, fileName: true, mimeType: true } });
  if (!file) throw fail(404, "File not found.");
  const inline = /^data:([a-z0-9.+/-]+);base64,(.*)$/is.exec(file.url || "");
  if (inline) return { buffer: Buffer.from(inline[2], "base64"), contentType: inline[1].toLowerCase(), fileName: file.fileName };
  if (!keyFromUrl(file.url)) throw fail(400, "This file is not stored on this server, so it cannot be downloaded.");
  const response = await fetchUrl(file.url);
  if (!response.ok) throw fail(404, "The stored file could not be read. It may have been deleted.");
  const contentType = String(response.headers.get("content-type") || file.mimeType || "application/octet-stream").split(";")[0].toLowerCase();
  return { buffer: Buffer.from(await response.arrayBuffer()), contentType, fileName: file.fileName };
}

module.exports = { CAMERA_WHERE, toBoardRow, viewerManages, viewerLeads, viewerOnShoot, toDetail, listShoots, shootDateWhere, getShoot, listOptions, listActivity, fileDownload };
