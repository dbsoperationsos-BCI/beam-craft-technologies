-- Whether a brand's client may download their quotation.
--
-- The public page has always carried a download control, and the studio wants that to be a
-- decision per brand rather than a fact of the page: a Corp proposal may be a file the client is
-- meant to keep, while a Dum Dum one is meant to be read at the link and nowhere else. The answer
-- belongs to the brand - Settings → Quotation Settings → <brand> → PDF Content → Allow Client
-- Download - so Dum Dum, Qua Qua and Corp each hold their own, and a quotation is judged by the
-- brand it was raised under.
--
-- FALSE on every brand already here, which is the safe answer and the studio's asked-for default:
-- the control disappears from every public quotation until somebody turns it on, and no quotation,
-- snapshot, picture or word is read or rewritten by this. Not snapshotted onto a version either -
-- it is read live, so switching it off reaches the links already sent.
--
-- Written by hand and applied with `prisma migrate deploy`.
ALTER TABLE `sales_quotation_brand`
  ADD COLUMN `allow_client_download` BOOLEAN NOT NULL DEFAULT false;
