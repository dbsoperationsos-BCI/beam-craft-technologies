/**
 * The Accounts Manager, described as data for the shared components to draw: the tabs above the
 * table, the table's own columns, the info panel beside it, and the two forms that record an entry.
 *
 * Cash moves in or out, and which it is, is the first thing asked and the last thing that can be
 * changed — an entry's identifier carries its direction. Both directions are one record and one
 * table, so most of what follows is shared and only the few direction-only fields differ: money in
 * lands in a studio account, money out goes to somebody.
 */

export const ENTRY_TYPES = ["Received", "Spent"];
/** "Advance Settlement" is an employee handing back what was left of an expense advance. */
export const RECEIVED_CATEGORIES = ["Advance", "Partial Payment", "Extras", "Final Settlement", "Advance Settlement"];
/** Placeholder until Accounts settles its own spend list; changing this array is the whole change. */
export const SPENT_CATEGORIES = ["Vendor Payment", "Freelancer Payment", "Salary Advance", "Employee Expense", "Travel", "Equipment", "Office Expense", "Client Refund", "Other"];
export const CATEGORIES_BY_TYPE = { Received: RECEIVED_CATEGORIES, Spent: SPENT_CATEGORIES };
/**
 * How the money moved, and what each way of moving it asks for. Mirrors the server.
 *
 * A mode that arrives with a reference from the payment app or the bank asks for it — for a
 * transfer that reference is the proof it went through. A mode that moves money through an account
 * asks which one. Cash does neither, and is the only mode asking for nothing beyond the receiver
 * every entry names.
 */
export const MODES_WITH_TRANSACTION_ID = ["UPI", "Bank Transfer", "Net Banking"];
export const MODES_WITH_ACCOUNT = ["Bank Transfer", "Net Banking", "Credit / Debit Cards"];
// "Other" is the way out for anything the four named modes do not cover — a cheque, an adjustment,
// a swap. Like cash it asks for neither a reference nor an account; what it actually was belongs in
// the entry's description.
export const PAYMENT_MODES = ["UPI", "Bank Transfer", "Net Banking", "Cash", "Credit / Debit Cards", "Other"];
/** The person who is not on the payroll, and so is typed rather than picked. */
export const OTHER_HANDLER = "Other";
/** The mode the named five do not cover, which then says what it actually was. */
export const OTHER_PAYMENT_MODE = "Other";

/** What a studio account can be. Mirrors the server's own list in master-data/definitions.js. */
export const BANK_ACCOUNT_TYPES = ["Savings", "Current", "Overdraft", "Cash Credit"];

/** The details shown under each account in Settings, in the order they are read. */
export const bankAccountFields = [
  ["accountNumber", "Account Number"],
  ["ifscCode", "IFSC / Routing Code"],
  ["accountType", "Account Type"],
];

/**
 * The direction, offered as radio choices at the top of the form rather than as a step before it.
 * The fields below react to the answer as it changes, so the difference between the two is read
 * beside what each one asks for instead of on a screen that then disappears.
 */
export const entryTypeChoices = [
  { value: "Received", label: "Cash Received", description: "Money coming in from a client." },
  { value: "Spent", label: "Cash Spent", description: "Money going out to a vendor, a freelancer or anyone else." },
];

export const isReceived = (values) => values.entryType === "Received";
/*
 * What the chosen mode asks for, read off the payment mode list.
 *
 * The list is the studio's now - Settings → Field Settings → Accounts → Payment Mode - and each mode
 * carries whether it wants a reference, an account, or a line saying what the payment actually was.
 * These were the three arrays above, so a mode the studio added asked for nothing and a mode it
 * renamed stopped asking.
 *
 * `context` is where the screen hands the answer over, and the arrays above are the fallback for a
 * caller that has none: an unseeded list, or a page still loading. Same shape as `when(values,
 * context)`, which is how the field list calls these.
 */
const listed = (context, key, fallback) => {
  const value = context?.[key];
  return Array.isArray(value) && value.length ? value : fallback;
};

