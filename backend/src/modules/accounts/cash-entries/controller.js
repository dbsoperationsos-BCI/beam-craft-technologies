const { withUserNames } = require("../../../services/userNames");
const { z } = require("zod");
const { paymentModes, modesWithTransactionId, modesWithAccount, modesWithDetails, FALLBACK_MODES, FALLBACK_MODES_WITH_TRANSACTION_ID, FALLBACK_MODES_WITH_ACCOUNT } = require("../../../services/paymentOptionLists");
const { workingEmployeeStatuses, listPhotoUrl } = require("../../../services/employeeOptionLists");
const prisma = require("../../../config/db");
const { attachFiles, removeDroppedFiles, fileUrls, discardUploads } = require("../../../services/uploadMetadata");
const { receiptMessageFor } = require("./receiptMessage");
const { ensureInvoiceToken, entryByInvoiceToken, invoiceUrl, TOKEN_PATTERN } = require("./invoiceLink");
const { resolveProjectGroup, sendToProjectGroup } = require("../../sales/crd-documents/groupSend");
const { receiptFor } = require("./receipt");
const { renderReceiptPdf } = require("../../../services/paymentReceiptPdf");
const { projectClientNames, clientNameOf } = require("../../../services/projectClientNames");
const iamService = require("../../../services/iam.service");
const clientPush = require("../../../services/clientPush");

/*
 * The permission a branch on a cash entry is measured against.
 *
 * Branch reach is per-permission: somebody may reach every branch for leads through one role and one
 * branch for the cash book through another, so the check has to name which of the two it means.
 */
const CASH_MANAGEMENT = { module: "ACCOUNTS", feature: "Cash Management", level: "READ_WRITE" };
const dataScope = require("../../../services/dataScope.service");
const { projectAccessWhere, readableProject } = require("../../../services/projectScope");
const { lookups: referenceLookups } = require("../../../services/referenceMatchers");
const { nextIdentifier } = require("../../../services/identifiers");
const { everyChunk } = require("../../../services/wordChunks");
const { PICKER_PAGE, searchPicker } = require("../../../services/pickerSearch");
// An entry against a project in the Recycling Bin is kept - it is money that happened - but not listed.
const { liveProjectWhere } = require("../../../services/projectScope");
const { importTableRows, templateHeaders } = require("../../../services/tableImport");
const { receivedIntoOptions, accountsByBranch } = require("../../../services/branchBankAccounts");
const { parseDate: parseStatementDate } = require("../statement-import/parser");

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

/*
 * The third kind, **Transfer**, is the studio's own money moving from one branch's account to
 * another's. It is one entry, not a Spent and a Received: it is filed in the books of the branch the
 * money left (`branch`, as every entry is) and names the branch it landed in (`toBranchId`), with
 * the account it left (`paidFromAccount`) and the account it reached (`receivedAccount`). It has no
 * project, shoot or client, and it is neither income nor spend.
 */
const ENTRY_TYPES = ["Received", "Spent", "Transfer"];
/** Where an entry came from - the Source column. */
const ENTRY_SOURCES = ["Manual", "CSV Import", "PDF Import"];
const RECEIVED_CATEGORIES = ["Advance", "Partial Payment", "Extras", "Final Settlement", "Advance Settlement"];
/** Placeholder until Accounts settles its own spend list; changing this array is the whole change. */
const SPENT_CATEGORIES = ["Vendor Payment", "Freelancer Payment", "Salary Advance", "Employee Expense", "Travel", "Equipment", "Office Expense", "Client Refund", "Other"];
const TRANSFER_CATEGORIES = ["Branch Transfer"];
const CATEGORIES_BY_TYPE = { Received: RECEIVED_CATEGORIES, Spent: SPENT_CATEGORIES, Transfer: TRANSFER_CATEGORIES };
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
const SCHEME_BY_TYPE = { Received: "CASH_RECEIVED", Spent: "CASH_SPENT", Transfer: "CASH_TRANSFER" };
// The employment statuses that count as working here, read off the status list the studio
// maintains in Settings → Field Settings rather than written out again. See
// `services/employeeOptionLists`.
/** How many projects and shoots the form's pickers are given, most recent first. */
/** Where the receipts live in the bucket, under the module that owns them like every other folder. */
const PROOF_FOLDER = "accounts/cash-entries/proof";
const MAX_PROOF_FILES = 5;

const optionalText = (max) => z.string().trim().max(max).nullable().optional();

const entryFields = z.object({
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
  // A branch transfer's two ends, picked on the form. Ignored on every other entry.
  fromBranchId: z.coerce.number().int().positive().nullable().optional(),
  toBranchId: z.coerce.number().int().positive().nullable().optional(),
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
});

/**
 * The rules across fields, shared by every writer.
 *
 * `referencesOptional` is the cash-book import's: a spreadsheet row is history being brought in, and
 * an old cash book often has no transaction ID, no account and no remark against a payment that
 * plainly happened. The form asks for them because the person typing has the payment in front of
 * them; an import keeps the row and leaves those three empty rather than refusing it.
 *
 * `spentPartiesOptional` is the import's too, for money out: an old cash book's expense line often
 * says neither whom it was paid to nor who in the studio paid it, and the import keeps it with both
 * left empty. Money received still names who took it.
 */
