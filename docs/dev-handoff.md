# Developer Handoff — DBS Operations OS

Everything needed to take this project over: the stack, how to get it running end to end, how the
database and Prisma are set up, every environment variable, and where the secret values come from.

Read this first, then [../CLAUDE.md](../CLAUDE.md) for the working rules, then the README for the
side you are changing — [../frontend/README.md](../frontend/README.md) or
[../backend/README.md](../backend/README.md).

> **On secrets.** This file names every credential the app needs and says where to obtain it. It
> does **not** contain the values. Anything committed to git is permanent and readable by everyone
> with repo access, including future collaborators. Request the live values through the secure
> channel in [Getting the secret values](#getting-the-secret-values) and keep them in your local
> `.env`, which is never committed.

---

## 1. What you are inheriting

| | |
| --- | --- |
| Repository | `github.com/Beam-Craft-Technologies/DBS-Operations-OS` |
| Integration branch | `develop` — all work merges here by PR |
| Release branch | `main` — production only, deployed by an authorized maintainer |
| Current open work | `test/crm-develop-merge` — merges the CRM branch into `develop`, PR pending |

The app is an internal operations platform for a photography studio. Modules: HRM / employees,
Sales (projects, CRM leads, meetings), Project Management (shoots, production, post-production),
Image Selection (client galleries, uploads, R2 storage) and Asset Management (assets, vendors,
client storage).

---

## 2. Stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js **24** (pinned in `.nvmrc`) |
| Frontend | Next.js **16.2.9** (App Router), React **19.2.4** |
| Styling | Tailwind CSS **v4** (via `@tailwindcss/postcss`) |
| UI libraries | MUI **9.2** + Emotion, `lucide-react`, `@tanstack/react-table` |
| Backend | Express **5**, Node built-in test runner |
| ORM | Prisma → **MySQL** |
| Auth | JWT (`jsonwebtoken`) + `bcryptjs` password hashing |
| Queue | BullMQ on **Redis** (image processing, WhatsApp notifications) |
| Images | `sharp` (thumbnails/previews), `exif-reader` |
| Object storage | **Cloudflare R2** via `@aws-sdk/client-s3` |
| Email | `nodemailer` over SMTP |
| Google APIs | `googleapis` — Sheets sync, OAuth, Picker |
| Validation | `zod` |
| Deployment | Hostinger VPS, Ubuntu 22.04, Nginx, PM2, Let's Encrypt |

> Next.js 16 differs from older documentation. Check `frontend/node_modules/next/dist/docs/`
> before using an unfamiliar API — see [../frontend/AGENTS.md](../frontend/AGENTS.md).

---

## 3. Prerequisites

- **Node.js 24** — `nvm use` picks it up from `.nvmrc`
- **MySQL 8** running locally, with a database you can own
- **Redis** — optional for most work. `npm run dev` in `backend/` starts a throwaway in-memory
  Redis via `redis-memory-server`, so you only need a real one if you are testing the image queue
  against a persistent instance.
- **Git**, and a GitHub account with access to the repo

---

## 4. Credentials and secrets

### 4.1 The local development login

The seed creates a Super Admin. These are **local-only development credentials**, already committed
in `backend/prisma/seed.js`, and are not the production login:

| Field | Value |
| --- | --- |
| Email | `admin@dontblinkstudio.com` |
| Username | `admin` |
| Password | `Admin@12345` |
| Role | `SUPER_ADMIN` |

Re-running `npm run seed` resets this user, which is the quickest way back in if you lock yourself
out locally.

### 4.2 What each secret is for

| Secret | Used for | Where it comes from |
| --- | --- | --- |
| `DATABASE_URL` | MySQL connection | Your own local MySQL; production value lives on the VPS only |
| `JWT_SECRET` | Signs auth tokens; also the fallback key for publish tokens | Generate your own locally: `openssl rand -base64 48` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth for the CRM's Sheets integration | Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID |
| `GOOGLE_OAUTH_ENCRYPTION_KEY` | Encrypts stored Google refresh tokens at rest | Generate: `openssl rand -base64 32` |
| `GOOGLE_PICKER_API_KEY` / `GOOGLE_PICKER_APP_ID` | Google Picker file browser | Same Google Cloud project — API key, and the project number as App ID |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL` | Cloudflare R2 image storage | Cloudflare dashboard → R2 → Manage API Tokens |
| `SMTP_*` | Outbound email (onboarding invites, password resets) | The studio's mail provider |
| `CALLYZER_WEBHOOK_SECRET` | Verifies inbound Callyzer call webhooks | Callyzer dashboard |
| `CRM_WEBHOOK_URL` | Outbound CRM lead webhook | Whoever owns the receiving endpoint |
| `PUBLISH_TOKEN_ENCRYPTION_KEY` | Encrypts client gallery share tokens | Generate: `openssl rand -base64 32`. Falls back to `JWT_SECRET` if unset |

### 4.3 Getting the secret values

Real values are **not** in this repo and must not be added to it. Ask the project owner
(Sabarish) to send you:

1. A filled `backend/.env` and `frontend/.env.local`, **or**
2. The individual values above, through a password manager share or another encrypted channel —
   not email, chat, or a commit.

For local work you often do not need most of them. See
[section 6](#6-running-it-end-to-end) for what is genuinely required to boot.

### 4.4 Outstanding security item

A Google service-account private key (`crm-sheets@sinuous-client-504205-m9.iam.gserviceaccount.com`)
was committed at `backend/.secrets/google-service-account.json`. No application code read it.

**Done:** the file is deleted and `.secrets/` is now ignored, so the key is not in the current tree
and cannot be re-added by accident.

**Still outstanding:** deleting a file does not remove it from history. The key remains readable
through commit `3ee4ba5` on `feature/crm-lead-management`, which is already on the remote, so
anyone with repo access can still recover it. **The key must be rotated in Google Cloud** —
that, not the deletion, is what actually closes the exposure. Rotating also makes the copy in
history worthless, which is why scrubbing history is optional rather than urgent.

---

## 5. Environment variables — full reference

Copy the examples first:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

### Backend (`backend/.env`)

**Core — required to boot**

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | |
| `PORT` | `5001` | Falls back to `5000` in code if unset |
| `DATABASE_URL` | — | **Required.** MySQL connection string |
| `JWT_SECRET` | — | **Required.** Any long random string locally |
| `JWT_EXPIRES_IN` | `7d` | Not in `.env.example`; override only if needed |
| `FRONTEND_URL` | `http://localhost:3000` | Used in emailed links |
| `JSON_BODY_LIMIT` | `50mb` | Request body cap; a `413` is returned above it |

**Email**

| Variable | Notes |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_FROM` | Leave blank locally; email calls no-op |
| `SMTP_PASSWORD` | Code accepts `SMTP_PASS` as an alias |
| `SMTP_SECURE` | Not in the example file; set for implicit TLS |
| `EMPLOYEE_LOGIN_URL` | Overrides the login link in onboarding emails |

**Google / CRM**

| Variable | Default | Notes |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | — | Also read as `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENTID` |
| `GOOGLE_CLIENT_SECRET` | — | Same alias pattern |
| `GOOGLE_OAUTH_REDIRECT_URI` | `http://localhost:5001/api/sales/google-oauth/callback` | Must match the Google Console entry exactly |
| `GOOGLE_OAUTH_FRONTEND_REDIRECT_URI` | `http://localhost:3000/sales/crm` | Where the user lands after consent |
| `GOOGLE_OAUTH_ENCRYPTION_KEY` | — | Encrypts stored refresh tokens |
| `GOOGLE_OAUTH_STATE_TTL_MINUTES` | `15` | OAuth state lifetime |
| `GOOGLE_SHEETS_AUTO_SYNC` | `true` | Set `false` to stop background sheet polling |
| `GOOGLE_SHEETS_SYNC_INTERVAL_SECONDS` | `120` | `..._MINUTES` also exists in code |
| `GOOGLE_SHEETS_SPREADSHEET_IDS` | — | Comma-separated sheet IDs |
| `GOOGLE_PICKER_API_KEY`, `GOOGLE_PICKER_APP_ID` | — | Backend copies of the picker credentials |
| `CRM_WEBHOOK_URL` | — | `CRM_LEADS_WEBHOOK_URL` also read |
| `CALLYZER_WEBHOOK_SECRET` | — | Shared secret for inbound call webhooks |

**Cloudflare R2**

| Variable | Notes |
| --- | --- |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | From the R2 API token |
| `R2_BUCKET_NAME` | `R2_BUCKET` is accepted as an alias in the image-selection storage layer |
| `R2_PUBLIC_BASE_URL` | No trailing slash. Must match the frontend's copy |
| `GEOCODING_ENABLED`, `GEOCODING_CONTACT_EMAIL`, `NOMINATIM_BASE_URL`, `GEOCODING_TIMEOUT_MS` | Attendance address lookup via OpenStreetMap. Optional; set the contact email before production, and `GEOCODING_ENABLED="false"` stops coordinates leaving the server |
| `R2_PRIVATE_BUCKET_NAME` | Optional. A second bucket with **no** public access, for attendance selfies. Unset, they go to the main bucket guarded only by an unguessable key and the server warns once |

**Image Selection / queue**

| Variable | Default | Notes |
| --- | --- | --- |
| `REDIS_URL` | `redis://127.0.0.1:6379` | |
| `IMAGE_PROCESSING_EMBEDDED_WORKER` | `true` | `false` runs the worker as a separate process |
| `WHATSAPP_EMBEDDED_WORKER` | `true` | Same pattern |
| `IMAGE_PROCESSING_CONCURRENCY` | — | Parallel image jobs |
| `IMAGE_SELECTION_UPLOAD_ROOT` | `backend/uploads/image-selection` | Where processed files land |
| `STORE_ORIGINAL_IMAGES` | — | Whether masters are kept |
| `PUBLISH_TOKEN_ENCRYPTION_KEY` | falls back to `JWT_SECRET` | Gallery share tokens |
| `META_WHATSAPP_TEMPLATE_NAME`, `META_WHATSAPP_TEMPLATE_LANGUAGE` | — | WhatsApp message template |

### Frontend (`frontend/.env.local`)

| Variable | Default | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:5001` | Backend base URL |
| `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` | — | Google Picker |
| `NEXT_PUBLIC_GOOGLE_PICKER_APP_ID` | — | Google Picker |
| `NEXT_PUBLIC_R2_PUBLIC_BASE_URL` | — | Must match backend `R2_PUBLIC_BASE_URL` |

> Everything prefixed `NEXT_PUBLIC_` is **compiled into the browser bundle** and is therefore
> public. Never put a private key behind that prefix.

---

## 6. Running it end to end

### 6.1 First run

```bash
git clone https://github.com/Beam-Craft-Technologies/DBS-Operations-OS.git
cd DBS-Operations-OS
nvm use                                   # Node 24

# --- database ---
mysql -u root -p -e "CREATE DATABASE dbs_operations_os_dev;"

# --- backend ---
cd backend
cp .env.example .env                      # then set DATABASE_URL and JWT_SECRET
npm install
npm run setup:local                       # generate + migrate + seed, in one step
npm run dev                               # starts Redis and the API together

# --- frontend (new terminal) ---
cd ../frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Open <http://localhost:3000> and sign in with the seeded admin from
[section 4.1](#41-the-local-development-login).

**Minimum to boot:** `DATABASE_URL` and `JWT_SECRET`. Everything else degrades gracefully — email
no-ops, Google and R2 features report that they are not configured rather than crashing.

`npm run setup:local` is shorthand for `prisma generate` → `prisma migrate dev` → `seed`.

### 6.2 What the seed gives you

Branches, departments, designations, employment types, locations, skills, languages, work types,
asset categories and sample assets, project service and deliverable definitions, option sets, and
the Super Admin user.

---

## 7. Database and Prisma

### Setup

- **Provider:** MySQL. **Client:** `prisma-client-js`. Both declared at the top of
  [../backend/prisma/schema.prisma](../backend/prisma/schema.prisma).
- Connection comes from `DATABASE_URL`.
- One schema file, **52 models**, ~1,500 lines.
- **55 migrations** in `backend/prisma/migrations/`.
- The client is instantiated once in `backend/src/config/db.js`; import it from there rather than
  constructing a new `PrismaClient`.

### Commands

```bash
npm run prisma:generate      # regenerate the client after editing the schema
npm run prisma:migrate       # prisma migrate dev — create + apply a migration locally
npm run prisma:studio        # browse the data
npm run seed                 # re-run the seed
npx prisma validate          # check the schema parses and relations resolve
npx prisma format            # canonical formatting
```

### Rules that matter

- **Prisma Migrate owns the schema.** Never hand-edit tables.
- **`migrate dev` locally, `migrate deploy` on the VPS.** Never run `migrate dev` against
  production — it can reset data.
- **Never rewrite a migration already committed to git.** Add a new one instead.
- After changing `schema.prisma`, run `prisma generate` or the client's types go stale.
- Every model change needs a migration in the same commit as the code that uses it.

### Model map

| Area | Representative models |
| --- | --- |
| Auth / HR | `User`, `Employee`, `EmployeeOnboardingInvite`, `Department`, `Designation` |
| Sales | `SalesProject`, `SalesCrmLead`, `SalesCrmMeeting`, `SalesGoogleSheetLink`, `SalesGoogleAccountConnection` |
| Project management | `ProjectShoot`, `ProjectServiceDefinition`, `ProjectDeliverableDefinition`, `ProjectPostProductionAllocation` |
| Image selection | `ImageSelectionProject`, `ImageSelectionFolder`, `ImageSelectionUpload`, `ImageSelectionPhotoSelection`, `ImageSelectionSettings` |
| Assets | `Asset`, `AssetCategory`, `Vendor`, `ClientStorage`, `AssetRequest`, `AssetMaintenance` |

---

## 8. Architecture

```text
frontend/src/app/(app)/<module>/<page>/page.js       Next.js 16 App Router page
  └── frontend/src/components/<module>/*.js          UI from components/ui + shared
        └── frontend/src/services/<module>/*.service.js    one function per API call
              └── frontend/src/services/api/client.js      apiRequest(): base URL, JWT, errors
                    │  HTTP (NEXT_PUBLIC_API_URL)
                    ▼
              backend/src/server.js                  mounts every router under /api/*
                    └── backend/src/modules/<module>/<feature>/routes.js   + protect (JWT)
                          └── controller.js          validation, status codes
                                └── service.js       storage, email, images
                                      └── src/config/db.js → Prisma Client → MySQL
```

Points worth knowing before your first change:

- Signed-in pages render inside `frontend/src/components/app-shell/AppShell.js`. Public pages
  (`/login`, `/onboarding/apply/[token]`, `/gallery/[token]`, password reset) sit outside the
  `(app)` route group and get no shell.
- **API calls belong in `frontend/src/services/<module>/*.service.js`** — never in `src/lib`, which
  is for pure helpers, validation and browser storage. `src/lib/apiClient.js` is a thin re-export of
  `services/api/client.js` kept for older imports.
- Long-running image work is queued to BullMQ/Redis and handled by
  `backend/src/modules/image-selection/processing/`.
- In `backend/src/server.js`, **every router must be mounted above the 404 catch-all.** Anything
  registered after it is unreachable.
- Overlay stacking is centralised in `frontend/src/constants/layers.js`. Portalled popovers (the
  calendar, dropdown menus) sit above dialogs deliberately — they are rendered into `document.body`
  and would otherwise be covered by the dialog that opened them.

---

## 9. Day-to-day commands

| Task | Command |
| --- | --- |
| Backend dev (API + Redis) | `cd backend && npm run dev` |
| Backend API only | `cd backend && npm run dev:server` |
| Backend tests | `cd backend && npm test` |
| Frontend dev | `cd frontend && npm run dev` |
| Frontend lint | `cd frontend && npm run lint` |
| Frontend tests | `cd frontend && npm test` |
| Production build | `cd frontend && npm run build` |

**Before every PR:** `npm run lint` + `npm test` in `frontend`, `npm test` in `backend`, and check
the screen at ~360px, ~768px and ~1280px.

### Current known-failing tests

`cd backend && npm test` reports **97 pass / 15 fail**. All 15 are pre-existing failures in the
image-selection module on `develop` and are unrelated to any current work. Frontend is 33/33.
If your change does not touch image selection and you still see 15 failures, that is the expected
baseline — not something you broke.

---

## 10. Branch and deployment workflow

```text
feature branch → PR → develop → (maintainer) → main → VPS
```

- Branch from `develop`, one scoped feature or fix at a time, PR back into `develop`.
- **Never push to `main`.** It is the production-release branch and the VPS deploys from it only.
- New developers do not deploy to the VPS or edit production env files.
- Deployment is PM2-based (`dbs-erp-backend`, `dbs-erp-frontend`) behind Nginx, run by an
  authorized maintainer. Production paths live under `/var/www/dbs-operations-os/`, with env files
  and uploads in `shared/`. See `scripts/production-backup.sh` and
  [project-state/DEPLOYMENT-WORKFLOW.md](project-state/DEPLOYMENT-WORKFLOW.md).

### The three rules every change must satisfy

1. **Reuse a component before building one.** Search `frontend/src/components/` first — `ui/`,
   `shared/`, `layout/`, `data-table/` and `schema-form/` already cover dialogs, form fields,
   buttons, module headers, tables and full-screen forms. On the backend, check
   `backend/src/services/`.
2. **Everything must be responsive to ~360px.** Mobile-first, no fixed pixel widths, no horizontal
   page scroll, multi-column layouts collapse below `md`, and the app shell never scrolls as a
   page — its inner panes do.
3. **Update the docs in the same change.** The relevant README, any affected
   `docs/project-state/` file, and a [CHANGELOG.md](CHANGELOG.md) entry ship with the code.

---

## 11. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Module not found: Can't resolve 'lucide-react'` | `node_modules` predates a dependency change. `cd frontend && npm install` |
| Prisma client types are stale after a schema edit | `npm run prisma:generate` |
| `PrismaClientInitializationError` on boot | `DATABASE_URL` wrong, or MySQL not running |
| Login fails on a fresh clone | Seed did not run — `npm run seed` |
| Redis / BullMQ connection errors | Use `npm run dev` (starts an in-memory Redis) rather than `npm run dev:server` |
| Google features report "not configured" | Expected without Google credentials; the rest of the app still works |
| Uploads fail with `413` | Body larger than `JSON_BODY_LIMIT` (default `50mb`) |
| A new API route 404s | It is mounted *after* the 404 catch-all in `server.js`. Move it above |
| A dropdown or calendar opens behind a dialog | Pass a higher `menuZIndexClassName`; see `constants/layers.js` |
| `Cannot find module '.../image-selection/uploads/...'` | The module is missing from the repository — see [known issues](#13-known-issues) |
| `The table 'x' does not exist` after switching branches | Pending migrations. `npx prisma migrate deploy` |
| Backend deps missing after a branch switch | `npm install`. A lockfile change alone does not update `node_modules` |

---

## 13. Known issues

### The image-selection uploads module is missing from the repository

`backend/src/modules/image-selection/uploads/` is **not in git** and not on any branch. It was lost
to an unanchored `uploads` rule in `backend/.gitignore`, which matched that source folder as well as
the upload directory it was written for, so the files were never committed.

At least four files are missing — `routes`, `service`, `validation` and `progress` — inferred from
what still imports them.

**Consequences today:**

- Browser-based image upload does not work. `/api/image-selection/projects/:projectId/uploads` is
  not mounted and returns 404. The server logs a warning naming the gap at startup.
- Upload progress is not reported during image processing; the worker falls back to a no-op.
- Two test files fail because they import the missing module —
  `image-selection-upload-chunks.test.js` and `image-selection-upload-validation.test.js`.

**What has been done:** the `.gitignore` rule is now anchored (`/uploads`), so the folder can be
committed once recovered, and `server.js` and `processing/service.js` degrade instead of crashing —
before this, a fresh clone could not start the backend at all.

**What still needs doing:** recover the folder from the machine of whoever wrote the image-selection
upload feature and commit it. Registering originals from an Original Storage Path is unaffected and
still works.

### Duplicate index drops across migration lineages

Three migrations independently dropped `SalesWhatsappGroupName_status_createdAt_idx`. MySQL has no
`DROP INDEX IF EXISTS`, so whichever ran second failed with error 1091 and stalled the run. The
earliest-dated migration owns the drop; the other two are no-ops with a comment explaining why. If
you ever see error 1091 mid-migration, this is the pattern to look for.

---

## 12. Handoff checklist

- [ ] Repo access granted on GitHub
- [ ] Node 24 installed, `nvm use` works
- [ ] MySQL running, dev database created
- [ ] `backend/.env` and `frontend/.env.local` received through a secure channel
- [ ] `npm run setup:local` completes; able to sign in as the seeded admin
- [ ] `npm run dev` runs on both sides; <http://localhost:3000> loads
- [ ] Backend tests show the expected 97/15 baseline; frontend 33/33
- [ ] `npm run build` succeeds in `frontend`
- [ ] Read [../CLAUDE.md](../CLAUDE.md) and the README for your side
- [ ] **Rotate the exposed Google service-account key** — the file is deleted, but the old key is
      still readable in git history (see [section 4.4](#44-outstanding-security-item))
- [ ] Recover `backend/src/modules/image-selection/uploads/` (see [known issues](#13-known-issues))
- [ ] Confirm you understand: never push to `main`, never run `migrate dev` on the VPS, never
      commit a `.env`
