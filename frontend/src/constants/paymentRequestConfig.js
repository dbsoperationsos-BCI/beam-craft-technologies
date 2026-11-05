/**
 * Payment Requests, described as data for the shared components to draw: the tabs above the table,
 * the table's own columns, the info panel beside it, the four forms that raise a request, and the
 * form an admin approves one with.
 *
 * The four kinds are the same transaction wearing four labels — somebody asks for an amount, an
 * admin says yes or no, a yes moves money — so they are one field list with the kind chosen first
 * and each field asking to be shown only for the kinds that want it. That is the same shape the
 * cash entry form takes around its direction, and it is why adding a fifth kind here is a matter of
 * naming it and marking the fields it shares.
 */

export const REQUEST_TYPES = ["SALARY_ADVANCE", "ADVANCE_EXPENSE", "EXPENSE_SUBMISSION", "VENDOR_PAYMENT"];
/**
 * The kinds that itemise expenses. A vendor payment does not: it is one bill for one amount, so it
 * states that amount the way a salary advance does rather than being built up from lines that would
 * each ask for a project, a shoot and a category the bill has no answer for.
 */
export const TYPES_WITH_EXPENSES = ["ADVANCE_EXPENSE", "EXPENSE_SUBMISSION", "VENDOR_PAYMENT"];
/**
 * The kinds whose amount is the total of their lines, so the form shows it rather than asking.
 * Only a salary advance states its own figure, having no lines to add up. An advance against
 * expenses is the sum of what it plans to spend: a separately typed estimate could disagree with
 * the lines beneath it, and the approver would have no way to tell which number was meant.
 */
export const TYPES_WITH_COMPUTED_TOTAL = ["ADVANCE_EXPENSE", "EXPENSE_SUBMISSION", "VENDOR_PAYMENT"];
export const TYPES_WITH_BILLS = ["EXPENSE_SUBMISSION", "VENDOR_PAYMENT"];
/**
 * The kinds that describe themselves in prose rather than stating a reason. A salary advance is
 * asked *why*, because the answer is the case for granting it; the other three are asked *what*,
 * because the expense lines already say why and what is left is the detail around them.
 */
export const TYPES_WITH_DESCRIPTION = ["ADVANCE_EXPENSE", "EXPENSE_SUBMISSION", "VENDOR_PAYMENT"];

export const SETTLEMENTS = ["Expense Excess", "Reimbursement needed"];
/**
 * How a salary advance comes back. The second choice carries a month count rather than being a
 * bare "Other", so the record says what the arrangement actually is. Mirrors the server.
 */
export const REPAYMENT_ONE_PAYMENT = "One Payment in Next Salary Date";
export const REPAYMENT_OVER_MONTHS = "Over Several Months";
export const REPAYMENT_PLANS = [REPAYMENT_ONE_PAYMENT, REPAYMENT_OVER_MONTHS];
export const MAX_REPAYMENT_MONTHS = 24;
/** An excess hands money back, so there is nobody to pay and no QR code to pay them at. */
export const SETTLEMENT_EXCESS = "Expense Excess";
export const REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED"];
/** What the shoot picker offers first: an expense belonging to no shoot and so to no project. */
export const GENERAL_SHOOT = "General";

/**
 * The kind, offered as radio choices at the top of the form rather than as a step before it. The
 * fields below react to the answer as it changes, so what each kind asks for is read beside the
 * choice instead of on a screen that then disappears.
 */
export const requestTypeChoices = [
  { value: "SALARY_ADVANCE", label: "Salary Advance", description: "An advance on your salary, recovered from a later payslip." },
  { value: "ADVANCE_EXPENSE", label: "Advance Expense", description: "Money needed up front for a shoot or a job, before it is spent." },
  { value: "EXPENSE_SUBMISSION", label: "Expense Submission", description: "Settling an advance already taken, or claiming back what you spent." },
  { value: "VENDOR_PAYMENT", label: "Vendor Payment", description: "A vendor's bill for the studio to pay." },
];

