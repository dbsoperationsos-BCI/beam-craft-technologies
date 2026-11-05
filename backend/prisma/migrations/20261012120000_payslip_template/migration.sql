-- Settings → Template Settings: the payslip's heading, as the studio types it - the company's name,
-- its address (one line to a row) and its logo's stored link, on the one HRM settings row.
--
-- Nullable: empty until the studio fills them in, when the payslip shows its placeholders. The logo's
-- link is TEXT because a server with no image storage configured keeps the picture inline.
--
-- Cost: three nullable columns on a one-row table. Instant.

ALTER TABLE `hrm_settings`
  ADD COLUMN `payslip_company_name` VARCHAR(200) NULL,
  ADD COLUMN `payslip_address` TEXT NULL,
  ADD COLUMN `payslip_logo_url` TEXT NULL;
