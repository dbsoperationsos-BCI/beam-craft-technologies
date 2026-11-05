-- AlterTable
ALTER TABLE `User` ADD COLUMN `accessDepartment` VARCHAR(100) NULL,
    ADD COLUMN `credentialsSentAt` DATETIME(3) NULL,
    ADD COLUMN `lastLoginAt` DATETIME(3) NULL,
    ADD COLUMN `linkedEmployeeId` INTEGER NULL,
    ADD COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `username` VARCHAR(50) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `User_username_key` ON `User`(`username`);

-- CreateIndex
CREATE UNIQUE INDEX `User_linkedEmployeeId_key` ON `User`(`linkedEmployeeId`);

-- CreateIndex
CREATE INDEX `User_accessDepartment_idx` ON `User`(`accessDepartment`);
