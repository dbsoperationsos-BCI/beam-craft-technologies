-- WCR on a Production shoot's plan asks when to follow the client up.
--
-- The plan's status (Plan tab -> Status) can be WCR - waiting for the client's reply - as a Pre
-- Production shoot's can. It now needs the next follow-up date with its remarks, kept here and shown
-- on the shoot's tile, its row and the Plan tab. Cleared whenever the status is anything but WCR.
--
-- Cost: one nullable column on project_production. No data written.

ALTER TABLE `project_production` ADD COLUMN `plan_followup_date` DATETIME(3) NULL;
