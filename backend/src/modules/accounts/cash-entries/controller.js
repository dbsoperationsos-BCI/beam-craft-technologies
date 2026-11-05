const { z } = require("zod");
const { paymentModes, modesWithTransactionId, modesWithAccount, modesWithDetails, FALLBACK_MODES, FALLBACK_MODES_WITH_TRANSACTION_ID, FALLBACK_MODES_WITH_ACCOUNT } = require("../../../services/paymentOptionLists");
const { workingEmployeeStatuses } = require("../../../services/employeeOptionLists");
const prisma = require("../../../config/db");
const { attachFiles, removeDroppedFiles, fileUrls, discardUploads } = require("../../../services/uploadMetadata");
const { receiptMessageFor } = require("./receiptMessage");
const { projectClientNames, clientNameOf } = require("../../../services/projectClientNames");
const iamService = require("../../../services/iam.service");

/*
 * The permission a branch on a cash entry is measured against.
 *
 * Branch reach is per-permission: somebody may reach every branch for leads through one role and one
 * branch for the cash book through another, so the check has to name which of the two it means.
 */
const CASH_MANAGEMENT = { module: "ACCOUNTS", feature: "Cash Management", level: "READ_WRITE" };
const dataScope = require("../../../services/dataScope.service");
const { lookups: referenceLookups } = require("../../../services/referenceMatchers");
const { nextIdentifier } = require("../../../services/identifiers");
const { importTableRows, templateHeaders } = require("../../../services/tableImport");

/**
 * Cash moving in and out: what it was, who it was with, how it moved, and who in the studio handled
 * it.
 *
 * Both directions are the same record with `entryType` saying which way the money went, so the
 * validation below is one schema with the few direction-only fields required conditionally. Money in
 * lands in a studio account and is taken by a receiver; money out goes to somebody and is paid by
 * one of ours. The fields that do not belong to the direction chosen are dropped rather than stored,
 * so an entry can never carry a leftover from the direction picked a moment earlier.
 *
 * The other conditional is the payment mode: a mode with a reference asks for the transaction ID and
 * cash does not.
 *
 * What the money was against follows the same split. Money comes in for a project as a whole — an
 * advance, a final settlement — while money goes out per shoot, so money in is filed against a
 * project and money out against a shoot, whose project is stored alongside it so both directions can
 * be totalled per project.
 *
 * That link is also what tells an entry its branch, which is why a form must supply it. The branch
 * decides whose books the money lands in and is nobody's to choose, so it is read off the project's
 * Source Branch in `linkFields` rather than asked for — the same rule a payment request already
 * applies to itself. The one writer that can file against no project is an approved payment request,
 * which resolved its own branch when it was raised and hands it over; `formEntrySchema` below is
 * what holds every other caller to naming a project.
 */

const ENTRY_TYPES = ["Received", "Spent"];
const RECEIVED_CATEGORIES = ["Advance", "Partial Payment", "Extras", "Final Settlement", "Advance Settlement"];
/** Placeholder until Accounts settles its own spend list; changing this array is the whole change. */
const SPENT_CATEGORIES = ["Vendor Payment", "Freelancer Payment", "Salary Advance", "Employee Expense", "Travel", "Equipment", "Office Expense", "Client Refund", "Other"];
const CATEGORIES_BY_TYPE = { Received: RECEIVED_CATEGORIES, Spent: SPENT_CATEGORIES };
/**
 * How the money moved, and what each way of moving it asks for.
 *
 * A mode that carries a reference from the payment app or the bank asks for it — for a transfer
 * that reference is the proof it went through. A mode that moves money through an account asks
 * which one: the account it landed in for money in, the account it left for money out. Cash does
 * neither, and is the only mode that asks for nothing beyond the receiver every entry names.
 */
/*
 * What each way of moving money asks for, read off the payment mode list rather than written out.
 *
 * These three were arrays here and again in the browser, so a studio adding a mode of its own got
 * one the form offered and this refused. The meaning is on the row now - see
 * `services/paymentOptionLists`, which is also where the fallbacks live: exactly these values.
 */
const MODES_WITH_TRANSACTION_ID = FALLBACK_MODES_WITH_TRANSACTION_ID;
const MODES_WITH_ACCOUNT = FALLBACK_MODES_WITH_ACCOUNT;
 // "Other" is the way out for anything the four named modes do not cover — a cheque, an adjustment,
