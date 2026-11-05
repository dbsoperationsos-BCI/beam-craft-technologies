"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import FileUploadField from "@/components/shared/FileUploadField";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import useFormErrors from "@/components/shared/useFormErrors";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import Dialog from "@/components/ui/Dialog";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import useTableSelection from "@/components/data-table/useTableSelection";
import { buildTableColumns, defaultVisibilityFor } from "@/components/data-table/tableCells";
import { saveBlob } from "@/lib/downloadImage";
import { isBlankText } from "@/lib/formErrors.mjs";
import { columnCount, daysSince } from "@/lib/kanbanSummary.mjs";
import { createSpeakUp, getMySpeakUps, fetchSpeakUpAttachment } from "@/services/hrm/speakUp.service";
import {
  ACCEPTED_ATTACHMENT_TYPES,
  SPEAK_UP_REASSURANCE,
  SPEAK_UP_STATUS_LABELS,
  TYPE_OPTIONS,
  speakUpDescriptionFor,
  speakUpDetailSections,
  speakUpFormInitialValues,
  speakUpStatusStyles,
  speakUpTableFields,
  withStatusLabel,
} from "@/constants/speakUpConfig";

// The status is all the employee sees of the review - never who decided it, why, or whom it went to.
const tableColumns = buildTableColumns({ fields: speakUpTableFields, statusStyles: speakUpStatusStyles });
const tableVisibility = defaultVisibilityFor(speakUpTableFields);
/*
 * The Board: one column per status, in the review's own order and colours. View-only - the
 * employee has no action that moves a Speak-up between statuses; only a reviewer decides one.
 */
