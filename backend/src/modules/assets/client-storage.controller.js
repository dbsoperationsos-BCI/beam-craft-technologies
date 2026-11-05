const { z } = require("zod");
const { workingEmployeeStatuses } = require("../../services/employeeOptionLists");
const { optionNames } = require("../../services/optionLists");
const { importTableRows, templateHeaders } = require("../../services/tableImport");
const prisma = require("../../config/db");
const { storeDocuments } = require("../../services/documentStorage");
const { storeImages, discardUploads } = require("../../services/imageStorage");
const { projectClientNames, clientNameOf } = require("../../services/projectClientNames");
const { nextStorageId, clientStorageAccessWhere } = require("./client-storage.service");

const STORAGE_PHOTO_FOLDER = "client-storage/photos";

/** Values the "Hard disk in" column accepts, in the order they appear in the dropdown. */
const hardDiskStates = ["Hard Disk In", "Delivered", "In Office"];
const handInStatus = "Hand In";
const backupDoneStatus = "Footage Backup Done";
const backupMissedStatus = "Footage BackUp not done";
const hddOutStatus = "HDD Out";
const assignedStatus = "Assigned";
const transitStatus = "In Transit";
/** How long after the shoot a record has to reach "Footage Backup Done" before it is overdue. */
const backupGraceMs = 24 * 60 * 60 * 1000;
/** The steps still waiting on their backup, and so the ones the overdue sweep can catch. */
const awaitingBackupStatuses = ["Yet to Start", handInStatus];

/**
 * Every move a person is allowed to make, as `from -> the statuses it may become`. A record is
 * raised as "Yet to Receive" and runs to "Delivered" in one line.
 *
 * "Footage BackUp not done" sits off to the side of that line rather than on it: the overdue
 * sweep parks a record there when its deadline passes, and the only way out is to actually
 * complete the backup, which puts it back on "Footage Backup Done" and the rest of the flow
 * carries on unchanged. It is deliberately absent from every list here, so nobody can declare a
 * backup missed by hand while there is still time.
 */
const transitions = {
  "Yet to Receive": ["Yet to Start"],
  "Yet to Start": [handInStatus],
  [handInStatus]: [backupDoneStatus],
  [backupMissedStatus]: [backupDoneStatus],
  [backupDoneStatus]: [hddOutStatus],
  [hddOutStatus]: [assignedStatus],
  [assignedStatus]: [transitStatus],
  // Where a record goes after In Transit depends on the record, not just its status — see
  // nextStatusesFor. Declared as the finished case; the looping case is applied there.
  [transitStatus]: ["Delivered"],
  Delivered: [],
};

/**
 * What a specific record may become next. Everything follows `transitions` except the end of the
 * journey: while the project still has a shoot to come, a disc that has been delivered is not
 * finished with, so it returns to "Yet to Receive" and goes round the same flow again for the
 * next shoot instead of resting at "Delivered".
 *
 * Computed per record here rather than in the browser, so the menu can only ever offer what this
 * endpoint would accept.
 */
function nextStatusesFor(record) {
  if (record.status === transitStatus) return record.isShootStatusPending ? ["Yet to Receive"] : ["Delivered"];
  return transitions[record.status] || null;
}
/**
 * Every status, in the order the flow reads, with the off-to-the-side "not done" sitting next to
 * the step it interrupts. Declared rather than derived from `transitions`, so reordering that map
 * cannot silently reorder what is shown.
 */
const statuses = ["Yet to Receive", "Yet to Start", handInStatus, backupDoneStatus, backupMissedStatus, hddOutStatus, assignedStatus, transitStatus, "Delivered"];

