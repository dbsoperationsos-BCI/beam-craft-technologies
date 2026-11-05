-- The message that hands somebody their offboarding form, as wording the studio owns.
--
-- The dialog printed a bare link in a read-only box, which left whoever was sending it to write the
-- sentences around it every time: what the link is, how long their notice is, that it asks for the
-- email or phone the studio already holds, and that nothing about their employment changes until HR
-- confirms the dates. A resignation is the message a studio most wants to word in its own voice, so
-- it is a template beside the onboarding invite rather than a sentence in a component.
--
-- **The copy-and-send message, not the email.** The form still sends its own email with its own
-- wording; this is the version a person pastes into WhatsApp, which is the one that has to work when
-- the mail quota is spent or the mail never arrives.
--
-- `WHERE NOT EXISTS` rather than a plain INSERT: a studio that has already written this keeps what it
-- wrote, and re-running the migration is not a way to lose it.
INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'EMPLOYEE_OFFBOARDING_FORM', 'Offboarding Form', 'Hi {employee name},

Please confirm your resignation details here:
{offboarding link}

Your notice period is {notice period}. The form asks when your notice starts and shows the last working day it works out to.

The link is open until {expiry date}. You will be asked for the email or phone number on your record to open it.

HR will confirm the dates with you. Nothing about your employment changes until they do.'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'EMPLOYEE_OFFBOARDING_FORM');

-- And the three messages the rest of the flow sends, for the same reason.
--
-- A reminder for a form nobody has filled in; the confirmation once HR records the resignation,
-- which is the message a leaver keeps and the one that states the dates they will be held to; and
-- the refusal, which carries HR's own remark rather than leaving somebody to be told nothing. Each
-- is offered from the form's row in the register, to copy and send.
INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'EMPLOYEE_OFFBOARDING_REMINDER', 'Offboarding Reminder', 'Hi {employee name},

A reminder that your offboarding form is still waiting for you:
{offboarding link}

It only asks when your notice starts. The link is open until {expiry date}, and your notice period is {notice period}.

Let HR know if the link will not open for you.'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'EMPLOYEE_OFFBOARDING_REMINDER');

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'EMPLOYEE_OFFBOARDING_APPROVED', 'Offboarding Confirmed', 'Hi {employee name},

Your resignation has been recorded. Your notice starts on {notice start date} and your last working day with us is {last working day}.

You keep your login and mark attendance as usual until then. We will be in touch about the handover and your final settlement.

Thank you for everything.'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'EMPLOYEE_OFFBOARDING_APPROVED');

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'EMPLOYEE_OFFBOARDING_NOT_ACCEPTED', 'Offboarding Not Accepted', 'Hi {employee name},

Your offboarding form has not been accepted, so nothing about your employment has changed.

{hr remark}

Please speak to HR before filling in another one.'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'EMPLOYEE_OFFBOARDING_NOT_ACCEPTED');
