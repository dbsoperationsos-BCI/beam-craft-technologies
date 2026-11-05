-- A branch administrator's permissions become their own role's, instead of a shared set.
--
-- `branch_admin_permission` was one studio-wide matrix merged on top of every role marked Branch
-- Admin. Nothing is merged any more: ticking Branch Admin fills that role's own matrix, which can
-- then be cut back, and what is left is what the role holds. So whatever the set was granting has
-- to be written into each ticked role before the merge disappears, or every branch administrator
-- would lose those permissions the moment this deploys.
--
-- Most-permissive, like the merge it replaces: a role already holding a permission keeps its own
-- level, and only the ones it does not hold are copied in. `WHERE NOT EXISTS` is what makes it
-- replayable - running it twice adds nothing the second time.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT
  LOWER(CONCAT('ba', REPLACE(UUID(), '-', ''))),
  r.`id`,
  b.`permission_id`,
  b.`access_level`,
  NOW(3),
  NOW(3)
FROM `role` r
JOIN `branch_admin_permission` b
WHERE r.`is_branch_manager` = 1
  AND NOT EXISTS (
    SELECT 1 FROM `role_permission` rp
    WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = b.`permission_id`
  );

-- The table itself is left in place, unread. Dropping it in the same change would take the record
-- of what the set held with it, and there is nothing to gain from doing both at once.
