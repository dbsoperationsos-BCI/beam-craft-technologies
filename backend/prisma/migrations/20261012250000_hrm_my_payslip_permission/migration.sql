-- HRM → Payslip: the signed-in employee's own payslips, behind `HRM / My Payslip` - written here as
-- well as in `seeds/permission-catalogue.js` because the seed cannot be run on production (IAM.md
-- step 10). **SUPER_ADMIN alone is granted it.** Tick it in Administration → Roles for the roles whose
-- people should see their payslips, and re-save them.
--
-- Cost: one permission row and one grant. Instant.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'HRM', 'My Payslip', 'HRM_MY_PAYSLIP', 'My Payslip',
       'HRM → Payslip: the signed-in employee''s own payslips',
       1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'HRM' AND `existing`.`feature` = 'My Payslip' AND `existing`.`level` = 'HRM_MY_PAYSLIP'
);

-- SUPER_ADMIN holds every permission there is, and cannot be edited from Administration → Roles.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'HRM' AND `permission`.`feature` = 'My Payslip' AND `permission`.`level` = 'HRM_MY_PAYSLIP'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
