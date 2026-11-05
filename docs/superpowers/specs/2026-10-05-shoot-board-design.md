# Shoot Board — design

Date: 2026-10-05 · Branch: `feature/iam-system` · Status: implemented

## Purpose

A week-at-a-glance board of the shoots a person works on, as a sub-module of Project Management.
Each day of the week is a column; each shoot is a card on its date; the shoots of one project share
a colour so a project's run of shoots reads as one.

## Decisions (agreed in conversation)

| Question | Answer |
| --- | --- |
| Whose shoots | Every shoot the viewer — or anybody reporting to them — is named on, in any role (below). Super Admin sees all. |
| Time shown | One week, Monday–Sunday, with ‹ › to move a week and **Today**. |
| Card | Read at a glance; a tap opens the existing production shoot panel where allowed. No drag. |
| Permission | New `PROJECT / Shoot Board`. |

## Who sees which shoots

A shoot is on the viewer's board when any of these names one of `employeeIds` (the viewer's own
employee plus their reports, from `dataScope.identityFor` — `resolve` answers "unlimited" with no
people for a role without a branch limit, so it cannot be used for a user-based board):

- On the project (`sales_project`): `projectManagerEmployeeId`, `preProductionCoordinatorEmployeeId`,
  `creativeManagerEmployeeId`, `productionManagerEmployeeId`, `postProductionCoordinatorEmployeeId`.
- On the shoot's production (`project_production`), when it has one: `productionCoordinatorEmployeeId`,
  a production team member (`teamMembers.employeeId`), a crew member (`serviceCrew.employeeId`).

Unlimited (every live shoot) for a Super Admin (`dataScope.bypassesHierarchy`) and for a holder of
`PROJECT / Show All Projects` at Read — the studio-wide grant the Projects page and Production board
already answer to. Branch reach is **not** used to widen the board: it is user based, so a role's
branches do not add shoots nobody in the viewer's line is named on.

A login with no linked employee and no unlimited grant sees an empty board with a sentence saying
the account is not linked to an employee (as Pre Production does).

Only live rows: shoot and project not deleted, project not "Yet to Start".

## Permission (Rule 4)

- Catalogue: add `{ module: "PROJECT", feature: "Shoot Board" }` to
  `backend/prisma/seeds/permission-catalogue.js`.
- Migration `…_shoot_board_permission`: `INSERT … WHERE NOT EXISTS` of the permission, granted to
  `SUPER_ADMIN` only (IAM.md step 10). Every other role starts DISABLED; the changelog names the
  roles the studio may want to grant it to (Project Managers, coordinators, Production).
- Backend: a new router mounted at `/api/project-management/shoot-board`, `protect` +
  `requireModule("PROJECT", "Shoot Board")`.
- Frontend: `modulePermissions.js` row for `/project-management/shoot-board`; sidebar entry under
  Project Management; `RouteGuard` closes it to others.
- A card opens the production panel only when the shoot has a production record **and** the viewer
  holds `PROJECT / Production` at Read (`useModuleAccess`). Otherwise the card is not a button —
  nobody taps into a refusal. The panel keeps all of its own access rules.

## API

`GET /api/project-management/shoot-board/shoots?from=YYYY-MM-DD&to=YYYY-MM-DD`

- `from`/`to` required, valid dates, `to` ≥ `from`, at most 31 days apart → else 400.
- Returns `{ data: { shoots: [...], unlinked } }`:
  - `shoots`: shoots dated in the range (`project_shoot.date_created`), ordered by date then
    project, each `{ id, shootId, shoot, shootDate, shootPlace, projectId, eventId, clientName,
    productionShootId (the shoot id when a production record exists, else null), pending (production
    pending label or null), coordinator (production coordinator name or null) }`. Names resolved
    through the linked employee first (Rule 5).
- Files: `backend/src/modules/project-management/shoot-board/{routes,controller,read}.js`, mounted in
  `server.js`. Reuses `projectClientNames`, `pendingLabel` from `production/steps.js`.

## Screen

Page `frontend/src/app/(app)/project-management/shoot-board/page.js` composes
`components/project-management/shoot-board/ShootBoardPage.js` (+ `ShootBoardDay.js`,
`ShootBoardCard.js`); service `services/project-management/shoot-board.service.js`; pure helpers in
`lib/shootBoard.mjs` (week start/end, the seven days, labels, colour assignment).

- **Header** (`ModulePageHeader`): "Shoot Board"; the week ("6 – 12 Oct 2026"), ‹ › and Today.
- **Legend**: one chip per project in the week, in its colour, with event ID / client name.
- **Desktop (md+)**: seven equal columns Mon–Sun, day name + date at the top, today highlighted;
  each column scrolls on its own; the page does not scroll as a whole (app shell rule).
- **Phone (~360px)**: days stacked; a day with no shoots collapses to one line ("Tue 7 — no shoots").
- **Colour**: a fixed palette of 10 tints; projects in the week get colours in order of first
  appearance, so two projects in one week never share one (beyond 10 the palette repeats). A card
  carries its project's colour as a left stripe and a light tint; text stays slate for contrast.
- **Card**: shoot name, client / event ID, place, coordinator, `ProductionPendingPill` when there is
  a production record.
- **States**: `Loader` while loading; error line with Retry; "No shoots this week" when empty.
- Closing an opened panel refreshes the week.

## Testing

- Backend: `read.js` where-builder (each role field, team, crew, unlimited, no employee), date-range
  validation (missing, reversed, > 31 days), route guard present, the migration grants SUPER_ADMIN only.
- Frontend: `lib/shootBoard.mjs` (Monday start, week label across months/years, distinct colours in
  order of appearance), wiring tests (route row, guard, card opens only with Production + record).
- Lint, tests, and the 360 / 768 / 1280 px check.

## Out of scope

Dragging to reschedule; month view; filters beyond the week; Post Production work items.
