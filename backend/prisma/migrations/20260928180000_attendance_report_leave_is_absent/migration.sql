-- The Attendance Register counts people on leave (a comp-off included) as Absent, and so does its
-- Send message: `{absent count}` and `{absent list}` include them, each tagged "On leave" or
-- "Comp-off" in the list. The default wording therefore drops its separate On leave and Comp-off
-- lines and sections, which would name the same people twice.
--
-- Only where the wording is still exactly what 20260926160000 left, so a template somebody has
-- reworded is untouched. The placeholders stay available. The new wording is the one the screen
-- falls back to (`DEFAULT_ATTENDANCE_REPORT` in `frontend/src/lib/attendanceReport.mjs`).
UPDATE `message_template`
SET `body` = 'Attendance Report - {date}
{branch}, as of {time}

Total employees: {total employees}
Present: {present count}
Late: {late count}
Absent: {absent count}
Permission: {permission count}

Present:
{present list}

Late:
{late list}

Absent:
{absent list}

Permission:
{permission list}'
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
