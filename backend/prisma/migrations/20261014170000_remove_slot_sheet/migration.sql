-- Sales & CRM -> Slot Sheet is taken out of the app: its page, its endpoints, the calendar's Block
-- Period and `SALES / Slot Sheet` all go, and with them what 20261014120000 and 20261014130000 added.
--
-- The permission row is deleted, not switched off: `role_permission`, `role_permission_scope` and
-- `branch_admin_permission` all cascade from `permission`, so every grant of it goes too.
-- `seeds/permission-catalogue.js` no longer lists it, so a seeded environment does not bring it back.
--
-- The two tables are dropped with every booking and block in them, and the studio hours. Nothing else
-- points at them; their own keys to branch, lead, vertical, employee and user go with them.
--
-- Cost: one row, its grants and two small tables. Instant.

DELETE FROM `permission`
WHERE `module` = 'SALES' AND `feature` = 'Slot Sheet' AND `level` = 'SALES_SLOT_SHEET';

DROP TABLE IF EXISTS `slot_booking`;

DROP TABLE IF EXISTS `slot_sheet_settings`;
