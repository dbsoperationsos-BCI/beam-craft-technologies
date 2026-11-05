-- The Offboarding Confirmed message names the day the leaver's full and final settlement is paid, and
-- says when their salary is held through the notice (Payroll rules → Hold salary during notice).
-- Only the wording this app shipped is replaced: a message the studio has reworded is left as it is.
UPDATE `message_template`
SET `body` = 'Hi {employee name},

Your resignation has been recorded. Your notice starts on {notice start date} and your last working day with us is {last working day}.

You keep your login and mark attendance as usual until then. We will be in touch about the handover. Your final settlement is paid on {final settlement date}. {salary hold}

Thank you for everything.'
WHERE `key` = 'EMPLOYEE_OFFBOARDING_APPROVED'
  AND `body` = 'Hi {employee name},

Your resignation has been recorded. Your notice starts on {notice start date} and your last working day with us is {last working day}.

You keep your login and mark attendance as usual until then. We will be in touch about the handover and your final settlement.

Thank you for everything.';
