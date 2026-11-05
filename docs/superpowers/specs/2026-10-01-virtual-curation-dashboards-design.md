# Virtual Curation dashboards: AI Feature and Album Proofing in the Image Selection family

Date: 2026-10-01. Status: design brief written from the owner's specification and a read of the code;
implementation follows it. Every number on these dashboards is the backend's; nothing on either client
derives a business state.

## 1. Outcome

Three dashboards that read as one product. Image Selection's dashboard is the reference and is not
redesigned. The AI Feature overview is rebuilt on the same pattern, and Album Proofing gets a dashboard
it did not have. Both ship on the web (`frontend/`) and on the desktop (`Image-Selection_Desktop---BCT`),
reading the same backend endpoint so that the two clients can never show different figures.

Nothing in any module's working flow changes: event creation, face processing, QC, corrections,
versions, client links, uploads, permissions and the data model stay exactly as they are. The one
behavioural change outside the dashboards themselves is where the Album Proofing sidebar entry lands:
on its new dashboard, as Image Selection's does, with Projects one switch away.

## 2. The pattern (from the Image Selection dashboard)

| Part | Web (reference) | What is generalised |
| --- | --- | --- |
| Header | `ModulePageHeader` through the module's navigation component: title, section `DropdownMenu`, refresh `IconButton`, create `Button`, `OptionsMenu` ⋮ | Unchanged per module; Album Proofing's navigation gains the Dashboard / Projects sections |
| Canvas | `dashboard-canvas` scroll pane, caption + range `Dropdown` row | Same classes |
| Range | `lifetime / month / week / 3m / 6m`, default `month`; counts are positions, the range scopes the *period* figures and the comparison point (`range.from`) | Backend `rangeBounds` and the picker vocabulary move to shared files, re-exported from their old homes |
| Cards | `SummaryCards`: ten `<button aria-pressed>` cards, label + `TrendBadge`, number + unit + `ComparedTo`; pressing one narrows the table | New shared `DashboardMetricCards` takes `cards`, `summary`, `trend`, `rangeKey`, `view`, `onViewChange`, `sameView`, `number` formatter |
| Table | `DataTable` in `DataTableShell` with `filtering`, `sorting`, `infiniteScroll`, double-click opens, footer count, view chip | Each module writes its own columns in its own component |
| Lower panels | `xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]`: a list panel and a `dl` panel in `DashboardCard` + `CardState` | Shared `DashboardCard` already exists; a shared `DashboardProgressBar` replaces the module-local bar |
| States | first load → skeleton in cards and panels; failed first load → `CardState error` with Try again; failed refresh → keep data, `FloatingNotice`; empty studio → one `EmptyDashboard` section | Same on both new dashboards |

On the desktop the same parts exist in `src/modules/image-selection/dashboard/` (`DashboardCards.jsx`,
`DashboardRecentProjects.jsx`, `dashboardSpec.js`). The generic parts (`DashboardCard`, `CardState`,
`SummaryCards` as a generic grid, `TrendBadge`, `ComparedTo`, the progress bar, and the sortable
filterable table) move to `src/components/dashboard/` so the three modules share them without
importing across module folders; the range vocabulary moves to `src/lib/dashboardRange.js`. The
Image Selection module keeps its files and imports the shared pieces.

## 3. Backend

### 3.1 Shared

`backend/src/services/dashboardRange.js` holds `RANGE_KEYS`, `DEFAULT_RANGE`, `RANGE_LABELS`,
`rangeBounds(key, now)`, `dashboardQuerySchema`. The Image Selection dashboard service and
validation import and re-export them, so `image-selection-dashboard.test.js` keeps passing unchanged.

### 3.2 AI Feature: `GET /api/ai-feature/overview?range=`

The existing endpoint, extended. Guard unchanged (`protect` + `requireModule("IMAGE_SELECTION", "AI
Feature")`). `range` is optional and defaults to `month`; an unknown key is a 400 as on Image
Selection. Every existing key keeps its meaning and shape (an older desktop build may still read it).

Added keys:

