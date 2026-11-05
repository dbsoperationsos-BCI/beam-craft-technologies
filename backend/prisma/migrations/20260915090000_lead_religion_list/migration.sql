-- The religions a Dum Dum quotation may be raised for.
--
-- Shipped empty, deliberately. The studio writes its own list in its own wording; seeding one here
-- would put an outsider's choices into a field about people's beliefs, and every row would then
-- have to be corrected rather than simply entered.
--
-- Shaped exactly like `lead_relationship` beside it, because it is the same kind of thing: a short
-- named list the studio maintains in Settings → Field Settings. What differs is how the form reads
-- it — Relationship is typed-with-suggestions, Religion is a closed dropdown, so the list actually
-- governs the field rather than merely suggesting to it.
--
-- Written by hand and applied with `prisma migrate deploy`.

CREATE TABLE `lead_religion` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` TEXT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `lead_religion_code_key`(`code`),
  INDEX `lead_religion_is_active_name_idx`(`is_active`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
