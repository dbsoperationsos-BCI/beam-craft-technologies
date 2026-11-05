-- The per-grant data scope is withdrawn: there is one rule for everybody instead.
--
-- 20260906120000 added `data_scope` so a role could be set to All records / Their branches / Their
-- team / Their own per module. The studio's answer is simpler than that and does not vary by role:
--
--     a record is yours if your name is on it,
--     or if the name on it belongs to somebody who reports to you, at any depth,
--     or if it belongs to a branch your roles reach.
--
-- The three are ORed and the name comes first, so an asset in Visakhapatnam assigned to somebody
-- whose roles reach only Erode is still theirs to see. A setting that could turn that off is a
-- setting that can be set wrong, and there is nothing it could usefully say - so the column goes
-- rather than staying as one that looks meaningful and is not.
--
-- Nothing else read it by the time this ran; the resolver in `src/services/dataScope.service.js`
-- had already moved to the rule above. Dropping a column is a metadata change in InnoDB.

ALTER TABLE `role_permission` DROP COLUMN `data_scope`;
