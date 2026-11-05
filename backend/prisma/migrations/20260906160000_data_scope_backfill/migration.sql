-- The backfill: every reference column added by 20260906150000 (and `employee.branch_id` from
-- 20260906140000) filled from the text beside it, under the rules approved from the match report.
--
-- The rules are the ones `scripts/reportDataScopeBackfill.js` proposed and its tests pin, written
-- here in SQL so the same decision runs on the VPS through `migrate deploy`. `test/data-scope-
-- backfill.test.js` replays every row through the JavaScript matchers afterwards and fails if the
-- SQL and the JavaScript ever answer differently - the two are held to one rule, not two copies.
--
-- Only rows whose reference is still NULL are touched, so this can be applied again without
-- harm, and a row that matches nothing stays NULL: it is reported, never guessed.
--
--   Branch    the branch's exact name (case-insensitive, inner spaces folded), else the first word
--             of a branch's name where that first word belongs to exactly one branch ("Erode" ->
--             "Erode TN"), and "Vizag" for Visakhapatnam. Employees take their work base first and
--             their current location where that is blank.
--   Vertical  the name, the code, the document code or the identifier code, spelling folded the way
--             VERTICAL_SQL folds it (letters and digits only), plus the CRM's own spellings -
--             corporate/corporation/crop -> Corp, wedding/weddings -> Dum Dum. "Not Allocated" is
--             not a vertical and stays NULL.
--   Owner     the employee's id (DBS001), else their full name where exactly one employee has it.
--             A first name alone, or a name two employees share, matches nobody.
--   Tasks     get `owner_employee_id`, derived from the assignee's login: its linked employee, or
--             NULL for a login with none (the Super Admin). Kept in step on every write from now on.
--
-- Cost: one UPDATE ... JOIN per column per rule, each on an indexed reference column that is
-- NULL. Proportional to the rows that match; seconds on the CRM lead table at its current size.

-- ── Tasks: an owner column, derived from the assignee's login ─────────────────────────────────
ALTER TABLE `hrm_task` ADD COLUMN `owner_employee_id` INT NULL AFTER `assigned_to_user_id`;
CREATE INDEX `hrm_task_owner_employee_id_idx` ON `hrm_task` (`owner_employee_id`);
ALTER TABLE `hrm_task`
  ADD CONSTRAINT `hrm_task_owner_employee_id_fkey` FOREIGN KEY (`owner_employee_id`) REFERENCES `employee` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE `hrm_task` t JOIN `user` u ON u.`id` = t.`assigned_to_user_id`
   SET t.`owner_employee_id` = u.`linked_employee_id` WHERE t.`owner_employee_id` IS NULL;

-- ── Branches ──────────────────────────────────────────────────────────────────────────────────
-- sales_crm_lead.assigned_branch -> branch_id
UPDATE `sales_crm_lead` t JOIN `branch` b ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`assigned_branch`,''))), '[[:space:]]+', ' ') = REGEXP_REPLACE(LOWER(TRIM(COALESCE(b.`name`,''))), '[[:space:]]+', ' ')
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL;
UPDATE `sales_crm_lead` t JOIN (SELECT LOWER(SUBSTRING_INDEX(`name`, ' ', 1)) AS w, MIN(`id`) AS id, COUNT(*) AS n FROM `branch` GROUP BY w HAVING n = 1) f
    ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`assigned_branch`,''))), '[[:space:]]+', ' ') = f.w
   SET t.`branch_id` = f.id WHERE t.`branch_id` IS NULL;