const optionalText = (max) => z.preprocess((value) => typeof value === "string" && value.trim() === "" ? null : value, z.string().trim().max(max).nullable().optional());
const checkbox = z.boolean().optional();
// Only the storage side of a record is writable. Everything about the shoot, client, project
// status and coordinators is read through the shoot and project links, so it is never accepted
// from the client. `projectId` is not writable either: it follows the shoot that is chosen.
const storageInput = z.object({
  shootId: z.preprocess((value) => value === "" ? null : value, z.string().cuid().nullable().optional()),
  // Set by hand for now. It is meant to follow the project's last shoot date, and once that rule
  // exists this should stop being something a person edits.
  isShootStatusPending: checkbox,
  product: optionalText(191),
  type: optionalText(191),
  wid: optionalText(100),
  workType: optionalText(191),
  footageLocation: optionalText(191),
  storageType: optionalText(100),
  footageLink: optionalText(2000),
  remarks: optionalText(10000),
  hardDiscBrand: optionalText(100),
  hardDiscColour: optionalText(80),
  hardDiscCapacity: optionalText(50),
  items: optionalText(191),
  footageSize: optionalText(50),
  hardDiskIn: z.preprocess((value) => value === "" ? null : value, z.enum(hardDiskStates).nullable().optional()),
  labeled: checkbox,
  footageBackup: checkbox,
  finalFilesCopy: checkbox,
  harddiskFootagesBackup: checkbox,
  folderStructureChecked: checkbox,
  finalRenders: checkbox,
  otherFilesInHarddisk: checkbox,
});
const listInput = z.object({ q: z.string().trim().max(191).optional(), status: z.enum(statuses).optional(), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(50) });

// Preprocessed the same way as the delete reason, so a missing key reports the readable message
// rather than zod's "expected string, received undefined".
const requiredDetail = (max, label, step) => z.preprocess((value) => value ?? "", z.string().trim().min(1, `${label} is required before this record can move to ${step}.`).max(max));

// FileUploadField hands back two different shapes, and the asset form treats them separately for
// the same reason: an image field yields bare data-URL strings (already compressed in the
// browser), while a document field yields `{ name, data }` so the filename survives.
//
// Either may instead arrive as the object already persisted, which is passed through rather than
// uploaded again, so re-submitting a form neither duplicates the file nor blanks its metadata.
const storedImage = z.object({ url: z.string().url().max(2000), byteSize: z.number().nullable().optional(), width: z.number().nullable().optional(), height: z.number().nullable().optional(), mimeType: z.string().max(100).nullable().optional(), originalByteSize: z.number().nullable().optional() });
const imageInput = (max = 10) => z.array(z.union([z.string().max(7000000), storedImage])).max(max, max === 1 ? "Attach a single image as the proof." : `Attach at most ${max} images.`).nullable().optional();
const documentInput = z.union([
  z.object({ name: z.string().trim().min(1).max(255), data: z.string().max(7000000) }),
  z.object({ name: z.string().trim().min(1).max(255), url: z.string().url().max(2000) }),
]);
const fileInput = z.array(documentInput).max(10).nullable().optional();
/** Which storage service each uploaded column goes through, keyed by the shape it carries. */
const imageFields = ["hddOutPhoto", "transitCurrentPhoto", "packagePhoto"];
const fileFields = ["courierReceipt"];

/**
 * What each step asks for, as the record's own columns rather than a free-form blob, so the
 * answers land where the table already reads them.
 *
 * The disc is described when it is handed in, the backup is confirmed once it has been taken, and
 * the closing checks are made as it goes out. Only the details identifying the disc and its
 * footage are required; links, remarks and the checks are recorded if known and left alone
 * otherwise.
 */
const handInDetails = z.object({
  workType: requiredDetail(191, "Work Type", handInStatus),
  footageLocation: requiredDetail(191, "Footage Location", handInStatus),
  storageType: requiredDetail(100, "Storage Type", handInStatus),
  hardDiscBrand: requiredDetail(100, "Hard Disc Brand", handInStatus),
  hardDiscCapacity: requiredDetail(50, "Hard Disc Capacity", handInStatus),
  footageLink: optionalText(2000),
  remarks: optionalText(10000),
  hardDiscColour: optionalText(80),
  items: optionalText(191),
  labeled: checkbox,
});

const backupDetails = z.object({
  footageSize: requiredDetail(50, "Footage Size", backupDoneStatus),
  footageBackup: checkbox,
  finalFilesCopy: checkbox,
  harddiskFootagesBackup: checkbox,
});

