# Production Stage — Design

Date: 2026-09-30 · Status: awaiting review · Branch: from `develop`

## Goal

Once a project has a Production Manager assigned in pre-production, each of its shoots gets a
production record. The Production Manager fills the plan for the shoot. The Production
Coordinator named in that plan then works through the shoot step by step. Each step is logged,
and three of the steps post a message to the project's WhatsApp group.

Everything is **per shoot**. A coordinator can have several shoots in progress at once, and the
shoot board shows what is pending on each one.

## What exists today and is reused

| Need | Existing piece |
| --- | --- |
| Production Manager on the project | `SalesProject.productionManagerEmployeeId` → Employee, set in `PreProductionGeneral.js` |
| One row per shoot, raised automatically | `ProjectPreProduction` + `pre-production/service.js` (row-raising pattern) |
| Production page + permission | `/project-management/production` (currently a thin list in `ProjectWorkflowModulePage`), `PROJECT:Production` in the catalogue and in `modulePermissions.js` |
| Travel modes, employees, category-filtered assets | Pre-production `listOptions` (`pre-production/controller.js`) |
| Vendors | `GET /api/assets/vendors/options` (`options: "vendors"`) |
| Shoot services | `ProjectPostProductionAllocation` (per `shootId`, `serviceDefinitionId`) |
| Camera + gallery multi-image | `shared/MultiImageField.js` + `CameraCaptureDialog.js` |
| File upload (tickets) | `shared/FileUploadField.js`, `services/documentStorage.js` |
| Image storage | `services/imageStorage.js` (`storeImages`, rollback, `discardUploads`) |
| Group WhatsApp send | `sessionManager.listGroups` / `sendMessageToGroup` (paced, typing, groups only) |
| Group link precedent | `ImageSelectionProject.whatsappGroupJid/Subject/LinkedAt`, Attendance report group |
| Message templates | `services/messageTemplate.js` (`TEMPLATE_KEYS`, `renderMessage`) |
| Activity log pattern | `HrmTaskActivity` |
| Step rail | `ai-feature/events/wizard/StepRail.js` (move to shared and generalise) |
| Multi-select | `shared/MultiSelectField.js` / `SearchableMultiSelect.js` |

## Data model

Table and column names are snake_case through `@map`/`@@map`. Every link is an id with a
`@relation` and an index. A name copy is stored only where it is declared in `nameCopies.js`.
The whole schema ships in one migration, rehearsed on a copy of the production database first.

**`ProjectProduction`** → `project_production`, one row per shoot
- `id`, `shootId` (unique → `ProjectShoot`), `salesProjectId` → `SalesProject`, `branchId` →
  Branch (for `dataScope`)
- Plan: `productionCoordinatorEmployeeId` → Employee, `travelMode` (a value from the existing
  travel-mode list), `remarks`, `planSubmittedAt`, `planSubmittedByUserId` → User
- Execution:
  - `currentStep`: one of `STARTED_FROM_STUDIO`, `REACHED_SHOOT_PLACE`, `PINEAPPLE_MEETING`,
    `SHOOT_STARTED`, `SHOOT_STATUS`, `REACHED_STUDIO`, `PHOTO_COPY`, `DONE`
  - one completion time per step, e.g. `startedFromStudioAt`, …, `photoCopyAt`
  - `pineappleRemarks`
  - `shootStatus` (`PAUSED` | `HOLD` | `REJECT` | `COMPLETED`, null until first set) and
    `shootStatusRemarks`
  - `footageUrl`, `footageBackupByEmployeeId` → Employee, `footageRemarks`
- `createdAt`, `updatedAt`

**Linked lists**, one join table each, unique on `(productionId, targetId)`:
- `project_production_team_member`: `employeeId` → Employee
- `project_production_camera`: `assetId` → Asset, limited to the "Cameras" category (optional)
- `project_production_service`: `allocationId` → `ProjectPostProductionAllocation`, and only
  allocations of this shoot are accepted
- `project_production_exposure_vendor`: `vendorId` → Vendor

**`ProjectProductionFile`** → `project_production_file`
- `productionId`, `kind` (`TICKET` | `PINEAPPLE_GROUP` | `HAPPENING_NOW`), `url`, `fileName`,
  `mimeType`, `uploadedByUserId`, `createdAt`
- Tickets may be images or PDFs and go through `documentStorage`. Photos go through
  `imageStorage`.

**`ProjectProductionActivity`** → `project_production_activity`, following `HrmTaskActivity`
- `productionId`, `action`, `detail`, `userId` → User, `userName`, `createdAt`; index
  `(productionId, createdAt)`
- Actions: `PLAN_SAVED`, `PLAN_SUBMITTED`, `STEP_COMPLETED`, `SHOOT_STATUS_CHANGED`,
  `FILE_ADDED`, `FILE_REMOVED`, `WHATSAPP_SENT`, `WHATSAPP_FAILED`, `WHATSAPP_RETRIED`

