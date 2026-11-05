"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import OptionsMenu from "@/components/ui/OptionsMenu";
import SpeakUpDecisionDialog from "@/components/hrm/SpeakUpDecisionDialog";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import useTableSelection from "@/components/data-table/useTableSelection";
import { buildTableColumns, defaultVisibilityFor } from "@/components/data-table/tableCells";
import { saveBlob } from "@/lib/downloadImage";
import { columnCount, daysSince } from "@/lib/kanbanSummary.mjs";
import { getAllSpeakUps, fetchSpeakUpAttachment, reviewSpeakUp } from "@/services/hrm/speakUp.service";
import { SPEAK_UP_DECISIONS, SPEAK_UP_STATUS_LABELS, speakUpReviewDetailSections, speakUpReviewTableFields, speakUpStatusStyles, withStatusLabel } from "@/constants/speakUpConfig";

const tableVisibility = defaultVisibilityFor(speakUpReviewTableFields);
/*
 * The Board: one column per status, in the review's own order and colours. Dropping a pending card
 * on Approved, Approved & Assigned or Rejected opens that decision's own dialog - the same one the
 * ⋮ and the panel's buttons open - so nothing is decided by the drop itself.
 */
const boardColumns = Object.keys(speakUpStatusStyles).map((label) => ({ value: label, className: `${speakUpStatusStyles[label]} text-white` }));
const DECISION_FOR_COLUMN = { [SPEAK_UP_STATUS_LABELS.APPROVED]: "APPROVE", [SPEAK_UP_STATUS_LABELS.ASSIGNED]: "ASSIGN", [SPEAK_UP_STATUS_LABELS.REJECTED]: "REJECT" };
const boardCard = {
  title: (row) => row.title,
  subtitle: (row) => [row.speakUpId, row.employeeName].filter(Boolean).join(" · "),
  meta: (row) => [row.type, row.createdAt ? String(row.createdAt).slice(0, 10) : ""].filter(Boolean).join(" · "),
};
const statusOf = (row) => row.statusLabel;
// Under Pending, a Speak-up raised over a week ago is tagged with how long it has waited, and the
// column's figure counts exactly those cards; a decided one waits on nobody.
const SPEAK_UP_WAIT_DAYS = 7;
const speakUpWaitingFlag = (row, column) => {
  if (column.value !== SPEAK_UP_STATUS_LABELS.PENDING) return "";
  const days = daysSince(row.createdAt);
  return days !== null && days > SPEAK_UP_WAIT_DAYS ? `Waiting ${days} days` : "";
};

/*
 * `canDecide` is HRM / Speak-up Review with write. Without it the table has no ⋮ at all - a control
 * the viewer may not use is absent - and the server refuses the decision either way.
 */
