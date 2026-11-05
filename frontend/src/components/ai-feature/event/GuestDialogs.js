"use client";

import { useMemo, useState } from "react";
import Dialog from "@/components/ui/Dialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import TextAreaField from "@/components/shared/TextAreaField";
import Dropdown from "@/components/shared/Dropdown";
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
      <TextField label="Name" helperText="The guest's name as the studio wants it listed." required value={form.name} onChange={(event) => set("name")(event.target.value)} error={errors.name} autoFocus maxLength={191} className="sm:col-span-2" />
      <TextField label="Phone" helperText="The guest's mobile number, with country code if outside India." type="tel" value={form.phone} onChange={(event) => set("phone")(event.target.value)} error={errors.phone} placeholder="+91 98765 43210" maxLength={30} />
      <TextField label="Email" helperText="The guest's email address, if you have it." type="email" value={form.email} onChange={(event) => set("email")(event.target.value)} error={errors.email} maxLength={191} />
      <Dropdown label="Group" helperText="The guest group they belong to, which sorts the guest list." clearable clearLabel="No group" placeholder="No group" options={groupOptions(groups)} value={form.groupId} onChange={(value) => set("groupId")(value || "")} />
      <Dropdown label="RSVP" helperText="Whether the guest has said they are coming." options={RSVP_OPTIONS} value={form.rsvp} onChange={set("rsvp")} sorted={false} />
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
      <TextAreaField label="Guests" helperText="One guest per line: name, then phone and email, separated by commas." value={text} onChange={(event) => { setText(event.target.value); setError(""); }} rows={10} placeholder={"Arun Kumar, +91 98765 43210, arun@example.com\nPriya, 9876501234"} inputClassName="font-mono text-xs" />
      <Dropdown label="Put them in a group" helperText="The group every imported guest is added to." clearable clearLabel="No group" placeholder="No group" options={groupOptions(groups)} value={groupId} onChange={(value) => setGroupId(value || "")} />
      <p className="text-xs text-slate-500">{formatCount(parsed.rows.length)} {parsed.rows.length === 1 ? "guest" : "guests"} ready{parsed.problems.length ? `, ${formatCount(parsed.problems.length)} ${parsed.problems.length === 1 ? "line" : "lines"} skipped` : ""}.</p>
      {parsed.problems.length > 0 && <ul className="max-h-28 overflow-y-auto rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">{parsed.problems.slice(0, 20).map((problem) => <li key={problem}>{problem}</li>)}{parsed.problems.length > 20 && <li>…and {parsed.problems.length - 20} more.</li>}</ul>}
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    </div>
  </Dialog>;
}

/** The event's guest groups: a name that sorts the guest list. */
export function GuestGroupsDialog({ eventId, groups, onClose, onChanged }) {
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
      description="Groups sort the guest list - the bride's side, the office, the family."
      size="md"
      height="mid"
      onClose={onClose}
      headerActions={<Button type="button" size="sm" onClick={() => setEditing({})}>+ Group</Button>}
    >
      {error && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {groups.length === 0
        ? <EmptyState title="No groups yet." message="Create a group to sort the guest list." action={<Button type="button" size="sm" variant="primary" onClick={() => setEditing({})}>Create a group</Button>} />
        : <ul className="divide-y divide-slate-100">
          {groups.map((group) => <li key={group.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">{group.name}</p>
              {group.guestCount != null && <p className="truncate text-[11px] text-slate-500">{formatCount(group.guestCount)} {group.guestCount === 1 ? "guest" : "guests"}</p>}
            </div>
            <OptionsMenu ariaLabel={`Options for ${group.name}`} zIndex={135} items={[{ label: "Edit", onSelect: () => setEditing(group) }, { label: "Remove", tone: "danger", onSelect: () => setConfirm(group) }]} />
          </li>)}
        </ul>}
    </Dialog>
    {editing && <GroupFormDialog key={editing.id || "new"} eventId={eventId} group={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
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

function GroupFormDialog({ eventId, group, onClose, onSaved }) {
  const [name, setName] = useState(group?.name || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) { setError("Give the group a name."); return; }
    setBusy(true);
    try {
      const payload = { name: name.trim() };
      if (group) await updateAiGuestGroup(eventId, group.id, payload); else await createAiGuestGroup(eventId, payload);
      onSaved();
    } catch (cause) {
      setError(cause.message || "Unable to save the group.");
      setBusy(false);
    }
  }

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
    <TextField label="Group name" helperText="A name for this set of guests, such as Bride's family." required value={name} onChange={(event) => { setName(event.target.value); setError(""); }} error={error} autoFocus maxLength={120} />
  </Dialog>;
}
