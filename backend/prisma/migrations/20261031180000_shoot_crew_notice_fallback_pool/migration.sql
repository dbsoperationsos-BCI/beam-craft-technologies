-- Shoot crew notice: the third chosen sender goes. Priority 1 and Priority 2 are still chosen, and
-- behind them every other employee with Allow WhatsApp ticked is tried in name order - the same
-- fallback the daily attendance report uses, which is what the studio asked for.
--
-- The column is dropped rather than left unused: the feature has not been released, so nothing has
-- been chosen in it, and a column nothing reads is a trap for whoever reads this table next.
ALTER TABLE `shoot_crew_notice_settings` DROP FOREIGN KEY `shoot_crew_notice_settings_sender_fallback_user_id_fkey`;
DROP INDEX `shoot_crew_notice_settings_sender_fallback_user_id_idx` ON `shoot_crew_notice_settings`;
ALTER TABLE `shoot_crew_notice_settings` DROP COLUMN `sender_fallback_user_id`;