```jsonc
{
  "range":  { "key", "label", "from", "to" },
  "period": { "key", "label", "eventsCreated", "photosUploaded", "photosProcessed" },  // inside [from, to)
  "summary": {
    "totalEvents", "activeEvents", "upcomingEvents", "completedEvents", "archivedEvents",
    "processingPhotos",   // QUEUED + PROCESSING, as of now
    "totalPhotos",        // kind PHOTO
    "processedPhotos",    // aiStatus COMPLETED
    "failedPhotos",       // aiStatus FAILED
    "peopleDetected"      // persons not hidden
  },
  "trend": null | { "<summary key>": { "before", "delta" } },   // keys without a reliable as-of are absent
  "comparedAt": null | ISODate,
  "eventRows": [ { "id", "name", "eventType", "startDate", "endDate", "status", "archivedAt",
                   "coverUrl", "mediaCount", "processedCount", "failedCount", "processingCount",
                   "peopleCount", "faceCount", "guestCount", "percent", "lastActivityAt" } ],
  "processingProgress": [ eventRow ],   // events with queued or processing media, up to 5, most recently active first
  "totalEventsAllTime": n,
  "generatedAt": ISODate
}
```

As-of snapshot for `trend` (every range but `lifetime`, `asOf = range.from`), reconstructed from the
dates rows carry, exactly as Image Selection does:

| key | as of `asOf` |
| --- | --- |
| totalEvents | live events with `createdAt < asOf` (an event deleted since is gone from every figure, as on Image Selection) |
| active / upcoming / completed | `statusFromDates(event, asOf)` over those events, with `archivedAt >= asOf` masked |
| archivedEvents | `archivedAt < asOf` |
| totalPhotos | media kind PHOTO, `createdAt < asOf`, `deletedAt` null or `>= asOf` |
| processedPhotos | COMPLETED media with `createdAt < asOf` and `aiCompletedAt` null or `< asOf` |
| peopleDetected | persons `createdAt < asOf` (hidden later is not masked; the row has no stamp for it) |
| processingPhotos, failedPhotos | **no trend**: queue and failure states are not reconstructible |

`eventRows` is every live event, archived ones included (status ARCHIVED), sorted by
`lastActivityAt` desc, where `lastActivityAt` is the newest of the event's `updatedAt` and its latest
activity row. `peopleCount` and the per-status media counts come from grouped queries; `mediaCount`
uses the same `LISTED_MEDIA` scope as the events list so the two screens agree. `percent` is
`processing/summary.js`'s percent.

### 3.3 Album Proofing: `GET /api/image-selection/album-proofs/dashboard?range=`

New route in the existing router, mounted **before** `/:albumId`, guarded `READ_ANY` (Album Proofing
READ or Album Proofing QC READ), the same guard as the album list it summarises. No new permission.
No branch scoping: the module has no branch column and no `dataScope` declaration today; the
dashboard inherits the list's reach.

```jsonc
{
  "range", "period": { "key", "label", "albumsCreated", "sentToQc", "sentToClient", "completed" },  // activity rows in [from, to)
  "totalAlbumsAllTime": n,
  "summary": {
    "totalAlbums",          // live albums, archived included
    "draft",                // DRAFT
    "readyForQc",           // READY_FOR_QC + REVISION_READY_FOR_QC
    "qcReview",             // QC_REVIEW
    "correctionsOpen",      // albums with ≥1 OPEN / IN_PROGRESS / REOPENED correction (the list's openCorrections > 0)
    "readyForRevisedVersion", // revisionGate unlocked: revising state, round source has corrections, none unresolved
    "readyForClient",       // QC_APPROVED + READY_FOR_CLIENT
    "clientReview",         // CLIENT_REVIEW
    "linkExpiringSoon",     // latest publication active and expiresAt within 10 days
    "completed"             // COMPLETED
  },
  "trend": null | { "totalAlbums": {...}, "completed": {...} },   // only the two with a stamp to read
  "comparedAt",
  "albumRows": [ { "id", "projectId", "name", "albumType", "projectName", "clientName",
                   "status", "archivedAt", "currentVersionNumber", "openCorrections",
                   "correctionTotal", "correctionResolved", "correctionPercent",
                   "stagePercent", "readyForRevisedVersion",
                   "link": null | { "state": "active|expiringSoon|expired|revoked", "expiresAt", "revisionNumber" },
                   "lastActivityAt", "views": { "correctionsOpen", "readyForRevisedVersion", "linkExpiringSoon", "linkExpired" } } ],
  "correctionWork": [ albumRow ],   // albums in a fixing state, up to 5, most recently active first
  "corrections": { "open", "inProgress", "reopened", "resolved", "total" },
  "links": { "active", "expiringSoon", "expired", "revoked", "inClientReview": [ { "albumId", "name", "versionNumber" } ] },
  "processing": { "processing", "failed" },
  "clientApproved": n, "archived": n,
  "generatedAt"
}
```

