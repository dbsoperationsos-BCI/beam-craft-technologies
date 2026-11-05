-- When the studio last took the client's selected originals out of a project.
--
-- Stamped by both ways that happens: the server copying them to the Selected Output Path, and the
-- browser's Download Selected finishing a run. The Image Selection dashboard reads it for its
-- "Not Yet Downloaded" and "Downloaded" cards, judged against the latest submission - a selection
-- item the client sends after a download puts the project back on the not-yet-downloaded side.
--
-- Nullable and unset for every existing project, which reads as "never downloaded" - true for a
-- project whose selections are still with the client, and the honest answer for one downloaded
-- before this column existed, since nothing recorded that either way.
ALTER TABLE `image_selection_project`
  ADD COLUMN `selected_downloaded_at` DATETIME(3) NULL;
