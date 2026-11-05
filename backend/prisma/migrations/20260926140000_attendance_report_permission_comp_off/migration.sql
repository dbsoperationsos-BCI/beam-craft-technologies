-- The Attendance Report gains Permission and Comp-off, after On leave, in the counts and as lists.
--
-- Only where the studio has not touched the wording: the UPDATE matches the exact text
-- 20260926120000 seeded, so a template somebody has already reworded is left as they wrote it -
-- they can add `{permission count}`, `{permission list}`, `{comp-off count}` and `{comp-off list}`
-- themselves in Settings → Templates → Attendance Report. The new wording is the one the screen falls
-- back to (`DEFAULT_ATTENDANCE_REPORT` in `frontend/src/lib/attendanceReport.mjs`).
UPDATE `message_template`
SET `body` = 'Attendance Report - {date}
{branch}, as of {time}

Total employees: {total employees}
Present: {present count}
Late: {late count}
Absent: {absent count}
On leave: {on leave count}
Permission: {permission count}
Comp-off: {comp-off count}
Not checked out: {not checked out count}

Present:
{present list}

Late:
{late list}

Absent:
{absent list}

On leave:
{on leave list}

Permission:
{permission list}

Comp-off:
{comp-off list}'
WHERE `key` = 'ATTENDANCE_DAILY_REPORT'
  AND REPLACE(`body`, '\r', '') = 'Attendance Report - {date}
{branch}, as of {time}

Total employees: {total employees}
Present: {present count}
Late: {late count}
Absent: {absent count}
On leave: {on leave count}
Not checked out: {not checked out count}

Present:
{present list}

Late:
{late list}

Absent:
{absent list}

On leave:
{on leave list}';
