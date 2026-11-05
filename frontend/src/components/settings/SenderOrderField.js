"use client";

import { avatarOf } from "@/lib/employeeAvatar.mjs";
import Dropdown from "@/components/shared/Dropdown";
import RadioGroupField from "@/components/shared/RadioGroupField";
import SortableList from "@/components/shared/SortableList";
import StatusBadge from "@/components/shared/StatusBadge";

const MODES = [
  { value: "SAME", label: "Sender" },
  { value: "ROTATE", label: "Rotation" },
];
const MODE_HELP = {
  SAME: "One person sends every message. If they can't, the others are tried in the fallback order below.",
  ROTATE: "Each message goes from the next person in this order. Someone who can't send is skipped for the one after.",
};

const stateOf = (person) => (person.eligible === false
  ? { tone: "neutral", text: "No longer eligible" }
  : person.connected ? { tone: "success", text: "Connected" } : { tone: "neutral", text: "Not connected" });

/**
 * Who an automatic WhatsApp message goes from, as one of two choices:
 *
 * - **Sender** - one employee, picked from a dropdown, sends every message; where they cannot, every
 *   other employee with Allow WhatsApp ticked is tried in the fallback order dragged below them.
 * - **Rotation** - every employee with Allow WhatsApp ticked takes a turn, in the order dragged here
 *   (or with ArrowUp / ArrowDown on a focused row). Anybody given Allow WhatsApp since joins at the end.
 *
 * `sender`, `fallback` (everyone else with Allow WhatsApp), `senders` (the rotation, everyone with
 * Allow WhatsApp) and `mode` are the server's (`status.sender`, `status.fallback`, `status.senders`,
 * `status.senderMode`). Each mode keeps its own setting and its own order, so switching between them
 * loses neither. Every change - the mode, the sender, either order - is handed to
 * `onChange({ mode, senderUserId, fallbackUserIds, userIds })` at once, the way the old dropdown saved
 * on choosing. Without `canWrite` it is only read: the choice as text, the orders with no handles.
 */
export default function SenderOrderField({ sender = null, fallback = [], senders = [], mode = "SAME", canWrite = false, saving = false, onChange }) {
  const ids = senders.map((person) => person.id);
  const fallbackIds = fallback.map((person) => person.id);
  const save = (next) => onChange?.({ mode, senderUserId: sender?.id ?? null, fallbackUserIds: fallbackIds, userIds: ids, ...next });
  // The one place both orders are drawn, each numbered from 1 in its own order. Rearranged by dragging
  // a row (or ArrowUp / ArrowDown while it has focus) - no arrow buttons, as the studio asked.
  const order = (label, people, onReorder) => <SortableList
    label={label}
    items={people.map((person, index) => ({ ...person, label: person.name, place: index + 1 }))}
    disabled={!canWrite || saving}
    moveButtons={false}
    onReorder={onReorder}
    renderRow={row}
  />;

  // Everyone with Allow WhatsApp, plus the chosen sender if they no longer are - so the field still
  // names them and says why.
  const lapsed = sender && !ids.includes(sender.id) ? [{ ...sender, eligible: false }] : [];
  const options = [...senders, ...lapsed].map((person) => ({
    value: String(person.id),
    label: `${person.name}${person.code ? ` (${person.code})` : ""} · ${stateOf(person).text}`,
    avatar: avatarOf(person),
  }));

  const row = (person) => {
    const state = stateOf(person);
    return <div className="flex min-w-0 items-center gap-2">
      <span className="w-6 shrink-0 text-right text-xs font-semibold text-slate-500">{person.place}.</span>
      <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{person.name}{person.code ? ` (${person.code})` : ""}</span>
      <StatusBadge tone={state.tone}>{state.text}</StatusBadge>
    </div>;
  };

  return <div className="space-y-3">
    {canWrite
      ? <RadioGroupField
        label="How it is sent"
        name="sender-mode"
        value={mode}
        options={MODES}
        disabled={saving}
        onChange={(next) => { if (next !== mode) save({ mode: next }); }}
        helperText={MODE_HELP[mode] || MODE_HELP.SAME}
      />
      : <p className="text-xs text-slate-600 sm:text-sm"><span className="font-medium">How it is sent:</span> {mode === "ROTATE" ? "Rotation" : "Sender"} - {MODE_HELP[mode] || MODE_HELP.SAME}</p>}

    {mode === "ROTATE"
      ? (senders.length
        ? order("Rotation order", senders, (next) => save({ userIds: next }))
        : <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500 sm:text-sm">No employee has Allow WhatsApp ticked yet, so there is nobody to rotate through.</p>)
      : <>
        {canWrite
          ? <Dropdown
            label="Sender"
            placeholder="Choose an employee"
            helperText="Priority 1 - their own WhatsApp sends it. Clear it to stop sending."
            value={sender ? String(sender.id) : ""}
            options={options}
            // The new sender leaves the fallback order; whoever they replace joins its end.
            onChange={(value) => { const next = value ? Number(value) : null; save({ senderUserId: next, fallbackUserIds: fallbackIds.filter((id) => id !== next) }); }}
            searchable
            clearable
            disabled={saving}
          />
          : <p className="text-xs text-slate-600 sm:text-sm">Sent from <span className="font-medium text-slate-800">{sender?.name || "nobody yet"}</span>{sender ? ` · ${stateOf(sender).text}` : ""}.</p>}
        {/* Shown before a Sender is chosen too, so the order can be set up front; it is only tried
            once there is a Sender to fall back from. */}
        {fallback.length > 0 && <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-600">Fallback order{canWrite ? " - drag to rearrange" : ""}</p>
          {order("Fallback order", fallback, (next) => save({ fallbackUserIds: next }))}
        </div>}
      </>}
  </div>;
}
