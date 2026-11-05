-- A branch address in its parts, rather than one box of text.
--
-- `address` was a single free-text column: everything a person felt like typing, in whatever order.
-- It could be shown and nothing else. Split into lines, city, state and postal code, the same
-- address can be printed a part at a time on a document, and a postal code can fill in the city and
-- the state from the India Post lookup this application already uses everywhere else.
--
-- What each branch has today is moved into the first line rather than discarded, so no branch loses
-- its address and none opens with an empty form. The first line takes 255 characters, which is more
-- than a street address needs; a longer paragraph in the old column would be trimmed to that, and
-- the trim is why the copy happens before the old column goes.
--
-- Every part is nullable, like the rest of a branch: a branch exists on its name alone.
ALTER TABLE `branch`
  ADD COLUMN `address_line1` VARCHAR(255) NULL AFTER `name`,
  ADD COLUMN `address_line2` VARCHAR(255) NULL AFTER `address_line1`,
  ADD COLUMN `city` VARCHAR(120) NULL AFTER `address_line2`,
  ADD COLUMN `state` VARCHAR(120) NULL AFTER `city`,
  ADD COLUMN `postal_code` VARCHAR(10) NULL AFTER `state`;

UPDATE `branch`
  SET `address_line1` = LEFT(TRIM(`address`), 255)
  WHERE `address` IS NOT NULL AND TRIM(`address`) <> '';

ALTER TABLE `branch` DROP COLUMN `address`;