UPDATE `sales_crm_lead` t JOIN `branch` b ON LOWER(b.`name`) LIKE 'visakhapatnam%'
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`assigned_branch`,''))), '[[:space:]]+', ' ') = 'vizag';
-- sales_project.source_branch -> branch_id
UPDATE `sales_project` t JOIN `branch` b ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`source_branch`,''))), '[[:space:]]+', ' ') = REGEXP_REPLACE(LOWER(TRIM(COALESCE(b.`name`,''))), '[[:space:]]+', ' ')
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL;
UPDATE `sales_project` t JOIN (SELECT LOWER(SUBSTRING_INDEX(`name`, ' ', 1)) AS w, MIN(`id`) AS id, COUNT(*) AS n FROM `branch` GROUP BY w HAVING n = 1) f
    ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`source_branch`,''))), '[[:space:]]+', ' ') = f.w
   SET t.`branch_id` = f.id WHERE t.`branch_id` IS NULL;
UPDATE `sales_project` t JOIN `branch` b ON LOWER(b.`name`) LIKE 'visakhapatnam%'
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`source_branch`,''))), '[[:space:]]+', ' ') = 'vizag';
-- sales_quotation.source_branch -> branch_id
UPDATE `sales_quotation` t JOIN `branch` b ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`source_branch`,''))), '[[:space:]]+', ' ') = REGEXP_REPLACE(LOWER(TRIM(COALESCE(b.`name`,''))), '[[:space:]]+', ' ')
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL;
UPDATE `sales_quotation` t JOIN (SELECT LOWER(SUBSTRING_INDEX(`name`, ' ', 1)) AS w, MIN(`id`) AS id, COUNT(*) AS n FROM `branch` GROUP BY w HAVING n = 1) f
    ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`source_branch`,''))), '[[:space:]]+', ' ') = f.w
   SET t.`branch_id` = f.id WHERE t.`branch_id` IS NULL;
UPDATE `sales_quotation` t JOIN `branch` b ON LOWER(b.`name`) LIKE 'visakhapatnam%'
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`source_branch`,''))), '[[:space:]]+', ' ') = 'vizag';
-- cash_entry.branch -> branch_id
UPDATE `cash_entry` t JOIN `branch` b ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`branch`,''))), '[[:space:]]+', ' ') = REGEXP_REPLACE(LOWER(TRIM(COALESCE(b.`name`,''))), '[[:space:]]+', ' ')
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL;
UPDATE `cash_entry` t JOIN (SELECT LOWER(SUBSTRING_INDEX(`name`, ' ', 1)) AS w, MIN(`id`) AS id, COUNT(*) AS n FROM `branch` GROUP BY w HAVING n = 1) f
    ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`branch`,''))), '[[:space:]]+', ' ') = f.w
   SET t.`branch_id` = f.id WHERE t.`branch_id` IS NULL;
UPDATE `cash_entry` t JOIN `branch` b ON LOWER(b.`name`) LIKE 'visakhapatnam%'
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`branch`,''))), '[[:space:]]+', ' ') = 'vizag';
-- payment_request.branch -> branch_id
UPDATE `payment_request` t JOIN `branch` b ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`branch`,''))), '[[:space:]]+', ' ') = REGEXP_REPLACE(LOWER(TRIM(COALESCE(b.`name`,''))), '[[:space:]]+', ' ')
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL;
UPDATE `payment_request` t JOIN (SELECT LOWER(SUBSTRING_INDEX(`name`, ' ', 1)) AS w, MIN(`id`) AS id, COUNT(*) AS n FROM `branch` GROUP BY w HAVING n = 1) f
    ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`branch`,''))), '[[:space:]]+', ' ') = f.w
   SET t.`branch_id` = f.id WHERE t.`branch_id` IS NULL;
UPDATE `payment_request` t JOIN `branch` b ON LOWER(b.`name`) LIKE 'visakhapatnam%'
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`branch`,''))), '[[:space:]]+', ' ') = 'vizag';
-- hrm_task.branch -> branch_id
UPDATE `hrm_task` t JOIN `branch` b ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`branch`,''))), '[[:space:]]+', ' ') = REGEXP_REPLACE(LOWER(TRIM(COALESCE(b.`name`,''))), '[[:space:]]+', ' ')
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL;
UPDATE `hrm_task` t JOIN (SELECT LOWER(SUBSTRING_INDEX(`name`, ' ', 1)) AS w, MIN(`id`) AS id, COUNT(*) AS n FROM `branch` GROUP BY w HAVING n = 1) f
    ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`branch`,''))), '[[:space:]]+', ' ') = f.w
   SET t.`branch_id` = f.id WHERE t.`branch_id` IS NULL;
