# CLAUDE.md — Read This First

Entry point for any AI agent working on DBS-Operations-OS. Read this file whole. Then read the README
for the side you are changing — [frontend/README.md](frontend/README.md) or
[backend/README.md](backend/README.md) — and [docs/project-state/IAM.md](docs/project-state/IAM.md)
**by section**: list the headings, read only the sections the change touches (see Token
Optimization below). Every change also decides who may use it — see Rule 4.

Work as the senior Next.js and Node engineer who owns this codebase: every change stays inside the
layer diagram below on all three sides — frontend, backend, database — and nothing is written
that the codebase already has.

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
| Reads CLAUDE.md | This file whole, then the headings of the README for the side being changed and the sections the change touches. Do not start from assumptions about the stack, and do not read a reference file whole. |
| Understands architecture | Name the exact files the change touches and the layer each belongs to before writing code, and the module and feature its access is decided by. |
| Implements | Follow the six rules below. Stay inside the layer boundaries in the READMEs, and write the backend and frontend RBAC alongside the feature rather than after it. |
| Tests | `npm run lint` + `npm test` in `frontend`, `npm test` in `backend`; plus the responsive check at ~360px, ~768px, ~1280px. |
| Updates relevant .md files | The README tables that the change makes stale, and `docs/project-state/PROJECT-STATE.md` if product behaviour changed. |
| Updates changelog | One entry at the top of the matching group under `Unreleased` in [docs/CHANGELOG.md](docs/CHANGELOG.md), placed from the file's first 40 lines — never a read of the whole file. |
| Claude reviews | Read the diff against these rules: reuse, responsiveness, access control on both sides, layer boundaries, RBAC guarded, docs updated, no secrets, and **only the final fix in the diff** (see Hard Constraints) - with the report of the subagent for each side touched: `frontend-ui-reviewer` and `ux-heuristics-reviewer`, `backend-api-reviewer`, `db-schema-reviewer` for any database change, and `security-reviewer` whenever the change touches auth, a token, a public route, a webhook, raw SQL, an upload, an outbound call, a secret or a dependency. |
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

## The Six Rules

1. **Reuse a component before building one — never type raw markup for something that exists.**
   Before writing any UI, list `frontend/src/components/ui/`, `shared/`, `layout/`, `data-table/`
   and `schema-form/` and grep the module's own folder for the behaviour. A `<button>`, `<input>`,
   `<select>`, `<textarea>`, `<table>` or `role="dialog"` typed into a page or module component is
   a defect when `Button`, `TextField`, `Dropdown`, `TextAreaField`, `DataTable` or `Dialog` does
   the job. When one nearly fits, add the prop to it. When nothing fits, create one reusable
   component in the right folder, then use it — a page composes components and holds no markup of
   its own. On the backend, check `backend/src/services/` and `src/middleware/` before writing a
   helper. Before and after UI work, run the **frontend-ui-reviewer** subagent in
   [.claude/agents/](.claude/agents/README.md); the inventory and the checklist live there.
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
   | Backend | Every route mounts `protect` and then `checkPermission(module, feature, level)` or `requireModule(module, feature)` from `src/middleware/permissionMiddleware.js` — `READ` to look, `READ_WRITE` to change. The guard is the **only** thing deciding access: never add a check on `req.user.role` inside a controller, which silently overrules the permission above it and cannot be granted to anyone. Never trust an id from the body or the URL to be one the caller may touch. Before and after backend work, run the **backend-api-reviewer** subagent in [.claude/agents/](.claude/agents/README.md); its checklist covers this table, branch reach, `dataScope`, controllers, services and tests. |
   | Frontend | The route gets a row in `frontend/src/constants/modulePermissions.js`; without one the page is open to anyone signed in. `RouteGuard` then closes it, the sidebar stops listing it, and the page asks `useRouteAccess()` what it may do. A control the viewer may not use is **absent**, not disabled and refused. A panel reachable by double-click or a deep link takes `canWrite` as a prop — it cannot rely on the control that opens it having been hidden. |
   | New module or feature | Add the `{ module, feature }` row to `PERMISSIONS` in `backend/prisma/seeds/permission-catalogue.js` **and write the same row into a migration** (`INSERT … WHERE NOT EXISTS`, see IAM.md step 10) — the seed cannot be run on the VPS, so a catalogue-only permission never reaches production and the guard naming it refuses everybody but a Super Admin. Reseed locally. **The migration grants it to `SUPER_ADMIN` only — never to any other role, and never by default.** Every other role starts at `DISABLED`; do not also grant Branch Admin, an Administrator-tick role, or any role that "seems related" without the user explicitly asking for that role in this change. Say in the changelog entry which roles the studio might now want it granted to, and let the studio grant it themselves in Role Management. |

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

   Every business table now carries a `branchId` beside its branch text, and `dataScope` narrows on
   it; a new module still has to declare its branch column to `dataScope`, or it is not narrowed.