// a swap. Like cash it carries neither a reference nor an account, so what it actually was belongs
// in the entry's description.
const PAYMENT_MODES = FALLBACK_MODES;
// Money in and money out are two runs of numbers, not one: the studio reads a receipt book and a
// payment book, and a shared sequence would leave gaps in both.
const SCHEME_BY_TYPE = { Received: "CASH_RECEIVED", Spent: "CASH_SPENT" };
// The employment statuses that count as working here, read off the status list the studio
// maintains in Settings → Field Settings rather than written out again. See
// `services/employeeOptionLists`.
/** How many projects and shoots the form's pickers are given, most recent first. */
const LOOKUP_LIMIT = 200;
/** Where the receipts live in the bucket, under the module that owns them like every other folder. */
const PROOF_FOLDER = "accounts/cash-entries/proof";
const MAX_PROOF_FILES = 5;

const optionalText = (max) => z.string().trim().max(max).nullable().optional();

const entrySchema = z.object({
  entryType: z.enum(ENTRY_TYPES),
  // Money in names a project, money out names a shoot; the one that does not belong to the
  // direction is dropped in `linkFields` rather than rejected, as `receivedAccount` and `paidTo`
  // already are, so switching direction in the form cannot leave a stale link behind.
  projectId: optionalText(191),
  shootId: optionalText(191),
  category: z.string().trim().min(1, "Choose a category").max(60),
  // Money is read as a number but stored as a decimal, so the string a form sends is coerced here
  // and handed to Prisma as a fixed two-place figure rather than a float.
  amount: z.coerce.number().positive("Enter an amount greater than zero").max(999_999_999),
  entryDate: z.coerce.date(),
  // Not asked for by any form. An entry's branch is the Source Branch of the project it is filed
  // against, worked out in `linkFields`; this is the way in for the one writer with no project to
  // read it from — an approved payment request, whose branch was resolved when it was raised.
  branch: optionalText(120),
  // The same way in, for the same two writers. An entry filed against a project takes its client
  // from the project; an approved payment request has no project to read one from - a salary
  // advance, a vendor bill on general lines - and names the person or vendor it pays instead, and
  // an imported row carries the Client Name column. `client_name` cannot be null, so without this
  // field both were stripped here and the write failed on the column, as a 500, after the request
  // had been marked approved inside the same transaction.
  clientName: optionalText(191),
  /*
   * Checked against the payment mode list rather than a fixed set of six.
   *
   * It was `z.enum(PAYMENT_MODES)`, so a mode added in Settings → Field Settings → Accounts →
   * Payment Mode was offered by the form and refused here. Async, which is what makes the parses
   * below `safeParseAsync`.
   */
  paymentMode: z.string().trim().min(1).max(120).refine(
    async (value) => (await paymentModes()).some((name) => name === value),
    "Choose a payment mode from the list",
  ),
  transactionId: optionalText(100),
  paymentModeOther: optionalText(120),
  receivedAccount: optionalText(120),
  paidFromAccount: optionalText(120),
  paidTo: optionalText(191),
  handlerEmployeeId: z.coerce.number().int().positive().nullable().optional(),
  handlerName: optionalText(191),
  handlerIsOther: z.boolean().optional(),
  description: optionalText(5000),
  // A flat list of links: the files already on the entry come back as the URLs they were stored
  // under, and anything just picked arrives as an inline data URI. Which is which is sorted out in
  // `attachProof`, so the form does not have to tell them apart.
  paymentProof: z.array(z.string().min(1)).max(MAX_PROOF_FILES, `Attach at most ${MAX_PROOF_FILES} files`).nullable().optional(),
}).superRefine(async (value, context) => {
  const issue = (path, message) => context.addIssue({ code: "custom", path: [path], message });
  // Which modes ask for what is the list's own answer now, not three arrays written out here.
  const [withTransactionId, withAccount, withDetails] = await Promise.all([
    modesWithTransactionId(), modesWithAccount(), modesWithDetails(),
  ]);

  if (!(CATEGORIES_BY_TYPE[value.entryType] || []).includes(value.category)) {
    issue("category", `That category does not belong to a ${value.entryType.toLowerCase()} entry`);
  }
  // A mode that says what it actually was is only meaningful once it does, the way an "Other"
  // handler needs a name. Which modes those are is the list's answer.
  if (withDetails.includes(value.paymentMode) && !value.paymentModeOther) {
    issue("paymentModeOther", "Say what the payment mode was");
  }
  if (withTransactionId.includes(value.paymentMode) && !value.transactionId) {
    issue("transactionId", value.paymentMode === "UPI" ? "Enter the UPI transaction ID" : `Enter the ${value.paymentMode} reference number`);
  }
  // Only the modes that move money through an account are asked for one; cash is asked for none.
  if (withAccount.includes(value.paymentMode)) {
    if (value.entryType === "Received" && !value.receivedAccount) issue("receivedAccount", "Enter the account the money went into");
    if (value.entryType === "Spent" && !value.paidFromAccount) issue("paidFromAccount", "Enter the account the money was paid from");
  }
  if (value.entryType === "Spent" && !value.paidTo) {
    issue("paidTo", "Enter who the payment went to");
  }
  if (value.handlerIsOther && !value.handlerName) {
    issue("handlerName", value.entryType === "Received" ? "Enter who received the money" : "Enter who paid the money out");
  }
  if (!value.handlerIsOther && !value.handlerEmployeeId) {
    issue("handlerEmployeeId", value.entryType === "Received" ? "Choose the employee who received the money" : "Choose the employee who paid the money out");
  }
});

