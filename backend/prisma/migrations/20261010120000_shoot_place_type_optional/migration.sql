-- A shoot's place, district, state and type may be unknown: Pre Production → Import brings in the
-- studio's old sheet as it stands, and leaves empty what that sheet does not say rather than
-- inventing it. The shoot form still asks for all four, so a shoot saved there keeps them.
--
-- Only NOT NULL is relaxed; the shoot type keeps its default, so every existing writer is unchanged.
-- Cost: four column definitions on `project_shoot`, no data touched. Instant on a table this size.

ALTER TABLE `project_shoot`
  MODIFY `shoot_place` VARCHAR(191) NULL,
  MODIFY `shoot_type` VARCHAR(30) NULL DEFAULT 'Studio / In-House',
  MODIFY `district` VARCHAR(191) NULL,
  MODIFY `state` VARCHAR(191) NULL;
