# Virtual Curation Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI Feature and Album Proofing modules a dashboard on the Image Selection dashboard's pattern, on the web and the desktop, from one backend endpoint each.

**Architecture:** The backend answers one `?range=` request per module with positions (summary), an as-of trend, period counts, the table rows and the two panels; both clients only format. Generic card / panel / bar / range vocabulary is extracted from the Image Selection dashboard into shared files and re-exported from the old locations so nothing that works today changes. Each module keeps its own vocabulary file (cards, views, labels) mirrored web ↔ desktop.

**Tech Stack:** Express + Prisma (MySQL) backend; Next.js 16 / React 19 / Tailwind web with `DataTable`, `DashboardCard`, `Dropdown`, MUI icons; Vite / React 19 / Tailwind 4 / Material Symbols desktop; node:test (backend, web), vitest (desktop).

**Spec:** `docs/superpowers/specs/2026-10-01-virtual-curation-dashboards-design.md`

## Global Constraints

- No existing flow changes: event creation, processing, QC, corrections, versions, links, uploads, permissions, schema. No migration.
- Every new backend read is guarded exactly as the list it summarises: AI → `requireModule("IMAGE_SELECTION","AI Feature")` (already on the router); Album → `READ_ANY` (`Album Proofing` READ or `Album Proofing QC` READ).
- Existing response keys of `/api/ai-feature/overview` keep their shape and meaning.
- Range keys `lifetime|month|week|3m|6m`, default `month`; unknown → 400.
- Expiring soon = 10 days. No trend for a figure whose past cannot be read from a stamp.
- Only `@mui/icons-material` icons and Montserrat on the web; Material Symbols via `Icon` on the desktop.
- Web: a page composes components; API calls only in `services/`; `src/lib` pure. Desktop: no cross-module imports; one service function per endpoint.
- Changelog: one entry at the top of the matching group under `Unreleased`; READMEs and PROJECT-STATE updated in the same change.

## Review Focus

1. **Range at a month boundary** — `trend.before` must be the count at the first instant of the range, so an event created at 00:00:00 studio time on the 1st is *not* in `before`. Test in Task 2 and Task 3 with `createdAt === range.from`.
2. **Archived event in the past** — an event archived after `asOf` must count under its dated status in `before`, not under archived. Test in Task 2.
3. **Album with no publication / revoked publication** — `link` is `null` or `revoked`, never `expired` from a null `expiresAt`. Test in Task 3.
4. **Failed refresh** — a 500 on refresh must keep the figures on screen and show a notice; a 500 on first load must show the retry state; neither may crash the module. Covered by the page structure (same as Image Selection) and checked headless in Task 11.
5. **A QC-only role** — sees the Album dashboard with no New Project button and the row double-click still opens the album read-only. Covered by `canWrite` gating in Task 7 and Task 10.

---

### Task 1: Shared range helper on the backend

**Files:**
- Create: `backend/src/services/dashboardRange.js`
- Modify: `backend/src/modules/image-selection/dashboard/service.js` (replace the local `STUDIO_OFFSET_MS … rangeBounds` block with an import; keep `rangeBounds`, `RANGE_KEYS`, `DEFAULT_RANGE` in `module.exports`)
- Modify: `backend/src/modules/image-selection/dashboard/validation.js` (import `dashboardQuerySchema` from the shared file and re-export)
- Test: `backend/test/dashboard-range.test.js`

**Interfaces:**
- Produces: `rangeBounds(key = "month", now = new Date()) → { key, label, from: Date, to: Date }`, `RANGE_KEYS`, `DEFAULT_RANGE`, `RANGE_LABELS`, `dashboardQuerySchema` (zod: `{ range: enum(RANGE_KEYS).optional().default("month") }`).

- [ ] Write `backend/test/dashboard-range.test.js`: `rangeBounds("month", new Date("2026-09-15T10:00:00Z")).from` equals `2026-08-31T18:30:00.000Z`; `to` equals `2026-09-15T18:30:00.000Z`; unknown key falls back to month; `dashboardQuerySchema.safeParse({ range: "year" }).success === false`.
- [ ] Run `node --test test/dashboard-range.test.js` in `backend` → fails (module not found).
- [ ] Move the block from the Image Selection service into the shared file; import and re-export.
- [ ] Run `node --test test/dashboard-range.test.js test/image-selection-dashboard.test.js` → pass.

### Task 2: AI overview becomes the AI dashboard

**Files:**
- Modify: `backend/src/modules/ai-feature/overview/service.js` (`dashboard({ range, now })`), `overview/controller.js` (parse `req.query` with `dashboardQuerySchema`, 400 on failure), `overview/validation.js` (new, re-exports the schema)
- Test: `backend/test/ai-feature-overview-dashboard.test.js`

