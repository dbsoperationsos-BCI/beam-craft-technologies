-- Each vertical's pre production sheet asks its own questions on top of the shared ones. The
-- superset lives on the same one-row-per-shoot table as nullable columns: a Dum Dum shoot leaves
-- the Qua Qua-only answers empty and vice versa. Progress columns hold 'Pending'/'Completed', and
-- NULL means the question has not been taken up at all — which is why they are not booleans.
-- "Received The Storage" / "Storage ID" get no columns: they are read from the project's Client
-- Storage record, so the disc's whereabouts keeps one source of truth.

-- Shared by Dum Dum and Qua Qua
ALTER TABLE `project_pre_production`
  ADD COLUMN `intro_call_remarks` TEXT NULL,
  ADD COLUMN `getting_dresses_images` VARCHAR(20) NULL,
  ADD COLUMN `production_master` VARCHAR(20) NULL,
  ADD COLUMN `production_team_allocation` VARCHAR(20) NULL,
  ADD COLUMN `shoot_completion_message` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `followup_remarks` TEXT NULL,
-- Dum Dum only — a wedding has two sides, so the intro call is asked once per side
  ADD COLUMN `groom_address` TEXT NULL,
  ADD COLUMN `bride_address` TEXT NULL,
  ADD COLUMN `intro_call_groom` VARCHAR(20) NULL,
  ADD COLUMN `intro_call_bride` VARCHAR(20) NULL,
  ADD COLUMN `event_schedule_meeting` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `meeting_date` DATETIME(3) NULL,
  ADD COLUMN `meeting_time` VARCHAR(5) NULL,
  ADD COLUMN `meeting_link` VARCHAR(2048) NULL,
  ADD COLUMN `invitation_soft_copy` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `invitation_link` VARCHAR(2048) NULL,
  ADD COLUMN `getting_decor_images` VARCHAR(20) NULL,
  ADD COLUMN `number_plate` VARCHAR(191) NULL,
  ADD COLUMN `site_visit` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `team_reached_message` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `post_wedding_gift` VARCHAR(20) NULL,
-- Qua Qua only — one client, one intro call
  ADD COLUMN `intro_call` VARCHAR(20) NULL,
  ADD COLUMN `google_review` BOOLEAN NOT NULL DEFAULT false;
