-- The CRM lead's vertical becomes a reference to the `vertical` table.
--
-- `sales_crm_lead.branch` has never held a branch. It holds "Dum Dum", "Qua Qua" or "Corp" - the
-- vertical, spelled as free text by four producers (the app, CSV import, Google Sheets, Callyzer)
-- and folded with LOWER/REPLACE/TRIM wherever it is read. The lead's branch is `assigned_branch`.
-- The `vertical` table has existed since 20260819120000 and nothing referenced it.
--
-- No row of any table changes meaning here, and nothing is backfilled: `vertical_id` is added
-- NULL beside the text and stays NULL until the match report has been approved. The text column
-- keeps its physical name on purpose - see below.
--
-- ── What this adds ──────────────────────────────────────────────────────────────────────────────
--
--   * `sales_crm_lead.vertical_id`, nullable, indexed, FOREIGN KEY to `vertical(id)`. SET NULL on
--     delete: a vertical retired from Settings leaves its leads readable rather than refusing.
--
--   * `vertical.document_code` and `vertical.identifier_code`, the two short spellings the studio
--     actually prints. WED / QQ / CORP goes on projects, quotations, CRD documents and WhatsApp
--     group names; DD / QQ / CORP goes inside every identifier (`DBS-EID-DD-ERD-000001`). Both
--     were hard-coded maps - `salesVertical.js` and `identifiers.js` - and are now columns, set
--     here for the three sales verticals. Team 33 and General are employee-side verticals with no
--     board and no documents, and are left NULL: a lead may reference only a vertical that has a
--     document code, which the write path checks. The maps keep answering until the readers move
--     to these columns, so nothing printed changes today.
--
-- ── Why the text column is not renamed ──────────────────────────────────────────────────────────
--
-- `board_key` (20260903120000) is a STORED generated column computed from `branch`, and MySQL
-- will not rename a column a generated column depends on: renaming means dropping `board_key`
-- and its index, renaming, and adding both back - two rebuilds of the lead table, measured at
-- 3.5 minutes each for 500,000 rows. The same two rebuilds are needed once more when the text
-- column is finally dropped in favour of `vertical_id`. Paying them twice for a name the column
-- carries only during the transition is not worth it, so the column stays `branch` in the
-- database and is called `verticalName` in the Prisma schema and `vertical` in the code.
--
-- ── The three columns that are renamed ─────────────────────────────────────────────────────────
--
-- `sales_crm_dynamic_column.branch`, `sales_google_sheet_link.branch` and
-- `sales_crm_lead_watch.branch` hold the same vertical name (a Table Settings field belongs to
-- a vertical; a sheet link feeds one). All three tables are empty and none has a generated
-- column, so RENAME COLUMN is a metadata change. Their indexes are renamed to what Prisma
-- expects, as 20260906090000 did for `branch`.
--
-- ── The views were already broken ───────────────────────────────────────────────────────────────
--
-- The four `vw_crm_leads_*` views have referenced a table called `SalesCrmLead` since they were
-- made, and 20260819112301_convert_to_snake_case renamed it `sales_crm_lead`. Every one of them
-- has answered "references invalid table(s)" to any SELECT since (CHECK TABLE reports them
-- Corrupt). Nothing in the application reads them - they exist for MySQL Workbench, see
-- scripts/crm-vertical-queries.sql - which is why nobody noticed. They are recreated here over
-- the table as it is actually named, with the same columns under the same headings plus
-- `Vertical ID`, and are updatable as the 20260815190000 rebuild intended. Until the readers
-- move, the CRM reads `Verticals` (the text), not `Vertical ID`.
--
-- ── Cost of applying ────────────────────────────────────────────────────────────────────────────
--
-- Adding a nullable column, renaming columns and indexes, and the views are metadata changes.
-- The two new indexes are built online and the FOREIGN KEY is checked against a column that is
-- NULL in every row. Seconds at any size; no rebuild of the lead table.

