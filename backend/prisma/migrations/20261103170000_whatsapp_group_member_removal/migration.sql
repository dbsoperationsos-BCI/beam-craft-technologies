-- An employee can now be taken out of a WhatsApp group, not only put into one.
--
-- `status` already carried where an add had got to; it now carries a removal too, because joining and
-- leaving a group are the same fact at different times and a second column would have let a row claim
-- both. The new values are REMOVING (queued), REMOVED, NOT_IN (they were not in it, which is the state
-- wanted) and REMOVE_FAILED. The column is already VARCHAR(20) and the longest of those is 13, so it
-- does not change.
--
-- `removed_at` is the only column added: when WhatsApp confirmed they were out, beside the `added_at`
-- that has always said when it confirmed they were in.
--
-- **Nothing is backfilled and no status is rewritten.** Every existing row keeps the add status it
-- has, and no removal is queued by this - the first removal happens when somebody is relieved after
-- this ships.
--
-- Cost: one nullable column on a table with one row per employee per group. Instant.

ALTER TABLE `employee_whatsapp_group_member` ADD COLUMN `removed_at` DATETIME(3) NULL;