const hddOutDetails = z.object({
  hardDiskIn: z.preprocess((value) => value === "" ? null : value, z.enum(hardDiskStates).nullable().optional()),
  folderStructureChecked: checkbox,
  finalRenders: checkbox,
  otherFilesInHarddisk: checkbox,
  hddOutPhoto: imageInput(1),
});
// `details` is parsed on its own, and only for the step that asks for it, so it is not validated
// here as well — otherwise moving to an earlier step while sending details would demand them.
const statusInput = z.object({ nextStatus: z.enum(statuses) });
/**
 * How the disc travels, asked for on the way into "In Transit".
 *
 * These were the two arrays below, written here *and* again in `formPanelConfig.js` for the picker
 * - the same drift Payment Mode had, where a word the form offered was a word the server refused.
 * They are lists the studio maintains now (Settings → Fields → Client Storage), read through
 * `optionLists`, and the arrays are what a failed or empty read falls back to.
 *
 * Client Storage keeps its own two lists rather than sharing the assets' - the words match today,
 * but a disc on its way to a client is not judged the way a camera on the shelf is.
 */
const FALLBACK_TRANSIT_CONDITIONS = ["Excellent", "Good", "Fair", "Damaged"];
const FALLBACK_SHIPMENT_TYPES = ["Hand Delivery", "Courier", "Transport", "Internal Transfer"];
const transitConditionNames = () => optionNames("storageCondition", FALLBACK_TRANSIT_CONDITIONS);
const shipmentTypeNames = () => optionNames("storageShipmentType", FALLBACK_SHIPMENT_TYPES);
const nullableDate = z.preprocess((value) => value === "" ? null : value, z.coerce.date().nullable().optional());
const nullableEnum = (values) => z.preprocess((value) => value === "" ? null : value, z.enum(values).nullable().optional());
/*
 * The same, against a list read at validation time rather than a set compiled in.
 *
 * Async, which is what makes every parse of a schema holding one of these a `safeParseAsync` -
 * `safeParse` cannot await a refinement and reports it as a failure instead.
 */
const nullableListed = (names) => z.preprocess(
  (value) => value === "" ? null : value,
  z.string().nullable().optional().refine(
    async (value) => value == null || (await names()).includes(value),
    { message: "Choose one of the options offered" },
  ),
);
// Nothing here is required: the asset transit step asks for the same details without insisting on
// any of them, and a disc often leaves before its tracking number is known.
const transitDetails = z.object({
  transitCondition: nullableListed(transitConditionNames),
  transitDamageRemarks: optionalText(10000),
  transitCurrentPhoto: imageInput(),
  transferFrom: optionalText(191),
  transferTo: optionalText(191),
  sentBy: optionalText(150),
  sentByPhone: optionalText(30),
  receivedBy: optionalText(150),
  receivedByPhone: optionalText(30),
  courierService: optionalText(150),
  trackingNumber: optionalText(100),
  shipmentDateTime: nullableDate,
  shipmentEta: nullableDate,
  courierCharge: z.preprocess((value) => value === "" ? null : value, z.coerce.number().nonnegative().nullable().optional()),
  shipmentType: nullableListed(shipmentTypeNames),
  courierReceipt: fileInput,
  packagePhoto: imageInput(),
  transferReason: optionalText(10000),
  specialInstructions: optionalText(10000),
});

/** Which schema guards the way into each step, for the steps that ask for anything. */
const detailSchemas = { [handInStatus]: handInDetails, [backupDoneStatus]: backupDetails, [hddOutStatus]: hddOutDetails, [transitStatus]: transitDetails };

/**
 * Who post production is handing the disc to, asked for on the way into "Assigned". Anything that
 * is not a positive whole number — missing, blank or nonsense — is collapsed to undefined first so
 * every one of those reports the same readable message instead of zod's coercion complaint.
 */
const assignmentInput = z.object({
  assignedToId: z.preprocess(
    (value) => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : undefined; },
    z.number({ error: "Select the person this hard disc is assigned to." }),
  ),
});
// Preprocessed so an absent `reason` reports the same message as a blank one.
const deleteInput = z.object({ reason: z.preprocess((value) => value ?? "", z.string().trim().min(1, "A reason is required before removing a client storage record.").max(10000)) });

const fail = (status, message) => Object.assign(new Error(message), { status });
const handler = (work, status = 200) => async (req, res) => { try { res.status(status).json(await work(req)); } catch (error) { console.error("Client storage error:", error); if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues[0]?.message || "Please correct the client storage details.", errors: error.issues }); res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to process client storage request." }); } };

