"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import DataTableShell from "@/components/data-table/DataTableShell";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import { columnTotal } from "@/lib/kanbanSummary.mjs";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import TableFooter from "@/components/data-table/TableFooter";
import { TableCellValue } from "@/components/data-table/tableCells";
import PayrollPaymentHistory from "@/components/hrm/PayrollPaymentHistory";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import RadioGroupField from "@/components/shared/RadioGroupField";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import RecordSummaryCard from "@/components/shared/RecordSummaryCard";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import useFormErrors from "@/components/shared/useFormErrors";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import useUnsavedGuard from "@/components/shared/useUnsavedGuard";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { SKIPPED_TAB, boardStatusOf, rowsForTab, tabCountsFor } from "@/lib/payrollTabs.mjs";
import { payrollPolicyBreachInfoSections, payrollRecoveryForInfo, payrollRecoveryInfoSections } from "@/constants/infoPanelConfig";
import {
  DEDUCT_BY_OPTIONS,
  MONTH_NAMES,
  dayCount,
  emptyRecoveryForm,
  frozenHoldMessage,
  isLopForm,
  lopDaysPerMonthText,
  monthCountOptions,
  monthLabel,
  monthOptions,
  recoveryDate,
  recoveryFieldErrors,
  recoveryFormFor,
  recoveryFormProblem,
  recoveryPayload,
  recoveryPreview,
  rupees,
  yearOptions,
} from "@/lib/payrollRecovery.mjs";
import {
  createPayrollPolicyBreach,
  getPayrollPolicyBreachEmployees,
  getPayrollPolicyBreaches,
  removePayrollPolicyBreach,
  updatePayrollPolicyBreach,
} from "@/services/hrm/payrollPolicyBreach.service";
import {
  createPayrollRecovery,
  getPayrollRecoveries,
  getPayrollRecoveryEmployees,
  removePayrollRecovery,
  undoPayrollRecoveryConversion,
  updatePayrollRecovery,
} from "@/services/hrm/payrollRecovery.service";

/*
 * HRM → Payroll → **Recovery**: money an employee owes the studio, taken back from their salary over
 * a run of months - the studio's recovery sheet, as a register.
 *
 * Create Recovery asks for the employee by name (their Employee ID comes with them), the total, the
 * start month and year, the number of months and the reason, and shows the monthly deduction and the
 * start and end dates as they are typed. The server mints the Recovery ID (`RECO-ID-0001`) and works
 * the same figures out on every read, with the status from the payroll: Completed once every
 * instalment month is Paid on the Main Page, Active until then - Deducted counts them ("3 of 5").
 *
 * A recovery made on Advance Salary (Convert to Recovery) names the advances it came from (From
 * Advances) - they live here now, not there. It keeps its employee and total, and has no Remove: its
 * ⋮ offers Undo conversion instead, which removes it and brings the advances back to Advance Salary.
 *
 * One tap on a row shows it in the info panel beside the table; two open it full screen, read-only -
 * as every register does. Editing is the ⋮'s.
 *
 * `HRM / Payroll Recovery`: Read shows the register; Read / Write adds Create Recovery and each row's
 * ⋮ (Edit, Remove). Undo conversion also needs `HRM / Payroll Advance` Read / Write
 * (`canUndoConversion`). Without them those controls are absent, not disabled. The server checks again.
 *
 * **Policy Breach** (`kind="policy-breach"`) is the same register for fines for breaking a studio policy,
 * behind `HRM / Payroll Policy Breach`: an amount over a number of months, the Main Page's Policy Breach
 * Deduction - apart from its typed Policy Breach Leaves. It has no conversion, so no From Advances and
 * no Undo conversion; everything else reads as a recovery does. `KINDS` holds what differs.
 */

