-- CRM leads by vertical, for MySQL Workbench.
--
-- Open this file in Workbench (File -> Open SQL Script), put the cursor in a query and press
-- the lightning bolt, or Cmd+Enter, to run just that one.
--
-- Why this file exists: browsing the `sales_crm_lead` table directly is misleading. Qua Qua is
-- 14,635 of its 14,665 rows, and `enquiry_id` sorts as text - so "DBS-DD-EID-430615" comes
-- before "DBS-DD-EID-4870" and the 30 Dum Dum and Corp leads sit far past the 1,000 rows
-- Workbench fetches by default. They are not missing; they are just never on screen.
--
-- Everything below goes through views. A view holds no data of its own - it is a live window
-- onto `sales_crm_lead` - so what you see is always current, and an edit here is an edit to the
-- real lead. Change a cell in Workbench and the CRM shows it; change it in the CRM and the
-- next query here shows it. The columns are named as the CRM names them.
--
-- Editing is allowed. Two things to know:
--
--   * DELETE removes the lead outright. The CRM soft-deletes by stamping `deleted_at`, which
--     is recoverable; a DELETE here is not. To soft-delete instead:
--         UPDATE `sales_crm_lead` SET `deleted_at` = NOW() WHERE `enquiry_id` = 'DBS-DD-EID-...';
--
--   * Editing the `Verticals` column moves a lead between verticals, so the row leaves the
--     view you edited it in and turns up in another one. `Vertical ID` beside it is the
--     reference to the `vertical` table; the CRM reads the text until the reference is backfilled.

-- ---------------------------------------------------------------------------------------
-- 1. How many leads each vertical has. Run this first - it is the whole answer to
--    "where are Dum Dum and Corp".
-- ---------------------------------------------------------------------------------------
SELECT `Vertical`, COUNT(*) AS `Leads`
FROM `vw_crm_leads_all`
GROUP BY `Vertical`
ORDER BY `Leads` DESC;


-- ---------------------------------------------------------------------------------------
-- 2. One vertical at a time. Each view carries only that vertical's columns, in the order
--    the CRM shows them.
-- ---------------------------------------------------------------------------------------
SELECT * FROM `vw_crm_leads_dum_dum`;   -- 21 leads, 29 columns

SELECT * FROM `vw_crm_leads_corp`;      -- 9 leads, 33 columns

SELECT * FROM `vw_crm_leads_qua_qua`;   -- 14,635 leads, 31 columns


-- ---------------------------------------------------------------------------------------
-- 3. All three together, with the vertical in a column you can sort or filter on.
-- ---------------------------------------------------------------------------------------
SELECT * FROM `vw_crm_leads_all` ORDER BY `Vertical`, `Enquiry ID`;

-- Everything except Qua Qua - the 30 leads that are hard to reach in the raw table.
SELECT `Vertical`, `Enquiry ID`, `Enquiry Name`, `Phone Number`, `Status`, `CRM`, `Nearest Branch`
FROM `vw_crm_leads_all`
WHERE `Vertical` <> 'Qua Qua'
ORDER BY `Vertical`, `Enquiry ID`;


-- ---------------------------------------------------------------------------------------
-- 4. If the views are not in the Navigator: right-click the `dbs_operations_os_dev` schema
--    -> Refresh All, then look under Views, which is its own folder below Tables. This
--    confirms they exist whatever the Navigator is showing.
-- ---------------------------------------------------------------------------------------
SHOW FULL TABLES IN `dbs_operations_os_dev` WHERE `Table_type` = 'VIEW';