const projectSelect = { id: true, whatsappGroupNameId: true, whatsappGroupName: true, projectStatus: true, mainEventDate: true, sourceBranch: true, crmName: true, preProductionCoordinator: true, creativeManager: true, postProductionCoordinator: true };
const shootInclude = { select: { id: true, shootId: true, shoot: true, dateCreated: true, project: { select: projectSelect } } };
// The project is linked directly as well as through the shoot, because records raised when a
// project starts may not have a shoot to read it through yet.
const recordInclude = { shoot: shootInclude, project: { select: projectSelect } };

const locator = (value) => /^\d+$/.test(value) ? { id: Number(value) } : { storageId: value };
/**
 * One record, held to the same line as the list: a record this person may not read is "not found"
 * rather than "forbidden", so an id cannot be probed to learn a record exists.
 */
async function activeRecord(req, value) {
  const row = await prisma.clientStorage.findFirst({ where: { ...locator(value), isDeleted: false, AND: [await readerWhere(req)] } });
  if (!row) throw fail(404, "Client storage record not found.");
  return row;
}
const readerWhere = (req) => clientStorageAccessWhere({ userId: Number(req.user.id), permissions: req.permission });
/*
 * Not narrowed, and neither is the picker it is chosen from: a hard disc is attached to whichever
 * shoot the footage came from, and the person registering it is often not on that shoot. The
 * records themselves are what the rule narrows - and attaching one puts this person's name on it.
 */
async function activeShoot(req, shootId) {
  if (!shootId) return null;
  const shoot = await prisma.projectShoot.findFirst({
    where: { id: shootId, deletedAt: null },
    select: { id: true, projectId: true },
  });
  if (!shoot) throw fail(400, "Select a valid shoot for this storage record.");
  return shoot;
}

/**
 * Uploads the transit files and rewrites each column to hold what was stored rather than the
 * base64 that arrived. Returns the stored objects so they can be deleted again if the row fails
 * to save, leaving nothing orphaned in the bucket.
 */
async function attachStepFiles(details) {
  const uploads = [];
  try {
    for (const field of imageFields) {
      if (!Object.prototype.hasOwnProperty.call(details, field) || details[field] === null) continue;
      const incoming = details[field];
      // storeImage takes a source string; an entry already stored arrives as its persisted object.
      const stored = await storeImages(incoming.map((item) => typeof item === "string" ? item : item.url), { folder: STORAGE_PHOTO_FOLDER });
      uploads.push(...stored);
      details[field] = stored.map((item, index) => {
        const previous = incoming[index];
        // A re-submitted image is not uploaded again, and comes back with its metadata empty, so
        // what was measured the first time is carried across rather than blanked.
        if (item.reused && previous && typeof previous === "object") return { ...previous, url: item.url };
        return { url: item.url, byteSize: item.byteSize, width: item.width, height: item.height, mimeType: item.mimeType, originalByteSize: item.originalByteSize };
      });
    }
    for (const field of fileFields) {
      if (!Object.prototype.hasOwnProperty.call(details, field) || details[field] === null) continue;
      const stored = await storeDocuments(details[field]);
      uploads.push(...stored);
      // A dev server with no bucket configured hands back the inline payload instead of a URL;
      // keep whichever it gave so the record still shows the file.
      details[field] = stored.map((item) => item.url ? { name: item.name, url: item.url } : { name: item.name, data: item.data });
    }
    return uploads;
  } catch (error) {
    await discardUploads(uploads);
    throw error;
  }
}

/*
 * The employment statuses that still count as working here.
 *
 * Read off the status list rather than written out: the studio maintains it in Settings →
 * Field Settings, and each status carries whether it means somebody is working. Written out,
 * this array and the three others like it had no way of hearing about a status being renamed or
 * added, so the list was editable and the meaning of it was not.
 */

/**
 * Resolves the person a disc is being handed to, refusing anyone archived or no longer employed.
 * Their name is stored alongside the link so the record still reads correctly once they leave.
 */
async function resolveAssignee(value) {
  const { assignedToId } = assignmentInput.parse({ assignedToId: value });
  const employee = await prisma.employee.findFirst({
    where: { id: assignedToId, archivedAt: null, employmentStatus: { in: await workingEmployeeStatuses() } },
    select: { id: true, employeeName: true },
  });
  if (!employee) throw fail(400, "Assign this hard disc to a current employee.");
  return { assignedToId: employee.id, assignedToName: employee.employeeName, assignedAt: new Date() };
}

