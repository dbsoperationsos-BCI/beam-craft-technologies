import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");

/*
 * The boards that are not about money show a figure of their own under each column's heading
 * (`KanbanBoard`'s `columnAmount`, with `text` in place of an amount).
 */

test("Tasks board counts the overdue tasks in its open columns only, each tagged with how late", () => {
  const source = read("hrm/TasksPage.js");
  assert.match(source, /import \{ columnCount(, expiresSoon)? \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /const CLOSED_TASK_COLUMNS = \["COMPLETED", "CANCELLED", "SUBMITTED", "REASSIGNED"\];/);
  assert.match(source, /if \(CLOSED_TASK_COLUMNS\.includes\(column\.value\)\) return "";\n\s+const late = daysOverdue\(task, view\?\.id\);\n\s+return late > 0 \? `Overdue \$\{late\} \$\{late === 1 \? "day" : "days"\}` : "";/);
  // The count is exactly the cards carrying a tag.
  assert.match(source, /columnAmount=\{\(rows, column\) => \(CLOSED_TASK_COLUMNS\.includes\(column\.value\) \? null : columnCount\(rows, \(task\) => Boolean\(overdueFlag\(task, column\)\), "Overdue"\)\)\}\n\s+cardFlag=\{overdueFlag\}/);
});

test("Attendance requests board: Pending counts and tags 2+ day waits from createdAt, Approved sums permission hours, the rest show nothing", () => {
  const source = read("hrm/AttendanceRequestsPage.js");
  assert.match(source, /import \{ columnCount, columnSumText, daysSince \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /const PENDING_WAIT_DAYS = 2;/);
  assert.match(source, /if \(column\.value !== "Pending"\) return "";\n\s+const days = daysSince\(row\.raw\?\.createdAt\);\n\s+return days !== null && days > PENDING_WAIT_DAYS \? `Waiting \$\{days\} days` : "";/);
  assert.match(source, /columnAmount=\{\(rows, column\) => \(column\.value === "Pending" \? columnCount\(rows, \(row\) => Boolean\(waitingFlag\(row, column\)\), `Waiting \$\{PENDING_WAIT_DAYS\}\+ days`/);
  assert.match(source, /: column\.value === "Approved" \? columnSumText\(rows, \(row\) => \(Number\(row\.raw\?\.durationMinutes\) \|\| 0\) \/ 60, "Permission", \(hours\) => `\$\{Math\.round\(hours \* 10\) \/ 10\} h`\)\s*: null\)\}/);
  assert.match(source, /cardFlag=\{waitingFlag\}/);
});

test("Interview: the column counts who needs chasing, and each counted card is tagged with why", async () => {
  const source = fs.readFileSync(new URL("../src/components/hrm/InterviewPage.js", import.meta.url), "utf8");
  assert.match(source, /import \{ columnCount, columnNext, daysSince(, expiresSoon)? \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /columnAmount=\{candidateColumnFigure\}\n\s+cardFlag=\{candidateFlag\}/);
  assert.match(source, /return days !== null && days >= STALE_DAYS \? `Not updated \$\{days\} days` : "";/);
  assert.match(source, /column\.value === "Interview Scheduled" && interviewPassed\(candidate\) \? "Interview date passed" : ""/);
  // The column's count is exactly the cards carrying a tag.
  assert.match(source, /columnCount\(rows, \(candidate\) => Boolean\(candidateFlag\(candidate, column\)\), `Not updated \$\{STALE_DAYS\}\+ days`\)/);
  assert.match(source, /rows\.some\(interviewPassed\) \? columnCount\(rows, interviewPassed, "Interview dates passed"\) : columnNext\(/);
  assert.doesNotMatch(source, /Avg idle/);
  const board = fs.readFileSync(new URL("../src/components/data-table/KanbanBoard.js", import.meta.url), "utf8");
  assert.match(board, /flag=\{cardFlag\?\.\(row, column\) \|\| ""\}/);
  assert.match(board, /\{flag && <span className="mt-1\.5 inline-flex[^"]*bg-amber-50[^"]*"><span aria-hidden="true">⚠<\/span>\{flag\}<\/span>\}/);
  const { daysSince } = await import("../src/lib/kanbanSummary.mjs");
  assert.equal(daysSince("2026-10-20", new Date(2026, 10, 4)), 15);
  assert.equal(daysSince(null), null);
});

// "Waiting 7+ days" on the boards whose open columns wait on somebody - null in the done columns.
const readWaitingBoard = (...parts) => fs.readFileSync(new URL(`../src/components/${parts.join("/")}`, import.meta.url), "utf8");

test("CRD Documents counts waiting from the document's creation, not in Submitted, and tags each counted card", () => {
  const source = readWaitingBoard("sales", "CrdDocumentsPage.js");
  assert.match(source, /import \{ columnCount, daysSince \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /columnAmount=\{documentColumnFigure\}\n\s+cardFlag=\{documentFlag\}/);
  assert.match(source, /if \(column\.value === "Submitted"\) return "";\n\s+const days = daysSince\(row\.crdDocument\?\.createdAt \|\| row\.createdAt\);\n\s+return days !== null && days > WAITING_DAYS \? `Waiting \$\{days\} days` : "";/);
  // The column's count is exactly the cards carrying a tag.
  assert.match(source, /column\.value === "Submitted" \? null\n\s+: columnCount\(rows, \(row\) => Boolean\(documentFlag\(row, column\)\), `Waiting \$\{WAITING_DAYS\}\+ days`/);
  assert.match(source, /const WAITING_DAYS = 7;/);
  assert.doesNotMatch(source, /columnWaiting/);
});

test("Client Gifts counts Sent from sentAt and Yet To Sent from createdAt, not in Received, and tags each counted card", () => {
  const source = readWaitingBoard("project-management", "ClientGiftsPage.js");
  assert.match(source, /import \{ columnCount, daysSince \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /columnAmount=\{giftColumnFigure\}\n\s+cardFlag=\{giftFlag\}/);
  assert.match(source, /if \(column\.value === "Received by Client"\) return "";\n\s+const days = daysSince\(column\.value === "Sent" \? row\.sentAt : row\.createdAt\);\n\s+return days !== null && days > WAITING_DAYS \? `Waiting \$\{days\} days` : "";/);
  assert.match(source, /column\.value === "Received by Client" \? null\n\s+: columnCount\(rows, \(row\) => Boolean\(giftFlag\(row, column\)\), `Waiting \$\{WAITING_DAYS\}\+ days`/);
  assert.match(source, /const WAITING_DAYS = 7;/);
  assert.doesNotMatch(source, /columnWaiting/);
});

test("Feedback counts waiting only on Yet to be done and Issues, by the board's own date", () => {
  const source = readWaitingBoard("project-management", "FeedbackPage.js");
  assert.match(source, /import \{ columnCount, daysSince \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /const OPEN_FEEDBACK_COLUMNS = \[DEFAULT_FEEDBACK_STATUS, "Issues"\];/);
  assert.match(source, /columnAmount=\{feedbackColumnFigure\}\n\s+cardFlag=\{feedbackFlag\}/);
  assert.match(source, /if \(!OPEN_FEEDBACK_COLUMNS\.includes\(column\.value\)\) return "";\n\s+const days = daysSince\(feedbackDateOf\(row\)\);\n\s+return days !== null && days > WAITING_DAYS \? `Waiting \$\{days\} days` : "";/);
  assert.match(source, /OPEN_FEEDBACK_COLUMNS\.includes\(column\.value\)\n\s+\? columnCount\(rows, \(row\) => Boolean\(feedbackFlag\(row, column\)\), `Waiting \$\{WAITING_DAYS\}\+ days`/);
  assert.match(source, /const WAITING_DAYS = 7;/);
  assert.doesNotMatch(source, /columnWaiting/);
  assert.match(source, /const time = new Date\(row\.createdAt \|\| row\.shootDate \|\| row\.eventDate \|\| ""\)\.getTime\(\);/);
});

test("Speak-up Review counts and tags waiting only on Pending, from createdAt", () => {
  const source = readWaitingBoard("hrm", "SpeakUpReviewPanel.js");
  assert.match(source, /import \{ columnCount, daysSince \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /const SPEAK_UP_WAIT_DAYS = 7;/);
  assert.match(source, /if \(column\.value !== SPEAK_UP_STATUS_LABELS\.PENDING\) return "";\n\s+const days = daysSince\(row\.createdAt\);\n\s+return days !== null && days > SPEAK_UP_WAIT_DAYS \? `Waiting \$\{days\} days` : "";/);
  assert.match(source, /columnAmount=\{\(rows, column\) => \(column\.value === SPEAK_UP_STATUS_LABELS\.PENDING \? columnCount\(rows, \(row\) => Boolean\(speakUpWaitingFlag\(row, column\)\), `Waiting \$\{SPEAK_UP_WAIT_DAYS\}\+ days`[^\n]*: null\)\}\n\s+cardFlag=\{speakUpWaitingFlag\}/);
});

test("Client Storage board totals the column's footage size, read into GB / TB", () => {
  const source = read("assets/ClientStorageManagementView.js");
  assert.match(source, /import \{ columnSumText \} from "@\/lib\/kanbanSummary\.mjs"/);
  assert.match(source, /columnAmount=\{\(rows\) => \(rows\.some\(\(record\) => footageGigabytes\(record\.footageSize\)\) \? columnSumText\(rows, \(record\) => footageGigabytes\(record\.footageSize\), "Size", formatGigabytes\) : null\)\}/);
  assert.match(source, /const FOOTAGE_UNITS = \{ tb: 1000, gb: 1, mb: 0\.001 \}/);
});

test("Onboarding invites board counts and tags links expiring soon, in the open columns only", () => {
  const source = read("employees/OnboardingInviteTable.js");
  assert.match(source, /import \{ columnCount(, expiresSoon)? \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /const BOARD_OPEN_STATUSES = \["Created", "Verified"\]/);
  assert.match(source, /if \(!BOARD_OPEN_STATUSES\.includes\(column\.value\)\) return "";/);
  // The shared window: the start of today to the end of the day after tomorrow.
  assert.match(source, /return expiresSoon\((row\.inviteExpiresAt|invite\.expiresAt)\);/);
  assert.match(source, /BOARD_OPEN_STATUSES\.includes\(column\.value\) \? columnCount\(rows, \(invite\) => Boolean\(boardCardFlag\(invite, column\)\), "Expiring soon"/);
  assert.match(source, /columnAmount=\{boardColumnAmount\}\n\s+cardFlag=\{boardCardFlag\}/);
});

test("Resignation forms board counts and tags links expiring soon, in the columns still with the employee", () => {
  const source = read("employees/OffboardingInviteDialog.js");
  assert.match(source, /import \{ columnCount(, expiresSoon)? \} from "@\/lib\/kanbanSummary\.mjs";/);
  assert.match(source, /const OPEN_STATUSES = \["Sent", "Verified", "Sent Back"\]/);
  assert.match(source, /if \(!OPEN_STATUSES\.includes\(column\.value\)\) return "";/);
  // The shared window: the start of today to the end of the day after tomorrow.
  assert.match(source, /return expiresSoon\((row\.inviteExpiresAt|invite\.expiresAt)\);/);
  assert.match(source, /columnAmount=\{\(rows, column\) => \(OPEN_STATUSES\.includes\(column\.value\) \? columnCount\(rows, \(invite\) => Boolean\(expiringFlag\(invite, column\)\), "Expiring soon"[^\n]*: null\)\}\n\s+cardFlag=\{expiringFlag\}/);
});

test("Schedule board shows the next booking still to come, none under Cancelled", () => {
  const source = read("sales/MeetingsPage.js");
  assert.match(source, /import \{ columnNext \} from "@\/lib\/kanbanSummary\.mjs"/);
  assert.match(source, /const happensOn = \(row\) => row\.meeting\?\.startAt \|\| \(row\.day \? `\$\{row\.day\}T00:00:00` : null\)/);
  assert.match(source, /columnAmount=\{\(rows, column\) => \(column\.value === "Cancelled" \? null : columnNext\(rows, happensOn\)\)\}/);
});
