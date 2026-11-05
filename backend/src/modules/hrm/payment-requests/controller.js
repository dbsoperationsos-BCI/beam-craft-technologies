const { withUserNames } = require("../../../services/userNames");
const { optionNames, nameWithFlag } = require("../../../services/optionLists");
const { z } = require("zod");
const { workingEmployeeStatuses, listPhotoUrl } = require("../../../services/employeeOptionLists");
const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const dataScope = require("../../../services/dataScope.service");
const { everyChunk } = require("../../../services/wordChunks");
const { PICKER_PAGE, searchPicker } = require("../../../services/pickerSearch");
const { lookups: referenceLookups } = require("../../../services/referenceMatchers");
const { attachFiles, removeDroppedFiles, fileUrls, discardUploads } = require("../../../services/uploadMetadata");
const { projectClientNames, clientNameOf } = require("../../../services/projectClientNames");
const { recordCashEntry, attachProof } = require("../../accounts/cash-entries/controller");
const { createAdvanceIn } = require("../payroll-advance/service");
const { openPayrollMonth } = require("../payroll-register/settingsVersions");
const { receivedIntoOptions } = require("../../../services/branchBankAccounts");
const { VENDOR_LABEL_SELECT } = require("../../../services/vendorLabel");

/**
 * Money an employee asks the studio for, and what an admin decided about it.
 *
 * Four kinds in one module because they are the same transaction wearing four labels: somebody asks
 * for an amount, an admin says yes or no, and a yes moves money. What differs is only what each kind
 * has to say for itself — a salary advance names a repayment plan, a vendor payment names the
 * vendor, the two expense kinds itemise what was or will be spent — so the schema below is one
 * object with those fields required per type rather than four near-identical schemas.
 *
 * A request is raised by whoever is signed in and can only be seen by them until it is decided;
 * an admin sees every request and is the only one who can decide. Approving writes the cash entry
 * that pays it, through the Accounts module's own recorder so the entry is validated, numbered and
 * filed by exactly the rules a hand-typed entry is.
 */

const TYPES = ["SALARY_ADVANCE", "ADVANCE_EXPENSE", "EXPENSE_SUBMISSION", "VENDOR_PAYMENT"];
/**
 * The kinds that itemise expenses. The other two ask for one amount instead: a salary advance because
 * nothing has been spent yet, a vendor payment because a bill is already one figure for one payee and
 * has no project, shoot or expense category of its own to break down by.
 */
const TYPES_WITH_EXPENSES = ["ADVANCE_EXPENSE", "EXPENSE_SUBMISSION", "VENDOR_PAYMENT"];
/** The kinds whose amount IS the total of their lines, so the server totals it rather than trusting it. */
const TYPES_WITH_COMPUTED_TOTAL = ["ADVANCE_EXPENSE", "EXPENSE_SUBMISSION", "VENDOR_PAYMENT"];
const TYPES_WITH_BILLS = ["EXPENSE_SUBMISSION", "VENDOR_PAYMENT"];
/**
 * The kinds that describe themselves in prose rather than stating a reason. A salary advance is
 * asked *why*, because the answer is the case for granting it; the other three are asked *what*,
 * because the lines already say why and what is left is the detail around them.
 */
const TYPES_WITH_DESCRIPTION = ["ADVANCE_EXPENSE", "EXPENSE_SUBMISSION", "VENDOR_PAYMENT"];

const STATUSES = ["PENDING", "APPROVED", "REJECTED"];
/*
 * How a request settles up. A list the studio maintains (Settings → Fields → Payment Requests); this
 * is what a failed or empty read falls back to.
 */
const SETTLEMENTS = ["Expense Excess", "Reimbursement needed"];
const settlementNames = () => optionNames("paymentSettlement", SETTLEMENTS);
/**
 * How a salary advance comes back. The second choice carries a month count rather than being a
 * bare "Other", so the record says what the arrangement actually is.
 */
const REPAYMENT_ONE_PAYMENT = "One Payment in Next Salary Date";
const REPAYMENT_OVER_MONTHS = "Over Several Months";
const REPAYMENT_PLANS = [REPAYMENT_ONE_PAYMENT, REPAYMENT_OVER_MONTHS];
const MAX_REPAYMENT_MONTHS = 24;
/**
 * An excess is the employee handing money back, so there is nothing to pay them and no QR code to
 * pay it to. A reimbursement is the studio paying them, which needs one.
 */
const SETTLEMENT_EXCESS = "Expense Excess";
/*
 * Which settlement that is, read off the row rather than off the spelling. `means_excess` is the
 * flag; only one settlement may carry it, and this is what the code used to compare against.
 */
const excessSettlement = () => nameWithFlag("paymentSettlement", "meansExcess", SETTLEMENT_EXCESS);
/** Placeholder until Accounts settles its own list, exactly as the cash entry spend categories are. */
const EXPENSE_TYPES = ["Travel", "Food", "Accommodation", "Fuel", "Props", "Equipment Rental", "Courier", "Printing", "Vendor Payment", "Miscellaneous"];

const SEQUENCE_BY_TYPE = {
  SALARY_ADVANCE: { key: "PAYMENT_REQUEST_SALARY_ID", prefix: "SAL" },
  ADVANCE_EXPENSE: { key: "PAYMENT_REQUEST_ADVANCE_ID", prefix: "ADV" },
  EXPENSE_SUBMISSION: { key: "PAYMENT_REQUEST_EXPENSE_ID", prefix: "EXP" },
  VENDOR_PAYMENT: { key: "PAYMENT_REQUEST_VENDOR_ID", prefix: "VND" },
};

/** Which spend an approved request lands under in the books. */
const CATEGORY_BY_TYPE = {
  SALARY_ADVANCE: "Salary Advance",
  ADVANCE_EXPENSE: "Employee Expense",
  EXPENSE_SUBMISSION: "Employee Expense",
  VENDOR_PAYMENT: "Vendor Payment",
};
/**
 * An excess coming back is a receipt, and the categories a receipt may carry are a different list
 * from the ones a payment may — so the category follows the direction, not the type alone.
 */
const RECEIVED_CATEGORY = "Advance Settlement";

const LABEL_BY_TYPE = {
  SALARY_ADVANCE: "Salary Advance",
  ADVANCE_EXPENSE: "Advance Expense",
  EXPENSE_SUBMISSION: "Expense Submission",
  VENDOR_PAYMENT: "Vendor Payment",
};

// The employment statuses that count as working here, read off the status list the studio
// maintains in Settings → Field Settings rather than written out again. See
// `services/employeeOptionLists`.
const QR_FOLDER = "hrm/payment-requests/qr";
const BILLS_FOLDER = "hrm/payment-requests/bills";
const MAX_BILLS = 10;

/**
 * Who may decide a request.
 *
 * READ_WRITE on ACCOUNTS / Payment Request — the permission this module is named after.
 * It used to be `role === "SUPER_ADMIN"`, which meant the permission could be granted and the
 * decision still refused, and nobody but the super admin could ever approve a payment. Every route
 * asks this one question rather than testing for itself.
 */
/**
 * **Who may decide a request, and who may take their own back.**
 *
 * `canDecide` is `ACCOUNTS / Payment Request Approver` - approve, reject, correct anybody's request,
 * and read the whole queue. It used to be Read / Write on `Payment Request`, the same
 * permission that lets somebody **raise** a request, so a holder could ask the studio for money and
 * allow it themselves in two clicks; the row then named one person as both who requested it and who
 * decided it, and nothing marked that as unusual.
 *
 * `ownsIt` is the requester. Their own request is theirs to **withdraw** and nothing else: correcting
 * it is the approver's, because an amount or a bill changed after the ask is what the approver is
 * being asked about.
 *
 * And an approver does **not** withdraw. Withdrawing deletes the row; rejecting records who decided
 * and why. An approver who disagrees with a request has the second of those and does not need the
 * first, and a decision that leaves no trace is not one anybody can be asked about later.
 */
const canDecide = (user) => iamService.hasPermission(user?.id, "ACCOUNTS", "Payment Request Approver", "READ_WRITE");

/** Whether this request is the caller's own - what they raised, by their employee record. */
const ownedBy = (request, user) => Boolean(request?.requestedById) && request.requestedById === Number(user?.linkedEmployeeId);

