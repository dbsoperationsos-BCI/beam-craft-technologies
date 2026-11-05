-- A service is priced per shoot type and session timing.
--
-- Studio + Half Session at one figure, Studio + Full Session at another, and an Hours / Minutes
-- row priced per hour: `pricing` holds those rows as JSON, `[{ shootType, timingMode, price }]`,
-- set from the Pricing button on Settings → Project → Services → Add / Edit Service. A quotation
-- line added for a shoot takes the row matching the shoot's type and timing as its unit price, and
-- falls back to the flat `price` column - which is what every existing service keeps until its
-- pricing is filled in, so nothing already quoted changes.
--
-- Written by hand and applied with `prisma migrate deploy`.

ALTER TABLE `project_service_definition` ADD COLUMN `pricing` JSON NULL;