/**
 * The same entry as a form fills it in, which must say what the money was against.
 *
 * The branch is no longer asked for and is read off the project instead, so the link that used to be
 * optional is now the only thing that can answer it: money in names the project, money out names one
 * of its shoots, and neither may be left empty. An office expense with no project behind it is
 * raised as a payment request rather than filed here.
 *
 * `entrySchema` stays permissive because approving such a request cannot meet this — a salary
 * advance belongs to no project — and that entry arrives with the branch its request already
 * resolved.
 */
const formEntrySchema = entrySchema.superRefine((value, context) => {
  if (value.entryType === "Received" && !value.projectId) {
    context.addIssue({ code: "custom", path: ["projectId"], message: "Select the project this was received for" });
  }
  if (value.entryType === "Spent" && !value.shootId) {
    context.addIssue({ code: "custom", path: ["shootId"], message: "Select the shoot this was spent on" });
  }
});

const idSchema = z.string().trim().min(1).max(191);
const listQuerySchema = z.object({
  entryType: z.enum(ENTRY_TYPES).optional(),
  category: z.string().trim().max(60).optional(),
  search: z.string().trim().max(191).optional(),
});

function validationError(res, error) {
  return res.status(400).json({ message: "Validation failed", errors: error.flatten() });
}

function handleCashEntryError(res, error, fallback) {
  if (error.fieldErrors) return res.status(400).json({ message: error.message, errors: error.fieldErrors });
  if (error.status) return res.status(error.status).json({ message: error.message });
  if (error.code === "P2025") return res.status(404).json({ message: "Cash entry not found" });
  return res.status(500).json({ message: fallback, error: error.message });
}

function parseId(req, res) {
  const parsed = idSchema.safeParse(req.params.id);
  if (parsed.success) return parsed.data;
  validationError(res, parsed.error);
  return null;
}

/*
 * DBS-MR-QQ-ERD-000001 for money in, DBS-MS-QQ-ERD-000001 for money out.
 *
 * Counted per vertical and per branch, so each set of books runs from one. The branch is the one
 * `linkFields` already worked out - the project's own Source Branch, falling back to what the
 * request carried - and the vertical is read off that same project.
 *
 * An entry filed against no project has no vertical to read, which is the case for an office
 * expense; it takes the default rather than refusing to save, because a cash book that cannot
 * record a bill is worse than one whose office expenses all read DD.
 */
async function verticalForEntry(projectId, client = prisma) {
  if (!projectId) return "";
  const project = await client.salesProject.findFirst({ where: { id: projectId }, select: { vertical: true } });
  return project?.vertical || "";
}

const nextEntryId = (entryType, { branch, vertical }, client = prisma) =>
  nextIdentifier(SCHEME_BY_TYPE[entryType], { vertical, branch }, client);

/** The project columns the form pulls in and the table reads back. */
const projectSelect = { id: true, eventId: true, whatsappGroupNameId: true, whatsappGroupName: true, projectStatus: true, mainEventDate: true, sourceBranch: true, crmName: true };

/** A project as the form's pickers read it: the identifier chosen from, plus what it fills in. */
const toProjectOption = (project, names) => project && {
  id: project.id,
  eventId: project.eventId,
  clientName: clientNameOf(project, names),
  projectStatus: project.projectStatus,
  mainEventDate: project.mainEventDate,
  sourceBranch: project.sourceBranch,
  crmName: project.crmName,
};

const include = {
  handler: { select: { id: true, employeeId: true, employeeName: true, department: true, designation: true } },
  project: { select: { id: true, eventId: true } },
  shoot: { select: { id: true, shootId: true, shoot: true, dateCreated: true } },
};