const entryRules = ({ referencesOptional = false, spentPartiesOptional = false, transfers = true } = {}) => async (value, context) => {
  const issue = (path, message) => context.addIssue({ code: "custom", path: [path], message });
  // Which modes ask for what is the list's own answer now, not three arrays written out here.
  const [withTransactionId, withAccount, withDetails] = await Promise.all([
    modesWithTransactionId(), modesWithAccount(), modesWithDetails(),
  ]);

  if (!(CATEGORIES_BY_TYPE[value.entryType] || []).includes(value.category)) {
    issue("category", `That category does not belong to a ${value.entryType.toLowerCase()} entry`);
  }
  /*
   * The **remark on the payment mode**, which is what `paymentModeOther` holds and what the form now
   * calls it. A mode the studio marked as asking for one is a mode that says nothing by itself -
   * "Other" - so the entry has to say what it actually was. Which modes those are is the list's own
   * answer, not a set written out here.
   *
   * Not the entry's description: that is about the payment as a whole and stays optional. This one
   * is about the mode alone, and is the only mandatory note on a cash entry.
   */
  if (!referencesOptional && withDetails.includes(value.paymentMode) && !value.paymentModeOther) {
    issue("paymentModeOther", "Add a remark for this payment mode");
  }
  if (!referencesOptional && withTransactionId.includes(value.paymentMode) && !value.transactionId) {
    issue("transactionId", value.paymentMode === "UPI" ? "Enter the UPI transaction ID" : `Enter the ${value.paymentMode} reference number`);
  }
  const transfer = value.entryType === "Transfer";
  // A cash book's spreadsheet has no From Branch or To Branch column, so a transfer is refused as
  // a row rather than asked for fields the template cannot carry.
  if (transfer && !transfers) {
    issue("entryType", "A branch transfer cannot be imported. Record it from Add Entry.");
    return;
  }
  if (transfer) {
    if (!value.fromBranchId) issue("fromBranchId", "Choose the branch the money left");
    if (!value.toBranchId) issue("toBranchId", "Choose the branch the money went to");
    if (value.fromBranchId && value.fromBranchId === value.toBranchId) issue("toBranchId", "A transfer goes to a different branch");
  }
  // Only the modes that move money through an account are asked for one; cash is asked for none. A
  // transfer is asked for both ends.
  if (!referencesOptional && withAccount.includes(value.paymentMode)) {
    if ((value.entryType === "Received" || transfer) && !value.receivedAccount) issue("receivedAccount", "Enter the account the money went into");
    if ((value.entryType === "Spent" || transfer) && !value.paidFromAccount) issue("paidFromAccount", "Enter the account the money was paid from");
  }
  if (value.entryType === "Spent" && !value.paidTo && !spentPartiesOptional) {
    issue("paidTo", "Enter who the payment went to");
  }
  /*
   * **Asked of everything except money received through a mode that carries a remark.**
   *
   * Which is "Other" out of the box: a payment that arrived by some arrangement the list does not
   * name, where the remark above says what actually happened and the person filing it is the person
   * it happened to - so naming a receiver asked the form to repeat what the login already says, on
   * the form that books a project. Nothing is stored in its place, nobody having been asked.
   *
   * Every other mode asks as it always did, in both directions: money received by cash, UPI or a
   * transfer still names who took it, and the studio's money leaving through somebody's hands - a
   * thing to be accountable for - always names them.
   */
  const asksHandler = !(value.entryType === "Received" && withDetails.includes(value.paymentMode))
    && !(value.entryType === "Spent" && spentPartiesOptional);
  if (asksHandler) {
    const received = value.entryType === "Received";
    const who = received ? "received the money" : transfer ? "made the transfer" : "paid the money out";
    if (value.handlerIsOther && !value.handlerName) issue("handlerName", `Enter who ${who}`);
    if (!value.handlerIsOther && !value.handlerEmployeeId) issue("handlerEmployeeId", `Choose the employee who ${who}`);
  }
};

const entrySchema = entryFields.superRefine(entryRules());
/**
 * The import's: the transaction ID, the account and the mode's remark may be left empty, and so may
 * money out's Paid To and Handled By.
 */
const importEntrySchema = entryFields.superRefine(entryRules({ referencesOptional: true, spentPartiesOptional: true, transfers: false }));

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

/*
 * "Settles payment" on a receipt: which of the project's scheduled payments it is, and whether it is
 * all of what is pending (FULL) or part of it, the rest due on `pendingDueDate` (PARTIAL). Read by
 * `scheduled-payments/service.js` `settleInTx`, required when needed because that module requires
 * this one.
 */
const settlesSchema = z.object({
  paymentScheduleId: z.string().trim().min(1, "Choose the scheduled payment this settles.").max(64),
  mode: z.enum(["FULL", "PARTIAL"], { error: "Choose Full or Partial payment." }),
  pendingDueDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date the rest is due.").optional().nullable(),
}).superRefine((value, context) => {
  if (value.mode === "PARTIAL" && !value.pendingDueDate) context.addIssue({ code: "custom", path: ["pendingDueDate"], message: "Choose the date the rest is due." });
});
const scheduledPayments = () => require("../scheduled-payments/service");

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

/*
 * The form's project and shoot pickers, **searched on the server**.
 *
 * `options` carried every live project and shoot capped at 200, and the picker filtered
 * that list in the browser - so the cap was not a page but the limit of what an entry could be filed
 * against, and ordered newest-first what it dropped was the oldest. This file already worked around
 * it: `CashEntryFormPanel` puts an edited entry's own project and shoot back at the top of the list
 * "because the server offers the most recent only". That workaround is the bug written down - it
 * rescues the one record the form was opened on and nothing else, so an entry could be *read* against
 * an old project but never *filed* against one.
 *
 * 200 of 640 projects and 200 of 986 shoots on the development database. See
 * `services/pickerSearch.js` for the shape and why.
 *
 * Unlike the payment request's, the **shoot** search here takes a `projectId`: this form asks for the
 * project first and narrows the shoots to it, which is the form's own design and not a cap.
 */
async function searchProjectOptions(req, res) {
  try {
    const { rows, total, capped } = await searchPicker(prisma.salesProject, {
      search: String(req.query.search || "").trim(),
      where: { deletedAt: null },
      // The Event ID and the group name, which is what the "client name" on screen already is
      // (`projectClientNames`): there is no separate column to search.
      chunkIn: (chunk) => [{ eventId: { contains: chunk } }, { whatsappGroupName: { contains: chunk } }],
      orderBy: [{ createdAt: "desc" }],
      select: projectSelect,
    });
    const names = await projectClientNames(rows);
    return res.json({ data: { projects: rows.map((project) => toProjectOption(project, names)), total, capped } });
  } catch (error) { return handleCashEntryError(res, error, "Unable to search projects"); }
}

