-- The studio's quotation for a client's requests: the requests priced together and sent at once share
-- a code (the client opens them as one quotation), and an item may be given complimentary. Two empty
-- columns and an index on a table added today.

ALTER TABLE `client_service_request`
  ADD COLUMN `quote_code` VARCHAR(40) NULL,
  ADD COLUMN `complimentary` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `client_service_request_quote_idx` ON `client_service_request`(`quote_code`);
