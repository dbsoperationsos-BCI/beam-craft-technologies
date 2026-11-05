-- The short, safe reason a production WhatsApp message was not sent ("No WhatsApp group linked",
-- "WhatsApp not connected", ...). It is what every viewer of the shoot is shown; the raw send error
-- stays in `error` and the server log and never leaves the module.
ALTER TABLE `project_production_message`
  ADD COLUMN `reason` VARCHAR(60) NULL;
