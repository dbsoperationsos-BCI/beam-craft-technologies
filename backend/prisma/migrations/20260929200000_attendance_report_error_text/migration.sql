-- The daily report's failure trace now names every number tried, in order, not only the last - a
-- studio with several employees eligible to send it can produce a longer trace than 500 characters
-- held. Widened rather than left to truncate silently.
ALTER TABLE `hrm_settings`
  MODIFY COLUMN `attendance_report_last_error` TEXT NULL;
