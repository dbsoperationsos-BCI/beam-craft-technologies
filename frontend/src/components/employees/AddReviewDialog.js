"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import Dialog from "@/components/ui/Dialog";
import Dropdown from "@/components/shared/Dropdown";
import { REVIEW_OUTCOMES, emptyReview, outcomeStyle, reviewPayload, totalIncrement, validateReview } from "@/constants/employeeReviewConfig";
import { syncedNextReviewDate } from "@/lib/employeeReviewSchedule.mjs";

// A dash for an amount nobody gave, and a number for one they did — including a deliberate 0,
// which is a review that awarded nothing and is not the same as a review that did not say.
const formatAmount = (value) => (value === null || value === undefined || String(value).trim() === ""
  ? "—"
  : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(value)));

/** How the review went, said in its own colour. Silent where nobody said. */
export function OutcomeChip({ outcome }) {
  if (!outcome) return <span className="text-slate-400">—</span>;
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${outcomeStyle(outcome).chip}`}>{outcome}</span>;
}

/**
 * Records one salary review against an employee: fill the fields, press Save.
 *
 * Opened on an existing review instead, the same form edits that one.
 *
 * It used to hold a queue — Add Review List built up a list inside the dialog and Save committed the
 * lot. That was a second list on a screen whose whole subject is a list of reviews, and it asked
 * somebody recording one review to press two buttons, the first of which looked like the one that
 * saves. Reviews are recorded one at a time, so the dialog does one thing.
 */
/**
 * `prefill` starts a *new* review from answers the caller already knows — the Upcoming entry hands
 * over the date the review was due. It is not `initialReview`: that one means "edit this row", and
 * a synthetic row with no key would be saved over nothing and quietly lost.
 */
export default function AddReviewDialog({ initialReview, prefill, existingReviews = [], onClose, onSave }) {
  const isEdit = Boolean(initialReview);
  const [current, setCurrent] = useState(() => initialReview ? { ...initialReview } : { ...emptyReview(), ...prefill, nextReviewDate: prefill?.reviewDate ? syncedNextReviewDate({ previousSource: "", nextSource: prefill.reviewDate, currentNext: "" }) : "" });
  const [error, setError] = useState("");

  /*
   * Answering the review date proposes the next one, six months on.
   *
   * The same rule the joining date follows on the form behind this, through the same helper — a
   * review is six months after the last thing that happened, wherever that is being decided. It is
   * a proposal: the field stays editable, and once somebody has put their own date in it, moving
   * the review date leaves it alone rather than overwriting a decision with a default.
   */
  function update(field, value) {
    setCurrent((existing) => ({
      ...existing,
      [field]: value,
      ...(field === "reviewDate" ? { nextReviewDate: syncedNextReviewDate({ previousSource: existing.reviewDate, nextSource: value, currentNext: existing.nextReviewDate }) } : {}),
    }));
    setError("");
  }

  /**
   * One review, saved.
   *
   * There used to be a queue: a review was added to a list inside the dialog, several could be
   * built up, and Save committed the lot. It was a second list on a screen that already has one —
   * the reviews already recorded are right behind this dialog — and it asked somebody adding a
   * single review to press two buttons, the first of which looked like the one that saves. Reviews
   * are recorded one at a time, so the dialog does one thing.
   */
  function save() {
    const problem = validateReview(current);
    if (problem) {
      setError(problem);
      return;
    }
    onSave([reviewPayload(current)]);
  }

  const runningTotal = totalIncrement([...existingReviews, current]);

  return <Dialog
    title={isEdit ? "Edit Review" : "Add Review"}
    description="Increment amounts here decide the employee's total increment and total salary."
    size="lg"
    layer="dialogOverPanel"
    onClose={onClose}
    footer={<>
      <Button className="max-sm:flex-1" type="button" onClick={onClose}>Cancel</Button>
      <Button className="max-sm:flex-1" type="button" variant="primary" onClick={save}>Save</Button>
    </>}
  >
    <div className="grid gap-4 md:grid-cols-2">
      {/*
        * Any date, past or future.
        *
        * It was limited to today and earlier, on the reading that a review is something that has
        * happened. Two things were wrong with that. The studio records reviews it has scheduled as
        * well as ones it has held - that is the list it works from - and the Upcoming tab's own
        * "Record this review" hands over the date the review is *due*, which is by definition in
        * the future: the prefill arrived in a field that would not accept it back.
        */}
      <DateField label="Review Date" required value={current.reviewDate} onChange={(value) => update("reviewDate", value)} />
      {/* Beside the date because it is what the review *says*; the increment below is what the
          review then did about it. `sorted={false}` keeps the scale in its own order - alphabetically
          these read Average, Good, Poor, which is not a scale at all. */}
      <Dropdown
        mode="input"
        label="Review Outcome"
        placeholder="Not recorded"
        sorted={false}
        menuZIndexClassName="z-[200]"
        value={current.outcome || ""}
        onChange={(value) => update("outcome", value)}
        options={REVIEW_OUTCOMES.map((outcome) => ({ label: outcome, value: outcome }))}
      />
      {/* Not required: plenty of reviews are held without a figure, and demanding one meant typing
          a 0 that then counted as a real increment of zero in the employee's totals for ever. */}
      <TextField label="Increment Amount" type="number" inputMode="numeric" min="0" placeholder="Leave empty if none" value={current.incrementAmount} onChange={(event) => update("incrementAmount", event.target.value)} />
      <DateField label="Next Review Date" value={current.nextReviewDate} onChange={(value) => update("nextReviewDate", value)} />
      <TextAreaField className="md:col-span-2" label="Remarks" rows={3} value={current.remarks} onChange={(event) => update("remarks", event.target.value)} />
    </div>

    {error && <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

    {/* What the employee's total increment becomes once this is saved, so the figure the record
        will show is visible while the amount that changes it is being typed. */}
    <p className="mt-4 text-sm text-slate-600">Total increment after saving: <span className="font-semibold text-slate-800">{formatAmount(runningTotal)}</span></p>
  </Dialog>;
}
