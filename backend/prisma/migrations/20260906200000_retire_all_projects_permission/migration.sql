-- Retire `PROJECT / All Projects`: one permission decides whose records you see, not one per module.
--
-- Whose records a person sees is decided by the names on the record, plus - for somebody who
-- administers a branch - everything filed against that branch (docs/project-state/DATA-SCOPE.md).
-- `ADMIN / Branch Administration` is that permission.
--
-- The project register had a second one. `PROJECT / All Projects` lifted the name requirement for
-- the project screens alone, so a person named on a single project was answered with every project
-- in the branches their roles reached. That is a defensible rule; the problem is that it was a
-- *different* rule from the one the assets, leads, cash and task screens follow, held under a
-- different permission, and nothing on screen said which one was answering. It was reported as a
-- bug twice - "why am I getting all the projects, nobody under me is on them" - and the honest fix
-- is one rule everywhere rather than a second place to look.
--
-- What changes for a role holding it: the project screens now answer the way every other screen
-- does - the projects you are named on (as CRM, project manager, either coordinator, creative
-- manager or creator), your reports' projects, and nothing else. To restore branch-wide sight,
-- grant `ADMIN / Branch Administration` for the same branches; it widens every module at once,
-- which is the point.
--
-- `role_permission` and `permission_scope` both cascade from `permission`, so deleting the row
-- takes its grants and any sub-actions with it. Nothing else references it: the seed no longer
-- lists it, and `projectScope.js` no longer reads it.
--
-- Cost: one row, plus its grants. Instant.

DELETE FROM `permission`
WHERE `module` = 'PROJECT'
  AND `feature` = 'All Projects';