/**
 * An expense submission that came in under its advance is money coming back to the studio, not
 * going out, so approving it records a receipt rather than a payment. Every other kind pays out.
 */
const directionOf = async (request) => (request.type === "EXPENSE_SUBMISSION" && request.settlement === await excessSettlement() ? "Received" : "Spent");

/**
 * Whether the request needs a QR code to pay to. Everything the studio pays out does; an expense
 * excess does not, because the money is coming back the other way and there is nobody to pay.
 */
const takesQrCode = async (input) => !(input.type === "EXPENSE_SUBMISSION" && input.settlement === await excessSettlement());
/**
 * Whether a line is asked what the money was spent on.
 *
 * Everything that itemises, except an expense submission settling an **excess**: that is unspent
 * advance money being handed back, so there is nothing it was spent on, and asking produced a
 * category on a line that recorded a refund. An advance against expenses is still asked - what it
 * *will* be spent on is the case for granting it.
 */
const asksExpenseType = async (input) => TYPES_WITH_EXPENSES.includes(input.type) && await takesQrCode(input);

const optionalText = (max) => z.string().trim().max(max).nullable().optional();
const requiredText = (max, message) => z.string().trim().min(1, message).max(max);

const expenseSchema = z.object({
  // Only the shoot is named. Its project comes with it — the picker shows which project each shoot
  // belongs to and `resolveExpenseLinks` stores both, so nobody is asked the same thing twice.
  shootId: optionalText(191),
  expenseDate: z.coerce.date(),
  // Required of every itemising kind but an excess, and checked by the request rather than the line:
  // only the request knows which settlement it is, and an excess has nothing it was spent on.
  expenseType: optionalText(60),
  description: optionalText(2000),
  amount: z.coerce.number().positive("Enter an amount greater than zero").max(999_999_999),
});

const requestSchema = z.object({
  type: z.enum(TYPES),
  // No branch, in any case. It is not the requester's to choose: a request against a shoot belongs
  // to that shoot's branch, and one against no shoot to the branch the person raising it works out
  // of, so `resolveBranch` reads it off records that already know the answer. A branch sent in the
  // body is ignored rather than trusted.
  vendorId: z.coerce.number().int().positive("Choose the vendor").nullable().optional(),
  amount: z.coerce.number().positive("Enter an amount greater than zero").max(999_999_999).optional(),
  reason: optionalText(5000),
  comments: optionalText(5000),
  repaymentPlan: optionalText(60),
  repaymentMonths: z.coerce.number().int().positive().max(MAX_REPAYMENT_MONTHS).nullable().optional(),
  settlement: optionalText(30),
  // The date on the vendor's bill. The itemising kinds carry a date per line instead, so this is
  // required only where it is asked for, which the type check below is what says.
  expenseDate: z.coerce.date().nullable().optional(),
  qrCode: z.array(z.string().min(1)).max(1, "Attach one QR code").nullable().optional(),
  bills: z.array(z.string().min(1)).max(MAX_BILLS, `Attach at most ${MAX_BILLS} bills`).nullable().optional(),
  expenses: z.array(expenseSchema).max(50, "Add at most 50 expense lines").optional(),
// Async: the settlement is checked against the studio's own list. Every parse of this schema is a
// `safeParseAsync` accordingly.
}).superRefine(async (value, context) => {
  const issue = (path, message) => context.addIssue({ code: "custom", path: [path], message });

  if (TYPES_WITH_EXPENSES.includes(value.type) && !(value.expenses || []).length) {
    issue("expenses", "Add at least one expense line");
  }
  // Every kind but the submission states its own amount; for that one it is the total of the lines
  // and is worked out below rather than taken from the request.
  if (!TYPES_WITH_COMPUTED_TOTAL.includes(value.type) && !(value.amount > 0)) {
    issue("amount", value.type === "SALARY_ADVANCE"
      ? "Enter the advance salary amount requested"
      : value.type === "VENDOR_PAYMENT" ? "Enter the amount to be paid to the vendor" : "Enter the advance amount requested");
  }
  if (TYPES_WITH_DESCRIPTION.includes(value.type) && !value.comments) {
    issue("comments", "Enter a description of what this is for");
  }
  if (value.type === "SALARY_ADVANCE") {
    if (!value.reason) issue("reason", "Enter the reason for the salary request");
    if (!REPAYMENT_PLANS.includes(value.repaymentPlan)) issue("repaymentPlan", "Choose how the advance will be repaid");
    if (value.repaymentPlan === REPAYMENT_OVER_MONTHS && !value.repaymentMonths) {
      issue("repaymentMonths", `Enter how many months, up to ${MAX_REPAYMENT_MONTHS}`);
    }
  }

  if (value.type === "EXPENSE_SUBMISSION") {
    if (!(await settlementNames()).includes(value.settlement)) issue("settlement", "Choose whether this is an excess or a reimbursement");
  }
  // Said against the line it is missing from, since a request may hold fifty of them.
  if (await asksExpenseType(value)) {
    (value.expenses || []).forEach((line, index) => {
      if (!line.expenseType) issue("expenses", `Expense line ${index + 1}: choose what the expense was for`);
    });
  }
  if (value.type === "VENDOR_PAYMENT") {
    if (!value.vendorId) issue("vendorId", "Choose the vendor");
  }
});

/**
 * Approving is a decision and nothing else: yes, with a note if there is one to leave.
 *
 * It used to carry the payment's own fields, because approving and paying were one step. They are
 * two now - the person who authorises a spend is rarely the person who releases it - so the money
 * details moved to `paymentSchema` below, and an approval knows nothing about how the money will
 * eventually move.
 */
const approvalSchema = z.object({
  remarks: optionalText(2000),
});

/** What Accounts adds when it releases the money: how it actually moved, which the request cannot know. */
const paymentSchema = z.object({
  remarks: optionalText(2000),
  entryDate: z.coerce.date().optional(),
  paymentMode: optionalText(30),
  paymentModeOther: optionalText(120),
  transactionId: optionalText(100),
  receivedAccount: optionalText(120),
  paidFromAccount: optionalText(120),
  // Who the money went to. Derived from the request when the approver leaves it alone — the vendor
  // on a vendor payment, the requester otherwise — but editable, because the person releasing it
  // may know better than the record who actually took it.
  paidTo: optionalText(191),
  handlerEmployeeId: z.coerce.number().int().positive().nullable().optional(),
  handlerName: optionalText(191),
  handlerIsOther: z.boolean().optional(),
  // The proof of the payment being released, which belongs to the entry rather than to the request:
  // the request's bills say what was owed, this says it was paid.
  paymentProof: z.array(z.string().min(1)).max(5).nullable().optional(),
});

// Missing and empty are the same mistake to the person rejecting, so an absent remark is read as an
// empty one and answered with the message that says what to do rather than a type complaint.
const rejectSchema = z.object({
  remarks: z.preprocess((value) => value ?? "", requiredText(2000, "Enter why this request is being turned down")),
});

const listQuerySchema = z.object({
  type: z.enum(TYPES).optional(),
  status: z.enum(STATUSES).optional(),
  // Accounts Manager's queue: approved and not yet released. Asked as its own filter rather than as
  // a fourth status, because paid is the cash book's answer and not a column on the request.
  paid: z.enum(["yes", "no"]).optional(),
  search: z.string().trim().max(191).optional(),
});

/**
 * Asset Management → Vendors → Vendor Payments: every vendor's bills, by where they have got to.
 *
 * No vendor and no search: the screen reads the whole ledger and narrows it in the table, whose
 * column filters and search already answer "this vendor's bills" - a second picker above them would
 * be a second answer to the same question.
 */
const vendorPaymentsQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
});

function validationError(res, error) {
  return res.status(400).json({ message: "Validation failed", errors: error.flatten() });
}

function handleError(res, error, fallback) {
  if (error.fieldErrors) return res.status(400).json({ message: error.message, errors: error.fieldErrors });
  if (error.status) return res.status(error.status).json({ message: error.message });
  if (error.code === "P2025") return res.status(404).json({ message: "Payment request not found" });
  console.error("Payment request error:", error);
  return res.status(500).json({ message: fallback, error: error.message });
}

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const forbidden = (message) => Object.assign(new Error(message), { status: 403 });

