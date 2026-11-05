"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
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
import { payrollAdvanceForInfo, payrollAdvanceInfoSections } from "@/constants/infoPanelConfig";
import {
  advanceFieldErrors,
  advanceFormFor,
  advanceFormProblem,
  advancePayload,
  advancesTotal,
  conversionFieldErrors,
  conversionFormFor,
  conversionPayload,
  conversionPreview,
  deductionMonthLabel,
  emptyAdvanceForm,
  localToday,
} from "@/lib/payrollAdvance.mjs";
import { frozenHoldMessage, monthCountOptions, monthLabel, monthOptions, recoveryDate, rupees, yearOptions } from "@/lib/payrollRecovery.mjs";
import {
  convertPayrollAdvancesToRecovery,
  createPayrollAdvance,
  getPayrollAdvanceEmployees,
  getPayrollAdvances,
  removePayrollAdvance,
  updatePayrollAdvance,
} from "@/services/hrm/payrollAdvance.service";

/*
 * HRM → Payroll → **Advance Salary**: money paid to an employee ahead of their salary, taken back in
 * full from one month's payroll - the Recovery register's layout, for a single deduction.
 *
 * Create Advance asks for the date it was given, the employee by name (their Employee ID comes with
 * them), the amount, the month it is taken back from and the reason. The server mints the Advance ID
 * (`ADV-ID-0001`), works the status out from the payroll (Pending until the month it comes off is
 * Paid on the Main Page, Deducted from then) and
 * hands that month's payroll row on the Main Page its Salary Advance - at once, if the row is there
 * and not yet paid. A month already paid is settled, and the server says so.
 *
 * **Convert to Recovery.** One employee's advances, ticked together, become one recovery taken back
 * over months: the header offers Convert to Recovery over the ticked rows, and the dialog asks only
 * the start month and how many months - the employee and the total are the advances'. Once one is
 * ticked, only that employee's advances can be ticked beside it. Converted, they move to Payroll →
 * Recovery and leave this register (the server keeps them, linked, for the audit); the recovery's
 * own ⋮ there can undo it, which brings them back here.
 *
 * One tap on a row shows it in the info panel beside the table; two open it full screen, read-only -
 * as every register does. Editing is the ⋮'s.
 *
 * `HRM / Payroll Advance`: Read shows the register; Read / Write adds Create Advance and each row's
 * ⋮ (Edit, Remove). Converting also needs `HRM / Payroll Recovery` Read / Write (`canConvert`):
 * without it there are no tick boxes. Absent, not disabled; the server checks again.
 */

// Pending and Deducted are where an advance has got to; Skipped is which ones were moved off a
// month on the Main Page, and a skipped advance is still Pending - see `payrollTabs.mjs`.
const TABS = ["All", "Pending", "Deducted", SKIPPED_TAB];
const statusStyles = { Pending: "bg-amber-500", Deducted: "bg-emerald-500", [SKIPPED_TAB]: "bg-sky-500" };
// The Board's columns: the status tabs, less All, in their colours. A skipped row still owed stands
// under Skipped there (`boardStatusOf`), not under its live status as well - a card is in one column.
const BOARD_COLUMNS = TABS.filter((tab) => tab !== "All").map((tab) => ({ value: tab, label: tab, className: `${statusStyles[tab]} text-white` }));
// The board's trend counts an advance by the day it was given (Advance Date), else when it was entered.
const advanceDateOf = (row) => {
  const time = new Date(row.advanceDate || row.createdAt || "").getTime();
  return Number.isNaN(time) ? null : time;
};

const columns = [
  { id: "advanceId", label: "Advance ID", value: (row) => row.advanceId },
  { id: "advanceDate", label: "Date", value: (row) => recoveryDate(row.advanceDate) || "-" },
  { id: "employeeCode", label: "Employee ID", value: (row) => row.employeeCode || "-" },
  { id: "employeeName", label: "Employee Name", value: (row) => row.employeeName || "-" },
  { id: "amount", label: "Amount", value: (row) => rupees(row.amount) },
  { id: "deductMonth", label: "From Month", value: (row) => deductionMonthLabel(row.deductYear, row.deductMonth) || "-" },
  { id: "reason", label: "Reason", value: (row) => row.reason || "-" },
  { id: "status", label: "Status", value: (row) => row.status },
  // Skipped on the Main Page: From Month is then the month it now comes off.
  { id: "skippedMonths", label: "Skipped Months", value: (row) => (row.skippedMonths || []).map(monthLabel).join(", ") || "-" },
];

