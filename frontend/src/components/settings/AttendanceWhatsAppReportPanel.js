"use client";

import { useCallback, useEffect, useState } from "react";
import WhatsApp from "@mui/icons-material/WhatsApp";
import Button from "@/components/shared/Button";
import DashboardCard from "@/components/shared/DashboardCard";
import HelpTip from "@/components/shared/HelpTip";
import RecordSummaryCard from "@/components/shared/RecordSummaryCard";
import TextField from "@/components/shared/TextField";
import TimeField from "@/components/shared/TimeField";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import useFormErrors from "@/components/shared/useFormErrors";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import AttendanceReportGroupDialog from "@/components/hrm/AttendanceReportGroupDialog";
import SenderOrderField from "@/components/settings/SenderOrderField";
import {
  getAttendanceReportGroup,
  listAttendanceReportSenderCandidates,
  setAttendanceReportEnabled,
  setAttendanceReportGroupName,
  setAttendanceReportSendAt,
  setAttendanceReportSenders,
  unlinkAttendanceReportGroup,
} from "@/services/hrm/attendance.service";

const messageOf = (error, fallback) => error?.data?.message || error?.message || fallback;

/*
 * The daily attendance report's endpoints and wording - the panel's defaults. Settings → Wishes →
 * Wishes Scheduler hands in its own (`WishesSchedulerPanel`), so one panel sets both groups.
 */
const ATTENDANCE_REPORT_API = {
  getStatus: getAttendanceReportGroup,
  listCandidates: listAttendanceReportSenderCandidates,
  setGroupName: setAttendanceReportGroupName,
  setSendAt: setAttendanceReportSendAt,
  setEnabled: setAttendanceReportEnabled,
  setSenders: setAttendanceReportSenders,
  clearGroupName: unlinkAttendanceReportGroup,
};
const ATTENDANCE_REPORT_WORDING = {
  what: "the report",
  loadError: "Unable to read the attendance report's WhatsApp group.",
  sentLabel: "Today's report",
  sendAtSaved: (sendAt) => `The report will now be sent daily at ${sendAt}. A report already sent today is not sent again.`,
  nameSaved: (sendAt) => `Group name saved - checked against each sender's WhatsApp the next time the report sends, at ${sendAt}.`,
  cleared: "Group name cleared. The daily report is no longer sent.",
  clearMessage: (groupName) => `The daily attendance report will no longer be sent until a group name is set again${groupName ? ` (currently "${groupName}")` : ""}.`,
  placeholder: "e.g. Studio Attendance",
  serverOverride: "ATTENDANCE_REPORT_SEND_AT",
  switchNote: "Sent daily at the time below while this is on. Off keeps the time, the senders and the group, and sends nothing.",
  switchAria: "Send the daily attendance report",
  switchedOn: "On. The daily attendance report is sent at the set time.",
  switchedOff: "Off. The daily attendance report is not sent until this is switched on again.",
};

/**
 * Settings → User Settings → Attendance WhatsApp Report: who sends the Attendance Register's daily report,
 * and where it goes.
 *
 * **Who sends it** is the administrator's to choose (`SenderOrderField`): one **Sender** from those
 * with Allow WhatsApp ticked on their Login Credentials, the rest tried after them in a fallback order
 * they drag - or a **Rotation** through all of them in an order they drag. Where nobody can send,
 * the message is not sent and the reason shows here.
 *
 * **The group is a name, typed by an administrator** - not picked from anyone's own WhatsApp. At
 * send time, whichever sender is being tried has their own joined groups searched for one matching
 * that name; there is nothing to link or choose ahead of time. **Connecting is done here**, by
 * anyone with Allow WhatsApp - any of them may be chosen or take a turn, and their turn only succeeds once
 * their own WhatsApp is actually in a group of that name.
 *
 * `api` and `wording` make this one panel serve every scheduled group message (the wishes, the Photo
 * Selection Submitted notification). An `api` without `setSendAt` is a message that goes on an
 * event rather than at a time: the "Sends daily at" row is left out, and `wording.whereNote` says
 * where it goes in that message's own words. An `api` with `setEnabled` is a message with a switch:
 * the status and the two sections are then drawn inside one Notification card whose header holds
 * the switch (`wording.switchNote`, `switchAria`, `switchedOn`, `switchedOff` say it in that
 * message's words), moved by whoever may choose the senders unless `canWrite` says otherwise; a
 * reader sees On / Off as text. Off keeps every setting and sends nothing - the server decides that,
 * not this screen. An `api` without `setGroupName` is a message whose group is not one name - the
 * payment reminder goes to each project's own - so there is no "Where it goes" card, and "Who sends
 * it" takes the full width. `wording.sentText(status)`, where
 * given, says how today went in that message's own words. `children` draw below, for a notification that has more to set. The Connect
 * WhatsApp row and the dialogs stay outside the card.
 */
