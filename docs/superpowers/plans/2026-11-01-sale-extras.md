# Sale Extras Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Owner rules: work on `feature/photo-selling`, **no commits**, tests + reviewer agents once at the end.

**Goal:** Record every post-booking add / remove / scope-edit of a shoot, service or deliverable as a priced Extra line, shown above Shedule Payment in Edit Sale Details and, once published, on the same client quotation link.

**Architecture:** Baseline snapshot JSON on the three plan tables; `reconcileSaleExtras` diffs live rows against it into `project_sale_extra` lines under a project lock; publish freezes `project_sale_extra_revision`; the public quotation reads the latest revision; money readers add published amounts.

**Spec:** `docs/superpowers/specs/2026-11-01-sale-extras-design.md`

## Global Constraints
- Hand-written SQL migration applied with `prisma migrate deploy`; `npm run prisma:generate`; rehearse on a DB copy; index names ≤ 64.
- Kinds ADDED / REMOVED / MODIFIED; categories SHOOT / SERVICE / DELIVERABLE; status DRAFT / PUBLISHED / CANCELLED; code `SXT-000001`.
- Scope fields — service: quantity, quantitySessionTiming, sessionOptionId, durationHours, durationMinutes, workDays, timingMinutes, sizeOptionValueId; deliverable: quantity, numberOfPhotos, brandName, size, frameInches, videoLength, sizeOptionValueId; shoot: none.
- "Same operation" window for auto deliverables and recreate pairing: 60 seconds.
- Tracked only when `project.quotationId` names a version finalized now.
- Guard for amounts / publish = the guard on `PATCH /api/sales/projects/:id`; reads = the register's readers; reach via `projectAccessWhere` (`forWrite` for writes).
- Never write `sales_quotation`, `cash_entry`, `project_payment_schedule`, or any shoot / allocation row except the baseline snapshot moves of §5.8.
- Shared components only, 360px usable, MUI icons, Montserrat.

## Review Focus
1. Project booked on a quotation with no shoots (hand-added rows) — all rows are extras.
2. Shoot removed with Image Selection submitted selections (409 path) — nothing recorded until the shoot is actually removed.
3. A service added then removed before publishing — no line left (cancelled).
4. Quotation re-linked on Edit Sale Details after a publish — refused.
5. Old project (pre-migration) — every current row is baseline, section shows no lines.

### Task 1: Schema + migration
Files: `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261101160000_sale_extras/migration.sql`, test `backend/test/sale-extras-migration.test.js`.
Columns `sale_baseline JSON NULL` ×3 (backfilled from current scope for every row, shoot `{}`), tables `project_sale_extra` and `project_sale_extra_revision` per spec §4. Test: migration text never updates other columns; prisma models exist; a new allocation reads `saleBaseline === null`.

### Task 2: Pure rules (`backend/src/modules/sales/sale-extras/rules.js`)
`SCOPE_FIELDS`, `scopeOf(category, row)`, `sameScope(a, b)`, `signedAmount(kind, entered)`, `amountProblem(kind, amount)`, `revisionTotals(original, lines)`, `snapshotLines(lines)` (parents with `included` children, `publishedIn`). Unit tests.

### Task 3: Reconcile (`backend/src/modules/sales/sale-extras/reconcile.js`)
`reconcileSaleExtras(tx, projectId) -> { tracked, quotation }` implementing spec §5 rules 2–8 with the 60-second windows; idempotent (a second run changes nothing). Uses `autoDeliverableNamesForServices` exported from the projects controller. DB-backed tests for each rule, idempotence, untracked projects, legacy rows.

### Task 4: Booking + re-link
`createProject`: shoots with `fromQuotation: true` (honoured only with a finalized quotation and ≤ quoted shoot count) write `saleBaseline` on the shoot, its services and deliverables. Per-row creates accept `fromQuotation` (same honouring) for `writeQuotedPlanToProject`. `updateProject` refuses a quotation change when a sale-extras revision exists (409). Frontend `CreateProjectFormPanel` keeps `fromQuotation` in `shootsPayload` and `writeQuotedPlanToProject` bodies. Tests.

### Task 5: API — list, set amount, publish, unfinalize guard
`backend/src/modules/sales/sale-extras/{service.js,controller.js}`; routes on `projects/routes.js`: `GET /projects/:id/sale-extras`, `PATCH /projects/:id/sale-extras/:extraId`, `POST /projects/:id/sale-extras/publish`. Publish per spec §6 (locks, `draftIds` + `reviewed` + `expectedRevision`, every draft priced, activity log). `unfinalizeQuotation` refuses when a revision exists. Tests incl. concurrency and RBAC.

### Task 6: Money + public payload
`listProjectPayments` (adds `totalSaleExtras` into `totalExtra`/`totalSigned`), `receipt.js`, `receiptMessage.js`, client portal summary, assistant; `publicQuotation` adds `saleExtras` from the latest revision on this exact finalized version. Tests: counted once, drafts never, response unchanged without a revision.

### Task 7: Frontend helpers + services
`frontend/src/lib/saleExtras.mjs` (signed rupees, labels, totals), `frontend/src/services/sales/sale-extras.service.js`. Unit test.

### Task 8: Edit Sale Details section
`frontend/src/components/sales/SaleExtrasSection.js`; insert in `CreateProjectFormPanel` (edit mode, tracked projects) between Service Creation and Shedule Payment + section link; reload on plan change; Set amount dialog, publish confirm, revision View. Source tests for gating.

### Task 9: Client cards
`frontend/src/components/sales/QuotationPricingCards.js` (+ `quotationSheetParts.js`), `PublicQuotationPage.js` switches on `quotation.saleExtras`; existing pricing tests re-pointed.

### Task 10: Docs, full verification, review
READMEs, PROJECT-STATE, IAM note, CHANGELOG; backend + frontend suites; lint; headless E2E of the brief's 17 scenarios at 360/768/1280; reviewer agents; fix; final report.
