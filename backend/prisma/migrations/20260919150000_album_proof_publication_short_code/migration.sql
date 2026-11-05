-- The short public identifier in an album proof's client URL.
--
-- The link handed to a client was `/album-proof/` followed by the 43-character token - unreadable
-- down a telephone and long enough that a client pasting it into WhatsApp sees it wrap. This is the
-- same short code the client gallery already uses (`src/services/shortCode.js`): six characters
-- from an alphabet with no 0/O, 1/I or L, random and never derived from an album, project or
-- publication id, so the URL says nothing about what is behind it.
--
-- NULL on every publication already here, and deliberately not backfilled. A link already with a
-- client keeps resolving by its original token - `/album-proof/<token>` still routes and the
-- backend still looks it up by token hash - so nothing that has been shared stops working. Only
-- links published from now on get a code, and once issued a code is never rotated: reset PIN,
-- expiry changes and re-reads all leave it exactly as it is.
--
-- UNIQUE because the code is what the public route resolves on. Allocation retries on this
-- constraint until an unclaimed code lands, so two publishes racing cannot share one URL.
--
-- Nothing is read, rewritten or recreated by this.
--
-- Written by hand and applied with `prisma migrate deploy`.

ALTER TABLE `album_proof_client_publication`
  ADD COLUMN `short_code` VARCHAR(8) NULL AFTER `revision_number`,
  ADD UNIQUE INDEX `album_proof_client_publication_short_code_key` (`short_code`);
