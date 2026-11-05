-- A booking's client number may be unknown: Pre Production → Import brings in the studio's old
-- sheet, where many bookings carry none, and leaves it empty to be added on the project rather than
-- refusing the booking. Every form that saves a project still asks for it.
--
-- Only NOT NULL is relaxed; nothing is rewritten. Cost: one column definition on `sales_project`.

ALTER TABLE `sales_project` MODIFY `client_main_number` VARCHAR(30) NULL;