const WIDTHS = { advanceId: 140, advanceDate: 130, employeeCode: 120, employeeName: 180, deductMonth: 160, reason: 260, actions: 56 };

export default function PayrollAdvanceSection({ titleAccessory = null, canWrite = false, canConvert = false }) {
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
  const [form, setForm] = useState(() => emptyAdvanceForm());
  // The server's refusal, shown above the fields; the fields' own problems show under each once a
  // save has been tried.
  const [formError, setFormError] = useState("");
  const [tried, setTried] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [removeReason, setRemoveReason] = useState("");
  // A refused removal - a month paid since - said in the dialog, beside the reason it was asked for.
  const [removeError, setRemoveError] = useState("");
  // The removal's reason, marked under its box when Remove is pressed blank.
  const removeFields = useFormErrors();
  // The rows ticked for Convert to Recovery, by id.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  // `{ advances }` while the Convert to Recovery dialog is open, with its form and what went wrong.
  const [converting, setConverting] = useState(null);
  const [convertForm, setConvertForm] = useState(null);
  const [convertError, setConvertError] = useState("");
  const [convertTried, setConvertTried] = useState(false);
  const { notice, showNotice, showError, clearNotice } = useNotice();
  const { busy, run } = useSubmitOnce();
  const router = useRouter();

  // Bumped by a failed load's Try again, which loads the register afresh.
  const [reloadToken, setReloadToken] = useState(0);

  // A failed load is said, with a way to try again - not left to look like an empty register.
  const load = useCallback(() => {
    setLoading(true);
    return getPayrollAdvances()
      .then((response) => setRows(response?.data || []))
      .catch((error) => showNotice(error?.message || "Unable to load the advances.", "error", { label: "Try again", onSelect: () => setReloadToken((value) => value + 1) }))
      .finally(() => setLoading(false));
  }, [showNotice]);

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
      getPayrollAdvanceEmployees()
        .then((response) => { if (live) setEmployees(response?.data || []); })
        .catch((error) => { if (live) showError(error?.message || "Unable to load the employees."); });
    }, 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [canWrite, showError]);

  const employeeOptions = useMemo(() => {
    // A new one: somebody whose payroll is frozen until it is paid out is marked, so the pick is informed.
    const held = (employee) => (!editing?.id && employee.frozenHold ? " - payroll frozen" : "");
    const options = employees.map((employee) => ({ value: String(employee.id), label: `${employee.employeeCode ? `${employee.employeeName} (${employee.employeeCode})` : employee.employeeName}${held(employee)}` }));
    // An advance being corrected keeps its employee in the list even if they have since left.
    const kept = editing?.row;
    if (kept && !options.some((option) => option.value === String(kept.employeeId))) {
      options.push({ value: String(kept.employeeId), label: kept.employeeCode ? `${kept.employeeName} (${kept.employeeCode})` : kept.employeeName });
    }
    return options;
  }, [employees, editing]);
  const chosenEmployee = employees.find((employee) => String(employee.id) === form.employeeId)
    || (editing?.row && String(editing.row.employeeId) === form.employeeId ? { employeeCode: editing.row.employeeCode } : null);
  // A new advance waits while the employee's frozen payroll month awaits its payable date - said as
  // soon as they are picked, rather than after Create.
  const heldMessage = editing && !editing.id ? frozenHoldMessage(chosenEmployee?.frozenHold, "salary advance") : "";
  const fieldErrors = tried ? advanceFieldErrors(form) : {};
  const fromMonth = deductionMonthLabel(form.deductYear, form.deductMonth);

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
    const initial = emptyAdvanceForm();
    setForm(initial);
    setFormError("");
    setTried(false);
    setEditing({ id: null, initial });
  }

  const openEdit = useCallback((row) => {
    const initial = advanceFormFor(row);
    setForm(initial);
    setFormError("");
    setTried(false);
    setEditing({ id: row.id, row, initial });
  }, []);

  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  async function save() {
    setTried(true);
    setFormError("");
    if (advanceFormProblem(form) || heldMessage) return;
    try {
      const response = editing.id
        ? await updatePayrollAdvance(editing.id, advancePayload(form))
        : await createPayrollAdvance(advancePayload(form));
      setEditing(null);
      showNotice(editing.id ? `${response?.data?.advanceId || "Advance"} updated.` : `${response?.data?.advanceId || "Advance"} created.`, "success");
      await load();
    } catch (error) {
      setFormError(error?.data?.message || error?.message || "Unable to save this advance.");
    }
  }

  // The ticked advances, and whose they are: a recovery is one person's.
  const selectedAdvances = useMemo(() => rows.filter((row) => selectedIds.has(String(row.id))), [rows, selectedIds]);
  const selectedEmployees = useMemo(() => [...new Set(selectedAdvances.map((row) => row.employeeId))], [selectedAdvances]);
  const selectedEmployee = selectedEmployees.length === 1 ? selectedEmployees[0] : null;
  // Once one is ticked, only that employee's advances can be ticked beside it.
  const canSelectRow = useCallback((row) => selectedEmployee === null || row.employeeId === selectedEmployee, [selectedEmployee]);

  const openConvert = useCallback(() => {
    if (!selectedAdvances.length || selectedEmployees.length !== 1) return;
    setConvertForm(conversionFormFor(selectedAdvances));
    setConvertError("");
    setConvertTried(false);
    setConverting({ advances: selectedAdvances });
  }, [selectedAdvances, selectedEmployees]);

  // Drawn in the header over the ticked rows, beside Export and the cross that clears them. Its hint
  // says why the other employees' rows lost their tick boxes - or, after the header's tick-all, why
  // it cannot be pressed.
  const selectedName = selectedAdvances[0]?.employeeName || "this employee";
  const selectionActions = useMemo(() => (canConvert ? [{
    id: "convert-to-recovery",
    label: "Convert to Recovery",
    variant: "primary",
    onClick: openConvert,
    disabled: selectedEmployees.length !== 1,
    title: selectedEmployees.length > 1
      ? "Tick the advances of one employee - a recovery is one person's. Clear the selection with the header tick box and start again."
      : `Only ${selectedName}'s advances can be ticked with these - clear the selection with the header tick box to choose someone else.`,
  }] : undefined), [canConvert, openConvert, selectedEmployees, selectedName]);

  const convertFieldErrors = convertTried && convertForm ? conversionFieldErrors(convertForm) : {};
  const convertPreview = converting && convertForm ? conversionPreview(converting.advances, convertForm) : null;
  const setConvert = (field, value) => setConvertForm((current) => ({ ...current, [field]: value }));
  // A conversion makes a new recovery, which waits while the employee's frozen payroll awaits its payable date.
  const convertHeld = converting
    ? frozenHoldMessage(employees.find((employee) => String(employee.id) === String(converting.advances[0]?.employeeId))?.frozenHold, "recovery")
    : "";

  async function confirmConvert() {
    setConvertTried(true);
    setConvertError("");
    if (Object.values(conversionFieldErrors(convertForm)).some(Boolean) || convertHeld) return;
    try {
      const response = await convertPayrollAdvancesToRecovery(conversionPayload(converting.advances, convertForm));
      const { recovery, advanceIds = [] } = response?.data || {};
      showNotice(
        `${advanceIds.join(", ")} moved to Recovery as ${recovery?.recoveryId || "one recovery"} - ${rupees(recovery?.monthlyDeduction)} a month from ${deductionMonthLabel(recovery?.startYear, recovery?.startMonth)}.`,
        "success",
        { label: "View recovery", onSelect: () => router.push("/hrm/payroll?section=recovery") },
      );
      setConverting(null);
      setSelectedIds(new Set());
      await load();
    } catch (error) {
      setConvertError(error?.data?.message || error?.message || "Unable to convert these advances.");
    }
  }

  async function confirmRemove() {
    try {
      await removePayrollAdvance(removing.id, removeReason.trim());
      showNotice(`${removing.advanceId} removed.`, "success");
      removeFields.clearAll();
      setRemoving(null);
      await load();
    } catch (error) {
      setRemoveError(error?.data?.message || error?.message || "Unable to remove this advance.");
    }
  }

  // One advance's ⋮ - the table row's and the Board card's. Nothing without `canWrite`.
  const rowActionItems = useCallback((row) => (canWrite ? [
    { label: "Edit", onSelect: () => openEdit(row) },
    { label: "Remove", tone: "danger", onSelect: () => { setRemoveReason(""); setRemoveError(""); setRemoving(row); } },
  ] : undefined), [canWrite, openEdit]);

  const tableColumns = useMemo(() => [
    ...columns.map((column) => ({
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
      cell: ({ row }) => <OptionsMenu ariaLabel={`Actions for ${row.original.advanceId}`} items={rowActionItems(row.original)} />,
      width: WIDTHS.actions,
      minWidth: WIDTHS.actions,
    }] : []),
  ], [canWrite, rowActionItems]);

  const tabCounts = useMemo(() => tabCountsFor(rows, TABS), [rows]);
  const selectedRow = rows.find((row) => row.id === selectedId) || null;
  const viewingRow = rows.find((row) => row.id === viewingId) || null;
  const visibleRows = useMemo(() => rowsForTab(rows, activeTab), [activeTab, rows]);

  /*
   * The Board: every advance in a column per status, in the tabs' order - so the status tabs give way
   * while it is shown. A card opens the advance full screen, as a double click on its row does. The
   * status is the payroll's answer (Deducted once its month is Paid), never a choice made here, so
   * nothing is dragged. Ticks are the table's, for Convert to Recovery, and go with it.
   */
  const [layout, setLayout] = useTableBoardLayout("hrm-payroll-advance");
  const onBoard = layout === "board";
  const changeLayout = useCallback((next) => { setLayout(next); setSelectedIds(new Set()); }, [setLayout]);

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader
      title="Payroll"
      titleAccessory={titleAccessory}
      tabs={onBoard ? undefined : TABS.map((tab) => ({ id: tab, label: tab, count: tabCounts[tab] || 0 }))}
      tabValue={activeTab}
      // A tick never outlives the tab it was made on, so nothing hidden is converted.
      onTabChange={(tab) => { setActiveTab(tab); setSelectedIds(new Set()); }}
      tabsAriaLabel="Advance status filters"
      actions={<>
        <TableBoardSwitch value={layout} onChange={changeLayout} />
        {canWrite && <Button type="button" variant="primary" onClick={openCreate}>Create Advance</Button>}
      </>}
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {/* The board fills the row and scrolls sideways inside its own rail; the page never does. */}
    <div className={onBoard ? "flex min-h-0 min-w-0 flex-1" : "min-h-0 flex-1"}>
      {onBoard ? <KanbanBoard
        rows={rows}
        columns={BOARD_COLUMNS}
        statusOf={boardStatusOf}
        // What is still owed (Pending, Skipped) and what has been taken back (Deducted).
        columnAmount={(rows, column) => columnTotal(rows, (row) => row.amount, column.value === "Deducted" ? "Deducted" : "Owed")}
        dateOf={advanceDateOf}
        card={{ title: (row) => row.employeeName || "-", subtitle: (row) => `${row.advanceId} · ${row.employeeCode || "-"}`, meta: (row) => [rupees(row.amount), deductionMonthLabel(row.deductYear, row.deductMonth)].filter(Boolean).join(" · ") }}
        getRowId={(row) => String(row.id)}
        onOpen={(row) => setViewingId(row.id)}
        // The card's ⋮ is the row's ⋮.
        cardActions={rowActionItems}
        viewOnly="An advance is marked Deducted when payroll deducts it."
        loading={loading}
        noun="advances"
        ariaLabel="Salary advances board"
      /> : <DataTableShell
        className="h-full min-h-0"
        footer={<TableFooter spread><span>Advances</span><span>Total rows: {tableStats.total}</span></TableFooter>}
      >
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <DataTable
            columns={tableColumns}
            data={visibleRows}
            loading={loading}
            loadingMessage="Loading advances..."
            emptyMessage={canWrite ? "No advances yet. Create Advance adds the first." : "No advances yet."}
            noMatchMessage="No advances match the current filters."
            onVisibleRowsChange={setTableStats}
            onRowClick={(row) => { setSelectedId(row.id); setInfoPanelState("expanded"); }}
            onRowDoubleClick={(row) => setViewingId(row.id)}
            selectedRowId={selectedId ? String(selectedId) : undefined}
            getRowId={(row) => String(row.id)}
            ariaLabel="Salary advances"
            features={{
              filtering: true,
              sorting: true,
              columnVisibility: true,
              csvExport: { enabled: true, fileName: "payroll-advances", onResult: (exported) => showNotice(exported ? "Advance CSV export downloaded." : "No advances to export.") },
              // Tick boxes only for somebody who may convert what they tick.
              selection: canConvert ? { selectedIds, onChange: setSelectedIds, canSelectRow, rowLabel: (row) => row.advanceId, noun: "advance", actions: selectionActions } : undefined,
            }}
          />
          <DataTableInfoPanel
            title="Advance Details"
            entity={payrollAdvanceForInfo(selectedRow)}
            sections={payrollAdvanceInfoSections}
            emptyText="Select an advance to see its details."
            // What it has taken back, month by month - after the details, refreshed when the row changes.
            after={selectedRow ? <PayrollPaymentHistory className="mt-4 border-t border-slate-200 pt-4" kind="advance" id={selectedRow.id} version={String(selectedRow.updatedAt || "")} /> : null}
            // Edit is a tap away beside the row it shows, as the ⋮ offers it - for somebody who may.
            headerActions={canWrite && selectedRow ? <Button type="button" size="sm" onClick={() => openEdit(selectedRow)}>Edit</Button> : null}
            state={infoPanelState}
            onToggle={() => setInfoPanelState((current) => (current === "expanded" ? "collapsed" : "expanded"))}
          />
        </div>
      </DataTableShell>}
    </div>

    {viewingRow && <RecordViewPanel
      title={viewingRow.advanceId}
      entity={payrollAdvanceForInfo(viewingRow)}
      sections={payrollAdvanceInfoSections}
      sidebarAriaLabel="Advance sections"
      extraTabs={[{ id: "payment-history", label: "Payment History", render: () => <PayrollPaymentHistory kind="advance" id={viewingRow.id} version={String(viewingRow.updatedAt || "")} hideTitle /> }]}
      onClose={() => setViewingId(null)}
    />}

    {editing && <Dialog
      title={editing.id ? `Edit ${editing.row.advanceId}` : "Create Advance"}
      description={editing.id ? "Correct this advance. Its ID stays the same." : "The Advance ID is given when it is saved."}
      onClose={requestClose}
      footer={<>
        <Button type="button" variant="secondary" onClick={requestClose} disabled={busy}>Cancel</Button>
        <Button type="button" variant="primary" busy={busy} busyLabel="Saving..." disabled={Boolean(heldMessage)} onClick={() => run(save)}>{editing.id ? "Save" : "Create"}</Button>
      </>}
    >
      {formError && <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DateField label="Date" required value={form.advanceDate} helperText="The day the advance was handed over; it cannot be a future day." maxDate={localToday()} error={fieldErrors.advanceDate || ""} onChange={(value) => set("advanceDate", value || "")} />
        <TextField label="Amount" required helperText="The advance in rupees, taken back in full from one month's salary." type="number" min={1} step="0.01" inputMode="decimal" prefix="₹" value={form.amount} error={fieldErrors.amount || ""} onChange={(event) => set("amount", event.target.value)} />
        <Dropdown
          label="Employee Name"
          helperText="The employee who received the advance."
          required
          ariaLabel="Employee"
          placeholder="Search for the employee"
          options={employeeOptions}
          value={form.employeeId}
          onChange={(value) => set("employeeId", value)}
          error={fieldErrors.employeeId || heldMessage}
          searchable
        />
        <TextField label="Employee ID" value={chosenEmployee?.employeeCode || ""} helperText="Filled in from the employee chosen; it cannot be typed." placeholder="Filled in from the employee" readOnly />
        <Dropdown label="From Month" required helperText="The payroll month the advance is deducted from." ariaLabel="Month it is taken back from" options={monthOptions} value={form.deductMonth} error={fieldErrors.deductMonth || ""} onChange={(value) => set("deductMonth", value)} sorted={false} />
        <Dropdown label="From Year" required helperText="The year of the payroll the advance is deducted from." ariaLabel="Year it is taken back from" options={yearOptions(new Date(), editing.row?.deductYear)} value={form.deductYear} error={fieldErrors.deductYear || ""} onChange={(value) => set("deductYear", value)} sorted={false} />
        <TextAreaField className="sm:col-span-2" label="Reason" rows={3} value={form.reason} helperText="Why the advance was given, kept on its record." onChange={(event) => set("reason", event.target.value)} placeholder="Medical, a family function..." />
      </div>
      {/* Where the money comes back from, as it is chosen. */}
      {fromMonth && <RecordSummaryCard
        className="mt-4"
        columnsClassName="sm:grid-cols-2"
        rows={[
          ["Employee", employeeOptions.find((option) => option.value === form.employeeId)?.label || null],
          ["Taken back from", `${fromMonth} salary`],
        ]}
        note={`The whole amount comes off the ${fromMonth} payroll as its Salary Advance.`}
      />}
    </Dialog>}
    {editing && <ConfirmDialog {...closeConfirmProps} />}

    {converting && convertForm && <Dialog
      title="Convert to Recovery"
      description="They move to Payroll → Recovery as one recovery, taken back over the months you choose, and leave this list. Undo it from the recovery's ⋮ there."
      onClose={() => { if (!busy) setConverting(null); }}
      footer={<>
        <Button type="button" variant="secondary" onClick={() => setConverting(null)} disabled={busy}>Cancel</Button>
        <Button type="button" variant="primary" busy={busy} busyLabel="Converting..." disabled={Boolean(convertHeld)} onClick={() => run(confirmConvert)}>Convert to Recovery</Button>
      </>}
    >
      {(convertError || convertHeld) && <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{convertError || convertHeld}</p>}
      {/* What is being converted - the advances' own, not asked again. */}
      <RecordSummaryCard
        columnsClassName="sm:grid-cols-3"
        rows={[
          ["Employee", converting.advances[0].employeeCode ? `${converting.advances[0].employeeName} (${converting.advances[0].employeeCode})` : converting.advances[0].employeeName],
          ["Advances", converting.advances.map((row) => row.advanceId).join(", ")],
          ["Total", rupees(advancesTotal(converting.advances))],
        ]}
      />
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Dropdown label="Start Month" required ariaLabel="Start month" options={monthOptions} value={convertForm.startMonth} helperText="The first payroll month the recovery is deducted from." error={convertFieldErrors.startMonth || ""} onChange={(value) => setConvert("startMonth", value)} sorted={false} />
        <Dropdown label="Start Year" required ariaLabel="Start year" options={yearOptions(new Date(), Number(convertForm.startYear))} helperText="The year of the first payroll month it is deducted from." value={convertForm.startYear} error={convertFieldErrors.startYear || ""} onChange={(value) => setConvert("startYear", value)} sorted={false} />
        <Dropdown className="sm:col-span-2" label="Number of months" required ariaLabel="Number of months" placeholder="Choose how many months" helperText="The total is split evenly into this many monthly deductions." options={monthCountOptions} value={convertForm.months} error={convertFieldErrors.months || ""} onChange={(value) => setConvert("months", value)} sorted={false} />
        <TextAreaField className="sm:col-span-2" label="Reason" rows={2} value={convertForm.reason} helperText="Why the advances are being recovered over months, kept on the recovery." onChange={(event) => setConvert("reason", event.target.value)} />
      </div>
      {/* The recovery as it will read on Payroll → Recovery - a dash until the months are chosen. */}
      {convertPreview && <RecordSummaryCard
        className="mt-4"
        columnsClassName="sm:grid-cols-3"
        rows={[
          ["Monthly Deduction", Number(convertForm.months) >= 1 ? rupees(convertPreview.monthlyDeduction) : null],
          ["Start Date", recoveryDate(convertPreview.startDate)],
          ["End Date", Number(convertForm.months) >= 1 ? recoveryDate(convertPreview.endDate) : null],
        ]}
        note={Number(convertForm.months) >= 1 ? convertPreview.deducted : "Choose the number of months to see the monthly deduction."}
      />}
    </Dialog>}

    {removing && <ConfirmDialog
      open
      title={`Remove ${removing.advanceId}?`}
      message={`${rupees(removing.amount)} to ${removing.employeeName || "this employee"} comes off the register and will no longer be deducted from the ${deductionMonthLabel(removing.deductYear, removing.deductMonth)} payroll. The record is kept for the audit trail.`}
      confirmLabel="Remove"
      busyLabel="Removing..."
      tone="danger"
      loading={busy}
      onCancel={() => { removeFields.clearAll(); setRemoving(null); }}
      onConfirm={() => { if (removeFields.check({ removeReason: removeReason.trim() ? "" : "Enter a reason." })) run(confirmRemove); }}
    >
      {removeError && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{removeError}</p>}
      <TextAreaField label="Reason" required rows={3} value={removeReason} helperText="Kept on the record's audit trail with who removed it." onChange={(event) => { setRemoveReason(event.target.value); removeFields.clear("removeReason"); }} error={removeFields.errors.removeReason} placeholder="Why is it being removed?" />
    </ConfirmDialog>}
  </section>;
}
