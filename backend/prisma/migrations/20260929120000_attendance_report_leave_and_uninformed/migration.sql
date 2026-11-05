-- The Attendance Report is said as Present (a count, no names), Leave - whoever is away with an
-- approved request, a comp-off included - and Uninformed Leave - whoever is away without one - then
-- Permission. The Present and Absent lists are gone from the default wording, and the Absent line with
-- them. New placeholders `{leave count}`, `{leave list}`, `{uninformed leave count}` and
-- `{uninformed leave list}`; the old ones stay for a studio that wants them.
--
-- Only where the wording is still exactly what 20260928220000 left, so a template somebody has
-- reworded is untouched. The new wording is the one the screen and the daily WhatsApp send fall back
-- to (`DEFAULT_ATTENDANCE_REPORT` in `frontend/src/lib/attendanceReport.mjs` and
-- `backend/src/modules/hrm/attendance/reportText.js`).
UPDATE `message_template`
SET `body` = 'Attendance Report - {date}
{branch}, as of {time}

Total employees: {total employees}
Present: {present count}
Leave: {leave count}
Uninformed Leave: {uninformed leave count}
Permission: {permission count}

Leave:
{leave list}

Uninformed Leave:
{uninformed leave list}

Permission:
{permission list}'
WHERE `key` = 'ATTENDANCE_DAILY_REPORT'
  AND REPLACE(`body`, '\r', '') = 'Attendance Report - {date}
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
{permission list}';