/**
 * PLACEHOLDER — the date the shoot actually happened is not captured anywhere yet. Until that
 * field exists this stands in with the linked shoot's date, falling back to the project's main
 * event date for records raised before a shoot was attached. Everything that depends on the shoot
 * date goes through here, so pointing it at the real column later is a one-line change.
 */
function actualShootDate(row) {
  const value = row.shoot?.dateCreated || row.project?.mainEventDate || null;
  return value ? new Date(value) : null;
}

/**
 * Moves records that ran out of time on to "Footage BackUp not done". A record is overdue when it
 * is still sitting at "Yet to Start" a day after its shoot; one with no date to measure from is
 * left alone rather than guessed at.
 *
 * Run on every list request instead of from a scheduled job, the same way asset inspections
 * decide "due" at read time. The consequence is that statuses only catch up when somebody opens
 * the page — acceptable here because the page is where they are read.
 */
async function sweepOverdueBackups() {
  const waiting = await prisma.clientStorage.findMany({
    where: { isDeleted: false, status: { in: awaitingBackupStatuses } },
    select: { id: true, shoot: { select: { dateCreated: true } }, project: { select: { mainEventDate: true } } },
  });
  const deadline = Date.now() - backupGraceMs;
  const overdue = waiting.filter((row) => { const shootDate = actualShootDate(row); return shootDate && shootDate.getTime() <= deadline; }).map((row) => row.id);
  if (overdue.length) await prisma.clientStorage.updateMany({ where: { id: { in: overdue } }, data: { status: backupMissedStatus } });
  return overdue.length;
}

/** Shared with Accounts, which shows a project by its client for the same reason. */
const clientNames = projectClientNames;

/**
 * Flattens the shoot and project columns the table shows into one `project` object per row.
 * The direct project link wins over the shoot's, so a record still shows its client and
 * coordinators while it is waiting for a shoot to be attached.
 */
function withShootContext(row, names) {
  const project = row.project || row.shoot?.project || null;
  return {
    ...row,
    shoot: row.shoot ? { id: row.shoot.id, shootId: row.shoot.shootId, shoot: row.shoot.shoot, dateCreated: row.shoot.dateCreated } : null,
    project: project && {
      clientName: clientNameOf(project, names),
      projectStatus: project.projectStatus, mainEventDate: project.mainEventDate, sourceBranch: project.sourceBranch, crmName: project.crmName,
      preProductionCoordinator: project.preProductionCoordinator, creativeManager: project.creativeManager, postProductionCoordinator: project.postProductionCoordinator,
    },
  };
}

/** Attaches the creating user's name so the list can show who added each record. */
async function decorate(rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  const ids = [...new Set(list.map((row) => row.createdBy).filter(Boolean))];
  const [users, names] = await Promise.all([
    ids.length ? prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [],
    clientNames(list.map((row) => row.project || row.shoot?.project)),
  ]);
  const userNames = new Map(users.map((user) => [user.id, user.name]));
  const result = list.map((row) => ({
    ...withShootContext(row, names),
    addedBy: row.createdBy ? { id: row.createdBy, name: userNames.get(row.createdBy) || null } : null,
    // Carried per record so the row menu offers exactly the moves this record can make.
    nextStatuses: nextStatusesFor(row) || [],
  }));
  return Array.isArray(rows) ? result : result[0];
}

