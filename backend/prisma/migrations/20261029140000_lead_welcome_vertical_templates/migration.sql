-- Settings → Templates → New Lead Welcome by Vertical: a starting wording for each vertical a lead
-- comes in for - an office-time and an after-hours one, in a formal tone written for that vertical
-- (weddings, children's shoots, corporate work) - for the studio to edit. Keyed by the vertical's id
-- (`newLeadWelcome.verticalTemplateKey`), found by its code, which is the same in every database where
-- the id is not. General and Team 33 are not worded on their own. A wording already written is left
-- alone (`WHERE NOT EXISTS`), and a vertical this database does not have adds nothing.
--
-- Cost: at most six rows. Nothing else is touched.

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT CONCAT('CRM_LEAD_WELCOME_V', v.`id`, '_OFFICE'), CONCAT('New Lead Welcome - ', v.`name`, ' - Office time'), '{greeting} {client name},

Thank you for contacting us about your wedding photography. We have received your enquiry of {day}, {date} at {time} (Reference: {enquiry id}).

I am {sender name}, and I will be personally assisting you. To help us prepare a proposal suited to your celebration, kindly share the following details:
- Wedding date(s)
- Venue and city
- Events to be covered (for example engagement, haldi, wedding, reception)
- Approximate number of guests

We look forward to being a part of your special day.

Warm regards,
{sender name}'
FROM `vertical` v
WHERE v.`code` = 'DUM_DUM'
  AND NOT EXISTS (SELECT 1 FROM `message_template` t WHERE t.`key` = CONCAT('CRM_LEAD_WELCOME_V', v.`id`, '_OFFICE'));

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT CONCAT('CRM_LEAD_WELCOME_V', v.`id`, '_AFTER_HOURS'), CONCAT('New Lead Welcome - ', v.`name`, ' - After hours'), '{greeting} {client name},

Thank you for contacting us about your wedding photography. We have received your enquiry of {day}, {date} at {time} (Reference: {enquiry id}).

Our studio is closed for the day. I am {sender name}, and I will contact you personally on the next working day.

In the meantime, kindly share the following details so that we may prepare for our conversation:
- Wedding date(s)
- Venue and city
- Events to be covered (for example engagement, haldi, wedding, reception)
- Approximate number of guests

Thank you for your patience. We look forward to being a part of your special day.

Warm regards,
{sender name}'
FROM `vertical` v
WHERE v.`code` = 'DUM_DUM'
  AND NOT EXISTS (SELECT 1 FROM `message_template` t WHERE t.`key` = CONCAT('CRM_LEAD_WELCOME_V', v.`id`, '_AFTER_HOURS'));

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT CONCAT('CRM_LEAD_WELCOME_V', v.`id`, '_OFFICE'), CONCAT('New Lead Welcome - ', v.`name`, ' - Office time'), '{greeting} {client name},

Thank you for contacting us about a photoshoot for your little one. We have received your enquiry of {day}, {date} at {time} (Reference: {enquiry id}).

I am {sender name}, and I will be personally assisting you. So that we can plan the shoot around your family, kindly share the following details:
- The occasion (for example maternity, newborn, first birthday)
- Your child''s age, or the expected due date
- Preferred date for the shoot
- Preferred location (our studio, your home or a venue)

We look forward to capturing these precious moments with you.

Warm regards,
{sender name}'
FROM `vertical` v
WHERE v.`code` = 'QUA_QUA'
  AND NOT EXISTS (SELECT 1 FROM `message_template` t WHERE t.`key` = CONCAT('CRM_LEAD_WELCOME_V', v.`id`, '_OFFICE'));

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT CONCAT('CRM_LEAD_WELCOME_V', v.`id`, '_AFTER_HOURS'), CONCAT('New Lead Welcome - ', v.`name`, ' - After hours'), '{greeting} {client name},

Thank you for contacting us about a photoshoot for your little one. We have received your enquiry of {day}, {date} at {time} (Reference: {enquiry id}).

Our studio is closed for the day. I am {sender name}, and I will contact you personally on the next working day.

In the meantime, kindly share the following details so that we may plan the shoot around your family:
- The occasion (for example maternity, newborn, first birthday)
- Your child''s age, or the expected due date
- Preferred date for the shoot
- Preferred location (our studio, your home or a venue)

Thank you for your patience. We look forward to capturing these precious moments with you.

Warm regards,
{sender name}'
FROM `vertical` v
WHERE v.`code` = 'QUA_QUA'
  AND NOT EXISTS (SELECT 1 FROM `message_template` t WHERE t.`key` = CONCAT('CRM_LEAD_WELCOME_V', v.`id`, '_AFTER_HOURS'));

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT CONCAT('CRM_LEAD_WELCOME_V', v.`id`, '_OFFICE'), CONCAT('New Lead Welcome - ', v.`name`, ' - Office time'), 'Dear {client name},

Thank you for contacting us about photography and videography for your organisation. We have received your enquiry of {day}, {date} at {time} (Reference: {enquiry id}).

I am {sender name}, and I will be your point of contact. To help us prepare a proposal suited to your requirement, kindly share the following details:
- Nature of the requirement (for example event coverage, product shoot, corporate headshots, brand film)
- Date(s) and expected duration
- Location
- Company name and the contact person

We would be glad to share a tailored proposal at the earliest.

Best regards,
{sender name}'
FROM `vertical` v
WHERE v.`code` = 'CORP'
  AND NOT EXISTS (SELECT 1 FROM `message_template` t WHERE t.`key` = CONCAT('CRM_LEAD_WELCOME_V', v.`id`, '_OFFICE'));

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT CONCAT('CRM_LEAD_WELCOME_V', v.`id`, '_AFTER_HOURS'), CONCAT('New Lead Welcome - ', v.`name`, ' - After hours'), 'Dear {client name},

Thank you for contacting us about photography and videography for your organisation. We have received your enquiry of {day}, {date} at {time} (Reference: {enquiry id}).

Our office is closed for the day. I am {sender name}, and I will contact you on the next working day.

In the meantime, kindly share the following details so that we may prepare a proposal suited to your requirement:
- Nature of the requirement (for example event coverage, product shoot, corporate headshots, brand film)
- Date(s) and expected duration
- Location
- Company name and the contact person

Thank you for your patience.

Best regards,
{sender name}'
FROM `vertical` v
WHERE v.`code` = 'CORP'
  AND NOT EXISTS (SELECT 1 FROM `message_template` t WHERE t.`key` = CONCAT('CRM_LEAD_WELCOME_V', v.`id`, '_AFTER_HOURS'));
