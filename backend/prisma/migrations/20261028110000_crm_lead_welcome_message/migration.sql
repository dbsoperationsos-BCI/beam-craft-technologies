-- Settings → User Settings → Automatic WhatsApp Message → New Lead Welcome: when a lead arrives on
-- the CRM Leads board from a linked Google Sheet, one WhatsApp message to the lead's number from the
-- WhatsApp of whoever the lead is assigned to. Its switch, off until an administrator turns it on,
-- and the last error, on the HR settings row beside Photo Selection Submitted's. Each message is a
-- `whatsapp_activity` row, so no new table. Guarded by the existing
-- `SETTINGS / Automatic WhatsApp Message` permission, so no permission row.
--
-- Cost: two columns on a one-row table, one template row. Instant.

ALTER TABLE `hrm_settings`
  ADD COLUMN `lead_welcome_enabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `lead_welcome_last_error` TEXT NULL;

-- The wording, edited in Settings → Templates → New Lead Welcome. Placeholders: {client name} (the
-- lead's name) and {sender name} (whoever the lead is assigned to). Written only when absent.
INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'CRM_LEAD_WELCOME', 'New Lead Welcome', 'Hi {client name},

Thank you for reaching out to us! I''m {sender name}, and I''ll be personally taking care of your enquiry.

To help us plan this perfectly for you, could you share:
- Your event date
- The event location
- The type of event

Just reply to this message and I''ll get back to you right away.'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'CRM_LEAD_WELCOME');
