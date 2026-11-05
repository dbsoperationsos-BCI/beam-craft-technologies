# Sale Extras (Edit Sale Details) — Design Specification

Status: **Draft for owner review** · 2026-11-01 · branch `feature/sale-extras` (from `develop`, owner 2026-11-02) · no code written.

## 1. Goal

After a project is booked on a finalized quotation, every shoot, service or deliverable **added**,
**removed** or **modified** (scope edit) is recorded automatically as an Extra draft. The owner types
each price. The drafts and totals show in **EXTRA – ADDITIONAL & REMOVED ITEMS**, a new section of Edit
Sale Details placed immediately above Shedule Payment. **Publish Updated Quotation** freezes a revision
that the existing client quotation link shows as the original card, an unpriced Extra section, and the
Updated Total.

## 2. Owner decisions

| # | Decision |
|---|---|
| D1 | Recorded on **every screen** that changes a shoot / service / deliverable (Edit Sale Details, Edit / Start Project, Pre Production import, client portal) - at the server, in the same transaction as the change. |
| D2 | **Every item its own amount** (owner, 2026-11-02 - replaces "one amount per shoot"). A new shoot, each of its services and deliverables, and everything removed with a shoot are separate lines, each priced on its own (₹0 allowed). Lines published earlier as *included* stay as published. |
| D3 | Published Net Extra **counts toward outstanding, receipts, Total Signed and the client portal**, exactly once. Drafts never. Nothing is marked paid. Shedule Payment is untouched. |
| D4 | Amounts are **pre-GST** like the original; the client cards use the original quotation's "+ X% GST applicable" line. GST is never added into a total. |
| D5 | The existing **Extra Quotations** (EXT-, Payments tab, manager approval) stay **separate and unchanged**; not shown in this section or on the client cards. |
| D6 | Rows added **at booking** beyond the quotation are extras. The baseline is exactly what the finalized quotation contained. |
| D7 | **Modified** is tracked for scope edits only - service: quantity, session timing / duration / work days, size; deliverable: quantity, variant (brand, size, frame, video length, size option), number of photos. Shoot date / time / venue edits are **not** extras. Repeated edits to one item stay one Modified draft. |
| D8 | Who enters amounts and publishes: **whoever can edit the sale** - the same guard as saving Edit Sale Details. No new permission. |
| D9 | Projects with **no finalized quotation** are **not tracked**: no section, nothing recorded, unchanged behaviour. |

## 3. Audit findings this design rests on

- **Edit Sale Details** = `CreateProjectFormPanel` in edit mode, opened from Sales Manager and Projects.
  Sections: Project Details, Sales Remarks, Service Creation, Shedule Payment, Client Credentials.
- Service Creation writes **each row immediately** through per-row routes (`useProjectPlan`);
  "Update Project" saves only sale fields. Rows keep stable ids; deletes are soft.
- **No row records whether it came from the quotation**; quotation line ids are not kept.
- Other writers: Edit / Start Project (same per-row routes, plus `saveStartProjectWork` which can
  recreate services), `replaceProductionDeliverables`/`syncProjectShootDeliverables`, the auto
  deliverables a service brings (`autoDeliverablesByService`), Pre Production import (retire / restore
  shoots), client portal pre-production.
- Removing a shoot already hard-cleans its Image Selection folders (409 if submitted selections),
  soft-deletes its services / deliverables / workflow, hides its Pre Production and Production rows and
  flags shoot-linked scheduled payments. **This feature changes none of that** - it only records.
- Shedule Payment stores percentages; amounts = Initial Converted Value × %. Untouched.
- GST is only stated. The client page's dark pricing card is `PublicQuotationPage.js`; the PDF prints that page.

## 4. Data model (one additive migration, rehearsed on a copy of the database)

