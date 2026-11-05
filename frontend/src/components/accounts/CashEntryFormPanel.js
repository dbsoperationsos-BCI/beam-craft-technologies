"use client";

import { avatarOf } from "@/lib/employeeAvatar.mjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import RecordSummaryCard from "@/components/shared/RecordSummaryCard";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import Button from "@/components/shared/Button";
import useFormErrors from "@/components/shared/useFormErrors";
import useRemoteOptions from "@/components/shared/useRemoteOptions";
import { createCashEntry, searchCashEntryProjects, searchCashEntryShoots, updateCashEntry } from "@/services/accounts/cash-entries.service";
import { getOpenScheduledPayments } from "@/services/accounts/scheduled-payments.service";
import usePaymentModes from "@/components/accounts/usePaymentModes";
import {
  OTHER_HANDLER,
  settleChange,
  settleNotes,
  withSettledPayment,
  cashEntryFormSections,
  cashEntryLeadFields,
  cashEntryInitialValues,
  cashEntryPayload,
  entryTypeChoices,
  projectFor,
  cashEntryFieldProblems,
  shootFor,
} from "@/constants/accountsConfig";

const toDateInput = (value) => value ? new Date(value).toISOString().slice(0, 10) : "";
const formatDate = (value) => value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(value)) : "";

function errorMessage(error, fallback) {
  if (error?.status === 401 || error?.status === 403) return "Your session has expired. Please sign in again.";
  return error?.data?.message || error?.message || fallback;
}

/**
 * The handler is one field to fill in but two things to store — an employee id, or a typed name when
 * it was somebody outside the payroll. The dropdown carries employee ids as its values with "Other"
 * alongside them, and this turns that back into the pair the server keeps.
 */
const handlerValue = (entry) => entry?.handlerIsOther ? OTHER_HANDLER : (entry?.handlerEmployeeId ? String(entry.handlerEmployeeId) : "");

/**
 * What the chosen shoot or project fills in, shown read-only beneath the picker.
 *
 * These are the other records' own columns, so they are read through the link rather than copied
 * onto the entry — with the two exceptions the entry takes a copy of on save, the client and the
 * Source Branch, which it keeps as the text those columns held on the day. Neither is a field:
 * choosing what the entry is filed against is what answers both, which is why the pickers above are
 * required.
 */
function LinkSummary({ received, fixed = false, shoot, project }) {
  if (!shoot && !project) {
    return <p className="text-xs text-slate-500 sm:text-sm">
      {received
        ? "Select the project to pull in its client, branch, status and CRM."
        : "Select the shoot this was spent on, to pull in its project's client and branch."}
    </p>;
  }
  // The project chosen above wins: the shoot's copy of it is the fallback for an entry filed
  // against a shoot too old to still be in the picker's list.
  const details = project || shoot?.project;
  const rows = [
    ...(shoot ? [["Shoot", shoot.shoot], ["Shoot Date", formatDate(shoot.dateCreated)], ["Place", shoot.place]] : []),
    ["Event ID", details?.eventId],
    ["Client Name", details?.clientName],
    ["Project Status", details?.projectStatus],
    ["Main Event Date", formatDate(details?.mainEventDate)],
    // The entry's own branch, not just a detail of the project: it is stored on the entry from here.
    ["Branch", details?.sourceBranch],
    ["CRM", details?.crmName],
  ];
  /* The shared card, which this markup was the first of - Start / Edit Project states the sale it
     is planning against in the same one. `note`: a form opened from a project says so, in place of
     the picker it no longer shows, because the record below was not chosen here. */
  return <RecordSummaryCard
    rows={rows}
    note={fixed ? `Filed against the project this was opened from${received ? "." : ", on the shoot chosen above."}` : null}
  />;
}