export const needsTransactionId = (values, context) =>
  listed(context, "modesWithTransactionId", MODES_WITH_TRANSACTION_ID).includes(values.paymentMode);
export const needsAccount = (values, context) =>
  listed(context, "modesWithAccount", MODES_WITH_ACCOUNT).includes(values.paymentMode);
export const needsModeDetails = (values, context) =>
  listed(context, "modesWithDetails", [OTHER_PAYMENT_MODE]).includes(values.paymentMode);
export const handlerIsOther = (values) => values.handler === OTHER_HANDLER;

/**
 * What choosing a project or a shoot settles for the rest of the form: the client, and the branch.
 *
 * Neither is a field. Both are read off the project on the server when the entry is saved — the
 * branch decides whose books the money lands in and is nobody's to choose, so asking for it only
 * offered the way to an entry whose branch and project disagreed. The summary under the picker shows
 * what will be stored, which is why choosing what the entry is filed against is now required.
 */
const findLookup = (context, key, id) => (context?.lookups?.[key] || []).find((item) => item.id === id) || null;

export const shootFor = (values, context) => findLookup(context, "shoots", values.shootId);
export const projectFor = (values, context) => findLookup(context, "projects", values.projectId);

/**
 * Every shoot, each labelled with the project it belongs to.
 *
 * Money out names only the shoot. The shoot knows its project and the project knows its client, so
 * asking for all three asked twice for something already on record and let the answers disagree.
 *
 * A form opened from a project narrows the list to that project's shoots. The entry is already
 * filed against it, and the server refuses a shoot from a different one, so offering every studio
 * shoot would only be offering the way to a rejected save.
 */
const shootChoices = (values, context) => (context?.lookups?.shoots || [])
  .filter((shoot) => !context?.fixedProject || shoot.project?.id === context.fixedProject.id)
  .map((shoot) => ({ value: shoot.id, label: `${shoot.project?.eventId ? `${shoot.project.eventId} — ` : ""}${shoot.shootId} ${shoot.shoot}`.trim() }));

/** Says where the list comes from when it is empty, rather than opening a dropdown with nothing in it. */
const accountProps = (context, chosen) => {
  const ready = (context?.options?.accounts || []).length;
  return { searchable: true, disabled: !ready, placeholder: ready ? chosen : "Add a bank account in Settings" };
};

/** A picker is only useful once its list has arrived, and says so rather than opening empty. */
const projectProps = (values, context) => {
  const ready = (context?.options?.projects || []).length;
  return { searchable: true, disabled: !ready, placeholder: ready ? "Select the project" : "No projects available" };
};

const shootProps = (values, context) => {
  const count = shootChoices(values, context).length;
  const empty = context?.fixedProject ? "This project has no shoots yet" : "No shoots available";
  return { searchable: true, disabled: !count, placeholder: count ? "Select the shoot this was spent on" : empty };
};

/** The tabs split the list by direction, which is the first cut Accounts reads it by. */
export const accountsTabs = [
  { label: "All", entryTypes: null },
  { label: "Received", entryTypes: ["Received"] },
  { label: "Spent", entryTypes: ["Spent"] },
];

/**
 * `[key, header, type, size, minSize]`, the same shape the other module tables use. One set of
 * columns covers both directions: the two that belong to one direction read "—" on the other, which
 * is what every empty cell in every other module table already reads.
 */
export const accountsTableFields = [
  ["entryId", "Entry ID", undefined, 150, 130],
  ["entryType", "Type", "status", 130, 110],
  ["clientName", "Client Name", undefined, 210, 170],
  // What the entry was filed against. Money out carries a shoot, money in a project, so each reads
  // "—" on the other direction, as every other direction-only column here already does.
  ["shootCode", "Shoot ID", undefined, 150, 130],
  ["projectCode", "Event ID", undefined, 150, 130],
  ["category", "Category", undefined, 190, 160],
  ["amount", "Amount", "amount", 150, 130],
  ["entryDate", "Date", "date", 150, 130],
  ["branch", "Branch", undefined, 170, 140],
  ["paymentMode", "Payment Mode", undefined, 160, 140],
  ["paymentModeOther", "Payment Mode Details", undefined, 190, 150],
  ["transactionId", "Transaction ID", undefined, 190, 150],
  ["receivedAccount", "Received Account", undefined, 190, 150],
  ["paidFromAccount", "Paid From Account", undefined, 190, 150],
  ["paidTo", "Payment To", undefined, 200, 160],
  ["handlerName", "Received / Paid By", undefined, 200, 160],
  ["handlerEmployeeCode", "Employee ID", undefined, 150, 130],
  ["description", "Description", undefined, 260, 200],
];

