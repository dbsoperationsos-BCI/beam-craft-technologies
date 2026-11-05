-- Settings → Organization → Branches → Edit → External URLs: the branch's Google Review Link - the
-- page a client is asked to review the studio on, in the Feedback thank-you message.
--
-- One optional text column, null until the studio fills it in; the branches validation adds
-- https:// to a link typed without a scheme. The branch's social media accounts are not columns of
-- their own: they are the labelled links the studio adds (`custom_social_links`). No permission:
-- the branch form and its endpoints are already behind SETTINGS / Organization.
--
-- Cost: one nullable column on a table of a handful of rows. Instant.
ALTER TABLE `branch` ADD COLUMN `google_review_url` VARCHAR(500) NULL;
