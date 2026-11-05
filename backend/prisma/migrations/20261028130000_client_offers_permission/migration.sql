-- `SALES / Client Offers`: Sales -> Client Offers, the offers on the Home page of the clients' app.
-- Read to see them, Read / Write to add, change or remove them.
--
-- Here as well as in `seeds/permission-catalogue.js` because the seed cannot be run on production;
-- the seed upserts on `module + feature + level`, so a seeded database finds this row rather than
-- making a second.
--
-- Granted Read / Write to the SUPER_ADMIN role only. Every other role starts at DISABLED; the studio
-- grants it in Role Management.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'SALES', 'Client Offers', 'CLIENT_OFFER_MANAGE', 'Client Offers', 'The offers shown on the Home page of the clients'' app: see them (Read), and add, change or remove them (Read / Write)', 1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'SALES' AND `existing`.`feature` = 'Client Offers' AND `existing`.`level` = 'CLIENT_OFFER_MANAGE'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'SALES' AND `permission`.`feature` = 'Client Offers' AND `permission`.`level` = 'CLIENT_OFFER_MANAGE'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