-- The two short codes, and their values for the three sales verticals.
ALTER TABLE `vertical`
  ADD COLUMN `document_code` VARCHAR(10) NULL,
  ADD COLUMN `identifier_code` VARCHAR(10) NULL;
CREATE UNIQUE INDEX `vertical_document_code_key` ON `vertical` (`document_code`);
CREATE UNIQUE INDEX `vertical_identifier_code_key` ON `vertical` (`identifier_code`);

UPDATE `vertical` SET `document_code` = 'WED',  `identifier_code` = 'DD'   WHERE `code` = 'DUM_DUM';
UPDATE `vertical` SET `document_code` = 'QQ',   `identifier_code` = 'QQ'   WHERE `code` = 'QUA_QUA';
UPDATE `vertical` SET `document_code` = 'CORP', `identifier_code` = 'CORP' WHERE `code` = 'CORP';

-- The reference, NULL everywhere until the backfill is approved.
ALTER TABLE `sales_crm_lead` ADD COLUMN `vertical_id` INT NULL;
CREATE INDEX `sales_crm_lead_vertical_id_idx` ON `sales_crm_lead` (`vertical_id`);
ALTER TABLE `sales_crm_lead`
  ADD CONSTRAINT `sales_crm_lead_vertical_id_fkey`
  FOREIGN KEY (`vertical_id`) REFERENCES `vertical` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- The three empty tables whose `branch` is a vertical name.
ALTER TABLE `sales_crm_dynamic_column`
  RENAME COLUMN `branch` TO `vertical`,
  RENAME INDEX `sales_crm_dynamic_column_branch_key_key` TO `sales_crm_dynamic_column_vertical_key_key`,
  RENAME INDEX `sales_crm_dynamic_column_branch_sort_order_idx` TO `sales_crm_dynamic_column_vertical_sort_order_idx`;
ALTER TABLE `sales_google_sheet_link`
  RENAME COLUMN `branch` TO `vertical`,
  RENAME INDEX `sales_google_sheet_link_branch_idx` TO `sales_google_sheet_link_vertical_idx`;
ALTER TABLE `sales_crm_lead_watch`
  RENAME COLUMN `branch` TO `vertical`,
  RENAME INDEX `sales_crm_lead_watch_branch_idx` TO `sales_crm_lead_watch_vertical_idx`;

-- The four Workbench views, over the table as it is now named. Generated from the 20260815190000
-- definitions by renaming identifiers and appending `Vertical ID`; column headings are unchanged.
DROP VIEW IF EXISTS `vw_crm_leads_dum_dum`;
DROP VIEW IF EXISTS `vw_crm_leads_qua_qua`;
DROP VIEW IF EXISTS `vw_crm_leads_corp`;
DROP VIEW IF EXISTS `vw_crm_leads_all`;

-- Dum Dum: every column writable.
CREATE VIEW `vw_crm_leads_dum_dum` AS
SELECT
  `enquiry_id` AS `Enquiry ID`,
  `created_date` AS `Enquiry Date`,
  `added_time` AS `Added Time`,
  `name` AS `Enquiry Name`,
  `phone` AS `Phone Number`,
  `relationship` AS `Relationship`,
  `status` AS `Status`,
  `crm` AS `CRM`,
  `assigned_branch` AS `Nearest Branch`,
  `referred_from` AS `Referred From`,
  `offer_type` AS `Offer Type`,
  `campaign_name` AS `Campaign Name`,
  `adset_name` AS `Adset Name`,
  `ad_name` AS `Ad Name`,
  `preferred_budget` AS `Preferred Budget`,
  `city` AS `City`,
  `state` AS `State`,
  `event_planned_type` AS `Type of Event Planned`,
  `event_planned_date` AS `When is the Event Planned`,
  `groom_name` AS `Groom Name`,
  `groom_contact` AS `Groom Contact`,
  `groom_location` AS `Groom Location`,
  `bride_name` AS `Bride Name`,
  `bride_contact` AS `Bride Contact`,
  `bride_location` AS `Bride Location`,
  `reference_name` AS `Referenced Person Name`,
  `reference_contact` AS `Referenced Person Contact`,
  `remarks` AS `Remarks`,
  `source` AS `Source`,
  `branch` AS `Verticals`,
  `vertical_id` AS `Vertical ID`
