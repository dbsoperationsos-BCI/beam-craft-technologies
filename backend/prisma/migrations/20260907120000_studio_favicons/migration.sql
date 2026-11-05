-- The mark the browser tab shows, uploaded in Settings, one per tab theme.
--
-- Two columns rather than one: a tab is drawn on the browser's own strip, not on the application's
-- background, so a dark mark vanishes on a dark tab and a light one on a light tab. A studio that
-- has only one uploads one - it is then used for both - and a studio that has neither gets the
-- bundled pair. Nullable and unset for every existing row, which is exactly "use the bundled pair".
--
-- URLs, like `gallery_logo_url` beside them, and public for the same reason: the tab that needs
-- them most is the client's, opened from a link with no login behind it.
ALTER TABLE `image_selection_settings`
  ADD COLUMN `favicon_light_url` VARCHAR(500) NULL,
  ADD COLUMN `favicon_dark_url` VARCHAR(500) NULL;
