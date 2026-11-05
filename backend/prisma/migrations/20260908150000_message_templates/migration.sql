-- The messages the studio sends, written once in Settings and filled in per record.
--
-- The same things are said to clients over and over - a receipt for a payment, a reminder - and each
-- was retyped, so the wording drifted and the figures were copied by hand. A template is that
-- message with its facts left as `{placeholders}`; the module holding the record fills them in.
--
-- `key` is the id rather than a number: the accounts screen asks for `CASH_RECEIVED` by name, and a
-- message the studio adds later is a new row with its own key rather than a column added here.
CREATE TABLE `message_template` (
  `key` VARCHAR(60) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `body` TEXT NOT NULL,
  `updated_by_user_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The receipt the studio already sends, as its starting wording. Seeded here rather than left for
-- somebody to type, so the message works the day this ships; it is the studio's to edit afterwards
-- and this row is never written again.
INSERT INTO `message_template` (`key`, `name`, `body`) VALUES ('CASH_RECEIVED', 'Cash Received', 'Greetings,
Just wanted to let you know we received {payment amount} on {payment date} towards the {shoot name} by {payment mode}. Thank you for your prompt payment. Your outstanding balance as of today is {outstanding balance}.

Payment Tracking ID: {payment id}
We appreciate your business and thank you for your journey with Don''t Blink Studioz. If you have any concerns, please don''t hesitate to contact us.

Best Regards,
Accounts support team
Don''t blink studioz');