function parseId(req, res) {
  const id = Number(req.params.id);
  if (Number.isInteger(id) && id > 0) return id;
  res.status(400).json({ message: "That is not a valid request id" });
  return null;
}

/** SAL-000001 and its three siblings, from the counter every generated identifier comes from. */
async function nextRequestCode(type, client = prisma) {
  const { key, prefix } = SEQUENCE_BY_TYPE[type];
  const row = await client.appSequence.upsert({
    where: { key },
    create: { key, currentValue: 1 },
    update: { currentValue: { increment: 1 } },
  });
  return `${prefix}-${String(row.currentValue).padStart(6, "0")}`;
}

const include = {
  expenses: {
    orderBy: { id: "asc" },
    include: {
      project: { select: { id: true, eventId: true } },
      shoot: { select: { id: true, shootId: true, shoot: true } },
    },
  },
  requestedBy: { select: { id: true, employeeId: true, employeeName: true, department: true, designation: true } },
  cashEntries: { where: { deletedAt: null }, orderBy: { entryId: "asc" }, select: { id: true, entryId: true, entryType: true, entryDate: true, shootId: true } },
};

/** Flattened for the table, which reads plain keys, with the lines and links kept for the panel. */
// Async because the direction depends on which settlement means the money comes back, which is a
// flag on the row rather than a word in the code.
async function toRow(request) {
  const expenses = (request.expenses || []).map((line) => ({
    ...line,
    amount: Number(line.amount),
    projectCode: line.project?.eventId || "General",
    shootCode: line.shoot?.shootId || "General",
    shootName: line.shoot?.shoot || "",
  }));
  return {
    ...request,
    amount: Number(request.amount),
    expenses,
    expenseCount: expenses.length,
    typeLabel: LABEL_BY_TYPE[request.type] || request.type,
    direction: await directionOf(request),
    requestedByCode: request.requestedByCode || request.requestedBy?.employeeId || "",
    requestedByDepartment: request.requestedBy?.department || "",
    // Every entry the approval wrote, in one cell: an approved request is as many rows in the books
    // as it named shoots, and naming only the first of them hid the rest from the request they came
    // from. One entry still reads as one number.
    cashEntryCode: (request.cashEntries || []).map((entry) => entry.entryId).join(", "),
    /*
     * Paid is "the cash book has it", not a status of its own.
     *
     * An approved request waiting for Accounts and one Accounts has released differ by exactly the
     * entries the release writes, so the entries are the fact and a fourth status would only be a
     * second copy of it - one that every request approved before paying was split out would have
     * needed a migration to backfill, and would have been wrong for any it missed.
     */
    paid: (request.cashEntries || []).length > 0,
    /*
     * Only ever said of an approved request. A pending one is not awaiting payment - it is awaiting
     * a decision - and a rejected one never will be, so both read as nothing rather than as a queue
     * they are not in.
     */
    paymentStatus: (request.cashEntries || []).length > 0
      ? "Paid"
      : (request.status === "APPROVED" ? "Awaiting Payment" : ""),
    qrCodeUrls: fileUrls(request.qrCode),
    billUrls: fileUrls(request.bills),
  };
}

/** The lines' own total, which is what the two settlement kinds are worth however they were typed. */
const totalOf = (expenses) => (expenses || []).reduce((sum, line) => sum + Number(line.amount || 0), 0);

/**
 * Only the lines that belong to the kind being raised, with the ones it does not ask for dropped.
 *
 * `asksType` is false on an excess, where the line keeps no expense type however one got sent: a
 * column the form does not ask for is not one a payload may fill in behind it.
 */
function expenseRows(input, asksType = true) {
  if (!TYPES_WITH_EXPENSES.includes(input.type)) return [];
  return (input.expenses || []).map((line) => ({
    // Written once. This object listed `projectId` twice and the second, always null, won — so a
    // line never kept the project it was sent with. `resolveExpenseLinks` fills it from the shoot
    // a moment later, which is why nothing looked broken, but a line naming a project and no shoot
    // lost it silently.
    projectId: line.projectId || null,
    shootId: line.shootId || null,
    expenseDate: line.expenseDate,
    // `|| null` as well as the check above: the per-line schema would let "" through on its own, and
    // the column says "nothing it was spent on" with NULL rather than with an empty string.
    expenseType: asksType ? (line.expenseType || null) : null,
    description: line.description ?? null,
    amount: Number(line.amount).toFixed(2),
  }));
}

/**
 * Resolves what each line was spent on from the shoot it names.
 *
 * Only the shoot is asked for; its project is read from the shoot itself and stored beside it, so
 * an approval can attribute a request spanning several shoots of one project to that project
 * without anyone having answered the same question twice. A line naming nothing is the "General"
 * the form offers and keeps both null.
 *
 * Every distinct shoot is looked up once for the whole request rather than once per line.
 */
async function resolveExpenseLinks(rows) {
  const shootIds = [...new Set(rows.map((line) => line.shootId).filter(Boolean))];
  if (!shootIds.length) return;

  const shoots = await prisma.projectShoot.findMany({
    where: { id: { in: shootIds }, deletedAt: null },
    select: { id: true, projectId: true },
  });
  const projectOf = new Map(shoots.map((shoot) => [shoot.id, shoot.projectId]));

  rows.forEach((line, index) => {
    if (!line.shootId) return;
    if (!projectOf.has(line.shootId)) throw badRequest(`Expense line ${index + 1}: select a valid shoot`);
    line.projectId = projectOf.get(line.shootId);
  });
}

/**
 * The branch a request belongs to, which is nobody's to choose.
 *
 * A request against a shoot belongs to that shoot's branch — the project's Source Branch, the same
 * value a cash entry filed against the shoot would carry. One against no shoot belongs to the
 * branch the person raising it works out of: their employee record's work base, and failing that
 * the branch their login is assigned to in IAM. Resolved when the request is raised so it reads on
 * the record from the start, rather than at approval when the employee may have moved.
 *
 * The form used to ask for a branch when none of these could answer. That put the one field on the
 * form nobody could get right — the value decides whose books the cash entry lands in — in front of
 * the person least placed to know it, so the field is gone and the last source below took its place.
 */
async function resolveBranch(rows, requester, actorId = null) {
  const projectId = rows.map((line) => line.projectId).find(Boolean);
  if (projectId) {
    const project = await prisma.salesProject.findFirst({ where: { id: projectId }, select: { sourceBranch: true } });
    if (project?.sourceBranch) return project.sourceBranch;
  }

  if (requester.requestedById) {
    const employee = await prisma.employee.findFirst({
      where: { id: requester.requestedById },
      select: { workBaseLocation: true, currentWorkLocation: true },
    });
    const branch = employee?.workBaseLocation || employee?.currentWorkLocation;
    if (branch) return branch;
  }

  // The login's own branch, for an account with no employee behind it or an employee whose work
  // base was never filled in. Nothing is checked against what the caller may reach: this is their
  // own assignment, read off their user record, not a branch they named.
  if (actorId !== null) {
    const account = await prisma.user.findFirst({ where: { id: actorId }, select: { branch: { select: { name: true } } } });
    if (account?.branch?.name) return account.branch.name;
  }

  // Nothing left to read. A super admin belongs to no branch, and an account can be linked to no
  // employee, so this is reachable — and a request that cannot name a branch cannot become a cash
  // entry, which is why it stops here rather than being saved without one.
  throw badRequest("No branch could be worked out for this request. Name a shoot on an expense line, or ask an administrator to set a work base location on your employee record or a branch on your user account.");
}

/**
 * The vendor being paid, read from the vendor record rather than typed, so neither can drift.
 *
 * The **id** comes back beside the two names because that is what the request is filed under: Asset
 * Management → Vendors reads a vendor's payments through `payment_request.vendor_id`, and the name
 * columns are the copies the request was raised with - a vendor renamed afterwards, or removed from
 * the register, still leaves a request that says who was paid.
 */
