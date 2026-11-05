-- What the studio calls a quotation: `Quotation - Vertical - Branch - Client Name - Venue`.
--
-- Stored rather than composed on read. A quotation is never rewritten — every edit raises the next
-- version — so what a version was called when it was sent is a fact about that version, and
-- rebuilding the name on every read would rename a document already in a client's inbox the moment
-- somebody renamed a venue in master data.
--
-- Nullable because the rows are already here; `scripts/backfillQuotationNames.js` names them from
-- what they already hold, and every version raised since carries one.
ALTER TABLE `sales_quotation` ADD COLUMN `quotation_name` VARCHAR(300) NULL;
