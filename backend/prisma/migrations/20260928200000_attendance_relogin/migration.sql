-- Somebody can log in and out more than once a day. The day stays one `attendance_session` row - its
-- `login_at` the first login, its `logout_at` the latest logout - and a login after a logout re-opens
-- it. Two columns keep the rest honest:
--
--   `away_minutes`  the time spent logged out between a logout and the next login, all such gaps
--                   added up. It is taken off the day's worked time: somebody logged out was not
--                   working. 9:00-13:00 and 14:00-18:00 is 8 hours, not 9.
--   `login_count`   how many times the day was logged in - 1 for every day recorded before this.
--
-- Every login and logout is still its own `attendance_event`, with its photograph and position.
--
-- Cost: two columns with defaults on `attendance_session`. Instant on MySQL 8 (INSTANT add column).

ALTER TABLE `attendance_session`
  ADD COLUMN `away_minutes` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `login_count` INTEGER NOT NULL DEFAULT 1;