export default function AttendanceWhatsAppReportPanel({ onNotice, api = ATTENDANCE_REPORT_API, wording = ATTENDANCE_REPORT_WORDING, canWrite = null, children = null }) {
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [saving, setSaving] = useState(false);
  const [sendersError, setSendersError] = useState("");
  const [groupName, setGroupName] = useState("");
  const [savingName, setSavingName] = useState(false);
  // Sends daily at, as the time field holds it ("HH:MM", India time).
  const [sendAtTime, setSendAtTime] = useState("");
  const [savingTime, setSavingTime] = useState(false);
  const [timeError, setTimeError] = useState("");
  const [nameError, setNameError] = useState("");
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const fields = useFormErrors();

  const load = useCallback(() => api.getStatus()
    .then((response) => {
      const next = response?.data || null;
      setStatus(next);
      setGroupName(next?.groupName || "");
      setSendAtTime(next?.sendAtTime || "");
      setLoadError("");
      // The employees to choose from: only an administrator is given them.
      if (next?.canChooseSenders) {
        return api.listCandidates()
          .then((list) => setCandidates(Array.isArray(list?.data) ? list.data : []))
          .catch(() => setCandidates([]));
      }
      return undefined;
    })
    .catch((error) => setLoadError(messageOf(error, wording.loadError))), [api, wording]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loadError) return <p className="text-xs text-rose-600 sm:text-sm">{loadError}</p>;
  if (!status) return <p className="text-xs text-slate-500 sm:text-sm">Loading...</p>;

  // The switch: saved on the server, which answers with the fresh status - taken as it is, so what
  // the header shows is what the scheduler will do, and a group name or time typed but not yet
  // saved is left as typed. A toggle never sends anything itself.
  async function setEnabled(next) {
    setSwitching(true);
    setSwitchError("");
    try {
      const response = await api.setEnabled(next);
      if (response?.data) setStatus(response.data);
      onNotice?.(next ? wording.switchedOn : wording.switchedOff);
    } catch (error) {
      setSwitchError(messageOf(error, `Unable to switch ${wording.what} on or off.`));
    } finally {
      setSwitching(false);
    }
  }

  const namedGroup = typeof api.setGroupName === "function";

  const saveSenders = async (input) => {
    setSaving(true);
    setSendersError("");
    try {
      const response = await api.setSenders(input);
      if (response?.data) setStatus(response.data);
      onNotice?.(input.mode === "ROTATE" ? "Rotation saved." : "Sender saved.");
    } catch (error) {
      setSendersError(messageOf(error, "Unable to save the senders."));
    } finally {
      setSaving(false);
    }
  };

  const saveSendAt = async () => {
    if (!fields.check({ sendAtTime: sendAtTime ? "" : "Choose the time it is sent." })) return;
    setSavingTime(true);
    setTimeError("");
    try {
      const response = await api.setSendAt(sendAtTime);
      if (response?.data) {
        setStatus(response.data);
        setSendAtTime(response.data.sendAtTime || "");
      }
      onNotice?.(wording.sendAtSaved(response?.data?.sendAt || "that time"));
    } catch (error) {
      setTimeError(messageOf(error, `Unable to save when ${wording.what} is sent.`));
    } finally {
      setSavingTime(false);
    }
  };

  const saveGroupName = async () => {
    setSavingName(true);
    setNameError("");
    try {
      const response = await api.setGroupName(groupName);
      if (response?.data) setStatus(response.data);
      onNotice?.(wording.nameSaved(status.sendAt));
    } catch (error) {
      setNameError(messageOf(error, "Unable to save the WhatsApp group's name."));
    } finally {
      setSavingName(false);
    }
  };

  const clearGroupName = async () => {
    setUnlinking(true);
    try {
      const response = await api.clearGroupName();
      if (response?.data) setStatus(response.data);
      setConfirmingUnlink(false);
      onNotice?.(wording.cleared);
    } catch (error) {
      setNameError(messageOf(error, "Unable to clear the WhatsApp group's name."));
      setConfirmingUnlink(false);
    } finally {
      setUnlinking(false);
    }
  };

  const sentToday = status.lastSentOn === status.today && status.lastSentBy;
  /*
   * The two answers a person opens this for - when it goes, and whether today's went - read at a
   * glance above the controls that set them, in the shared summary card. The WhatsApp Group is the group
   * name in its own card below.
   */
  /*
   * Sends daily at is set here by whoever chooses the sender - unless the server's testing override
   * is deciding it, when the time is shown and said to be fixed there, so a saved time is not mistaken
   * for the one that runs.
   */
  const sendAtValue = status.canChooseSenders && !status.sendAtFromServer
    ? <div className="mt-1 space-y-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <TimeField label="Time (India)" helperText="The time it goes out every day, in India time." twelveHour value={sendAtTime} onChange={(event) => { setSendAtTime(event.target.value); setTimeError(""); fields.clear("sendAtTime"); }} disabled={savingTime} error={fields.errors.sendAtTime} className="min-w-0 flex-1 basis-40 sm:max-w-[13rem]" />
        <Button type="button" variant="primary" onClick={() => { void saveSendAt(); }} disabled={savingTime || sendAtTime === status.sendAtTime} className="shrink-0">
          {savingTime ? "Saving..." : "Save"}
        </Button>
      </div>
      {timeError && <p role="alert" className="text-xs text-rose-600 sm:text-sm">{timeError}</p>}
    </div>
    : <span>{status.sendAt}{status.sendAtFromServer && <span className="block text-xs text-amber-700">Fixed on the server for testing ({wording.serverOverride}).</span>}</span>;
  const scheduled = typeof api.setSendAt === "function";
  const glance = [
    ...(scheduled ? [["Sends daily at", sendAtValue]] : []),
    [wording.sentLabel, wording.sentText ? wording.sentText(status) : sentToday
      ? <span className="text-emerald-700">Sent by {status.lastSentBy.name || "someone no longer named"}</span>
      : <span className="text-slate-500">Not sent yet</span>],
  ];

  const sections = <>
    <RecordSummaryCard rows={glance} columnsClassName={scheduled ? "sm:grid-cols-2" : "sm:grid-cols-1"} />
    {status.lastError && <p role="alert" className={`rounded-lg border px-3 py-2 text-xs sm:text-sm ${sentToday ? "border-amber-200 bg-amber-50 text-amber-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{status.lastError}</p>}

    {/* The Sender and the WhatsApp Group, side by side from `lg` at the same height; stacked, in that
        order, below it - and the Sender alone, full width, for a message that goes to no group. */}
    <div className={`grid items-stretch gap-4 ${namedGroup ? "lg:grid-cols-2" : ""}`}>
      <DashboardCard
        title="Sender"
        noteAsTip
        note={status.canChooseSenders
          ? "From the employees with Allow WhatsApp ticked: one Sender every time with the rest behind them in a fallback order you drag, or a Rotation through all of them in the order you drag."
          : "Chosen by an administrator: one Sender every time, or a Rotation through the employees with Allow WhatsApp."}
        className="h-full"
        bodyClassName="space-y-3 p-4"
      >
        <SenderOrderField
          sender={status.sender || null}
          fallback={status.fallback || []}
          senders={status.senders || []}
          mode={status.senderMode || "SAME"}
          canWrite={Boolean(status.canChooseSenders)}
          saving={saving}
          onChange={(next) => { void saveSenders(next); }}
        />
        {status.canChooseSenders && !candidates.length && <p className="text-xs text-slate-500">No active employee has Allow WhatsApp ticked on their Login Credentials yet.</p>}
        {sendersError && <p role="alert" className="text-xs text-rose-600 sm:text-sm">{sendersError}</p>}
      </DashboardCard>

      {/* Only where the message has a group to name: the payment reminder and the shoot crew
          notice go to a project's own group, or to a person, so there is nothing to type here. */}
      {namedGroup && <DashboardCard
        title="WhatsApp Group"
        noteAsTip
        note={wording.whereNote || `Sent at ${status.sendAt} into the WhatsApp group with this name - matched against each sender's own groups when it sends, not when you save.`}
        className="h-full"
        bodyClassName="space-y-2 p-4"
      >
        <div className="flex flex-wrap items-end gap-2">
          <TextField
            label="Group name"
            value={groupName}
            helperText="Type it exactly as the group's name reads in WhatsApp."
            onChange={(event) => setGroupName(event.target.value)}
            placeholder={wording.placeholder}
            readOnly={!status.canChooseSenders}
            disabled={savingName}
            maxLength={500}
            className="min-w-0 flex-1 basis-48"
            inputClassName="min-h-10"
          />
          {status.canChooseSenders && <div className="flex shrink-0 gap-2">
            <Button type="button" variant="primary" onClick={() => { void saveGroupName(); }} disabled={savingName || groupName.trim() === (status.groupName || "")}>
              {savingName ? "Saving..." : "Save"}
            </Button>
            {/* Asks before it clears (the dialog below), so it need not shout here. */}
            {status.linked && <Button type="button" variant="secondary" onClick={() => setConfirmingUnlink(true)}>Clear</Button>}
          </div>}
        </div>
        {nameError && <p role="alert" className="text-xs text-rose-600 sm:text-sm">{nameError}</p>}
      </DashboardCard>}
    </div>
  </>;

  // One Notification card for a message with a switch: the switch in its header, the status and the
  // two sections inside. A message without one (the wishes) draws the sections as they are.
  const switchable = typeof api.setEnabled === "function";
  const enabled = status.enabled !== false;
  const canSwitch = typeof canWrite === "boolean" ? canWrite : Boolean(status.canChooseSenders);
  const framed = switchable
    ? <DashboardCard
      title="Notification"
      noteAsTip
      note={wording.switchNote}
      action={canSwitch
        ? <ToggleSwitch label={enabled ? "On" : "Off"} ariaLabel={wording.switchAria} checked={enabled} disabled={switching} onCheckedChange={(next) => { void setEnabled(next); }} />
        : <span className={`text-sm font-medium ${enabled ? "text-emerald-700" : "text-slate-500"}`}>{enabled ? "On" : "Off"}</span>}
      bodyClassName="space-y-4 p-3 sm:p-4"
    >
      {switchError && <p role="alert" className="text-xs text-rose-600 sm:text-sm">{switchError}</p>}
      {sections}
    </DashboardCard>
    : sections;

  return <div className="max-w-5xl space-y-4">
    {framed}

    {children}

    {status.canManage && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <WhatsApp style={{ fontSize: 22 }} aria-hidden="true" className="shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="flex min-w-0 items-center font-semibold text-slate-900"><span className="truncate">Your WhatsApp</span><HelpTip text="Connect it here so your turn as a sender can succeed." /></p>
      </div>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} className="shrink-0 gap-1.5 whitespace-nowrap">
        <WhatsApp style={{ fontSize: 18 }} aria-hidden="true" />Connect WhatsApp
      </Button>
    </div>}

    {open && <AttendanceReportGroupDialog
      status={status}
      onClose={() => { setOpen(false); void load(); }}
    />}
    {/* Only a message with one named group has a name to clear. */}
    {namedGroup && <ConfirmDialog
      open={confirmingUnlink}
      title="Clear the WhatsApp group's name?"
      message={wording.clearMessage(status.groupName)}
      confirmLabel="Clear"
      busyLabel="Clearing..."
      loading={unlinking}
      onCancel={() => setConfirmingUnlink(false)}
      onConfirm={() => { void clearGroupName(); }}
    />}
  </div>;
}
