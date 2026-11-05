-- Branch transfer: a third kind of cash entry, money moving from one branch's account to another's.
--
-- The entry is filed in the books of the branch the money left (`branch` / `branch_id`, as every
-- entry already is); `to_branch_id` is the branch it landed in. A transfer moves the studio's own
-- money and has no client, so `client_name` stops being required - every existing row keeps its
-- value, and only a transfer is written without one.
--
-- Additive only: a nullable column, an index and a key, and a NOT NULL relaxed. Nothing existing is
-- rewritten, so it cannot fail on production data.

ALTER TABLE `cash_entry` MODIFY `client_name` VARCHAR(191) NULL;

ALTER TABLE `cash_entry` ADD COLUMN `to_branch_id` INT NULL;

CREATE INDEX `cash_entry_to_branch_id_idx` ON `cash_entry` (`to_branch_id`);

ALTER TABLE `cash_entry`
  ADD CONSTRAINT `cash_entry_to_branch_id_fkey` FOREIGN KEY (`to_branch_id`) REFERENCES `branch` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