exports.list = handler(async (req) => {
  const input = listInput.parse(req.query);
  // Before reading, catch up any record whose backup deadline passed while nobody was looking.
  await sweepOverdueBackups();
  /*
   * The rule goes under `AND` beside the search, never spread into the same object: both carry an
   * `OR`, and the second would replace the first - which is how a search once became a way round
   * the rule on the asset and project lists.
   */
  const access = await readerWhere(req);
  const where = { isDeleted: false, ...(input.status && { status: input.status }), AND: [access, ...(input.q ? [{ OR: [{ storageId: { contains: input.q } }, { wid: { contains: input.q } }, { hardDiscBrand: { contains: input.q } }, { shoot: { shootId: { contains: input.q } } }] }] : [])] };
  // The tab counts and the "last updated" note describe every record this person may read, not the
  // filtered page, so they drop the status filter but keep the rule.
  const unfiltered = { isDeleted: false, AND: [access] };
  const [rows, total, grouped, latest] = await Promise.all([
    prisma.clientStorage.findMany({ where, include: recordInclude, orderBy: { createdAt: "desc" }, skip: (input.page - 1) * input.limit, take: input.limit }),
    prisma.clientStorage.count({ where }),
    prisma.clientStorage.groupBy({ by: ["status"], where: unfiltered, _count: { _all: true } }),
    prisma.clientStorage.findFirst({ where: unfiltered, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
  ]);
  const counts = Object.fromEntries(statuses.map((status) => [status, 0]));
  grouped.forEach((group) => { counts[group.status] = group._count._all; });
  return {
    data: await decorate(rows),
    pagination: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) },
    counts: { all: grouped.reduce((sum, group) => sum + group._count._all, 0), ...counts },
    lastUpdatedAt: latest?.updatedAt || null,
  };
});

/** Shoots the Add Storage form can attach to, carrying the project columns it shows read-only. */
exports.shoots = handler(async (req) => {
  const input = listInput.parse(req.query);
  const rows = await prisma.projectShoot.findMany({
    where: { deletedAt: null, ...(input.q && { OR: [{ shootId: { contains: input.q } }, { shoot: { contains: input.q } }] }) },
    select: shootInclude.select,
    orderBy: { dateCreated: "desc" },
    take: 200,
  });
  const names = await clientNames(rows.map((row) => row.project));
  return { data: rows.map((row) => { const { shoot, project } = withShootContext({ shoot: row }, names); return { ...shoot, project }; }) };
});

// `transitions` is served rather than restated in the browser, so the row menu can only ever
// offer moves the API would accept.
// The picker reads its words from here, so the form and the validation above cannot disagree.
exports.options = handler(async () => ({
  data: {
    hardDiskStates,
    statuses,
    transitions,
    transitConditions: await transitConditionNames(),
    shipmentTypes: await shipmentTypeNames(),
  },
}));

exports.get = handler(async (req) => {
  const row = await prisma.clientStorage.findFirst({ where: { ...locator(req.params.storageId), isDeleted: false, AND: [await readerWhere(req)] }, include: recordInclude });
  if (!row) throw fail(404, "Client storage record not found.");
  return { data: await decorate(row) };
});

exports.create = handler(async (req) => {
  const input = storageInput.parse(req.body);
  const shoot = await activeShoot(req, input.shootId);
  const userId = Number(req.user.id);
  const row = await prisma.clientStorage.create({ data: { ...input, projectId: shoot?.projectId || null, storageId: await nextStorageId(prisma), createdBy: userId, updatedBy: userId }, include: recordInclude });
  return { data: await decorate(row) };
}, 201);

/*
 * ── Importing storage records from a spreadsheet ──────────────────────────────────────────────
 *
 * A record is mostly what the employee holding the hard disc writes down - the brand, the capacity,
 * where the footage sits - and none of it is required, so a file may carry as few columns as the
 * studio has answers for. `shootId` is deliberately absent: it is a database id nobody reads off a
 * spreadsheet, and the link to a shoot is made from the project side.
 */
const CLIENT_STORAGE_IMPORT_COLUMNS = [
  { field: "product", label: "Product" },
  { field: "type", label: "Type" },
  { field: "wid", label: "WID" },
  { field: "workType", label: "Work Type" },
  { field: "footageLocation", label: "Footage Location" },
  { field: "storageType", label: "Storage Type" },
  { field: "footageLink", label: "Footage Link" },
  { field: "hardDiscBrand", label: "Hard Disc Brand" },
  { field: "hardDiscColour", label: "Hard Disc Colour" },
  { field: "hardDiscCapacity", label: "Hard Disc Capacity" },
  { field: "items", label: "Items" },
  { field: "footageSize", label: "Footage Size" },
  { field: "hardDiskIn", label: "Hard Disk In" },
  { field: "remarks", label: "Remarks" },
];

exports.importTemplate = handler(async () => ({ data: { columns: templateHeaders(CLIENT_STORAGE_IMPORT_COLUMNS) } }));

