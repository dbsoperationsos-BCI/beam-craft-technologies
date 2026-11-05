-- A production plan's ticket status for Bus, Train and Flight: YET_TO_TAKE, TAKEN or ON_THE_FLY.
-- Nullable: plans saved before it was asked keep NULL, which reads as before (a ticket attached
-- completes the travel detail). No backfill.
ALTER TABLE `project_production` ADD COLUMN `ticket_status` VARCHAR(20) NULL;
