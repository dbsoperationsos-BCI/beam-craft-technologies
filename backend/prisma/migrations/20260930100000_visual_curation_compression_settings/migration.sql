-- Visual Curation Settings → Processing / Compression: the studio's preview and thumbnail presets
-- for Image Selection, Album Proofing and Signature Album uploads, one JSON object per module.
-- Additive and nullable: an existing row reads back unchanged, and null is every module's
-- recommended default.
ALTER TABLE `image_selection_settings`
  ADD COLUMN `compression` JSON NULL;
