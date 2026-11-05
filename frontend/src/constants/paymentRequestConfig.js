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
  ["cashEntryCode", "Cash Entry", undefined, 150, 130],
  ["createdAt", "Raised On", "date", 150, 130],
  ["decidedAt", "Decided On", "date", 150, 130],
];

/** Pending reads amber, approved green, rejected red — the same reading the accounts dots give. */
export const requestStatusStyles = {
  PENDING: "bg-amber-500",
  APPROVED: "bg-emerald-500",
  REJECTED: "bg-red-500",
};

export const requestInfoSections = [
  { title: "Request", fields: [["requestCode", "Request ID"], ["typeLabel", "Type"], ["status", "Status"], ["amount", "Amount", "amount"], ["createdAt", "Raised On", "date"]] },
  { title: "Raised By", fields: [["requestedByName", "Name"], ["requestedByCode", "Employee ID"], ["requestedByDepartment", "Department"], ["branch", "Branch"]] },
  { title: "Details", fields: [["reason", "Reason"], ["comments", "Description"], ["repaymentPlan", "Repayment"], ["repaymentMonths", "Repayment Months"], ["settlement", "Excess / Reimbursement"], ["vendorName", "Vendor"], ["vendorPhone", "Vendor Phone"]] },
  // Rendered by the `expenses` formatter the page supplies, so a request's breakdown is readable
  // from the row without opening the approval form.
  { title: "Expenses", fields: [["expenses", "Lines", "expenses"]] },
  { title: "Decision", fields: [["decidedAt", "Decided On", "date"], ["decisionRemarks", "Remarks"], ["cashEntryCode", "Cash Entry"]] },
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
        // Switching back to the single payment drops the count, so a stale number cannot be saved
        // against an arrangement that no longer has months in it.
        clears: ["repaymentMonths"],
      },
      {
        name: "repaymentMonths",
        label: "Over How Many Months",
        required: true,
        when: (values) => values.type === "SALARY_ADVANCE" && values.repaymentPlan === REPAYMENT_OVER_MONTHS,
        props: { type: "number", min: 1, max: MAX_REPAYMENT_MONTHS, step: 1, inputMode: "numeric", placeholder: `1 to ${MAX_REPAYMENT_MONTHS}` },
      },
      {
        name: "vendorId",
        label: "Vendor",
        type: "select",
        required: true,
        when: isType("VENDOR_PAYMENT"),
        options: "vendors",
        // Picked from the vendor register rather than typed, so a name and a number already on
        // record cannot be re-entered differently here. The server reads both from that record.
        props: (values, context) => ({
          searchable: true,
          disabled: !(context?.options?.vendors || []).length,
          placeholder: (context?.options?.vendors || []).length ? "Select the vendor" : "No active vendors available",
        }),
      },
      {
        name: "settlement",
        label: "Excess or Reimbursement?",
        type: "radio",
        required: true,
        when: isType("EXPENSE_SUBMISSION"),
        options: SETTLEMENTS,
        colSpan: 2,
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
        // One only: the QR code is where this money should land, and two of them name two places.
        props: { image: true, accept: ".avif,.jpeg,.jpg,.png,.webp", maxFiles: 1 },
      },
      {
        name: "acceptTerms",
        label: "I agree to the terms & conditions",
        type: "checkbox",
        colSpan: 2,
      },
    ],
  },
];

/**
 * What an admin adds when approving: how the money actually moves.
 *
 * The request says who is owed what and why; it cannot know how it will be paid, so that is asked
 * at the moment of approval and the entry is written from both halves. The fields mirror the cash
 * entry's own, because that is exactly what they become — including the direction, since an expense
 * submission that came in under its advance is money returning to the studio.
 */
/** Says where the accounts come from when the list is empty, rather than opening an empty dropdown. */
const approvalAccountProps = (context, chosen) => {
  const ready = (context?.options?.accounts || []).length;
  return { searchable: true, disabled: !ready, placeholder: ready ? chosen : "Add a bank account in Accounts Settings" };
};

