-- A comp-off is a day off given back for a holiday or weekly off that was worked. The day taken off
-- is the request's from/to date as for a leave; this column is the day that earned it. Nullable, and
-- set on COMP_OFF requests only, so every existing row is untouched.
ALTER TABLE `attendance_request` ADD COLUMN `worked_date` DATE NULL;

-- "Has this worked day already been claimed", asked on every comp-off raised.
CREATE INDEX `attendance_request_employee_id_worked_date_idx` ON `attendance_request`(`employee_id`, `worked_date`);
