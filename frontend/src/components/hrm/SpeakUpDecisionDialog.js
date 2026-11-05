"use client";

import { useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import TextAreaField from "@/components/shared/TextAreaField";
import Dialog from "@/components/ui/Dialog";
import { avatarOf } from "@/lib/employeeAvatar.mjs";
import { getSpeakUpAssignees } from "@/services/hrm/speakUp.service";
import { PRIORITY_LABELS, TASK_PRIORITIES } from "@/constants/taskConfig";
import { SPEAK_UP_DECISIONS } from "@/constants/speakUpConfig";

const PRIORITY_OPTIONS = TASK_PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] }));

/**
 * One reviewer decision on one pending speak-up: Approve, Approve & Assign, or Reject.
 *
 * Reject asks why, and will not go without it. Approve & Assign asks who, how urgent and by when -
 * the task's title and description come from the speak-up itself, and never say who raised it.
 * Approve takes an optional remark. The remark stays in Speak-up Review: the employee sees only
 * the status.
 */
export default function SpeakUpDecisionDialog({ decision, speakUp, busy = false, error = "", onClose, onConfirm, onError }) {
  const copy = SPEAK_UP_DECISIONS[decision];
  const assigning = decision === "ASSIGN";
  const rejecting = decision === "REJECT";
  const [remark, setRemark] = useState("");
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [dueOn, setDueOn] = useState("");
  const [assignees, setAssignees] = useState(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!assigning) return undefined;
    let cancelled = false;
    getSpeakUpAssignees()
      .then((response) => {
        if (cancelled) return;
        setAssignees((response?.data || []).map((user) => ({ value: user.id, label: user.name, avatar: avatarOf(user) })));
      })
      .catch((error) => {
        if (cancelled) return;
        setAssignees([]);
        onError?.(error.message || "Unable to load who this can be assigned to.");
      });
    return () => { cancelled = true; };
  }, [assigning, onError]);

  const reasonMissing = rejecting && !remark.trim();
  const assigneeMissing = assigning && !assignedToUserId;

  function submit(event) {
    event.preventDefault();
    setTried(true);
    if (busy || reasonMissing || assigneeMissing) return;
    onConfirm({
      decision,
      remark: remark.trim(),
      ...(assigning ? { assignedToUserId: Number(assignedToUserId), priority, dueOn } : {}),
    });
  }

  return <Dialog
    title={copy.title}
    description={[speakUp.speakUpId, speakUp.title].filter(Boolean).join(" · ")}
    size={assigning ? "md" : "sm"}
    // Above the open speak-up when it is decided from there, as well as over the table.
    layer="dialogOverPanel"
    onClose={onClose}
    busy={busy}
    onSubmit={submit}
    footer={<>
      <Button type="button" size="lg" onClick={onClose} className="font-semibold">Cancel</Button>
      <Button type="submit" variant={copy.tone} size="lg" busy={busy} className="font-semibold">{copy.action}</Button>
    </>}
  >
    <div className="space-y-4 pb-2">
      {assigning && <>
        <p className="text-sm text-slate-500">
          The speak-up becomes a task for the person you choose. The task does not say who raised it.
        </p>
        <Dropdown
          label="Assign To"
          helperText="The person who gets this as a task; they do not see who raised it."
          required
          placeholder={assignees === null ? "Loading..." : "Select a person"}
          options={assignees || []}
          value={assignedToUserId}
          onChange={setAssignedToUserId}
          error={assignees?.length === 0
            ? "No one can take a task right now. Close this and try again."
            : tried && assigneeMissing ? "Choose who it is assigned to." : ""}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Dropdown label="Priority" helperText="How urgent the task is for the person it is assigned to." options={PRIORITY_OPTIONS} sorted={false} searchable={false} value={priority} onChange={setPriority} />
          <DateField label="Due Date" helperText="The day the task should be done by; blank for no deadline." restriction="past" value={dueOn} onChange={setDueOn} />
        </div>
      </>}
      <div className="space-y-1">
        <TextAreaField
          label={rejecting ? "Reason" : assigning ? "Note for the assignee (optional)" : "Remark (optional)"}
          helperText={assigning ? "Extra detail for the person doing the task." : "Your note on this decision, for the review team."}
          required={rejecting}
          rows={3}
          value={remark}
          onChange={(event) => setRemark(event.target.value)}
          error={tried && reasonMissing ? "Say why it is rejected." : ""}
        />
        {/* Said under the field rather than in its placeholder, so it is still there once typing starts. */}
        <p className="text-xs text-slate-500">
          {assigning ? "Added to the task." : "Seen in Speak-up Review only - the employee sees just the status."}
        </p>
      </div>
      {/* A failed save is said here, in the dialog still open over the page, not behind it. */}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  </Dialog>;
}
