"use client";

import { useMemo, useState } from "react";
import Dialog from "@/components/ui/Dialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import TextAreaField from "@/components/shared/TextAreaField";
import Dropdown from "@/components/shared/Dropdown";
import Checkbox from "@/components/shared/Checkbox";
import EmptyState from "@/components/ai-feature/shared/EmptyState";
import { formatCount } from "@/lib/aiFeature.mjs";
import { createAiGuest, createAiGuestGroup, deleteAiGuestGroup, importAiGuests, updateAiGuest, updateAiGuestGroup } from "@/services/ai-feature/ai-feature.service";

export const RSVP_OPTIONS = [{ label: "Pending", value: "PENDING" }, { label: "Accepted", value: "ACCEPTED" }, { label: "Declined", value: "DECLINED" }];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+\d][\d\s()-]{5,29}$/;

const groupOptions = (groups) => groups.map((group) => ({ label: group.name, value: group.id }));

/** Add a guest or edit one; the same fields both ways. */
export function GuestFormDialog({ eventId, guest = null, groups = [], onClose, onSaved }) {
  const [form, setForm] = useState({ name: guest?.name || "", phone: guest?.phone || "", email: guest?.email || "", groupId: guest?.groupId || "", rsvp: guest?.rsvp || "PENDING" });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (key) => (value) => { setForm((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: "", form: "" })); };

  async function submit(event) {
    event.preventDefault();
    const problems = {};
    if (!form.name.trim()) problems.name = "Give the guest a name.";
    if (form.phone.trim() && !PHONE.test(form.phone.trim())) problems.phone = "Not a phone number.";
    if (form.email.trim() && !EMAIL.test(form.email.trim())) problems.email = "Not an email address.";
    if (Object.keys(problems).length) { setErrors(problems); return; }
    setBusy(true);
    try {
      const payload = { name: form.name.trim(), phone: form.phone.trim() || null, email: form.email.trim() || null, groupId: form.groupId || null, rsvp: form.rsvp };
      const response = guest ? await updateAiGuest(eventId, guest.id, payload) : await createAiGuest(eventId, payload);
      onSaved(response.data);
    } catch (cause) {
      setErrors({ form: cause.message || "Unable to save the guest." });
      setBusy(false);
    }
  }

  return <Dialog
    title={guest ? "Edit guest" : "Add guest"}
    size="md"
    onClose={onClose}
    busy={busy}
    onSubmit={submit}
    footer={<>
      <Button type="button" className="max-sm:flex-1" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="submit" variant="primary" className="max-sm:flex-1" disabled={busy}>{busy ? "Saving..." : guest ? "Save" : "Add guest"}</Button>
    </>}
  >
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField label="Name" required value={form.name} onChange={(event) => set("name")(event.target.value)} error={errors.name} autoFocus maxLength={191} className="sm:col-span-2" />
      <TextField label="Phone" type="tel" value={form.phone} onChange={(event) => set("phone")(event.target.value)} error={errors.phone} placeholder="+91 98765 43210" maxLength={30} />
      <TextField label="Email" type="email" value={form.email} onChange={(event) => set("email")(event.target.value)} error={errors.email} maxLength={191} />
      <Dropdown label="Group" clearable clearLabel="No group" placeholder="No group" options={groupOptions(groups)} value={form.groupId} onChange={(value) => set("groupId")(value || "")} />
      <Dropdown label="RSVP" options={RSVP_OPTIONS} value={form.rsvp} onChange={set("rsvp")} sorted={false} />
    </div>
    {errors.form && <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{errors.form}</p>}
  </Dialog>;
}

/** "Name, Phone[, Email]" per line, or a pasted CSV with a header; blank and comment lines skipped. */
export function parseGuestLines(text) {
  const rows = []; const problems = [];
  const lines = String(text || "").split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const parts = line.split(/[,\t;]/).map((part) => part.trim().replace(/^"|"$/g, ""));
    if (index === 0 && /^name$/i.test(parts[0] || "") ) return;
    const [name, phone = "", email = ""] = parts;
    if (!name) { problems.push(`Line ${index + 1}: no name.`); return; }
    if (phone && !PHONE.test(phone)) { problems.push(`Line ${index + 1}: "${phone}" is not a phone number.`); return; }
    if (email && !EMAIL.test(email)) { problems.push(`Line ${index + 1}: "${email}" is not an email address.`); return; }
    rows.push({ name, phone: phone || null, email: email || null });
  });
  return { rows, problems };
}