/**
 * An entry is flattened for the table, which reads plain keys, while the linked employee is kept
 * under `handler` for anything wanting the whole record. `signedAmount` lets a list holding both
 * directions be totalled by adding a column up rather than by branching per row.
 *
 * The shoot and project read back as their business identifiers — PS-000012, EVT-000004 — because
 * that is what the table shows and what the person who filed the entry chose from.
 */
function toRow(entry) {
  const amount = entry.amount === null ? null : Number(entry.amount);
  return {
    ...entry,
    amount,
    signedAmount: amount === null ? null : (entry.entryType === "Spent" ? -amount : amount),
    handlerEmployeeCode: entry.handler?.employeeId || (entry.handlerIsOther ? "—" : ""),
    handlerDepartment: entry.handler?.department || "",
    shootCode: entry.shoot?.shootId || "",
    shootName: entry.shoot?.shoot || "",
    shootDate: entry.shoot?.dateCreated || null,
    projectCode: entry.project?.eventId || "",
    // The metadata stays on `paymentProof` for anything that wants it; the bare links are what the
    // form re-sends and what the info panel's gallery draws.
    paymentProofUrls: fileUrls(entry.paymentProof),
  };
}

async function handlerFields(input) {
  if (input.handlerIsOther) {
    return { handlerEmployeeId: null, handlerName: input.handlerName, handlerIsOther: true };
  }
  const employee = await prisma.employee.findFirst({
    where: { id: input.handlerEmployeeId, archivedAt: null },
    select: { id: true, employeeName: true },
  });
  if (!employee) throw badRequest("The selected employee is not an active employee");
  return { handlerEmployeeId: employee.id, handlerName: employee.employeeName, handlerIsOther: false };
}

/** The entry's proof, stored through the shared uploader so the bills on a payment request behave identically. */
const attachProof = (sources, existing, userId) => attachFiles(sources, existing, { folder: PROOF_FOLDER, userId })
  .then(({ files, uploads }) => ({ proof: files, uploads }));

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

/**
 * What the entry is filed against.
 *
 * Both directions name a project. Money out additionally names one of that project's shoots, since
 * spend is per shoot, and stores both so it can be read either way without a second hop; money in
 * is for the project as a whole and stores no shoot. Choosing nothing is allowed and stores
 * nothing, which is how an office expense or a refund against no project is filed.
 *
 * A shoot from another project is refused rather than quietly re-filing the entry: the two arrive
 * from pickers where the project narrows the shoots, so a mismatch is a stale value, not a choice.
 */
/*
 * The links are deliberately not narrowed to what this person may read.
 *
 * A picker exists to link one record to another, and an entry is filed against whatever project the
 * money was for - which is often somebody else's wedding. The project dropdown offers every project
 * for the same reason, so refusing one here would refuse what the form itself offered. What is
 * narrowed is the list of entries: whose money this is to *see* is a different question from what
 * it may be filed against.
 */
async function linkFields(input) {
  const projectSelection = { id: true, whatsappGroupNameId: true, whatsappGroupName: true, sourceBranch: true };
  // Scoped: an entry may only be filed against a project this person can see. Refused as an invalid
  // choice rather than as a permission, so the reply says no more than the picker already did.
  const project = input.projectId
    ? await prisma.salesProject.findFirst({ where: { id: input.projectId, deletedAt: null }, select: projectSelection })
    : null;
  if (input.projectId && !project) throw badRequest("Select a valid project for this entry");

  // The client comes off whichever project the entry ends up filed against, so it is worked out
  // here beside the links rather than asked for and left to disagree with them.
  const named = async (found) => {
    if (!found) return null;
    const names = await projectClientNames([found]);
    return clientNameOf(found, names);
  };

  /**
   * What the link settles: the client, and the branch.
   *
   * The branch is the project's own Source Branch rather than anything sent in. It decides whose
   * books the entry lands in, so reading it off the project is what stops a form's answer and the
   * project's disagreeing — and is the same source a payment request against a shoot already uses.
   * `input.branch` is the fallback for an entry with no project, which only an approved payment
   * request can be; with neither there is nothing to file against, and the column cannot be null.
   */
  const filedAgainst = async (found, projectId, shootId) => {
    const branch = found?.sourceBranch || input.branch || null;
    if (!branch) throw badRequest("No branch could be worked out for this entry. File it against a project.");
    // The project's client where there is a project; otherwise the name the writer sent - which
    // is what the column needs, and refused here rather than at the database.
    const clientName = (await named(found)) || input.clientName || null;
    if (!clientName) throw badRequest("No client could be worked out for this entry. Name the client, or file it against a project.");
    return { projectId, shootId, clientName, branch };
  };

  if (input.entryType === "Received" || !input.shootId) {
    return filedAgainst(project, project?.id || null, null);
  }

  // A shoot reaches a project too, so it is scoped through the same rule: filing against a shoot
  // must not be a way round filing against its project.
  const shoot = await prisma.projectShoot.findFirst({
    where: { id: input.shootId, deletedAt: null },
    select: { id: true, projectId: true, project: { select: projectSelection } },
  });
  if (!shoot) throw badRequest("Select a valid shoot for this entry");
  if (project && shoot.projectId !== project.id) throw badRequest("That shoot does not belong to the chosen project");
  return filedAgainst(shoot.project, shoot.projectId, shoot.id);
}

