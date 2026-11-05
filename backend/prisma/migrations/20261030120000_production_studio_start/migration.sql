-- The Studio Start Date and Time move from pre production's shoot form to the Production Manager's
-- plan. Additive: pre production's columns stay (deprecated) for shoots whose production is not
-- raised yet, and are carried over when it is (`ensureProjectProduction`).
ALTER TABLE `project_production`
  ADD COLUMN `studio_start_date` DATETIME(3) NULL,
  ADD COLUMN `studio_start_time` VARCHAR(5) NULL;

-- Every production already raised takes its shoot's answer from pre production.
UPDATE `project_production` AS `production`
  INNER JOIN `project_pre_production` AS `pre` ON `pre`.`shoot_id` = `production`.`shoot_id`
SET `production`.`studio_start_date` = `pre`.`studio_start_date`,
    `production`.`studio_start_time` = `pre`.`studio_start_time`
WHERE `production`.`studio_start_date` IS NULL
  AND `production`.`studio_start_time` IS NULL
  AND (`pre`.`studio_start_date` IS NOT NULL OR `pre`.`studio_start_time` IS NOT NULL);
