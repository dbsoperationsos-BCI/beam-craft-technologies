-- The two messages the employee screens hand over, as wording the studio owns.
--
-- Both already existed as sentences hardcoded in their dialogs - `OnboardingInviteDialog` and
-- `CredentialsCreatedDialog` - which meant the one message a studio most wants to word its own way
-- was the one it could not touch. They are templates now, beside the cash receipt.
--
-- **These are the copy-and-send messages, not the emails.** Both screens still send their own email
-- with its own wording; this is the version a person pastes into WhatsApp, which is the one that has
-- to work when the mail quota is spent or the mail simply never arrives.
--
-- Seeded with the exact wording each dialog printed before, so nothing reads differently on the day
-- this ships and the Settings box opens on the real message rather than empty. `WHERE NOT EXISTS`
-- rather than a plain INSERT: a studio that has already written either of these keeps what it wrote,
-- and re-running the migration is not a way to lose it.
INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'EMPLOYEE_ONBOARDING_INVITE', 'Employee Invite', 'Hi {candidate name},

Welcome aboard. Please complete your onboarding details here:
{onboarding link}

The link is open until {expiry date}. You will be asked for your email or phone number to open it — use the one you gave us.

Please keep this link to yourself.'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'EMPLOYEE_ONBOARDING_INVITE');

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'LOGIN_CREDENTIALS', 'Login Credential', 'Hi {employee name},

Your login has been created. Sign in with:

Username: {username}
Login email: {login email}
Temporary password: {temporary password}

Login here: {login link}

You will be asked to choose your own password the first time you sign in.
Please do not share these details with anybody.'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'LOGIN_CREDENTIALS');
