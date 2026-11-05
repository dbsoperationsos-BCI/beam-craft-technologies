-- The role each past stint was worked in, for the profile's Work History flow: the designation and
-- department the employee held when they left, kept on their rejoin row (their record's own may
-- change after they come back). Adds two nullable columns; no existing row is changed.
ALTER TABLE `employee_rejoin` ADD COLUMN `designation` VARCHAR(150) NULL,
    ADD COLUMN `department` VARCHAR(150) NULL;