**`ProjectProductionMessage`** → `project_production_message`
- `productionId`, `step` (`STARTED_FROM_STUDIO` | `REACHED_SHOOT_PLACE` | `SHOOT_COMPLETED`),
  `status` (`SENT` | `FAILED`), `error`, `sentAt`, `sentFromUserId`; unique
  `(productionId, step)`

**`SalesProject`** gains:
- `whatsappGroupJid`
- `whatsappGroupSubject`
- `whatsappGroupLinkedByUserId` → User
- `whatsappGroupLinkedAt`

**When rows are created:** in the same place and the same way pre-production rows are, for every
shoot of a started project that has `productionManagerEmployeeId` set. The operation is
idempotent: it only creates rows that are missing.

**The Production Coordinator lives only on the production plan.** Pre-production used to ask for
it on the shoot form (`ProjectPreProduction.productionCoordinatorEmployeeId`); that field is
removed from pre-production's form, validation, write and read paths. When a production row is
raised and the shoot's pre-production coordinator is set (and that employee still exists), it is
copied in once as the plan's starting coordinator. The old `project_pre_production` columns stay in
this change, marked deprecated, and a follow-up migration drops them once every eligible shoot has
its production row. The "Assigned By (Project Coordinator)" display on the project table is a
different field and is not touched.

## Flow

### 1. Pre-production: link the WhatsApp group
- The pre-production General panel gets a "WhatsApp group" field. The logged-in user's paired
  WhatsApp groups are listed through `listGroups`, and the group whose subject matches
  `SalesProject.whatsappGroupName` is selected by default.
- Saving stores the jid, the subject, who linked it and when.
- All messages for this project are sent from **the linker's** paired WhatsApp.
- The backend accepts only a jid that appears in the caller's own `listGroups`.

### 2. Production Manager: the plan (per shoot)
- Fields:
  - Production Coordinator: one employee
  - Production team: several employees
  - Travel mode
  - Tickets: several files, downloadable
  - Cameras: several, optional
  - Services: several, from this shoot's services
  - Exposure: several vendors
  - Remarks
- The manager can **save** a draft or **submit** the plan. Submitting requires a coordinator.
- The coordinator's steps are locked until the plan is submitted. After submitting, the manager
  can still edit the plan, and each save is logged.

### 3. Production Coordinator: execution (per shoot, strictly one step after another)

Only the current step can be edited. A finished step shows ✓ with who finished it and when.
There is no going back, except that the shoot status can be changed again.

1. **Started from studio.** Confirm, which sends WhatsApp message 1.
2. **Reached the shoot place.** Confirm, which sends WhatsApp message 2.
3. **Pineapple meeting.** A group photo and remarks, both required.
4. **Shoot started.** At least 2 "happening now" images, taken with the camera or picked from
   the gallery (`MultiImageField`). More can be added until the shoot is done.
5. **Shoot status.** Paused, Hold, Reject or Completed, with remarks required. It can be
   changed any number of times, and every change is logged. **Completed** sends WhatsApp
   message 3 and opens step 6. Changing away from Completed after step 6 has opened is not
   allowed.
6. **Reached studio.** Confirm.
7. **Photo copy.** Footage URL, footage backup done by (an employee), and remarks. Confirming it
   sets `currentStep = DONE`.

### 4. WhatsApp sending
- The message is sent after the step is saved and outside its transaction, using
  `sendMessageToGroup({ userId: linkedByUserId, jid, body })`. That call already spaces messages
  out and shows typing.
- The text comes from three new templates in `messageTemplate.js`, editable in Settings. The
  placeholders are project name, shoot, date, location and coordinator:
  - `PRODUCTION_STARTED_FROM_STUDIO`
  - `PRODUCTION_REACHED_SHOOT_PLACE`
  - `PRODUCTION_SHOOT_COMPLETED`
- A failed send never blocks the step. This covers no linked group, the linker's WhatsApp being
  disconnected, and a WhatsApp error. The step completes, the message row is saved as `FAILED`
  with the reason, the step shows "Not sent · Retry", and the Retry endpoint sends it once more.
- One message per step, and each is triggered by a person. There is no scheduled or bulk
  sending.

### 5. Activity log
Every action is written to the log in the same transaction as the change it records. WhatsApp
results are written right after the send. The log is shown oldest-first in the Activity tab.

## Screens

The existing `/project-management/production` page is replaced by:

- **Shoot board** (`DataTable`)
  - One row per production record, showing the project, the shoot and its date, the manager,
    the coordinator, and a pending pill ("Plan pending", "Step 3/7 · Pineapple meeting",
    "Paused", "Done").
  - A "My shoots" filter.
- **Shoot panel**, opened from a row, with three tabs:
  - **Plan**: the manager's form, read-only for everyone else, with tickets downloadable by
    anyone who can view
  - **Execution**: the shared step rail plus the form for the current step
  - **Activity**: the log