export function ImportGuestsDialog({ eventId, groups = [], onClose, onImported }) {
  const [text, setText] = useState("");
  const [groupId, setGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const parsed = useMemo(() => parseGuestLines(text), [text]);

  async function submit(event) {
    event.preventDefault();
    if (!parsed.rows.length) { setError("Nothing to import yet."); return; }
    setBusy(true);
    try {
      const response = await importAiGuests(eventId, { guests: parsed.rows, groupId: groupId || null });
      onImported(response.data || {});
    } catch (cause) {
      setError(cause.message || "Unable to import the guests.");
      setBusy(false);
    }
  }

  return <Dialog
    title="Import guests"
    description="One guest per line: Name, Phone, Email. Paste a CSV export straight in; a guest whose phone number is already on the list is updated rather than added twice."
    size="lg"
    onClose={onClose}
    busy={busy}
    onSubmit={submit}
    footer={<>
      <Button type="button" className="max-sm:flex-1" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="submit" variant="primary" className="max-sm:flex-1" disabled={busy || !parsed.rows.length}>{busy ? "Importing..." : `Import ${parsed.rows.length ? formatCount(parsed.rows.length) : ""}`.trim()}</Button>
    </>}
  >
    <div className="space-y-3">
      <TextAreaField label="Guests" value={text} onChange={(event) => { setText(event.target.value); setError(""); }} rows={10} placeholder={"Arun Kumar, +91 98765 43210, arun@example.com\nPriya, 9876501234"} inputClassName="font-mono text-xs" />
      <Dropdown label="Put them in a group" clearable clearLabel="No group" placeholder="No group" options={groupOptions(groups)} value={groupId} onChange={(value) => setGroupId(value || "")} />
      <p className="text-xs text-slate-500">{formatCount(parsed.rows.length)} {parsed.rows.length === 1 ? "guest" : "guests"} ready{parsed.problems.length ? `, ${formatCount(parsed.problems.length)} ${parsed.problems.length === 1 ? "line" : "lines"} skipped` : ""}.</p>
      {parsed.problems.length > 0 && <ul className="max-h-28 overflow-y-auto rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">{parsed.problems.slice(0, 20).map((problem) => <li key={problem}>{problem}</li>)}{parsed.problems.length > 20 && <li>…and {parsed.problems.length - 20} more.</li>}</ul>}
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    </div>
  </Dialog>;
}

/** The event's guest groups: a name, and which sub-events its members may see. */
export function GuestGroupsDialog({ eventId, groups, subEvents = [], onClose, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove(group) {
    setBusy(true);
    try { await deleteAiGuestGroup(eventId, group.id); setConfirm(null); onChanged(); }
    catch (cause) { setError(cause.message || "Unable to remove the group."); }
    finally { setBusy(false); }
  }

  return <>
    <Dialog
      title="Guest groups"
      description="Groups decide which sub events a guest may open from the event link - the bride's side, the office, the family."
      size="md"
      height="mid"
      onClose={onClose}
      headerActions={<Button type="button" size="sm" onClick={() => setEditing({})}>+ Group</Button>}
    >
      {error && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {groups.length === 0
        ? <EmptyState title="No groups yet." message="Guests without a group see whatever the event's privacy setting allows." action={<Button type="button" size="sm" variant="primary" onClick={() => setEditing({})}>Create a group</Button>} />
        : <ul className="divide-y divide-slate-100">
          {groups.map((group) => {
            const names = (group.subEventIds || []).map((id) => subEvents.find((subEvent) => subEvent.id === id)?.name).filter(Boolean);
            return <li key={group.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{group.name}</p>
                <p className="truncate text-[11px] text-slate-500">{group.guestCount != null ? `${formatCount(group.guestCount)} guests • ` : ""}{names.length ? names.join(", ") : "Every sub event"}</p>
              </div>
              <OptionsMenu ariaLabel={`Options for ${group.name}`} zIndex={135} items={[{ label: "Edit", onSelect: () => setEditing(group) }, { label: "Remove", tone: "danger", onSelect: () => setConfirm(group) }]} />
            </li>;
          })}
        </ul>}
    </Dialog>
    {editing && <GroupFormDialog key={editing.id || "new"} eventId={eventId} group={editing.id ? editing : null} subEvents={subEvents} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
    <ConfirmDialog
      open={Boolean(confirm)}
      layer="confirmOverDialog"
      title="Remove this group?"
      message={`Guests in "${confirm?.name}" stay on the list, without a group.`}
      confirmLabel="Remove group"
      loading={busy}
      onCancel={() => setConfirm(null)}
      onConfirm={() => remove(confirm)}
    />
  </>;
}

function GroupFormDialog({ eventId, group, subEvents, onClose, onSaved }) {
  const [name, setName] = useState(group?.name || "");
  const [subEventIds, setSubEventIds] = useState(() => new Set(group?.subEventIds || []));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) { setError("Give the group a name."); return; }
    setBusy(true);
    try {
      const payload = { name: name.trim(), subEventIds: Array.from(subEventIds) };
      if (group) await updateAiGuestGroup(eventId, group.id, payload); else await createAiGuestGroup(eventId, payload);
      onSaved();
    } catch (cause) {
      setError(cause.message || "Unable to save the group.");
      setBusy(false);
    }
  }
  const toggle = (id) => setSubEventIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return <Dialog
    title={group ? "Edit group" : "New group"}
    layer="dialogOverPanel"
    onClose={onClose}
    busy={busy}
    onSubmit={submit}
    footer={<>
      <Button type="button" className="max-sm:flex-1" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="submit" variant="primary" className="max-sm:flex-1" disabled={busy}>{busy ? "Saving..." : group ? "Save" : "Create group"}</Button>
    </>}
  >
    <div className="space-y-3">
      <TextField label="Group name" required value={name} onChange={(event) => { setName(event.target.value); setError(""); }} error={error} autoFocus maxLength={120} />
      <fieldset>
        <legend className="text-[11px] font-semibold text-slate-600 sm:text-xs">Sub events this group may open</legend>
        {subEvents.length === 0
          ? <p className="mt-1.5 text-xs text-slate-500">No sub events yet - the group sees the whole event.</p>
          : <ul className="mt-1.5 space-y-1.5">
            {subEvents.map((subEvent) => <li key={subEvent.id}>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"><Checkbox checked={subEventIds.has(subEvent.id)} onChange={() => toggle(subEvent.id)} ariaLabel={subEvent.name} />{subEvent.name}</label>
            </li>)}
          </ul>}
        {subEvents.length > 0 && <p className="mt-1.5 text-[11px] text-slate-500">Tick none to allow every sub event.</p>}
      </fieldset>
    </div>
  </Dialog>;
}
