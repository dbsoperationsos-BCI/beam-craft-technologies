-- Several UPI IDs per branch, where there was one.
--
-- Settings → Organization → Branches takes a list now: a branch is commonly paid into more than one
-- handle, and the Payment QR beside them encodes only one. The list is the studio's order, the
-- first being the one it leads with, and it is held as JSON for the same reason `aliases` on this
-- table is - these are values the branch owns rather than rows anything points at, and nothing ever
-- looks a branch up by one.
--
-- The UPI ID each branch already holds becomes the first entry of its list, so nothing typed into
-- the single box is lost. A branch that had none gets NULL, which reads as an empty list exactly as
-- `[]` does; only a branch that is saved afterwards is written at all.
--
-- The old column goes once it has been copied. It is a fortnight old, nothing outside this feature
-- ever read it, and leaving it would be a second place a branch's UPI ID could be said to live.
-- `vendor.upi_id` is a different column on a different table and is not touched.
--
-- Written by hand and applied with `prisma migrate deploy`.
ALTER TABLE `branch`
  ADD COLUMN `upi_ids` JSON NULL;

UPDATE `branch`
  SET `upi_ids` = JSON_ARRAY(TRIM(`upi_id`))
  WHERE `upi_id` IS NOT NULL AND TRIM(`upi_id`) <> '';

ALTER TABLE `branch`
  DROP COLUMN `upi_id`;
