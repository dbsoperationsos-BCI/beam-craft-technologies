-- Break In and Break Off carry the same evidence as a login and logout: a live selfie, a live
-- position and the server's time. The capture itself is a row in `attendance_event` (types
-- BREAK_START and BREAK_END); the break points at the two, so its photos and positions can be shown
-- beside it. Both nullable: a break ended by the logout has no Break Off capture of its own, and the
-- breaks recorded before this carried none.

ALTER TABLE `attendance_break`
  ADD COLUMN `start_event_id` INTEGER NULL,
  ADD COLUMN `end_event_id` INTEGER NULL;