export const labelForType = (type) => (requestTypeChoices.find((choice) => choice.value === type) || {}).label || type;

const isType = (...types) => (values) => types.includes(values.type);
const hasExpenses = (values) => TYPES_WITH_EXPENSES.includes(values.type);
const computesTotal = (values) => TYPES_WITH_COMPUTED_TOTAL.includes(values.type);
const takesBills = (values) => TYPES_WITH_BILLS.includes(values.type);
const takesDescription = (values) => TYPES_WITH_DESCRIPTION.includes(values.type);

/** The tabs split the list by where a request has got to, which is the first cut anyone reads it by. */
export const requestTabs = [
  { label: "All", statuses: null },
  { label: "Pending", statuses: ["PENDING"] },
  { label: "Approved", statuses: ["APPROVED"] },
  { label: "Rejected", statuses: ["REJECTED"] },
];

/** `[key, header, type, size, minSize]`, the same shape every other module table uses. */
export const requestTableFields = [
  ["requestCode", "Request ID", undefined, 150, 130],
  ["status", "Status", "status", 130, 110],
  ["typeLabel", "Type", undefined, 180, 150],
  ["requestedByName", "Raised By", undefined, 190, 160],
  ["requestedByCode", "Employee ID", undefined, 140, 120],
  ["amount", "Amount", "amount", 150, 130],
  ["branch", "Branch", undefined, 170, 140],
  ["vendorName", "Vendor", undefined, 180, 150],
  ["expenseCount", "Lines", undefined, 100, 90],
  ["cashEntryCode", "Cash Entries", undefined, 150, 130],
  /*
    * Approved is not paid: the money leaves when Accounts releases it, which is a second step, and
    * this column is the one that answers for it ("Awaiting Payment" or "Paid").
    *
    * Plain text rather than a `status` column. There is one `statusStyles` map per table, and the
    * board's columns and the Status column's filter list are both built from its keys - so a second
    * status column would have put Paid on the board as a column to drag a request into. It names
    * its own two answers as the tuple's `filterOptions` instead, which is a list filter without
    * `listFilters` - passing that would have turned every other column on the table into a text box.
    */
  ["paymentStatus", "Payment", undefined, 150, 130, ["Awaiting Payment", "Paid"]],
  ["createdAt", "Raised On", "date", 150, 130],
  ["decidedAt", "Decided On", "date", 150, 130],
];

/** Pending reads amber, approved green, rejected red — the same reading the accounts dots give. */
export const requestStatusStyles = {
  PENDING: "bg-amber-500",
  APPROVED: "bg-emerald-500",
  REJECTED: "bg-red-500",
};

/*
 * Asset Management → Vendors → **Vendor Payments**: the same records read from the vendor's side.
 *
 * A bill rather than a request, because that is what it is to the vendor - so the code column is
 * "Bill ID" here and "Request ID" on the Payment Requests screen, and the three money columns are
 * the ledger reading: asked, gone out, still owed. `paid` and `balance` are the server's own sums of
 * the cash entries the approval wrote, not arithmetic the screen does.
 */
export const vendorPaymentTableFields = [
  ["requestCode", "Bill ID", undefined, 150, 130],
  ["status", "Status", "status", 130, 110],
  ["vendorName", "Vendor", undefined, 200, 160],
  ["vendorCode", "Vendor ID", undefined, 140, 120],
  ["billDate", "Bill Date", "date", 140, 120],
  ["amount", "Amount", "amount", 150, 130],
  ["paid", "Paid", "amount", 150, 130],
  ["balance", "Balance", "amount", 150, 130],
  ["branch", "Branch", undefined, 170, 140],
  ["requestedByName", "Raised By", undefined, 190, 160],
  ["cashEntryCode", "Cash Entries", undefined, 160, 130],
  ["paidOn", "Paid On", "date", 140, 120],
  ["createdAt", "Raised On", "date", 150, 130],
  ["decidedAt", "Decided On", "date", 150, 130],
];

