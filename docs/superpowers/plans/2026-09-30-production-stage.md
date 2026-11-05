# Production Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every shoot of a started project that has a Production Manager a production record: the manager fills and submits a per-shoot plan, the named Production Coordinator walks seven strictly ordered steps on the day, every action is logged, and three steps post to the project's linked WhatsApp group.

**Architecture:** A new backend module `backend/src/modules/project-management/production/` (pure step rules in `steps.js`, access in `access.js`, row raising in `service.js`, plan / execution / messages / reads in their own files, one router guarded by `requireModule("PROJECT", "Production")`), rows raised beside `ensureProjectPreProduction`, and a WhatsApp group link added to the pre-production router. The frontend replaces the thin `/project-management/production` list with a `DataTable` board and a `SchemaFormPanel` with Plan / Execution / Activity tabs, built from existing shared components plus `StepRail` moved to `components/shared/`.

**Tech Stack:** Express 5 + Prisma 6 (MySQL, `utf8mb4_unicode_ci`), zod, `node --test` (backend and frontend), Next.js 16 App Router, React, Tailwind.

**Spec:** [docs/superpowers/specs/2026-09-30-production-stage-design.md](../specs/2026-09-30-production-stage-design.md)

## Global Constraints

- One permission: `PROJECT:Production` (already in `backend/prisma/seeds/permission-catalogue.js:417-421` and `frontend/src/constants/modulePermissions.js:156`). No new catalogue row, no permission migration row.
- Backend router mounts `protect` then `requireModule("PROJECT", "Production")`: GET needs READ, every write READ_WRITE.
- **The Production Coordinator lives only on the production plan** (`ProjectProduction.productionCoordinatorEmployeeId`). It is removed from pre production's form, validation, write and read paths (Task 3); an existing pre production answer is carried over once, as the plan's starting coordinator, when the production row is raised. The old `project_pre_production.production_coordinator*` columns stay in this change (dropping them before the carry-over has run would lose data) and are dropped by a follow-up migration. The "Assigned By (Project Coordinator)" display (`infoPanelConfig.js:289`, `ProjectDataTable.js`) is a different field and is not touched.
- Who edits what is decided in the service by being named, never by `req.user.role`: manager = `SalesProject.productionManagerEmployeeId`, coordinator = `ProjectProduction.productionCoordinatorEmployeeId`, Super Admin (via `dataScope.bypassesHierarchy`) edits both ⚑.
- Board rows: `dataScope.resolve` on `branchId` plus the rows the viewer's own name is on.
- Group link uses the existing `PROJECT:Pre Production` guard.
- Every table and column `snake_case` through `@map` / `@@map`; every link an id with `@relation` and an index; no text name copies added (activity `user_name` is a log, not a copy — `nameCopies.js` header).
- Whole schema ships in **one** migration; every `CREATE TABLE` ends `DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;` (`backend/test/migration-collations.test.js`); rehearsed on a copy of production before deploy; a committed migration is never rewritten.
- `prisma migrate dev` is broken locally (shadow DB). Generate/verify with a scratch DB + `prisma migrate diff`; the user applies with `npx prisma migrate deploy`.
- Never run the seed on production. Template rows ship in the migration (`INSERT … WHERE NOT EXISTS`).
- Uploads: image (JPEG/PNG/WebP) and PDF only, size and count limited; tickets through `documentStorage` (`trustUrls: false`), photos through `imageStorage`.
- WhatsApp: one message per step, each triggered by a person; sent after the step's transaction with `sendMessageToGroup({ userId: whatsappGroupLinkedByUserId, jid, body })`; a failed send never blocks the step; honour `isChatEnabled` / `isChatEnabledForUser`.
- Frontend: reuse `components/ui`, `shared`, `data-table`, `schema-form`, `layout`; no raw `<button>/<input>/<select>/<textarea>/<table>/role="dialog"` in module code; usable at 360 / 768 / 1280 px; the shell never scrolls as a page; a control the viewer cannot use is absent.
- **Mobile is the primary target.** The Production Manager and the Production Coordinator both work this from a phone during the shoot. Every production screen is designed at **360px first** and then widened:
  - the shoot panel opens **full-screen** on a phone (`SchemaFormPanel` is already `fixed inset-0 h-dvh` below `sm`), never a side pane;
  - the board shows **cards** below `md` (`DataTable` has no mobile card mode — checked — so a reusable `data-table/RecordCardList` is added) and the table from `md` up;
  - the current step's primary action is a **large, thumb-reachable button fixed to the bottom** of the panel on a phone (`shared/StickyActionBar`);
  - photo steps offer the **camera first** (`MultiImageField`'s Take photos leads);
  - a ticket **opens or downloads with one tap**;
  - the Plan form is **one column**;
  - every tap target is **at least 44px** (`Button size="lg"` is `min-h-11`);
  - **no hover-only affordances** — anything shown on hover is also there without it.
- API calls only in `frontend/src/services/project-management/*.service.js`; pure helpers in `frontend/src/lib/*.mjs`.
- **Never commit.** Every task ends with "Stage for review" (`git add` only). The user commits, pushes and opens the PR to `develop`.

## Review Focus

1. **Two presses of the same step (double tap, or the coordinator on two phones).** Expected: the step completes once and exactly one WhatsApp message goes; the second press gets 409. Pinned by Task 11 ("a second press of the same step is refused and sends nothing twice").
2. **The linker's WhatsApp is disconnected, their login is gone, or chat is switched off.** Expected: the step still completes, the message row is `FAILED` with the reason, the step shows "Not sent · Retry". Pinned by Task 14 ("a failed send still completes the step and records FAILED", "no linked group records FAILED").
3. **Edit Project re-saves services.** `saveStartProjectWork` soft-deletes and re-creates every `ProjectPostProductionAllocation` (`backend/src/modules/sales/projects/controller.js:3425-3428`), so a plan's service ids can point at deleted rows. Expected: those services are dropped from the plan read, never a 500, and a new save rejects them. Pinned by Task 5 ("a service Edit Project removed is dropped from the plan") and Task 6 ("a soft-deleted service is rejected").
4. **A file that is not a file: a link, an SVG/HTML payload, or an over-limit batch.** Expected: 400 before anything is stored. Pinned by Task 10 ("a link is not a file", "a ticket must be an image or a PDF", "the count limit is enforced").
5. **One WhatsApp group linked to two projects.** Expected: 409, so one client's messages never land in another client's group. Pinned by Task 15 ("a group already linked to another live project is refused").
6. **A phone on a slow venue network uploading several photos.** Expected: photos are compressed on the phone before they are sent (`MultiImageField` → `compressImageFile`), each goes on its own request with a visible "N left to upload", and a photo whose upload fails **stays on the phone with Retry** rather than vanishing; closing the panel with photos still waiting asks first. Pinned by Task 13 (`production-uploads.test.mjs`: "a failed upload stays queued with its reason", "retry puts only the failed ones back").

---

## Before Task 1

- [ ] Confirm with the user which branch to work on. CLAUDE.md wants a feature branch from `develop` (e.g. `feature/production-stage`); do not create, commit or push without their say-so.
- [ ] Read the reviewer checklists you will need: `.claude/agents/backend-api-reviewer.md`, `db-schema-reviewer.md`, `security-reviewer.md`, `frontend-ui-reviewer.md`. Run **db-schema-reviewer** and **security-reviewer** on the spec *before* Task 1 (CLAUDE.md "before and after").

## File Map

Backend (create):
- `backend/prisma/migrations/20260930120000_production_stage/migration.sql` — the one migration.
- `backend/src/modules/project-management/production/steps.js` — step order, labels, file rules (pure).
- `backend/src/modules/project-management/production/access.js` — caller, named-person access, board scope, `loadForWrite`, `fail`.
- `backend/src/modules/project-management/production/activity.js` — `logActivity`.
- `backend/src/modules/project-management/production/service.js` — `ensureProjectProduction` (row raising).
- `backend/src/modules/project-management/production/plan.js` — `savePlan`.
- `backend/src/modules/project-management/production/read.js` — board rows, detail, options, activity.
- `backend/src/modules/project-management/production/execution.js` — steps, shoot status, files.
- `backend/src/modules/project-management/production/messages.js` — WhatsApp send + retry.
- `backend/src/modules/project-management/production/controller.js`, `routes.js`.
- `backend/src/modules/project-management/pre-production/whatsappGroup.js` — group choices + link.
- Tests: `backend/test/production-fake-client.js`, `project-production-steps-rules.test.js`, `project-production-rows.test.js`, `project-production-access.test.js`, `project-production-read.test.js`, `project-production-plan.test.js`, `project-production-routes.test.js`, `project-production-execution.test.js`, `project-production-messages.test.js`, `pre-production-whatsapp-group.test.js`.

Backend (modify, incl. taking the coordinator off pre production): `backend/prisma/schema.prisma`, `backend/src/server.js`, `backend/src/modules/sales/projects/controller.js`, `backend/src/modules/project-management/pre-production/{controller,routes}.js`, `backend/src/services/messageTemplate.js`.

Frontend (create):
- `frontend/src/lib/productionSteps.mjs`, `frontend/src/lib/productionPlan.mjs`
- `frontend/src/services/project-management/production.service.js`
- `frontend/src/constants/productionFormConfig.js`
- `frontend/src/components/shared/StepRail.js` (moved), `frontend/src/components/shared/StickyActionBar.js`, `frontend/src/components/data-table/RecordCardList.js`
- `frontend/src/lib/productionUploads.mjs`
- `frontend/src/components/project-management/production/{ProductionPage,ProductionPendingPill,ProductionShootPanel,ProductionFileList,ProductionUploadQueue,useProductionUploads,ProductionExecutionTab,ProductionStepForm,ProductionMessageStatus,ProductionActivityTab}.js`
- `frontend/src/components/project-management/ProjectWhatsappGroupField.js`
- Tests: `frontend/test/production-steps.test.mjs`, `production-plan.test.mjs`, `production-uploads.test.mjs`, `production-page-wiring.test.mjs`, `step-rail-shared.test.mjs`, `pre-production-no-coordinator.test.mjs`.

Frontend (modify): `frontend/src/constants/formPanelConfig.js`, `components/project-management/PreProductionFormPanel.js`, `constants/infoPanelConfig.js`, `components/shared/MultiImageField.js`, `frontend/src/app/(app)/project-management/production/page.js`, `components/project-management/ProjectWorkflowModulePage.js`, `components/ai-feature/events/CreateEventWizard.js`, `components/project-management/PreProductionGeneral.js`, `services/project-management/pre-production.service.js`, `components/settings/MessageTemplatePanel.js`, `components/settings/SettingsOverlay.js`. Delete `components/ai-feature/events/wizard/StepRail.js`.

Docs (modify): `backend/README.md`, `frontend/README.md`, `docs/project-state/PROJECT-STATE.md`, `docs/CHANGELOG.md`.

---

# Phase 1 — Schema, rows, access, router, board, Plan tab

### Task 1: Schema and the one migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (models `User` ~22, `Employee` ~372, `SalesProject` ~1550, `ProjectShoot` ~3656, `ProjectPostProductionAllocation` ~4198, `Branch` ~4552, `Vendor` ~4696, `Asset` ~4862; new models after `ProjectPreProductionConcept`)
- Create: `backend/prisma/migrations/20260930120000_production_stage/migration.sql`
- Test: `backend/test/migration-collations.test.js` (existing, must still pass)

**Interfaces:**
- Produces: Prisma delegates `projectProduction`, `projectProductionTeamMember`, `projectProductionCamera`, `projectProductionService`, `projectProductionExposureVendor`, `projectProductionFile`, `projectProductionActivity`, `projectProductionMessage`; `SalesProject.whatsappGroupJid/whatsappGroupSubject/whatsappGroupLinkedByUserId/whatsappGroupLinkedAt`; compound unique `productionId_step` on messages; message template keys `PRODUCTION_STARTED_FROM_STUDIO`, `PRODUCTION_REACHED_SHOOT_PLACE`, `PRODUCTION_SHOOT_COMPLETED` seeded.

- [ ] **Step 1: Add the new models to `schema.prisma`** directly after the `ProjectPreProductionConcept` model:

```prisma
/// Production's record of one shoot: the Production Manager's plan and the Production
/// Coordinator's steps on the day.
///
/// One row per `ProjectShoot`, raised by `production/service.js` the moment a started project has
/// a Production Manager - in the same two places pre production rows are raised. The project, the
/// shoot and the manager are read back through the links; only what production itself decides or
/// records lives here. `currentStep` walks STARTED_FROM_STUDIO … PHOTO_COPY and then DONE, one step
/// at a time (`production/steps.js`); each step's completion time has its own column, and who
/// completed it is the STEP_COMPLETED line in `activities`.
model ProjectProduction {
  id                              String    @id @default(cuid())
  shootId                         String    @unique @map("shoot_id")
  salesProjectId                  String    @map("sales_project_id")
  /// The project's branch, copied when the row is raised and kept in step on every project save
  /// (`ensureProjectProduction`), so `dataScope` narrows this table by branch without a join.
  branchId                        Int?      @map("branch_id")
  productionCoordinatorEmployeeId Int?      @map("production_coordinator_employee_id")
  /// One of pre production's travel modes (`travelModes` in pre-production/controller.js).
  travelMode                      String?   @map("travel_mode") @db.VarChar(30)
  remarks                         String?   @db.Text
  planSubmittedAt                 DateTime? @map("plan_submitted_at")
  planSubmittedByUserId           Int?      @map("plan_submitted_by_user_id")
  currentStep                     String    @default("STARTED_FROM_STUDIO") @map("current_step") @db.VarChar(30)
  startedFromStudioAt             DateTime? @map("started_from_studio_at")
  reachedShootPlaceAt             DateTime? @map("reached_shoot_place_at")
  pineappleMeetingAt              DateTime? @map("pineapple_meeting_at")
  shootStartedAt                  DateTime? @map("shoot_started_at")
  /// When the shoot status was set to Completed, which is what finishes step 5.
  shootStatusAt                   DateTime? @map("shoot_status_at")
  reachedStudioAt                 DateTime? @map("reached_studio_at")
  photoCopyAt                     DateTime? @map("photo_copy_at")
  pineappleRemarks                String?   @map("pineapple_remarks") @db.Text
  /// PAUSED, HOLD, REJECT or COMPLETED; null until first set.
  shootStatus                     String?   @map("shoot_status") @db.VarChar(20)
  shootStatusRemarks              String?   @map("shoot_status_remarks") @db.Text
  footageUrl                      String?   @map("footage_url") @db.VarChar(2048)
  footageBackupByEmployeeId       Int?      @map("footage_backup_by_employee_id")
  footageRemarks                  String?   @map("footage_remarks") @db.Text
  createdAt                       DateTime  @default(now()) @map("created_at")
  updatedAt                       DateTime  @updatedAt @map("updated_at")

  shoot                         ProjectShoot                      @relation(fields: [shootId], references: [id], onDelete: Cascade)
  salesProject                  SalesProject                      @relation(fields: [salesProjectId], references: [id], onDelete: Cascade)
  branch                        Branch?                           @relation(fields: [branchId], references: [id], onDelete: SetNull)
  productionCoordinatorEmployee Employee?                         @relation("ProjectProductionCoordinator", fields: [productionCoordinatorEmployeeId], references: [id], onDelete: SetNull)
  footageBackupByEmployee       Employee?                         @relation("ProjectProductionFootageBackup", fields: [footageBackupByEmployeeId], references: [id], onDelete: SetNull)
  planSubmittedByUser           User?                             @relation("ProjectProductionPlanSubmittedBy", fields: [planSubmittedByUserId], references: [id], onDelete: SetNull)
  teamMembers                   ProjectProductionTeamMember[]
  cameras                       ProjectProductionCamera[]
  services                      ProjectProductionService[]
  exposureVendors               ProjectProductionExposureVendor[]
  files                         ProjectProductionFile[]
  activities                    ProjectProductionActivity[]
  messages                      ProjectProductionMessage[]

  @@index([salesProjectId])
  @@index([branchId])
  @@index([productionCoordinatorEmployeeId])
  @@index([footageBackupByEmployeeId])
  @@index([planSubmittedByUserId])
  @@index([currentStep])
  @@map("project_production")
}

/// The production team named on a shoot's plan. Replaced whole on every plan save.
model ProjectProductionTeamMember {
  id           String   @id @default(cuid())
  productionId String   @map("production_id")
  employeeId   Int      @map("employee_id")
  createdAt    DateTime @default(now()) @map("created_at")

  production ProjectProduction @relation(fields: [productionId], references: [id], onDelete: Cascade)
  employee   Employee          @relation("ProjectProductionTeamMemberEmployee", fields: [employeeId], references: [id], onDelete: Cascade)

  @@unique([productionId, employeeId])
  @@index([employeeId])
  @@map("project_production_team_member")
}

/// Cameras taken to a shoot - assets in Asset Management's "Cameras" category. Optional.
model ProjectProductionCamera {
  id           String   @id @default(cuid())
  productionId String   @map("production_id")
  assetId      Int      @map("asset_id")
  createdAt    DateTime @default(now()) @map("created_at")

  production ProjectProduction @relation(fields: [productionId], references: [id], onDelete: Cascade)
  asset      Asset             @relation("ProjectProductionCameraAsset", fields: [assetId], references: [id], onDelete: Cascade)

  @@unique([productionId, assetId])
  @@index([assetId])
  @@map("project_production_camera")
}

/// The services this shoot's production covers - only allocations of this shoot are accepted.
model ProjectProductionService {
  id           String   @id @default(cuid())
  productionId String   @map("production_id")
  allocationId String   @map("allocation_id")
  createdAt    DateTime @default(now()) @map("created_at")

  production ProjectProduction               @relation(fields: [productionId], references: [id], onDelete: Cascade)
  allocation ProjectPostProductionAllocation @relation(fields: [allocationId], references: [id], onDelete: Cascade)

  @@unique([productionId, allocationId])
  @@index([allocationId])
  @@map("project_production_service")
}

/// The exposure vendors booked for a shoot.
model ProjectProductionExposureVendor {
  id           String   @id @default(cuid())
  productionId String   @map("production_id")
  vendorId     Int      @map("vendor_id")
  createdAt    DateTime @default(now()) @map("created_at")

  production ProjectProduction @relation(fields: [productionId], references: [id], onDelete: Cascade)
  vendor     Vendor            @relation("ProjectProductionExposureVendor", fields: [vendorId], references: [id], onDelete: Cascade)

  @@unique([productionId, vendorId])
  @@index([vendorId])
  @@map("project_production_exposure_vendor")
}

/// A file on a shoot: a ticket (image or PDF, the manager's) or a photo (the coordinator's).
model ProjectProductionFile {
  id               String   @id @default(cuid())
  productionId     String   @map("production_id")
  /// TICKET, PINEAPPLE_GROUP or HAPPENING_NOW.
  kind             String   @db.VarChar(20)
  /// The public link - or, on a machine with no object storage, the inline data URI, which is why
  /// this is MediumText like the employee photo columns.
  url              String   @db.MediumText
  fileName         String   @map("file_name") @db.VarChar(255)
  mimeType         String?  @map("mime_type") @db.VarChar(100)
  uploadedByUserId Int?     @map("uploaded_by_user_id")
  createdAt        DateTime @default(now()) @map("created_at")

  production     ProjectProduction @relation(fields: [productionId], references: [id], onDelete: Cascade)
  uploadedByUser User?             @relation("ProjectProductionFileUploadedBy", fields: [uploadedByUserId], references: [id], onDelete: SetNull)

  @@index([productionId, kind])
  @@index([uploadedByUserId])
  @@map("project_production_file")
}

/// Everything done on a shoot's production, oldest first - modelled on `HrmTaskActivity`.
/// `userName` is who did it at the time; a log is not a name copy (see nameCopies.js).
model ProjectProductionActivity {
  id           Int      @id @default(autoincrement())
  productionId String   @map("production_id")
  /// PLAN_SAVED, PLAN_SUBMITTED, STEP_COMPLETED, SHOOT_STATUS_CHANGED, FILE_ADDED, FILE_REMOVED,
  /// WHATSAPP_SENT, WHATSAPP_FAILED or WHATSAPP_RETRIED.
  action       String   @db.VarChar(40)
  detail       String?  @db.Text
  userId       Int?     @map("user_id")
  userName     String   @map("user_name") @db.VarChar(191)
  createdAt    DateTime @default(now()) @map("created_at")

  production ProjectProduction @relation(fields: [productionId], references: [id], onDelete: Cascade)
  user       User?             @relation("ProjectProductionActivityUser", fields: [userId], references: [id], onDelete: SetNull)

  @@index([productionId, createdAt])
  @@index([userId])
  @@map("project_production_activity")
}

/// The one WhatsApp message a step posts to the project's group, and how it went.
model ProjectProductionMessage {
  id             String    @id @default(cuid())
  productionId   String    @map("production_id")
  /// STARTED_FROM_STUDIO, REACHED_SHOOT_PLACE or SHOOT_COMPLETED.
  step           String    @db.VarChar(30)
  /// SENT or FAILED; SENDING only while a retry holds its claim.
  status         String    @db.VarChar(10)
  error          String?   @db.Text
  sentAt         DateTime? @map("sent_at")
  sentFromUserId Int?      @map("sent_from_user_id")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  production   ProjectProduction @relation(fields: [productionId], references: [id], onDelete: Cascade)
  sentFromUser User?             @relation("ProjectProductionMessageSentFrom", fields: [sentFromUserId], references: [id], onDelete: SetNull)

  @@unique([productionId, step])
  @@index([sentFromUserId])
  @@map("project_production_message")
}
```

- [ ] **Step 2: Add the back-fields and the SalesProject columns**

In `model SalesProject`, after `crdDocumentStatus` (line ~1614) add:

```prisma
  /// The project's WhatsApp group, linked on Pre Production → General from the linker's own paired
  /// WhatsApp; production messages are sent into it from that linker's WhatsApp.
  whatsappGroupJid                    String?                                   @map("whatsapp_group_jid") @db.VarChar(64)
  whatsappGroupSubject                String?                                   @map("whatsapp_group_subject") @db.VarChar(500)
  whatsappGroupLinkedByUserId         Int?                                      @map("whatsapp_group_linked_by_user_id")
  whatsappGroupLinkedAt               DateTime?                                 @map("whatsapp_group_linked_at")
```

In its relation list (after `applicabilityChanges`) add `productions ProjectProduction[]`, and after `createdByUser` add:

```prisma
  whatsappGroupLinkedByUser         User?     @relation("SalesProjectWhatsappGroupLinkedBy", fields: [whatsappGroupLinkedByUserId], references: [id], onDelete: SetNull)
```

and in its index list add `@@index([whatsappGroupJid])` and `@@index([whatsappGroupLinkedByUserId])`.

Back-fields (add to each model's relation list):
- `ProjectShoot`: `production ProjectProduction?`
- `ProjectPreProduction` (no column change): above `productionCoordinator` add
  ```prisma
  /// DEPRECATED — the Production Coordinator lives on `ProjectProduction` now. These two are only
  /// read once, by `ensureProjectProduction`, to carry an existing answer over as the plan's starting
  /// coordinator; nothing writes them. Dropped by a follow-up migration once every eligible shoot
  /// has its production row.
  ```
- `ProjectPostProductionAllocation`: `productionServices ProjectProductionService[]`
- `Branch`: `projectProductions ProjectProduction[]`
- `Asset`: `productionCameras ProjectProductionCamera[] @relation("ProjectProductionCameraAsset")`
- `Vendor`: `productionExposures ProjectProductionExposureVendor[] @relation("ProjectProductionExposureVendor")`
- `Employee`:
  ```prisma
  productionsCoordinated         ProjectProduction[]           @relation("ProjectProductionCoordinator")
  productionFootageBackups       ProjectProduction[]           @relation("ProjectProductionFootageBackup")
  productionTeamMemberships      ProjectProductionTeamMember[] @relation("ProjectProductionTeamMemberEmployee")
  ```
- `User`:
  ```prisma
  productionPlansSubmitted       ProjectProduction[]         @relation("ProjectProductionPlanSubmittedBy")
  productionFilesUploaded        ProjectProductionFile[]     @relation("ProjectProductionFileUploadedBy")
  productionActivities           ProjectProductionActivity[] @relation("ProjectProductionActivityUser")
  productionMessagesSent         ProjectProductionMessage[]  @relation("ProjectProductionMessageSentFrom")
  salesProjectWhatsappGroupLinks SalesProject[]              @relation("SalesProjectWhatsappGroupLinkedBy")
  ```

- [ ] **Step 3: Validate the schema**

Run: `cd backend && npx prisma validate && npx prisma format`
Expected: `The schema at prisma/schema.prisma is valid 🚀`. Keep only the formatting `prisma format` applies to the lines you added; revert any whitespace it moves elsewhere.

- [ ] **Step 4: Write the migration** `backend/prisma/migrations/20260930120000_production_stage/migration.sql`:

```sql
-- Production: one record per shoot of a started project that has a Production Manager.
--
-- The Production Manager fills a plan per shoot (coordinator, team, travel, tickets, cameras,
-- services, exposure vendors, remarks); the Production Coordinator named in it then walks seven
-- steps on the day, strictly in order. Every action is logged, three steps post to the project's
-- WhatsApp group, and that group is linked on the project itself from Pre Production → General.
--
-- Additive only: new columns on `sales_project` are nullable and every other statement creates a
-- table, so this cannot fail on production data. Rows are raised by the application the next time
-- each project is saved or given a shoot; nothing is backfilled here.

-- AlterTable
ALTER TABLE `sales_project`
  ADD COLUMN `whatsapp_group_jid` VARCHAR(64) NULL,
  ADD COLUMN `whatsapp_group_subject` VARCHAR(500) NULL,
  ADD COLUMN `whatsapp_group_linked_by_user_id` INTEGER NULL,
  ADD COLUMN `whatsapp_group_linked_at` DATETIME(3) NULL;

CREATE INDEX `sales_project_whatsapp_group_jid_idx` ON `sales_project`(`whatsapp_group_jid`);
CREATE INDEX `sales_project_whatsapp_group_linked_by_user_id_idx` ON `sales_project`(`whatsapp_group_linked_by_user_id`);

-- CreateTable
CREATE TABLE `project_production` (
    `id` VARCHAR(191) NOT NULL,
    `shoot_id` VARCHAR(191) NOT NULL,
    `sales_project_id` VARCHAR(191) NOT NULL,
    `branch_id` INTEGER NULL,
    `production_coordinator_employee_id` INTEGER NULL,
    `travel_mode` VARCHAR(30) NULL,
    `remarks` TEXT NULL,
    `plan_submitted_at` DATETIME(3) NULL,
    `plan_submitted_by_user_id` INTEGER NULL,
    `current_step` VARCHAR(30) NOT NULL DEFAULT 'STARTED_FROM_STUDIO',
    `started_from_studio_at` DATETIME(3) NULL,
    `reached_shoot_place_at` DATETIME(3) NULL,
    `pineapple_meeting_at` DATETIME(3) NULL,
    `shoot_started_at` DATETIME(3) NULL,
    `shoot_status_at` DATETIME(3) NULL,
    `reached_studio_at` DATETIME(3) NULL,
    `photo_copy_at` DATETIME(3) NULL,
    `pineapple_remarks` TEXT NULL,
    `shoot_status` VARCHAR(20) NULL,
    `shoot_status_remarks` TEXT NULL,
    `footage_url` VARCHAR(2048) NULL,
    `footage_backup_by_employee_id` INTEGER NULL,
    `footage_remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `project_production_shoot_id_key`(`shoot_id`),
    INDEX `project_production_sales_project_id_idx`(`sales_project_id`),
    INDEX `project_production_branch_id_idx`(`branch_id`),
    INDEX `project_production_production_coordinator_employee_id_idx`(`production_coordinator_employee_id`),
    INDEX `project_production_footage_backup_by_employee_id_idx`(`footage_backup_by_employee_id`),
    INDEX `project_production_plan_submitted_by_user_id_idx`(`plan_submitted_by_user_id`),
    INDEX `project_production_current_step_idx`(`current_step`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_production_team_member` (
    `id` VARCHAR(191) NOT NULL,
    `production_id` VARCHAR(191) NOT NULL,
    `employee_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `project_production_team_member_production_id_employee_id_key`(`production_id`, `employee_id`),
    INDEX `project_production_team_member_employee_id_idx`(`employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_production_camera` (
    `id` VARCHAR(191) NOT NULL,
    `production_id` VARCHAR(191) NOT NULL,
    `asset_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `project_production_camera_production_id_asset_id_key`(`production_id`, `asset_id`),
    INDEX `project_production_camera_asset_id_idx`(`asset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_production_service` (
    `id` VARCHAR(191) NOT NULL,
    `production_id` VARCHAR(191) NOT NULL,
    `allocation_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `project_production_service_production_id_allocation_id_key`(`production_id`, `allocation_id`),
    INDEX `project_production_service_allocation_id_idx`(`allocation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_production_exposure_vendor` (
    `id` VARCHAR(191) NOT NULL,
    `production_id` VARCHAR(191) NOT NULL,
    `vendor_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `project_production_exposure_vendor_production_id_vendor_id_key`(`production_id`, `vendor_id`),
    INDEX `project_production_exposure_vendor_vendor_id_idx`(`vendor_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_production_file` (
    `id` VARCHAR(191) NOT NULL,
    `production_id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `url` MEDIUMTEXT NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(100) NULL,
    `uploaded_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `project_production_file_production_id_kind_idx`(`production_id`, `kind`),
    INDEX `project_production_file_uploaded_by_user_id_idx`(`uploaded_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_production_activity` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `production_id` VARCHAR(191) NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `detail` TEXT NULL,
    `user_id` INTEGER NULL,
    `user_name` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `project_production_activity_production_id_created_at_idx`(`production_id`, `created_at`),
    INDEX `project_production_activity_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_production_message` (
    `id` VARCHAR(191) NOT NULL,
    `production_id` VARCHAR(191) NOT NULL,
    `step` VARCHAR(30) NOT NULL,
    `status` VARCHAR(10) NOT NULL,
    `error` TEXT NULL,
    `sent_at` DATETIME(3) NULL,
    `sent_from_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `project_production_message_production_id_step_key`(`production_id`, `step`),
    INDEX `project_production_message_sent_from_user_id_idx`(`sent_from_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_project` ADD CONSTRAINT `sales_project_whatsapp_group_linked_by_user_id_fkey` FOREIGN KEY (`whatsapp_group_linked_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_production` ADD CONSTRAINT `project_production_shoot_id_fkey` FOREIGN KEY (`shoot_id`) REFERENCES `project_shoot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production` ADD CONSTRAINT `project_production_sales_project_id_fkey` FOREIGN KEY (`sales_project_id`) REFERENCES `sales_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production` ADD CONSTRAINT `project_production_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_production` ADD CONSTRAINT `project_production_production_coordinator_employee_id_fkey` FOREIGN KEY (`production_coordinator_employee_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_production` ADD CONSTRAINT `project_production_footage_backup_by_employee_id_fkey` FOREIGN KEY (`footage_backup_by_employee_id`) REFERENCES `employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_production` ADD CONSTRAINT `project_production_plan_submitted_by_user_id_fkey` FOREIGN KEY (`plan_submitted_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_production_team_member` ADD CONSTRAINT `project_production_team_member_production_id_fkey` FOREIGN KEY (`production_id`) REFERENCES `project_production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_team_member` ADD CONSTRAINT `project_production_team_member_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_camera` ADD CONSTRAINT `project_production_camera_production_id_fkey` FOREIGN KEY (`production_id`) REFERENCES `project_production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_camera` ADD CONSTRAINT `project_production_camera_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_service` ADD CONSTRAINT `project_production_service_production_id_fkey` FOREIGN KEY (`production_id`) REFERENCES `project_production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_service` ADD CONSTRAINT `project_production_service_allocation_id_fkey` FOREIGN KEY (`allocation_id`) REFERENCES `project_post_production_allocation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_exposure_vendor` ADD CONSTRAINT `project_production_exposure_vendor_production_id_fkey` FOREIGN KEY (`production_id`) REFERENCES `project_production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_exposure_vendor` ADD CONSTRAINT `project_production_exposure_vendor_vendor_id_fkey` FOREIGN KEY (`vendor_id`) REFERENCES `vendor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_file` ADD CONSTRAINT `project_production_file_production_id_fkey` FOREIGN KEY (`production_id`) REFERENCES `project_production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_file` ADD CONSTRAINT `project_production_file_uploaded_by_user_id_fkey` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_production_activity` ADD CONSTRAINT `project_production_activity_production_id_fkey` FOREIGN KEY (`production_id`) REFERENCES `project_production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_activity` ADD CONSTRAINT `project_production_activity_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `project_production_message` ADD CONSTRAINT `project_production_message_production_id_fkey` FOREIGN KEY (`production_id`) REFERENCES `project_production`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `project_production_message` ADD CONSTRAINT `project_production_message_sent_from_user_id_fkey` FOREIGN KEY (`sent_from_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- The three production messages, as starting wording the studio edits in Settings → Templates.
-- `WHERE NOT EXISTS` so a studio that already wrote one keeps it, and a replay loses nothing.
INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'PRODUCTION_STARTED_FROM_STUDIO', 'Production — Started From Studio', 'Hi, our team has started from the studio for {shoot} on {date}.
Project: {project name}
Location: {location}
Production Coordinator: {coordinator}'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'PRODUCTION_STARTED_FROM_STUDIO');

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'PRODUCTION_REACHED_SHOOT_PLACE', 'Production — Reached Shoot Place', 'Hi, our team has reached {location} for {shoot} ({date}).
Production Coordinator: {coordinator}'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'PRODUCTION_REACHED_SHOOT_PLACE');

INSERT INTO `message_template` (`key`, `name`, `body`)
SELECT 'PRODUCTION_SHOOT_COMPLETED', 'Production — Shoot Completed', 'Hi, {shoot} for {project name} on {date} is complete. Thank you!
Production Coordinator: {coordinator}'
WHERE NOT EXISTS (SELECT 1 FROM `message_template` WHERE `key` = 'PRODUCTION_SHOOT_COMPLETED');
```

- [ ] **Step 5: Verify the migration against the schema on a scratch database** (the shadow DB is broken locally; this is the procedure that works):

```bash
cd backend
# 1) Replay every migration, including the new one, into a fresh scratch database on the same server.
SCRATCH_URL="$(node -e 'const u=new URL(process.env.DATABASE_URL);u.pathname="/dbs_operations_os_scratch";console.log(u.toString())')"
DATABASE_URL="$SCRATCH_URL" npx prisma migrate deploy
# 2) Diff the replayed database against the schema. Expected: no statement about any production_* table
#    or the four sales_project whatsapp_group_* columns. Pre-existing drift (DROP FOREIGN KEY on
#    image_selection_deliverable_config, `updated_at` DROP DEFAULT, RENAME INDEX on master-data tables)
#    is not this change's to fix.
npx prisma migrate diff --from-url "$SCRATCH_URL" --to-schema-datamodel prisma/schema.prisma --script
```

Expected: `migrate deploy` ends "All migrations have been successfully applied"; the diff contains nothing mentioning `production` or `whatsapp_group_`. If it does, fix the SQL (never the name of an already-committed migration).

- [ ] **Step 6: Run the collation test and generate the client**

Run: `cd backend && node --test test/migration-collations.test.js && npx prisma generate`
Expected: 3 passing tests; client generated.

- [ ] **Step 7: Ask the user to apply locally** — `cd backend && npx prisma migrate deploy` against their dev DB (their call, per the memory note). Before production: rehearse `migrate deploy` on a restored copy of the production database (CLAUDE.md Rule 5).

- [ ] **Step 8: Stage for review (do NOT commit — the user commits)**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260930120000_production_stage/migration.sql
```

---

### Task 2: Step rules (pure)

**Files:**
- Create: `backend/src/modules/project-management/production/steps.js`
- Test: `backend/test/project-production-steps-rules.test.js`

**Interfaces:**
- Produces: `STEPS: string[7]`, `DONE = "DONE"`, `STEP_LABELS`, `STEP_TIME_FIELDS`, `SHOOT_STATUSES`, `SHOOT_STATUS_LABELS`, `MESSAGE_STEPS`, `MESSAGE_LABELS`, `MESSAGE_FOR_STEP` (`{ STARTED_FROM_STUDIO, REACHED_SHOOT_PLACE, SHOOT_STATUS → "SHOOT_COMPLETED" }`), `FILE_KINDS`, `FILE_KIND_LABELS`, `FILE_LIMITS`, `MIN_HAPPENING_NOW = 2`, `stepIndex(step): number`, `nextStep(step): string|null`, `pendingLabel(record): string`, `fileAddRefusal(record, kind): string|null`, `fileRemoveRefusal(record, kind): string|null`.

- [ ] **Step 1: Write the failing test** `backend/test/project-production-steps-rules.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/modules/project-management/production/steps");

const submitted = (overrides = {}) => ({ planSubmittedAt: new Date(), currentStep: "STARTED_FROM_STUDIO", shootStatus: null, ...overrides });

test("the seven steps run in one order and end in DONE", () => {
  assert.deepEqual(S.STEPS, ["STARTED_FROM_STUDIO", "REACHED_SHOOT_PLACE", "PINEAPPLE_MEETING", "SHOOT_STARTED", "SHOOT_STATUS", "REACHED_STUDIO", "PHOTO_COPY"]);
  assert.equal(S.nextStep("STARTED_FROM_STUDIO"), "REACHED_SHOOT_PLACE");
  assert.equal(S.nextStep("PHOTO_COPY"), S.DONE);
  assert.equal(S.nextStep("NOT_A_STEP"), null);
  assert.equal(S.stepIndex(S.DONE), 7);
});

test("the pending pill says what the shoot is waiting on", () => {
  assert.equal(S.pendingLabel({ planSubmittedAt: null, currentStep: "STARTED_FROM_STUDIO" }), "Plan pending");
  assert.equal(S.pendingLabel(submitted({ currentStep: "PINEAPPLE_MEETING" })), "Step 3/7 · Pineapple meeting");
  assert.equal(S.pendingLabel(submitted({ currentStep: "SHOOT_STATUS", shootStatus: "PAUSED" })), "Paused");
  assert.equal(S.pendingLabel(submitted({ currentStep: "SHOOT_STATUS", shootStatus: null })), "Step 5/7 · Shoot status");
  assert.equal(S.pendingLabel(submitted({ currentStep: S.DONE })), "Done");
});

test("the three WhatsApp steps map to their messages", () => {
  assert.equal(S.MESSAGE_FOR_STEP.STARTED_FROM_STUDIO, "STARTED_FROM_STUDIO");
  assert.equal(S.MESSAGE_FOR_STEP.REACHED_SHOOT_PLACE, "REACHED_SHOOT_PLACE");
  assert.equal(S.MESSAGE_FOR_STEP.SHOOT_STATUS, "SHOOT_COMPLETED");
  assert.equal(S.MESSAGE_FOR_STEP.PINEAPPLE_MEETING, undefined);
});

test("tickets can change until the shoot is done", () => {
  assert.equal(S.fileAddRefusal({ planSubmittedAt: null, currentStep: "STARTED_FROM_STUDIO" }, "TICKET"), null);
  assert.match(S.fileAddRefusal(submitted({ currentStep: S.DONE }), "TICKET"), /done/);
  assert.equal(S.fileRemoveRefusal(submitted({ currentStep: "SHOOT_STATUS" }), "TICKET"), null);
});

test("the pineapple photo belongs to the pineapple meeting step only", () => {
  assert.match(S.fileAddRefusal({ planSubmittedAt: null, currentStep: "PINEAPPLE_MEETING" }, "PINEAPPLE_GROUP"), /plan/);
  assert.equal(S.fileAddRefusal(submitted({ currentStep: "PINEAPPLE_MEETING" }), "PINEAPPLE_GROUP"), null);
  assert.ok(S.fileAddRefusal(submitted({ currentStep: "REACHED_SHOOT_PLACE" }), "PINEAPPLE_GROUP"));
  assert.ok(S.fileRemoveRefusal(submitted({ currentStep: "SHOOT_STARTED" }), "PINEAPPLE_GROUP"));
});

test("happening-now photos are added until the shoot is completed, removed only before Shoot started is done", () => {
  assert.equal(S.fileAddRefusal(submitted({ currentStep: "SHOOT_STARTED" }), "HAPPENING_NOW"), null);
  assert.equal(S.fileAddRefusal(submitted({ currentStep: "SHOOT_STATUS" }), "HAPPENING_NOW"), null);
  assert.ok(S.fileAddRefusal(submitted({ currentStep: "REACHED_STUDIO" }), "HAPPENING_NOW"));
  assert.equal(S.fileRemoveRefusal(submitted({ currentStep: "SHOOT_STARTED" }), "HAPPENING_NOW"), null);
  assert.ok(S.fileRemoveRefusal(submitted({ currentStep: "SHOOT_STATUS" }), "HAPPENING_NOW"));
});

test("an unknown kind is refused", () => {
  assert.ok(S.fileAddRefusal(submitted(), "SELFIE"));
  assert.ok(S.fileRemoveRefusal(submitted(), "SELFIE"));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd backend && node --test test/project-production-steps-rules.test.js`
Expected: FAIL — `Cannot find module '../src/modules/project-management/production/steps'`.

- [ ] **Step 3: Implement** `backend/src/modules/project-management/production/steps.js`:

```js
/**
 * The steps a Production Coordinator works through on one shoot, and the rules about them.
 *
 * Pure: no database, no clock. The service reads a record and asks these questions of it, so the
 * order of the day is written once and the tests can hold it without MySQL.
 *
 * Strictly one after another. Only the current step can be completed; a finished step is never
 * reopened. The one thing that can change again is the shoot status (step 5), and only until it is
 * Completed - Completed opens Reached studio, and from then on it stays Completed.
 */

const STEPS = ["STARTED_FROM_STUDIO", "REACHED_SHOOT_PLACE", "PINEAPPLE_MEETING", "SHOOT_STARTED", "SHOOT_STATUS", "REACHED_STUDIO", "PHOTO_COPY"];
const DONE = "DONE";

const STEP_LABELS = {
  STARTED_FROM_STUDIO: "Started from studio",
  REACHED_SHOOT_PLACE: "Reached shoot place",
  PINEAPPLE_MEETING: "Pineapple meeting",
  SHOOT_STARTED: "Shoot started",
  SHOOT_STATUS: "Shoot status",
  REACHED_STUDIO: "Reached studio",
  PHOTO_COPY: "Photo copy",
};

/** The column each step's completion time is kept in. */
const STEP_TIME_FIELDS = {
  STARTED_FROM_STUDIO: "startedFromStudioAt",
  REACHED_SHOOT_PLACE: "reachedShootPlaceAt",
  PINEAPPLE_MEETING: "pineappleMeetingAt",
  SHOOT_STARTED: "shootStartedAt",
  SHOOT_STATUS: "shootStatusAt",
  REACHED_STUDIO: "reachedStudioAt",
  PHOTO_COPY: "photoCopyAt",
};

const SHOOT_STATUSES = ["PAUSED", "HOLD", "REJECT", "COMPLETED"];
const SHOOT_STATUS_LABELS = { PAUSED: "Paused", HOLD: "Hold", REJECT: "Rejected", COMPLETED: "Completed" };

/** The three WhatsApp messages, and which step sends each. */
const MESSAGE_STEPS = ["STARTED_FROM_STUDIO", "REACHED_SHOOT_PLACE", "SHOOT_COMPLETED"];
const MESSAGE_LABELS = { STARTED_FROM_STUDIO: "Started from studio", REACHED_SHOOT_PLACE: "Reached shoot place", SHOOT_COMPLETED: "Shoot completed" };
const MESSAGE_FOR_STEP = { STARTED_FROM_STUDIO: "STARTED_FROM_STUDIO", REACHED_SHOOT_PLACE: "REACHED_SHOOT_PLACE", SHOOT_STATUS: "SHOOT_COMPLETED" };

const FILE_KINDS = ["TICKET", "PINEAPPLE_GROUP", "HAPPENING_NOW"];
const FILE_KIND_LABELS = { TICKET: "Ticket", PINEAPPLE_GROUP: "Pineapple meeting photo", HAPPENING_NOW: "Happening-now photo" };
/** How many of each a shoot may hold. */
const FILE_LIMITS = { TICKET: 10, PINEAPPLE_GROUP: 5, HAPPENING_NOW: 30 };
const MIN_HAPPENING_NOW = 2;

const stepIndex = (step) => (step === DONE ? STEPS.length : STEPS.indexOf(step));

function nextStep(step) {
  const index = STEPS.indexOf(step);
  if (index === -1) return null;
  return STEPS[index + 1] || DONE;
}

/** The board's pill: what this shoot is waiting on right now. */
function pendingLabel(record) {
  if (!record.planSubmittedAt) return "Plan pending";
  if (record.currentStep === DONE) return "Done";
  if (record.currentStep === "SHOOT_STATUS" && record.shootStatus && record.shootStatus !== "COMPLETED") return SHOOT_STATUS_LABELS[record.shootStatus];
  return `Step ${STEPS.indexOf(record.currentStep) + 1}/${STEPS.length} · ${STEP_LABELS[record.currentStep]}`;
}

/** Why a file of this kind cannot be added now, or null when it can. Who may add it is access.js's. */
function fileAddRefusal(record, kind) {
  if (!FILE_KINDS.includes(kind)) return "Unknown kind of file.";
  if (kind === "TICKET") return record.currentStep === DONE ? "This shoot is done; its tickets can no longer change." : null;
  if (!record.planSubmittedAt) return "The plan has not been submitted yet.";
  if (kind === "PINEAPPLE_GROUP") {
    return record.currentStep === "PINEAPPLE_MEETING" ? null : "The group photo is added at the Pineapple meeting step.";
  }
  return ["SHOOT_STARTED", "SHOOT_STATUS"].includes(record.currentStep) ? null : "Happening-now photos are added from Shoot started until the shoot is completed.";
}

/** Why a file of this kind cannot be removed now: once its step is done, it stays. */
function fileRemoveRefusal(record, kind) {
  if (kind === "TICKET") return record.currentStep === DONE ? "This shoot is done; its tickets can no longer change." : null;
  if (kind === "PINEAPPLE_GROUP") return record.currentStep === "PINEAPPLE_MEETING" ? null : "The pineapple meeting is done; its photo stays.";
  if (kind === "HAPPENING_NOW") return record.currentStep === "SHOOT_STARTED" ? null : "Shoot started is done; its photos stay.";
  return "Unknown kind of file.";
}

module.exports = {
  STEPS, DONE, STEP_LABELS, STEP_TIME_FIELDS, SHOOT_STATUSES, SHOOT_STATUS_LABELS,
  MESSAGE_STEPS, MESSAGE_LABELS, MESSAGE_FOR_STEP, FILE_KINDS, FILE_KIND_LABELS, FILE_LIMITS, MIN_HAPPENING_NOW,
  stepIndex, nextStep, pendingLabel, fileAddRefusal, fileRemoveRefusal,
};
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd backend && node --test test/project-production-steps-rules.test.js`
Expected: 7 passing.

- [ ] **Step 5: Stage for review (do NOT commit — the user commits)**

```bash
git add backend/src/modules/project-management/production/steps.js backend/test/project-production-steps-rules.test.js
```

---

### Task 3: Raising production rows, and moving the coordinator off pre production

**Files:**
- Create: `backend/src/modules/project-management/production/service.js`
- Modify: `backend/src/modules/sales/projects/controller.js:10` (require), `:3453` (saveStartProjectWork), `:3689` (createProjectShoots)
- Modify: `backend/src/modules/project-management/pre-production/controller.js` — schema field `:53`, `toRow` `:330-331`, `updateRow` destructure `:477` and write block `:527-546`
- Modify: `frontend/src/constants/formPanelConfig.js:724-733` (the "Status" section) and the comment on `preProductionFormSectionsFor` (`:736-739`)
- Modify: `frontend/src/components/project-management/PreProductionFormPanel.js:91,100-103,123,133`
- Modify: `frontend/src/constants/infoPanelConfig.js:239` (pre production's read-back "Production Coordinator" only — **not** `:289` "Assigned By (Project Coordinator)", which is a different field, and not `ProjectDataTable.js`)
- Test: `backend/test/project-production-rows.test.js`, `backend/test/project-pre-production.test.js` (append), `frontend/test/pre-production-no-coordinator.test.mjs`

Checked with `grep -rn "productionCoordinator"`: `frontend/src/lib/preProductionProgress.js`, `frontend/src/lib/preProductionFormat.js` and `frontend/test/pre-production-progress.test.mjs` never count or format the coordinator, and `backend/src/services/nameCopies.js` / `resolvedNames.js` do not declare it — so there is nothing to remove there. Re-run the grep before you start; if a new use has appeared, remove it in this task.

**Interfaces:**
- Consumes: Prisma delegates from Task 1.
- Produces: `ensureProjectProduction(client, projectId): Promise<number>` — rows created, each carrying `productionCoordinatorEmployeeId` from the shoot's pre production row when that employee still exists. Pre production rows no longer carry `productionCoordinator` / `productionCoordinatorEmployeeId`, and `PATCH /api/project-management/pre-production/:shootId` no longer accepts it (the key is stripped).

- [ ] **Step 1: Write the failing tests**

`backend/test/project-production-rows.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { ensureProjectProduction } = require("../src/modules/project-management/production/service");

/*
 * A stand-in for the Prisma calls row raising makes - one project, its shoots (with the pre
 * production coordinator each may carry), the employees that exist, and whatever production rows
 * exist - so this runs without MySQL, as the pre production row tests do.
 */
function fakeClient({ project, shoots = [], existing = [], employees = [] } = {}) {
  const state = { created: [], existing: existing.map((row) => ({ ...row })), branchSyncs: [] };
  return {
    state,
    salesProject: { findFirst: async ({ where }) => (project && project.id === where.id && !project.deletedAt ? project : null) },
    projectShoot: { findMany: async () => shoots.filter((shoot) => !shoot.deletedAt).map((shoot) => ({ id: shoot.id, preProduction: shoot.preProduction ?? null })) },
    employee: { findMany: async ({ where }) => employees.filter((employee) => where.id.in.includes(employee.id) && !employee.archivedAt).map(({ id }) => ({ id })) },
    projectProduction: {
      updateMany: async (args) => { state.branchSyncs.push(args); return { count: 0 }; },
      findMany: async ({ where }) => state.existing.filter((row) => where.shootId.in.includes(row.shootId)).map((row) => ({ shootId: row.shootId })),
      createMany: async ({ data }) => { state.created.push(...data); state.existing.push(...data); return { count: data.length }; },
    },
  };
}

const started = (overrides = {}) => ({ id: "project-1", projectStatus: "Work in Progress - Pre & Production", productionManagerEmployeeId: 5, branchId: 3, ...overrides });
const shoots = [{ id: "shoot-1" }, { id: "shoot-2" }];

test("a started project with a Production Manager gets one production row per shoot", async () => {
  const client = fakeClient({ project: started(), shoots });
  assert.equal(await ensureProjectProduction(client, "project-1"), 2);
  assert.deepEqual(client.state.created, [
    { shootId: "shoot-1", salesProjectId: "project-1", branchId: 3, productionCoordinatorEmployeeId: null },
    { shootId: "shoot-2", salesProjectId: "project-1", branchId: 3, productionCoordinatorEmployeeId: null },
  ]);
});

test("the pre production coordinator is carried over once as the plan's starting coordinator", async () => {
  const client = fakeClient({
    project: started(),
    shoots: [
      { id: "shoot-1", preProduction: { productionCoordinatorEmployeeId: 9 } },
      // Pre production's column never had a foreign key, so it can name somebody who is gone.
      { id: "shoot-2", preProduction: { productionCoordinatorEmployeeId: 40 } },
      { id: "shoot-3", preProduction: { productionCoordinatorEmployeeId: 41 } },
      { id: "shoot-4", preProduction: null },
    ],
    employees: [{ id: 9 }, { id: 41, archivedAt: new Date() }],
  });
  await ensureProjectProduction(client, "project-1");
  assert.deepEqual(client.state.created.map((row) => [row.shootId, row.productionCoordinatorEmployeeId]), [
    ["shoot-1", 9], ["shoot-2", null], ["shoot-3", null], ["shoot-4", null],
  ]);
  // Once: a row that exists is never touched again, so a coordinator the manager changed stays changed.
  assert.equal(await ensureProjectProduction(client, "project-1"), 0);
});

test("rows are created idempotently: only the missing ones, and a second call makes none", async () => {
  const client = fakeClient({ project: started(), shoots, existing: [{ shootId: "shoot-1" }] });
  assert.equal(await ensureProjectProduction(client, "project-1"), 1);
  assert.deepEqual(client.state.created.map((row) => row.shootId), ["shoot-2"]);
  assert.equal(await ensureProjectProduction(client, "project-1"), 0);
});

test("no Production Manager, a Yet to Start project, or a deleted shoot raise nothing", async () => {
  assert.equal(await ensureProjectProduction(fakeClient({ project: started({ productionManagerEmployeeId: null }), shoots }), "project-1"), 0);
  assert.equal(await ensureProjectProduction(fakeClient({ project: started({ projectStatus: "Yet to Start" }), shoots }), "project-1"), 0);
  const client = fakeClient({ project: started(), shoots: [{ id: "shoot-1", deletedAt: new Date() }] });
  assert.equal(await ensureProjectProduction(client, "project-1"), 0);
  assert.equal(await ensureProjectProduction(fakeClient({ project: null }), "project-1"), 0);
});

test("existing rows follow the project's branch, including rows with no branch yet", async () => {
  const client = fakeClient({ project: started({ branchId: 4 }), shoots, existing: [{ shootId: "shoot-1" }, { shootId: "shoot-2" }] });
  await ensureProjectProduction(client, "project-1");
  assert.deepEqual(client.state.branchSyncs[0], {
    where: { salesProjectId: "project-1", OR: [{ branchId: null }, { branchId: { not: 4 } }] },
    data: { branchId: 4 },
  });
  const unbranched = fakeClient({ project: started({ branchId: null }), shoots });
  await ensureProjectProduction(unbranched, "project-1");
  assert.deepEqual(unbranched.state.branchSyncs[0].where, { salesProjectId: "project-1", branchId: { not: null } });
});
```

Append to `backend/test/project-pre-production.test.js`:

```js
test("pre production no longer takes a Production Coordinator - it lives on the production plan", () => {
  const parsed = preProductionUpdateSchema.safeParse({ productionCoordinatorEmployeeId: 9, reportingTime: "09:00" });
  assert.ok(parsed.success);
  assert.equal("productionCoordinatorEmployeeId" in parsed.data, false);
});
```

`frontend/test/pre-production-no-coordinator.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("the pre production form and read-back no longer ask for a Production Coordinator", () => {
  assert.doesNotMatch(read("constants/formPanelConfig.js"), /productionCoordinatorEmployeeId/);
  assert.doesNotMatch(read("components/project-management/PreProductionFormPanel.js"), /productionCoordinator/);
  const info = read("constants/infoPanelConfig.js");
  assert.doesNotMatch(info, /\["productionCoordinator", "Production Coordinator"\]/);
  // A different field, read from the project's assignment - left exactly as it was.
  assert.match(info, /\["productionCoordinator", "Assigned By \(Project Coordinator\)"\]/);
});
```

- [ ] **Step 2: Run to fail**

Run: `cd backend && node --test test/project-production-rows.test.js test/project-pre-production.test.js` and `cd frontend && node --test test/pre-production-no-coordinator.test.mjs`
Expected: FAIL — production module not found; the schema still keeps the key; the form still names the coordinator.

- [ ] **Step 3: Implement** `backend/src/modules/project-management/production/service.js`:

```js
/**
 * Raising production rows from the project side.
 *
 * The moment a started project has a Production Manager, every one of its shoots gets a production
 * record, so the plan reaches the manager without anybody creating it by hand. Modelled on
 * `ensureProjectPreProduction` and called from the same two places: saving the project (Start /
 * Edit Project, and Pre Production → General, which is where the manager is named) and adding
 * shoots to a project that has already started.
 *
 * The Production Coordinator used to be asked on pre production's shoot form. It lives on the
 * production plan now, and a row being raised carries pre production's answer over **once** as
 * the plan's starting coordinator. After that the plan is the only place it changes.
 */

/**
 * The rows whose copied branch no longer matches the project's. `{ not: n }` is `<> n` in SQL,
 * which never matches NULL, so a row with no branch yet is asked for separately.
 */
const branchDiffers = (branchId) => (branchId === null || branchId === undefined
  ? { branchId: { not: null } }
  : { OR: [{ branchId: null }, { branchId: { not: branchId } }] });

/**
 * Pre production's coordinators that can still be named: the column never had a foreign key, so
 * it may point at an employee who has since gone, and copying that id would fail the insert.
 */
async function carriedCoordinators(client, shoots) {
  const named = [...new Set(shoots.map((shoot) => shoot.preProduction?.productionCoordinatorEmployeeId).filter(Boolean))];
  if (!named.length) return new Set();
  const live = await client.employee.findMany({ where: { id: { in: named }, archivedAt: null }, select: { id: true } });
  return new Set(live.map((employee) => employee.id));
}

/**
 * Creates the missing production rows for a project's shoots, and returns how many it made.
 *
 * Safe to call on every save: a row that exists is never touched, apart from keeping its copied
 * branch equal to the project's so `dataScope` narrows it by the branch the project is in now.
 */
async function ensureProjectProduction(client, projectId) {
  const project = await client.salesProject.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, projectStatus: true, productionManagerEmployeeId: true, branchId: true },
  });
  if (!project) return 0;

  const branchId = project.branchId ?? null;
  await client.projectProduction.updateMany({ where: { salesProjectId: project.id, ...branchDiffers(branchId) }, data: { branchId } });

  // Only started projects, and only once somebody is named: assignment is what routes the work.
  if (project.projectStatus === "Yet to Start") return 0;
  if (!project.productionManagerEmployeeId) return 0;

  const shoots = await client.projectShoot.findMany({
    where: { projectId: project.id, deletedAt: null },
    select: { id: true, preProduction: { select: { productionCoordinatorEmployeeId: true } } },
  });
  if (!shoots.length) return 0;

  const existing = await client.projectProduction.findMany({
    where: { shootId: { in: shoots.map((shoot) => shoot.id) } },
    select: { shootId: true },
  });
  const known = new Set(existing.map((row) => row.shootId));
  const missing = shoots.filter((shoot) => !known.has(shoot.id));
  if (!missing.length) return 0;

  const live = await carriedCoordinators(client, missing);
  const result = await client.projectProduction.createMany({
    data: missing.map((shoot) => {
      const carried = shoot.preProduction?.productionCoordinatorEmployeeId || null;
      return { shootId: shoot.id, salesProjectId: project.id, branchId, productionCoordinatorEmployeeId: carried && live.has(carried) ? carried : null };
    }),
    skipDuplicates: true,
  });
  return result.count;
}

module.exports = { ensureProjectProduction };
```

- [ ] **Step 4: Hook it where pre-production rows are raised** in `backend/src/modules/sales/projects/controller.js`:

After line 10 add:
```js
const { ensureProjectProduction } = require("../../project-management/production/service");
```
After `await ensureProjectPreProduction(transaction, project.id, { userId });` (line ~3453) add:
```js
  // And the production board, on the same terms: raised once the project has a Production Manager,
  // which Pre Production → General assigns through this same save.
  await ensureProjectProduction(transaction, project.id);
```
After `await ensureProjectPreProduction(transaction, project.id, { userId: req.user.id });` in `createProjectShoots` (line ~3689) add:
```js
      await ensureProjectProduction(transaction, project.id);
```

- [ ] **Step 5: Take the coordinator off pre production (backend)** — in `backend/src/modules/project-management/pre-production/controller.js`:
  - delete the schema line `productionCoordinatorEmployeeId: z.coerce.number().int().positive().nullable().optional(),` (`:53`);
  - in `toRow` delete `productionCoordinator: record.productionCoordinator,` and `productionCoordinatorEmployeeId: record.productionCoordinatorEmployeeId,` (`:330-331`);
  - in `updateRow` change the destructure (`:477`) to `const { eventStartTime, eventEndTime, concepts, ...fields } = parsed.data;` and delete the whole `// Naming somebody resolves their name here …` block that writes `data.productionCoordinatorEmployeeId` / `data.productionCoordinator` (`:527-546`). `activeEmployeeStatuses` stays — `listOptions` still uses it.

- [ ] **Step 6: Take it off pre production (frontend)**
  - `frontend/src/constants/formPanelConfig.js`: delete the whole `{ id: "progress", title: "Status", fields: [ …productionCoordinatorEmployeeId… ] }` section (`:724-733`) — it held nothing else — and change the comment above `preProductionFormSectionsFor` to: `The form for one shoot: the shared sections, with the shoot's vertical checklist slotted in straight after Concepts. A vertical with no checklist (Corp, or an unset Product) gets the base form. The Production Coordinator is not asked here - it is named on the shoot's production plan.`
  - `frontend/src/components/project-management/PreProductionFormPanel.js`: delete `productionCoordinatorEmployeeId: row.productionCoordinatorEmployeeId ?? "",` (`:91`); delete the `productionCoordinators: …` entry from `context.options` (`:100-103`); change the destructure (`:123`) to `const { contextSummary, travelVehicleAssetId, concepts, ...values } = form;`; delete the `productionCoordinatorEmployeeId: …` line of the payload (`:133`).
  - `frontend/src/constants/infoPanelConfig.js:239`: remove `["productionCoordinator", "Production Coordinator"]` from `preProductionInfoSections`' People fields. Leave `:289` and `ProjectDataTable.js` alone.

- [ ] **Step 7: Run the tests**

Run: `cd backend && node --test test/project-production-rows.test.js test/project-pre-production.test.js test/pre-production-general.test.js` and `cd frontend && node --test test/pre-production-no-coordinator.test.mjs && npm run lint && npm test`
Expected: all pass. Open Pre Production → a shoot's form at 360px: no Status section, nothing else moved.

- [ ] **Step 8: Stage for review (do NOT commit — the user commits)**

```bash
git add backend/src/modules/project-management/production/service.js backend/src/modules/sales/projects/controller.js backend/src/modules/project-management/pre-production/controller.js backend/test/project-production-rows.test.js backend/test/project-pre-production.test.js frontend/src/constants/formPanelConfig.js frontend/src/components/project-management/PreProductionFormPanel.js frontend/src/constants/infoPanelConfig.js frontend/test/pre-production-no-coordinator.test.mjs
```

**Follow-up (not this change):** once every eligible shoot has its production row, a separate migration drops `project_pre_production.production_coordinator` and `production_coordinator_employee_id` (and the index on it), and the DEPRECATED comment goes with them.

---

### Task 4: Access — caller, named-person rights, board scope, activity log

**Files:**
- Create: `backend/src/modules/project-management/production/access.js`
- Create: `backend/src/modules/project-management/production/activity.js`
- Test: `backend/test/project-production-access.test.js`

**Interfaces:**
- Consumes: `dataScope.resolve`, `dataScope.bypassesHierarchy` (`backend/src/services/dataScope.service.js`).
- Produces:
  - `fail(status, message, code?) → Error` (with `.status`, `.code`)
  - `callerOf(userId, { client, scope }) → Promise<{ userId, name, employeeId, superAdmin }>`
  - `accessFor(production, caller) → { canEditPlan, canRunSteps }` (production needs `salesProject.productionManagerEmployeeId`, `productionCoordinatorEmployeeId`)
  - `boardWhere(userId, { scope }) → Promise<PrismaWhere>`
  - `liveWhere` (shoot and project not deleted), `WRITE_SELECT`, `loadForWrite(client, shootId) → Promise<production>` (404 when missing)
  - `logActivity(client, productionId, action, detail, caller) → Promise`

- [ ] **Step 1: Write the failing test** `backend/test/project-production-access.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { accessFor, boardWhere, callerOf, loadForWrite } = require("../src/modules/project-management/production/access");
const { logActivity } = require("../src/modules/project-management/production/activity");

const record = { productionCoordinatorEmployeeId: 9, salesProject: { productionManagerEmployeeId: 5 } };

test("being named decides who edits what", () => {
  assert.deepEqual(accessFor(record, { employeeId: 5, superAdmin: false }), { canEditPlan: true, canRunSteps: false });
  assert.deepEqual(accessFor(record, { employeeId: 9, superAdmin: false }), { canEditPlan: false, canRunSteps: true });
  assert.deepEqual(accessFor(record, { employeeId: 77, superAdmin: false }), { canEditPlan: false, canRunSteps: false });
  // A login with no employee is named on nothing - null never matches an unset seat.
  assert.deepEqual(accessFor({ productionCoordinatorEmployeeId: null, salesProject: { productionManagerEmployeeId: null } }, { employeeId: null, superAdmin: false }), { canEditPlan: false, canRunSteps: false });
  assert.deepEqual(accessFor(record, { employeeId: null, superAdmin: true }), { canEditPlan: true, canRunSteps: true });
});

test("the manager who is also the coordinator does both", () => {
  assert.deepEqual(accessFor({ productionCoordinatorEmployeeId: 5, salesProject: { productionManagerEmployeeId: 5 } }, { employeeId: 5, superAdmin: false }), { canEditPlan: true, canRunSteps: true });
});

test("an unlimited scope reads every row", async () => {
  const scope = { resolve: async () => ({ unlimited: true, where: {}, employeeIds: [] }) };
  assert.deepEqual(await boardWhere(1, { scope }), {});
});

test("a scoped viewer also gets the rows their own name is on as manager or team member", async () => {
  const calls = [];
  const scope = { resolve: async (args) => { calls.push(args); return { unlimited: false, where: { productionCoordinatorEmployeeId: { in: [9, 12] } }, employeeIds: [9, 12] }; } };
  assert.deepEqual(await boardWhere(21, { scope }), {
    OR: [
      { productionCoordinatorEmployeeId: { in: [9, 12] } },
      { salesProject: { productionManagerEmployeeId: { in: [9, 12] } } },
      { teamMembers: { some: { employeeId: { in: [9, 12] } } } },
    ],
  });
  assert.equal(calls[0].module, "PROJECT");
  assert.equal(calls[0].feature, "Production");
  assert.deepEqual(calls[0].columns, { branch: "branchId", employee: ["productionCoordinatorEmployeeId"] });
});

test("a viewer named on nothing gets only what the scope already says", async () => {
  const scope = { resolve: async () => ({ unlimited: false, where: { id: { in: [] } }, employeeIds: [] }) };
  assert.deepEqual(await boardWhere(21, { scope }), { OR: [{ id: { in: [] } }] });
});

test("the caller is the employee behind the login, and a Super Admin is asked of dataScope", async () => {
  const client = { user: { findUnique: async () => ({ id: 21, name: "Ravi", linkedEmployeeId: 9 }) } };
  const scope = { bypassesHierarchy: async (id) => id === 1 };
  assert.deepEqual(await callerOf(21, { client, scope }), { userId: 21, name: "Ravi", employeeId: 9, superAdmin: false });
  const admin = await callerOf(1, { client: { user: { findUnique: async () => ({ id: 1, name: "Owner", linkedEmployeeId: null }) } }, scope });
  assert.equal(admin.superAdmin, true);
});

test("a shoot with no live production record is not found", async () => {
  const client = { projectProduction: { findFirst: async () => null } };
  await assert.rejects(loadForWrite(client, "shoot-x"), (error) => error.status === 404);
});

test("an activity line records who did it at the time", async () => {
  const created = [];
  const client = { projectProductionActivity: { create: async ({ data }) => { created.push(data); return data; } } };
  await logActivity(client, "prod-1", "PLAN_SAVED", null, { userId: 20, name: "Meena" });
  assert.deepEqual(created, [{ productionId: "prod-1", action: "PLAN_SAVED", detail: null, userId: 20, userName: "Meena" }]);
});
```

- [ ] **Step 2: Run to fail**

Run: `cd backend && node --test test/project-production-access.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `backend/src/modules/project-management/production/access.js`:

```js
const prisma = require("../../../config/db");
const dataScope = require("../../../services/dataScope.service");

/**
 * Who may do what on a shoot's production record.
 *
 * The router's `requireModule("PROJECT", "Production")` decides whether somebody may read (READ)
 * or write (READ_WRITE) at all. Past that, **being named** decides which shoot a person may change:
 * the project's Production Manager edits the plan, the plan's Production Coordinator runs the
 * steps, everybody else with the permission reads. A Super Admin edits both (⚑ spec assumption),
 * asked of `dataScope.bypassesHierarchy` rather than of `req.user.role` in a controller.
 */
const PERMISSION = { module: "PROJECT", feature: "Production" };

const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

/** A shoot and a project that have not been deleted. */
const liveWhere = { shoot: { deletedAt: null }, salesProject: { deletedAt: null } };

async function callerOf(userId, { client = prisma, scope = dataScope } = {}) {
  const id = Number(userId) || 0;
  const [account, superAdmin] = await Promise.all([
    client.user.findUnique({ where: { id }, select: { id: true, name: true, linkedEmployeeId: true } }),
    scope.bypassesHierarchy(id),
  ]);
  return { userId: id, name: account?.name || `User ${id}`, employeeId: account?.linkedEmployeeId || null, superAdmin: Boolean(superAdmin) };
}

function accessFor(production, caller) {
  const me = caller?.employeeId || null;
  const managerId = production?.salesProject?.productionManagerEmployeeId ?? null;
  const coordinatorId = production?.productionCoordinatorEmployeeId ?? null;
  const superAdmin = Boolean(caller?.superAdmin);
  return {
    canEditPlan: superAdmin || (Boolean(me) && me === managerId),
    canRunSteps: superAdmin || (Boolean(me) && me === coordinatorId),
  };
}

/**
 * The rows a viewer's board holds: `dataScope` on the copied branch and the coordinator column,
 * plus every row their own name (or a report's) is on as the project's manager or on the team -
 * the two names `dataScope` cannot reach because they live on the project and on a join table.
 */
async function boardWhere(userId, { scope = dataScope } = {}) {
  const resolved = await scope.resolve({
    userId,
    ...PERMISSION,
    columns: { branch: "branchId", employee: ["productionCoordinatorEmployeeId"] },
  });
  if (resolved.unlimited) return {};
  const limbs = [resolved.where];
  if (resolved.employeeIds?.length) {
    limbs.push({ salesProject: { productionManagerEmployeeId: { in: resolved.employeeIds } } });
    limbs.push({ teamMembers: { some: { employeeId: { in: resolved.employeeIds } } } });
  }
  return { OR: limbs };
}

/** What every write needs to know about the record before it decides anything. */
const WRITE_SELECT = {
  id: true,
  shootId: true,
  currentStep: true,
  planSubmittedAt: true,
  shootStatus: true,
  productionCoordinatorEmployeeId: true,
  salesProject: { select: { productionManagerEmployeeId: true } },
};

async function loadForWrite(client, shootId) {
  const production = await client.projectProduction.findFirst({
    where: { shootId: String(shootId || ""), ...liveWhere },
    select: WRITE_SELECT,
  });
  if (!production) throw fail(404, "Production record not found.");
  return production;
}

module.exports = { PERMISSION, fail, liveWhere, callerOf, accessFor, boardWhere, WRITE_SELECT, loadForWrite };
```

And `backend/src/modules/project-management/production/activity.js`:

```js
/**
 * The production log, written in the same transaction as the change it records (WhatsApp results
 * are written right after the send). Read oldest first on the Activity tab.
 */
const ACTIONS = [
  "PLAN_SAVED", "PLAN_SUBMITTED", "STEP_COMPLETED", "SHOOT_STATUS_CHANGED",
  "FILE_ADDED", "FILE_REMOVED", "WHATSAPP_SENT", "WHATSAPP_FAILED", "WHATSAPP_RETRIED",
];

function logActivity(client, productionId, action, detail, caller) {
  return client.projectProductionActivity.create({
    data: { productionId, action, detail: detail ?? null, userId: caller?.userId || null, userName: String(caller?.name || "Unknown").slice(0, 191) },
  });
}

module.exports = { ACTIONS, logActivity };
```

- [ ] **Step 4: Run to pass**

Run: `cd backend && node --test test/project-production-access.test.js`
Expected: 8 passing.

- [ ] **Step 5: Stage for review (do NOT commit — the user commits)**

```bash
git add backend/src/modules/project-management/production/access.js backend/src/modules/project-management/production/activity.js backend/test/project-production-access.test.js
```

---

### Task 5: Reads — board rows, detail, options, activity

**Files:**
- Modify: `backend/src/modules/project-management/pre-production/controller.js:703` (export `travelModes`)
- Create: `backend/src/modules/project-management/production/read.js`
- Test: `backend/test/project-production-read.test.js`

**Interfaces:**
- Consumes: `callerOf`, `accessFor`, `boardWhere`, `liveWhere`, `fail` (Task 4); `pendingLabel`, `STEPS`, `STEP_TIME_FIELDS` (Task 2); `travelModes` (pre-production controller). `CAMERA_WHERE` is defined here and imported by Task 6's plan.js.
- Produces:
  - `toBoardRow(record, clientNames: Map, caller) → row` with `{ id, shootRecordId, projectId, eventId, clientName, shootId, shoot, shootDate, shootPlace, productionManagerEmployeeId, productionManager, productionCoordinatorEmployeeId, productionCoordinator, planSubmittedAt, currentStep, shootStatus, pending, mine, updatedAt }`
  - `toDetail(record, clientNames, caller) → row + { district, location, locationLink, reportingTime, whatsappGroupSubject, plan: { productionCoordinatorEmployeeId, productionCoordinator, team:[{id,name}], travelMode, cameras:[{id,name}], services:[{id,name}], exposureVendors:[{id,name}], remarks, planSubmittedAt, planSubmittedBy }, execution: { currentStep, stepTimes, pineappleRemarks, shootStatus, shootStatusRemarks, footageUrl, footageBackupByEmployeeId, footageBackupBy, footageRemarks }, stepLog: { [step]: { by, at } }, files:[{ id, kind, url, fileName, mimeType, uploadedBy, createdAt }], messages:[{ step, status, error, sentAt }], canEditPlan, canRunSteps }`
  - `listShoots(userId, deps)`, `getShoot(userId, shootId, deps)`, `listOptions(userId, shootId|null, deps) → { travelModes, employees, cameras, vendors, services }`, `listActivity(userId, shootId, deps)`
  - `CAMERA_WHERE` (asset `where` for cameras)

- [ ] **Step 1: Export the travel modes from pre-production** — in `backend/src/modules/project-management/pre-production/controller.js`, change the last line to:

```js
module.exports = { saveGeneral, storageOfProject, listRows, listOptions, updateRow, addProjectFollowup, completeProjectFollowup, progressStatuses, travelModes, preProductionUpdateSchema, followupCreateSchema, followupSummary, conceptList };
```

- [ ] **Step 2: Write the failing test** `backend/test/project-production-read.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { toBoardRow, toDetail } = require("../src/modules/project-management/production/read");

const base = (overrides = {}) => ({
  id: "prod-1",
  shootId: "shoot-1",
  productionCoordinatorEmployeeId: 9,
  productionCoordinatorEmployee: { employeeName: "Ravi" },
  planSubmittedAt: new Date("2026-09-30T04:00:00Z"),
  currentStep: "PINEAPPLE_MEETING",
  shootStatus: null,
  travelMode: "Train",
  remarks: "Carry rain covers",
  updatedAt: new Date("2026-09-30T05:00:00Z"),
  shoot: { id: "shoot-1", shootId: "DBS-SID-1", shoot: "Reception", dateCreated: new Date("2026-10-02T00:00:00Z"), shootPlace: "Erode", district: "Erode", preProduction: { locationAddress: "Hall A", locationLink: null, reportingTime: "08:00" } },
  salesProject: { id: "project-1", eventId: "DBS-EV-1", whatsappGroupName: "Asha weds Arun", whatsappGroupNameId: null, productionManager: "Old copy", productionManagerEmployeeId: 5, productionManagerEmployee: { employeeName: "Meena" }, whatsappGroupSubject: "Asha & Arun" },
  teamMembers: [{ employeeId: 12, employee: { employeeName: "Kavin" } }],
  cameras: [{ assetId: 3, asset: { assetName: "Sony A7", assetCode: "AST-3" } }],
  services: [
    { allocationId: "alloc-live", allocation: { serviceName: "Candid", deletedAt: null } },
    { allocationId: "alloc-gone", allocation: { serviceName: "Drone", deletedAt: new Date() } },
  ],
  exposureVendors: [{ vendorId: 4, vendor: { vendorName: "Lights Co" } }],
  files: [],
  messages: [{ step: "STARTED_FROM_STUDIO", status: "FAILED", error: "WhatsApp is not connected.", sentAt: null }],
  activities: [{ detail: "STARTED_FROM_STUDIO", userName: "Ravi", createdAt: new Date("2026-10-02T02:00:00Z") }],
  planSubmittedByUser: { name: "Meena" },
  footageBackupByEmployee: null,
  ...overrides,
});

test("a board row carries the pending pill and reads the manager's name through the link", () => {
  const row = toBoardRow(base(), new Map(), { employeeId: 77 });
  assert.equal(row.pending, "Step 3/7 · Pineapple meeting");
  assert.equal(row.productionManager, "Meena");
  assert.equal(row.clientName, "Asha weds Arun");
  assert.equal(row.mine, false);
});

test("My shoots means manager, coordinator or team member", () => {
  assert.equal(toBoardRow(base(), new Map(), { employeeId: 5 }).mine, true);
  assert.equal(toBoardRow(base(), new Map(), { employeeId: 9 }).mine, true);
  assert.equal(toBoardRow(base(), new Map(), { employeeId: 12 }).mine, true);
  assert.equal(toBoardRow(base(), new Map(), { employeeId: null }).mine, false);
});

test("a service Edit Project removed is dropped from the plan", () => {
  const detail = toDetail(base(), new Map(), { employeeId: 5, superAdmin: false });
  assert.deepEqual(detail.plan.services, [{ id: "alloc-live", name: "Candid" }]);
  assert.deepEqual(detail.plan.cameras, [{ id: 3, name: "Sony A7 (AST-3)" }]);
});

test("the detail says who may do what, and who finished each step", () => {
  const detail = toDetail(base(), new Map(), { employeeId: 9, superAdmin: false });
  assert.equal(detail.canEditPlan, false);
  assert.equal(detail.canRunSteps, true);
  assert.deepEqual(detail.stepLog.STARTED_FROM_STUDIO.by, "Ravi");
  assert.equal(detail.location, "Hall A");
  assert.equal(detail.messages[0].status, "FAILED");
});
```

- [ ] **Step 3: Run to fail**

Run: `cd backend && node --test test/project-production-read.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** `backend/src/modules/project-management/production/read.js`:

```js
const prisma = require("../../../config/db");
const { projectClientNames, clientNameOf } = require("../../../services/projectClientNames");
const { workingEmployeeStatuses } = require("../../../services/employeeOptionLists");
const { travelModes } = require("../pre-production/controller");
const { callerOf, accessFor, boardWhere, liveWhere, fail } = require("./access");
const S = require("./steps");

/** Asset Management's cameras still in circulation - what a plan may name. */
const CAMERA_CATEGORY_NAMES = ["Cameras"];
const CAMERA_WHERE = { isDeleted: false, status: { in: ["ACTIVE", "UNASSIGNED", "UNDER_REPAIR"] }, category: { name: { in: CAMERA_CATEGORY_NAMES } } };

const nameOnly = { select: { employeeName: true } };

const boardInclude = {
  shoot: { select: { id: true, shootId: true, shoot: true, dateCreated: true, shootPlace: true, district: true } },
  salesProject: { select: { id: true, eventId: true, whatsappGroupName: true, whatsappGroupNameId: true, productionManager: true, productionManagerEmployeeId: true, productionManagerEmployee: nameOnly } },
  productionCoordinatorEmployee: nameOnly,
  teamMembers: { select: { employeeId: true } },
};

const detailInclude = {
  ...boardInclude,
  shoot: { select: { ...boardInclude.shoot.select, preProduction: { select: { locationAddress: true, locationLink: true, reportingTime: true } } } },
  salesProject: { select: { ...boardInclude.salesProject.select, whatsappGroupSubject: true } },
  teamMembers: { select: { employeeId: true, employee: nameOnly } },
  planSubmittedByUser: { select: { name: true } },
  footageBackupByEmployee: nameOnly,
  cameras: { select: { assetId: true, asset: { select: { assetName: true, assetCode: true } } } },
  services: { select: { allocationId: true, allocation: { select: { serviceName: true, deletedAt: true } } } },
  exposureVendors: { select: { vendorId: true, vendor: { select: { vendorName: true } } } },
  files: { select: { id: true, kind: true, url: true, fileName: true, mimeType: true, createdAt: true, uploadedByUser: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
  messages: { select: { step: true, status: true, error: true, sentAt: true } },
  // Who finished each step is the STEP_COMPLETED line the step wrote; no column repeats it.
  activities: { where: { action: "STEP_COMPLETED" }, select: { detail: true, userName: true, createdAt: true }, orderBy: { createdAt: "asc" } },
};

function isMine(record, employeeId) {
  if (!employeeId) return false;
  return record.salesProject?.productionManagerEmployeeId === employeeId
    || record.productionCoordinatorEmployeeId === employeeId
    || (record.teamMembers || []).some((member) => member.employeeId === employeeId);
}

function toBoardRow(record, clientNames, caller) {
  const { shoot, salesProject: project } = record;
  return {
    id: record.id,
    shootRecordId: record.shootId,
    projectId: project.id,
    eventId: project.eventId,
    clientName: clientNameOf(project, clientNames),
    shootId: shoot.shootId,
    shoot: shoot.shoot,
    shootDate: shoot.dateCreated,
    shootPlace: shoot.shootPlace,
    productionManagerEmployeeId: project.productionManagerEmployeeId,
    // The linked name first; the copy only where nothing is linked (Rule 5).
    productionManager: project.productionManagerEmployee?.employeeName || project.productionManager || null,
    productionCoordinatorEmployeeId: record.productionCoordinatorEmployeeId,
    productionCoordinator: record.productionCoordinatorEmployee?.employeeName || null,
    planSubmittedAt: record.planSubmittedAt,
    currentStep: record.currentStep,
    shootStatus: record.shootStatus,
    pending: S.pendingLabel(record),
    mine: isMine(record, caller?.employeeId || null),
    updatedAt: record.updatedAt,
  };
}

function toDetail(record, clientNames, caller) {
  const access = accessFor(record, caller);
  const pre = record.shoot?.preProduction || null;
  const stepLog = {};
  for (const entry of record.activities || []) {
    if (entry.detail) stepLog[entry.detail] = { by: entry.userName, at: entry.createdAt };
  }
  return {
    ...toBoardRow(record, clientNames, caller),
    district: record.shoot.district,
    location: pre?.locationAddress || null,
    locationLink: pre?.locationLink || null,
    reportingTime: pre?.reportingTime || null,
    whatsappGroupSubject: record.salesProject.whatsappGroupSubject || null,
    plan: {
      productionCoordinatorEmployeeId: record.productionCoordinatorEmployeeId,
      productionCoordinator: record.productionCoordinatorEmployee?.employeeName || null,
      team: (record.teamMembers || []).map((member) => ({ id: member.employeeId, name: member.employee?.employeeName || null })),
      travelMode: record.travelMode,
      cameras: (record.cameras || []).map((camera) => ({ id: camera.assetId, name: camera.asset ? `${camera.asset.assetName} (${camera.asset.assetCode})` : null })),
      // Edit Project soft-deletes and re-creates every allocation on save, so a service it removed
      // is dropped here rather than shown as if it were still sold (Review Focus 3).
      services: (record.services || [])
        .filter((service) => service.allocation && !service.allocation.deletedAt)
        .map((service) => ({ id: service.allocationId, name: service.allocation.serviceName })),
      exposureVendors: (record.exposureVendors || []).map((link) => ({ id: link.vendorId, name: link.vendor?.vendorName || null })),
      remarks: record.remarks,
      planSubmittedAt: record.planSubmittedAt,
      planSubmittedBy: record.planSubmittedByUser?.name || null,
    },
    execution: {
      currentStep: record.currentStep,
      stepTimes: Object.fromEntries(S.STEPS.map((step) => [step, record[S.STEP_TIME_FIELDS[step]] || null])),
      pineappleRemarks: record.pineappleRemarks || null,
      shootStatus: record.shootStatus,
      shootStatusRemarks: record.shootStatusRemarks || null,
      footageUrl: record.footageUrl || null,
      footageBackupByEmployeeId: record.footageBackupByEmployeeId || null,
      footageBackupBy: record.footageBackupByEmployee?.employeeName || null,
      footageRemarks: record.footageRemarks || null,
    },
    stepLog,
    files: (record.files || []).map((file) => ({ id: file.id, kind: file.kind, url: file.url, fileName: file.fileName, mimeType: file.mimeType, uploadedBy: file.uploadedByUser?.name || null, createdAt: file.createdAt })),
    messages: (record.messages || []).map((message) => ({ step: message.step, status: message.status, error: message.error, sentAt: message.sentAt })),
    canEditPlan: access.canEditPlan,
    canRunSteps: access.canRunSteps,
  };
}

async function listShoots(userId, { client = prisma, scope } = {}) {
  const [caller, where] = await Promise.all([callerOf(userId, { client, scope }), boardWhere(userId, { scope })]);
  const records = await client.projectProduction.findMany({
    where: { ...liveWhere, AND: [where] },
    include: boardInclude,
    orderBy: [{ shoot: { dateCreated: "asc" } }, { createdAt: "asc" }],
  });
  const clientNames = await projectClientNames(records.map((record) => record.salesProject));
  return records.map((record) => toBoardRow(record, clientNames, caller));
}

/** One shoot, if it is on this viewer's board. Keyed by the shoot's internal id. */
async function getShoot(userId, shootId, { client = prisma, scope } = {}) {
  const [caller, where] = await Promise.all([callerOf(userId, { client, scope }), boardWhere(userId, { scope })]);
  const record = await client.projectProduction.findFirst({ where: { shootId: String(shootId || ""), ...liveWhere, AND: [where] }, include: detailInclude });
  if (!record) throw fail(404, "Production record not found.");
  const clientNames = await projectClientNames([record.salesProject]);
  return toDetail(record, clientNames, caller);
}

/**
 * The plan form's vocabulary. Vendors are read here rather than from `/api/vendors/options`, which
 * answers to ASSET permissions a production role need not hold - and returns vocabulary, not vendors.
 */
async function listOptions(userId, shootId, { client = prisma, scope, statuses = workingEmployeeStatuses } = {}) {
  let services = [];
  if (shootId) {
    const where = await boardWhere(userId, { scope });
    const production = await client.projectProduction.findFirst({ where: { shootId: String(shootId), ...liveWhere, AND: [where] }, select: { shootId: true } });
    if (!production) throw fail(404, "Production record not found.");
    services = await client.projectPostProductionAllocation.findMany({
      where: { shootId: production.shootId, deletedAt: null },
      select: { id: true, serviceName: true, serviceDetails: true },
      orderBy: { createdAt: "asc" },
    });
  }
  const [employees, cameras, vendors] = await Promise.all([
    client.employee.findMany({ where: { archivedAt: null, employmentStatus: { in: await statuses() } }, select: { id: true, employeeId: true, employeeName: true }, orderBy: { employeeName: "asc" } }),
    client.asset.findMany({ where: CAMERA_WHERE, select: { id: true, assetCode: true, assetName: true }, orderBy: { assetName: "asc" } }),
    client.vendor.findMany({ where: { isDeleted: false, status: "ACTIVE" }, select: { id: true, vendorId: true, vendorName: true, vendorType: true }, orderBy: { vendorName: "asc" }, take: 500 }),
  ]);
  return { travelModes, employees, cameras, vendors, services };
}

/** The log, oldest first, for anybody who can see the shoot. */
async function listActivity(userId, shootId, { client = prisma, scope } = {}) {
  const where = await boardWhere(userId, { scope });
  const production = await client.projectProduction.findFirst({ where: { shootId: String(shootId || ""), ...liveWhere, AND: [where] }, select: { id: true } });
  if (!production) throw fail(404, "Production record not found.");
  return client.projectProductionActivity.findMany({
    where: { productionId: production.id },
    select: { id: true, action: true, detail: true, userName: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

module.exports = { CAMERA_WHERE, toBoardRow, toDetail, listShoots, getShoot, listOptions, listActivity };
```

- [ ] **Step 5: Run to pass**

Run: `cd backend && node --test test/project-production-read.test.js test/project-pre-production.test.js`
Expected: all pass.

- [ ] **Step 6: Stage for review (do NOT commit — the user commits)**

```bash
git add backend/src/modules/project-management/production/read.js backend/src/modules/project-management/pre-production/controller.js backend/test/project-production-read.test.js
```

---

### Task 6: Saving and submitting the plan

**Files:**
- Create: `backend/test/production-fake-client.js` (shared by Tasks 6, 10, 11, 14)
- Create: `backend/src/modules/project-management/production/plan.js`
- Test: `backend/test/project-production-plan.test.js`

**Interfaces:**
- Consumes: `loadForWrite`, `accessFor`, `fail` (Task 4), `logActivity` (Task 4), `CAMERA_WHERE` (Task 5).
- Produces: `savePlan(shootId, input, caller, deps) → Promise<productionId>`; `input` = `{ submit?, productionCoordinatorEmployeeId?, teamEmployeeIds?, travelMode?, cameraAssetIds?, serviceAllocationIds?, exposureVendorIds?, remarks? }` (already zod-parsed); `createProductionFake(seed)` for tests.

- [ ] **Step 1: Write the shared fake client** `backend/test/production-fake-client.js` (not a `.test.js`, like `signature-album-fake-repository.js`):

```js
/*
 * An in-memory stand-in for the Prisma calls the production module makes, so its tests run
 * without MySQL. It honours only the parts of each `where` the module relies on: ids, the shoot,
 * the current step, soft-deletion, the Cameras category, active vendors and active employees.
 */
function createProductionFake({ productions = [], employees = [], assets = [], allocations = [], vendors = [], files = [], messages = [], projects = [] } = {}) {
  const state = {
    productions: productions.map((row) => ({ currentStep: "STARTED_FROM_STUDIO", planSubmittedAt: null, shootStatus: null, productionCoordinatorEmployeeId: null, ...row })),
    files: files.map((file) => ({ ...file })),
    messages: messages.map((message) => ({ ...message })),
    activities: [],
    links: { team: [], camera: [], service: [], vendor: [] },
    projects,
  };
  let sequence = 0;
  const nextId = (prefix) => `${prefix}-${++sequence}`;
  const idsIn = (where) => where?.id?.in || [];
  const byId = (id) => state.productions.find((row) => row.id === id);
  const links = (bucket) => ({
    deleteMany: async ({ where }) => { state.links[bucket] = state.links[bucket].filter((link) => link.productionId !== where.productionId); return { count: 0 }; },
    createMany: async ({ data }) => { state.links[bucket].push(...data); return { count: data.length }; },
  });

  const client = {
    state,
    $transaction: async (work) => work(client),
    projectProduction: {
      findFirst: async ({ where }) => state.productions.find((row) => row.shootId === where.shootId) || null,
      findUnique: async ({ where }) => byId(where.id) || null,
      update: async ({ where, data }) => Object.assign(byId(where.id), data),
      updateMany: async ({ where, data }) => {
        const rows = state.productions.filter((row) => row.id === where.id && (where.currentStep === undefined || row.currentStep === where.currentStep));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
    projectProductionFile: {
      count: async ({ where }) => state.files.filter((file) => file.productionId === where.productionId && (!where.kind || file.kind === where.kind)).length,
      findFirst: async ({ where }) => state.files.find((file) => file.id === where.id && file.productionId === where.productionId) || null,
      createMany: async ({ data }) => { data.forEach((file) => state.files.push({ id: nextId("file"), ...file })); return { count: data.length }; },
      delete: async ({ where }) => state.files.splice(state.files.findIndex((file) => file.id === where.id), 1)[0],
    },
    projectProductionActivity: { create: async ({ data }) => { state.activities.push(data); return data; } },
    projectProductionMessage: {
      upsert: async ({ where, create, update }) => {
        const key = where.productionId_step;
        const row = state.messages.find((message) => message.productionId === key.productionId && message.step === key.step);
        if (row) return Object.assign(row, update);
        state.messages.push({ ...create });
        return create;
      },
      updateMany: async ({ where, data }) => {
        const rows = state.messages.filter((message) => message.productionId === where.productionId && message.step === where.step && message.status === where.status);
        rows.forEach((message) => Object.assign(message, data));
        return { count: rows.length };
      },
    },
    projectProductionTeamMember: links("team"),
    projectProductionCamera: links("camera"),
    projectProductionService: links("service"),
    projectProductionExposureVendor: links("vendor"),
    employee: {
      findMany: async ({ where }) => employees.filter((employee) => idsIn(where).includes(employee.id) && employee.active !== false).map(({ id }) => ({ id })),
      findFirst: async ({ where }) => employees.find((employee) => employee.id === where.id && employee.active !== false) || null,
    },
    asset: { findMany: async ({ where }) => assets.filter((asset) => idsIn(where).includes(asset.id) && asset.category === "Cameras" && !asset.isDeleted).map(({ id }) => ({ id })) },
    projectPostProductionAllocation: { findMany: async ({ where }) => allocations.filter((allocation) => idsIn(where).includes(allocation.id) && allocation.shootId === where.shootId && !allocation.deletedAt).map(({ id }) => ({ id })) },
    vendor: { findMany: async ({ where }) => vendors.filter((vendor) => idsIn(where).includes(vendor.id) && vendor.status === "ACTIVE" && !vendor.isDeleted).map(({ id }) => ({ id })) },
    messageTemplate: { findUnique: async () => null },
    salesProject: {
      findFirst: async ({ where }) => {
        if (where.whatsappGroupJid) return projects.find((project) => project.whatsappGroupJid === where.whatsappGroupJid && project.id !== where.id?.not && !project.deletedAt) || null;
        return projects.find((project) => project.id === where.id && !project.deletedAt) || null;
      },
      update: async ({ where, data }) => Object.assign(projects.find((project) => project.id === where.id), data),
    },
  };
  return client;
}

/** One shoot's production record as the module reads it, with everything a message needs. */
function productionRow(overrides = {}) {
  return {
    id: "prod-1",
    shootId: "shoot-1",
    currentStep: "STARTED_FROM_STUDIO",
    planSubmittedAt: new Date("2026-09-30T04:00:00Z"),
    shootStatus: null,
    productionCoordinatorEmployeeId: 9,
    salesProject: { productionManagerEmployeeId: 5, eventId: "DBS-EV-1", whatsappGroupName: "Asha weds Arun", whatsappGroupJid: "120363012345678901@g.us", whatsappGroupLinkedByUserId: 30 },
    shoot: { shoot: "Reception", dateCreated: new Date("2026-10-02T00:00:00Z"), shootPlace: "Erode", district: "Erode", preProduction: null },
    productionCoordinatorEmployee: { employeeName: "Ravi" },
    ...overrides,
  };
}

const manager = { userId: 20, name: "Meena", employeeId: 5, superAdmin: false };
const coordinator = { userId: 21, name: "Ravi", employeeId: 9, superAdmin: false };
const stranger = { userId: 22, name: "Guest", employeeId: 77, superAdmin: false };
const superAdmin = { userId: 1, name: "Owner", employeeId: null, superAdmin: true };

module.exports = { createProductionFake, productionRow, manager, coordinator, stranger, superAdmin };
```

- [ ] **Step 2: Write the failing test** `backend/test/project-production-plan.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { savePlan } = require("../src/modules/project-management/production/plan");
const { createProductionFake, productionRow, manager, coordinator } = require("./production-fake-client");

const statuses = async () => ["Active"];
const seed = (overrides = {}) => createProductionFake({
  productions: [productionRow({ planSubmittedAt: null, productionCoordinatorEmployeeId: null, ...overrides })],
  employees: [{ id: 9 }, { id: 12 }, { id: 13 }, { id: 40, active: false }],
  assets: [{ id: 3, category: "Cameras" }, { id: 4, category: "Lenses" }],
  allocations: [{ id: "alloc-1", shootId: "shoot-1" }, { id: "alloc-other", shootId: "shoot-2" }, { id: "alloc-gone", shootId: "shoot-1", deletedAt: new Date() }],
  vendors: [{ id: 7, status: "ACTIVE" }, { id: 8, status: "INACTIVE" }],
});
const deps = (client) => ({ client, statuses, now: () => new Date("2026-09-30T06:00:00Z") });

test("only the project's Production Manager edits the plan", async () => {
  const client = seed();
  await assert.rejects(savePlan("shoot-1", { remarks: "x" }, coordinator, deps(client)), (error) => error.status === 403);
});

test("a draft saves without a coordinator, and is logged", async () => {
  const client = seed();
  await savePlan("shoot-1", { travelMode: "Train", remarks: "Carry rain covers" }, manager, deps(client));
  assert.equal(client.state.productions[0].travelMode, "Train");
  assert.equal(client.state.productions[0].planSubmittedAt, null);
  assert.equal(client.state.activities.at(-1).action, "PLAN_SAVED");
});

test("submitting needs a Production Coordinator", async () => {
  const client = seed();
  await assert.rejects(savePlan("shoot-1", { submit: true }, manager, deps(client)), (error) => error.status === 400 && /Coordinator/.test(error.message));
});

test("submitting stamps the plan once and logs PLAN_SUBMITTED; later saves log PLAN_SAVED", async () => {
  const client = seed();
  await savePlan("shoot-1", { submit: true, productionCoordinatorEmployeeId: 9 }, manager, deps(client));
  const row = client.state.productions[0];
  assert.equal(row.productionCoordinatorEmployeeId, 9);
  assert.deepEqual(row.planSubmittedAt, new Date("2026-09-30T06:00:00Z"));
  assert.equal(row.planSubmittedByUserId, 20);
  assert.equal(client.state.activities.at(-1).action, "PLAN_SUBMITTED");
  await savePlan("shoot-1", { submit: true, remarks: "Changed" }, manager, deps(client));
  assert.equal(client.state.activities.at(-1).action, "PLAN_SAVED");
});

test("a submitted plan cannot lose its coordinator", async () => {
  const client = seed({ planSubmittedAt: new Date(), productionCoordinatorEmployeeId: 9 });
  await assert.rejects(savePlan("shoot-1", { productionCoordinatorEmployeeId: null }, manager, deps(client)), (error) => error.status === 400);
});

test("services from another shoot are rejected", async () => {
  const client = seed();
  await assert.rejects(savePlan("shoot-1", { serviceAllocationIds: ["alloc-1", "alloc-other"] }, manager, deps(client)), (error) => error.status === 400 && /shoot/.test(error.message));
});

test("a soft-deleted service is rejected", async () => {
  const client = seed();
  await assert.rejects(savePlan("shoot-1", { serviceAllocationIds: ["alloc-gone"] }, manager, deps(client)), (error) => error.status === 400);
});

test("cameras must come from the Cameras category, vendors must be active, team must be active employees", async () => {
  await assert.rejects(savePlan("shoot-1", { cameraAssetIds: [4] }, manager, deps(seed())), (error) => error.status === 400);
  await assert.rejects(savePlan("shoot-1", { exposureVendorIds: [8] }, manager, deps(seed())), (error) => error.status === 400);
  await assert.rejects(savePlan("shoot-1", { teamEmployeeIds: [12, 40] }, manager, deps(seed())), (error) => error.status === 400);
});

test("the lists are replaced whole and duplicates are dropped", async () => {
  const client = seed();
  await savePlan("shoot-1", { teamEmployeeIds: [12, 13, 12], cameraAssetIds: [3], serviceAllocationIds: ["alloc-1"], exposureVendorIds: [7] }, manager, deps(client));
  assert.deepEqual(client.state.links.team, [{ productionId: "prod-1", employeeId: 12 }, { productionId: "prod-1", employeeId: 13 }]);
  assert.deepEqual(client.state.links.camera, [{ productionId: "prod-1", assetId: 3 }]);
  assert.deepEqual(client.state.links.service, [{ productionId: "prod-1", allocationId: "alloc-1" }]);
  assert.deepEqual(client.state.links.vendor, [{ productionId: "prod-1", vendorId: 7 }]);
  await savePlan("shoot-1", { teamEmployeeIds: [] }, manager, deps(client));
  assert.deepEqual(client.state.links.team, []);
});
```

- [ ] **Step 3: Run to fail**

Run: `cd backend && node --test test/project-production-plan.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** `backend/src/modules/project-management/production/plan.js`:

```js
const prisma = require("../../../config/db");
const { workingEmployeeStatuses } = require("../../../services/employeeOptionLists");
const { accessFor, loadForWrite, fail } = require("./access");
const { logActivity } = require("./activity");
const { CAMERA_WHERE } = require("./read");

/**
 * The Production Manager's plan for one shoot: save a draft, or submit it. Submitting needs a
 * Production Coordinator and is what opens the coordinator's steps; after that the manager can
 * still change the plan, and each save is logged.
 *
 * Every id in the body is checked here, never trusted: employees must be working, cameras must be
 * in the Cameras category, services must be **this shoot's** live allocations, vendors must be
 * active. A list that is sent replaces the whole list; one that is left out is not touched.
 */
const unique = (values = []) => [...new Set(values)];

async function activeEmployees(tx, ids, label, statuses) {
  const wanted = unique(ids);
  if (!wanted.length) return [];
  const found = await tx.employee.findMany({ where: { id: { in: wanted }, archivedAt: null, employmentStatus: { in: await statuses() } }, select: { id: true } });
  if (found.length !== wanted.length) throw fail(400, `Select only active employees for ${label}.`);
  return wanted;
}

async function replaceLinks(delegate, productionId, column, ids) {
  await delegate.deleteMany({ where: { productionId } });
  if (ids.length) await delegate.createMany({ data: ids.map((id) => ({ productionId, [column]: id })) });
}

async function savePlan(shootId, input, caller, deps = {}) {
  const { client = prisma, now = () => new Date(), statuses = workingEmployeeStatuses } = deps;
  return client.$transaction(async (tx) => {
    const production = await loadForWrite(tx, shootId);
    if (!accessFor(production, caller).canEditPlan) throw fail(403, "Only this project's Production Manager can change the plan.");

    const data = {};
    const changed = [];
    if (input.productionCoordinatorEmployeeId !== undefined) {
      if (input.productionCoordinatorEmployeeId === null) {
        if (production.planSubmittedAt) throw fail(400, "A submitted plan must keep a Production Coordinator.");
        data.productionCoordinatorEmployeeId = null;
      } else {
        [data.productionCoordinatorEmployeeId] = await activeEmployees(tx, [input.productionCoordinatorEmployeeId], "Production Coordinator", statuses);
      }
      changed.push("coordinator");
    }
    if (input.travelMode !== undefined) { data.travelMode = input.travelMode; changed.push("travel mode"); }
    if (input.remarks !== undefined) { data.remarks = input.remarks || null; changed.push("remarks"); }

    const coordinator = data.productionCoordinatorEmployeeId !== undefined ? data.productionCoordinatorEmployeeId : production.productionCoordinatorEmployeeId;
    const submitting = Boolean(input.submit) && !production.planSubmittedAt;
    if (submitting && !coordinator) throw fail(400, "Choose a Production Coordinator before submitting the plan.");
    if (submitting) Object.assign(data, { planSubmittedAt: now(), planSubmittedByUserId: caller.userId || null });
    if (Object.keys(data).length) await tx.projectProduction.update({ where: { id: production.id }, data });

    if (input.teamEmployeeIds !== undefined) {
      await replaceLinks(tx.projectProductionTeamMember, production.id, "employeeId", await activeEmployees(tx, input.teamEmployeeIds, "the production team", statuses));
      changed.push("team");
    }
    if (input.cameraAssetIds !== undefined) {
      const ids = unique(input.cameraAssetIds);
      if (ids.length) {
        const found = await tx.asset.findMany({ where: { id: { in: ids }, ...CAMERA_WHERE }, select: { id: true } });
        if (found.length !== ids.length) throw fail(400, "Choose cameras from Asset Management's Cameras category.");
      }
      await replaceLinks(tx.projectProductionCamera, production.id, "assetId", ids);
      changed.push("cameras");
    }
    if (input.serviceAllocationIds !== undefined) {
      const ids = unique(input.serviceAllocationIds);
      if (ids.length) {
        const found = await tx.projectPostProductionAllocation.findMany({ where: { id: { in: ids }, shootId: production.shootId, deletedAt: null }, select: { id: true } });
        if (found.length !== ids.length) throw fail(400, "One or more services are not this shoot's.");
      }
      await replaceLinks(tx.projectProductionService, production.id, "allocationId", ids);
      changed.push("services");
    }
    if (input.exposureVendorIds !== undefined) {
      const ids = unique(input.exposureVendorIds);
      if (ids.length) {
        const found = await tx.vendor.findMany({ where: { id: { in: ids }, isDeleted: false, status: "ACTIVE" }, select: { id: true } });
        if (found.length !== ids.length) throw fail(400, "Choose active vendors for exposure.");
      }
      await replaceLinks(tx.projectProductionExposureVendor, production.id, "vendorId", ids);
      changed.push("exposure");
    }

    await logActivity(tx, production.id, submitting ? "PLAN_SUBMITTED" : "PLAN_SAVED", changed.length ? `Changed: ${changed.join(", ")}` : null, caller);
    return production.id;
  });
}

module.exports = { savePlan };
```

- [ ] **Step 5: Run to pass**

Run: `cd backend && node --test test/project-production-plan.test.js`
Expected: 8 passing.

- [ ] **Step 6: Stage for review (do NOT commit — the user commits)**

```bash
git add backend/src/modules/project-management/production/plan.js backend/test/production-fake-client.js backend/test/project-production-plan.test.js
```

---

### Task 7: Controller, router, mount

**Files:**
- Create: `backend/src/modules/project-management/production/controller.js`
- Create: `backend/src/modules/project-management/production/routes.js`
- Modify: `backend/src/server.js:66` (require) and `:381` (mount)
- Test: `backend/test/project-production-routes.test.js`

**Interfaces:**
- Consumes: `read.*` (Task 5), `savePlan` (Task 6), `callerOf` (Task 4), `travelModes`.
- Produces HTTP: `GET /api/project-management/production/options?shootId=`, `GET /shoots`, `GET /shoots/:shootId`, `GET /shoots/:shootId/activity`, `PATCH /shoots/:shootId/plan` → `{ data: detail }`. Exports `planSchema` for later tasks' reuse pattern.

- [ ] **Step 1: Write the failing test** `backend/test/project-production-routes.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "project-management", "production", "routes.js"), "utf8");
const SERVER = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");

test("the production router is signed-in and guarded by PROJECT / Production before any route", () => {
  const protectAt = ROUTES.indexOf("router.use(protect)");
  const guardAt = ROUTES.indexOf('router.use(requireModule("PROJECT", "Production"))');
  const firstRoute = ROUTES.search(/router\.(get|post|patch|delete)\(/);
  assert.ok(protectAt > -1 && guardAt > protectAt && firstRoute > guardAt);
  // No role check decides access in this module (CLAUDE.md Rule 4).
  assert.doesNotMatch(ROUTES, /req\.user\.role/);
});

test("the router is mounted under /api/project-management/production", () => {
  assert.match(SERVER, /app\.use\("\/api\/project-management\/production", projectProductionRoutes\)/);
});

test("the controller never reads req.user.role", () => {
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "project-management", "production", "controller.js"), "utf8");
  assert.doesNotMatch(controller, /req\.user\.role/);
});

test("the plan body is strict: an unknown key is refused rather than written", () => {
  const { planSchema } = require("../src/modules/project-management/production/controller");
  assert.equal(planSchema.safeParse({ remarks: "x", planSubmittedAt: "2026-01-01" }).success, false);
  assert.equal(planSchema.safeParse({ travelMode: "Rocket" }).success, false);
  assert.ok(planSchema.safeParse({ submit: true, productionCoordinatorEmployeeId: 9, teamEmployeeIds: [1, 2], travelMode: "Train", serviceAllocationIds: ["a"] }).success);
});
```

- [ ] **Step 2: Run to fail**

Run: `cd backend && node --test test/project-production-routes.test.js`
Expected: FAIL — ENOENT for routes.js.

- [ ] **Step 3: Implement** `backend/src/modules/project-management/production/controller.js`:

```js
const { z } = require("zod");
const read = require("./read");
const { savePlan } = require("./plan");
const { callerOf } = require("./access");
const { travelModes } = require("../pre-production/controller");

/*
 * The production board's HTTP edge: parse the body with zod (strict - an unknown key is refused,
 * so nothing a browser invents reaches Prisma), hand it to the service with the caller, and answer
 * with the shoot as it now stands. Who may change what is decided in the services by being named.
 */

const optionalText = z.string().trim().max(5000).nullable().optional();
const idList = z.array(z.coerce.number().int().positive()).max(50);

const planSchema = z.object({
  submit: z.boolean().optional(),
  productionCoordinatorEmployeeId: z.coerce.number().int().positive().nullable().optional(),
  teamEmployeeIds: idList.optional(),
  travelMode: z.enum(travelModes).nullable().optional(),
  cameraAssetIds: idList.optional(),
  serviceAllocationIds: z.array(z.string().trim().min(1).max(191)).max(50).optional(),
  exposureVendorIds: idList.optional(),
  remarks: optionalText,
}).strict();

function respond(res, error, fallback) {
  if (error?.status) return res.status(error.status).json({ message: error.message, ...(error.code ? { code: error.code } : {}) });
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
}
const invalid = (res, parsed) => res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });

async function listShoots(req, res) {
  try { return res.json({ data: await read.listShoots(req.user.id) }); } catch (error) { return respond(res, error, "Unable to load production shoots."); }
}

async function getShoot(req, res) {
  try { return res.json({ data: await read.getShoot(req.user.id, req.params.shootId) }); } catch (error) { return respond(res, error, "Unable to load this shoot."); }
}

async function listOptions(req, res) {
  try {
    const shootId = typeof req.query.shootId === "string" && req.query.shootId ? req.query.shootId : null;
    return res.json({ data: await read.listOptions(req.user.id, shootId) });
  } catch (error) { return respond(res, error, "Unable to load the production form options."); }
}

async function listActivity(req, res) {
  try { return res.json({ data: await read.listActivity(req.user.id, req.params.shootId) }); } catch (error) { return respond(res, error, "Unable to load the activity."); }
}

async function savePlanRoute(req, res) {
  const parsed = planSchema.safeParse(req.body || {});
  if (!parsed.success) return invalid(res, parsed);
  try {
    await savePlan(req.params.shootId, parsed.data, await callerOf(req.user.id));
    return res.json({ data: await read.getShoot(req.user.id, req.params.shootId) });
  } catch (error) { return respond(res, error, "Unable to save the plan."); }
}

module.exports = { planSchema, respond, invalid, listShoots, getShoot, listOptions, listActivity, savePlan: savePlanRoute };
```

`backend/src/modules/project-management/production/routes.js`:

```js
const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");

const router = express.Router();
router.use(protect);

/*
 * The production board answers for PROJECT / Production, which already exists in the catalogue.
 * `requireModule` reads GET at READ and everything else at READ_WRITE, and covers any route added
 * below the moment it is written. Past the guard, being named on the shoot decides who may change
 * it - the project's Production Manager the plan, the plan's Production Coordinator the steps -
 * and that is checked in the services against the record, never by role here.
 */
router.use(requireModule("PROJECT", "Production"));

router.get("/options", controller.listOptions);
router.get("/shoots", controller.listShoots);
router.get("/shoots/:shootId", controller.getShoot);
router.get("/shoots/:shootId/activity", controller.listActivity);
router.patch("/shoots/:shootId/plan", controller.savePlan);

module.exports = router;
```

In `backend/src/server.js`, after line 66 (`projectPreProductionRoutes` require) add:
```js
const projectProductionRoutes = require("./modules/project-management/production/routes");
```
and after line 381 (`app.use("/api/project-management/pre-production", …)`) add:
```js
app.use("/api/project-management/production", projectProductionRoutes);
```

- [ ] **Step 4: Run to pass, then the whole backend suite**

Run: `cd backend && node --test test/project-production-routes.test.js && npm test`
Expected: 4 passing; full suite green.

- [ ] **Step 5: Stage for review (do NOT commit — the user commits)**

```bash
git add backend/src/modules/project-management/production/controller.js backend/src/modules/project-management/production/routes.js backend/src/server.js backend/test/project-production-routes.test.js
```

---

### Task 8: Frontend step and plan helpers, API service

**Files:**
- Create: `frontend/src/lib/productionSteps.mjs`
- Create: `frontend/src/lib/productionPlan.mjs`
- Create: `frontend/src/services/project-management/production.service.js`
- Test: `frontend/test/production-steps.test.mjs`, `frontend/test/production-plan.test.mjs`

**Interfaces:**
- Consumes: backend detail shape (Task 5).
- Produces:
  - `productionSteps.mjs`: `PRODUCTION_STEPS: [id,label][]`, `SHOOT_STATUS_OPTIONS`, `MESSAGE_STEP_FOR`, `MESSAGE_LABELS`, `ACTIVITY_LABELS`, `PRODUCTION_MESSAGE_PLACEHOLDERS`, `stepIndex(step)`, `stepLabel(step)`, `formatDay(value)`, `formatWhen(value)`, `stepNotes(stepLog)`, `activityText(entry)`, `messageFor(messages, messageStep)`.
  - `productionPlan.mjs`: `productionPlanForm(detail)`, `productionPlanPayload(form, submit)`, `productionPlanOptions(options, detail)`.
  - Service: `getProductionShoots()`, `getProductionShoot(shootId)`, `getProductionOptions(shootId)`, `getProductionActivity(shootId)`, `saveProductionPlan(shootId, data)`, `addProductionFiles(shootId, kind, files)`, `removeProductionFile(shootId, fileId)`, `completeProductionStep(shootId, step, data)`, `changeProductionShootStatus(shootId, data)`, `retryProductionMessage(shootId, step)`.

- [ ] **Step 1: Write the failing tests**

`frontend/test/production-steps.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { PRODUCTION_STEPS, MESSAGE_STEP_FOR, stepIndex, stepLabel, stepNotes, activityText, messageFor } from "../src/lib/productionSteps.mjs";

test("the rail's steps match the server's order", () => {
  assert.deepEqual(PRODUCTION_STEPS.map(([id]) => id), ["STARTED_FROM_STUDIO", "REACHED_SHOOT_PLACE", "PINEAPPLE_MEETING", "SHOOT_STARTED", "SHOOT_STATUS", "REACHED_STUDIO", "PHOTO_COPY"]);
  assert.equal(stepIndex("PINEAPPLE_MEETING"), 2);
  assert.equal(stepIndex("DONE"), 7);
  assert.equal(stepLabel("SHOOT_STATUS"), "Shoot status");
});

test("a finished step carries who finished it", () => {
  const notes = stepNotes({ STARTED_FROM_STUDIO: { by: "Ravi", at: "2026-10-02T02:00:00Z" } });
  assert.match(notes.STARTED_FROM_STUDIO, /^✓ Ravi · /);
  assert.equal(notes.REACHED_SHOOT_PLACE, undefined);
});

test("the log reads as sentences", () => {
  assert.equal(activityText({ action: "STEP_COMPLETED", detail: "PINEAPPLE_MEETING" }), "Step completed: Pineapple meeting");
  assert.equal(activityText({ action: "PLAN_SUBMITTED", detail: null }), "Plan submitted");
  assert.equal(activityText({ action: "WHATSAPP_FAILED", detail: "Started from studio: not connected" }), "WhatsApp not sent: Started from studio: not connected");
});

test("the Completed status is the step that sends the shoot-completed message", () => {
  assert.equal(MESSAGE_STEP_FOR.SHOOT_STATUS, "SHOOT_COMPLETED");
  assert.deepEqual(messageFor([{ step: "SHOOT_COMPLETED", status: "SENT" }], "SHOOT_COMPLETED"), { step: "SHOOT_COMPLETED", status: "SENT" });
  assert.equal(messageFor([], "SHOOT_COMPLETED"), null);
});
```

`frontend/test/production-plan.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { productionPlanForm, productionPlanPayload, productionPlanOptions } from "../src/lib/productionPlan.mjs";

const detail = {
  plan: {
    productionCoordinatorEmployeeId: 9, productionCoordinator: "Ravi",
    team: [{ id: 12, name: "Kavin" }], travelMode: "Train",
    cameras: [{ id: 3, name: "Sony A7 (AST-3)" }], services: [{ id: "alloc-1", name: "Candid" }],
    exposureVendors: [{ id: 7, name: "Lights Co" }], remarks: "Rain covers",
  },
};

test("the form holds every id as a string, the way the pickers compare them", () => {
  assert.deepEqual(productionPlanForm(detail), {
    productionCoordinatorEmployeeId: "9", teamEmployeeIds: ["12"], travelMode: "Train",
    cameraAssetIds: ["3"], serviceAllocationIds: ["alloc-1"], exposureVendorIds: ["7"], remarks: "Rain covers",
  });
  assert.equal(productionPlanForm(null).productionCoordinatorEmployeeId, "");
});

test("the payload turns them back into what the server validates", () => {
  const payload = productionPlanPayload(productionPlanForm(detail), true);
  assert.deepEqual(payload, {
    submit: true, productionCoordinatorEmployeeId: 9, teamEmployeeIds: [12], travelMode: "Train",
    cameraAssetIds: [3], serviceAllocationIds: ["alloc-1"], exposureVendorIds: [7], remarks: "Rain covers",
  });
  assert.equal(productionPlanPayload({ ...productionPlanForm(null) }, false).productionCoordinatorEmployeeId, null);
});

test("a chosen value missing from today's list still shows its name", () => {
  const options = productionPlanOptions({ employees: [{ id: 12, employeeName: "Kavin", employeeId: "E12" }], cameras: [], services: [], vendors: [] }, detail);
  assert.deepEqual(options.employees.map((option) => option.value), ["12", "9"]);
  assert.equal(options.cameras[0].label, "Sony A7 (AST-3)");
  assert.equal(options.employees[0].label, "Kavin (E12)");
});
```

- [ ] **Step 2: Run to fail**

Run: `cd frontend && node --test test/production-steps.test.mjs test/production-plan.test.mjs`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement** `frontend/src/lib/productionSteps.mjs`:

```js
/**
 * The production steps as the screens name them. The order is the server's
 * (backend/src/modules/project-management/production/steps.js) and is repeated here only because
 * the browser cannot import the backend; the server stays the authority on what may happen next.
 */
export const PRODUCTION_STEPS = [
  ["STARTED_FROM_STUDIO", "Started from studio"],
  ["REACHED_SHOOT_PLACE", "Reached shoot place"],
  ["PINEAPPLE_MEETING", "Pineapple meeting"],
  ["SHOOT_STARTED", "Shoot started"],
  ["SHOOT_STATUS", "Shoot status"],
  ["REACHED_STUDIO", "Reached studio"],
  ["PHOTO_COPY", "Photo copy"],
];

export const SHOOT_STATUS_OPTIONS = [
  { value: "PAUSED", label: "Paused" },
  { value: "HOLD", label: "Hold" },
  { value: "REJECT", label: "Reject" },
  { value: "COMPLETED", label: "Completed" },
];

/** Which step sends which WhatsApp message. */
export const MESSAGE_STEP_FOR = { STARTED_FROM_STUDIO: "STARTED_FROM_STUDIO", REACHED_SHOOT_PLACE: "REACHED_SHOOT_PLACE", SHOOT_STATUS: "SHOOT_COMPLETED" };
export const MESSAGE_LABELS = { STARTED_FROM_STUDIO: "Started from studio", REACHED_SHOOT_PLACE: "Reached shoot place", SHOOT_COMPLETED: "Shoot completed" };

export const ACTIVITY_LABELS = {
  PLAN_SAVED: "Plan saved",
  PLAN_SUBMITTED: "Plan submitted",
  STEP_COMPLETED: "Step completed",
  SHOOT_STATUS_CHANGED: "Shoot status changed",
  FILE_ADDED: "File added",
  FILE_REMOVED: "File removed",
  WHATSAPP_SENT: "WhatsApp sent",
  WHATSAPP_FAILED: "WhatsApp not sent",
  WHATSAPP_RETRIED: "WhatsApp retried",
};

/** What each placeholder of the three production messages is filled with (Settings → Templates). */
export const PRODUCTION_MESSAGE_PLACEHOLDERS = {
  "project name": "The project's WhatsApp group name, or its Event ID",
  shoot: "The shoot's name, as Reception",
  date: "The shoot's date, as 02 Oct 2026",
  location: "Pre production's location, or the shoot place, with the district",
  coordinator: "The Production Coordinator named in the plan",
};

export function stepIndex(step) {
  if (step === "DONE") return PRODUCTION_STEPS.length;
  const index = PRODUCTION_STEPS.findIndex(([id]) => id === step);
  return index < 0 ? 0 : index;
}

export const stepLabel = (step) => PRODUCTION_STEPS.find(([id]) => id === step)?.[1] || step;

export function formatDay(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function formatWhen(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

/** "✓ Ravi · 02 Oct, 07:30" under each finished step on the rail. */
export function stepNotes(stepLog = {}) {
  return Object.fromEntries(Object.entries(stepLog || {}).map(([id, entry]) => [id, `✓ ${entry?.by || "—"} · ${formatWhen(entry?.at)}`]));
}

export function activityText(entry) {
  const label = ACTIVITY_LABELS[entry.action] || entry.action;
  if (entry.action === "STEP_COMPLETED") return `${label}: ${stepLabel(entry.detail)}`;
  return entry.detail ? `${label}: ${entry.detail}` : label;
}

export const messageFor = (messages = [], messageStep) => (messages || []).find((message) => message.step === messageStep) || null;
```

`frontend/src/lib/productionPlan.mjs`:

```js
/**
 * The plan form's values and options. Ids are held as strings because `Dropdown` and
 * `MultiSelectField` compare values with `===` against option values, and turned back into numbers
 * (allocation ids stay strings) only for the request.
 */
const ids = (list = []) => (list || []).map((item) => String(item.id));
const numbers = (values = []) => values.map(Number);
const asOption = (value, label) => ({ value: String(value), label: String(label || value) });

export function productionPlanForm(detail) {
  const plan = detail?.plan || {};
  return {
    productionCoordinatorEmployeeId: plan.productionCoordinatorEmployeeId ? String(plan.productionCoordinatorEmployeeId) : "",
    teamEmployeeIds: ids(plan.team),
    travelMode: plan.travelMode || "",
    cameraAssetIds: ids(plan.cameras),
    serviceAllocationIds: ids(plan.services),
    exposureVendorIds: ids(plan.exposureVendors),
    remarks: plan.remarks || "",
  };
}

export function productionPlanPayload(form, submit) {
  return {
    submit: Boolean(submit),
    productionCoordinatorEmployeeId: form.productionCoordinatorEmployeeId === "" ? null : Number(form.productionCoordinatorEmployeeId),
    teamEmployeeIds: numbers(form.teamEmployeeIds),
    travelMode: form.travelMode || null,
    cameraAssetIds: numbers(form.cameraAssetIds),
    serviceAllocationIds: form.serviceAllocationIds,
    exposureVendorIds: numbers(form.exposureVendorIds),
    remarks: String(form.remarks || "").trim() || null,
  };
}

/** Today's lists, plus anything the plan already names that has since left them. */
function withChosen(list, chosen = []) {
  const seen = new Set(list.map((option) => option.value));
  return [...list, ...(chosen || []).filter((item) => item && !seen.has(String(item.id))).map((item) => asOption(item.id, item.name))];
}

export function productionPlanOptions(options = {}, detail = null) {
  const plan = detail?.plan || {};
  const coordinator = plan.productionCoordinatorEmployeeId ? [{ id: plan.productionCoordinatorEmployeeId, name: plan.productionCoordinator }] : [];
  const employees = (options?.employees || []).map((employee) => asOption(employee.id, `${employee.employeeName}${employee.employeeId ? ` (${employee.employeeId})` : ""}`));
  return {
    employees: withChosen(employees, [...coordinator, ...(plan.team || [])]),
    travelModes: options?.travelModes || [],
    cameras: withChosen((options?.cameras || []).map((asset) => asOption(asset.id, `${asset.assetName} (${asset.assetCode})`)), plan.cameras),
    services: withChosen((options?.services || []).map((service) => asOption(service.id, service.serviceName)), plan.services),
    vendors: withChosen((options?.vendors || []).map((vendor) => asOption(vendor.id, vendor.vendorName)), plan.exposureVendors),
  };
}
```

`frontend/src/services/project-management/production.service.js`:

```js
import { apiRequest } from "@/services/api/client";

/*
 * The production board. `shootId` is always the shoot's internal id, not its DBS-SID code. Who may
 * change a shoot is the server's to decide (by being named on it); these only carry the request.
 */
const BASE = "/api/project-management/production";
const shootPath = (shootId) => `${BASE}/shoots/${encodeURIComponent(shootId)}`;

/** The board: one row per production record the viewer may see. */
export function getProductionShoots() {
  return apiRequest(`${BASE}/shoots`);
}

/** One shoot in full, with `canEditPlan` and `canRunSteps` for the viewer. */
export function getProductionShoot(shootId) {
  return apiRequest(shootPath(shootId));
}

/** Employees, travel modes, cameras, vendors and - for a shoot - its services. */
export function getProductionOptions(shootId) {
  return apiRequest(`${BASE}/options${shootId ? `?shootId=${encodeURIComponent(shootId)}` : ""}`);
}

/** The shoot's log, oldest first. */
export function getProductionActivity(shootId) {
  return apiRequest(`${shootPath(shootId)}/activity`);
}

/** Save the plan; `submit: true` submits it. Answers with the shoot. */
export function saveProductionPlan(shootId, data) {
  return apiRequest(`${shootPath(shootId)}/plan`, { method: "PATCH", body: JSON.stringify(data) });
}

/** Add tickets (`TICKET`) or photos (`PINEAPPLE_GROUP`, `HAPPENING_NOW`): `files` is `[{ name, data }]`. */
export function addProductionFiles(shootId, kind, files) {
  return apiRequest(`${shootPath(shootId)}/files`, { method: "POST", body: JSON.stringify({ kind, files }) });
}

export function removeProductionFile(shootId, fileId) {
  return apiRequest(`${shootPath(shootId)}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
}

/** Complete the current step. Answers `{ data: shoot, message }`, `message` being the WhatsApp result. */
export function completeProductionStep(shootId, step, data = {}) {
  return apiRequest(`${shootPath(shootId)}/steps/${encodeURIComponent(step)}`, { method: "POST", body: JSON.stringify(data) });
}

/** `{ status, remarks }`; Completed opens Reached studio and sends the shoot-completed message. */
export function changeProductionShootStatus(shootId, data) {
  return apiRequest(`${shootPath(shootId)}/shoot-status`, { method: "PATCH", body: JSON.stringify(data) });
}

/** Send a failed step message once more. */
export function retryProductionMessage(shootId, step) {
  return apiRequest(`${shootPath(shootId)}/messages/${encodeURIComponent(step)}/retry`, { method: "POST" });
}
```

- [ ] **Step 4: Run to pass**

Run: `cd frontend && node --test test/production-steps.test.mjs test/production-plan.test.mjs`
Expected: 7 passing.

- [ ] **Step 5: Stage for review (do NOT commit — the user commits)**

```bash
git add frontend/src/lib/productionSteps.mjs frontend/src/lib/productionPlan.mjs frontend/src/services/project-management/production.service.js frontend/test/production-steps.test.mjs frontend/test/production-plan.test.mjs
```

---

### Task 9: The shoot board and the Plan tab

**Files:**
- Create: `frontend/src/constants/productionFormConfig.js`
- Create: `frontend/src/components/data-table/RecordCardList.js` (the board's phone view; `DataTable` has no card mode)
- Create: `frontend/src/components/project-management/production/ProductionPage.js`
- Create: `frontend/src/components/project-management/production/ProductionPendingPill.js`
- Create: `frontend/src/components/project-management/production/ProductionShootPanel.js` (Plan-only; Task 13 replaces it with the three-tab version)
- Modify: `frontend/src/app/(app)/project-management/production/page.js`
- Modify: `frontend/src/components/project-management/ProjectWorkflowModulePage.js:31-39` (drop the `production` rule)
- Test: `frontend/test/production-page-wiring.test.mjs`

**Interfaces:**
- Consumes: service (Task 8), `productionPlanForm/Payload/Options` (Task 8), `useRouteAccess` (`components/auth/PermissionsProvider.js:129`), `DataTable`, `DataTableShell`, `TableFooter`, `ModulePageHeader`, `FloatingNotice`/`useNotice`, `IconButton`, `OptionsMenu`, `useCompactView`, `useStickyTab`, `SchemaFormPanel`, `MultiSelectField`, `Button`, `useSubmitOnce`.
- Produces: `<ProductionShootPanel shootId canWrite onClose onChanged(message) />`, `<ProductionPendingPill label />`, `productionPlanSections`, `<RecordCardList items getKey onOpen renderTitle renderMeta renderBadge loading loadingMessage emptyMessage ariaLabel />`.

**Phone first.** Build and check this task at 360px before widening: cards below `md`, the panel full-screen, one-column plan, 44px buttons.

- [ ] **Step 1: Write the failing wiring test** `frontend/test/production-page-wiring.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("the production route renders the shoot board, not the old project list", () => {
  const page = read("app/(app)/project-management/production/page.js");
  assert.match(page, /ProductionPage/);
  assert.doesNotMatch(page, /ProjectWorkflowModulePage/);
  assert.doesNotMatch(read("components/project-management/ProjectWorkflowModulePage.js"), /\bproduction: \{/);
});

test("the board asks the route what it may do and passes it to the panel", () => {
  const board = read("components/project-management/production/ProductionPage.js");
  assert.match(board, /useRouteAccess\(\)/);
  assert.match(board, /canWrite=\{canWrite\}/);
});

test("the board is cards on a phone and the table from md up", () => {
  const board = read("components/project-management/production/ProductionPage.js");
  assert.match(board, /RecordCardList/);
  assert.match(board, /md:hidden/);
  assert.match(board, /hidden min-h-0 flex-1 md:flex/);
});

test("the plan is one column and its buttons are thumb-sized", () => {
  const config = read("constants/productionFormConfig.js");
  assert.equal((config.match(/columns: 1/g) || []).length, 5);
  assert.match(read("components/project-management/production/ProductionShootPanel.js"), /size="lg"/);
});

test("module components type no raw controls (Rule 1)", () => {
  for (const file of fs.readdirSync(new URL("../src/components/project-management/production/", import.meta.url))) {
    const source = read(`components/project-management/production/${file}`);
    assert.doesNotMatch(source, /<(button|input|select|textarea|table)\b/, file);
    assert.doesNotMatch(source, /role="dialog"/, file);
  }
});
```

- [ ] **Step 2: Run to fail**

Run: `cd frontend && node --test test/production-page-wiring.test.mjs`
Expected: FAIL — page still renders `ProjectWorkflowModulePage`.

- [ ] **Step 3: Write the plan sections** `frontend/src/constants/productionFormConfig.js`:

```js
/*
 * The Production Manager's plan for one shoot. The multi-pickers are `custom` fields drawn by the
 * panel's renderers (`MultiSelectField`), because the schema renderer has no multi-select type.
 * Nothing is marked required: a draft saves half-filled, and the server alone refuses a submit
 * without a Production Coordinator. Every section is one column (`columns: 1`): the manager fills
 * this on a phone, and one column is what a phone shows anyway.
 */
export const productionPlanSections = [
  {
    id: "people",
    title: "People",
    columns: 1,
    fields: [
      { name: "productionCoordinatorEmployeeId", label: "Production Coordinator", type: "select", options: "employees", placeholder: "Select employee", props: { searchable: true } },
      { name: "teamEmployeeIds", type: "custom", colSpan: 2 },
    ],
  },
  {
    id: "travel",
    title: "Travel",
    columns: 1,
    fields: [
      { name: "travelMode", label: "Travel Mode", type: "select", options: "travelModes", placeholder: "Select travel mode" },
    ],
  },
  {
    id: "equipment",
    title: "Cameras & Services",
    columns: 1,
    fields: [
      { name: "cameraAssetIds", type: "custom", colSpan: 2 },
      { name: "serviceAllocationIds", type: "custom", colSpan: 2 },
    ],
  },
  { id: "exposure", title: "Exposure", columns: 1, fields: [{ name: "exposureVendorIds", type: "custom", colSpan: 2 }] },
  { id: "remarks", title: "Remarks", columns: 1, fields: [{ name: "remarks", label: "Remarks", type: "textarea", colSpan: 2, placeholder: "Anything the crew should know" }] },
];
```

- [ ] **Step 4: Write the pill** `frontend/src/components/project-management/production/ProductionPendingPill.js`:

```jsx
/** What a shoot is waiting on, as one short pill - the board's last column and the panel header. */
const TONES = {
  "Plan pending": "bg-amber-50 text-amber-800 ring-amber-200",
  Done: "bg-green-50 text-green-700 ring-green-200",
  Paused: "bg-slate-100 text-slate-700 ring-slate-300",
  Hold: "bg-slate-100 text-slate-700 ring-slate-300",
  Rejected: "bg-red-50 text-red-700 ring-red-200",
};

export default function ProductionPendingPill({ label }) {
  return <span className={`inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${TONES[label] || "bg-blue-50 text-blue-700 ring-blue-200"}`}>{label || "—"}</span>;
}
```

- [ ] **Step 5: Write the Plan-only panel** `frontend/src/components/project-management/production/ProductionShootPanel.js`:

```jsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import Button from "@/components/shared/Button";
import MultiSelectField from "@/components/shared/MultiSelectField";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import { productionPlanSections } from "@/constants/productionFormConfig";
import { productionPlanForm, productionPlanOptions, productionPlanPayload } from "@/lib/productionPlan.mjs";
import { formatDay } from "@/lib/productionSteps.mjs";
import { getProductionOptions, getProductionShoot, saveProductionPlan } from "@/services/project-management/production.service";

/**
 * One shoot's production, opened from the board.
 *
 * What the viewer may do comes from two answers together: `canWrite` (the route's permission,
 * READ_WRITE) and the shoot's own `canEditPlan` from the API (being this project's Production
 * Manager). Opened by double-click or from the row menu alike, the panel asks them itself rather
 * than trusting the control that opened it. Anybody else reads the plan, filled in and read-only.
 */
export default function ProductionShootPanel({ shootId, canWrite, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState(() => productionPlanForm(null));
  const [error, setError] = useState("");
  const { busy, run } = useSubmitOnce();
  const update = useCallback((field, value) => setForm((current) => ({ ...current, [field]: value })), []);

  const load = useCallback(async () => {
    try {
      const [shootResponse, optionsResponse] = await Promise.all([getProductionShoot(shootId), getProductionOptions(shootId)]);
      setDetail(shootResponse?.data || null);
      setForm(productionPlanForm(shootResponse?.data));
      setOptions(optionsResponse?.data || null);
    } catch (loadError) {
      setError(loadError.message || "Unable to load this shoot.");
    }
  }, [shootId]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const planEditable = Boolean(canWrite && detail?.canEditPlan);

  const applyDetail = useCallback((next, message) => {
    if (!next) return;
    setDetail(next);
    setForm(productionPlanForm(next));
    onChanged?.(message);
  }, [onChanged]);

  const context = useMemo(() => {
    const lists = productionPlanOptions(options || {}, detail);
    const multi = (label, list, placeholder) => ({ values, onChange, field }) => <MultiSelectField
      label={label}
      options={list}
      values={values[field.name] || []}
      onChange={onChange}
      placeholder={placeholder}
      searchable
      readOnly={!planEditable}
    />;
    return {
      options: { employees: lists.employees, travelModes: lists.travelModes },
      renderers: {
        teamEmployeeIds: multi("Production Team", lists.employees, "Select team members"),
        cameraAssetIds: multi("Cameras", lists.cameras, "Select cameras (optional)"),
        serviceAllocationIds: multi("Services", lists.services, "Select this shoot's services"),
        exposureVendorIds: multi("Exposure", lists.vendors, "Select vendors"),
      },
    };
  }, [detail, options, planEditable]);

  async function submit(event) {
    event.preventDefault();
    if (!planEditable) return;
    // Which of the two footer buttons submitted the form: Save draft or Submit plan.
    const submitting = event.nativeEvent?.submitter?.value === "submit";
    await run(async () => {
      setError("");
      try {
        const response = await saveProductionPlan(shootId, productionPlanPayload(form, submitting));
        applyDetail(response?.data, submitting ? "Plan submitted." : "Plan saved.");
      } catch (saveError) {
        setError(saveError.message || "Unable to save the plan.");
      }
    });
  }

  const submitted = Boolean(detail?.plan?.planSubmittedAt);
  const footer = <>
    <Button className="max-sm:flex-1" size="lg" type="button" onClick={onClose} disabled={busy}>Close</Button>
    {planEditable && <Button className="ml-auto max-sm:flex-1" size="lg" type="submit" value="save" busy={busy} busyLabel="Saving...">{submitted ? "Save" : "Save draft"}</Button>}
    {planEditable && !submitted && <Button className="max-sm:flex-1" size="lg" type="submit" value="submit" variant="primary" busy={busy} busyLabel="Submitting...">Submit plan</Button>}
  </>;

  const title = detail ? `${detail.shootId || "Shoot"} — ${detail.shoot || "Production"}` : "Production";
  const description = detail ? [detail.clientName || detail.eventId, formatDay(detail.shootDate), detail.pending].filter(Boolean).join(" · ") : undefined;

  return <SchemaFormPanel
    title={title}
    description={description}
    loading={!detail && !error}
    loadingLabel="Loading shoot..."
    readOnly={!planEditable}
    sections={productionPlanSections}
    values={form}
    onChange={update}
    context={context}
    sidebarAriaLabel="Production plan sections"
    closeAriaLabel="Close production shoot"
    onClose={onClose}
    onSubmit={submit}
    validateRequired={false}
    error={error}
    saving={busy}
    footer={footer}
  />;
}
```

- [ ] **Step 6a: Write the card list** `frontend/src/components/data-table/RecordCardList.js` (reusable: any board can show its rows as cards below `md`):

```jsx
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";

/**
 * A table's rows as tappable cards, for a phone, where a wide table is a sideways scroll nobody can
 * read. `DataTable` has no card mode of its own, so a board renders this below `md` and its table
 * from `md` up, from the same rows. Each card is one 44px-plus tap target that opens the row; there
 * is nothing on a card that only appears on hover.
 */
export default function RecordCardList({ items = [], getKey, onOpen, renderTitle, renderMeta, renderBadge, loading = false, loadingMessage = "Loading...", emptyMessage = "Nothing here yet.", ariaLabel }) {
  if (loading && !items.length) return <Loader label={loadingMessage} className="p-6" />;
  if (!items.length) return <p className="p-4 text-sm text-slate-500">{emptyMessage}</p>;
  return <ul aria-label={ariaLabel} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-3">
    {items.map((item) => <li key={getKey(item)}>
      <Button type="button" variant="plain" size="none" onClick={() => onOpen(item)} className="flex min-h-11 w-full flex-col items-stretch gap-1 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm active:bg-slate-50">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-semibold text-slate-900">{renderTitle(item)}</span>
          {renderBadge && <span className="shrink-0">{renderBadge(item)}</span>}
        </span>
        {renderMeta && <span className="text-xs text-slate-600">{renderMeta(item)}</span>}
      </Button>
    </li>)}
  </ul>;
}
```

- [ ] **Step 6: Write the board** `frontend/src/components/project-management/production/ProductionPage.js`:

```jsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import RecordCardList from "@/components/data-table/RecordCardList";
import TableFooter from "@/components/data-table/TableFooter";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import IconButton from "@/components/shared/IconButton";
import useCompactView from "@/components/shared/useCompactView";
import useStickyTab from "@/components/shared/useStickyTab";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";
import ProductionPendingPill from "@/components/project-management/production/ProductionPendingPill";
import ProductionShootPanel from "@/components/project-management/production/ProductionShootPanel";
import { formatDay } from "@/lib/productionSteps.mjs";
import { getProductionShoots } from "@/services/project-management/production.service";

/*
 * The production board: one row per shoot of a started project that has a Production Manager.
 * "My Shoots" is the shoots the viewer's own name is on - as the project's manager, the plan's
 * coordinator, or on its team - which the server marks on each row (`mine`).
 *
 * Phone first: the manager and the coordinator open this at the venue. Below `md` the rows are
 * cards (shoot, client, date, the pending pill) and a tap opens the shoot full-screen; the table,
 * its filters and its export are the desktop view of the same rows.
 */
const tabs = ["All", "My Shoots"];
const text = (value) => (value === null || value === undefined || value === "" ? "—" : String(value));

const columns = [
  { id: "eventId", label: "Event ID" },
  { id: "clientName", label: "Client Name" },
  { id: "shootId", label: "Shoot ID" },
  { id: "shoot", label: "Shoot" },
  { id: "shootDate", label: "Shoot Date", type: "date" },
  { id: "productionManager", label: "Production Manager" },
  { id: "productionCoordinator", label: "Production Coordinator" },
  { id: "pending", label: "Pending" },
  { id: "actions", label: "Actions", fixed: true, sortable: false, filterable: false },
];

const displayValue = (row, column) => (column.type === "date" ? formatDay(row[column.id]) || "—" : text(row[column.id]));
const sortValue = (row, column) => (column.type === "date" ? new Date(row[column.id] || 0).getTime() || 0 : String(row[column.id] ?? "").toLocaleLowerCase());

export default function ProductionPage() {
  const { canWrite } = useRouteAccess();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useStickyTab("production-board", "All", tabs);
  const [openShootId, setOpenShootId] = useState(null);
  const [tableStats, setTableStats] = useState({ total: 0 });
  const [lastUpdated, setLastUpdated] = useState(null);
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();
  const { toggleCompact, density } = useCompactView("production-board");

  const loadRows = useCallback(async ({ notifyOnError = true } = {}) => {
    setLoading(true);
    try {
      const response = await getProductionShoots();
      setRows(Array.isArray(response?.data) ? response.data : []);
      setLastUpdated(new Date());
      return true;
    } catch (error) {
      if (notifyOnError) showError(error.message || "Unable to load production shoots.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => { const timer = window.setTimeout(() => { void loadRows(); }, 0); return () => window.clearTimeout(timer); }, [loadRows]);

  const tabRows = useMemo(() => (activeTab === "My Shoots" ? rows.filter((row) => row.mine) : rows), [activeTab, rows]);
  const tabCounts = useMemo(() => ({ All: rows.length, "My Shoots": rows.filter((row) => row.mine).length }), [rows]);

  const tableColumns = useMemo(() => columns.map((column) => ({
    ...column,
    header: column.label,
    accessorFn: (row) => displayValue(row, column),
    sortingFn: (first, second) => {
      const a = sortValue(first.original, column);
      const b = sortValue(second.original, column);
      return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true });
    },
    cell: column.id === "actions"
      ? ({ row }) => <OptionsMenu ariaLabel={`Actions for ${row.original.shootId}`} items={[{ label: "Open", onSelect: () => setOpenShootId(row.original.shootRecordId) }]} />
      : column.id === "pending"
        ? ({ row }) => <ProductionPendingPill label={row.original.pending} />
        : ({ row }) => displayValue(row.original, column),
    exportValue: (row) => displayValue(row, column),
    width: column.id === "actions" ? 56 : 180,
    minWidth: column.id === "actions" ? 56 : 140,
  })), []);

  async function refresh() {
    clearNotice();
    if (await loadRows({ notifyOnError: false })) showNotice("Production shoots refreshed.");
    else showError("Unable to refresh production shoots.");
  }

  const updatedText = lastUpdated ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(lastUpdated) : "—";

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader
      title="Production"
      tabs={tabs.map((tab) => ({ id: tab, label: tab, count: tabCounts[tab] || 0 }))}
      tabValue={activeTab}
      onTabChange={setActiveTab}
      tabsAriaLabel="Production shoot filters"
      actions={<IconButton onClick={() => void refresh()} label="Refresh production shoots">↻</IconButton>}
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <div className="flex min-h-0 flex-1 flex-col md:hidden">
      <RecordCardList
        items={tabRows}
        getKey={(row) => row.id}
        onOpen={(row) => setOpenShootId(row.shootRecordId)}
        renderTitle={(row) => `${row.shoot || "Shoot"} · ${row.clientName || row.eventId || ""}`}
        renderMeta={(row) => [formatDay(row.shootDate) || "No date", row.productionCoordinator ? `Coordinator: ${row.productionCoordinator}` : "No coordinator yet"].join(" · ")}
        renderBadge={(row) => <ProductionPendingPill label={row.pending} />}
        loading={loading}
        loadingMessage="Loading production shoots..."
        emptyMessage="No production shoots yet. A shoot appears here once its project has started and has a Production Manager."
        ariaLabel="Production shoots"
      />
    </div>
    <div className="hidden min-h-0 flex-1 md:flex md:flex-col">
      <DataTableShell className="h-full min-h-0" footer={<TableFooter spread><span>Last updated: {updatedText}</span><span>Total rows: {tableStats.total}</span></TableFooter>}>
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <DataTable
            key={activeTab}
            columns={tableColumns}
            data={tabRows}
            density={density}
            onToggleCompact={toggleCompact}
            loading={loading}
            loadingMessage="Loading production shoots..."
            emptyMessage="No production shoots yet. A shoot appears here once its project has started and has a Production Manager."
            noMatchMessage="No matching shoots found."
            onRowDoubleClick={(row) => setOpenShootId(row.shootRecordId)}
            onVisibleRowsChange={setTableStats}
            ariaLabel="Production shoots table"
            features={{
              filtering: true,
              sorting: true,
              columnVisibility: true,
              infiniteScroll: { pageSize: 50 },
              csvExport: { enabled: true, fileName: "production-shoots", onResult: (exported) => (exported ? showSuccess("Production CSV export downloaded.") : showNotice("No rows available to export.")) },
            }}
          />
        </div>
      </DataTableShell>
    </div>
    {openShootId && <ProductionShootPanel
      shootId={openShootId}
      canWrite={canWrite}
      onClose={() => setOpenShootId(null)}
      onChanged={(message) => { if (message) showSuccess(message); void loadRows({ notifyOnError: false }); }}
    />}
  </section>;
}
```

- [ ] **Step 7: Point the route at the board** — replace `frontend/src/app/(app)/project-management/production/page.js`:

```jsx
import ProductionPage from "@/components/project-management/production/ProductionPage";

export default function ProductionRoutePage() {
  return <ProductionPage />;
}
```

In `frontend/src/components/project-management/ProjectWorkflowModulePage.js` delete the `production: { … }` entry of `moduleRules` (lines 31-39) and change the comment above `moduleRules` to: `The workflow boards that list projects. Pre Production and Production are not among them any more: their rows are shoots rather than projects, so each has its own screen (PreProductionPage, production/ProductionPage).`

- [ ] **Step 8: Run tests and lint**

Run: `cd frontend && node --test test/production-page-wiring.test.mjs && npm run lint && npm test`
Expected: 3 passing; lint clean; full suite green.

- [ ] **Step 9: Walk it** — `npm run dev` in both `backend` and `frontend`, sign in as a Production Manager whose role holds `PROJECT / Production` READ_WRITE: the board lists their shoots; the panel's plan saves a draft and submits; a READ-only viewer sees the plan read-only with no Save/Submit. Walk it **on a phone-sized viewport first (360px)**: the board is cards, a tap opens the shoot full-screen, the plan is one column, every button is at least 44px tall, nothing needs a hover. Then 768 (still cards; the table appears at `md`) and 1280 px: no horizontal page scroll anywhere.

- [ ] **Step 10: Stage for review (do NOT commit — the user commits)**

```bash
git add frontend/src/constants/productionFormConfig.js frontend/src/components/data-table/RecordCardList.js frontend/src/components/project-management/production frontend/src/app/\(app\)/project-management/production/page.js frontend/src/components/project-management/ProjectWorkflowModulePage.js frontend/test/production-page-wiring.test.mjs
```

---

# Phase 2 — Uploads, the step engine, Execution and Activity tabs

### Task 10: Files — tickets and photos

**Files:**
- Create: `backend/src/modules/project-management/production/execution.js` (file functions; Task 11 adds the step functions to the same file)
- Modify: `backend/src/modules/project-management/production/controller.js`, `routes.js`
- Test: `backend/test/project-production-execution.test.js`

**Interfaces:**
- Consumes: `loadForWrite`, `accessFor`, `fail` (Task 4), `logActivity`, `fileAddRefusal`, `fileRemoveRefusal`, `FILE_LIMITS`, `FILE_KIND_LABELS` (Task 2); `storeDocument` (`services/documentStorage.js:46`), `storeImages`, `discardUploads` (`services/imageStorage.js:101,117`), `deleteObject` (`services/objectStorage.js:87`).
- Produces: `addFiles(shootId, { kind, files: [{ name?, data }] }, caller, deps) → { productionId, added }`; `removeFile(shootId, fileId, caller, deps) → { productionId, removed }`; HTTP `POST /shoots/:shootId/files`, `DELETE /shoots/:shootId/files/:fileId` → `{ data: detail }`.

- [ ] **Step 1: Write the failing tests** — create `backend/test/project-production-execution.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { addFiles, removeFile } = require("../src/modules/project-management/production/execution");
const { createProductionFake, productionRow, manager, coordinator } = require("./production-fake-client");

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const PDF = "data:application/pdf;base64,JVBERi0xLjQ=";
const storeStub = (calls) => async (kind, files) => { calls.push({ kind, count: files.length }); return files.map((file, index) => ({ url: `https://cdn.example/${kind}-${index}`, key: `k-${index}`, fileName: file.name || "File", mimeType: "image/png" })); };

test("a ticket must be an image or a PDF", async () => {
  const client = createProductionFake({ productions: [productionRow()] });
  const calls = [];
  await assert.rejects(addFiles("shoot-1", { kind: "TICKET", files: [{ name: "x.svg", data: "data:image/svg+xml;base64,PHN2Zz4=" }] }, manager, { client, store: storeStub(calls) }), (error) => error.status === 400);
  await assert.rejects(addFiles("shoot-1", { kind: "TICKET", files: [{ name: "x.html", data: "data:text/html;base64,PGgxPg==" }] }, manager, { client, store: storeStub(calls) }), (error) => error.status === 400);
  await addFiles("shoot-1", { kind: "TICKET", files: [{ name: "train.pdf", data: PDF }] }, manager, { client, store: storeStub(calls) });
  assert.equal(calls.length, 1, "nothing is stored for a refused file");
});

test("a link is not a file", async () => {
  const client = createProductionFake({ productions: [productionRow()] });
  await assert.rejects(addFiles("shoot-1", { kind: "TICKET", files: [{ name: "x", data: "https://evil.example/x.pdf" }] }, manager, { client, store: storeStub([]) }), (error) => error.status === 400);
});

test("tickets are the manager's, photos the coordinator's", async () => {
  const client = createProductionFake({ productions: [productionRow({ currentStep: "SHOOT_STARTED" })] });
  await assert.rejects(addFiles("shoot-1", { kind: "TICKET", files: [{ data: PDF }] }, coordinator, { client, store: storeStub([]) }), (error) => error.status === 403);
  await assert.rejects(addFiles("shoot-1", { kind: "HAPPENING_NOW", files: [{ data: PNG }] }, manager, { client, store: storeStub([]) }), (error) => error.status === 403);
});

test("added files are stored, recorded and logged", async () => {
  const client = createProductionFake({ productions: [productionRow({ currentStep: "SHOOT_STARTED" })] });
  await addFiles("shoot-1", { kind: "HAPPENING_NOW", files: [{ name: "a.png", data: PNG }, { name: "b.png", data: PNG }] }, coordinator, { client, store: storeStub([]) });
  assert.equal(client.state.files.length, 2);
  assert.equal(client.state.files[0].uploadedByUserId, 21);
  assert.equal(client.state.activities.at(-1).action, "FILE_ADDED");
});

test("the count limit is enforced", async () => {
  const files = Array.from({ length: 10 }, (_, index) => ({ id: `t-${index}`, productionId: "prod-1", kind: "TICKET" }));
  const client = createProductionFake({ productions: [productionRow()], files });
  await assert.rejects(addFiles("shoot-1", { kind: "TICKET", files: [{ data: PDF }] }, manager, { client, store: storeStub([]) }), (error) => error.status === 400);
});

test("a photo is refused outside its step", async () => {
  const client = createProductionFake({ productions: [productionRow({ currentStep: "REACHED_SHOOT_PLACE" })] });
  await assert.rejects(addFiles("shoot-1", { kind: "PINEAPPLE_GROUP", files: [{ data: PNG }] }, coordinator, { client, store: storeStub([]) }), (error) => error.status === 409);
});

test("uploads are discarded when the record write fails", async () => {
  const client = createProductionFake({ productions: [productionRow({ currentStep: "SHOOT_STARTED" })] });
  client.projectProductionFile.createMany = async () => { throw new Error("db down"); };
  const discarded = [];
  await assert.rejects(addFiles("shoot-1", { kind: "HAPPENING_NOW", files: [{ data: PNG }] }, coordinator, { client, store: storeStub([]), discard: async (stored) => discarded.push(...stored) }));
  assert.equal(discarded.length, 1);
});

test("happening-now photos cannot be removed once Shoot started is done; the object is deleted when they can", async () => {
  const files = [{ id: "f-1", productionId: "prod-1", kind: "HAPPENING_NOW", url: "https://cdn.example/a", fileName: "a.png" }];
  const done = createProductionFake({ productions: [productionRow({ currentStep: "SHOOT_STATUS" })], files });
  await assert.rejects(removeFile("shoot-1", "f-1", coordinator, { client: done, removeObject: async () => true }), (error) => error.status === 409);
  const open = createProductionFake({ productions: [productionRow({ currentStep: "SHOOT_STARTED" })], files });
  const removed = [];
  await removeFile("shoot-1", "f-1", coordinator, { client: open, removeObject: async (url) => removed.push(url) });
  assert.deepEqual(removed, ["https://cdn.example/a"]);
  assert.equal(open.state.activities.at(-1).action, "FILE_REMOVED");
});

test("a file of another shoot is not found", async () => {
  const client = createProductionFake({ productions: [productionRow()], files: [{ id: "f-9", productionId: "prod-other", kind: "TICKET", url: "u", fileName: "x" }] });
  await assert.rejects(removeFile("shoot-1", "f-9", manager, { client, removeObject: async () => true }), (error) => error.status === 404);
});
```

- [ ] **Step 2: Run to fail**

Run: `cd backend && node --test test/project-production-execution.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `backend/src/modules/project-management/production/execution.js` (file part):

```js
const prisma = require("../../../config/db");
const { storeDocument } = require("../../../services/documentStorage");
const { storeImages, discardUploads } = require("../../../services/imageStorage");
const { deleteObject } = require("../../../services/objectStorage");
const { accessFor, loadForWrite, fail } = require("./access");
const { logActivity } = require("./activity");
const S = require("./steps");

/*
 * What the Production Coordinator does on the day, and the files both sides add.
 *
 * Tickets are the manager's (plan side) and may be images or PDFs, stored through documentStorage
 * with `trustUrls: false`; photos are the coordinator's and go through imageStorage, which
 * compresses them. Only a `data:` payload of an allowed type is accepted - a link, an SVG or an
 * HTML page is refused before anything is stored. Files are stored before the transaction (uploads
 * are slow) and discarded if the record write fails.
 */
const DOCUMENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const mimeOf = (data) => (/^data:([^;,]+);base64,/.exec(String(data || "")) || [])[1] || null;

function assertSide(production, kind, caller) {
  const access = accessFor(production, caller);
  if (kind === "TICKET" ? !access.canEditPlan : !access.canRunSteps) {
    throw fail(403, kind === "TICKET" ? "Only this project's Production Manager can change the tickets." : "Only this shoot's Production Coordinator can add or remove its photos.");
  }
}

async function defaultStore(kind, files) {
  if (kind !== "TICKET") {
    const images = await storeImages(files.map((file) => file.data), { folder: "production/photos" });
    return images.map((image, index) => ({ url: image.url, key: image.key, fileName: String(files[index]?.name || `Photo ${index + 1}`).slice(0, 255), mimeType: image.mimeType }));
  }
  const stored = [];
  try {
    for (const file of files) {
      const name = String(file.name || "Ticket").slice(0, 255);
      const result = await storeDocument({ name, data: file.data }, { folder: "production/tickets", trustUrls: false });
      if (!result) throw fail(400, `${name} could not be read.`);
      // Without object storage (local development) the document comes back inline rather than linked.
      stored.push({ url: result.url || result.data, key: result.key, fileName: name, mimeType: mimeOf(file.data) });
    }
    return stored;
  } catch (error) {
    await discardUploads(stored);
    throw error;
  }
}

async function addFiles(shootId, { kind, files }, caller, deps = {}) {
  const { client = prisma, store = defaultStore, discard = discardUploads } = deps;
  const production = await loadForWrite(client, shootId);
  assertSide(production, kind, caller);
  const refusal = S.fileAddRefusal(production, kind);
  if (refusal) throw fail(409, refusal);

  const allowed = kind === "TICKET" ? DOCUMENT_TYPES : PHOTO_TYPES;
  for (const file of files) {
    const type = mimeOf(file.data);
    if (!type || !allowed.has(type)) throw fail(400, `${file.name || "This file"} is not ${kind === "TICKET" ? "an image or a PDF" : "a JPEG, PNG or WebP photo"}.`);
  }
  const held = await client.projectProductionFile.count({ where: { productionId: production.id, kind } });
  if (held + files.length > S.FILE_LIMITS[kind]) throw fail(400, `Up to ${S.FILE_LIMITS[kind]} ${S.FILE_KIND_LABELS[kind].toLowerCase()}s can be kept on a shoot.`);

  const stored = await store(kind, files);
  try {
    await client.$transaction(async (tx) => {
      // Asked again inside the write: the step may have moved on while the upload ran.
      const current = await loadForWrite(tx, shootId);
      const stillRefused = S.fileAddRefusal(current, kind);
      if (stillRefused) throw fail(409, stillRefused);
      await tx.projectProductionFile.createMany({
        data: stored.map((file) => ({ productionId: production.id, kind, url: file.url, fileName: file.fileName, mimeType: file.mimeType || null, uploadedByUserId: caller.userId || null })),
      });
      await logActivity(tx, production.id, "FILE_ADDED", `${S.FILE_KIND_LABELS[kind]}: ${stored.map((file) => file.fileName).join(", ")}`, caller);
    });
  } catch (error) {
    await discard(stored);
    throw error;
  }
  return { productionId: production.id, added: stored.length };
}

async function removeFile(shootId, fileId, caller, deps = {}) {
  const { client = prisma, removeObject = deleteObject } = deps;
  const removed = await client.$transaction(async (tx) => {
    const production = await loadForWrite(tx, shootId);
    const file = await tx.projectProductionFile.findFirst({ where: { id: String(fileId || ""), productionId: production.id }, select: { id: true, kind: true, url: true, fileName: true } });
    if (!file) throw fail(404, "File not found.");
    assertSide(production, file.kind, caller);
    const refusal = S.fileRemoveRefusal(production, file.kind);
    if (refusal) throw fail(409, refusal);
    await tx.projectProductionFile.delete({ where: { id: file.id } });
    await logActivity(tx, production.id, "FILE_REMOVED", `${S.FILE_KIND_LABELS[file.kind]}: ${file.fileName}`, caller);
    return { ...file, productionId: production.id };
  });
  // Best-effort, after the row is gone; `deleteObject` never throws and ignores inline data.
  await removeObject(removed.url);
  return { productionId: removed.productionId, removed: removed.id };
}

module.exports = { addFiles, removeFile };
```

- [ ] **Step 4: Wire the routes** — in `controller.js` add (above `module.exports`):

```js
const execution = require("./execution");
const { FILE_KINDS } = require("./steps");

// ~5 MB decoded, the documentStorage ceiling, as base64 plus its data: prefix.
const MAX_DATA_URI_CHARS = 7_500_000;
const filesSchema = z.object({
  kind: z.enum(FILE_KINDS),
  files: z.array(z.object({ name: z.string().trim().max(255).optional(), data: z.string().min(1).max(MAX_DATA_URI_CHARS) }).strict()).min(1).max(10),
}).strict();

async function addFiles(req, res) {
  const parsed = filesSchema.safeParse(req.body || {});
  if (!parsed.success) return invalid(res, parsed);
  try {
    await execution.addFiles(req.params.shootId, parsed.data, await callerOf(req.user.id));
    return res.status(201).json({ data: await read.getShoot(req.user.id, req.params.shootId) });
  } catch (error) { return respond(res, error, "Unable to add the files."); }
}

async function removeFile(req, res) {
  try {
    await execution.removeFile(req.params.shootId, req.params.fileId, await callerOf(req.user.id));
    return res.json({ data: await read.getShoot(req.user.id, req.params.shootId) });
  } catch (error) { return respond(res, error, "Unable to remove the file."); }
}
```

and add `filesSchema, addFiles, removeFile` to its `module.exports`. In `routes.js` add after the plan route:

```js
router.post("/shoots/:shootId/files", controller.addFiles);
router.delete("/shoots/:shootId/files/:fileId", controller.removeFile);
```

The global JSON limit is 50 MB (`server.js:149-150`); `filesSchema` caps one request at 10 files of ~5 MB, which stays under it.

- [ ] **Step 5: Run to pass**

Run: `cd backend && node --test test/project-production-execution.test.js test/project-production-routes.test.js`
Expected: all pass.

- [ ] **Step 6: Stage for review (do NOT commit — the user commits)**

```bash
git add backend/src/modules/project-management/production/execution.js backend/src/modules/project-management/production/controller.js backend/src/modules/project-management/production/routes.js backend/test/project-production-execution.test.js
```

---

### Task 11: The step engine and shoot status

**Files:**
- Modify: `backend/src/modules/project-management/production/execution.js`
- Modify: `backend/src/modules/project-management/production/controller.js`, `routes.js`
- Test: `backend/test/project-production-execution.test.js` (append)

**Interfaces:**
- Consumes: Task 2 rules, Task 4 access, `workingEmployeeStatuses` (`services/employeeOptionLists.js:82`).
- Produces: `completeStep(shootId, step, input, caller, deps) → { productionId, message }`; `changeShootStatus(shootId, { status, remarks }, caller, deps) → { productionId, message }`. `deps.notify(productionId, messageStep, caller, deps) → Promise<message|null>` defaults to a no-op until Task 14. HTTP `POST /shoots/:shootId/steps/:step` and `PATCH /shoots/:shootId/shoot-status` → `{ data: detail, message }`.

- [ ] **Step 1: Append the failing tests** to `backend/test/project-production-execution.test.js`:

```js
const { completeStep, changeShootStatus } = require("../src/modules/project-management/production/execution");
const { superAdmin } = require("./production-fake-client");

const statuses = async () => ["Active"];
const at = (step, overrides = {}) => createProductionFake({ productions: [productionRow({ currentStep: step, ...overrides })], employees: [{ id: 14 }] });
const notifier = (sent) => async (productionId, messageStep) => { sent.push(messageStep); return { step: messageStep, status: "SENT" }; };

test("a step cannot be completed before the plan is submitted", async () => {
  const client = at("STARTED_FROM_STUDIO", { planSubmittedAt: null });
  await assert.rejects(completeStep("shoot-1", "STARTED_FROM_STUDIO", {}, coordinator, { client }), (error) => error.status === 409 && /plan/.test(error.message));
});

test("steps cannot be skipped", async () => {
  const client = at("STARTED_FROM_STUDIO");
  await assert.rejects(completeStep("shoot-1", "REACHED_SHOOT_PLACE", {}, coordinator, { client }), (error) => error.status === 409);
  await assert.rejects(completeStep("shoot-1", "NOT_A_STEP", {}, coordinator, { client }), (error) => error.status === 400);
});

test("only the named coordinator runs the steps; a Super Admin may too", async () => {
  await assert.rejects(completeStep("shoot-1", "STARTED_FROM_STUDIO", {}, manager, { client: at("STARTED_FROM_STUDIO") }), (error) => error.status === 403);
  await completeStep("shoot-1", "STARTED_FROM_STUDIO", {}, superAdmin, { client: at("STARTED_FROM_STUDIO") });
});

test("completing a step moves to the next, stamps it, logs it and asks for its message", async () => {
  const client = at("STARTED_FROM_STUDIO");
  const sent = [];
  const result = await completeStep("shoot-1", "STARTED_FROM_STUDIO", {}, coordinator, { client, now: () => new Date("2026-10-02T02:00:00Z"), notify: notifier(sent) });
  const row = client.state.productions[0];
  assert.equal(row.currentStep, "REACHED_SHOOT_PLACE");
  assert.deepEqual(row.startedFromStudioAt, new Date("2026-10-02T02:00:00Z"));
  assert.deepEqual(client.state.activities.at(-1), { productionId: "prod-1", action: "STEP_COMPLETED", detail: "STARTED_FROM_STUDIO", userId: 21, userName: "Ravi" });
  assert.deepEqual(sent, ["STARTED_FROM_STUDIO"]);
  assert.equal(result.message.status, "SENT");
});

test("a second press of the same step is refused and sends nothing twice", async () => {
  const client = at("REACHED_SHOOT_PLACE");
  const sent = [];
  await completeStep("shoot-1", "REACHED_SHOOT_PLACE", {}, coordinator, { client, notify: notifier(sent) });
  await assert.rejects(completeStep("shoot-1", "REACHED_SHOOT_PLACE", {}, coordinator, { client, notify: notifier(sent) }), (error) => error.status === 409);
  assert.deepEqual(sent, ["REACHED_SHOOT_PLACE"]);
});

test("the pineapple meeting needs a group photo and remarks", async () => {
  await assert.rejects(completeStep("shoot-1", "PINEAPPLE_MEETING", { remarks: "Met the family" }, coordinator, { client: at("PINEAPPLE_MEETING") }), (error) => error.status === 400 && /photo/.test(error.message));
  const withPhoto = createProductionFake({ productions: [productionRow({ currentStep: "PINEAPPLE_MEETING" })], files: [{ id: "p", productionId: "prod-1", kind: "PINEAPPLE_GROUP" }] });
  await assert.rejects(completeStep("shoot-1", "PINEAPPLE_MEETING", { remarks: "  " }, coordinator, { client: withPhoto }), (error) => error.status === 400 && /remarks/.test(error.message));
  await completeStep("shoot-1", "PINEAPPLE_MEETING", { remarks: "Met the family" }, coordinator, { client: withPhoto });
  assert.equal(withPhoto.state.productions[0].pineappleRemarks, "Met the family");
});

test("at least 2 happening-now images are required", async () => {
  const one = createProductionFake({ productions: [productionRow({ currentStep: "SHOOT_STARTED" })], files: [{ id: "h1", productionId: "prod-1", kind: "HAPPENING_NOW" }] });
  await assert.rejects(completeStep("shoot-1", "SHOOT_STARTED", {}, coordinator, { client: one }), (error) => error.status === 400 && /2/.test(error.message));
  one.state.files.push({ id: "h2", productionId: "prod-1", kind: "HAPPENING_NOW" });
  await completeStep("shoot-1", "SHOOT_STARTED", {}, coordinator, { client: one });
  assert.equal(one.state.productions[0].currentStep, "SHOOT_STATUS");
});

test("the shoot status step is finished by setting Completed, not by the step route", async () => {
  await assert.rejects(completeStep("shoot-1", "SHOOT_STATUS", {}, coordinator, { client: at("SHOOT_STATUS") }), (error) => error.status === 400);
});

test("status changes need remarks, are logged, and Paused keeps the shoot on the status step", async () => {
  const client = at("SHOOT_STATUS");
  await assert.rejects(changeShootStatus("shoot-1", { status: "PAUSED", remarks: " " }, coordinator, { client }), (error) => error.status === 400);
  await changeShootStatus("shoot-1", { status: "PAUSED", remarks: "Rain" }, coordinator, { client });
  await changeShootStatus("shoot-1", { status: "HOLD", remarks: "Waiting for the family" }, coordinator, { client });
  assert.equal(client.state.productions[0].currentStep, "SHOOT_STATUS");
  assert.equal(client.state.productions[0].shootStatus, "HOLD");
  assert.deepEqual(client.state.activities.map((entry) => entry.action), ["SHOOT_STATUS_CHANGED", "SHOOT_STATUS_CHANGED"]);
  assert.equal(client.state.activities[1].detail, "Paused → Hold: Waiting for the family");
});

test("Completed opens Reached studio and asks for the shoot-completed message", async () => {
  const client = at("SHOOT_STATUS", { shootStatus: "PAUSED" });
  const sent = [];
  await changeShootStatus("shoot-1", { status: "COMPLETED", remarks: "Wrapped" }, coordinator, { client, notify: notifier(sent) });
  assert.equal(client.state.productions[0].currentStep, "REACHED_STUDIO");
  assert.ok(client.state.productions[0].shootStatusAt instanceof Date);
  assert.deepEqual(client.state.activities.map((entry) => entry.action), ["SHOOT_STATUS_CHANGED", "STEP_COMPLETED"]);
  assert.deepEqual(sent, ["SHOOT_COMPLETED"]);
});

test("moving back from Completed once Reached studio has opened is rejected", async () => {
  const client = at("REACHED_STUDIO", { shootStatus: "COMPLETED" });
  await assert.rejects(changeShootStatus("shoot-1", { status: "PAUSED", remarks: "Oops" }, coordinator, { client }), (error) => error.status === 409);
  assert.equal(client.state.productions[0].shootStatus, "COMPLETED");
});

test("the status cannot be set before the shoot reaches that step", async () => {
  await assert.rejects(changeShootStatus("shoot-1", { status: "PAUSED", remarks: "x" }, coordinator, { client: at("SHOOT_STARTED") }), (error) => error.status === 409);
});

test("photo copy needs the footage URL, who backed it up, and remarks - then the shoot is DONE", async () => {
  const client = at("PHOTO_COPY");
  await assert.rejects(completeStep("shoot-1", "PHOTO_COPY", { footageBackupByEmployeeId: 14, footageRemarks: "x" }, coordinator, { client, statuses }), (error) => error.status === 400);
  await assert.rejects(completeStep("shoot-1", "PHOTO_COPY", { footageUrl: "https://drive.example/f", footageBackupByEmployeeId: 99, footageRemarks: "x" }, coordinator, { client, statuses }), (error) => error.status === 400);
  await completeStep("shoot-1", "PHOTO_COPY", { footageUrl: "https://drive.example/f", footageBackupByEmployeeId: 14, footageRemarks: "Two copies" }, coordinator, { client, statuses });
  const row = client.state.productions[0];
  assert.equal(row.currentStep, "DONE");
  assert.equal(row.footageBackupByEmployeeId, 14);
});

test("a notifier that throws never undoes the step", async () => {
  const client = at("STARTED_FROM_STUDIO");
  const result = await completeStep("shoot-1", "STARTED_FROM_STUDIO", {}, coordinator, { client, notify: async () => { throw new Error("socket closed"); } });
  assert.equal(client.state.productions[0].currentStep, "REACHED_SHOOT_PLACE");
  assert.equal(result.message.status, "FAILED");
});
```

- [ ] **Step 2: Run to fail**

Run: `cd backend && node --test test/project-production-execution.test.js`
Expected: FAIL — `completeStep is not a function`.

- [ ] **Step 3: Implement** — in `execution.js` add after the requires:

```js
const { workingEmployeeStatuses } = require("../../../services/employeeOptionLists");

/** Until Task 14 wires WhatsApp in, a step asks for no message. */
const noNotify = async () => null;

/**
 * Asks for the step's WhatsApp message after the step is saved, outside its transaction. Whatever
 * happens to the send, the step stays done: a throw here is reported as a FAILED message.
 */
async function notifyAfter(notify, productionId, messageStep, caller, deps) {
  try {
    return await notify(productionId, messageStep, caller, deps);
  } catch (error) {
    console.error("Production message could not be recorded:", error);
    return { step: messageStep, status: "FAILED", error: "The WhatsApp message could not be sent.", sentAt: null };
  }
}
```

and before `module.exports`:

```js
/**
 * Completes the shoot's current step - only the current one, only after the plan is submitted,
 * only by the named Production Coordinator. The update is conditional on the step still being
 * current, so two presses (or two phones) complete it once and send one message.
 */
async function completeStep(shootId, step, input, caller, deps = {}) {
  const { client = prisma, now = () => new Date(), statuses = workingEmployeeStatuses, notify = noNotify } = deps;
  if (!S.STEPS.includes(step)) throw fail(400, "Unknown step.");
  if (step === "SHOOT_STATUS") throw fail(400, "Set the shoot status to Completed to finish this step.");

  const productionId = await client.$transaction(async (tx) => {
    const production = await loadForWrite(tx, shootId);
    if (!accessFor(production, caller).canRunSteps) throw fail(403, "Only this shoot's Production Coordinator can complete its steps.");
    if (!production.planSubmittedAt) throw fail(409, "The plan has not been submitted yet.");
    if (production.currentStep !== step) {
      throw fail(409, production.currentStep === S.DONE ? "Every step of this shoot is already done." : `Finish "${S.STEP_LABELS[production.currentStep]}" first.`);
    }

    const data = { [S.STEP_TIME_FIELDS[step]]: now(), currentStep: S.nextStep(step) };
    if (step === "PINEAPPLE_MEETING") {
      const photos = await tx.projectProductionFile.count({ where: { productionId: production.id, kind: "PINEAPPLE_GROUP" } });
      if (!photos) throw fail(400, "Add the pineapple meeting group photo.");
      const remarks = String(input.remarks || "").trim();
      if (!remarks) throw fail(400, "Write the pineapple meeting remarks.");
      data.pineappleRemarks = remarks;
    }
    if (step === "SHOOT_STARTED") {
      const photos = await tx.projectProductionFile.count({ where: { productionId: production.id, kind: "HAPPENING_NOW" } });
      if (photos < S.MIN_HAPPENING_NOW) throw fail(400, `Add at least ${S.MIN_HAPPENING_NOW} happening-now photos.`);
    }
    if (step === "PHOTO_COPY") {
      if (!input.footageUrl) throw fail(400, "Enter the footage URL.");
      if (!input.footageBackupByEmployeeId) throw fail(400, "Choose who did the footage backup.");
      const remarks = String(input.footageRemarks || "").trim();
      if (!remarks) throw fail(400, "Write the photo copy remarks.");
      const employee = await tx.employee.findFirst({ where: { id: input.footageBackupByEmployeeId, archivedAt: null, employmentStatus: { in: await statuses() } }, select: { id: true } });
      if (!employee) throw fail(400, "Choose an active employee for the footage backup.");
      Object.assign(data, { footageUrl: input.footageUrl, footageBackupByEmployeeId: employee.id, footageRemarks: remarks });
    }

    const { count } = await tx.projectProduction.updateMany({ where: { id: production.id, currentStep: step }, data });
    if (!count) throw fail(409, "This step has just been completed by someone else.");
    await logActivity(tx, production.id, "STEP_COMPLETED", step, caller);
    return production.id;
  });

  const messageStep = S.MESSAGE_FOR_STEP[step];
  const message = messageStep ? await notifyAfter(notify, productionId, messageStep, caller, deps) : null;
  return { productionId, message };
}

/**
 * Step 5. Paused, Hold, Reject or Completed, with remarks, as often as needed while the shoot is on
 * this step; every change is logged. Completed finishes the step and opens Reached studio - and from
 * then on the status can no longer change.
 */
async function changeShootStatus(shootId, { status, remarks }, caller, deps = {}) {
  const { client = prisma, now = () => new Date(), notify = noNotify } = deps;
  if (!S.SHOOT_STATUSES.includes(status)) throw fail(400, "Choose Paused, Hold, Reject or Completed.");
  const text = String(remarks || "").trim();
  if (!text) throw fail(400, "Write the remarks for this status.");

  const productionId = await client.$transaction(async (tx) => {
    const production = await loadForWrite(tx, shootId);
    if (!accessFor(production, caller).canRunSteps) throw fail(403, "Only this shoot's Production Coordinator can change its status.");
    if (!production.planSubmittedAt) throw fail(409, "The plan has not been submitted yet.");
    if (S.stepIndex(production.currentStep) < S.stepIndex("SHOOT_STATUS")) throw fail(409, `Finish "${S.STEP_LABELS[production.currentStep]}" first.`);
    if (production.currentStep !== "SHOOT_STATUS") throw fail(409, "The shoot is Completed and Reached studio has opened, so its status can no longer change.");

    const data = { shootStatus: status, shootStatusRemarks: text };
    if (status === "COMPLETED") Object.assign(data, { shootStatusAt: now(), currentStep: "REACHED_STUDIO" });
    const { count } = await tx.projectProduction.updateMany({ where: { id: production.id, currentStep: "SHOOT_STATUS" }, data });
    if (!count) throw fail(409, "The shoot has just been marked Completed by someone else.");
    await logActivity(tx, production.id, "SHOOT_STATUS_CHANGED", `${S.SHOOT_STATUS_LABELS[production.shootStatus] || "Not set"} → ${S.SHOOT_STATUS_LABELS[status]}: ${text}`, caller);
    if (status === "COMPLETED") await logActivity(tx, production.id, "STEP_COMPLETED", "SHOOT_STATUS", caller);
    return production.id;
  });

  const message = status === "COMPLETED" ? await notifyAfter(notify, productionId, "SHOOT_COMPLETED", caller, deps) : null;
  return { productionId, message };
}
```

and change the export to `module.exports = { addFiles, removeFile, completeStep, changeShootStatus };`.

- [ ] **Step 4: Wire the routes** — in `controller.js`:

```js
const { SHOOT_STATUSES } = require("./steps");

const stepSchema = z.object({
  remarks: optionalText,
  footageUrl: z.string().trim().max(2048).regex(/^https?:\/\/\S+$/i, "Enter the footage link as an http(s) URL.").nullable().optional(),
  footageBackupByEmployeeId: z.coerce.number().int().positive().nullable().optional(),
  footageRemarks: optionalText,
}).strict();
const shootStatusSchema = z.object({ status: z.enum(SHOOT_STATUSES), remarks: z.string().trim().min(1, "Write the remarks.").max(5000) }).strict();

/** What a step hands the WhatsApp sender. Empty until Task 14. */
const stepDeps = {};

async function completeStep(req, res) {
  const parsed = stepSchema.safeParse(req.body || {});
  if (!parsed.success) return invalid(res, parsed);
  try {
    const { message } = await execution.completeStep(req.params.shootId, req.params.step, parsed.data, await callerOf(req.user.id), stepDeps);
    return res.json({ data: await read.getShoot(req.user.id, req.params.shootId), message });
  } catch (error) { return respond(res, error, "Unable to complete this step."); }
}

async function changeShootStatus(req, res) {
  const parsed = shootStatusSchema.safeParse(req.body || {});
  if (!parsed.success) return invalid(res, parsed);
  try {
    const { message } = await execution.changeShootStatus(req.params.shootId, parsed.data, await callerOf(req.user.id), stepDeps);
    return res.json({ data: await read.getShoot(req.user.id, req.params.shootId), message });
  } catch (error) { return respond(res, error, "Unable to change the shoot status."); }
}
```

Export `completeStep, changeShootStatus, stepSchema, shootStatusSchema`. In `routes.js` add:

```js
router.patch("/shoots/:shootId/shoot-status", controller.changeShootStatus);
router.post("/shoots/:shootId/steps/:step", controller.completeStep);
```

- [ ] **Step 5: Run to pass**

Run: `cd backend && node --test test/project-production-execution.test.js && npm test`
Expected: all pass.

- [ ] **Step 6: Stage for review (do NOT commit — the user commits)**

```bash
git add backend/src/modules/project-management/production/execution.js backend/src/modules/project-management/production/controller.js backend/src/modules/project-management/production/routes.js backend/test/project-production-execution.test.js
```

---

### Task 12: Move `StepRail` to shared

**Files:**
- Create: `frontend/src/components/shared/StepRail.js` (moved and generalised)
- Delete: `frontend/src/components/ai-feature/events/wizard/StepRail.js`
- Modify: `frontend/src/components/ai-feature/events/CreateEventWizard.js:15,158`
- Test: `frontend/test/step-rail-shared.test.mjs`

**Interfaces:**
- Produces: `<StepRail steps={[id,label][]} current={index} furthest={index} onSelect={(index) => …} problems={{}} notes={{ [id]: string }} ariaLabel="…" />` — `notes` and `ariaLabel` new, optional; old props unchanged.

- [ ] **Step 1: Write the failing test** `frontend/test/step-rail-shared.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const url = (path) => new URL(`../src/${path}`, import.meta.url);

test("StepRail lives in components/shared and the Events wizard uses it from there", () => {
  assert.ok(fs.existsSync(url("components/shared/StepRail.js")));
  assert.equal(fs.existsSync(url("components/ai-feature/events/wizard/StepRail.js")), false);
  const wizard = fs.readFileSync(url("components/ai-feature/events/CreateEventWizard.js"), "utf8");
  assert.match(wizard, /import StepRail from "@\/components\/shared\/StepRail";/);
  assert.match(wizard, /ariaLabel="Wizard steps"/);
});

test("the shared rail takes notes and a label", () => {
  const rail = fs.readFileSync(url("components/shared/StepRail.js"), "utf8");
  assert.match(rail, /notes = \{\}/);
  assert.match(rail, /ariaLabel = "Steps"/);
  assert.match(rail, /min-h-11 /, "a 44px tap target on a phone");
});
```

- [ ] **Step 2: Run to fail**

Run: `cd frontend && node --test test/step-rail-shared.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Move and generalise** — `git mv frontend/src/components/ai-feature/events/wizard/StepRail.js frontend/src/components/shared/StepRail.js`, then make it:

```jsx
"use client";

import CheckRounded from "@mui/icons-material/CheckRounded";

/**
 * Where a multi-step flow is, and where it has been: the Events wizard and a production shoot's
 * steps. A vertical list beside the form from md up; on a phone the same steps as a row of pills
 * that scrolls sideways, so the form keeps the width.
 *
 * A step already passed can be pressed to go back to it (to read it, on production); one ahead
 * cannot be jumped to. `problems` marks a step whose fields are refused. `notes` puts a short line
 * under a step's label from md up - who finished it and when - and is left off on a phone, where
 * the pills have no room for it.
 */
export default function StepRail({ steps, current, furthest, onSelect, problems = {}, notes = {}, ariaLabel = "Steps" }) {
  return <nav aria-label={ariaLabel} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:w-52 md:shrink-0 md:flex-col md:overflow-visible md:px-0 md:pb-0">
    {steps.map(([id, label], index) => {
      const active = index === current;
      const done = index < furthest && !active;
      const reachable = index <= furthest;
      const failing = Boolean(problems[id]);
      return <button
        key={id}
        type="button"
        disabled={!reachable}
        aria-current={active ? "step" : undefined}
        onClick={() => onSelect(index)}
        className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-left text-xs font-medium transition md:min-h-0 md:w-full md:rounded-md md:px-2.5 md:py-2 md:text-sm ${active ? "bg-blue-600 text-white" : reachable ? "text-slate-700 hover:bg-slate-100" : "text-slate-400"} ${failing && !active ? "text-red-600" : ""}`}
      >
        <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${active ? "border-white/60 bg-white/15" : done ? "border-green-500 bg-green-50 text-green-700" : "border-slate-300 bg-white text-slate-500"}`}>
          {done ? <CheckRounded style={{ fontSize: 14 }} /> : index + 1}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="whitespace-nowrap md:whitespace-normal">{label}</span>
          {notes[id] && <span className={`hidden text-[11px] font-normal md:block ${active ? "text-white/80" : "text-slate-500"}`}>{notes[id]}</span>}
        </span>
      </button>;
    })}
  </nav>;
}
```

Two changes beyond the move, both for the phone: `notes`/`ariaLabel`, and `min-h-11 md:min-h-0` on each pill so the rail is a 44px tap target below `md` (the Events wizard's pills grow the same way on a phone; its desktop rail is unchanged). The hover fill stays — it is never the only sign of anything.

In `CreateEventWizard.js` change line 15 to `import StepRail from "@/components/shared/StepRail";` and line 158's element to add `ariaLabel="Wizard steps"`:

```jsx
{steps.length > 1 && <StepRail steps={steps} current={step} furthest={furthest} onSelect={goTo} ariaLabel="Wizard steps" problems={Object.keys(problems).length ? { details: true } : {}} />}
```

- [ ] **Step 4: Run to pass**

Run: `cd frontend && node --test test/step-rail-shared.test.mjs && npm run lint`
Expected: 2 passing; lint clean. Open AI Feature → Events → Create and confirm the wizard rail still works at 360 and 1280 px.

- [ ] **Step 5: Stage for review (do NOT commit — the user commits)**

```bash
git add -A frontend/src/components/shared/StepRail.js frontend/src/components/ai-feature/events/wizard/StepRail.js frontend/src/components/ai-feature/events/CreateEventWizard.js frontend/test/step-rail-shared.test.mjs
```

---

### Task 13: Execution tab, tickets, uploads that survive a bad network, Activity tab

**Phone first.** This is the screen the coordinator holds at the venue. Build and check every step at 360px before widening: the step's primary action sits in a bar fixed to the bottom of the panel, the camera is offered first, every tap target is at least 44px, a ticket opens with one tap, and a photo that fails to upload stays on the phone with Retry.

**Files:**
- Create: `frontend/src/lib/productionUploads.mjs` (the upload queue, pure)
- Create: `frontend/src/components/shared/StickyActionBar.js` (reusable: a primary action fixed to the bottom of a panel on a phone)
- Modify: `frontend/src/components/shared/MultiImageField.js` (a `size` prop for 44px buttons)
- Create: `frontend/src/components/project-management/production/useProductionUploads.js`
- Create: `frontend/src/components/project-management/production/ProductionUploadQueue.js`
- Create: `frontend/src/components/project-management/production/ProductionFileList.js`
- Create: `frontend/src/components/project-management/production/ProductionExecutionTab.js`
- Create: `frontend/src/components/project-management/production/ProductionStepForm.js`
- Create: `frontend/src/components/project-management/production/ProductionActivityTab.js`
- Modify (full replacement): `frontend/src/components/project-management/production/ProductionShootPanel.js`
- Modify: `frontend/src/constants/productionFormConfig.js` (add `tickets`)
- Test: `frontend/test/production-uploads.test.mjs`, `frontend/test/production-page-wiring.test.mjs` (append)

**Interfaces:**
- Consumes: service functions (Task 8), `StepRail` (Task 12), `PRODUCTION_STEPS`, `stepIndex`, `stepNotes`, `stepLabel`, `formatWhen`, `SHOOT_STATUS_OPTIONS`, `activityText` (Task 8), `MultiImageField`, `FileUploadField`, `TextField`, `TextAreaField`, `Dropdown`, `Button` (`size="lg"` = `min-h-11`), `ConfirmDialog` (`layer="dialogOverPanel"`), `Tabs`, `Loader`, `useSubmitOnce`.
- Produces:
  - `productionUploads.mjs`: `enqueueUploads(queue, kind, files) → queue`, `markUpload(queue, id, status, error?)`, `dropUpload(queue, id)`, `retryUploads(queue, kind)`, `nextWaiting(queue)`, `uploadsOf(queue, kind) → { items, left, failed }`. An item is `{ id, kind, name, data, status: "waiting"|"uploading"|"failed", error }`.
  - `useProductionUploads(shootId, onUploaded(detail)) → { queue, add(kind, files), retry(kind), discard(id), pending }`
  - `<StickyActionBar>{buttons}</StickyActionBar>`; `<MultiImageField size="lg" … />`
  - `<ProductionUploadQueue queue kind onRetry onDiscard />`, `<ProductionFileList files canRemove onRemove emptyText />`
  - `<ProductionExecutionTab shootId detail options canRunSteps uploads onDetail(next, message) onError(text) onRemoveFile(file) />`, `<ProductionStepForm … />`, `<ProductionActivityTab shootId refreshKey onError />`

- [ ] **Step 1: Write the failing tests**

`frontend/test/production-uploads.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { enqueueUploads, markUpload, dropUpload, retryUploads, nextWaiting, uploadsOf } from "../src/lib/productionUploads.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

test("photos are queued one item each, in the order they were taken", () => {
  const queue = enqueueUploads([], "HAPPENING_NOW", [PNG, PNG]);
  assert.equal(queue.length, 2);
  assert.deepEqual(queue.map((item) => [item.kind, item.status, item.data]), [["HAPPENING_NOW", "waiting", PNG], ["HAPPENING_NOW", "waiting", PNG]]);
  assert.equal(nextWaiting(queue).id, queue[0].id);
  assert.notEqual(queue[0].id, queue[1].id);
});

test("a ticket keeps its file name", () => {
  const [item] = enqueueUploads([], "TICKET", [{ name: "train.pdf", data: "data:application/pdf;base64,JVBERi0=" }]);
  assert.equal(item.name, "train.pdf");
});

test("a failed upload stays queued with its reason", () => {
  let queue = enqueueUploads([], "HAPPENING_NOW", [PNG, PNG]);
  queue = dropUpload(queue, queue[0].id);
  queue = markUpload(queue, queue[0].id, "failed", "Network error");
  assert.deepEqual(uploadsOf(queue, "HAPPENING_NOW"), { items: queue, left: 0, failed: 1 });
  assert.equal(queue[0].error, "Network error");
  assert.equal(nextWaiting(queue), null, "a failed photo is not retried behind the person's back");
});

test("retry puts only the failed ones of that kind back", () => {
  let queue = [...enqueueUploads([], "HAPPENING_NOW", [PNG]), ...enqueueUploads([], "TICKET", [{ name: "t.pdf", data: "d" }])];
  queue = markUpload(markUpload(queue, queue[0].id, "failed", "x"), queue[1].id, "failed", "y");
  queue = retryUploads(queue, "HAPPENING_NOW");
  assert.deepEqual(queue.map((item) => item.status), ["waiting", "failed"]);
  assert.equal(queue[0].error, "");
});
```

Append to `frontend/test/production-page-wiring.test.mjs`:

```js
test("the panel has Plan, Execution and Activity, and the rail comes from shared", () => {
  const panel = read("components/project-management/production/ProductionShootPanel.js");
  assert.match(panel, /\{ id: "plan", label: "Plan" \}, \{ id: "execution", label: "Execution" \}, \{ id: "activity", label: "Activity" \}/);
  assert.match(read("components/project-management/production/ProductionExecutionTab.js"), /from "@\/components\/shared\/StepRail"/);
});

test("a step's controls are drawn only for the coordinator on the current step, in a bar at the bottom", () => {
  const form = read("components/project-management/production/ProductionStepForm.js");
  assert.match(form, /editable &&/);
  assert.match(form, /layer="dialogOverPanel"/);
  assert.match(form, /<StickyActionBar>/);
  assert.match(form, /<MultiImageField[^>]*size="lg"/);
});

test("uploads go through the queue, and closing with photos still waiting asks first", () => {
  const panel = read("components/project-management/production/ProductionShootPanel.js");
  assert.match(panel, /useProductionUploads\(/);
  assert.match(panel, /uploads\.pending/);
});
```

- [ ] **Step 2: Run to fail**

Run: `cd frontend && node --test test/production-uploads.test.mjs test/production-page-wiring.test.mjs`
Expected: FAIL — `productionUploads.mjs` not found; the new wiring tests fail.

- [ ] **Step 3: The queue** `frontend/src/lib/productionUploads.mjs`:

```js
/**
 * Photos and tickets on their way to the server, kept in the browser until each one lands.
 *
 * The coordinator uploads from a phone at the venue, where the network is slow and drops. So every
 * file is its own item and its own request - one failure loses nothing else - and an item whose
 * upload fails **stays here** with its reason until the person retries or discards it. Photos are
 * already compressed by `MultiImageField` before they reach the queue. Successful items are dropped:
 * they are on the shoot now.
 */
let sequence = 0;

export function enqueueUploads(queue, kind, files) {
  return [...queue, ...(files || []).map((file, index) => {
    sequence += 1;
    const isPhoto = typeof file === "string";
    return {
      id: `upload-${Date.now()}-${sequence}`,
      kind,
      name: isPhoto ? `Photo ${index + 1}.jpg` : String(file?.name || "File"),
      data: isPhoto ? file : file?.data,
      status: "waiting",
      error: "",
    };
  })];
}

export const markUpload = (queue, id, status, error = "") => queue.map((item) => (item.id === id ? { ...item, status, error } : item));
export const dropUpload = (queue, id) => queue.filter((item) => item.id !== id);
export const retryUploads = (queue, kind) => queue.map((item) => (item.kind === kind && item.status === "failed" ? { ...item, status: "waiting", error: "" } : item));
export const nextWaiting = (queue) => queue.find((item) => item.status === "waiting") || null;

/** One kind's items, how many are still to go, and how many failed. */
export function uploadsOf(queue, kind) {
  const items = queue.filter((item) => item.kind === kind);
  return { items, left: items.filter((item) => item.status !== "failed").length, failed: items.filter((item) => item.status === "failed").length };
}
```

- [ ] **Step 4: The hook** `frontend/src/components/project-management/production/useProductionUploads.js`:

```js
"use client";

import { useCallback, useRef, useState } from "react";
import { dropUpload, enqueueUploads, markUpload, nextWaiting, retryUploads } from "@/lib/productionUploads.mjs";
import { addProductionFiles } from "@/services/project-management/production.service";

/**
 * Sends the queue one file at a time and keeps what failed. `onUploaded` receives the shoot as it
 * stands after each file lands, so the list fills in as the photos arrive rather than all at once
 * at the end of a slow upload.
 */
export default function useProductionUploads(shootId, onUploaded) {
  const [queue, setQueue] = useState([]);
  // The queue as it stands now; state only follows it, so a photo taken mid-upload is never lost.
  const current = useRef([]);
  const running = useRef(false);
  const commit = useCallback((next) => { current.current = next; setQueue(next); }, []);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (let item = nextWaiting(current.current); item; item = nextWaiting(current.current)) {
        commit(markUpload(current.current, item.id, "uploading"));
        try {
          const response = await addProductionFiles(shootId, item.kind, [{ name: item.name, data: item.data }]);
          commit(dropUpload(current.current, item.id));
          onUploaded?.(response?.data);
        } catch (error) {
          commit(markUpload(current.current, item.id, "failed", error.message || "Upload failed."));
        }
      }
    } finally {
      running.current = false;
    }
  }, [commit, onUploaded, shootId]);

  const add = useCallback((kind, files) => {
    if (!files?.length) return;
    commit(enqueueUploads(current.current, kind, files));
    void pump();
  }, [commit, pump]);

  const retry = useCallback((kind) => { commit(retryUploads(current.current, kind)); void pump(); }, [commit, pump]);
  const discard = useCallback((id) => commit(dropUpload(current.current, id)), [commit]);

  return { queue, add, retry, discard, pending: queue.length };
}
```

- [ ] **Step 5: The queue's face** `frontend/src/components/project-management/production/ProductionUploadQueue.js`:

```jsx
import Button from "@/components/shared/Button";
import { uploadsOf } from "@/lib/productionUploads.mjs";

/** "3 left to upload", and each failed file with its reason, Retry and Discard. Nothing for a clean queue. */
export default function ProductionUploadQueue({ queue, kind, onRetry, onDiscard }) {
  const { items, left, failed } = uploadsOf(queue, kind);
  if (!items.length) return null;
  return <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700" aria-live="polite">
    {left > 0 && <p className="font-medium">Uploading… {left} left</p>}
    {failed > 0 && <>
      <p className="font-medium text-amber-800">{failed} not uploaded. They are still on this phone.</p>
      <ul className="flex flex-col gap-1">
        {items.filter((item) => item.status === "failed").map((item) => <li key={item.id} className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate">{item.name}: {item.error}</span>
          <Button type="button" variant="plain" size="lg" className="shrink-0 text-red-600" onClick={() => onDiscard(item.id)}>Discard</Button>
        </li>)}
      </ul>
      <Button type="button" size="lg" className="w-full sm:w-auto sm:self-start" onClick={() => onRetry(kind)}>Retry upload</Button>
    </>}
  </div>;
}
```

- [ ] **Step 6: The bottom bar** `frontend/src/components/shared/StickyActionBar.js`:

```jsx
/**
 * A screen's primary action, held at the bottom of the panel on a phone where a thumb reaches it,
 * and back in the flow of the form from `md` up. Sticky inside the panel's own scrolling body, so it
 * stays in view however long the step's form is; it clears the phone's home indicator.
 */
export default function StickyActionBar({ children, className = "" }) {
  return <div className={`sticky bottom-0 z-10 -mx-3 mt-2 flex flex-col gap-2 border-t border-slate-200 bg-white px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:static md:mx-0 md:flex-row md:border-0 md:bg-transparent md:p-0 ${className}`}>{children}</div>;
}
```

- [ ] **Step 7: 44px buttons on `MultiImageField`** — in `frontend/src/components/shared/MultiImageField.js` add a prop `size = "md",` after `cameraLayer = "dialogOverPanel",` and change the `buttonClass` line to:

```js
  // `lg` is the phone-at-a-venue size: 44px tall and full width on a phone, so a thumb lands on it.
  const buttonClass = `inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium sm:text-sm ${size === "lg" ? "min-h-11 w-full sm:w-auto" : ""}`;
```

Take photos already comes before Upload photos, so the camera is offered first; every existing caller keeps `md` and is unchanged.

- [ ] **Step 8: Add tickets to the plan sections** — in `productionFormConfig.js`, the `travel` section's fields become:

```js
      { name: "travelMode", label: "Travel Mode", type: "select", options: "travelModes", placeholder: "Select travel mode" },
      { name: "tickets", type: "custom", colSpan: 2 },
```

- [ ] **Step 9: Write** `ProductionFileList.js`:

```jsx
import Button from "@/components/shared/Button";

/**
 * A shoot's files: photos as thumbnails, ticket PDFs as a full-width row. The whole tile is one
 * link, so a ticket opens (or downloads, where the browser can) with a single tap, for anybody who
 * can view the shoot. `canRemove` draws Remove - only for the side that added it, and only before
 * its step is done; the server asks the same.
 */
export default function ProductionFileList({ files = [], canRemove = false, onRemove, emptyText = "Nothing added yet." }) {
  if (!files.length) return <p className="text-xs text-slate-500">{emptyText}</p>;
  return <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
    {files.map((file) => {
      const image = String(file.mimeType || "").startsWith("image/");
      return <li key={file.id} className={`flex min-w-0 flex-col gap-1 rounded-md border border-slate-200 bg-white p-2 ${image ? "" : "col-span-2 sm:col-span-3 lg:col-span-4"}`}>
        <a href={file.url} target="_blank" rel="noreferrer" download={file.fileName} className="flex min-h-11 min-w-0 items-center">
          {image
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={file.url} alt={file.fileName} className="aspect-square w-full rounded object-cover" />
            : <span className="block truncate text-sm font-medium text-blue-700 underline">Open {file.fileName}</span>}
        </a>
        <span className="truncate text-[11px] text-slate-500">{file.uploadedBy || "—"}</span>
        {canRemove && <Button type="button" variant="plain" size="lg" className="self-start px-0 text-red-600" onClick={() => onRemove(file)}>Remove</Button>}
      </li>;
    })}
  </ul>;
}
```

- [ ] **Step 10: Write** `ProductionStepForm.js`:

```jsx
"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import MultiImageField from "@/components/shared/MultiImageField";
import StickyActionBar from "@/components/shared/StickyActionBar";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ProductionFileList from "@/components/project-management/production/ProductionFileList";
import ProductionUploadQueue from "@/components/project-management/production/ProductionUploadQueue";
import { MESSAGE_LABELS, MESSAGE_STEP_FOR, SHOOT_STATUS_OPTIONS, formatWhen, stepLabel } from "@/lib/productionSteps.mjs";
import { changeProductionShootStatus, completeProductionStep } from "@/services/project-management/production.service";

/*
 * One step of the day, built for a phone. `editable` is true only for the named coordinator on the
 * **current** step; everything else is the step read back. The step's one primary action sits in
 * the `StickyActionBar` at the bottom of the panel, full-width and 44px, where a thumb reaches it.
 * Happening-now photos may keep being added from Shoot started until the shoot is Completed.
 */
const CONFIRM_STEPS = new Set(["STARTED_FROM_STUDIO", "REACHED_SHOOT_PLACE", "REACHED_STUDIO"]);
const statusLabel = (value) => SHOOT_STATUS_OPTIONS.find((option) => option.value === value)?.label || "Not set";
const primary = "w-full md:w-auto";

function ReadBack({ rows }) {
  return <dl className="grid gap-x-4 gap-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
    {rows.map(([label, value]) => <div key={label} className="min-w-0">
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-800">{value || "—"}</dd>
    </div>)}
  </dl>;
}

export default function ProductionStepForm({ stepId, shootId, detail, options, editable, canRunSteps, uploads, onDetail, onError, onRemoveFile }) {
  const { busy, run } = useSubmitOnce();
  const execution = detail.execution;
  const [confirming, setConfirming] = useState(false);
  const [remarks, setRemarks] = useState(execution.pineappleRemarks || "");
  const [status, setStatus] = useState(execution.shootStatus || "");
  const [statusRemarks, setStatusRemarks] = useState("");
  const [footage, setFootage] = useState({
    footageUrl: execution.footageUrl || "",
    footageBackupByEmployeeId: execution.footageBackupByEmployeeId ? String(execution.footageBackupByEmployeeId) : "",
    footageRemarks: execution.footageRemarks || "",
  });
  const log = detail.stepLog?.[stepId];
  const filesOf = (kind) => (detail.files || []).filter((file) => file.kind === kind);
  const employees = (options?.employees || []).map((employee) => ({ value: String(employee.id), label: employee.employeeName }));
  const queueFor = (kind) => <ProductionUploadQueue queue={uploads.queue} kind={kind} onRetry={uploads.retry} onDiscard={uploads.discard} />;

  async function complete(payload = {}) {
    await run(async () => {
      onError("");
      try {
        const response = await completeProductionStep(shootId, stepId, payload);
        setConfirming(false);
        onDetail(response?.data, `${stepLabel(stepId)} done.`);
      } catch (error) {
        setConfirming(false);
        onError(error.message || "Unable to complete this step.");
      }
    });
  }

  async function saveStatus() {
    await run(async () => {
      onError("");
      try {
        const response = await changeProductionShootStatus(shootId, { status, remarks: statusRemarks });
        setStatusRemarks("");
        onDetail(response?.data, status === "COMPLETED" ? "Shoot completed." : `Shoot status set to ${statusLabel(status)}.`);
      } catch (error) {
        onError(error.message || "Unable to change the shoot status.");
      }
    });
  }

  const pineapple = filesOf("PINEAPPLE_GROUP");
  const happening = filesOf("HAPPENING_NOW");
  const canAddHappening = canRunSteps && ["SHOOT_STARTED", "SHOOT_STATUS"].includes(execution.currentStep);
  const messageStep = MESSAGE_STEP_FOR[stepId];

  return <section className="flex min-w-0 flex-col gap-4">
    <header className="flex flex-col gap-0.5">
      <h3 className="text-base font-semibold text-slate-900">{stepLabel(stepId)}</h3>
      {log && <p className="text-xs text-green-700">✓ {log.by} · {formatWhen(log.at)}</p>}
    </header>

    {CONFIRM_STEPS.has(stepId) && editable && <>
      <p className="text-sm text-slate-600">{messageStep ? `Confirming posts the "${MESSAGE_LABELS[messageStep]}" message to the project's WhatsApp group.` : "Confirm when the team is back at the studio."}</p>
      <StickyActionBar>
        <Button type="button" variant="primary" size="lg" className={primary} onClick={() => setConfirming(true)}>Confirm {stepLabel(stepId).toLowerCase()}</Button>
      </StickyActionBar>
      <ConfirmDialog
        open={confirming}
        layer="dialogOverPanel"
        tone="primary"
        title={`${stepLabel(stepId)}?`}
        message={messageStep ? "This completes the step and posts its message to the WhatsApp group. It cannot be undone." : "This completes the step. It cannot be undone."}
        confirmLabel="Confirm"
        busyLabel="Saving..."
        loading={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void complete()}
      />
    </>}

    {stepId === "PINEAPPLE_MEETING" && <>
      {editable && <MultiImageField label="Group photo" required size="lg" value={[]} max={Math.max(1, 5 - pineapple.length)} onChange={(next) => uploads.add("PINEAPPLE_GROUP", next)} />}
      {queueFor("PINEAPPLE_GROUP")}
      <ProductionFileList files={pineapple} canRemove={editable} onRemove={onRemoveFile} emptyText="No group photo yet." />
      {editable
        ? <TextAreaField label="Remarks" required value={remarks} onChange={(event) => setRemarks(event.target.value)} />
        : <ReadBack rows={[["Remarks", execution.pineappleRemarks]]} />}
      {editable && <StickyActionBar>
        <Button type="button" variant="primary" size="lg" className={primary} busy={busy} busyLabel="Saving..." disabled={!pineapple.length || !remarks.trim()} onClick={() => void complete({ remarks })}>Complete pineapple meeting</Button>
      </StickyActionBar>}
    </>}

    {stepId === "SHOOT_STARTED" && <>
      {canAddHappening && <MultiImageField label="Happening now" size="lg" value={[]} max={Math.max(1, 30 - happening.length)} onChange={(next) => uploads.add("HAPPENING_NOW", next)} />}
      {queueFor("HAPPENING_NOW")}
      <ProductionFileList files={happening} canRemove={editable} onRemove={onRemoveFile} emptyText="No happening-now photos yet." />
      {editable && <StickyActionBar>
        <p className="text-xs text-slate-500 md:self-center">{happening.length} of at least 2 photos uploaded.</p>
        <Button type="button" variant="primary" size="lg" className={primary} busy={busy} busyLabel="Saving..." disabled={happening.length < 2} onClick={() => void complete()}>Shoot started</Button>
      </StickyActionBar>}
    </>}

    {stepId === "SHOOT_STATUS" && <>
      <ReadBack rows={[["Status", statusLabel(execution.shootStatus)], ["Remarks", execution.shootStatusRemarks]]} />
      {editable && <div className="flex flex-col gap-3">
        <Dropdown label="New status" required value={status} onChange={setStatus} options={SHOOT_STATUS_OPTIONS} placeholder="Select status" />
        <TextAreaField label="Remarks" required value={statusRemarks} onChange={(event) => setStatusRemarks(event.target.value)} />
        <StickyActionBar>
          <Button type="button" variant="primary" size="lg" className={primary} busy={busy} busyLabel="Saving..." disabled={!status || !statusRemarks.trim()} onClick={() => void saveStatus()}>Save status</Button>
        </StickyActionBar>
      </div>}
    </>}

    {stepId === "PHOTO_COPY" && (editable
      ? <div className="flex flex-col gap-3">
        <TextField label="Footage URL" required type="url" inputMode="url" value={footage.footageUrl} onChange={(event) => setFootage((current) => ({ ...current, footageUrl: event.target.value }))} />
        <Dropdown label="Footage backup done by" required value={footage.footageBackupByEmployeeId} onChange={(value) => setFootage((current) => ({ ...current, footageBackupByEmployeeId: value }))} options={employees} placeholder="Select employee" />
        <TextAreaField label="Remarks" required value={footage.footageRemarks} onChange={(event) => setFootage((current) => ({ ...current, footageRemarks: event.target.value }))} />
        <StickyActionBar>
          <Button type="button" variant="primary" size="lg" className={primary} busy={busy} busyLabel="Saving..." disabled={!footage.footageUrl || !footage.footageBackupByEmployeeId || !footage.footageRemarks.trim()} onClick={() => void complete({ ...footage, footageBackupByEmployeeId: Number(footage.footageBackupByEmployeeId) })}>Complete photo copy</Button>
        </StickyActionBar>
      </div>
      : <ReadBack rows={[["Footage URL", execution.footageUrl], ["Backup done by", execution.footageBackupBy], ["Remarks", execution.footageRemarks]]} />)}

    {!editable && !log && stepId !== "SHOOT_STATUS" && <p className="text-xs text-slate-500">{canRunSteps ? "Finish the steps before this one first." : "Only this shoot's Production Coordinator completes its steps."}</p>}
  </section>;
}
```

- [ ] **Step 11: Write** `ProductionExecutionTab.js`:

```jsx
"use client";

import { useState } from "react";
import StepRail from "@/components/shared/StepRail";
import ProductionStepForm from "@/components/project-management/production/ProductionStepForm";
import { PRODUCTION_STEPS, stepIndex, stepNotes } from "@/lib/productionSteps.mjs";

/**
 * The coordinator's day, one step at a time. On a phone the rail is a row of pills above the step
 * (scrolls sideways); from md up it is a list beside it. A finished step can be opened to read it
 * back (✓, who, when). The form is editable only on the current step for whoever runs the steps.
 */
export default function ProductionExecutionTab({ shootId, detail, options, canRunSteps, uploads, onDetail, onError, onRemoveFile }) {
  const furthest = stepIndex(detail.execution.currentStep);
  const lastIndex = PRODUCTION_STEPS.length - 1;
  const [viewed, setViewed] = useState(Math.min(furthest, lastIndex));
  // When the current step moves on, follow it rather than stay on the step just finished.
  const [followed, setFollowed] = useState(furthest);
  if (followed !== furthest) {
    setFollowed(furthest);
    setViewed(Math.min(furthest, lastIndex));
  }

  if (!detail.plan.planSubmittedAt) {
    return <p className="m-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 sm:m-4">The steps open once the Production Manager submits the plan.</p>;
  }

  const [stepId] = PRODUCTION_STEPS[viewed];
  return <div className="flex min-w-0 flex-col gap-4 p-3 sm:p-4 md:flex-row">
    <StepRail steps={PRODUCTION_STEPS} current={viewed} furthest={furthest} onSelect={setViewed} notes={stepNotes(detail.stepLog)} ariaLabel="Production steps" />
    <div className="min-w-0 flex-1">
      <ProductionStepForm
        key={stepId}
        stepId={stepId}
        shootId={shootId}
        detail={detail}
        options={options}
        editable={canRunSteps && stepId === detail.execution.currentStep}
        canRunSteps={canRunSteps}
        uploads={uploads}
        onDetail={onDetail}
        onError={onError}
        onRemoveFile={onRemoveFile}
      />
    </div>
  </div>;
}
```

- [ ] **Step 12: Write** `ProductionActivityTab.js`:

```jsx
"use client";

import { useEffect, useState } from "react";
import Loader from "@/components/shared/Loader";
import { activityText, formatWhen } from "@/lib/productionSteps.mjs";
import { getProductionActivity } from "@/services/project-management/production.service";

/** Everything done on the shoot, oldest first. Re-read whenever the shoot changes (`refreshKey`). */
export default function ProductionActivityTab({ shootId, refreshKey, onError }) {
  const [entries, setEntries] = useState(null);
  useEffect(() => {
    let live = true;
    getProductionActivity(shootId)
      .then((response) => { if (live) setEntries(Array.isArray(response?.data) ? response.data : []); })
      .catch((error) => { if (live) { setEntries([]); onError(error.message || "Unable to load the activity."); } });
    return () => { live = false; };
  }, [shootId, refreshKey, onError]);

  if (!entries) return <Loader label="Loading activity..." className="p-6" />;
  if (!entries.length) return <p className="p-4 text-sm text-slate-500">Nothing has happened on this shoot yet.</p>;
  return <ol className="flex flex-col gap-2 p-3 sm:p-4">
    {entries.map((entry) => <li key={entry.id} className="rounded-md border border-slate-200 bg-white p-3">
      <p className="break-words text-sm text-slate-800">{activityText(entry)}</p>
      <p className="mt-1 text-xs text-slate-500">{entry.userName} · {formatWhen(entry.createdAt)}</p>
    </li>)}
  </ol>;
}
```

- [ ] **Step 13: Replace** `ProductionShootPanel.js` with the three-tab version:

```jsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import Button from "@/components/shared/Button";
import FileUploadField from "@/components/shared/FileUploadField";
import MultiSelectField from "@/components/shared/MultiSelectField";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Tabs from "@/components/ui/Tabs";
import ProductionActivityTab from "@/components/project-management/production/ProductionActivityTab";
import ProductionExecutionTab from "@/components/project-management/production/ProductionExecutionTab";
import ProductionFileList from "@/components/project-management/production/ProductionFileList";
import ProductionUploadQueue from "@/components/project-management/production/ProductionUploadQueue";
import useProductionUploads from "@/components/project-management/production/useProductionUploads";
import { productionPlanSections } from "@/constants/productionFormConfig";
import { productionPlanForm, productionPlanOptions, productionPlanPayload } from "@/lib/productionPlan.mjs";
import { formatDay } from "@/lib/productionSteps.mjs";
import { getProductionOptions, getProductionShoot, removeProductionFile, saveProductionPlan } from "@/services/project-management/production.service";

const TABS = [{ id: "plan", label: "Plan" }, { id: "execution", label: "Execution" }, { id: "activity", label: "Activity" }];

/**
 * One shoot's production, opened from the board: Plan, Execution and Activity.
 *
 * Phone first. `SchemaFormPanel` covers the whole screen below `sm` (`fixed inset-0 h-dvh`), so the
 * shoot opens full-screen on a phone rather than as a side pane; the tabs sit under the title and
 * the footer stays at the bottom.
 *
 * What the viewer may do comes from two answers together: `canWrite` (the route's permission,
 * READ_WRITE) and the shoot's own `canEditPlan` / `canRunSteps` from the API (being named on it).
 * The panel asks them itself, so a deep link or a double-click cannot open more than the viewer
 * holds; a control the viewer cannot use is absent, not disabled.
 *
 * Files go through `useProductionUploads`: one request per file, and a file that fails stays on the
 * phone with Retry. Closing while any are still waiting asks first.
 */
export default function ProductionShootPanel({ shootId, canWrite, onClose, onChanged }) {
  const [tab, setTab] = useState("plan");
  const [detail, setDetail] = useState(null);
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState(() => productionPlanForm(null));
  const [error, setError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const { busy, run } = useSubmitOnce();
  const update = useCallback((field, value) => setForm((current) => ({ ...current, [field]: value })), []);

  const load = useCallback(async () => {
    try {
      const [shootResponse, optionsResponse] = await Promise.all([getProductionShoot(shootId), getProductionOptions(shootId)]);
      setDetail(shootResponse?.data || null);
      setForm(productionPlanForm(shootResponse?.data));
      setOptions(optionsResponse?.data || null);
    } catch (loadError) {
      setError(loadError.message || "Unable to load this shoot.");
    }
  }, [shootId]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const planEditable = Boolean(canWrite && detail?.canEditPlan);
  const stepsRunnable = Boolean(canWrite && detail?.canRunSteps);
  const done = detail?.execution?.currentStep === "DONE";

  const applyDetail = useCallback((next, message) => {
    if (!next) return;
    setDetail(next);
    setForm(productionPlanForm(next));
    onChanged?.(message);
  }, [onChanged]);

  // Each file that lands refreshes the shoot quietly; the queue itself says how many are left.
  const uploads = useProductionUploads(shootId, useCallback((next) => applyDetail(next), [applyDetail]));

  const removeFile = useCallback(async (file) => {
    setError("");
    try {
      const response = await removeProductionFile(shootId, file.id);
      applyDetail(response?.data, `${file.fileName} removed.`);
    } catch (removeError) {
      setError(removeError.message || "Unable to remove the file.");
    }
  }, [applyDetail, shootId]);

  const requestClose = useCallback(() => (uploads.pending ? setConfirmClose(true) : onClose()), [onClose, uploads.pending]);

  const context = useMemo(() => {
    const lists = productionPlanOptions(options || {}, detail);
    const tickets = (detail?.files || []).filter((file) => file.kind === "TICKET");
    const multi = (label, list, placeholder) => ({ values, onChange, field }) => <MultiSelectField
      label={label}
      options={list}
      values={values[field.name] || []}
      onChange={onChange}
      placeholder={placeholder}
      searchable
      readOnly={!planEditable}
    />;
    return {
      options: { employees: lists.employees, travelModes: lists.travelModes },
      renderers: {
        teamEmployeeIds: multi("Production Team", lists.employees, "Select team members"),
        cameraAssetIds: multi("Cameras", lists.cameras, "Select cameras (optional)"),
        serviceAllocationIds: multi("Services", lists.services, "Select this shoot's services"),
        exposureVendorIds: multi("Exposure", lists.vendors, "Select vendors"),
        tickets: () => <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold text-slate-600 sm:text-xs">Tickets</span>
          <ProductionFileList files={tickets} canRemove={planEditable && !done} onRemove={removeFile} emptyText="No tickets added." />
          <ProductionUploadQueue queue={uploads.queue} kind="TICKET" onRetry={uploads.retry} onDiscard={uploads.discard} />
          {planEditable && !done && tickets.length < 10 && <FileUploadField
            label="Add tickets"
            value={[]}
            onChange={(files) => uploads.add("TICKET", files)}
            accept="application/pdf,image/jpeg,image/png,image/webp"
            maxFiles={10 - tickets.length}
          />}
        </div>,
      },
    };
  }, [detail, done, options, planEditable, removeFile, uploads]);

  async function submit(event) {
    event.preventDefault();
    if (tab !== "plan" || !planEditable) return;
    const submitting = event.nativeEvent?.submitter?.value === "submit";
    await run(async () => {
      setError("");
      try {
        const response = await saveProductionPlan(shootId, productionPlanPayload(form, submitting));
        applyDetail(response?.data, submitting ? "Plan submitted." : "Plan saved.");
      } catch (saveError) {
        setError(saveError.message || "Unable to save the plan.");
      }
    });
  }

  const submitted = Boolean(detail?.plan?.planSubmittedAt);
  const onPlan = tab === "plan";
  const footer = <>
    <Button className="max-sm:flex-1" size="lg" type="button" onClick={requestClose} disabled={busy}>Close</Button>
    {onPlan && planEditable && <Button className="ml-auto max-sm:flex-1" size="lg" type="submit" value="save" busy={busy} busyLabel="Saving...">{submitted ? "Save" : "Save draft"}</Button>}
    {onPlan && planEditable && !submitted && <Button className="max-sm:flex-1" size="lg" type="submit" value="submit" variant="primary" busy={busy} busyLabel="Submitting...">Submit plan</Button>}
  </>;

  const title = detail ? `${detail.shootId || "Shoot"} — ${detail.shoot || "Production"}` : "Production";
  const description = detail ? [detail.clientName || detail.eventId, formatDay(detail.shootDate), detail.pending].filter(Boolean).join(" · ") : undefined;

  return <>
    <SchemaFormPanel
      title={title}
      description={description}
      tabs={<Tabs tabs={TABS} value={tab} onChange={setTab} ariaLabel="Production shoot sections" />}
      loading={!detail && !error}
      loadingLabel="Loading shoot..."
      readOnly={onPlan && !planEditable}
      sections={onPlan ? productionPlanSections : []}
      values={form}
      onChange={update}
      context={context}
      sidebarAriaLabel="Production plan sections"
      closeAriaLabel="Close production shoot"
      onClose={requestClose}
      onSubmit={submit}
      validateRequired={false}
      error={error}
      saving={busy}
      footer={footer}
    >
      {detail && tab === "execution" && <ProductionExecutionTab
        shootId={shootId}
        detail={detail}
        options={options}
        canRunSteps={stepsRunnable}
        uploads={uploads}
        onDetail={applyDetail}
        onError={setError}
        onRemoveFile={removeFile}
      />}
      {detail && tab === "activity" && <ProductionActivityTab shootId={shootId} refreshKey={detail.updatedAt} onError={setError} />}
    </SchemaFormPanel>
    <ConfirmDialog
      open={confirmClose}
      layer="dialogOverPanel"
      primaryAction="cancel"
      title="Files still uploading"
      message={`${uploads.pending} file${uploads.pending === 1 ? " has" : "s have"} not reached the server yet. Closing now loses ${uploads.pending === 1 ? "it" : "them"}.`}
      cancelLabel="Stay"
      confirmLabel="Close anyway"
      onCancel={() => setConfirmClose(false)}
      onConfirm={() => { setConfirmClose(false); onClose(); }}
    />
  </>;
}
```

`uploads` is a new object each render, so the `context` memo recomputes on every render; that is acceptable here (a handful of fields). If React Compiler or a profiler flags it, depend on `uploads.queue`, `uploads.add`, `uploads.retry` and `uploads.discard` instead.

- [ ] **Step 14: Run tests and lint**

Run: `cd frontend && node --test test/production-uploads.test.mjs test/production-page-wiring.test.mjs test/step-rail-shared.test.mjs && npm run lint && npm test`
Expected: all pass; lint clean.

- [ ] **Step 15: Walk it on a phone first** — at **360px** (then a real phone on the office Wi-Fi if you can), as the coordinator on a submitted plan: the rail is a pill row; Confirm sits in the bottom bar and is thumb-sized; Started from studio and Reached shoot place each ask once, then complete. At Pineapple meeting, **Take photos** comes first — take one, write remarks, Complete from the bottom bar. At Shoot started, add three photos with the browser's network throttled to "Slow 3G": the queue shows "Uploading… N left" and the photos appear one by one. Switch the network **offline** mid-upload: the unsent photos show "not uploaded … still on this phone" with Retry; go back online, Retry, they land. Try to close with one still failed: the panel asks first. Set Paused, then Completed; confirm Reached studio; fill Photo copy → the pill reads Done. As the manager: add a ticket PDF and open it with one tap. As a READ-only viewer: everything reads back, no Confirm / Complete / Remove / Retry. Then 768 and 1280 px: the rail moves beside the step, the bar sits back in the form, nothing scrolls the page sideways, and nothing appears only on hover.

- [ ] **Step 16: Stage for review (do NOT commit — the user commits)**

```bash
git add frontend/src/lib/productionUploads.mjs frontend/src/components/shared/StickyActionBar.js frontend/src/components/shared/MultiImageField.js frontend/src/components/project-management/production frontend/src/constants/productionFormConfig.js frontend/test/production-uploads.test.mjs frontend/test/production-page-wiring.test.mjs
```

---

# Phase 3 — WhatsApp group link, templates, sending, retry

### Task 14: Sending the three messages, and retry

**Files:**
- Modify: `backend/src/services/messageTemplate.js` (`TEMPLATE_KEYS`)
- Create: `backend/src/modules/project-management/production/messages.js`
- Modify: `backend/src/modules/project-management/production/controller.js` (`stepDeps`, retry route), `routes.js`
- Test: `backend/test/project-production-messages.test.js`

**Interfaces:**
- Consumes: `getTemplate`, `renderTemplate`, `TEMPLATE_KEYS` (`services/messageTemplate.js`); `sessionManager.sendMessageToGroup({ userId, jid, body })` (`sales/whatsapp-chat/sessionManager.js:1492`); `repository.isChatEnabled()`, `isChatEnabledForUser(userId)` (`sales/whatsapp-chat/repository.js:192,310`); `completeStep`/`changeShootStatus` `deps.notify` (Task 11).
- Produces: `sendStepMessage(productionId, messageStep, caller, deps) → { step, status: "SENT"|"FAILED", error, sentAt }`; `retryMessage(shootId, messageStep, caller, deps) → { productionId, message }`; `messageValues(production)`; HTTP `POST /shoots/:shootId/messages/:step/retry` → `{ data: detail, message }`.

- [ ] **Step 1: Write the failing test** `backend/test/project-production-messages.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { completeStep } = require("../src/modules/project-management/production/execution");
const { sendStepMessage, retryMessage, messageValues } = require("../src/modules/project-management/production/messages");
const { createProductionFake, productionRow, coordinator, manager } = require("./production-fake-client");

const switchesOn = () => ({ isChatEnabled: async () => true, isChatEnabledForUser: async () => true });
const sessionsThat = (behaviour) => () => ({ sendMessageToGroup: behaviour });

test("a sent message goes from the linker's WhatsApp into the linked group and is recorded", async () => {
  const client = createProductionFake({ productions: [productionRow()] });
  const sends = [];
  const result = await sendStepMessage("prod-1", "STARTED_FROM_STUDIO", coordinator, { client, switches: switchesOn, sessions: sessionsThat(async (args) => { sends.push(args); return {}; }), now: () => new Date("2026-10-02T02:00:00Z") });
  assert.equal(result.status, "SENT");
  assert.equal(sends[0].userId, 30);
  assert.equal(sends[0].jid, "120363012345678901@g.us");
  assert.match(sends[0].body, /Reception/);
  assert.deepEqual(client.state.messages[0], { productionId: "prod-1", step: "STARTED_FROM_STUDIO", status: "SENT", error: null, sentAt: new Date("2026-10-02T02:00:00Z"), sentFromUserId: 30 });
  assert.equal(client.state.activities.at(-1).action, "WHATSAPP_SENT");
});

test("a failed send still completes the step and records FAILED", async () => {
  const client = createProductionFake({ productions: [productionRow()] });
  const failing = sessionsThat(async () => { throw Object.assign(new Error("WhatsApp is not connected. Scan the QR code to link your WhatsApp."), { status: 409, code: "WHATSAPP_NOT_CONNECTED" }); });
  const deps = { client, switches: switchesOn, sessions: failing, notify: sendStepMessage };
  const { message } = await completeStep("shoot-1", "STARTED_FROM_STUDIO", {}, coordinator, deps);
  assert.equal(client.state.productions[0].currentStep, "REACHED_SHOOT_PLACE");
  assert.equal(message.status, "FAILED");
  assert.match(client.state.messages[0].error, /not connected/);
  assert.deepEqual(client.state.activities.map((entry) => entry.action), ["STEP_COMPLETED", "WHATSAPP_FAILED"]);
});

test("no linked group records FAILED with the reason, and nothing is sent", async () => {
  const client = createProductionFake({ productions: [productionRow({ salesProject: { productionManagerEmployeeId: 5, whatsappGroupJid: null, whatsappGroupLinkedByUserId: null } })] });
  let sent = false;
  const result = await sendStepMessage("prod-1", "REACHED_SHOOT_PLACE", coordinator, { client, switches: switchesOn, sessions: sessionsThat(async () => { sent = true; }) });
  assert.equal(result.status, "FAILED");
  assert.match(result.error, /No WhatsApp group/);
  assert.equal(sent, false);
});

test("WhatsApp switched off for the studio is a FAILED send, not a crash", async () => {
  const client = createProductionFake({ productions: [productionRow()] });
  const result = await sendStepMessage("prod-1", "SHOOT_COMPLETED", coordinator, { client, switches: () => ({ isChatEnabled: async () => false, isChatEnabledForUser: async () => true }), sessions: sessionsThat(async () => {}) });
  assert.equal(result.status, "FAILED");
});

test("retry sends a failed message once more; there is nothing to retry after it goes", async () => {
  const client = createProductionFake({ productions: [productionRow({ currentStep: "REACHED_SHOOT_PLACE" })], messages: [{ productionId: "prod-1", step: "STARTED_FROM_STUDIO", status: "FAILED", error: "x" }] });
  const deps = { client, switches: switchesOn, sessions: sessionsThat(async () => ({})) };
  const { message } = await retryMessage("shoot-1", "STARTED_FROM_STUDIO", coordinator, deps);
  assert.equal(message.status, "SENT");
  assert.deepEqual(client.state.activities.map((entry) => entry.action), ["WHATSAPP_RETRIED", "WHATSAPP_SENT"]);
  await assert.rejects(retryMessage("shoot-1", "STARTED_FROM_STUDIO", coordinator, deps), (error) => error.status === 409);
});

test("only the coordinator retries, and only a known message", async () => {
  const client = createProductionFake({ productions: [productionRow()], messages: [{ productionId: "prod-1", step: "STARTED_FROM_STUDIO", status: "FAILED" }] });
  await assert.rejects(retryMessage("shoot-1", "STARTED_FROM_STUDIO", manager, { client }), (error) => error.status === 403);
  await assert.rejects(retryMessage("shoot-1", "PINEAPPLE", coordinator, { client }), (error) => error.status === 400);
});

test("the placeholders are filled from the shoot", () => {
  const values = messageValues(productionRow({ shoot: { shoot: "Reception", dateCreated: new Date("2026-10-02T00:00:00Z"), shootPlace: "Erode", district: "Erode", preProduction: { locationAddress: "Hall A" } } }));
  assert.equal(values["project name"], "Asha weds Arun");
  assert.equal(values.location, "Hall A, Erode");
  assert.equal(values.coordinator, "Ravi");
  assert.equal(values.date, "02 Oct 2026");
});
```

- [ ] **Step 2: Run to fail**

Run: `cd backend && node --test test/project-production-messages.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the template keys** — in `backend/src/services/messageTemplate.js`, inside `TEMPLATE_KEYS` add:

```js
  // The three production messages, posted to the project's WhatsApp group by the coordinator's
  // steps (project-management/production/messages.js). Sent, not copy-and-send.
  PRODUCTION_STARTED_FROM_STUDIO: "PRODUCTION_STARTED_FROM_STUDIO",
  PRODUCTION_REACHED_SHOOT_PLACE: "PRODUCTION_REACHED_SHOOT_PLACE",
  PRODUCTION_SHOOT_COMPLETED: "PRODUCTION_SHOOT_COMPLETED",
```

- [ ] **Step 4: Implement** `backend/src/modules/project-management/production/messages.js`:

```js
const prisma = require("../../../config/db");
const { STUDIO_TIME_ZONE } = require("../../../services/studioTime");
const { getTemplate, renderTemplate, TEMPLATE_KEYS } = require("../../../services/messageTemplate");
const { accessFor, loadForWrite, fail } = require("./access");
const { logActivity } = require("./activity");
const S = require("./steps");

/*
 * The three production messages, posted into the project's WhatsApp group.
 *
 * Sent from **the linker's** own paired WhatsApp (`SalesProject.whatsappGroupLinkedByUserId`),
 * through `sendMessageToGroup`, which paces and shows typing. One message per step, each triggered
 * by a person completing the step - nothing scheduled, nothing bulk. Both WhatsApp chat switches
 * are honoured, as every other send path does.
 *
 * A failed send never blocks the step: the reason is kept on the message row as FAILED and the
 * coordinator can retry it. The wording is the studio's (Settings → Templates); the defaults below
 * are what the migration seeded, used only if the row has been deleted.
 */
const TEMPLATE_FOR = {
  STARTED_FROM_STUDIO: TEMPLATE_KEYS.PRODUCTION_STARTED_FROM_STUDIO,
  REACHED_SHOOT_PLACE: TEMPLATE_KEYS.PRODUCTION_REACHED_SHOOT_PLACE,
  SHOOT_COMPLETED: TEMPLATE_KEYS.PRODUCTION_SHOOT_COMPLETED,
};
const DEFAULT_BODIES = {
  STARTED_FROM_STUDIO: "Hi, our team has started from the studio for {shoot} on {date}.\nProject: {project name}\nLocation: {location}\nProduction Coordinator: {coordinator}",
  REACHED_SHOOT_PLACE: "Hi, our team has reached {location} for {shoot} ({date}).\nProduction Coordinator: {coordinator}",
  SHOOT_COMPLETED: "Hi, {shoot} for {project name} on {date} is complete. Thank you!\nProduction Coordinator: {coordinator}",
};
const MAX_ERROR_CHARS = 1000;

// Lazily, so tests hand in stand-ins and a server without WhatsApp does not load it.
const defaultSessions = () => require("../../sales/whatsapp-chat/sessionManager");
const defaultSwitches = () => require("../../sales/whatsapp-chat/repository");

const MESSAGE_SELECT = {
  id: true,
  shoot: { select: { shoot: true, dateCreated: true, shootPlace: true, district: true, preProduction: { select: { locationAddress: true } } } },
  salesProject: { select: { eventId: true, whatsappGroupName: true, whatsappGroupJid: true, whatsappGroupLinkedByUserId: true } },
  productionCoordinatorEmployee: { select: { employeeName: true } },
};

function formatDay(value) {
  if (!value) return "a date to be confirmed";
  return new Intl.DateTimeFormat("en-GB", { timeZone: STUDIO_TIME_ZONE, day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function messageValues(production) {
  const { shoot = {}, salesProject = {} } = production || {};
  return {
    "project name": salesProject.whatsappGroupName || salesProject.eventId || "",
    shoot: shoot.shoot || "",
    date: formatDay(shoot.dateCreated),
    location: [shoot.preProduction?.locationAddress || shoot.shootPlace, shoot.district].filter(Boolean).join(", "),
    coordinator: production?.productionCoordinatorEmployee?.employeeName || "",
  };
}

async function sendStepMessage(productionId, messageStep, caller, deps = {}) {
  const { client = prisma, sessions = defaultSessions, switches = defaultSwitches, now = () => new Date() } = deps;
  let error = null;
  let senderId = null;
  try {
    const production = await client.projectProduction.findUnique({ where: { id: productionId }, select: MESSAGE_SELECT });
    const project = production?.salesProject;
    if (!project?.whatsappGroupJid) throw new Error("No WhatsApp group is linked to this project. Link one on Pre Production → General.");
    senderId = project.whatsappGroupLinkedByUserId || null;
    if (!senderId) throw new Error("Whoever linked the WhatsApp group no longer has a login. Link the group again.");
    const { isChatEnabled, isChatEnabledForUser } = switches();
    if (!(await isChatEnabled())) throw new Error("WhatsApp chat is switched off for the studio.");
    if (!(await isChatEnabledForUser(senderId))) throw new Error("WhatsApp chat is switched off for whoever linked the group.");
    const template = await getTemplate(TEMPLATE_FOR[messageStep], client).catch(() => null);
    const body = renderTemplate(template?.body || DEFAULT_BODIES[messageStep], messageValues(production));
    await sessions().sendMessageToGroup({ userId: senderId, jid: project.whatsappGroupJid, body });
  } catch (sendError) {
    error = String(sendError?.message || "The WhatsApp message could not be sent.").slice(0, MAX_ERROR_CHARS);
  }

  const fields = { status: error ? "FAILED" : "SENT", error, sentAt: error ? null : now(), sentFromUserId: senderId };
  await client.projectProductionMessage.upsert({
    where: { productionId_step: { productionId, step: messageStep } },
    create: { productionId, step: messageStep, ...fields },
    update: fields,
  });
  await logActivity(client, productionId, error ? "WHATSAPP_FAILED" : "WHATSAPP_SENT", error ? `${S.MESSAGE_LABELS[messageStep]}: ${error}` : S.MESSAGE_LABELS[messageStep], caller);
  return { step: messageStep, status: fields.status, error, sentAt: fields.sentAt };
}

/**
 * Sends a FAILED message once more. Claimed first (FAILED → SENDING), so two presses cannot both
 * send; the send then settles it on SENT or back on FAILED.
 */
async function retryMessage(shootId, messageStep, caller, deps = {}) {
  const { client = prisma } = deps;
  if (!S.MESSAGE_STEPS.includes(messageStep)) throw fail(400, "Unknown message.");
  const production = await loadForWrite(client, shootId);
  if (!accessFor(production, caller).canRunSteps) throw fail(403, "Only this shoot's Production Coordinator can retry its messages.");
  const { count } = await client.projectProductionMessage.updateMany({ where: { productionId: production.id, step: messageStep, status: "FAILED" }, data: { status: "SENDING" } });
  if (!count) throw fail(409, "There is no failed message to retry for this step.");
  await logActivity(client, production.id, "WHATSAPP_RETRIED", S.MESSAGE_LABELS[messageStep], caller);
  return { productionId: production.id, message: await sendStepMessage(production.id, messageStep, caller, deps) };
}

module.exports = { TEMPLATE_FOR, DEFAULT_BODIES, messageValues, sendStepMessage, retryMessage };
```

- [ ] **Step 5: Wire it in** — in `controller.js` replace `const stepDeps = {};` with:

```js
const { sendStepMessage, retryMessage } = require("./messages");

/** A step's WhatsApp message is sent after its transaction, from the group's linker. */
const stepDeps = { notify: sendStepMessage };

async function retryMessageRoute(req, res) {
  try {
    const { message } = await retryMessage(req.params.shootId, req.params.step, await callerOf(req.user.id));
    return res.json({ data: await read.getShoot(req.user.id, req.params.shootId), message });
  } catch (error) { return respond(res, error, "Unable to retry the message."); }
}
```

export `retryMessage: retryMessageRoute`, and in `routes.js` add:

```js
router.post("/shoots/:shootId/messages/:step/retry", controller.retryMessage);
```

- [ ] **Step 6: Run to pass**

Run: `cd backend && node --test test/project-production-messages.test.js test/project-production-execution.test.js && npm test`
Expected: all pass.

- [ ] **Step 7: Stage for review (do NOT commit — the user commits)**

```bash
git add backend/src/services/messageTemplate.js backend/src/modules/project-management/production/messages.js backend/src/modules/project-management/production/controller.js backend/src/modules/project-management/production/routes.js backend/test/project-production-messages.test.js
```

---

### Task 15: Linking the project's WhatsApp group (backend)

**Files:**
- Create: `backend/src/modules/project-management/pre-production/whatsappGroup.js`
- Modify: `backend/src/modules/project-management/pre-production/controller.js` (`projectSelect`, `toRow`, two handlers, exports)
- Modify: `backend/src/modules/project-management/pre-production/routes.js`
- Test: `backend/test/pre-production-whatsapp-group.test.js`

**Interfaces:**
- Consumes: `sessionManager.listGroups(userId) → [{ jid, subject, participantCount }]` (`sessionManager.js:1470`; throws 409 `WHATSAPP_NOT_CONNECTED`).
- Produces: `projectGroupChoices(projectId, userId, deps) → { groups: [{ jid, subject, participantCount, linked, matchesProject }], suggestedJid }`; `linkProjectGroup(projectId, userId, jid, deps) → { projectId, jid, subject, linkedAt }`; HTTP `GET /api/project-management/pre-production/projects/:projectId/whatsapp-groups`, `PATCH …/projects/:projectId/whatsapp-group` (`{ jid }`); pre-production rows gain `whatsappGroupJid`, `whatsappGroupSubject`, `whatsappGroupLinkedAt`, `whatsappGroupLinkedBy`.

- [ ] **Step 1: Write the failing test** `backend/test/pre-production-whatsapp-group.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { projectGroupChoices, linkProjectGroup } = require("../src/modules/project-management/pre-production/whatsappGroup");
const { createProductionFake } = require("./production-fake-client");

const groups = [
  { jid: "111111111111111111@g.us", subject: "Asha Weds  Arun", participantCount: 12 },
  { jid: "222222222222222222@g.us", subject: "Studio crew", participantCount: 8 },
];
const sessions = () => ({ listGroups: async () => groups });

test("the caller's groups are listed, with the one named like the project chosen by default", async () => {
  const client = createProductionFake({ projects: [{ id: "p-1", eventId: "DBS-EV-1", whatsappGroupName: "asha weds arun", whatsappGroupJid: null }] });
  const result = await projectGroupChoices("p-1", 21, { client, sessions });
  assert.equal(result.suggestedJid, "111111111111111111@g.us");
  assert.equal(result.groups[0].matchesProject, true);
});

test("a group jid not in the caller's own groups is rejected", async () => {
  const client = createProductionFake({ projects: [{ id: "p-1", eventId: "DBS-EV-1", whatsappGroupName: "Asha" }] });
  await assert.rejects(linkProjectGroup("p-1", 21, "999999999999999999@g.us", { client, sessions }), (error) => error.status === 400 && error.code === "NOT_IN_GROUP");
});

test("linking stores the jid, the subject, who linked it and when", async () => {
  const project = { id: "p-1", eventId: "DBS-EV-1", whatsappGroupName: "Asha" };
  const client = createProductionFake({ projects: [project] });
  await linkProjectGroup("p-1", 21, "111111111111111111@g.us", { client, sessions, now: () => new Date("2026-09-30T06:00:00Z") });
  assert.equal(project.whatsappGroupJid, "111111111111111111@g.us");
  assert.equal(project.whatsappGroupSubject, "Asha Weds  Arun");
  assert.equal(project.whatsappGroupLinkedByUserId, 21);
  assert.deepEqual(project.whatsappGroupLinkedAt, new Date("2026-09-30T06:00:00Z"));
});

test("a group already linked to another live project is refused", async () => {
  const client = createProductionFake({ projects: [
    { id: "p-1", eventId: "DBS-EV-1", whatsappGroupName: "Asha" },
    { id: "p-2", eventId: "DBS-EV-2", whatsappGroupName: "Other", whatsappGroupJid: "111111111111111111@g.us" },
  ] });
  await assert.rejects(linkProjectGroup("p-1", 21, "111111111111111111@g.us", { client, sessions }), (error) => error.status === 409 && error.code === "GROUP_TAKEN");
});

test("a disconnected WhatsApp says so rather than listing nothing", async () => {
  const client = createProductionFake({ projects: [{ id: "p-1", eventId: "DBS-EV-1", whatsappGroupName: "Asha" }] });
  const offline = () => ({ listGroups: async () => { throw Object.assign(new Error("WhatsApp is not connected."), { status: 409, code: "WHATSAPP_NOT_CONNECTED" }); } });
  await assert.rejects(projectGroupChoices("p-1", 21, { client, sessions: offline }), (error) => error.status === 409);
});

test("a project that does not exist is not found", async () => {
  await assert.rejects(projectGroupChoices("nope", 21, { client: createProductionFake(), sessions }), (error) => error.status === 404);
});
```

- [ ] **Step 2: Run to fail**

Run: `cd backend && node --test test/pre-production-whatsapp-group.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `backend/src/modules/project-management/pre-production/whatsappGroup.js`:

```js
const prisma = require("../../../config/db");

/*
 * The project's WhatsApp group, linked on Pre Production → General.
 *
 * Offered from the linker's own paired WhatsApp (`listGroups`), with the group named like the
 * project chosen by default. The jid from the browser is trusted for nothing: it is linked only if
 * the caller's WhatsApp actually answered for that group, and never to a group another live project
 * already holds - one client's messages must not land in another client's chat. Production then
 * sends into it from this linker's WhatsApp.
 */
const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const nameKey = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const defaultSessions = () => require("../../sales/whatsapp-chat/sessionManager");

async function liveProject(client, projectId) {
  const project = await client.salesProject.findFirst({
    where: { id: String(projectId || ""), deletedAt: null },
    select: { id: true, eventId: true, whatsappGroupName: true, whatsappGroupJid: true },
  });
  if (!project) throw fail(404, "Project not found.");
  return project;
}

async function projectGroupChoices(projectId, userId, { client = prisma, sessions = defaultSessions } = {}) {
  const project = await liveProject(client, projectId);
  const wanted = nameKey(project.whatsappGroupName);
  const groups = (await sessions().listGroups(userId)).map((group) => ({
    ...group,
    linked: group.jid === project.whatsappGroupJid,
    matchesProject: Boolean(wanted) && nameKey(group.subject) === wanted,
  }));
  const suggested = groups.find((group) => group.linked) || groups.find((group) => group.matchesProject) || null;
  return { groups, suggestedJid: suggested?.jid || null };
}

async function linkProjectGroup(projectId, userId, jid, { client = prisma, sessions = defaultSessions, now = () => new Date() } = {}) {
  const wanted = String(jid || "").trim();
  if (!wanted) throw fail(400, "Choose a WhatsApp group.");
  const project = await liveProject(client, projectId);
  const group = (await sessions().listGroups(userId)).find((entry) => entry.jid === wanted);
  if (!group) throw fail(400, "Your WhatsApp is not in that group. Refresh the list and choose again.", "NOT_IN_GROUP");
  const holder = await client.salesProject.findFirst({ where: { whatsappGroupJid: group.jid, deletedAt: null, id: { not: project.id } }, select: { eventId: true } });
  if (holder) throw fail(409, `That group is already linked to project ${holder.eventId}.`, "GROUP_TAKEN");
  const linkedAt = now();
  await client.salesProject.update({
    where: { id: project.id },
    data: {
      whatsappGroupJid: group.jid,
      whatsappGroupSubject: String(group.subject || "").slice(0, 500) || null,
      whatsappGroupLinkedByUserId: Number(userId) || null,
      whatsappGroupLinkedAt: linkedAt,
    },
  });
  return { projectId: project.id, jid: group.jid, subject: group.subject || null, linkedAt };
}

module.exports = { projectGroupChoices, linkProjectGroup };
```

- [ ] **Step 4: Handlers, routes and row fields** — in `pre-production/controller.js`:

Add after the other requires:
```js
const { projectGroupChoices, linkProjectGroup } = require("./whatsappGroup");
```

In `projectSelect` (after `projectStatus: true,`) add:
```js
  // The project's WhatsApp group, which production messages are sent into.
  whatsappGroupJid: true,
  whatsappGroupSubject: true,
  whatsappGroupLinkedAt: true,
  whatsappGroupLinkedByUser: { select: { name: true } },
```

In `toRow` (after `projectStatus: project.projectStatus,`) add:
```js
    whatsappGroupJid: project.whatsappGroupJid,
    whatsappGroupSubject: project.whatsappGroupSubject,
    whatsappGroupLinkedAt: project.whatsappGroupLinkedAt,
    whatsappGroupLinkedBy: project.whatsappGroupLinkedByUser?.name || null,
```

Before `module.exports` add:
```js
const whatsappGroupLinkSchema = z.object({ jid: z.string().trim().min(1).max(64) }).strict();

/** The caller's own WhatsApp groups, for the General panel's picker. */
async function listWhatsappGroups(req, res) {
  try {
    return res.json({ data: await projectGroupChoices(req.params.projectId, req.user.id) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message, ...(error.code ? { code: error.code } : {}) });
    console.error("Unable to list WhatsApp groups:", error);
    return res.status(500).json({ message: "Unable to read your WhatsApp groups." });
  }
}

/** Link one of them to the project; production sends from this caller's WhatsApp from now on. */
async function linkWhatsappGroup(req, res) {
  const parsed = whatsappGroupLinkSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });
  try {
    return res.json({ data: await linkProjectGroup(req.params.projectId, req.user.id, parsed.data.jid) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message, ...(error.code ? { code: error.code } : {}) });
    console.error("Unable to link the WhatsApp group:", error);
    return res.status(500).json({ message: "Unable to link the WhatsApp group." });
  }
}
```
and add `listWhatsappGroups, linkWhatsappGroup` to `module.exports`.

In `pre-production/routes.js`, after the `general` route:
```js
// The project's WhatsApp group, picked from the caller's own paired WhatsApp. Under PROJECT /
// Pre Production like the rest of General: reading the list needs READ, linking READ_WRITE.
router.get("/projects/:projectId/whatsapp-groups", controller.listWhatsappGroups);
router.patch("/projects/:projectId/whatsapp-group", controller.linkWhatsappGroup);
```

- [ ] **Step 5: Run to pass**

Run: `cd backend && node --test test/pre-production-whatsapp-group.test.js test/project-pre-production.test.js && npm test`
Expected: all pass.

- [ ] **Step 6: Stage for review (do NOT commit — the user commits)**

```bash
git add backend/src/modules/project-management/pre-production/whatsappGroup.js backend/src/modules/project-management/pre-production/controller.js backend/src/modules/project-management/pre-production/routes.js backend/test/pre-production-whatsapp-group.test.js
```

---

### Task 16: WhatsApp group field, "Not sent · Retry", Settings templates (frontend)

**Files:**
- Modify: `frontend/src/services/project-management/pre-production.service.js`
- Create: `frontend/src/components/project-management/ProjectWhatsappGroupField.js`
- Modify: `frontend/src/components/project-management/PreProductionGeneral.js` (sections ~203-261, renderers ~264-306)
- Create: `frontend/src/components/project-management/production/ProductionMessageStatus.js`
- Modify: `frontend/src/components/project-management/production/ProductionStepForm.js`
- Modify: `frontend/src/components/settings/MessageTemplatePanel.js:30-55`, `frontend/src/components/settings/SettingsOverlay.js:~809-821`
- Test: `frontend/test/production-page-wiring.test.mjs` (append)

**Interfaces:**
- Consumes: HTTP from Tasks 14-15; `PRODUCTION_MESSAGE_PLACEHOLDERS`, `messageFor`, `MESSAGE_STEP_FOR` (Task 8).
- Produces: `getPreProductionWhatsappGroups(projectId)`, `linkPreProductionWhatsappGroup(projectId, jid)`; `<ProjectWhatsappGroupField project canWrite onLinked />`; `<ProductionMessageStatus shootId message canRetry onDetail onError />`.

- [ ] **Step 1: Append the failing test** to `frontend/test/production-page-wiring.test.mjs`:

```js
test("General links the group, the step shows Not sent · Retry, Settings offers the three templates", () => {
  assert.match(read("components/project-management/PreProductionGeneral.js"), /ProjectWhatsappGroupField/);
  assert.match(read("components/project-management/production/ProductionStepForm.js"), /ProductionMessageStatus/);
  assert.match(read("components/project-management/production/ProductionMessageStatus.js"), /Not sent/);
  const settings = read("components/settings/SettingsOverlay.js");
  for (const key of ["PRODUCTION_STARTED_FROM_STUDIO", "PRODUCTION_REACHED_SHOOT_PLACE", "PRODUCTION_SHOOT_COMPLETED"]) assert.match(settings, new RegExp(`templateKey="${key}"`));
  assert.match(read("components/settings/MessageTemplatePanel.js"), /PRODUCTION_MESSAGE_PLACEHOLDERS/);
});
```

- [ ] **Step 2: Run to fail**

Run: `cd frontend && node --test test/production-page-wiring.test.mjs`
Expected: FAIL on the new test.

- [ ] **Step 3: Service functions** — append to `frontend/src/services/project-management/pre-production.service.js`:

```js
/** The signed-in person's own WhatsApp groups, with the one named like the project suggested. */
export function getPreProductionWhatsappGroups(projectId) {
  return apiRequest(`/api/project-management/pre-production/projects/${encodeURIComponent(projectId)}/whatsapp-groups`);
}

/** Link one of those groups to the project; production messages are then sent from this person's WhatsApp. */
export function linkPreProductionWhatsappGroup(projectId, jid) {
  return apiRequest(`/api/project-management/pre-production/projects/${encodeURIComponent(projectId)}/whatsapp-group`, {
    method: "PATCH",
    body: JSON.stringify({ jid }),
  });
}
```

- [ ] **Step 4: The group field** `frontend/src/components/project-management/ProjectWhatsappGroupField.js`:

```jsx
"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import PreProductionSummaryGroup from "@/components/project-management/PreProductionSummaryGroup";
import { formatDate } from "@/lib/preProductionFormat";
import { getPreProductionWhatsappGroups, linkPreProductionWhatsappGroup } from "@/services/project-management/pre-production.service";

/**
 * The project's WhatsApp group, on General. The groups are read from WhatsApp only when somebody
 * presses Choose group - never on opening the panel - and the one named like the project is chosen
 * by default. Production messages are sent from the WhatsApp of whoever links it, which the field
 * says, so nobody links a group from a phone they do not mean to send from.
 */
export default function ProjectWhatsappGroupField({ project, canWrite, onLinked }) {
  const [groups, setGroups] = useState(null);
  const [chosen, setChosen] = useState("");
  const [error, setError] = useState("");
  const reading = useSubmitOnce();
  const linking = useSubmitOnce();

  async function loadGroups() {
    await reading.run(async () => {
      setError("");
      try {
        const response = await getPreProductionWhatsappGroups(project.projectId);
        setGroups(response?.data?.groups || []);
        setChosen(response?.data?.suggestedJid || "");
      } catch (requestError) {
        setError(requestError.message || "Unable to read your WhatsApp groups.");
      }
    });
  }

  async function link() {
    await linking.run(async () => {
      setError("");
      try {
        await linkPreProductionWhatsappGroup(project.projectId, chosen);
        setGroups(null);
        await onLinked?.("WhatsApp group linked.");
      } catch (requestError) {
        setError(requestError.message || "Unable to link the WhatsApp group.");
      }
    });
  }

  return <div className="flex min-w-0 flex-col gap-3">
    <PreProductionSummaryGroup rows={[
      ["Linked Group", project.whatsappGroupSubject],
      ["Linked By", project.whatsappGroupLinkedBy],
      ["Linked On", project.whatsappGroupLinkedAt ? formatDate(project.whatsappGroupLinkedAt) : null],
    ]} />
    {canWrite && !groups && <Button type="button" size="lg" className="self-start max-sm:w-full" busy={reading.busy} busyLabel="Reading your groups..." onClick={() => void loadGroups()}>
      {project.whatsappGroupJid ? "Change group" : "Choose group"}
    </Button>}
    {canWrite && groups && <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
      <Dropdown
        label="WhatsApp group"
        value={chosen}
        onChange={setChosen}
        options={groups.map((group) => ({ value: group.jid, label: `${group.subject || group.jid}${group.matchesProject ? " (matches project)" : ""}` }))}
        placeholder={groups.length ? "Select group" : "Your WhatsApp is in no groups"}
        className="min-w-0 flex-1"
      />
      <Button type="button" variant="primary" size="lg" className="max-sm:w-full" disabled={!chosen} busy={linking.busy} busyLabel="Linking..." onClick={() => void link()}>Link group</Button>
    </div>}
    {canWrite && <p className="text-xs text-slate-500">Production messages for this project are sent from the WhatsApp of whoever links the group.</p>}
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
  </div>;
}
```

- [ ] **Step 5: Put it on General** — in `PreProductionGeneral.js`:

Add import:
```js
import ProjectWhatsappGroupField from "@/components/project-management/ProjectWhatsappGroupField";
```
In `sections`, after the `production-manager` section add:
```js
    {
      id: "whatsapp-group",
      title: "WhatsApp Group",
      fields: [{ name: "whatsappGroup", type: "custom", colSpan: 2 }],
    },
```
In `context.renderers` add:
```js
      whatsappGroup: () => <ProjectWhatsappGroupField project={project} canWrite={canWrite} onLinked={onSaved} />,
```
and add `onSaved` to that `useMemo`'s dependency list (`[canWrite, employees, movesFor, onSaved, project, storage]`).

- [ ] **Step 6: The message status** `frontend/src/components/project-management/production/ProductionMessageStatus.js`:

```jsx
"use client";

import Button from "@/components/shared/Button";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import { MESSAGE_LABELS, formatWhen } from "@/lib/productionSteps.mjs";
import { retryProductionMessage } from "@/services/project-management/production.service";

/** How a step's WhatsApp message went: sent, sending, or "Not sent · Retry" with the reason. */
export default function ProductionMessageStatus({ shootId, message, canRetry, onDetail, onError }) {
  const { busy, run } = useSubmitOnce();
  if (message.status === "SENT") return <p className="text-xs text-green-700">WhatsApp sent · {formatWhen(message.sentAt)}</p>;
  if (message.status === "SENDING") return <p className="text-xs text-slate-500">WhatsApp sending…</p>;

  async function retry() {
    await run(async () => {
      onError("");
      try {
        const response = await retryProductionMessage(shootId, message.step);
        onDetail(response?.data, response?.message?.status === "SENT" ? `${MESSAGE_LABELS[message.step]} message sent.` : undefined);
        if (response?.message?.status === "FAILED") onError(response.message.error || "The message was not sent.");
      } catch (error) {
        onError(error.message || "Unable to retry the message.");
      }
    });
  }

  return <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
    <span className="font-semibold">Not sent</span>
    <span className="min-w-0 flex-1 break-words">{message.error}</span>
    {canRetry && <Button type="button" size="lg" className="w-full sm:w-auto" busy={busy} busyLabel="Retrying..." onClick={() => void retry()}>Retry</Button>}
  </div>;
}
```

In `ProductionStepForm.js`: add imports

```js
import ProductionMessageStatus from "@/components/project-management/production/ProductionMessageStatus";
import { messageFor } from "@/lib/productionSteps.mjs";
```

(merge `messageFor` into the existing `@/lib/productionSteps.mjs` import), and directly after the `</header>` add:

```jsx
    {messageStep && messageFor(detail.messages, messageStep) && <ProductionMessageStatus
      shootId={shootId}
      message={messageFor(detail.messages, messageStep)}
      canRetry={canRunSteps}
      onDetail={onDetail}
      onError={onError}
    />}
```

- [ ] **Step 7: Settings → Templates** — in `MessageTemplatePanel.js` add the import

```js
import { PRODUCTION_MESSAGE_PLACEHOLDERS } from "@/lib/productionSteps.mjs";
```

and inside `PLACEHOLDER_HELP_BY_KEY`, after `ATTENDANCE_DAILY_REPORT`:

```js
  // The three production messages, posted to the project's WhatsApp group by the coordinator's steps.
  PRODUCTION_STARTED_FROM_STUDIO: PRODUCTION_MESSAGE_PLACEHOLDERS,
  PRODUCTION_REACHED_SHOOT_PLACE: PRODUCTION_MESSAGE_PLACEHOLDERS,
  PRODUCTION_SHOOT_COMPLETED: PRODUCTION_MESSAGE_PLACEHOLDERS,
```

In `SettingsOverlay.js`, after the `message-attendance-report` child (≈ line 821), add three children written out like it:

```jsx
        // The three production messages, posted to the project's WhatsApp group by the steps.
        {
          id: "message-production-started",
          title: "Production — Started From Studio",
          render: () => <MessageTemplatePanel
            templateKey="PRODUCTION_STARTED_FROM_STUDIO"
            canWrite={canWriteMessageTemplates}
            unsavedRef={messageTemplateUnsavedRef}
            onNotice={setSectionNotice}
            onError={setLinkError}
          />,
        },
        {
          id: "message-production-reached",
          title: "Production — Reached Shoot Place",
          render: () => <MessageTemplatePanel
            templateKey="PRODUCTION_REACHED_SHOOT_PLACE"
            canWrite={canWriteMessageTemplates}
            unsavedRef={messageTemplateUnsavedRef}
            onNotice={setSectionNotice}
            onError={setLinkError}
          />,
        },
        {
          id: "message-production-completed",
          title: "Production — Shoot Completed",
          render: () => <MessageTemplatePanel
            templateKey="PRODUCTION_SHOOT_COMPLETED"
            canWrite={canWriteMessageTemplates}
            unsavedRef={messageTemplateUnsavedRef}
            onNotice={setSectionNotice}
            onError={setLinkError}
          />,
        },
```

- [ ] **Step 8: Run tests and lint**

Run: `cd frontend && node --test test/production-page-wiring.test.mjs && npm run lint && npm test`
Expected: all pass; lint clean.

- [ ] **Step 9: Walk it (one-to-one care: this is the studio's real WhatsApp)** — with a **test group** only: connect your WhatsApp in the chat screen, open Pre Production → a project → General → Choose group; the project-named group is preselected; Link. On Production, confirm Started from studio on a test shoot → one message in the test group. Disconnect WhatsApp, confirm Reached shoot place → the step completes and shows "Not sent · Retry"; reconnect, Retry → sent. Settings → Templates shows the three production messages with their placeholders. Check the General field and the "Not sent · Retry" badge **at 360px first**: Retry is full-width and 44px, the group picker and Link stack.

- [ ] **Step 10: Stage for review (do NOT commit — the user commits)**

```bash
git add frontend/src/services/project-management/pre-production.service.js frontend/src/components/project-management/ProjectWhatsappGroupField.js frontend/src/components/project-management/PreProductionGeneral.js frontend/src/components/project-management/production frontend/src/components/settings/MessageTemplatePanel.js frontend/src/components/settings/SettingsOverlay.js frontend/test/production-page-wiring.test.mjs
```

---

# Phase 4 — Docs, verification, review

### Task 17: READMEs, PROJECT-STATE, CHANGELOG

**Files:**
- Modify: `backend/README.md` (Module Layout ~112-149, Mounted API Surface ~181-247)
- Modify: `frontend/README.md` (Rule 1 component table, the `components/shared/` row ~205)
- Modify: `docs/project-state/PROJECT-STATE.md` (~1999-2004, Project Management Details ~2743-2815, Deferred Work ~2978-2980)
- Modify: `docs/project-state/SALES-AND-PROJECT-MANAGEMENT-WORKFLOW.md` (~522, ~548)
- Modify: `docs/CHANGELOG.md` (top of the first `### Added` under `## Unreleased`)

Read each by section only (`grep -n '^## \|^### '` then `sed -n 'a,bp'`); never whole files.

- [ ] **Step 1: backend/README.md**
  - Module Layout: beside `project-management/ pre-production (…)` (line ~124) add `production (the Production Manager's per-shoot plan and the Production Coordinator's steps)`.
  - Mounted API Surface: under the pre-production row (~201) add a row:

    `| /api/project-management/production | The production board, one row per shoot of a started project with a Production Manager. GET /shoots (dataScope on branch plus the shoots the viewer's name is on), GET /shoots/:shootId (with canEditPlan / canRunSteps), GET /options?shootId= (employees, travel modes, Cameras-category assets, active vendors, this shoot's services), GET /shoots/:shootId/activity, PATCH /shoots/:shootId/plan (save or submit), POST/DELETE /shoots/:shootId/files (tickets: image/PDF via documentStorage; photos via imageStorage; size, count and type limited), POST /shoots/:shootId/steps/:step (strict order), PATCH /shoots/:shootId/shoot-status, POST /shoots/:shootId/messages/:step/retry. Guarded by requireModule("PROJECT", "Production"); who edits is decided by being named (manager = SalesProject.productionManagerEmployeeId, coordinator = the plan's), Super Admin both. Rows are raised by production/service.js beside ensureProjectPreProduction. Three steps post to the project's WhatsApp group from the linker's WhatsApp; a failed send is recorded FAILED and never blocks the step. |`
  - Extend the pre-production row: add `GET /projects/:projectId/whatsapp-groups` and `PATCH /projects/:projectId/whatsapp-group` (`{ jid }`, only a jid in the caller's own listGroups, never a group another live project holds).

- [ ] **Step 2: frontend/README.md** — in the `components/shared/` row add `StickyActionBar` (a screen's primary action held at the bottom of a panel on a phone, back in the form from `md`), note `MultiImageField`'s new `size="lg"` (44px, full-width on a phone), and in the `components/data-table/` row add `RecordCardList` (a table's rows as tappable cards below `md`; `DataTable` has no card mode). Also add `StepRail` (a multi-step rail: vertical from md, a sideways pill row on a phone; `notes` for "✓ who · when" under a step; used by the Events wizard and a production shoot). If the Rule 1 inventory lists module folders, add `components/project-management/production/` (board, shoot panel with Plan / Execution / Activity tabs).

- [ ] **Step 3: PROJECT-STATE.md** — replace the bullet `- Production.` (~2002) with:

  `- Production — one record per shoot, raised once a started project has a Production Manager. The manager saves or submits a per-shoot plan (coordinator, team, travel mode, tickets, cameras, this shoot's services, exposure vendors, remarks); the named Production Coordinator then works seven steps strictly in order (started from studio, reached shoot place, pineapple meeting with a group photo, shoot started with at least two happening-now photos, shoot status, reached studio, photo copy). Every action is logged, and three steps post to the project's WhatsApp group, linked on Pre Production → General and sent from the linker's WhatsApp.`

  In the Pre Production bullet (~1999) and wherever the pre production form's fields are listed, drop "Production Coordinator": it is named on the production plan now.

  Add a short `### Production` subsection under `## Project Management Details` (say it is built for the phone first: cards below `md`, full-screen shoot, bottom action bar, uploads that survive a dropped network) naming the board columns, the pending pill, the three tabs and who may do what. In Deferred Work change `- Detailed production execution.` to `- Moving the project's status automatically when production finishes; reusing the Image Selection group link for production.` and add the follow-up: `- Drop project_pre_production.production_coordinator / production_coordinator_employee_id (deprecated; carried into the production plan) in a migration of its own once every eligible shoot has its production row.`

  In `docs/project-state/SALES-AND-PROJECT-MANAGEMENT-WORKFLOW.md` (read by section) remove "Production Coordinator" from the pre production card's list (~522) and from the form's field list (~548).

- [ ] **Step 4: CHANGELOG** — `grep -n '^### ' docs/CHANGELOG.md | head` to find the first `### Added` under `## Unreleased` (currently line ~1144), and insert at its top:

```markdown
- **Production is a working board: a per-shoot plan for the Production Manager and a step-by-step
  day for the Production Coordinator, with WhatsApp updates to the project's group.** Each shoot of a
  started project that has a Production Manager gets a production record. The manager saves or
  submits the plan; the coordinator named in it works through Started from studio → Reached shoot
  place → Pineapple meeting → Shoot started → Shoot status → Reached studio → Photo copy, strictly in
  order, from the phone. Started from studio, Reached shoot place and Completed post to the project's
  WhatsApp group, which is linked on Pre Production → General and sent from the linker's WhatsApp; a
  failed send never blocks the step and shows "Not sent · Retry". The three message wordings are in
  Settings → Templates. Built for the phone first: cards below tablet width, the shoot full-screen,
  the step's action in a bar at the bottom, and photos that fail to upload stay on the phone with
  Retry. **The Production Coordinator moved from pre production to the production plan:** the pre
  production shoot form no longer asks for it, and a shoot's existing answer is carried over once,
  as the plan's starting coordinator, when its production record is raised (the old columns stay
  until a later migration drops them). `StepRail` moved to `components/shared`.
  [production/](../backend/src/modules/project-management/production/),
  [ProductionPage.js](../frontend/src/components/project-management/production/ProductionPage.js),
  [ProjectWhatsappGroupField.js](../frontend/src/components/project-management/ProjectWhatsappGroupField.js).
  **Roles:** `PROJECT / Production` already exists and no permission row is added. Grant it
  **Read / Write** to the roles held by Production Managers and Production Coordinators in Admin →
  Role Management and **re-save those roles**; linking the group needs `PROJECT / Pre Production`
  Read / Write, which pre production roles already hold.
  **Deploy:** rehearse on a copy of production, then `npx prisma migrate deploy` and
  `npx prisma generate`. Production records appear for a project the next time it is saved or gets a
  shoot.
```

- [ ] **Step 5: Measure the rule files** — `scripts/doc-sizes.sh`; if a README section grew noticeably, run the **token-optimizer** subagent and apply what it says about moving text.

- [ ] **Step 6: Stage for review (do NOT commit — the user commits)**

```bash
git add backend/README.md frontend/README.md docs/project-state/PROJECT-STATE.md docs/project-state/SALES-AND-PROJECT-MANAGEMENT-WORKFLOW.md docs/CHANGELOG.md
```

---

### Task 18: Verify, review, hand over

**Files:** none new; fixes land in the files of the task they belong to.

- [ ] **Step 1: Full test and lint runs**

Run: `cd backend && npm test` then `cd frontend && npm run lint && npm test`
Expected: all green, no lint errors.

- [ ] **Step 2: Responsive check, phone first** — at **~360px first**, then ~768 and ~1280: board (cards below `md`), shoot panel full-screen (all three tabs), each step form with its bottom action bar, the camera dialog over the panel, the upload queue on a throttled/offline network, one-tap ticket open, General's WhatsApp field. Every tap target ≥ 44px, nothing hover-only, no horizontal page scroll, the shell never scrolls as a page.

- [ ] **Step 3: Reviewer subagents** (after, per CLAUDE.md) — run in parallel and fix every finding in the owning task's files:
  - **backend-api-reviewer** on `backend/src/modules/project-management/production/`, the pre-production changes, `server.js`, `sales/projects/controller.js`.
  - **db-schema-reviewer** on `schema.prisma` and the migration, and every Prisma query in the new module.
  - **security-reviewer** on uploads (`execution.js` files, `filesSchema`), the outbound WhatsApp (`messages.js`, `whatsappGroup.js`), the new router.
  - **frontend-ui-reviewer** (and **ux-heuristics-reviewer**) on `components/project-management/production/`, `ProjectWhatsappGroupField.js`, `PreProductionGeneral.js`, `shared/StepRail.js`.

- [ ] **Step 4: Read the whole diff** — `git diff --staged` end to end: every hunk is one the final design needs (CLAUDE.md "only the final fix in the diff"); no leftover `stepDeps = {}` from Task 11, no Plan-only panel remnants from Task 9, the docs describe what the code does.

- [ ] **Step 5: Hand over** — tell the user: tests/lint results, the migration to rehearse and apply, the roles to grant and re-save, and that nothing is committed. They commit, push and open the PR to `develop`.

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1), row raising (3), access by naming + Super Admin (4), dataScope board (4-5), plan save/submit + id validation (6), router + all ten endpoints (7, 10, 11, 14), files with limits (10), strict steps / plan gate / ≥2 photos / pineapple / status rules (11), activity in-transaction (4, 6, 10, 11), WhatsApp send-after-transaction / FAILED / retry (14), group link + default match + own-listGroups check (15), templates in Settings (1, 14, 16), board + My Shoots + pending pill (9), Plan / Execution / Activity tabs (9, 13), StepRail moved (12), mobile-first + absent controls (9, 13, 16, 18), docs + changelog naming roles (17), reviewers (Before Task 1, 18).
- **Coordinator move:** removal from pre production, the one-time carry-over and its test, and the kept-then-dropped columns are all in Task 3 (follow-up drop noted there and in Task 17).
- **Phone first:** Global Constraints; board cards (Task 9), full-screen panel and one-column plan (9, 13), bottom action bar, camera first, 44px targets, one-tap tickets, upload queue (13), 44px Retry and group buttons (16), phone-first checks (9, 13, 16, 18).
- **Deviations the executor must know:** `status` on messages also holds a transient `SENDING` during a retry claim; the vendor list comes from `/production/options`, not `/api/vendors/options` (that route needs ASSET permissions and returns vocabulary, not vendors); a group already held by another live project is refused (Review Focus 5).
