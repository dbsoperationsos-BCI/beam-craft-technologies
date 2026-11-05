-- `ADMIN / Branch Administration` now comes with the Branch Admin tick, and from nowhere else.
--
-- It is the permission that *makes* a branch administrator one: it widens somebody from the work
-- their own name is on to every record in the branches their roles reach. Until now it was an
-- ordinary row in the role matrix, which meant a role could be marked **Branch Admin** and not hold
-- it - and the two names are close enough to be read as the same thing, while "Administer Branches"
-- also sounds like the right to edit the branch register, which is `SETTINGS / Organization`.
-- People ticked the box, watched nothing change, and had no way to see why.
--
-- `getUserPermissions` grants it to anyone carrying a role with `is_branch_manager` (see
-- `TICK_CARRIES` in `iam.service.js`), and `GET /api/admin/permissions` no longer offers it, so
-- neither the role editor nor the Admin Permission dialog can set it.
--
-- This removes it from the shared **Admin Permission** set, where a studio may have put it to work
-- around the above. Nothing is lost: everyone who held it through the set holds it through the tick,
-- because the set only ever reaches a role that carries the tick in the first place. Left in place
-- it would be a second source of truth that no screen can show and the next save of the set would
-- silently drop.
--
-- **Grants on individual roles are deliberately NOT removed.** A role that was given it explicitly
-- goes on holding it - `writeRoleMatrix` carries it across a save it cannot see - so no branch
-- administrator loses access on deploy. Those grants simply stop being the way it is given.
--
-- Cost: at most one row. Instant.

DELETE `set` FROM `branch_admin_permission` AS `set`
  JOIN `permission` AS `p` ON `p`.`id` = `set`.`permission_id`
 WHERE `p`.`module` = 'ADMIN' AND `p`.`feature` = 'Branch Administration';
