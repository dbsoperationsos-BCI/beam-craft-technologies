-- A deliverable is described in words: whose it is, how long or big it is, and its frame's inches.
--
-- Settings → Project → Deliverables → Add / Edit Deliverable asks Company / Brand Name, Length /
-- Size and Frame Inches beside the deliverable's one Price, all typed, and the Deliverables table
-- lists them. Words for the screen; nothing prices or filters on them. NULL on every row already
-- here, which reads as blank.
--
-- Written by hand and applied with `prisma migrate deploy`.

ALTER TABLE `project_deliverable_definition`
  ADD COLUMN `brand_name` VARCHAR(191) NULL,
  ADD COLUMN `length_size` VARCHAR(100) NULL,
  ADD COLUMN `frame_inches` VARCHAR(60) NULL;