UPDATE `hrm_task` t JOIN `branch` b ON LOWER(b.`name`) LIKE 'visakhapatnam%'
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`branch`,''))), '[[:space:]]+', ' ') = 'vizag';
-- sales_whatsapp_group_name.branch -> branch_id
UPDATE `sales_whatsapp_group_name` t JOIN `branch` b ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`branch`,''))), '[[:space:]]+', ' ') = REGEXP_REPLACE(LOWER(TRIM(COALESCE(b.`name`,''))), '[[:space:]]+', ' ')
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL;
UPDATE `sales_whatsapp_group_name` t JOIN (SELECT LOWER(SUBSTRING_INDEX(`name`, ' ', 1)) AS w, MIN(`id`) AS id, COUNT(*) AS n FROM `branch` GROUP BY w HAVING n = 1) f
    ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`branch`,''))), '[[:space:]]+', ' ') = f.w
   SET t.`branch_id` = f.id WHERE t.`branch_id` IS NULL;
UPDATE `sales_whatsapp_group_name` t JOIN `branch` b ON LOWER(b.`name`) LIKE 'visakhapatnam%'
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`branch`,''))), '[[:space:]]+', ' ') = 'vizag';
-- employee.work_base_location -> branch_id
UPDATE `employee` t JOIN `branch` b ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`work_base_location`,''))), '[[:space:]]+', ' ') = REGEXP_REPLACE(LOWER(TRIM(COALESCE(b.`name`,''))), '[[:space:]]+', ' ')
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL;
UPDATE `employee` t JOIN (SELECT LOWER(SUBSTRING_INDEX(`name`, ' ', 1)) AS w, MIN(`id`) AS id, COUNT(*) AS n FROM `branch` GROUP BY w HAVING n = 1) f
    ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`work_base_location`,''))), '[[:space:]]+', ' ') = f.w
   SET t.`branch_id` = f.id WHERE t.`branch_id` IS NULL;
UPDATE `employee` t JOIN `branch` b ON LOWER(b.`name`) LIKE 'visakhapatnam%'
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`work_base_location`,''))), '[[:space:]]+', ' ') = 'vizag';
-- employee.current_work_location -> branch_id
UPDATE `employee` t JOIN `branch` b ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`current_work_location`,''))), '[[:space:]]+', ' ') = REGEXP_REPLACE(LOWER(TRIM(COALESCE(b.`name`,''))), '[[:space:]]+', ' ')
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL;
UPDATE `employee` t JOIN (SELECT LOWER(SUBSTRING_INDEX(`name`, ' ', 1)) AS w, MIN(`id`) AS id, COUNT(*) AS n FROM `branch` GROUP BY w HAVING n = 1) f
    ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`current_work_location`,''))), '[[:space:]]+', ' ') = f.w
   SET t.`branch_id` = f.id WHERE t.`branch_id` IS NULL;
UPDATE `employee` t JOIN `branch` b ON LOWER(b.`name`) LIKE 'visakhapatnam%'
   SET t.`branch_id` = b.`id` WHERE t.`branch_id` IS NULL AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`current_work_location`,''))), '[[:space:]]+', ' ') = 'vizag';

-- ── Verticals ─────────────────────────────────────────────────────────────────────────────────
-- sales_crm_lead.branch -> vertical_id
UPDATE `sales_crm_lead` t JOIN `vertical` v
    ON REGEXP_REPLACE(LOWER(COALESCE(t.`branch`,'')), '[^a-z0-9]', '') <> '' AND REGEXP_REPLACE(LOWER(COALESCE(t.`branch`,'')), '[^a-z0-9]', '') IN (REGEXP_REPLACE(LOWER(COALESCE(v.`name`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`code`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`document_code`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`identifier_code`,'')), '[^a-z0-9]', ''))
   SET t.`vertical_id` = v.`id` WHERE t.`vertical_id` IS NULL;