export const accountsInfoSections = [
  { title: "Entry", fields: [["entryId", "Entry ID"], ["entryType", "Type"], ["entryDate", "Date", "date"], ["category", "Category"], ["amount", "Amount", "amount"]] },
  { title: "Client", fields: [["clientName", "Client Name"], ["branch", "Branch"]] },
  { title: "Filed Against", fields: [["projectCode", "Event ID"], ["shootCode", "Shoot ID"], ["shootName", "Shoot"], ["shootDate", "Shoot Date", "date"]] },
  { title: "Payment", fields: [["paymentMode", "Payment Mode"], ["paymentModeOther", "Payment Mode Details"], ["transactionId", "Transaction ID / Reference"], ["receivedAccount", "Received Account"], ["paidFromAccount", "Paid From Account"], ["paidTo", "Payment To"]] },
  { title: "Handled By", fields: [["handlerName", "Received / Paid By"], ["handlerEmployeeCode", "Employee ID"], ["handlerDepartment", "Department"]] },
  { title: "Notes", fields: [["description", "Description"]] },
  // A gallery with nothing in it drops itself and takes this section with it, so an entry filed
  // without a receipt shows no empty heading.
  { title: "Payment Proof", fields: [["paymentProofUrls", "Files", "gallery"]] },
];

/** The direction dot in the table: money in reads green, money out red. */
export const accountsStatusStyles = {
  Received: "bg-emerald-500",
  Spent: "bg-red-500",
};

/**
 * The direction, shown above the first section rather than inside it: it is not one of the Entry
 * Details, it is the question every section below answers. Changing it re-asks the whole form.
 *
 * Locked once filed — an entry's identifier carries its direction, so an edit reads it back instead
 * of offering it.
 */
export const cashEntryLeadFields = [
    {
      name: "entryType",
      label: "Entry Type",
      type: "radio",
      required: true,
      colSpan: 2,
      options: entryTypeChoices,
      // A bare line of choices, no box: it introduces the form rather than sitting among inputs.
      props: { controlClassName: "px-0 py-0" },
      when: (values, context) => !context?.locked,
      clears: ["category", "receivedAccount", "paidFromAccount", "paidTo", "shootId"],
    },
    { name: "entryTypeLocked", type: "custom", colSpan: 2, when: (values, context) => Boolean(context?.locked) },
];

/**
 * The form Accounts fills in, in either direction.
 *
 * Three answers decide what else is asked for. The direction picked in the form's first step settles
 * the category list and swaps the account for who the payment went to. A payment mode that carries
 * a reference asks for it and one that moves money through an account asks which, so `clears` empties
 * both on every change of mode — cash asks for neither. And the person is picked from the employees,
 * unless it was somebody outside the payroll, in which case "Other" asks for the name.
 */