/** One bill read in full. Read-only: raising and deciding stay on the screens that own them. */
export const vendorPaymentInfoSections = [
  { title: "Bill", fields: [["requestCode", "Bill ID"], ["status", "Status"], ["billDate", "Bill Date", "date"], ["amount", "Amount", "amount"], ["paid", "Paid", "amount"], ["balance", "Balance", "amount"]] },
  { title: "Vendor", fields: [["vendorName", "Vendor"], ["vendorCode", "Vendor ID"], ["vendorPhone", "Phone"]] },
  { title: "Raised By", fields: [["requestedByName", "Employee Name"], ["requestedByCode", "Employee ID"], ["branch", "Branch"], ["createdAt", "Raised On", "date"], ["comments", "Description"]] },
  { title: "Paid", fields: [["cashEntryCode", "Cash Entries"], ["paidOn", "Paid On", "date"], ["decidedAt", "Decided On", "date"]] },
  { title: "Bills", fields: [["billUrls", "Bills", "gallery"]] },
];

export const requestInfoSections = [
  { title: "Request", fields: [["requestCode", "Request ID"], ["typeLabel", "Type"], ["status", "Status"], ["amount", "Amount", "amount"], ["createdAt", "Raised On", "date"]] },
  { title: "Raised By", fields: [["requestedByName", "Employee Name"], ["requestedByCode", "Employee ID"], ["requestedByDepartment", "Department"], ["branch", "Branch"]] },
  { title: "Details", fields: [["reason", "Reason"], ["comments", "Description"], ["repaymentPlan", "Repayment"], ["repaymentMonths", "Repayment Months"], ["settlement", "Excess / Reimbursement"], ["vendorName", "Vendor"], ["vendorPhone", "Vendor Phone"]] },
  // Rendered by the `expenses` formatter the page supplies, so a request's breakdown is readable
  // from the row without opening the payment form.
  { title: "Expenses", fields: [["expenses", "Lines", "expenses"]] },
  { title: "Decision", fields: [["decidedAt", "Decided On", "date"], ["decisionRemarks", "Remarks"], ["paymentStatus", "Payment"], ["cashEntryCode", "Cash Entries"]] },
  // Both galleries drop themselves when empty and take the section with them.
  { title: "Bills", fields: [["billUrls", "Bills", "gallery"]] },
  { title: "QR Code", fields: [["qrCodeUrls", "QR Code", "gallery"]] },
];

/**
 * The kind, shown above the first section rather than inside it: it is not one of the Request
 * Details, it is the question every section below answers. Changing it re-asks the whole form.
 */
export const requestLeadFields = [
  {
      name: "type",
      label: "Request Type",
      type: "radio",
      required: true,
      colSpan: 2,
      options: requestTypeChoices,
      helperText: "What kind of money you are asking for; changing it clears the answers below.",
      // A bare line of choices, no box: it introduces the form rather than sitting among inputs.
      props: { controlClassName: "px-0 py-0" },
      clears: ["amount", "reason", "comments", "repaymentPlan", "settlement", "vendorName", "vendorPhone"],
    },
];

/**
 * The form that raises a request.
 *
 * Every field says which kinds ask for it. The amount is the clearest case: a salary advance, an
 * advance against expenses and a vendor's bill are each one figure somebody already knows, so they
 * state it, while a submission is worth the sum of its lines, so the form totals those and shows the
 * answer rather than inviting a number that could disagree with them.
 */
