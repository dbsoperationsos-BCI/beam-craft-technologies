/**
 * An employee's salary history as the steps of a timeline: the reviews oldest first, each with the
 * side it is drawn on and the salary it left the employee on.
 *
 * **Shine** sits on the right and **Shadow** on the left; a review nobody marked sits on the line
 * itself, because it is neither. The side is the outcome and nothing else - an amount is always an
 * increment, and a Shadow review awarding one still raises the salary.
 *
 * The running salary starts from the joining salary, or from nothing where none is recorded, which
 * is how `reviewTotals` counts it - so the last step's figure is the Total Salary the record shows.
 * A review with no figure leaves the salary where it was.
 */

const SIDES = { Shine: "right", Shadow: "left" };

export const reviewSide = (outcome) => SIDES[outcome] || "center";

const amountOf = (value) => (value === null || value === undefined || String(value).trim() === "" ? null : Number(value));

export function reviewTimeline(reviews = [], joiningSalary = "") {
  let salary = amountOf(joiningSalary) ?? 0;
  return [...reviews]
    .sort((first, second) => String(first?.reviewDate ?? "").localeCompare(String(second?.reviewDate ?? "")))
    .map((review) => {
      const increment = amountOf(review.incrementAmount);
      if (increment !== null) salary += increment;
      return { review, side: reviewSide(review.outcome), increment, salary };
    });
}

/**
 * The timeline's steps with the client's feedback woven in by date: each salary review step as
 * `{ type: "review", ...step }`, and each client mention (`clientFeedback` - an Appreciation is a
 * Shine, Not Satisfied a Shadow) as `{ type: "client", entry, side }` on its outcome's side. A mention
 * never moves the salary, so the review steps keep the figures `reviewTimeline` gave them.
 */
export function withClientFeedback(steps = [], clientFeedback = []) {
  // Compared as moments, not as text: a review is a date, a mention a timestamp.
  const time = (value) => { const at = new Date(value ?? "").getTime(); return Number.isNaN(at) ? 0 : at; };
  const dated = [
    ...steps.map((step) => ({ type: "review", ...step, on: time(step.review?.reviewDate) })),
    ...clientFeedback.map((entry) => ({ type: "client", entry, side: reviewSide(entry.outcome), on: time(entry.givenOn) })),
  ];
  return dated.sort((first, second) => first.on - second.on);
}

/** How many Shines and Shadows the client feedback holds. */
export function clientFeedbackCounts(clientFeedback = []) {
  return {
    shine: clientFeedback.filter((entry) => entry.outcome === "Shine").length,
    shadow: clientFeedback.filter((entry) => entry.outcome === "Shadow").length,
  };
}
