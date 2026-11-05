-- `HRM / Payslip`: the Payslip screen under HRM in the sidebar (`/hrm/payslip`), empty for now.
--
-- Here as a migration rather than as a line in the seed alone, because the seed cannot be run on
-- production - a guard naming a permission the table does not hold refuses everybody but a Super
-- Admin. `seeds/permission-catalogue.js` holds the same row and upserts on `module + feature +
-- level`, so a seeded environment finds this one rather than making a second.
--
-- Granted Read / Write to the SUPER_ADMIN role only. Every other role starts at DISABLED; the studio
-- grants it in Role Management.
--
-- Cost: one permission row, one grant. Instant.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'HRM', 'Payslip', 'PAYSLIP_VIEW', 'Payslip', 'The Payslip screen', 1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'HRM' AND `existing`.`feature` = 'Payslip' AND `existing`.`level` = 'PAYSLIP_VIEW'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'HRM' AND `permission`.`feature` = 'Payslip' AND `permission`.`level` = 'PAYSLIP_VIEW'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