export const approvalFormSections = [
  {
    id: "decision",
    title: "Approve & Record Payment",
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
      { name: "entryDate", label: "Payment Date", type: "date", required: true, props: { restriction: "future" } },
      { name: "paymentMode", label: "Payment Mode", type: "select", required: true, options: "paymentModes", clears: ["transactionId", "receivedAccount", "paidFromAccount", "paymentModeOther"] },
      {
        name: "paymentModeOther",
        label: "Payment Mode Details",
        required: true,
        when: (values) => values.paymentMode === "Other",
        props: { placeholder: "e.g. Cheque, adjustment against an advance" },
      },
      {
        name: "transactionId",
        label: (values) => values.paymentMode === "UPI" ? "UPI Transaction ID" : `${values.paymentMode || "Payment"} Reference Number`,
        required: true,
        when: (values, context) => (context?.modesWithTransactionId || []).includes(values.paymentMode),
        props: (values) => ({ placeholder: values.paymentMode === "UPI" ? "Reference from the payment app" : "Reference from the bank" }),
      },
      {
        name: "receivedAccount",
        label: "Received Account",
        required: true,
        type: "select",
        when: (values, context) => context?.received && (context?.modesWithAccount || []).includes(values.paymentMode),
        options: "accounts",
        props: (values, context) => approvalAccountProps(context, "Account the money went into"),
      },
      {
        name: "paidFromAccount",
        label: "Paid From Account",
        required: true,
        type: "select",
        when: (values, context) => !context?.received && (context?.modesWithAccount || []).includes(values.paymentMode),
        options: "accounts",
        props: (values, context) => approvalAccountProps(context, "Account the money was paid from"),
      },
      {
        name: "handler",
        label: (values, context) => context?.received ? "Receiver" : "Paid By",
        type: "select",
        required: true,
        options: "handlers",
        clears: ["handlerOtherName"],
        props: (values, context) => ({ searchable: true, placeholder: context?.received ? "Select the employee who took the money" : "Select the employee who paid it out" }),
      },
      {
        name: "handlerOtherName",
        label: (values, context) => context?.received ? "Receiver's Name" : "Payer's Name",
        required: true,
        when: (values, context) => values.handler === context?.otherHandler,
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
        props: { placeholder: "Who the payment went to" },
      },
      {
        // The request's bills say what was owed; this says it was paid, and is stored on the cash
        // entry rather than the request for exactly that reason.
        name: "paymentProof",
        label: "Payment Proof",
        type: "file",
        colSpan: 2,
        props: { image: true, accept: ".avif,.jpeg,.jpg,.png,.webp", maxFiles: 5 },
      },
      { name: "remarks", label: "Remarks", type: "textarea", colSpan: 2, props: { rows: 3, placeholder: "Anything worth keeping with this decision." } },
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
  acceptTerms: false,
};

export const emptyExpenseLine = { shootId: "", expenseDate: "", expenseType: "", description: "", amount: "" };

/**
 * The shoots a line may name, each labelled with the project it belongs to.
 *
 * One picker rather than two: a shoot already knows its project, so asking for the project first
 * and then narrowing to it made the reader answer the same question twice. The server reads the
 * project off the shoot and stores both.
 */
export const shootChoiceLabel = (shoot) => `${shoot.projectCode ? `${shoot.projectCode} — ` : ""}${shoot.shootId} ${shoot.shoot}`.trim();

/**
 * Extra quotations, tabled the way every other module tables its records.
 *
 * `[key, header, type, size, minSize]`, the same shape the requests above use, so the column
 * menu, the resizing, the filters and the CSV export all behave identically — an extra is a
 * different record, not a different kind of screen.
 */
export const extraQuotationTableFields = [
  ["requestCode", "Request ID", undefined, 140, 120],
  ["status", "Status", "status", 160, 140],
  ["service", "Service", undefined, 200, 160],
  ["amount", "Amount", "amount", 140, 120],
  ["projectCode", "Event ID", undefined, 150, 130],
  ["projectName", "Project", undefined, 220, 170],
  ["shootCode", "Shoot ID", undefined, 140, 120],
  ["shootName", "Shoot", undefined, 180, 150],
  ["requestedByName", "Added By", undefined, 180, 150],
  ["projectManager", "Approver", undefined, 180, 150],
  ["remarks", "Remarks", undefined, 260, 200],
  ["decisionRemarks", "Decision Remarks", undefined, 240, 180],
  ["createdAt", "Raised On", "date", 150, 130],
  ["decidedAt", "Decided On", "date", 150, 130],
];

/** Waiting, agreed, or turned down — the three states an extra can be read in. */
export const extraQuotationStatusStyles = {
  PENDING: "bg-amber-500",
  APPROVED: "bg-emerald-500",
  REJECTED: "bg-red-500",
};

export const extraQuotationInfoSections = [
  { title: "Extra", fields: [["requestCode", "Request ID"], ["status", "Status"], ["service", "Service"], ["amount", "Amount", "amount"], ["createdAt", "Raised On", "date"]] },
  { title: "Filed Against", fields: [["projectCode", "Event ID"], ["projectName", "Project"], ["shootCode", "Shoot ID"], ["shootName", "Shoot"], ["shootDate", "Shoot Date", "date"]] },
  { title: "Raised By", fields: [["requestedByName", "Added By"], ["remarks", "Remarks"]] },
  { title: "Decision", fields: [["projectManager", "Approver"], ["decidedAt", "Decided On", "date"], ["decisionRemarks", "Decision Remarks"]] },
  // Drops itself when there is nothing attached, as the payment proof gallery does. The stored
  // key is still `proofUrls`; only what the reader is shown changed.
  { title: "Attachments", fields: [["proofUrls", "Files", "gallery"]] },
];