async function resolveVendor(vendorId) {
  if (!vendorId) return { vendorId: null, vendorName: null, vendorPhone: null };
  const vendor = await prisma.vendor.findFirst({
    where: { id: vendorId, isDeleted: false },
    select: { id: true, vendorName: true, mobileNumber: true },
  });
  if (!vendor) throw badRequest("Select a valid vendor");
  return { vendorId: vendor.id, vendorName: vendor.vendorName, vendorPhone: vendor.mobileNumber || null };
}

function requestData(input, expenses, branch, vendor) {
  const isVendor = input.type === "VENDOR_PAYMENT";
  const settles = input.type === "EXPENSE_SUBMISSION";
  return {
    type: input.type,
    branch,
    amount: (TYPES_WITH_COMPUTED_TOTAL.includes(input.type) ? totalOf(expenses) : input.amount).toFixed(2),
    reason: input.type === "SALARY_ADVANCE" ? input.reason ?? null : null,
    comments: TYPES_WITH_DESCRIPTION.includes(input.type) ? input.comments ?? null : null,
    repaymentPlan: input.type === "SALARY_ADVANCE" ? input.repaymentPlan ?? null : null,
    // The count belongs to the one choice that has it; the other stores none rather than a leftover.
    repaymentMonths: input.type === "SALARY_ADVANCE" && input.repaymentPlan === REPAYMENT_OVER_MONTHS ? input.repaymentMonths ?? null : null,
    settlement: settles ? input.settlement ?? null : null,
    vendorId: isVendor ? vendor.vendorId : null,
    vendorName: isVendor ? vendor.vendorName : null,
    vendorPhone: isVendor ? vendor.vendorPhone : null,
  };
}

/** The employee behind the signed-in user, which is who a request is raised by and shown against. */
async function requesterOf(user) {
  const employeeId = Number(user?.linkedEmployeeId) || null;
  if (!employeeId) return { requestedById: null, requestedByName: user?.name || "Unknown", requestedByCode: null };
  const employee = await prisma.employee.findFirst({ where: { id: employeeId }, select: { id: true, employeeName: true, employeeId: true } });
  if (!employee) return { requestedById: null, requestedByName: user?.name || "Unknown", requestedByCode: null };
  return { requestedById: employee.id, requestedByName: employee.employeeName, requestedByCode: employee.employeeId };
}

/**
 * A request is the requester's own business until somebody who may decide it looks at it - and a
 * decider is then narrowed by the grant's scope on the permission this module is guarded with, on
 * the request's branch reference and the employee who raised it. The two rules are ANDed, so the
 * scope can only ever narrow what the ownership rule already allowed: a decider at All records
 * keeps exactly today's answer, and a requester still sees their own whatever the scope says.
 */
const REQUEST_SCOPE_COLUMNS = { branch: "branchId", employee: "requestedById", user: "createdBy" };
// Resolved on the **approver's** permission, because it only narrows the wide view that permission
// grants: a requester sees their own rows by `requestedById` and nothing else narrows that further.
const requestScope = (user) => dataScope.resolve({ userId: Number(user?.id), module: "ACCOUNTS", feature: "Payment Request Approver", columns: REQUEST_SCOPE_COLUMNS });

async function visibilityWhere(user) {
  const employeeId = Number(user?.linkedEmployeeId) || null;
  // A login with no employee behind it can raise nothing and so owns nothing; `-1` matches no row
  // rather than falling through to every row, which a bare `undefined` would.
  if (!(await canDecide(user))) return { requestedById: employeeId || -1 };
  return { AND: [(await requestScope(user)).where] };
}

/*
 * A request with an expense line on a project in Resource Management → Recycling Bin is kept - it is
 * money asked for, and Restore brings the project back - but not listed, opened or acted on while it
 * is there. Whole requests rather than single lines, so a request is never shown with part of its
 * total missing.
 */
const NOT_ON_A_BINNED_PROJECT = { expenses: { none: { OR: [{ project: { deletedAt: { not: null } } }, { shoot: { project: { deletedAt: { not: null } } } }] } } };

/*
 * ── Asset Management → Vendors → Vendor Payments ───────────────────────────────────────────────
 *
 * The studio's bills to its vendors, read from the vendor's side: what was asked for, where it got
 * to, and what has actually left the account against it. One row per Vendor Payment request, with
 * the cash entries the approval wrote summed into `paid`.
 *
 * It lives here, in the module that owns payment requests, rather than in the assets module - and it
 * answers for `ACCOUNTS / Payment Request` like every other route on this router, because
 * that is the permission that decides who may read what the studio is paying. The Vendors screen
 * offers the view only to somebody holding it; a reader with Vendor Management alone never sees it,
 * and this guard is what makes that true rather than the screen hiding a tab.
 *
 * `visibilityWhere` is the same rule the Payment Requests screen reads by, so this cannot become a
 * way around it: somebody who may not decide requests sees the ones they raised themselves, which
 * from the vendor's side is "the bills I sent in for this vendor".
 */
const VENDOR_PAYMENT_INCLUDE = {
  vendor: { select: { id: true, vendorId: true, vendorName: true, mobileNumber: true } },
  requestedBy: { select: { employeeId: true, employeeName: true } },
  cashEntries: {
    where: { deletedAt: null, entryType: "Spent" },
    orderBy: { entryDate: "asc" },
    select: { id: true, entryId: true, entryDate: true, amount: true, paidTo: true },
  },
};

/** One bill as the ledger reads it: asked, where it got to, and what has gone out against it. */
function vendorPaymentRow(request) {
  const entries = (request.cashEntries || []).map((entry) => ({ ...entry, amount: Number(entry.amount) }));
  const paid = entries.reduce((sum, entry) => sum + entry.amount, 0);
  const amount = Number(request.amount);
  return {
    id: request.id,
    requestCode: request.requestCode,
    status: request.status,
    // The linked vendor's name as it reads **today**, falling back to the copy the request was
    // raised with for a vendor since removed from the register - the one case the link is null and
    // the text is all there is.
    vendorId: request.vendor?.id ?? request.vendorId ?? null,
    vendorCode: request.vendor?.vendorId || "",
    vendorName: request.vendor?.vendorName || request.vendorName || "",
    vendorPhone: request.vendor?.mobileNumber || request.vendorPhone || "",
    // Null rather than 0 for a vendor the link never found: "we cannot tell" is not "nothing".
    linked: Boolean(request.vendorId),
    branch: request.branch,
    billDate: request.expenseDate,
    amount,
    paid,
    // Only ever what is still owed on an approved bill. A pending one is not owed until it is
    // decided, and a rejected one never will be, so neither carries a balance.
    balance: request.status === "APPROVED" ? Number((amount - paid).toFixed(2)) : 0,
    paidOn: entries.length ? entries[entries.length - 1].entryDate : null,
    cashEntryCode: entries.map((entry) => entry.entryId).join(", "),
    cashEntries: entries,
    requestedByName: request.requestedByName,
    requestedByCode: request.requestedByCode || request.requestedBy?.employeeId || "",
    comments: request.comments || "",
    billUrls: fileUrls(request.bills),
    createdAt: request.createdAt,
    decidedAt: request.decidedAt,
  };
}

async function vendorPayments(req, res) {
  const parsed = vendorPaymentsQuerySchema.safeParse(req.query);
  if (!parsed.success) return validationError(res, parsed.error);
  const { status } = parsed.data;
  try {
    const visibility = await visibilityWhere(req.user);
    const data = await prisma.paymentRequest.findMany({
      where: {
        deletedAt: null,
        type: "VENDOR_PAYMENT",
        ...visibility,
        ...NOT_ON_A_BINNED_PROJECT,
      },
      orderBy: [{ createdAt: "desc" }],
      include: VENDOR_PAYMENT_INCLUDE,
    });
    const rows = data.map(vendorPaymentRow);
    /*
     * The status narrows the rows **here** rather than in the query, so the tabs' counts and the
     * totals are of everything this reader can see rather than of the tab in front of them. A tab
     * reading zero for what you are looking at is the one thing a count must never say.
     */
    const shown = status ? rows.filter((row) => row.status === status) : rows;
    return res.json({
      data: shown,
      meta: {
        // What the tabs count, over everything this reader can see rather than over the page shown.
        counts: {
          ALL: rows.length,
          ...Object.fromEntries(STATUSES.map((entry) => [entry, rows.filter((row) => row.status === entry).length])),
        },
        totals: {
          amount: Number(rows.reduce((sum, row) => sum + row.amount, 0).toFixed(2)),
          paid: Number(rows.reduce((sum, row) => sum + row.paid, 0).toFixed(2)),
          balance: Number(rows.reduce((sum, row) => sum + row.balance, 0).toFixed(2)),
        },
      },
    });
  } catch (error) { return handleError(res, error, "Unable to load vendor payments"); }
}

