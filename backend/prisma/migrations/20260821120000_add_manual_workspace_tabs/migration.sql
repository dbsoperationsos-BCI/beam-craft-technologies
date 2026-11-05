-- Which workspace tabs a manually named project was created with, chosen on the Create New
-- Project form. A linked project earns its tabs from the Post Production Allocation and the
-- Deliverables table instead, so all three stay NULL there. NULL on an older manual project
-- means the default it always had: Photo Selection on, the other two off.
ALTER TABLE `image_selection_project`
    ADD COLUMN `photo_selection_tab` BOOLEAN NULL,
    ADD COLUMN `photo_culling_tab` BOOLEAN NULL,
    ADD COLUMN `signature_album_tab` BOOLEAN NULL;
