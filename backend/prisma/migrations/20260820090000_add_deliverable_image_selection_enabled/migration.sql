-- Whether a deliverable is offered as a selection item in Image Selection, set per deliverable in
-- Project Settings — the Deliverables table's Image Selection column is the only thing that
-- decides it, replacing the list of photo-facing services that used to be hard-coded in
-- image-selection/deliverables. NULL means the studio has never answered, which counts as No.
ALTER TABLE `project_deliverable_definition` ADD COLUMN `image_selection_enabled` BOOLEAN NULL;

-- The definitions the retired built-in list used to admit are stamped Yes — matched the way the
-- code matched them, ignoring case, spacing and punctuation, and covering the spellings older
-- projects were allocated under — so every existing project keeps exactly the selection items it
-- had when the list moved into the table.
UPDATE `project_deliverable_definition`
SET `image_selection_enabled` = TRUE
WHERE `image_selection_enabled` IS NULL
  AND REGEXP_REPLACE(LOWER(`name`), '[^a-z0-9]', '') IN (
    'acrylicprinting',
    'albumselection',
    'calenderdesigning',
    'calendardesigning',
    'compressedimages',
    'countdownposter',
    'countdownposters',
    'customgifts',
    'framesprinting',
    'framesretouching',
    'framesretouchingdesigning',
    'maxiprint',
    'printonly',
    'printsonly',
    'retouches',
    'slideshow'
  );
