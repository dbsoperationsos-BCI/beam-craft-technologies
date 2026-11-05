-- Where an attendance capture actually was, in words.
--
-- The module recorded coordinates and showed them as coordinates: "11.351332, 77.691160" tells
-- somebody reviewing a day nothing they can act on. This holds the resolved address beside them.
--
-- Nullable, and stays NULL for every capture taken before today and for any where the lookup does
-- not answer. That is deliberate: the address is resolved *after* the capture is safely recorded
-- and never blocks it, so a geocoder that is slow, rate-limited or unreachable costs an address and
-- never an attendance record. The line falls back to coordinates wherever it is missing.
--
-- Written by hand and applied with `prisma migrate deploy`.

ALTER TABLE `attendance_event`
  ADD COLUMN `location_address` VARCHAR(300) NULL;
