-- The client's invoice link for money received: a random token, made the first time the receipt is
-- shared, so the invoice can be opened without signing in. NULL until then; existing rows keep NULL.
ALTER TABLE `cash_entry` ADD COLUMN `invoice_token` VARCHAR(24) NULL;
CREATE UNIQUE INDEX `cash_entry_invoice_token_key` ON `cash_entry`(`invoice_token`);
