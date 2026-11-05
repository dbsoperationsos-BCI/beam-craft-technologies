-- Resource Management -> Recycling Bin is now called Project Vault on screen.
--
-- Only the name Role Management shows changes. The permission's key - `ASSET / Recycling Bin`,
-- level RECYCLING_BIN_MANAGE - is what every grant and every route guard names, so it is left
-- exactly as it is: no role loses or gains anything, and nobody has to be granted it again.
UPDATE `permission`
SET `display_name` = 'Project Vault', `updated_at` = NOW(3)
WHERE `module` = 'ASSET' AND `feature` = 'Recycling Bin' AND `level` = 'RECYCLING_BIN_MANAGE';