Definitions the dashboard adds, all display derivations written once in
`album-proofs/dashboard.service.js` and documented there:

- **Expiring soon**: 10 days, the same figure Image Selection's gallery classifier uses.
- **Link state** from the album's latest publication: `revoked` if `revokedAt`; else `expired` if
  `expiresAt <= now`; else `expiringSoon` within 10 days; else `active`. No publication → `null`
  ("Not sent").
- **stagePercent**: a milestone position on the workflow for the Progress column, from the status:
  DRAFT / PROCESSING / PROCESSING_FAILED 0 · READY_FOR_QC 20 · QC_REVIEW, QC_CHANGES_REQUESTED,
  QC_REVISION_IN_PROGRESS, REVISION_READY_FOR_QC 40 · QC_APPROVED, READY_FOR_CLIENT 60 · CLIENT_REVIEW,
  CLIENT_CHANGES_REQUESTED, REVISION_IN_PROGRESS 80 · CLIENT_APPROVED 90 · COMPLETED 100.
- **correctionPercent**: resolved / total corrections on the album (null with none).
- `readyForRevisedVersion` reuses `revisionGate.js`, never a second rule.

Trend: `totalAlbums` as `createdAt < asOf`; `completed` as `completedAt < asOf` among albums still
COMPLETED. Every other card's past status is overwritten in place and is not reconstructed.

## 4. Web

### 4.1 Shared

- `frontend/src/lib/dashboardRange.mjs`: `RANGE_OPTIONS`, `DEFAULT_RANGE`, `PERIOD_PHRASES`,
  `periodPhrase`, `PREVIOUS_PHRASES`, `previousPhrase`, `PREVIOUS_LABELS`, `previousLabel`, `trendOf`,
  `unitLabel`, `formatCompact`, `formatBytes`, `relativeTime`, `number`. `imageSelectionDashboard.mjs`
  re-exports them so its test and callers are untouched.
- `frontend/src/components/shared/DashboardMetricCards.js`: the card grid (`SummaryCards` made
  generic), with `TrendBadge` and `ComparedTo`. Image Selection's `SummaryCards` becomes a thin call.
- `frontend/src/components/shared/DashboardProgressBar.js`: the bar + percent; Image Selection's
  `SelectionProgressBar` re-exports it with its "No limit" wording.

### 4.2 AI Feature (`/visual-curation/ai/overview`, label stays "Overview", permission row unchanged)

`components/ai-feature/overview/AiOverviewPage.js` rebuilt on the pattern; `lib/aiDashboard.mjs`
holds the ten cards, views and labels; `AiDashboardCards.js` (processing progress list, detection &
storage `dl`) and `AiDashboardRecentEvents.js` (the table). Polling every 30 s while visible stays.
Create Event keeps routing to `/visual-curation/ai/events?create=1`.

Cards, in order: Total Events (view null) · Active Events (status ACTIVE) · Upcoming Events ·
Completed Events · Processing (events with processing media) · Total Photos (null) · Processed
Photos (null) · Failed (events with failed media) · People Detected (null) · Archived Events (status
ARCHIVED). Unit "Event" on the event cards, "Photo" on the photo cards, "Person/People" on people.

Recent Events table columns: Event (name + type beneath) · Date (`formatEventRange`) · Event Type ·
Photos · Processed · People · Faces · Progress (bar) · Status (`StatusChip`) · Last Activity.
Double-click opens the event workspace.

Left panel "AI Processing Progress": `processingProgress` rows, each name + status chip, "processed /
total", failed count in red when > 0, relative time, bar. Empty: "No AI processing currently running."
Right panel "Detection & Storage": Storage used · Faces detected · People · Face matches · Unmatched
faces · Videos · Guests · Recent uploads (24h) · Archived events, each with a hint line.
Empty studio: "No events yet" with Create Event when `canWrite`.

### 4.3 Album Proofing (`/image-selection/album-proofing/dashboard`)

