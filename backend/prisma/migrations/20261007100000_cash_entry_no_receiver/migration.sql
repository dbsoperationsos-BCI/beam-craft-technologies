-- Money received no longer names who received it.
--
-- The form that books a project asked for a Receiver before it would save the advance, and the
-- studio asked for that box to go: whoever fills the form is the person taking the money. Nothing is
-- stored in its place, because nobody is asked - so the column has to be able to say "unknown".
--
-- Money **out** still names who paid it, and every entry already filed keeps the receiver it was
-- filed with. Widening a column to NULL touches no row, so this is safe to replay.
ALTER TABLE `cash_entry` MODIFY `handler_name` VARCHAR(191) NULL;