**Interfaces:**
- Produces: `createOverviewService({ prisma, activity, now })` returning `{ dashboard(query) }` so the test injects a fake prisma; the module still exports `dashboard` bound to the real client. Response keys per spec §3.2: `range, period, summary, trend, comparedAt, eventRows, processingProgress, totalEventsAllTime, generatedAt` beside the existing `events, media, faces, guests, storage, recentEvents, recentActivity`.

- [ ] Write the test with a fake prisma whose `aiEvent.findMany`, `aiEventMedia.groupBy/count/aggregate`, `aiEventFace.count/groupBy`, `aiEventPerson.count/groupBy`, `aiEventFaceMatch.count`, `aiEventGuest.count`, `aiEventActivity.groupBy` answer from an in-memory fixture of 4 events (one upcoming, one active, one completed, one archived after `range.from`) and 10 media (6 COMPLETED, 2 QUEUED, 1 FAILED, 1 VIDEO SKIPPED). Assert: `summary` figures; `trend.totalEvents.before` excludes the event created at exactly `range.from`; `trend.activeEvents.before` counts the later-archived event under its dated status; `trend.processingPhotos` and `trend.failedPhotos` are absent; `eventRows` sorted by `lastActivityAt` desc with `processedCount`, `peopleCount`, `percent`; `processingProgress` holds only the event with QUEUED media; `range=lifetime` → `trend === null`; invalid range → the controller answers 400.
- [ ] Run → fails.
- [ ] Implement: group media by `[eventId, aiStatus]` and `[eventId, kind]` once, persons by `eventId` where `hidden:false`, faces by `eventId`, activity `_max.createdAt` by `eventId`; `statusFromDates` for status; as-of counts per spec table.
- [ ] Run the new test and the existing `ai-feature-*.test.js` → pass.

### Task 3: Album Proofing dashboard endpoint

**Files:**
- Create: `backend/src/modules/image-selection/album-proofs/dashboard.service.js`, `dashboard.repository.js`
- Modify: `album-proofs/routes.js` (`router.get("/dashboard", READ_ANY, controller.dashboard)` **above** `router.get("/:albumId", …)`), `album-proofs/controller.js` (`dashboard` handler using `dashboardQuerySchema`)
- Test: `backend/test/album-proofs-dashboard.test.js`

**Interfaces:**
- Produces: `createDashboardService(repo, { now })` → `{ build({ range }) }` with the response in spec §3.3. Repository functions: `listAlbumsForDashboard()` (live albums incl. archived, with project, latest FROZEN version, latest publication, correction counts by status), `correctionsByAlbumAndSource()`, `activityCounts({ from, to })`, `activityLatestByAlbum()`.
- Exposes `EXPIRING_SOON_DAYS = 10`, `STAGE_PERCENT` map, `linkStateOf(publication, now)`, `stagePercentOf(status)` for the tests.

- [ ] Write the test from a fixture of 9 albums covering DRAFT, PROCESSING_FAILED, READY_FOR_QC, QC_REVIEW, QC_REVISION_IN_PROGRESS with 2 QC corrections (1 RESOLVED, 1 OPEN), REVISION_IN_PROGRESS with 1 CLIENT correction RESOLVED (gate unlocked), CLIENT_REVIEW with a publication expiring in 3 days, CLIENT_REVIEW with a publication revoked, COMPLETED with `completedAt` before `range.from`. Assert every `summary` key; `albumRows[i].link.state`; `readyForRevisedVersion` true only for the REVISION_IN_PROGRESS album; `stagePercent`; `trend.completed.before === 1`; `trend.totalAlbums.before` excludes the album created at `range.from`; `links.inClientReview` lists the two CLIENT_REVIEW albums with their version; `processing.failed === 1`; `range=lifetime` → `trend === null`; `/dashboard` is registered before `/:albumId` (read `routes.js` and assert order, as `desktop-capabilities.test.js` does for route order).
- [ ] Run → fails.
- [ ] Implement; reuse `revisionGate.js`'s gate (export a pure `gateOf({ status, roundTotal, unresolved })` if it is not already pure) and `clientLabel` for the client name.
- [ ] Run new test + `album-proofs*.test.js` + `album-proof-*.test.js` → pass (environmental failures noted in memory are not from this change).

### Task 4: Web shared dashboard pieces

**Files:**
- Create: `frontend/src/lib/dashboardRange.mjs`, `frontend/src/components/shared/DashboardMetricCards.js`, `frontend/src/components/shared/DashboardProgressBar.js`
- Modify: `frontend/src/lib/imageSelectionDashboard.mjs` (import + re-export the moved names), `frontend/src/components/image-selection/dashboard/DashboardCards.js` (`SummaryCards` calls `DashboardMetricCards`; `SelectionProgressBar` wraps `DashboardProgressBar`)
- Test: `frontend/test/dashboard-range.test.mjs`; existing `image-selection-dashboard.test.mjs` unchanged

