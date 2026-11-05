"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import DashboardCard from "@/components/shared/DashboardCard";
import InlineAlert from "@/components/shared/InlineAlert";
import Loader from "@/components/shared/Loader";
import RecordSummaryCard from "@/components/shared/RecordSummaryCard";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import {
  getShootCrewNotice,
  setShootCrewNoticeEnabled,
  setVendorShootNoticeEnabled,
} from "@/services/settings/shootCrewNotice.service";

/*
 * Settings → Project Management → **Shoot crew notice**: two switches, and what is waiting.
 *
 * Two days before a shoot, everybody given a service on it is sent what the shoot is, when and where
 * it is, and the service they are on. A plan changed after that tells only the people whose own part
 * changed - a seat handed over tells those two - and somebody taken off it is told that instead.
 * Nothing goes until the plan has been still for half an hour, which is also what sends a plan
 * settled late, inside the two days.
 *
 * A **vendor** confirmed on a shoot is told on the same machine, switched on separately: thirty
 * minutes after the production manager confirms them, again two days before, again whenever the day,
 * the place or their service changes, and once more if they come off it.
 *
 * ── Why there is nothing to choose here any more ──
 *
 * Who sends it used to be picked here: one employee's WhatsApp for every shoot in the studio. It is
 * now read off the project - the crew's notice from its **Pre-Production Coordinator**, a vendor's
 * from its **Production Manager** - so a vendor who replies "can we shift by an hour?" is replying to
 * somebody who can answer. There is no fallback: where that person cannot send, those messages wait,
 * and this panel is the only place that is visible. So the card that used to hold the picker now
 * holds the **waiting list**, with the reason beside each project, because each reason is fixed by a
 * different person.
 */

const messageOf = (error, fallback) => error?.data?.message || error?.message || fallback;
const dateTime = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
const sentWords = (value) => {
  const at = value ? new Date(value) : null;
  return at && !Number.isNaN(at.getTime()) ? dateTime.format(at) : "";
};

const lastSentRow = (value) => {
  const words = sentWords(value);
  return [["Last sent", words ? <span className="text-emerald-700">{words}</span> : <span className="text-slate-500">Nothing sent yet</span>]];
};

/**
 * One arm's card: its switch, when it last sent, and the trouble its last sweep left. Both arms read
 * the same, so neither becomes the odd one out as they are changed.
 */
function NoticeArm({ title, summary, note, on, canWrite, busy, ariaLabel, onSwitch, lastSentAt, lastError, switchError, children }) {
  return <DashboardCard
    title={title}
    /* What this switch will send is said **on the card**, not only in the ⓘ: a consequence a hover
     * reveals is one a touch or keyboard reader never meets. The long form stays in the tip. */
    note={summary}
    tip={note}
    action={canWrite
      ? <ToggleSwitch label={busy ? "Saving..." : (on ? "On" : "Off")} ariaLabel={ariaLabel} checked={on} disabled={busy} onCheckedChange={(next) => { void onSwitch(next); }} />
      : <span className={`text-sm font-medium ${on ? "text-emerald-700" : "text-slate-500"}`}>{on ? "On" : "Off"}</span>}
    bodyClassName="space-y-3 p-3 sm:p-4"
  >
    {switchError && <InlineAlert tone="error" size="sm">{switchError}</InlineAlert>}
    <RecordSummaryCard rows={lastSentRow(lastSentAt)} columnsClassName="sm:grid-cols-1" />
    {/* The trouble the **last sweep** left, not a live failure: said so, since it has no time of its own. */}
    {lastError && <InlineAlert tone="warning" size="sm">Last try: {lastError}</InlineAlert>}
    {!canWrite && <p className="text-xs text-slate-500">Only an administrator can switch this on or off.</p>}
    {children}
  </DashboardCard>;
}

/** What each reason asks of whoever reads it - the panel says which, so it reaches the right person. */
const FIXED_BY = {
  NOBODY_NAMED: "Name one on the project, in Project Management → Pre-Production → General.",
  NO_LOGIN: "Give them a login, in Admin → User Management.",
  // Both halves of the reason: a login that has gone inactive is not fixed by ticking anything.
  NOT_ELIGIBLE: "In Admin → User Management, check their login is active and that Allow WhatsApp is ticked on it.",
  CHAT_OFF: "Switch their WhatsApp chat back on, in Admin → User Management.",
  NOT_CONNECTED: "Only they can do this: ask them to scan the QR on Settings → Attendance WhatsApp Report.",
  NO_NUMBER: "Save a WhatsApp or mobile number on the vendor, in Asset Management → Vendors.",
};

