"use client";

import Button from "@/components/shared/Button";
import HelpTip from "@/components/shared/HelpTip";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { outcomeStyle } from "@/constants/employeeReviewConfig";
import { clientFeedbackCounts, reviewTimeline, withClientFeedback } from "@/lib/employeeReviewTimeline.mjs";
import { today } from "@/lib/employeeReviewSchedule.mjs";
import { OutcomeChip } from "./AddReviewDialog";

export const formatMoney = (value) => value === null || value === undefined || value === "" ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(value));
export const formatListDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
};

/*
 * Where a step sits. Below `md` there is one column with the line down its left edge, so every card
 * sits to the right of it; from `md` the line runs down the middle, Shine to its right, Shadow to its
 * left, and anything on the line itself - joining, an unmarked review, the next review - centred
 * over it.
 */
const PLACE = {
  right: "pl-10 md:ml-auto md:w-1/2 md:pl-8",
  left: "pl-10 md:mr-auto md:w-1/2 md:pl-0 md:pr-8",
  center: "pl-10 md:mx-auto md:w-80 md:pl-0",
};
const DOT = {
  right: "left-4 md:left-0",
  left: "left-4 md:left-auto md:right-0 md:translate-x-1/2",
  center: "left-4 md:left-1/2",
};
/*
 * Capped to the joining and next-review boxes' own width rather than left to fill the half-column
 * `PLACE` gives it, which on anything wider than a tablet was most of the page. `left` also gets
 * `md:ml-auto` so the box still hugs the centre line from its own side, the way `right`'s default
 * flush-left position already does - a fixed width alone would have left it stranded at the far
 * edge, away from the dot naming which side it is on.
 */
const CARD_WIDTH = { right: "md:w-80", left: "md:ml-auto md:w-80", center: "" };

function Step({ side, dotClassName, children }) {
  return <li className={`relative ${PLACE[side]}`}>
    {/* Hidden from a screen reader: the list is read in order, and the side is only a picture of the
        outcome the card already says in words. */}
    <span aria-hidden="true" className={`absolute top-4 h-3 w-3 -translate-x-1/2 rounded-full ring-4 ring-white ${DOT[side]} ${dotClassName}`} />
    {children}
  </li>;
}

/**
 * One review, at the size the joining and next-review boxes already set: the date and outcome, then
 * what it awarded and the remark behind it, always shown - a long remark wraps inside the card.
 */
function ReviewCard({ review, side, increment, salary, onEdit, onDelete }) {
  return <div className={`relative rounded-lg border px-4 py-3 text-sm ${CARD_WIDTH[side]} ${outcomeStyle(review.outcome).card}`}>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="font-semibold text-slate-800">{formatListDate(review.reviewDate)}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5"><OutcomeChip outcome={review.outcome} />{review.reviewType === "SPOT" && <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">Spot</span>}</div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <OptionsMenu
          ariaLabel={`Actions for the review dated ${formatListDate(review.reviewDate)}`}
          items={[
            { label: "Edit", onSelect: () => onEdit(review) },
            { label: "Delete", tone: "danger", onSelect: () => onDelete(review) },
          ]}
          // Above the form panel the timeline sits inside, which stacks at 110.
          menuZIndexClassName="z-[140]"
        />
      </div>
    </div>
    <p className="mt-2 text-slate-700">
        {increment === null ? <span className="text-slate-500">No increment recorded</span> : <span className="font-medium">+{formatMoney(increment)}</span>}
        <span className="text-slate-500"> → </span>
        <span className="font-semibold text-slate-800">{formatMoney(salary)}</span>
    </p>
    {review.remarks && <p className="mt-2 whitespace-pre-line break-words text-xs text-slate-600">{review.remarks}</p>}
  </div>;
}

/**
 * A client's Appreciation or Not Satisfied from a Production Completion Feedback, as a Shine or a
 * Shadow card on the timeline. Read-only - it is the client's word, kept on the feedback, and changes
 * nothing about the salary - so it carries no menu, only where it came from.
 */
function ClientFeedbackCard({ entry, side }) {
  return <div className={`relative rounded-lg border border-dashed px-4 py-3 text-sm ${CARD_WIDTH[side]} ${outcomeStyle(entry.outcome).card}`}>
    <p className="font-semibold text-slate-800">{formatListDate(entry.givenOn)}</p>
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <OutcomeChip outcome={entry.outcome} />
      <span className="text-xs font-medium text-slate-600">Client feedback</span>
    </div>
    {/* The project and Feedback ID only for a reader who may read feedback; otherwise just what happened. */}
    {entry.feedbackCode
      ? <>
        <p className="mt-2 break-words text-slate-700">{[entry.projectName, entry.eventId && `(${entry.eventId})`].filter(Boolean).join(" ")}</p>
        <p className="text-xs text-slate-500">{entry.outcome === "Shine" ? "Appreciated" : "Not satisfied with"} in {entry.feedbackCode}</p>
      </>
      : <p className="mt-2 text-xs text-slate-500">{entry.outcome === "Shine" ? "Appreciated" : "Not satisfied with"} in a client&rsquo;s Production Completion Feedback</p>}
  </div>;
}

