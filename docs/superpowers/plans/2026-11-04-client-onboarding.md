# Client Onboarding (Subscribe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Onboard client companies for Beam Craft's two products (Media Studio Operations, Account Manager) through an invite link and a public form, listing them per product under SUBSCRIBE.

**Architecture:** A new backend module `backend/src/modules/subscribe/client-onboarding/` copies the shape of `hrm/onboarding-invites` (hashed token + short code, verify by email/phone, zod, rate-limited public routes) over two new Prisma models. The frontend adds one list page used by both product routes, an invite dialog, and a public form page, built from the existing DataTable / ModulePageHeader / dialog components.

**Tech Stack:** Express 5, Prisma 6 + MySQL, zod, node:test (backend); Next.js 16, React 19, Tailwind 4, node:test (frontend).

**Spec:** `docs/superpowers/specs/2026-11-04-client-onboarding-design.md`

## Global Constraints

- Work only in `/Users/mac/Desktop/Beam-Craft-Website`. Never touch `/Users/mac/Desktop/BC/DBS-Operations-OS`.
- No git commits — the user commits manually and the folder has no repo yet. "Commit" steps are replaced by "list changed files".
- No seed, mock or sample rows. Don't Blink Studioz and Velava arrive only through real invites. Tests are pure (no DB writes).
- Products: `MEDIA_STUDIO_OPERATIONS` ("Media Studio Operations", route `/subscribe/media-studio-operations`), `ACCOUNT_MANAGER` ("Account Manager", route `/subscribe/account-manager`).
- Permission: `{ module: "SUBSCRIBE", feature: "Client Onboarding" }`.
- Public link: `{FRONTEND_URL}/client-onboarding/apply/{shortCode}`.
- Every form field is mandatory. GST: 15 chars matching `/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/`. PAN: `/^[A-Z]{5}[0-9]{4}[A-Z]$/`. Both upper-cased and trimmed first.
- Logo: PNG, ≤5 MB. Favicon: PNG or SVG, ≤1 MB. Stored with `storeFavicon` in folders `beamcraft/client-onboarding/logo` and `beamcraft/client-onboarding/favicon`.
- Default invite expiry: 7 days from today, end of day.
- UI copy uses "Client Onboarding", never "Employee".

## Review Focus

- A link opened after its expiry date, or after being cancelled, must show a clear message and refuse submit — tested in Task 3 (`inviteState`) and Task 4 (submit guard).
- A second submit on an already-submitted link must be refused, not create a second company — Task 4 test `submit refuses an invite already Submitted`.
- Phone typed with spaces, dashes or +91 must still verify — Task 3 reuses `phonesMatch`; test `verify accepts the phone in another format`.
- Lower-case or space-padded GST/PAN must be accepted after normalising — Task 3 test `gst and pan are normalised before checking`.
- A JPG renamed as logo, or a favicon over 1 MB, must be refused with a field message, not a 500 — Task 3 test `logo must be png and favicon png or svg within size`.

---

### Task 1: Permission, menu and cleanup

**Files:**
- Modify: `backend/prisma/seeds/permission-catalogue.js` (add entry after the ACCOUNTS module block, ~line 450)
- Modify: `frontend/src/constants/modulePermissions.js` (route map near line 172, `MODULE_LABELS` ~line 205)
- Modify: `frontend/src/components/accounts/AccountsManagerPage.js` (revert the `title` prop added earlier)
- Delete: `frontend/src/app/(app)/subscribe/account-manager/page.js` (rewritten in Task 6), `frontend/src/app/(app)/subscribe/media-studio-operations/page.js` (rewritten in Task 6)
- Test: `backend/test/subscribe-permission.test.js`

**Interfaces:**
- Produces: permission row `SUBSCRIBE / Client Onboarding` (level `CLIENT_ONBOARD`, displayName "Onboard Subscription Clients"); route entries `["/subscribe/media-studio-operations", { module: "SUBSCRIBE", feature: "Client Onboarding" }]` and the same for `/subscribe/account-manager`; `MODULE_LABELS.SUBSCRIBE = "Subscribe"`.

