-- AlterTable
ALTER TABLE `employee` ADD COLUMN `alternative1_employee_id` INTEGER NULL,
    ADD COLUMN `alternative2_employee_id` INTEGER NULL;

-- CreateIndex
CREATE INDEX `employee_alternative1_employee_id_idx` ON `employee`(`alternative1_employee_id`);

-- CreateIndex
CREATE INDEX `employee_alternative2_employee_id_idx` ON `employee`(`alternative2_employee_id`);

-- AddForeignKey
ALTER TABLE `employee` ADD CONSTRAINT `employee_alternative1_employee_id_fkey` FOREIGN KEY (`alternative1_employee_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee` ADD CONSTRAINT `employee_alternative2_employee_id_fkey` FOREIGN KEY (`alternative2_employee_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
