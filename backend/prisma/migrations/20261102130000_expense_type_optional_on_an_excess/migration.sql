-- An expense submission settling an **excess** is unspent advance money being handed back, so there
-- is nothing it was spent on to name. The form no longer asks what the expense was for on those
-- lines, so the column has to accept NULL. Every other itemising kind still requires one, which the
-- request's own validation enforces -- a line never stores `''` to mean "none".
--
-- Widening a NOT NULL column to NULL cannot fail on existing data: every row already holds a value.
ALTER TABLE `payment_request_expense` MODIFY COLUMN `expense_type` VARCHAR(60) NULL;