async function listRequests(req, res) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return validationError(res, parsed.error);
  const { type, status, paid, search } = parsed.data;
  try {
    const visibility = await visibilityWhere(req.user);
    // Word Chunk Search: every word typed, any order - added beside the visibility rule's own AND.
    const chunks = everyChunk(search, (chunk) => ({ OR: [
      { requestCode: { contains: chunk } },
      { requestedByName: { contains: chunk } },
      { vendorName: { contains: chunk } },
      { branch: { contains: chunk } },
    ] }));
    const data = await prisma.paymentRequest.findMany({
      where: {
        deletedAt: null,
        ...visibility,
        ...NOT_ON_A_BINNED_PROJECT,
        ...(chunks.length ? { AND: [...(visibility.AND || []), ...chunks] } : {}),
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
        // `some`/`none` on the entries rather than a column: a soft-deleted entry is not a payment,
        // and the relation is where that is already known.
        ...(paid ? { cashEntries: paid === "yes" ? { some: { deletedAt: null } } : { none: { deletedAt: null } } } : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      include,
    });
    /*
     * Awaited, and mapped one row at a time rather than handed `toRow` directly.
     *
     * `toRow` is async — it asks `directionOf` what an expense submission settles as — so
     * `data.map(toRow)` is an array of promises, and `res.json` renders a promise as `{}`. The list
     * answered with one empty object per request: the right number of rows, every cell blank, and
     * every status tab reading zero because no row carried a status. Every other caller of `toRow`
     * already awaited it; this was the only one that did not.
     *
     * `(row) => toRow(row)` rather than `.map(toRow)`: map also passes the index and the array, and
     * a second parameter added to `toRow` later would silently start receiving them.
     */
    // Who raised and who decided each request, by name (`services/userNames`).
    const rows = await withUserNames(await Promise.all(data.map((row) => toRow(row))));
    /*
     * `myEmployeeId` is how the screen knows which rows are the reader's own, which is what Withdraw
     * is offered on. Sent rather than computed per row so one answer covers the list, and sent as an
     * id rather than a `canWithdraw` flag per row because the screen also has to know it for a row
     * that arrives later through a Kanban drag.
     */
    return res.json({ data: rows, meta: { canDecide: await canDecide(req.user), myEmployeeId: Number(req.user?.linkedEmployeeId) || null } });
  } catch (error) { return handleError(res, error, "Unable to load payment requests"); }
}

async function getRequest(req, res) {
  const id = parseId(req, res);
  if (!id) return;
  try {
    const request = await prisma.paymentRequest.findFirst({ where: { id, deletedAt: null, ...(await visibilityWhere(req.user)), ...NOT_ON_A_BINNED_PROJECT }, include });
    if (!request) return res.status(404).json({ message: "Payment request not found" });
    return res.json({ data: await toRow(request) });
  } catch (error) { return handleError(res, error, "Unable to load this payment request"); }
}

/** Everything the four forms and the approval draw their dropdowns from, in one request. */
/*
 * The pickers on a payment request, **searched on the server** rather than handed their whole list.
 *
 * `options` used to carry them: every live shoot and every live project, capped at 200.
 * That cap reads like a page and is not one - nothing fetches the next - so it was the limit of what
 * a line could ever name, and because the order is newest-first, what it dropped was the oldest. A
 * studio that brought its past projects in through the Pre Production import could not file an
 * expense against any of them, and the picker, filtering only what it had been given, said "No
 * options available" as though the record did not exist. 200 of 986 shoots and 200 of 640 projects
 * on the development database.
 *
 * Why this is shaped the way it is, and the shared `searchPicker`, are in
 * `services/pickerSearch.js`.
 *
 * **The shoot search takes no project filter.** A line's project is derived from its shoot
 * (`resolveExpenseLinks`), so the shoot is the one answer being given, and narrowing by a project
 * chosen elsewhere would only hide shoots from somebody who knows which shoot they mean.
 */
const SHOOT_PAGE = PICKER_PAGE;

async function searchShoots(req, res) {
  try {
    const { rows, total, capped } = await searchPicker(prisma.projectShoot, {
      search: String(req.query.search || "").trim(),
      where: { deletedAt: null, project: { deletedAt: null } },
      chunkIn: (chunk) => [
        { shootId: { contains: chunk } },
        { shoot: { contains: chunk } },
        { project: { eventId: { contains: chunk } } },
        { project: { whatsappGroupName: { contains: chunk } } },
      ],
      orderBy: [{ dateCreated: "desc" }, { shootId: "desc" }],
      select: {
        id: true, shootId: true, shoot: true, dateCreated: true, projectId: true,
        project: { select: { eventId: true } },
      },
    });
    return res.json({
      data: {
        shoots: rows.map((shoot) => ({
          id: shoot.id,
          shootId: shoot.shootId,
          shoot: shoot.shoot,
          dateCreated: shoot.dateCreated,
          projectId: shoot.projectId,
          projectCode: shoot.project?.eventId || "",
        })),
        total,
        capped,
      },
    });
  } catch (error) { return handleError(res, error, "Unable to search shoots"); }
}

/** The vendors a request can be raised against: the active register, searched by name or code. */
async function searchVendors(req, res) {
  try {
    const { rows, total, capped } = await searchPicker(prisma.vendor, {
      search: String(req.query.search || "").trim(),
      where: { isDeleted: false, status: "ACTIVE" },
      chunkIn: (chunk) => [
        { vendorName: { contains: chunk } },
        { vendorId: { contains: chunk } },
        { mobileNumber: { contains: chunk } },
      ],
      orderBy: [{ vendorName: "asc" }],
      select: { id: true, vendorId: true, ...VENDOR_LABEL_SELECT, mobileNumber: true },
    });
    return res.json({ data: { vendors: rows, total, capped } });
  } catch (error) { return handleError(res, error, "Unable to search vendors"); }
}

async function options(req, res) {
  try {
    const [employees, projects, shoots, vendors, accounts] = await Promise.all([
      prisma.employee.findMany({
        where: { archivedAt: null, employmentStatus: { in: await workingEmployeeStatuses() } },
        orderBy: { employeeName: "asc" },
        select: { id: true, employeeId: true, employeeName: true, department: true, profilePhotoUrl: true },
      }),
      // Every project, whoever they belong to: a request is raised against whatever project the
      // money was for, which is often not one this person is on. The requests themselves are what
      // the rule narrows.
      prisma.salesProject.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: PICKER_PAGE,
        select: { id: true, eventId: true, whatsappGroupNameId: true, whatsappGroupName: true },
      }),
      /*
       * The shoots a line is most likely to name, for the picker to open on before anybody types:
       * the nearest ones by shoot date. Everything else is reached by typing, which `searchShoots`
       * answers over every shoot - this list is a starting point and never the limit of what can be
       * chosen, which is what it used to be.
       */
      prisma.projectShoot.findMany({
        where: { deletedAt: null, project: { deletedAt: null } },
        orderBy: { dateCreated: "desc" },
        take: SHOOT_PAGE,
        select: { id: true, shootId: true, shoot: true, dateCreated: true, projectId: true },
      }),
      prisma.vendor.findMany({
        where: { isDeleted: false, status: "ACTIVE" },
        orderBy: { vendorName: "asc" },
        take: PICKER_PAGE,
        select: { id: true, vendorId: true, ...VENDOR_LABEL_SELECT, mobileNumber: true },
      }),
      /*
       * The studio's accounts, from the branch register - the one place they are kept since the
       * Accounts module's own bank-account list was retired. The label is the value stored on the
       * record, so it is built in `services/branchBankAccounts.js` and nowhere else.
       */
      receivedIntoOptions(),
    ]);
    const names = await projectClientNames(projects);
    const projectCodes = new Map(projects.map((project) => [project.id, project.eventId]));
    return res.json({
      data: {
        // No branches: nothing on these screens asks anybody to choose one. `resolveBranch` works
        // it out when the request is raised.
        employees: employees.map((row) => ({ ...row, profilePhotoUrl: listPhotoUrl(row.profilePhotoUrl) })),
        projects: projects.map((project) => ({ id: project.id, eventId: project.eventId, clientName: clientNameOf(project, names) })),
        // Each shoot carries the project it belongs to, so one picker can name both.
        shoots: shoots.map((shoot) => ({
          ...shoot,
          projectCode: projectCodes.get(shoot.projectId) || "",
        })),
        vendors,
        // Already labels, built where the stored value is - see `receivedIntoOptions`.
        accounts,
        expenseTypes: EXPENSE_TYPES,
        settlements: await settlementNames(),
        // Which settlement means the money comes back, so the form can drop the QR code for it -
        // the same answer this endpoint decides the direction by.
        excessSettlement: await excessSettlement(),
        repaymentPlans: REPAYMENT_PLANS,
        canDecide: await canDecide(req.user),
        myEmployeeId: Number(req.user?.linkedEmployeeId) || null,
      },
    });
  } catch (error) { return handleError(res, error, "Unable to load payment request options"); }
}