exports.importRows = handler(async (req) => {
  const userId = Number(req.user.id);
  return {
    data: await importTableRows({
      headers: req.body?.headers,
      rows: req.body?.rows,
      startRow: Number(req.body?.startRow) || 2,
      columns: CLIENT_STORAGE_IMPORT_COLUMNS,
      schema: storageInput,
      create: async (input) => {
        await prisma.clientStorage.create({ data: { ...input, projectId: null, storageId: await nextStorageId(prisma), createdBy: userId, updatedBy: userId } });
      },
    }),
  };
});

exports.update = handler(async (req) => {
  const current = await activeRecord(req, req.params.storageId);
  const input = storageInput.partial().parse(req.body);
  // Choosing a shoot moves the record to that shoot's project. Clearing the shoot leaves the
  // project link alone, so a record raised from a started project keeps pointing at it.
  let projectId;
  if (Object.prototype.hasOwnProperty.call(input, "shootId")) {
    const shoot = await activeShoot(req, input.shootId);
    if (shoot) projectId = shoot.projectId;
  }
  const row = await prisma.clientStorage.update({ where: { id: current.id }, data: { ...input, ...(projectId !== undefined && { projectId }), updatedBy: Number(req.user.id) }, include: recordInclude });
  return { data: await decorate(row) };
});

/**
 * Moves a record one step along `statuses`. Skipping a step and going back are both refused, so
 * a record that reads "Delivered" has genuinely been through every step before it.
 *
 * Three steps ask for more than the move itself: "Footage Backup Done" wants the disc and footage
 * details, "Assigned" wants the person post production is handing the disc to, and "In Transit"
 * wants how the disc travels.
 */
exports.changeStatus = handler(async (req) => {
  const current = await activeRecord(req, req.params.storageId);
  const input = statusInput.parse(req.body);
  const allowed = nextStatusesFor(current);
  if (!allowed) throw fail(409, `This record carries an unrecognised status (${current.status}).`);
  if (input.nextStatus === current.status) throw fail(409, `This record is already ${current.status}.`);
  if (!allowed.includes(input.nextStatus)) {
    throw fail(409, allowed.length
      ? `A storage record moves one step at a time: ${current.status} can only become ${allowed.join(" or ")}.`
      : `${current.status} is the end of the line; this record cannot be moved on.`);
  }

  const detailSchema = detailSchemas[input.nextStatus];
  // `parseAsync`, because the transit step's condition and shipment type are checked against the
  // studio's own lists rather than against a set compiled in, and a refinement that awaits cannot
  // be run by the synchronous parse - it would report every value as invalid.
  const details = detailSchema ? await detailSchema.parseAsync(req.body.details || {}) : {};
  const assignment = input.nextStatus === assignedStatus ? await resolveAssignee(req.body.assignedToId) : {};
  // Files are uploaded only once the move itself is known to be legal, so a rejected transition
  // never leaves anything behind in the bucket.
  const uploads = detailSchema ? await attachStepFiles(details) : [];

  let row;
  try {
    row = await prisma.clientStorage.update({
      where: { id: current.id },
      data: { ...details, ...assignment, ...(input.nextStatus === assignedStatus && { assignedById: Number(req.user.id) }), status: input.nextStatus, updatedBy: Number(req.user.id) },
      include: recordInclude,
    });
  } catch (error) {
    await discardUploads(uploads);
    throw error;
  }
  return { data: await decorate(row), message: `${current.storageId} moved to ${input.nextStatus}.` };
});

/**
 * Removing one record, as the route and the bulk delete both do it.
 *
 * Split out so `DELETE /bulk` runs this rather than its own query. `activeRecord` takes the request
 * as well as the id and is what scopes the record to this caller, so an id typed into the body of a
 * bulk request is refused exactly as the same id in the URL would be.
 */
const removeStorageRecord = async (req, storageId) => {
  const current = await activeRecord(req, storageId);
  const input = deleteInput.parse(req.body);
  await prisma.clientStorage.update({ where: { id: current.id }, data: { isDeleted: true, deletedReason: input.reason, deletedAt: new Date(), updatedBy: Number(req.user.id) } });
  return { id: current.id, storageId: current.storageId, isDeleted: true };
};
exports.removeStorageRecord = removeStorageRecord;
exports.remove = handler(async (req) => ({ data: await removeStorageRecord(req, req.params.storageId), message: "Client storage record removed." }));
