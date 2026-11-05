"use client";

import { avatarOf } from "@/lib/employeeAvatar.mjs";
import { useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import RecordDetails from "@/components/data-table/RecordDetails";
import Button from "@/components/shared/Button";
import TextAreaField from "@/components/shared/TextAreaField";
import Dialog from "@/components/ui/Dialog";
import Dropdown from "@/components/shared/Dropdown";
import useFormErrors from "@/components/shared/useFormErrors";
import { approveTask, cancelTask, completeTask, reassignTask, revokeTask, resolveFeedbackTask, startTask, uploadTaskAttachment } from "@/services/hrm/tasks.service";
import TaskAttachments from "@/components/hrm/TaskAttachments";
import { activityLabel, activityStyles, taskInfoSections, taskStatusStyles } from "@/constants/taskConfig";

/**
 * One task, read in full, with the things that can still happen to it.
 *
 * The five verbs are offered from the record's own answers — `canStart`, `canComplete`,
 * `canReassign`, `canCancel` and `canDelete`, which the server works out per row from the same
 * function it refuses the write with. Nothing here guesses from the signed-in user: whoever holds
 * the task gets Start, Reassign and Mark Complete, whoever set it gets Cancel and Delete (as does a
 * Super Admin), and somebody reading through `HRM / All Tasks` gets none of them because none is
 * theirs to press. A control that is not theirs is absent rather than present and refused.
 *
 * `canWrite` is the screen's own permission and gates all four on top of that: a role holding only
 * READ can read its tasks and act on none of them. The panel takes it as a prop rather than reading
 * the route, because it is opened by a double-click and by a link from the bell as well as by the
 * table — it cannot rely on the control that opened it having been hidden.
 */

const dateTime = (value) => value
  ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "—";

/** The history, newest at the bottom, the way a conversation reads. */
function ActivityLog({ activities }) {
  if (!activities?.length) return <p className="text-sm text-slate-500">Nothing has happened to this task yet.</p>;
  return <ol className="flex flex-col gap-3">
    {activities.map((activity) => <li key={activity.id} className="flex gap-3">
      {/* The dot and the line under it, so the entries read as one thread rather than as rows. */}
      <span className="mt-1.5 flex flex-col items-center">
        <span className={`h-2 w-2 shrink-0 rounded-full ${activityStyles[activity.action] || "bg-slate-400"}`} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800">{activityLabel(activity.action)}</p>
        {activity.detail && <p className="mt-0.5 break-words text-sm text-slate-600">{activity.detail}</p>}
        <p className="mt-0.5 text-xs text-slate-400">{activity.userName} · {dateTime(activity.createdAt)}</p>
      </div>
    </li>)}
  </ol>;
}

export default function TaskDetailPanel({ task, canWrite = false, assignableUsers = [], onClose, onChanged, onError, onNotice, onRefresh, onDelete }) {
  const [busy, setBusy] = useState(false);
  // Both ask for a reason, and only one is required — so they share the reason box and differ in
  // whether an empty one is allowed through. Reassigning asks for a person as well.
  const [reassigning, setReassigning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Whoever assigned the task taking it back, with an optional person to reassign it to.
  const [revoking, setRevoking] = useState(false);
  // A feedback issue being answered: "Issues sorted" or "Rejected" while its dialog is open.
  const [answering, setAnswering] = useState(null);
  const [reason, setReason] = useState("");
  const [nextAssignee, setNextAssignee] = useState("");
  const fields = useFormErrors();

  async function run(action, message) {
    setBusy(true);
    try {
      const response = await action();
      setReassigning(false);
      setCancelling(false);
      setRevoking(false);
      setAnswering(null);
      setReason("");
      setNextAssignee("");
      onChanged?.(response?.data, message);
    } catch (error) {
      onError?.(error?.data?.message || error?.message || "Unable to update that task.");
    } finally {
      setBusy(false);
    }
  }

  /*
   * Attaching from here, which is the second half of what the assign form starts.
   *
   * `canAttach` is the server's answer for this reader - one of the two people on the task - and
   * `canWrite` is the screen's own permission on top of it, the same pair the four verbs answer to.
   * Somebody reading through All Tasks may open every file and add none.
   */
  async function attach(file) {
    try {
      await uploadTaskAttachment(task.id, file);
      onNotice?.(`${file.name} attached.`);
      await onRefresh?.();
    } catch (error) {
      onError?.(error?.data?.message || error?.message || `${file.name} could not be attached.`);
    }
  }

  /*
   * Rebuilt each render rather than memoised: the attachment section closes over `attach` and the
   * panel's callbacks, all of which are new every render, so a memo keyed on `task` alone would
   * hand the section a stale uploader. It is a list of five objects — the memo was never the cost.
   */
  const sections = [
    ...taskInfoSections.map((section) => ({
      id: `task-${section.title.toLowerCase()}`,
      title: section.title,
      render: () => <RecordDetails entity={task} sections={[section]} variant="rows" hideEmpty />,
    })),
    /*
     * The files, between the record and its history: they are part of what the task is - the brief
     * it was given with, the proof it was finished by - rather than something that happened to it.
     */
    {
      id: "task-attachments",
      title: "Attachments",
      render: () => <TaskAttachments
        taskId={task.id}
        attachments={task.attachments}
        canAttach={canWrite && task.canAttach}
        onUpload={attach}
        onRemoved={() => onRefresh?.()}
        onNotice={onNotice}
        onError={onError}
      />,
    },
    // The history is a section of its own rather than a field, because it is a list that grows and
    // the record's other sections are a fixed set of answers.
    { id: "task-activity", title: "Activity", render: () => <ActivityLog activities={task.activities} /> },
  ];

  /*
   * Who this task can be handed to: everybody assignable except whoever holds it now.
   *
   * The current holder is dropped rather than shown and refused — reassigning a task to the person
   * who already has it is not a reassignment, and the server says so. Previous holders stay on the
   * list: work does come back, and a task that went out and returned is a normal thing to record.
   */
  const reassignOptions = (assignableUsers || [])
    .filter((user) => Number(user.id) !== Number(task.assignedToUserId))
    .map((user) => ({ value: String(user.id), label: user.name || user.username || user.email || `User ${user.id}`, avatar: avatarOf(user) }));

  /*
   * The five verbs, each offered only where the server says this reader may use it *and* the
   * screen's permission allows writing at all. A read-only viewer gets no footer.
   */
  const actions = canWrite ? [
    // Primary: on a task waiting to be picked up, getting on with it is the thing to press. Only one
    // of Start and Mark Complete is ever offered at a time, so the footer never carries two.
    task.canStart && { label: "Start", variant: "primary", run: () => run(() => startTask(task.id), `${task.taskCode} is now in progress.`) },
    /* Not `danger`: handing work to the right person is the system working, not a failure. Rolling
       back was red because it stopped the task; this keeps it moving. */
    task.canReassign && { label: "Reassign", variant: undefined, run: () => { setReason(""); setNextAssignee(""); fields.clearAll(); setReassigning(true); } },
    task.canRevoke && { label: "Revoke Task", variant: undefined, run: () => { setReason(""); setNextAssignee(""); setRevoking(true); } },
    task.canCancel && { label: "Cancel Task", variant: "danger", run: () => { setReason(""); setCancelling(true); } },
    /*
     * Delete is handed back to the page rather than run here.
     *
     * The same confirmation serves the row menu and this button, so it is worded once and lives
     * where the list is - which is also what the reader is left looking at, since a deleted task
     * has no panel to return to. Offered beside Cancel Task, not instead of it: cancelling says a
     * real task was called off and tells the holder, deleting says it should never have been
     * raised.
     */
    task.canDelete && onDelete && { label: "Delete Task", variant: "danger", run: () => onDelete(task) },
    // The holder finishes and sends it back to whoever assigned it.
    task.canComplete && { label: task.completeSendsBack ? "Finish & Send Back" : "Mark as Completed", variant: "primary", run: () => run(() => completeTask(task.id), task.completeSendsBack ? `${task.taskCode} finished and sent back to ${task.assignedByName}.` : `${task.taskCode} marked as completed.`) },
    // Whoever assigned it, once it has been sent back.
    task.canApprove && { label: "Mark as Completed", variant: "primary", run: () => run(() => approveTask(task.id), `${task.taskCode} marked as completed.`) },
    /*
     * A feedback issue - a client's Average or Poor review given to this person - is answered rather
     * than completed: Issues sorted, or Rejected with the reason. Either one finishes the task and is
     * what moves the feedback out of Issues once every issue on it is answered.
     */
    task.canResolveFeedback && { label: "Issues sorted", variant: "primary", run: () => { setReason(""); fields.clearAll(); setAnswering("Issues sorted"); } },
    task.canResolveFeedback && { label: "Rejected", variant: "danger", run: () => { setReason(""); fields.clearAll(); setAnswering("Rejected"); } },
  ].filter(Boolean) : [];

  return <>
    <SchemaFormPanel
      title={`${task.taskCode} · ${task.title}`}
      description={[
        // What this task is, when it is a client's review: which review, how they rated it, and where.
        task.feedbackIssue && `Feedback issue: ${task.feedbackIssue.reviewLabel} rated ${task.feedbackIssue.review} in ${task.feedbackIssue.feedbackCode}${task.feedbackIssue.shootCode ? ` (shoot ${task.feedbackIssue.shootCode})` : ""}`,
        `Assigned to ${task.assignedToName}`,
        `by ${task.assignedByName}`,
        dateTime(task.createdAt),
      ].filter(Boolean).join(" · ")}
      sections={sections}
      sidebarAriaLabel="Task sections"
      closeAriaLabel="Close task"
      onClose={onClose}
      // Nothing here is submitted: the panel is the reading surface, and each verb below acts on
      // its own rather than on a Save.
      onSubmit={(event) => event.preventDefault()}
      /*
       * The verbs, and only the verbs. There is no Close button: the panel's own × closes it, and a
       * footer led by a button that does nothing to the task pushed the real actions to the far
       * edge of the bar. A task with nothing left to do to it - already finished, or being read by
       * somebody who is neither side of it - gets no footer at all rather than an empty bar.
       */
      footer={actions.length ? <div className="flex w-full flex-wrap items-center justify-end gap-2">
        {actions.map((action) => <Button
          key={action.label}
          className="max-sm:w-full"
          type="button"
          variant={action.variant}
          onClick={action.run}
          busy={busy}
        >{action.label}</Button>)}
      </div> : null}
    >
      {/* What is asked first of any task — how urgent, and where it has got to — read as a strip
          rather than as two more fields among a dozen. */}
      <div className="w-full max-w-[1040px] px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Priority</p>
            <p className="mt-0.5 text-xl font-semibold text-slate-900 sm:text-2xl">{task.priorityLabel}</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">
            <span className={`h-2 w-2 shrink-0 rounded-full ${taskStatusStyles[task.statusLabel] || "bg-slate-400"}`} />
            {task.statusLabel}
          </span>
        </div>
      </div>
    </SchemaFormPanel>

    {/*
      * Handing the task to somebody else, which demands both a person and a reason.
      *
      * The reason is not a formality: the next person is being given work with no history of their
      * own, and the sentence saying why it left the last one is the only thing that lets them pick
      * it up. Everybody on the chain reads it — whoever set the task, whoever held it before, and
      * whoever holds it now.
      */}
    {reassigning && <Dialog
      title={`Reassign ${task.taskCode}`}
      description="The task moves to whoever you choose, and stays open. They and whoever set the task are both told, with your reason."
      // Opened from inside a SchemaFormPanel, which stacks at 110 — the Dialog default of 100 put
      // this behind the panel that opened it, so pressing the button appeared to do nothing at all.
      layer="dialogOverPanel"
      busy={busy}
      onClose={() => setReassigning(false)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!fields.check({
          nextAssignee: nextAssignee ? "" : "Choose who takes it over.",
          reason: reason.trim() ? "" : "Enter why it is being reassigned.",
        })) return;
        const to = reassignOptions.find((option) => option.value === nextAssignee);
        void run(() => reassignTask(task.id, Number(nextAssignee), reason.trim()), `${task.taskCode} reassigned${to ? ` to ${to.label}` : ""}.`);
      }}
      footer={<>
        <Button className="max-sm:flex-1" type="button" onClick={() => setReassigning(false)} disabled={busy}>Cancel</Button>
        <Button className="max-sm:flex-1" variant="primary" disabled={busy}>{busy ? "Reassigning..." : "Reassign"}</Button>
      </>}
    >
      <div className="space-y-4">
        {/* The current holder is not on the list: reassigning a task to whoever already has it is
            not a reassignment, and the server refuses it. Better absent than offered and refused. */}
        <Dropdown
          mode="input"
          label="Reassign to"
          helperText="The person who takes over this task; they are notified."
          required
          searchable
          placeholder={reassignOptions.length ? "Choose who should do this" : "No one else can be given this task"}
          menuZIndexClassName="z-[200]"
          value={nextAssignee}
          onChange={(value) => { setNextAssignee(value); fields.clear("nextAssignee"); }}
          error={fields.errors.nextAssignee}
          options={reassignOptions}
        />
        <TextAreaField
          required
          label="Why is it being reassigned?"
          helperText="Sent to the new assignee and kept in the task's activity."
          value={reason}
          onChange={(event) => { setReason(event.target.value); fields.clear("reason"); }}
          error={fields.errors.reason}
          rows={4}
          placeholder="e.g. I am on the Erode shoot all week — Priya has the client's files"
        />
      </div>
    </Dialog>}

    {/* Revoking: taken back from whoever has it, and - if someone is chosen - reassigned to them, who
        then follow the same flow from the start. */}
    {revoking && <Dialog
      title={`Revoke ${task.taskCode}?`}
      description={`It is taken back from ${task.assignedToName}, who is told. Choose someone to reassign it to, or leave it empty to keep it with you.`}
      layer="dialogOverPanel"
      busy={busy}
      onClose={() => setRevoking(false)}
      onSubmit={(event) => {
        event.preventDefault();
        const to = reassignOptions.find((option) => option.value === nextAssignee);
        void run(() => revokeTask(task.id, reason.trim() || null, nextAssignee ? Number(nextAssignee) : null), to ? `${task.taskCode} revoked and reassigned to ${to.label}.` : `${task.taskCode} revoked from ${task.assignedToName}.`);
      }}
      footer={<>
        <Button className="max-sm:flex-1" type="button" onClick={() => setRevoking(false)} disabled={busy}>Cancel</Button>
        <Button className="max-sm:flex-1" variant="primary" disabled={busy}>{busy ? "Saving..." : nextAssignee ? "Revoke & Reassign" : "Revoke Task"}</Button>
      </>}
    >
      <div className="space-y-4">
        <Dropdown
          mode="input"
          label="Reassign to (optional)"
          helperText="Hands the task to this person; leave empty to keep it yourself."
          searchable
          placeholder="Leave empty to keep it with you"
          menuZIndexClassName="z-[200]"
          value={nextAssignee}
          onChange={(value) => setNextAssignee(value || "")}
          options={reassignOptions}
        />
        <TextAreaField
          label="Reason (optional)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          maxLength={1000}
          helperText="Told to whoever had the task and kept in its activity."
          placeholder="e.g. Priya has the client's files, so she will take this over"
        />
      </div>
    </Dialog>}

    {/* Answering a feedback issue: sorted, or rejected with the reason the feedback keeps. */}
    {answering && <Dialog
      title={answering === "Rejected" ? `Reject this issue (${task.taskCode})?` : `Mark this issue as sorted (${task.taskCode})?`}
      description={answering === "Rejected"
        ? "The client's issue is closed as rejected. Say why - the reason is kept on the feedback."
        : "The client's issue is closed as sorted out. Add a remark if it helps whoever reads the feedback."}
      layer="dialogOverPanel"
      busy={busy}
      onClose={() => setAnswering(null)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!fields.check({ reason: answering === "Rejected" && !reason.trim() ? "Enter a reason." : "" })) return;
        void run(() => resolveFeedbackTask(task.id, answering, reason.trim()), `${task.taskCode} answered: ${answering}.`);
      }}
      footer={<>
        <Button className="max-sm:flex-1" type="button" onClick={() => setAnswering(null)} disabled={busy}>Back</Button>
        <Button className="max-sm:flex-1" variant={answering === "Rejected" ? "danger" : "primary"} disabled={busy}>{busy ? "Saving..." : answering}</Button>
      </>}
    >
      <TextAreaField
        label={answering === "Rejected" ? "Reason" : "Remarks (optional)"}
        helperText="Kept on the client's feedback alongside the answer."
        required={answering === "Rejected"}
        value={reason}
        onChange={(event) => { setReason(event.target.value); fields.clear("reason"); }}
        error={fields.errors.reason}
        rows={3}
        maxLength={1000}
        placeholder={answering === "Rejected" ? "Why is this issue being rejected?" : "How was it sorted out?"}
      />
    </Dialog>}
    {/* Calling a task off. A reason is welcome here but not demanded — the person who set it is the
        one cancelling, so there is nobody who is owed an explanation. */}
    {cancelling && <Dialog
      title={`Cancel ${task.taskCode}?`}
      description={`${task.assignedToName} is told it has been called off, and the task stops appearing in their list.`}
      // Above the panel it was opened from, for the same reason as the revert dialog above.
      layer="dialogOverPanel"
      busy={busy}
      onClose={() => setCancelling(false)}
      onSubmit={(event) => {
        event.preventDefault();
        void run(() => cancelTask(task.id, reason.trim() || null), `${task.taskCode} cancelled.`);
      }}
      footer={<>
        <Button className="max-sm:flex-1" type="button" onClick={() => setCancelling(false)} disabled={busy}>Keep Task</Button>
        <Button className="max-sm:flex-1" variant="danger" disabled={busy}>{busy ? "Cancelling..." : "Cancel Task"}</Button>
      </>}
    >
      <TextAreaField
        label="Reason (optional)"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={3}
        helperText="Told to the assignee and kept in the task's activity."
        placeholder="e.g. The client moved the date, so this is no longer needed"
      />
    </Dialog>}
  </>;
}