async function searchShootOptions(req, res) {
  const projectId = String(req.query.projectId || "").trim();
  try {
    const { rows, total, capped } = await searchPicker(prisma.projectShoot, {
      search: String(req.query.search || "").trim(),
      where: { deletedAt: null, project: { deletedAt: null }, ...(projectId ? { projectId } : {}) },
      chunkIn: (chunk) => [
        { shootId: { contains: chunk } },
        { shoot: { contains: chunk } },
        { shootPlace: { contains: chunk } },
        { project: { eventId: { contains: chunk } } },
        { project: { whatsappGroupName: { contains: chunk } } },
      ],
      orderBy: [{ dateCreated: "desc" }, { shootId: "desc" }],
      select: { id: true, shootId: true, shoot: true, dateCreated: true, shootPlace: true, district: true, state: true, project: { select: projectSelect } },
    });
    const names = await projectClientNames(rows.map((shoot) => shoot.project));
    return res.json({
      data: {
        shoots: rows.map((shoot) => ({
          id: shoot.id,
          shootId: shoot.shootId,
          shoot: shoot.shoot,
          dateCreated: shoot.dateCreated,
          place: [shoot.shootPlace, shoot.district, shoot.state].filter(Boolean).join(", "),
          project: toProjectOption(shoot.project, names),
        })),
        total,
        capped,
      },
    });
  } catch (error) { return handleCashEntryError(res, error, "Unable to search shoots"); }
}

const include = {
  toBranch: { select: { id: true, name: true } },
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
  // The invoice token is the client's credential to their invoice: handed out by Share invoice
  // (Read / Write) as a link, and never in a row a Read-only viewer is sent.
  const { invoiceToken: _invoiceToken, ...fields } = entry;
  return {
    ...fields,
    amount,
    // A transfer moves money between the studio's own branches, so it adds nothing to either total.
    signedAmount: amount === null ? null : (entry.entryType === "Spent" ? -amount : entry.entryType === "Transfer" ? 0 : amount),
    // Read through the link: a transfer keeps no text copy of where the money went.
    toBranchName: entry.toBranch?.name || "",
    // A received entry names nobody, so there is no code and no em dash standing in for one: the
    // em dash belongs to a handler who is off the payroll, which is a different answer from "none".
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
  /*
   * Money in **may** name nobody - a payment received through a mode that carries a remark is not
   * asked - and then there is nothing to resolve and nothing to store: not an empty string, which
   * would read as a receiver called "", and not the person filing it, which would be this table
   * answering a question it was not asked.
   *
   * **No keys at all, rather than explicit nulls.** This runs on the way into an update as well as a
   * create, and the form no longer sends a handler - so nulls here were written straight over the
   * receiver an older receipt already held, losing it the first time anybody corrected an amount on
   * it. Omitting the keys leaves those columns exactly as they are; on a create there is nothing to
   * leave, so the row is written with the null the column allows and `handlerIsOther` false by
   * default. Nothing else in `entryData` is conditional in this way, which is why it is said here.
   *
   * Only where nothing was given, though, rather than for every received entry. An approved payment
   * request can file money *in* - a settlement where the studio spent less than it advanced, so the
   * balance comes back - and it names who took it. Refusing to store what that path supplies would
   * throw away the one receiver still being recorded, for a form rule it is not subject to. "Named
   * by hand with no name" counts as nothing given: it would otherwise store a handler marked as
   * being off the payroll whom nobody named, which reads as an em dash where a person should be.
   */
  /*
   * And money out imported from a cash book that never said who paid it - the one way a spent entry
   * reaches here with nobody named, the form and the schema asking for them everywhere else. Without
   * this, an absent id went to `findFirst` as `id: undefined`, which matches the **first employee in
   * the table**: somebody nobody named would have been recorded as having paid the money out.
   */
  if (!input.handlerEmployeeId && !input.handlerName) {
    return {};
  }
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
  if (input.entryType === "Transfer") return transferFields(input);
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
    return { projectId, shootId, clientName, branch, toBranchId: null };
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

/**
 * What a branch transfer is filed under: the branch the money left, whose books it lands in, and the
 * branch it went to. Both must be open branches; who may use them is checked by the writer, as the
 * branch of every other entry is. No project, shoot or client - a transfer is the studio's own money.
 */
async function transferFields(input) {
  const branches = await prisma.branch.findMany({
    where: { id: { in: [input.fromBranchId, input.toBranchId] }, isActive: true },
    select: { id: true, name: true },
  });
  const from = branches.find((branch) => branch.id === input.fromBranchId);
  const to = branches.find((branch) => branch.id === input.toBranchId);
  if (!from) throw badRequest("Select a valid branch the money left");
  if (!to) throw badRequest("Select a valid branch the money went to");
  // Each end's account must be one its own branch holds - the form offers no other, and the body is
  // not trusted to have kept to it. Only checked where one was sent: cash names no account.
  const accounts = new Map((await accountsByBranch()).map((branch) => [branch.id, branch.accounts]));
  if (input.paidFromAccount && !(accounts.get(from.id) || []).includes(input.paidFromAccount)) {
    throw badRequest(`Choose an account of ${from.name} for the account the money left`);
  }
  if (input.receivedAccount && !(accounts.get(to.id) || []).includes(input.receivedAccount)) {
    throw badRequest(`Choose an account of ${to.name} for the account the money went into`);
  }
  // The id is the one picked, written as it is rather than matched back from the name.
  return { projectId: null, shootId: null, clientName: null, branch: from.name, branchId: from.id, toBranchId: to.id };
}

async function entryData(input) {
  const isReceived = input.entryType === "Received";
  const isTransfer = input.entryType === "Transfer";
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
    // A transfer carries both ends; money in only where it landed, money out only where it left.
    receivedAccount: (isReceived || isTransfer) && carriesAccount ? input.receivedAccount : null,
    paidFromAccount: !isReceived && carriesAccount ? input.paidFromAccount : null,
    paidTo: isReceived || isTransfer ? null : input.paidTo,
    description: input.description ?? null,
    ...(await handlerFields(input)),
  };
}

/**
 * Whether the caller reaches every branch the entry names, for the cash book: its own branch, and on
 * a transfer the branch the money went to as well. A transfer moves money into another branch's
 * account, so it is not somebody's to record who could not record an entry there.
 */
async function canUseEntryBranches(actorId, data) {
  // A transfer's own branch was picked by id, so it is checked by id; everything else by its name.
  const ownBranch = data.branchId
    ? await iamService.canUseBranchId(actorId, data.branchId, CASH_MANAGEMENT)
    : await iamService.canUseBranchName(actorId, data.branch, CASH_MANAGEMENT);
  if (!ownBranch) return false;
  return !data.toBranchId || iamService.canUseBranchId(actorId, data.toBranchId, CASH_MANAGEMENT);
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

/**
 * One live entry the request may see, or null - out of scope reads as not found.
 *
 * `throughProject`: also an entry filed against a project the caller sees on their board, whoever
 * recorded it and whatever its branch. Somebody who holds Cash Management works a project's whole
 * Payments tab - view, receipt, edit, share - not only the payments their own scope would list.
 * Delete does not ask for it, and neither does the Accounts Manager list.
 */
async function scopedEntry(req, id, select, { throughProject = false } = {}) {
  const [scope, entry] = await Promise.all([
    cashScope(req),
    prisma.cashEntry.findFirst({ where: { id, deletedAt: null, AND: [liveProjectWhere({ shoot: "shoot" })] }, ...(select ? { select: { ...select, branchId: true, handlerEmployeeId: true, createdBy: true, projectId: true } } : { include }) }),
  ]);
  if (!entry) return null;
  if (scope.allows(entry)) return entry;
  return throughProject && (await onVisibleProject(req, entry.projectId)) ? entry : null;
}

/**
 * Whether the caller may settle `projectId`'s scheduled payments: a project Cash Management reaches
 * for writing - what the Due tabs' Clear asks - or one on their board, as the Payments tab works it.
 */
async function maySettleFor(req, projectId) {
  if (!projectId) return false;
  const reached = await prisma.salesProject.findFirst({
    where: { id: String(projectId), deletedAt: null, AND: [await projectAccessWhere({ userId: Number(req.user.id), permissions: req.permission, forWrite: true })] },
    select: { id: true },
  });
  return Boolean(reached) || onVisibleProject(req, projectId);
}

/** Whether `projectId` is a live project the caller sees on their board - the Payments tab's own rule. */
async function onVisibleProject(req, projectId) {
  return Boolean(projectId && (await readableProject({ userId: Number(req.user.id), projectId })));
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
        // Word Chunk Search: every word typed, any order - beside the scope, never replacing it.
        AND: [scope.where, liveProjectWhere({ shoot: "shoot" }), ...everyChunk(search, (chunk) => ({ OR: [
          { clientName: { contains: chunk } },
          { entryId: { contains: chunk } },
          { paidTo: { contains: chunk } },
          // Searched by the identifiers the entry was filed under, which is how Accounts finds what
          // a shoot cost or what came in against a project. The description carries the code of the
          // payment request an approval wrote the entry for, so the two can be found from each other.
          { shoot: { shootId: { contains: chunk } } },
          { project: { eventId: { contains: chunk } } },
          { description: { contains: chunk } },
        ] }))],
        ...(entryType ? { entryType } : {}),
        ...(category ? { category } : {}),
      },
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
      include,
    });
    // Who recorded and last changed each entry, by name (`services/userNames`).
    return res.json({ data: await withUserNames(data.map(toRow)) });
  } catch (error) { return handleCashEntryError(res, error, "Unable to load cash entries"); }
}

