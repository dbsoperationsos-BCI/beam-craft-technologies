-- Payroll -> Main Page locks a month once its payable date has passed: from then on only somebody holding
-- `HRM / Payroll After Payday` may change it (save a row, mark it Paid, remove or restore one, skip a
-- deduction, fill in a month never made). Reading it is never locked. Written here as well as in
-- `seeds/permission-catalogue.js` because the seed cannot be run on production (IAM.md step 10).
-- **SUPER_ADMIN alone is granted it**, as the studio asked.
--
-- Cost: one permission row and one grant. Instant.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'HRM', 'Payroll After Payday', 'PAYROLL_AFTER_PAYDAY', 'Payroll After Payday',
       'Payroll -> Main Page: change a month after its payable date has passed (Read / Write)',
       1, NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'HRM' AND `existing`.`feature` = 'Payroll After Payday' AND `existing`.`level` = 'PAYROLL_AFTER_PAYDAY'
);

-- SUPER_ADMIN holds every permission there is, and cannot be edited from Administration -> Roles.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'HRM' AND `permission`.`feature` = 'Payroll After Payday' AND `permission`.`level` = 'PAYROLL_AFTER_PAYDAY'
WHERE `role`.`name` = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
