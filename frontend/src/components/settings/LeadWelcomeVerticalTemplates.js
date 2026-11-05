"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import MessageTemplatePanel from "@/components/settings/MessageTemplatePanel";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Tabs from "@/components/ui/Tabs";
import { clockLabel, clockMinutes } from "@/lib/attendanceTime.mjs";
import { getLeadWelcomeVerticals } from "@/services/settings/message-templates.service";

const SLOTS = [
  { id: "office", label: "Office time", key: "officeKey", written: "officeWritten" },
  { id: "afterHours", label: "After hours", key: "afterHoursKey", written: "afterHoursWritten" },
];

/** What a vertical has written, said beside its name in the picker. */
function writtenNote(vertical) {
  if (vertical.officeWritten && vertical.afterHoursWritten) return "";
  if (vertical.officeWritten) return " (office time only)";
  if (vertical.afterHoursWritten) return " (after hours only)";
  return " (not written)";
}

/**
 * Settings → Templates → **New Lead Welcome by Vertical**: the wording a new lead from a linked Google
 * Sheet is sent for its vertical, one for a lead arriving in office time and one for after hours.
 *
 * Office time is the attendance shift (Attendance Rules) on a working day; a weekly off or a holiday
 * is after hours. A lead whose vertical has nothing written for the moment is not messaged - it is in
 * the WhatsApp Activity Log as Failed, to message by hand - so the picker and the tabs say which are
 * written, and a gap is seen without opening every one. Each wording is an ordinary message
 * template, edited in the same panel as every other.
 */
export default function LeadWelcomeVerticalTemplates({ canWrite = false, switchable = true, onNotice, onError, unsavedRef }) {
  const [answer, setAnswer] = useState(null);
  const [failed, setFailed] = useState(false);
  const [verticalId, setVerticalId] = useState("");
  const [slot, setSlot] = useState("office");
  // A switch asked for while the wording on screen is unsaved, waiting on the reader's answer.
  const [pending, setPending] = useState(null);
  const ownUnsaved = useRef(false);
  const unsaved = unsavedRef || ownUnsaved;

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const response = await getLeadWelcomeVerticals();
      const data = response?.data || { verticals: [] };
      setAnswer(data);
      setVerticalId((current) => current || (data.verticals[0] ? String(data.verticals[0].id) : ""));
    } catch (error) {
      setFailed(true);
      onError?.(error.message || "Unable to load the verticals.");
    }
  }, [onError]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Changing the vertical or the time opens another wording: an unsaved edit is asked about first.
  const ask = (change) => (unsaved.current ? setPending(change) : apply(change));
  function apply(change) {
    if (change.verticalId !== undefined) setVerticalId(change.verticalId);
    if (change.slot !== undefined) setSlot(change.slot);
    setPending(null);
  }
  // A save changes what is written, so the marks are read again.
  const saved = (message) => { onNotice?.(message); void load(); };

  if (failed && !answer) return <div className="space-y-3">
    <p className="text-sm text-slate-600">The verticals could not be loaded.</p>
    <Button type="button" size="sm" onClick={() => void load()}>Try again</Button>
  </div>;
  if (!answer) return <Loader label="Loading the verticals..." />;
  const verticals = answer.verticals || [];
  if (!verticals.length) return <p className="text-sm text-slate-500">There are no verticals yet. Add one in Master Data, then word its welcome here.</p>;

  const vertical = verticals.find((row) => String(row.id) === verticalId) || verticals[0];
  const current = SLOTS.find((entry) => entry.id === slot) || SLOTS[0];
  const templateKey = vertical[current.key];
  const start = clockMinutes(answer.shift?.start || "");
  const end = clockMinutes(answer.shift?.end || "");
  const shiftHours = answer.shift?.start && answer.shift?.end ? `${clockLabel(start)} to ${clockLabel(end)}` : "the attendance shift";

  return <div className="space-y-4">
    <p className="text-xs text-slate-500 sm:text-sm">
      A new lead from a linked Google Sheet is sent its vertical&apos;s wording for the time it arrives.
      Where nothing is written for that time, the lead is not messaged.
    </p>
    {/* The verticals as tabs, as a page's status tabs are, and the two moments under them. What each
        vertical has written is said on hover; the moment's own tab says when it is not written. */}
    <div className="space-y-2">
      <Tabs
        tabs={verticals.map((row) => ({ id: String(row.id), label: row.name, title: `${row.name}${writtenNote(row) || " (both written)"}` }))}
        value={String(vertical.id)}
        onChange={(next) => ask({ verticalId: String(next) })}
        ariaLabel="Vertical to word the welcome for"
        className="border-b border-slate-200"
      />
      <Tabs
        tabs={SLOTS.map((entry) => ({ id: entry.id, label: vertical[entry.written] ? entry.label : `${entry.label} - not written` }))}
        value={slot}
        onChange={(next) => ask({ slot: next })}
        ariaLabel="When the lead arrives"
        size="sm"
      />
    </div>
    <p className="text-xs text-slate-500">
      <span className="font-medium text-slate-700">Office time</span> is {shiftHours} on a working day (Attendance Rules).
      <span className="font-medium text-slate-700"> After hours</span> is any other time, a weekly off or a holiday.
    </p>
    {!vertical[current.written] && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:text-sm">
      Nothing is written for {vertical.name} - {current.label.toLowerCase()} yet, so these leads are not messaged. They show as Failed in the WhatsApp Activity Log, to message by hand.
    </p>}
    <MessageTemplatePanel
      key={templateKey}
      templateKey={templateKey}
      helpKey="CRM_LEAD_WELCOME"
      name={`New Lead Welcome - ${vertical.name} - ${current.label}`}
      canWrite={canWrite}
      switchable={switchable}
      unsavedRef={unsaved}
      onNotice={saved}
      onError={onError}
    />
    {pending && <ConfirmDialog
      title="Discard your changes?"
      message="This wording has changes that are not saved. Switching to another vertical or time throws them away."
      confirmLabel="Discard"
      onCancel={() => setPending(null)}
      onConfirm={() => apply(pending)}
    />}
  </div>;
}
