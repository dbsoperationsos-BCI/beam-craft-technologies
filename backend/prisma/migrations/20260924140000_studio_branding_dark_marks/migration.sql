-- A dark-mode Global Logo and a dark-mode favicon, each uploaded beside its light-mode mark.
--
-- The application has two dark themes, and a logo drawn for a white ground is inverted by CSS to
-- read on their top bar - a fair guess, and only a guess: a coloured mark comes out in the wrong
-- family and a mark with its own dark ground comes out as a light block. A studio that has a dark
-- version of its mark can now upload it, and the guess is only made where nothing was uploaded.
-- The browser tab is the same question again on a different ground: a tab strip is drawn by the
-- browser, dark or light by its own setting, so the tab mark gets a dark sibling too.
--
-- The existing columns stay the light-mode marks. That is what keeps every white surface exactly
-- as it is - a PDF, a quotation page, a client gallery and every document's frozen snapshot read
-- `gallery_logo_url` and are never handed a dark mark. Nullable and unset for every existing row,
-- which is exactly "use the light mark", so nothing changes for a studio until it uploads one.
ALTER TABLE `image_selection_settings`
  ADD COLUMN `gallery_logo_dark_url` VARCHAR(500) NULL,
  ADD COLUMN `favicon_dark_url` VARCHAR(500) NULL;
