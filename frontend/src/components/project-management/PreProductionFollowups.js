"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import TextAreaField from "@/components/shared/TextAreaField";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { layers } from "@/constants/layers";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import useFormErrors from "@/components/shared/useFormErrors";
import { formatDate } from "@/lib/preProductionFormat";

/*
 * A project's follow-ups, in the column beside its shoot cards.
 *
 * Chasing the client is the project's, not a shoot's, so it sits beside the cards rather than on
 * one of them and stays in view while they scroll. Adding a follow-up asks only when the client is
 * to be chased next; it joins the pending list, the earliest pending date is the project's Next
 * Followup Date, and marking one done is what sets the Last Followup Date — nobody types it. A pending
 * follow-up can be edited (its date and remarks, in place) or deleted (asked first); one already done
 * is the record of what was done and stays as it is.
 */

/** The date and remarks a follow-up asks - adding one, and editing a pending one in place. */
function FollowupFields({ value, onChange, fields }) {
  return <>
    <DateField label="Next Followup Date" required restriction="past" helperText="The day the client is to be chased next." value={value.followupDate} onChange={(followupDate) => { fields.clear("followupDate"); onChange({ ...value, followupDate }); }} error={fields.errors.followupDate} />
    <TextAreaField label="Remarks" helperText="Notes for whoever makes this follow-up call." value={value.remarks} placeholder="What the client said, and what is owed next" onChange={(event) => onChange({ ...value, remarks: event.target.value })} />
  </>;
}

/** The one thing a follow-up must have before it is saved. */
const followupProblems = (value) => ({ followupDate: value.followupDate ? "" : "Choose the next followup date." });

/** A stored date as the date field's "YYYY-MM-DD". */
const dayValue = (value) => (value ? String(value).slice(0, 10) : "");

/** "overdue", "today" or "" for a pending follow-up's date, compared as local days. */
function dueState(value) {
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return "";
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (due < today) return "overdue";
  return due.getTime() === today.getTime() ? "today" : "";
}

const dueBadge = {
  overdue: ["Overdue", "bg-rose-50 text-rose-700"],
  today: ["Today", "bg-amber-50 text-amber-700"],
};

