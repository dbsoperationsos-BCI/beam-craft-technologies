-- CreateTable
CREATE TABLE `Department` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `parentDepartmentId` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Department_code_key`(`code`),
    INDEX `Department_parentDepartmentId_idx`(`parentDepartmentId`),
    INDEX `Department_isActive_name_idx`(`isActive`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Designation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT, `code` VARCHAR(50) NOT NULL, `name` VARCHAR(120) NOT NULL, `description` TEXT NULL, `isActive` BOOLEAN NOT NULL DEFAULT true, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Designation_code_key`(`code`), INDEX `Designation_isActive_name_idx`(`isActive`, `name`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EmploymentType` (
    `id` INTEGER NOT NULL AUTO_INCREMENT, `code` VARCHAR(50) NOT NULL, `name` VARCHAR(120) NOT NULL, `description` TEXT NULL, `isActive` BOOLEAN NOT NULL DEFAULT true, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `EmploymentType_code_key`(`code`), INDEX `EmploymentType_isActive_name_idx`(`isActive`, `name`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Location` (
    `id` INTEGER NOT NULL AUTO_INCREMENT, `code` VARCHAR(50) NOT NULL, `name` VARCHAR(120) NOT NULL, `address` TEXT NULL, `description` TEXT NULL, `isActive` BOOLEAN NOT NULL DEFAULT true, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Location_code_key`(`code`), INDEX `Location_isActive_name_idx`(`isActive`, `name`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Skill` (
    `id` INTEGER NOT NULL AUTO_INCREMENT, `code` VARCHAR(50) NOT NULL, `name` VARCHAR(120) NOT NULL, `description` TEXT NULL, `isActive` BOOLEAN NOT NULL DEFAULT true, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Skill_code_key`(`code`), INDEX `Skill_isActive_name_idx`(`isActive`, `name`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Language` (
    `id` INTEGER NOT NULL AUTO_INCREMENT, `code` VARCHAR(50) NOT NULL, `name` VARCHAR(120) NOT NULL, `description` TEXT NULL, `isActive` BOOLEAN NOT NULL DEFAULT true, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Language_code_key`(`code`), INDEX `Language_isActive_name_idx`(`isActive`, `name`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WorkType` (
    `id` INTEGER NOT NULL AUTO_INCREMENT, `code` VARCHAR(50) NOT NULL, `name` VARCHAR(120) NOT NULL, `description` TEXT NULL, `isActive` BOOLEAN NOT NULL DEFAULT true, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `WorkType_code_key`(`code`), INDEX `WorkType_isActive_name_idx`(`isActive`, `name`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EmployeeStatus` (
    `id` INTEGER NOT NULL AUTO_INCREMENT, `code` VARCHAR(50) NOT NULL, `name` VARCHAR(120) NOT NULL, `description` TEXT NULL, `color` VARCHAR(20) NULL, `sortOrder` INTEGER NOT NULL DEFAULT 0, `isActive` BOOLEAN NOT NULL DEFAULT true, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `EmployeeStatus_code_key`(`code`), INDEX `EmployeeStatus_isActive_sortOrder_idx`(`isActive`, `sortOrder`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Department` ADD CONSTRAINT `Department_parentDepartmentId_fkey` FOREIGN KEY (`parentDepartmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
