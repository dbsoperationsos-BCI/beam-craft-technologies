-- When the client sent this selection item to the studio.
--
-- `ImageSelectionDeliverableConfig.selectionSubmittedAt` has been in schema.prisma without a
-- migration to create it, so Prisma Client selected a column no database built from these
-- migrations had: every read of the Image Selection project list failed with P2022, "the column
-- selection_submitted_at does not exist".
--
-- Nullable, and no backfill: a null reads as "not submitted", which is what every existing row is.
-- The matching column on `image_selection_gallery_publication` already exists and is untouched.
--
-- ── Added conditionally, and why ──
--
-- The field sat in schema.prisma for a while with no migration behind it, which is precisely the
-- situation `prisma db push` and `prisma migrate dev` resolve by creating the column themselves. So
-- any database a developer pushed to in that window already has it, MySQL has no
-- `ADD COLUMN IF NOT EXISTS`, and the plain ALTER failed there with error 1060, "Duplicate column
-- name 'selection_submitted_at'" - which under `migrate deploy` is not one migration failing but
-- every migration behind it stalling, P3018, until somebody intervenes by hand.
--
-- The same guard `20260901090000_add_crm_lead_estimated_value` carries, for the same error and the
-- same reason. A database that genuinely lacks the column still gets it; one that already has it
-- moves on.
SET @column_exists := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'image_selection_deliverable_config'
     AND column_name = 'selection_submitted_at'
);
SET @statement := IF(
  @column_exists = 0,
  'ALTER TABLE `image_selection_deliverable_config` ADD COLUMN `selection_submitted_at` DATETIME(3) NULL',
  'DO 0'
);
PREPARE add_column FROM @statement;
EXECUTE add_column;
DEALLOCATE PREPARE add_column;