function PendingFollowup({ entry, isNext, canWrite, onComplete, onEdit, onDelete }) {
  const { busy, run } = useSubmitOnce();
  const [editing, setEditing] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const fields = useFormErrors();
  const badge = dueBadge[dueState(entry.followupDate)];

  async function save() {
    if (!fields.check(followupProblems(editing))) return;
    const saved = await run(() => onEdit(entry.id, editing));
    if (saved) setEditing(null);
  }

  async function remove() {
    const removed = await run(() => onDelete(entry.id));
    if (!removed) setConfirmingDelete(false);
  }

  if (editing) {
    return <li className="flex flex-col gap-3 rounded-lg border border-blue-300 bg-white p-3 shadow-sm">
      <FollowupFields value={editing} onChange={setEditing} fields={fields} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" className="max-sm:flex-1" disabled={busy} onClick={() => { fields.clearAll(); setEditing(null); }}>Cancel</Button>
        <Button type="button" variant="primary" className="max-sm:flex-1" busy={busy} busyLabel="Saving..." onClick={save}>Save</Button>
      </div>
    </li>;
  }

  return <li className={`rounded-lg border bg-white p-3 shadow-sm ${isNext ? "border-blue-300" : "border-slate-200"}`}>
    <div className="flex min-w-0 items-start justify-between gap-2">
      <div className="min-w-0">
        {isNext && <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-600">Next follow-up</p>}
        <p className="text-sm font-semibold text-slate-900">{formatDate(entry.followupDate)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {badge && <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${badge[1]}`}>{badge[0]}</span>}
        {/* The panel sits over the board, so the menu opens on the layer above it, not behind it. */}
        {canWrite && <OptionsMenu
          ariaLabel={`Actions for the follow-up on ${formatDate(entry.followupDate)}`}
          menuClassName="w-36"
          menuZIndexClassName={layers.menuOverPanel}
          items={[
            { label: "Mark done", disabled: busy, onSelect: () => run(() => onComplete(entry.id)) },
            { label: "Edit", disabled: busy, onSelect: () => setEditing({ followupDate: dayValue(entry.followupDate), remarks: entry.remarks || "" }) },
            { label: "Delete", tone: "danger", disabled: busy, onSelect: () => setConfirmingDelete(true) },
          ]}
        />}
      </div>
    </div>
    {entry.remarks && <p className="mt-1.5 whitespace-pre-line break-words text-xs text-slate-600">{entry.remarks}</p>}
    <div className="mt-2 flex items-center justify-between gap-2">
      <p className="min-w-0 truncate text-[11px] text-slate-400">{entry.createdBy ? `Added by ${entry.createdBy}` : ""}</p>
    </div>
    {confirmingDelete && <ConfirmDialog
      open
      layer="dialogOverPanel"
      title="Delete this follow-up?"
      message={`The follow-up for ${formatDate(entry.followupDate)} is removed from the project. Its Activity keeps a note that it was deleted.`}
      confirmLabel="Delete"
      busyLabel="Deleting..."
      loading={busy}
      onCancel={() => setConfirmingDelete(false)}
      onConfirm={remove}
    />}
  </li>;
}

/** A follow-up already made: the date it was for, what it was about, and when it was closed. */
function DoneFollowup({ entry }) {
  return <li className="rounded-lg border border-slate-200 bg-white/60 p-3">
    <div className="flex min-w-0 items-start justify-between gap-2">
      <p className="text-sm font-medium text-slate-600">{formatDate(entry.followupDate)}</p>
      <span className="shrink-0 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Done</span>
    </div>
    {entry.remarks && <p className="mt-1.5 whitespace-pre-line break-words text-xs text-slate-500">{entry.remarks}</p>}
    <p className="mt-2 truncate text-[11px] text-slate-400">Completed {formatDate(entry.doneAt)}{entry.doneBy ? ` by ${entry.doneBy}` : ""}</p>
  </li>;
}

export default function PreProductionFollowups({ project, canWrite, onAdd, onComplete, onEdit, onDelete }) {
  const [form, setForm] = useState({ followupDate: "", remarks: "" });
  const { busy, run } = useSubmitOnce();
  const fields = useFormErrors();
  const pending = project?.pendingFollowups || [];
  const done = project?.doneFollowups || [];

  async function add() {
    if (!fields.check(followupProblems(form))) return;
    const added = await run(() => onAdd(form));
    if (added) setForm({ followupDate: "", remarks: "" });
  }

  return <div className="flex flex-col gap-4 p-4 sm:p-5">
    <div>
      <h2 className="text-sm font-semibold text-slate-900">Follow-ups</h2>
      <p className="mt-0.5 text-[11px] text-slate-400">Chasing the client for this project, not for a single shoot.</p>
    </div>

    {canWrite && <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <FollowupFields value={form} onChange={setForm} fields={fields} />
      <Button type="button" variant="primary" className="max-sm:w-full sm:self-end" busy={busy} busyLabel="Adding..." onClick={add}>Add Follow-up</Button>
    </div>}

    {/* Each list only when it has something in it — an empty heading is noise beside the form. */}
    {pending.length > 0 && <section>
      <h3 className="text-xs font-semibold text-slate-700">Pending ({pending.length})</h3>
      <ul className="mt-2 flex flex-col gap-2">
        {pending.map((entry, index) => <PendingFollowup key={entry.id} entry={entry} isNext={index === 0} canWrite={canWrite} onComplete={onComplete} onEdit={onEdit} onDelete={onDelete} />)}
      </ul>
    </section>}

    {done.length > 0 && <section>
      <h3 className="text-xs font-semibold text-slate-700">Completed ({done.length})</h3>
      <ul className="mt-2 flex flex-col gap-2">
        {done.map((entry) => <DoneFollowup key={entry.id} entry={entry} />)}
      </ul>
    </section>}
  </div>;
}
