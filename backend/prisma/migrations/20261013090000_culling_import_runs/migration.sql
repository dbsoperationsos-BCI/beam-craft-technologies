-- AI culling: a run that begins with the import.
--
-- A session created while its photos are still arriving (`awaits_uploads`) carries the mode the
-- photographer chose at import time, waits unqueued while the desktop app uploads previews and
-- analyzes the originals photo by photo, and is handed to the server's stages only once every
-- photo of its scope has landed. Additive, defaulted to today's behaviour: every existing run
-- reads as a run that never waited for uploads.
ALTER TABLE `image_selection_culling_session`
  ADD COLUMN `awaits_uploads` BOOLEAN NOT NULL DEFAULT false;
