# Backend — DBS-Operations-OS

Node.js + Express 5 REST API, Prisma ORM on MySQL 8, JWT auth, BullMQ/Redis for image processing,
S3-compatible object storage (Cloudflare R2), Nodemailer for transactional mail.

## Run It

```bash
npm install
npm run setup:local   # prisma generate + migrate dev + seed (first run)
npm run dev           # Redis (in-memory) + nodemon on src/server.js
npm test              # clears leftover test fixtures, then node --test
npm run prisma:studio # optional data browser
```

### Test data

Several suites write real rows — branches, employees, roles, leads, projects — because what they
check is a SQL rule, and there is no honest way to check one without a database. Each cleans up in
an `after()` hook, which runs exactly as long as the run finishes: not when a test fails hard, not
when the process is killed. What was left behind then sat in the developer's own database and
showed up on screen as real data — the studio's Branches list reached 29 branches, 23 of them named
"Accounts Scope Branch 004915", and one leftover employee made `data-scope-backfill` fail on every
subsequent run.

So `npm test` sweeps first, through `pretest` → `scripts/clear-test-fixtures.js`. It deletes only
rows whose own identifying column begins with a **reserved fixture prefix** — `TCS-`, `TDA-`,
`TDC-`, `TDP-`, `TDS-`, `TES-`, `TLC-`, `TPC-`, `TQE-`, `WCS-`, `TEST_`, `ZZTEST-`, `ZZREP-` — and
never by date or by resemblance. **Do not code real records with those prefixes**, and give a new
suite a prefix of its own and add it to `PREFIXES`: `test/test-fixture-prefixes.test.js` reads both
the script and the suites and fails on a prefix, or a table, the sweep does not know about. The
sweep never fails the run; a database it cannot reach is warned about and skipped.

Defaults to port `5001` via `PORT`. Health check: `GET /api/health` → `{ ok: true }`.
**The Super Admin's password.** `prisma/seed.js` creates `admin@dontblinkstudio.com` with the password written at the top of that file — which is a password in this repository. **The seed applies it only when it creates the account**: reseeding is part of the Rule 4 workflow on the VPS, and an `update` that carried the password would put the studio back on a published credential every time a permission was added. So changing it on a running installation is a database change and the seed will not undo it; `test/seed-super-admin-password.test.js` holds that rule.

`GET /api/health/email` (`ADMIN / System Settings` `READ`) reports whether mail **and SMS** are configured and how each `SMTP_*` sender is faring; `?verify=true` authenticates against each one. It is the answer to "the password reset never arrived", which the reset form itself cannot give — it replies the same way whatever happens, or it becomes a way of asking which addresses have accounts. No password and no API key is ever returned. **Resetting a password** goes two ways: a six-digit code to the mobile number on somebody's employee record (`POST /api/auth/forgot-password/otp`, then `/otp/verify`, two-minute expiry, five attempts, single use — it mints the same reset token the emailed link carries), The screen offers **only** the code; `POST /api/auth/forgot-password` is left on the server, referenced by no screen, as the last way back in for an account whose number has not been set. The number comes from the employee record, or from `user.mobile` for a login with no employee behind it — the Super Admin is that account, and `npm run set:user-mobile -- <username> "+91 9876543210"` is how it gets one (the employee's number wins wherever there is one). Codes need `SMS_PROVIDER` and `SMS_API_KEY` set; they are never routed through the WhatsApp integration, which is a QR-paired personal account that gets banned for automated sending. **Locally there is no gateway**, so with `NODE_ENV="development"` and nothing configured the code is printed on the server console in a box saying nothing was sent — otherwise no screen past the code box could be reached at all. That echo is the only place allowed to print a live code: it refuses to run under any other `NODE_ENV`, including an unset one, `SMS_DEV_ECHO="false"` turns it off, a configured gateway always wins over it, and `GET /api/health/email` reports it as `sms.devEcho`.
`GET /api/user/profile-photo/download` (signed in) answers with the caller's own photo as a file
attachment — reading it here rather than in the browser is what makes the download work for a
photo held on the R2 bucket, which is another origin.

`GET|PUT|DELETE /api/user/preferences[/:key]` (signed in) keep how one login has arranged the
application for itself — column order, hidden columns, frozen columns, column widths
(`table:<slug>`), the density every table reads at (`app:compactView`), the appearance it reads in
(`app:theme`), the order of its own sidebar (`app:sidebarLayout`), and the tab each screen was
left on (`tab:<screen>`). Self-service like the rest of `src/modules/user/routes.js`: `req.user.id`
is the only account any of it touches and nothing in a payload may name another, so `protect` alone
guards it and **no module permission applies** — a table layout belongs to whoever arranged it, and
gating it would mean a role could be refused the right to remember its own screen. The values are
written by a browser and land in a JSON column, so `src/modules/user/preferences/service.js` decides
what each namespace may hold and caps both the value and the number of keys per account; anything
else is refused rather than stored.

The sidebar layout is checked against the sidebar's actual structure rather than stored as sent:
`src/modules/user/preferences/sidebarStructure.js` holds which module owns each screen, and refuses
an arrangement that files one under a module that does not own it — Quotations cannot be saved into
Project Management however the request was written. Only the *structure* is mirrored there; the
canonical sidebar registry, with the labels, routes and icons, is
`frontend/src/constants/navigation.mjs`, and `test/user-preferences-sidebar.test.js` imports it and
fails if the two ever disagree about an id or its default position. A preference orders the sidebar
and nothing else: it grants no access, and what a role may open is still decided by that role's
permissions when the browser draws it.

A changed or reset password may not be one of the account's last six: `src/services/passwordHistory.js`
keeps the previous hashes in `user.password_history` and refuses a match.

`GET /api/release` (signed in) returns the version plus the lead-in of each entry in the
changelog's current section, read by `src/services/releaseNotes.js` for the app's Release
Information dialog. The version needs the `VERSION` file at the repository root (`<major>.<minor>`).
`npm run dev` starts a local in-memory Redis alongside the API so the image queue works without a
Redis install; `npm start` (production) expects a real Redis.

Environment lives in `backend/.env` — never commit it. Setup, credentials, and troubleshooting are
in the [root README](../README.md) and
[docs/project-state/LOCAL-DEVELOPER-SETUP.md](../docs/project-state/LOCAL-DEVELOPER-SETUP.md).

## Code Flow

```text
src/server.js                     express app, mounts every router under /api/*
        │
        └── src/modules/<module>/<feature>/routes.js    router + protect middleware
                    │
                    └── controller.js       request/response, validation, status codes
                                │
                                ├── service.js / src/services/*     storage, email, images
                                └── src/config/db.js  →  Prisma Client  →  MySQL
```

- **Auth** — `src/middleware/authMiddleware.js` exports `protect`, which verifies the `Bearer` JWT
  and puts the payload on `req.user`. Routers apply it once with `router.use(protect)`. Only
  genuinely public routers skip it: `/api/auth`, `/api/onboarding`,
  `/api/public/image-selection/galleries`. `protect` checks the signature and nothing else — it
  never queries — so a token naming an account that has since been deleted still reaches the
  permission guard. The guard is what answers it: `iam.service` throws that case with
  `status: 401` / `code: "USER_NOT_FOUND"`, and `permissionMiddleware`'s `checkFailed` honours a
  status the error already carries instead of reporting 500. That distinction is the difference
  between the browser signing the person out and the browser retrying a dead token forever.
- **Errors** — `server.js` registers a JSON 404 fallback and a final 4-argument error handler, so
  the frontend always parses JSON. Never let an error reach Express's default HTML page.
- **Prisma** — one client from `src/config/db.js`. Schema in `prisma/schema.prisma`, migrations in
  `prisma/migrations/`, local admin from `prisma/seed.js`.

### Module Layout

New work uses one folder per feature under `src/modules/<module>/<feature>/`, with `routes.js`,
`controller.js`, and an optional `service.js`:

```text
src/modules/
  hrm/            master-data (also mounts employees + onboarding-invites), employees, onboarding-invites,
                  org-chart, payment-requests, separations, attendance, referrals, tasks,
                  interview (the candidate register, plus its own linked Google Sheets and the
                  Google connection behind them, mounted as three routers)
  sales/          projects, whatsapp-group-names
  image-selection/ dashboard, projects, settings, folders, uploads, gallery, publication, publish-share,
                  deliverables, public-gallery, whatsapp, processing, storage, config,
                  faces (the client gallery's People filter: its own queue, worker and three
                  tables, hooked in only where a photo becomes READY - on whenever the face
                  engine is, AI_FACE_ENGINE_ENABLED=true),
                  album-proofs (its own projects, albums, versions, QC, corrections, client
                  publication and upload-dock mount — separate from projects/ by design)
  assets/         assets, categories, vendors, client-storage, asset-requests, inspections
  ai-feature/     the AI Feature (Visual Curation → AI Feature): events, sub-events, guests, media,
                  processing (its own BullMQ queue and worker), face-engine (the Python sidecar),
                  people (clustering), matches, share, activity, overview, default-settings, public
                  (the guest link) - a module of its own that reads nothing from image-selection/
                  but the Redis connection factory
```

`src/modules/assets/` predates the folder-per-feature convention and uses flat
`<feature>.routes.js` / `<feature>.controller.js` files; `src/routes/authRoutes.js` and
`src/controllers/authController.js` are the original auth pair. Follow the folder-per-feature
convention for anything new rather than extending the older shapes.

### Shared Services and Workers

| Path | Responsibility |
| --- | --- |
| `src/services/referenceMatchers.js` | How a branch, a vertical or an employee written as text is matched to its row — the one rule behind the match report, the backfill and every write that keeps a reference column in step with its text |
| `src/services/dataScope.service.js` | Whose rows a request gets: turns a grant's data scope (ALL / BRANCH / TEAM / SELF) into a Prisma `where` and a per-record check, with the recursive org-chart walk TEAM needs. Screens and AI tools both resolve through it — see [DATA-SCOPE.md](../docs/project-state/DATA-SCOPE.md). `seesEverything(userId, { module, feature })` asks the first half of that question on its own — is this person narrowed at all — for a reader with no rows to narrow: the topbar bell, which widens from somebody's own work to the studio's for anybody the scope does not confine. It is here so that no caller has to write a `req.user.role === "SUPER_ADMIN"` test of its own, which would be a second answer to this file's question and one no role could be granted |
| `src/services/bulkDelete.js` | Deleting a ticked set of rows, from any module's table — the counterpart to `tableImport.js` beside it. `mountBulkDelete(router, { path?, guard, deleteOne, noun })` registers `DELETE /bulk` and mounts `checkPermission("ADMIN", "Table Select All", "READ_WRITE")` **itself**, so a router cannot be wired with a bulk delete and no guard; `guard` is whatever the module needs on top, exactly as its single-row delete needs it. It holds no Prisma client and deletes nothing: `deleteOne(id, req)` is the module's *own* delete — `deleteAssetRecord`, `removeEmployee`, `deleteProjectRecord`, `removeVendorRecord` — which is the whole of the security argument, since the ids arrive in the body and only the module knows what makes a row reachable (CLAUDE.md Rule 4). A module handing over a bare `prisma.thing.delete` would open a hole this permission does not close. Ids may be strings or numbers and are echoed back **as sent**, because the selection bar clears its ticks by looking each one up in the set it sent. Walks them one at a time and reports per id the way the importer reports per row: a refusal lands in `missedIds` rather than failing the request, so a selection of forty with three that are not yours deletes thirty-seven and says so; nothing deleted at all is a 404, which is not the same answer as a partial success. Capped at 500 per request. `test/bulk-delete.test.js` |
| `src/services/emailService.js` | Nodemailer transactional mail (invites, credentials) |
| `src/services/imageStorage.js`, `objectStorage.js`, `documentStorage.js` | Uploads and reads against R2/S3 (`src/config/r2.js`) |
| `src/services/imageCompression.js` | Sharp derivatives and EXIF |
| `src/services/shortCode.js` | The short public codes behind shortened links — client gallery URLs and onboarding invite links share one alphabet and generator |
| `src/services/quotationPdfService.js` | Renders the public quotation page to PDF in headless Chrome (Puppeteer) as **one sheet the length of the document, 1080px wide** - the reference design is a continuous proposal, and cut into A4 pages it broke a card wherever a page ended. The viewport is set to the sheet's width before the page loads, the height is measured once the pictures have arrived, and `pageRanges: "1"` guards against the blank page a fractional height can add. Needs `FRONTEND_URL` to point at the running frontend; one browser is shared per process |
| `src/services/documentBranding.js` | The logo a document was issued under, frozen on its row. `snapshotDocumentBranding()` is called once where a quotation version or CRD link is *created* and returns the `logoUrl` column to write; `brandingForDocument(row)` is what every reader of a stored document asks and answers from the row alone, never Settings. A row older than the column answers `null` and shows the bundled default mark. Any new document type follows the same two calls |
| `src/modules/sales/quotation-brands/` | The brand behind a quotation - Dum Dum, Qua Qua, Corp - and what it froze onto each version. `service.allowsClientDownload(row)` is the one answer here that is deliberately *not* frozen: whether the client holding this quotation's link may download it, read live off the brand's `allow_client_download` so withdrawing it reaches the links already sent, and `false` for a brand row, a brand code or a database that will not answer. `service.brandConfiguration(code)` is what the generator loads: the brand's services and deliverables (each with the project definition it points at), packages, terms, PDF wording and pictures, one read per table. `service.presentationFor(code, { payload, quotation })` gathers everything the client's copy prints beyond the rows as it stands now - the Global Name and Global Logo from Settings → Organization (a brand has no logo of its own), the studio's shared content from `sales_quotation_settings.pdf_content` / `pdf_assets` / `pdf_sections` (the four section switches - notes, trademark, journey, infrastructure - where only a stored `false` hides one) (the notes and trademark cards, Journey & Legacy with its map and timeline, Our Infrastructure with its collages - Settings → Quotation Settings → General) laid over the brand's own pictures and words (`sales_quotation_brand.pdf_content` / `pdf_assets`: cover and Thank You photographs and the rest of the wording), the quotation's branch (by its resolved `branchId`, then by the text it holds, against the branch register) with its website, phone and email, the head office standing in for a quotation that names no branch, and every active branch as the locations list. `service.snapshotForQuotation(payload)` is called once as a version is raised and freezes that answer plus the brand's own wording overrides (never the template's defaults, which are the code's to change - `LEGACY_PDF_CONTENT` in `defaults.js` names the old defaults an early snapshot baked in, and they read as nothing chosen), the terms and the GST rate into `payload.brandSnapshot`, which the public page and the PDF read instead of the tables - so a brand's settings can change every week and `DBS-QO-DD-ERD-000001` keeps printing what it was sent with. `service.presentationForQuotation(row)` is what `GET /api/public/quotations/:token` answers with: the version's own snapshot, and today's answer only where a snapshot older than this shape is silent. `defaults.js` holds what prints when a brand has configured nothing - the reference design's words and timeline - held to the frontend's copy by `test/sales-quotation-brands.test.js` and `test/sales-quotation-presentation.test.js`. `assertNewSelectionsOffered` refuses a line newly chosen off a retired or another brand's master while keeping every line an earlier version already held |
| `src/modules/image-selection/processing/{queue,worker}.js` | BullMQ image pipeline; pending jobs are recovered on boot |
| `src/modules/image-selection/faces/` | The client gallery's **People filter**: a plugin on the side of Image Selection. `hook.js` is told - never awaited - where a photo becomes READY (`processing/service.js` and `uploads/derivativeController.js`) and queues it on `image-selection-faces`; `worker.js` + `processing.js` read the photo's *existing* preview, ask the AI Feature's face engine (`faces/engine.js` is the one import of `ai-feature/`, so one Python process serves both modules) for faces and vectors, and `clustering.js` joins each face to the project's nearest person above the threshold or starts a new one - two faces in one frame are never one person, and a photo added later is compared with the people already found rather than re-clustering the gallery. What is stored is only `image_selection_face_scan` (how far each photo got), `image_selection_face_person` (a running centroid and which existing photo, and where in it, stands for the person) and `image_selection_face_mapping` (person ↔ existing `image_selection_upload` id, with confidence); no photo is copied and no crop is written anywhere - the People row's circles are cut from the cover photo's thumbnail in the browser. All three cascade from the photo in the database, so deleting a photo or a folder cleans them up without the delete paths knowing; the project purge takes the person rows in one added line. `filter.js` is the whole of the read-side integration: one more `where` condition on `gallery/repository.listPublishedImages`. On whenever the face engine is (`AI_FACE_ENGINE_ENABLED=true`; `IMAGE_SELECTION_FACE_RECOGNITION_ENABLED=false` keeps the engine for the AI Feature alone); the worker rides in the API unless `IMAGE_SELECTION_FACE_EMBEDDED_WORKER=false` (`npm run worker:faces`), scans stuck by a restart are re-queued at boot, and an engine outage parks a scan rather than failing it. A gallery whose photos were never handed over - one from before the filter existed - is queued in the background the first time a client opens one of its folders (`service.ensureQueued`: one count per people request, never awaited, never twice at once), and can also be queued by hand with `POST /api/image-selection/projects/:projectId/faces/queue` |
| `src/modules/ai-feature/processing/{queue,worker,service}.js` | The AI Feature's own queue (`ai-feature-media`) and worker: per photo, read the preview from R2, ask the face engine for faces and vectors, store each face and its embedding, cluster it into a person, match it against the event's registered guests. Embedded in the API unless `AI_FEATURE_EMBEDDED_WORKER=false`, in which case `npm run worker:ai-events` runs it alone; pending rows are recovered on boot |
| `src/modules/ai-feature/face-engine/{engine.js,face_engine.py}` | The face engine: one long-lived Python process per worker speaking JSON lines, running InsightFace's SCRFD detector and ArcFace recogniser fetched from the Hugging Face Hub (`public-data/insightface`). Off unless `AI_FACE_ENGINE_ENABLED=true`; probed at boot, never awaited; when it is down, face jobs stay queued with the reason on show rather than failing. Packages in `requirements-face.txt` |
| `src/modules/ai-feature/shared/vectors.js` | Face vectors at rest and compared: base64 float32 in a TEXT column, cosine similarity, running centroids, confidence bands - MySQL 8 has no vector type, so this is done in Node one event at a time |
| `src/modules/image-selection/whatsapp/worker.js` | WhatsApp send queue |
| `src/modules/image-selection/whatsapp/group.service.js` | The project's WhatsApp group and the invite sent into it: name-matching against the coordinator's own groups (`sessionManager.listGroups`), one live project per group, a jid from the browser linked only when that person's WhatsApp answered for it, and a send through `sessionManager.sendMessageToGroup` that is **synchronous** — the socket lives in the API process and the send worker may not — and idempotent per publish version through the same notification table the Meta path writes |
| `src/workers/imageProcessingWorker.js` | Standalone worker process (`npm run worker:image`) |