async function entryData(input) {
  const isReceived = input.entryType === "Received";
  const [carriesTransactionId, carriesAccount] = await Promise.all([
    modesWithTransactionId().then((modes) => modes.includes(input.paymentMode)),
    modesWithAccount().then((modes) => modes.includes(input.paymentMode)),
  ]);
  return {
    entryType: input.entryType,
    ...(await linkFields(input)),
    category: input.category,
    amount: input.amount.toFixed(2),
    entryDate: input.entryDate,
    paymentMode: input.paymentMode,
    transactionId: carriesTransactionId ? input.transactionId : null,
    paymentModeOther: input.paymentMode === "Other" ? input.paymentModeOther : null,
    receivedAccount: isReceived && carriesAccount ? input.receivedAccount : null,
    paidFromAccount: !isReceived && carriesAccount ? input.paidFromAccount : null,
    paidTo: isReceived ? null : input.paidTo,
    description: input.description ?? null,
    ...(await handlerFields(input)),
  };
}

/** The branch reference beside the branch name an entry is filed under, by the backfill's rule. */
async function branchReference(branch) {
  return { branchId: (await referenceLookups()).branchId(branch) };
}

/**
 * Whose entries: the grant's scope on ACCOUNTS / Cash Management, on the entry's branch reference
 * and the employee who handled the money. Resolved once per request and used by the list and by
 * every record endpoint, so an id typed into a URL reaches exactly what the list shows.
 */
const CASH_SCOPE_COLUMNS = { branch: "branchId", employee: "handlerEmployeeId", user: "createdBy" };
const cashScope = (req) => dataScope.resolve({ userId: Number(req.user.id), module: req.permission.module, feature: req.permission.feature, columns: CASH_SCOPE_COLUMNS });

/** One live entry the request may see, or null - out of scope reads as not found. */
async function scopedEntry(req, id, select) {
  const [scope, entry] = await Promise.all([
    cashScope(req),
    prisma.cashEntry.findFirst({ where: { id, deletedAt: null }, ...(select ? { select: { ...select, branchId: true, handlerEmployeeId: true, createdBy: true } } : { include }) }),
  ]);
  return entry && scope.allows(entry) ? entry : null;
}

async function listEntries(req, res) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return validationError(res, parsed.error);
  const { entryType, category, search } = parsed.data;
  try {
    const scope = await cashScope(req);
    const data = await prisma.cashEntry.findMany({
      where: {
        deletedAt: null,
        AND: [scope.where],
        ...(entryType ? { entryType } : {}),
        ...(category ? { category } : {}),
        ...(search ? { OR: [
          { clientName: { contains: search } },
          { entryId: { contains: search } },
          { paidTo: { contains: search } },
          // Searched by the identifiers the entry was filed under, which is how Accounts finds what
          // a shoot cost or what came in against a project. The description carries the code of the
          // payment request an approval wrote the entry for, so the two can be found from each other.
          { shoot: { shootId: { contains: search } } },
          { project: { eventId: { contains: search } } },
          { description: { contains: search } },
        ] } : {}),
      },
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
      include,
    });
    return res.json({ data: data.map(toRow) });
  } catch (error) { return handleCashEntryError(res, error, "Unable to load cash entries"); }
}

async function getEntry(req, res) {
  const id = parseId(req, res);
  if (!id) return;
  try {
    const entry = await scopedEntry(req, id);
    if (!entry) return res.status(404).json({ message: "Cash entry not found" });
    return res.json({ data: toRow(entry) });
  } catch (error) { return handleCashEntryError(res, error, "Unable to load this cash entry"); }
}