### 4.1 Baseline marker and snapshot
`sale_baseline JSON NULL` on `project_shoot`, `project_post_production_allocation`,
`project_shoot_deliverable`: NULL = not baseline (an extra); non-null = baseline, holding the row's
original scope fields (D7) for Modified comparison. The migration fills it for **every existing row**
(existing projects' current scope becomes their baseline; no history is invented). New rows default NULL.
`createProject` fills it on rows the booking marked as coming from the quotation (§5.1).

### 4.2 `project_sale_extra` - one recorded change
| Column | Notes |
|---|---|
| `id`, `code` | SXT-000001 from the app counter |
| `project_id` | FK sales_project, Cascade (permanent purge only) |
| `kind` | ADDED / REMOVED / MODIFIED |
| `category` | SHOOT / SERVICE / DELIVERABLE |
| `shoot_id`, `service_allocation_id`, `deliverable_allocation_id` | FKs to the row, SetNull, indexed |
| `parent_extra_id` | self FK, SetNull - set on an *included* line (D2, and auto deliverables a service brought) |
| `item_name`, `shoot_name` | copies of the names at the moment of the change, so a removed item still reads |
| `details` | JSON - for MODIFIED `{ before, after }` of the scope fields; for REMOVED the row as it was |
| `amount` | Decimal(12,2) NULL until entered; never set on an included line |
| `remarks` | internal, optional |
| `status` | DRAFT / PUBLISHED / CANCELLED |
| `published_revision_id` | FK to the revision that first published it, SetNull |
| `created_by`, `created_at`, `updated_at` | |

### 4.3 `project_sale_extra_revision` - immutable
`project_id`, `sales_quotation_id` (FK Restrict), `revision_number` (unique per project),
`original_amount`, `net_adjustment`, `updated_total`, `gst_percent`, `lines` JSON (every PUBLISHED line,
included children under their parent, each with `publishedIn`), `published_by_id`, `published_by_name`,
`published_at`. Never updated or deleted by code.

## 5. Recording (server, `backend/src/services/saleExtras.js`)

**How (implementation ruling):** rather than hooking each of the ~15 write paths (and every future one),
the baseline rows keep a snapshot of their original scope (`sale_baseline` JSON, §4.1), and one
`reconcileSaleExtras(projectId)` compares the project's current rows with it under a lock on the project
row, creating / updating / cancelling DRAFT lines. It runs whenever the Extra section is read and inside
publish, so a change made on any screen (D1) is captured; a line's date is the change's own time (the
row's created / deleted / updated time). The only existing write path touched is booking (rule 1).

Tracked only when the project's `quotationId` names a version **finalized now** (D9). Rules:

1. **Booking.** `createProject` receives `fromQuotation` per shoot / service / deliverable (the form
   already knows it; today it strips it). Flagged rows are written with their `sale_baseline` snapshot, the rest
   are recorded ADDED (D6). A flag is honoured only when a quotation is linked and the row matches a line
   of that quotation's payload (definition id for services / deliverables, shoot count ≤ quoted shoots).
2. **Add shoot** (not baseline) → ADDED SHOOT. Services / deliverables later created **on a non-baseline
   shoot** → ADDED child lines, `parent_extra_id` = that shoot's line, no amount.
3. **Add service / deliverable on a baseline shoot** → its own ADDED line. Deliverables the service
   auto-brings (`autoDeliverablesByService` sync) → child lines of that service line.
4. **Remove a baseline shoot** → REMOVED SHOOT; its baseline services / deliverables removed with it →
   child lines. **Remove a baseline service / deliverable** on its own → its own REMOVED line (auto
   deliverables it takes away → children).
5. **Remove an extra item**: its ADDED line still DRAFT → that draft becomes CANCELLED (children too);
   already PUBLISHED → a REMOVED line is recorded for you to price (typically the reverse).
6. **Modified** (D7): a scope-field change on a baseline service / deliverable opens one MODIFIED draft
   per item (`details.before` kept from the first edit, `after` updated each time); changing it back to
   the original values cancels that draft. After it is published, a further edit opens a new draft.
   Edits to an extra item update its own line's details - no new line.
7. **Restore** (Pre Production import restoring a retired shoot): an open REMOVED draft is cancelled;
   otherwise ADDED.
8. **Recreate paths** (`saveStartProjectWork` productionServices, `syncProjectShootDeliverables`):
   diffed by shoot + definition / name; an unchanged item (same shoot and definition, replaced in the same operation) has its baseline moved to the new row and
   records nothing, so a re-save never creates noise.
Recording never blocks or alters the operational write; if it fails the transaction fails as one.

## 6. Amounts and publishing

- Amounts are typed in the section's boxes and travel with publish (owner, 2026-11-02: no separate
  save). ADDED ≥ 0 (the form takes a positive figure), REMOVED ≤ 0 (a positive reduction is stored
  negative), MODIFIED either sign. `|amount| ≤ 999,999,999`. A published line's edited amount becomes a
  CORRECTION line for the difference.
- `GET /api/sales/projects/:id/sale-extras` - lines (with children), draft total, published Net Extra,
  original amount (the finalized quotation's `amount`), Updated Total, revisions, `canPublishReason`.
- `POST /api/sales/projects/:id/sale-extras/publish { draftIds, reviewed, expectedRevision, lines, published }` - one
  transaction locking the project then the quotation row; 409 when drafts / their `updatedAt` / the
  latest revision differ from what was reviewed; 400 when a priced draft is missing its amount (₹0 must
  be typed) or there is nothing new; unique revision number as the last guard. Writes the revision,
  flips drafts to PUBLISHED, logs `SALE_EXTRAS_PUBLISHED` to project activity. **No notification.**
- Guard (D8): reading as whoever may open Edit Sale Details; amount and publish under the same guard
  that saves Edit Sale Details (`PATCH /projects/:id`), with project reach at the write level.
- A quotation with a published revision cannot be unfinalized (409); without one, unchanged.

## 7. Money (D3)
`listProjectPayments` (Total Signed), `receipt.js` balance due, `receiptMessage.js` outstanding,
client portal summary and chat assistant add the sum of PUBLISHED, non-included `project_sale_extra`
amounts beside approved Extra Quotations. Rows are summed, never revisions - each line once. Shedule
Payment percentages, amounts, dates, receipts, cash entries and payments are not written.

## 8. UI

### 8.1 Edit Sale Details - `SaleExtrasSection` (new, `frontend/src/components/sales/`)
Inserted between Service Creation and Shedule Payment in `CreateProjectFormPanel` (edit mode only, and
only for a tracked project), with its entry in the section links. Reloads after every Service Creation
change. Contents:
- Table (`SimpleTable`): Item · Category · Change (Added / Removed / Modified) · Shoot · Amount (signed) ·
  Remarks · Created · Status. Included lines indented under their parent, "included in shoot".
- Row action **Set amount** → `Dialog` with `TextField` amount (+ remarks), drafts only, writers only.
- Totals: Original Finalized Amount · Draft Extra · Net Extra (published) · Updated Total.
- **Publish Updated Quotation** → `ConfirmDialog` listing the drafts and totals, `useSubmitOnce`.
- Revision history with **View** (frozen lines).
- Read-only viewers see everything; amount and publish controls are absent.
Service Creation and Shedule Payment are not changed.

### 8.2 Client quotation (`PublicQuotationPage.js`, so also the PDF)
With a published revision on this exact finalized version: the existing pricing card, unchanged; an
**Extra** section with **Added Items** and **Removed Items** (Item, Category, Related Shoot, Created
Date = when the change happened; every published line once, corrections excluded, a modified line
under Added with what changed; a group with nothing is not drawn) and no prices; then **Updated Total
Amount** - the total, the GST line under the same General Settings switch as the original card, and
"Updated <published date>", with no revision number or net. The Event cards are not changed. Read only
from the latest revision's snapshot. No revision → the page is as today. Same link, expiry and rules.

## 9. Tests
Backend (DB-backed, prefixed fixtures): every rule in §5 including booking flags, children, auto
deliverables, cancel-on-remove, modified + revert, restore, recreate-no-noise, untracked projects
record nothing, legacy rows are baseline; amount signs and guards; publish (stale, double, concurrent,
missing amount); public payload (drafts hidden, unchanged without a revision); money counted once;
schedule, receipts and the quotation row unchanged; unfinalize guard. Frontend: lint, unit tests for the
helpers, source tests for gating. Headless E2E of the brief's 17 scenarios at 360 / 768 / 1280.
Migration rehearsed on a copy of the dev database. Reviewer agents at the end (owner rule).

## 10. Docs
backend/frontend README rows, PROJECT-STATE section, IAM note (no new permission), CHANGELOG entry
(migration, behaviour, not deployed).

## 11. Out of scope
Production / pre-production / image-selection behaviour on removal (unchanged, only recorded); the
existing Extra Quotations; GST or schedule recalculation; notifications; deployment.
