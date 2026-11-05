-- The one colleague who approves this person's permission requests - an hour or two out of a single
-- day - set from the Permission Approval section of the Create Login Credentials form.
--
-- One slot rather than the three a leave goes through: a permission is settled the same morning it
-- is asked for, and a queue of three is a queue for a decision nobody needs to escalate. Left NULL
-- the request falls to the leave approvers, which is what every row here starts as.
ALTER TABLE `employee`
  ADD COLUMN `permission_approver_employee_id` INT NULL;

CREATE INDEX `employee_permission_approver_employee_id_idx`
  ON `employee` (`permission_approver_employee_id`);
