-- A lead's Assigned Branch is spelled the way the branch is.
--
-- The CRM offered six branch names of its own - `Erode`, `Tiruppur`, `Coimbatore`, `Bangalore`,
-- `Hyderabad`, `Vizag` - from a hard-coded array in the browser, while the studio's branches are
-- `Erode TN`, `Tiruppur TN`, `Coimbatore TN`, `Bangalore KA`, `Hyderabad TL` and
-- `Visakhapatnam AP`. Not one of the six is a branch. The picker now reads the `branch` table like
-- every other branch picker in the application, which leaves the leads already saved holding a
-- spelling that is no longer on the list - and `Dropdown` shows its placeholder for a value it
-- cannot find among its options, so Assigned Branch would have read as *empty* on every lead the
-- studio has.
--
-- Rewritten from the reference rather than from a table of spellings. `branch_id` was filled by
-- 20260906160000 through `referenceMatchers`, which already forgives the first word of a name
-- ("Erode" -> "Erode TN") and knows the studio says Vizag for Visakhapatnam - so the branch each
-- lead means has been recorded correctly all along. This only makes the text agree with it.
--
-- Nothing is guessed and nothing is cleared:
--
--   * a lead with a `branch_id` takes that branch's own name;
--   * a lead without one is left exactly as it is - blank stays blank, and an unmatched spelling
--     stays so it can still be read and corrected by hand. Clearing it would destroy the only
--     record of what somebody typed.
--
-- Idempotent: after this runs the text already equals the name, so the `<>` makes a second run
-- match no rows. Safe on a database where the CRM has never been used - it updates nothing.

UPDATE `sales_crm_lead` AS `l`
  JOIN `branch` AS `b` ON `b`.`id` = `l`.`branch_id`
SET `l`.`assigned_branch` = `b`.`name`
WHERE `l`.`branch_id` IS NOT NULL
  AND TRIM(COALESCE(`l`.`assigned_branch`, '')) <> `b`.`name`;