UPDATE `sales_crm_lead` t JOIN `vertical` v
    ON LOWER(v.`document_code`) = CASE REGEXP_REPLACE(LOWER(COALESCE(t.`branch`,'')), '[^a-z0-9]', '') WHEN 'corporate' THEN 'corp' WHEN 'corporation' THEN 'corp' WHEN 'crop' THEN 'corp' WHEN 'wedding' THEN 'wed' WHEN 'weddings' THEN 'wed' END
   SET t.`vertical_id` = v.`id` WHERE t.`vertical_id` IS NULL;
-- sales_project.vertical -> vertical_id
UPDATE `sales_project` t JOIN `vertical` v
    ON REGEXP_REPLACE(LOWER(COALESCE(t.`vertical`,'')), '[^a-z0-9]', '') <> '' AND REGEXP_REPLACE(LOWER(COALESCE(t.`vertical`,'')), '[^a-z0-9]', '') IN (REGEXP_REPLACE(LOWER(COALESCE(v.`name`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`code`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`document_code`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`identifier_code`,'')), '[^a-z0-9]', ''))
   SET t.`vertical_id` = v.`id` WHERE t.`vertical_id` IS NULL;
UPDATE `sales_project` t JOIN `vertical` v
    ON LOWER(v.`document_code`) = CASE REGEXP_REPLACE(LOWER(COALESCE(t.`vertical`,'')), '[^a-z0-9]', '') WHEN 'corporate' THEN 'corp' WHEN 'corporation' THEN 'corp' WHEN 'crop' THEN 'corp' WHEN 'wedding' THEN 'wed' WHEN 'weddings' THEN 'wed' END
   SET t.`vertical_id` = v.`id` WHERE t.`vertical_id` IS NULL;
-- sales_whatsapp_group_name.vertical -> vertical_id
UPDATE `sales_whatsapp_group_name` t JOIN `vertical` v
    ON REGEXP_REPLACE(LOWER(COALESCE(t.`vertical`,'')), '[^a-z0-9]', '') <> '' AND REGEXP_REPLACE(LOWER(COALESCE(t.`vertical`,'')), '[^a-z0-9]', '') IN (REGEXP_REPLACE(LOWER(COALESCE(v.`name`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`code`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`document_code`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`identifier_code`,'')), '[^a-z0-9]', ''))
   SET t.`vertical_id` = v.`id` WHERE t.`vertical_id` IS NULL;
UPDATE `sales_whatsapp_group_name` t JOIN `vertical` v
    ON LOWER(v.`document_code`) = CASE REGEXP_REPLACE(LOWER(COALESCE(t.`vertical`,'')), '[^a-z0-9]', '') WHEN 'corporate' THEN 'corp' WHEN 'corporation' THEN 'corp' WHEN 'crop' THEN 'corp' WHEN 'wedding' THEN 'wed' WHEN 'weddings' THEN 'wed' END
   SET t.`vertical_id` = v.`id` WHERE t.`vertical_id` IS NULL;
-- sales_project_crd_document.vertical -> vertical_id
UPDATE `sales_project_crd_document` t JOIN `vertical` v
    ON REGEXP_REPLACE(LOWER(COALESCE(t.`vertical`,'')), '[^a-z0-9]', '') <> '' AND REGEXP_REPLACE(LOWER(COALESCE(t.`vertical`,'')), '[^a-z0-9]', '') IN (REGEXP_REPLACE(LOWER(COALESCE(v.`name`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`code`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`document_code`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`identifier_code`,'')), '[^a-z0-9]', ''))
   SET t.`vertical_id` = v.`id` WHERE t.`vertical_id` IS NULL;