**Interfaces:**
- `DashboardMetricCards({ cards, summary, trend, rangeKey, loading, view, onViewChange, sameView, format = number })` — `cards: [{ key, label, unit, view, compact? }]`; `unit` may be a string (`"Album"`) or `[singular, plural]`.
- `DashboardProgressBar({ percent, color, emptyText = "—" })`.
- `dashboardRange.mjs` exports: `RANGE_OPTIONS, DEFAULT_RANGE, PERIOD_PHRASES, periodPhrase, PREVIOUS_PHRASES, previousPhrase, PREVIOUS_LABELS, previousLabel, trendOf, unitLabel, formatCompact, formatBytes, relativeTime, number`.

- [ ] Write the range test (phrases, `trendOf(-3).text === "-3"`, `unitLabel(1, ["Person","People"]) === "Person"`, `unitLabel(2, "Album") === "Albums"`).
- [ ] Run `node --test test/dashboard-range.test.mjs` in `frontend` → fails.
- [ ] Extract; keep the rendered markup of the Image Selection cards byte-identical.
- [ ] `npm test` and `npm run lint` in `frontend` → pass.

### Task 5: Web AI dashboard

**Files:**
- Create: `frontend/src/lib/aiDashboard.mjs`, `frontend/src/components/ai-feature/overview/AiDashboardCards.js`, `frontend/src/components/ai-feature/overview/AiDashboardRecentEvents.js`
- Modify: `frontend/src/components/ai-feature/overview/AiOverviewPage.js` (rebuild), `frontend/src/services/ai-feature/ai-feature.service.js` (`getAiOverview({ range } = {})`)
- Test: `frontend/test/ai-dashboard.test.mjs`

**Interfaces:**
- `aiDashboard.mjs`: `AI_SUMMARY_CARDS` (10, per spec §4.2), `sameView`, `viewLabel`, `rowMatchesView(row, view)` (`{ status }` or `{ attention: "processing" | "failed" }`), `rowsForView`, `EMPTY_PROCESSING = "No AI processing currently running."`, `eventHref(id)`.

- [ ] Write the test: card keys match the backend summary keys; `rowsForView(rows, { attention: "failed" })` keeps rows with `failedCount > 0`; `viewLabel({ status: "ARCHIVED" }) === "Archived Events"`.
- [ ] Run → fails. Implement the lib, then the components, then the page.
- [ ] `npm test`, `npm run lint` → pass. Headless check at 360 / 768 / 1280 (Task 11).

### Task 6: Web Album Proofing dashboard

**Files:**
- Create: `frontend/src/app/(app)/image-selection/album-proofing/dashboard/page.js`, `frontend/src/lib/albumProofingDashboard.mjs`, `frontend/src/components/image-selection/album-proofing/dashboard/AlbumProofingDashboardPage.js`, `AlbumDashboardCards.js`, `AlbumDashboardRecentAlbums.js`
- Modify: `frontend/src/services/image-selection/album-proofs.service.js` (`getAlbumProofingDashboard({ range })`), `frontend/src/app/(app)/image-selection/album-proofing/page.js` (pass `sections`), `frontend/src/components/image-selection/ImageSelectionNavigation.js` (export `albumProofingSections`), `frontend/src/constants/navigation.mjs` (href → dashboard), `frontend/src/constants/modulePermissions.js` (dashboard row ahead of the prefix row)
- Test: `frontend/test/album-proofing-dashboard.test.mjs`; `backend/test/permission-catalogue-sidebar.test.js` and any route-map test must still pass

**Interfaces:**
- `albumProofingDashboard.mjs`: `ALBUM_SUMMARY_CARDS` (10, per spec §4.3), `sameView`, `viewLabel`, `rowMatchesView(row, view)` (`{ status: [..] }` or `{ attention }` read from `row.views`), `rowsForView`, `LINK_LABELS = { active: "Active", expiringSoon: "Expiring soon", expired: "Expired", revoked: "Revoked" }`, `linkLabel(link)` (`"Not sent"` for null), `versionText(row)`, `albumHref(row)` → `/image-selection/album-proofing?projectId=&albumId=`, `DASHBOARD_ROUTE`, `PROJECTS_ROUTE`.

- [ ] Write the test (cards ↔ summary keys; `rowMatchesView` on status arrays and attention flags; `linkLabel(null) === "Not sent"`; `albumHref`).
- [ ] Run → fails. Implement lib, components, page, nav, route row.
- [ ] `npm test`, `npm run lint` → pass; verify the existing album page still opens `?projectId=&albumId=`.

### Task 7: Desktop shared dashboard kit

