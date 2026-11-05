import test from "node:test";
import assert from "node:assert/strict";
import { shootProgress, shootCompletionStatus, shootPlanStatus, projectCompletionStatus, projectCompletionLabel, projectProgressPercent } from "../src/lib/preProductionProgress.js";

const base = {
  // The shoot's own day, which every shoot is counted on, is `subEventDate` on the board's row.
  subEventDate: "2026-10-02", eventStartTime: "10:00", eventEndTime: "18:00", reportingTime: "09:00",
  locationAddress: "Hall", locationLink: "https://maps.example/x",
};
const quaQuaDone = {
  introCall: "Completed", gettingDressesImages: true, googleReview: true,
};

test("a shoot is Yet to Start until a Pre Production detail is filled - the sale's event times do not count", () => {
  assert.equal(shootCompletionStatus({ product: "QQ" }), "Yet to Start");
  assert.equal(shootCompletionStatus({ product: "QQ", eventStartTime: "10:00", eventEndTime: "18:00" }), "Yet to Start", "the times come with the sale");
  assert.equal(shootCompletionStatus({ product: "QQ", eventStartTime: "10:00", reportingTime: "09:00" }), "Work in Progress", "one detail filled here starts it");
});

test("only the mandatory answers are counted: the shared details alone are Planned", () => {
  /*
   * The percentage is of the answers a shoot is **required** to give - the event's times, the
   * reporting time, its own date, and where it is (the venue, or the branch for an
   * indoor shoot).
   * The vertical checklist, the Location Link, the accommodation and the concepts are work to do
   * rather than answers the shoot is held short for: they were counted, so a shoot with every
   * mandatory answer read sixty-something per cent and never reached Planned until a dozen chased
   * questions had been ticked.
   */
  assert.equal(shootCompletionStatus({ product: "QQ", ...base }), "Planned");
  assert.equal(shootPlanStatus({ product: "QQ", ...base }), "Planned");
  // The checklist does not hold it short, and the shoot reads Planned with it untouched or part done.
  assert.equal(shootCompletionStatus({ product: "QQ", ...base, ...quaQuaDone }), "Planned");
  assert.equal(shootCompletionStatus({ product: "QQ", ...base, ...quaQuaDone, introCall: "Pending" }), "Planned");
  // Five answers for an outdoor shoot, whatever its vertical asks beyond them.
  assert.deepEqual(shootProgress({ product: "Dum Dum", ...base }), { filled: 5, total: 5, pending: 0, percent: 100 });
  assert.equal(shootProgress({ product: "Dum Dum", ...base, subEventDate: null }).pending, 1, "a shoot with no day is not planned");
  assert.equal(shootProgress({ product: "Dum Dum", eventScheduleMeeting: true }).total, 5, "a meeting being scheduled adds nothing to count");
});

test("the checklist is still work: a shoot with only a chased question answered has been started", () => {
  // It does not count toward the percentage, but somebody who made the intro call has begun - the
  // board saying Yet to Start would be telling them their afternoon did not happen.
  assert.equal(shootCompletionStatus({ product: "QQ", introCall: "Completed" }), "Work in Progress");
  assert.equal(shootCompletionStatus({ product: "QQ", gettingDressesImages: true }), "Work in Progress");
  // Each vertical's own questions: a Site Visit is Dum Dum's, and says nothing about a Qua Qua shoot.
  assert.equal(shootCompletionStatus({ product: "Dum Dum", siteVisit: true }), "Work in Progress");
  assert.equal(shootCompletionStatus({ product: "QQ", siteVisit: true }), "Yet to Start");
  assert.equal(shootProgress({ product: "QQ", introCall: "Completed" }).percent, 0, "and nothing of the percentage");
});

test("a vertical with no checklist is complete on the shared details", () => {
  assert.equal(shootPlanStatus({ product: "Corp", ...base }), "Planned");
});

test("a shoot's pre production status is its own details', whatever Production says", () => {
  assert.equal(shootCompletionStatus({ productionShoot: "COMPLETED" }), "Yet to Start");
});

test("a status set by hand - WCR, Hold, Rejected - is what the shoot shows; its details still say how far it is", () => {
  const planned = { product: "Corp", ...base };
  assert.equal(shootCompletionStatus({ ...planned, shootStatus: "HOLD" }), "Hold");
  assert.equal(shootCompletionStatus({ ...planned, shootStatus: "WCR" }), "WCR");
  assert.equal(shootCompletionStatus({ ...planned, shootStatus: "REJECTED" }), "Rejected");
  assert.equal(shootPlanStatus({ ...planned, shootStatus: "HOLD" }), "Planned");
});

