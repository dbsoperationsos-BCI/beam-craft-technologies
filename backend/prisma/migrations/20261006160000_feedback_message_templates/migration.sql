-- Project Management → Feedback: the two messages a client is answered with once their feedback is
-- given, copied from the Feedback page's message box. Edited in Settings → Message Templates.
--
-- Feedback Thank You - an Excellent or Good review (filed Completed): thanks, a request for a
-- review on the branch's Google page, and its social media accounts to follow.
-- Feedback Issues - an Average or Poor review (filed Issues): thanks for the prompt feedback, its
-- Feedback ID to quote, and word that the team will sort the issues out.
--
-- Placeholders, filled by the dialog: {client name}, {event id}, {shoot}; for the thank-you
-- {google review link} and {social links} - the branch's links from Settings → Organization →
-- Branches, one line each for those it has; and for Issues {feedback id}, as DBS-FB-00001.
--
-- Written only when absent, so a studio that has already worded either keeps its own. No
-- permission: the templates are read under PROJECT / Feedback, added to the read list in code.
--
-- Cost: two rows. Instant.

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'FEEDBACK_THANK_YOU', 'Feedback Thank You', 'Hi {client name},

Thank you for your wonderful feedback on your {shoot}! It means a lot to our whole team.

If you enjoyed working with us, we would be grateful for a review here:
{google review link}

Follow us for more of our work:
{social links}'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'FEEDBACK_THANK_YOU');

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'FEEDBACK_ISSUES', 'Feedback Issues', 'Hi {client name},

Thank you for your prompt feedback on your {shoot}. We have logged it as Feedback ID {feedback id}. It helps us grow, and our team will sort out the issues you have raised and get back to you shortly.

Please quote {feedback id} if you contact us about it. Thank you for your patience.'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'FEEDBACK_ISSUES');
