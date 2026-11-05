-- Create Project → Client Login Ready: the wording a client's login is handed over in.
--
-- Its own template rather than the employee's Login Credential one, because the two say different
-- things: a client signs in by username with no login email, and keeps the password the studio gives
-- them - they cannot change it - where an employee's wording names a login email and a password to be
-- replaced. Edited in Settings → Message Templates → Client Login Credentials.
--
-- Placeholders, filled by the dialog: {project name}, {username}, {password}, {login link}.
--
-- Written only when absent, so a studio that has already worded it keeps its own.
--
-- Cost: one row. Instant.

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'CLIENT_LOGIN_CREDENTIALS', 'Client Login Credential', 'Hi,

Your login for {project name} has been created. Sign in with:

Username: {username}
Password: {password}

Login here: {login link}

Please do not share these details with anybody.'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'CLIENT_LOGIN_CREDENTIALS');
