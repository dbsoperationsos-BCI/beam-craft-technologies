-- A WhatsApp group name (Sales Manager project) may now back one project PER SECTION — one on
-- the Projects page and one in Album Proofing — instead of one across the whole module. The
-- composite unique keeps duplicates impossible within a section, and its leftmost column keeps
-- satisfying the sales_project_id foreign key, which is why it is created before the old
-- single-column unique is dropped. Written by hand and applied with `prisma migrate deploy`.

CREATE UNIQUE INDEX `image_selection_project_sales_section_unique` ON `image_selection_project`(`sales_project_id`, `album_proofing`);
DROP INDEX `image_selection_project_sales_project_id_key` ON `image_selection_project`;
