-- Settings → Wishes → Work Anniversary Wishes: ten wishes sent on each year an employee completes with
-- the studio, counted from their Date Of Joining (the 1st anniversary onwards), the same way and by the
-- same Wishes Scheduler as the Birthday and Anniversary Wishes. Kept as message templates
-- (`message_template`, keys `WORK_ANNIVERSARY_WISH_01`..`10`). `{employee name}` is the employee's
-- name; `{years}` the years they have completed ("3 years").
--
-- `INSERT IGNORE` on the key: a wish the studio has already written is never put back to this wording.
-- No new permission: the section answers to `SETTINGS / Wishes`, as the other two do.
--
-- Cost: ten rows. Instant.

INSERT IGNORE INTO `message_template` (`key`, `name`, `body`) VALUES
  ('WORK_ANNIVERSARY_WISH_01', 'Work Anniversary Wish 1', 'Happy Work Anniversary, {employee name}! Thank you for {years} of creativity, hard work and beautiful moments with Don''t Blink Studios.'),
  ('WORK_ANNIVERSARY_WISH_02', 'Work Anniversary Wish 2', 'Congratulations, {employee name}, on completing {years} with us! The team is better for having you in it.'),
  ('WORK_ANNIVERSARY_WISH_03', 'Work Anniversary Wish 3', 'Dear {employee name}, {years} and counting! Thank you for every shoot, every edit and every smile you have brought to the studio.'),
  ('WORK_ANNIVERSARY_WISH_04', 'Work Anniversary Wish 4', 'Happy Work Anniversary, {employee name}! Here is to {years} of growing together - and many more stories still to capture.'),
  ('WORK_ANNIVERSARY_WISH_05', 'Work Anniversary Wish 5', 'Today {employee name} completes {years} with Don''t Blink Studios. Thank you for your dedication - we are proud to have you on the team.'),
  ('WORK_ANNIVERSARY_WISH_06', 'Work Anniversary Wish 6', 'Cheers to {years}, {employee name}! Your passion and effort make a difference every single day. Happy Work Anniversary!'),
  ('WORK_ANNIVERSARY_WISH_07', 'Work Anniversary Wish 7', 'Happy Work Anniversary, {employee name}! {years} of memories made and moments captured - thank you for being part of our journey.'),
  ('WORK_ANNIVERSARY_WISH_08', 'Work Anniversary Wish 8', 'Congratulations on {years} with the studio, {employee name}! Wishing you continued success and joy in the years ahead.'),
  ('WORK_ANNIVERSARY_WISH_09', 'Work Anniversary Wish 9', 'Dear {employee name}, thank you for {years} of commitment, teamwork and talent. Happy Work Anniversary from all of us!'),
  ('WORK_ANNIVERSARY_WISH_10', 'Work Anniversary Wish 10', 'Happy Work Anniversary, {employee name}! {years} ago you joined us, and the studio has been brighter ever since.');
