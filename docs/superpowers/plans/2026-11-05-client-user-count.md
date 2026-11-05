# Client User Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BeamCraft shows, per client, how many active users the client's site has against its plan ("3 of 5").

**Architecture:** The client site (Velava) pushes its active-user count to a new site-key-protected endpoint
`POST /api/client-site/usage` right after each subscription read; BeamCraft stores it on `SubscriptionClient`
and the SUBSCRIBE tables / details panel render it.

**Tech Stack:** Beam-Craft-Website: Express + Prisma (MySQL), Next frontend, `node --test`. Velava: Express 5 + Prisma 6.

**Spec:** `docs/superpowers/specs/2026-11-05-client-user-count-design.md`

## Global Constraints

- Counted: Velava `users` with `isActive: true`; the Admin login (`agency_login`) is not counted.
- Auth: same as `getSiteSubscription` - `Authorization: Bearer <site key>`, `X-Site: <subdomain>`, one `401 This site is not recognised.` (`NOT_RECOGNISED`) for unknown subdomain / no key / wrong key.
- `activeUsers` must be an integer 0-100000 (a JSON number, not a string); otherwise `400`.
- Labels, verbatim: `3 of 5`, `Within limit`, `At limit`, `Not reported yet`, column `Users`, column `User Limit`, rows `Users In Use`, `Users Reported`.
- Never commit or push: the user commits. Never open `.env` files.
- No sample/test rows in any real database.

## Review Focus

- A count above the limit (limit lowered after users were added: `7 of 5`) → `At limit`, not `Within limit`.
- A report for a client whose account is not set up yet (`activatedAt` null) → `404`, nothing stored.
- A body with extra fields (`{ activeUsers: 3, usersAllowed: 999 }`) → only `activeUsers` / `usersReportedAt` written.
- BeamCraft down or answering 500 to the usage call → Velava's `sync()` still caches the subscription and does not throw.
- `usersAllowed` null on a client (no limit) → `3`, status `Within limit`.

---

### Task 1: BeamCraft stores the reported count

**Files:**
- Modify: `backend/prisma/schema.prisma` (model `SubscriptionClient`, near `usersAllowed`)
- Create: `backend/prisma/migrations/20261105120000_client_active_users/migration.sql`
- Modify: `backend/src/modules/subscribe/client-onboarding/siteApi.js`
- Modify: `backend/src/modules/subscribe/client-onboarding/siteRoutes.js`
- Test: `backend/test/client-site-api.test.js`

**Interfaces:**
- Produces: `SubscriptionClient.activeUsers Int?` (`active_users`), `SubscriptionClient.usersReportedAt DateTime?` (`users_reported_at`, `DATETIME(3)`); `reportSiteUsage(req, res, db = prisma)` exported from `siteApi.js`; route `POST /api/client-site/usage`.

- [ ] **Step 1: Write the failing tests** in `client-site-api.test.js`, with a `fakeDb` that also records `subscriptionClient.update({ where, data })` and a `callUsage(headers, body, client)` helper mirroring `call`:
  - `usage: the right key stores the count and when` - 200, `update` called once with `where: { id: "c1" }` and `data` keys exactly `["activeUsers", "usersReportedAt"]`, `activeUsers: 3`, `usersReportedAt instanceof Date`; response `{ data: { activeUsers: 3 } }`.
  - `usage: 401 with one message` - unknown subdomain, `siteKeyHash: null`, wrong key, no key → each `401`, `body.message === NOT_RECOGNISED`, `update` never called.
  - `usage: 404 before the account is set up` - `liveClient({ activatedAt: null })` → `404`, no update.
  - `usage: 400 for a count that is not a whole number` - bodies `{ activeUsers: -1 }`, `{ activeUsers: 2.5 }`, `{ activeUsers: "3" }`, `{}`, `{ activeUsers: 100001 }`, `undefined` → `400`, no update.
  - `usage: only the count is written` - body `{ activeUsers: 3, usersAllowed: 999 }` → `data` keys exactly `["activeUsers", "usersReportedAt"]`.

- [ ] **Step 2: Run** `cd backend && node --test test/client-site-api.test.js` → FAIL (`reportSiteUsage is not a function`).

- [ ] **Step 3: Implement.** Schema: two fields after `usersAllowed`, with `///` doc comments ("the last count the client's site sent", "when it sent it"). Migration: one `ALTER TABLE \`subscription_client\` ADD COLUMN \`active_users\` INT NULL, ADD COLUMN \`users_reported_at\` DATETIME(3) NULL;` with a leading `--` comment like the existing migrations. `reportSiteUsage`: same subdomain/key/activatedAt checks as `getSiteSubscription` (extract the shared lookup into `async function authorisedClient(req, res, db)` returning the client or `null` after answering, and use it in both), validate with `z.object({ activeUsers: z.number().int().min(0).max(100000) })` on `req.body ?? {}`, `db.subscriptionClient.update({ where: { id: client.id }, data: { activeUsers, usersReportedAt: new Date() } })`, 500 → `"Unable to record usage"`. Route: `router.post("/usage", express.json({ limit: "1kb" }), (req, res) => reportSiteUsage(req, res));`.

- [ ] **Step 4: Run** `node --test test/client-site-api.test.js test/client-subscription.test.js` → all PASS, then `npx prisma validate` → "The schema ... is valid".

- [ ] **Step 5: Apply the migration locally** `npx prisma migrate deploy && npx prisma generate` → "1 migration ... applied". Leave changes uncommitted.

### Task 2: BeamCraft shows the count