export default function ShootCrewNoticePanel({ onNotice }) {
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [switchError, setSwitchError] = useState("");
  const [vendorSwitchError, setVendorSwitchError] = useState("");
  const [switching, setSwitching] = useState("");

  const load = useCallback(() => getShootCrewNotice()
    .then((response) => {
      setStatus(response?.data || null);
      setLoadError("");
    })
    .catch((error) => setLoadError(messageOf(error, "Unable to read the shoot crew notice."))), []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function switchCrew(next) {
    setSwitching("crew");
    setSwitchError("");
    try {
      const response = await setShootCrewNoticeEnabled(next);
      setStatus(response?.data || status);
      onNotice?.(next ? "The shoot crew notice is on. Each shoot's crew is told two days before it." : "The shoot crew notice is off. Nothing is sent to the crew.");
    } catch (error) {
      setSwitchError(messageOf(error, "Unable to switch the shoot crew notice on or off."));
    } finally {
      setSwitching("");
    }
  }

  async function switchVendor(next) {
    setSwitching("vendor");
    setVendorSwitchError("");
    try {
      const response = await setVendorShootNoticeEnabled(next);
      setStatus(response?.data || status);
      // Said plainly, because "it is on" would otherwise read as "and everybody has been told".
      onNotice?.(next
        ? "The vendor notice is on. Vendors confirmed from now on are told; nobody already confirmed has been messaged."
        : "The vendor notice is off. Nothing is sent to vendors.");
    } catch (error) {
      setVendorSwitchError(messageOf(error, "Unable to switch the vendor notice on or off."));
    } finally {
      setSwitching("");
    }
  }

  if (loadError) {
    return <InlineAlert tone="error" action={<Button size="sm" onClick={() => { void load(); }}>Try again</Button>}>{loadError}</InlineAlert>;
  }
  if (!status) return <Loader label="Loading the shoot crew notice..." />;

  const waiting = status.waiting || [];

  return <div className="max-w-5xl space-y-4">
    <NoticeArm
      title="Shoot crew notice"
      summary="Tells each shoot's crew two days before it, and tells them again when their part changes. A shoot less than two days away is told within half an hour."
      note="Two days before a shoot, everybody given a service on it is sent what it is, when and where, and the service they are on. A plan changed after that tells only the people whose own part changed, and somebody taken off it is told that instead - half an hour after the plan was last touched, so a plan being worked on does not send a message a minute."
      on={Boolean(status.enabled)}
      canWrite={Boolean(status.canWrite)}
      busy={switching === "crew"}
      ariaLabel="Send each shoot's crew a WhatsApp notice"
      onSwitch={switchCrew}
      lastSentAt={status.lastSentAt}
      lastError={status.lastError}
      switchError={switchError}
    />

    <NoticeArm
      title="Vendor shoot notice"
      summary="Tells a vendor half an hour after you confirm them, reminds them two days before, and tells them what changed. Switching it on messages nobody already confirmed."
      note="Half an hour after a vendor is confirmed on a shoot, they are sent what it is, when and where, and the service they are on - then reminded two days before, told whenever the day, the place or their service changes, and told not to travel if they come off it. Switching it on tells nobody who is already confirmed."
      on={Boolean(status.vendorEnabled)}
      canWrite={Boolean(status.canWrite)}
      busy={switching === "vendor"}
      ariaLabel="Send each shoot's confirmed vendors a WhatsApp notice"
      onSwitch={switchVendor}
      lastSentAt={status.vendorLastSentAt}
      lastError={status.vendorLastError}
      switchError={vendorSwitchError}
    />

    <DashboardCard
      title="Waiting to be sent"
      note={`Nobody chooses who sends these: each shoot's crew hears from their project's ${status.senderRole || "Pre-Production Coordinator"}, and a vendor from its ${status.vendorSenderRole || "Production Manager"}.`}
      tip={`From their own WhatsApp, connected on Settings → Attendance WhatsApp Report. Where that person cannot send, those messages wait and go the moment they can - they never go from anybody else's number. Not a setting: each shoot's crew hears from their project's ${status.senderRole || "Pre-Production Coordinator"}, and a vendor from its ${status.vendorSenderRole || "Production Manager"} - from their own WhatsApp, connected on Attendance WhatsApp Report. Where that person cannot send, those messages wait and go the moment they can; they never go from anybody else's number.`}
      bodyClassName="space-y-3 p-3 sm:p-4"
    >
      {!waiting.length
        ? <p className="text-xs text-slate-500 sm:text-sm">
          {status.enabled || status.vendorEnabled
            ? "Nothing is waiting. Every project with a shoot coming up has somebody who can send its messages."
            : "Both arms are off, so nothing is waiting to be sent."}
        </p>
        : <>
          <p className="text-xs text-slate-600 sm:text-sm">
            {waiting.length === 1 ? "One thing is waiting" : `${waiting.length} things are waiting`}, and will go on their own once this is sorted:
          </p>
          <ul className="space-y-2">
            {waiting.map((row, at) => <li key={`${row.arm}-${row.projectId || row.vendorId || row.person || at}-${row.why}`}>
              <InlineAlert tone="warning" size="sm">
                <span className="font-semibold">{row.project || row.person}</span>
                {row.role && !row.project ? ` · ${row.role}` : ""}
                {" · "}{row.arm === "vendor" ? "vendor messages" : "crew messages"}
                <span className="block">{row.reason}</span>
                {/* What to do next, on its own line: the reason alone sends nobody anywhere. */}
                {FIXED_BY[row.why] && <span className="mt-0.5 block font-medium text-amber-900">{FIXED_BY[row.why]}</span>}
              </InlineAlert>
            </li>)}
          </ul>
        </>}
    </DashboardCard>
  </div>;
}