const KINDS = {
  recovery: {
    noun: "recovery", plural: "recoveries", title: "Recovery", idField: "recoveryId", idLabel: "Recovery ID", amountLabel: "Total Amount", convertible: true,
    createNote: "The Recovery ID is given when it is saved.",
    load: getPayrollRecoveries, loadEmployees: getPayrollRecoveryEmployees, create: createPayrollRecovery, update: updatePayrollRecovery, remove: removePayrollRecovery,
    infoSections: payrollRecoveryInfoSections, csvFileName: "payroll-recoveries", reasonPlaceholder: "Salary advance, an expense to recover...",
  },
  "policy-breach": {
    noun: "policy breach", plural: "policy breaches", title: "Policy Breach", idField: "policyBreachId", idLabel: "Policy Breach ID", amountLabel: "Total Amount", convertible: false, deductByLop: true,
    createNote: "A fine taken from the employee's salary over the months chosen - not Policy Breach Leaves, the loss-of-pay days typed on the Main Page. The Policy Breach ID is given when it is saved.",
    load: getPayrollPolicyBreaches, loadEmployees: getPayrollPolicyBreachEmployees, create: createPayrollPolicyBreach, update: updatePayrollPolicyBreach, remove: removePayrollPolicyBreach,
    infoSections: payrollPolicyBreachInfoSections, csvFileName: "payroll-policy-breaches", reasonPlaceholder: "Which policy, and what happened...",
  },
};
// The first letter up, for a noun at the start of a sentence.
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// Active and Completed are where a run has got to; Skipped is which ones had a month moved on the
// Main Page, and a skipped run is still Active - see `payrollTabs.mjs`.
const TABS = ["All", "Active", "Completed", SKIPPED_TAB];
const statusStyles = { Active: "bg-amber-500", Completed: "bg-emerald-500", [SKIPPED_TAB]: "bg-sky-500" };
// The Board's columns: the status tabs, less All, in their colours. A skipped row still owed stands
// under Skipped there (`boardStatusOf`), not under its live status as well - a card is in one column.
const BOARD_COLUMNS = TABS.filter((tab) => tab !== "All").map((tab) => ({ value: tab, label: tab, className: `${statusStyles[tab]} text-white` }));

const columnsFor = (kind) => [
  { id: kind.idField, label: kind.idLabel, value: (row) => row[kind.idField] },
  { id: "employeeCode", label: "Employee ID", value: (row) => row.employeeCode || "-" },
  { id: "employeeName", label: "Employee Name", value: (row) => row.employeeName || "-" },
  // An LOP policy breach is days, not money: its total and its monthly share read in days.
  { id: "totalAmount", label: kind.amountLabel, value: (row) => (row.deductBy === "LOP" ? dayCount(row.totalDays) : rupees(row.totalAmount)) },
  { id: "startMonth", label: "Start Month", value: (row) => MONTH_NAMES[row.startMonth - 1] || "-" },
  { id: "startYear", label: "Start Year", value: (row) => String(row.startYear) },
  { id: "months", label: "No. of Months", value: (row) => String(row.months) },
  { id: "monthlyDeduction", label: "Monthly Deduction", value: (row) => (row.deductBy === "LOP" ? lopDaysPerMonthText(row.lopDaysPerMonth) : rupees(row.monthlyDeduction)) },
  // How many instalments have come back - their months' payroll Paid - which decides the status.
  { id: "instalmentsDeducted", label: "Deducted", value: (row) => `${row.instalmentsDeducted ?? 0} of ${row.months}` },
  { id: "reason", label: "Reason", value: (row) => row.reason || "-" },
  // Advance Salary → Convert to Recovery: the advances it was made from. A recovery's alone.
  ...(kind.convertible ? [{ id: "advanceIds", label: "From Advances", value: (row) => (row.advanceIds || []).join(", ") || "-" }] : []),
  // Skipped on the Main Page: the end date is a month later for each.
  { id: "skippedMonths", label: "Skipped Months", value: (row) => (row.skippedMonths || []).map(monthLabel).join(", ") || "-" },
  { id: "status", label: "Status", value: (row) => row.status },
  { id: "startDate", label: "Start Date", value: (row) => recoveryDate(row.startDate) },
  { id: "endDate", label: "End Date", value: (row) => recoveryDate(row.endDate) },
];