New page `app/(app)/image-selection/album-proofing/dashboard/page.js` rendering
`components/image-selection/album-proofing/dashboard/AlbumProofingDashboardPage.js`; the existing
page becomes the "Projects" section. `ImageSelectionNavigation` is given
`sections=[Dashboard, Projects]` on both pages. The sidebar entry (`navigation.mjs`) points to the
dashboard. The route map's prefix row `/image-selection/album-proofing` already guards the new
path; a dashboard row is added ahead of it so the landing resolver sends people to the dashboard, as
Image Selection's does. `lib/albumProofingDashboard.mjs` holds the cards, views and labels; the
status chip reuses `ProofingStatusChip` and `ALBUM_STATE_LABELS`.

Cards: Total Albums · Draft · Ready for QC · QC Review · Corrections Open · Ready for Revised Version
· Ready for Client · Client Review · Link Expiring Soon · Completed. Unit "Album".

Recent Albums table: Album (name, project beneath) · Client · Version (`V2` / "No proof yet") ·
Status (chip) · Corrections (`n open`) · Progress (stagePercent bar) · Link (Active / Expiring soon /
Expired / Revoked / Not sent) · Last Activity. Double-click opens the album in the Projects page
(`?projectId=&albumId=`, the deep link the page already honours).

Left panel "QC & Correction Progress": `correctionWork` rows: name + chip, "resolved / total
corrections", "ready for revised upload" when unlocked, relative time, correction bar. Empty: "No open
corrections." Right panel "Proofing & Link Status": Active client links · Expiring soon · Expired ·
Revoked · In client review (names with version) · Client approved · Completed · Processing /
failed · Archived. Empty studio: "No albums yet" with New Project when `canWrite`.

Create action: "New Project" → `/image-selection/album-proofing?new=1` when the Album Proofing grant
is READ_WRITE (the QC grant alone shows no create control). The web route map holds one permission
per page, so on the web the dashboard opens for the Album Proofing grant, as the Projects page beside
it does; a role holding only Album Proofing QC reaches the dashboard on the desktop, whose module
registry accepts either grant, and the API answers both.

The dashboard counts the albums the Projects page can show: live albums under a live, unarchived
project — so every row it lists is one a double click can open.

## 5. Desktop

- `src/lib/dashboardRange.js` and `src/components/dashboard/` (`DashboardCard`, `CardState`,
  `MetricCards`, `DashboardProgressBar`, `DashboardTable`) extracted from the Image Selection
  module, which then imports them.
- AI Curation: `overview/OverviewPage.jsx` rebuilt; `overview/aiDashboardSpec.js` mirrors the web's
  `aiDashboard.mjs`; same cards, table and panels; `getAiOverview({ range })`.
- Album Proofing: `index.jsx` gains `dashboard` (index redirects to it) and `projects` (the old
  index page); `AlbumProofingHeader.jsx` gives the module the Dashboard / Projects switch and ⋮ it
  lacked; `dashboard/DashboardPage.jsx`, `dashboard/albumDashboardSpec.js`;
  `getAlbumProofingDashboard({ range })` in `albumProofs.service.js`. `albumRoute` opens a row.
- Desktop-only extras stay secondary: the AI dashboard shows the local engine strip the shell
  already mounts; nothing local replaces a backend figure.
- Vitest specs for both spec files, mirroring `dashboard/__tests__/dashboardSpec.test.js`.

## 6. Tests and verification

- Backend: `ai-feature-overview-dashboard.test.js` (summary, trend masking, period counts, event
  rows, validation) and `album-proofs-dashboard.test.js` (every card from a fixture of albums,
  link states, gate reuse, stage percent, trend) with injected repositories, no database.
- Web: `frontend/test/ai-dashboard.test.mjs`, `album-proofing-dashboard.test.mjs`, and the existing
  `image-selection-dashboard.test.mjs` unchanged; `npm run lint`, `npm test`.
- Desktop: `npm test`, `npm run build`.
- Responsive check at ~360, ~768, ~1280 (web) and 1024×640 (desktop).
- Reviews: backend-api-reviewer, db-schema-reviewer (new Prisma reads), frontend-ui-reviewer,
  ux-heuristics-reviewer.

## 7. Out of scope, deliberately

No new permission, no new table or column, no migration, no change to any status, transition,
gate, expiry, version or upload rule, no change to the Image Selection dashboard's figures or layout,
no Desktop-only status mapping, no second audit system.
