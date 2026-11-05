-- Up to three colleagues who approve an employee's leave requests, in order — employee
-- references like the alternative (cover) slots beside them, set from the Leave Approval
-- section of the Create Login Credentials form.
ALTER TABLE `employee`
  ADD COLUMN `leave_approver1_employee_id` INT NULL,
  ADD COLUMN `leave_approver2_employee_id` INT NULL,
  ADD COLUMN `leave_approver3_employee_id` INT NULL;
