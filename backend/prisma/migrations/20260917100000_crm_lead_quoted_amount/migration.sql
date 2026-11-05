-- A lead keeps what the Quotation Calculator quoted it.
--
-- The CRM's Quotation Calculator prices a lead from the studio's own services and deliverables
-- now, and Apply writes the total here with the choices it was built from - so the calculator
-- reopens where it was left, and converting the lead prefills Create Project's Signed Quotation
-- with the total rather than with the budget typed on the lead. NULL on every lead already here.
--
-- Written by hand and applied with `prisma migrate deploy`.

ALTER TABLE `sales_crm_lead`
  ADD COLUMN `quoted_amount` DECIMAL(12, 2) NULL,
  ADD COLUMN `quoted_draft` JSON NULL;