/**
 * An employee's reviews as a timeline down the page: joining salary at the top, each review in date
 * order with what it awarded and the salary it left them on, and the next review centred at the
 * foot with **Mark review** to record it. **Add Review** sits at the top right.
 *
 * The client's word sits on it too (`clientFeedback`): a client's Appreciation in a Production
 * Completion Feedback is a **Shine**, Not Satisfied a **Shadow**, each a card on its side in date order,
 * marked Client feedback and counted at the top. They never move the salary.
 *
 * Replaces the Upcoming / Past tabs and the review table: the running salary at every step answers
 * what the totals box used to, and the last step's figure is the Total Salary.
 */
export default function EmployeeReviewTimeline({ reviews = [], clientFeedback = [], joiningDate, joiningSalary, upcoming, onAdd, onEdit, onDelete, onMark }) {
  const steps = withClientFeedback(reviewTimeline(reviews, joiningSalary), clientFeedback);
  const counts = clientFeedbackCounts(clientFeedback);

  return <div>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-semibold text-slate-800">Salary Timeline</h3>
        <p className="text-sm text-slate-600">Shine on the right, Shadow on the left.</p>
        {clientFeedback.length > 0 && <p className="text-sm text-slate-600">Client feedback: {counts.shine} Shine · {counts.shadow} Shadow</p>}
      </div>
      <Button type="button" variant="primary" onClick={onAdd} className="max-sm:w-full">+ Add Review</Button>
    </div>

    <ol aria-label="Salary timeline" className="relative space-y-5 before:absolute before:bottom-0 before:left-4 before:top-0 before:w-px before:bg-slate-200 md:before:left-1/2">
      <Step side="center" dotClassName="bg-blue-600">
        <div className="relative rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-center text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-blue-700">Joining · {formatListDate(joiningDate)}<HelpTip text="Their date of joining and joining salary, from Employment Details; every review below adds to it." /></p>
          <p className="mt-1 text-base font-semibold text-slate-800">{formatMoney(joiningSalary)}</p>
        </div>
      </Step>

      {steps.map((step) => {
        const dot = step.side === "right" ? "bg-emerald-500" : step.side === "left" ? "bg-rose-700" : "bg-slate-400";
        return step.type === "client"
          ? <Step key={`client-${step.entry.id}`} side={step.side} dotClassName={dot}>
            <ClientFeedbackCard entry={step.entry} side={step.side} />
          </Step>
          : <Step key={step.review.key || step.review.reviewDate} side={step.side} dotClassName={dot}>
            <ReviewCard review={step.review} side={step.side} increment={step.increment} salary={step.salary} onEdit={onEdit} onDelete={onDelete} />
          </Step>;
      })}

      {/*
        * The border alone says the date has gone by - `overdue` is strictly before today, and is
        * the one thing this card needed a sentence for before. **Mark review** is offered from a
        * different, wider line: on or after the due date, "during and after" rather than only
        * once it is overdue, so the day itself is not the one day neither the border nor the
        * button says anything. Before that day, the schedule is a date and nothing has happened
        * yet to record - a review wanted early goes through **+ Add Review** above instead, the
        * same way any review not on the schedule already does.
        */}
      <Step side="center" dotClassName={upcoming?.overdue ? "bg-amber-500" : "border-2 border-slate-400 bg-white"}>
        {upcoming
          ? <div className={`relative rounded-lg border px-4 py-3 text-center text-sm ${upcoming.overdue ? "border-amber-300 bg-amber-50" : "border-dashed border-slate-300 bg-white"}`}>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Next review<HelpTip text="When their next salary review is due, taken from the latest review or, before any, from Next Review Date." /></p>
            <p className="mt-1 font-semibold text-slate-800">{formatListDate(upcoming.dueOn)}</p>
            {upcoming.dueOn <= today() && <Button type="button" size="sm" className="mt-3" onClick={onMark}>Mark review</Button>}
          </div>
          : <p className="relative rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-center text-sm text-slate-500">No review is scheduled. Set a Next Review Date in Personal Details.</p>}
      </Step>
    </ol>
  </div>;
}
