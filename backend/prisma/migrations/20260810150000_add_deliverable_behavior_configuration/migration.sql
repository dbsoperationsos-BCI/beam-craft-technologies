ALTER TABLE `ProjectDeliverableDefinition`
    ADD COLUMN `photoCountEnabled` BOOLEAN NULL,
    ADD COLUMN `sizeOptionSetId` VARCHAR(191) NULL,
    ADD COLUMN `remarksEnabled` BOOLEAN NULL;

ALTER TABLE `ProjectShootDeliverable`
    ADD COLUMN `sizeOptionValueId` VARCHAR(191) NULL;

CREATE INDEX `ProjectDeliverableDefinition_sizeOptionSetId_idx`
    ON `ProjectDeliverableDefinition`(`sizeOptionSetId`);

CREATE INDEX `ProjectShootDeliverable_sizeOptionValueId_idx`
    ON `ProjectShootDeliverable`(`sizeOptionValueId`);

ALTER TABLE `ProjectDeliverableDefinition`
    ADD CONSTRAINT `ProjectDeliverableDefinition_sizeOptionSetId_fkey`
    FOREIGN KEY (`sizeOptionSetId`)
    REFERENCES `ProjectOptionSet`(`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE;

ALTER TABLE `ProjectShootDeliverable`
    ADD CONSTRAINT `ProjectShootDeliverable_sizeOptionValueId_fkey`
    FOREIGN KEY (`sizeOptionValueId`)
    REFERENCES `ProjectOptionSetValue`(`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE;
