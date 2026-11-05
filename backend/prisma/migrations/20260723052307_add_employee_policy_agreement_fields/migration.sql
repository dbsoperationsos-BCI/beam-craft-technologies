-- AlterTable
ALTER TABLE `Employee` ADD COLUMN `policyAgreementAccepted` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `policyAgreementAcceptedAt` DATETIME(3) NULL;