export const cashEntryFormSections = [
  {
    id: "entry",
    title: "Entry Details",
    fields: [
      // What the money was against — and with it, who it was with and whose books it lands in. Money
      // in names the project; money out names one of its shoots, since spend is per shoot while
      // money comes in for the project as a whole. Either way the client and the branch are read off
      // that project on save rather than typed, so none of the three can disagree; the summary below
      // shows what will be stored.
      //
      // Required, both of them, and that is what the branch costs: an entry that named no project
      // had no branch to be worked out from, and the branch is what decides whose books it lands in.
      // A spend against no project — an office expense, a salary advance — is raised as a payment
      // request instead, which resolves its own branch and writes the entry when it is approved.
      //
      // A form opened from a project's own Payments tab has that project settled before it opens:
      // the picker goes, the summary below names what was chosen for it, and money out is offered
      // that project's shoots alone — which shoot is then the one thing left to answer.
      {
        name: "projectId",
        label: "Project",
        type: "select",
        required: true,
        options: "projects",
        when: (values, context) => isReceived(values) && !context?.fixedProject,
        props: projectProps,
      },
      {
        name: "shootId",
        label: "Shoot ID",
        type: "select",
        required: true,
        options: shootChoices,
        when: (values) => !isReceived(values),
        props: shootProps,
      },
      { name: "linkSummary", type: "custom", colSpan: 2 },
      { name: "category", label: "Category", type: "select", required: true, options: (values) => CATEGORIES_BY_TYPE[values.entryType] || [] },
      { name: "amount", label: "Amount", required: true, props: { type: "number", min: 0, step: "0.01", inputMode: "decimal", placeholder: "0.00" } },
      { name: "entryDate", label: (values) => isReceived(values) ? "Received Date" : "Spent Date", type: "date", required: true, props: { restriction: "future" } },
    ],
  },
  {
    id: "payment",
    title: "Payment",
    fields: [
      { name: "paymentMode", label: "Payment Mode", type: "select", required: true, options: "paymentModes", clears: ["transactionId", "receivedAccount", "paidFromAccount", "paymentModeOther"] },
      {
        name: "transactionId",
        // UPI hands back a transaction ID; a transfer hands back a reference, which is the proof it
        // went through. Same column, named as the mode names it.
        label: (values) => values.paymentMode === "UPI" ? "UPI Transaction ID" : `${values.paymentMode || "Payment"} Reference Number`,
        required: true,
        when: needsTransactionId,
        props: (values) => ({ placeholder: values.paymentMode === "UPI" ? "Reference from the payment app" : "Reference from the bank" }),
      },
      {
        name: "paymentModeOther",
        label: "Payment Mode Details",
        required: true,
        when: (values, context) => needsModeDetails(values, context),
        props: { placeholder: "e.g. Cheque, adjustment against an advance" },
      },
      {
        name: "receivedAccount",
        label: "Received Account",
        required: true,
        type: "select",
        when: (values, context) => isReceived(values) && needsAccount(values, context),
        // Picked from the accounts maintained in Settings, not typed: the same account arriving as
        // three spellings is what stopped any report grouping by it.
        options: "accounts",
        props: (values, context) => accountProps(context, "Account the money went into"),
      },
      {
        name: "paidFromAccount",
        label: "Paid From Account",
        required: true,
        type: "select",
        when: (values, context) => !isReceived(values) && needsAccount(values, context),
        options: "accounts",
        props: (values, context) => accountProps(context, "Account the money was paid from"),
      },
      {
        name: "paidTo",
        label: "Payment To",
        required: true,
        when: (values) => !isReceived(values),
        props: { placeholder: "Who the payment went to" },
      },
      // Who handled the money, whichever way it moved. It sits here rather than in a section of its
      // own: two fields, one of which is usually hidden, did not fill a section, and who handled a
      // payment is part of the payment. The employees are offered by name, and "Other (not an
      // employee)" opens the box beside it for anyone off the payroll — a freelancer, a client's
      // own runner. The pair shares a stem so the second field reads as the first one answered by
      // hand, and "Paid By" matches the "Received / Paid By" this column is called elsewhere.
      {
        name: "handler",
        label: (values) => isReceived(values) ? "Receiver" : "Paid By",
        type: "select",
        required: true,
        options: "handlers",
        clears: ["handlerOtherName"],
        props: (values) => ({ searchable: true, placeholder: isReceived(values) ? "Select the employee who took the money" : "Select the employee who paid it out" }),
      },
      {
        name: "handlerOtherName",
        label: (values) => isReceived(values) ? "Receiver's Name" : "Payer's Name",
        required: true,
        when: handlerIsOther,
        props: (values) => ({ placeholder: isReceived(values) ? "Name of the person who received it" : "Name of the person who paid it out" }),
      },
      // The receipt, bill or screenshot behind the payment. Compressed in the browser and again on
      // the server before it reaches the bucket, the way every other image in the app is, and on a
      // phone the picker offers the camera so a paper receipt can be photographed where it is
      // handed over. Optional — plenty of cash changes hands without one.
      {
        name: "paymentProof",
        label: (values) => isReceived(values) ? "Receipt / Proof" : "Bill / Proof",
        type: "file",
        colSpan: 2,
        props: { image: true, accept: ".avif,.jpeg,.jpg,.png,.webp", maxFiles: 5 },
      },
    ],
  },
  {
    id: "notes",
    title: "Description",
    columns: 1,
    fields: [
      { name: "description", label: "Description", type: "textarea", colSpan: 2, props: { rows: 4, placeholder: "Anything worth keeping with this entry." } },
    ],
  },
];

