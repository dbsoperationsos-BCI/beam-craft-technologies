-- One row per named approver per request, so a leave can need all of them.
--
-- A leave used to be settled by whichever of the three approvers answered first. That is right for
-- a queue nobody should be able to stall, and wrong for a decision the studio wants everybody on
-- the list to make: it meant two of the three might never see a request that had already been
-- approved in their name.
--
-- A leave now needs every approver named on the employee's record; a permission, an on-duty, a
-- correction and an outside-location request each need the one permission approver. Any single
-- rejection settles the whole request, because a refusal is a veto rather than a vote.
--
-- The list is written down when the request is raised rather than read from the employee each time,
-- so changing somebody's approvers next month cannot rewrite who was asked about a leave last
-- month. `attendance_request_event` beside this still records every action, but it records the
-- *login* that acted and cannot say which of three approvers a person is, nor name the two who have
-- not answered yet.
--
-- Written by hand and applied with `prisma migrate deploy`.

CREATE TABLE `attendance_request_approval` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `request_id` INTEGER NOT NULL,
  `approver_employee_id` INTEGER NOT NULL,
  -- PENDING until they answer, then APPROVED or REJECTED. Their own answer, not the request's: one
  -- rejection settles the request while the others honestly still read PENDING.
  `decision` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `remarks` TEXT NULL,
  `decided_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- One answer per approver per request. A second press changes an answer rather than adding one.
  UNIQUE INDEX `attendance_request_approval_request_approver_key`(`request_id`, `approver_employee_id`),
  INDEX `attendance_request_approval_approver_decision_idx`(`approver_employee_id`, `decision`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Deleting a request takes its answers with it: an answer to a question nobody asked is not a
-- record of anything.
ALTER TABLE `attendance_request_approval`
  ADD CONSTRAINT `attendance_request_approval_request_id_fkey`
  FOREIGN KEY (`request_id`) REFERENCES `attendance_request`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
