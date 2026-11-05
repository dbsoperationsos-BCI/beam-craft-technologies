# CLAUDE.md — Read This First

Entry point for any AI agent working on DBS-Operations-OS. Read this file, then the README for the
side you are changing: [frontend/README.md](frontend/README.md) or
[backend/README.md](backend/README.md). Every change also decides who may use it, so read
[docs/project-state/IAM.md](docs/project-state/IAM.md) as well — see Rule 4.

## Development Workflow

```text
Developer asks Claude Code
          ↓
Claude reads CLAUDE.md
          ↓
Understands architecture
          ↓
DeepSeek V4 Pro implements
          ↓
Tests
          ↓
Updates relevant .md files
          ↓
Updates changelog
          ↓
Claude reviews the changes
          ↓
Git diff / PR
```

Claude Code owns the **first** and **last** steps: understand the architecture and scope the change
up front, then review the implementation before it becomes a diff or PR. DeepSeek V4 Pro is the
default implementer. The middle steps are not optional — a change is finished only once tests, the
`.md` files, and [docs/CHANGELOG.md](docs/CHANGELOG.md) are all updated.

Per-step expectations:

| Step | What it means here |
| --- | --- |
| Reads CLAUDE.md | This file plus the README for the side being changed. Do not start from assumptions about the stack. |
| Understands architecture | Name the exact files the change touches and the layer each belongs to before writing code, and the module and feature its access is decided by. |
| Implements | Follow the four rules below. Stay inside the layer boundaries in the READMEs, and write the backend and frontend RBAC alongside the feature rather than after it. |
| Tests | `npm run lint` + `npm test` in `frontend`, `npm test` in `backend`; plus the responsive check at ~360px, ~768px, ~1280px. |
| Updates relevant .md files | The README tables that the change makes stale, and `docs/project-state/PROJECT-STATE.md` if product behaviour changed. |
| Updates changelog | One entry in [docs/CHANGELOG.md](docs/CHANGELOG.md) under `Unreleased`. |
| Claude reviews | Read the diff against these rules: reuse, responsiveness, access control on both sides, layer boundaries, RBAC guarded, docs updated, no secrets. |
| Git diff / PR | Feature branch → PR to `develop`. Never push to `main`. |

