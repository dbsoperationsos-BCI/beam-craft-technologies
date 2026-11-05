-- Requests waiting on an approver move from the sidebar badge to the notification bell.
--
-- From now on the application writes a REQUEST_WAITING notification to each approver named on a
-- request as it is raised (`hrm/attendance/requestNotifications.js`). Requests raised before this
-- have none, and the badge that used to announce them is gone - so every approval still pending
-- today is given its notification here, in the same words the application writes, or approvers
-- would lose sight of what was already waiting on them.
--
-- Only the approvers named on the request's own approval rows whose answer is still pending, on a
-- request still pending, reached through an active login linked to their employee record, never
-- the requester themselves. Replayable: a notification already there for that login and request is
-- not written twice. No schema change.

INSERT INTO `notification` (`user_id`, `type`, `title`, `body`, `entity_type`, `entity_id`, `link`, `created_at`)
SELECT
  `u`.`id`,
  'REQUEST_WAITING',
  LEFT(CONCAT(
    CASE `r`.`type`
      WHEN 'LEAVE' THEN 'Leave'
      WHEN 'PERMISSION' THEN 'Permission'
      WHEN 'ON_DUTY' THEN 'On duty / travel'
      WHEN 'CORRECTION' THEN 'Checkout correction'
      WHEN 'OUTSIDE_LOCATION' THEN 'Outside location'
      WHEN 'COMP_OFF' THEN 'Comp-off'
      ELSE 'A'
    END,
    ' request from ',
    COALESCE(NULLIF(TRIM(`e`.`employee_name`), ''), 'An employee')
  ), 200),
  CONCAT(
    DATE_FORMAT(`r`.`from_date`, '%e %b %Y'),
    IF(`r`.`to_date` <> `r`.`from_date`, CONCAT(' – ', DATE_FORMAT(`r`.`to_date`, '%e %b %Y')), ''),
    IF(`r`.`from_time` IS NOT NULL AND `r`.`to_time` IS NOT NULL, CONCAT(' · ', `r`.`from_time`, '–', `r`.`to_time`), ''),
    ' · Waiting for your approval'
  ),
  'HRM_ATTENDANCE_REQUEST',
  CAST(`r`.`id` AS CHAR),
  -- Employee Attendance's Request section for a login that holds that screen, HRM → Request otherwise.
  CASE WHEN `u`.`role` = 'SUPER_ADMIN' OR EXISTS (
      SELECT 1
        FROM `user_role` AS `ur`
        JOIN `role` AS `ro` ON `ro`.`id` = `ur`.`role_id` AND `ro`.`is_active` = 1
        JOIN `role_permission` AS `rp` ON `rp`.`roleId` = `ro`.`id` AND `rp`.`access_level` IN ('READ', 'READ_WRITE')
        JOIN `permission` AS `p` ON `p`.`id` = `rp`.`permissionId` AND `p`.`is_active` = 1
       WHERE `ur`.`user_id` = `u`.`id` AND `p`.`module` = 'HRM' AND `p`.`feature` = 'Employee Attendance'
    )
    THEN '/hrm/employee-attendance?section=request'
    ELSE '/hrm/requests'
  END,
  `r`.`created_at`
  FROM `attendance_request_approval` AS `a`
  JOIN `attendance_request` AS `r` ON `r`.`id` = `a`.`request_id` AND `r`.`status` = 'PENDING'
  JOIN `employee` AS `e` ON `e`.`id` = `r`.`employee_id`
  JOIN `user` AS `u` ON `u`.`linked_employee_id` = `a`.`approver_employee_id` AND `u`.`status` = 'ACTIVE'
 WHERE `a`.`decision` = 'PENDING'
   AND `a`.`approver_employee_id` <> `r`.`employee_id`
   AND NOT EXISTS (
     SELECT 1 FROM `notification` AS `n`
      WHERE `n`.`user_id` = `u`.`id` AND `n`.`type` = 'REQUEST_WAITING'
        -- The cast takes the connection's collation, which need not be the column's; named here so
        -- the comparison cannot fail on a server whose connection default differs.
        AND `n`.`entity_type` = 'HRM_ATTENDANCE_REQUEST' AND `n`.`entity_id` = CAST(`r`.`id` AS CHAR) COLLATE utf8mb4_unicode_ci
   );
