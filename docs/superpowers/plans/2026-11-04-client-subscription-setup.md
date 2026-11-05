# Client Subscription Setup (Part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Set up a submitted client's account in Beam Craft: product, subdomain, users, Admin login, validity, modules.

**Architecture:** New columns on `subscription_client`; pure rules in `client-onboarding/subscription.js`; one `PUT /invites/:id/subscription` endpoint; a `SubscriptionDialog` opened from the Client Details row menu; status/tabs extended in `subscriptionProducts.mjs`.

**Tech Stack:** Express 5, Prisma 6 + MySQL, zod, bcryptjs, node:test; Next.js 16, React 19.

**Spec:** `docs/superpowers/specs/2026-11-04-client-subscription-setup-design.md`

## Global Constraints

- Only `/Users/mac/Desktop/Beam-Craft-Website`. No commits. No test rows in the DB; tests are pure. Restart the backend after `prisma generate`.
- Subdomain `/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/`, unique. Username `/^[A-Za-z0-9._-]{3,60}$/`. Users ≥ 1 integer. Valid Until ≥ Valid From. Modules non-empty, each in the product's list.
- Password: 12 chars from `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789`, `crypto.randomInt`; bcrypt cost 10; hash never leaves the server.
- Module lists and message text exactly as the spec.

## Review Focus

- Saving twice without Reset password must not change or reveal the password — Task 2 test.
- A subdomain already used by another client is refused with a clear message, not a 500 — Task 2 maps P2002 on `subdomain` to 409.
- Setting up a row that is not submitted is refused — Task 2 test via `assertCanSetUp`.
- Valid Until before Valid From is refused — Task 1 test.
- A module from the other product is refused — Task 1 test.

---

### Task 1: Rules (`backend/src/modules/subscribe/client-onboarding/subscription.js`)

**Produces:** `MODULES_BY_PRODUCT`, `subscriptionSchema` (zod; `.superRefine` for dates and product modules), `generatePassword(length = 12): string`, `subscriptionStatus(client, now): "Active" | "Expired" | null`, `accountMessage({ contactName, subdomain, adminUsername, password, validUntil }): string`.

- [ ] Test `backend/test/client-subscription.test.js`: schema accepts a valid body; refuses bad subdomain, bad username, users 0, Until < From, empty modules, foreign module; password length 12 and alphabet; status Active on the last day, Expired the day after, null when not set up; message text equals the spec.
- [ ] Run → FAIL; implement; run → PASS.

### Task 2: Data + endpoint

**Files:** `backend/prisma/schema.prisma`, migration `20261104190000_client_subscription`, `controller.js` (`assertCanSetUp(invite)`, `saveSubscription`), `routes.js` (`PUT /invites/:id/subscription`), `serializeInvite` strips `adminPasswordHash` from `client`.

- [ ] Test: `assertCanSetUp` refuses an invite without a client (400) and passes one with a client; `passwordChange({ firstTime, resetPassword })` → generate on first save or reset only.
- [ ] Migrate, generate, restart backend; run targeted tests → PASS.

### Task 3: Frontend

**Files:** `constants/subscriptionProducts.mjs` (status + tabs + `MODULES_BY_PRODUCT` mirror), `services/subscribe/client-onboarding.service.js` (`saveSubscription`), `components/subscribe/SubscriptionDialog.js`, `SubscriptionClientsPage.js` (row menu: Set up account / Edit subscription).

- [ ] Test `frontend/test/subscription-clients-tabs.test.mjs`: tabs list; Active/Expired rows sit in their tabs; Submitted-not-set-up stays in Submitted.
- [ ] Implement; eslint clean; all frontend tests pass; pages load 200.