- [ ] **Step 1: Write the failing test** — `subscribe-permission.test.js` requires the catalogue and asserts an entry with `module === "SUBSCRIBE" && feature === "Client Onboarding"` exists.
- [ ] **Step 2: Run** `cd backend && node --test test/subscribe-permission.test.js` → FAIL.
- [ ] **Step 3: Add the catalogue entry; replace the `/subscribe/account-manager` → ACCOUNTS mapping with the two SUBSCRIBE mappings; add the label; remove the `title` prop (back to `title="Accounts Manager"`); delete the two placeholder pages.**
- [ ] **Step 4: Run** the test → PASS. Run `node -r dotenv/config prisma/seeds/iam-roles-permissions.js` → output includes the new permission granted to SUPER_ADMIN.
- [ ] **Step 5: List changed files.**

### Task 2: Data model

**Files:**
- Modify: `backend/prisma/schema.prisma` (append two models)
- Create: `backend/prisma/migrations/20261104120000_client_onboarding/migration.sql` (generated)

**Interfaces:**
- Produces: Prisma models `ClientOnboardingInvite` (`@@map("client_onboarding_invite")`) and `SubscriptionClient` (`@@map("subscription_client")`), columns exactly as spec §4, camelCase fields with `@map` snake_case. `product` is `String @db.VarChar(40)`; `status` `String @default("Created") @db.VarChar(20)`; `SubscriptionClient.inviteId` `@unique`; `ClientOnboardingInvite.clientId` optional; index `@@index([product, status])` on the invite.

- [ ] **Step 1: Add both models.**
- [ ] **Step 2: Run** `npx prisma migrate dev --name client_onboarding --create-only`, rename the folder to the timestamp above if needed, then `npx prisma migrate deploy` → "All migrations have been successfully applied."
- [ ] **Step 3: Run** `npx prisma validate` → valid.
- [ ] **Step 4: List changed files.**

### Task 3: Pure rules (products, state, validation)

**Files:**
- Create: `backend/src/modules/subscribe/client-onboarding/rules.js`
- Test: `backend/test/client-onboarding-rules.test.js`

**Interfaces:**
- Produces:
  - `PRODUCTS: { MEDIA_STUDIO_OPERATIONS: "Media Studio Operations", ACCOUNT_MANAGER: "Account Manager" }`
  - `isProduct(value: string): boolean`
  - `inviteState(invite, now = new Date()): "Pending" | "Submitted" | "Expired" | "Cancelled"` — Submitted if `submittedAt`; Cancelled if `cancelledAt`; Expired if `expiresAt < now`; else Pending.
  - `inviteSchema` (zod): `{ product, contactName (1–150), contactEmail (email ≤191), contactPhone (8–30), expiresAt (date string, today or later) }`
  - `submissionSchema` (zod): every spec §3 field, GST/PAN transformed with trim+upper then regex-checked, `usersNeeded` int ≥1, `logo` and `favicon` data-URI strings.
  - `checkUpload(dataUri, { types: string[], maxBytes: number }): string | null` — returns an error message or null.
  - Re-export `phonesMatch` from `../../hrm/onboarding-invites/controller`.

- [ ] **Step 1: Write failing tests:**
  - `inviteState` → each of the four states, including `expiresAt` one second in the past = "Expired".
  - `gst and pan are normalised before checking` → `" 33abcde1234f1z5 "` parses to `"33ABCDE1234F1Z5"`; `"abcde1234f"` → `"ABCDE1234F"`; `"ABCDE1234"` fails.
  - `every field is mandatory` → removing any one key from a valid submission fails.
  - `usersNeeded must be a whole number of at least 1` → 0 and 2.5 fail, "12" coerces to 12.
  - `logo must be png and favicon png or svg within size` → JPEG data URI as logo returns a message; 1.2 MB PNG favicon returns a message; small PNG returns null.
  - `verify accepts the phone in another format` → `phonesMatch("+91 98765-43456", "9876543456") === true`.
