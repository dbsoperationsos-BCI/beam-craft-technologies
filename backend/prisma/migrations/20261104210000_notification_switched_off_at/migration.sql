-- When each switchable notification was last switched off.
--
-- Switching a message off answers the failures it had already recorded: nothing is being sent, so
-- nobody has to go and find its WhatsApp group. The settings panel's own error is cleared as the
-- switch is pressed, and a production step message's row is closed - but a name-addressed failure
-- lives in `whats_app_activity`, which is the **log of what happened** and is never rewritten. So
-- the failure cannot be cleared; what can be recorded is the moment the studio answered it.
--
-- The "could not find its WhatsApp group" notice then ignores a failure older than this timestamp.
-- Switched off, the message's failures are hidden outright; switched back on, the notice starts from
-- that moment - a new failure appears, the ones from before it never return.
--
-- Two columns because two name-addressed messages have a switch of their own: the daily attendance
-- report and Photo Selection Submitted. The wishes and the payment reminder have no switch, so there
-- is no moment to record and their failures are always work to do.
--
-- NULL means "never switched off", which is where every studio starts: nothing is hidden, and the
-- notice reads exactly as it does today until somebody presses a switch.
--
-- Cost: two nullable columns on a single-row settings table. Instant.

ALTER TABLE `hrm_settings`
  ADD COLUMN `attendance_report_off_at` DATETIME(3) NULL,
  ADD COLUMN `photo_selection_off_at` DATETIME(3) NULL;