async function createRequest(req, res) {
  // `safeParseAsync`: the settlement is checked against the studio's own list.
  const parsed = await requestSchema.safeParseAsync(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const input = parsed.data;
  try {
    const actorId = Number(req.user.id) || null;
    const requester = await requesterOf(req.user);
    const expenses = expenseRows(input, await asksExpenseType(input));
    // All resolved before anything is uploaded, so a bad answer costs no bucket objects to roll back.
    await resolveExpenseLinks(expenses);
    const branch = await resolveBranch(expenses, requester, actorId);
    const vendor = await resolveVendor(input.type === "VENDOR_PAYMENT" ? input.vendorId : null);

    // An excess stores no QR code even if one was sent, the way every other field that does not
    // belong to the kind being raised is dropped rather than kept.
    const qr = await attachFiles(await takesQrCode(input) ? input.qrCode : null, null, { folder: QR_FOLDER, userId: actorId });
    let bills;
    try {
      bills = await attachFiles(TYPES_WITH_BILLS.includes(input.type) ? input.bills : null, null, { folder: BILLS_FOLDER, userId: actorId });
    } catch (error) {
      await discardUploads(qr.uploads);
      throw error;
    }

    try {
      const created = await prisma.$transaction(async (tx) => tx.paymentRequest.create({
        data: {
          ...requestData(input, expenses, branch, vendor),
          // The branch reference beside the name, by the backfill's rule, so a request raised today is
          // narrowed like one that was backfilled.
          branchId: (await referenceLookups()).branchId(branch),
          ...requester,
          requestCode: await nextRequestCode(input.type, tx),
          qrCode: qr.files ?? null,
          bills: bills.files ?? null,
          termsAcceptedAt: new Date(),
          createdBy: actorId,
          expenses: expenses.length ? { create: expenses } : undefined,
        },
        include,
      }));
      return res.status(201).json({ data: await toRow(created) });
    } catch (error) {
      // Nothing was written, so the files just uploaded belong to nothing.
      await discardUploads([...qr.uploads, ...bills.uploads]);
      throw error;
    }
  } catch (error) { return handleError(res, error, "Unable to raise this payment request"); }
}

/**
 * The project every line that names one agrees on.
 *
 * Null the moment two of them name different projects, because then there is no one project to be
 * filed against. A "General" line names no shoot and so no project, and it does not take the
 * project away from the lines that do: a courier among three shoot lines used to leave the whole
 * request filed against nothing at all.
 */
function commonProject(expenses) {
  const ids = [...new Set((expenses || []).map((line) => line.projectId).filter(Boolean))];
  return ids.length === 1 ? ids[0] : null;
}

/** Paise, so a shoot's total is the sum of its lines rather than a float that drifts off them. */
const paise = (amount) => Math.round(Number(amount || 0) * 100);

/**
 * The entries an approved request becomes: one per shoot it was spent on, or one per project the
 * money came back for, each carrying that one's own lines.
 *
 * **Money out is per shoot** and **money in is per project** — the two rules Accounts already
 * applies to its own cash book, since a spend happens on a shoot while money comes back for a
 * project as a whole. Either way it is one row per thing, not one row for the total: a request
 * itemising three shoots is three rows, each worth what was actually spent on that one, and an
 * excess returning money across two projects is two rows, one per project.
 *
 * Nothing is divided. The lines already answer both questions — which shoot or project, and how
 * much — and every itemising kind stores its `amount` as those lines' total (`requestData`), so the
 * rows add back up to the request.
 *
 * Before this, an entry carried one shoot and a request could only be filed against a shoot, or a
 * project, that every line agreed on. Two of either meant one entry naming neither, and that money
 * reached nobody's books.
 *
 * A line naming neither — the "General" the form offers — is folded into the one project the rest of
 * them name, and stands as its own row only when there is no single project to fold it into. Order
 * is the order the lines were entered, so the books read down the way the request does.
 */
function entryGroups(expenses, { perShoot }) {
  const lines = expenses || [];
  if (!lines.length) return [];
  const common = commonProject(lines);
  const groups = new Map();
  for (const line of lines) {
    // A General line has no project of its own, so it takes the one the request as a whole names.
    const projectId = line.projectId || common;
    const shootId = perShoot ? line.shootId || null : null;
    const key = perShoot ? line.shootId || "" : projectId || "";
    const group = groups.get(key) || { projectId, shootId, total: 0 };
    group.total += paise(line.amount);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ total, ...group }) => ({ ...group, amount: total / 100 }));
}

/**
 * Every entry an approval writes, and what each is filed against.
 *
 * Money out is one entry per shoot; money coming **back** is one entry per project, since money
 * comes back for a project as a whole — both through `entryGroups`. A request that itemises
 * nothing, a salary advance, is the one entry it has always been, for the amount asked for.
 *
 * The rows have to come to the amount approved, and they do by construction: every itemising kind
 * stores its `amount` as its lines' total (`requestData`). Checked rather than trusted, because the
 * two are written at different times and a request whose figure had drifted from its lines would
 * otherwise be paid as a set of rows that quietly did not add up to what was approved.
 */
function filingsFor(request, received) {
  const groups = entryGroups(request.expenses, { perShoot: !received });
  if (!groups.length) return [{ projectId: commonProject(request.expenses), shootId: null, amount: Number(request.amount) }];
  const total = groups.reduce((sum, group) => sum + paise(group.amount), 0);
  if (total !== paise(request.amount)) {
    throw badRequest("This request's expense lines no longer add up to the amount being approved. Open it, check the lines, and save it again.");
  }
  return groups;
}

/**
 * The payroll row an approved salary advance becomes, so the money comes back off a payslip.
 *
 * A salary advance was two records that did not know about each other: this request, which asked for
 * the money and was approved, and HRM → Payroll → Advance Salary, which is what actually deducts it.
 * Nothing joined them, so an approved advance reached payroll only if somebody remembered to retype
 * it — and when nobody did, the studio paid it out and never took it back.
 *
 * **Which month.** `openPayrollMonth` — the payroll month still being paid, the first whose payable
 * day has not passed. Approved before this month's payday it comes off this month; approved after
 * it, off the next. Never a month already paid, which payroll refuses anyway and for good reason.
 *
 * The amount lands on that payslip through `syncPayroll` inside `createAdvanceIn`, which is the same
 * path the Advance Salary screen's own form takes. Written in the approval's transaction: a request
 * marked paid with no deduction behind it is the bug this exists to close.
 */
async function recordSalaryAdvance(tx, request, actorId, entryDate) {
  const { year, month } = await openPayrollMonth(tx);
  const day = (entryDate instanceof Date ? entryDate : new Date(entryDate)).toISOString().slice(0, 10);
  return createAdvanceIn(tx, {
    employeeId: request.requestedById,
    advanceDate: day,
    amount: Number(request.amount),
    deductMonth: month,
    deductYear: year,
    // Says on the payroll screen where it came from, and what was agreed about paying it back.
    reason: [request.requestCode, request.repaymentPlan, request.reason].filter(Boolean).join(" · "),
    paymentRequestId: request.id,
  }, actorId);
}

