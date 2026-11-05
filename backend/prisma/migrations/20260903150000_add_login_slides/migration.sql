-- The pictures the login page turns through: a JSON list of public image URLs in display order,
-- on the studio-wide settings row beside the Global Logo. Null means "use the plain slides".
ALTER TABLE `image_selection_settings` ADD COLUMN `login_slides` JSON NULL;
