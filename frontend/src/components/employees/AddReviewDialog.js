"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import HelpTip from "@/components/shared/HelpTip";
import DateField from "@/components/shared/DateField";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import Dialog from "@/components/ui/Dialog";
import Dropdown from "@/components/shared/Dropdown";
import RadioGroupField from "@/components/shared/RadioGroupField";
import { todayKey } from "@/constants/fieldValidation";
import useFormErrors from "@/components/shared/useFormErrors";
import { REVIEW_OUTCOMES, REVIEW_TYPES, emptyReview, isSpotReview, outcomeStyle, reviewPayload, reviewProblems, reviewTotals } from "@/constants/employeeReviewConfig";
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
export default function AddReviewDialog({ initialReview, prefill, existingReviews = [], joiningSalary = "", scheduledDate = "", onClose, onSave }) {
  const isEdit = Boolean(initialReview);
  /*
   * A cyclic review's date fills itself in: the date it was due (`prefill`), else the employee's
   * scheduled Next Review Date, else today - and the next one six months on from it. A spot review
   * is dated today, and the date is not asked.
   */
  const cyclicDate = prefill?.reviewDate || scheduledDate || todayKey();
  const withCyclicDates = (review, date) => ({ ...review, reviewDate: date, nextReviewDate: syncedNextReviewDate({ previousSource: "", nextSource: date, currentNext: "" }) });
  /*
   * A new review opens as a spot one, dated today. Opened for a review that was due (`prefill`,
   * Start Review / Record this review), it is that scheduled one - a cyclic review on its due date.
   */
  const [current, setCurrent] = useState(() => {
    if (initialReview) return { reviewType: "CYCLIC", ...initialReview };
    if (prefill?.reviewDate) return withCyclicDates({ ...emptyReview(), ...prefill, reviewType: "CYCLIC" }, cyclicDate);
    return { ...emptyReview(), reviewType: "SPOT", reviewDate: todayKey() };
  });
  const spot = isSpotReview(current);
  const fields = useFormErrors();

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
    fields.clear(field);
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
  // Switching the kind of review re-dates it the way that kind is dated.
  function changeType(reviewType) {
    fields.clearAll();
    setCurrent((existing) => (reviewType === "SPOT"
      ? { ...existing, reviewType, reviewDate: isEdit && isSpotReview(initialReview) ? initialReview.reviewDate : todayKey() }
      : withCyclicDates({ ...existing, reviewType }, isEdit && !isSpotReview(initialReview) ? initialReview.reviewDate : cyclicDate)));
  }

  function save() {
    if (!fields.check(reviewProblems(current))) return;
    onSave([reviewPayload(current)]);
  }

  /*
   * The employee's figures once this is saved, worked out the way the record works them out.
   *
   * The review being edited is already in `existingReviews`, so it is taken out before this form's
   * copy of it is put back - counting both would add its increment twice.
   */
  const others = isEdit ? existingReviews.filter((review) => review.key !== initialReview.key) : existingReviews;
  const after = reviewTotals([...others, current], joiningSalary);

  return <Dialog
    title={isEdit ? "Edit Review" : "Add Review"}
    description={spot ? "A spot review records how it went and a remark. It does not change the review schedule or the salary." : "Increment amounts here decide the employee's total increment and total salary."}
    size="lg"
    layer="dialogOverPanel"
    onClose={onClose}
    footer={<>
      <Button className="max-sm:flex-1" type="button" onClick={onClose}>Cancel</Button>
      <Button className="max-sm:flex-1" type="button" variant="primary" onClick={save}>Save</Button>
    </>}
  >
    <RadioGroupField className="mb-4" label="Review Type" helperText="Spot records a quick remark; Cyclic is the scheduled review that can change salary." required value={current.reviewType} onChange={changeType} options={REVIEW_TYPES} />
    {spot ? <div className="grid gap-4">
      <Dropdown
        mode="input"
        label="Review Outcome"
        helperText="Shine for good work, Shadow for work that fell short."
        required
        placeholder="Choose the outcome"
        sorted={false}
        menuZIndexClassName="z-[200]"
        value={current.outcome || ""}
        onChange={(value) => update("outcome", value)}
        options={REVIEW_OUTCOMES.map((outcome) => ({ label: outcome, value: outcome }))}
        error={fields.errors.outcome}
      />
      <TextAreaField label="Remarks" helperText="What happened and why, kept on the employee's review history." rows={4} value={current.remarks} onChange={(event) => update("remarks", event.target.value)} />
    </div> : <div className="grid gap-4 md:grid-cols-2">
      {/*
        * Any date, past or future.
        *
        * It was limited to today and earlier, on the reading that a review is something that has
        * happened. Two things were wrong with that. The studio records reviews it has scheduled as
        * well as ones it has held - that is the list it works from - and the Upcoming tab's own
        * "Record this review" hands over the date the review is *due*, which is by definition in
        * the future: the prefill arrived in a field that would not accept it back.
        */}
      <DateField label="Review Date" helperText="When the review was held or is due; it can be in the future." required value={current.reviewDate} onChange={(value) => update("reviewDate", value)} error={fields.errors.reviewDate} />
      {/* Beside the date because it is what the review *says*; the increment below is what the
          review then did about it. `sorted={false}` keeps the scale in its own order - alphabetically
          these read Average, Good, Poor, which is not a scale at all. */}
      <Dropdown
        mode="input"
        label="Review Outcome"
        helperText="Shine for good work, Shadow for work that fell short."
        placeholder="Not recorded"
        sorted={false}
        menuZIndexClassName="z-[200]"
        value={current.outcome || ""}
        onChange={(value) => update("outcome", value)}
        options={REVIEW_OUTCOMES.map((outcome) => ({ label: outcome, value: outcome }))}
      />
      {/* Not required: plenty of reviews are held without a figure, and demanding one meant typing
          a 0 that then counted as a real increment of zero in the employee's totals for ever. */}
      <TextField label="Increment Amount" helperText="The raise given at this review; it adds to the employee's total salary." type="number" inputMode="numeric" min="0" placeholder="Leave empty if none" value={current.incrementAmount} onChange={(event) => update("incrementAmount", event.target.value)} error={fields.errors.incrementAmount} />
      <DateField label="Next Review Date" helperText="When this employee should next be reviewed; it sets their schedule." value={current.nextReviewDate} onChange={(value) => update("nextReviewDate", value)} error={fields.errors.nextReviewDate} />
      <TextAreaField className="md:col-span-2" label="Remarks" helperText="What was discussed and agreed, kept on the employee's review history." rows={3} value={current.remarks} onChange={(event) => update("remarks", event.target.value)} />
    </div>}

    {fields.summary && <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{fields.summary}</p>}

    {/* What the employee's salary becomes once this is saved - joining salary plus every increment -
        so the figure the record will show is visible while the amount that changes it is typed. */}
    {!spot && <dl className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-3">
      {[["Joining Salary", formatAmount(joiningSalary), "The salary they joined on, from their employee record."], ["Total Increment", formatAmount(after.totalIncrement), "Every review increment added up, this one included."], ["Total Salary", formatAmount(after.totalSalary), "Joining salary plus all increments: what their salary becomes once this is saved."]].map(([label, value, help]) => <div key={label}>
        <dt className="font-medium text-slate-500">{label}<HelpTip text={help} /></dt>
        <dd className="mt-1 font-semibold text-slate-800">{value}</dd>
      </div>)}
    </dl>}
  </Dialog>;
}
