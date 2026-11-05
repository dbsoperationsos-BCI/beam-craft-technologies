-- AI culling, phase 3 of V2: analysis can happen on the workstation that holds the originals.
--
-- A session records where its technical signals come from: SERVER (the worker reads previews, as
-- every session so far) or DESKTOP (the Image Selection Desktop app analyzes the originals where
-- they live and posts numbers; the server fills any gap from previews, then groups and ranks).
-- `engine_versions` names the engines that produced a session's signals, so a later model change
-- can never silently reinterpret an old run. Each result row says which side stamped it.
-- All additive, defaulted to today's behaviour: nothing existing changes meaning.
ALTER TABLE `image_selection_culling_session`
  ADD COLUMN `analysis_source` VARCHAR(20) NOT NULL DEFAULT 'SERVER',
  ADD COLUMN `engine_versions` JSON NULL;
ALTER TABLE `image_selection_culling_result` ADD COLUMN `analysis_source` VARCHAR(20) NULL;
