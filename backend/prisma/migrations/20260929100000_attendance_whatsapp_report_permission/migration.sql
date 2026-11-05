-- `HRM / Attendance WhatsApp Report`: who may link the WhatsApp group the Attendance Register's daily
-- report is sent into at 9:45 am, and send it from their own WhatsApp. Holding it is what gives
-- somebody the register's WhatsApp button (Link the group / the linked group) and the pairing, group
-- list, link and unlink behind it; the scheduled send also checks that whoever linked the group still
-- holds it.
--
-- Here as a migration rather than as a line in the seed alone, because the seed cannot be run on
-- production - a guard naming a permission the table does not hold refuses everybody but a Super
-- Admin. `seeds/permission-catalogue.js` holds the same row and upserts on `module + feature +
-- level`, so a seeded environment finds this one rather than making a second.
--
-- Granted Read / Write to the SUPER_ADMIN role and every active role with the Administrator tick -
-- nobody else. The studio then grants it in Role Management to the role of whoever should send it.
--
-- Cost: one permission row, one grant per administrator role. Instant.

INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'HRM', 'Attendance WhatsApp Report', 'ATTENDANCE_WHATSAPP_REPORT', 'Attendance WhatsApp Report',
       'Link the WhatsApp group the Attendance Register''s daily report is sent to at 9:45 am, and send it from your own WhatsApp',
       1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'HRM' AND `existing`.`feature` = 'Attendance WhatsApp Report' AND `existing`.`level` = 'ATTENDANCE_WHATSAPP_REPORT'
);

INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
FROM `role`
JOIN `permission`
  ON `permission`.`module` = 'HRM' AND `permission`.`feature` = 'Attendance WhatsApp Report' AND `permission`.`level` = 'ATTENDANCE_WHATSAPP_REPORT'
WHERE (`role`.`name` = 'SUPER_ADMIN' OR (`role`.`is_admin` = 1 AND `role`.`is_active` = 1))
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` AS `already`
    WHERE `already`.`roleId` = `role`.`id` AND `already`.`permissionId` = `permission`.`id`
  );