## Architecture in One Screen

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
                                └── service.js / src/services/*   storage, email, images
                                      └── src/config/db.js → Prisma Client → MySQL
```

- Signed-in pages render inside `frontend/src/components/app-shell/AppShell.js`; public pages
  (the BeamCraft home page at `/`, `/login`, `/onboarding/apply/[token]`, `/gallery/[token]`, password reset) sit outside the
  `(app)` route group and get no shell.
- API calls belong in `frontend/src/services/<module>/*.service.js` — never in `src/lib`, which is
  for pure helpers, validation, and browser storage.
- Long-running image work is queued to BullMQ/Redis and handled by
  `backend/src/modules/image-selection/processing/`.
- Prisma Migrate owns the database schema. `migrate dev` locally, `migrate deploy` on the VPS only.

## The Four Rules

1. **Reuse a component before building one.** Search `frontend/src/components/` first — `ui/`,
   `shared/`, `layout/`, `data-table/`, and `schema-form/` already cover dialogs, form fields,
   buttons, module headers, tables, and full-screen forms. If nothing fits, create a reusable
   component in the correct folder instead of inlining markup in a page. On the backend, check
   `backend/src/services/` before writing a new helper.
2. **Everything must be responsive down to mobile.** Every screen, dialog, table, and form must be
   usable at ~360px. Mobile-first classes, no fixed pixel widths, no horizontal page scroll,
   multi-column layouts collapse below `md`, and the app shell never scrolls as a page — its inner
   panes do.
3. **Update the docs in the same change.** The relevant README, any affected `docs/project-state/`
   file, and a `docs/CHANGELOG.md` entry ship with the code. Documentation that contradicts the code
   is a defect.
4. **Every change carries its own access control, on both sides.** Read
   [docs/project-state/IAM.md](docs/project-state/IAM.md) before writing the code, decide which
   module and feature the change belongs to, and write the RBAC for it in the same change. An
   endpoint that anyone signed in can call, or a screen that shows what the viewer may not have, is
   an unfinished change — not a follow-up task.

   | Side | What that means |
   | --- | --- |
   | Backend | Every route mounts `protect` and then `checkPermission(module, feature, level)` or `requireModule(module, feature)` from `src/middleware/permissionMiddleware.js` — `READ` to look, `READ_WRITE` to change. The guard is the **only** thing deciding access: never add a check on `req.user.role` inside a controller, which silently overrules the permission above it and cannot be granted to anyone. Never trust an id from the body or the URL to be one the caller may touch. |
   | Frontend | The route gets a row in `frontend/src/constants/modulePermissions.js`; without one the page is open to anyone signed in. `RouteGuard` then closes it, the sidebar stops listing it, and the page asks `useRouteAccess()` what it may do. A control the viewer may not use is **absent**, not disabled and refused. A panel reachable by double-click or a deep link takes `canWrite` as a prop — it cannot rely on the control that opens it having been hidden. |
   | New module or feature | Add the `{ module, feature }` row to `PERMISSIONS` in `backend/prisma/seeds/permission-catalogue.js` **and write the same row into a migration** (`INSERT … WHERE NOT EXISTS`, see IAM.md step 10) — the seed cannot be run on the VPS, so a catalogue-only permission never reaches production and the guard naming it refuses everybody but a Super Admin. Reseed locally. Say in the changelog entry which roles now reach it, and re-save those roles — neither the seed nor the migration writes grants. |

   Two traps worth knowing before you choose a permission, both of which have already shipped bugs:
   a guard may only name a permission that exists in the seed, and a screen may not be given a finer
   permission than the endpoint it reads — one endpoint feeding several screens means those screens
   share a permission until the endpoint is split. The full checklist, and what `READ` versus
   `READ_WRITE` versus no access must look like on screen, is in
   [IAM.md](docs/project-state/IAM.md).

   **Branch reach belongs to the permission, not to the person.** Every call into the branch API —
   `reachableBranchIds`, `reachableBranches`, `buildBranchFilter`, `canAccessBranch`,
   `canUseBranchId`, `canUseBranchName`, and the `checkBranchAccess` guard — names the
   `{ module, feature }` it is asking about, and the answer is the branches of the roles that grant
   **that** permission. Somebody may hold CRM Leads across every branch through one role and Asset
   Management in one branch through another; asked without a permission named, the wider role used to
   widen the narrower one silently. Calls that genuinely mean "anywhere at all" pass
   `{ anyRole: true }` and say why — there are three. A role naming no branches contributes none (it
   is not read as "all of them"), and a person's own `user.branch_id` is **not** added: the roles
   decide, and nothing else does. Somebody narrowed to nothing still sees the work their own name is
   on and their team's, through `dataScope`.

   Branch scoping is still not solved for every column: only `User` and `Asset` carry a `branchId` a
   filter can use, and everything else stores its branch as free text, matched by name. Do not assume
   a role's branch list narrows what a new module returns — declare the module's branch column to
   `dataScope` if it should.

Details and per-file checklists: [frontend/README.md](frontend/README.md) Rules 1–3,
[backend/README.md](backend/README.md), and [docs/project-state/IAM.md](docs/project-state/IAM.md)
for Rule 4.

## RBAC — Every Feature Ships With Its Access Control

The app is role-based (IAM): a permission is a `module:feature` pair held at `DISABLED`, `READ`,
or `READ_WRITE`, granted to roles in Admin → Role Management, and `SUPER_ADMIN` holds everything.
Whenever you develop or change a feature, work out who may use it and write the RBAC code in the
same change — an unguarded route or an ungated button is a defect, not a follow-up task.

- **Backend — guard every route.** A new router mounts `protect` (JWT) plus a permission guard.
  Prefer `requireModule("<MODULE>", "<Feature>")` from
  `backend/src/middleware/permissionMiddleware.js` on the whole router: GET/HEAD requires `READ`,
  every other method `READ_WRITE`, and a route added later is covered the moment it is written
  (pass `{ readOnlyReads: false }` where even reading is privileged). Use `checkPermission` /
  `checkAnyPermission` / `checkBranchAccess` for finer per-route cases. An explicit role check
  (e.g. the `req.user.role === "SUPER_ADMIN"` guards in Image Selection controllers) is only for
  a module that belongs to one role outright. Public tokenized pages (client gallery, onboarding
  apply, CRD form, password reset) authenticate by token instead — everything else is guarded.
- **Frontend — gate what the role cannot use.** Wrap privileged UI in
  `<PermissionGuard module="..." feature="..." level="...">` or read `usePermissions()` from
  `frontend/src/components/auth/  
  PermissionsProvider.js`, so nobody sees a button their role
  cannot act on. The backend guard stays the authority: hiding a control is never the only
  protection.
- **New module or feature key:** add the permission to
  `backend/prisma/seeds/permission-catalogue.js` **and** to a migration so Role Management can
  actually grant it everywhere, and keep the `module:feature` strings identical on both sides.

## Hard Constraints

- Do not change the approved stack or architecture without explicit approval.
- Do not touch the separate legacy WhatsApp automation unless a task names it.
- Never commit `.env` files, credentials, JWT secrets, SMTP details, or password hashes.
- Never run `prisma migrate dev` on the VPS, and never rewrite a migration already committed to git.
- **Never run the seed on production.** `prisma/seed.js` runs *every* seeder, and most of them write
  rather than only fill gaps — option lists, catalogues, master data, demo rows. On a live database
  that is not "the new rows appear", it is every one of those tables being rewritten to whatever the
  repository currently says, silently undoing anything the studio has changed in Settings since. So
  a change that needs a row in production carries it in a **migration** (`INSERT … WHERE NOT
  EXISTS`, see [IAM.md](docs/project-state/IAM.md) step 10), which is replayable, ordered and
  reviewed with the code. Where a seed genuinely is the only way — a large or generated data set —
  it goes in a **file of its own** under `prisma/seeds/`, runnable on its own with nothing else
  mounted on it, and the changelog entry says which command to run and what it touches. The rule is
  that production is never handed a script whose blast radius is "whatever else is in the seed".
- **The one seed that may be run on production** is
  [production-permissions.seed.js](backend/prisma/seeds/production-permissions.seed.js) —
  `npm run seed:permissions`, with `-- --dry-run` to see what it would do first. It creates the
  permissions the catalogue describes and refreshes their display names, and that is all: it cannot
  retire, deactivate or delete anything, it never writes `isActive`, and it touches no role, grant,
  scope, user, branch or master data. A new permission still reaches nobody until a role is ticked in
  Role Management and re-saved. A permission shipping **with code** still belongs in a migration
  (IAM.md step 10) — this is for repairing drift, or catching production up with a catalogue that has
  moved ahead of it.
- Work one scoped feature or bug fix at a time; branch from `develop` and open a PR to `develop`.
- Next.js 16 differs from older documentation — check `frontend/node_modules/next/dist/docs/` before
  using an unfamiliar API. See [frontend/AGENTS.md](frontend/AGENTS.md).
- **Database naming:** All table names and column names in the database must be `snake_case` (e.g., `sales_project`, `created_at`, `project_id`). Use Prisma's `@map()` for columns and `@@map()` for tables when field/model names differ from database names. Code always uses camelCase; Prisma handles the translation automatically.