async function getEntry(req, res) {
  const id = parseId(req, res);
  if (!id) return;
  try {
    const entry = await scopedEntry(req, id, null, { throughProject: true });
    if (!entry) return res.status(404).json({ message: "Cash entry not found" });
    return res.json({ data: toRow(entry) });
  } catch (error) { return handleCashEntryError(res, error, "Unable to load this cash entry"); }
}

/**
 * One cash received entry's invoice, as a PDF - the Payments tab's download. Scoped like
 * `getEntry`, so a receipt is printed only for an entry its reader may already open; money spent has
 * none. Named by the entry's own number (RCP-000123), which is the receipt's number.
 */
async function downloadReceipt(req, res) {
  const id = parseId(req, res);
  if (!id) return;
  try {
    const entry = await scopedEntry(req, id, null, { throughProject: true });
    if (!entry) return res.status(404).json({ message: "Cash entry not found" });
    const receipt = await receiptFor(entry);
    if (!receipt) return res.status(400).json({ message: "Only money received has an invoice." });
    const pdf = await renderReceiptPdf(receipt);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Invoice-${String(entry.entryId).replace(/[^A-Za-z0-9-]/g, "")}.pdf"`);
    res.setHeader("Content-Length", pdf.length);
    return res.end(pdf);
  } catch (error) { return handleCashEntryError(res, error, "The invoice could not be prepared. Try again in a moment."); }
}

/**
 * Everything the form's dropdowns are drawn from, in one request rather than five. Money in and out
 * are not asked for a branch - their branch is the Source Branch of the project they name - so the
 * branches offered are a transfer's two ends alone.
 * The account names are the studio's own, kept in Settings, which keeps a typo from quietly becoming
 * a second account.
 *
 * Projects and shoots carry the details the form fills in from them, so choosing one costs no
 * further request. Both are a **page** - the most recent `PICKER_PAGE` - for their pickers to open
 * on; typing searches every one of them through `/projects` and `/shoots`. They used to be the most
 * recent 200 and the picker filtered within that, which made the cap the limit of what an entry
 * could be filed against rather than the limit of what it opened showing.
 */
