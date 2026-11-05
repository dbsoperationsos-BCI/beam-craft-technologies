-- Client Zone: the two gifts a project owes its client, each with the person who is to take care
-- of it and where it has got to.
--
-- Welcome Gift was already a bare "Applicable / Not Applicable" answer with nobody named against
-- it, so an applicable gift was a fact nobody owned. Shoot Completed Gift is the second of the
-- pair, and both now carry an assignee and a status the Client Zone screen moves along:
-- "Yet To Receive" -> "Sent" -> "Received by Client".
--
-- The assignee is stored as a name and an employee id together, the way every other project
-- assignment is, so renaming an employee does not rewrite who a gift was given to.
ALTER TABLE `sales_project`
  ADD COLUMN `welcome_gift_employee_id` INT NULL,
  ADD COLUMN `welcome_gift_assignee` VARCHAR(191) NULL,
  ADD COLUMN `welcome_gift_status` VARCHAR(30) NULL,
  ADD COLUMN `welcome_gift_sent_at` DATETIME(3) NULL,
  ADD COLUMN `welcome_gift_received_at` DATETIME(3) NULL,
  ADD COLUMN `shoot_completed_gift` VARCHAR(30) NULL,
  ADD COLUMN `shoot_completed_gift_employee_id` INT NULL,
  ADD COLUMN `shoot_completed_gift_assignee` VARCHAR(191) NULL,
  ADD COLUMN `shoot_completed_gift_status` VARCHAR(30) NULL,
  ADD COLUMN `shoot_completed_gift_sent_at` DATETIME(3) NULL,
  ADD COLUMN `shoot_completed_gift_received_at` DATETIME(3) NULL;

-- The two questions Client Zone asks: one gift's applicable projects, narrowed by the status tab.
CREATE INDEX `sales_project_welcome_gift_welcome_gift_status_idx`
  ON `sales_project`(`welcome_gift`, `welcome_gift_status`);
CREATE INDEX `sales_project_shoot_completed_gift_shoot_completed_gift_sta_idx`
  ON `sales_project`(`shoot_completed_gift`, `shoot_completed_gift_status`);

-- A project already marked Applicable has a gift outstanding, so it starts on the first tab
-- rather than being invisible until somebody re-saves the project.
UPDATE `sales_project` SET `welcome_gift_status` = 'Yet To Receive'
  WHERE `welcome_gift` = 'Applicable' AND `welcome_gift_status` IS NULL;
