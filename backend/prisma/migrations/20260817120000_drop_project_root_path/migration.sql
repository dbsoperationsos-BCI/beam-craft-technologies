-- The Root Path was a typed folder string used to decide where a browser saved a download. A
-- browser cannot write to a path just because it was named one, so it was replaced by the Target
-- Download Path: a folder handle the user picks through the browser's own picker, held in that
-- browser's IndexedDB rather than on this row.
--
-- The two server-side paths added in 20260815160000 stay. They are resolved on the machine running
-- the backend, which does have the access a browser lacks.
ALTER TABLE `ImageSelectionSettings` DROP COLUMN `projectRootPath`;