export const requestFormSections = [
  {
    id: "request",
    title: "Request Details",
    // No Branch field. The branch a request belongs to is read off records that already know it —
    // the shoot's project, then the person raising it — so nobody is asked to name the branch whose
    // books their request will land in. It appears on the record once the request is raised.
    fields: [
      {
        name: "amount",
        // Only a salary advance reaches this field; every other kind adds its lines up instead.
        label: "Advance Salary Amount Requested",
        required: true,
        when: (values) => !computesTotal(values),
        helperText: "How much of your salary you want in advance; it is recovered from later payslips.",
        props: { type: "number", min: 0, step: "0.01", inputMode: "decimal", placeholder: "0.00" },
      },
      {
        name: "repaymentPlan",
        label: "How will it be repaid?",
        type: "radio",
        required: true,
        when: isType("SALARY_ADVANCE"),
        options: REPAYMENT_PLANS,
        colSpan: 2,
        helperText: "Whether the advance comes off your next salary in one go or over several months.",
        // Switching back to the single payment drops the count, so a stale number cannot be saved
        // against an arrangement that no longer has months in it.
        clears: ["repaymentMonths"],
      },
      {
        name: "repaymentMonths",
        label: "Over How Many Months",
        required: true,
        when: (values) => values.type === "SALARY_ADVANCE" && values.repaymentPlan === REPAYMENT_OVER_MONTHS,
        helperText: `The number of monthly salary deductions it is spread over, 1 to ${MAX_REPAYMENT_MONTHS}.`,
        props: { type: "number", min: 1, max: MAX_REPAYMENT_MONTHS, step: 1, inputMode: "numeric", placeholder: `1 to ${MAX_REPAYMENT_MONTHS}` },
      },
      {
        name: "vendorId",
        label: "Vendor",
        type: "select",
        required: true,
        when: isType("VENDOR_PAYMENT"),
        /*
         * Searched on the server where the screen offers one (`context.remote.vendors`): `options`
         * carries a page of the register for the picker to open on, and typing reaches all of it.
         * The vendor already chosen is kept in the list, since the field holds its id and the label
         * comes from a list each search replaces.
         */
        /*
         * `context.options.vendors` is already `{ value, label }`, built by the panel - which is also
         * where the server-side search's results are labelled and the chosen vendor is kept in the
         * list. Deliberately not built here: **this file imports nothing**, so that the tests which
         * load it directly through Node need no module aliasing, and a label helper pulled in for one
         * field would have broken that for every one of them.
         */
        options: "vendors",
        helperText: "The vendor to be paid; their name and number come from the vendor register.",
        // Picked from the vendor register rather than typed, so a name and a number already on
        // record cannot be re-entered differently here. The server reads both from that record.
        props: (values, context) => {
          const ready = (context?.options?.vendors || []).length;
          const remote = context?.remote?.vendors;
          return {
            searchable: true,
            // Never disabled while it can be searched: typing is how the rest of the register is
            // reached, and a disabled box cannot be typed into.
            disabled: !ready && !remote,
            placeholder: ready || remote ? "Select or search the vendor" : "No active vendors available",
            ...(remote ? remote.props : {}),
          };
        },
      },
      {
        name: "settlement",
        label: "Excess or Reimbursement?",
        type: "radio",
        required: true,
        when: isType("EXPENSE_SUBMISSION"),
        options: SETTLEMENTS,
        colSpan: 2,
        helperText: "Whether you are returning unspent advance money or claiming back what you spent extra.",
        // An excess asks for no QR code, so one attached before the switch is dropped with it.
        clears: ["qrCode"],
      },
      {
        name: "reason",
        label: "Reason for the Salary Request",
        type: "textarea",
        required: true,
        when: isType("SALARY_ADVANCE"),
        colSpan: 2,
        helperText: "Why you need the advance; the approver reads this before deciding.",
        props: { rows: 4, placeholder: "Why the money is needed." },
      },
      {
        // Keep the purpose beside the amount and expense estimate. It is part of the request
        // itself, not an attachment or a payment-method detail.
        name: "comments",
        label: "Request Details",
        type: "textarea",
        required: true,
        when: takesDescription,
        colSpan: 2,
        helperText: "What the money is for and how it will be used; the approver reads this.",
        props: { rows: 4, placeholder: "Explain what this advance is for and how it will be used." },
      },
    ],
  },
  {
    id: "expenses",
    title: "Expenses",
    when: hasExpenses,
    // The repeating rows are their own component: a table of lines is not a field.
    render: ({ context }) => context?.expenseLines || null,
    fields: [],
  },
  {
    id: "attachments",
    title: "Attachments",
    fields: [
      {
        name: "bills",
        label: "Upload all the Bills",
        type: "file",
        when: takesBills,
        colSpan: 2,
        helperText: "Photos of every bill behind this request, up to ten images.",
        props: { image: true, accept: ".avif,.jpeg,.jpg,.png,.webp", maxFiles: 10 },
      },
      {
        name: "qrCode",
        label: (values) => values.type === "VENDOR_PAYMENT" ? "Upload Vendor QR Code" : "Upload your QR Code",
        type: "file",
        colSpan: 2,
        // Not asked of an expense excess: that is money going back to the studio, so there is
        // nobody to pay and nowhere to pay them.
        /*
         * An excess is the employee handing money back, so there is nobody to pay and no QR code to
         * pay it to. Which settlement that is comes down with the list (`means_excess` on the row)
         * rather than being the literal "Expense Excess" compared here and again on the server.
         */
        when: (values, context) => !(values.type === "EXPENSE_SUBMISSION"
          && values.settlement === (context?.options?.excessSettlement || SETTLEMENT_EXCESS)),
        helperText: (values) => values.type === "VENDOR_PAYMENT" ? "The vendor's payment QR code, so the studio knows where to send the money." : "Your payment QR code, so the studio knows where to send the money.",
        // One only: the QR code is where this money should land, and two of them name two places.
        props: { image: true, accept: ".avif,.jpeg,.jpg,.png,.webp", maxFiles: 1 },
      },
    ],
  },
];

