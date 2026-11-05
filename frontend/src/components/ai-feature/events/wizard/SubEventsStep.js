"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import SortableList from "@/components/shared/SortableList";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import TimeField from "@/components/shared/TimeField";
import EmptyState from "@/components/ai-feature/shared/EmptyState";
import { formatEventDate, formatTime } from "@/lib/aiFeature.mjs";

let nextLocalId = 1;
/** A key for a row that has no id from the server yet. */
export const localId = () => `new-${nextLocalId++}`;

const blank = () => ({ name: "", date: "", startTime: "", endTime: "", location: "", description: "" });

/** What the create endpoint takes for each row: empty strings become nulls, the local id goes. */
export function subEventsPayload(rows) {
  return rows.map((row) => ({
    name: row.name.trim(),
    date: row.date || null,
    startTime: row.startTime || null,
    endTime: row.endTime || null,
    location: row.location.trim() || null,
    description: row.description.trim() || null,
  }));
}

function SubEventForm({ initial, onSave, onCancel, dateBounds }) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const set = (name) => (value) => setDraft((current) => ({ ...current, [name]: value }));
  const fromInput = (name) => (changeEvent) => set(name)(changeEvent.target.value);
  function save() {
    if (!draft.name.trim()) { setError("Give the sub-event a name."); return; }
    if (draft.startTime && draft.endTime && draft.endTime < draft.startTime) { setError("The end time is before the start time."); return; }
    onSave(draft);
  }
  return <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3">
    <div className="space-y-3">
      <TextField label="Name" required value={draft.name} onChange={fromInput("name")} error={error} maxLength={191} placeholder="Haldi" autoFocus />
      <div className="grid gap-3 sm:grid-cols-3">
        <DateField label="Date" value={draft.date} onChange={set("date")} minDate={dateBounds.min} maxDate={dateBounds.max} />
        <TimeField label="Start Time" value={draft.startTime} onChange={fromInput("startTime")} />
        <TimeField label="End Time" value={draft.endTime} onChange={fromInput("endTime")} />
      </div>
      <TextField label="Location" value={draft.location} onChange={fromInput("location")} maxLength={255} />
      <TextAreaField label="Description" value={draft.description} onChange={fromInput("description")} maxLength={4000} rows={2} />
    </div>
    <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button type="button" size="sm" onClick={onCancel}>Cancel</Button>
      <Button type="button" size="sm" variant="primary" onClick={save}>{initial.id ? "Save sub-event" : "Add sub-event"}</Button>
    </div>
  </div>;
}

/**
 * Step two: the parts of the event that have a gallery of their own - Haldi, Sangeet, Reception.
 * Optional; an event with none is one gallery. Rows are added and edited in a form under the
 * list, reordered by drag, arrows or keyboard, and the order is the order guests see.
 */
export default function SubEventsStep({ rows, onChange, dateBounds }) {
  // `null` closed, `{}` adding, `{ id }` editing that row.
  const [editing, setEditing] = useState(null);
  const label = (row) => row.name || "Untitled";

  function saveRow(draft) {
    if (draft.id) onChange(rows.map((row) => (row.id === draft.id ? draft : row)));
    else onChange([...rows, { ...draft, id: localId() }]);
    setEditing(null);
  }
  const reorder = (order) => onChange(order.map((id) => rows.find((row) => row.id === id)).filter(Boolean));

  return <div className="space-y-3">
    <p className="text-xs text-slate-500">Sub-events split the gallery into the parts of the day. They are optional; one can be added later inside the event.</p>
    {rows.length === 0 && !editing && <EmptyState title="No sub-events yet" message="Add the ceremonies or sessions guests will look for." className="rounded-lg border border-dashed border-slate-300 py-8" />}
    {rows.length > 0 && <SortableList
      items={rows.map((row) => ({ ...row, label: label(row) }))}
      onReorder={reorder}
      label="Sub-events"
      disabled={Boolean(editing)}
      renderRow={(row) => <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800">{label(row)}</p>
          <p className="truncate text-[11px] text-slate-500">{[formatEventDate(row.date), [formatTime(row.startTime), formatTime(row.endTime)].filter(Boolean).join(" – "), row.location].filter(Boolean).join(" · ") || "No date yet"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="sm" disabled={Boolean(editing)} onClick={() => setEditing({ id: row.id })}>Edit</Button>
          <Button type="button" variant="ghost" size="sm" disabled={Boolean(editing)} className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => onChange(rows.filter((item) => item.id !== row.id))}>Remove</Button>
        </div>
      </div>}
    />}
    {editing
      ? <SubEventForm key={editing.id || "new"} initial={editing.id ? rows.find((row) => row.id === editing.id) || blank() : blank()} onSave={saveRow} onCancel={() => setEditing(null)} dateBounds={dateBounds} />
      : <Button type="button" size="sm" onClick={() => setEditing({})}>+ Add sub-event</Button>}
  </div>;
}
