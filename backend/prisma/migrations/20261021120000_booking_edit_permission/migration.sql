-- `SALES / Booking Edit`: the permission that lets a role edit a booking on Bookings & Converted -
-- the sale's own details, its payment schedule and its client login - without being staffed on the
-- project, a branch
-- administrator or holding `PROJECT / Show All Projects`.
--
-- It widens no reading: the write still looks its project up through the caller's own data scope, so
-- it reaches the bookings they can already see and answers 404 for anything else.
--
-- Here as well as in `seeds/permission-catalogue.js` because the seed cannot be run on production;
-- the seed upserts on `module + feature + level`, so a seeded database finds this row rather than
-- making a second.
--
-- Granted Read / Write to the SUPER_ADMIN role only. Every other role starts at DISABLED; the studio
-- grants it in Role Management. It takes nothing away: whoever may edit a booking today still may.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'SALES', 'Booking Edit', 'SALESPROJECT_BOOKING_EDIT', 'Edit Bookings', 'Read / Write to edit a booking on Bookings & Converted - the sale''s own details, its payment schedule and its client login - without being staffed on the project. Only the bookings this person can already see; creating one is Manage Sales Projects, and deleting it stays with the Project Manager', 1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'SALES' AND `existing`.`feature` = 'Booking Edit' AND `existing`.`level` = 'SALESPROJECT_BOOKING_EDIT'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'SALES' AND `permission`.`feature` = 'Booking Edit' AND `permission`.`level` = 'SALESPROJECT_BOOKING_EDIT'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
