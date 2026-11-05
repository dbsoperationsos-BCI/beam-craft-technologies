-- A deliverable says what it is - an image or a video, and which kind - and is priced by it.
--
-- Settings → Project → Deliverables → Add / Edit Deliverable asks Image or Video, then Frames /
-- Album / Calendar or Teaser / Full Length / Candid, and prices the deliverable the way that kind
-- is sold: an image kind per size from its own size list, a full-length video per session, a
-- teaser or candid as one figure. The rows live in `pricing` as JSON, shaped by `kind`. Every
-- column is NULL on the rows already here, which reads as "not asked yet" - the flat `price`
-- column goes on answering for them, so nothing already quoted changes.
--
-- Written by hand and applied with `prisma migrate deploy`.

ALTER TABLE `project_deliverable_definition`
  ADD COLUMN `media_type` VARCHAR(20) NULL,
  ADD COLUMN `kind` VARCHAR(30) NULL,
  ADD COLUMN `pricing` JSON NULL;
