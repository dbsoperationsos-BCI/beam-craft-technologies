/**
 * The Accounts Manager, described as data for the shared components to draw: the tabs above the
 * table, the table's own columns, the info panel beside it, and the two forms that record an entry.
 *
 * Cash moves in or out, and which it is, is the first thing asked and the last thing that can be
 * changed — an entry's identifier carries its direction. Both directions are one record and one
 * table, so most of what follows is shared and only the few direction-only fields differ: money in
 * lands in a studio account, money out goes to somebody.
 */

export const ENTRY_TYPES = ["Received", "Spent", "Transfer"];
/** "Advance Settlement" is an employee handing back what was left of an expense advance. */
export const RECEIVED_CATEGORIES = ["Advance", "Partial Payment", "Extras", "Final Settlement", "Advance Settlement"];
/** Placeholder until Accounts settles its own spend list; changing this array is the whole change. */
export const SPENT_CATEGORIES = ["Vendor Payment", "Freelancer Payment", "Salary Advance", "Employee Expense", "Travel", "Equipment", "Office Expense", "Client Refund", "Other"];
/** A transfer has the one category, filled in rather than asked. */
export const TRANSFER_CATEGORY = "Branch Transfer";
export const CATEGORIES_BY_TYPE = { Received: RECEIVED_CATEGORIES, Spent: SPENT_CATEGORIES, Transfer: [TRANSFER_CATEGORY] };
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

/*
 * `BANK_ACCOUNT_TYPES` and `bankAccountFields` were here, and went with the screen that read them:
 * Accounts -> ⋮ -> Settings, which kept a bank-account list of its own as HRM master data. The
 * studio's accounts live on the branch they belong to now - Settings -> Organization -> Branches -
 * and an entry's "received into" list is built from those (`services/branchBankAccounts.js` on the
 * server, which is also where the label it stores comes from).
 */

/**
 * The direction, offered as radio choices at the top of the form rather than as a step before it.
 * The fields below react to the answer as it changes, so the difference between the two is read
 * beside what each one asks for instead of on a screen that then disappears.
 */
export const entryTypeChoices = [
  { value: "Received", label: "Cash Received", description: "Money coming in from a client." },
  { value: "Spent", label: "Cash Spent", description: "Money going out to a vendor, a freelancer or anyone else." },
  { value: "Transfer", label: "Branch Transfer", description: "Money moving from one branch's account to another's." },
];

export const isReceived = (values) => values.entryType === "Received";

/*
 * "Settles payment": money received against a project may settle one of its scheduled payments -
 * all of what is pending (Full) or part of it, the rest falling due on a date of its own (Partial),
 * as Accounts Manager's Clear and Partially paid do. `context.openPayments` is the project's
 * payments still open, read for the project chosen; none open, or none chosen, and the entry is not
 * tied to the schedule.
 */
