/*
  Warnings:

  - You are about to drop the `AppSequence` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Asset` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AssetCategory` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AssetMaintenance` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AssetRequest` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AssetStatusLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ClientStorage` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Department` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Designation` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Employee` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EmployeeOnboardingInvite` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EmployeeStatus` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EmploymentType` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ImageSelectionDeliverableConfig` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ImageSelectionFolder` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ImageSelectionGalleryPublication` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ImageSelectionPhotoSelection` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ImageSelectionProject` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ImageSelectionSettings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ImageSelectionUpload` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ImageSelectionUploadBatch` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ImageSelectionWhatsAppNotification` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Language` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Location` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProjectAttachment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProjectDeliverableDefinition` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProjectOptionSet` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProjectOptionSetValue` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProjectPostProductionAllocation` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProjectPostProductionWorkflowAllocation` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProjectPostProductionWorkflowDefinition` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProjectServiceDefinition` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProjectShoot` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProjectShootDeliverable` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SalesCrmDynamicColumn` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SalesCrmLead` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SalesCrmLeadWatch` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SalesCrmMeeting` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SalesGoogleAccountConnection` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SalesGoogleOAuthState` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SalesGoogleSheetLink` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SalesProject` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SalesProjectCrdDocument` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SalesQuotation` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SalesWhatsappGroupName` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Skill` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Vendor` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WorkType` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `leads` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `Asset` DROP FOREIGN KEY `Asset_assigned_person_id_fkey`;

-- DropForeignKey
ALTER TABLE `Asset` DROP FOREIGN KEY `Asset_branch_id_fkey`;

-- DropForeignKey
ALTER TABLE `Asset` DROP FOREIGN KEY `Asset_category_id_fkey`;

-- DropForeignKey
ALTER TABLE `Asset` DROP FOREIGN KEY `Asset_manager_id_fkey`;

-- DropForeignKey
ALTER TABLE `AssetCategory` DROP FOREIGN KEY `AssetCategory_parent_id_fkey`;

-- DropForeignKey
ALTER TABLE `AssetMaintenance` DROP FOREIGN KEY `AssetMaintenance_asset_id_fkey`;

-- DropForeignKey
ALTER TABLE `AssetMaintenance` DROP FOREIGN KEY `AssetMaintenance_received_and_checked_by_id_fkey`;

-- DropForeignKey
ALTER TABLE `AssetMaintenance` DROP FOREIGN KEY `AssetMaintenance_repaired_by_id_fkey`;

-- DropForeignKey
ALTER TABLE `AssetMaintenance` DROP FOREIGN KEY `AssetMaintenance_submitted_by_id_fkey`;

-- DropForeignKey
ALTER TABLE `AssetRequest` DROP FOREIGN KEY `AssetRequest_asset_id_fkey`;

-- DropForeignKey
ALTER TABLE `AssetRequest` DROP FOREIGN KEY `AssetRequest_category_id_fkey`;

-- DropForeignKey
ALTER TABLE `AssetRequest` DROP FOREIGN KEY `AssetRequest_sub_category_id_fkey`;

-- DropForeignKey
ALTER TABLE `AssetStatusLog` DROP FOREIGN KEY `AssetStatusLog_asset_id_fkey`;

-- DropForeignKey
ALTER TABLE `AssetStatusLog` DROP FOREIGN KEY `AssetStatusLog_assigned_from_id_fkey`;

-- DropForeignKey
ALTER TABLE `AssetStatusLog` DROP FOREIGN KEY `AssetStatusLog_assigned_to_id_fkey`;

-- DropForeignKey
ALTER TABLE `ClientStorage` DROP FOREIGN KEY `ClientStorage_assigned_to_id_fkey`;

-- DropForeignKey
ALTER TABLE `ClientStorage` DROP FOREIGN KEY `ClientStorage_project_id_fkey`;

-- DropForeignKey
ALTER TABLE `ClientStorage` DROP FOREIGN KEY `ClientStorage_shoot_id_fkey`;

-- DropForeignKey
ALTER TABLE `Department` DROP FOREIGN KEY `Department_parentDepartmentId_fkey`;

-- DropForeignKey
ALTER TABLE `ImageSelectionDeliverableConfig` DROP FOREIGN KEY `ImageSelectionDeliverableConfig_imageSelectionProjectId_fkey`;

-- DropForeignKey
ALTER TABLE `ImageSelectionDeliverableConfig` DROP FOREIGN KEY `ImageSelectionDeliverableConfig_projectPostProductionAlloca_fkey`;

-- DropForeignKey
ALTER TABLE `ImageSelectionDeliverableConfig` DROP FOREIGN KEY `ImageSelectionDeliverableConfig_projectShootDeliverableId_fkey`;

-- DropForeignKey
ALTER TABLE `ImageSelectionFolder` DROP FOREIGN KEY `ImageSelectionFolder_parentId_fkey`;

-- DropForeignKey
ALTER TABLE `ImageSelectionFolder` DROP FOREIGN KEY `ImageSelectionFolder_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `ImageSelectionFolder` DROP FOREIGN KEY `ImageSelectionFolder_projectShootId_fkey`;

-- DropForeignKey
ALTER TABLE `ImageSelectionGalleryPublication` DROP FOREIGN KEY `ImageSelectionGalleryPublication_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `ImageSelectionPhotoSelection` DROP FOREIGN KEY `ImageSelectionPhotoSelection_imageSelectionDeliverableConfi_fkey`;

-- DropForeignKey
ALTER TABLE `ImageSelectionPhotoSelection` DROP FOREIGN KEY `ImageSelectionPhotoSelection_imageSelectionUploadId_fkey`;

-- DropForeignKey
ALTER TABLE `ImageSelectionProject` DROP FOREIGN KEY `ImageSelectionProject_salesProjectId_fkey`;

-- DropForeignKey
ALTER TABLE `ImageSelectionUpload` DROP FOREIGN KEY `ImageSelectionUpload_batchId_fkey`;

-- DropForeignKey
ALTER TABLE `ImageSelectionUpload` DROP FOREIGN KEY `ImageSelectionUpload_folderId_fkey`;

-- DropForeignKey
ALTER TABLE `ImageSelectionUpload` DROP FOREIGN KEY `ImageSelectionUpload_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `ImageSelectionUploadBatch` DROP FOREIGN KEY `ImageSelectionUploadBatch_folderId_fkey`;

-- DropForeignKey
ALTER TABLE `ImageSelectionUploadBatch` DROP FOREIGN KEY `ImageSelectionUploadBatch_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `ImageSelectionWhatsAppNotification` DROP FOREIGN KEY `ImageSelectionWhatsAppNotification_imageSelectionProjectId_fkey`;

-- DropForeignKey
ALTER TABLE `ImageSelectionWhatsAppNotification` DROP FOREIGN KEY `ImageSelectionWhatsAppNotification_salesProjectId_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectAttachment` DROP FOREIGN KEY `ProjectAttachment_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectDeliverableDefinition` DROP FOREIGN KEY `ProjectDeliverableDefinition_sizeOptionSetId_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectOptionSetValue` DROP FOREIGN KEY `ProjectOptionSetValue_optionSetId_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectPostProductionAllocation` DROP FOREIGN KEY `ProjectPostProductionAllocation_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectPostProductionAllocation` DROP FOREIGN KEY `ProjectPostProductionAllocation_serviceDefinitionId_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectPostProductionAllocation` DROP FOREIGN KEY `ProjectPostProductionAllocation_sessionOptionId_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectPostProductionAllocation` DROP FOREIGN KEY `ProjectPostProductionAllocation_shootId_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectPostProductionAllocation` DROP FOREIGN KEY `ProjectPostProductionAllocation_sizeOptionValueId_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectPostProductionWorkflowAllocation` DROP FOREIGN KEY `ProjectPostProductionWorkflowAllocation_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectPostProductionWorkflowAllocation` DROP FOREIGN KEY `ProjectPostProductionWorkflowAllocation_serviceAllocationId_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectPostProductionWorkflowAllocation` DROP FOREIGN KEY `ProjectPostProductionWorkflowAllocation_shootId_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectPostProductionWorkflowAllocation` DROP FOREIGN KEY `ProjectPostProductionWorkflowAllocation_workflowDefinitionI_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectPostProductionWorkflowDefinition` DROP FOREIGN KEY `ProjectPostProductionWorkflowDefinition_serviceDefinitionId_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectServiceDefinition` DROP FOREIGN KEY `ProjectServiceDefinition_sizeOptionSetId_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectServiceDefinition` DROP FOREIGN KEY `ProjectServiceDefinition_timingOptionSetId_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectShoot` DROP FOREIGN KEY `ProjectShoot_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectShootDeliverable` DROP FOREIGN KEY `ProjectShootDeliverable_deliverableDefinitionId_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectShootDeliverable` DROP FOREIGN KEY `ProjectShootDeliverable_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectShootDeliverable` DROP FOREIGN KEY `ProjectShootDeliverable_shootId_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectShootDeliverable` DROP FOREIGN KEY `ProjectShootDeliverable_sizeOptionValueId_fkey`;

-- DropTable
DROP TABLE `AppSequence`;

-- DropTable
DROP TABLE `Asset`;

-- DropTable
DROP TABLE `AssetCategory`;

-- DropTable
DROP TABLE `AssetMaintenance`;

-- DropTable
DROP TABLE `AssetRequest`;

-- DropTable
DROP TABLE `AssetStatusLog`;

-- DropTable
DROP TABLE `ClientStorage`;

-- DropTable
DROP TABLE `Department`;

-- DropTable
DROP TABLE `Designation`;

-- DropTable
DROP TABLE `Employee`;

-- DropTable
DROP TABLE `EmployeeOnboardingInvite`;

-- DropTable
DROP TABLE `EmployeeStatus`;

-- DropTable
DROP TABLE `EmploymentType`;

-- DropTable
DROP TABLE `ImageSelectionDeliverableConfig`;

-- DropTable
DROP TABLE `ImageSelectionFolder`;

-- DropTable
DROP TABLE `ImageSelectionGalleryPublication`;

-- DropTable
DROP TABLE `ImageSelectionPhotoSelection`;

-- DropTable
DROP TABLE `ImageSelectionProject`;

-- DropTable
DROP TABLE `ImageSelectionSettings`;

-- DropTable
DROP TABLE `ImageSelectionUpload`;

-- DropTable
DROP TABLE `ImageSelectionUploadBatch`;

-- DropTable
DROP TABLE `ImageSelectionWhatsAppNotification`;

-- DropTable
DROP TABLE `Language`;

-- DropTable
DROP TABLE `Location`;

-- DropTable
DROP TABLE `ProjectAttachment`;

-- DropTable
DROP TABLE `ProjectDeliverableDefinition`;

-- DropTable
DROP TABLE `ProjectOptionSet`;

-- DropTable
DROP TABLE `ProjectOptionSetValue`;

-- DropTable
DROP TABLE `ProjectPostProductionAllocation`;

-- DropTable
DROP TABLE `ProjectPostProductionWorkflowAllocation`;

-- DropTable
DROP TABLE `ProjectPostProductionWorkflowDefinition`;

-- DropTable
DROP TABLE `ProjectServiceDefinition`;

-- DropTable
DROP TABLE `ProjectShoot`;

-- DropTable
DROP TABLE `ProjectShootDeliverable`;

-- DropTable
DROP TABLE `SalesCrmDynamicColumn`;

-- DropTable
DROP TABLE `SalesCrmLead`;

-- DropTable
DROP TABLE `SalesCrmLeadWatch`;

-- DropTable
DROP TABLE `SalesCrmMeeting`;

-- DropTable
DROP TABLE `SalesGoogleAccountConnection`;

-- DropTable
DROP TABLE `SalesGoogleOAuthState`;

-- DropTable
DROP TABLE `SalesGoogleSheetLink`;

-- DropTable
DROP TABLE `SalesProject`;

-- DropTable
DROP TABLE `SalesProjectCrdDocument`;

-- DropTable
DROP TABLE `SalesQuotation`;

-- DropTable
DROP TABLE `SalesWhatsappGroupName`;

-- DropTable
DROP TABLE `Skill`;

-- DropTable
DROP TABLE `User`;

-- DropTable
DROP TABLE `Vendor`;

-- DropTable
DROP TABLE `WorkType`;

-- DropTable
DROP TABLE `leads`;

-- CreateTable
CREATE TABLE `user` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `username` VARCHAR(50) NULL,
    `password` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'SUPER_ADMIN',
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `linked_employee_id` INTEGER NULL,
    `access_department` VARCHAR(100) NULL,
    `must_change_password` BOOLEAN NOT NULL DEFAULT true,
    `credentials_sent_at` DATETIME(3) NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_email_key`(`email`),
    UNIQUE INDEX `user_username_key`(`username`),
    UNIQUE INDEX `user_linked_employee_id_key`(`linked_employee_id`),
    INDEX `user_access_department_idx`(`access_department`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` VARCHAR(50) NOT NULL,
    `employee_name` VARCHAR(150) NOT NULL,
    `employment_status` VARCHAR(30) NOT NULL DEFAULT 'pending',
    `gender` VARCHAR(30) NULL,
    `contact_number` VARCHAR(30) NULL,
    `email_id` VARCHAR(191) NULL,
    `work_email_id` VARCHAR(191) NULL,
    `date_of_joining` DATETIME(3) NULL,
    `designation` VARCHAR(150) NULL,
    `department` VARCHAR(150) NULL,
    `skills` TEXT NULL,
    `vertical` VARCHAR(150) NULL,
    `work_base_location` VARCHAR(150) NULL,
    `current_work_location` VARCHAR(150) NULL,
    `photo_shooter` BOOLEAN NULL,
    `work_type` VARCHAR(100) NULL,
    `languages_known` TEXT NULL,
    `blood_group` VARCHAR(10) NULL,
    `emergency_contact_name` VARCHAR(150) NULL,
    `emergency_contact_number` VARCHAR(30) NULL,
    `emergency_contact_relationship` VARCHAR(100) NULL,
    `aadhar_card_number` VARCHAR(50) NULL,
    `pan_card_number` VARCHAR(50) NULL,
    `father_name` VARCHAR(150) NULL,
    `father_occupation` VARCHAR(150) NULL,
    `mother_name` VARCHAR(150) NULL,
    `mother_occupation` VARCHAR(150) NULL,
    `spouse_name` VARCHAR(150) NULL,
    `date_of_birth` DATETIME(3) NULL,
    `marital_status` VARCHAR(50) NULL,
    `wedding_anniversary` DATETIME(3) NULL,
    `current_address` TEXT NULL,
    `permanent_address` TEXT NULL,
    `reference1_person_name` VARCHAR(150) NULL,
    `reference1_person_phone` VARCHAR(30) NULL,
    `reference1_person_address` TEXT NULL,
    `reference2_person_name` VARCHAR(150) NULL,
    `reference2_person_phone` VARCHAR(30) NULL,
    `reference2_person_address` TEXT NULL,
    `nominee1_person_name` VARCHAR(150) NULL,
    `nominee1_person_phone` VARCHAR(30) NULL,
    `nominee2_person_name` VARCHAR(150) NULL,
    `nominee2_person_phone` VARCHAR(30) NULL,
    `bank_name` VARCHAR(150) NULL,
    `bank_location` VARCHAR(150) NULL,
    `account_number` VARCHAR(100) NULL,
    `ifsc_code` VARCHAR(30) NULL,
    `bank_account_status` VARCHAR(50) NULL,
    `added_accounts` TEXT NULL,
    `company_mentioned_name` VARCHAR(150) NULL,
    `date_of_relieving` DATETIME(3) NULL,
    `relieving_remarks` TEXT NULL,
    `total_salary` DECIMAL(12, 2) NULL,
    `joining_salary` DECIMAL(12, 2) NULL,
    `last_review_date` DATETIME(3) NULL,
    `next_review_date` DATETIME(3) NULL,
    `total_increment` DECIMAL(12, 2) NULL,
    `increment_01` DECIMAL(12, 2) NULL,
    `increment_01_date` DATETIME(3) NULL,
    `increment_02` DECIMAL(12, 2) NULL,
    `increment_02_date` DATETIME(3) NULL,
    `increment_03` DECIMAL(12, 2) NULL,
    `increment_03_date` DATETIME(3) NULL,
    `increment_04` DECIMAL(12, 2) NULL,
    `increment_04_date` DATETIME(3) NULL,
    `increment_05` DECIMAL(12, 2) NULL,
    `increment_05_date` DATETIME(3) NULL,
    `increment_06` DECIMAL(12, 2) NULL,
    `increment_06_date` DATETIME(3) NULL,
    `increment_07` DECIMAL(12, 2) NULL,
    `increment_07_date` DATETIME(3) NULL,
    `increment_08` DECIMAL(12, 2) NULL,
    `increment_08_date` DATETIME(3) NULL,
    `increment_09` DECIMAL(12, 2) NULL,
    `increment_09_date` DATETIME(3) NULL,
    `increment_10` DECIMAL(12, 2) NULL,
    `increment_10_date` DATETIME(3) NULL,
    `remarks_details` TEXT NULL,
    `appreciation_details` TEXT NULL,
    `policy_agreement_accepted` BOOLEAN NOT NULL DEFAULT false,
    `policy_agreement_accepted_at` DATETIME(3) NULL,
    `archived_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `employee_employee_id_key`(`employee_id`),
    INDEX `employee_employment_status_idx`(`employment_status`),
    INDEX `employee_employee_name_idx`(`employee_name`),
    INDEX `employee_created_at_idx`(`created_at`),
    INDEX `employee_archived_at_idx`(`archived_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_onboarding_invite` (
    `id` VARCHAR(191) NOT NULL,
    `candidate_name` VARCHAR(150) NOT NULL,
    `candidate_email` VARCHAR(191) NOT NULL,
    `candidate_phone` VARCHAR(30) NOT NULL,
    `intended_designation` VARCHAR(150) NULL,
    `token_hash` CHAR(64) NOT NULL,
    `token_preview` VARCHAR(32) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'Created',
    `expires_at` DATETIME(3) NOT NULL,
    `verified_at` DATETIME(3) NULL,
    `submitted_at` DATETIME(3) NULL,
    `employee_id` VARCHAR(50) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `employee_onboarding_invite_token_hash_key`(`token_hash`),
    INDEX `employee_onboarding_invite_status_expires_at_idx`(`status`, `expires_at`),
    INDEX `employee_onboarding_invite_candidate_email_idx`(`candidate_email`),
    INDEX `employee_onboarding_invite_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_project` (
    `id` VARCHAR(191) NOT NULL,
    `enquiry_id` VARCHAR(100) NOT NULL,
    `event_id` VARCHAR(30) NOT NULL,
    `whatsapp_group_name_id` VARCHAR(191) NULL,
    `whatsapp_group_name` VARCHAR(500) NOT NULL,
    `client_main_number` VARCHAR(30) NOT NULL,
    `vertical` VARCHAR(30) NULL,
    `source_branch` VARCHAR(30) NOT NULL,
    `deliverables` VARCHAR(100) NOT NULL,
    `deliverables_details` TEXT NULL,
    `sales_pre_production_remarks` TEXT NULL,
    `sales_production_remarks` TEXT NULL,
    `sales_post_production_remarks` TEXT NULL,
    `main_event_date_known` BOOLEAN NOT NULL DEFAULT false,
    `main_event_date` DATETIME(3) NULL,
    `initial_converted_value` DECIMAL(12, 2) NOT NULL,
    `crm_name` VARCHAR(191) NOT NULL,
    `crm_employee_id` INTEGER NULL,
    `group_type` VARCHAR(30) NULL,
    `group_name_generator_json` JSON NULL,
    `project_status` VARCHAR(60) NOT NULL DEFAULT 'Yet to Start',
    `project_manager` VARCHAR(191) NULL,
    `project_manager_employee_id` INTEGER NULL,
    `pre_production_coordinator` VARCHAR(191) NULL,
    `pre_production_coordinator_employee_id` INTEGER NULL,
    `creative_manager` VARCHAR(191) NULL,
    `creative_manager_employee_id` INTEGER NULL,
    `post_production_coordinator` VARCHAR(191) NULL,
    `post_production_coordinator_employee_id` INTEGER NULL,
    `welcome_gift` VARCHAR(30) NULL,
    `project_validity_months` INTEGER NULL,
    `storage_needed` VARCHAR(10) NULL,
    `crd_document_status` VARCHAR(50) NULL,
    `created_by_user_id` INTEGER NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_project_event_id_key`(`event_id`),
    INDEX `sales_project_created_at_idx`(`created_at`),
    INDEX `sales_project_project_status_idx`(`project_status`),
    INDEX `sales_project_deleted_at_idx`(`deleted_at`),
    INDEX `sales_project_enquiry_id_idx`(`enquiry_id`),
    INDEX `sales_project_whatsapp_group_name_id_idx`(`whatsapp_group_name_id`),
    INDEX `sales_project_crm_employee_id_idx`(`crm_employee_id`),
    INDEX `sales_project_project_manager_employee_id_idx`(`project_manager_employee_id`),
    INDEX `sales_project_pre_production_coordinator_employee_id_idx`(`pre_production_coordinator_employee_id`),
    INDEX `sales_project_creative_manager_employee_id_idx`(`creative_manager_employee_id`),
    INDEX `sales_project_post_production_coordinator_employee_id_idx`(`post_production_coordinator_employee_id`),
    INDEX `sales_project_created_by_user_id_idx`(`created_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_quotation` (
    `id` VARCHAR(191) NOT NULL,
    `quotation_number` VARCHAR(30) NOT NULL,
    `quotation_id` VARCHAR(30) NOT NULL,
    `public_token` VARCHAR(16) NOT NULL,
    `enquiry_id` VARCHAR(100) NULL,
    `client_name` VARCHAR(191) NULL,
    `client_main_number` VARCHAR(30) NULL,
    `source_branch` VARCHAR(30) NULL,
    `event_venue` VARCHAR(500) NULL,
    `followed_by` VARCHAR(191) NULL,
    `referred_by` VARCHAR(191) NULL,
    `secondary_contact_number` VARCHAR(30) NULL,
    `quotation_date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `valid_until` DATETIME(3) NULL,
    `subtotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `discount` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(30) NOT NULL DEFAULT 'Generated',
    `service_count` INTEGER NOT NULL DEFAULT 0,
    `deliverable_count` INTEGER NOT NULL DEFAULT 0,
    `payload` JSON NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_quotation_quotation_number_key`(`quotation_number`),
    UNIQUE INDEX `sales_quotation_quotation_id_key`(`quotation_id`),
    UNIQUE INDEX `sales_quotation_public_token_key`(`public_token`),
    INDEX `sales_quotation_created_at_idx`(`created_at`),
    INDEX `sales_quotation_deleted_at_idx`(`deleted_at`),
    INDEX `sales_quotation_enquiry_id_idx`(`enquiry_id`),
    INDEX `sales_quotation_public_token_idx`(`public_token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_project_crd_document` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `public_token` VARCHAR(16) NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'Sent',
    `submission` JSON NULL,
    `submitted_at` DATETIME(3) NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_project_crd_document_project_id_key`(`project_id`),
    UNIQUE INDEX `sales_project_crd_document_public_token_key`(`public_token`),
    INDEX `sales_project_crd_document_created_at_idx`(`created_at`),
    INDEX `sales_project_crd_document_public_token_idx`(`public_token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_crm_lead` (
    `enquiry_id` VARCHAR(100) NOT NULL,
    `name` TEXT NULL,
    `phone` TEXT NULL,
    `branch` TEXT NULL,
    `status` TEXT NULL,
    `crm` TEXT NULL,
    `added_time` TEXT NULL,
    `created_date` TEXT NULL,
    `relationship` TEXT NULL,
    `referred_from` TEXT NULL,
    `offer_type` TEXT NULL,
    `campaign_name` TEXT NULL,
    `adset_name` TEXT NULL,
    `ad_name` TEXT NULL,
    `preferred_budget` TEXT NULL,
    `city` TEXT NULL,
    `state` TEXT NULL,
    `source` TEXT NULL,
    `assigned_branch` TEXT NULL,
    `event_planned_type` TEXT NULL,
    `event_planned_date` TEXT NULL,
    `groom_name` TEXT NULL,
    `groom_contact` TEXT NULL,
    `groom_location` TEXT NULL,
    `bride_name` TEXT NULL,
    `bride_contact` TEXT NULL,
    `bride_location` TEXT NULL,
    `reference_name` TEXT NULL,
    `reference_contact` TEXT NULL,
    `remarks` TEXT NULL,
    `contact_repeated` TEXT NULL,
    `shoot_type` TEXT NULL,
    `location` TEXT NULL,
    `ih_oh` TEXT NULL,
    `last_follow_up_date` TEXT NULL,
    `next_follow_up_date` TEXT NULL,
    `last_converted_date` TEXT NULL,
    `cna_sequence` TEXT NULL,
    `shoot_id` TEXT NULL,
    `date` TEXT NULL,
    `baby_or_mother_name` TEXT NULL,
    `date_of_birth_or_edod` TEXT NULL,
    `company_name` TEXT NULL,
    `primary_decision_maker` TEXT NULL,
    `designation` TEXT NULL,
    `contact_number` TEXT NULL,
    `alternate_mobile_number` TEXT NULL,
    `official_email_id` TEXT NULL,
    `company_website` TEXT NULL,
    `company_type` TEXT NULL,
    `company_size` TEXT NULL,
    `branches` TEXT NULL,
    `project_type` TEXT NULL,
    `shoot_city` TEXT NULL,
    `expected_budget` TEXT NULL,
    `competitions` TEXT NULL,
    `source_enquiry_id` TEXT NULL,
    `source_row_number` TEXT NULL,
    `spreadsheet_id` TEXT NULL,
    `gid` TEXT NULL,
    `target_tab` TEXT NULL,
    `system_table_id` TEXT NULL,
    `last_source_sync_at` TEXT NULL,
    `next_follow_up_time` TEXT NULL,
    `shoots` LONGTEXT NULL,
    `remark_entries` LONGTEXT NULL,
    `attachments` LONGTEXT NULL,
    `custom_fields` LONGTEXT NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sales_crm_lead_deleted_at_idx`(`deleted_at`),
    INDEX `sales_crm_lead_created_at_idx`(`created_at`),
    PRIMARY KEY (`enquiry_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_crm_dynamic_column` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `branch` VARCHAR(30) NOT NULL,
    `key` VARCHAR(120) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `field_type` VARCHAR(30) NOT NULL DEFAULT 'text',
    `placeholder` VARCHAR(191) NULL,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `options` TEXT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sales_crm_dynamic_column_branch_sort_order_idx`(`branch`, `sort_order`),
    UNIQUE INDEX `sales_crm_dynamic_column_branch_key_key`(`branch`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_crm_lead_watch` (
    `id` VARCHAR(191) NOT NULL,
    `enquiry_id` VARCHAR(100) NOT NULL,
    `branch` VARCHAR(60) NULL,
    `lead_name` VARCHAR(191) NULL,
    `phone` VARCHAR(60) NULL,
    `lead_status` VARCHAR(60) NULL,
    `snapshot` LONGTEXT NOT NULL,
    `added_by_user_id` INTEGER NULL,
    `added_by_name` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_crm_lead_watch_enquiry_id_key`(`enquiry_id`),
    INDEX `sales_crm_lead_watch_created_at_idx`(`created_at`),
    INDEX `sales_crm_lead_watch_branch_idx`(`branch`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_crm_meeting` (
    `id` VARCHAR(191) NOT NULL,
    `enquiry_id` VARCHAR(100) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `start_at` DATETIME(3) NOT NULL,
    `end_at` DATETIME(3) NOT NULL,
    `attendees` TEXT NULL,
    `organizer_email` VARCHAR(191) NULL,
    `google_event_id` VARCHAR(191) NULL,
    `google_calendar_id` VARCHAR(191) NULL,
    `meet_link` VARCHAR(500) NULL,
    `html_link` VARCHAR(500) NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'SCHEDULED',
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sales_crm_meeting_enquiry_id_start_at_idx`(`enquiry_id`, `start_at`),
    INDEX `sales_crm_meeting_google_event_id_idx`(`google_event_id`),
    INDEX `sales_crm_meeting_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_google_sheet_link` (
    `id` VARCHAR(191) NOT NULL,
    `google_account_connection_id` VARCHAR(191) NULL,
    `system_table_name` VARCHAR(191) NOT NULL,
    `system_table_id` VARCHAR(191) NOT NULL DEFAULT '',
    `branch` VARCHAR(191) NOT NULL DEFAULT '',
    `sheet_url` VARCHAR(1000) NOT NULL,
    `spreadsheet_id` VARCHAR(191) NULL,
    `spreadsheet_name` VARCHAR(255) NULL,
    `targeted_tab` VARCHAR(191) NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    `last_synced_at` DATETIME(3) NULL,
    `last_sync_status` VARCHAR(30) NULL,
    `last_sync_summary` TEXT NULL,
    `created_by_user_id` INTEGER NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sales_google_sheet_link_google_account_connection_id_idx`(`google_account_connection_id`),
    INDEX `sales_google_sheet_link_system_table_name_idx`(`system_table_name`),
    INDEX `sales_google_sheet_link_system_table_id_idx`(`system_table_id`),
    INDEX `sales_google_sheet_link_branch_idx`(`branch`),
    INDEX `sales_google_sheet_link_deleted_at_idx`(`deleted_at`),
    INDEX `sales_google_sheet_link_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_google_account_connection` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `google_account_id` VARCHAR(191) NOT NULL,
    `google_email` VARCHAR(191) NOT NULL,
    `google_display_name` VARCHAR(191) NULL,
    `access_token_encrypted` TEXT NULL,
    `refresh_token_encrypted` TEXT NULL,
    `token_expires_at` DATETIME(3) NULL,
    `scopes` TEXT NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'CONNECTED',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_google_account_connection_user_id_key`(`user_id`),
    INDEX `sales_google_account_connection_google_account_id_idx`(`google_account_id`),
    INDEX `sales_google_account_connection_google_email_idx`(`google_email`),
    INDEX `sales_google_account_connection_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_google_oauth_state` (
    `id` VARCHAR(191) NOT NULL,
    `state_hash` CHAR(64) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `purpose` VARCHAR(30) NOT NULL DEFAULT 'connect',
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_google_oauth_state_state_hash_key`(`state_hash`),
    INDEX `sales_google_oauth_state_user_id_expires_at_idx`(`user_id`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_attachment` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `stored_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(191) NULL,
    `size` INTEGER NOT NULL,
    `file_path` VARCHAR(500) NOT NULL,
    `uploaded_by_user_id` INTEGER NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `project_attachment_project_id_deleted_at_idx`(`project_id`, `deleted_at`),
    INDEX `project_attachment_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `image_selection_project` (
    `id` VARCHAR(191) NOT NULL,
    `project_name` VARCHAR(500) NOT NULL,
    `source_type` VARCHAR(20) NOT NULL DEFAULT 'Manual',
    `sales_project_id` VARCHAR(191) NULL,
    `client_name` VARCHAR(191) NULL,
    `client_main_number` VARCHAR(30) NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'New',
    `selection_valid_until` DATETIME(3) NULL,
    `selection_validity_enabled` BOOLEAN NOT NULL DEFAULT true,
    `allow_photo_selection` BOOLEAN NOT NULL DEFAULT true,
    `public_slug` VARCHAR(191) NULL,
    `archived_at` DATETIME(3) NULL,
    `last_opened_at` DATETIME(3) NULL,
    `total_photo_size` BIGINT NOT NULL DEFAULT 0,
    `publish_version` INTEGER NOT NULL DEFAULT 1,
    `created_by_user_id` INTEGER NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `image_selection_project_sales_project_id_key`(`sales_project_id`),
    UNIQUE INDEX `image_selection_project_public_slug_key`(`public_slug`),
    INDEX `image_selection_project_created_at_idx`(`created_at`),
    INDEX `image_selection_project_deleted_at_idx`(`deleted_at`),
    INDEX `image_selection_project_created_by_user_id_idx`(`created_by_user_id`),
    INDEX `image_selection_project_status_archived_at_idx`(`status`, `archived_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `image_selection_gallery_publication` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `token_cipher` TEXT NOT NULL,
    `pin_hash` CHAR(64) NULL,
    `pin_cipher` TEXT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'PUBLISHED',
    `published_by_user_id` INTEGER NULL,
    `published_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `selection_submitted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `image_selection_gallery_publication_project_id_key`(`project_id`),
    UNIQUE INDEX `image_selection_gallery_publication_token_hash_key`(`token_hash`),
    INDEX `image_selection_gallery_publication_status_idx`(`status`),
    INDEX `image_selection_gallery_publication_published_at_idx`(`published_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `image_selection_folder` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `parent_id` VARCHAR(191) NULL,
    `project_shoot_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_by_user_id` INTEGER NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `image_selection_folder_project_shoot_id_key`(`project_shoot_id`),
    INDEX `image_selection_folder_project_id_parent_id_deleted_at_idx`(`project_id`, `parent_id`, `deleted_at`),
    INDEX `image_selection_folder_project_id_parent_id_sort_order_idx`(`project_id`, `parent_id`, `sort_order`),
    INDEX `image_selection_folder_parent_id_idx`(`parent_id`),
    INDEX `image_selection_folder_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `image_selection_deliverable_config` (
    `id` VARCHAR(191) NOT NULL,
    `image_selection_project_id` VARCHAR(191) NOT NULL,
    `project_post_production_allocation_id` VARCHAR(191) NULL,
    `project_shoot_deliverable_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `selection_limit_override` INTEGER NULL,
    `display_order` INTEGER NOT NULL DEFAULT 0,
    `inactive_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `image_selection_deliverable_config_image_selection_project_i_idx`(`image_selection_project_id`, `enabled`, `inactive_at`, `display_order`),
    INDEX `image_selection_deliverable_config_project_post_production_a_idx`(`project_post_production_allocation_id`),
    INDEX `image_selection_deliverable_config_project_shoot_deliverable_idx`(`project_shoot_deliverable_id`),
    UNIQUE INDEX `image_selection_config_project_allocation_unique`(`image_selection_project_id`, `project_post_production_allocation_id`),
    UNIQUE INDEX `image_selection_config_shoot_deliverable_unique`(`image_selection_project_id`, `project_shoot_deliverable_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `image_selection_whatsapp_notification` (
    `id` VARCHAR(191) NOT NULL,
    `sales_project_id` VARCHAR(191) NULL,
    `image_selection_project_id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(50) NOT NULL,
    `template` VARCHAR(191) NOT NULL,
    `recipient_masked` VARCHAR(64) NOT NULL,
    `message_snapshot` TEXT NOT NULL,
    `provider_message_id` VARCHAR(191) NULL,
    `idempotency_key` VARCHAR(191) NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    `error_code` VARCHAR(100) NULL,
    `error_message` TEXT NULL,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `image_selection_whatsapp_notification_idempotency_key_key`(`idempotency_key`),
    INDEX `image_selection_whatsapp_notification_sales_project_id_creat_idx`(`sales_project_id`, `created_at`),
    INDEX `image_selection_whatsapp_notification_image_selection_projec_idx`(`image_selection_project_id`, `status`, `created_at`),
    INDEX `image_selection_whatsapp_notification_provider_message_id_idx`(`provider_message_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `image_selection_upload` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `folder_id` VARCHAR(191) NULL,
    `batch_id` VARCHAR(191) NULL,
    `file_name` VARCHAR(500) NOT NULL,
    `storage_name` VARCHAR(191) NOT NULL,
    `original_path` VARCHAR(1024) NULL,
    `mime_type` VARCHAR(191) NOT NULL,
    `size_bytes` BIGINT NOT NULL,
    `uploaded_bytes` BIGINT NOT NULL DEFAULT 0,
    `chunk_size` INTEGER NOT NULL,
    `total_chunks` INTEGER NOT NULL,
    `uploaded_chunks` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    `processing_error` TEXT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `image_format` VARCHAR(30) NULL,
    `orientation` INTEGER NULL,
    `captured_at` DATETIME(3) NULL,
    `thumbnail_name` VARCHAR(191) NULL,
    `processed_name` VARCHAR(191) NULL,
    `compressed_name` VARCHAR(191) NULL,
    `compressed_size_bytes` BIGINT NULL,
    `thumbnail_key` VARCHAR(1024) NULL,
    `preview_key` VARCHAR(1024) NULL,
    `processing_attempts` INTEGER NOT NULL DEFAULT 0,
    `processing_started_at` DATETIME(3) NULL,
    `processing_completed_at` DATETIME(3) NULL,
    `selected` BOOLEAN NOT NULL DEFAULT false,
    `selected_at` DATETIME(3) NULL,
    `created_by_user_id` INTEGER NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `image_selection_upload_storage_name_key`(`storage_name`),
    INDEX `image_selection_upload_project_id_folder_id_status_idx`(`project_id`, `folder_id`, `status`),
    INDEX `image_selection_upload_batch_id_status_idx`(`batch_id`, `status`),
    INDEX `image_selection_upload_created_at_idx`(`created_at`),
    INDEX `image_selection_upload_project_id_folder_id_selected_idx`(`project_id`, `folder_id`, `selected`),
    INDEX `image_selection_upload_project_id_folder_id_original_path_idx`(`project_id`, `folder_id`, `original_path`(191)),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `image_selection_photo_selection` (
    `id` VARCHAR(191) NOT NULL,
    `image_selection_upload_id` VARCHAR(191) NOT NULL,
    `image_selection_deliverable_config_id` VARCHAR(191) NOT NULL,
    `selected_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `image_selection_photo_selection_image_selection_deliverable__idx`(`image_selection_deliverable_config_id`, `selected_at`),
    UNIQUE INDEX `image_selection_photo_selection_image_selection_upload_id_im_key`(`image_selection_upload_id`, `image_selection_deliverable_config_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `image_selection_upload_batch` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `folder_id` VARCHAR(191) NULL,
    `total_files` INTEGER NOT NULL,
    `uploaded_files` INTEGER NOT NULL DEFAULT 0,
    `compressed_files` INTEGER NOT NULL DEFAULT 0,
    `failed_files` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(30) NOT NULL DEFAULT 'UPLOADING',
    `created_by_user_id` INTEGER NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `image_selection_upload_batch_project_id_status_idx`(`project_id`, `status`),
    INDEX `image_selection_upload_batch_folder_id_idx`(`folder_id`),
    INDEX `image_selection_upload_batch_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `image_selection_settings` (
    `id` VARCHAR(30) NOT NULL DEFAULT 'default',
    `gallery_validity_months` INTEGER NOT NULL DEFAULT 6,
    `default_selection_limit` INTEGER NOT NULL DEFAULT 50,
    `original_storage_path` VARCHAR(500) NULL,
    `selected_output_path` VARCHAR(500) NULL,
    `studio_name` VARCHAR(191) NOT NULL DEFAULT 'Don''t Blink Studios',
    `gallery_logo_url` VARCHAR(500) NULL,
    `updated_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_shoot` (
    `id` VARCHAR(191) NOT NULL,
    `shoot_id` VARCHAR(30) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `date_created` DATETIME(3) NOT NULL,
    `shoot` VARCHAR(100) NOT NULL,
    `shoot_place` VARCHAR(191) NOT NULL,
    `shoot_type` VARCHAR(30) NOT NULL DEFAULT 'Studio / In-House',
    `is_main_event` BOOLEAN NOT NULL DEFAULT false,
    `district` VARCHAR(191) NOT NULL,
    `state` VARCHAR(191) NOT NULL,
    `event_start_time` VARCHAR(5) NULL,
    `event_end_time` VARCHAR(5) NULL,
    `session_timing` VARCHAR(20) NULL,
    `session_duration_hours` INTEGER NULL,
    `session_duration_minutes` INTEGER NULL,
    `food_taken_care_by` VARCHAR(20) NOT NULL DEFAULT 'Studio',
    `accommodation` VARCHAR(20) NOT NULL DEFAULT 'Studio',
    `travel` VARCHAR(20) NOT NULL DEFAULT 'Studio',
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `project_shoot_shoot_id_key`(`shoot_id`),
    INDEX `project_shoot_project_id_deleted_at_idx`(`project_id`, `deleted_at`),
    INDEX `project_shoot_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_service_definition` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(100) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `quantity_mode` ENUM('NONE', 'INTEGER') NULL,
    `timing_mode` ENUM('NONE', 'FULL_HALF_SESSION', 'HOURS_MINUTES', 'DAYS', 'MINUTES') NULL,
    `timing_option_set_id` VARCHAR(191) NULL,
    `size_option_set_id` VARCHAR(191) NULL,
    `remarks_enabled` BOOLEAN NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `project_service_definition_code_key`(`code`),
    UNIQUE INDEX `project_service_definition_name_key`(`name`),
    INDEX `project_service_definition_is_active_sort_order_idx`(`is_active`, `sort_order`),
    INDEX `project_service_definition_timing_option_set_id_idx`(`timing_option_set_id`),
    INDEX `project_service_definition_size_option_set_id_idx`(`size_option_set_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_post_production_workflow_definition` (
    `id` VARCHAR(191) NOT NULL,
    `service_definition_id` VARCHAR(191) NOT NULL,
    `raw_file_in` BOOLEAN NOT NULL DEFAULT true,
    `photo_selection` BOOLEAN NULL,
    `output_01` VARCHAR(191) NULL,
    `output_02` VARCHAR(191) NULL,
    `output_03` VARCHAR(191) NULL,
    `output_04` VARCHAR(191) NULL,
    `final_files_out` BOOLEAN NOT NULL DEFAULT true,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `project_post_production_workflow_definition_service_definiti_key`(`service_definition_id`),
    INDEX `project_post_production_workflow_definition_is_active_idx`(`is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_option_set` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(100) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `project_option_set_code_key`(`code`),
    INDEX `project_option_set_is_active_sort_order_idx`(`is_active`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_option_set_value` (
    `id` VARCHAR(191) NOT NULL,
    `option_set_id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(100) NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `project_option_set_value_option_set_id_is_active_sort_order_idx`(`option_set_id`, `is_active`, `sort_order`),
    UNIQUE INDEX `project_option_set_value_option_set_id_code_key`(`option_set_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_deliverable_definition` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(100) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `photo_count_enabled` BOOLEAN NULL,
    `size_option_set_id` VARCHAR(191) NULL,
    `remarks_enabled` BOOLEAN NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `project_deliverable_definition_code_key`(`code`),
    UNIQUE INDEX `project_deliverable_definition_name_key`(`name`),
    INDEX `project_deliverable_definition_is_active_sort_order_idx`(`is_active`, `sort_order`),
    INDEX `project_deliverable_definition_size_option_set_id_idx`(`size_option_set_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_shoot_deliverable` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `shoot_id` VARCHAR(191) NOT NULL,
    `deliverable_definition_id` VARCHAR(191) NULL,
    `deliverable_name` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `number_of_photos` INTEGER NULL,
    `selection_limit` INTEGER NULL,
    `size` VARCHAR(100) NULL,
    `size_option_value_id` VARCHAR(191) NULL,
    `remarks` TEXT NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `project_shoot_deliverable_project_id_deleted_at_idx`(`project_id`, `deleted_at`),
    INDEX `project_shoot_deliverable_shoot_id_deleted_at_idx`(`shoot_id`, `deleted_at`),
    INDEX `project_shoot_deliverable_deliverable_definition_id_idx`(`deliverable_definition_id`),
    INDEX `project_shoot_deliverable_size_option_value_id_idx`(`size_option_value_id`),
    INDEX `project_shoot_deliverable_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_post_production_allocation` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `shoot_id` VARCHAR(191) NOT NULL,
    `service_definition_id` VARCHAR(191) NULL,
    `service_name` VARCHAR(191) NOT NULL,
    `service_details` TEXT NULL,
    `quantity_session_timing` VARCHAR(191) NULL,
    `quantity` INTEGER NULL,
    `session_option_id` VARCHAR(191) NULL,
    `duration_hours` INTEGER NULL,
    `duration_minutes` INTEGER NULL,
    `work_days` INTEGER NULL,
    `timing_minutes` INTEGER NULL,
    `size_option_value_id` VARCHAR(191) NULL,
    `remarks` TEXT NULL,
    `selection_limit` INTEGER NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `project_post_production_allocation_project_id_deleted_at_idx`(`project_id`, `deleted_at`),
    INDEX `project_post_production_allocation_shoot_id_deleted_at_idx`(`shoot_id`, `deleted_at`),
    INDEX `project_post_production_allocation_service_definition_id_idx`(`service_definition_id`),
    INDEX `project_post_production_allocation_session_option_id_idx`(`session_option_id`),
    INDEX `project_post_production_allocation_size_option_value_id_idx`(`size_option_value_id`),
    INDEX `project_post_production_allocation_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_post_production_workflow_allocation` (
    `id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `shoot_id` VARCHAR(191) NOT NULL,
    `service_allocation_id` VARCHAR(191) NOT NULL,
    `workflow_definition_id` VARCHAR(191) NULL,
    `service_name` VARCHAR(191) NOT NULL,
    `raw_file_in` BOOLEAN NOT NULL DEFAULT true,
    `photo_selection` BOOLEAN NULL,
    `output_01` VARCHAR(191) NULL,
    `output_02` VARCHAR(191) NULL,
    `output_03` VARCHAR(191) NULL,
    `output_04` VARCHAR(191) NULL,
    `final_files_out` BOOLEAN NOT NULL DEFAULT true,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `project_post_production_workflow_allocation_project_id_delet_idx`(`project_id`, `deleted_at`),
    INDEX `project_post_production_workflow_allocation_shoot_id_deleted_idx`(`shoot_id`, `deleted_at`),
    INDEX `project_post_production_workflow_allocation_workflow_definit_idx`(`workflow_definition_id`),
    UNIQUE INDEX `project_post_production_workflow_allocation_service_allocati_key`(`service_allocation_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_request` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `request_code` VARCHAR(30) NOT NULL,
    `asset_name` VARCHAR(150) NOT NULL,
    `category_id` VARCHAR(191) NOT NULL,
    `sub_category_id` VARCHAR(191) NULL,
    `remarks` TEXT NULL,
    `requested_by` INTEGER NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `decision_remarks` TEXT NULL,
    `decided_by` INTEGER NULL,
    `decided_at` DATETIME(3) NULL,
    `asset_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `asset_request_request_code_key`(`request_code`),
    INDEX `asset_request_category_id_idx`(`category_id`),
    INDEX `asset_request_sub_category_id_idx`(`sub_category_id`),
    INDEX `asset_request_created_at_idx`(`created_at`),
    INDEX `asset_request_status_idx`(`status`),
    INDEX `asset_request_asset_id_idx`(`asset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_sequence` (
    `key` VARCHAR(100) NOT NULL,
    `current_value` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_whatsapp_group_name` (
    `id` VARCHAR(191) NOT NULL,
    `group_type` VARCHAR(30) NOT NULL,
    `vertical` VARCHAR(30) NOT NULL,
    `generated_name` VARCHAR(500) NOT NULL,
    `branch` VARCHAR(30) NOT NULL,
    `offer_name` VARCHAR(200) NULL,
    `client_name` VARCHAR(200) NULL,
    `groom_name` VARCHAR(150) NULL,
    `bride_name` VARCHAR(150) NULL,
    `event_name` VARCHAR(200) NULL,
    `social_media_posting` VARCHAR(10) NULL,
    `house_type` VARCHAR(10) NULL,
    `gou` BOOLEAN NULL,
    `place` VARCHAR(200) NOT NULL,
    `main_event_date` DATETIME(3) NULL,
    `generator_payload` JSON NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'Available',
    `expires_at` DATETIME(3) NULL,
    `used_at` DATETIME(3) NULL,
    `used_by_project_id` VARCHAR(191) NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_whatsapp_group_name_generated_name_key`(`generated_name`),
    INDEX `sales_whatsapp_group_name_status_expires_at_idx`(`status`, `expires_at`),
    INDEX `sales_whatsapp_group_name_branch_idx`(`branch`),
    INDEX `sales_whatsapp_group_name_used_by_project_id_idx`(`used_by_project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `department` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `parent_department_id` INTEGER NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `department_code_key`(`code`),
    INDEX `department_parent_department_id_idx`(`parent_department_id`),
    INDEX `department_is_active_name_idx`(`is_active`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `designation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `designation_code_key`(`code`),
    INDEX `designation_is_active_name_idx`(`is_active`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employment_type` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `employment_type_code_key`(`code`),
    INDEX `employment_type_is_active_name_idx`(`is_active`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `location` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `address` TEXT NULL,
    `description` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `location_code_key`(`code`),
    INDEX `location_is_active_name_idx`(`is_active`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_category` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `code` VARCHAR(120) NOT NULL,
    `parent_id` VARCHAR(191) NULL,
    `level` INTEGER NOT NULL,
    `module_type` VARCHAR(30) NOT NULL DEFAULT 'ASSET',
    `icon` VARCHAR(100) NULL,
    `description` TEXT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `asset_category_code_key`(`code`),
    INDEX `asset_category_parent_id_idx`(`parent_id`),
    INDEX `asset_category_level_idx`(`level`),
    INDEX `asset_category_is_active_idx`(`is_active`),
    UNIQUE INDEX `asset_category_parent_id_name_key`(`parent_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vendor` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vendor_id` VARCHAR(30) NOT NULL,
    `vendor_name` VARCHAR(191) NOT NULL,
    `vendor_type` VARCHAR(100) NOT NULL,
    `source_type` VARCHAR(10) NOT NULL DEFAULT 'EXT',
    `contact_person` VARCHAR(150) NULL,
    `mobile_number` VARCHAR(30) NULL,
    `whatsapp_number` VARCHAR(30) NULL,
    `alternate_number` VARCHAR(30) NULL,
    `email` VARCHAR(191) NULL,
    `gst_number` VARCHAR(30) NULL,
    `pan_number` VARCHAR(20) NULL,
    `aadhaar_number` VARCHAR(20) NULL,
    `business_registration_name` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `area` VARCHAR(150) NULL,
    `city` VARCHAR(100) NULL,
    `district` VARCHAR(100) NULL,
    `state` VARCHAR(100) NULL,
    `country` VARCHAR(100) NULL,
    `pincode` VARCHAR(15) NULL,
    `bank_name` VARCHAR(150) NULL,
    `account_number` VARCHAR(100) NULL,
    `ifsc_code` VARCHAR(30) NULL,
    `upi_id` VARCHAR(100) NULL,
    `website` VARCHAR(500) NULL,
    `instagram` VARCHAR(500) NULL,
    `facebook` VARCHAR(500) NULL,
    `business_start_year` INTEGER NULL,
    `preferred_languages` JSON NULL,
    `skills` JSON NULL,
    `rating` INTEGER NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `status_reason` TEXT NULL,
    `referred_by` VARCHAR(191) NULL,
    `remarks` TEXT NULL,
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,
    `deleted_reason` TEXT NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_by` INTEGER NULL,
    `updated_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `vendor_vendor_id_key`(`vendor_id`),
    INDEX `vendor_vendor_name_idx`(`vendor_name`),
    INDEX `vendor_vendor_type_idx`(`vendor_type`),
    INDEX `vendor_status_is_deleted_idx`(`status`, `is_deleted`),
    INDEX `vendor_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_storage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `storage_id` VARCHAR(30) NOT NULL,
    `project_id` VARCHAR(191) NULL,
    `shoot_id` VARCHAR(191) NULL,
    `status` VARCHAR(40) NOT NULL DEFAULT 'Yet to Receive',
    `is_shoot_status_pending` BOOLEAN NOT NULL DEFAULT false,
    `assigned_to_id` INTEGER NULL,
    `assigned_to_name` VARCHAR(150) NULL,
    `assigned_at` DATETIME(3) NULL,
    `assigned_by_id` INTEGER NULL,
    `hdd_out_photo` JSON NULL,
    `transit_condition` VARCHAR(40) NULL,
    `transit_damage_remarks` TEXT NULL,
    `transit_current_photo` JSON NULL,
    `transfer_from` VARCHAR(191) NULL,
    `transfer_to` VARCHAR(191) NULL,
    `sent_by` VARCHAR(150) NULL,
    `sent_by_phone` VARCHAR(30) NULL,
    `received_by` VARCHAR(150) NULL,
    `received_by_phone` VARCHAR(30) NULL,
    `courier_service` VARCHAR(150) NULL,
    `tracking_number` VARCHAR(100) NULL,
    `shipment_date_time` DATETIME(3) NULL,
    `shipment_eta` DATETIME(3) NULL,
    `courier_charge` DECIMAL(12, 2) NULL,
    `shipment_type` VARCHAR(40) NULL,
    `courier_receipt` JSON NULL,
    `package_photo` JSON NULL,
    `transfer_reason` TEXT NULL,
    `special_instructions` TEXT NULL,
    `sold_by_name` VARCHAR(150) NULL,
    `sold_by_employee_id` VARCHAR(50) NULL,
    `sold_to_name` VARCHAR(150) NULL,
    `sold_to_contact` VARCHAR(50) NULL,
    `sold_date` DATE NULL,
    `sold_price` DECIMAL(12, 2) NULL,
    `product` VARCHAR(191) NULL,
    `type` VARCHAR(191) NULL,
    `wid` VARCHAR(100) NULL,
    `work_type` VARCHAR(191) NULL,
    `footage_location` VARCHAR(191) NULL,
    `storage_type` VARCHAR(100) NULL,
    `footage_link` TEXT NULL,
    `remarks` TEXT NULL,
    `hard_disc_brand` VARCHAR(100) NULL,
    `hard_disc_colour` VARCHAR(80) NULL,
    `hard_disc_capacity` VARCHAR(50) NULL,
    `items` VARCHAR(191) NULL,
    `footage_size` VARCHAR(50) NULL,
    `hard_disk_in` VARCHAR(40) NULL,
    `labeled` BOOLEAN NOT NULL DEFAULT false,
    `footage_backup` BOOLEAN NOT NULL DEFAULT false,
    `final_files_copy` BOOLEAN NOT NULL DEFAULT false,
    `harddisk_footages_backup` BOOLEAN NOT NULL DEFAULT false,
    `folder_structure_checked` BOOLEAN NOT NULL DEFAULT false,
    `final_renders` BOOLEAN NOT NULL DEFAULT false,
    `other_files_in_harddisk` BOOLEAN NOT NULL DEFAULT false,
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,
    `deleted_reason` TEXT NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_by` INTEGER NULL,
    `updated_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `client_storage_storage_id_key`(`storage_id`),
    INDEX `client_storage_is_deleted_idx`(`is_deleted`),
    INDEX `client_storage_created_at_idx`(`created_at`),
    INDEX `client_storage_project_id_idx`(`project_id`),
    INDEX `client_storage_shoot_id_idx`(`shoot_id`),
    INDEX `client_storage_status_idx`(`status`),
    INDEX `client_storage_assigned_to_id_idx`(`assigned_to_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `asset_code` VARCHAR(30) NOT NULL,
    `asset_name` VARCHAR(150) NOT NULL,
    `specification` TEXT NULL,
    `company` VARCHAR(150) NULL,
    `serial_number` VARCHAR(100) NULL,
    `branch_id` INTEGER NOT NULL,
    `remarks` TEXT NULL,
    `photo_data` MEDIUMTEXT NULL,
    `assigned_person_id` INTEGER NULL,
    `manager_id` INTEGER NULL,
    `category_id` VARCHAR(191) NULL,
    `color` VARCHAR(80) NULL,
    `purchase_date` DATE NULL,
    `inspection_period_months` INTEGER NULL,
    `last_inspected_date` DATE NULL,
    `next_inspection_date` DATE NULL,
    `purchase_price` DECIMAL(12, 2) NULL,
    `purchased_from` VARCHAR(150) NULL,
    `invoice_number` VARCHAR(100) NULL,
    `warranty_months` INTEGER NULL,
    `insurance_details` TEXT NULL,
    `insurance_expiry` DATE NULL,
    `images` JSON NULL,
    `documents` JSON NULL,
    `status` ENUM('ACTIVE', 'UNDER_REPAIR', 'IN_SERVICE', 'IN_TRANSIT', 'INACTIVE', 'LOST', 'STOLEN', 'SOLD', 'DISPOSED', 'UNASSIGNED') NOT NULL DEFAULT 'ACTIVE',
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,
    `created_by` INTEGER NULL,
    `updated_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `inspection_code` VARCHAR(30) NULL,
    `inspection_condition` VARCHAR(30) NULL,
    `inspection_remarks` TEXT NULL,
    `inspected_on` DATETIME(3) NULL,
    `inspected_by_id` INTEGER NULL,
    `inspected_by_user_id` INTEGER NULL,
    `inspected_by_employee_id` VARCHAR(50) NULL,
    `inspected_by_name` VARCHAR(150) NULL,
    `last_inspection_images` JSON NULL,
    `last_inspection_image_metadata` JSON NULL,
    `second_last_inspection_images` JSON NULL,
    `second_last_inspection_image_metadata` JSON NULL,
    `current_inspection_images` JSON NULL,
    `current_inspection_image_metadata` JSON NULL,

    UNIQUE INDEX `asset_asset_code_key`(`asset_code`),
    UNIQUE INDEX `asset_serial_number_key`(`serial_number`),
    UNIQUE INDEX `asset_inspection_code_key`(`inspection_code`),
    INDEX `asset_status_idx`(`status`),
    INDEX `asset_is_deleted_idx`(`is_deleted`),
    INDEX `asset_branch_id_idx`(`branch_id`),
    INDEX `asset_assigned_person_id_idx`(`assigned_person_id`),
    INDEX `asset_manager_id_idx`(`manager_id`),
    INDEX `asset_category_id_idx`(`category_id`),
    INDEX `asset_next_inspection_date_idx`(`next_inspection_date`),
    INDEX `asset_inspected_by_id_idx`(`inspected_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_status_log` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `asset_id` INTEGER NOT NULL,
    `previous_status` ENUM('ACTIVE', 'UNDER_REPAIR', 'IN_SERVICE', 'IN_TRANSIT', 'INACTIVE', 'LOST', 'STOLEN', 'SOLD', 'DISPOSED', 'UNASSIGNED') NOT NULL,
    `next_status` ENUM('ACTIVE', 'UNDER_REPAIR', 'IN_SERVICE', 'IN_TRANSIT', 'INACTIVE', 'LOST', 'STOLEN', 'SOLD', 'DISPOSED', 'UNASSIGNED') NOT NULL,
    `change_type` VARCHAR(40) NOT NULL,
    `changed_by_user_id` INTEGER NULL,
    `changed_by_employee_id` VARCHAR(50) NULL,
    `changed_by_name` VARCHAR(150) NULL,
    `reason` TEXT NULL,
    `lost_by_name` VARCHAR(150) NULL,
    `lost_by_employee_id` VARCHAR(50) NULL,
    `sold_by_name` VARCHAR(150) NULL,
    `sold_by_employee_id` VARCHAR(50) NULL,
    `sold_to_name` VARCHAR(150) NULL,
    `sold_to_contact` VARCHAR(50) NULL,
    `sold_date` DATE NULL,
    `sold_price` DECIMAL(12, 2) NULL,
    `is_status_change` BOOLEAN NOT NULL DEFAULT false,
    `is_assignee_change` BOOLEAN NOT NULL DEFAULT false,
    `assigned_from_id` INTEGER NULL,
    `assigned_to_id` INTEGER NULL,
    `form_data` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `asset_status_log_asset_id_created_at_idx`(`asset_id`, `created_at`),
    INDEX `asset_status_log_next_status_idx`(`next_status`),
    INDEX `asset_status_log_assigned_to_id_idx`(`assigned_to_id`),
    INDEX `asset_status_log_assigned_from_id_idx`(`assigned_from_id`),
    INDEX `asset_status_log_asset_id_is_assignee_change_idx`(`asset_id`, `is_assignee_change`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_maintenance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `asset_id` INTEGER NOT NULL,
    `maintenance_status` ENUM('TO_REPAIR', 'IN_REPAIR', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'TO_REPAIR',
    `open_slot` INTEGER NULL DEFAULT 1,
    `repair_reason` TEXT NOT NULL,
    `repaired_by_id` INTEGER NULL,
    `repaired_date` DATE NULL,
    `service_provider` VARCHAR(200) NULL,
    `service_city` VARCHAR(100) NULL,
    `service_state` VARCHAR(100) NULL,
    `submitted_date` DATE NULL,
    `eta` DATE NULL,
    `submitted_by_id` INTEGER NULL,
    `contact` VARCHAR(150) NULL,
    `repair_cost` DECIMAL(12, 2) NULL,
    `completion_remarks` TEXT NULL,
    `received_and_checked_by_id` INTEGER NULL,
    `cancellation_reason` TEXT NULL,
    `completed_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `asset_maintenance_asset_id_idx`(`asset_id`),
    INDEX `asset_maintenance_maintenance_status_idx`(`maintenance_status`),
    UNIQUE INDEX `asset_maintenance_asset_id_open_slot_key`(`asset_id`, `open_slot`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skill` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `skill_code_key`(`code`),
    INDEX `skill_is_active_name_idx`(`is_active`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `language` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `language_code_key`(`code`),
    INDEX `language_is_active_name_idx`(`is_active`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_type` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `work_type_code_key`(`code`),
    INDEX `work_type_is_active_name_idx`(`is_active`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_status` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `color` VARCHAR(20) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `employee_status_code_key`(`code`),
    INDEX `employee_status_is_active_sort_order_idx`(`is_active`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `project_attachment` ADD CONSTRAINT `project_attachment_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_project` ADD CONSTRAINT `image_selection_project_sales_project_id_fkey` FOREIGN KEY (`sales_project_id`) REFERENCES `sales_project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_gallery_publication` ADD CONSTRAINT `image_selection_gallery_publication_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `image_selection_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_folder` ADD CONSTRAINT `image_selection_folder_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `image_selection_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_folder` ADD CONSTRAINT `image_selection_folder_project_shoot_id_fkey` FOREIGN KEY (`project_shoot_id`) REFERENCES `project_shoot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_folder` ADD CONSTRAINT `image_selection_folder_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `image_selection_folder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_deliverable_config` ADD CONSTRAINT `image_selection_deliverable_config_image_selection_project__fkey` FOREIGN KEY (`image_selection_project_id`) REFERENCES `image_selection_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_deliverable_config` ADD CONSTRAINT `image_selection_deliverable_config_project_post_production__fkey` FOREIGN KEY (`project_post_production_allocation_id`) REFERENCES `project_post_production_allocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_deliverable_config` ADD CONSTRAINT `image_selection_deliverable_config_project_shoot_deliverabl_fkey` FOREIGN KEY (`project_shoot_deliverable_id`) REFERENCES `project_shoot_deliverable`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_whatsapp_notification` ADD CONSTRAINT `image_selection_whatsapp_notification_sales_project_id_fkey` FOREIGN KEY (`sales_project_id`) REFERENCES `sales_project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_whatsapp_notification` ADD CONSTRAINT `image_selection_whatsapp_notification_image_selection_proje_fkey` FOREIGN KEY (`image_selection_project_id`) REFERENCES `image_selection_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_upload` ADD CONSTRAINT `image_selection_upload_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `image_selection_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_upload` ADD CONSTRAINT `image_selection_upload_folder_id_fkey` FOREIGN KEY (`folder_id`) REFERENCES `image_selection_folder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_upload` ADD CONSTRAINT `image_selection_upload_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `image_selection_upload_batch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_photo_selection` ADD CONSTRAINT `image_selection_photo_selection_image_selection_upload_id_fkey` FOREIGN KEY (`image_selection_upload_id`) REFERENCES `image_selection_upload`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_photo_selection` ADD CONSTRAINT `image_selection_photo_selection_image_selection_deliverable_fkey` FOREIGN KEY (`image_selection_deliverable_config_id`) REFERENCES `image_selection_deliverable_config`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_upload_batch` ADD CONSTRAINT `image_selection_upload_batch_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `image_selection_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `image_selection_upload_batch` ADD CONSTRAINT `image_selection_upload_batch_folder_id_fkey` FOREIGN KEY (`folder_id`) REFERENCES `image_selection_folder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_shoot` ADD CONSTRAINT `project_shoot_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_service_definition` ADD CONSTRAINT `project_service_definition_timing_option_set_id_fkey` FOREIGN KEY (`timing_option_set_id`) REFERENCES `project_option_set`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_service_definition` ADD CONSTRAINT `project_service_definition_size_option_set_id_fkey` FOREIGN KEY (`size_option_set_id`) REFERENCES `project_option_set`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_post_production_workflow_definition` ADD CONSTRAINT `project_post_production_workflow_definition_service_definit_fkey` FOREIGN KEY (`service_definition_id`) REFERENCES `project_service_definition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_option_set_value` ADD CONSTRAINT `project_option_set_value_option_set_id_fkey` FOREIGN KEY (`option_set_id`) REFERENCES `project_option_set`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_deliverable_definition` ADD CONSTRAINT `project_deliverable_definition_size_option_set_id_fkey` FOREIGN KEY (`size_option_set_id`) REFERENCES `project_option_set`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_shoot_deliverable` ADD CONSTRAINT `project_shoot_deliverable_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_shoot_deliverable` ADD CONSTRAINT `project_shoot_deliverable_shoot_id_fkey` FOREIGN KEY (`shoot_id`) REFERENCES `project_shoot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_shoot_deliverable` ADD CONSTRAINT `project_shoot_deliverable_deliverable_definition_id_fkey` FOREIGN KEY (`deliverable_definition_id`) REFERENCES `project_deliverable_definition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_shoot_deliverable` ADD CONSTRAINT `project_shoot_deliverable_size_option_value_id_fkey` FOREIGN KEY (`size_option_value_id`) REFERENCES `project_option_set_value`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_post_production_allocation` ADD CONSTRAINT `project_post_production_allocation_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_post_production_allocation` ADD CONSTRAINT `project_post_production_allocation_shoot_id_fkey` FOREIGN KEY (`shoot_id`) REFERENCES `project_shoot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_post_production_allocation` ADD CONSTRAINT `project_post_production_allocation_service_definition_id_fkey` FOREIGN KEY (`service_definition_id`) REFERENCES `project_service_definition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_post_production_allocation` ADD CONSTRAINT `project_post_production_allocation_session_option_id_fkey` FOREIGN KEY (`session_option_id`) REFERENCES `project_option_set_value`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_post_production_allocation` ADD CONSTRAINT `project_post_production_allocation_size_option_value_id_fkey` FOREIGN KEY (`size_option_value_id`) REFERENCES `project_option_set_value`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_post_production_workflow_allocation` ADD CONSTRAINT `project_post_production_workflow_allocation_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_post_production_workflow_allocation` ADD CONSTRAINT `project_post_production_workflow_allocation_shoot_id_fkey` FOREIGN KEY (`shoot_id`) REFERENCES `project_shoot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_post_production_workflow_allocation` ADD CONSTRAINT `project_post_production_workflow_allocation_service_allocat_fkey` FOREIGN KEY (`service_allocation_id`) REFERENCES `project_post_production_allocation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_post_production_workflow_allocation` ADD CONSTRAINT `project_post_production_workflow_allocation_workflow_defini_fkey` FOREIGN KEY (`workflow_definition_id`) REFERENCES `project_post_production_workflow_definition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_request` ADD CONSTRAINT `asset_request_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `asset_category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_request` ADD CONSTRAINT `asset_request_sub_category_id_fkey` FOREIGN KEY (`sub_category_id`) REFERENCES `asset_category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_request` ADD CONSTRAINT `asset_request_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department` ADD CONSTRAINT `department_parent_department_id_fkey` FOREIGN KEY (`parent_department_id`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_category` ADD CONSTRAINT `asset_category_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `asset_category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_storage` ADD CONSTRAINT `client_storage_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `sales_project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_storage` ADD CONSTRAINT `client_storage_shoot_id_fkey` FOREIGN KEY (`shoot_id`) REFERENCES `project_shoot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_storage` ADD CONSTRAINT `client_storage_assigned_to_id_fkey` FOREIGN KEY (`assigned_to_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset` ADD CONSTRAINT `asset_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset` ADD CONSTRAINT `asset_assigned_person_id_fkey` FOREIGN KEY (`assigned_person_id`) REFERENCES `employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset` ADD CONSTRAINT `asset_manager_id_fkey` FOREIGN KEY (`manager_id`) REFERENCES `employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset` ADD CONSTRAINT `asset_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `asset_category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_status_log` ADD CONSTRAINT `asset_status_log_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_status_log` ADD CONSTRAINT `asset_status_log_assigned_from_id_fkey` FOREIGN KEY (`assigned_from_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_status_log` ADD CONSTRAINT `asset_status_log_assigned_to_id_fkey` FOREIGN KEY (`assigned_to_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_maintenance` ADD CONSTRAINT `asset_maintenance_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_maintenance` ADD CONSTRAINT `asset_maintenance_repaired_by_id_fkey` FOREIGN KEY (`repaired_by_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_maintenance` ADD CONSTRAINT `asset_maintenance_submitted_by_id_fkey` FOREIGN KEY (`submitted_by_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_maintenance` ADD CONSTRAINT `asset_maintenance_received_and_checked_by_id_fkey` FOREIGN KEY (`received_and_checked_by_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
