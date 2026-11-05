-- Curated: the Signature Album layout that frames each photo by its own orientation (landscape
-- 3:2, portrait 2:3, square 1:1). It becomes what a new album starts on. Layout is drawn live from
-- an album's (or chapter's) saved layout style, so no existing album or chapter is touched here -
-- each keeps the style it holds and renders exactly as before.

-- The column defaults, matching `schema.prisma`. The service always writes the studio default on
-- create, so these only answer for a row written without one.
ALTER TABLE `signature_album` ALTER COLUMN `layout_style` SET DEFAULT 'CURATED';
ALTER TABLE `signature_album_settings` ALTER COLUMN `default_layout_style` SET DEFAULT 'CURATED';

-- The studio-wide default (Settings → Image Selection → Signature Album → Default Gallery Layout),
-- moved to Curated only where it still holds the shipped Editorial. A studio that picked any other
-- layout keeps it. Replayable: a second run finds nothing to change.
UPDATE `signature_album_settings`
SET `default_layout_style` = 'CURATED'
WHERE `id` = 'default' AND `default_layout_style` = 'EDITORIAL';
