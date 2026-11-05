-- HRM -> Payroll -> Main Page -> Payment -> Freeze: a payroll row settled like a paid one before it is
-- paid. While `frozen`, nothing that happens later changes its figures - Refresh passes it by, an
-- advance, a recovery, a skip or a conversion is refused for its month, and its salary rules are
-- kept in `paid_lop_divisor` / `paid_rounding` from the moment it is frozen. Its payment can still
-- be recorded; unfreezing opens it again. Who froze it and when are kept beside the flag, the person
-- an id with its key.
--
-- Cost: three columns on `payroll_entry` (every existing row not frozen, NOT NULL DEFAULT false), one
-- index and one key. No permission change: freezing is a write under `HRM / Payroll Register`.

ALTER TABLE `payroll_entry` ADD COLUMN `frozen` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `frozen_at` DATETIME(3) NULL,
    ADD COLUMN `frozen_by_user_id` INTEGER NULL;

CREATE INDEX `payroll_entry_frozen_by_user_id_idx` ON `payroll_entry`(`frozen_by_user_id`);

ALTER TABLE `payroll_entry` ADD CONSTRAINT `payroll_entry_frozen_by_user_id_fkey` FOREIGN KEY (`frozen_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
