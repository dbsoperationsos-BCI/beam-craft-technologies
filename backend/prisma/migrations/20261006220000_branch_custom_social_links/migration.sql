-- Settings → Organization → Branches → Edit → Social Media Links → "+ Add social media link": the
-- branch's own extra links, each with the label the studio gives it (YouTube, Pinterest, ...).
--
-- A JSON list of `{ label, url }`, like `upi_ids` beside it. NULL until the studio adds one, and read
-- as an empty list. No permission: the branch form and its endpoints are already behind
-- SETTINGS / Organization.
--
-- Cost: one nullable column on a table of a handful of rows. Instant.
ALTER TABLE `branch` ADD COLUMN `custom_social_links` JSON NULL;
