-- Settings -> Templates -> Interview Welcome -> After hours: the message a candidate from a linked
-- interview sheet is sent when they arrive outside office time (the attendance shift on a working day),
-- on a weekly off or on a holiday. Interview Welcome itself is the office-time message. A starting
-- wording - the same screening questions, saying the office is closed - for the studio to edit; one the
-- studio has already written is left alone (`WHERE NOT EXISTS`).
--
-- Cost: one row. Nothing else is touched.

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'INTERVIEW_WELCOME_AFTER_HOURS', 'Interview Welcome - After hours', 'Hey thanks for your interest on this job. Our office is closed for now - we will get back to you on the next working day. Meanwhile, please fill this questions

1. Which position are you applying for?
2. What all softwares do you know?
3. When Can you join?
4. What is your Expected Salary?
5. What is your least Expected Salary?
6. How many years of experience do you have?
7. What is your Current Company?
8. What is your current Salary?
9. Where are you from?
10. Reason for leaving the present company?
11. Your Native place?'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'INTERVIEW_WELCOME_AFTER_HOURS');