/**
 * What Accounts adds when it releases the money: how it actually moved.
 *
 * The request says who is owed what and why, and the approval says yes; neither knows how it was
 * paid, so that is asked when the money leaves and the entry is written from both halves. The
 * fields mirror the cash entry's own, because that is exactly what they become — including the
 * direction, since an expense submission that came in under its advance is money returning.
 *
 * These were the approval form's until approving and paying were split in two. Approving asks for a
 * remark and nothing else now; this is Accounts Manager → Pending → Record Payment.
 */
/** Says where the accounts come from when the list is empty, rather than opening an empty dropdown. */
const paymentAccountProps = (context, chosen) => {
  const ready = (context?.options?.accounts || []).length;
  return { searchable: true, disabled: !ready, placeholder: ready ? chosen : "Add a bank account in Accounts Settings" };
};

export const paymentFormSections = [
  {
    id: "decision",
    title: "Record Payment",
    summary: (values, context) => [
      ["Request ID", context.request.requestCode],
      ["Type", context.request.typeLabel],
      ["Raised By", context.request.requestedByName],
      ["Amount", context.request.amountText],
      ["Request Details", context.request.comments || context.request.reason],
      ["Branch", context.request.branch],
      ["Records", context.request.direction === "Received" ? "Cash Received" : "Cash Spent"],
    ],
    // The lines the amount is made of, between what is being approved and how it will be paid:
    // releasing money without seeing what it covers is the one thing this screen must not ask for.
    render: ({ context }) => context?.expenseBreakdown || null,
    fields: [
      { name: "entryDate", label: "Payment Date", type: "date", required: true, helperText: "The day the money actually moved; a future date is not allowed.", props: { restriction: "future" } },
      { name: "paymentMode", label: "Payment Mode", type: "select", required: true, options: "paymentModes", helperText: "How the money moved; it decides which reference or account is asked next.", clears: ["transactionId", "receivedAccount", "paidFromAccount", "paymentModeOther"] },
      {
        name: "paymentModeOther",
        label: "Payment Mode Details",
        required: true,
        when: (values) => values.paymentMode === "Other",
        helperText: "Say how this payment was actually made, since Other alone does not.",
        props: { placeholder: "e.g. Cheque, adjustment against an advance" },
      },
      {
        name: "transactionId",
        label: (values) => values.paymentMode === "UPI" ? "UPI Transaction ID" : `${values.paymentMode || "Payment"} Reference Number`,
        required: true,
        when: (values, context) => (context?.modesWithTransactionId || []).includes(values.paymentMode),
        helperText: "The reference the payment app or bank gave, kept as proof the payment went through.",
        props: (values) => ({ placeholder: values.paymentMode === "UPI" ? "Reference from the payment app" : "Reference from the bank" }),
      },
      {
        name: "receivedAccount",
        label: "Received Account",
        required: true,
        type: "select",
        when: (values, context) => context?.received && (context?.modesWithAccount || []).includes(values.paymentMode),
        helperText: "The studio account the returned money went into.",
        options: "accounts",
        props: (values, context) => paymentAccountProps(context, "Account the money went into"),
      },
      {
        name: "paidFromAccount",
        label: "Paid From Account",
        required: true,
        type: "select",
        when: (values, context) => !context?.received && (context?.modesWithAccount || []).includes(values.paymentMode),
        helperText: "The studio account the money was paid out of.",
        options: "accounts",
        props: (values, context) => paymentAccountProps(context, "Account the money was paid from"),
      },
      {
        name: "handler",
        label: (values, context) => context?.received ? "Receiver" : "Paid By",
        type: "select",
        required: true,
        options: "handlers",
        helperText: "The employee who handled the money; choose Other for someone off the payroll.",
        clears: ["handlerOtherName"],
        props: (values, context) => ({ searchable: true, placeholder: context?.received ? "Select the employee who took the money" : "Select the employee who paid it out" }),
      },
      {
        name: "handlerOtherName",
        label: (values, context) => context?.received ? "Receiver's Name" : "Payer's Name",
        required: true,
        when: (values, context) => values.handler === context?.otherHandler,
        helperText: "The full name of the person outside the payroll who handled the money.",
        props: (values, context) => ({ placeholder: context?.received ? "Name of the person who received it" : "Name of the person who paid it out" }),
      },
      {
        // After Paid By, not before it: the approver settles who released the money, then who took
        // it. Only money going out has a payee, and it arrives pre-filled with the vendor or the
        // person who raised the request, staying editable because the approver may know better.
        name: "paidTo",
        label: "Payment To",
        required: true,
        when: (values, context) => !context?.received,
        helperText: "Filled in with the vendor or requester; change it if someone else was paid.",
        props: { placeholder: "Who the payment went to" },
      },
      {
        // The request's bills say what was owed; this says it was paid, and is stored on the cash
        // entry rather than the request for exactly that reason.
        name: "paymentProof",
        label: "Payment Proof",
        type: "file",
        colSpan: 2,
        helperText: "Optional screenshot or receipt showing the money was paid, up to five images.",
        props: { image: true, accept: ".avif,.jpeg,.jpg,.png,.webp", maxFiles: 5 },
      },
      { name: "remarks", label: "Remarks", type: "textarea", colSpan: 2, helperText: "Optional note kept on the cash entries this writes.", props: { rows: 3, placeholder: "Anything worth keeping with this payment." } },
    ],
  },
];

