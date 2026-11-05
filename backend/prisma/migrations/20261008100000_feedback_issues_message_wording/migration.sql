-- Project Management → Feedback: the studio's new wording for the Feedback Issues message - the
-- note a client is sent when their feedback is filed under Issues.
--
-- Replaced only where the template still holds the wording it was created with
-- (20261006160000_feedback_message_templates), so a message the studio has already reworded in
-- Settings → Message Templates is left as they wrote it. Line breaks are written as CHAR(10), and
-- compared with carriage returns removed, so the result is the same whichever line endings the file
-- or the stored text has. Re-runnable: once replaced, the old wording no longer matches.

UPDATE `message_template`
SET `body` = CONCAT('Hi {client name},', CHAR(10), CHAR(10), 'Thank you for sharing your feedback about your project. We’ve received it and will review the issues you raised. Our team will get back to you soon.', CHAR(10), CHAR(10), 'Please mention {feedback id} if you contact us about your feedback. Thank you for your patience.')
WHERE `key` = 'FEEDBACK_ISSUES'
  AND REPLACE(`body`, CHAR(13), '') = CONCAT('Hi {client name},', CHAR(10), CHAR(10), 'Thank you for your prompt feedback on your {shoot}. We have logged it as Feedback ID {feedback id}. It helps us grow, and our team will sort out the issues you have raised and get back to you shortly.', CHAR(10), CHAR(10), 'Please quote {feedback id} if you contact us about it. Thank you for your patience.');
