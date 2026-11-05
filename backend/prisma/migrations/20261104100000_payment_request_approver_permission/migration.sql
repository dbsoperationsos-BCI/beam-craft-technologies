-- Raising money and allowing it become two permissions, and the older one gets an honest name.
--
-- One permission used to do both jobs. `ACCOUNTS / Payment Request Approval` at Read / Write let
-- somebody raise a request **and** approve it, so a holder could ask the studio for money and allow
-- it themselves in two clicks - the row then named the same person as who requested it and who
-- decided it, and nothing marked that as unusual.
--
-- After this:
--
--   * `ACCOUNTS / Payment Request` - the screen and **your own** requests. Read to see it, Read /
--     Write to raise one and to withdraw one you raised. This is the old `Payment Request Approval`
--     row, renamed in place: it no longer approves anything, and a key reading "Approval" over a
--     display name reading "Payment Requests" is worse than a plain name, because the key is what
--     somebody checks when the display name looks wrong.
--   * `ACCOUNTS / Payment Request Approver` - the decision. Approve, reject or correct anybody's
--     request, and read the whole queue. **Not** withdraw: withdrawing deletes the row, while
--     rejecting records who decided and why, and an approver who disagrees has the second and does
--     not need the first.
--
-- Here as a migration because **the seed cannot be run on production** (CLAUDE.md Rule 4).
-- `seeds/permission-catalogue.js` holds the same two rows and upserts on `module + feature + level`.
--
-- **Renamed the old one, not the new one.** The tempting move is the opposite: keep `Payment Request
-- Approval` as the approval permission, since that name always fitted approving. It would be a quiet
-- disaster. Everybody holding it today holds it to **raise** requests; make it the approval
-- permission and every one of them can approve, including their own - the hole this migration exists
-- to close, reopened by a rename. Nothing in the data says which of them was meant to approve, so no
-- later migration could sort them out. The rule: rename the permission whose meaning changed, not the
-- one whose meaning stayed.
--
-- **No grant moves.** `role_permission` references `permission`.`id`, so renaming the feature on the
-- row leaves every grant, role and data scope attached exactly as it was - verified on a copy: three
-- grants before, three after. What must change in lockstep is the code, because a guard names the
-- string literally and one left behind would name a permission that no longer exists and refuse
-- everybody (IAM.md). All of them are in this change: `hrm/payment-requests/routes.js`,
-- `contacts/directory/service.js`, `modulePermissions.js`, Accounts Manager, the three Vendor files,
-- and the catalogue.
--
-- **An approver also needs `Payment Request` Read** to open the screen at all: a route names one
-- permission, and widening that machinery for one screen would change every page's guard. The same
-- shape as `PROJECT / Production Execution`, whose description says so too.
--
-- **The approver is granted to SUPER_ADMIN only.** Every other role starts without it, so **until the
-- studio ticks it in Role Management, nobody but a Super Admin can approve or reject a payment
-- request** - which is the point of the split, but it does mean the queue stops moving until that is
-- done. The studio will most likely want it on whichever role already holds the raising permission at
-- Read / Write for its finance people; that is theirs to decide, not ours to assume.
--
-- Replayable: the insert is guarded by NOT EXISTS, the grant by a LEFT JOIN, and the rename matches
-- the **old** name so a second run finds no row. `permission` has a unique key on
-- (module, feature, level), so in the one case this must not paper over - both names somehow present
-- at once - the rename fails loudly on that key rather than quietly leaving two permissions where the
-- code expects one.
--
-- Cost: one permission row, one grant, one rename. Instant.

-- 1. The decision becomes its own permission.
INSERT INTO `permission` (`id`, `module`, `feature`, `level`, `display_name`, `description`, `is_active`, `created_at`, `updated_at`)
SELECT UUID(), 'ACCOUNTS', 'Payment Request Approver', 'PAYMENT_APPROVE', 'Approve Payment Requests',
       'Decide anybody''s payment request - approve, reject or correct it - and read the whole queue. Does not withdraw: an approver rejects, which leaves a record. Also needs ACCOUNTS / Payment Request Read to open the screen',
       1, NOW(3), NOW(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `permission` AS `existing`
  WHERE `existing`.`module` = 'ACCOUNTS'
    AND `existing`.`feature` = 'Payment Request Approver'
    AND `existing`.`level` = 'PAYMENT_APPROVE'
);

-- 2. To a Super Admin, and to nobody else.
INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', NOW(3), NOW(3)
  FROM `role` JOIN `permission` ON `permission`.`module` = 'ACCOUNTS'
                               AND `permission`.`feature` = 'Payment Request Approver'
                               AND `permission`.`level` = 'PAYMENT_APPROVE'
  LEFT JOIN `role_permission` ON `role_permission`.`roleId` = `role`.`id` AND `role_permission`.`permissionId` = `permission`.`id`
 WHERE `role`.`name` = 'SUPER_ADMIN' AND `role_permission`.`id` IS NULL;

-- 3. And the older permission says what it actually governs.
UPDATE `permission`
   SET `feature` = 'Payment Request',
       `display_name` = 'Payment Requests',
       `description` = 'See the payment request screen and your own requests; Read / Write raises one and withdraws one you raised. Approving is ACCOUNTS / Payment Request Approver',
       `updated_at` = NOW(3)
 WHERE `module` = 'ACCOUNTS' AND `feature` = 'Payment Request Approval';
