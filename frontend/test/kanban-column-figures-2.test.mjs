import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");

/*
 * The remaining boards' figures under each column's heading (`KanbanBoard`'s `columnAmount`).
 */

test("My payslips board totals net pay as Paid or Due", () => {
  const source = read("hrm/MyPayslipPage.js");
  assert.match(source, /import \{ columnTotal \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /columnAmount=\{\(rows, column\) => columnTotal\(rows, \(row\) => row\.netPay, column\.value === "Paid" \? "Paid" : "Due"\)\}/);
});

test("My Speak-ups board counts and tags week-old ones under Pending only", () => {
  const source = read("hrm/SpeakUpPanel.js");
  assert.match(source, /import \{ columnCount, daysSince \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /const SPEAK_UP_WAIT_DAYS = 7;/);
  assert.match(source, /if \(column\.value !== SPEAK_UP_STATUS_LABELS\.PENDING\) return "";\n\s+const days = daysSince\(row\.createdAt\);\n\s+return days !== null && days > SPEAK_UP_WAIT_DAYS \? `Waiting \$\{days\} days` : "";/);
  assert.match(source, /columnAmount=\{\(rows, column\) => \(column\.value === SPEAK_UP_STATUS_LABELS\.PENDING \? columnCount\(rows, \(row\) => Boolean\(speakUpWaitingFlag\(row, column\)\), `Waiting \$\{SPEAK_UP_WAIT_DAYS\}\+ days`[^\n]*: null\)\}\n\s+cardFlag=\{speakUpWaitingFlag\}/);
});

test("Users board counts the logins linked to no employee", () => {
  const source = read("admin/UserManagement.js");
  assert.match(source, /import \{ columnCount(, expiresSoon)? \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /const userFlag = \(user\) => \(user\.linkedEmployeeId \? "" : "No employee linked"\);/);
  assert.match(source, /columnAmount=\{\(rows\) => columnCount\(rows, \(user\) => Boolean\(userFlag\(user\)\), "Not linked"\)\}\n\s+cardFlag=\{userFlag\}/);
});

test("Roles board sums the users on its roles from _count.users", () => {
  const source = read("admin/RoleManagement.js");
  assert.match(source, /import \{ columnSumText \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /columnAmount=\{\(rows\) => columnSumText\(rows, \(role\) => role\._count\?\.users \?\? 0, "Users", String\)\}/);
});

test("Vendors board counts crew-ready vendors under Active only, and no spend", () => {
  const source = read("assets/VendorManagementView.js");
  assert.match(source, /import \{ columnCount(, expiresSoon)? \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /const vendorFlag = \(vendor, column\) => \(column\.value === "ACTIVE" && vendor\.canBeProductionTeamMember \? "Crew-ready" : ""\);/);
  assert.match(source, /columnAmount=\{\(rows, column\) => \(column\.value === "ACTIVE" \? columnCount\(rows, \(vendor\) => Boolean\(vendorFlag\(vendor, column\)\), "Crew-ready"\) : null\)\} cardFlag=\{vendorFlag\}/);
  assert.doesNotMatch(source, /columnTotal/);
});

test("Contacts board counts contacts recorded in the last 30 days", () => {
  const source = read("contacts/ContactsPage.js");
  assert.match(source, /import \{ columnCount(, expiresSoon)? \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /const contactFlag = \(row\) => \(Boolean\(row\.recordedAt\) && Date\.now\(\) - new Date\(row\.recordedAt\)\.getTime\(\) <= 30 \* 86_400_000 \? "New" : ""\);/);
  assert.match(source, /columnAmount=\{\(rows\) => columnCount\(rows, \(row\) => Boolean\(contactFlag\(row\)\), "New in last 30 days"\)\}\n\s+cardFlag=\{contactFlag\}/);
});

test("User activity logs board counts the failed requests from statusCode", () => {
  const source = read("admin/UserActivityLogsPage.js");
  assert.match(source, /import \{ columnCount(, expiresSoon)? \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /const logFlag = \(row\) => \(Number\(row\.statusCode\) >= 400 \? `Failed \(\$\{row\.statusCode\}\)` : ""\);/);
  assert.match(source, /columnAmount=\{\(rows\) => columnCount\(rows, \(row\) => Boolean\(logFlag\(row\)\), "Failed"\)\}\n\s+cardFlag=\{logFlag\}/);
});

test("WhatsApp activity board counts resendable failures and day-old waiting messages only", () => {
  const source = read("settings/WhatsAppActivityLogPanel.js");
  assert.match(source, /import \{ columnCount, daysSince \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /const WAITING_COLUMNS = \["QUEUED", "PROCESSING"\];\nconst WAITING_DAYS = 1;/);
  assert.match(source, /if \(column\.value === "FAILED"\) return row\.resendable \? "Resendable" : "";/);
  assert.match(source, /return days !== null && days > WAITING_DAYS \? `Waiting \$\{days\} days` : "";/);
  // Both counts go through the one flag.
  assert.match(source, /const counted = \(row\) => Boolean\(activityFlag\(row, column\)\);/);
  assert.match(source, /if \(column\.value === "FAILED"\) return columnCount\(rows, counted, "Resendable"\);/);
  assert.match(source, /WAITING_COLUMNS\.includes\(column\.value\) \? columnCount\(rows, counted, `Waiting \$\{WAITING_DAYS\}\+ days`/);
  assert.match(source, /columnAmount=\{activityColumnFigure\}\n\s+cardFlag=\{activityFlag\}/);
  assert.doesNotMatch(source, /columnWaiting/);
});

test("Project settings boards count services with no deliverable, and Deliverables shows none", () => {
  const source = read("project-management/ProjectSettingsPanel.js");
  assert.match(source, /import \{ columnCount(, expiresSoon)? \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /function SettingsBoard\(\{ rows, groupOf, card, columnAmount, cardFlag,/);
  assert.match(source, /columnAmount=\{columnAmount\}\n(\s+\/\/.*\n)?\s+cardFlag=\{cardFlag\}/);
  assert.match(source, /const serviceFlag = \(row\) => \(row\.deliverableAdded === "No" \? "No deliverable" : ""\);/);
  assert.equal(source.match(/columnAmount=\{\(rows\) => columnCount\(rows, \(row\) => Boolean\(serviceFlag\(row\)\), "No deliverable"\)\}\n\s+cardFlag=\{serviceFlag\}/g)?.length, 1);
});

test("Screening forms board counts and tags links expiring soon in the open columns only", () => {
  const source = read("hrm/InterviewApplicationInviteDialog.js");
  assert.match(source, /import \{ columnCount(, expiresSoon)? \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /const LIVE_LINK_COLUMNS = \["Created", "Verified"\];/);
  assert.match(source, /if \(!LIVE_LINK_COLUMNS\.includes\(column\.value\)\) return "";/);
  // The shared window: the start of today to the end of the day after tomorrow.
  assert.match(source, /return expiresSoon\((row\.inviteExpiresAt|invite\.expiresAt)\);/);
  assert.match(source, /columnAmount=\{\(rows, column\) => \(LIVE_LINK_COLUMNS\.includes\(column\.value\) \? columnCount\(rows, \(invite\) => Boolean\(expiringFlag\(invite, column\)\), "Expiring soon"[^\n]*: null\)\}\n\s+cardFlag=\{expiringFlag\}/);
});

test("CRM report boards each carry their own column figure", () => {
  const source = read("sales/CrmReportsPage.js");
  assert.match(source, /import \{ columnSumText \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /columnAmount=\{board\.columnAmount\}/);
  assert.match(source, /columnSumText\(rows, sumOf\("connected"\), "Connected"/);
  assert.match(source, /columnSumText\(rows, sumOf\("attempts"\), "Attempts"/);
  assert.match(source, /columnSumText\(rows, sumOf\("calls"\), "Calls"/);
  assert.match(source, /columnSumText\(rows, sumOf\("durationSeconds"\), "Talk", talkTime\)/);
  assert.match(source, /sumOf\("workedSeconds"\)\(row\) \/ 3600, "Worked"/);
  for (const [report, figure] of [["summary", "connectedFigure"], ['"lead-analysis"', "callsFigure"], ['"never-attended"', "attemptsFigure"], ['"not-picked-up"', "attemptsFigure"], ['"call-history"', "talkFigure"], ['"work-hours"', "workedFigure"]]) {
    assert.match(source, new RegExp(`^  ${report}: \\{.*columnAmount: ${figure} \\},$`, "m"));
  }
});

test("User Management: each column says, in words, what HR should act on - and tags the cards it means", async () => {
  const source = read("employees/EmployeeVerificationPage.js");
  assert.match(source, /import \{ columnCount, columnNextWho, columnOldest, daysSince, expiresSoon \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /columnAmount=\{boardColumnFigure\}\n\s+cardFlag=\{boardCardFlag\}/);
  // Employee Submission Pending: links running out first, else the oldest invite still unanswered.
  assert.match(source, /text: `\$\{plural\(expiring, "link expires", "links expire"\)\} in 2 days`/);
  assert.match(source, /return columnOldest\(rows, sentOn, \(days\) => `Oldest invite sent \$\{plural\(days, "day", "days"\)\} ago`\);/);
  assert.match(source, /"HR Onboarding Pending"\) return columnOldest\(rows, \(row\) => row\.createdAt, \(days\) => `Oldest waiting \$\{plural\(days, "day", "days"\)\}`\);/);
  // Active: reviews due this month, from Next Review Date, tagged "Review due 12 Nov".
  assert.match(source, /"Active"\) return columnCount\(rows, reviewDueThisMonth, "Reviews due this month"/);
  assert.match(source, /"Active"\) return reviewDueThisMonth\(row\) \? `Review due \$\{/);
  // Serving Notice: who leaves next, by name.
  assert.match(source, /"Serving Notice"\) return columnNextWho\(rows, \(row\) => row\.dateOfRelieving, \(row\) => row\.employeeName, "Next to leave"\);/);
  const { columnNextWho, columnOldest } = await import("../src/lib/kanbanSummary.mjs");
  const now = new Date(2026, 10, 4);
  assert.equal(columnNextWho([{ d: "2026-12-02", n: "bc dc" }, { d: "2026-12-20", n: "Keerthana" }], (r) => r.d, (r) => r.n, "Next to leave", now).text, "Next to leave: bc dc on 2 Dec");
  assert.equal(columnNextWho([{ d: "2026-10-01", n: "Gone" }], (r) => r.d, (r) => r.n, "Next to leave", now), null);
  // `now` is the fifth argument, after the title. Passed fourth it landed in the title and the count
  // came from the real today, so this read "Oldest 12" only on 4 Nov 2026 and broke the next morning.
  assert.equal(columnOldest([{ d: "2026-10-23" }, { d: "2026-11-01" }], (r) => r.d, (days) => `Oldest ${days}`, "", now).text, "Oldest 12");
  assert.equal(columnOldest([], (r) => r.d, (days) => `Oldest ${days}`, "", now), null);
});

test("Attendance register board counts and tags Late under Present and Irregular under Leave only", () => {
  const source = read("hrm/AttendanceRegisterPage.js");
  assert.match(source, /import \{ columnCount(, expiresSoon)? \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /const registerFlag = \(row, column\) => \(column\.value === "Present" \? \(row\.status === "Late" \? "Late" : ""\)\s*: column\.value === "Leave" \? \(isIrregular\(row\) \? "Irregular" : ""\)\s*: ""\);/);
  assert.match(source, /columnAmount=\{\(rows, column\) => \(column\.value === "Present" \? columnCount\(rows, \(row\) => Boolean\(registerFlag\(row, column\)\), "Late"\)\s*: column\.value === "Leave" \? columnCount\(rows, \(row\) => Boolean\(registerFlag\(row, column\)\), "Irregular"\)\s*: null\)\}\n\s+cardFlag=\{registerFlag\}/);
});

test("Employee attendance by branch board sums the late days from late", () => {
  const source = read("hrm/AdminAttendanceEmployees.js");
  assert.match(source, /import \{ columnSumText \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /columnAmount=\{\(rows\) => columnSumText\(rows, \(row\) => row\.late, "Late days", String\)\}/);
});

test("My attendance boards show worked hours (none on days not worked) and break hours from minutes", () => {
  const source = read("hrm/EmployeeAttendancePage.js");
  assert.match(source, /import \{ columnSumText \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /const columnHours = \(rows, label\) => columnSumText\(rows, \(row\) => \(Number\(row\.minutes\) \|\| 0\) \/ 60, label, \(hours\) => `\$\{Math\.round\(hours \* 10\) \/ 10\} h`\);/);
  assert.match(source, /const NO_WORK_STATUSES = \["Absent", "Holiday", "On leave", "Not required"\];/);
  assert.match(source, /columnAmount=\{\(rows, column\) => \(NO_WORK_STATUSES\.includes\(column\.value\) \? null : columnHours\(rows, "Worked"\)\)\}/);
  assert.match(source, /columnAmount=\{\(rows\) => columnHours\(rows, "Break"\)\}/);
  // The break rows carry their minutes for that sum.
  assert.match(source, /function rowsFromBreaks[\s\S]*?minutes: entry\.minutes,/);
});