/**
 * Everything the form's dropdowns are drawn from, in one request rather than five. No branches: the
 * form no longer asks for one, since an entry's branch is the Source Branch of the project it names.
 * The account names are the studio's own, kept in Settings, which keeps a typo from quietly becoming
 * a second account.
 *
 * Projects and shoots carry the details the form fills in from them, so choosing one costs no
 * further request. Both are the most recent `LOOKUP_LIMIT`, the same cut Client Storage's shoot
 * picker takes, and the dropdowns search within that.
 */
async function options(req, res) {
  try {
    const [employees, accounts, projects, shoots] = await Promise.all([
      prisma.employee.findMany({
        where: { archivedAt: null, employmentStatus: { in: await workingEmployeeStatuses() } },
        orderBy: { employeeName: "asc" },
        select: { id: true, employeeId: true, employeeName: true, department: true, designation: true },
      }),
      prisma.bankAccount.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { name: true } }),
      // Every project, whoever they belong to. A picker exists to link one record to another, and
      // the person booking a cash entry against a wedding is often not on that wedding - narrowing
      // it offers them nothing to file against. What is narrowed is the list of entries itself.
      prisma.salesProject.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: LOOKUP_LIMIT,
        select: projectSelect,
      }),
      prisma.projectShoot.findMany({
        where: { deletedAt: null },
        orderBy: { dateCreated: "desc" },
        take: LOOKUP_LIMIT,
        select: { id: true, shootId: true, shoot: true, dateCreated: true, shootPlace: true, district: true, state: true, project: { select: projectSelect } },
      }),
    ]);
    const names = await projectClientNames([...projects, ...shoots.map((shoot) => shoot.project)]);
    return res.json({
      data: {
        employees,
        // One list for both directions: an account the studio owns is the same account whether
        // money landed in it or left it.
        accounts: accounts.map((account) => account.name),
        projects: projects.map((project) => toProjectOption(project, names)),
        shoots: shoots.map((shoot) => ({
          id: shoot.id,
          shootId: shoot.shootId,
          shoot: shoot.shoot,
          dateCreated: shoot.dateCreated,
          place: [shoot.shootPlace, shoot.district, shoot.state].filter(Boolean).join(", "),
          project: toProjectOption(shoot.project, names),
        })),
        entryTypes: ENTRY_TYPES,
        categoriesByType: CATEGORIES_BY_TYPE,
        paymentModes: await paymentModes(),
      },
    });
  } catch (error) { return handleCashEntryError(res, error, "Unable to load accounts options"); }
}

/**
 * Validates and writes one cash entry, uploads and all.
 *
 * Split out of the route handler so that approving a payment request can record the entry it pays
 * for under exactly these rules — the same validation, the same identifier counter, the same
 * direction-only fields dropped — rather than growing a second copy of them that drifts. `client`
 * takes the caller's transaction so the entry and whatever the caller writes alongside it either
 * both land or neither does. `schema` is the one thing the two callers differ on: a form must name
 * the project the branch is read from, an approval cannot always.
 */
async function recordCashEntry(body, actorId, client = prisma, { enforceBranchReach = false, schema = entrySchema } = {}) {
  // Async because the payment-mode rules ask the list: which modes exist, and which of them ask
  // for a reference, an account or a line saying what the payment actually was.
  const parsed = await schema.safeParseAsync(body);
  // Carries the field errors so a caller answering an HTTP request still replies in the shape it
  // always did, rather than flattening a per-field failure into one sentence.
  if (!parsed.success) throw Object.assign(new Error("Validation failed"), { status: 400, fieldErrors: parsed.error.flatten() });
  const data = await entryData(parsed.data);
  // The branch is the project's, not a name anybody typed, so it is checked against the branches
  // this person's roles reach only once it has been worked out. Not applied when an approval writes
  // the entry: that entry's branch is the one on the request being approved, which was itself
  // checked when it was raised.
  if (enforceBranchReach && !(await iamService.canUseBranchName(actorId, data.branch, CASH_MANAGEMENT))) {
    throw Object.assign(new Error("You cannot record an entry against that branch."), { status: 403 });
  }
  const { proof, uploads } = await attachProof(parsed.data.paymentProof, null, actorId);
  try {
    return await client.cashEntry.create({
      data: {
        ...data,
        ...(await branchReference(data.branch)),
        paymentProof: proof,
        entryId: await nextEntryId(
          parsed.data.entryType,
          { branch: data.branch, vertical: await verticalForEntry(data.projectId, client) },
          client,
        ),
        createdBy: actorId,
        updatedBy: actorId,
      },
      include,
    });
  } catch (error) {
    // The entry was never written, so the files it uploaded have nothing to belong to.
    await discardUploads(uploads);
    throw error;
  }
}

