-- The Attendance Report no longer says "Late: {late count}" or lists the late - the studio does not
-- want it in the message.
--
-- Only where the wording is still exactly what 20260928180000 left, so a template somebody has
-- reworded is untouched. `{late count}` and `{late list}` stay available for anybody who wants them
-- back. The new wording is the one the screen falls back to (`DEFAULT_ATTENDANCE_REPORT` in
-- `frontend/src/lib/attendanceReport.mjs`).
UPDATE `message_template`
SET `body` = 'Attendance Report - {date}
{branch}, as of {time}

Total employees: {total employees}
Present: {present count}
Absent: {absent count}
Permission: {permission count}

Present:
{present list}

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
Permission: {permission count}

Present:
{present list}

Late:
{late list}

Absent:
{absent list}

Permission:
{permission list}';
