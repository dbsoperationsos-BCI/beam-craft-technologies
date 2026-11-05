import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const RULES = read("components/hrm/AttendanceRulesPanel.js");
const BALANCE = read("components/hrm/CasualLeaveBalance.js");
const DIALOG = read("components/hrm/AttendanceRequestDialog.js");
const FORM = read("components/hrm/AttendanceRequestFormPanel.js");
const SERVICE = read("services/hrm/attendance.service.js");

test("Attendance Rules sets Casual Leave: days a month, month-to-month carry, and what carries into the new year", () => {
  assert.match(RULES, /<h2 className="[^"]*">Casual Leave<HelpTip text="[^"]+" \/><\/h2>/);
  assert.match(RULES, /label="Casual leave per month \(days\)" type="number" min=\{0\} max=\{31\} step=\{0\.5\}/);
  assert.match(RULES, /label="Days carried into the next year" type="number" min=\{0\} max=\{366\} step=\{0\.5\}/);
  assert.match(RULES, /<ToggleSwitch\s+label=\{`Carry unused leave to \$\{period\.next\}`\}/);
  // Every line under the choice follows it: month and 1 January, or pay cycle and January's payroll.
  assert.match(RULES, /\? \{ next: "the next pay cycle", buildUp: "cycle by cycle", each: "Each pay cycle's", end: "the end of the cycle" \}/);
  assert.match(RULES, /: \{ next: "the next month", buildUp: "month by month", each: "Each month's", end: "the end of the month" \};/);
  // The year's turn is named as a date - on the pay cycle the November day January's payroll starts.
  assert.match(RULES, /\? `On \$\{formatDate\(yearStart\.startsOn\)\} - when January \$\{yearStart\.year\}'s payroll cycle starts`/);
  assert.match(RULES, /helperText=\{`\$\{yearTurns\}, at most this many unused days carry over\. 0 means all unused days lapse\.`\}/);
  // Saved by its own section, in whole and half days.
  assert.match(RULES, /casualLeavePerMonth: Number\(form\.casualLeavePerMonth \?\? 0\),/);
  assert.match(RULES, /casualLeaveMonthlyCarry: form\.casualLeaveMonthlyCarry !== false,/);
  assert.match(RULES, /casualLeaveYearCarryMax: Number\(form\.casualLeaveYearCarryMax \?\? 0\),/);
  assert.match(RULES, /return Number\.isInteger\(number \* 2\) \? "" : "Use whole or half days, like 1 or 1\.5\.";/);
  // Each section saves on its own, at its foot - four of them - and none for a reader.
  assert.equal((RULES.match(/\{saveButton\("(workingDay|casualLeave|permissions|compOff)"\)\}/g) || []).length, 4);
  assert.match(RULES, /const saveButton = \(section\) => !readOnly && <div className="mt-4 flex justify-end">/);
  assert.match(RULES, /disabled=\{Boolean\(saving\) \|\| !changed\(section\) \|\| Boolean\(problems\[section\]\)\}/);
  // A section's save sends its own fields alone, and keeps what is being typed in another.
  assert.match(RULES, /await saveAttendanceSettings\(payloads\[section\]\(\)\);/);
  assert.match(RULES, /if \(!ownFields\.includes\(key\) && !sameValue\(current\[key\], before\?\.\[key\]\)\) next\[key\] = current\[key\];/);
  // A policy change re-counts every balance, so it is confirmed first; the carry rules show only while it is on.
  assert.match(RULES, /if \(needsConfirming\[section\]\) setConfirming\(section\); else save\(section\);/);
  // The shift times are checked on the press and marked under their own boxes.
  assert.match(RULES, /if \(section === "workingDay" && !fields\.check\(shiftProblems\(\)\)\) return;/);
  assert.match(RULES, /"Re-count Casual Leave for everyone\?"/);
  assert.match(RULES, /\{casualLeaveOn && <>/);
  // A "month" is the calendar month or Payroll rules' pay cycle, saved and confirmed with the rest.
  assert.match(RULES, /\{ value: "CALENDAR_MONTH", label: "Calendar month" \},\s+\{ value: "PAY_CYCLE", label: "Pay cycle" \},/);
  assert.match(RULES, /<RadioGroupField\s+label="Count Casual Leave by"/);
  assert.match(RULES, /casualLeavePeriod: form\.casualLeavePeriod \|\| "CALENDAR_MONTH",/);
  assert.match(RULES, /\|\| \(form\.casualLeavePeriod \|\| "CALENDAR_MONTH"\) !== \(settings\?\.casualLeavePeriod \|\| "CALENDAR_MONTH"\);/);
  assert.match(RULES, /\{form\.casualLeaveMonthlyCarry !== false && <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">\s+<TextField label="Days carried into the next year"/);
});

test("the Leave form says the balance, and warns of Loss of Pay rather than refusing", () => {
  assert.match(SERVICE, /return apiRequest\(`\$\{base\}\/requests\/leave-balance\$\{query \? `\?\$\{query\}` : ""\}`\);/);
  assert.match(BALANCE, /role="status" aria-live="polite" className=\{said \? "space-y-1\.5" : "contents"\}/);
  assert.match(BALANCE, /Available CL: <span className="font-semibold">\{days\(reading\.balance\)\}<\/span>/);
  // The leave's working days, naming each weekly off and holiday in the range that is not counted.
  assert.match(BALANCE, /Leave days: <span className="font-semibold">\{days\(preview\.days\)\}<\/span>/);
  assert.match(BALANCE, /\.join\(", "\)\} not counted/);
  assert.match(BALANCE, /of leave waiting for approval will also take from it/);
  assert.match(BALANCE, /const tail = "beyond your balance and will be Loss of Pay \(deducted from your pay\)\.";/);
  assert.match(DIALOG, /\{isLeave && <CasualLeaveBalance fromDate=\{form\.fromDate\} toDate=\{form\.toDate\} leaveType=\{form\.leaveType\} excludeRequestId=\{editing \? prefill\?\.id : null\} \/>\}/);
  assert.match(FORM, /\{type === "LEAVE" && <CasualLeaveBalance fromDate=\{values\.fromDate\} toDate=\{values\.toDate\} leaveType=\{values\.leaveType\} excludeRequestId=\{editing \? prefill\?\.id : null\} \/>\}/);
});

test("Attendance Rules has a Comp-Off section for how long a comp-off can be used, and the forms stop at it", async () => {
  const PICKER = read("components/hrm/CompOffWorkedDayPicker.js");
  const CONFIG = read("constants/attendanceRequestConfig.js");
  assert.match(RULES, /<h2 className="[^"]*">Comp-Off<HelpTip text="[^"]+" \/><\/h2>/);
  assert.match(RULES, /label="Comp-off expires after \(days\)" type="number" min=\{0\} max=\{366\} step=\{1\}/);
  assert.match(RULES, /compOff: \(\) => \(\{ compOffExpiryDays: Number\(form\.compOffExpiryDays \?\? 0\) \}\),/);
  const { compOffExpiresOn } = await import("../src/constants/attendanceRequestConfig.js");
  assert.equal(compOffExpiresOn("2026-09-06", { compOffExpiryDays: 30 }), "2026-10-06");
  assert.equal(compOffExpiresOn("2026-09-06", { compOffExpiryDays: 0 }), "");
  assert.match(DIALOG, /maxDate=\{compOffExpiresOn\(form\.workedDate, settings\)\}/);
  assert.match(DIALOG, /This comp-off has to be taken by \$\{expiresOn\}/);
  // A comp-off is a Leave with Comp-Off chosen now (`requestTypeOf`), and its day off still stops at the expiry.
  assert.match(CONFIG, /requestTypeOf\(values\) === "COMP_OFF" \? compOffExpiresOn\(values\.workedDate, context\?\.settings\) : ""/);
  assert.match(PICKER, /\{option\.expiresOn && <span className="[^"]*">Use by \{dayLabel\(option\.expiresOn\)\}<\/span>\}/);
  assert.match(PICKER, /Weekly Off \/ Holiday Worked/);
});

test("Attendance Rules has a Permissions section: the longest one, how many a month or pay cycle allows, and the form says how many are used", () => {
  const ALLOWANCE = read("components/hrm/PermissionAllowance.js");
  assert.match(RULES, /<h2 className="[^"]*">Permissions<HelpTip text="[^"]+" \/><\/h2>/);
  // The longest permission moved here from the Working day section - written once.
  assert.equal((RULES.match(/label="Longest permission \(minutes\)"/g) || []).length, 1);
  assert.ok(RULES.indexOf('label="Longest permission (minutes)"') > RULES.indexOf(">Permissions<HelpTip"));
  assert.match(RULES, /label=\{`Permissions allowed per \$\{permissionsByPayCycle \? "pay cycle" : "month"\}`\} type="number" min=\{0\} max=\{31\} step=\{1\}/);
  assert.match(RULES, /<RadioGroupField\s+label="Count permissions by"/);
  // Shown whatever the limit, and before the numbers, as Count Casual Leave by is.
  assert.doesNotMatch(RULES, /permissionsValue > 0 && <div className="mt-4">\s+<RadioGroupField/);
  assert.ok(RULES.indexOf('label="Count permissions by"') < RULES.indexOf('label="Longest permission (minutes)"'));
  assert.match(RULES, /permissionsPerPeriod: Number\(form\.permissionsPerPeriod \?\? 0\),/);
  assert.match(RULES, /permissionPeriod: form\.permissionPeriod \|\| "CALENDAR_MONTH",/);
  assert.match(SERVICE, /return apiRequest\(`\$\{base\}\/requests\/permission-usage\?\$\{params\.toString\(\)\}`\);/);
  assert.match(ALLOWANCE, /Permissions in \{usage\.label\}: <span className="font-semibold">\{usage\.used\} of \{usage\.limit\}<\/span> used/);
  assert.match(DIALOG, /\{isPermission && <PermissionAllowance date=\{form\.fromDate\} excludeRequestId=\{editing \? prefill\?\.id : null\} \/>\}/);
  assert.match(FORM, /\{type === "PERMISSION" && <PermissionAllowance date=\{values\.fromDate\} excludeRequestId=\{editing \? prefill\?\.id : null\} \/>\}/);
});

test("a leave asks its type - Casual Leave or Loss of Pay - with nothing chosen, and is listed with it", async () => {
  const CONFIG = read("constants/attendanceRequestConfig.js");
  const REQUESTS = read("components/hrm/attendanceRequests.js");
  assert.match(CONFIG, /\{ value: "CL", label: "Casual Leave \(CL\)" \},\s+\{ value: "LOP", label: "Loss of Pay \(LOP\)" \},/);
  // The Raise Request form's Leave Type also offers Comp-Off, and stays shown while it is chosen.
  assert.match(CONFIG, /\{ name: "leaveType", label: "Leave Type", type: "radio", required: true, colSpan: 2, options: RAISE_LEAVE_TYPE_OPTIONS, when: \(values\) => values\.type === "LEAVE", clears: \["workedDate", "workedPairDate"\]/);
  assert.match(DIALOG, /\{isLeave && <RadioGroupField label="Leave Type" required(?: helperText="[^"]*")? options=\{LEAVE_TYPE_OPTIONS\} value=\{form\.leaveType\}/);
  assert.match(DIALOG, /leaveType: prefill\?\.leaveType \|\| "",/);
  assert.match(DIALOG, /leaveType: action === "LEAVE" \? form\.leaveType : null,/);
  // A Loss of Pay leave says it is unpaid in place of the balance it does not touch.
  // A Loss of Pay leave says it is unpaid in place of the balance it does not use; a Casual Leave warns past the balance.
  assert.match(BALANCE, /\{leaveType === "LOP" && <p /);
  assert.match(BALANCE, /\{leaveType === "CL" && lossOfPay > 0 && <p /);
  assert.match(BALANCE, /every day of this leave is unpaid, and your Casual Leave balance is not used\./);
  // In order: the dates, then the Leave Type, then what the leave comes to.
  const dates = DIALOG.indexOf('<DateField label="To date"');
  const type = DIALOG.indexOf('{isLeave && <RadioGroupField label="Leave Type"');
  const summary = DIALOG.indexOf("{isLeave && <CasualLeaveBalance");
  assert.ok(dates > 0 && dates < type && type < summary, "dates, Leave Type, then the summary");
  const CONFIG_ORDER = read("constants/attendanceRequestConfig.js");
  assert.ok(CONFIG_ORDER.indexOf('name: "toDate"') < CONFIG_ORDER.indexOf('name: "leaveType"'), "the full form asks the type after the dates");
  // A leave's span is not said as days on the form: its working days are, under the type.
  assert.match(DIALOG, /if \(action === "LEAVE" \|\| action === "COMP_OFF"/);
  const { requestFormProblems } = await import("../src/components/hrm/AttendanceRequestDialog.js").catch(() => ({}));
  if (requestFormProblems) assert.match(requestFormProblems("LEAVE", { fromDate: "2026-10-10", toDate: "2026-10-10", leaveType: "", reason: "x" }, { today: "2026-10-10" }).leaveType, /Choose the leave type/);
  // Said under the Leave Type itself.
  assert.match(DIALOG, /if \(action === "LEAVE" && !form\.leaveType\) problems\.leaveType = "Choose the leave type\.";/);
  assert.match(DIALOG, /onChange=\{\(value\) => update\("leaveType", value\)\} disabled=\{busy\} error=\{fields\.errors\.leaveType\}/);
  assert.match(REQUESTS, /return request\?\.type === "LEAVE" && request\.leaveType \? `\$\{label\} \(\$\{request\.leaveType\}\)` : label;/);
});
