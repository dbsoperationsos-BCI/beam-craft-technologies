-- A half day is a band of hours, not a ceiling.
--
-- `half_day_minutes` said "worked less than this and the day is half a day", which cannot express
-- what a studio means by it. It credited somebody who was here for twenty minutes with half a day,
-- and it made four hours exactly a *full* day — the boundary landing on the wrong side of the one
-- number anybody would name.
--
-- Four to five hours is a half day. Below four is too short to credit and reads as an absence; above
-- five is a full day, judged then on when the person arrived and left.
--
-- The existing column is renamed rather than dropped and recreated, so a studio that had already
-- set a threshold keeps the number: what it held is the figure that now means "at least this much
-- to earn a half day", which is the same quantity read from the other side.
--
-- Written by hand and applied with `prisma migrate deploy`.

ALTER TABLE `attendance_settings`
  CHANGE COLUMN `half_day_minutes` `half_day_min_minutes` INTEGER NOT NULL DEFAULT 240,
  ADD COLUMN `half_day_max_minutes` INTEGER NOT NULL DEFAULT 300;
