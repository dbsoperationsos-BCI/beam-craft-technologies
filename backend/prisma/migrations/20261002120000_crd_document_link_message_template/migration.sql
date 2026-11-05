-- CRD Documents → Create Link → CRD Link Ready: the wording a client's CRD form link is handed over
-- in, from Copy or Send WhatsApp (into the project's own group). Edited in Settings → Message
-- Templates → CRD Document Link.
--
-- Placeholders, filled by the dialog: {client name}, {event id}, {crd link}.
--
-- Written only when absent, so a studio that has already worded it keeps its own.
--
-- Cost: one row. Instant.

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'CRD_DOCUMENT_LINK', 'CRD Document Link', 'Hi {client name},

Please fill in your CRD document here:
{crd link}

It opens without a sign-in and saves as you go, so you can come back to it.'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'CRD_DOCUMENT_LINK');
