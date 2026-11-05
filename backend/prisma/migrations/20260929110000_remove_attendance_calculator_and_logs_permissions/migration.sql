-- `HRM / Attendance Calculator` and `HRM / Attendance Logs` are taken off Role Management: the studio
-- does not want them granted role by role. What they opened goes back to administrators alone (the
-- server's `isAdministrator` - a Super Admin, or a role with the Administrator tick), which is who
-- migration 20260928120000 granted them to in the first place, so no administrator loses anything:
--
--   Attendance Calculator  Settings → Employee → Attendance calculator, and its endpoints.
--   Attendance Logs        the Self Dashboard's Login Summary and Break Summary, and the Break
--                          Summary's endpoint.
--
-- The two rows are deleted, not switched off: `role_permission`, `role_permission_scope` and
-- `branch_admin_permission` all cascade from `permission`, so every grant of them goes too and none
-- is left pointing at nothing. `seeds/permission-catalogue.js` no longer lists them, so a seeded
-- environment does not bring them back.
--
-- Cost: two rows and their grants. Instant.

DELETE FROM `permission`
WHERE `module` = 'HRM'
  AND (`feature`, `level`) IN (
    ('Attendance Calculator', 'ATTENDANCE_CALCULATOR'),
    ('Attendance Logs', 'ATTENDANCE_LOGS')
  );
