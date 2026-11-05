"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import TextAreaField from "@/components/shared/TextAreaField";
import Dialog from "@/components/ui/Dialog";
import InterviewStatusPills from "@/components/hrm/InterviewStatusPills";
import { setCandidateStatusBulk } from "@/services/hrm/interview.service";
import { BULK_STAGE_STATUSES, REJECTED_STATUS } from "@/constants/interviewConfig";

/**
 * One decision, taken about every candidate ticked on the register.
 *
 * `InterviewDecisionDialog` asked of a selection: the same question - the stage, and *why* - over a
 * set rather than over one row. The reason is written against **each** candidate rather than once
 * against the batch, because a decision is a thing about a person: somebody reading a candidate's
 * record a year later needs to find the reason on that record, not a note about thirty people it
 * happened to be taken alongside.
 *
 * ── The three it offers, and the five it does not ──
 *
 * Selected, On Hold and Rejected are **decisions**: the studio can take them about twelve people at
 * once as readily as about one, and each is a word that means exactly what it says wherever it is
 * written. The other stages are **consequences of an act** - a candidate is at Form Submission
 * Pending because a form went out, at Interview Scheduled because a conversation is in the diary,
 * at Onboarded because an invite was raised - and writing one of those onto a row without the act
 * behind it puts a candidate in a tab whose whole meaning is that something exists which does not.
 * That stage is then worked by somebody looking for an interview nobody booked. So those stay where
 * they are made: the screening form dialog, the schedule dialog, the onboarding invite.
 *
 * ── Why the reason is optional ──
 *
 * The same reason it is optional on one candidate: a required box on a decision somebody has already
 * made is a box that gets "ok" typed into it. A blank note writes no entry at all, so the decisions
 * on a record stay reasons rather than a row of empties.
 */

/*
 * `resolveIds` rather than the ids themselves, because the register is read a page at a time.
 *
 * A selection of "every candidate this stage holds" is a boolean on the page, not a list - the
 * browser has drawn only what was scrolled into view. So the list is asked for at the moment the
 * action runs, and `count` is what the bar and this dialog say in the meantime.
 */
export default function InterviewBulkStageDialog({ resolveIds, count = 0, canWrite = true, onClose, onSaved }) {
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);


  const candidates = `${count} candidate${count === 1 ? "" : "s"}`;

  async function submit(event) {
    event.preventDefault();
    if (!canWrite || saving) return;
    if (!status) { setError("Choose the stage to move them to."); return; }
    setSaving(true);
    setError("");
    try {
      /*
       * One call rather than one per candidate. The server moves them one at a time - each note is
       * appended to that candidate's own decisions - and answers with what it moved and what it
       * could not, so a row deleted between the read and the press is counted rather than throwing
       * the rest of the selection away.
       */
      // Resolved here rather than held: with "all matching" the ids are the server's answer, and
      // asking for them earlier would be asking on every render of a dialog nobody had submitted.
      const ids = await resolveIds();
      if (!ids.length) { setError("That selection no longer holds any candidates."); return; }
      const response = await setCandidateStatusBulk(ids, status, note.trim() || undefined);
      onSaved?.(response?.message || `${candidates} moved to ${status}.`);
    } catch (saveError) {
      setError(saveError?.data?.message || saveError?.message || `Unable to move ${candidates} to ${status}.`);
    } finally {
      setSaving(false);
    }
  }

  return <Dialog
    title="Change Stage"
    description={`${candidates} selected`}
    size="md"
    onClose={onClose}
    onSubmit={submit}
    busy={saving}
    footer={<>
      <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
      {/* Red only for the harsh one, exactly as the single decision dialog is: Selected and On Hold
          are answers a studio is pleased to record, and one red button for all three would say they
          are the same kind of thing. Refused until a stage is chosen, because "move them" with no
          stage names nothing to move them to. */}
      <Button type="submit" variant={status === REJECTED_STATUS ? "danger" : "primary"} disabled={saving || !canWrite || !status}>
        {saving ? "Moving…" : `Move ${candidates}`}
      </Button>
    </>}
  >
    {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-normal text-red-700 sm:text-sm">{error}</p>}
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Stage</p>
    <InterviewStatusPills value={status} onChange={(next) => { setStatus(next); setError(""); }} options={BULK_STAGE_STATUSES} />
    <div className="mt-4">
      <TextAreaField
        label="Remarks"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={4}
      />
      {/* Said out loud, because it is the part that is easy to get wrong from a dialog about a set:
          the reason lands on every one of their records, so it has to read as true of all of them. */}
      <p className="mt-2 text-[11px] font-normal leading-5 text-slate-500 sm:text-xs">
        Written against each of the {candidates} — so it should be a reason that is true of all of them. Left blank, nothing is recorded.
      </p>
    </div>
  </Dialog>;
}