const WIDTHS = { recoveryId: 140, policyBreachId: 150, employeeCode: 120, employeeName: 180, reason: 260, advanceIds: 200, actions: 56 };

export default function PayrollRecoverySection({ kind: kindKey = "recovery", titleAccessory = null, canWrite = false, canUndoConversion = false }) {
  const kind = KINDS[kindKey];
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  // One tap shows a row in the info panel beside the table; two open it full screen, read-only. Held
  // by id, so a reload shows the row as it now stands - or nothing, once it has left the register.
  const [selectedId, setSelectedId] = useState(null);
  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  const [viewingId, setViewingId] = useState(null);
  const [activeTab, setActiveTab] = useState("All");
  const [tableStats, setTableStats] = useState({ total: 0 });
  const [employees, setEmployees] = useState([]);
  // `{ id: null, initial }` while creating, `{ id, row, initial }` while correcting one, `null` when
  // the form is shut. `initial` is what it opened on, to tell an edit from nothing typed.
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(() => emptyRecoveryForm());
  // The server's refusal, shown above the fields; the fields' own problems show under each once a
  // save has been tried.
  const [formError, setFormError] = useState("");
  const [tried, setTried] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [removeReason, setRemoveReason] = useState("");
  // The removal's reason, marked under its box when Remove is pressed blank.
  const removeFields = useFormErrors();
  // A recovery made from advances whose conversion is being undone, and a refusal said in that dialog.
  const [undoing, setUndoing] = useState(null);
  const [undoError, setUndoError] = useState("");
  const { notice, showNotice, showError, clearNotice } = useNotice();
  const { busy, run } = useSubmitOnce();

  // Bumped by a failed load's Try again, which loads the register afresh.
  const [reloadToken, setReloadToken] = useState(0);

  // A failed load is said, with a way to try again - not left to look like an empty register.
  const load = useCallback(() => {
    setLoading(true);
    return kind.load()
      .then((response) => setRows(response?.data || []))
      .catch((error) => showNotice(error?.message || `Unable to load the ${kind.plural}.`, "error", { label: "Try again", onSelect: () => setReloadToken((value) => value + 1) }))
      .finally(() => setLoading(false));
  }, [kind, showNotice]);

  // Deferred a tick, like every first load here: setting state straight from an effect body is a
  // cascading render.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, reloadToken]);

  // The employees the form picks from - asked for only by somebody who may use the form.
  useEffect(() => {
    if (!canWrite) return undefined;
    let live = true;
    const timer = window.setTimeout(() => {
      kind.loadEmployees()
        .then((response) => { if (live) setEmployees(response?.data || []); })
        .catch((error) => { if (live) showError(error?.message || "Unable to load the employees."); });
    }, 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [canWrite, kind, showError]);

  const employeeOptions = useMemo(() => {
    // A new one: somebody whose payroll is frozen until it is paid out is marked, so the pick is informed.
    const held = (employee) => (!editing?.id && employee.frozenHold ? " - payroll frozen" : "");
    const options = employees.map((employee) => ({ value: String(employee.id), label: `${employee.employeeCode ? `${employee.employeeName} (${employee.employeeCode})` : employee.employeeName}${held(employee)}` }));
    // One being corrected keeps its employee in the list even if they have since left.
    const kept = editing?.row;
    if (kept && !options.some((option) => option.value === String(kept.employeeId))) {
      options.push({ value: String(kept.employeeId), label: kept.employeeCode ? `${kept.employeeName} (${kept.employeeCode})` : kept.employeeName });
    }
    return options;
  }, [employees, editing]);
  const chosenEmployee = employees.find((employee) => String(employee.id) === form.employeeId)
    || (editing?.row && String(editing.row.employeeId) === form.employeeId ? { employeeCode: editing.row.employeeCode } : null);
  const preview = recoveryPreview(form);
  // A new recovery waits while the employee's frozen payroll month awaits its payable date - said as
  // soon as they are picked, rather than after Create.
  const heldMessage = editing && !editing.id ? frozenHoldMessage(chosenEmployee?.frozenHold, kind.noun) : "";
  const fieldErrors = tried ? recoveryFieldErrors(form) : {};

  // Closing with something typed asks first - backdrop, Escape and Cancel alike.
  const dirty = Boolean(editing) && JSON.stringify(form) !== JSON.stringify(editing.initial);
  const { guard: guardClose, confirmProps: closeConfirmProps } = useUnsavedGuard(dirty, {
    title: "Close without saving?",
    message: "What was typed here is discarded.",
    confirmLabel: "Discard changes",
    cancelLabel: "Keep editing",
  });
  const requestClose = () => { if (!busy) guardClose(() => setEditing(null)); };

  function openCreate() {
    const initial = emptyRecoveryForm();
    setForm(initial);
    setFormError("");
    setTried(false);
    setEditing({ id: null, initial });
  }

  const openEdit = useCallback((row) => {
    const initial = recoveryFormFor(row);
    setForm(initial);
    setFormError("");
    setTried(false);
    setEditing({ id: row.id, row, initial });
  }, []);

  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  async function save() {
    setTried(true);
    setFormError("");
    if (recoveryFormProblem(form) || heldMessage) return;
    try {
      const response = editing.id
        ? await kind.update(editing.id, recoveryPayload(form))
        : await kind.create(recoveryPayload(form));
      setEditing(null);
      showNotice(editing.id ? `${response?.data?.[kind.idField] || kind.title} updated.` : `${response?.data?.[kind.idField] || kind.title} created.`, "success");
      await load();
    } catch (error) {
      setFormError(error?.data?.message || error?.message || `Unable to save this ${kind.noun}.`);
    }
  }

  async function confirmUndo() {
    try {
      const response = await undoPayrollRecoveryConversion(undoing.id);
      const { recoveryId, advanceIds = [] } = response?.data || {};
      showNotice(`${recoveryId || "The recovery"} removed - ${advanceIds.join(", ")} back on Advance Salary, each coming off its own month again.`, "success");
      setUndoing(null);
      await load();
    } catch (error) {
      setUndoError(error?.data?.message || error?.message || "Unable to undo this conversion.");
    }
  }

  async function confirmRemove() {
    try {
      await kind.remove(removing.id, removeReason.trim());
      showNotice(`${removing[kind.idField]} removed.`, "success");
      removeFields.clearAll();
      setRemoving(null);
      await load();
    } catch (error) {
      showError(error?.data?.message || error?.message || `Unable to remove this ${kind.noun}.`);
    }
  }

  // One row's ⋮ - the table row's and the Board card's. Nothing without `canWrite`.
  const rowActionItems = useCallback((row) => (canWrite ? [
    { label: "Edit", onSelect: () => openEdit(row) },
    // One made from advances goes by undoing the conversion, which hands them back to Advance Salary.
    ...((row.advanceIds || []).length
      ? (canUndoConversion ? [{ label: "Undo conversion", onSelect: () => { setUndoError(""); setUndoing(row); } }] : [])
      : [{ label: "Remove", tone: "danger", onSelect: () => { setRemoveReason(""); setRemoving(row); } }]),
  ] : undefined), [canWrite, canUndoConversion, openEdit]);

  const tableColumns = useMemo(() => [
    ...columnsFor(kind).map((column) => ({
      id: column.id,
      header: column.label,
      accessorFn: column.value,
      cell: column.id === "status"
        ? ({ row }) => <TableCellValue value={row.original.status} type="status" statusStyles={statusStyles} />
        : ({ row }) => column.value(row.original),
      exportValue: column.value,
      width: WIDTHS[column.id] || 150,
      minWidth: column.id === "reason" ? 180 : 110,
    })),
    ...(canWrite ? [{
      id: "actions",
      header: "",
      accessorFn: () => "",
      enableSorting: false,
      enableColumnFilter: false,
      cell: ({ row }) => <OptionsMenu ariaLabel={`Actions for ${row.original[kind.idField]}`} items={rowActionItems(row.original)} />,
      width: WIDTHS.actions,
      minWidth: WIDTHS.actions,
    }] : []),
  ], [canWrite, kind, rowActionItems]);

  const tabCounts = useMemo(() => tabCountsFor(rows, TABS), [rows]);
  const selectedRow = rows.find((row) => row.id === selectedId) || null;
  const viewingRow = rows.find((row) => row.id === viewingId) || null;
  const visibleRows = useMemo(() => rowsForTab(rows, activeTab), [activeTab, rows]);

  /*
   * The Board: every row in a column per status, in the tabs' order - so the status tabs give way
   * while it is shown. A card opens the row full screen, as a double click does. The status is the
   * payroll's answer (Completed once every instalment month is Paid), never a choice made here, so
   * nothing is dragged. Remembered per register, so Recovery and Policy Breach keep their own.
   */
  const [layout, setLayout] = useTableBoardLayout(`hrm-payroll-${kindKey}`);
  const onBoard = layout === "board";

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader
      title="Payroll"
      titleAccessory={titleAccessory}
      tabs={onBoard ? undefined : TABS.map((tab) => ({ id: tab, label: tab, count: tabCounts[tab] || 0 }))}
      tabValue={activeTab}
      onTabChange={setActiveTab}
      tabsAriaLabel={`${kind.title} status filters`}
      actions={<>
        <TableBoardSwitch value={layout} onChange={setLayout} />
        {canWrite && <Button type="button" variant="primary" onClick={openCreate}>Create {kind.title}</Button>}
      </>}
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {/* The board fills the row and scrolls sideways inside its own rail; the page never does. */}
    <div className={onBoard ? "flex min-h-0 min-w-0 flex-1" : "min-h-0 flex-1"}>
      {onBoard ? <KanbanBoard
        rows={rows}
        columns={BOARD_COLUMNS}
        statusOf={boardStatusOf}
        // The money in each column; an LOP policy breach is days, not money, so it adds nothing.
        columnAmount={(rows) => columnTotal(rows, (row) => (row.deductBy === "LOP" ? 0 : row.totalAmount), "Total")}
        card={{ title: (row) => row.employeeName || "-", subtitle: (row) => `${row[kind.idField]} · ${row.employeeCode || "-"}`, meta: (row) => `${rupees(row.totalAmount)} · ${row.instalmentsDeducted ?? 0} of ${row.months} deducted` }}
        getRowId={(row) => String(row.id)}
        onOpen={(row) => setViewingId(row.id)}
        // The card's ⋮ is the row's ⋮.
        cardActions={rowActionItems}
        viewOnly="A recovery completes as payroll deducts its instalments."
        loading={loading}
        noun={kind.plural}
        ariaLabel={`${capital(kind.plural)} board`}
      /> : <DataTableShell
        className="h-full min-h-0"
        footer={<TableFooter spread><span>{capital(kind.plural)}</span><span>Total rows: {tableStats.total}</span></TableFooter>}
      >
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <DataTable
            columns={tableColumns}
            data={visibleRows}
            loading={loading}
            loadingMessage={`Loading ${kind.plural}...`}
            emptyMessage={canWrite ? `No ${kind.plural} yet. Create ${kind.title} adds the first.` : `No ${kind.plural} yet.`}
            noMatchMessage={`No ${kind.plural} match the current filters.`}
            onVisibleRowsChange={setTableStats}
            onRowClick={(row) => { setSelectedId(row.id); setInfoPanelState("expanded"); }}
            onRowDoubleClick={(row) => setViewingId(row.id)}
            selectedRowId={selectedId ? String(selectedId) : undefined}
            getRowId={(row) => String(row.id)}
            ariaLabel={capital(kind.plural)}
            features={{ filtering: true, sorting: true, columnVisibility: true, csvExport: { enabled: true, fileName: kind.csvFileName, onResult: (exported) => showNotice(exported ? `${kind.title} CSV export downloaded.` : `No ${kind.plural} to export.`) } }}
          />
          <DataTableInfoPanel
            title={`${kind.title} Details`}
            entity={payrollRecoveryForInfo(selectedRow)}
            sections={kind.infoSections}
            emptyText={`Select a ${kind.noun} to see its details.`}
            // What it has taken back, month by month - after the details, refreshed when the row changes.
            after={selectedRow ? <PayrollPaymentHistory className="mt-4 border-t border-slate-200 pt-4" kind={kindKey} id={selectedRow.id} version={String(selectedRow.updatedAt || "")} /> : null}
            // Edit is a tap away beside the row it shows, as the ⋮ offers it - for somebody who may.
            headerActions={canWrite && selectedRow ? <Button type="button" size="sm" onClick={() => openEdit(selectedRow)}>Edit</Button> : null}
            state={infoPanelState}
            onToggle={() => setInfoPanelState((current) => (current === "expanded" ? "collapsed" : "expanded"))}
          />
        </div>
      </DataTableShell>}
    </div>

    {viewingRow && <RecordViewPanel
      title={viewingRow[kind.idField]}
      entity={payrollRecoveryForInfo(viewingRow)}
      sections={kind.infoSections}
      sidebarAriaLabel={`${kind.title} sections`}
      extraTabs={[{ id: "payment-history", label: "Payment History", render: () => <PayrollPaymentHistory kind={kindKey} id={viewingRow.id} version={String(viewingRow.updatedAt || "")} hideTitle /> }]}
      onClose={() => setViewingId(null)}
    />}

    {editing && <Dialog
      title={editing.id ? `Edit ${editing.row[kind.idField]}` : `Create ${kind.title}`}
      description={editing.id
        ? (editing.row.advanceIds?.length
          ? `Made from ${editing.row.advanceIds.join(", ")} on Advance Salary, so its employee and total stay theirs. Undo conversion in its ⋮ to remove it.`
          : `Correct this ${kind.noun}. Its ID stays the same.`)
        : kind.createNote}
      onClose={requestClose}
      footer={<>
        <Button type="button" variant="secondary" onClick={requestClose} disabled={busy}>Cancel</Button>
        <Button type="button" variant="primary" busy={busy} busyLabel="Saving..." disabled={Boolean(heldMessage)} onClick={() => run(save)}>{editing.id ? "Save" : "Create"}</Button>
      </>}
    >
      {formError && <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Dropdown
          className="sm:col-span-2"
          label="Employee Name"
          helperText={`The employee this ${kind.noun} is deducted from.`}
          required
          ariaLabel="Employee"
          placeholder="Search for the employee"
          options={employeeOptions}
          value={form.employeeId}
          onChange={(value) => set("employeeId", value)}
          error={fieldErrors.employeeId || heldMessage}
          // Made from an employee's advances, it stays theirs - as the server holds it.
          readOnly={Boolean(editing.row?.advanceIds?.length)}
          searchable
        />
        {/* A policy breach is taken as an amount or as loss-of-pay days; only the total below changes. */}
        {kind.deductByLop && <RadioGroupField className="sm:col-span-2" label="Deduct by" name="deduct-by" helperText="Take it back as a rupee amount or as loss-of-pay days." variant="field" controlClassName="!mt-1.5 !min-h-9 px-0 py-0" required options={DEDUCT_BY_OPTIONS} value={form.deductBy || "AMOUNT"} onChange={(value) => set("deductBy", value)} />}
        <TextField label="Employee ID" value={chosenEmployee?.employeeCode || ""} helperText="Filled in from the employee chosen; it cannot be typed." placeholder="Filled in from the employee" readOnly />
        {isLopForm(form)
          ? <TextField label="Total Days" required helperText="Loss-of-pay days in all, split evenly over the months below." type="number" min={0.5} step="0.5" inputMode="decimal" value={form.totalDays ?? ""} error={fieldErrors.totalDays || ""} onChange={(event) => set("totalDays", event.target.value)} />
          : <TextField label={kind.amountLabel} required helperText="The total in rupees, split evenly over the months below." type="number" min={1} step="0.01" inputMode="decimal" prefix="₹" value={form.totalAmount} readOnly={Boolean(editing.row?.advanceIds?.length)} error={fieldErrors.totalAmount || ""} onChange={(event) => set("totalAmount", event.target.value)} />}
        <Dropdown label="Start Month" required helperText="The first payroll month the deduction is taken from." ariaLabel="Start month" options={monthOptions} value={form.startMonth} error={fieldErrors.startMonth || ""} onChange={(value) => set("startMonth", value)} sorted={false} />
        <Dropdown label="Start Year" required helperText="The year of the first payroll month it is taken from." ariaLabel="Start year" options={yearOptions(new Date(), editing.row?.startYear)} value={form.startYear} error={fieldErrors.startYear || ""} onChange={(value) => set("startYear", value)} sorted={false} />
        <Dropdown label="Number of months" required helperText="How many monthly instalments the total is split into." ariaLabel="Number of months" options={monthCountOptions} value={form.months} error={fieldErrors.months || ""} onChange={(value) => set("months", value)} sorted={false} />
        <TextAreaField className="sm:col-span-2" label="Reason" rows={3} helperText={`Why this ${kind.noun} is being made, kept on its record.`} value={form.reason} onChange={(event) => set("reason", event.target.value)} placeholder={kind.reasonPlaceholder} />
      </div>
      {/* The figures the server will work out, shown as they are typed - a dash until there is an amount. */}
      {preview && <RecordSummaryCard
        className="mt-4"
        columnsClassName="sm:grid-cols-3"
        rows={[
          isLopForm(form)
            ? ["Monthly LOP Days", preview.monthlyDays]
            : ["Monthly Deduction", preview.monthlyDeduction === null ? null : rupees(preview.monthlyDeduction)],
          ["Start Date", recoveryDate(preview.startDate)],
          ["End Date", recoveryDate(preview.endDate)],
        ]}
        // Months skipped on the Main Page push the real end date a month later each.
        note={editing.row?.skippedMonths?.length
          ? `${preview.deducted} Skipped on the Main Page: ${editing.row.skippedMonths.map(monthLabel).join(", ")} - the end date is a month later for each.`
          : preview.deducted}
      />}
    </Dialog>}
    {editing && <ConfirmDialog {...closeConfirmProps} />}

    {undoing && <ConfirmDialog
      open
      title={`Undo the conversion to ${undoing.recoveryId}?`}
      message={`${undoing.recoveryId} is removed, and ${(undoing.advanceIds || []).join(", ")} go back to Advance Salary, each coming off its own month's salary again - unpaid months on the Main Page follow at once. Not possible once a month it covers has been paid.`}
      confirmLabel="Undo conversion"
      busyLabel="Undoing..."
      tone="primary"
      loading={busy}
      onCancel={() => setUndoing(null)}
      onConfirm={() => run(confirmUndo)}
    >
      {undoError && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{undoError}</p>}
    </ConfirmDialog>}

    {removing && <ConfirmDialog
      open
      title={`Remove ${removing[kind.idField]}?`}
      message={`${removing.deductBy === "LOP" ? `${dayCount(removing.totalDays)} of loss of pay` : rupees(removing.totalAmount)} from ${removing.employeeName || "this employee"} comes off the register. The record is kept for the audit trail.`}
      confirmLabel="Remove"
      busyLabel="Removing..."
      tone="danger"
      loading={busy}
      onCancel={() => { removeFields.clearAll(); setRemoving(null); }}
      onConfirm={() => { if (removeFields.check({ removeReason: removeReason.trim() ? "" : "Enter a reason." })) run(confirmRemove); }}
    >
      <TextAreaField label="Reason" required rows={3} value={removeReason} helperText="Kept on the record's audit trail with who removed it." onChange={(event) => { setRemoveReason(event.target.value); removeFields.clear("removeReason"); }} error={removeFields.errors.removeReason} placeholder="Why is it being removed?" />
    </ConfirmDialog>}
  </section>;
}
