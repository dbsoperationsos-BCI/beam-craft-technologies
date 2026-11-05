-- Registering a photo asks whether its trail is already in the destination folder, once per photo,
-- so a folder of a few thousand frames asked it a few thousand times against no index at all.
--
-- A prefix index is all MySQL will take here: `originalPath` is VARCHAR(1024), which at four bytes
-- per character is past the 3072-byte InnoDB key limit. 191 characters narrows the scan to one row
-- in every realistic case, and the query still compares the column in full.
CREATE INDEX `ImageSelectionUpload_projectId_folderId_originalPath_idx`
  ON `ImageSelectionUpload` (`projectId`, `folderId`, `originalPath`(191));