**Files:**
- Modify: `frontend/src/constants/subscriptionProducts.mjs` (`clientRow`, `clientStatusStyles`, `clientTableFields`, `productTableFields`, `clientInfoSections`)
- Test: `frontend/test/subscription-clients-tabs.test.mjs`

**Interfaces:**
- Consumes: `invite.client.activeUsers`, `invite.client.usersReportedAt` (ISO string), `invite.client.usersAllowed` from Task 1 via `serializeInvite`.
- Produces: row fields `usersInUseLabel`, `userLimitStatus`, `usersReportedLabel`.

- [ ] **Step 1: Write the failing tests** - `the user count reads as "3 of 5", and the limit as a status`:
  - `clientRow({ id: "i1", state: "Submitted", client: { usersAllowed: 5, activeUsers: 3, usersReportedAt: "2026-11-05T06:30:00Z" } })` → `usersInUseLabel "3 of 5"`, `userLimitStatus "Within limit"`, `usersReportedLabel` equal to the same `checkedAt` format the health labels use (`"5 Nov, 12:00"`).
  - `activeUsers: 5` → `"5 of 5"`, `"At limit"`; `activeUsers: 7` → `"7 of 5"`, `"At limit"`.
  - `usersAllowed: null, activeUsers: 3` → `"3"`, `"Within limit"`.
  - no `activeUsers` (never reported) → `usersInUseLabel ""`, `userLimitStatus "Not reported yet"`, `usersReportedLabel ""`.
  - Update the existing field-order assertions: `clientTableFields` keys gain `"usersInUseLabel", "userLimitStatus"` right after `"usersNeeded"`; `productTableFields` gains `["usersInUseLabel", "Users"], ["userLimitStatus", "User Limit"]` right after `["status", "Status"]`; the Subscription section's keys gain `"usersInUseLabel", "usersReportedLabel"` after `"usersAllowed"`.
  - `clientStatusStyles["Within limit"] === "bg-emerald-500"`, `clientStatusStyles["At limit"] === "bg-red-500"` (`"Not reported yet"` reuses the existing `bg-slate-300` key - add it, `"Not checked yet"` stays).

- [ ] **Step 2: Run** `cd frontend && node --test test/subscription-clients-tabs.test.mjs` → FAIL.

- [ ] **Step 3: Implement** `function usageFields(client)` beside `healthFields`, spread into `clientRow`; columns `["usersInUseLabel", "Users", undefined, 120, 100]`, `["userLimitStatus", "User Limit", "status", 160, 130]`; info rows `["usersInUseLabel", "Users In Use"]`, `["usersReportedLabel", "Users Reported"]`.

- [ ] **Step 4: Run** the frontend test file → PASS; `npx eslint src/constants/subscriptionProducts.mjs` → no errors. Leave uncommitted.

### Task 3: Velava reports its count

**Files:**
- Modify: `/Users/mac/Desktop/Velavaagencciess/backend/src/subscription.js`
- Create: `/Users/mac/Desktop/Velavaagencciess/backend/test/usage.test.js`
- Modify: `/Users/mac/Desktop/Velavaagencciess/backend/package.json` (`"test": "node --test"` if no test script exists)

**Interfaces:**
- Consumes: `POST /api/client-site/usage` from Task 1.
- Produces: `reportUsage({ db = prisma, fetchImpl = fetch } = {}) -> Promise<void>`, exported; called in `sync()` after the successful `fetchRemote()` + cache write, not awaited-in-a-way-that-can-throw (`await reportUsage().catch(...)` is fine since it never throws).

- [ ] **Step 1: Write the failing tests** (set `BEAMCRAFT_API_URL="https://bc.test/"`, `BEAMCRAFT_SITE="velava"`, `BEAMCRAFT_SITE_KEY="k"` in `process.env` before requiring):
  - `reports the active users to BeamCraft with the site's key` - fake `db.user.count` returns 4 and records its args; fake fetch records `(url, init)`. Assert count called with `{ where: { isActive: true } }`, url `"https://bc.test/api/client-site/usage"`, `init.method "POST"`, headers include `Authorization: "Bearer k"`, `"X-Site": "velava"`, `"Content-Type": "application/json"`, `JSON.parse(init.body)` deep-equals `{ activeUsers: 4 }`.
  - `a failed report never throws` - fetch rejects → `await reportUsage(...)` resolves; fetch answers `{ ok: false, status: 500 }` → resolves.
  - `nothing is sent when BeamCraft is not set up` - with `BEAMCRAFT_SITE_KEY` deleted, fetch never called (restore after).

- [ ] **Step 2: Run** `cd /Users/mac/Desktop/Velavaagencciess/backend && node --test test/usage.test.js` → FAIL.

- [ ] **Step 3: Implement** `reportUsage` with `AbortSignal.timeout(TIMEOUT_MS)`, `console.error("[subscription] usage: ...")` on any failure; call it in `sync()` inside the `try` after `applyLogin(data)`.

- [ ] **Step 4: Run** `node --test test/` → PASS. Leave uncommitted.

### Task 4: End to end, locally

- [ ] **Step 1:** With both apps running and Velava's `.env` already pointing at the local BeamCraft (don't open it - check by watching Velava's log for `[subscription]` errors), wait one minute.
- [ ] **Step 2:** Open `localhost:3002` → Account Manager page → the Velava row shows `Users` = Velava's real active-user count `of` its plan, `User Limit` `Within limit`; details panel shows `Users In Use` and `Users Reported`. If Velava is not wired to the local BeamCraft, report that instead of claiming it works.
