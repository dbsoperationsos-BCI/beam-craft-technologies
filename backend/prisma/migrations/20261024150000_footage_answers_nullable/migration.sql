-- File in (the production shoot's Photo copy step) can be saved part way: a service's answers are
-- kept as they stand, and what has not been filled in yet is NULL rather than an empty string.
-- Completing the step still requires all of them, in `execution.photoCopyRows`.
--
-- Widening only: every existing row was written by a completed step and holds all five answers, so
-- nothing is rewritten and nothing can fail on production data.
ALTER TABLE `project_production_footage`
  MODIFY `footage_url` VARCHAR(2048) NULL,
  MODIFY `file_count` INTEGER NULL,
  MODIFY `size` VARCHAR(50) NULL,
  MODIFY `first_file_name` VARCHAR(255) NULL,
  MODIFY `last_file_name` VARCHAR(255) NULL;
