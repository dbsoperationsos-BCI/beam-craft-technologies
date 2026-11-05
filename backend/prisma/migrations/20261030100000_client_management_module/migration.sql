-- Client Offers and Client Chats move from Sales & CRM to a menu group of their own, Client
-- Management, and their permissions move with them to the `CLIENT` module - so Role Management lists
-- them under the same heading as the sidebar (see 20260909130000_permissions_match_the_sidebar).
--
-- Nobody gains or loses access. Each row is *updated* rather than replaced, keyed on its level (the
-- part that never moves), so every grant naming it follows it to the new module.
--
-- The seed (`seeds/permission-catalogue.js`) upserts on `module + feature + level` and names `CLIENT`
-- for both, so a seeded database finds these rows as written here rather than making second ones.
--
-- Cost: two rows. Instant.

UPDATE `permission`
SET `module` = 'CLIENT'
WHERE `module` = 'SALES'
  AND `feature` = 'Client Offers'
  AND `level` = 'CLIENT_OFFER_MANAGE';

UPDATE `permission`
SET `module` = 'CLIENT'
WHERE `module` = 'SALES'
  AND `feature` = 'Client Chats'
  AND `level` = 'CLIENT_CHAT_MANAGE';
