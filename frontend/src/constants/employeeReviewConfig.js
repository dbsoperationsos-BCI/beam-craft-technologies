/**
 * The salary review an employee picks up at each appraisal, and the columns the list of them shows.
 *
 * The employee's Total Increment, Total Salary, Last Review Date and Next Review Date are all worked
 * out from these rows by the server rather than typed in, which is why none of them appear here.
 */

/**
 * The two kinds of review. **Cyclic** is the regular one on the employee's schedule: it may award
 * an increment and it sets the next review date. **Spot** is an outcome and a remark recorded
 * between them - it touches neither the schedule nor the salary.
 */
export const REVIEW_TYPES = [
  { value: "SPOT", label: "Spot Review" },
  { value: "CYCLIC", label: "Cyclic Review" },
];
export const isSpotReview = (review) => review?.reviewType === "SPOT";

export const emptyReview = () => ({
  reviewType: "CYCLIC",
  reviewDate: "",
  outcome: "",
  incrementAmount: "",
  nextReviewDate: "",
  remarks: "",
});

/**
 * How a review went: **Shine** or **Shadow**.
 *
 * The studio's own words, and they are the mark and its appearance at once - a review that shone
 * lifts its row and one that cast a shadow shades it, so the list is read down without reading a
 * word. Naming the field for what the reader sees is the point: "Good / Average / Poor" would have
 * been a second vocabulary for the same two states.
 *
 * Two marks, not three. A review nobody judged is left unmarked, and that is the middle case - it
 * carries neither shine nor shadow, which is honest in a way a third "Average" option would not be:
 * "nothing to report" is not a grade somebody awarded.
 *
 * Ordered best-first on purpose - `sorted={false}` in the picker - because the alphabet would read
 * this scale out backwards.
 */
export const REVIEW_OUTCOMES = ["Shine", "Shadow"];

/**
 * What each mark looks like, which is what it is named after.
 *
 * **Shine** lifts its row: a warm light tint and a green edge, the row reading brighter than the
 * ones around it. **Shadow** shades it: a rose tint and a dark inner edge, so the row sits lower
 * than the rest. The two are told apart by lightness as well as by hue, which is what makes the
 * list readable to somebody who cannot separate red from green.
 *
 * Deliberately faint. This is a background behind text that still has to be read, and a
 * full-strength colour across a table row is a warning banner rather than a mark on a record.
 *
 * A review nobody judged gets neither, and that is the whole reason there is no third option: an
 * unmarked row is the middle case, and it says "nobody said" rather than inventing an opinion.
 */
export const REVIEW_OUTCOME_STYLES = {
  /*
   * `edge` goes on the row's **first cell**, not on the row.
   *
   * A `<tr>` under `border-collapse: collapse` - which Tailwind's preflight sets - drops a
   * `box-shadow` silently: the class is generated, the row renders, and no stripe appears. A border
   * on the leading cell is drawn by the table itself and always shows.
   */
  Shine: {
    row: "bg-emerald-50/70",
    edge: "border-l-4 border-l-emerald-500",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700",
    card: "border-l-4 border-l-emerald-500 border-emerald-200 bg-emerald-50/50 shadow-[0_1px_6px_0_#10b98133]",
  },
  Shadow: {
    row: "bg-rose-50/70",
    edge: "border-l-4 border-l-rose-700",
    chip: "border-rose-200 bg-rose-100 text-rose-800",
    card: "border-l-4 border-l-rose-700 border-rose-200 bg-rose-50/60 shadow-[0_1px_6px_0_#9f123933]",
  },
};

/** The styles for one review, or empty ones where nobody said how it went. */
export const outcomeStyle = (outcome) => REVIEW_OUTCOME_STYLES[outcome] || { row: "", edge: "", chip: "border-slate-200 bg-slate-50 text-slate-500", card: "border-slate-200 bg-white" };

/**
 * The dot beside a review's mark in the table, keyed by the mark itself.
 *
 * `TableCellValue`'s `status` type looks the value up here, so these are keyed by what is stored —
 * `Shine`, `Shadow` — rather than by a label. A review nobody marked falls through to the shared
 * slate default and reads as a dash, which is the honest answer: nobody said.
 */
export const reviewStatusStyles = {
  Shine: "bg-emerald-500",
  Shadow: "bg-rose-600",
};

/**
 * The review table's columns, in the shape every other module table uses:
 * `[key, header, type, size, minSize]`.
 *
 * `outcome` is a `status`, which is what puts the mark's colour in the cell; `incrementAmount` is an
 * `amount`, so a review held without a figure reads as a dash rather than as 0.
 */
