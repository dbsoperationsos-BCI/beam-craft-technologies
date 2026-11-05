-- Everything added since `20260824100000_add_call_transcripts`, as one migration.
--
-- Squashed before pushing, from nine that were never committed - so no migration anybody else has
-- applied is being rewritten, which is the rule that matters here.
--
-- The nine files are concatenated in the order they were written, verbatim. That is deliberate: it
-- produces exactly the state the nine produced, statement for statement, rather than a tidier script
-- that has to be reasoned about. Where that leaves something looking redundant - the session timing
-- enum is widened and then narrowed again - it is because the data is moved between those two steps.
--
-- Contents:
--   add_ai_conversations                         Nebula's stored conversations
--   add_ai_knowledge                             Nebula's knowledge documents
--   add_ai_action_plans                          Nebula's proposed actions
--   widen_call_outcome                           Call outcome widened to TEXT
--   service_shoot_types_and_timings              Services: shoot types, timing lists, default quantity
--   service_default_duration                     Services: default duration
--   split_session_timing_modes                   Half and Full Session split apart; Days and Minutes removed
--   shoot_multi_type_and_timing                  Shoots: several types and timings
--   password_reset_token                         Password reset tokens


-- ============================================================================
-- Nebula's stored conversations
-- (was 20260827100000_add_ai_conversations)
-- ============================================================================
-- Assistant conversations, kept per person per module.
--
-- Additive only: two new tables and nothing altered, so applying this cannot disturb the CRM, the
-- leads, the call logs, the transcripts or the WhatsApp tables.
--
-- Apply with `prisma migrate deploy`, never `migrate dev`. The CRM creates several of its tables at
-- runtime, so `migrate dev` reads them as drift and offers to reset the database - which would drop
-- every lead. `deploy` applies pending migrations without that check.

