-- Split the one "Onboard Pending" status into the two the onboarding flow actually has.
--
-- An invite that has been sent but not filled in and a submission waiting on HR are two different
-- places to be, and only the second one has an employee row at all. The waiting-on-the-candidate
-- half is "Employee Submission Pending", carried by the invite rather than by an employee, so
-- nothing here needs to write it. The waiting-on-HR half is what "Onboard Pending" always meant,
-- renamed to say so.
--
-- `previous_employment_status` is renamed alongside it: deleting a separation puts the employee
-- back on the status stored there, and a status that no longer exists would put them nowhere.
--
-- Both tables are recreated empty earlier in this sequence — `employee` by the snake_case
-- conversion, `employee_separation` by the migration after it — so on a database built from these
-- migrations there is nothing here to rename. It is kept for any database restored from a backup
-- taken before the conversion, where those rows do exist.

UPDATE `employee`
SET `employment_status` = 'HR Onboarding Pending'
WHERE `employment_status` = 'Onboard Pending';

UPDATE `employee_separation`
SET `previous_employment_status` = 'HR Onboarding Pending'
WHERE `previous_employment_status` = 'Onboard Pending';
