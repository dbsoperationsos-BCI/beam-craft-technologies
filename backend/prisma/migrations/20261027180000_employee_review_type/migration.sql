-- A review is CYCLIC (the regular, scheduled review) or SPOT (an outcome and remarks between them).
-- Additive: every existing review is a cyclic one.
ALTER TABLE `employee_review` ADD COLUMN `review_type` VARCHAR(20) NOT NULL DEFAULT 'CYCLIC';