FROM `sales_crm_lead`
WHERE `deleted_at` IS NULL AND (TRIM(COALESCE(`branch`,'')) = '' OR LOWER(REPLACE(TRIM(`branch`),' ','')) NOT IN ('quaqua','corp','corporate','corporation'));

-- Qua Qua: every column writable.
CREATE VIEW `vw_crm_leads_qua_qua` AS
SELECT
  `enquiry_id` AS `Enquiry ID`,
  `created_date` AS `Enquiry Date`,
  `name` AS `Enquiry Name`,
  `added_time` AS `Added Timestamp`,
  `phone` AS `Phone Number`,
  `status` AS `Status`,
  `crm` AS `CRM`,
  `assigned_branch` AS `Nearest Branch`,
  `offer_type` AS `Offer Type`,
  `campaign_name` AS `Campaign Name`,
  `adset_name` AS `Adset Name`,
  `ad_name` AS `Ad Name`,
  `referred_from` AS `Referred From`,
  `preferred_budget` AS `Preferred Budget`,
  `city` AS `City`,
  `state` AS `State`,
  `event_planned_type` AS `Type of Event Planned`,
  `event_planned_date` AS `When is the Event Planned`,
  `contact_repeated` AS `Contact Repeated`,
  `shoot_type` AS `Shoot Type`,
  `location` AS `Location`,
  `ih_oh` AS `IH/OH`,
  `last_follow_up_date` AS `Last Followup Date`,
  `next_follow_up_date` AS `Next followup Date`,
  `last_converted_date` AS `Last Converted Date`,
  `shoot_id` AS `Shoot ID`,
  `date` AS `Date`,
  `baby_or_mother_name` AS `Baby (or) Mother Name`,
  `date_of_birth_or_edod` AS `Date of Birth (or) EDOD`,
  `contact_number` AS `Contact`,
  `source` AS `Source`,
  `branch` AS `Verticals`,
  `vertical_id` AS `Vertical ID`
FROM `sales_crm_lead`
WHERE `deleted_at` IS NULL AND LOWER(REPLACE(TRIM(COALESCE(`branch`,'')),' ','')) = 'quaqua';

-- Corp: every column writable.
CREATE VIEW `vw_crm_leads_corp` AS
SELECT
  `enquiry_id` AS `Enquiry ID`,
  `created_date` AS `Enquiry Date`,
  `name` AS `Enquiry Name`,
  `added_time` AS `Added Timestamp`,
  `phone` AS `Phone Number`,
  `status` AS `Status`,
  `crm` AS `CRM`,
  `assigned_branch` AS `Nearest Branch`,
  `referred_from` AS `Referred From`,
  `offer_type` AS `Offer Type`,
  `campaign_name` AS `Campaign Name`,
  `adset_name` AS `Adset Name`,
  `ad_name` AS `Ad Name`,
  `preferred_budget` AS `Preferred Budget`,
  `city` AS `City`,
  `state` AS `State`,
  `company_name` AS `Company Name (or) Client organisation`,
  `primary_decision_maker` AS `Primary decision-maker - Contact`,
  `designation` AS `Designation`,
  `contact_number` AS `Contact Number`,
  `alternate_mobile_number` AS `Alternate Mobile Number`,
  `official_email_id` AS `Official Email ID`,
  `company_website` AS `Company Website`,
  `company_type` AS `Company Type`,
  `company_size` AS `Company Size`,
  `branches` AS `Branches`,
  `project_type` AS `Project Type`,
  `location` AS `Location`,
  `shoot_city` AS `Shoot City`,
  `expected_budget` AS `Expected Budget`,
  `competitions` AS `Competitions`,
  `remarks` AS `Remarks`,
  `source` AS `Source`,
  `branch` AS `Verticals`,
  `vertical_id` AS `Vertical ID`
