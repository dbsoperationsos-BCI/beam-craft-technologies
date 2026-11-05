-- The branch's UPI ID.
--
-- Settings → Organization → Branches now takes the UPI ID a client pays this branch through, in the
-- QR Code section beside the picture that encodes it. Optional, like everything else the register
-- holds beyond a name and an address: a branch paid only by transfer has none, and every branch
-- already on the register keeps working without one.
--
-- Stored as typed and trimmed - "name@bank". Read by the register, and printed on the client's
-- quotation payment page beside the QR.
--
-- NULL on every branch already here. Nothing is read or rewritten by this.
--
-- Written by hand and applied with `prisma migrate deploy`.
ALTER TABLE `branch`
  ADD COLUMN `upi_id` VARCHAR(100) NULL;
