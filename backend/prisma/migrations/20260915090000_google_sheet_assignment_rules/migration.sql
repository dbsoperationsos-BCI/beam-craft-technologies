-- Assigning a sheet's leads to the right person, by rule rather than by hand.
--
-- A spreadsheet says who a lead is; it almost never says whose lead it is. Every lead a linked
-- sheet imported therefore arrived with an empty CRM column, and somebody assigned them by reading
-- a column - the Facebook page, the form, the city - and picking a name per lead. On a sheet the
-- poller re-reads every two minutes that is a job nobody finishes.
--
-- One row here is that reading written down once: a column, the value to look for in it, and the
-- employee whose lead it is when the two meet. One column matching one value and nothing else -
-- two values going to the same person is two rules rather than a syntax to learn. The importer asks these of every row it maps, so the initial
-- import and the two-minute auto-sync assign identically - there is only one code path.
--
-- Matched against the sheet's own header text, not the CRM field the importer maps it to: the
-- columns a studio routes by (Page Name, Form Name, Team) are exactly the ones the importer has no
-- field for, and a rule written against a mapped field could never see them.
--
-- No foreign keys, matching `sales_google_sheet_link` and `sales_google_sheet_row` beside it. The
-- employee id is indexed instead, which is what makes "which rules point at the person who just
-- left?" answerable when somebody is offboarded.

CREATE TABLE `sales_google_sheet_assignment_rule` (
  `id`                   VARCHAR(191) NOT NULL,
  `link_id`              VARCHAR(191) NOT NULL,
  `priority`             INT          NOT NULL DEFAULT 0,
  `column_header`        VARCHAR(255) NOT NULL DEFAULT '',
  `match_value`          VARCHAR(500) NOT NULL DEFAULT '',
  `target_employee_id`   INT          NULL,
  `target_employee_name` VARCHAR(150) NOT NULL DEFAULT '',
  `created_at`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `sales_google_sheet_assignment_rule_link_id_idx` (`link_id`),
  INDEX `sales_google_sheet_assignment_rule_target_employee_id_idx` (`target_employee_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
