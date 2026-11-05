-- WhatsApp becomes something an administrator switches on per person, rather than a rule everybody
-- is held to until released.
--
-- `whatsapp_exempt` (migration 20260910120000) recorded the *exception*: the rule applied to every
-- non-administrator the moment it shipped, and a tick let one person out. The studio asked for the
-- other way round - nobody is held until somebody says so - so the column records the *rule* now and
-- is `FALSE` for everyone.
--
-- Dropped rather than converted. Under the old column every row was `FALSE` ("no exception"), which
-- converts to "held"; under the new one the studio wants those same accounts *not* held, so
-- converting would give exactly the wrong answer for every row in the table. The feature had not
-- been switched on for anybody, so there is no intent here to preserve - only a default to set.
ALTER TABLE `user` DROP COLUMN `whatsapp_exempt`;

-- Off for every account. An administrator ticks "Allow WhatsApp" in Login Credentials -> WhatsApp on
-- the people who should be held to it, and an administrator is never held whatever this says.
ALTER TABLE `user` ADD COLUMN `whatsapp_required` BOOLEAN NOT NULL DEFAULT FALSE;