5. **Every link is an id with a key; a name is only ever a copy.** A column that names a branch,
   person, vertical, lead, project or master-data row is an id with `@relation` and an index, never
   text. The text columns that remain are copies declared in `backend/src/services/nameCopies.js`
   (a rename rewrites them) and resolved on read by `backend/src/services/resolvedNames.js` (the
   linked name comes back, the text only where nothing is linked). `""` never means "none". A
   migration is rehearsed on a copy of the database and must not fail on production data. Before and
   after touching `schema.prisma`, a migration, a Prisma query or raw SQL, run the
   **db-schema-reviewer** subagent in [.claude/agents/](.claude/agents/README.md); the full rules
   live there, not here, so they cost nothing until they are needed.

6. **Every screen follows the usability principles.** A screen says what is happening, lets the
   user leave and undo, prevents the error before reporting it, speaks the studio's words, shows
   only what the moment needs and fills what the app already knows — Nielsen's 10 heuristics,
   Shneiderman's 8 golden rules, Gerhardt-Powals' cognitive engineering principles, the
   interaction and perception laws (Hick, Fitts, Miller, Jakob, Gestalt) and content, accessibility
   and experience (WCAG 2.1 AA, content design, Norman, Tognazzini, Peak-End, Fogg, Cialdini)
   and the house SAGE checklist (first-time user, trust, cognitive load), mapped to this codebase's
   own components. Before and after adding or reshaping a screen, flow, dialog or
   form, run the **ux-heuristics-reviewer** subagent in [.claude/agents/](.claude/agents/README.md);
   the rules live there.

Details and per-file checklists: [frontend/README.md](frontend/README.md) Rules 1–3,
[backend/README.md](backend/README.md), [docs/project-state/IAM.md](docs/project-state/IAM.md)
for Rule 4, and [.claude/agents/db-schema-reviewer.md](.claude/agents/db-schema-reviewer.md) for
Rule 5.

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

## Token Optimization — Read Sections, Not Files

Every file a session reads costs tokens before any work starts, and the reference files here are
large: a README is 25–35k tokens, IAM.md 21k, PROJECT-STATE.md 57k, the changelog 130k. The rules:

- **CLAUDE.md is the only file read whole.** Everything else — the READMEs, `docs/project-state/`,
  the changelog — is read by section: `grep -n '^## ' <file>` for the headings, then
  `sed -n 'a,bp' <file>` for the section the change touches. A question that spans many files goes
  to an `Explore` subagent, which returns the conclusion, not the files.
- **The changelog is read by its head.** `head -40 docs/CHANGELOG.md` shows the how-to and the
  first groups under `Unreleased`; the entry goes at the top of the first group of its name, and a
  second group of the same name is never opened. The file holds only `Unreleased` and the latest
  release; older releases live one file per version in `docs/changelog/`.
- **A rule is written once, and this file points to it.** Here a rule is a short paragraph plus a
  pointer. A checklist a reviewer applies lives in a `.claude/agents/` file, loaded only when that
  area is worked on; reference knowledge lives in a README or `docs/project-state/`.
- **Writing a rule is the moment to optimize.** After any change to this file, a README, an agent
  file, a `docs/project-state/` file or the changelog's how-to, run `scripts/doc-sizes.sh` to see
  what each rule file now costs a session, and run the **token-optimizer** subagent in
  [.claude/agents/](.claude/agents/README.md) when a rule grew: it says which text moves to an
  agent file or a docs file, and whether a large file is worth splitting by area. Nothing is
  enforced — the aim is that a session reads only what its change needs.

## Hard Constraints

- Do not change the approved stack or architecture without explicit approval.
- Do not touch the separate legacy WhatsApp automation unless a task names it.
- Never commit `.env` files, credentials, JWT secrets, SMTP details, or password hashes. A change
  that touches auth, a token, a public route, a webhook, raw SQL, an upload, an outbound call, a
  secret or a dependency runs the **security-reviewer** subagent in
  [.claude/agents/](.claude/agents/README.md) before and after; values go through `?` in raw
  SQL, tokens come from `crypto`, public routes sit behind `rateLimit`, `req.body` is never
  spread into Prisma.
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
- **A wrong attempt is undone before the right one is finished.** When a change was made on a
  misreading of the problem and the real cause is understood later, every edit from the abandoned
  attempts is reverted in the same change — not left beside the fix because it "does no harm".
  Before finishing, read `git diff` end to end: every hunk must be one the final understanding
  needs. A hunk that exists only because of an earlier guess is removed, and so is the changelog
  line, README sentence, migration, test or seed row that described the guess. The diff the user
  reviews is the fix, not the history of finding it. If an earlier attempt was already committed,
  say so and revert it in a commit of its own rather than layering the fix on top.
- Next.js 16 differs from older documentation — check `frontend/node_modules/next/dist/docs/` before
  using an unfamiliar API. See [frontend/AGENTS.md](frontend/AGENTS.md).
- **Database naming:** All table names and column names in the database must be `snake_case` (e.g., `sales_project`, `created_at`, `project_id`). Use Prisma's `@map()` for columns and `@@map()` for tables when field/model names differ from database names. Code always uses camelCase; Prisma handles the translation automatically.
