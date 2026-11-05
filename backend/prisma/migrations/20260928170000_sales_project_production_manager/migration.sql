-- The Production Manager a project is staffed to, assigned from Pre Production's General panel.
--
-- The fifth seat on a project, beside the Project Manager, the two coordinators and the Creative
-- Manager, and shaped exactly like them: the id is the link, and the name beside it is the copy a
-- rename rewrites (see `backend/src/services/nameCopies.js`). Nullable with no default, because
-- every project that already exists has nobody in this seat and that is a real answer rather than a
-- gap to fill.
--
-- `ON DELETE SET NULL`, as the other four seats do: an employee record being removed empties the
-- seat rather than taking the project with it.
ALTER TABLE `sales_project`
  ADD COLUMN `production_manager` VARCHAR(191) NULL,
  ADD COLUMN `production_manager_employee_id` INTEGER NULL;

CREATE INDEX `sales_project_production_manager_employee_id_idx`
  ON `sales_project`(`production_manager_employee_id`);

ALTER TABLE `sales_project`
  ADD CONSTRAINT `sales_project_production_manager_employee_id_fkey`
  FOREIGN KEY (`production_manager_employee_id`) REFERENCES `employee`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
  