-- Two designations the studio asked for: Production Manager and Branch Partner.
--
-- The Intended Designation dropdown on an onboarding invite - and the Designation field on the
-- employee record beside it - is drawn from the `designation` table, not from the code: the
-- frontend's `designationOptions` is only the fallback for a database whose list is empty, so
-- adding a role there alone would appear on nobody's screen. The list is HR's own, maintained from
-- Employee Repository -> Settings, which is why these arrive as rows rather than as constants.
--
-- `INSERT IGNORE`, and the code is the unique key, so this is a no-op wherever HR has already added
-- one of the two by hand - it will not overwrite a name they chose or resurrect one they retired.
-- The same statement 20260819120000 seeded the original 28 with, in the same UPPER_SNAKE_CASE the
-- rest of that table uses.
--
-- Cost: two rows. Instant.

INSERT IGNORE INTO `designation` (`code`, `name`, `updated_at`) VALUES
  ('PRODUCTION_MANAGER', 'Production Manager', NOW(3)),
  ('BRANCH_PARTNER', 'Branch Partner', NOW(3));
