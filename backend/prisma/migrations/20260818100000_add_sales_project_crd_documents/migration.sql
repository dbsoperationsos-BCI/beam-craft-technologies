CREATE TABLE `SalesProjectCrdDocument` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `publicToken` VARCHAR(16) NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'Sent',
  `submission` JSON NULL,
  `submittedAt` DATETIME(3) NULL,
  `createdByUserId` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `SalesProjectCrdDocument_projectId_key`(`projectId`),
  UNIQUE INDEX `SalesProjectCrdDocument_publicToken_key`(`publicToken`),
  INDEX `SalesProjectCrdDocument_createdAt_idx`(`createdAt`),
  INDEX `SalesProjectCrdDocument_publicToken_idx`(`publicToken`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
