-- CreateTable
CREATE TABLE `EmployeeOnboardingInvite` (
    `id` VARCHAR(191) NOT NULL,
    `candidateName` VARCHAR(150) NOT NULL,
    `candidateEmail` VARCHAR(191) NOT NULL,
    `candidatePhone` VARCHAR(30) NOT NULL,
    `intendedDesignation` VARCHAR(150) NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `tokenPreview` VARCHAR(32) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'Created',
    `expiresAt` DATETIME(3) NOT NULL,
    `verifiedAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NULL,
    `employeeId` VARCHAR(50) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `EmployeeOnboardingInvite_tokenHash_key`(`tokenHash`),
    INDEX `EmployeeOnboardingInvite_status_expiresAt_idx`(`status`, `expiresAt`),
    INDEX `EmployeeOnboardingInvite_candidateEmail_idx`(`candidateEmail`),
    INDEX `EmployeeOnboardingInvite_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
