-- A schedule may hold several Partial Payments or Extras Services, numbered as they are added -
-- "Partial Payment 1", "Partial Payment 2". That was the two names matched by a regular expression
-- in SchedulePaymentSection.js, so renaming either stopped the numbering and left two rows on the
-- schedule reading identically. The meaning belongs on the row, beside `settles_balance`.
ALTER TABLE `payment_schedule_category` ADD COLUMN `repeatable` BOOLEAN NOT NULL DEFAULT false;

UPDATE `payment_schedule_category` SET `repeatable` = true
  WHERE `code` IN ('PARTIAL_PAYMENT', 'EXTRAS_SERVICES');
