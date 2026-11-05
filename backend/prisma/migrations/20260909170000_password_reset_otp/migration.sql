-- A password reset asked for by mobile rather than by email.
--
-- Its own table rather than columns on `password_reset_token`, because the two are different
-- secrets with different rules. A token is 32 random bytes carried in a link and is safe for an
-- hour; an OTP is six digits somebody reads off a phone and types, which is a million guesses - so
-- it lives for two minutes, is single use, and counts its own wrong attempts. Sharing one table
-- would mean a nullable column per difference and one row shape meaning two things.
--
-- `code_hash` is deliberately **not** unique. Two accounts may legitimately hold the same six digits
-- at the same time, and a unique index would refuse the second - which both breaks a reset and
-- tells the caller something about another account's live code.
--
-- Verifying one mints an ordinary `password_reset_token`, so the reset itself stays the single path
-- the emailed link has always taken.
--
-- `ON DELETE CASCADE` from the user, like the token table: an account that goes takes its
-- outstanding codes with it.

CREATE TABLE `password_reset_otp` (
  `id` VARCHAR(191) NOT NULL,
  `user_id` INTEGER NOT NULL,
  `code_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `used_at` DATETIME(3) NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `password_reset_otp_user_id_used_at_idx`(`user_id`, `used_at`),
  INDEX `password_reset_otp_expires_at_idx`(`expires_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `password_reset_otp` ADD CONSTRAINT `password_reset_otp_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
