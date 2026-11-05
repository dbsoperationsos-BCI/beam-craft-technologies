-- A project is soft-deleted -- its row stays and `deleted_at` is set -- so the foreign key's
-- ON DELETE SET NULL never fires for the client storage hanging off it, and the storage register
-- filters on its own `is_deleted` alone. A deleted project's hard disc therefore went on being
-- listed in Client Storage, filed against a project that had disappeared from Bookings & Converted
-- and from every other screen. `deleteProject` now takes the records with it in the same
-- transaction; this removes the ones left behind by deletions made before it did.
--
-- Marked rather than erased, with the same three columns the register's own Remove writes, so a
-- record removed this way reads exactly like one removed by hand and is still recoverable here.
-- A record somebody had already removed keeps its own reason: that one is the true account of why
-- it went, and overwriting it would rewrite history. Written by hand and applied with
-- `prisma migrate deploy`.

UPDATE `client_storage` `cs`
  JOIN `sales_project` `sp` ON `sp`.`id` = `cs`.`project_id`
  SET `cs`.`is_deleted` = 1,
      `cs`.`deleted_reason` = 'The project this record was raised against was deleted.',
      `cs`.`deleted_at` = NOW()
  WHERE `sp`.`deleted_at` IS NOT NULL AND `cs`.`is_deleted` = 0;
