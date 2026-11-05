-- The WhatsApp group behind an Image Selection project, so the gallery invite can be sent into it.
--
-- The studio runs every production project in a WhatsApp group with the client, and the project's
-- name here *is* that group's name (the list sync copies it from the Sales project). Until now the
-- invite left through a wa.me link to the client's own number, typed once more by hand. These three
-- columns remember which group the project is - its address, what it was called when it was linked,
-- and when - so Review & Share can send the invite straight into the group from whichever
-- coordinator pressed Send, on their own paired WhatsApp.
--
-- The address is a `@g.us` jid, never a phone number, and it is only ever written from the list of
-- groups the coordinator's own WhatsApp answered for, so a project cannot be pointed at a group
-- nobody here is in. One live project per group is the service's rule rather than a unique index:
-- an archived or soft-deleted project must not keep a group from the project that follows it, and
-- the Album Proofing rows share this table.
--
-- Cost: three nullable columns and one index on a table of a few hundred rows. Instant.

ALTER TABLE `image_selection_project`
  ADD COLUMN `whatsapp_group_jid` VARCHAR(64) NULL,
  ADD COLUMN `whatsapp_group_subject` VARCHAR(500) NULL,
  ADD COLUMN `whatsapp_group_linked_at` DATETIME(3) NULL;

CREATE INDEX `image_selection_project_whatsapp_group_jid_idx`
  ON `image_selection_project` (`whatsapp_group_jid`);