export const requestInitialValues = {
  vendorId: "",
  type: "",
  amount: "",
  reason: "",
  comments: "",
  repaymentPlan: "",
  repaymentMonths: "",
  settlement: "",
  qrCode: [],
  bills: [],
};

export const emptyExpenseLine = { shootId: "", expenseDate: "", expenseType: "", description: "", amount: "" };

/**
 * What the expense lines call themselves, which is not the same question in all three cases.
 *
 * One table was asking one set of words of three different things. Every line said "the day the
 * money **was** spent" and "Expense Amount", which is true only of money already gone:
 *
 *   * An **advance against expenses** is money wanted *before* it is spent, so the day it asks for
 *     is the day it is needed - which is usually still to come, and the form refused exactly that -
 *     and the figure is an estimate, not a receipt.
 *   * An **excess** is unspent advance money being handed *back*. There is nothing it was spent on,
 *     so it is not asked (`asksExpenseType`), and the amount is what is being returned.
 *   * A **reimbursement**, and a vendor's bill, are money already spent, which is what the original
 *     wording described.
 *
 * Written here rather than in the table so the three readings sit side by side and can be compared,
 * and so the server's own rule about the expense type has one counterpart to match.
 */
const LINES_SPENT = {
  heading: "Expense lines",
  item: "Expense",
  shootHelp: "The shoot this was spent on; leave as General if none.",
  dateLabel: "Expense Date",
  dateHelp: "The day the money was spent; it cannot be a future day.",
  // What the date box refuses, in DateField's own words: "future", "past", or "none" for a box that
  // refuses nothing - which is what a day still to come needs.
  dateRestriction: "future",
  asksExpenseType: true,
  typeHelp: "What the money was spent on, such as travel or food.",
  typePlaceholder: "What was it spent on",
  amountLabel: "Expense Amount",
  amountHelp: "The amount spent in rupees; it adds up to the request total.",
  descriptionHelp: "Any detail that helps the approver understand the expense.",
  total: "Total Expenses Submitted",
};

