-- The shoot crew notice sweeps a three-day window of `project_shoot.date_created` every minute
-- (`shoot-crew-notice/due.js`). Without an index that is a table scan per tick, paid every minute
-- for as long as the app runs - on a studio with thousands of shoots, forever.
--
-- An online index add on MySQL 8: the table stays readable and writable while it is built, and
-- nothing is read or rewritten. Separate from the feature's own migration, which is already applied.
CREATE INDEX `project_shoot_date_created_idx` ON `project_shoot`(`date_created`);
