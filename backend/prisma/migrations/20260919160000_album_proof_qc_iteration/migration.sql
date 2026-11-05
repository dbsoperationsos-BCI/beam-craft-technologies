-- A QC pass is not a client version.
--
-- V1, V2, V3 are what the CLIENT has been sent. QC asking for corrections and the designer
-- uploading a revised file is a pass *inside* the current client version, however many times it
-- goes round - so the version list reads V1, V2, V3 and not V1, V1, V1, V1, V2.
--
-- Each pass still freezes its own immutable snapshot, because the proofs QC reviewed on an earlier
-- pass must remain exactly as they were reviewed. `iteration` is what tells two snapshots of the
-- same client version apart, which the old unique on (album_id, version_number) made impossible:
-- the pass would have had to overwrite the one before it.
--
-- Every row already here becomes iteration 1, which is precisely what each of them is - one
-- snapshot of its own version number. Nothing is renumbered, nothing is merged, nothing is
-- deleted, and no album's V1/V2/V3 changes meaning. An album whose versions were created under the
-- previous rule (where a QC round did increment) keeps those numbers: they are real frozen
-- snapshots the studio may have reviewed or sent, and guessing which were QC passes would be
-- rewriting history we cannot verify.
--
-- The plain index on (album_id, version_number) replaces the lookups the old unique was serving.
--
-- Written by hand and applied with `prisma migrate deploy`.

ALTER TABLE `album_proof_version`
  ADD COLUMN `iteration` INT NOT NULL DEFAULT 1 AFTER `version_number`;

ALTER TABLE `album_proof_version`
  DROP INDEX `album_proof_version_album_id_version_number_key`,
  ADD UNIQUE INDEX `album_proof_version_album_id_version_number_iteration_key` (`album_id`, `version_number`, `iteration`),
  ADD INDEX `album_proof_version_album_id_version_number_idx` (`album_id`, `version_number`);