export const reviewTableFields = [
  ["reviewDate", "Review Date", "date", 150, 130],
  ["outcome", "Outcome", "status", 130, 110],
  ["incrementAmount", "Increment Amount", "amount", 170, 140],
  ["nextReviewDate", "Next Review Date", "date", 160, 140],
  ["remarks", "Remarks", undefined, 240, 160],
];

export const reviewListColumns = [
  ["reviewDate", "Review Date", "date"],
  ["outcome", "Outcome"],
  ["incrementAmount", "Increment Amount", "amount"],
  ["nextReviewDate", "Next Review Date", "date"],
  ["remarks", "Remarks"],
];

/**
 * One review as the server takes it: a blank amount as `null`, not as `0`.
 *
 * The distinction is the whole reason the field was made optional. `Number("")` is 0, so the
 * obvious conversion would quietly turn every unanswered box into an increment of zero — a real
 * figure, indistinguishable afterwards from a review that genuinely awarded nothing.
 */
export function reviewPayload({ key, ...review }) {
  const increment = String(review.incrementAmount ?? "").trim();
  // Trimmed, not just checked for blank: a remark typed with a leading or trailing space carried
  // it into the record and, now that the timeline sizes a card to its content, into the card's own
  // height - a stray space at the end being why one review's box was taller than every other's.
  const remarks = String(review.remarks ?? "").trim();
  return {
    ...review,
    incrementAmount: increment === "" ? null : Number(increment),
    outcome: review.outcome || null,
    nextReviewDate: review.nextReviewDate || null,
    remarks: remarks === "" ? null : remarks,
    reviewType: review.reviewType || "CYCLIC",
    // A spot review awards nothing and schedules nothing.
    ...(isSpotReview(review) ? { incrementAmount: null, nextReviewDate: null } : {}),
  };
}

/** Reviews are only meaningful in date order, whatever order they were entered in. */
export const sortReviews = (reviews) => [...reviews].sort((first, second) => new Date(first.reviewDate) - new Date(second.reviewDate));

export const totalIncrement = (reviews) => reviews.reduce((sum, review) => sum + Number(review.incrementAmount || 0), 0);

/** What the server will store, so the panel can show the same figures before it saves. */
export function reviewTotals(allReviews, joiningSalary) {
  // Spot reviews are neither the schedule nor the salary: only cyclic ones count here.
  const reviews = allReviews.filter((review) => !isSpotReview(review));
  if (!reviews.length) return { totalIncrement: null, totalSalary: joiningSalary === "" ? null : Number(joiningSalary), lastReviewDate: "", nextReviewDate: "" };
  const sorted = sortReviews(reviews);
  const latest = sorted[sorted.length - 1];
  const increment = totalIncrement(reviews);
  return {
    totalIncrement: increment,
    totalSalary: joiningSalary === "" || joiningSalary === null || joiningSalary === undefined ? increment : Number(joiningSalary) + increment,
    lastReviewDate: latest.reviewDate,
    nextReviewDate: latest.nextReviewDate || "",
  };
}

/**
 * What a review must have, which is its date and nothing else - each problem keyed by its field.
 *
 * The increment used to be required, and that was wrong twice over: reviews are held without one -
 * a confirmation, a year with no raises, a conversation minuted before the figure is agreed - and
 * requiring it meant typing a 0, which is a real increment of zero and counts as one in the
 * employee's totals for ever afterwards. Left empty it is simply not answered. A figure that *is*
 * given still has to be a sensible one.
 */
export function reviewProblems(review) {
  const increment = String(review.incrementAmount ?? "").trim();
  // A spot review is its outcome; the rest of it is not asked.
  if (isSpotReview(review)) return { outcome: review.outcome ? "" : "Choose the review outcome." };
  return {
    reviewDate: review.reviewDate ? "" : "Enter the review date.",
    incrementAmount: increment !== "" && !(Number(increment) >= 0) ? "Enter a valid increment amount, or leave it empty." : "",
    nextReviewDate: review.reviewDate && review.nextReviewDate && new Date(review.nextReviewDate) < new Date(review.reviewDate)
      ? "The next review date cannot fall before the review date." : "",
  };
}

/** The first of those problems, or "" when the review can be saved. */
export function validateReview(review) {
  return Object.values(reviewProblems(review)).find(Boolean) || "";
}