**Files:**
- Create: `src/lib/dashboardRange.js`, `src/components/dashboard/DashboardCard.jsx` (`DashboardCard`, `CardState`), `MetricCards.jsx`, `DashboardProgressBar.jsx`, `DashboardTable.jsx`
- Modify: `src/modules/image-selection/dashboard/DashboardCards.jsx`, `DashboardRecentProjects.jsx`, `dashboardSpec.js` (import from the shared files; keep every export)
- Test: `src/components/dashboard/__tests__/dashboardTable.test.js` (the pure `narrowRows({ rows, columns, filters, sort })` helper), existing `dashboardSpec.test.js`

**Interfaces:**
- `DashboardTable({ columns, rows, renderCell, getRowId, onOpen, loading, error, onRetry, emptyMessage, loadingMessage, ariaLabel, footer })` — `columns: [{ id, header, width, value(row) }]`; keeps the Image Selection table's filter row, three-state sort, 15-row paging, double-click.
- `MetricCards` takes the same props as the web's `DashboardMetricCards`.

- [ ] Write the `narrowRows` test (filter is case-insensitive contains; sort numeric vs string; `null` sort keeps order).
- [ ] `npm test` → fails; extract; `npm test` + `npm run build` → pass.

### Task 8: Desktop AI dashboard

**Files:**
- Create: `src/modules/ai-curation/overview/aiDashboardSpec.js` (mirror of the web lib), `src/modules/ai-curation/overview/AiDashboardCards.jsx`, `AiDashboardRecentEvents.jsx`, `__tests__/aiDashboardSpec.test.js`
- Modify: `src/modules/ai-curation/overview/OverviewPage.jsx`, `src/services/aiFeature.service.js` (`getAiOverview({ range } = {})`), `src/modules/ai-curation/lib/aiFeature.js` only if a formatter is missing

- [ ] Spec test mirrors Task 5's; `npm test` → fails; implement; `npm test` + `npm run build` → pass.

### Task 9: Desktop Album Proofing dashboard

**Files:**
- Create: `src/modules/album-proofing/AlbumProofingHeader.jsx`, `src/modules/album-proofing/dashboard/DashboardPage.jsx`, `AlbumDashboardCards.jsx`, `AlbumDashboardRecentAlbums.jsx`, `albumDashboardSpec.js`, `__tests__/albumDashboardSpec.test.js`
- Modify: `src/modules/album-proofing/index.jsx` (index → `Navigate("dashboard")`, `dashboard`, `projects`, `projects/:projectId` …), `src/modules/album-proofing/AlbumProofingPage.jsx` (mount the header; its "/album-proofing" links become `/album-proofing/projects`), `src/modules/album-proofing/lib/albumStates.js` (`projectRoute` → `/album-proofing/projects…`, add `DASHBOARD_ROUTE`), `src/services/albumProofs.service.js` (`getAlbumProofingDashboard({ range })`), `src/core/permissions/modules.js` route stays `/album-proofing`
- Check: `src/projects/ProjectsHubPage.jsx`, `src/activity/ActivityPage.jsx`, `src/app/HomePage.jsx` and `AlbumRedirect.jsx` for hard-coded `/album-proofing` links that should now say `/album-proofing/projects`.

- [ ] Spec test; implement; `npm test` + `npm run build` → pass; `docs/VIRTUAL-CURATION-AUDIT.md` §2 module map and §3.3 updated.

### Task 10: Docs and changelog (web repo)

- [ ] `frontend/README.md` Rule 1 table: the two new shared components, one line each.
- [ ] `backend/README.md` Code Flow: the AI overview `?range=` and the album-proofs `/dashboard` route, one line each.
- [ ] `docs/project-state/PROJECT-STATE.md`: AI Feature and Album Proofing sections say the dashboard exists and what it shows (read those sections by heading first).
- [ ] `docs/CHANGELOG.md`: one `Added` entry (Album Proofing dashboard, web + desktop, who reaches it: Album Proofing / Album Proofing QC READ) and one `Changed` entry (AI overview rebuilt on the dashboard pattern; `?range=`), each at the top of its group.

### Task 11: Verification

- [ ] `backend`: `npm test` (compare against the environmental failures already known on this machine).
- [ ] `frontend`: `npm run lint && npm test`.
- [ ] Desktop: `npm test && npm run build`.
- [ ] Headless signed-in check of `/visual-curation/ai/overview` and `/image-selection/album-proofing/dashboard` at 360 / 768 / 1280 (memory: headless-signed-in-verify); desktop from Vite at 1024×640 (memory: crossplatform-verify-recipe) — same figures on both.
- [ ] Reviews: backend-api-reviewer, db-schema-reviewer, frontend-ui-reviewer, ux-heuristics-reviewer; fix findings.
- [ ] `git diff` end to end: only hunks the final design needs.
