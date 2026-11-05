-- The content every brand's quotation shares.
--
-- The Additional Notes card, the Officially Trademarked Brand card, the Journey & Legacy section
-- (its headings, the India map and the timeline) and Our Infrastructure (its headings, tagline and
-- the collage per branch) are the studio's, not a brand's, so they are kept once - on the studio's
-- single quotation settings row - and printed on every brand's quotation. Settings -> Quotation
-- Settings -> General edits them; each brand's own screen keeps only what differs per brand.
--
-- Additive and nullable: nothing else changes, and every version already raised keeps the snapshot
-- it was raised with.
ALTER TABLE `sales_quotation_settings`
  ADD COLUMN `pdf_content` JSON NULL,
  ADD COLUMN `pdf_assets` JSON NULL;
