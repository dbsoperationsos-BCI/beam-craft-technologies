-- Whether a service brings deliverables with it.
--
-- A booking is not only a price. "Studio, Full Session, 8x12, ₹700" may be sold *with* an acrylic
-- print of that size and a photo selection, and a studio that has said so once should not have to
-- add them to every quotation by hand. Settings → Project → Services → Add / Edit Service asks
-- **Deliverable Added** beside Remarks and Size, and a service answered Yes maps deliverable
-- variants onto each of its pricing rows.
--
-- The mapping is not a column here. It belongs to the *booking* rather than to the service - the
-- 12x18 row brings a 12x18 print and the 8x12 row does not - so it rides on each row of the
-- `pricing` JSON as `deliverables: [{ deliverableId, brandId, variantId }]`, which is also what
-- keeps it attached when a row is edited. Ids only: a name cannot identify a variant, since two
-- brands sell a 12x18 and two deliverables may be called the same thing.
--
-- NULL on every service already here, which reads as No: `deliverableAdded !== true` brings
-- nothing, so every service goes on behaving exactly as it does today until somebody answers Yes.
-- No existing service or pricing row is read, rewritten or recreated by this.
--
-- Written by hand and applied with `prisma migrate deploy`.

ALTER TABLE `project_service_definition`
  ADD COLUMN `deliverable_added` BOOLEAN NULL AFTER `size_enabled`;
