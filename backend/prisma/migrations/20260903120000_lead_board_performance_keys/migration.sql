-- The keys the Leads & Followups board is read by, and the one index that serves it.
--
-- Additive and derived only. No existing column is altered and no data is rewritten: every column
-- below is computed by MySQL from columns that are already there, so a deploy that applies this
-- cannot change what any lead says.
--
-- ── Why ──────────────────────────────────────────────────────────────────────────────────────────
--
-- Every lead field is TEXT, written by four different producers - the app, CSV import, Google
-- Sheets and the Callyzer webhook - so the board's queries normalised as they read: LOWER/REPLACE/
-- TRIM to decide which vertical a lead is on, STR_TO_DATE to compare a follow-up date. A function
-- around a column has to be evaluated for every row before anything can be decided, so no index
-- could be used and every board query scanned the whole table. Measured at 500,000 leads:
--
--   first page of a board          4,098 ms
--   the twelve tab counts          6,337 ms
--   a page reached by scrolling    7,500 ms
--
-- and the board ran the first two on every request and all three on every scroll append.
--
-- These columns are the same normalisations, done once when the row is written. After this
-- migration the same three are 60 ms, 548 ms and 359 ms.
--
-- ── Two decisions worth knowing ─────────────────────────────────────────────────────────────────
--
-- `board_key` is NULL for a soft-deleted lead. A deleted lead is on no board, so naming a board
-- excludes it, and the queries stopped saying `deleted_at IS NULL` altogether. While they said it,
-- MySQL kept choosing the `deleted_at` index - one entry per lead in a table where all but a
-- handful are live - and counting a single board took 3.5s rather than 62ms. Neither an index hint
-- nor ANALYZE TABLE would talk it out of that; removing the choice did.
--
-- One wide covering index, not several narrow ones. With `(board_key, follow_up_day)` and
-- `(board_key, created_day)` also present, MySQL chose the narrowest for `ORDER BY enquiry_id` and
-- filesorted 226,000 rows. With only `sales_crm_lead_board_main_idx` the same page reports
-- "Backward index scan; Using index" and is 40x faster. Fewer indexes also means less work per row
-- inserted, which is what a 500,000-row CSV import spends its time on.
--
-- ── Cost of applying ────────────────────────────────────────────────────────────────────────────
--
-- Each ADD COLUMN of a STORED generated column rebuilds the table, so this is not instant on a
-- large one. Measured, not estimated: **3 minutes 31 seconds** for 500,000 leads on a developer
-- Mac, and the six ALTERs are sequential so the table is rebuilt six times. Expect minutes, not
-- seconds. The table stays readable throughout, but writes to it block - a Callyzer delivery or a
-- running import during that window will wait, and may time out.
--
-- Apply it in a deployment window. If the production table is much larger than 500,000 rows, or the
-- VPS is busier than a laptop, run it with the API stopped rather than hoping it slips through.

-- Which of the four boards a lead sits on, or NULL if it has been deleted. Mirrors
-- BRANCH_SQL_SOURCE in src/modules/sales/crm-leads/leadQueryService.js exactly.
ALTER TABLE `sales_crm_lead`
  ADD COLUMN `board_key` VARCHAR(10) GENERATED ALWAYS AS (
    CASE
      WHEN `deleted_at` IS NOT NULL THEN NULL
      WHEN TRIM(COALESCE(`branch`,'')) = '' AND LOWER(TRIM(COALESCE(`source`,''))) = 'callyzer' THEN 'calls'
      WHEN LOWER(REPLACE(TRIM(COALESCE(`branch`,'')),' ','')) = 'quaqua' THEN 'quaqua'
      WHEN LOWER(REPLACE(TRIM(COALESCE(`branch`,'')),' ','')) IN ('corp','corporate','corporation') THEN 'corp'
      ELSE 'dumdum'
    END
  ) STORED;

