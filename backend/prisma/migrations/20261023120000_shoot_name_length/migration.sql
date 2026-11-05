-- Several shoots ticked in Add Shoot become one shoot named for all of them ("Haldi + Mehandi"),
-- so the name needs more room than 100 characters: five of the studio's longest names with their
-- separators come to 107. Widening a VARCHAR keeps every row as it is.
ALTER TABLE `project_shoot` MODIFY `shoot` VARCHAR(191) NOT NULL;
