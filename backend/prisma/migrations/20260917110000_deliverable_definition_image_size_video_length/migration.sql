-- An image deliverable has a size, a video one has a length, and they are asked for separately.
--
-- `length_size` was one box answering for both, which meant a deliverable switched from Image to
-- Video read its print size as a running time. Settings → Project → Deliverables asks **Size** and
-- **Frame Inches** for an image and **Length** for a video now, so the column is renamed to the one
-- it actually holds and the other is added beside it. Whatever was typed into `length_size` was a
-- size or a length depending on the deliverable's type; it is kept as the size, which is what the
-- box was labelled for the image deliverables that carry one, and a video's length is typed once.
--
-- Written by hand and applied with `prisma migrate deploy`.

ALTER TABLE `project_deliverable_definition`
  CHANGE COLUMN `length_size` `image_size` VARCHAR(100) NULL,
  ADD COLUMN `video_length` VARCHAR(100) NULL AFTER `image_size`;