-- The status folded the way STATUS_DISPLAY_SQL folds it, so a tab counts exactly the rows whose
-- Status column reads that label. Trimmed as well as lowercased, which the old `pending` clause
-- was not - a status stored as "followup " displayed as Followup and was missed by its own tab.
ALTER TABLE `sales_crm_lead`
  ADD COLUMN `status_key` VARCHAR(60) GENERATED ALWAYS AS (
    LOWER(TRIM(COALESCE(`status`,'')))
  ) STORED;

-- The three dates the tabs compare, as real DATEs. Each accepts the two forms these text columns
-- actually hold - `YYYY-MM-DD...` from the app and `DD/MM/YYYY` from a hand-kept sheet - and is
-- NULL for anything else, which simply does not match. Mirrors isoDaySql().
ALTER TABLE `sales_crm_lead`
  ADD COLUMN `created_day` DATE GENERATED ALWAYS AS (
    COALESCE(
      CASE
        WHEN `created_date` REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN STR_TO_DATE(LEFT(`created_date`,10),'%Y-%m-%d')
        WHEN `created_date` REGEXP '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN STR_TO_DATE(CONCAT(SUBSTRING(`created_date`,7,4),'-',SUBSTRING(`created_date`,4,2),'-',SUBSTRING(`created_date`,1,2)),'%Y-%m-%d')
        ELSE NULL
      END,
      DATE(`created_at`)
    )
  ) STORED;

ALTER TABLE `sales_crm_lead`
  ADD COLUMN `follow_up_day` DATE GENERATED ALWAYS AS (
    CASE
      WHEN `next_follow_up_date` REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN STR_TO_DATE(LEFT(`next_follow_up_date`,10),'%Y-%m-%d')
      WHEN `next_follow_up_date` REGEXP '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN STR_TO_DATE(CONCAT(SUBSTRING(`next_follow_up_date`,7,4),'-',SUBSTRING(`next_follow_up_date`,4,2),'-',SUBSTRING(`next_follow_up_date`,1,2)),'%Y-%m-%d')
      ELSE NULL
    END
  ) STORED;

ALTER TABLE `sales_crm_lead`
  ADD COLUMN `dob_edod_day` DATE GENERATED ALWAYS AS (
    CASE
      WHEN `date_of_birth_or_edod` REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN STR_TO_DATE(LEFT(`date_of_birth_or_edod`,10),'%Y-%m-%d')
      WHEN `date_of_birth_or_edod` REGEXP '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN STR_TO_DATE(CONCAT(SUBSTRING(`date_of_birth_or_edod`,7,4),'-',SUBSTRING(`date_of_birth_or_edod`,4,2),'-',SUBSTRING(`date_of_birth_or_edod`,1,2)),'%Y-%m-%d')
      ELSE NULL
    END
  ) STORED;

-- The last ten digits of each number the lead carries: the same rule `phoneMatchKey`, the Callyzer
-- router and the contact directory all compare on, so "is this number already a lead?" becomes a
-- lookup. That question is asked once per delivered call and once per imported row, and it was a
-- full-table REGEXP scan every time.
ALTER TABLE `sales_crm_lead`
  ADD COLUMN `phone_key` VARCHAR(10) GENERATED ALWAYS AS (
    RIGHT(REGEXP_REPLACE(COALESCE(`phone`,''), '[^0-9]', ''), 10)
  ) STORED,
  ADD COLUMN `contact_key` VARCHAR(10) GENERATED ALWAYS AS (
    RIGHT(REGEXP_REPLACE(COALESCE(`contact_number`,''), '[^0-9]', ''), 10)
  ) STORED;

-- One index for the board: `(board_key, enquiry_id)` is its default sort, so a page is an ordered
-- range with no sort step, and every column the tab counts read follows, so counting never touches
-- a row. See the note above on why this is one index and not four.
CREATE INDEX `sales_crm_lead_board_main_idx`
  ON `sales_crm_lead` (`board_key`, `enquiry_id`, `status_key`, `created_day`, `follow_up_day`, `dob_edod_day`);

CREATE INDEX `sales_crm_lead_phone_key_idx` ON `sales_crm_lead` (`phone_key`);
CREATE INDEX `sales_crm_lead_contact_key_idx` ON `sales_crm_lead` (`contact_key`);
