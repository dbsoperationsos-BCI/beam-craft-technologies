"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import TextAreaField from "@/components/shared/TextAreaField";
import Dialog from "@/components/ui/Dialog";
import { setCandidateStatus } from "@/services/hrm/interview.service";
import { FOLLOW_UP_STATUS, ON_HOLD_STATUS, REJECTED_STATUS, SELECTED_STATUS } from "@/constants/interviewConfig";

/**
 * Every stage a person moves a candidate to by hand, each asked with its reason.
 *
 * Four of them, and one is not like the other three. **Selected**, **On Hold** and **Rejected** are
 * decisions about the person - the answers the register exists to reach. **Follow Up** is a decision
 * about the work: this candidate is worth another try, on this day. So it is the one that asks for a
 * date as well as a reason, and the one a candidate arrives at more than once.
 *
 * Selecting somebody, parking them and turning them down were a single click on the row's ⋮: the
 * stage changed and the **why** lived in whoever pressed it. Weeks later nobody could say why a
 * candidate was on hold, and "we already spoke to them and said no" was a thing the register could
 * not tell you.
 *
 * So each opens this, which asks one question. The note is **appended** to the candidate's
 * decisions rather than written over the last one, because a candidate held in March and rejected
 * in May has two reasons and neither explains the other.
 *
 * ── Why the note is optional ──
 *
 * A required box on a decision somebody has already made is a box that gets "ok" typed into it. The
 * dialog exists to make the reason easy and expected, not to refuse the decision without one - and
 * a blank note writes no entry at all, so the list stays reasons rather than a row of empties.
 */

const DECISIONS = {
  /*
   * **Follow Up is the one that asks for a date**, and the only stage here that is not a decision
   * about the person at all - it is a decision about *the work*: this is worth another try, on this
   * day. A stage that recorded the trying without the day would leave the register unable to say
   * who is due, which is the whole reason for having the stage.
   *
   * It is also the one a candidate reaches more than once. Each attempt appends its own entry to
   * their decisions, so three unanswered calls read as three, with the day each was made.
   */
  [FOLLOW_UP_STATUS]: {
    title: "Follow Up",
    confirm: "Save Follow-up",
    hint: "What happened when you reached out — no answer, asked to call back, wants time to think. This is what the next person to pick the row up will read.",
    asksDate: true,
  },
  [SELECTED_STATUS]: {
    title: "Mark Selected",
    confirm: "Mark Selected",
    hint: "What decided it — the round they were seen in, what stood out, what was agreed on pay.",
  },
  [ON_HOLD_STATUS]: {
    title: "Put On Hold",
    confirm: "Put On Hold",
    hint: "Why they are being parked, and what would bring them back — a role that is not open yet, a budget, a date.",
  },
  [REJECTED_STATUS]: {
    title: "Reject Candidate",
    confirm: "Reject",
    hint: "Why they were turned down. This is what anybody reading the register later will have to go on.",
  },
};

export default function InterviewDecisionDialog({ candidate, status, canWrite = true, onClose, onSaved }) {
  const decision = DECISIONS[status] || { title: "Move Stage", confirm: "Save", hint: "" };
  const [note, setNote] = useState("");
  /*
   * Opens on the date the record already holds rather than empty, because a follow-up almost always
   * moves a day that is already there - and a blank box invites a save that quietly clears it.
   * Only Follow Up draws this; the other three never send the key at all, so the column they do not
   * ask about is the column they do not touch.
   */
  const [nextFollowUpDate, setNextFollowUpDate] = useState(() => candidate?.nextFollowUpDate || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!canWrite || saving) return;
    setSaving(true);
    try {
      /*
       * Through the stage route, not the full update: it writes the stage and the note and nothing
       * else, so a decision taken from the register can never blank a column somebody else was
       * editing. A blank note is not sent, so no empty entry is recorded.
       */
      await setCandidateStatus(
        candidate.id,
        status,
        note.trim() || undefined,
        // Sent only by the stage that asks, so a rejection cannot blank a follow-up date nobody
        // meant to touch. `null` where Follow Up is saved with the box cleared, which means exactly
        // that: there is no next follow-up.
        decision.asksDate ? (nextFollowUpDate || null) : undefined,
      );
      onSaved?.(`${candidate.name || candidate.candidateCode || "Candidate"} moved to ${status}.`);
    } catch (saveError) {
      setError(saveError?.data?.message || saveError?.message || `Unable to move that candidate to ${status}.`);
    } finally {
      setSaving(false);
    }
  }

  return <Dialog
    title={decision.title}
    description={candidate?.name || candidate?.candidateCode || undefined}
    size="md"
    onClose={onClose}
    onSubmit={submit}
    busy={saving}
    footer={<>
      <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
      {/* Red only where the decision is the harsh one. Selected and On Hold are answers a studio is
          pleased to record, and three red buttons would say they are all the same kind of thing. */}
      <Button type="submit" variant={status === REJECTED_STATUS ? "danger" : "primary"} disabled={saving || !canWrite}>
        {saving ? "Saving…" : decision.confirm}
      </Button>
    </>}
  >
    {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-normal text-red-700 sm:text-sm">{error}</p>}
    {decision.asksDate && <div className="mb-4">
      <DateField
        label="Next Follow-up"
        value={nextFollowUpDate}
        onChange={setNextFollowUpDate}
      />
      {/* Said out loud, because it is what the register is worked by: the Next Follow-up column and
          the date filters above the table both read this, so a row with no day on it is a row that
          never comes back round to anybody. */}
      <p className="mt-2 text-[11px] font-normal leading-5 text-slate-500 sm:text-xs">
        When to try them again. Left blank, nothing brings this candidate back to anybody&apos;s attention.
      </p>
    </div>}
    <TextAreaField
      label="Remarks"
      value={note}
      onChange={(event) => setNote(event.target.value)}
      rows={5}
    />
    <p className="mt-2 text-[11px] font-normal leading-5 text-slate-500 sm:text-xs">{decision.hint}</p>
  </Dialog>;
}
