-- Whether a shoot is being shot to a concept, and what that concept is.
--
-- Asked as a plain yes/no; only when the answer is yes does the form ask for the reference the crew
-- shoots against and the notes that go with it. Both belong to pre production — the coordinator
-- agrees the concept with the client and records it here — so they sit on the shoot's pre
-- production row rather than on the shoot itself.
ALTER TABLE `project_pre_production`
  ADD COLUMN `concepts_needed` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `concept_reference` VARCHAR(2048) NULL,
  ADD COLUMN `concept_remarks` TEXT NULL;