function toForm(entry, entryType, { projectId = "", ...values } = {}) {
  if (!entry) return { ...cashEntryInitialValues, entryType, projectId, ...values };
  return {
    entryType: entry.entryType || entryType,
    shootId: entry.shootId || "",
    projectId: entry.projectId || "",
    // A transfer's two ends; the entry's own branch is the one the money left.
    fromBranchId: entry.entryType === "Transfer" && entry.branchId ? String(entry.branchId) : "",
    toBranchId: entry.toBranchId ? String(entry.toBranchId) : "",
    category: entry.category || "",
    amount: entry.amount === null || entry.amount === undefined ? "" : String(entry.amount),
    entryDate: toDateInput(entry.entryDate),
    paymentMode: entry.paymentMode || "",
    transactionId: entry.transactionId || "",
    paymentModeOther: entry.paymentModeOther || "",
    receivedAccount: entry.receivedAccount || "",
    paidFromAccount: entry.paidFromAccount || "",
    paidTo: entry.paidTo || "",
    handler: handlerValue(entry),
    handlerOtherName: entry.handlerIsOther ? entry.handlerName || "" : "",
    description: entry.description || "",
    // The upload field works in links; the metadata behind each one stays on the server and is
    // matched back to it on save, so an edit never rewrites who uploaded a file or when.
    paymentProof: (Array.isArray(entry.paymentProof) ? entry.paymentProof : []).map((file) => file?.url).filter(Boolean),
  };
}

/**
 * Records one movement of cash, in or out, or corrects one already recorded.
 *
 * Adding starts on the direction rather than on the fields, the way Add Asset starts on single or
 * bulk: the answer decides which fields the form asks for — the categories on offer, whether it
 * wants a studio account or who was paid — and an entry keeps the direction it was filed under, so
 * changing it means withdrawing the entry and recording a new one. It is asked as the panel's first
 * step instead of in a dialog in front of it, so the choice and the form it opens are one surface,
 * and the summary at the top of Entry Details offers the way back to it.
 *
 * Which fields each direction asks for lives in the field list rather than in this file; this owns
 * the direction, validation, and saving.
 *
 * `preset.entryTypeOpen` keeps the kind choosable while `preset.entryType` pre-selects it - Import
 * from PDF reads a likely direction off the statement, but the person recording the row decides
 * whether it was money received, money spent or a branch transfer.
 *
 * `preset` is for a form opened from somewhere that has already answered part of it — a project's
 * Payments tab, where the button pressed says the direction and the screen says the project. Both
 * are then read back rather than asked for, and the project is handed over as a whole record, not
 * an id: the picker holds the most recent projects only and cannot be relied on to contain it.
 * `preset.values` fills in more of it (a category, an amount), and `preset.amountFixed` keeps the
 * amount as given.
 *
 * `onRecord(payload)`, when given, records the entry instead of the cash book's own endpoint - a
 * scheduled payment cleared from Accounts -> Scheduled Payments is recorded through its own route,
 * which links the receipt to it. The panel then saves once and leaves the rest to the caller.
 */
