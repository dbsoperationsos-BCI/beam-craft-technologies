-- Leave requests: Casual Leave (CL) or Loss of Pay (LOP).
--
-- `leave_type` on a LEAVE request, chosen by the person raising it: CL takes from the Casual Leave
-- balance (Settings → Employee → Attendance Rules) - a day beyond it is Loss of Pay - and LOP never
-- touches the balance: every day of it is unpaid. Null on every other kind of request.
--
-- Every leave already raised was Casual Leave in all but name - it took from the balance - so it is
-- marked CL here, and nothing anybody was paid changes.
--
-- Cost: one nullable column on `attendance_request` and one pass over its LEAVE rows. Instant.

ALTER TABLE `attendance_request` ADD COLUMN `leave_type` VARCHAR(10) NULL;

UPDATE `attendance_request` SET `leave_type` = 'CL' WHERE `type` = 'LEAVE' AND `leave_type` IS NULL;
