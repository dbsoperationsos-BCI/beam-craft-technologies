-- Where a login's own arrangement of the application is kept, so it follows the person rather than
-- the browser.
--
-- Column order, hidden columns, frozen columns, column widths, compact view and the tab each screen
-- was left on were all held in `localStorage`. That had three faults, and the third is a leak: the
-- layout did not survive a move to another machine, it was lost whenever site data was cleared, and
-- because the keys were not namespaced by user, the next person to sign in on a shared machine
-- inherited the previous one's arrangement.
--
-- One row per key rather than one blob per user: two tabs arranging two different tables cannot
-- overwrite each other, and one table can be reset without rewriting the rest. The key carries its
-- own namespace (`table:<slug>`, `app:compactView`, `tab:<screen>`) - the application decides those
-- and this table only stores them, so a new kind of preference needs no migration.
--
-- `ON DELETE CASCADE` because a preference is meaningless without the login it belongs to, and
-- nothing here is worth keeping once the account is gone.
CREATE TABLE `user_preference` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `user_id`    INT NOT NULL,
  `key`        VARCHAR(120) NOT NULL,
  `value`      JSON NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- One answer per key per login: every write is an upsert on this pair, so a second tab saving the
-- same table updates the row rather than adding a rival to it.
CREATE UNIQUE INDEX `user_preference_user_id_key_key` ON `user_preference`(`user_id`, `key`);
-- The only read the application makes: every preference this login holds, in one query at sign-in.
CREATE INDEX `user_preference_user_id_idx` ON `user_preference`(`user_id`);

ALTER TABLE `user_preference`
  ADD CONSTRAINT `user_preference_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
