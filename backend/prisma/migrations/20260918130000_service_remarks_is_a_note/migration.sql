-- A service's Remarks is a note the studio writes, not a Yes or a No.
--
-- The same change `20260918100000` made to a deliverable's Remarks, for the same reason and with
-- the same consequence. It was a switch: it decided whether a project's service line carried a
-- remarks box at all. Settings → Project → Services → Add / Edit Service asks for Remarks as a
-- typed note now - "brief the team before the shoot", whatever is worth saying about the service -
-- and it decides nothing. The line keeps its own remarks whatever is written here.
--
-- Reading a note as an answer was the thing to remove. The rule was "an answer starting with 'no'
-- is No", so a perfectly ordinary note beginning "Not applicable" or "No drone on this one" would
-- have turned that box off across every project using the service, with nothing on screen to say
-- it had happened.
--
-- Every service but one answered Yes, and the one that answered No is demonstration data
-- (`SERVICE_DEMO_COMP_DRONE`). No project service line carries a remark today, so no line gains or
-- loses anything it was actually holding.
--
-- The boolean is written out as the word it was chosen as - 'Yes' and 'No', never MySQL's own '1'
-- and '0' - before the answers are cleared, so the conversion is readable on its own and a
-- half-applied run leaves words rather than digits. Then the two words the dropdown could ever have
-- written are cleared, and the box opens empty and ready to be written in. Only those two are
-- cleared, so a note typed later survives and a second run matches nothing.
--
-- Written by hand and applied with `prisma migrate deploy`.

ALTER TABLE `project_service_definition`
  ADD COLUMN `remarks_enabled_text` TEXT NULL AFTER `remarks_enabled`;

UPDATE `project_service_definition`
SET `remarks_enabled_text` = CASE WHEN `remarks_enabled` = 1 THEN 'Yes' WHEN `remarks_enabled` = 0 THEN 'No' ELSE NULL END;

ALTER TABLE `project_service_definition` DROP COLUMN `remarks_enabled`;

ALTER TABLE `project_service_definition`
  CHANGE COLUMN `remarks_enabled_text` `remarks_enabled` TEXT NULL;

UPDATE `project_service_definition`
SET `remarks_enabled` = NULL
WHERE `remarks_enabled` IN ('Yes', 'No');
