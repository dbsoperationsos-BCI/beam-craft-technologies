-- HRM employee WhatsApp groups: the WhatsApp groups the studio adds employees to, typed by name in
-- Settings -> Employee -> WhatsApp Groups, and each employee's add to each group with WhatsApp's answer.
-- Two new tables only; nothing existing is touched.

-- CreateTable
CREATE TABLE `employee_whatsapp_group` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(200) NOT NULL,
    `created_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `employee_whatsapp_group_name_key`(`name`),
    INDEX `employee_whatsapp_group_created_by_user_id_idx`(`created_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_whatsapp_group_member` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employee_id` INTEGER NOT NULL,
    `group_id` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `detail` TEXT NULL,
    `requested_by_user_id` INTEGER NULL,
    `added_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `employee_whatsapp_group_member_group_id_idx`(`group_id`),
    INDEX `employee_whatsapp_group_member_status_idx`(`status`),
    INDEX `employee_whatsapp_group_member_requested_by_user_id_idx`(`requested_by_user_id`),
    UNIQUE INDEX `employee_whatsapp_group_member_employee_id_group_id_key`(`employee_id`, `group_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `employee_whatsapp_group` ADD CONSTRAINT `employee_whatsapp_group_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_whatsapp_group_member` ADD CONSTRAINT `employee_whatsapp_group_member_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_whatsapp_group_member` ADD CONSTRAINT `employee_whatsapp_group_member_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `employee_whatsapp_group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_whatsapp_group_member` ADD CONSTRAINT `employee_whatsapp_group_member_requested_by_user_id_fkey` FOREIGN KEY (`requested_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
