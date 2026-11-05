-- The studio's branch table, under its own name.
--
-- `location` has always been the branch list - Erode TN, Tiruppur TN, Coimbatore TN, Bangalore KA,
-- Hyderabad TL, Visakhapatnam AP - and everything that points at it already calls the column
-- `branch_id`: `user`, `asset` and `role_branch`. Only the table disagreed, and every free-text
-- branch column elsewhere is about to become a foreign key to it, so it is renamed before six
-- more tables learn the wrong name.
--
-- No row changes and no column changes. This is the rename and nothing else; the columns that
-- happen to be called `location` on other tables - a bride's location, a bank's, the shoot's -
-- are not branches and are not touched.
--
-- ── What the rename carries with it ─────────────────────────────────────────────────────────────
--
-- MySQL re-points a foreign key when the table it references is renamed, and keeps the
-- constraint's name. The three constraints are named after their own table and column
-- (`user_branch_id_fkey`, `asset_branch_id_fkey`, `role_branch_branch_id_fkey`), which is the
-- name Prisma expects whatever the target table is called, so they need nothing here.
--
-- The two indexes on the table itself are the exception: their names carry the table's, and
-- Prisma names an index after the table it sits on. Left as `location_*`, the next
-- `migrate diff` would report the schema and the database disagree. They are renamed to match.
--
-- ── Cost of applying ────────────────────────────────────────────────────────────────────────────
--
-- RENAME TABLE and RENAME INDEX are metadata operations in InnoDB: no rows are read or written,
-- and the table is not rebuilt. Instant at any size.

RENAME TABLE `location` TO `branch`;

ALTER TABLE `branch`
  RENAME INDEX `location_code_key` TO `branch_code_key`,
  RENAME INDEX `location_is_active_name_idx` TO `branch_is_active_name_idx`;
