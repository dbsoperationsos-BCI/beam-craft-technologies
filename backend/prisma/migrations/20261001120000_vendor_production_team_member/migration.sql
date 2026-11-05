-- Vendors → Add Vendor → Capabilities → "Can be a production team member?" - a Yes / No question,
-- and No unless somebody says Yes.
--
-- NOT NULL with a default of false: the form opens on No, so every vendor that existed before the
-- question - and any created without answering it, by import or API - reads as No. There is no
-- "not answered" state for it to fall into.
--
-- Adds one column, filled with the default for every existing row; no existing value is touched, so
-- it cannot fail on production data.
--
-- No permission changes: the field is part of the same Vendor form and endpoints, guarded as before.
--
-- Cost: one ADD COLUMN with a constant default on the vendor table. Instant on MySQL 8.

ALTER TABLE `vendor` ADD COLUMN `can_be_production_team_member` BOOLEAN NOT NULL DEFAULT false;
