-- Clearing up after the bug that `ProjectShootDeliverable.selectionLimit` replaces.
--
-- Image Selection used to keep each limit as `selectionLimitOverride` on its own row, and Selection
-- Settings posts every row on Save rather than only the edited ones — so the first save pinned every
-- selection item, and ticking one checkbox was enough to do it. A pinned number always won, so a
-- quantity changed in Post Production Allocation could never reach Image Selection again: a
-- deliverable allocated for 5000 photos went on reading 50, and nothing in either screen could
-- correct it.
--
-- Two kinds of stale number have to go, or the next save would launder them into the shared column and
-- the wrong value would become the real one:
--
--   1. A limit already on the deliverable that is exactly the studio-wide default. That is the
--      fingerprint of the number the panel stamped when it had nothing better to show, not a figure
--      anybody chose — an Album Selection ordered for 5000 photos does not have a considered limit of
--      50 by coincidence.
--   2. Every `selectionLimitOverride` on an allocation-derived row, because the limit no longer lives
--      there at all.
--
-- An override worth keeping is carried onto the deliverable in between, on the same rule: a number
-- other than the studio default is one somebody chose. It is a judgement, not a certainty. A studio
-- that meant to set exactly the default loses that and can set it again, and what it falls back to is
-- the quantity actually ordered — which is the number the two screens were disagreeing about.

-- 1. Drop a limit that is only the studio default wearing a disguise. First, so that step 2 can then
--    put a real override in its place rather than finding the column already occupied.
UPDATE `ProjectShootDeliverable`
SET `selectionLimit` = NULL
WHERE `selectionLimit` IS NOT NULL
  AND `selectionLimit` = COALESCE(
    (SELECT `defaultSelectionLimit` FROM `ImageSelectionSettings` WHERE `id` = 'default'), 50);

-- 2. Carry a deliberate override onto the deliverable, where both screens now read it.
UPDATE `ProjectShootDeliverable` `deliverable`
  JOIN `ImageSelectionDeliverableConfig` `config`
    ON `config`.`projectShootDeliverableId` = `deliverable`.`id`
SET `deliverable`.`selectionLimit` = `config`.`selectionLimitOverride`
WHERE `config`.`selectionLimitOverride` IS NOT NULL
  AND `deliverable`.`selectionLimit` IS NULL
  AND `config`.`selectionLimitOverride` <> COALESCE(
    (SELECT `defaultSelectionLimit` FROM `ImageSelectionSettings` WHERE `id` = 'default'), 50);

-- 3. No allocation-derived row keeps a copy of the limit any more.
UPDATE `ImageSelectionDeliverableConfig`
SET `selectionLimitOverride` = NULL
WHERE `projectShootDeliverableId` IS NOT NULL;