const speakUpBoardColumns = Object.keys(speakUpStatusStyles).map((label) => ({ value: label, className: `${speakUpStatusStyles[label]} text-white` }));
const boardCard = {
  title: (row) => row.title,
  subtitle: (row) => [row.speakUpId, row.type].filter(Boolean).join(" · "),
  meta: (row) => (row.createdAt ? String(row.createdAt).slice(0, 10) : ""),
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

/** `canWrite` decides whether Add is offered at all - a READ-only holder of `HRM / Speak-up` may
 * see their own past submissions but not raise a new one, and the control for that is absent
 * rather than disabled (Rule 4). Defaults to `true` so a caller that has not been updated to pass
 * it still gets the button. */
export default function SpeakUpPanel({ onError, onNotice, canWrite = true }) {
  const [form, setForm] = useState(speakUpFormInitialValues);
  const [mine, setMine] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [viewingId, setViewingId] = useState(null);
  const [layout, setLayout] = useTableBoardLayout("hrm-speak-up");
  const { busy, run } = useSubmitOnce();
  const fields = useFormErrors();

  const load = useCallback(() => {
    setLoading(true);
    return getMySpeakUps()
      .then((response) => setMine((response?.data || []).map(withStatusLabel)))
      .catch((error) => onError?.(error.message || "Unable to load your Speak-ups."))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  /*
   * The tick boxes, for a role holding `ADMIN / Table Select All` - the same selection every other
   * table in the OS carries, with Export and Delete over it.
   *
   * Delete is **taking back your own**, which is why it goes to `/mine/bulk` and not to the
   * register's: only rows that are yours, and only while a reviewer has not decided them yet. Once
   * one is answered it is the studio's record of what was raised, and the server refuses it with a
   * sentence saying so (`deleteSpeakUpRecord`), which the bar reports against the row that would not
   * go while clearing the ones that did.
   */
  const bulk = useTableSelection({
    prefix: "/api/hrm/speak-up/mine",
    rows: mine,
    noun: "Speak-up",
    canDelete: canWrite,
    deleteMessage: "A Speak-up a reviewer has already decided stays - it is the studio's record of what was raised and answered.",
    showSuccess: onNotice,
    showError: onError,
    onDeleted: () => load(),
  });

  // Picking "Other" asks a second question rather than leaving it to the description alone - the
  // fixed list is the studio's own words for the common cases, and this names the one case they
  // do not cover.
  const speakUpProblems = () => ({
    type: form.type ? "" : "Choose the type.",
    otherType: form.type === "Other" && isBlankText(form.otherType) ? "Enter the issue type." : "",
    title: isBlankText(form.title) ? "Enter a subject." : "",
    description: isBlankText(form.description) ? "Say what happened." : "",
  });
  const viewing = mine.find((row) => row.id === viewingId) || null;

  function downloadAttachment(row) {
    fetchSpeakUpAttachment(row.id)
      .then((blob) => saveBlob(blob, row.attachmentFileName))
      .catch((error) => onError?.(error.message || "Unable to download this attachment."));
  }

  function update(field, value) {
    fields.clear(field);
    setForm((current) => ({ ...current, [field]: value }));
  }

  function openAdd() {
    setForm(speakUpFormInitialValues);
    fields.clearAll();
    setAdding(true);
  }

  async function submit() {
    if (!fields.check(speakUpProblems())) return;
    try {
      await createSpeakUp({
        type: form.type,
        title: form.title.trim(),
        description: speakUpDescriptionFor(form),
        attachment: form.attachment[0] || null,
      });
      setAdding(false);
      onNotice?.("Your Speak-up has been sent to HR.");
      await load();
    } catch (error) {
      if (!fields.fromServer(error)) onError?.(error.message || "Unable to save this Speak-up.");
    }
  }

  // The attachment cell is built here, per row, where the download handler can still name the row
  // it belongs to - `RecordDetails`' own formatters answer only by type, with no way back to the
  // record they came from, so this is done once on the way in rather than asked of it.
  const viewingEntity = viewing && {
    ...viewing,
    attachmentFileName: viewing.attachmentFileName
      ? <Button variant="plain" size="none" className="text-sm text-blue-600 underline hover:text-blue-700" onClick={() => downloadAttachment(viewing)}>{viewing.attachmentFileName}</Button>
      : null,
  };

  return <div className="flex min-h-0 flex-1 flex-col bg-white">
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-6">
      <h3 className="min-w-0 truncate text-sm font-semibold text-slate-700">Your past Speak-ups</h3>
      <div className="flex shrink-0 items-center gap-2">
        <TableBoardSwitch value={layout} onChange={setLayout} />
        {canWrite && <Button variant="primary" onClick={openAdd}>Add Speak-up</Button>}
      </div>
    </div>
    {layout === "board" ? <KanbanBoard
      rows={mine}
      columns={speakUpBoardColumns}
      statusOf={statusOf}
      // Under Pending only, how many of yours have waited over a week for a reviewer; the decided columns have nothing waiting.
      columnAmount={(rows, column) => (column.value === SPEAK_UP_STATUS_LABELS.PENDING ? columnCount(rows, (row) => Boolean(speakUpWaitingFlag(row, column)), `Waiting ${SPEAK_UP_WAIT_DAYS}+ days`, `Cards in this column waiting more than ${SPEAK_UP_WAIT_DAYS} days`) : null)}
      cardFlag={speakUpWaitingFlag}
      card={boardCard}
      getRowId={(row) => String(row.id)}
      onOpen={(row) => setViewingId(row.id)}
      viewOnly="Only a reviewer decides a Speak-up's status."
      loading={loading}
      noun="Speak-ups"
      ariaLabel="Your Speak-ups board"
    /> : <DataTableShell className="min-h-0 flex-1 rounded-none border-0">
      <DataTable
        columns={tableColumns}
        data={mine}
        loading={loading}
        emptyMessage="You haven&apos;t sent one yet."
        noMatchMessage="No Speak-ups match the current filters."
        ariaLabel="Your Speak-ups"
        getRowId={(row) => String(row.id)}
        onRowDoubleClick={(row) => setViewingId(row.id)}
        defaultColumnVisibility={tableVisibility}
        tableClassName="min-w-full"
        features={{
          filtering: true,
          sorting: true,
          csvExport: { enabled: true, fileName: "my-speak-ups", onResult: (exported) => onNotice?.(exported ? "Speak-up CSV export downloaded." : "No Speak-ups available to export.") },
          selection: bulk.selection,
        }}
      />
    </DataTableShell>}

    {viewingEntity && <RecordViewPanel
      title={viewingEntity.title || "Speak-up"}
      entity={viewingEntity}
      sections={speakUpDetailSections}
      formatters={{ longtext: (value) => <p className="whitespace-pre-wrap">{value}</p>, attachment: (value) => value }}
      sidebarAriaLabel="Speak-up sections"
      onClose={() => setViewingId(null)}
    />}

    {adding && <Dialog
      title="Add Speak-up"
      onClose={() => setAdding(false)}
      footer={<>
        <Button variant="secondary" onClick={() => setAdding(false)} disabled={busy}>Discard</Button>
        <Button variant="primary" busy={busy} busyLabel="Sending..." onClick={() => run(submit)}>Send</Button>
      </>}
    >
      <p className="mb-4 text-sm text-slate-600">
        {SPEAK_UP_REASSURANCE}
      </p>
      {fields.summary && <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{fields.summary}</p>}
      <div className="flex flex-col gap-4">
        <Dropdown
          label="Type"
          helperText="The kind of concern, so it reaches the right reviewer."
          required
          ariaLabel="Speak-up type"
          placeholder="Select a type"
          options={TYPE_OPTIONS}
          value={form.type}
          onChange={(value) => update("type", value)}
          error={fields.errors.type}
        />
        {form.type === "Other" && <TextField
          label="Please specify the issue type"
          helperText="Name the kind of issue in a few words."
          required
          value={form.otherType}
          onChange={(event) => update("otherType", event.target.value)}
          error={fields.errors.otherType}
        />}
        <TextField
          label="Subject"
          helperText="A short line that sums up the concern."
          required
          value={form.title}
          onChange={(event) => update("title", event.target.value)}
          error={fields.errors.title}
        />
        <TextAreaField
          label="What happened?"
          helperText="Describe it in your own words; it stays confidential."
          required
          rows={6}
          value={form.description}
          onChange={(event) => update("description", event.target.value)}
          error={fields.errors.description}
        />
        <FileUploadField
          label="Attachment"
          helperText="Optional proof, such as a screenshot or document; one file."
          value={form.attachment}
          onChange={(value) => update("attachment", value)}
          accept={ACCEPTED_ATTACHMENT_TYPES}
          maxFiles={1}
        />
      </div>
    </Dialog>}
  </div>;
}
