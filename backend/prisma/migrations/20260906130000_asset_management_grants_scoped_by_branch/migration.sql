-- Asset Management is the first module to read the data scope, and it must go on showing what it
-- shows today.
--
-- Every grant was given a scope of ALL by 20260906120000 because ALL is what every module did:
-- anyone who could open a screen saw every record in it. Asset Management was the exception - its
-- list has been narrowed to the branches a role reaches since the branch filter existed (IAM.md,
-- "Branch-scoped: two screens"). Read through the resolver with a scope of ALL, that role would
-- suddenly see every branch's assets, which is a widening nobody chose.
--
-- So the grants that exist today are translated, not defaulted: an Asset Management grant at ALL
-- becomes BRANCH, which is the setting that means what the screen already did. A role whose
-- administrator later wants it wider can be set to ALL on the Roles screen, deliberately.
--
-- Data, not schema; affects permission rows only, and only those naming this one permission at
-- the default. Reversible by setting them back on the Roles screen.

UPDATE `role_permission` rp
  JOIN `permission` p ON p.id = rp.permissionId
   SET rp.`data_scope` = 'BRANCH'
 WHERE p.`module` = 'ASSET' AND p.`feature` = 'Asset Management' AND rp.`data_scope` = 'ALL';