UPDATE `sales_project_crd_document` t JOIN `vertical` v
    ON LOWER(v.`document_code`) = CASE REGEXP_REPLACE(LOWER(COALESCE(t.`vertical`,'')), '[^a-z0-9]', '') WHEN 'corporate' THEN 'corp' WHEN 'corporation' THEN 'corp' WHEN 'crop' THEN 'corp' WHEN 'wedding' THEN 'wed' WHEN 'weddings' THEN 'wed' END
   SET t.`vertical_id` = v.`id` WHERE t.`vertical_id` IS NULL;
-- employee.vertical -> vertical_id
UPDATE `employee` t JOIN `vertical` v
    ON REGEXP_REPLACE(LOWER(COALESCE(t.`vertical`,'')), '[^a-z0-9]', '') <> '' AND REGEXP_REPLACE(LOWER(COALESCE(t.`vertical`,'')), '[^a-z0-9]', '') IN (REGEXP_REPLACE(LOWER(COALESCE(v.`name`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`code`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`document_code`,'')), '[^a-z0-9]', ''), REGEXP_REPLACE(LOWER(COALESCE(v.`identifier_code`,'')), '[^a-z0-9]', ''))
   SET t.`vertical_id` = v.`id` WHERE t.`vertical_id` IS NULL;
UPDATE `employee` t JOIN `vertical` v
    ON LOWER(v.`document_code`) = CASE REGEXP_REPLACE(LOWER(COALESCE(t.`vertical`,'')), '[^a-z0-9]', '') WHEN 'corporate' THEN 'corp' WHEN 'corporation' THEN 'corp' WHEN 'crop' THEN 'corp' WHEN 'wedding' THEN 'wed' WHEN 'weddings' THEN 'wed' END
   SET t.`vertical_id` = v.`id` WHERE t.`vertical_id` IS NULL;

-- ── Owners ────────────────────────────────────────────────────────────────────────────────────
-- sales_crm_lead.crm -> owner_employee_id
UPDATE `sales_crm_lead` t JOIN `employee` e ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`crm`,''))), '[[:space:]]+', ' ') = REGEXP_REPLACE(LOWER(TRIM(COALESCE(e.`employee_id`,''))), '[[:space:]]+', ' ')
   SET t.`owner_employee_id` = e.`id` WHERE t.`owner_employee_id` IS NULL AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`crm`,''))), '[[:space:]]+', ' ') <> '';
UPDATE `sales_crm_lead` t JOIN (SELECT REGEXP_REPLACE(LOWER(TRIM(COALESCE(`employee_name`,''))), '[[:space:]]+', ' ') AS nm, MIN(`id`) AS id, COUNT(*) AS n FROM `employee` GROUP BY nm HAVING n = 1) e
    ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`crm`,''))), '[[:space:]]+', ' ') = e.nm
   SET t.`owner_employee_id` = e.id WHERE t.`owner_employee_id` IS NULL AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`crm`,''))), '[[:space:]]+', ' ') <> '';
-- sales_quotation.followed_by -> owner_employee_id
UPDATE `sales_quotation` t JOIN `employee` e ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`followed_by`,''))), '[[:space:]]+', ' ') = REGEXP_REPLACE(LOWER(TRIM(COALESCE(e.`employee_id`,''))), '[[:space:]]+', ' ')
   SET t.`owner_employee_id` = e.`id` WHERE t.`owner_employee_id` IS NULL AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`followed_by`,''))), '[[:space:]]+', ' ') <> '';
UPDATE `sales_quotation` t JOIN (SELECT REGEXP_REPLACE(LOWER(TRIM(COALESCE(`employee_name`,''))), '[[:space:]]+', ' ') AS nm, MIN(`id`) AS id, COUNT(*) AS n FROM `employee` GROUP BY nm HAVING n = 1) e
    ON REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`followed_by`,''))), '[[:space:]]+', ' ') = e.nm
   SET t.`owner_employee_id` = e.id WHERE t.`owner_employee_id` IS NULL AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(t.`followed_by`,''))), '[[:space:]]+', ' ') <> '';
