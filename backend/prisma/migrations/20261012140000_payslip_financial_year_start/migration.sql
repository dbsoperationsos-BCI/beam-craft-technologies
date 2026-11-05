-- Settings → Template Settings: the month the financial year starts in, from which a payslip's YTD
-- (year to date) is counted - October's payslip, with the year starting in April, counts April to
-- October. 1 to 12; April, the Indian financial year, until the studio says otherwise.
--
-- Cost: one NOT NULL integer with a default on a one-row table. Instant.

ALTER TABLE `hrm_settings` ADD COLUMN `payslip_financial_year_start_month` INT NOT NULL DEFAULT 4;
