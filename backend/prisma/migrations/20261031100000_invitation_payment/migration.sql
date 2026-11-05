-- Paying for an invitation: each design has a price (rupees, 0 free); a client's invitation from a
-- priced design gets a few free edits, then sharing and further edits wait on payment. The client
-- asks the studio to unlock it, and the studio records it paid (by whom, for how much).
--
-- New columns on tables added this week, all defaulted or empty, so there is nothing to fail on.

ALTER TABLE `invitation_template`
  ADD COLUMN `price` INTEGER NOT NULL DEFAULT 0;

ALTER TABLE `client_invitation`
  ADD COLUMN `edit_count` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `unlock_requested_at` DATETIME(3) NULL,
  ADD COLUMN `paid_at` DATETIME(3) NULL,
  ADD COLUMN `paid_by` INTEGER NULL,
  ADD COLUMN `paid_amount` INTEGER NULL;