export default function SpeakUpReviewPanel({ onError, onNotice, canDecide = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewingId, setViewingId] = useState(null);
  // `{ decision, row }` while a decision dialog is open.
  const [deciding, setDeciding] = useState(null);
  const [busy, setBusy] = useState(false);
  const [decisionError, setDecisionError] = useState("");
  const [layout, setLayout] = useTableBoardLayout("hrm-speak-up-review");

  // Read as a callback rather than inline in the effect, because the selection's Delete reloads the
  // register afterwards and needs the same read the screen opened with.
  const load = useCallback(() => {
    setLoading(true);
    return getAllSpeakUps()
      .then((response) => setRows((response?.data || []).map(withStatusLabel)))
      .catch((error) => onError?.(error.message || "Unable to load Speak-ups."))
      .finally(() => setLoading(false));
  }, [onError]);

  // Off the render, the way the other registers read themselves: calling it in the effect body is a
  // setState inside a render pass, which React now warns about.
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All`, with Export and Delete over them
   * as every other register in the OS has.
   *
   * Delete is HR clearing a record it has finished with, so it takes `canDecide` - whoever may
   * decide a Speak-up is who may remove one - and it reaches any row, whatever its state. A Speak-up
   * that became a task leaves the task alone: that is work somebody was given, and it is closed on
   * the Tasks board rather than from here.
   */
  const bulk = useTableSelection({
    prefix: "/api/hrm/speak-up",
    rows,
    noun: "Speak-up",
    canDelete: canDecide,
    deleteMessage: "The attachment goes with it. A Speak-up that became a task leaves the task on the Tasks board.",
    showSuccess: onNotice,
    showError: onError,
    onDeleted: () => load(),
  });

  function downloadAttachment(row) {
    fetchSpeakUpAttachment(row.id)
      .then((blob) => saveBlob(blob, row.attachmentFileName))
      .catch((error) => onError?.(error.message || "Unable to download this attachment."));
  }

  async function decide(payload) {
    const { row } = deciding;
    setBusy(true);
    setDecisionError("");
    try {
      const response = await reviewSpeakUp(row.id, payload);
      // The decided row in place, so the status changes where the reader is looking.
      setRows((current) => current.map((item) => (item.id === row.id ? withStatusLabel(response.data) : item)));
      setDeciding(null);
      const taskCode = response.data?.taskCode;
      onNotice?.(taskCode ? `Speak-up approved and assigned as task ${taskCode}.` : SPEAK_UP_DECISIONS[payload.decision].said);
    } catch (error) {
      setDecisionError(error.message || "Unable to record this decision.");
    } finally {
      setBusy(false);
    }
  }

  // A decided speak-up is decided once: only a pending one offers the three choices. Without
  // `canDecide` there is no ⋮ on the row or the Board card.
  function rowActionItems(row) {
    if (!canDecide || row.status !== "PENDING") return undefined;
    return Object.entries(SPEAK_UP_DECISIONS).map(([decision, copy]) => ({
      label: copy.label,
      tone: decision === "REJECT" ? "danger" : undefined,
      onSelect: () => { setDecisionError(""); setDeciding({ decision, row }); },
    }));
  }

  // A decided row keeps the ⋮'s square so rows stay one height.
  function renderActions(row) {
    const items = rowActionItems(row);
    if (!items) return <span aria-hidden="true" className="inline-block h-8 w-8" />;
    return <OptionsMenu ariaLabel={`Actions for ${row.speakUpId || "speak-up"}`} items={items} />;
  }

  const tableColumns = buildTableColumns({ fields: speakUpReviewTableFields, statusStyles: speakUpStatusStyles, renderActions: canDecide ? renderActions : undefined });

  const viewing = rows.find((row) => row.id === viewingId) || null;
  // Same reasoning as `SpeakUpPanel`: the download button needs the row it belongs to, which a
  // formatter answered only by type cannot reach on its own.
  const viewingEntity = viewing && {
    ...viewing,
    attachmentFileName: viewing.attachmentFileName
      ? <Button variant="plain" size="none" className="text-sm text-blue-600 underline hover:text-blue-700" onClick={() => downloadAttachment(viewing)}>{viewing.attachmentFileName}</Button>
      : null,
  };

  /*
   * The page header above belongs to the Attendance screen, so the Table / Board switch sits in a
   * bar of this panel's own - the arrangement Speak-up's "Your past Speak-ups" bar already has.
   */
  return <div className="flex min-h-0 flex-1 flex-col bg-white">
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-6">
      <h3 className="min-w-0 truncate text-sm font-semibold text-slate-700">Speak-ups, studio-wide</h3>
      <TableBoardSwitch value={layout} onChange={setLayout} />
    </div>
    {layout === "board" ? <KanbanBoard
      rows={rows}
      columns={boardColumns}
      statusOf={statusOf}
      // How many Pending Speak-ups have waited 7+ days since they were raised; a decided one waits on nobody.
      columnAmount={(rows, column) => (column.value === SPEAK_UP_STATUS_LABELS.PENDING ? columnCount(rows, (row) => Boolean(speakUpWaitingFlag(row, column)), `Waiting ${SPEAK_UP_WAIT_DAYS}+ days`, `Cards in this column waiting more than ${SPEAK_UP_WAIT_DAYS} days`) : null)}
      cardFlag={speakUpWaitingFlag}
      card={boardCard}
      getRowId={(row) => String(row.id)}
      onOpen={(row) => setViewingId(row.id)}
      // The card's ⋮ is the row's ⋮.
      cardActions={rowActionItems}
      canDropAt={(row, to) => canDecide && row.status === "PENDING" && Boolean(DECISION_FOR_COLUMN[to])}
      onDrop={(row, to) => { setDecisionError(""); setDeciding({ decision: DECISION_FOR_COLUMN[to], row }); }}
      loading={loading}
      noun="Speak-ups"
      ariaLabel="Speak-ups board"
    /> : <DataTableShell className="min-h-0 flex-1 rounded-none border-0">
      <DataTable
        columns={tableColumns}
        data={rows}
        loading={loading}
        emptyMessage="No Speak-ups yet."
        noMatchMessage="No Speak-ups match the current filters."
        ariaLabel="Speak-ups, studio-wide"
        getRowId={(row) => String(row.id)}
        onRowDoubleClick={(row) => setViewingId(row.id)}
        defaultColumnVisibility={tableVisibility}
        tableClassName="min-w-full"
        features={{
          filtering: true,
          sorting: true,
          csvExport: { enabled: true, fileName: "speak-ups", onResult: (exported) => onNotice?.(exported ? "Speak-up CSV export downloaded." : "No Speak-ups available to export.") },
          selection: bulk.selection,
        }}
      />
    </DataTableShell>}

    {viewingEntity && <RecordViewPanel
      title={viewingEntity.title || "Speak-up"}
      entity={viewingEntity}
      sections={speakUpReviewDetailSections}
      formatters={{ longtext: (value) => <p className="whitespace-pre-wrap">{value}</p>, attachment: (value) => value }}
      sidebarAriaLabel="Speak-up sections"
      onClose={() => setViewingId(null)}
      /*
       * The three decisions at the foot of the open speak-up, as a task's verbs sit at the foot of
       * its panel - only while it is pending and only for somebody who may decide. A decided one
       * keeps the plain Close.
       */
      footer={canDecide && viewing.status === "PENDING" ? <div className="flex w-full flex-wrap items-center justify-end gap-2">
        {Object.entries(SPEAK_UP_DECISIONS).map(([decision, copy]) => <Button
          key={decision}
          className="max-sm:w-full"
          type="button"
          variant={decision === "REJECT" ? "danger" : decision === "ASSIGN" ? "primary" : "secondary"}
          onClick={() => { setDecisionError(""); setDeciding({ decision, row: viewing }); }}
        >{copy.label}</Button>)}
      </div> : undefined}
    />}

    {deciding && <SpeakUpDecisionDialog
      decision={deciding.decision}
      speakUp={deciding.row}
      busy={busy}
      error={decisionError}
      onClose={() => { if (!busy) setDeciding(null); }}
      onConfirm={decide}
      onError={onError}
    />}
  </div>;
}
