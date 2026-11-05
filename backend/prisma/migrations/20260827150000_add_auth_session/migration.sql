-- Persistent desktop sign-ins: one row per issued refresh token, stored as a SHA-256 hash with a
-- fixed 30-day expiry. Written by hand and applied with `prisma migrate deploy` (never
-- `migrate dev` — see docs; the CRM's runtime DDL keeps the shadow database drifted).

CREATE TABLE `auth_session` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `token_hash` VARCHAR(64) NOT NULL,
    `client` VARCHAR(30) NOT NULL DEFAULT 'desktop',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `last_used_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,

    UNIQUE INDEX `auth_session_token_hash_key`(`token_hash`),
    INDEX `auth_session_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `auth_session` ADD CONSTRAINT `auth_session_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
