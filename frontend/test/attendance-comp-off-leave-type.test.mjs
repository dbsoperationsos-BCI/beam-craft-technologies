import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { RAISE_LEAVE_TYPE_OPTIONS, RAISE_REQUEST_TYPES, LEAVE_TYPE_OPTIONS, formTypeFields, requestTypeOf } from "../src/constants/attendanceRequestConfig.js";
import { requestActionItems } from "../src/lib/attendanceRequestStatus.mjs";

/*
 * Raise Request: Comp-off is a Leave Type now - Leave -> Comp-Off - beside Casual Leave and Loss of Pay,
 * and no longer a Request Type of its own. It is still sent and stored as COMP_OFF, so every rule and
 * every request already raised reads it as before. A weekly off or holiday worked is a Comp-Off Credit,
 * raised by attendance and decided by the approvers - never edited by the person it is about.
 */

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");

test("Comp-off is not a Request Type, and is a Leave Type beside CL and LOP", () => {
  assert.deepEqual(RAISE_REQUEST_TYPES.map((option) => option.value), ["LEAVE", "PERMISSION", "INCORRECT_LOGIN"]);
  assert.deepEqual(RAISE_LEAVE_TYPE_OPTIONS.map((option) => option.label), ["Casual Leave (CL)", "Loss of Pay (LOP)", "Comp-Off"]);
  // The quick dialog's leave types are untouched: it has no worked-day picker, so it offers no Comp-Off.
  assert.deepEqual(LEAVE_TYPE_OPTIONS.map((option) => option.value), ["CL", "LOP"]);
});

test("Leave with Comp-Off chosen is a comp-off; CL and LOP stay leaves", () => {
  assert.equal(requestTypeOf({ type: "LEAVE", leaveType: "COMP_OFF" }), "COMP_OFF");
  assert.equal(requestTypeOf({ type: "LEAVE", leaveType: "CL" }), "LEAVE");
  assert.equal(requestTypeOf({ type: "LEAVE", leaveType: "LOP" }), "LEAVE");
  assert.equal(requestTypeOf({ type: "PERMISSION", leaveType: "" }), "PERMISSION");
  assert.equal(requestTypeOf({ type: "INCORRECT_LOGIN" }), "INCORRECT_LOGIN");
});

test("a comp-off raised before opens again as Leave -> Comp-Off; every other kind opens as it was", () => {
  assert.deepEqual(formTypeFields("COMP_OFF", ""), { type: "LEAVE", leaveType: "COMP_OFF" });
  assert.deepEqual(formTypeFields("LEAVE", "LOP"), { type: "LEAVE", leaveType: "LOP" });
  assert.deepEqual(formTypeFields("PERMISSION", undefined), { type: "PERMISSION", leaveType: "" });
});

test("the form sends a comp-off as COMP_OFF, with its day worked and no leave type", () => {
  const PANEL = read("components", "hrm", "AttendanceRequestFormPanel.js");
  assert.match(PANEL, /const type = requestTypeOf\(values\);/);
  // Sent through `send`, which hands it to `onSubmit` and asks about a request already on that day.
  assert.match(PANEL, /send\(requestPayload\(type, values\)\)/);
  assert.match(PANEL, /return Promise\.resolve\(onSubmit\(payload\)\)/);
  const DIALOG = read("components", "hrm", "AttendanceRequestDialog.js");
  assert.match(DIALOG, /workedDate: isCompOff \? form\.workedDate : null,/);
  assert.match(DIALOG, /leaveType: action === "LEAVE" \? form\.leaveType : null,/);
});

test("a credit offers its approvers Approve and Reject but no Send back, and its employee only View", () => {
  const credit = { type: "COMP_OFF_CREDIT", status: "PENDING", canDecide: true };
  const noop = () => {};
  const handlers = { onView: noop, onEdit: noop, onRevert: noop, onDelete: noop, onDecide: noop, onSendBack: noop };
  assert.deepEqual(requestActionItems("approvals", credit, handlers).map((item) => item.label), ["Approve", "Reject"]);
  assert.deepEqual(requestActionItems("own", credit, handlers).map((item) => item.label), ["View"]);
  // A comp-off leave is the raiser's to change, as before.
  assert.deepEqual(requestActionItems("own", { type: "COMP_OFF", status: "PENDING" }, handlers).map((item) => item.label), ["View", "Edit", "Revert back", "Delete"]);
});

test("credits are listed with the comp-offs, and their details show the day, the hours and the credit", async () => {
  const { requestViewTypes, requestTypeLabel, attendanceRequestForInfo, attendanceRequestSections } = await import("../src/components/hrm/attendanceRequests.js").catch(() => ({}));
  if (!requestViewTypes) {
    // A React module this suite may not load; the source says the same.
    const REQUESTS = read("components", "hrm", "attendanceRequests.js");
    assert.match(REQUESTS, /\[REQUEST_VIEW_COMP_OFF\]: \["COMP_OFF", "COMP_OFF_CREDIT"\]/);
    assert.match(REQUESTS, /COMP_OFF_CREDIT: \["workedDate", "creditDayKind", "creditLoginAt", "creditLogoutAt", "creditWorked", "creditStatus", "creditExpiresOn"\]/);
    assert.match(REQUESTS, /if \(request\?\.type === "COMP_OFF"\) return "Leave \(Comp-Off\)";/);
    return;
  }
  assert.deepEqual(requestViewTypes["comp-off"], ["COMP_OFF", "COMP_OFF_CREDIT"]);
  assert.equal(requestTypeLabel({ type: "COMP_OFF" }), "Leave (Comp-Off)");
  assert.equal(requestTypeLabel({ type: "COMP_OFF_CREDIT" }), "Comp-Off Credit");
  const info = attendanceRequestForInfo({ type: "COMP_OFF_CREDIT", status: "PENDING", workedDate: "2026-03-01", fromDate: "2026-03-01", toDate: "2026-03-01", compOffCredit: { dayKind: "Weekly off", loginAt: "2026-03-01T03:30:00Z", logoutAt: "2026-03-01T13:30:00Z", workedLabel: "10h", creditStatus: "Not credited yet" } });
  assert.deepEqual([info.workedDate, info.creditDayKind, info.creditWorked, info.creditStatus, info.fromDate], ["2026-03-01", "Weekly off", "10h", "Not credited yet", ""]);
  const period = attendanceRequestSections({ type: "COMP_OFF_CREDIT" }).find((section) => section.title === "Period");
  assert.deepEqual(period.fields.map(([key]) => key), ["workedDate", "creditDayKind", "creditLoginAt", "creditLogoutAt", "creditWorked", "creditStatus", "creditExpiresOn"]);
});
