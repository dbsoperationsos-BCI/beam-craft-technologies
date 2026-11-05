-- Getting Dresses Images, Getting Decor Images and Post Wedding Gift move from a Pending/Completed
-- progress column to a plain yes/no one, drawn as the same radio pair every other checklist toggle
-- already uses (Site Visit, Team Reached Message, ...) rather than a status dropdown.
--
-- A straight `MODIFY COLUMN` from VARCHAR to a boolean would let MySQL cast each string on its own
-- terms rather than on the meaning it actually carries here, so the value is carried across through
-- a temporary column instead: "Completed" becomes true. "Pending" is not the same as a row nobody
-- has touched - a new row is created with these columns absent, and "Pending" is only ever written
-- by somebody actually opening the dropdown and choosing it - so it is the deliberate "not done yet"
-- answer and becomes false, the same distinction `yesNoField.js` draws between "No" and unanswered.
-- Only a row that was already null - never opened - stays null.
ALTER TABLE `project_pre_production`
  ADD COLUMN `getting_dresses_images_yn` TINYINT(1) NULL,
  ADD COLUMN `getting_decor_images_yn` TINYINT(1) NULL,
  ADD COLUMN `post_wedding_gift_yn` TINYINT(1) NULL;

UPDATE `project_pre_production`
   SET `getting_dresses_images_yn` = CASE WHEN `getting_dresses_images` = 'Completed' THEN 1 WHEN `getting_dresses_images` = 'Pending' THEN 0 ELSE NULL END,
       `getting_decor_images_yn` = CASE WHEN `getting_decor_images` = 'Completed' THEN 1 WHEN `getting_decor_images` = 'Pending' THEN 0 ELSE NULL END,
       `post_wedding_gift_yn` = CASE WHEN `post_wedding_gift` = 'Completed' THEN 1 WHEN `post_wedding_gift` = 'Pending' THEN 0 ELSE NULL END;

ALTER TABLE `project_pre_production`
  DROP COLUMN `getting_dresses_images`,
  DROP COLUMN `getting_decor_images`,
  DROP COLUMN `post_wedding_gift`;

ALTER TABLE `project_pre_production`
  CHANGE COLUMN `getting_dresses_images_yn` `getting_dresses_images` TINYINT(1) NULL,
  CHANGE COLUMN `getting_decor_images_yn` `getting_decor_images` TINYINT(1) NULL,
  CHANGE COLUMN `post_wedding_gift_yn` `post_wedding_gift` TINYINT(1) NULL;