export const cashEntryInitialValues = {
  entryType: "",
  shootId: "",
  projectId: "",
  category: "",
  amount: "",
  entryDate: "",
  paymentMode: "",
  transactionId: "",
  paymentModeOther: "",
  receivedAccount: "",
  paidFromAccount: "",
  paidTo: "",
  handler: "",
  handlerOtherName: "",
  description: "",
  paymentProof: [],
};

/**
 * The advance that opens a project, as Create Project asks for it.
 *
 * Money in against a project that does not exist yet, so it is the cash entry form from the category
 * down to the description and nothing above it: which project the money is against is the one being
 * created, and with it the client and the branch it settles. Derived from the list above rather than
 * written out again, so a field added to a cash entry is asked for here too.
 */
export const projectAdvanceFormSections = cashEntryFormSections.map((section) => ({
  ...section,
  fields: section.fields.filter((field) => !["projectId", "shootId", "linkSummary"].includes(field.name)),
}));

/** The advance as an unfilled form. Its direction is settled by what it is: money coming in. */
export const projectAdvanceInitialValues = { ...cashEntryInitialValues, entryType: "Received" };

/**
 * What a cash entry must answer before it can be saved, in the order the form asks it.
 *
 * Shared by the Accounts form and the advance on Create Project so the two cannot drift — the second
 * records the same entry through the same endpoint, and only differs in supplying the link from the
 * project it is created alongside rather than from a picker. Returns the first problem as a sentence,
 * or "" when there is none.
 */
/*
 * `context` is the screen's own - the same object the fields were drawn with - so what is checked
 * here and what was asked for on screen cannot disagree about a payment mode. Optional, and the
 * arrays fall back where it is absent, which is what the server enforces anyway.
 */
export function validateCashEntry(values, { requireLink = true, context } = {}) {
  const received = isReceived(values);
  // The link is what the entry's client and branch are read from on the server, so it is the one
  // answer nothing else can stand in for.
  if (requireLink) {
    if (received && !values.projectId) return "Select the project this was received for.";
    if (!received && !values.shootId) return "Select the shoot this was spent on.";
  }
  if (!values.category) return "Choose a category.";
  if (!(Number(values.amount) > 0)) return "Enter an amount greater than zero.";
  if (!values.entryDate) return `Enter the date the money was ${received ? "received" : "spent"}.`;
  if (!values.paymentMode) return "Choose the payment mode.";
  if (needsModeDetails(values, context) && !String(values.paymentModeOther || "").trim()) return "Say what the payment mode was.";
  if (needsTransactionId(values, context) && !String(values.transactionId || "").trim()) {
    return values.paymentMode === "UPI" ? "Enter the UPI transaction ID." : `Enter the ${values.paymentMode} reference number.`;
  }
  if (needsAccount(values, context)) {
    if (received && !String(values.receivedAccount || "").trim()) return "Enter the account the money went into.";
    if (!received && !String(values.paidFromAccount || "").trim()) return "Enter the account the money was paid from.";
  }
  if (!received && !String(values.paidTo || "").trim()) return "Enter who the payment went to.";
  if (!values.handler) return `Choose who ${received ? "received the money" : "paid the money out"}.`;
  if (handlerIsOther(values) && !String(values.handlerOtherName || "").trim()) return `Enter who ${received ? "received the money" : "paid the money out"}.`;
  return "";
}