/*
 * ── Importing cash entries from a spreadsheet ─────────────────────────────────────────────────
 *
 * The columns a cash book actually has. Two of them need saying:
 *
 *   * **Branch** is required here and is asked for by no form. An entry's branch is normally the
 *     Source Branch of the project it is filed against, and a spreadsheet does not carry a project's
 *     database id - so an imported entry names its branch directly. `linkFields` already accepts
 *     that as the way in for a writer with no project to read one from.
 *   * **Handled By** is a person's name. The form picks an employee from a list; a spreadsheet
 *     writes a name, so it is matched to one active employee where exactly one matches and recorded
 *     as somebody outside the staff list where none does.
 */
const CASH_ENTRY_IMPORT_COLUMNS = [
  { field: "entryType", label: "Entry Type", required: true },
  { field: "entryDate", label: "Entry Date", required: true },
  { field: "category", label: "Category", required: true },
  { field: "amount", label: "Amount", required: true },
  { field: "branch", label: "Branch", required: true },
  { field: "paymentMode", label: "Payment Mode", required: true },
  { field: "clientName", label: "Client Name" },
  { field: "paidTo", label: "Paid To" },
  { field: "transactionId", label: "Transaction ID" },
  { field: "paymentModeOther", label: "Payment Mode Details" },
  { field: "receivedAccount", label: "Received Account" },
  { field: "paidFromAccount", label: "Paid From Account" },
  { field: "handlerName", label: "Handled By" },
  { field: "description", label: "Description" },
];

/**
 * The handler a row names, as an employee where one can be identified.
 *
 * Exactly one match, or none: two people of the same name is not something an importer may pick
 * between, so it records the name as written and marks it as somebody outside the staff list -
 * which is what the form's own "Other" does and is correctable afterwards.
 */
async function resolveImportHandler(handlerName) {
  const name = String(handlerName || "").trim();
  if (!name) return { handlerName: "", handlerIsOther: true };
  const matches = await prisma.employee.findMany({
    where: { employeeName: name, employmentStatus: { in: await workingEmployeeStatuses() } },
    select: { id: true, employeeName: true },
    take: 2,
  });
  if (matches.length === 1) return { handlerEmployeeId: matches[0].id, handlerName: matches[0].employeeName, handlerIsOther: false };
  return { handlerName: name, handlerIsOther: true };
}

async function importTemplate(req, res) {
  return res.json({ data: { columns: templateHeaders(CASH_ENTRY_IMPORT_COLUMNS) } });
}

async function importEntries(req, res) {
  const actorId = Number(req.user.id);
  try {
    const data = await importTableRows({
      headers: req.body?.headers,
      rows: req.body?.rows,
      startRow: Number(req.body?.startRow) || 2,
      columns: CASH_ENTRY_IMPORT_COLUMNS,
      // Validated here so a refusal names the column the studio is looking at; `recordCashEntry`
      // validates again on its own terms, which is what keeps an imported entry identical to a
      // typed one - same identifier counter, same branch check, same links.
      schema: entrySchema,
      create: async (input) => {
        await recordCashEntry(
          { ...input, ...(await resolveImportHandler(input.handlerName)) },
          actorId,
          prisma,
          // The person's own branch reach, row by row: an import must not be a way to file an entry
          // against a branch this person could not choose on the form.
          { enforceBranchReach: true },
        );
      },
    });
    return res.json({ data });
  } catch (error) {
    if (error?.status === 400) return res.status(400).json({ message: error.message });
    return handleCashEntryError(res, error, "Unable to import cash entries");
  }
}

async function createEntry(req, res) {
  try {
    const actorId = Number(req.user.id) || null;
    const created = await prisma.$transaction((tx) => recordCashEntry(req.body, actorId, tx, { enforceBranchReach: true, schema: formEntrySchema }));
    /*
     * The receipt to send the client, filled in and handed back with the entry.
     *
     * Built here rather than by the screen because the outstanding balance is the project's whole
     * ledger - the quotation, its approved extras and every receipt against it - and because the
     * wording is a settings row the accounts screen would otherwise have to fetch under a
     * permission it does not hold. Money spent gets none; so does a studio that has deleted the
     * template, and the screen then shows nothing rather than a message full of placeholders.
     *
     * Outside the transaction, and never fatal: the entry is recorded either way, and a receipt
     * that cannot be built must not turn a saved payment into an error.
     */
    let receiptMessage = null;
    try {
      receiptMessage = await receiptMessageFor(await entryForReceipt(created.id));
    } catch (messageError) {
      console.error("Unable to build the receipt message for this cash entry:", messageError.message);
    }
    return res.status(201).json({ data: toRow(created), receiptMessage });
  } catch (error) { return handleCashEntryError(res, error, "Unable to record this cash entry"); }
}

