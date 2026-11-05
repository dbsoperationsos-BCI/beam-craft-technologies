-- Which of the shared sections a quotation prints.
--
-- The Additional Notes card, the Officially Trademarked Brand card, Journey & Legacy and Our
-- Infrastructure are the studio's rather than a brand's, and the studio may not want all four on
-- every quotation. This column holds the four switches as JSON, beside the shared wording and
-- pictures they belong to; Settings -> Quotation Settings -> General turns them on and off.
--
-- Additive, nullable, and read so that only a stored `false` hides a section: a row nobody has
-- saved - and every version raised before this - prints all four exactly as it did.
ALTER TABLE `sales_quotation_settings` ADD COLUMN `pdf_sections` JSON NULL;