/** A booking's schedule is not saved yet: its payments are named by their place, `schedule-0` for the first. */
export const bookingSchedulePrefix = "schedule-";
export const SETTLE_FULL = "FULL";
export const SETTLE_PARTIAL = "PARTIAL";
export const settleModeChoices = [
  { value: SETTLE_FULL, label: "Full payment" },
  { value: SETTLE_PARTIAL, label: "Partial payment" },
];
const cents = (value) => Math.round(value * 100) / 100;
const rupees = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const dayLabel = (key) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${String(key).slice(0, 10)}T00:00:00Z`));
const asksSettles = (values, context) => isReceived(values) && (context?.openPayments || []).length > 0;
const settlesPartly = (values, context) => asksSettles(values, context) && values.settleMode === SETTLE_PARTIAL && Boolean(settledPaymentOf(values, context));
export const settledPaymentOf = (values, context) => (context?.openPayments || []).find((payment) => payment.id === values.settlesPayment) || null;
/**
 * The form as it is drawn, checked and sent, against the payments on offer now: a choice whose
 * payment is no longer open (cleared by the entry before, or a booking's schedule row edited away)
 * is let go, and a Full payment is always exactly what is pending - worked out here rather than
 * stored, so it follows a schedule or quotation edited after it was chosen.
 */
export function withSettledPayment(values, payments = []) {
  if (!values?.settlesPayment) return values;
  const settled = payments.find((payment) => payment.id === values.settlesPayment);
  if (!settled) return { ...values, settlesPayment: "", settleMode: "", pendingDueDate: "" };
  if (values.settleMode === SETTLE_FULL) return { ...values, amount: String(settled.pending) };
  if (values.settleMode !== SETTLE_PARTIAL) return values;
  const now = String(values.amount ?? "").trim();
  return { ...values, amountLater: now === "" ? "" : String(cents(Number(settled.pending) - Number(now))) };
}

/** What the Amount box is held to, said under it while a payment is being settled. */
export function settleNotes(values, context) {
  const settled = isReceived(values) ? settledPaymentOf(values, context) : null;
  if (!settled || !values.settleMode) return {};
  return values.settleMode === SETTLE_FULL
    ? { amount: `Full payment: the pending ${rupees(settled.pending)}.` }
    : { amountLater: `Paid now + to pay later = the pending ${rupees(settled.pending)}.` };
}

/**
 * What changing the settle choice does to the amount: choosing another payment, None, or Partial
 * after Full empties it, so a figure filled in for one choice is never left looking typed for another.
 */
export function settleChange(current, field, value, payments = []) {
  // Typed in Amount to Pay Later: what is paid now is the rest of what is pending.
  if (field === "amountLater") {
    const settled = payments.find((payment) => payment.id === current.settlesPayment);
    const later = String(value ?? "").trim();
    return { ...current, amount: settled && later !== "" ? String(cents(Number(settled.pending) - Number(later))) : "" };
  }
  const next = { ...current, [field]: value };
  if ((field === "settlesPayment" || field === "settleMode") && current.settleMode === SETTLE_FULL && value !== SETTLE_FULL) next.amount = "";
  return next;
}

export const openPaymentChoices = (payments = []) => payments.map((payment) => ({
  value: payment.id,
  label: `${payment.category} · ${rupees(payment.pending)} pending${payment.status ? ` · ${payment.status}` : ""}${payment.dueDate ? ` · due ${dayLabel(payment.dueDate)}` : ""}`,
}));
/**
 * The studio's own money moving between two branches: one entry, filed in the books of the branch
 * it left, naming the account it left, the branch it went to and the account it reached. No project,
 * shoot, client or payee, and neither income nor spend.
 */
export const isTransfer = (values) => values.entryType === "Transfer";
/**
 * Money out to somebody - filed against a shoot and naming who was paid. Read as "neither of the
 * other two", which is how the money-out fields have always been shown before a type is picked.
 */
export const isSpent = (values) => !isReceived(values) && !isTransfer(values);
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

/**
 * Whether this entry is asked who handled the money.
 *
 * Everything except money **received** through a mode that carries a remark - "Other" out of the
 * box. There the Remarks box says what the payment actually was and the person filing it is the
 * person it happened to, so a Receiver repeated what the login already says. Every other mode asks
 * as it always did, in both directions.
 *
 * Written once because three things read it: which boxes the form draws, what it refuses to save
 * without, and what the payload sends - and a form that asks for something the payload then drops is
 * how a required answer goes missing.
 */
export const asksHandler = (values, context) => !(isReceived(values) && needsModeDetails(values, context));
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
const shootLabel = (shoot) => `${shoot.project?.eventId ? `${shoot.project.eventId} — ` : ""}${shoot.shootId} ${shoot.shoot}`.trim();

/*
 * The list is whatever the **search** last offered, where anybody has typed - `context.remote` - and
 * the page `options` opened on before that. `optionsFor` keeps the shoot already chosen in the list,
 * since the field holds its id and the label comes from a list each search replaces.
 *
 * The filter by `fixedProject` stays for the page it opens on, where the whole studio's shoots are
 * in hand; the search itself is narrowed on the server by `projectId`, which is the same rule asked
 * of the right side.
 */
const shootChoices = (values, context) => {
  const opened = (context?.lookups?.shoots || [])
    .filter((shoot) => !context?.fixedProject || shoot.project?.id === context.fixedProject.id);
  const remote = context?.remote?.shoots;
  if (!remote) return opened.map((shoot) => ({ value: shoot.id, label: shootLabel(shoot) }));
  return remote.optionsFor(opened, [values.shootId], shootLabel);
};

const projectLabel = (project) => `${project.eventId} — ${project.clientName || "Unnamed client"}`;

const projectChoices = (values, context) => {
  const opened = context?.lookups?.projects || [];
  const remote = context?.remote?.projects;
  if (!remote) return opened.map((project) => ({ value: project.id, label: projectLabel(project) }));
  return remote.optionsFor(opened, [values.projectId], projectLabel);
};

/** Says where the list comes from when it is empty, rather than opening a dropdown with nothing in it. */
/*
 * Where the accounts come from, said in the box when there are none.
 *
 * They are the **branches'** accounts now - Settings → Organization → Branches, on the branch each
 * one belongs to - and the Accounts module's own list is gone. "Add a bank account in Settings" sent
 * somebody to this screen's own ⋮ → Settings, which is where that list used to be edited and no
 * longer exists, so the one line on screen about it has to name the place that does.
 */
const accountProps = (context, chosen) => {
  const ready = (context?.options?.accounts || []).length;
  return {
    searchable: true,
    disabled: !ready,
    placeholder: ready ? chosen : "Add an account in Settings → Organization → Branches",
  };
};

/** A picker is only useful once its list has arrived, and says so rather than opening empty. */
/*
 * Both pickers are **searched on the server** (`context.remote`), so neither is disabled for an empty
 * list any more: typing is how the rest is reached, and a disabled box is a box that cannot be typed
 * into. It stays disabled only while the screen has not loaded its first page at all.
 */
const projectProps = (values, context) => {
  const ready = (context?.options?.projects || []).length;
  const remote = context?.remote?.projects;
  return {
    searchable: true,
    disabled: !ready && !remote,
    placeholder: ready || remote ? "Select or search the project" : "No projects available",
    ...(remote ? remote.props : {}),
  };
};

const shootProps = (values, context) => {
  const count = shootChoices(values, context).length;
  const remote = context?.remote?.shoots;
  const empty = context?.fixedProject ? "This project has no shoots yet" : "No shoots available";
  return {
    searchable: true,
    disabled: !count && !remote,
    placeholder: count || remote ? "Select or search the shoot this was spent on" : empty,
    ...(remote ? remote.props : {}),
  };
};

/*
 * A transfer's two ends: the branches this person may record cash against, each carrying its own
 * accounts. The branch the money went to is never the one it left, so that one is not offered.
 */
const branchList = (context) => context?.lookups?.branches || [];
const branchChoices = (values, context, { except } = {}) => branchList(context)
  .filter((branch) => String(branch.id) !== String(except || ""))
  .map((branch) => ({ value: String(branch.id), label: branch.name }));
const branchProps = (placeholder) => (values, context) => {
  const ready = branchList(context).length;
  return { searchable: true, disabled: !ready, placeholder: ready ? placeholder : "No branches available" };
};
/** The accounts of one branch - a transfer's account is always the account of its own end. */
const accountsOf = (context, branchId) => (branchList(context).find((branch) => String(branch.id) === String(branchId || ""))?.accounts) || [];
const transferAccountProps = (context, branchId, chosen) => {
  if (!branchId) return { searchable: true, disabled: true, placeholder: "Choose the branch first" };
  const ready = accountsOf(context, branchId).length;
  return { searchable: true, disabled: !ready, placeholder: ready ? chosen : "No account - add one in Branch settings" };
};

/** The tabs split the list by direction, which is the first cut Accounts reads it by. */
export const accountsTabs = [
  { label: "All", entryTypes: null },
  { label: "Received", entryTypes: ["Received"] },
  { label: "Spent", entryTypes: ["Spent"] },
  { label: "Transfers", entryTypes: ["Transfer"] },
];

/**
 * The one tab that is not a cash entry at all: the payment requests waiting for a decision.
 *
 * Kept out of `accountsTabs` because those are direction filters over the rows already loaded, each
 * with its `entryTypes`, while this one has its own source, its own table and its own permission -
 * the same way the scheduled payments' Due / Overdue / On Hold tabs sit beside them rather than in
 * them. Money the studio has been asked to pay, read where the money it has paid is kept.
 */
export const PENDING_REQUEST_TAB = "Pending";

/**
 * `[key, header, type, size, minSize]`, the same shape the other module tables use. One set of
 * columns covers both directions: the two that belong to one direction read "—" on the other, which
 * is what every empty cell in every other module table already reads.
 */
export const accountsTableFields = [
  ["entryId", "Entry ID", undefined, 150, 130],
  ["entryType", "Type", "status", 130, 110],
  // Manual, CSV Import or PDF Import; "—" on an entry recorded before the source was kept.
  ["source", "Source", undefined, 140, 120],
  ["clientName", "Client Name", undefined, 210, 170],
  // What the entry was filed against. Money out carries a shoot, money in a project, so each reads
  // "—" on the other direction, as every other direction-only column here already does.
  ["shootCode", "Shoot ID", undefined, 150, 130],
  ["projectCode", "Event ID", undefined, 150, 130],
  /*
   * The category and the payment mode name their own lists, because both answer from a list the
   * studio keeps rather than from whatever happens to be on screen. Derived from the rows, the
   * filter offered only the categories that already had an entry - so "Vendor Payment" was not on
   * it until the first vendor payment was approved, and the entry that created it could not be
   * filtered for until the page was read again. Every category the form can record is on the list,
   * both directions and the transfer, because the All tab holds all three.
   */
  ["category", "Category", undefined, 190, 160, [...RECEIVED_CATEGORIES, ...SPENT_CATEGORIES, TRANSFER_CATEGORY]],
  ["amount", "Amount", "amount", 150, 130],
  ["entryDate", "Date", "date", 150, 130],
  ["branch", "Branch", undefined, 170, 140],
  // A transfer's receiving branch; "Branch" beside it is the one the money left.
  ["toBranchName", "To Branch", undefined, 170, 140],
  ["paymentMode", "Payment Mode", undefined, 160, 140, PAYMENT_MODES],
  // Named for what it is about, because here it sits beside Description with nothing to tell them
  // apart - on the form it is under Payment Mode, where "Remarks" is unambiguous.
  ["paymentModeOther", "Payment Mode Remarks", undefined, 190, 150],
  ["transactionId", "Transaction ID", undefined, 190, 150],
  ["receivedAccount", "Received Account", undefined, 190, 150],
  ["paidFromAccount", "Paid From Account", undefined, 190, 150],
  ["paidTo", "Payment To", undefined, 200, 160],
  /*
   * Still "Received / Paid By", though only money out fills it in now.
   *
   * Narrowing it to "Paid By" was wrong, and wrong about money: entries filed before the receiver
   * stopped being asked **do** carry one, so a name that belonged to whoever took the studio's money
   * in would have been printed under a heading saying they paid it out. The heading has to cover
   * every row the column holds, which is a receiver on an old entry, a payer on money out, and
   * nothing on a received entry filed since.
   */
  ["handlerName", "Received / Paid By", undefined, 200, 160],
  ["handlerEmployeeCode", "Employee ID", undefined, 150, 130],
  ["description", "Description", undefined, 260, 200],
];

/*
 * The columns whose filter is a multi-select: the ones holding a short set of named values somebody
 * picks from. Every other column - IDs, client names, amounts, references, notes - is typed into, and
 * the date keeps its own picker.
 */
export const accountsListFilters = ["entryType", "source", "category", "branch", "toBranchName", "paymentMode", "receivedAccount", "paidFromAccount", "handlerName"];

export const accountsInfoSections = [
  { title: "Entry", fields: [["entryId", "Entry ID"], ["entryType", "Type"], ["entryDate", "Date", "date"], ["category", "Category"], ["amount", "Amount", "amount"], ["source", "Source"]] },
  // "Branch" is a transfer's From Branch; To Branch reads only on a transfer, and is dropped empty.
  { title: "Client & Branch", fields: [["clientName", "Client Name"], ["branch", "Branch"], ["toBranchName", "To Branch"]] },
  { title: "Filed Against", fields: [["projectCode", "Event ID"], ["shootCode", "Shoot ID"], ["shootName", "Shoot"], ["shootDate", "Shoot Date", "date"]] },
  { title: "Payment", fields: [["paymentMode", "Payment Mode"], ["paymentModeOther", "Payment Mode Remarks"], ["transactionId", "Transaction ID / Reference"], ["receivedAccount", "Received Account"], ["paidFromAccount", "Paid From Account"], ["paidTo", "Payment To"]] },
  { title: "Handled By", fields: [["handlerName", "Received / Paid By"], ["handlerEmployeeCode", "Employee ID"], ["handlerDepartment", "Department"]] },
  { title: "Notes", fields: [["description", "Description"]] },
  // A gallery with nothing in it drops itself and takes this section with it, so an entry filed
  // without a receipt shows no empty heading.
  { title: "Payment Proof", fields: [["paymentProofUrls", "Files", "gallery"]] },
];

/**
 * A scheduled payment read on a double click, as a cash entry is: the project it is owed by, and what
 * is due, when and why. A hold's remarks only when it is held.
 */
export const scheduledPaymentInfoSections = [
  { title: "Project", fields: [["eventId", "Event ID"], ["clientName", "Client Name"], ["clientMainNumber", "Client Number"], ["branch", "Branch"]] },
  { title: "Payment", fields: [["category", "Category"], ["dueDate", "Due Date", "date"], ["pending", "Due Amount", "amount"], ["remarks", "Remarks"], ["holdRemarks", "Hold Remarks"]] },
];

/** The direction dot in the table: money in reads green, money out red. */
export const accountsStatusStyles = {
  Received: "bg-emerald-500",
  Spent: "bg-red-500",
  Transfer: "bg-sky-500",
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
      helperText: "Whether money came in, went out or moved between branches; it cannot be changed later.",
      // A bare line of choices, no box: it introduces the form rather than sitting among inputs.
      props: { controlClassName: "px-0 py-0" },
      when: (values, context) => !context?.locked,
      clears: ["category", "receivedAccount", "paidFromAccount", "paidTo", "shootId", "fromBranchId", "toBranchId"],
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
        options: projectChoices,
        helperText: "The project this money came in for; its client and branch are taken from it.",
        when: (values, context) => isReceived(values) && !context?.fixedProject,
        props: projectProps,
      },
      {
        name: "shootId",
        label: "Shoot ID",
        type: "select",
        required: true,
        options: shootChoices,
        helperText: "The shoot this money was spent on; its project, client and branch come from it.",
        when: isSpent,
        props: shootProps,
      },
      { name: "linkSummary", type: "custom", colSpan: 2, when: (values) => !isTransfer(values) },
      {
        name: "settlesPayment",
        label: "Settles Payment",
        type: "select",
        options: (values, context) => openPaymentChoices(context?.openPayments),
        placeholder: "None - not a scheduled payment",
        when: asksSettles,
        clears: ["settleMode", "pendingDueDate"],
      },
      {
        name: "settleMode",
        label: "Payment",
        type: "radio",
        required: true,
        options: settleModeChoices,
        when: (values, context) => asksSettles(values, context) && Boolean(settledPaymentOf(values, context)),
        clears: ["pendingDueDate"],
      },
      // A transfer names its two branches in place of a project: the first is whose books it is
      // filed in, the second where the money landed. Changing either empties the account picked
      // from it, since an account belongs to one branch.
      {
        name: "fromBranchId",
        label: "From Branch",
        type: "select",
        required: true,
        options: (values, context) => branchChoices(values, context, { except: values.toBranchId }),
        when: isTransfer,
        helperText: "The branch the money left; the transfer is filed in its books.",
        clears: ["paidFromAccount"],
        props: branchProps("Branch the money left"),
      },
      {
        name: "toBranchId",
        label: "To Branch",
        type: "select",
        required: true,
        options: (values, context) => branchChoices(values, context, { except: values.fromBranchId }),
        when: isTransfer,
        helperText: "The branch whose account the money landed in.",
        clears: ["receivedAccount"],
        props: branchProps("Branch the money went to"),
      },
      // A transfer's one category is filled in on save rather than offered as a list of one.
      { name: "category", label: "Category", type: "select", required: true, options: (values) => CATEGORIES_BY_TYPE[values.entryType] || [], helperText: "What the money was for; the list and reports group entries by it.", when: (values) => !isTransfer(values) },
      // Fixed by the screen that opened the form where the amount is already decided - clearing a
      // scheduled payment receives exactly what is pending.
      { name: "amount", label: (values, context) => (settlesPartly(values, context) ? "Amount Paid Now" : "Amount"), required: true, helperText: (values, context) => context?.amountFixed ? "Set by the payment being cleared, so it cannot be changed here." : "The exact amount that changed hands, as on the receipt or bill.", props: (values, context) => ({ type: "number", min: 0, step: "0.01", inputMode: "decimal", placeholder: "0.00", ...(context?.amountFixed || (values.settleMode === SETTLE_FULL && settledPaymentOf(values, context)) ? { readOnly: true } : {}) }) },
      // A partial payment's two halves: what is paid now (Amount, above) and what is left to pay later,
      // which always add up to what is pending - typing either fills the other in (`settleChange`).
      {
        name: "amountLater",
        label: "Amount to Pay Later",
        required: true,
        when: settlesPartly,
        props: { type: "number", min: 0, step: "0.01", inputMode: "decimal", placeholder: "0.00" },
      },
      {
        name: "pendingDueDate",
        label: "Balance Due Date",
        type: "date",
        required: true,
        when: settlesPartly,
        props: { restriction: "past" },
      },
      { name: "entryDate", label: (values) => isReceived(values) ? "Received Date" : isTransfer(values) ? "Transfer Date" : "Spent Date", type: "date", required: true, helperText: "The day the money actually moved; a future date is not allowed.", props: { restriction: "future" } },
    ],
  },
  {
    id: "payment",
    title: "Payment",
    fields: [
      { name: "paymentMode", label: "Payment Mode", type: "select", required: true, options: "paymentModes", helperText: "How the money moved; it decides which reference or account is asked next.", clears: ["transactionId", "receivedAccount", "paidFromAccount", "paymentModeOther"] },
      {
        name: "transactionId",
        // UPI hands back a transaction ID; a transfer hands back a reference, which is the proof it
        // went through. Same column, named as the mode names it.
        label: (values) => values.paymentMode === "UPI" ? "UPI Transaction ID" : `${values.paymentMode || "Payment"} Reference Number`,
        required: true,
        when: needsTransactionId,
        helperText: "The reference the payment app or bank gave, kept as proof the payment went through.",
        props: (values) => ({ placeholder: values.paymentMode === "UPI" ? "Reference from the payment app" : "Reference from the bank" }),
      },
      /*
       * The remark on the **payment mode**, which is a different question from the entry's
       * Description below: that one is about the payment as a whole and stays optional, this one is
       * about the mode alone and is the one note a cash entry insists on. A mode the studio marked
       * as asking for one says nothing by itself - "Other" - so the entry has to say what it was.
       *
       * It was called "Payment Mode Details", which read as a second set of fields rather than as a
       * sentence somebody writes. Same box and the same stored value: every explanation already
       * recorded reads back under the new name.
       */
      {
        name: "paymentModeOther",
        label: "Remarks",
        required: true,
        when: (values, context) => needsModeDetails(values, context),
        helperText: "Say how this payment was actually made, since the payment mode alone does not.",
        // No made-up reference number: a specific one reads as a value already filled in.
        props: { placeholder: "e.g. Cheque number, or adjusted against an earlier advance" },
      },
      /*
       * A transfer asks for both accounts, each from its own branch: the account the money left
       * from the From Branch, the account it reached from the To Branch. Saved in the same two
       * columns money out and money in already use, so the table's account columns read a transfer
       * the way they read everything else.
       */
      {
        name: "paidFromAccount",
        label: (values) => isTransfer(values) ? "From Account" : "Paid From Account",
        required: true,
        type: "select",
        when: (values, context) => !isReceived(values) && needsAccount(values, context),
        helperText: (values) => isTransfer(values) ? "The From Branch's account the money left from." : "The studio account the money was paid out of.",
        options: (values, context) => isTransfer(values) ? accountsOf(context, values.fromBranchId) : (context?.options?.accounts || []),
        props: (values, context) => isTransfer(values)
          ? transferAccountProps(context, values.fromBranchId, "Account the money left")
          : accountProps(context, "Account the money was paid from"),
      },
      {
        name: "receivedAccount",
        label: (values) => isTransfer(values) ? "To Account" : "Received Account",
        required: true,
        type: "select",
        when: (values, context) => (isReceived(values) || isTransfer(values)) && needsAccount(values, context),
        helperText: (values) => isTransfer(values) ? "The To Branch's account the money went into." : "The studio account the client's money went into.",
        // Picked from the accounts the branches hold, not typed: the same account arriving as three
        // spellings is what stopped any report grouping by it. Each reads as its bank, the last four
        // digits of the number and its branch, and that label is what the entry keeps.
        options: (values, context) => isTransfer(values) ? accountsOf(context, values.toBranchId) : (context?.options?.accounts || []),
        props: (values, context) => isTransfer(values)
          ? transferAccountProps(context, values.toBranchId, "Account the money went into")
          : accountProps(context, "Account the money went into"),
      },
      {
        name: "paidTo",
        label: "Payment To",
        required: true,
        when: isSpent,
        helperText: "The vendor, freelancer or person who was paid this money.",
        props: { placeholder: "Who the payment went to" },
      },
      // Who handled the money, whichever way it moved. It sits here rather than in a section of its
      // own: two fields, one of which is usually hidden, did not fill a section, and who handled a
      // payment is part of the payment. The employees are offered by name, and "Other (not an
      // employee)" opens the box beside it for anyone off the payroll — a freelancer, a client's
      // own runner. The pair shares a stem so the second field reads as the first one answered by
      // hand, and "Paid By" matches the "Received / Paid By" this column is called elsewhere.
      /*
       * **Asked of everything except money received through a mode that carries a remark.**
       *
       * Which is "Other" out of the box: a payment that arrived by some arrangement the list does not
       * name, where the Remarks box above says what actually happened and the person filing it is the
       * person it happened to. Naming a receiver there was asking the form to repeat what the login
       * already says, on the form that books a project - and nothing is stored in its place, nobody
       * having been asked.
       *
       * Every other mode keeps it exactly as it was, in both directions: money received by cash, UPI
       * or a transfer still names who took it, and the studio's money *leaving* through somebody's
       * hands always names them.
       */
      {
        name: "handler",
        label: (values) => isReceived(values) ? "Receiver" : isTransfer(values) ? "Transferred By" : "Paid By",
        type: "select",
        required: true,
        options: "handlers",
        helperText: "The employee who handled the money; choose Other for someone off the payroll.",
        when: (values, context) => asksHandler(values, context),
        clears: ["handlerOtherName"],
        props: (values) => ({ searchable: true, placeholder: isReceived(values) ? "Select the employee who took the money" : isTransfer(values) ? "Select the employee who made the transfer" : "Select the employee who paid it out" }),
      },
      {
        name: "handlerOtherName",
        label: (values) => isReceived(values) ? "Receiver's Name" : isTransfer(values) ? "Transferred By (Name)" : "Payer's Name",
        required: true,
        when: (values, context) => asksHandler(values, context) && handlerIsOther(values),
        helperText: "The full name of the person outside the payroll who handled the money.",
        props: (values) => ({ placeholder: isReceived(values) ? "Name of the person who received it" : isTransfer(values) ? "Name of the person who made the transfer" : "Name of the person who paid it out" }),
      },
      // The receipt, bill or screenshot behind the payment. Compressed in the browser and again on
      // the server before it reaches the bucket, the way every other image in the app is, and on a
      // phone the picker offers the camera so a paper receipt can be photographed where it is
      // handed over. Optional — plenty of cash changes hands without one.
      {
        name: "paymentProof",
        label: (values) => isReceived(values) ? "Receipt / Proof" : isTransfer(values) ? "Transfer Proof" : "Bill / Proof",
        type: "file",
        colSpan: 2,
        helperText: "Optional photos of the receipt, bill or screenshot, up to five images.",
        props: { image: true, accept: ".avif,.jpeg,.jpg,.png,.webp", maxFiles: 5 },
      },
    ],
  },
  {
    id: "notes",
    title: "Description",
    columns: 1,
    fields: [
      /*
       * The note about the **payment**, as against the Remarks above, which is about the mode alone.
       * The placeholder says so: two free-text boxes on one form are told apart by what each asks
       * for, and "anything worth keeping" described either of them equally well.
       */
      { name: "description", label: "Description", type: "textarea", colSpan: 2, helperText: "Optional note on what this payment covers or what was agreed.", props: { rows: 4, placeholder: "Anything else about this payment - what it covers, what was agreed." } },
    ],
  },
];

export const cashEntryInitialValues = {
  entryType: "",
  shootId: "",
  projectId: "",
  settlesPayment: "",
  settleMode: "",
  amountLater: "",
  pendingDueDate: "",
  fromBranchId: "",
  toBranchId: "",
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
  // Nor a transfer's two branches: the advance is money in, never a transfer.
  fields: section.fields.filter((field) => !["projectId", "shootId", "linkSummary", "fromBranchId", "toBranchId"].includes(field.name)),
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
export function validateCashEntry(values, options = {}) {
  return Object.values(cashEntryFieldProblems(values, options))[0] || "";
}

/**
 * The same checks keyed by the field each is about - `{ amount: "Enter an amount greater than zero." }`
 * - so the Accounts form can say each one under its own box. In the order the form asks them, which
 * is what makes the first value `validateCashEntry`'s one sentence.
 */
/** Settling a scheduled payment: Full is exactly what is pending, Partial less, with the rest's date. */
export function settleProblems(values, context, problems = {}) {
  const settled = isReceived(values) ? settledPaymentOf(values, context) : null;
  if (!settled) return problems;
  if (!values.settleMode) problems.settleMode = "Choose Full or Partial payment.";
  else if (values.settleMode === SETTLE_FULL && Number(values.amount) !== Number(settled.pending)) problems.amount = `A full payment is the whole pending ${rupees(settled.pending)}.`;
  else if (values.settleMode === SETTLE_PARTIAL) {
    if (!problems.amount && !(Number(values.amount) < Number(settled.pending))) problems.amount = `A partial payment is less than the pending ${rupees(settled.pending)}. Choose Full payment for all of it.`;
    if (!values.pendingDueDate) problems.pendingDueDate = "Choose the date the rest is due.";
    else if (values.entryDate && values.pendingDueDate < values.entryDate) problems.pendingDueDate = "The rest cannot fall due before the money was received.";
  }
  return problems;
}

export function cashEntryFieldProblems(values, { requireLink = true, context } = {}) {
  const received = isReceived(values);
  const transfer = isTransfer(values);
  const spent = isSpent(values);
  const problems = {};
  // The link is what the entry's client and branch are read from on the server, so it is the one
  // answer nothing else can stand in for. A transfer names its two branches instead.
  if (transfer) {
    if (!values.fromBranchId) problems.fromBranchId = "Choose the branch the money left.";
    if (!values.toBranchId) problems.toBranchId = "Choose the branch the money went to.";
    else if (String(values.fromBranchId) === String(values.toBranchId)) problems.toBranchId = "A transfer goes to a different branch.";
  } else if (requireLink) {
    if (received && !values.projectId) problems.projectId = "Select the project this was received for.";
    if (!received && !values.shootId) problems.shootId = "Select the shoot this was spent on.";
  }
  // A transfer's one category is filled in on save rather than asked.
  if (!transfer && !values.category) problems.category = "Choose a category.";
  if (!(Number(values.amount) > 0)) problems.amount = "Enter an amount greater than zero.";
  settleProblems(values, context, problems);
  if (!values.entryDate) problems.entryDate = `Enter the date the money was ${received ? "received" : transfer ? "transferred" : "spent"}.`;
  if (!values.paymentMode) problems.paymentMode = "Choose the payment mode.";
  if (needsModeDetails(values, context) && !String(values.paymentModeOther || "").trim()) problems.paymentModeOther = "Add a remark for this payment mode.";
  if (needsTransactionId(values, context) && !String(values.transactionId || "").trim()) {
    problems.transactionId = values.paymentMode === "UPI" ? "Enter the UPI transaction ID." : `Enter the ${values.paymentMode} reference number.`;
  }
  if (needsAccount(values, context)) {
    // A transfer is asked for both ends.
    if (!received && !String(values.paidFromAccount || "").trim()) problems.paidFromAccount = "Enter the account the money was paid from.";
    if (!spent && !String(values.receivedAccount || "").trim()) problems.receivedAccount = "Enter the account the money went into.";
  }
  if (spent && !String(values.paidTo || "").trim()) problems.paidTo = "Enter who the payment went to.";
  // Asked unless this is money received through a mode that carries a remark - see `asksHandler`.
  if (asksHandler(values, context)) {
    const who = received ? "received the money" : transfer ? "made the transfer" : "paid the money out";
    if (!values.handler) problems.handler = `Choose who ${who}.`;
    else if (handlerIsOther(values) && !String(values.handlerOtherName || "").trim()) problems.handlerOtherName = `Enter who ${who}.`;
  }
  return problems;
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
  settleProblems(values, context, problems);
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
  const transfer = isTransfer(values);
  const branchId = (key) => transfer && values[key] ? Number(values[key]) : null;
  const other = handlerIsOther(values);
  const asked = asksHandler(values, context);
  const trimmed = (key) => String(values[key] || "").trim();
  return {
    entryType: values.entryType,
    // Money in is against the project alone; money out names one of its shoots as well.
    // A transfer is filed against no project or shoot; it names its two branches instead.
    projectId: transfer ? null : links.projectId ?? (values.projectId || null),
    shootId: received || transfer ? null : (links.shootId ?? (values.shootId || null)),
    fromBranchId: branchId("fromBranchId"),
    toBranchId: branchId("toBranchId"),
    category: transfer ? TRANSFER_CATEGORY : values.category,
    amount: Number(values.amount),
    entryDate: values.entryDate,
    paymentMode: values.paymentMode,
    transactionId: needsTransactionId(values, context) ? trimmed("transactionId") : null,
    paymentModeOther: values.paymentMode === OTHER_PAYMENT_MODE ? trimmed("paymentModeOther") : null,
    // Only the modes that move money through an account carry one, and only in their direction.
    // A transfer carries both ends.
    receivedAccount: (received || transfer) && needsAccount(values, context) ? trimmed("receivedAccount") : null,
    paidFromAccount: !received && needsAccount(values, context) ? trimmed("paidFromAccount") : null,
    paidTo: received || transfer ? null : trimmed("paidTo"),
    /*
     * Nothing is sent where the form did not ask - see `asksHandler`. This is the one place that
     * could smuggle a receiver onto an entry nobody was asked about: a name left behind by choosing
     * a mode and then changing it. The server stores nothing for those either.
     */
    handlerEmployeeId: asked && !other ? Number(values.handler) : null,
    handlerName: asked && other ? trimmed("handlerOtherName") : null,
    handlerIsOther: asked && other,
    description: trimmed("description") || null,
    paymentProof: Array.isArray(values.paymentProof) ? values.paymentProof : [],
    // Only where the form asked, so an entry left on None - or a form with no schedule - sends none.
    ...(received && settledPaymentOf(values, context) && values.settleMode ? {
      settles: {
        paymentScheduleId: values.settlesPayment,
        mode: values.settleMode,
        pendingDueDate: values.settleMode === SETTLE_PARTIAL ? values.pendingDueDate || null : null,
      },
    } : {}),
  };
}