/** Empty, whitespace, null and undefined are "not answered"; a picked file list is answered by length. */
function answered(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value === null || value === undefined) return false;
  return String(value).trim().length > 0;
}

/**
 * The same requirements as `validateCashEntry`, but keyed by field rather than as one sentence.
 *
 * `validateCashEntry` answers "what is the first thing wrong", which is what a form wants when it
 * has one line to say it in. This answers "what is wrong, and where", which is what a form wants
 * when it marks the inputs themselves — Create Project's Payment Received, where the reader needs
 * to see the four outstanding boxes rather than be told about them one press at a time.
 *
 * Read off the field list rather than restated: `required` and `when` on each field already say
 * which answers are wanted and when they apply, so a field added to a cash entry is required here
 * without this function being touched. Only the rules the list cannot express are written out —
 * an amount has to be a number above zero, which "not blank" does not cover.
 *
 * `sections` is which form is being checked: `cashEntryFormSections` for Accounts' own, and
 * `projectAdvanceFormSections` for the advance on Create Project, which has no project picker
 * because the project it belongs to is the one being created. `context` matters because some
 * fields ask to be shown only under it — a form opened from a project's Payments tab has its
 * project settled already, and must not then be asked for one.
 */
export function cashEntryProblems(values, { requireLink = true, sections = cashEntryFormSections, context } = {}) {
  const problems = {};
  for (const section of sections) {
    for (const field of section.fields || []) {
      if (!field.required) continue;
      if (field.when && !field.when(values, context)) continue;
      if (!answered(values?.[field.name])) problems[field.name] = "Required";
    }
  }
  // Answered but not a payment: the column takes an amount, and "0" or "-50" is neither blank nor
  // money, so saying so here is what stops the endpoint being the first thing to mention it.
  if (!problems.amount && !(Number(values?.amount) > 0)) problems.amount = "Enter an amount greater than zero.";
  // A form that supplies the link itself is not asked for one, however the field list is written.
  if (!requireLink) {
    delete problems.projectId;
    delete problems.shootId;
  }
  return problems;
}

/**
 * The entry as the server takes it, from the answers the form holds.
 *
 * The fields that do not belong to the direction or the payment mode are sent as null rather than
 * left out, so an entry corrected from one mode to another cannot keep the reference the first one
 * asked for. `links` is how a caller that knows the project without having asked for it — Create
 * Project, saving the advance against the project it has just created — supplies one.
 *
 * No branch: it is the Source Branch of the project named here, read on the server.
 */
/** `context` for the same reason `validateCashEntry` takes one: what is sent must match what was asked. */
export function cashEntryPayload(values, links = {}, context = undefined) {
  const received = isReceived(values);
  const other = handlerIsOther(values);
  const trimmed = (key) => String(values[key] || "").trim();
  return {
    entryType: values.entryType,
    // Money in is against the project alone; money out names one of its shoots as well.
    projectId: links.projectId ?? (values.projectId || null),
    shootId: received ? null : (links.shootId ?? (values.shootId || null)),
    category: values.category,
    amount: Number(values.amount),
    entryDate: values.entryDate,
    paymentMode: values.paymentMode,
    transactionId: needsTransactionId(values, context) ? trimmed("transactionId") : null,
    paymentModeOther: values.paymentMode === OTHER_PAYMENT_MODE ? trimmed("paymentModeOther") : null,
    // Only the modes that move money through an account carry one, and only in their direction.
    receivedAccount: received && needsAccount(values, context) ? trimmed("receivedAccount") : null,
    paidFromAccount: !received && needsAccount(values, context) ? trimmed("paidFromAccount") : null,
    paidTo: received ? null : trimmed("paidTo"),
    handlerEmployeeId: other ? null : Number(values.handler),
    handlerName: other ? trimmed("handlerOtherName") : null,
    handlerIsOther: other,
    description: trimmed("description") || null,
    paymentProof: Array.isArray(values.paymentProof) ? values.paymentProof : [],
  };
}
