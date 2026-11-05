-- The attendance report's WhatsApp group is no longer picked from one linker's own group list and
-- fixed by its JID. An administrator now simply types the group's name; at send time, whichever
-- sender is being tried has their own WhatsApp groups searched for one matching that name. This
-- feature has not shipped to production yet (its own migration landed a few hours before this one,
-- on the same branch), so there is no JID to carry forward - the old pair is dropped outright.
-- `attendance_report_linked_at` went with it: it recorded when the old, fixed link was made, and
-- nothing under the new per-sender resolution ever writes it.

ALTER TABLE `hrm_settings`
  DROP COLUMN `attendance_report_group_jid`,
  DROP COLUMN `attendance_report_group_subject`,
  DROP COLUMN `attendance_report_linked_at`,
  ADD COLUMN `attendance_report_group_name` VARCHAR(500) NULL AFTER `payback_day`;