FROM `sales_crm_lead`
WHERE `deleted_at` IS NULL AND LOWER(REPLACE(TRIM(COALESCE(`branch`,'')),' ','')) IN ('corp','corporate','corporation');

-- All three verticals. Every column writable except `Vertical`, which is derived from the text;
-- edit `Verticals` to move a lead.
CREATE VIEW `vw_crm_leads_all` AS
SELECT
  CASE
    WHEN LOWER(REPLACE(TRIM(COALESCE(`branch`,'')),' ','')) = 'quaqua' THEN 'Qua Qua'
    WHEN LOWER(REPLACE(TRIM(COALESCE(`branch`,'')),' ','')) IN ('corp','corporate','corporation') THEN 'Corp'
    ELSE 'Dum Dum' END COLLATE utf8mb4_unicode_ci AS `Vertical`,
  `enquiry_id` AS `Enquiry ID`,
  `created_date` AS `Enquiry Date`,
  `added_time` AS `Added Time`,
  `name` AS `Enquiry Name`,
  `phone` AS `Phone Number`,
  `relationship` AS `Relationship`,
  `status` AS `Status`,
  `crm` AS `CRM`,
  `assigned_branch` AS `Nearest Branch`,
  `referred_from` AS `Referred From`,
  `offer_type` AS `Offer Type`,
  `campaign_name` AS `Campaign Name`,
  `adset_name` AS `Adset Name`,
  `ad_name` AS `Ad Name`,
  `preferred_budget` AS `Preferred Budget`,
  `city` AS `City`,
  `state` AS `State`,
  `event_planned_type` AS `Type of Event Planned`,
  `event_planned_date` AS `When is the Event Planned`,
  `groom_name` AS `Groom Name`,
  `groom_contact` AS `Groom Contact`,
  `groom_location` AS `Groom Location`,
  `bride_name` AS `Bride Name`,
  `bride_contact` AS `Bride Contact`,
  `bride_location` AS `Bride Location`,
  `reference_name` AS `Referenced Person Name`,
  `reference_contact` AS `Referenced Person Contact`,
  `remarks` AS `Remarks`,
  `source` AS `Source`,
  `added_time` AS `Added Timestamp`,
  `contact_repeated` AS `Contact Repeated`,
  `shoot_type` AS `Shoot Type`,
  `location` AS `Location`,
  `ih_oh` AS `IH/OH`,
  `last_follow_up_date` AS `Last Followup Date`,
  `next_follow_up_date` AS `Next followup Date`,
  `last_converted_date` AS `Last Converted Date`,
  `shoot_id` AS `Shoot ID`,
  `date` AS `Date`,
  `baby_or_mother_name` AS `Baby (or) Mother Name`,
  `date_of_birth_or_edod` AS `Date of Birth (or) EDOD`,
  `contact_number` AS `Contact`,
  `company_name` AS `Company Name (or) Client organisation`,
  `primary_decision_maker` AS `Primary decision-maker - Contact`,
  `designation` AS `Designation`,
  `contact_number` AS `Contact Number`,
  `alternate_mobile_number` AS `Alternate Mobile Number`,
  `official_email_id` AS `Official Email ID`,
  `company_website` AS `Company Website`,
  `company_type` AS `Company Type`,
  `company_size` AS `Company Size`,
  `branches` AS `Branches`,
  `project_type` AS `Project Type`,
  `shoot_city` AS `Shoot City`,
  `expected_budget` AS `Expected Budget`,
  `competitions` AS `Competitions`,
  `branch` AS `Verticals`,
  `vertical_id` AS `Vertical ID`
FROM `sales_crm_lead`
WHERE `deleted_at` IS NULL;
