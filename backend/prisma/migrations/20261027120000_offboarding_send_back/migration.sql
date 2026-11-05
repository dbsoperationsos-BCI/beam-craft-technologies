-- A submitted offboarding form can be handed back for a correction.
--
-- The missing move between approving and rejecting. A form with the wrong date on it, or a reason
-- that does not match what the person actually said, is not a resignation to refuse - refusing says
-- the exit itself was not accepted, which is a different thing to tell somebody and leaves them
-- nothing to fix. So the form reopens on the same link, still carrying their own answers, with HR's
-- remark saying what to look at.
--
-- Three columns: when it was sent back, what to correct, and who asked. A form carrying them has
-- been round once, which is also how the public form knows to prefill itself as an edit.
--
-- Additive and nullable, so no existing row needs a value and this cannot fail on production data.
ALTER TABLE `employee_offboarding_invite`
  ADD COLUMN `sent_back_at` DATETIME(3) NULL,
  ADD COLUMN `send_back_remark` TEXT NULL,
  ADD COLUMN `sent_back_by_user_id` INTEGER NULL;

CREATE INDEX `employee_offboarding_invite_sent_back_by_user_id_idx` ON `employee_offboarding_invite`(`sent_back_by_user_id`);

ALTER TABLE `employee_offboarding_invite`
  ADD CONSTRAINT `employee_offboarding_invite_sent_back_by_user_id_fkey`
  FOREIGN KEY (`sent_back_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
