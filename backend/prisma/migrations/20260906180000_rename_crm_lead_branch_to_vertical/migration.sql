-- The lead's vertical column is called `vertical` in the database too.
--
-- 20260906110000 gave the lead a `vertical_id` and left the text column physically named `branch`,
-- because renaming it means dropping and rebuilding `board_key` and its index either side - two
-- rebuilds of the lead table - and the eventual drop of the text would pay them again.
--
-- It is renamed anyway, because a column called `branch` that holds "Dum Dum" is read by everyone
-- who opens the database, and every one of them has to be told it is not a branch. That is a cost
-- paid on every reading of the schema, against two rebuilds paid once. The lead's actual branch has
-- been `assigned_branch` all along, and now has `branch_id` beside it.
--
-- No row changes: `RENAME COLUMN` keeps every value, and everything dropped below is derived and
-- comes back computed from the same values.
--
-- ── Why this is eight statements and not one ────────────────────────────────────────────────────
--
-- MySQL refuses to rename a column a STORED generated column is computed from, and `board_key`
-- (20260903120000) is computed from this one. So `board_key` goes before the rename and comes back
-- after it - and the index covering `board_key` goes before the column does:
--
--   1. drop the four views          (they read the column by name)
--   2. drop the board index          (it covers `board_key`)
--   3. drop `board_key`              (it depends on the column)
--   4. rename `branch` -> `vertical`
--   5. add `board_key` back          (the same CASE, over `vertical`)
--   6. recreate the board index
--   7. recreate the four views       (over `vertical`, still aliased `Verticals`)
--
-- `board_key` is re-declared word for word except for the column name. It decides which of the four
-- boards a lead is on, `BOARD_SQL_SOURCE` in leadQueryService.js mirrors it, and
-- `contacts-directory.test.js` reads this file to hold the two together. Edit one, edit both.
--
-- ── Cost of applying ────────────────────────────────────────────────────────────────────────────
--
-- Steps 3 and 5 each rebuild the table - dropping and adding a STORED generated column both do -
-- and step 6 builds the index. 20260903120000 measured one such ADD COLUMN at **3 minutes 31
-- seconds** for 500,000 leads on a developer Mac; expect roughly twice that here, plus the index.
-- The rename itself and the view statements are instant. Writes to the lead table block for the
-- duration - a Callyzer delivery or a running import will wait, and may time out - so apply it in a
-- deployment window, with the API stopped if the table is large.

DROP VIEW IF EXISTS `vw_crm_leads_dum_dum`;
DROP VIEW IF EXISTS `vw_crm_leads_qua_qua`;
DROP VIEW IF EXISTS `vw_crm_leads_corp`;
DROP VIEW IF EXISTS `vw_crm_leads_all`;

DROP INDEX `sales_crm_lead_board_main_idx` ON `sales_crm_lead`;

ALTER TABLE `sales_crm_lead` DROP COLUMN `board_key`;

ALTER TABLE `sales_crm_lead` RENAME COLUMN `branch` TO `vertical`;

-- Which of the four boards a lead sits on, or NULL if it has been deleted. The definition from
-- 20260903120000_lead_board_performance_keys with `vertical` where it said `branch`, and nothing
-- else changed. Mirrors BOARD_SQL_SOURCE in src/modules/sales/crm-leads/leadQueryService.js.
ALTER TABLE `sales_crm_lead`
  ADD COLUMN `board_key` VARCHAR(10) GENERATED ALWAYS AS (
    CASE
      WHEN `deleted_at` IS NOT NULL THEN NULL
      WHEN TRIM(COALESCE(`vertical`,'')) = '' AND LOWER(TRIM(COALESCE(`source`,''))) = 'callyzer' THEN 'calls'
      WHEN LOWER(REPLACE(TRIM(COALESCE(`vertical`,'')),' ','')) = 'quaqua' THEN 'quaqua'
      WHEN LOWER(REPLACE(TRIM(COALESCE(`vertical`,'')),' ','')) IN ('corp','corporate','corporation') THEN 'corp'
      ELSE 'dumdum'
    END
  ) STORED;

-- The one board index, exactly as 20260903120000 created it. See that migration for why it is one
-- wide covering index and not four narrow ones.
CREATE INDEX `sales_crm_lead_board_main_idx`
  ON `sales_crm_lead` (`board_key`, `enquiry_id`, `status_key`, `created_day`, `follow_up_day`, `dob_edod_day`);

-- The four Workbench views again, over the renamed column. Column headings are unchanged - the
-- vertical is still headed `Verticals` - so a saved Workbench query keeps working.

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
  `vertical` AS `Verticals`,
  `vertical_id` AS `Vertical ID`
FROM `sales_crm_lead`
WHERE `deleted_at` IS NULL AND (TRIM(COALESCE(`vertical`,'')) = '' OR LOWER(REPLACE(TRIM(`vertical`),' ','')) NOT IN ('quaqua','corp','corporate','corporation'));

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
  `vertical` AS `Verticals`,
  `vertical_id` AS `Vertical ID`
FROM `sales_crm_lead`
WHERE `deleted_at` IS NULL AND LOWER(REPLACE(TRIM(COALESCE(`vertical`,'')),' ','')) = 'quaqua';

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
  `vertical` AS `Verticals`,
  `vertical_id` AS `Vertical ID`
FROM `sales_crm_lead`
WHERE `deleted_at` IS NULL AND LOWER(REPLACE(TRIM(COALESCE(`vertical`,'')),' ','')) IN ('corp','corporate','corporation');

-- All three verticals. Every column writable except `Vertical`, which is derived from the text;
-- edit `Verticals` to move a lead.
CREATE VIEW `vw_crm_leads_all` AS
SELECT
  CASE
    WHEN LOWER(REPLACE(TRIM(COALESCE(`vertical`,'')),' ','')) = 'quaqua' THEN 'Qua Qua'
    WHEN LOWER(REPLACE(TRIM(COALESCE(`vertical`,'')),' ','')) IN ('corp','corporate','corporation') THEN 'Corp'
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
  `vertical` AS `Verticals`,
  `vertical_id` AS `Vertical ID`
FROM `sales_crm_lead`
WHERE `deleted_at` IS NULL;
