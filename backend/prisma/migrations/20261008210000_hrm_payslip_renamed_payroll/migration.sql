-- HRM -> Payslip is renamed Payroll (`/hrm/payroll`), and its permission with it: `HRM / Payslip`
-- (migration 20261008200000_hrm_payslip_permission) becomes `HRM / Payroll`.
--
-- The row is renamed in place rather than replaced, so its id - and every role's grant of it - is
-- kept: whoever could open Payslip opens Payroll. A database that somehow already holds an
-- `HRM / Payroll` row (a seed run ahead of this) keeps that one and leaves the Payslip row alone,
-- since the two cannot share a name.
--
-- Cost: one row updated. Instant.

UPDATE `permission`
SET `feature` = 'Payroll', `level` = 'PAYROLL_VIEW', `display_name` = 'Payroll', `description` = 'The Payroll screen', `updated_at` = NOW(3)
WHERE `module` = 'HRM' AND `feature` = 'Payslip' AND `level` = 'PAYSLIP_VIEW'
  AND NOT EXISTS (
    SELECT 1 FROM (
      SELECT `id` FROM `permission` WHERE `module` = 'HRM' AND `feature` = 'Payroll' AND `level` = 'PAYROLL_VIEW'
    ) AS `already`
  );
