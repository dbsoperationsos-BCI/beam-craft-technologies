-- Remembering which sheet rows have already been imported, apart from the leads they made.
--
-- The sync worked out what to do with a row by looking for its lead. That cannot tell "never seen"
-- from "seen, and the studio deleted it", so a deleted lead was re-created on the next pass two
-- minutes later - and deleting a lead a sheet is syncing was not something a person could actually
-- do. Under the old soft delete it was worse: the upsert ends `deleted_at = NULL`, so the hidden
-- row was silently brought back to life under its original id.
--
-- One row here per sheet row ever imported, kept whether or not its lead still exists. The sync
-- then separates the three cases: a lead that exists is an edit, a known row with no lead was
-- deleted on purpose and is left alone, and an unknown row is new.
--
-- `row_key` is the identity the importer already computes for a row - the sheet's own Enquiry ID
-- where it has one, `<spreadsheet>:<tab>:row:<n>` where it does not - so this table and the lead's
-- `source_enquiry_id` cannot drift apart about what a row is.
--
-- Nothing is backfilled. Every row already imported is represented by its lead, which the sync
-- still finds and updates; the ledger only has to answer for rows deleted from here on.

CREATE TABLE `sales_google_sheet_row` (
  `id`            VARCHAR(191) NOT NULL,
  `link_id`       VARCHAR(191) NOT NULL,
  `row_key`       VARCHAR(255) NOT NULL,
  `enquiry_id`    VARCHAR(100) NULL,
  `first_seen_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `sales_google_sheet_row_link_key` (`link_id`, `row_key`),
  INDEX `sales_google_sheet_row_enquiry_id_idx` (`enquiry_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
