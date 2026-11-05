import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Add Review shows what the employee's salary becomes once the review is saved: the joining salary,
 * every increment, and the two added together - worked out by `reviewTotals`, the same function the
 * record's own totals use. Editing a review takes the saved copy out first, so its increment is not
 * counted twice.
 */

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const DIALOG = read("components", "employees", "AddReviewDialog.js");
const PANEL = read("components", "employees", "EmployeeFormPanel.js");
const CONFIG = read("constants", "employeeReviewConfig.js");

const reviewTotals = new Function(`
  const isSpotReview = (review) => review?.reviewType === "SPOT";
  ${CONFIG.slice(CONFIG.indexOf("export const sortReviews"), CONFIG.indexOf("export function reviewTotals")).replaceAll("export ", "")}
  ${CONFIG.slice(CONFIG.indexOf("export function reviewTotals"), CONFIG.indexOf("/**", CONFIG.indexOf("export function reviewTotals"))).replace("export ", "")}
  return reviewTotals;
`)();

test("total salary is the joining salary plus every increment", () => {
  const totals = reviewTotals([{ reviewDate: "2026-01-01", incrementAmount: "2000" }, { reviewDate: "2026-07-01", incrementAmount: "3000" }], "20000");
  assert.equal(totals.totalIncrement, 5000);
  assert.equal(totals.totalSalary, 25000);
});

test("a spot review is neither the salary nor the schedule", () => {
  const cyclic = { reviewDate: "2026-01-01", incrementAmount: "2000", nextReviewDate: "2026-07-01" };
  const totals = reviewTotals([cyclic, { reviewType: "SPOT", reviewDate: "2026-03-01", incrementAmount: "9000", nextReviewDate: "2026-04-01" }], "20000");
  assert.equal(totals.totalIncrement, 2000);
  assert.equal(totals.lastReviewDate, "2026-01-01");
  assert.equal(totals.nextReviewDate, "2026-07-01");
  // Spot reviews alone leave the employee as if never reviewed.
  assert.equal(reviewTotals([{ reviewType: "SPOT", reviewDate: "2026-03-01" }], "20000").totalSalary, 20000);
});

test("Add Review asks Spot or Cyclic: spot is outcome and remarks, cyclic is dated on its own", () => {
  assert.match(DIALOG, /<RadioGroupField className="mb-4" label="Review Type"(?: helperText="[^"]*")? required value=\{current\.reviewType\} onChange=\{changeType\} options=\{REVIEW_TYPES\} \/>/);
  assert.match(CONFIG, /if \(isSpotReview\(review\)\) return \{ outcome: review\.outcome \? "" : "Choose the review outcome\." \};/);
  assert.match(DIALOG, /const cyclicDate = prefill\?\.reviewDate \|\| scheduledDate \|\| todayKey\(\);/);
  assert.match(PANEL, /scheduledDate=\{form\.nextReviewDate\}/);
  // Saved as the type it is, a spot one with no increment and no next date.
  assert.match(CONFIG, /\.\.\.\(isSpotReview\(review\) \? \{ incrementAmount: null, nextReviewDate: null \} : \{\}\),/);
});

test("the dialog is given the joining salary and shows all three figures", () => {
  assert.match(PANEL, /<AddReviewDialog [^>]*joiningSalary=\{form\.joiningSalary\}/);
  assert.match(DIALOG, /const after = reviewTotals\(\[\.\.\.others, current\], joiningSalary\);/);
  assert.match(DIALOG, /\["Joining Salary", formatAmount\(joiningSalary\)(?:, "[^"]*")?\], \["Total Increment", formatAmount\(after\.totalIncrement\)(?:, "[^"]*")?\], \["Total Salary", formatAmount\(after\.totalSalary\)(?:, "[^"]*")?\]/);
});

test("an edited review is counted once, not twice", () => {
  assert.match(DIALOG, /const others = isEdit \? existingReviews\.filter\(\(review\) => review\.key !== initialReview\.key\) : existingReviews;/);
});
