-- A soft-deleted Image Selection / Album Proofing project kept its sales_project_id, so the
-- (sales_project_id, album_proofing) unique slot stayed taken and the WhatsApp group name could
-- never back a new project in that section again ("This WhatsApp group name already has an
-- Album Proofing project." with an empty sidebar). The purge now clears the link as it deletes;
-- this releases the rows deleted before it did. Written by hand and applied with
-- `prisma migrate deploy`.

UPDATE `image_selection_project` SET `sales_project_id` = NULL WHERE `deleted_at` IS NOT NULL;