const LINES_PLANNED = {
  ...LINES_SPENT,
  heading: "Planned expenses",
  item: "Planned expense",
  shootHelp: "The shoot this money is needed for; leave as General if none.",
  dateLabel: "Date Needed",
  dateHelp: "The day the money is needed by; a day still to come is expected.",
  dateRestriction: "none",
  typeHelp: "What the money will be spent on, such as travel or food.",
  typePlaceholder: "What will it be spent on",
  amountLabel: "Estimated Amount",
  amountHelp: "What this is expected to cost; it adds up to the advance total.",
  descriptionHelp: "Any detail that helps the approver understand what the money is for.",
  total: "Estimated Advance Total",
};

const LINES_RETURNED = {
  ...LINES_SPENT,
  heading: "Money being returned",
  item: "Return",
  shootHelp: "The shoot the advance was taken for; leave as General if none.",
  dateLabel: "Date Returned",
  dateHelp: "The day the money is being handed back; it cannot be a future day.",
  asksExpenseType: false,
  amountLabel: "Amount Returned",
  amountHelp: "The unspent amount being handed back; it adds up to the total returned.",
  descriptionHelp: "Any detail that helps the approver understand what is being returned.",
  total: "Total Being Returned",
};

/**
 * Which of the three a form is filling in. `excessSettlement` comes down with the options, since
 * which settlement means the money comes back is a flag on the studio's own list rather than the
 * words "Expense Excess" - the same reading the QR code field and the server both take.
 */
export const expenseLineWording = ({ type, settlement, excessSettlement } = {}) => {
  if (type === "ADVANCE_EXPENSE") return LINES_PLANNED;
  if (type === "EXPENSE_SUBMISSION" && settlement === (excessSettlement || SETTLEMENT_EXCESS)) return LINES_RETURNED;
  return LINES_SPENT;
};

/**
 * The shoots a line may name, each labelled with the project it belongs to.
 *
 * One picker rather than two: a shoot already knows its project, so asking for the project first
 * and then narrowing to it made the reader answer the same question twice. The server reads the
 * project off the shoot and stores both.
 */
export const shootChoiceLabel = (shoot) => `${shoot.projectCode ? `${shoot.projectCode} — ` : ""}${shoot.shootId} ${shoot.shoot}`.trim();
