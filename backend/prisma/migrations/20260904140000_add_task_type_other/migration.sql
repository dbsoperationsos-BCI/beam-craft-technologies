-- What a task of type "Other" actually was, typed beside the dropdown. Nullable because every
-- named type leaves it empty, and existing tasks predate the field.
ALTER TABLE `hrm_task` ADD COLUMN `task_type_other` VARCHAR(120) NULL;