/**
 * Approving a request authorises it. It does not pay it.
 *
 * These were one step, and the step did two jobs: it recorded a decision and it moved money. So the
 * approver needed the cash book's fields in front of them, a request appeared in Accounts Manager
 * only after it had already been paid, and nobody could authorise a spend without also releasing it.
 *
 * Now approving writes the decision and stops. The request then waits under Accounts Manager →
 * Pending, where whoever holds the cash book releases it through `payRequest` below, which is what
 * writes the cash entries and - for a salary advance - the payroll row that takes it back.
 */
async function approveRequest(req, res) {
  const id = parseId(req, res);
  if (!id) return;
  if (!(await canDecide(req.user))) return res.status(403).json({ message: "Only an admin can decide a payment request" });
  const parsed = approvalSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const request = await prisma.paymentRequest.findFirst({ where: { id, deletedAt: null, ...(await visibilityWhere(req.user)), ...NOT_ON_A_BINNED_PROJECT }, select: { id: true, status: true } });
    if (!request) return res.status(404).json({ message: "Payment request not found" });
    if (request.status !== "PENDING") throw badRequest(`This request has already been ${request.status.toLowerCase()}.`);

    /*
     * Claimed rather than updated: two approvers arriving together both read PENDING a moment ago,
     * and only one of them may be the one who decided it. Harmless now that nothing is written
     * alongside, kept because the decision's author and timestamp should still be whoever won.
     */
    const claimed = await prisma.paymentRequest.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: "APPROVED",
        decisionRemarks: parsed.data.remarks ?? null,
        decidedById: Number(req.user.id) || null,
        decidedAt: new Date(),
      },
    });
    if (!claimed.count) throw badRequest("This request has already been decided.");

    const decided = await prisma.paymentRequest.findUnique({ where: { id }, include });
    return res.json({ data: await toRow(decided) });
  } catch (error) { return handleError(res, error, "Unable to approve this payment request"); }
}

/**
 * Releasing the money an approved request asked for — Accounts Manager → Pending → Record Payment.
 *
 * The request says who is owed what and why, and the approval says yes. What neither knows is how
 * the money actually moved, so that arrives here and becomes the cash entries: one per shoot the
 * money was spent on, one per project it came back for, through `filingsFor`.
 *
 * Everything is written in one transaction. A release that failed halfway would leave a request
 * standing as paid with nothing behind it, or - now that a spend is one entry per shoot - a partial
 * set of rows that did not add up to the amount approved.
 *
 * **Guarded by the cash book, not by the approval.** Authorising a spend and releasing it are
 * different jobs held by different people, which is the whole point of the split: this route mounts
 * `ACCOUNTS / Cash Management` READ / WRITE on top of the router's own permission, because what it
 * writes is cash entries.
 */
async function payRequest(req, res) {
  const id = parseId(req, res);
  if (!id) return;
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const request = await prisma.paymentRequest.findFirst({ where: { id, deletedAt: null, ...(await visibilityWhere(req.user)), ...NOT_ON_A_BINNED_PROJECT }, include });
    if (!request) return res.status(404).json({ message: "Payment request not found" });
    if (request.status === "PENDING") throw badRequest("This request has not been approved yet. It has to be approved on the Payment Requests screen before the money can be released.");
    if (request.status !== "APPROVED") throw badRequest(`This request was ${request.status.toLowerCase()}, so there is nothing to pay.`);
    if (request.cashEntries.length) throw badRequest(`This request has already been paid — ${request.cashEntries.map((entry) => entry.entryId).join(", ")}.`);

    const actorId = Number(req.user.id) || null;
    const direction = await directionOf(request);
    const received = direction === "Received";
    const counterparty = request.type === "VENDOR_PAYMENT" ? request.vendorName : request.requestedByName;
    const filings = filingsFor(request, received);
    /*
     * One payment, so one upload: the proof is stored once here and attached to every row this
     * writes. Left to each entry, `storeImage` ran again for every shoot.
     */
    const { proof, uploads } = await attachProof(parsed.data.paymentProof, null, actorId);

    try {
      const paid = await prisma.$transaction(async (tx) => {
        /*
         * The request's row is locked before a rupee is written, and the entries are counted again
         * behind the lock.
         *
         * The count outside the transaction was read a moment ago, so two people releasing at once
         * both saw none. One entry each was one duplicate; a row per shoot would have been two full
         * sets, both stamped with this request, and the spend double-counted in the books. The
         * second waits on this lock until the first commits, then counts the entries it wrote and
         * finds the payment already made. `FOR UPDATE` because there is no column saying "paid" to
         * claim conditionally - the entries are the fact, and they are in another table.
         *
         * **This has to stay the first statement in the transaction.** Under REPEATABLE READ the
         * snapshot is taken by the first *non-locking* read, and a locking read does not take one -
         * so the count below is the first consistent read and sees what the winner committed. A
         * plain read placed above this line would pin a snapshot from before the lock was granted,
         * and the double payment would be back.
         */
        await tx.$queryRaw`SELECT id FROM payment_request WHERE id = ${id} FOR UPDATE`;
        // Re-read behind the lock rather than trusting what was read before the transaction opened.
        // APPROVED has no way back today - withdraw and reject both refuse anything but PENDING -
        // but this costs one query and does not depend on that staying true.
        const locked = await tx.paymentRequest.findUnique({ where: { id }, select: { status: true } });
        if (locked?.status !== "APPROVED") throw badRequest("This request is no longer approved, so there is nothing to pay.");
        const already = await tx.cashEntry.count({ where: { paymentRequestId: id, deletedAt: null } });
        if (already) throw badRequest("This request has just been paid by somebody else.");

        const written = [];
        for (const filing of filings) {
          const entry = await recordCashEntry({
            entryType: direction,
            projectId: filing.projectId,
            shootId: filing.shootId,
            clientName: counterparty,
            category: received ? RECEIVED_CATEGORY : CATEGORY_BY_TYPE[request.type],
            amount: filing.amount,
            entryDate: parsed.data.entryDate || new Date(),
            branch: request.branch,
            paymentMode: parsed.data.paymentMode,
            paymentModeOther: parsed.data.paymentModeOther,
            transactionId: parsed.data.transactionId,
            receivedAccount: parsed.data.receivedAccount,
            paidFromAccount: parsed.data.paidFromAccount,
            paidTo: received ? null : (parsed.data.paidTo || counterparty),
            handlerEmployeeId: parsed.data.handlerEmployeeId,
            handlerName: parsed.data.handlerName,
            handlerIsOther: parsed.data.handlerIsOther,
            paymentProof: parsed.data.paymentProof,
            // The payer's own note belongs to the entry, not to the request: `decisionRemarks` is
            // the approver's word on whether to pay at all, and is not overwritten here.
            description: [
              `${request.requestCode} · ${LABEL_BY_TYPE[request.type]}${request.reason || request.comments ? ` — ${request.reason || request.comments}` : ""}`,
              parsed.data.remarks,
            ].filter(Boolean).join(" · "),
          }, actorId, tx, { proof });
          written.push(entry.id);
        }
        /*
         * The entry names the request it came from, rather than the request naming the entry: one
         * release writes as many entries as the request itemised shoots, and a single column on the
         * request could hold only the first of them. Written after the entries because
         * `recordCashEntry` takes only the fields a cash entry form sends, the same way a cleared
         * scheduled payment stamps itself onto the entry it produced.
         */
        await tx.cashEntry.updateMany({ where: { id: { in: written } }, data: { paymentRequestId: id } });

        /*
         * A salary advance also becomes the payroll row that takes it back, and it becomes it when
         * the money actually leaves — not when the advance was authorised, since nothing is owed
         * back until it has been handed over. Refused rather than skipped when there is nobody to
         * take it from: paying an advance that no payslip will ever recover is the thing this is
         * here to prevent, so the release fails and says why.
         */
        if (request.type === "SALARY_ADVANCE") {
          /*
           * `PayrollAdvance.paymentRequestId` is unique, so a request whose cash entries were
           * deleted and which is therefore payable again would hit that constraint and surface as a
           * 500 with a Prisma message on it. Asked plainly instead: the deduction is still on a
           * payslip, and that is the thing to undo first.
           */
          const recovery = await tx.payrollAdvance.findUnique({ where: { paymentRequestId: id }, select: { advanceId: true } });
          if (recovery) {
            throw badRequest(`This advance is already on the payroll as ${recovery.advanceId}. Remove that deduction in HRM → Payroll → Advance Salary before paying it again.`);
          }
          if (!request.requestedById) {
            throw badRequest("This advance names no employee record, so there is no payslip to take it back from. Link the requester to an employee and raise it again.");
          }
          await recordSalaryAdvance(tx, request, actorId, parsed.data.entryDate || new Date());
        }

        // Read back rather than updated again: this is the row with its entries on it for the answer.
        return tx.paymentRequest.findUnique({ where: { id }, include });
      });

      return res.json({ data: await toRow(paid) });
    } catch (error) {
      // Nothing was written, so the proof just uploaded belongs to nothing.
      await discardUploads(uploads);
      throw error;
    }
  } catch (error) { return handleError(res, error, "Unable to record this payment"); }
}