export default function CashEntryFormPanel({ entry, preset, options, onClose, onSaved, onRecord, submitLabel, zIndexClassName }) {
  const [direction, setDirection] = useState(entry?.entryType || preset?.entryType || "");
  const received = direction === "Received";
  /*
   * A form opened from a project opens with that project already answered, and money in then has no
   * picker to answer it in. Kept as its own value rather than read off `preset` at save, so Save &
   * Next starts the next entry against the same project.
   */
  const presetSeed = useMemo(() => ({ ...(preset?.project ? { projectId: preset.project.id } : {}), ...(preset?.values || {}) }), [preset]);
  const [form, setForm] = useState(() => toForm(entry, entry?.entryType || preset?.entryType || "", presetSeed));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fields = useFormErrors();
  const { clear, clearAll } = fields;
  // Bumped by Save & Next to remount the panel, which is what makes the next entry start at the top
  // of the form on its first section rather than wherever the last one was left scrolled to.
  const [formKey, setFormKey] = useState(0);

  /*
   * The chosen project's payments still open, for "Settles Payment" - asked for money received being
   * recorded, never on an edit (a receipt keeps the payment it settled) nor where the screen records
   * the entry itself (`onRecord`: the Due tab's Clear and Partially paid already name the payment).
   * A read that fails leaves the list empty and the form as it always was.
   */
  const presetProjectId = preset?.project?.id || "";
  const settlesProjectId = received && !entry && !onRecord ? form.projectId || presetProjectId : "";
  const [openPayments, setOpenPayments] = useState({ projectId: "", rows: [] });
  // Bumped by Save & Next, so a payment the entry just settled leaves the list for the next one.
  const [openPaymentsRead, setOpenPaymentsRead] = useState(0);
  useEffect(() => {
    if (!settlesProjectId) return undefined;
    let current = true;
    getOpenScheduledPayments(settlesProjectId)
      .then((response) => { if (current) setOpenPayments({ projectId: settlesProjectId, rows: response?.data || [] }); })
      .catch(() => { if (current) setOpenPayments({ projectId: settlesProjectId, rows: [] }); });
    return () => { current = false; };
  }, [settlesProjectId, openPaymentsRead]);
  const openRows = useMemo(() => (settlesProjectId && openPayments.projectId === settlesProjectId ? openPayments.rows : []), [openPayments, settlesProjectId]);

  /**
   * Switching direction empties the answers that only make sense in the direction being left — the
   * category lists share no values, one direction's account is the other's payee, and money in is
   * filed against a project alone. The field's own `clears` empties them; this keeps `direction` in
   * step so the labels and validation below follow the radio as it changes.
   */
  const update = useCallback((field, value) => {
    setForm((current) => {
      const next = settleChange(current, field, value, openRows);
      // Another project has other payments: what was chosen for the last one goes.
      if (field === "projectId") Object.assign(next, { settlesPayment: "", settleMode: "", pendingDueDate: "" });
      return next;
    });
    clear(field);
    if (field === "entryType") {
      setDirection(value);
      setError("");
      clearAll();
    }
  }, [clear, clearAll, openRows]);

  /*
   * Both pickers are searched on the server: `options` carries a page for them to open on and typing
   * reaches every project and every shoot. The cap used to be the limit of what an entry could be
   * **filed** against, not just what the picker opened showing - see `services/pickerSearch.js`.
   *
   * The shoot search is narrowed to the project the entry is filed against where there is one, which
   * is this form's own rule rather than a cap: the server refuses a shoot from another project, so
   * offering them would only be offering the way to a rejected save.
   */
  const remoteProjects = useRemoteOptions(searchCashEntryProjects, { read: (data) => data.projects });
  const remoteShoots = useRemoteOptions(searchCashEntryShoots, {
    read: (data) => data.shoots,
    args: { projectId: preset?.project?.id || entry?.projectId || "" },
  });

  /**
   * And the record the form was **opened on** is put back at the top of the page it opens with, from
   * what the entry carries — the client and branch the entry itself stored, since those are the two
   * the picker fills in. Still needed with the search in place: the form opens before anybody types,
   * and an entry against a shoot from last year would otherwise open on a picker that does not list
   * it and lose the link the moment it was saved.
   */
  const shootList = useMemo(() => {
    const list = options.shoots || [];
    if (!entry?.shoot || list.some((item) => item.id === entry.shoot.id)) return list;
    // The project id is what the shoot picker filters on, so the stand-in carries it too.
    return [{ ...entry.shoot, place: "", project: { id: entry.projectId, eventId: entry.projectCode, clientName: entry.clientName, sourceBranch: entry.branch } }, ...list];
  }, [entry, options]);
  const projectList = useMemo(() => {
    const list = options.projects || [];
    // A project handed in by the screen that opened the form is put in the list the same way an
    // edited entry's own project is: the server offers the most recent projects only, and the form
    // has to be able to name the one it was opened from however old it is.
    if (preset?.project && !list.some((item) => item.id === preset.project.id)) return [preset.project, ...list];
    if (!entry?.project || list.some((item) => item.id === entry.project.id)) return list;
    return [{ ...entry.project, clientName: entry.clientName, sourceBranch: entry.branch }, ...list];
  }, [entry, options, preset]);

  // Only the projects are a ready-made list: the shoots are narrowed to the project chosen, so the
  // field list builds those itself from `lookups` as the answer changes.
  const branchList = useMemo(() => {
    const list = options.branches || [];
    if (entry?.entryType !== "Transfer") return list;
    const missing = [
      entry.branchId && { id: entry.branchId, name: entry.branch, accounts: entry.paidFromAccount ? [entry.paidFromAccount] : [] },
      entry.toBranchId && { id: entry.toBranchId, name: entry.toBranchName, accounts: entry.receivedAccount ? [entry.receivedAccount] : [] },
    ].filter((branch) => branch && !list.some((item) => item.id === branch.id));
    return [...missing, ...list];
  }, [entry, options]);

  const projectOptions = useMemo(() => projectList.map((item) => ({ value: item.id, label: `${item.eventId} — ${item.clientName || "Unnamed client"}` })), [projectList]);

  // The employees the entry can be credited to, plus the way out for anyone who is not one.
  const fixedProject = useMemo(
    () => (preset?.project ? projectList.find((item) => item.id === preset.project.id) || preset.project : null),
    [preset, projectList],
  );

  /*
   * The payment modes the studio maintains, and what each of them asks for.
   *
   * Settings → Field Settings → Accounts → Payment Mode keeps the list; each row says whether it
   * wants a reference, an account, or a line saying what the payment actually was. Read here so the
   * fields drawn, the check before saving and what is sent all read the same answer - and so does
   * the server, which asks the same list. A read that fails leaves `null`, and the arrays compiled
   * into `accountsConfig` stand in, which is exactly what this offered before.
   */
  const paymentModeOptions = usePaymentModes(options.paymentModes);

  const context = useMemo(() => ({
    // An entry keeps the direction it was filed under — its identifier carries it — so an edit
    // reads the direction back rather than offering it. A form opened by "record money in" or
    // "record money out" was answered the same way, by the button that opened it.
    locked: Boolean(entry) || (Boolean(preset?.entryType) && !preset?.entryTypeOpen),
    // The project this form was opened from, if it was opened from one. Read by the field list to
    // drop the project picker, to narrow the shoots to that project's own, and to name it instead.
    fixedProject,
    amountFixed: Boolean(preset?.amountFixed),
    // The project's payments still open - "Settles Payment" is asked only when there are some.
    openPayments: openRows,
    // What each mode asks for, cut from the one list, so the fields and the checks agree.
    modesWithTransactionId: paymentModeOptions.modesWithTransactionId,
    modesWithAccount: paymentModeOptions.modesWithAccount,
    modesWithDetails: paymentModeOptions.modesWithDetails,
    options: {
      paymentModes: paymentModeOptions.paymentModes,
      accounts: options.accounts || [],
      projects: projectOptions,
      handlers: [
        ...(options.employees || []).map((employee) => ({
          value: String(employee.id),
          label: `${employee.employeeName}${employee.employeeId ? ` · ${employee.employeeId}` : ""}`,
          avatar: avatarOf(employee),
        })),
        { value: OTHER_HANDLER, label: "Other" },
      ],
    },
    // The records behind the two pickers, which is what the field list reads to fill the rest of the
    // form in and what the summary below them is drawn from. `options` carries only what a dropdown
    // needs, a value and a label.
    // A transfer's branches, each with its own accounts. An edited transfer's branches are put back
    // if the person can no longer reach them, so the form opens on what the entry says.
    lookups: { shoots: shootList, projects: projectList, branches: branchList },
    // Both long pickers are searched on the server; `accountsConfig` reads this to build their
    // options and to pass `Dropdown` its remote-search props.
    remote: { shoots: remoteShoots, projects: remoteProjects },
    renderers: {
      entryTypeLocked: () => <div className="flex min-h-9 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <div>
          <span className="text-[11px] font-semibold text-slate-600 sm:text-xs">Entry Type</span>
          <p className="text-xs font-medium text-slate-900 sm:text-sm">{(entryTypeChoices.find((choice) => choice.value === direction) || {}).label || "—"}</p>
        </div>
        <span className="text-[11px] text-slate-500 sm:text-xs">An entry cannot change direction.</span>
      </div>,
      linkSummary: ({ values, context: fieldContext }) => <LinkSummary
        received={received}
        fixed={Boolean(fixedProject)}
        shoot={received ? null : shootFor(values, fieldContext)}
        project={projectFor(values, fieldContext)}
      />,
    },
  }), [branchList, direction, entry, fixedProject, openRows, options, paymentModeOptions, preset, projectList, projectOptions, received, remoteProjects, remoteShoots, shootList]);

  /**
   * Shared with the advance on Create Project, which records the same entry through the same
   * endpoint, so neither form can come to ask for less than the other.
   */
  // The screen's own context, so what is checked here and what was asked for on screen cannot
  // disagree about which payment modes want a reference or an account.
  // The form against the payments open now - see `withSettledPayment` - is what is drawn, checked and sent.
  const shown = withSettledPayment(form, openRows);
  const problems = () => cashEntryFieldProblems(shown, { context });

  /**
   * Records the entry, and either closes or clears down for the next one.
   *
   * Cash is entered in runs — a stack of receipts, a morning's payments — so the panel offers to
   * stay open. `keepOpen` files this entry and starts a blank form in the same direction, which is
   * the one answer worth keeping: somebody working through a pile of bills is recording money out
   * for all of them, and being asked the direction again each time is the whole friction.
   *
   * Everything else starts empty, the date included. A carried-over date is the one that quietly
   * files tomorrow's receipt under today.
   */
  async function save({ keepOpen = false } = {}) {
    setError("");

    // Each problem under its own box; the top says only how many.
    if (!fields.check(problems())) return;

    setSaving(true);
    try {
      // The same context the fields were drawn with, so what is sent matches what was asked for.
      const payload = cashEntryPayload({ ...shown, entryType: direction }, {}, context);
      if (onRecord) {
        await onRecord(payload);
        return;
      }
      const saved = entry ? await updateCashEntry(entry.id, payload) : await createCashEntry(payload);
      const entryId = saved?.data?.entryId || entry?.entryId || "";
      // The table behind reloads either way, so the entry just filed is in the list whether or not
      // the panel closes on top of it. Its receipt goes to the project's group from the server.
      onSaved(entry ? `Entry ${entryId} updated.` : `Entry ${entryId} recorded.`, { keepOpen });
      if (keepOpen) {
        // The project is kept alongside the direction: a run of entries started from one project's
        // Payments tab is a run against that project.
        setForm(toForm(null, direction, presetSeed));
        setFormKey((current) => current + 1);
        setOpenPaymentsRead((current) => current + 1);
      }
    } catch (requestError) {
      if (fields.fromServer(requestError)) return;
      setError(errorMessage(requestError, "Unable to save this cash entry."));
    } finally {
      setSaving(false);
    }
  }

  const transfer = direction === "Transfer";
  const noun = received ? "Cash Received" : transfer ? "Branch Transfer" : "Cash Spent";
  const addDescription = received ? "Money received from a client." : transfer ? "Money moved from one branch's account to another's." : "Money paid out against a client.";

  /**
   * An edit is one correction to one record, so it keeps the single Save the panel draws itself.
   * Recording offers the pair, since that is the only case with a next entry to go on to.
   *
   * Save & Close is the submit, so Enter still does what it always did. Save & Next is an ordinary
   * button beside it rather than a second submit, because which one was pressed then needs no
   * guessing at from the event.
   */
  // The three together at the right, as every panel's footer sits (`SchemaFormPanel`); stacked on a
  // phone, where `flex-col-reverse` keeps the primary one under the thumb.
  const addFooter = <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
    <Button className="w-full sm:w-auto" type="button" onClick={onClose} disabled={saving}>Cancel</Button>
    <Button className="w-full sm:w-auto" type="button" onClick={() => void save({ keepOpen: true })} disabled={saving}>{saving ? "Saving..." : "Save & Next"}</Button>
    <Button className="w-full sm:w-auto" variant="primary" disabled={saving}>{saving ? "Saving..." : "Save & Close"}</Button>
  </div>;

  return <SchemaFormPanel
    key={formKey}
    title={entry ? `Edit ${noun}` : `Record ${noun}`}
    description={entry ? `${entry.entryId} · ${transfer ? `${entry.branch} → ${entry.toBranchName || "—"}` : entry.clientName}` : addDescription}
    sections={cashEntryFormSections}
    leadFields={cashEntryLeadFields}
    values={shown}
    notes={settleNotes(shown, context)}
    onChange={update}
    context={context}
    sidebarAriaLabel="Cash entry form sections"
    closeAriaLabel="Close cash entry form"
    onClose={onClose}
    onSubmit={(event) => { event.preventDefault(); void save(); }}
    error={error || fields.summary}
    errors={fields.errors}
    saving={saving}
    zIndexClassName={zIndexClassName}
    submitLabel={entry ? "Update Entry" : submitLabel}
    savingLabel="Saving..."
    footer={entry || onRecord ? undefined : addFooter}
  />;
}
