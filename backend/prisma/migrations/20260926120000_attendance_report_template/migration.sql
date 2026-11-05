-- The Attendance Register's Send message: one day's attendance up to the moment it is sent, as
-- wording the studio owns in Settings → Templates → Attendance Report.
--
-- The register fills the placeholders from what the server decided about the day - the counts and
-- the lists of names - and shows the result in the copy box the invites and the receipt end on.
-- Seeded with the same wording the screen falls back to (`DEFAULT_ATTENDANCE_REPORT` in
-- `frontend/src/lib/attendanceReport.mjs`), so the Settings box opens on the real message. `WHERE NOT
-- EXISTS` so a studio that has already written it keeps what it wrote.
INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'ATTENDANCE_DAILY_REPORT', 'Attendance Report', 'Attendance Report - {date}
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
{on leave list}'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'ATTENDANCE_DAILY_REPORT');
