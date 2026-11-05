"use client";

import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import SortableList from "@/components/shared/SortableList";
import EmptyState from "@/components/ai-feature/shared/EmptyState";
import { formatEventDate, formatTime, toDateInput } from "@/lib/aiFeature.mjs";
import { deleteAiSubEvent, listAiSubEvents, reorderAiSubEvents } from "@/services/ai-feature/ai-feature.service";
import SubEventDialog from "../SubEventDialog";

/** The event's ceremonies and sessions, in the order guests will see them. Drag to reorder. */
export default function SubEventsTab({ eventId, event, canWrite, reloadEvent, showSuccess, showError }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setRows((await listAiSubEvents(eventId)).data || []); setError(""); }
    catch (cause) { setError(cause.message || "Unable to load the sub events."); setRows([]); }
  }, [eventId]);
  useEffect(() => {
    const timer = window.setTimeout(() => { load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function reorder(orderIds) {
    const previous = rows;
    setRows(orderIds.map((id) => rows.find((row) => row.id === id)).filter(Boolean));
    try { await reorderAiSubEvents(eventId, orderIds); reloadEvent?.(); }
    catch (cause) { setRows(previous); showError(cause.message || "Unable to reorder the sub events."); }
  }
  async function remove(subEvent) {
    setBusy(true);
    try {
      await deleteAiSubEvent(eventId, subEvent.id);
      setDialog(null);
      showSuccess("Sub event removed.");
      load(); reloadEvent?.();
    } catch (cause) {
      showError(cause.message || "Unable to remove the sub event.");
    } finally {
      setBusy(false);
    }
  }

  const schedule = (row) => [formatEventDate(row.date), row.startTime && `${formatTime(row.startTime)}${row.endTime ? ` – ${formatTime(row.endTime)}` : ""}`, row.location].filter(Boolean).join(" • ");

  return <div className="mx-auto max-w-3xl">
    <div className="mb-3 flex items-center justify-between gap-2">
      <p className="text-xs text-slate-500">{rows ? `${rows.length} sub ${rows.length === 1 ? "event" : "events"}` : ""}{canWrite && rows?.length > 1 ? " • drag a row to reorder" : ""}</p>
      {canWrite && <Button type="button" size="sm" variant="primary" onClick={() => setDialog({ kind: "form" })}>+ Add Sub Event</Button>}
    </div>
    {error && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    {rows === null
      ? <Loader label="Loading sub events..." />
      : rows.length === 0
        ? <EmptyState title="No sub events yet." message="Split the event into its ceremonies and sessions so folders and guest groups can be filed under each." action={canWrite && <Button type="button" size="sm" variant="primary" onClick={() => setDialog({ kind: "form" })}>Add the first one</Button>} />
        : <SortableList
          label="Sub events"
          items={rows}
          disabled={!canWrite}
          onReorder={reorder}
          renderRow={(row) => <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">{row.name}</p>
              <p className="truncate text-[11px] text-slate-500">{schedule(row) || "No schedule yet"}</p>
              {row.description && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{row.description}</p>}
            </div>
            {canWrite && <OptionsMenu ariaLabel={`Options for ${row.name}`} items={[
              { label: "Edit", onSelect: () => setDialog({ kind: "form", subEvent: row }) },
              { label: "Remove", tone: "danger", onSelect: () => setDialog({ kind: "delete", subEvent: row }) },
            ]} />}
          </div>}
        />}

    {canWrite && dialog?.kind === "form" && <SubEventDialog eventId={eventId} subEvent={dialog.subEvent || null} minDate={toDateInput(event?.startDate)} maxDate={toDateInput(event?.endDate)} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); showSuccess(dialog.subEvent ? "Sub event updated." : "Sub event added."); load(); reloadEvent?.(); }} />}
    <ConfirmDialog
      open={canWrite && dialog?.kind === "delete"}
      title="Remove this sub event?"
      message={`"${dialog?.subEvent?.name}" is removed. Folders filed under it stay, unbound; guest groups lose it from their access.`}
      confirmLabel="Remove"
      loading={busy}
      onCancel={() => setDialog(null)}
      onConfirm={() => remove(dialog.subEvent)}
    />
  </div>;
}
