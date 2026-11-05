"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DashboardCard from "@/components/shared/DashboardCard";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import MessageTemplatePanel from "@/components/settings/MessageTemplatePanel";
import SenderOrderField from "@/components/settings/SenderOrderField";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Tabs from "@/components/ui/Tabs";
import {
  getInterviewWelcomeMessage,
  getInterviewWelcomeSenderCandidates,
  setInterviewWelcomeMessageEnabled,
  setInterviewWelcomeSender,
} from "@/services/settings/automatic-whatsapp.service";

/*
 * Settings → Templates → **Interview Welcome**: the message each candidate a linked interview Google
 * Sheet brings in gets on WhatsApp, with - above the wording - whether it is sent at all and whose
 * WhatsApp it goes from: one Sender, or a Rotation through the employees with Allow WhatsApp ticked
 * (`SenderOrderField`).
 *
 * The switch and the senders are `SETTINGS / Automatic WhatsApp Message` (Read / Write to change them,
 * `canWrite` on the server's answer); a reader without it sees the wording alone. The wording is the
 * template, `SETTINGS / Message Template`, as every other.
 */

const messageOf = (error, fallback) => error?.data?.message || error?.message || fallback;

/*
 * The two wordings, as New Lead Welcome has them: Interview Welcome itself for a candidate arriving in
 * office time, and its after-hours message for any other time (a weekly off or a holiday included).
 */
const WORDINGS = [
  { id: "office", label: "Office time", key: "INTERVIEW_WELCOME", name: "Interview Welcome" },
  { id: "afterHours", label: "After hours", key: "INTERVIEW_WELCOME_AFTER_HOURS", name: "Interview Welcome - After hours" },
];

export default function InterviewWelcomePanel({ canWriteTemplate = false, onNotice, onError, unsavedRef }) {
  const [status, setStatus] = useState(null);
  // Not readable (no Automatic WhatsApp Message): the wording is shown without the controls.
  const [hidden, setHidden] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  // Which wording is open, and a switch asked for while the one on screen is unsaved.
  const [wording, setWording] = useState("office");
  const [pendingWording, setPendingWording] = useState(null);
  const ownUnsaved = useRef(false);
  const unsaved = unsavedRef || ownUnsaved;
  const openWording = WORDINGS.find((entry) => entry.id === wording) || WORDINGS[0];
  const askWording = (next) => { if (next === wording) return; if (unsaved.current) setPendingWording(next); else setWording(next); };

  const load = useCallback(async () => {
    try {
      const response = await getInterviewWelcomeMessage();
      const next = response?.data || null;
      setStatus(next);
      if (next?.canWrite) {
        const list = await getInterviewWelcomeSenderCandidates().catch(() => null);
        setCandidates(list?.data || []);
      }
    } catch (error) {
      if (error?.status === 403) setHidden(true);
      else setProblem(messageOf(error, "Unable to read the Interview Welcome message."));
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function change(work, said) {
    setBusy(true);
    setProblem("");
    try {
      const response = await work();
      if (response?.data) setStatus(response.data);
      onNotice?.(said);
    } catch (error) {
      setProblem(messageOf(error, "Unable to save that."));
    } finally {
      setBusy(false);
    }
  }

  const enabled = Boolean(status?.enabled);
  const canWrite = Boolean(status?.canWrite);
  const rotating = status?.senderMode === "ROTATE";
  const senders = status?.senders || [];
  // Whoever would be asked: the one Sender, or everybody in the Rotation.
  const asked = rotating ? senders : (status?.sender ? [status.sender, ...(status.fallback || [])] : []);
  const noneLinked = asked.length > 0 && asked.every((entry) => !entry.connected || entry.eligible === false);

  return <div className="max-w-5xl space-y-4">
    {!hidden && <DashboardCard
      title="Notification"
      note="Sent once to each new candidate a linked interview Google Sheet brings in, from the WhatsApp of the Sender, or the Rotation, chosen below."
      action={status && (canWrite
        ? <ToggleSwitch label={enabled ? "On" : "Off"} ariaLabel="Send this WhatsApp message to each new candidate from a linked interview sheet" checked={enabled} disabled={busy} onCheckedChange={(next) => { void change(() => setInterviewWelcomeMessageEnabled(next), next ? "On. Each new candidate from a linked interview sheet is now messaged on WhatsApp." : "Off. New candidates are not messaged."); }} />
        : <span className={`text-sm font-medium ${enabled ? "text-emerald-700" : "text-slate-500"}`}>{enabled ? "On" : "Off"}</span>)}
      bodyClassName="space-y-3 p-3 text-xs text-slate-600 sm:p-4 sm:text-sm"
    >
      {!status && !problem && <p className="text-slate-500">Loading...</p>}
      {problem && <p role="alert" className="text-rose-600">{problem}</p>}
      {status && <>
        <div className="max-w-xl">
          <SenderOrderField
            sender={status.sender || null}
            fallback={status.fallback || []}
            senders={senders}
            mode={status.senderMode || "SAME"}
            canWrite={canWrite}
            saving={busy}
            onChange={(input) => { void change(() => setInterviewWelcomeSender(input), input.mode === "ROTATE" ? "Rotation saved." : "Sender saved."); }}
          />
        </div>
        {noneLinked && <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800 ring-1 ring-amber-200">Nobody who would send it has WhatsApp linked, so nothing can be sent until one of them links it in WhatsApp Chat.</p>}
        {enabled && !asked.length && <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800 ring-1 ring-amber-200">It is on, but nobody is chosen to send it from, so no candidate is being messaged.</p>}
        {status.lastError && <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-amber-800 ring-1 ring-amber-200">{status.lastError}</p>}
      </>}
    </DashboardCard>}
    <div className="space-y-2">
      <Tabs tabs={WORDINGS.map((entry) => ({ id: entry.id, label: entry.label }))} value={wording} onChange={askWording} ariaLabel="When the candidate arrives" />
      <p className="text-xs text-slate-500">
        <span className="font-medium text-slate-700">Office time</span> is the attendance shift on a working day (Attendance Rules).
        <span className="font-medium text-slate-700"> After hours</span> is any other time, a weekly off or a holiday; where it has no wording, the office-time message is sent.
      </p>
    </div>
    <MessageTemplatePanel
      key={openWording.key}
      templateKey={openWording.key}
      helpKey="INTERVIEW_WELCOME"
      name={openWording.name}
      canWrite={canWriteTemplate}
      unsavedRef={unsaved}
      onNotice={onNotice}
      onError={onError}
    />
    {pendingWording && <ConfirmDialog
      title="Discard your changes?"
      message="This wording has changes that are not saved. Switching to the other message throws them away."
      confirmLabel="Discard"
      onCancel={() => setPendingWording(null)}
      onConfirm={() => { setWording(pendingWording); setPendingWording(null); }}
    />}
  </div>;
}
