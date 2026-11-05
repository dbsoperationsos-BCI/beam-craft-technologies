-- The project's WhatsApp group invite link (https://chat.whatsapp.com/...), pasted by the team on
-- Pre Production -> General, for the client to join the group from their app.
--
-- One nullable column added, no existing value changed, so there is nothing to fail on production data.

ALTER TABLE `sales_project` ADD COLUMN `whatsapp_group_invite_link` VARCHAR(255) NULL;
