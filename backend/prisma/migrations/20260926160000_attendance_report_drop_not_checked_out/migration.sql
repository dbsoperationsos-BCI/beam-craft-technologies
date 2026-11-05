-- The Attendance Report no longer says "Not checked out: {not checked out count}" - the studio does
-- not want it in the message.
--
-- Only where the wording is still exactly what 20260926140000 left, so a template somebody has
-- reworded is untouched (they can delete the line themselves in Settings → Templates → Attendance
-- Report). The placeholders stay available for anybody who wants them back. The new wording is the
-- one the screen falls back to (`DEFAULT_ATTENDANCE_REPORT` in `frontend/src/lib/attendanceReport.mjs`).
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
{comp-off list}';
