-- Which section of the Image Selection module owns a project: false = the Projects page,
-- true = Album Proofing. One table, one API, disjoint sidebars — every existing project stays
-- on the Projects page, so Album Proofing starts empty. Written by hand and applied with
-- `prisma migrate deploy` (never `migrate dev` — the CRM's runtime DDL keeps the shadow
-- database drifted).

ALTER TABLE `image_selection_project` ADD COLUMN `album_proofing` BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX `image_selection_project_album_proofing_idx` ON `image_selection_project`(`album_proofing`);