- [ ] **Step 2: Run** `node --test test/client-onboarding-rules.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement `rules.js`.** Byte size of a data URI = base64 length × 3/4 minus padding.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: List changed files.**

### Task 4: Backend controller and routes

**Files:**
- Create: `backend/src/modules/subscribe/client-onboarding/controller.js`
- Create: `backend/src/modules/subscribe/client-onboarding/routes.js` (team)
- Create: `backend/src/modules/subscribe/client-onboarding/publicRoutes.js`
- Modify: `backend/src/server.js` (mount next to line 275)
- Modify: `backend/src/services/emailTemplates.js`, `backend/src/services/emailService.js` (add `sendClientOnboardingInviteEmail`)
- Test: `backend/test/client-onboarding-controller.test.js`

**Interfaces:**
- Consumes: Task 3 exports; `generateShortCode`, `SHORT_CODE_PATTERN` (`services/shortCode`); `storeFavicon`, `discardUploads` (`services/imageStorage`); `protect`, `checkPermission`; `createRateLimiter`, `clientIp`.
- Produces (HTTP, JSON `{ data }` like the HRM invites):
  - Team, `/api/subscribe/client-onboarding`, `protect` + `checkPermission("SUBSCRIBE", "Client Onboarding", "READ")` for GET, `"READ_WRITE"` otherwise:
    - `GET /invites?product=ACCOUNT_MANAGER` → rows `{ id, product, contactName, contactEmail, contactPhone, state, expiresAt, createdAt, submittedAt, client: SubscriptionClient | null, link }`
    - `POST /invites` body `inviteSchema` → `{ data: { invite, link, message } }` (message = spec §2 text)
    - `POST /invites/:id/send-email` → sends `sendClientOnboardingInviteEmail`; mail failure → 502 with `describeMailFailure` text
    - `PATCH /invites/:id/cancel` → only while Pending
  - Public, `/api/client-onboarding`, rate limit `client-onboarding:${ip}` 60/15 min, `Cache-Control: no-store`:
    - `GET /invites/:token` → `{ product, productLabel, contactName, maskedEmail, maskedPhone, expiresAt, state }`
    - `POST /invites/:token/verify` body `{ identifier }` → 200 when it matches email (case-insensitive) or phone (`phonesMatch`), sets `verifiedAt`; else 403
    - `POST /invites/:token/submit` body `submissionSchema` → stores logo/favicon, creates `SubscriptionClient` and marks invite Submitted in one transaction; on failure discards uploads.
  - Token lookup: 8-char value matching `SHORT_CODE_PATTERN` → by `shortCode`, otherwise by `tokenHash`.
- Exports for tests: `buildInviteMessage({ contactName, productLabel, link, expiresAt }): string`, `assertSubmittable(invite, now): void` (throws `{ status: 410 }` for Expired/Cancelled, 409 for Submitted, 403 when not verified).

- [ ] **Step 1: Write failing tests** for the two exported helpers:
  - `buildInviteMessage` output equals the spec §2 text with values filled (expiry formatted `11 Nov 2026, 23:59`).
  - `submit refuses an invite already Submitted` → status 409; Expired → 410; Cancelled → 410; not verified → 403; verified Pending → no throw.
- [ ] **Step 2: Run** `node --test test/client-onboarding-controller.test.js` → FAIL.
- [ ] **Step 3: Implement controller, both routers, the email template (subject "Your Beam Craft onboarding link — {product}"), and mount in `server.js`.**
- [ ] **Step 4: Run** the test → PASS; run the whole suite `npm test` → no new failures versus before.
- [ ] **Step 5: Run** the backend and `curl -s localhost:5101/api/client-onboarding/invites/XXXXXXXX` → 404 JSON (route mounted, unknown code).
- [ ] **Step 6: List changed files.**

### Task 5: R2 storage keys

**Files:**
- Modify: `backend/.env` (gitignored)

- [ ] **Step 1: Copy every `R2_*` line from `/Users/mac/Desktop/BC/DBS-Operations-OS/backend/.env` into the website `backend/.env`, replacing existing `R2_*` lines, without printing values.**
- [ ] **Step 2: Verify** `node -e 'require("dotenv").config({quiet:true});console.log(require("./src/config/r2").isConfigured)'` → `true`.

### Task 6: Clients list page

**Files:**
- Create: `frontend/src/services/subscribe/client-onboarding.service.js`
- Create: `frontend/src/constants/subscriptionProducts.mjs`
- Create: `frontend/src/components/subscribe/SubscriptionClientsPage.js`
- Create: `frontend/src/components/subscribe/ClientDetailsPanel.js`
- Create: `frontend/src/app/(app)/subscribe/media-studio-operations/page.js`, `frontend/src/app/(app)/subscribe/account-manager/page.js`
- Test: `frontend/test/subscription-clients-tabs.test.mjs`

**Interfaces:**
- Consumes: Task 4 team endpoints.
- Produces:
  - Service: `listClientInvites(product)`, `createClientInvite(body)`, `sendClientInviteEmail(id)`, `cancelClientInvite(id)` via `apiRequest`.
  - `subscriptionProducts.mjs`: `PRODUCTS` (same keys/labels as backend), `CLIENT_TABS = ["All", "Form Pending", "Submitted", "Expired/Cancelled"]`, `inTab(row, tab): boolean` mapping Pending→"Form Pending", Submitted→"Submitted", Expired|Cancelled→"Expired/Cancelled".
  - `SubscriptionClientsPage({ product })`: `ModulePageHeader` (title = product label, tabs with counts, action **Create Onboarding Invite**), `DataTable` with spec §1 columns, footer like Employee Repository; double-click / View on a Submitted row opens `ClientDetailsPanel({ row, onClose })` showing every field plus logo and favicon images; row menu: Copy message, Send Invite, Cancel invite (Pending only).

- [ ] **Step 1: Write failing test** — `inTab` places a row of each state in exactly "All" plus its own tab; `CLIENT_TABS` equals the list above.
- [ ] **Step 2: Run** `cd frontend && node --test test/subscription-clients-tabs.test.mjs` → FAIL.
- [ ] **Step 3: Implement the constants, service, page, panel and both routes** (`<SubscriptionClientsPage product="MEDIA_STUDIO_OPERATIONS" />` / `"ACCOUNT_MANAGER"`). Empty state: "No clients yet. Send an onboarding invite to add one."
- [ ] **Step 4: Run** the test → PASS; `npx eslint src/components/subscribe src/services/subscribe src/constants/subscriptionProducts.mjs "src/app/(app)/subscribe"` → clean.
- [ ] **Step 5: List changed files.**

### Task 7: Create Onboarding Invite dialog

**Files:**
- Create: `frontend/src/components/subscribe/ClientInviteDialog.js`
- Modify: `frontend/src/components/subscribe/SubscriptionClientsPage.js` (open it; reload list on create/send/cancel)

**Interfaces:**
- Consumes: Task 6 service functions.
- Produces: `ClientInviteDialog({ product, onClose, onInviteCreated })` — form step (Contact Person Name, Contact Email, Contact Phone with +91 picker as in `OnboardingInviteDialog`, Expiry Date default +7 days; all required with field errors), then the **Onboarding Invite Created** step showing the returned `message` in a read-only textarea with **Copy message**, **Close**, **Send Invite**. Send failure shows the backend message in the dialog's notice.

- [ ] **Step 1: Implement**, reusing the field components `OnboardingInviteDialog` uses (read its imports).
- [ ] **Step 2: Lint** the two files → clean.
- [ ] **Step 3: Manual check** on the running frontend: open Account Manager → Create Onboarding Invite with real contact details → message box appears with `/client-onboarding/apply/<8 chars>`; row appears under Form Pending.
- [ ] **Step 4: List changed files.**

### Task 8: Public client form

**Files:**
- Create: `frontend/src/services/subscribe/public-client-onboarding.service.js`
- Create: `frontend/src/components/subscribe/PublicClientOnboardingForm.js`
- Create: `frontend/src/app/client-onboarding/apply/[token]/page.js`
- Modify: the public-path allow-list the app uses for `/onboarding/apply` (find with `grep -rn "onboarding/apply" frontend/src/proxy.js frontend/src/lib`) to also allow `/client-onboarding/apply`.

**Interfaces:**
- Consumes: Task 4 public endpoints.
- Produces: `PublicClientOnboardingForm({ token })` laid out like `PublicOnboardingForm`: Beam Craft logo, "Client Onboarding", "Complete your company's onboarding details for {productLabel}.", invite summary, verify step, then sections Company / Main Contact / Secondary Contact with the spec §3 fields, logo and favicon pickers that read files as data URIs and pre-check type/size, submit, thank-you state; Expired / Cancelled / Submitted states show their own message instead of the form.

- [ ] **Step 1: Implement service, component, route and allow-list entry.**
- [ ] **Step 2: Lint** → clean.
- [ ] **Step 3: Manual end-to-end** with the invite from Task 7: open the link in a private window, verify with the phone, fill real company details, submit → thank-you; the company shows under **Submitted** on Account Manager, the details panel shows logo and favicon; opening the link again shows "already submitted".
- [ ] **Step 4: List changed files.**
