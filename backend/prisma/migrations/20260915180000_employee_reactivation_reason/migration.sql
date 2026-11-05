-- Why somebody in the InActive tab was brought back to work, and by whom.
--
-- Move to Active removes the offboarding record it takes back, so without these columns a reversed
-- departure would leave no trace at all: the status would simply read Active again and nobody could
-- say why. Nullable throughout - every employee already on the books predates the question, and an
-- employee who has never left is never asked it.
ALTER TABLE `employee`
  ADD COLUMN `reactivation_reason` TEXT NULL,
  ADD COLUMN `reactivated_at` DATETIME(3) NULL,
  ADD COLUMN `reactivated_by_user_id` INT NULL;
