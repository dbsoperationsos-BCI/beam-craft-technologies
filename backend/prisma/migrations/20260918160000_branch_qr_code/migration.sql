-- The branch's payment QR code.
--
-- Settings → Organization → Branches now takes a picture of the QR a client scans to pay this
-- branch, beside the account number that says the same thing in digits. Optional, like everything
-- else the register holds beyond a name and an address: a branch paid only by transfer has no QR,
-- and every branch already on the register keeps working without one.
--
-- What is stored is the link `storeImage` returns after uploading the picture, exactly as the
-- gallery logo is stored. MEDIUMTEXT rather than a VARCHAR because of the one case where the
-- column holds the picture instead of a link: a machine with no Cloudflare R2 keys falls back to
-- the compressed data URI, which is a couple of hundred kilobytes.
--
-- NULL on every branch already here. Nothing is read or rewritten by this.
--
-- Written by hand and applied with `prisma migrate deploy`.
ALTER TABLE `branch`
  ADD COLUMN `qr_code_url` MEDIUMTEXT NULL;
