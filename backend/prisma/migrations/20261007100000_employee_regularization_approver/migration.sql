-- Employee Repository → Administration → Edit → Employee Preference → Attendance Regularization
-- Approval: the one colleague who approves this person's Attendance Regularization requests.
--
-- A link to the employee, like `permission_approver_employee_id` beside it: indexed, and cleared if
-- that colleague's record is ever deleted. NULL for everybody until HR sets it - and a
-- regularization raised by somebody with none set goes to their Permission Approver, as every one
-- did before this column, so nobody is left unable to raise one. No permission: set on the
-- Employee Preference, which is already behind its own permission.
--
-- Cost: one nullable column, an index and a foreign key on `employee`. Instant on a studio's roster.
ALTER TABLE `employee`
  ADD COLUMN `regularization_approver_employee_id` INT NULL;

CREATE INDEX `employee_regularization_approver_employee_id_idx`
  ON `employee` (`regularization_approver_employee_id`);

ALTER TABLE `employee` ADD CONSTRAINT `employee_regularization_approver_employee_id_fkey` FOREIGN KEY (`regularization_approver_employee_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