-- One conversation. The (user_id, module) pair is what isolates a CRM thread from an HRM one.
CREATE TABLE `ai_conversation` (
  `id` VARCHAR(191) NOT NULL,
  `user_id` INTEGER NOT NULL,
  -- SALES, HRM, IMAGE_SELECTION, ASSET, ACCOUNTS, or GLOBAL. A string rather than an enum so the
  -- AI module registry can add a scope without a migration.
  `module` VARCHAR(40) NOT NULL,
  `title` VARCHAR(200) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  -- The index every listing uses: this person's threads in this module, most recent first.
  INDEX `ai_conversation_user_id_module_updated_at_idx`(`user_id`, `module`, `updated_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- One turn. Tool results are summarised into the assistant turn rather than stored as their own
-- role, so replaying a conversation cannot resurrect data the reader may no longer be allowed.
CREATE TABLE `ai_message` (
  `id` VARCHAR(191) NOT NULL,
  `conversation_id` VARCHAR(191) NOT NULL,
  `role` VARCHAR(20) NOT NULL,
  `content` TEXT NOT NULL,
  -- Which tools ran, as JSON: names and durations, never their results.
  `tool_trace` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `ai_message_conversation_id_created_at_idx`(`conversation_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Cascades, so an account that is deleted takes its assistant history with it rather than leaving
-- orphaned rows about clients.
ALTER TABLE `ai_conversation`
  ADD CONSTRAINT `ai_conversation_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ai_message`
  ADD CONSTRAINT `ai_message_conversation_id_fkey`
  FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- Nebula's knowledge documents
-- (was 20260827140000_add_ai_knowledge)
-- ============================================================================
-- Company knowledge for the assistant: documents and their embedded passages.
--
-- Additive only - two new tables, nothing altered - so applying this cannot disturb the CRM, the
-- leads, the transcripts or the conversations.
--
-- Apply with `prisma migrate deploy`, never `migrate dev`: the CRM creates several tables at
-- runtime, which `migrate dev` reads as drift before offering a reset that would drop every lead.

CREATE TABLE `ai_document` (
  `id` VARCHAR(191) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  -- SALES, HRM, IMAGE_SELECTION, ASSET, ACCOUNTS, or GLOBAL for company-wide material.
  `module` VARCHAR(40) NOT NULL,
  -- "module" for its own module only, "global" for anything approved company-wide.
  `visibility` VARCHAR(20) NOT NULL DEFAULT 'module',
  `source` VARCHAR(500) NULL,
  `created_by_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  -- The index retrieval filters on, before any embedding is read.
  INDEX `ai_document_module_visibility_idx`(`module`, `visibility`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_document_chunk` (
  `id` VARCHAR(191) NOT NULL,
  `document_id` VARCHAR(191) NOT NULL,
  `ordinal` INTEGER NOT NULL,
  `content` TEXT NOT NULL,
  -- A JSON array of floats. MySQL has no vector type, and the corpus is small enough that cosine
  -- similarity in Node costs milliseconds.
  `embedding` LONGTEXT NOT NULL,
  `token_count` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `ai_document_chunk_document_id_ordinal_idx`(`document_id`, `ordinal`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_document_chunk`
  ADD CONSTRAINT `ai_document_chunk_document_id_fkey`
  FOREIGN KEY (`document_id`) REFERENCES `ai_document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- Nebula's proposed actions
-- (was 20260828140000_add_ai_action_plans)
-- ============================================================================
-- Proposed changes, held until a person confirms them.
--
-- Additive only: one new table, nothing altered. Apply with `prisma migrate deploy`, never
-- `migrate dev` - the CRM creates several tables at runtime, so `migrate dev` reads them as drift
-- and offers a reset that would drop every lead.
--
-- This replaces an in-memory map. A plan lives five minutes with a person sitting there, so memory
-- would mostly work - but a restart in that window loses it, and a table makes single-use a real
-- guarantee: claiming is one conditional UPDATE, so two concurrent confirms cannot both win.
CREATE TABLE `ai_action_plan` (
  `id` VARCHAR(191) NOT NULL,
  -- SHA-256 of the token handed to the browser, never the token. The token is the consent: whoever
  -- holds it can cause the change, so this table holds something that can verify one without being
  -- one.
  `token_hash` VARCHAR(64) NOT NULL,
  `user_id` INTEGER NOT NULL,
  `module` VARCHAR(40) NOT NULL,
  `tool` VARCHAR(80) NOT NULL,
  -- Cleared once carried out: the data has landed in the module's own tables by then.
  `args` TEXT NULL,
  `risk` VARCHAR(30) NOT NULL,
  `summary` TEXT NOT NULL,
  `status` VARCHAR(20) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `confirmed_at` DATETIME(3) NULL,

  -- Unique, so claiming a plan is one indexed row lock rather than a scan. This is what makes
  -- single-use safe under a double-submitted form.
  UNIQUE INDEX `ai_action_plan_token_hash_key`(`token_hash`),
  INDEX `ai_action_plan_status_expires_at_idx`(`status`, `expires_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_action_plan`
  ADD CONSTRAINT `ai_action_plan_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- Call outcome widened to TEXT
-- (was 20260828190000_widen_call_outcome)
-- ============================================================================
-- `call_outcome` holds prose, so it becomes TEXT.
--
-- It was VARCHAR(191) - Prisma's default length rather than a decision - and it sits between
-- `summary` and `next_action`, both of which are already TEXT. A model asked what a call achieved
-- writes a paragraph as readily as a phrase, and a longer-than-usual answer failed the entire write:
--
--   The provided value for the column is too long for the column's type. Column: call_outcome
--
-- The transcript had been made by then and was thrown away with the update, which is what made this
-- worth a migration rather than a truncation.
--
-- Widening only. No existing value can fail to fit, so this cannot lose data. Apply with
-- `prisma migrate deploy`, never `migrate dev`.
ALTER TABLE `sales_call_transcript` MODIFY `call_outcome` TEXT NULL;


-- ============================================================================
-- Services: shoot types, timing lists, default quantity
-- (was 20260829090000_service_shoot_types_and_timings)
-- ============================================================================
-- A service can name several timings, several shoot types, and a quantity.
--
-- Additive only: three nullable columns, nothing altered and nothing dropped. Every existing row
-- keeps the single `timing_mode` it already has, and null in the new columns is read as "as before"
-- rather than "none" - so applying this changes no behaviour until somebody edits a service.
--
-- Apply with `prisma migrate deploy`, never `migrate dev`.

-- How many of this service a project starts with. Null means it is not counted at all - a drone
-- either comes or it does not - which is what `quantity_mode = NONE` already says.
ALTER TABLE `project_service_definition` ADD COLUMN `default_quantity` INT NULL;

-- Every timing this service may be booked with, as a JSON array of ProjectServiceTimingMode names.
-- `timing_mode` stays as the first of them: the quotation calculator and the allocation builder
-- both branch on it, and a row written before this existed has null here and reads from there.
ALTER TABLE `project_service_definition` ADD COLUMN `timing_modes` JSON NULL;

-- STUDIO, OUTDOOR, or both. Null or empty means the service is offered for any shoot, which is what
-- every service written before this existed means.
ALTER TABLE `project_service_definition` ADD COLUMN `shoot_types` JSON NULL;


-- ============================================================================
-- Services: default duration
-- (was 20260829150000_service_default_duration)
-- ============================================================================
-- The duration a service starts with when it is added to a shoot, alongside `default_quantity`.
--
-- Additive and nullable: every existing service keeps a NULL duration, which reads as "not set" and
-- leaves the allocation blank exactly as it is today.
ALTER TABLE `project_service_definition`
  ADD COLUMN `default_duration_hours` INT NULL,
  ADD COLUMN `default_duration_minutes` INT NULL;


-- ============================================================================
-- Half and Full Session split apart; Days and Minutes removed
-- (was 20260829170000_split_session_timing_modes)
-- ============================================================================
-- Full Session and Half Session become timings of their own, and Days and Minutes go away.
--
-- `FULL_HALF_SESSION` was one mode covering both halves of the studio's session scale, so a service
-- offered only as a full session could not say so. It becomes the two it always stood for. Days and
-- Minutes are removed: one service used each, neither on any project.
--
-- Two things make this more than a rename. `timing_mode` is a MySQL enum, so it has to be widened
-- before the new spellings can be written and narrowed again afterwards. And most services predate
-- the multi-select and carry a NULL `timing_modes`, falling back to the singular column - those rows
-- have to be given a real list here, or a service that was FULL_HALF_SESSION would come out
-- offering only the half.

-- 1. Widen the enum so both spellings are writable while the data is moved.
ALTER TABLE `project_service_definition`
  MODIFY `timing_mode` ENUM('NONE','FULL_HALF_SESSION','HOURS_MINUTES','DAYS','MINUTES','HALF_SESSION','FULL_SESSION') NULL;

-- 2. Rebuild every list from what the row means today, whether that is recorded in the list or only
--    in the singular column. Written from the flags rather than edited in place, so it is the same
--    answer however many times it runs.
UPDATE `project_service_definition`
SET `timing_modes` = JSON_MERGE_PRESERVE(
  IF(
    (`timing_modes` IS NULL AND `timing_mode` = 'FULL_HALF_SESSION')
      OR (`timing_modes` IS NOT NULL AND (JSON_CONTAINS(`timing_modes`, '"FULL_HALF_SESSION"') OR JSON_CONTAINS(`timing_modes`, '"HALF_SESSION"'))),
    JSON_ARRAY('HALF_SESSION'), JSON_ARRAY()
  ),
  IF(
    (`timing_modes` IS NULL AND `timing_mode` = 'FULL_HALF_SESSION')
      OR (`timing_modes` IS NOT NULL AND (JSON_CONTAINS(`timing_modes`, '"FULL_HALF_SESSION"') OR JSON_CONTAINS(`timing_modes`, '"FULL_SESSION"'))),
    JSON_ARRAY('FULL_SESSION'), JSON_ARRAY()
  ),
  IF(
    (`timing_modes` IS NULL AND `timing_mode` = 'HOURS_MINUTES')
      OR (`timing_modes` IS NOT NULL AND JSON_CONTAINS(`timing_modes`, '"HOURS_MINUTES"')),
    JSON_ARRAY('HOURS_MINUTES'), JSON_ARRAY()
  )
);

-- A service left with nothing - it was Days, Minutes, or already untimed - is untimed.
UPDATE `project_service_definition`
SET `timing_modes` = JSON_ARRAY('NONE')
WHERE JSON_LENGTH(`timing_modes`) = 0;

-- 3. The singular column stays the first of the list, which is what every reader of it expects.
UPDATE `project_service_definition`
SET `timing_mode` = JSON_UNQUOTE(JSON_EXTRACT(`timing_modes`, '$[0]'));

-- 4. Narrow the enum to the timings that now exist, so the old spellings cannot come back.
ALTER TABLE `project_service_definition`
  MODIFY `timing_mode` ENUM('NONE','HALF_SESSION','FULL_SESSION','HOURS_MINUTES') NULL;


-- ============================================================================
-- Shoots: several types and timings
-- (was 20260829190000_shoot_multi_type_and_timing)
-- ============================================================================
-- A shoot may run in more than one place and over more than one session length.
--
-- A wedding that starts in the studio and moves outdoors was one or the other; a day booked partly
-- by the hour and partly as a full session could only say one. Both become lists.
--
-- The singular columns stay, holding the first of each list. Everything that reads a shoot's type or
-- timing one-at-a-time - the older screens, the exports - keeps working unchanged, and the list is
-- what the dialog writes and reads.
ALTER TABLE `project_shoot`
  ADD COLUMN `shoot_types` JSON NULL,
  ADD COLUMN `session_timings` JSON NULL;

-- Every existing shoot means exactly what it said: one type, one timing.
UPDATE `project_shoot`
SET `shoot_types` = JSON_ARRAY(`shoot_type`)
WHERE `shoot_type` IS NOT NULL;

UPDATE `project_shoot`
SET `session_timings` = JSON_ARRAY(`session_timing`)
WHERE `session_timing` IS NOT NULL;


-- ============================================================================
-- Password reset tokens
-- (was 20260829210000_password_reset_token)
-- ============================================================================
-- A live "forgot password" request.
--
-- Only a SHA-256 hash of the token is stored - the token itself goes out in the email and exists
-- nowhere else - so a copy of this table is not a set of working reset links. `used_at` makes a
-- token single-use, and the index on it is what lets the rest of a user's live tokens be spent when
-- one is redeemed.
CREATE TABLE `password_reset_token` (
  `id` VARCHAR(191) NOT NULL,
  `user_id` INTEGER NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `used_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `password_reset_token_token_hash_key`(`token_hash`),
  INDEX `password_reset_token_user_id_used_at_idx`(`user_id`, `used_at`),
  INDEX `password_reset_token_expires_at_idx`(`expires_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `password_reset_token`
  ADD CONSTRAINT `password_reset_token_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
