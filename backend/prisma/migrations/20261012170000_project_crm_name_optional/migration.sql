-- The CRM's name on a project may be empty.
--
-- `crm_employee_id` beside it has always been nullable; the text was not, so a booking the studio's old
-- sheet names no CRM for could not be imported at all - the row was refused for the one empty cell.
-- Pre Production → Import may now leave it, and the project form still asks for one, so nothing the
-- studio types changes.
--
-- Cost: one column widened to accept NULL. No existing row is touched - every one of them holds a name
-- already - and no index or key changes.

ALTER TABLE `sales_project` MODIFY `crm_name` VARCHAR(191) NULL;
