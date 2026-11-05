-- Settings → Wishes: ten Birthday Wishes and ten (wedding) Anniversary Wishes the studio sends its people,
-- kept as message templates (`message_template`, keys `BIRTHDAY_WISH_01`..`10` and
-- `WEDDING_ANNIVERSARY_WISH_01`..`10`) and edited on their own section, behind their own permission.
-- `{employee name}` is the employee's name; `{spouse name}` the spouse's name on their record.
--
-- `INSERT IGNORE` on the key: a wish the studio has already written is never put back to this wording.
--
-- `SETTINGS / Wishes`, the permission the section and its endpoint answer to - written here as well as in
-- `seeds/permission-catalogue.js` because the seed cannot be run on production (IAM.md step 10).
-- **SUPER_ADMIN alone is granted it.** Tick it in Administration → Roles for any other role that should
-- see or write the wishes, and re-save them.
--
-- Cost: twenty rows, one permission row and one grant. Instant.

INSERT IGNORE INTO `message_template` (`key`, `name`, `body`) VALUES
  ('BIRTHDAY_WISH_01', 'Birthday Wish 1', 'Happy Birthday, {employee name}! Wishing you a year filled with joy, good health and beautiful moments - just like the ones you help us capture.'),
  ('BIRTHDAY_WISH_02', 'Birthday Wish 2', 'Dear {employee name}, warmest birthday wishes from all of us. Thank you for the energy and creativity you bring to the team every day.'),
  ('BIRTHDAY_WISH_03', 'Birthday Wish 3', 'Happy Birthday, {employee name}! May this year bring you new opportunities, great achievements and plenty of reasons to smile.'),
  ('BIRTHDAY_WISH_04', 'Birthday Wish 4', 'Wishing you a very happy birthday, {employee name}. May your day be as bright and memorable as the stories you help us tell.'),
  ('BIRTHDAY_WISH_05', 'Birthday Wish 5', 'Many happy returns of the day, {employee name}! Have a wonderful celebration with the people you love.'),
  ('BIRTHDAY_WISH_06', 'Birthday Wish 6', 'Happy Birthday, {employee name}! Here is to another year of growth, success and happiness - we are glad to have you with us.'),
  ('BIRTHDAY_WISH_07', 'Birthday Wish 7', 'Dear {employee name}, on your special day we wish you good health, lasting happiness and every success in the year ahead.'),
  ('BIRTHDAY_WISH_08', 'Birthday Wish 8', 'Cheers to you, {employee name}! Have a fantastic birthday and an even better year ahead.'),
  ('BIRTHDAY_WISH_09', 'Birthday Wish 9', 'Happy Birthday, {employee name}! May all your dreams take beautiful shape this year, frame by frame.'),
  ('BIRTHDAY_WISH_10', 'Birthday Wish 10', 'Warm wishes on your birthday, {employee name}. Thank you for being such a valued part of our family. Enjoy your day!'),
  ('WEDDING_ANNIVERSARY_WISH_01', 'Wedding Anniversary Wish 1', 'Happy Wedding Anniversary, {employee name} and {spouse name}! Wishing you both a lifetime of love, laughter and togetherness.'),
  ('WEDDING_ANNIVERSARY_WISH_02', 'Wedding Anniversary Wish 2', 'Dear {employee name}, warm wishes to you and {spouse name} on your anniversary. May your bond grow stronger with every passing year.'),
  ('WEDDING_ANNIVERSARY_WISH_03', 'Wedding Anniversary Wish 3', 'Happy Anniversary, {employee name}! May the love you share with {spouse name} keep shining as bright as your wedding day.'),
  ('WEDDING_ANNIVERSARY_WISH_04', 'Wedding Anniversary Wish 4', 'Wishing {employee name} and {spouse name} a very happy anniversary - may your journey together be filled with beautiful memories.'),
  ('WEDDING_ANNIVERSARY_WISH_05', 'Wedding Anniversary Wish 5', 'Congratulations on another wonderful year together, {employee name} and {spouse name}! Happy Anniversary.'),
  ('WEDDING_ANNIVERSARY_WISH_06', 'Wedding Anniversary Wish 6', 'Dear {employee name}, happy wedding anniversary! May your home always be full of love, peace and happiness.'),
  ('WEDDING_ANNIVERSARY_WISH_07', 'Wedding Anniversary Wish 7', 'Happy Anniversary to a lovely couple, {employee name} and {spouse name}. Here is to many more years of joy together.'),
  ('WEDDING_ANNIVERSARY_WISH_08', 'Wedding Anniversary Wish 8', 'Warmest anniversary wishes, {employee name}! May every year together be better than the last.'),
  ('WEDDING_ANNIVERSARY_WISH_09', 'Wedding Anniversary Wish 9', 'Happy Wedding Anniversary, {employee name} and {spouse name}! Celebrating the love that brought you together and keeps you together.'),
  ('WEDDING_ANNIVERSARY_WISH_10', 'Wedding Anniversary Wish 10', 'On your special day, {employee name}, we wish you and {spouse name} endless love, understanding and happiness. Happy Anniversary!');

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'SETTINGS', 'Wishes', 'SETTINGS_WISHES', 'Wishes',
       'Settings → Wishes: the birthday and anniversary wishes the studio sends its people',
       1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'SETTINGS' AND `existing`.`feature` = 'Wishes' AND `existing`.`level` = 'SETTINGS_WISHES'
);

-- SUPER_ADMIN holds every permission there is, and cannot be edited from Administration → Roles.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'SETTINGS' AND `permission`.`feature` = 'Wishes' AND `permission`.`level` = 'SETTINGS_WISHES'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