- **Mobile is the primary target.** The Production Manager and the coordinator both use it on
  their phones during the shoot, so every screen is designed at 360px first, then checked at 768
  and 1280px:
  - the shoot panel opens full-screen on a phone, not as a side pane;
  - the board shows cards below `md` (the `DataTable` has no mobile card mode, so a reusable card
    list is added) and the table from `md` up;
  - the current step's primary action is a large, thumb-reachable button fixed to the bottom of
    the panel on a phone;
  - photo steps offer the camera first;
  - a ticket opens or downloads with one tap;
  - the Plan form is one column;
  - every tap target is at least 44px, and nothing is hover-only;
  - photos are compressed on the phone, upload one per request with visible progress, and a photo
    whose upload fails stays on the phone with Retry (closing with photos still waiting asks first).
  The shell never scrolls as a page.
- A panel reached by a deep link takes `canEditPlan` and `canRunSteps` as props. A control the
  viewer cannot use is absent, not disabled.

Components go in `components/project-management/production/`. API calls go in
`services/project-management/production.service.js`.

## Access control

- **One permission:** `PROJECT:Production`, which already exists. No new catalogue row or
  migration row is needed.
- **Backend:** a new router at `backend/src/modules/project-management/production/`, mounting
  `protect` and `requireModule("PROJECT", "Production")`. Reading needs READ; every write needs
  READ_WRITE.
- **Being named decides which shoot a person can edit.** It is checked against the record in the
  service, not by role:

| Caller on this shoot | Plan | Steps | Files |
| --- | --- | --- | --- |
| Employee = `SalesProject.productionManagerEmployeeId` | edit | view | download |
| Employee = `ProjectProduction.productionCoordinatorEmployeeId` | view | edit | download |
| Anyone else with Production READ or above | view | view | download |
| Super Admin ⚑ | edit | edit | download |

  The caller's employee is resolved from `req.user`. Ids in the body are never trusted: the shoot,
  the allocations, the assets and the vendors are each checked to belong to this shoot or to be
  valid.
- **Roles:** the roles for Production Manager and Production Coordinator need Production
  READ_WRITE granted in Role Management and re-saved. The changelog will say this.
- **Which shoots appear:** `dataScope` on `branchId`, plus the rows the viewer's own name is on.
- **Linking the WhatsApp group** uses the existing `PROJECT:Pre Production` guard on the
  pre-production router.
- **Frontend:** the existing `modulePermissions.js` row for `/project-management/production`
  stays, and `useRouteAccess()` combined with the permissions from the API decides which
  controls are shown.

⚑ The Super Admin override is assumed. Remove it if Super Admin should only view.

## API (under `/api/project-management/production`)

| Method | Path | Who |
| --- | --- | --- |
| GET | `/shoots` | board rows (scoped) |
| GET | `/shoots/:shootId` | detail, including `canEditPlan` and `canRunSteps` |
| GET | `/options` | employees, travel modes, cameras, vendors, and this shoot's services |
| PATCH | `/shoots/:shootId/plan` | manager: save or submit |
| POST | `/shoots/:shootId/files` | manager (tickets) or coordinator (photos) |
| DELETE | `/shoots/:shootId/files/:fileId` | the uploader's side, before the step is done |
| POST | `/shoots/:shootId/steps/:step` | coordinator: complete the current step |
| PATCH | `/shoots/:shootId/shoot-status` | coordinator: status + remarks |
| POST | `/shoots/:shootId/messages/:step/retry` | coordinator |
| GET | `/shoots/:shootId/activity` | anyone who can view |

The group link is `PATCH /api/project-management/pre-production/projects/:projectId/whatsapp-group`
plus `GET …/whatsapp-groups`.

Uploads are limited in size and count, and only image and PDF types are accepted. The
security-reviewer runs on this change because it touches uploads, outbound WhatsApp and a new
router.

## Testing

- Backend unit tests:
  - rows are created idempotently
  - who can edit what, by being named
  - step order is enforced (cannot skip a step; cannot complete a step before the plan is
    submitted)
  - at least 2 "happening now" images are required
  - moving back from Completed is rejected
  - a failed WhatsApp send still completes the step and records `FAILED`
  - a group jid not in the caller's `listGroups` is rejected
  - services from another shoot are rejected
- Backend also: the pre-production coordinator is carried over once when a production row is raised
  (and not when that employee no longer exists); pre-production no longer accepts the field.
- Frontend: `npm run lint` and `npm test` (including the upload queue keeping failed photos), plus
  a manual walk-through at 360px first, then 768 and 1280px, including a throttled/offline upload.
- Reviewers: frontend-ui-reviewer, backend-api-reviewer, db-schema-reviewer and
  security-reviewer, before and after the change.

## Build phases

1. Schema and migration, row creation (with the one-time coordinator carry-over and the removal of
   the coordinator from pre-production), the production router with its access checks, the Plan
   tab, and the new board.
2. The Execution tab (step rail moved to shared), uploads, and the activity log with its tab.
3. The WhatsApp group link in pre-production, the templates, sending, and retry.
4. Docs (frontend and backend READMEs, PROJECT-STATE production section), a CHANGELOG entry
   that names the roles to re-save, and the responsive check.

## Out of scope

- Post-production.
- Moving the project's `projectStatus` automatically when production finishes.
- Reusing the Image Selection group link. That link stays separate for now and could later be
  read from `SalesProject`.