/** The saved entry with the shoot and project the receipt names, read back once for the message. */
const entryForReceipt = (id) => prisma.cashEntry.findUnique({
  where: { id },
  include: { shoot: { select: { shoot: true } }, project: { select: { eventId: true } } },
});

/**
 * An entry keeps the direction it was recorded in. Its identifier carries that direction and its
 * counter has already moved on, so turning a receipt into a payment is a new entry and a withdrawal
 * of the old one, not an edit.
 */
async function updateEntry(req, res) {
  const id = parseId(req, res);
  if (!id) return;
  const parsed = await formEntrySchema.safeParseAsync(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const existing = await scopedEntry(req, id, { id: true, entryType: true, paymentProof: true });
    if (!existing) return res.status(404).json({ message: "Cash entry not found" });
    if (existing.entryType !== parsed.data.entryType) {
      return res.status(400).json({ message: "An entry cannot change direction. Remove it and record a new one." });
    }
    const actorId = Number(req.user.id) || null;
    const data = await entryData(parsed.data);
    // Checked on the branch the chosen project puts the entry in, which is what re-filing it against
    // a different project can move — the field it used to be checked on is no longer asked for.
    if (!(await iamService.canUseBranchName(actorId, data.branch, CASH_MANAGEMENT))) {
      return res.status(403).json({ message: "You cannot record an entry against that branch." });
    }
    const { proof, uploads } = await attachProof(parsed.data.paymentProof, existing.paymentProof, actorId);
    let updated;
    try {
      updated = await prisma.cashEntry.update({
        where: { id },
        data: { ...data, ...(await branchReference(data.branch)), paymentProof: proof, updatedBy: actorId },
        include,
      });
    } catch (error) {
      await discardUploads(uploads);
      throw error;
    }
    // Only once the row is written: until then the dropped files are still what the entry shows.
    await removeDroppedFiles(existing.paymentProof, proof);
    return res.json({ data: toRow(updated) });
  } catch (error) { return handleCashEntryError(res, error, "Unable to update this cash entry"); }
}

/** Withdrawn rather than erased, so an entry made by mistake still leaves a trail. */
/**
 * Removing one entry, as the route and the bulk delete both do it.
 *
 * `scopedEntry` is the part that matters here: it is what decides the entry is this caller's to
 * touch, so an id arriving in the body of a bulk request is narrowed exactly as one in the URL is.
 * Throws rather than answering, so the bulk runner can count it.
 */
async function deleteEntryRecord(req, id) {
  const parsed = Number.parseInt(id, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("That is not a valid cash entry id.");
  const existing = await scopedEntry(req, parsed, { id: true });
  if (!existing) throw new Error("Cash entry not found");
  await prisma.cashEntry.update({ where: { id: parsed }, data: { deletedAt: new Date(), updatedBy: Number(req.user.id) || null } });
  return { id: parsed };
}

async function deleteEntry(req, res) {
  const id = parseId(req, res);
  if (!id) return;
  try {
    const existing = await scopedEntry(req, id, { id: true });
    if (!existing) return res.status(404).json({ message: "Cash entry not found" });
    await prisma.cashEntry.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: Number(req.user.id) || null } });
    return res.status(204).send();
  } catch (error) { return handleCashEntryError(res, error, "Unable to remove this cash entry"); }
}

module.exports = {
  // Exported so a test names the same columns the screen does, rather than a copy that can drift.
  CASH_SCOPE_COLUMNS,
  listEntries,
  getEntry,
  options,
  createEntry,
  importTemplate,
  importEntries,
  updateEntry,
  deleteEntry,
  deleteEntryRecord,
  ENTRY_TYPES,
  CATEGORIES_BY_TYPE,
  PAYMENT_MODES,
  MODES_WITH_TRANSACTION_ID,
  MODES_WITH_ACCOUNT,
  recordCashEntry,
  formEntrySchema,
  // Exported so the project advance answers a refused entry the same way this screen does -
  // `fieldErrors` before `status`, or the field that was wrong is never named.
  handleError: handleCashEntryError,
  toRow,
};