test("the project's pre production status is its shoots' details: Yet to Start, WIP with its percentage, Planned", () => {
  const planned = { product: "Corp", ...base };
  const half = { product: "Corp", eventStartTime: "10:00", eventEndTime: "18:00", reportingTime: "09:00" };
  assert.equal(projectCompletionStatus([{ product: "Corp" }, { product: "Corp" }]), "Yet to Start");
  // Every shoot Yet to Start - the sale's times alone - is a project Yet to Start; any one worked on moves it.
  const sold = { product: "Corp", eventStartTime: "10:00", eventEndTime: "18:00" };
  assert.equal(projectCompletionStatus([sold, sold]), "Yet to Start");
  assert.equal(projectCompletionStatus([sold, half]), "Work in Progress");
  assert.equal(projectCompletionStatus([planned, planned]), "Planned");
  assert.equal(projectCompletionStatus([planned, { product: "Corp" }]), "Work in Progress");
  // The average of the shoots' own progress.
  assert.equal(projectProgressPercent([planned, { product: "Corp" }]), 50);
  assert.equal(projectCompletionLabel([planned, { product: "Corp" }]), "Work in Progress (50%)");
  assert.equal(projectProgressPercent([planned, half]), Math.round((100 + shootProgress(half).percent) / 2));
  assert.equal(shootProgress(half).percent, 60, "three of its five mandatory answers");
  // WCR and Rejected set by hand do not move the project's status - only Hold does.
  assert.equal(projectCompletionStatus([{ ...planned, shootStatus: "REJECTED" }, { ...planned, shootStatus: "WCR" }]), "Planned");
  assert.equal(projectCompletionStatus([{ ...planned, shootStatus: "HOLD" }, planned]), "Hold");
  assert.equal(projectCompletionStatus([]), "Yet to Start");
});

test("the status saved with the form: nothing when unchanged, refused without what it needs", async () => {
  const { shootStatusChange, shootStatusValue, AUTO } = await import("../src/lib/preProductionProgress.js");

  assert.equal(shootStatusChange({}, shootStatusValue({})).change, null);
  assert.match(shootStatusChange({}, { choice: "HOLD", remarks: "" }).problem, /remarks/);
  assert.match(shootStatusChange({}, { choice: "WCR", remarks: "" }).problem, /Next Followup Date/);
  assert.deepEqual(shootStatusChange({}, { choice: "WCR", remarks: "", followupDate: "2026-12-01" }).change, { status: "WCR", remarks: null, followupDate: "2026-12-01" });
  assert.deepEqual(shootStatusChange({ shootStatus: "HOLD", shootStatusRemarks: "x" }, { choice: AUTO }).change, { status: null, remarks: null, followupDate: null });
});

test("one shoot on Hold holds the project's pre production; Rejected stays the shoot's; the project's own status changes nothing", () => {
  assert.equal(projectCompletionStatus([{ shootStatus: "HOLD" }, {}]), "Hold");
  assert.equal(projectCompletionLabel([{ shootStatus: "HOLD" }, {}]), "Hold");
  assert.notEqual(projectCompletionStatus([{ shootStatus: "REJECTED" }, {}]), "Hold");
  // The project's own status is the project's alone: the department reads its shoots, whatever it is.
  assert.equal(projectCompletionStatus([{ shootStatus: "HOLD", projectStatus: "Delivered" }]), "Hold");
  assert.equal(projectCompletionStatus([{ projectStatus: "On Hold" }]), "Yet to Start");
  assert.equal(projectCompletionStatus([{ projectStatus: "Cancelled & Refunded" }]), "Yet to Start");
  assert.equal(shootCompletionStatus({ shootStatus: "HOLD", projectStatus: "Delivered" }), "Hold");
});

test("Event Timing carries the shoot's own date, editable, sent as the shoot's - null when cleared", async () => {
  const fs = await import("node:fs");
  const config = fs.readFileSync(new URL("../src/constants/formPanelConfig.js", import.meta.url), "utf8");
  assert.match(config, /\{ name: "shootDate", label: "Shoot Date", (?:helperText: "[^"]*", )?type: "date", required: true \},\n\s+\{ name: "eventStartTime"/);
  const panel = fs.readFileSync(new URL("../src/components/project-management/PreProductionFormPanel.js", import.meta.url), "utf8");
  assert.match(panel, /shootDate: dateInput\(row\.subEventDate\),/);
  assert.match(panel, /shootDate: values\.shootDate \|\| null,/);
});