Both workers run embedded in the API process by default; set
`IMAGE_PROCESSING_EMBEDDED_WORKER=false` or `WHATSAPP_EMBEDDED_WORKER=false` to run them separately.
The face worker (`src/workers/imageSelectionFaceWorker.js`, `npm run worker:faces`) does the same
behind `IMAGE_SELECTION_FACE_EMBEDDED_WORKER=false`, and starts nowhere at all unless the face
engine is switched on (`AI_FACE_ENGINE_ENABLED=true`, or `IMAGE_SELECTION_FACE_RECOGNITION_ENABLED=true`).

### Mounted API Surface

| Prefix | Module |
| --- | --- |
| `/api/auth` | Login, super-admin bootstrap (public) |
| `/api/admin/branch-admin-permissions` | The **Admin Permission** set: the one permission matrix every role marked `isBranchManager` carries on top of what that role grants in its own right. `GET` reads it, `PUT` replaces it whole, both under `ADMIN / Role Management` — `READ` to look, `READ_WRITE` to save. Guarded by role management rather than a permission of its own because it *is* role management, and a larger act than editing one role: saving it changes what every branch administrator may do without any of those roles being opened. One set for the studio, not one per role — two branch administrators in two branches do the same job in two places, and what differs between them is the branch list on their own role, which this does not touch. It is merged in `IAMService.getUserPermissions` through the same most-permissive rule as every other grant, so it can only ever widen somebody: a role already holding a permission at Read / Write keeps it when the set names it at Read. Empty until somebody saves one, and replaced whole on save so a permission cleared in the editor actually goes |
| `/api/admin/branches` | The branch register behind Settings → Organization → Branches — `GET /` the whole register (disabled branches included), `POST /` and `PATCH /:id` to add and edit one. `requireModule("SETTINGS", "Organization")` on the router, so this is an administrator's job while *choosing* a branch stays everybody's through `/api/hrm/branches`. There is no delete: a branch is disabled with `PATCH { isActive: false }`, because a year of quotations, every user's home branch and every asset's location go on pointing at it. Everything past the name is optional — **including the GSTIN and the PAN**, which were required until a branch that trades before its registration comes through turned out to be unaddable; both are still checked against their real shapes once there is something in the box, and a code, name, GSTIN or account number another branch already holds comes back 409 with a message per field. `qrCodeUrl` is the branch's payment QR: the browser sends the compressed data URI, the controller puts it through `storeImage` into `branches/qr-codes` and stores the link, and an existing link sent back by an edit passes through without being re-uploaded |
| `/api/hrm` | Master data, employees, onboarding invites, separations. Reads of the **reference lists** need only a session — departments and branches feed pickers all over the app, and gating those on HRM would lock an administrator out of their own screens — while every write asks for `HRM / Employee Management` `READ_WRITE`. The employee rows (`GET /employees`, the next id, the import template, alternative candidates), the separations and the invite list are not reference data and each carries `HRM / Employee Management` `READ` of its own; `GET /employees/directory` is the one session-only employee read, and answers id, Employee ID and name alone for the asset and client-storage pickers. A list kept per brand (`scopedBy: "vertical"` in `master-data/definitions.js` — the quotation Categories, resource `religions`) files each row under a brand code, requires one on create, and answers one brand's rows to `?vertical=DUM_DUM`. A master-data row is keyed by a `code` as well as a name, and `POST` **mints the code from the name** when one is not given (`codeFromName` in `master-data/definitions.js`): no screen shows the code, so a caller that sends a name is enough. Settings → Field Settings sent exactly that and was refused for three weeks because the schema demanded a code the screen does not have. An explicit code still wins, which is what Accounts needs for a key derived from the bank and branch rather than from the display name |
| `/api/hrm/attendance` | Employee Attendance. `GET /today`, `POST /login`, `POST /logout` for the day itself — the login time is the server's clock, never the browser's, and the one-per-day record is enforced by a unique index on `(employee_id, work_date)`. `GET /summary?from&to` returns one row per calendar day with the status and totals already decided, so no arithmetic is repeated in the browser. `/requests` raises leave, permission and on-duty; `/requests/:id/{approve,reject}` is for the three Leave Approval slots on the requester's employee record — or, on a **permission**, the one Permission Approval slot, falling back to those three where nobody is named in it — or an `HRM / Attendance Approval` holder, and `/requests/:id/cancel` and `DELETE /requests/:id` are the employee's own. `GET|PUT /settings` holds the working day; the **holiday calendar moved out** to `/api/settings/holidays`, since a company-declared holiday is a studio setting rather than an attendance decision — attendance still reads the same table when it judges a day. Mounted ahead of the master-data router, which would otherwise let any signed-in session read its GETs |
| `/api/hrm/referrals` | Employee referrals: `GET` / `PUT /settings` is what a referral pays, `GET /` is the register with each referral's instalments, and `PATCH /payouts/:payoutId` marks one paid. Guarded as a whole by `HRM / Employee Referral` — the permission that opens the Employee Referral screen these serve — so a GET needs `READ` and everything else `READ_WRITE`. Paid is refused a reversal in the service, not only in the UI: correcting money that has left the studio is an Accounts entry. Mounted ahead of `/api/hrm`, which claims everything else under that prefix **Whose referrals:** the register answers the studio's usual rule on the referrer — yours if you made it, if somebody reporting to you made it, or if you entered it on their behalf — and `ADMIN / Branch Administration` adds every referral whose *referrer* works in a branch the role reaches. The branch is read live through `referrer.branchId` rather than copied onto the row: `EmployeeReferral` has no `branch_id` and should not grow one, because a referral's branch is the referrer's and a copy goes stale the day somebody transfers. `PATCH /payouts/:payoutId` is held to the same rows and answers 404 out of scope — hiding a row from the register is not protection while its id can still be sent to the write that says money left the studio. The settings either side of it are studio-wide and answer to the permission alone |
| `/api/hrm/tasks` | Tasks one person gives another. `GET /mine` and `GET /given` are the two sides of the same row and answer for `HRM / Task Management`; `GET /all` is the whole studio's list and asks for `HRM / All Tasks` as well, which is why it is a route of its own rather than a parameter on the list — a screen may never hold a finer permission than the endpoint feeding it. `GET /options` is the narrow assignee picker: ids and names only, so giving a task is never a way to read the user directory. `POST /` gives one; `POST /:id/start`, `/complete`, `/revert` and `/cancel` are the four transitions, each its own verb because they belong to different people and record different things. `DELETE /:id` takes a task out of every list - the giver's and a Super Admin's, refused to everybody else - and is a **soft delete**: `deleted_at` is stamped, the row keeps its holders, history and files, and every read in the module narrows by it, so the id then answers 404 to every verb and to its own attachments. Who may do which is ownership, decided per task against the signed-in user's id; deleting is the one verb a role widens, and it is read in the service beside the task's two people rather than in the controller. `POST /:id/attachments` takes one file (multipart, 15MB, an allowlist of images, PDFs, office documents, CSV, text and ZIP - see `attachments.js`), `GET /:id/attachments/:attachmentId` streams one back with `Content-Disposition: attachment`, and `DELETE` removes it; the files themselves are one `attachments` JSON column on `hrm_task` and are read with the task, so there is no list route and nothing to join. Reading a file needs only what reading the task needs, while attaching and removing are the two people's alone - the same ownership rule the verbs keep. Nothing is public: the bytes are private objects in R2 under `hrm/tasks/<task code>/`, and a file belonging to a task the reader may not see answers the same 404 the task does. Mounted ahead of `/api/hrm`, which claims everything else under that prefix |
| `/api/hrm/interview` | The Interview register: `GET /candidates` (with `?status=`), `POST /candidates`, `POST /candidates/bulk` for Bulk Entry's batch, `GET` / `PUT` / `DELETE /candidates/:id`, **`POST /candidates/:id/schedule`** (a round put in the diary, as one act: the round is appended or the one being edited rewritten, the candidate **moves to Interview Scheduled** with the reason appended to their decisions, and a round whose mode is **Google Meet** gets a real Calendar event — created on the caller's own primary calendar through the *same* stored Google connection the linked sheets use, whose consent already carries `calendar.events`, with the candidate, the interviewer and any guests invited, and Google's link written onto the round. The event is created **before** the write, so `GOOGLE_NOT_CONNECTED` / `GOOGLE_CALENDAR_SCOPE_REQUIRED` refuse the whole schedule rather than filing an interview nobody can join. A round that already has an event is **patched** — the entry everybody holds moves, the link the candidate was sent still works, and Google sends its own update — and a 404/410 from the patch means the event is gone, which is answered with a new one rather than with a refusal. A round that stops being a Meet has its event cancelled, and that cancel never fails the save. **Editing does not move the stage**: moving a date is not a decision about a person. The day and the hour are handed to Google as a **clock face** — `dateTime` with no offset plus the caller's `timeZone` — because `interview_date` and `interview_time` are text somebody typed and converting them to an instant is how a 10:30 interview gets booked for 5am; `meetings.js`), **`GET /meet-guests`** (the working employees with the work address an invite belongs on, for the guest picker — guarded `checkPermission("HRM", "Interview", "READ_WRITE")`, a notch tighter than the router's own guard, because the roster with everybody's email on it is for somebody booking an interview and not for everybody who may read the register; this is also why it is not part of `GET /options`), **`POST /candidates/bulk-status`** and **`DELETE /candidates/bulk`** (what the register's tick boxes lead to — every ticked candidate moved to one stage with the reason written against each of their own records, or deleted together — both behind `checkPermission("HRM", "Interview Select All", "READ_WRITE")` on top of the router's guard, with a candidate already gone counted in `missedIds` rather than refusing the selection), `POST /candidates/:id/resend-form` (reopen the application this candidate already submitted and email them their own link again — the Employee Repository's Send Back, said for a candidate: the newest **Submitted** invite goes back to `Verified` with `submitted_at` cleared so the next submission is accepted, its expiry is extended to at least a week out and never shortened, and the candidate moves back to Form Submission Pending **only from Form Submitted**, so anybody since scheduled, held or selected keeps the stage somebody moved them to. An invite with no short code is refused rather than reopened — its token is stored hashed, so there is no link left to send. A refused email answers **502 carrying the link and the new deadline** rather than 500, because the reopening already happened and what a failed send costs is only that the candidate has not been told), `GET /options` — departments, **positions** (the designation list, then the register's own `interview_position` rows after it, deduplicated case-insensitively by `mergeNames`: Position Applied For is mostly a real role, but "General" is a position nobody is ever *employed* as, and a row in `designation` is also a row in every employee's designation picker, so the two questions get two lists), active branches, genders, the **sources the studio maintains** (`interview_source`, read through `optionLists.js`, falling back to *nothing* rather than to an array, since Source is an optional combobox everywhere and a fallback here would be the hardcoding back), and the fixed status, mode and employment-type lists — and `GET /import/template` + `POST /import`, the two paths every module's CSV import answers at (`services/tableImport.js`). Guarded as a whole by `HRM / Interview`, so a GET needs `READ` and everything else `READ_WRITE`; nothing in it reads `req.user.role`. All four write paths — the form, the batch, the CSV and the public application form — go through one `candidateSchema` and one `prepareValues`, so a candidate cannot arrive through one door in a shape another would refuse. A candidate carries **which paid ad brought them in** — `campaign_name`, `adset_name`, `ad_name`, migration `20260918170000` — because a studio running hiring ads on Meta needs to know not only that an application came from Meta Ads, which `source` already says, but which push, which audience and which creative, and that is what decides what keeps running. Three columns rather than one string, since the table is filtered by one of them at a time; nullable text like everything beside them, filled only by a linked sheet or a CSV, and listed in `SHEET_WRITTEN_FIELDS` — which is what a sheet row fills when the candidate is **first created**, and never afterwards: a sync only ever adds, so a campaign renamed mid-flight reads in the register as whatever it was called when the candidate arrived. A candidate's code is `DBS-INTV-000001` from the shared `app_sequence` counter; dates are folded to `YYYY-MM-DD` through `leadDates.js` and the status onto the module's own spelling (`candidates.js`), with an unknown stage kept as typed — which is what a sheet saying `Shortlisted`, `Interviewed`, `Joined` or `Declined` gets, none of the four being stages here and none foldable onto one that is without moving a candidate nobody moved. The seven the register keeps are **Yet to Connect**, **Form Submission Pending**, **Form Submitted**, **Interview Scheduled**, **Selected**, **On Hold** and **Rejected** last. There is no interviewer in the payload either: the roster is not read by everybody who may open the register (`interviewers()` stays for the sheet assignment rules, and `meetGuests()` serves the schedule dialog's own picker behind `READ_WRITE`). A batch row that fails is named by its position and the rest are written. `GET /candidates` is **paged** — `offset`, `limit` (default 100, capped at 500) and `appending`, answering `{ data, total, counts }`, ordered `created_at DESC, id DESC` because a sync writes thousands of rows sharing a timestamp to the millisecond and without the tiebreak a row repeats between pages while another never arrives; `counts` is one `groupBy` over the register so a tab describes the stage rather than the page, and is skipped on an append. **Delete is hard** — the row goes and its screening-form invites go with it in one transaction, the way `purgeLeads` removes a CRM lead, because a soft-deleted candidate still answered to a phone number and kept a linked sheet refusing to re-import somebody nobody could see. A deleted candidate is kept out — by the linked-sheet ledger, and by a match on their own phone, email or source row id, which still recognises them after the spreadsheet has shifted their row. Mounted ahead of `/api/hrm`, which claims everything else under that prefix |
| `/api/hrm/interview/invites` | The **screening form** a candidate is sent: `GET /`, `POST /`, `PATCH /:id`, `PATCH /:id/cancel`, `POST /:id/send-email`. `employee_onboarding_invite`'s own design for a candidate rather than a new hire (`interview/invites.js`) — a hashed token with a four-and-four preview, an 8-character short code the shared link carries, an expiry, and the candidate's own email or phone as the gate. Behind `HRM / Interview`, because asking a candidate for the rest of their application is a step of working the candidate. Every invite belongs to a register row: one is found by email or phone, or created, so a form can be sent to somebody not yet on the register and they appear on it from that moment. Raising one moves a candidate at **Yet to Connect** to **Form Submission Pending**, cancelling moves them back, and a candidate further along keeps their stage — sending the form to somebody already scheduled is asking for the rest of their details, not starting them over. An edit keeps the link, which is the whole point over cancelling and re-inviting, and moving an expired invite's date forward revives it. A second live form for the same person is refused (409) |
| `/api/interview` | The public application form, answered by token rather than by a session: `GET /invites/:token` (masked contact details and the option lists), `POST /invites/:token/verify` (the email or phone, matched the forgiving way `phonesMatch` matches one), `POST /invites/:token/submit`. Rate-limited at 60 requests per 15 minutes per IP and `Cache-Control: no-store` throughout, both for the reasons the onboarding form's own routes give — short codes must not be enumerable, and a 410 is cacheable by default, which once left a candidate reading a stale refusal after their link was reopened. The submission writes the candidate's own answers through `prepareValues` **partially**, so it cannot blank a screening answer HR already gave, and moves the stage to **Form Submitted** only from the three stages the form is the answer to. The résumé is stored to `hrm/interview/resume` before the transaction opens; `updateMany` on `status: "Verified", submittedAt: null` is what makes a double submit a 409 rather than two writes |
| Interview sheet recovery | `scripts/resetInterviewSheetImport.js` — Interview only, dry-run by default. A sync refuses to re-write anybody the register has seen, held by two locks: `hrm_interview_google_sheet_row` and the soft-deleted candidates themselves (matched on phone, email or source row id). `--restore` clears `deleted_at`, which is lossless and needs no sync — the spreadsheet holds none of the status, interviewer, remarks or dates a restore brings back. `--flush` removes both locks so Sync Now rebuilds from the sheet, permanently, under new candidate codes and orphaning any invite already sent. `--since=YYYY-MM-DD` scopes either. Nothing written without `--apply` |
| `/api/hrm/interview/google-sheet-links` | The Interview module's linked spreadsheets: the same routes and reply shapes as `/api/sales/google-sheet-links` — list, link (`POST`, which runs the first import and rolls the link back if the sheet cannot be read), edit (`PUT /:id`), `POST /:id/sync`, `POST /:id/restore`, `GET /:id/import-preview`, a soft `DELETE /:id` that removes the candidates the sheet imported, and `GET /assignable-employees` — on the module's own tables (`hrm_interview_google_sheet_*`) and behind `HRM / Interview` rather than the CRM's permission, so an HR role links its own sheets without holding the CRM. The importer is `interview/sheetImport.js` (pure: heading aliases, row mapping, validation, classification — `test/hrm-interview-sheet-import.test.js`, which pins a **Meta lead export's own header row** reading whole: Campaign/Adset/Ad Name, `Years of experience`, `Current Salary`, `Languages known?` and `When Can you join?` all map, and the sheet's own serial column is the one heading left unread, since the table numbers its own rows) and `interview/sheetSyncService.js` (the read through `readLinkedGoogleSheet`, the ledger, the code allocator and the writes). **A sync only ever adds**: a row whose candidate is already in the register is skipped as `skippedExisting` and never rewritten, so a status, an interviewer or a remark set here survives the next pass; the only rows a pass writes are new ones and ones that were rejected or failed to write, which are never recorded as imported and are therefore retried on their own (`test/sheet-sync-add-only.test.js`); the assignment rules reuse `leadAssignmentRules.js` and the CRM store's `validateRules` unchanged, stored through Prisma in `interview/sheetRulesStore.js`. `interview/sheetAutoSync.js` polls every active link on the CRM poller's interval |
| `/api/hrm/interview/google-oauth` | The Google account behind the Interview integration: `POST /start`, `GET` / `DELETE /connection`, `GET /picker-token`, `GET /spreadsheets/:id/tabs`. The **same** stored connection and the same handlers as `/api/sales/google-oauth`, mounted a second time behind `HRM / Interview`; only `start` differs, asking for consent with the `connect:interview` purpose so the single public callback sends the browser back to `/hrm/interview` rather than the CRM (`OAUTH_RETURN_PATHS` in the OAuth service). A refused consent returns to the same page, read off the state token |
| `/api/notifications` | The top bar's bell: `GET /` for this reader's notices with an unread count, `POST /:id/read` and `POST /read-all`. Every route is scoped to `req.user.id` in the query itself, so no request shape reads or clears somebody else's. The store is general — a notice carries a type, what it is about and where pressing it goes — and two modules write to it now: Tasks, and the CRM when a lead is put in somebody's name. So it is gated per **type** rather than per endpoint: `TYPE_PERMISSIONS` in [services/notifications.js](src/services/notifications.js) maps each type to the module it answers for, the controller asks once per distinct module, and `listForUser` narrows the rows **and the unread count** to the types the reader's permissions reach — a badge counted over every row beside a list narrowed to some of them is a bell that says three and opens showing one. A type absent from the map reaches nobody, which is the safe direction |
| `/api/onboarding` | Public onboarding application by token |
| `/api/sales`, `/api/sales/whatsapp-group-names` | Sales projects, group-name generator |
| `/api/sales/quotations` | Version-wise quotations, grouped by enquiry. `GET` lists chains — the current version of each with its history attached — and `GET /:id` reads one version in full. `POST` raises a version (the first of a new chain, or the next of the chain that enquiry already has), `POST /:id/versions` raises the next version from the one named, `POST /:id/duplicate` copies a version onto another enquiry as that enquiry's next version, and `POST /:id/link` re-enables that version's public link for another five days. `GET /:id/pdf` is the studio's own copy of a version as a file - the same render as the client's link, scoped like a change rather than like the picker's read, and deliberately *not* governed by the brand's **Allow Client Download**, which decides what the client's link hands out and not what the studio may save. There is no `PATCH`: a quotation already sent is never rewritten. Each version also carries `additionalNotes`, free text typed in the generator that prints on the client's copy above Terms & Conditions - held per version, so an earlier one shows the note it was sent with. Every version also carries `finalized` and `finalizedByEventId` — whether a project converted at that exact version, and which one — read from `sales_project.quotation_id` |
| `/api/image-selection` and `/api/image-selection/projects/:projectId/*` | Projects, folders, uploads, originals, gallery, publication, publish-share, deliverables, WhatsApp. A linked project is created by the list sync, never chosen, and is removed by `DELETE /api/sales/projects/:id` rather than from here — that delete soft-deletes every `ImageSelectionProject` holding the `salesProjectId`, both sections, inside the project's own transaction, then purges the Projects-page ones through `projects/service.purgeData()` once that transaction has committed (R2 cannot take part in it; a bucket failure therefore leaves a project already hidden, which the one-time script `scripts/one-off/purgeImageSelectionProjectsWithDeletedSalesProject.js` retries). Album Proofing rows are hidden and never purged: their proof pages carry `uploadId` values no foreign key protects. The list and the dashboard both apply `LIVE_PARENT` from `projects/repository.js`, so a linked project whose Sales project is deleted is out of the sidebar and out of every count even before it is purged. `GET /projects?attention=` narrows the list to one of the dashboard's views; `POST /projects/:id/gallery/selected/downloaded` is the browser's Download Selected reporting that it finished, the same stamp the originals copy-out writes. `GET …/whatsapp/groups`, `POST`/`DELETE …/whatsapp/group` and `POST …/whatsapp/send-group` are the project's WhatsApp group: linked only to a group the caller's own paired WhatsApp answered for, one live project per group, and the invite sent into it from whoever pressed Send — on their own number — once per publish version |
| `/api/image-selection/album-proofs`, `/api/image-selection/album-proofs/projects` and `/api/image-selection/album-proofs/projects/:projectId/uploads` | Album Proofing: its own projects (list, New Project from a saved group name or a manual name, edit, archive, delete), albums, versions, QC rounds, corrections, client publication, and the upload dock mounted again under its own grant. A correction round's next version is created by `POST /:albumId/revised-version` — the corrected spreads landing — and only then submitted by `resubmit-qc`; resolving a correction creates nothing ([revisionGate.js](src/modules/image-selection/album-proofs/revisionGate.js)). Guarded by `IMAGE_SELECTION / Album Proofing` (reads also by `Album Proofing QC`, which alone rules QC). Never through `projects/` — the two modules share a table, not code |
| `/api/image-selection/originals/*` and `/api/image-selection/projects/:projectId/originals/*` | Registering photos that stay on the studio's drive or NAS, and copying the client's selections out to the Selected Output Path. Every filesystem location is resolved from the database and re-checked against the configured root in [originals/paths.js](src/modules/image-selection/originals/paths.js) — a request never names a path |
| `/api/ai-feature` | The AI Feature: `/overview`, `/events` and everything under `/events/:eventId` - settings, sub-events, guests and groups, folders, media (`POST .../media/upload`, one multipart file per request, derived and queued in the request), processing progress and retry, people, matches, share, activity. Whole router under `IMAGE_SELECTION / AI Feature` (`GET` Read, the rest Read / Write); the people, match and retry routes ask `AI Face Management` on top. Every child query names the event id, so no child can be reached across events |
| `/api/ai-feature/default-settings` | The studio-wide template new events are copied from, behind More → Event Default Settings, under `IMAGE_SELECTION / AI Event Default Settings` |
| `/api/public/ai-feature/:code` | The guest link (public, rate limited): the event and its schedule, `join` (name, phone, PIN if set → a guest session scoped to that event), `gallery`, `folders`, `my-photos`, `selfie` (Find My Photos, matched against this event's faces only), `upload` where the event allows it, and "this is not me" |
| `/api/image-selection/settings` | Studio-wide settings shared by every project (one row): the Project Root Path every download is filed under, plus branding and the two default numbers. `GET` for any signed-in user, `PATCH` Super Admin only. Mounted ahead of the project router so it is not read as a project id |
| `/api/image-selection/dashboard` | The Image Selection dashboard in one response — summary counts, the workflow stages, Needs Attention, the activity series, the selection-progress list, storage statistics and the recent projects — for every Image Selection project as it stands (Album Proofing's rows never among them), with the period figures — projects created, photos added, photos picked, items submitted — for `?range=` (`lifetime`, `month`, `week`, `3m`, `6m`, defaulting to `month`). The activity series covers that same range - one range control on the page, not two - and only how finely it is drawn (a bar a day, a week or a month) is derived, from the span; Lifetime starts at the first pick a client ever made rather than at 1970. Every stage is the Projects sidebar's own rung ([dashboard/classify.js](src/modules/image-selection/dashboard/classify.js) is the one mapping, and the projects list reads it too for `?attention=`); counts are grouped in the database, no photo row is loaded, no folder is scanned and no bucket is listed. Guarded by IMAGE_SELECTION → Project Management (`READ`). Mounted ahead of the project router like settings |
| `/api/image-selection/storage-roots` | Named storage roots ("STUDIO_NAS_MAIN") — the durable identity behind where originals live, used by the Image Selection Desktop app. Names only: each workstation keeps its own mount mapping locally. Soft-deleted; guarded by IMAGE_SELECTION → Upload & Gallery. Mounted ahead of the project router for the same reason settings is |
| `/api/image-selection/projects/:projectId/faces` | The People filter's staff side: `GET /status` (how far the project's photos have got - unscanned / waiting / processing / completed / failed - how many people were found, and whether the engine can run at all) and `POST /queue` (hand the worker every READY photo it has not seen or gave up on; answers 202 at once, the work is in the background). Guarded by `IMAGE_SELECTION / Project Management`, the permission of the gallery these people are found in; 409 when the filter is switched off. No screen calls these yet - they exist so a gallery that predates the filter can be processed |
| `/api/image-selection/whatsapp` | The coordinator's own WhatsApp as Image Selection sees it — `GET /session`, `POST /session/connect` — and `POST /link-all`, which links every unlinked project to the group carrying its name and sends nothing. The same per-person session the CRM chat pairs, read here behind `IMAGE_SELECTION / Project Management` because a post-production coordinator need not hold `SALES / CRM Leads`, and a screen may not be given a finer permission than the endpoint it reads |
| `/api/sales/quotation-settings` | The rates the Quotation Generator prices with, in one row: service rate, deliverable rate, default discount, GST. `GET` to read, `PUT` to save - either on `SALES / Quotation Management` or on `ADMIN / System Settings`, since Settings → Quotation Settings → General is now where they are edited. A brand's own prices, GST and discount (`/api/sales/quotation-brands`) take precedence where set. A quotation stamps these into its own payload as it is generated, so changing them never reprices one already sent |
| `/api/sales/quotation-brands` | The three quotation brands and what each offers. `PATCH /admin/:code` also carries `allowClientDownload`, the brand's Yes/No on whether its clients may save the quotation as a file - see `/api/public/quotations`. `GET /` lists them (`?includeInactive=1` for Settings), `GET /:code/configuration` is the brand's services, deliverables, packages, terms, merged PDF wording and pictures - what the Quotation Generator loads when a brand is picked - and both answer for `SALES / Quotation Management` READ or `ADMIN / System Settings` READ. Everything under `/admin` is Settings → Quotation Settings and answers for `ADMIN / System Settings` (`requireModule`: GET at READ, the rest at READ_WRITE). `GET`/`PATCH /admin/general` is the studio's shared content (the shared words and the map, collages and timeline), routed ahead of `/:code`. Per brand: `PATCH` the brand (name, its own PDF wording overrides - the shared keys are dropped - GST, default discount, active, and `pdfAssets` - `coverSets`, the cover and Thank You photographs per group of shoots; every picture arrives as a data URI and is stored through `storeImage`/`storeImages` exactly as the Global Logo is, so the column holds links). `GET /:code/configuration` also returns `shoots`, the shoots that brand quotes for and the only ones a set may name, `POST`/`PATCH` a service, deliverable, package or term, `PUT .../order` to reorder, `DELETE` a package or term. Services and deliverables are hidden rather than deleted, because a quotation may still name them. Nothing here rewrites a version already raised |
| `/api/sales/callyzer` | The Callyzer **Call Log API**, proxied. `GET /status` says whether credentials are configured; `POST /reports/:report` runs one of `summary`, `employee-summary`, `analysis`, `never-attended`, `not-pickup-by-client`, `unique-clients`. Their documented rules are checked here first, so a bad range is one round trip rather than two. The browser never calls Callyzer directly - the AccessKey stays on the server |
| `/api/sales/whatsapp-chat/*` | Every route that names a lead validates the id through `IDENTIFIER_PATTERN` from [services/identifiers.js](src/services/identifiers.js) rather than a pattern of its own, and so does [services/crmMediaStore.js](src/services/crmMediaStore.js) when it builds an object key. Both had `/^DBS-[A-Z]{2}-EID-\d{1,12}$/` written out by hand — the shape an enquiry id had *before* it carried its vertical and branch (`DBS-DD-EID-4867`) — so both refused every id minted since (`DBS-EID-DD-HYD-000024`): WhatsApp Chat answered "That is not a valid CRM lead id." on every lead, and the media store had nowhere to file a single attachment. The guard is deliberately loose about *which* scheme an id belongs to: its job is that the value is safe to put in a query, a file name and a socket, and whether it names a lead this caller may read is the handler's question, asked against the lead |
| `/api/sales/whatsapp-chat/session` | What this account's WhatsApp is doing, plus the four things that decide whether the application is held shut until it is linked. **All four have to say yes before anybody sees a QR**, and only two of them are the server's: `linkRequired` is `whatsapp_required` on the account (Login Credentials → WhatsApp → **Allow WhatsApp**, off until somebody ticks it) *and* not an administrator (a Super Admin, or any **active** role carrying the Administrator tick — never held, because they do not work leads and they are the people who have to reach Settings to put somebody else's WhatsApp right). The other two are the switches the browser applies in `whatsappLinkNeeded`: the studio's (Settings → User Settings → WhatsApp, off lifts the gate for everyone) and this account's own. A gate that decides not to hold you renders **nothing**, so from the browser a missed tick, a switched-off studio and an administrator's exemption all look identical — which is why "it never asks me for the QR" is not a question the dialog can answer. And there is a fifth thing, which is not a condition but is usually the answer: **an account that is already linked is not asked to link**, which is the gate doing its job and looks identical to all four failing. Whether an account has paired outlives the process — the credentials are on disk under `WHATSAPP_SESSION_DIR`, which is what `restoreSessions` brings back at boot — so it can be answered from outside a running server, unlike the live status. `npm run report:whatsapp-gate -- <name>` prints all five for an account and names the first one that said no ([scripts/reportWhatsappGate.js](scripts/reportWhatsappGate.js)); reads only, safe against production |
| `/api/sales/whatsapp-chat/leads/:id/stream` | A `text/event-stream` the chat panel holds open for as long as a lead is on screen. It says one word — `changed` — whenever anything is written to that conversation, and the panel re-reads the thread through the endpoint it already used; the message itself is deliberately not pushed, so what a message looks like is decided in one place. This is what replaced re-reading the whole thread every 1.2 seconds. Not rate-limited: it is one request that stays open, and counting it against a per-minute budget would spend the whole budget on opening a handful of leads. Needs the proxy to leave it unbuffered — see [DEPLOYMENT-WORKFLOW.md](../docs/project-state/DEPLOYMENT-WORKFLOW.md) |
| `/api/hrm/attendance` | The attendance register: who was here, per person per day. **Derived** from `app_usage_session` - the same measured heartbeat the Work Hours report reads - so an ordinary day needs nothing entered, and a row in `employee_attendance` *overrides* it for what a measurement cannot know: approved leave, a public holiday, a half day, a shoot with no laptop open. `GET` reads a range; `POST` marks or corrects one day; `POST /clear` takes a correction back so the day reads as measured again. Guarded in its controller rather than at the route, because who may see whose depends on whose is being asked for: everybody reads and marks their own, `HRM` / `Employee Management` reads the studio's and corrects anybody's, and a caller without it is narrowed to themselves rather than refused |
| `/api/notifications` | The topbar bell: everything waiting on the signed-in person, gathered from every module they may read — follow-ups due or late, clients who replied on WhatsApp, calls not yet an enquiry, approvals awaiting a decision, and the leads that have just been put in their name. A registry in [notifications/sources.js](src/modules/notifications/sources.js); each source names the permission it answers to and is read only if the viewer holds it, so the bell can never be a way around the guard on the module a notice is about. The route itself asks only that the caller is signed in — it is on every screen, so requiring a module would 403 whole roles on every page. A source that fails contributes nothing and the rest still answer. **How wide it answers is the data scope's answer, not a role test:** `dataScope.seesEverything`, asked per source's module, so a reader the scope does not confine — a Super Admin, or anybody whose branch reach is not narrowed — gets the studio's notices rather than only their own, and a studio-wide line names whose work it is. A bell narrower than the board beneath it would be the one place an administrator's view stopped |
| `/api/sales/crm-reports/:report` | One report of the CRM's own data, filtered by the query string. Six read the studio's call log (`summary`, `employee-analysis`, `lead-analysis`, `never-attended`, `not-picked-up`, `call-history`) and three read how the staff use the application itself: `whatsapp-usage`, `application-usage`, and `work-hours` — the timesheet, a row per person per day with the day's start, finish, hours and idle time. `work-hours` is the one report that joins the two halves of the studio: its hours are **Call Hours + Application Usage**, because the browser cannot see a phone call and a salesperson on a forty-minute call was being recorded as forty minutes idle. Both halves are kept on the row beside the total. It is effort across two systems rather than wall clock and can exceed the length of a day — a call taken with the application open counts in both — so Idle stays measured against the application half alone and Day Span stays wall clock. The two sides are matched on the **name**, the only key there is between a Callyzer handset and an ERP login (the same match `whatsapp-usage` makes); a name on one side with no match on the other still gets a row, showing that half and nothing of the other. **A person on these reports is somebody in the Employee Repository**, at the working statuses and not archived — the same list `GET /options` offers, so the filter and the tables under it name the same people. Employee Analysis, `work-hours` and the call half of `whatsapp-usage` grouped the call log by `employee_name`, which is whatever the handset was labelled in the Callyzer app, so they listed people the filter refused to offer. The match is made **once, when the call is delivered**, and written to `sales_crm_call_log`.`matched_employee_id`: Callyzer's **Employee Code** against the repository's own code (`DBS-10`) first, the handset's **label** against the employee's name second — trimmed, collapsed and casefolded, but never fuzzier than that, because a wrong id files one person's calls under another's. The handset **number** is no part of it: Callyzer reports the company SIM and the repository holds the employee's own number, so the two never meet. `staffCallSql` then only *reads* that id, joining the repository for the name — so a person renamed there is renamed on every report at once, including on the calls they made before, and a handset relabelled in the Callyzer app changes nothing about whose row its calls are on. A call matched to nobody keeps the label Callyzer gave it and is shown to a reader narrowed by nothing; it stays off a scoped reader's report, because it is in no branch and on no team and there is no honest way to decide whose it is. The match is never re-made once written — a company SIM passed to somebody else must not re-file the calls its previous holder made — but a handset matched to nobody is tried again on every start, so an employee added after their first call still picks those calls up. The **call** reports (`summary`, `lead-analysis`, `never-attended`, `not-picked-up`, `call-history`) still count every call: they are about the work rather than the people. `npm run report:employee-match` lists both sides of that match before a deploy. `GET /options` is the filter bar's own lists |
| `/api/sales/quotation-calculator` | The CRM's Quotation Calculator, behind `SALES / Quotation Management`. `GET /catalogue` is the studio's active services and deliverables as Settings → Project holds them: a service as one row per priced pricing line — the booking in words, its price, and the deliverable variants that line brings with it where the service answered Deliverable Added — and a deliverable with its flat fields and price plus every brand and variant it is sold as at the variant's own price, its No. of Count answer and its Settings note, so the calculator picks the way the Quotation Generator picks. `GET /bookings?date=` the shoots booked on a day. `GET /leads/:leadId` and `POST /leads/:leadId` read and apply a quote onto a lead within the caller's lead scope — the calculator still reads a saved draft back to reopen on it, but no longer writes one: its Apply to Quotation hands the choices to the Quotation Generator in the browser instead, and the POST stays for any earlier client; the draft stored with it is the calculator's own state — the service rows as the screen holds them and the quantities by line they resolve to, deliverable quantities by variant key or deliverable id, No. of Count per row, which rows a service line brought in, and the priced lines the total was built from — bounded in size, read by nothing else |
| `/api/sales/crm-leads/branches` | The branches Assigned Branch offers, from the `branch` table, narrowed to the ones the caller's roles reach — `branchOptions` in `src/services/branchOptions.js`, the same rule and the same rows the quotation's Source Branch answers from. It replaces a hard-coded array in the browser whose six names (`Erode`, `Tiruppur`, …) matched no branch the studio has, so a branch added or renamed in Settings never reached the CRM. Behind the router's `SALES / CRM Leads` |
| `/api/sales/crm-leads/column-values` | The values one column actually holds on the tab being read, which is what that column's filter dropdown offers. The menus used to be the registers themselves - the whole Sales roster under CRM, every branch under Assigned Branch, every status the module can produce - so most of a menu was values no row in front of the reader held, and picking one emptied the board. This answers a spreadsheet's question instead: what is in this column, here. Asked with the same board, tab, date range and filters the page is read with, and narrowed by the same data scope, because these are values off rows `/page` is already serving - which is also why it carries no permission of its own. **A column's own filter is dropped** before the query runs: a dropdown narrowed by its own selection offers one value and no way back to the others. Answered from the lead table, or from the call log on the Calls board, so the reader never has to know which store they are looking at. Capped at 500 values; a column with more is one to type into |
| `/api/sales/crm-leads/duplicates` | The enquiries already held against a phone number, matched on its last ten digits — the CRM's one rule for "the same client". Read by Add Lead as a number is typed and by the lead popup when one is edited, so a second lead is never written against a client the studio already has without the existing Enquiry ID being named first. `excludeId` leaves the lead doing the asking out of the list. The forms compare each row's vertical against the one they are writing into: inside it the save is refused, across verticals the enquiry is named and the save goes on. `POST /` and `PUT /:id` hold that same rule and answer **409** `DUPLICATE_PHONE_IN_VERTICAL` — the browser's check is a convenience, this is the guarantee. The bulk and CSV import paths are deliberately outside it |
| `/api/sales/crm-leads/bulk` | Several leads written at once (`POST`), or a whole selection deleted at once (`DELETE`, `{ ids }`), the record shape the single create takes. The delete is **one** `UPDATE` over the selection: it used to run the same statement twice, because `sheets.deleteCrmLeads` - which had long since stopped touching a spreadsheet - was called first and was that same statement, and on a whole board that is seconds a person is watching a spinner for (~4.5s against ~2.2s at 17,573 leads). One statement rather than slices, too: a soft delete costs the row and not the statement, so slicing 17,573 ids into thousands measured *slower*. The webhook is fired rather than awaited, and the optional legacy `leads` mirror is abandoned after its first refusal instead of being retried per slice. The `DELETE` is what the board's red **Delete** over a selection calls, and it — along with `DELETE /:id` — mounts `checkPermission("SALES", "CRM Lead Deletion", "READ_WRITE")` on top of the router's own `SALES / CRM Leads` guard: working the board and destroying its records are different acts, and a select-all reaches a whole vertical. Every id is held to the caller's data scope by `allowedLeadIds` before anything is removed, and the reply names the ids actually deleted, so a lead outside that scope is dropped silently rather than confirmed to exist. What **Import Leads** posts. Each record is minted its Enquiry ID here, one at a time from that record's *own* vertical and branch — the batch can span all three, so it cannot be one reserved range — and each is stamped with its creator, given a `CREATED` row in the activity log, and announced to the CRM it names. It did none of that: `lead.id` is optional on the schema, so every caller that left it out wrote rows with a blank `enquiry_id`, which is the column the board's row key, the Call Logs join, the activity log and the duplicate check are all keyed by |
| `/api/sales/crm-leads/:id/projects` | What this lead's client became, for the lead popup's **Converted History** tab. Matched on the **contact number** — the lead's own number folded to its last ten digits against each project's `client_main_number`, the same rule the Contacts directory and the duplicate check use — rather than on `enquiry_id`, so a booking raised against another of the client's enquiries still appears. Carries enough of each project for the record view the row opens; the workflow (shoots, allocations, deliverables) is deliberately not read here, since this route answers the CRM's permission rather than Projects' |
| `/api/sales/crm-leads/:id/transcripts` and `/api/sales/crm-leads/transcripts/*` | Call transcripts for the lead popup's Transcripts tab: the list per lead, and one transcript with its segments. **Read-only** — there is no longer a route that writes anything from a transcript onto a lead; `POST /transcripts/:id/apply`, which wrote chosen AI suggestions, has been removed with the panel that called it |
| `/api/sales/crm-leads` — duplicate rule | **One number is one enquiry within a vertical**, asked on every write path rather than two: `create` and `update` through `verticalClashResponse`, `createBulk` through `batchVerticalClashes` (which also compares the batch against *itself* — two new rows sharing a number are found by no lookup), and the CSV import through `loadVerticalPhoneKeys`, one query per chunk rather than one per row. An edit is refused only where it **changes** the number: the paths that never asked left pairs of leads sharing one, and guarding an unchanged number would make those pairs uneditable and so uncorrectable. Cross-vertical stays allowed. `test/crm-duplicate-phone-guard.test.js` |
| `/api/sales/google-sheet-links` | The CRM's linked spreadsheets: list, link (`POST`), edit (`PUT /:id`), `POST /:id/sync`, `POST /:id/restore`, `GET /:id/import-preview` and a soft `DELETE /:id`. **A sync only ever adds** — a row whose lead is already in the CRM is skipped as `skippedExisting`, never refreshed, so what the studio has since put on the lead is never overwritten from the spreadsheet; see `sheet-sync-add-only.test.js` and PROJECT-STATE. Behind the router's `SALES / CRM Leads` guard, GET at `READ` and everything else at `READ_WRITE`. A link carries its **lead-assignment rules** in its own create and update payload — a column, a condition and the employee whose lead a matching row is — rather than through endpoints of their own: creating a link runs a full import immediately, so rules arriving in a second request would land after that first import had already assigned nobody, and nesting them means no new permission to seed. `GET /assignable-employees` is the Sales roster those rules may name, served here rather than reused from `/api/sales/crm-employees`, which answers to `REGISTER_READERS` — a permission somebody who may link a sheet need not hold, and which would have shown them an employee picker that refused them. Both read `salesEmployees()` from [employeeOptionLists.js](src/services/employeeOptionLists.js), which tests **membership** of the employee's comma-joined department list rather than comparing the whole column — an employee set to `Sales, Technical` is a salesperson |
| `/api/sales/crd-documents` | Lists CRD document rows with vertical, link and submission status (`GET`); issues the public CRD document link for a project (`POST /:projectId/link`) or returns the one already issued. `POST /` still creates a document for a client with no project yet, but **nothing calls it**: the Create CRD Document button is gone from the screen, because a CRD is asked *of a project* — every row is a booking that owes one, and Send Link on that row is where the client's link comes from. A document belonging to no project had no Event ID, no Enquiry ID and nothing to attach the answers back to. The rows already created that way are still listed and still readable |
| `/api/project-management/client-gifts` | The two gifts a project owes its client — Welcome Gift and Shoot Completed Gift — behind Project Management → Client Gifts. `GET /:gift` lists the projects that owe one (`welcome` or `shoot-completed`), `PATCH /:gift/:projectId/status` moves it between "Yet To Sent", "Sent" and "Received by Client". The first was "Yet To Receive", which named the wrong end of the journey — a gift in it has not been *sent* yet. The column is plain text and rows written before the rename still hold the old word, so `readStatus` folds it on read rather than a migration rewriting them: it is the same answer, it needs no operator step, and the next write puts the new spelling on the row. The dates are stamped here, not sent by the screen, so a gift cannot be recorded as arriving before it left. Guarded by PROJECT → Client Gifts |
| `/api/sales/crd-documents` | Lists CRD document rows with link/submission status (`GET`), and issues the public CRD document link for a project (`POST /:projectId/link`) or returns the one already issued |
| `/api/public/quotations` | The client's quotation by link token: `GET /:token` for the record - with `brandSnapshot` resolved by `presentationForQuotation`, so the page has the words, pictures, branch and studio name the version was raised with - and `GET /:token/pdf` for the same page rendered to a PDF download (public): one sheet the length of the document. A link that has run out of its five days answers `410` rather than `404` - the quotation exists, the link has lapsed. The PDF answers `403` where the quotation's brand has not switched on **Allow Client Download** (`sales_quotation_brand.allow_client_download`, `false` until somebody says otherwise): the record read carries the same answer as `allowClientDownload` so the page can drop its download control, but the refusal is here, read live off the brand, so a brand switched back to No stops serving the links it has already sent |
| `/api/public/crd-documents` | The client's Customer Identification Document by link token: `GET /:token` to read it, `PATCH /:token` to save progress, `POST /:token` to submit. Submit is refused until every required answer is present (public). **Event Details is the studio's half and the client is shown it read-only** — group name, event type, referred by, the point of contact, and when and where the event is, all prefilled from the project and the lead it came from. So `REQUIRED_COMMON` is empty: a field the form will not let anybody type in cannot be one that blocks submission, and Point of Contact Name is routinely blank on a wedding lead, which would have stranded the document with no screen able to fix it. What the client must answer is both sides in full and the terms. The four event fields used to be asked of the groom *and* the bride — two answers to each of four questions about one wedding — and are asked once on the common block now; a document saved under the old shape is lifted onto it on read by `liftSideEvent`, which only ever fills a blank and is safe to run every time |
| `/api/public/image-selection/galleries` | Client-facing gallery by share token (public). Picking is behind the PIN session; `POST /:token/selection/clear` is Deselect All, which releases every pick for one selection item in one statement and is refused on a submitted item like any other change. `GET /:token/people?folderId=` is the People filter's row - who was found in the folder, numbered in the order they were found, with how many of its photos each is in and which existing thumbnail (and where in it) shows their face - and `?personId=` on `GET /:token/folders/:folderId/images` narrows that same listing to one person's photos - or, comma-separated, to the photos any of several people are in; both read stored mappings only, never run the engine, and answer an empty list when the filter is off or has not run |
| `/api/schedule` | The studio calendar behind the topbar Calendar icon: everything booked, from every module that books something — meetings, shoots, a project's main event, the interviews HR has scheduled — plus the studio's declared holidays, in one entry shape. Its own prefix because none of those modules owns the others. **Opening it needs nothing but a signed-in session**, which is deliberate: it used to answer for `SALES / CRM Leads`, and a holiday is the same fact for everybody in the studio. What is *drawn* is still decided source by source — each source is included only for a viewer who holds that module's own Read permission, so a viewer holding nothing gets the holidays and an empty month rather than a 403. Holidays are the one source with no permission, because there is no audience to narrow them to. Meetings are read through the meetings module's own reader rather than re-queried, and a source that fails is named in `unavailable` rather than silently missing. Bookings made by the day carry `day` as plain `YYYY-MM-DD` text so no timezone can move them; a meeting carries its instant instead. The interview source answers for `HRM / Interview` — the whole of the guard the register's own router mounts, because a screen may not be given a finer permission than the endpoint it reads — and reads `interview_date` / `interview_time`, which are **text** columns, through the CRM's own `toIsoDay` and `toClockTime` rather than comparing them in SQL: a `gte` on a text column is an alphabetical comparison, right for the ISO days the register writes and quietly wrong for a `09/09/2026` that reached the table before the column was normalised. The hour travels in `meta` as the text the register shows, with a 24-hour `clock24` beside it for the list's Time column to sort on |
| `/api/settings/holidays` | The days the studio declares itself closed, as Settings → Holidays writes them: `GET` the list (optionally windowed with `from`/`to`), `POST` to declare one, `PUT /:id` to rename or move one, `DELETE /:id` to remove one. `requireModule("ADMIN", "System Settings")` guards the router, so reading needs Read and every change needs Read / Write. A `create` rather than an upsert: `holiday_date` is unique, and a second person declaring a day that already has a holiday gets a 409 telling them to edit the one that is there rather than silently renaming it. Nothing else calls this — the attendance rules and `/api/schedule` each read the table directly, so seeing a holiday never needs an administrator's permission |
| `/api/contacts` | The contact directory behind Sales → Contacts: every phone number the application holds — employees, CRM leads, project and gallery clients, quotation clients, vendor payees, vendors, client-storage buyers — **one row per record**, each under its own id, with its own name, its own vertical and its own module — and each opening its own record. It used to fold them onto one row per person and concatenate the ids, which produced a cell reading `DBS-EID-DD-ERD-000012, DBS-EID-QQ-HYD-000007`: not filterable to either, not sortable by either, one string in the export, and a double click that had to pick one of them, so the second enquiry was reachable from nowhere. The phone number still says which rows are one person — `phoneMatchKey`, the last ten digits, the same rule the lead form's duplicate check applies — and it orders the list so somebody's records arrive together. Each row carries a `key` of source plus id, because an id is unique only within the module that minted it and this list crosses eight. Callyzer's calls are **not** in it: no source reads the call log, and the lead source excludes `board_key = 'calls'`, so a number that rang the studio appears here once its caller has been triaged into a vertical and became an enquiry — not before. Its own prefix because it belongs to no one module. Opening it answers for `SALES / Contacts`, its own permission since the catalogue was made to match the sidebar — the screen is its own entry in the menu, so it has to be grantable on its own. That decides only whether the directory opens: nothing is stored, and each module's rows are read live and only for a viewer who holds that module's own Read permission, so holding `SALES / Contacts` alone opens an empty directory rather than a way past another module's guard |
| `/api/assets`, `/api/asset-categories`, `/api/vendors`, `/api/client-storage`, `/api/asset-requests` | Asset management. The register answers for `ASSET / Asset Management`, and that grant decides only whether the screen opens and whether somebody may *write at all* — **what they may do to one asset is decided per row**, inside the controllers, by `capabilitiesFor` in `assets.read.service.js`. An asset is theirs to manage if they are the employee named as its `managerId` or the login in its `createdBy`; on anything else they can see, the only write is moving it to `UNDER_REPAIR`. Beware the two id types: `managerId`/`assignedPersonId` hold an `Employee.id` and `createdBy` holds a `User.id`, which is why the caller is resolved once into `{ userId, employeeId }` rather than compared ad hoc. **`ALLOWED_STATUS_TRANSITIONS` lives here**, not on the screen — it used to live only in `AssetManagementPage.js`, so `PATCH /:assetId/status` took any status in the enum from anyone who could write while the menu politely hid the ones it should not offer; the list now sends each row's `allowedTransitions` and the screen draws that. Import and delete are refused to anybody but a Super Admin (`superAdminOnly`), the narrow carve-out below for a thing belonging to one role: there is one asset permission and it is held widely, so no level on it could separate disposing of a camera from asking for one. `POST /` and `POST /bulk` answer to **`ASSET / Asset Administration`**, not `Asset Management`: putting equipment on the register is held by few, while the register itself is held widely. `POST /api/asset-requests/:id/approve` deliberately still creates the asset on `ASSET / Asset Request Approval` alone — a second, intended way onto the register |

## Callyzer: two integrations, two credentials

They are opposite directions and use different keys. Confusing them is the single easiest mistake
to make here.

| | Webhook (inbound) | Call Log API (outbound) |
| --- | --- | --- |
| Direction | Callyzer → this server | This server → Callyzer |
| Credential | `CALLYZER_WEBHOOK_SECRET` | `CALLYZER_API_KEY` + `CALLYZER_API_SECRET` |
| Where it comes from | Callyzer > Configure Webhook > Secret | Callyzer dashboard, Settings/Developer |
| What it does | Delivers call logs as they happen | Reads reports and history on demand |

The webhook secret **cannot** authenticate an outbound call, and the API keys cannot verify a
delivery. Both are needed for both halves to work.

The one thing Callyzer's published docs do not state is how the AccessKey and SecretKey travel, so
that is configuration rather than a guess in the code: set `CALLYZER_API_AUTH_STYLE` to `bearer`
(default), `header` or `body` to match their Authentication section. Nothing needs recompiling.

Without the API credentials the routes answer "not configured" and the rest of the system is
unaffected - the webhook keeps delivering calls exactly as it does now.

### A call the router cannot place

`verticalForCall` in [callRouting.js](src/modules/sales/crm-leads/callRouting.js) reads a vertical
off the call's own labels, its note, the employee whose phone took it and the saved contact name.
When none of those answer it refuses to guess - a wedding lead sitting in Qua Qua is invisible to
the people who would have called it back - and leaves `vertical` blank.

A blank vertical used to read as Dum Dum, so every call it could not place landed in the wedding board
anyway. Those calls wait on a board of their own instead: **Leads & Followups -> Call Box**.

### The Call Box: a call is a call, not a lead

The board is **called** Call Box and **keyed** `Calls`. The value keys `CRM_TABLES`, `BOARD_TABS` and
`boardTableColumns` on the client and is the `board` parameter this endpoint takes, which
`isCallsBoard` compares against its own spelled-out `"Calls"` — renaming it to change a heading would
be renaming a wire format. `CALLS_BOARD_LABEL` in
[crmBoards.js](../frontend/src/lib/crmBoards.js) is the half a reader sees.

The webhook does **not** create a lead for a call from a number the CRM does not already hold. It
used to, and that was the mistake: every delivered call - a wrong number, a two-second misdial, a
call nobody answered - took an `EID` out of the same run the studio counts its real enquiries in,
and the board was a queue of leads nobody had asked for.

| | Where it lives | Enquiry ID | When |
| --- | --- | --- | --- |
| A call | `sales_crm_call_log` | `DBS-CLID-000001` | the moment Callyzer delivers it |
| An enquiry | `sales_crm_lead` | `DBS-EID-DD-ERD-000001` | when somebody adds the caller |

**The board is a queue, not an archive.** A call is on it while nobody has added its caller, and it
leaves the moment somebody does — for that caller's own vertical, where the lead is read under the
vertical's enquiry id and worked from there. So the first column, **Enquiry ID**, is always the
call's own `DBS-CLID-…` code and never a lead's: one format per board, and the code on screen says
which board you are reading. That code is also the row's key, which is why a client rung five times
is five rows rather than five rows sharing one lead's id.

Nothing of the call is lost when it leaves. `linkCallsToLead` hands every call from that number to
the new lead, and the lead's **Call Logs** tab reads the whole history back out of
`sales_crm_call_log` — so "what did we do on the phone with this client" is answered where the
client is, rather than by keeping a row on a queue of work nobody has done.

Five things make that work on a database that has been running:

- **A Call ID is `DBS-CLID-…`, and the codes minted as `DBS-CID-…` were rewritten to it.** Read out
  beside an `EID` the old tag was one syllable from it, and a Call ID heard as an Enquiry ID sends
  whoever heard it looking for a lead nobody created. `renameCallIdTag` in
  [callLogService.js](src/modules/sales/crm-leads/callLogService.js) rewrites the tag in place on the
  first read, before the minting below — only the tag, never the number, so it is a rename of every
  code and not a renumbering of the log. Idempotent by construction: `DBS-CLID-…` does not begin
  `DBS-CID-`. Two formats standing side by side on one board is the fault the change was meant to
  end, so nothing is left under the old one.
- **Codes are backfilled on the first read.** They used to be minted on delivery and nowhere else, so
  a log that predated them held rows with none and everything downstream fell back to Callyzer's own
  id for the call — a string like `XgnkwlIXrIKYMem-mDNAP7DPkVfFsV3-4IIhEogXFLU`, which is what the
  board was showing. `ensureCallIds` in [callLogService.js](src/modules/sales/crm-leads/callLogService.js)
  fills them in once per process, behind a cached promise like `ensureCallLogTable` beside it.
- **"Already a lead" is one rule, read by both sides.** `sales_crm_call_log`.`enquiry_id` is plain
  text with nothing keeping it honest — a lead deleted since, or an id in a format no lead has
  carried for a year, leaves a call claiming to belong to one that is not there. `callerIsALeadSql`
  in [callLogService.js](src/modules/sales/crm-leads/callLogService.js) asks it two ways: the call's
  own link, judged against a live lead with a vertical on it, and the caller's number against
  `phone_key`, which is the CRM's one rule for the same client. The board keeps a row by that rule
  and `linkCallsToLead` writes a link by it. They used to disagree — the writer looked only at
  whether the column was empty — and a call naming a dead id was then unlinkable for good: adding
  the caller to a vertical changed nothing on the board however many times it was done.
- **Calls stranded that way are repaired on the first read.** `relinkOrphanedCalls` re-points every
  call naming a lead that is not there at the caller's first live lead, and blanks it where the
  caller was never added. Beside the Call ID backfill, once per process, for the same reason that
  one is there: an operator step is a step somebody has to know about.
- **Call times are restamped onto the studio's clock.** Callyzer sends its wall clock with no offset
  on it — `call_date` and `call_time` are the handset's own, so Asia/Kolkata — and `calledAt` read
  them as UTC, which does not mark the instant but moves it: a call taken at 12:00 went into
  `called_at` as 12:00Z and the Call Logs tab, which renders in the studio's zone, showed it at
  5:30 pm. `restampCalledAt` in [callLogService.js](src/modules/sales/crm-leads/callLogService.js)
  corrects the log already written, beside the other two backfills, so the tab does not end up with
  old calls on one clock and new ones on another. Recomputed from `call_date` and `call_time`, which
  nothing has ever written to, rather than shifted blindly — so it is a re-derivation, and it is
  idempotent by construction: it matches only a row whose `called_at` is still its un-shifted wall
  clock, and a row it has corrected no longer is one.

So the Calls board is a cut of the call log, read by
[callBoardService.js](src/modules/sales/crm-leads/callBoardService.js) — one row per unplaced call.
It is served through the same `/api/sales/crm-leads/page` endpoint in the same record shape, which is
what lets the board reuse the table, the filters, the sorting, the infinite scroll and the selection
every other board uses; `isCallsBoard` in the controller is the only fork.

**Five tabs**, and they overlap on purpose - they are readings of one list rather than boxes it is
sorted into, so a missed call appears in three of them and the counts add up to more than the board
holds:

| Tab | What it holds |
| --- | --- |
| All | every call |
| Incoming | `call_type` Incoming, Missed or Rejected - the client rang |
| Outgoing | `call_type` Outgoing |
| Connected | `duration_seconds > 0` - somebody actually talked |
| Not Connected | `call_type` Missed or Rejected - the client rang and the studio did not pick up |

**Not Connected is the calls the studio did not answer.** It was `duration_seconds = 0`, every call
of zero length whichever way it went, and that put two unrelated things under one tab: a number the
studio rang that did not pick up is the client being unavailable, while a client who rang and got no
answer is the studio failing to take the call. Only the second is work anybody has to do something
about, and it is what the tab is read for — so an unanswered outgoing call was noise on the list that
matters most on this board. It is `NEVER_ATTENDED_SQL` now, which is inbound by definition, so
nothing outbound reaches the tab and unanswered outgoing calls are read under **Outgoing** instead.
Nothing is hidden; it is filed under the thing it is.

That is also the clause the **Status** column reads "Never Attended" for, so the tab and the cell now
say one thing about a row: every row under Not Connected reads Never Attended, and every row reading
Never Attended is under it. The column keeps the different word on purpose — the tab says what you
are looking at, the cell says what happened to that call — and its third value, Not Connected, is
what is left: an outgoing call that did not connect.

Somebody reads the caller, double-clicks the row, and the Add Lead form opens on what the call knows,
with the Vertical radio for whichever of the three they turn out to be. Confirming **creates** the
lead - a `POST` now, not a `PUT` - so the `EID` is minted for the vertical just chosen, and
`linkCallsToLead` hands every call from that number to it. The call stays on the board and wears the
new id in its Enquiry ID column; double-clicking it again opens the lead rather than the form.

That form is also where a caller is turned down: **Rejected** is offered in its Lead Status pills
when it was opened from a call, and nowhere else. A call cannot be rejected - it already happened -
so the status belongs to the lead it writes, and that lead lands in its own vertical's Rejected tab.

A caller the CRM already holds is unchanged: the call is attached to their existing lead and the lead
is updated, exactly as before.

**Contacts.** A call is not a contact, and the directory holds none of them. It used to hold every
caller's number twice over - as a side effect of the webhook creating leads, and then through a
`crmCall` source reading `sales_crm_call_log` directly - and the studio's objection is the right one:
a misdial, a courier and a wrong number arrive identically, under a Call ID with no name, and there
were nine thousand of them ahead of the rows anybody wanted. Both are gone from
[contacts/directory/service.js](src/modules/contacts/directory/service.js): no source reads the call
log, and the `crmLead` source excludes `board_key = 'calls'` so the leads the old webhook wrote stay
out as well. A caller becomes a contact by being **triaged** - somebody adds them to a vertical on the
Calls board, which mints a real enquiry, and that enquiry is listed with the name and vertical a
person actually filled in. The number is still reachable meanwhile, on the Calls board and on the
lead's Call Logs tab.

**Create Project.** The same rule, for the same reason:
`listEnquiries` in [projects/controller.js](src/modules/sales/projects/controller.js) excludes
`board_key = 'calls'`, so the enquiry picker offers the leads on Leads & Followups and no calls. The
old webhook's rows were filling its page of fifty with `Unknown` against a bare mobile number, and a
project must not be bookable against a caller nobody has triaged.

**Migrating an existing database.** [retireCallyzerCallLeads.js](scripts/retireCallyzerCallLeads.js)
gives every call already in the log a Call ID, then soft-deletes the leads that were never anything
but a call - Callyzer, no vertical, no status, no follow-up, no notes of their own, and no quotation,
project, meeting or CRD against them - and unlinks their calls so they appear on the board as calls.
It reports by default and writes only with `--apply`. Anything somebody has worked is left alone.

Until it has been run, those leads are still in the table with a blank vertical, which is why
`CALLS_SQL` in [leadQueryService.js](src/modules/sales/crm-leads/leadQueryService.js) survives: Dum
Dum is defined as everything *except* it, and without that exclusion every one of them would appear
in the wedding board. It is also why the stored `board_key` column it defines is the one test the
enquiry picker and the Contacts directory both make - a screen that read `source` and `vertical` for
itself would be a second definition of "this is a call", free to drift from the board's.
`reissueEnquiryIdOnPlacement` in `crmLeadService.js` survives for the same
reason - one of those leads placed into a vertical by hand is still renumbered for it, moving the
primary key and the ten other columns that quote it in one transaction.

### Trying the whole flow without waiting for a real call

Callyzer's own "Test" button fires from their cloud, so it cannot reach a local server - `localhost`
resolves on their machine. [testCallyzerWebhook.js](scripts/testCallyzerWebhook.js) is that sender
instead, posting the way Callyzer does, header for header and with no `Content-Type` at all.

```bash
npm run test:callyzer                      # Callyzer's own documented sample: proves the route works
npm run test:callyzer -- --test-leads      # the routing fixture: one call per decision the webhook makes
npm run test:callyzer -- --test-leads --today   # the same, dated today so the New tab fills
npm run remove:callyzer-test-leads         # what it created, listed
npm run remove:callyzer-test-leads -- --apply   # and removed
```

[callyzerTestBatch.js](scripts/callyzerTestBatch.js) is the fixture: eleven calls, of which eight are
stored and three are set aside - a colleague's number, a call labelled Personal, and one with no
number. **None of the eight becomes a lead**, and that is the fixture's main assertion now: every
number in it is invented, so none matches a client the CRM already holds, and all eight wait on the
Calls board under their own Call IDs. Each call carries a note saying which rule it is there to
prove, and the sender prints the expected outcome per number so the CRM can be read against it
rather than against a guess.

Every number begins `99000`, which no Indian mobile does. That is what lets the fixture never
collide with a real client and lets `removeCallyzerTestLeads.js` find its rows again with certainty
- it deletes on that prefix and has no flag to widen it. Leads are soft-deleted (`deleted_at`, the
same column the CRM's own Delete sets); the call logs under them are removed outright, because
`sales_crm_call_log` has no soft delete and a call pointing at an invisible lead makes the
"Enquired N times" counter wrong on the next delivery.

Two things worth knowing before running it against anything but your own machine:

- **A delivery creates real leads.** Sending the fixture at the studio's server puts seven
  fabricated enquiries in the CRM the sales team is working from, so the sender refuses any
  non-loopback `--url` without `--confirm`, and the cleanup has to be run **on that server** - it is
  a database job, not an HTTP one.
- **The staff directory is learnt from the call log.** `knownEmployeeNumbers()` reads back the
  distinct `employee_number`, so once the fixture has been delivered its two employee numbers are
  staff for good, and a later call *to* one of them is filtered as a colleague. Removing the rows
  undoes it, after that lookup's five-minute cache expires.

## Identifiers: one shape, one counter

Every record the studio names by a code gets it from
[services/identifiers.js](src/services/identifiers.js), and from nowhere else:

```text
DBS - <what it is> - <vertical> - <branch> - <number>
```

with the middle two present only where they mean something. A vendor belongs to the studio rather
than to a vertical, so it is `DBS-VNMGMT-000001`; an asset lives at a branch but serves every
vertical there, so it is `DBS-ASMGMT-ERD-000001`; a lead is both, so it is `DBS-EID-QQ-ERD-000001`.

| Scheme | Shape | Counted per |
| --- | --- | --- |
| `EMPLOYEE` | `DBS-1` | the studio |
| `CRM_LEAD` | `DBS-EID-QQ-ERD-000001` | vertical |
| `CALL_LOG` | `DBS-CLID-000001` | the studio |
| `SALES_PROJECT` | `DBS-BK-DD-ERD-000001` | vertical |
| `PROJECT_SHOOT` | `DBS-SID-DD-ERD-000001` | vertical |
| `QUOTATION` | `DBS-QO-QQ-ERD-000001` | vertical |
| `CRD_DOCUMENT` | `DBS-CRD-DD-000001` | vertical |
| `IMAGE_SELECTION` | `DBS-VCIS-000001` | the studio |
| `CASH_SPENT` / `CASH_RECEIVED` | `DBS-MS-…` / `DBS-MR-…` | vertical |
| `EMPLOYEE_REFERRAL` | `DBS-REF-000001` | the studio |
| `ASSET` | `DBS-ASMGMT-ERD-000001` | the studio |
| `VENDOR` | `DBS-VNMGMT-000001` | the studio |
| `CLIENT_STORAGE` | `DBS-STOMGMT-000001` | the studio |

**The branch is shown but never counted by.** A vertical runs one sequence across all of its
branches:

```text
DBS-EID-DD-ERD-000001
DBS-EID-DD-ERD-000002
DBS-EID-DD-CBE-000003      <- a Coimbatore lead, carrying on the same run
DBS-EID-DD-VIZAG-000004
```

so the number says how many enquiries that vertical has taken — the question the studio actually
asks of it — and the branch code beside it still says where each one came from. Counting per branch
instead gave five leads all numbered `000001`, which reads as five copies of the same record.
`countedParts` derives this by dropping the branch rather than listing it per scheme, because a
scheme that showed a branch and quietly counted by it would put two records on the same number and
nothing on screen would say so.

`SALES_PROJECT` is the one identifier a **booking** and a **project** share, because Sales Manager
and Project Management work the same row: the studio quotes one code from the sale through to
delivery, and there is no separate project number to keep in step with it. A shoot inside that
project takes its own run, because the studio counts and rosters shoots rather than projects.

**Renumbering what is already here.** [renumberIdentifiers.js](scripts/renumberIdentifiers.js) brings
records carrying an older shape onto the current one, sweeping every column that quotes each id. Its
`--renumber` mode re-issues identifiers that are already well-formed, which is what a change to the
*counting* rule needs — it reports by default, writes only with `--apply`, and stages each rename
through a temporary name because a renumbering is a permutation and half of the new names collide
with codes other rows are still holding. Identifiers already quoted to clients change, so it wants a
backup and one deliberate run.

**And that is why this is one module.** The only way "Qua Qua counts 1, 2, 3 …" stays true is for
one counter to be addressed by the same key every time it is asked. Eleven modules each deriving
their own key from their own idea of what "Qua Qua" is called is how one vertical quietly ends up
with two sequences — and a duplicate identifier is not something the studio finds out about gently.

So a module asks and is handed a string:

```js
const { nextIdentifier, peekIdentifier } = require("../../services/identifiers");
// Inside the transaction that writes the row, so a failed create does not spend a number.
const enquiryId = await nextIdentifier("CRM_LEAD", { vertical, branch }, tx);
// What the next one *would* be, without taking it - for a form that previews it.
const preview = await peekIdentifier("EMPLOYEE");
```

`vertical` and `branch` are whatever the record holds — `"Coimbatore, Tamil Nadu"`, `"quaqua"`,
`null`. They are folded through the alias tables in that module, so four producers writing a branch
four ways still produce one code. **A record naming no branch takes Erode** rather than refusing to
save: a lead reaches this application from the Callyzer webhook with nothing on it, and an
identifier that cannot be minted is a record that cannot be saved.

`frontend/src/lib/identifiers.mjs` states the same rules for the browser — it validates one and
reads the branch out of one — and `frontend/test/identifiers.test.mjs` reads *both files* and fails
if they drift. That test also pins the eleven shapes as literals: the studio asked for these exact
strings, and a test that built the expected string the same way the code does would prove only that
the code agrees with itself.

### Renumbering what was already here

[scripts/renumberIdentifiers.js](scripts/renumberIdentifiers.js) rewrites existing records into the
new shapes, along with every column that quotes them — an enquiry id alone is stored as plain text
on ten other tables. It is a script rather than a migration because it has to apply *the real rule*;
written again in SQL it would be a second copy of the alias tables, drifting from the first.

```bash
node scripts/renumberIdentifiers.js            # say what would change, write nothing
node scripts/renumberIdentifiers.js --apply    # do it, and leave the counters where it finished
```

It skips a record already in the new shape, so running it twice is safe. **It cannot reach the
Google Sheet**: the CRM's sheets carry their own Enquiry ID column, and a renamed lead no longer
matches it — the sync falls back to matching on phone number, which is what it already does for a
sheet row with no id.

### What counts as a day

A lead's dates are **text**, written by whatever produced them, and until recently "a day" meant two
shapes: `YYYY-MM-DD` and `DD/MM/YYYY`. Excel's short date is `09-Sep-26`, so a studio exporting its
own leads and importing the file back stored every date in a shape nothing here could read. That was
not one wrong cell:

| What read it | What it did with `09-Sep-26` |
| --- | --- |
| `enquiryDaySql()` | NULL — the lead was in no Today New Leads, no Yet to connect, no date range |
| `follow_up_day` (STORED generated column) | NULL — in no Today or Yesterday Pending tab; it falls into Overall Pending, which is where the undated go. A lead at **Invalid or Rejected** carries NULL by rule rather than by omission: `flattenLeadColumns` clears the date and time whatever the caller sent, so a lead nobody is chasing holds no call anybody is going to make |
| `dob_edod_day` (STORED generated column) | NULL — in neither Newborns nor Birthdays, which is the whole of Qua Qua |
| `leadArrivalDay` in the browser | not a date, so the Enquiry Date cell fell through to the row's insert timestamp and printed **today** on every row of the import |

[leadDates.js](src/modules/sales/crm-leads/leadDates.js) is now the one list of shapes, and
everything that reads or writes a lead's date goes through it — `toIsoDay` for JavaScript,
`isoDaySqlFor` for the board's SQL, and a twin of the first in
[frontend/src/lib/crmLeadDates.mjs](../frontend/src/lib/crmLeadDates.mjs) for the browser. Two rules
hold the list together: **ISO is tried first and nothing may reinterpret a value that already
parsed**, and **day comes before month**, as `DD/MM/YYYY` had already decided for this application.

`crm-lead-dates.test.js` runs all three over one shared sample list — `test/lead-date-samples.json`,
which the frontend test reads too — and the SQL half runs **against MySQL** rather than being
asserted as a string. That is not ceremony: `STR_TO_DATE('09-Sep-2026', '%d-%b-%y')` reads `20` as
the year and answers **2020**-09-09, and no amount of reading the SQL would have shown it. Use `%Y`,
never `%y`; use `%M`, never `%b`.

**Written as ISO, whatever arrives.** `flattenLeadColumns` folds every date column to `YYYY-MM-DD`,
and it is the one object every INSERT and UPDATE in the module takes its values from — so Add Lead,
Import Leads, the CSV import, the sheet sync and the API all store the canonical shape. This is what
keeps the schema's own generated columns from ever seeing something they cannot read, without a
migration that would rebuild the table to widen three STORED expressions.

**Rows written before that** keep their original text, and a reader cannot help them: the tabs filter
on the generated column, not on the text. Rewriting the text is what makes MySQL recompute all three,
which is `npm run normalise:lead-dates` — a dry run by default, `--apply` to write, safe to run twice,
and it never discards a value it cannot parse. **Run it once per environment** after deploying this.

## One date files a lead: its Enquiry Date

Every tab on Leads & Followups that is about a date, and the header's date range, read the **same**
day, and it is the lead's own **Enquiry Date** - what the Date column shows. (The Status column's
unset case no longer reads a day at all: see **Yet to connect does not expire** below.) One
expression states it, `enquiryDaySql()` over `COLUMN_SQL.enquiryDate` in
[leadQueryService.js](src/modules/sales/crm-leads/leadQueryService.js):

```text
date  →  created_date  →  created_at        the enquiry's own date, then its source's, then the
                                            moment the row was written - the last thing left to
                                            date a lead nothing else dates
```

There used to be a second reading beside it, `created_day` - a STORED, indexed generated column
holding the day the **row was written** - and Yet to connect, the Status derivation and the date
range all compared that instead. For a lead typed into Add Lead the two are the same day. For
anything imported, synced or bulk-entered they are not, and the consequence was the whole point of
the board going wrong: a studio importing a year of old enquiries wrote every one of them today, so
the entire file landed in **Today New Leads** and **Yet to connect** at once and fell inside any
range covering today, whatever the enquiries' own dates said. The tab meant to be today's calls
became the import, and could only be emptied by working through it lead by lead.

| Reader | Reads |
| --- | --- |
| Today New Leads | Enquiry Date `=` today |
| Yet to connect | no status set, **whatever the Enquiry Date** - or the words stored on the row |
| Status column, unset | Yet to connect, for as long as no status is set |
| Header date range | Enquiry Date between the two days |
| Today / Yesterday Pending | **not** the enquiry date: `follow_up_day` `=` today / `=` yesterday, with the status at Followup |
| Overall Pending | `follow_up_day` `<=` **today**, **or NULL**, with the status at Followup — everything still owed, deliberately overlapping both dated tabs |
| Newborns / Birthdays | **not** the enquiry date: `dob_edod_day`, through the occasion windows in `occasionLeadService.js` |

**Yet to connect does not expire.** A lead with no status set reads Yet to connect, and goes on
reading it until somebody sets one - there is no day in that rule. It used to read Yet to connect on
the day of its Enquiry Date and **Inactive** from the next morning, with exemptions added one at a
time as each was found to be hiding calls that were still to be made: a Qua Qua lead inside an
occasion window, then anything a Google Sheet link had put here. The exemptions were the rule telling
on itself, so the ageing is gone and the derived Inactive with it. Inactive is still printed for a
row that genuinely stores the word, which is what an import writes when the file's own Status column
said so.

Two consequences, both deliberate. The Yet to connect tab is now a **backlog** rather than a day's
list - it empties by being worked, not overnight, and on a board carrying old imports it opens with
every untouched lead on it. And the tab holds **both ways the label arrives**: the derived case and
the rows that store the words. Today Pending Followups already read both; the tab named for the label
did not, so a row could read Yet to connect in the Status column, answer a Status filter of Yet to
connect, be counted in Today Pending, and still be missing from the tab.

**The pending tabs are dated by the call that is owed, not by the enquiry.** A "pending followup"
is work due, so `follow_up_day` decides all three: Today Pending is the calls owed today, Yesterday
Pending the calls owed yesterday, Overall Pending everything owed today or earlier. Overall
bounded at yesterday until September 2026, on the reading that a call booked for today is not yet
late; the studio reads it as the total still owed rather than the total overdue, and leaving today
out made it short by a whole day's work, every day. They were
briefly cut by the enquiry date so that the date visible in the table was the date the tab was cut
by; that reads well and answers the wrong question, because a lead that enquired in July with a call
booked for yesterday is work owed yesterday, and filing it under July left the call in no dated tab.
A worklist is dated by when the work is due.

**Overall deliberately overlaps Yesterday**, and this is the one place on the board where the tabs
are not a partition. It is `<=` yesterday, so a call owed yesterday is in both — Yesterday Pending is
that day on its own, Overall is the whole backlog behind it. The counts on the strip therefore do not
add up to the board, on purpose. The bound is at yesterday rather than today for the tab's one hard
rule: **a call booked for today is not late** and must never appear in Overall. `follow_up_day IS
NULL` is in Overall too — a follow-up whose date was never filled in, or was typed as something that
is not a date, is owed on a day the board cannot name, and that is late work rather than no work.

**Newborns and Birthdays are the exception and must stay one.** They are cut by their own
calculation — the newborn window around the estimated delivery date and the run-up to the child's
first birthday, both read off `dob_edod_day` — because a lead that enquired in June is exactly the
lead whose window opens in September. Moving those onto the enquiry date would empty the two tabs
that are the whole of Qua Qua. `crm-lead-tabs.test.js` asserts they read no enquiry date.

Two things follow, and both are why this is written down rather than left to be rediscovered:

- **The Status derivation and the Yet to connect tab must read the same expression.** The tab is that
  derivation asked as a question. Move one and the board lists leads whose own pill says something
  else.
- **It costs a function per row where `created_day` cost an index lookup.** Accepted deliberately -
  Today New Leads has always paid it, `board_key` narrows the scan to one vertical first, and
  correctness is not optional here. If the board ever grows to where the range feels slow, the fix is
  a STORED generated column over those three columns beside `created_day`, and it changes only
  `enquiryDaySql()`. Note that adding one rebuilds the table, so it is a deploy-window migration.

**What writes that date.** A lead is only filed correctly if its source stated a date, so every way
in carries one. Add Lead stamps today every time the dialog opens and Import Leads stamps the day
the batch is typed; neither asks for an Enquiry Date, because a lead written down as it comes in is
that day's enquiry - and stamping on open is what stops a board left running overnight filing this
morning's lead under yesterday. A lead that needs another date is backdated from the lead popup after
it is saved. The file-based paths do read their source's date, Import Leads asks it per row for
the same reason, and both the CSV import and the Google Sheet sync read a `Created Date` / `Enquiry
Date` column and fall back to the day of the run only when the source states nothing.
`crm-import-enquiry-date.test.js` holds the two sheet mappers to the same chain - they had drifted,
and the sync's was stamping today over a stated date.

## Qua Qua occasions: one lead, a new enquiry when it comes round

Qua Qua shoots children, and the same client is worth calling more than once. Two occasions say so,
and the studio works both the same way:

| Occasion | Window | Filed under |
| --- | --- | --- |
| **Newborn** | 30 days before the estimated delivery date to 5 days after | the delivery's year |
| **Birthday** | 2 to 45 days before the child's next birthday | that birthday's year |

Both are read off the one field that holds either, "Date of Birth (or) EDOD". A lead whose window is
open goes back into **Yet to connect** alongside the genuinely new leads, and the status somebody
sets there is stored against that occasion — `sales_crm_lead_occasion`, keyed by
`(enquiry_id, occasion, occasion_year)` — and not against the lead. Writing it onto the lead would do
two wrong things at once: overwrite the record of what the last shoot ended as, and leave a status
sitting there for ever, so next year's birthday would never return to Yet to connect. A year with no
row **is** an occasion nobody has connected about, which is why nothing has to be written in advance
for one to appear.

[occasionLeadService.js](src/modules/sales/crm-leads/occasionLeadService.js) is the only place that
decides what a window is, and it states each rule twice on purpose:

| | Used by | For |
| --- | --- | --- |
| `match` per occasion, `occasionOccurrence`, `occasionContextFor` (JavaScript) | `crmLeadService.js` | Deciding, on a write, which occurrence a status belongs to |
| `windowSql` per occasion, `occasionYearSql`, `occasionColumnSql`, `occasionOverrideSql` | `leadQueryService.js` | Deciding, on a read, which leads the board lists and at which status |

The two must answer the same for the same lead on the same day, or a row is offered in Yet to connect
and then refused a status. `crm-lead-occasions.test.js` pins them against each other — including
29 February, which both sides land on the 28th because that is what MySQL's `DATE_ADD ... INTERVAL n
YEAR` does.

**The two windows can never both be open on one lead**, and that is what lets a lead read exactly one
status. A birthday needs the stored date to be in the past *and* its next recurrence 2-45 days off; a
date inside the newborn window is at most 5 days past, whose next birthday is some 360 days off. The
test sweeps the whole newborn window rather than arguing about it, because it is the assumption
`occasionOverrideSql` rests on. `OCCASION_ORDER` names newborn first anyway, so even a future
widening could not make one lead claim two.

Three consequences worth knowing before changing any of it:

- **While a window is open, the occasion's status is the lead's status everywhere the board looks.**
  `statusKeySql` and `followUpDaySql` in `leadQueryService.js` carry it, so the Converted, Rejected
  and Pending Followups tabs count such a lead by its occasion. A tab filtering on a different status
  from the one on screen is worse than either being wrong: the label is right there to be typed into
  the filter.
- **The API sends the occurrence beside the lead, not folded over it** (`occasionWindow`,
  `occasionKind`, `occasionStatus`, ... on `details`). That is what lets a screen read a lead and
  save it back without ever copying an occasion's status onto the lead. The client prefers those
  fields — see `resolveLeadStatus` in `CRMPage.js`.
- **Nothing here reaches Google Sheets.** The sheet's Status column is the *lead's* status, and it is
  the one copy of it this application does not own. `splitOccasionWrite` in `crmLeadService.js` puts
  the diverted fields back to what the lead holds before the sheet write runs.

Off the Qua Qua board none of this exists: `occasionOverrideSql` returns the plain column, so no
occasion SQL is generated for Dum Dum, Corp or Calls at all.

## Google Sheets: a linked sheet assigns its own leads

A spreadsheet says who a lead is. It almost never says *whose* lead it is — so every lead a linked
sheet imported arrived with an empty CRM column, and somebody assigned them by reading a column the
sheet does carry (the Facebook page, the form, the city) and picking a name per lead. On a sheet the
poller re-reads every 2 minutes, that is a job nobody finishes.

A link now carries an ordered list of **assignment rules** in `sales_google_sheet_assignment_rule`:
a column, the value to look for in it, and the employee whose lead a matching row is. Written in the
same dialog that links the sheet, because `create` runs a full import the moment the link is stored.

| Piece | Where | What it does |
| --- | --- | --- |
| The decision | [leadAssignmentRules.js](src/modules/sales/crm-leads/leadAssignmentRules.js) | Pure. `buildAssignmentMatcher(headers, rules)` compiles the rules against one sheet's headings once, and answers "whose row is this?" per row. No database, so the rules can be argued with directly in a test — the way `callRouting` answers the same question for a Callyzer call |
| The storage | [rulesStore.js](src/modules/sales/google-sheet-links/rulesStore.js) | Read, replace, validate. Kept apart from the controller because the sync reads the rules and the controller writes them, and the controller already requires the sync |
| The use | `mapRowToCrmCandidate` in [googleSheetsService.js](src/modules/sales/crm-leads/googleSheetsService.js) | One line: `crm: lead.crm \|\| existing?.lead?.crm \|\| assignment?.crm \|\| ""` |

Four decisions worth knowing before changing any of it:

- **Rules fill blanks; they do not overrule people.** That one line is the order the answers are
  trusted in: the sheet's own CRM column, then the owner the lead already has, then the rules. The
  poller re-reads *every* row of every sheet every 2 minutes, so a rule placed ahead of `existing`
  would undo a manager's reassignment within the minute — visibly, with the lead moving back on its
  own. Editing the rules does not re-assign leads already imported; a rule change is not a bulk
  reassignment.
- **The rules are read from the link's id inside `prepareGoogleSheetCrmImport`**, not handed in by
  the caller. Three places build a link object out of hand-written SQL — the poller's
  `listActiveLinks`, the controller's `sync`, and `LINK_SELECT_SQL` — and a rule set carried on the
  link would have to be added to all three, with the one that was missed failing silently as leads
  quietly arriving unassigned. Read from the id, every caller gets them without knowing they exist,
  which is what makes the first import and the 2-minute auto-sync assign identically.
- **Rules match the sheet's own header text**, not the CRM field the importer maps it to. The
  columns a studio actually routes by — Page Name, Form Name, Team, Ad Account — are exactly the
  ones `CRM_FIELD_ALIASES` has no name for, so they land in `unmappedHeaders` and a rule written
  against a mapped field could never see them.
- **A rule that cannot fire is reported, never silently dropped.** A column renamed in the
  spreadsheet leaves the rule stored and matching nothing, and every lead it used to assign arrives
  with no owner — which looks exactly like having written no rules at all. The import preview names
  the missing columns, and the sync summary carries `assignedByRule` and `unassignedRows`.

**One column matching one value, and nothing else** — no operators, no catch-all. Matching is
forgiving about case, spacing and punctuation (`fold`), because these rules are typed by hand
against columns filled in by hand and a rule that fails on a hyphen reads as a rule that does not
work; but the value is matched whole, so "Coimbatore Weddings 2026" is not "Coimbatore Weddings".
Two values going to the same person is two rules rather than a syntax to learn.

The first matching rule wins and evaluation stops. Two rules matching one row is not an error to
report: it is a question the studio answers by ordering them, which is why `priority` is stored and
editable rather than inferred from insertion order.

Deleting a link is a **soft** delete and leaves its rules in place, so `POST /:id/restore` brings
back a link that assigns exactly as it did. Only the rollback of a link whose sheet could not be
read removes them, because that link never really existed.

## Cover: who gets the work when somebody is away

Every employee may name two alternatives (`alternative1EmployeeId`, `alternative2EmployeeId`).
Together those are a directed graph, and the CRM walks it when a Google Sheet assignment rule names
somebody who cannot take the lead today.

| Piece | Where | What it does |
| --- | --- | --- |
| The rules | [alternativeChain.js](src/services/alternativeChain.js) | Pure. Cycle detection (`cycleThrough`, `forbiddenAlternatives`) and resolution (`availableCover`). No database, so the rules can be argued with directly in a test |
| The facts | [leadCover.js](src/services/leadCover.js) | Loads the graph, and who is away: approved `LEAVE` requests covering today, plus anybody archived or on a non-working employment status |
| Enforcement | `alternativeCycleProblem` in [employees/controller.js](src/modules/hrm/employees/controller.js) | Refuses a looping save on both create and edit, naming the route |
| Use | `prepareGoogleSheetCrmImport` in [googleSheetsService.js](src/modules/sales/crm-leads/googleSheetsService.js) | One resolver per pass; a rule's target is redirected to whoever can take it |

**The rule: no two people may cover each other.** If Vijay names Abi and Abi names Vijay, the pair
covers nobody outside itself — on a day both are away each points at the other, and the studio has
never said who ends up holding the work.

**Direct pairs only, and that is deliberate.** A longer ring — `Vijay → Abi → Kishore → Vijay` — is
allowed, because it is how every employee can have cover at all:

    2 employees   the only way to cover both is to have them cover each other, which is the
                  refused pair. One of the two is always the end of the line.
    3 employees   the fewest at which **nobody** is uncovered: a ring of three holds no pair,
                  and each person's work has somewhere to go.

Because rings are legal, resolution must not assume the walk ends on its own — `availableCover`
terminates on its `seen` set, visiting each employee at most once, and that is load-bearing rather
than defensive. The check itself is judged against the graph **as it would be after the save**, so
an edit that removes one link while adding another is not refused for a pair it is itself undoing.

**Resolution takes the nearest ring whole.** Vijay's own two people are asked first, and the search
moves outward only if *both* are away — otherwise some of his leads would go to Abi's alternative,
somebody Vijay never nominated, while Kishore sat free. Within a ring the work is round-robined, so
cover is shared rather than piled on whoever the graph reached first. An empty answer is a real
answer: the lead stays unassigned.

## Call Transcripts

Callyzer delivers a call log with a recording URL; the webhook saves the call, creates a transcript
row and queues a job. **It never waits for transcription** - Callyzer times deliveries out and a
five-minute call takes minutes to transcribe.

```text
webhook -> call log saved -> transcript row (PENDING) -> BullMQ
        -> download -> ffmpeg to 16kHz mono wav -> faster-whisper -> segments
        -> Claude reads it -> summary, outcome, next action, suggestions -> COMPLETED
```

Transcription runs **on this server** with faster-whisper - no API key, no per-minute cost, and the
audio never leaves the machine. Setup, once:

```bash
sudo apt install -y python3-pip
pip3 install faster-whisper
# The model downloads on first use (~500MB for "small") and is cached in ~/.cache/huggingface.
```

Then set `CALL_TRANSCRIPTION_ENABLED=true` and restart. Until that is set the webhook still queues
jobs, and they are picked up whenever a worker first starts - nothing is lost by enabling it later.

`ANTHROPIC_API_KEY` is separate and optional: without it the transcript is still made and shown, it
simply carries no summary or suggestions.

Two limits worth knowing:

- **Speaker labels are inferred, not measured.** faster-whisper transcribes but does not diarize,
  so Employee/Client comes from the call's direction plus the gaps between turns. It is right most
  of the time and wrong when people talk over each other. The panel says so. Real diarization means
  `pyannote.audio`, a HuggingFace token and its licence; `speakers.js` is the only file it replaces.
- **Nothing is written to a lead from a transcript at all.** The model reads a machine transcript of
  a noisy call in two languages, and its reading was offered as tick-box suggestions with an Apply
  button. The studio does not want that deciding what a lead says even with a press in between, so
  the panel and its route are gone: what the model produces — the summary, sentiment, outcome and
  next action — is shown beside the call and read by a person.

## Who Sees Which Projects

`src/services/projectScope.js` answers it, and the project screens spread its `where` fragment into
their queries. It is the studio's one rule (`docs/project-state/DATA-SCOPE.md`) with nothing added:
a Super Admin is filtered by nothing; anyone holding **ADMIN / Branch Administration** sees every
project in the branches their roles reach; everybody else sees the projects naming them — the five
people columns on `SalesProject`, matched on `user.linkedEmployeeId`, plus what they created —
wherever those projects were sold from. There is no project-only way to widen it. **PROJECT / All
Projects** used to be one and was retired: it showed a person named on one project every project in their
branch, under a permission nobody thought of as a visibility setting. A missing scope matches
nothing, so a caller that forgets to resolve one fails closed instead of serving the table.

**Records that hang off a project** — an attachment, an extra quotation, a client gift, a shoot —
are not records of their own and carry no names, so they are scoped *through* the parent with
`readableProject()` rather than given columns of their own. Not seeing the project is a **404 on the
child, never a 403**.

**Pickers are not narrowed, and neither is the write behind them.** A dropdown exists to link one
record to another, and whoever is doing the linking is usually not the person the other record
belongs to — so the project, shoot, lead and quotation-version pickers offer everything, and a form
never offers a choice it will then refuse. What is narrowed is the list of records. Linking is not
reading.

**A quotation belongs to its enquiry.** It is yours if you may read the lead it was raised against or
the project it became, as well as by its own owner and creator — so whoever books the project can
read the quotation it was sold on. `GET /api/sales/quotations` tells its two screens apart by the
query string: one enquiry named is the project form's version dropdown and answers in full; nothing
named is the register and answers with the reader's own rows.

`projectAccessWhere()` defaults to the project register's own permissions, and a screen holding
something else — Client Gifts, Cash Management, the Schedule calendar — passes what its own router
guarded with, usually `req.permission`. One exception is deliberate: an approval writing the cash
entry a payment request agreed files it against the project *that request* named, whether or not the
approver may read it. That caller passes no `chooser`; a person filling in a form does.

Scoped today: `GET /api/sales/projects` and Sales Manager, CRD Documents, project attachments, extra
quotations, client gifts, the Schedule calendar, and every project or shoot picker. **Not yet
scoped:** Image Selection, which reaches a project through `salesProjectId` and has its own Super
Admin checks in places.

## Database Rules

- **Every `CREATE TABLE` states its collation.** End it
  `) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`. A table that does not say inherits
  the *database's* default, which is `utf8mb4_unicode_ci` here and `utf8mb4_0900_ai_ci` on a
  database MySQL 8 creates without being told — so the same migration folder builds two different
  schemas, and the difference stays invisible until a query compares one of those columns with one
  from a table that did say, which fails outright with *Illegal mix of collations*. Six tables
  shipped without it and are converted by `20260906210000_pin_table_collations`;
  `test/migration-collations.test.js` fails if a seventh appears.

- **Branch belongs to the `branch` table.** `User`, `Asset`, `Employee` and `RoleBranch` hold a real
  `branchId`, and every other table that names a branch now has a `branchId` beside its text — NULL
  until the backfill, because the two spellings already in use (`Erode` and `Erode TN`) are why a
  name-matching backfill is not enough on its own. Run `npm run report:data-scope` before writing
  any of them: it is read-only, lists every distinct branch, vertical and owner value per table,
  and names the row each would map to or fails to. See
  [DATA-SCOPE.md](../docs/project-state/DATA-SCOPE.md). The CRM lead's own vertical is **not** one
  of them — the column called `branch` held Dum Dum / Qua Qua / Corp and never held a branch, so
  `20260906180000_rename_crm_lead_branch_to_vertical` renamed it to `vertical` (`verticalName` in
  Prisma), with `vertical_id` beside it referencing the `vertical` table; the text goes once every
  read has moved to the reference. The lead's actual branch is `assigned_branch`, with `branch_id`
  beside it. See [DATA-SCOPE.md](../docs/project-state/DATA-SCOPE.md) for the whole programme.
- **A renamed column is a search of the raw SQL, not just a migration.** Prisma's own client is
  generated from the schema and cannot name a column that is gone, but `$queryRawUnsafe` takes
  whatever string it is handed — so a rename leaves the hand-written queries pointing at nothing,
  and they fail only where the database is correct. `sales_crm_lead`.`branch` → `vertical` left
  `VERTICAL_SQL` behind and took the whole Contacts directory down on the VPS while every developer
  machine, carrying a leftover column the CRM's dynamic columns had re-created, answered happily.
  `test/raw-sql-table-names.test.js` covers renamed *tables*; a renamed column can only be caught by
  running the query, which is what `test/contacts-directory-query.test.js` does against the schema
  CI migrates from scratch.

- Prisma Migrate owns the schema. Do not hand-edit tables in MySQL Workbench.
- `npx prisma migrate dev` locally; **`npx prisma migrate deploy` only** on the VPS.
- Only squash or rewrite migrations that are still uncommitted. A migration already pushed to git
  has run on other machines — add a new migration instead.
- A migration that adds a column existing rows need filled ships with a backfill script under
  `prisma/` and an npm script, listed here and in the changelog so no environment is left half
  migrated.
- Never commit `.env`, credentials, tokens, or password hashes.

## Working Rules

Changes follow the [development workflow](../CLAUDE.md#development-workflow): understand the
architecture, implement, test, update the `.md` files, update
[../docs/CHANGELOG.md](../docs/CHANGELOG.md), review the diff, then open the PR. The three rules in
[../frontend/README.md](../frontend/README.md) apply here too, adapted:

1. **Reuse before building.** Check `src/services/` and the existing modules before writing a new
   helper — storage, email, and image handling are already centralised.
2. **API responses stay JSON and predictable.** Consistent `{ message }` on errors, correct status
   codes, and no HTML error pages, because the frontend parses every response as JSON.
3. **Update this README and the changelog in the same change** when a router is mounted or removed,
   a module folder is added, a shared service or worker changes, an env var is introduced, or the
   request flow changes. Workflow changes also belong in
   [../docs/project-state/PROJECT-STATE.md](../docs/project-state/PROJECT-STATE.md). `docs/DATABASE.md`
   is still an empty placeholder — `prisma/schema.prisma` is the source of truth for the schema.
