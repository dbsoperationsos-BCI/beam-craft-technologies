-- Guest login verification: a guest who has something to protect (a selfie, a visible match, a
-- verified phone) proves their phone by SMS code before a new device may join as them. Adds the
-- session version that lets a successful code end every other session for that guest, and the
-- purpose of each code (LOGIN or WHATSAPP). Additive only: existing guests start at version 0,
-- which is what every session issued before this carries, so no existing session ends; existing
-- codes are WHATSAPP codes, which is all there were.

-- AlterTable
ALTER TABLE `ai_event_guest` ADD COLUMN `session_version` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `ai_event_guest_phone_otp` ADD COLUMN `purpose` VARCHAR(20) NOT NULL DEFAULT 'WHATSAPP';

