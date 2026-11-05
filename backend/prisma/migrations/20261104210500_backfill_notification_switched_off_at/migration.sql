-- A notification that is **already** switched off is answered from now.
--
-- The column added by the migration before this is written when a switch is pressed, so a studio
-- that switched its attendance report off last week has the switch off and no moment recorded. The
-- "could not find its WhatsApp group" notice would hide its failures while it is off and then put
-- every one of them back the moment it was switched on again - the exact thing the column exists to
-- prevent, for the studios most likely to notice it.
--
-- So anything off right now is stamped with the moment this runs: its failures so far are answered,
-- and only what fails after it is switched on again is work to do.
--
-- A notification that is on is left alone (NULL - never switched off), and so is one already
-- stamped. Replayable: a second run matches nothing.
--
-- Cost: one row. Instant.

UPDATE `hrm_settings`
SET `attendance_report_off_at` = NOW(3)
WHERE `attendance_report_enabled` = false AND `attendance_report_off_at` IS NULL;

UPDATE `hrm_settings`
SET `photo_selection_off_at` = NOW(3)
WHERE `photo_selection_notify_enabled` = false AND `photo_selection_off_at` IS NULL;
