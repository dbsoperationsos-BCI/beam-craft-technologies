import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { reviewSide, reviewTimeline } from "../src/lib/employeeReviewTimeline.mjs";

/*
 * An employee's Reviews page is a timeline: the joining salary at the top, each review oldest first
 * with the salary it left them on - Shine on the right, Shadow on the left, unmarked on the line -
 * and the next review centred at the foot with Mark review. Add Review sits at the top right.
 */

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const TIMELINE = read("components", "employees", "EmployeeReviewTimeline.js");
const PANEL = read("components", "employees", "EmployeeFormPanel.js");

test("Shine is drawn on the right, Shadow on the left, and an unmarked review on the line", () => {
  assert.equal(reviewSide("Shine"), "right");
  assert.equal(reviewSide("Shadow"), "left");
  assert.equal(reviewSide(null), "center");
  assert.equal(reviewSide(""), "center");
});

test("reviews run oldest first, each carrying the salary it left the employee on", () => {
  const steps = reviewTimeline([
    { key: "b", reviewDate: "2026-01-01", incrementAmount: "3000", outcome: "Shine" },
    { key: "a", reviewDate: "2025-07-01", incrementAmount: "2000", outcome: "Shadow" },
    { key: "c", reviewDate: "2026-07-01", incrementAmount: "", outcome: null },
  ], "20000");
  assert.deepEqual(steps.map((step) => step.review.key), ["a", "b", "c"]);
  assert.deepEqual(steps.map((step) => step.side), ["left", "right", "center"]);
  assert.deepEqual(steps.map((step) => step.salary), [22000, 25000, 25000], "a review with no figure leaves the salary where it was");
  assert.equal(steps[2].increment, null);
});

test("a Shadow review's amount is still an increment", () => {
  const [step] = reviewTimeline([{ reviewDate: "2026-01-01", incrementAmount: "500", outcome: "Shadow" }], "1000");
  assert.equal(step.salary, 1500);
});

test("with no joining salary recorded the running figure counts the increments alone", () => {
  const steps = reviewTimeline([{ reviewDate: "2026-01-01", incrementAmount: "500" }], "");
  assert.equal(steps[0].salary, 500);
});

test("the page is the timeline: Add Review at the top right, the next review centred with Mark review", () => {
  assert.match(PANEL, /<EmployeeReviewTimeline\b/);
  assert.match(PANEL, /onMark=\{\(\) => setReviewDialog\(\{ review: null, prefill: \{ reviewDate: upcoming\.dueOn \} \}\)\}/);
  assert.doesNotMatch(PANEL, /EmployeeReviewList|reviewTab/);
  assert.match(TIMELINE, /justify-between[^"]*"[\s\S]*?\+ Add Review<\/Button>/);
  const foot = TIMELINE.slice(TIMELINE.lastIndexOf("<Step side=\"center\""));
  assert.match(foot, /Next review/);
  assert.match(foot, />Mark review<\/Button>/);
  assert.equal(fs.existsSync(path.join(import.meta.dirname, "..", "src", "components", "employees", "EmployeeReviewList.js")), false);
});

test("the timeline is an ordered list, and the dots are hidden from a screen reader", () => {
  assert.match(TIMELINE, /<ol aria-label="Salary timeline"/);
  assert.match(TIMELINE, /<span aria-hidden="true" className=\{`absolute top-4/);
});

test("a review card is always open: what it awarded and the remark are shown, with no Show details", () => {
  const TIMELINE = fs.readFileSync(path.join(process.cwd(), "src", "components", "employees", "EmployeeReviewTimeline.js"), "utf8");
  assert.doesNotMatch(TIMELINE, /Show details|Hide details|setExpanded|expanded &&/);
  assert.match(TIMELINE, /<span className="font-semibold text-slate-800">\{formatMoney\(salary\)\}<\/span>/);
  assert.match(TIMELINE, /\{review\.remarks && <p className="mt-2 whitespace-pre-line break-words/);
});
