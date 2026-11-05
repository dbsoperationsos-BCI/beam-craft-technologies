-- Each message on Settings → Templates can be switched off.
--
-- The wording of every automatic message already lives there; whether it is sent did not live
-- anywhere a studio could reach per message. Switching one off meant switching off the whole feature
-- that sends it - the shoot crew notice's toggle covers its two wordings together, and a project's
-- step messages had no switch at all, so a studio that wanted "shoot completed" and not "started from
-- studio" could have neither or both.
--
-- `enabled` defaults to **true**, so every template already written keeps sending exactly as it does
-- today and nothing changes until somebody turns a switch off.
--
-- Read by the senders, never by `getTemplate`: a template that is off must not look like one the
-- studio has not written, because every sender answers *that* by sending its own built-in wording
-- instead - which would send the very message somebody just switched off.
--
-- Cost: one column with a default on a table of a few dozen rows. Instant.

ALTER TABLE `message_template` ADD COLUMN `enabled` BOOLEAN NOT NULL DEFAULT true;