async function rejectRequest(req, res) {
  const id = parseId(req, res);
  if (!id) return;
  if (!(await canDecide(req.user))) return res.status(403).json({ message: "Only an admin can decide a payment request" });
  const parsed = rejectSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const request = await prisma.paymentRequest.findFirst({ where: { id, deletedAt: null, ...(await visibilityWhere(req.user)), ...NOT_ON_A_BINNED_PROJECT }, select: { id: true, status: true } });
    if (!request) return res.status(404).json({ message: "Payment request not found" });
    if (request.status !== "PENDING") throw badRequest(`This request has already been ${request.status.toLowerCase()}.`);

    const updated = await prisma.paymentRequest.update({
      where: { id },
      data: { status: "REJECTED", decisionRemarks: parsed.data.remarks, decidedById: Number(req.user.id) || null, decidedAt: new Date() },
      include,
    });
    return res.json({ data: await toRow(updated) });
  } catch (error) { return handleError(res, error, "Unable to reject this payment request"); }
}

/**
 * Withdrawing a request that has not been looked at yet. Only the person who raised it, and only
 * while it is still pending — once decided it is part of the record, and the uploads go with it.
 */
/**
 * Edits a request that has not been decided yet.
 *
 * Only while PENDING, and that is the whole point of the restriction rather than caution: approving
 * writes a Cash Spent entry from the request's amount, so editing an approved one would leave the
 * books saying something the request no longer does. A rejected request is a closed record for the
 * same reason. Neither is rewritten — the requester withdraws and raises again, as before.
 *
 * The kind cannot change either. `requestCode` is issued with a prefix per type, so turning a
 * salary advance into a vendor payment would leave the code describing something it is not.
 */
async function updateRequest(req, res) {
  const id = parseId(req, res);
  if (!id) return;
  // `safeParseAsync`: the settlement is checked against the studio's own list.
  const parsed = await requestSchema.safeParseAsync(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const input = parsed.data;
  try {
    const existing = await prisma.paymentRequest.findFirst({
      where: { id, deletedAt: null, ...(await visibilityWhere(req.user)), ...NOT_ON_A_BINNED_PROJECT },
      select: { id: true, type: true, status: true, requestedById: true, qrCode: true, bills: true },
    });
    if (!existing) return res.status(404).json({ message: "Payment request not found" });

    /*
     * Correcting a request is the **approver's**, not the requester's.
     *
     * It used to be either, which meant the figure an approver was looking at could change under
     * them between reading it and deciding it. A requester who got their own ask wrong withdraws it
     * and raises the one they meant - which is one line of audit rather than a silent edit.
     */
    if (!(await canDecide(req.user))) throw forbidden("Only a payment request approver can correct a request. Withdraw yours and raise the one you meant.");
    if (existing.status !== "PENDING") throw badRequest(`This request has already been ${existing.status.toLowerCase()} and cannot be edited.`);
    if (input.type !== existing.type) throw badRequest("The kind of a request cannot be changed. Withdraw it and raise the one you meant.");

    const actorId = Number(req.user.id) || null;
    // Read from the row rather than from the signed-in user: an approver editing somebody else's
    // request must not quietly become the person who raised it.
    const requester = { requestedById: existing.requestedById };
    const expenses = expenseRows(input, await asksExpenseType(input));
    await resolveExpenseLinks(expenses);
    // Three arguments, as `resolveBranch` takes them. A fourth used to be passed, with the caller's
    // id in it and `input.branch` - which the schema does not carry - in the caller's place, so the
    // fallback read `user.findFirst({ where: { id: undefined } })`: the first account in the table,
    // and an edited request could be quietly re-filed under that person's branch.
    const branch = await resolveBranch(expenses, requester, req.user.id);
    const vendor = await resolveVendor(input.type === "VENDOR_PAYMENT" ? input.vendorId : null);

    // `existing` is passed this time, so a link the form sent back keeps the metadata it was stored
    // with instead of being uploaded a second time.
    const qr = await attachFiles(await takesQrCode(input) ? input.qrCode : null, existing.qrCode, { folder: QR_FOLDER, userId: actorId });
    let bills;
    try {
      bills = await attachFiles(TYPES_WITH_BILLS.includes(input.type) ? input.bills : null, existing.bills, { folder: BILLS_FOLDER, userId: actorId });
    } catch (error) {
      await discardUploads(qr.uploads);
      throw error;
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        // The form sends the whole list of lines, so the stored ones are replaced by it.
        await tx.paymentRequestExpense.deleteMany({ where: { requestId: id } });
        return tx.paymentRequest.update({
          where: { id },
          data: {
            ...requestData(input, expenses, branch, vendor),
            branchId: (await referenceLookups()).branchId(branch),
            qrCode: qr.files ?? null,
            bills: bills.files ?? null,
            expenses: expenses.length ? { create: expenses } : undefined,
          },
          include,
        });
      });
      // Only after the row is written. Dropping the objects first would delete files the request
      // still points at if the write then failed.
      await removeDroppedFiles(existing.qrCode, qr.files);
      await removeDroppedFiles(existing.bills, bills.files);
      return res.json({ data: await toRow(updated) });
    } catch (error) {
      await discardUploads([...qr.uploads, ...bills.uploads]);
      throw error;
    }
  } catch (error) { return handleError(res, error, "Unable to update this payment request"); }
}

async function withdrawRequest(req, res) {
  const id = parseId(req, res);
  if (!id) return;
  try {
    const request = await prisma.paymentRequest.findFirst({ where: { id, deletedAt: null, ...(await visibilityWhere(req.user)), ...NOT_ON_A_BINNED_PROJECT }, select: { id: true, status: true, requestedById: true, qrCode: true, bills: true } });
    if (!request) return res.status(404).json({ message: "Payment request not found" });

    /*
     * The requester's alone. An approver who disagrees **rejects**, which leaves who decided and why;
     * withdrawing deletes the row, so an approver using it would erase the ask instead of answering
     * it. A Super Admin is not excepted either - this is about what the action means, not about rank.
     */
    if (!ownedBy(request, req.user)) throw forbidden("Only the person who raised a request can withdraw it. An approver rejects it instead.");
    if (request.status !== "PENDING") throw badRequest(`This request has already been ${request.status.toLowerCase()} and cannot be withdrawn.`);

    await prisma.paymentRequest.update({ where: { id }, data: { deletedAt: new Date() } });
    // Nothing decided it, so nothing has to be answerable for its uploads.
    await removeDroppedFiles(request.qrCode, []);
    await removeDroppedFiles(request.bills, []);
    return res.status(204).send();
  } catch (error) { return handleError(res, error, "Unable to withdraw this payment request"); }
}

module.exports = {
  searchShoots,
  searchVendors,
  listRequests,
  vendorPayments,
  getRequest,
  options,
  createRequest,
  updateRequest,
  approveRequest,
  payRequest,
  rejectRequest,
  withdrawRequest,
  // Exported for the tests: what an approval files its money against, with no database behind it.
  asksExpenseType,
  filingsFor,
  entryGroups,
  commonProject,
  TYPES,
  STATUSES,
  EXPENSE_TYPES,
  SETTLEMENTS,
  REPAYMENT_PLANS,
};