async function options(req, res) {
  try {
    const [employees, accounts, projects, shoots, branchAccounts, reachable] = await Promise.all([
      prisma.employee.findMany({
        where: { archivedAt: null, employmentStatus: { in: await workingEmployeeStatuses() } },
        orderBy: { employeeName: "asc" },
        select: { id: true, employeeId: true, employeeName: true, department: true, designation: true, profilePhotoUrl: true },
      }),
      /*
       * The studio's accounts, from the branch register - the one place they are kept since the
       * Accounts module's own bank-account list was retired. The label is the value stored on the
       * record, so it is built in `services/branchBankAccounts.js` and nowhere else.
       */
      receivedIntoOptions(),
      // Every project, whoever they belong to. A picker exists to link one record to another, and
      // the person booking a cash entry against a wedding is often not on that wedding - narrowing
      // it offers them nothing to file against. What is narrowed is the list of entries itself.
      prisma.salesProject.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: PICKER_PAGE,
        select: projectSelect,
      }),
      prisma.projectShoot.findMany({
        where: { deletedAt: null, project: { deletedAt: null } },
        orderBy: { dateCreated: "desc" },
        take: PICKER_PAGE,
        select: { id: true, shootId: true, shoot: true, dateCreated: true, shootPlace: true, district: true, state: true, project: { select: projectSelect } },
      }),
      accountsByBranch(),
      // A transfer's two ends are picked, so they are offered from the branches this person may
      // record cash against - the same reach the save is checked on.
      iamService.reachableBranches(Number(req.user.id), CASH_MANAGEMENT),
    ]);
    const reachableIds = new Set(reachable.map((branch) => branch.id));
    const names = await projectClientNames([...projects, ...shoots.map((shoot) => shoot.project)]);
    return res.json({
      data: {
        employees: employees.map((row) => ({ ...row, profilePhotoUrl: listPhotoUrl(row.profilePhotoUrl) })),
        // One list for both directions: an account the studio owns is the same account whether
        // money landed in it or left it.
        // Already labels, built where the stored value is - see `receivedIntoOptions`.
        accounts,
        projects: projects.map((project) => toProjectOption(project, names)),
        shoots: shoots.map((shoot) => ({
          id: shoot.id,
          shootId: shoot.shootId,
          shoot: shoot.shoot,
          dateCreated: shoot.dateCreated,
          place: [shoot.shootPlace, shoot.district, shoot.state].filter(Boolean).join(", "),
          project: toProjectOption(shoot.project, names),
        })),
        // The branches a transfer can run between, each with its own accounts, so the form offers the
        // account the money left from the branch it left and the account it reached from the other.
        branches: branchAccounts.filter((branch) => reachableIds.has(branch.id)),
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
async function recordCashEntry(body, actorId, client = prisma, { enforceBranchReach = false, schema = entrySchema, source = "Manual", proof: stored } = {}) {
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
  if (enforceBranchReach && !(await canUseEntryBranches(actorId, data))) {
    throw Object.assign(new Error("You cannot record an entry against that branch."), { status: 403 });
  }
  /*
   * `stored` is a proof already uploaded by the caller, attached rather than uploaded again.
   *
   * One payment can be several entries — an approved payment request is one row per shoot it was
   * spent on — and the proof is the one payment's. Uploaded per entry, `storeImage` ran once per
   * row for the same file, and a row that then failed left the earlier rows' files in the bucket
   * with nothing pointing at them, since no database rollback reaches storage.
   */
  const { proof, uploads } = stored === undefined
    ? await attachProof(parsed.data.paymentProof, null, actorId)
    : { proof: stored, uploads: [] };
  try {
    return await client.cashEntry.create({
      data: {
        ...data,
        ...(data.branchId ? {} : await branchReference(data.branch)),
        paymentProof: proof,
        // Set by the writer, never read off the body: a form says Manual, the importers say which.
        source: ENTRY_SOURCES.includes(source) ? source : "Manual",
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
 * The columns a cash book actually has. Three of them need saying:
 *
 *   * **Client Name** is the project's WhatsApp group name, written in full, and it is what files the
 *     row against its project - see `importProjectFor`. **Event ID** says which project when two share
 *     a group name, and wins whenever it is given.
 *   * **Branch** is only for a row filed against no project (money out on general lines): a row with
 *     a project takes the project's Source Branch, as the form does.
 *   * **Handled By** is a person's name. The form picks an employee from a list; a spreadsheet
 *     writes a name, so it is matched to one active employee where exactly one matches and recorded
 *     as somebody outside the staff list where none does.
 */
const CASH_ENTRY_IMPORT_COLUMNS = [
  { field: "entryType", label: "Entry Type", required: true },
  { field: "entryDate", label: "Entry Date", required: true },
  { field: "category", label: "Category", required: true },
  { field: "amount", label: "Amount", required: true },
  { field: "branch", label: "Branch" },
  { field: "paymentMode", label: "Payment Mode", required: true },
  { field: "clientName", label: "Client Name" },
  { field: "eventId", label: "Event ID" },
  { field: "paidTo", label: "Paid To" },
  { field: "transactionId", label: "Transaction ID" },
  // Renamed to Remarks, which is what the form asks for: a remark about the payment mode, as
  // against the Description below it, which is about the payment. The old heading still reads, so a
  // spreadsheet the studio saved before the rename imports exactly as it did.
  { field: "paymentModeOther", label: "Remarks", aliases: ["Payment Mode Details"] },
  { field: "receivedAccount", label: "Received Account" },
  { field: "paidFromAccount", label: "Paid From Account" },
  { field: "handlerName", label: "Handled By" },
  { field: "description", label: "Description" },
  // Which of the project's open scheduled payments a receipt settles, by its category ("Advance"),
  // and - for part of it - the day the rest is due. Blank: the receipt is not tied to the schedule.
  { field: "scheduledPayment", label: "Scheduled Payment" },
  { field: "balanceDueDate", label: "Balance Due Date" },
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
  // Unknown rather than a handler called "" - the column says null now, and `""` never means none.
  if (!name) return { handlerEmployeeId: null, handlerName: null, handlerIsOther: false };
  const matches = await prisma.employee.findMany({
    where: { employeeName: name, employmentStatus: { in: await workingEmployeeStatuses() } },
    select: { id: true, employeeName: true },
    take: 2,
  });
  if (matches.length === 1) return { handlerEmployeeId: matches[0].id, handlerName: matches[0].employeeName, handlerIsOther: false };
  return { handlerEmployeeId: null, handlerName: name, handlerIsOther: true };
}

/** A group name compared the way people type it: case and spacing do not matter. */
const sameName = (value) => String(value || "").replace(/\s+/g, " ").trim().toUpperCase();

/** Every live project by Event ID and by WhatsApp group name, read once for an import. */
async function importProjectLookup() {
  const projects = await prisma.salesProject.findMany({
    where: { deletedAt: null },
    select: { id: true, eventId: true, whatsappGroupName: true },
  });
  const byEventId = new Map(projects.map((project) => [sameName(project.eventId), project]));
  const byName = new Map();
  for (const project of projects) {
    const key = sameName(project.whatsappGroupName);
    byName.set(key, [...(byName.get(key) || []), project]);
  }
  return { byEventId, byName };
}

/**
 * The project an imported row is filed against.
 *
 * **Event ID** first, when the row has one: it names one project and nothing else. Otherwise the
 * **Client Name**, which is the project's WhatsApp group name - the name every staff screen shows
 * for it - written in full. Exactly one project with that name files the row against it; two
 * projects sharing one name, or none having it, is not guessed at. Money in is always for a project,
 * so such a row is refused with what to put right; money out may belong to none and goes in unlinked,
 * on the Branch it names.
 */
function importProjectFor(input, { byEventId, byName }) {
  const eventId = String(input.eventId || "").trim();
  if (eventId) {
    const project = byEventId.get(sameName(eventId));
    if (!project) throw badRequest(`No project has the Event ID ${eventId}.`);
    return project;
  }
  const name = String(input.clientName || "").trim();
  const received = input.entryType === "Received";
  if (!name) {
    if (received) throw badRequest("Name the project: its WhatsApp group name in Client Name, or its Event ID.");
    return null;
  }
  const matches = byName.get(sameName(name)) || [];
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw badRequest(`"${name}" is the WhatsApp group of ${matches.length} projects (${matches.map((project) => project.eventId).join(", ")}). Add the Event ID to say which.`);
  }
  if (received) throw badRequest(`No project has the WhatsApp group "${name}". Write the group name exactly as the project shows it, or add its Event ID.`);
  return null;
}

/*
 * An imported date, read day first. A spreadsheet's "05/10/2026" is the 5th of October here; handed
 * to `Date` as it was, it was read the American way as the 10th of May, "26/10/2026" was refused,
 * and "5 Oct 2026" landed on the 4th in UTC. The PDF import's reader, which knows Indian dates, turns
 * it into a bare YYYY-MM-DD first; anything it cannot read goes through unchanged and is refused by
 * the schema as before.
 */
const importDate = (value) => parseStatementDate(String(value ?? ""))?.iso || value;

/**
 * The row as the cash entry schema reads it, with the date read day first, the Handled By name
 * already turned into the employee it names, and the Event ID kept - the schema has no Event ID of
 * its own and would drop it before the project is looked up.
 *
 * The handler has to be worked out **before** the check, not after it: the schema asks for an
 * employee or a name marked as nobody on the staff, and a row carries only the name. Checked as it
 * came, every row except one paid by "Other" was refused as naming no employee, Handled By or not.
 */
const importSchema = {
  async safeParseAsync(record) {
    const parsed = await importEntrySchema.safeParseAsync({
      ...record,
      entryDate: importDate(record.entryDate),
      ...(await resolveImportHandler(record.handlerName)),
    });
    if (!parsed.success) return parsed;
    return {
      success: true,
      data: {
        ...parsed.data,
        eventId: record.eventId || null,
        scheduledPayment: String(record.scheduledPayment || "").trim() || null,
        balanceDueDate: String(record.balanceDueDate || "").trim() ? importDate(record.balanceDueDate) : null,
      },
    };
  },
};

/**
 * The open scheduled payment an imported receipt names by its category - "Advance", "Final
 * Settlement" - the one due first where there are several (a split's remainder shares its name).
 * None open by that name is refused with the payments that are, so the row can be put right.
 */
async function importScheduledPaymentFor(project, category) {
  const open = (await scheduledPayments().projectSchedule(project.id)).filter((payment) => payment.status !== "Cleared" && payment.pending > 0);
  const named = open.filter((payment) => sameName(payment.category) === sameName(category))
    .sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));
  if (named.length) return named[0].id;
  const offered = open.map((payment) => payment.category).join(", ");
  throw badRequest(`${project.eventId} has no open scheduled payment "${category}".${offered ? ` Open: ${offered}.` : " Nothing is still to be received."}`);
}

async function importTemplate(req, res) {
  return res.json({ data: { columns: templateHeaders(CASH_ENTRY_IMPORT_COLUMNS) } });
}

async function importEntries(req, res) {
  const actorId = Number(req.user.id);
  // Read on the first row that needs it, once for the whole file.
  let projects = null;
  try {
    const data = await importTableRows({
      headers: req.body?.headers,
      rows: req.body?.rows,
      startRow: Number(req.body?.startRow) || 2,
      columns: CASH_ENTRY_IMPORT_COLUMNS,
      // Validated here so a refusal names the column the studio is looking at; `recordCashEntry`
      // validates again on its own terms, which is what keeps an imported entry identical to a
      // typed one - same identifier counter, same branch check, same links.
      schema: importSchema,
      create: async ({ eventId, scheduledPayment, balanceDueDate, ...input }) => {
        projects ||= await importProjectLookup();
        const project = importProjectFor({ ...input, eventId }, projects);
        if (scheduledPayment) {
          if (input.entryType !== "Received" || !project) throw badRequest("Only money received for a project settles a Scheduled Payment.");
          if (!(await maySettleFor(req, project.id))) throw badRequest(`${project.eventId} is not a project you can record its scheduled payments for.`);
          const paymentScheduleId = await importScheduledPaymentFor(project, scheduledPayment);
          const settles = { mode: balanceDueDate ? "PARTIAL" : "FULL", pendingDueDate: balanceDueDate, projectId: project.id };
          await prisma.$transaction((tx) => scheduledPayments().settleInTx(tx, paymentScheduleId, settles, { ...input, projectId: project.id }, actorId, { source: "CSV Import", schema: importEntrySchema }));
          return;
        }
        await recordCashEntry(
          // The project's id files it; its client and branch are then read off the project by
          // `linkFields`, exactly as for an entry made in the form.
          // The handler was worked out in `importSchema`, before the row was checked.
          { ...input, projectId: project?.id || null },
          actorId,
          prisma,
          // The person's own branch reach, row by row: an import must not be a way to file an entry
          // against a branch this person could not choose on the form.
          { enforceBranchReach: true, source: "CSV Import", schema: importEntrySchema },
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
    // A payment recorded from Import from PDF goes through this same form, and says so; nothing
    // else a body says can make an entry anything but Manual.
    const source = req.body?.source === "PDF Import" ? "PDF Import" : "Manual";
    const { settles: settlesBody, ...body } = req.body || {};
    const settles = settlesBody ? settlesSchema.safeParse(settlesBody) : null;
    if (settles && !settles.success) return validationError(res, settles.error);
    if (settles && body.entryType !== "Received") return res.status(400).json({ message: "Only money received settles a scheduled payment." });
    if (settles && !(await maySettleFor(req, body.projectId))) return res.status(404).json({ message: "That project could not be found." });
    /*
     * "Settles payment": money received against one of the project's scheduled payments goes through
     * the Due tab's own rule (`settleInTx`) - a full payment clears it, a partial one splits the rest
     * off with its due date - in the same transaction as the entry, so neither is kept without the other.
     */
    const created = await prisma.$transaction((tx) => (settles
      ? scheduledPayments().settleInTx(tx, settles.data.paymentScheduleId, { ...settles.data, projectId: body.projectId || null }, body, actorId, { schema: formEntrySchema, source })
      : recordCashEntry(body, actorId, tx, { enforceBranchReach: true, schema: formEntrySchema, source })));
    // Money received on a project: the client's phone hears of it (after the save, never holding it up).
    clientPush.notifyPaymentReceived(created);
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
    const { receiptMessage, invoiceLink } = await receiptWithLink(created.id);
    // Typed entries only: an imported statement's rows are history, not a payment just taken.
    if (source === "Manual") queueReceiptToGroup(created, receiptMessage);
    return res.status(201).json({ data: toRow(created), receiptMessage, invoiceLink });
  } catch (error) { return handleCashEntryError(res, error, "Unable to record this cash entry"); }
}

/** The saved entry with the shoot and project the receipt names, read back once for the message. */
const entryForReceipt = (id) => prisma.cashEntry.findUnique({
  where: { id },
  include: { shoot: { select: { shoot: true } }, project: { select: { eventId: true } } },
});

/**
 * The receipt for money received, with its invoice link - made now, so the message sent is the one
 * to keep. Never fatal: a receipt that cannot be built must not turn a saved payment into an error.
 */
async function receiptWithLink(entryId) {
  try {
    const token = await ensureInvoiceToken(entryId);
    const invoiceLink = token ? invoiceUrl(token) : null;
    return { receiptMessage: await receiptMessageFor(await entryForReceipt(entryId), prisma, { invoiceLink }), invoiceLink };
  } catch (messageError) {
    console.error("Unable to build the receipt message for this cash entry:", messageError.message);
    return { receiptMessage: null, invoiceLink: null };
  }
}

/**
 * Money received on a project: its receipt into the project's WhatsApp group, from Settings → Project
 * Management → Payment reminder's sender, after the save has answered. Add Entry and a scheduled
 * payment's Clear and Part payment all come here. Required here, not at the top: that module reaches
 * back into Accounts' scheduled payments, which require this file.
 */
function queueReceiptToGroup(created, receiptMessage) {
  if (!receiptMessage?.body || !created?.projectId || created.entryType !== "Received") return;
  require("../../settings/payment-reminder/receivedMessage").sendReceivedMessageLater(created.id, receiptMessage.body);
}

/** The same, building the receipt first - for a save that does not hand the receipt back. */
async function sendReceiptToGroup(created) {
  if (!created?.projectId || created.entryType !== "Received") return;
  queueReceiptToGroup(created, (await receiptWithLink(created.id)).receiptMessage);
}

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
    const existing = await scopedEntry(req, id, { id: true, entryType: true, branch: true, amount: true, paymentScheduleId: true, paymentProof: true }, { throughProject: true });
    if (!existing) return res.status(404).json({ message: "Cash entry not found" });
    if (existing.entryType !== parsed.data.entryType) {
      return res.status(400).json({ message: "An entry cannot change direction. Remove it and record a new one." });
    }
    const actorId = Number(req.user.id) || null;
    const data = await entryData(parsed.data);
    // A receipt that settled a scheduled payment keeps its amount and project: changing either would
    // undo a clear or a split behind the schedule's back. Deleting it reopens the payment instead.
    if (existing.paymentScheduleId && (Number(data.amount) !== Number(existing.amount) || data.projectId !== existing.projectId)) {
      return res.status(400).json({ message: "This payment settles a scheduled payment, so its amount and project cannot change. Delete it and record it again." });
    }
    // Checked on the branch the chosen project puts the entry in, which is what re-filing it against
    // a different project can move — the field it used to be checked on is no longer asked for.
    // A payment kept on the project it was reached through, in the branch it is already filed under,
    // stays that project's - whatever the branch. Moving it to another branch is still checked.
    const keptOnVisibleProject = existing.entryType !== "Transfer"
      && data.projectId && data.projectId === existing.projectId
      && data.branch === existing.branch
      && (await onVisibleProject(req, data.projectId));
    if (!keptOnVisibleProject && !(await canUseEntryBranches(actorId, data))) {
      return res.status(403).json({ message: "You cannot record an entry against that branch." });
    }
    const { proof, uploads } = await attachProof(parsed.data.paymentProof, existing.paymentProof, actorId);
    let updated;
    try {
      updated = await prisma.cashEntry.update({
        where: { id },
        data: { ...data, ...(data.branchId ? {} : await branchReference(data.branch)), paymentProof: proof, updatedBy: actorId },
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

/**
 * Share invoice: the receipt message for one payment received, with its client invoice link - made
 * the first time it is asked for, then the same link every time. A write, so Cash Management Read /
 * Write: it hands the invoice out of the studio.
 */
async function shareInvoice(req, res) {
  const id = parseId(req, res);
  if (!id) return;
  try {
    const entry = await scopedEntry(req, id, null, { throughProject: true });
    if (!entry) return res.status(404).json({ message: "Cash entry not found" });
    if (entry.entryType !== "Received") return res.status(400).json({ message: "Only money received has an invoice." });
    const token = await ensureInvoiceToken(entry.id);
    if (!token) return res.status(404).json({ message: "Cash entry not found" });
    const invoiceLink = invoiceUrl(token);
    const message = await receiptMessageFor(await entryForReceipt(entry.id), prisma, { invoiceLink });
    return res.json({ data: { entryId: entry.entryId, projectId: entry.projectId || null, invoiceLink, message } });
  } catch (error) { return handleCashEntryError(res, error, "Unable to prepare the invoice link."); }
}

/** The live project a payment was received for, as the group send reads it - or a 422 saying why there is none. */
async function receiptProject(req, id) {
  const entry = await scopedEntry(req, id, null, { throughProject: true });
  if (!entry) throw Object.assign(new Error("Cash entry not found"), { status: 404 });
  if (entry.entryType !== "Received") throw Object.assign(new Error("Only money received has an invoice."), { status: 400 });
  const project = entry.projectId
    ? await prisma.salesProject.findFirst({ where: { id: entry.projectId, deletedAt: null }, select: { id: true, whatsappGroupName: true } })
    : null;
  if (!project) throw Object.assign(new Error("This payment has no project, so there is no WhatsApp group to send to. Copy the message instead."), { status: 422 });
  return { entry, project };
}

/** Share invoice, before anything is sent: which WhatsApp group Send would use (`crd-documents/groupSend.js`). */
async function invoiceGroup(req, res) {
  const id = parseId(req, res);
  if (!id) return;
  try {
    const { project } = await receiptProject(req, id);
    return res.json({ data: await resolveProjectGroup(project, req.user.id) });
  } catch (error) { return handleCashEntryError(res, error, "Unable to find the project's WhatsApp group."); }
}

const groupMessageSchema = z.object({ message: z.string().trim().min(1).max(4096) });

/**
 * Share invoice → Send: the message as the dialog's box holds it, into the project's own WhatsApp
 * group from the sender's own WhatsApp - one message, sent because a person pressed Send.
 */
async function sendInvoiceToGroup(req, res) {
  const id = parseId(req, res);
  if (!id) return;
  const parsed = groupMessageSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Write the message to send.", errors: parsed.error.flatten() });
  try {
    const { entry, project } = await receiptProject(req, id);
    // What goes into the client's group is this payment's receipt: the box may be reworded, but it
    // must still carry this entry's own invoice link.
    const token = await ensureInvoiceToken(entry.id);
    if (!token || !parsed.data.message.includes(invoiceUrl(token))) return res.status(400).json({ message: "Keep this payment's invoice link in the message." });
    const result = await sendToProjectGroup(project, req.user.id, parsed.data.message, {
      purpose: { trigger: "CASH_RECEIPT_INVOICE", eventRef: `cash-receipt:${entry.id}`, logTag: "cash-receipt", what: `receipt ${entry.entryId}` },
    });
    return res.json({ data: result, message: result.groupSubject ? `Sent to the WhatsApp group "${result.groupSubject}".` : "Sent to the project's WhatsApp group." });
  } catch (error) { return handleCashEntryError(res, error, "Unable to send the receipt to the WhatsApp group."); }
}

/*
 * The client's side, unauthenticated: the token is the credential (`invoiceLink.js`). A miss is
 * marked for the public-link limiter, which counts misses only. A failure says only that it failed -
 * never the error itself, which is the server's to read in its log.
 */
function publicFailure(res, error, message) {
  console.error(`[public-invoice] ${message}`, error);
  return res.status(500).json({ message });
}

async function publicInvoice(req, res) {
  try {
    const entry = await entryByInvoiceToken(req.params.token, include);
    if (!entry) { res.locals.linkMiss = true; return res.status(404).json({ message: "Invoice not found." }); }
    const receipt = await receiptFor(entry);
    return res.json({ data: { number: receipt.payment.number, date: receipt.payment.date, amount: receipt.payment.amount, clientName: receipt.client.name, studioName: receipt.studio.name, logoUrl: receipt.studio.logoUrl } });
  } catch (error) { return publicFailure(res, error, "Unable to load this invoice."); }
}

async function publicInvoicePdf(req, res) {
  try {
    const entry = await entryByInvoiceToken(req.params.token, include);
    if (!entry) {
      res.locals.linkMiss = true;
      // The client's link now comes straight here, so a dead one goes back to the page that says so.
      if (TOKEN_PATTERN.test(String(req.params.token || "")) && req.accepts(["html", "json"]) === "html") return res.redirect(303, `${invoiceUrl(req.params.token)}?unavailable=1`);
      return res.status(404).json({ message: "Invoice not found." });
    }
    const pdf = await renderReceiptPdf(await receiptFor(entry));
    res.setHeader("Content-Type", "application/pdf");
    // Inline, so the link opens the invoice to read; the viewer's own download saves it.
    res.setHeader("Content-Disposition", `inline; filename="Invoice-${String(entry.entryId).replace(/[^A-Za-z0-9-]/g, "")}.pdf"`);
    res.setHeader("Content-Length", pdf.length);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    return res.end(pdf);
  } catch (error) { return publicFailure(res, error, "The invoice could not be prepared. Try again in a moment."); }
}

module.exports = { settlesSchema, sendReceiptToGroup, searchProjectOptions, searchShootOptions,
  // For tests: who an entry records as having handled the money is the rule this change turned on,
  // and the import columns are where one heading claimed by two columns would show up. Both are
  // exercised rather than only read - see `test/cash-entry-receiver-retired.test.js`.
  handlerFields,
  CASH_ENTRY_IMPORT_COLUMNS,
  importProjectFor,
  importDate,
  importSchema,
  // Exported so a test names the same columns the screen does, rather than a copy that can drift.
  CASH_SCOPE_COLUMNS,
  listEntries,
  getEntry,
  downloadReceipt,
  shareInvoice,
  invoiceGroup,
  sendInvoiceToGroup,
  publicInvoice,
  publicInvoicePdf,
  options,
  createEntry,
  importTemplate,
  importEntries,
  updateEntry,
  deleteEntry,
  deleteEntryRecord,
  ENTRY_TYPES,
  ENTRY_SOURCES,
  importEntrySchema,
  entrySchema,
  transferFields,
  CATEGORIES_BY_TYPE,
  PAYMENT_MODES,
  MODES_WITH_TRANSACTION_ID,
  MODES_WITH_ACCOUNT,
  recordCashEntry,
  // So a caller writing several entries for one payment stores its proof once and attaches it.
  attachProof,
  formEntrySchema,
  // Exported so the project advance answers a refused entry the same way this screen does -
  // `fieldErrors` before `status`, or the field that was wrong is never named.
  handleError: handleCashEntryError,
  toRow,
};
