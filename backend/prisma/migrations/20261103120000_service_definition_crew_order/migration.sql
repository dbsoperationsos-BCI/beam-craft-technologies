-- The studio's own order for services, which is the order they are crewed in.
--
-- The Production Schedule sheet, the plan's Service Crew and the plan's checklist listed a shoot's
-- services in the order somebody booked them, so the same two sheets read differently from one
-- project to the next. They now read `sort_order` on the service instead, and this sets it: the
-- studio crews the traditional pair, then photo, then video, then the drones, each variant beside
-- its parent, and everything else after them.
--
-- `sort_order` is only ever written here and by Settings -> Project -> Services (the drag handle, and
-- max+1 for a service as it is created). The ten named services are given their positions by name,
-- so a service that was renamed or never created simply does not match and the UPDATE passes over
-- it - nothing fails, and nothing is created or removed.
--
-- The remaining services are re-ranked alphabetically after the ten. That is the order they are in
-- wherever nobody has dragged them (a laptop's copy of this database has them alphabetical, 0-39);
-- where the studio HAS dragged some of them into an order of its own, that order is replaced for
-- those services, and they can be dragged again in Settings afterwards. Replayable: running it
-- twice gives the same positions, because both halves are derived from the names alone.
--
-- Data only, so there is no schema change and no drift.
UPDATE `project_service_definition`
SET `sort_order` = CASE `name`
  WHEN 'Traditional Photo'      THEN 0
  WHEN 'Traditional Video'      THEN 1
  WHEN 'Semi Candid Photo'      THEN 2
  WHEN 'Semi Candid Photo + reel' THEN 3
  WHEN 'Candid Photo'           THEN 4
  WHEN 'Candid Photo + Reels'   THEN 5
  WHEN 'Semi Candid Video'      THEN 6
  WHEN 'Candid Video'           THEN 7
  WHEN 'Drone'                  THEN 8
  WHEN 'Complementary Drone'    THEN 9
  ELSE `sort_order`
END
WHERE `name` IN (
  'Traditional Photo', 'Traditional Video',
  'Semi Candid Photo', 'Semi Candid Photo + reel',
  'Candid Photo', 'Candid Photo + Reels',
  'Semi Candid Video', 'Candid Video',
  'Drone', 'Complementary Drone'
);

-- Everything else, alphabetically, after the ten above. The ranking is read from a derived table so
-- MySQL materialises it before the UPDATE touches the same rows.
UPDATE `project_service_definition` AS `d`
JOIN (
  SELECT `id`, 9 + ROW_NUMBER() OVER (ORDER BY `name` ASC) AS `position`
  FROM `project_service_definition`
  WHERE `name` NOT IN (
    'Traditional Photo', 'Traditional Video',
    'Semi Candid Photo', 'Semi Candid Photo + reel',
    'Candid Photo', 'Candid Photo + Reels',
    'Semi Candid Video', 'Candid Video',
    'Drone', 'Complementary Drone'
  )
) AS `ranked` ON `ranked`.`id` = `d`.`id`
SET `d`.`sort_order` = `ranked`.`position`;
