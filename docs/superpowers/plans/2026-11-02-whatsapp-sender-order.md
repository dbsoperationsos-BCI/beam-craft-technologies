# WhatsApp Sender Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every automatic WhatsApp message gets an ordered, rearrangeable list of sender numbers (primary first, then fallbacks) and a mode — **Same number** or **Take turns** — and nothing outside that list is ever tried.

**Architecture:** One new pair of tables holds a sender list and mode per automatic message. One backend module, `senderPolicy.js`, reads and saves it, works out the order for a send (rotated in Take turns mode) and runs the try-each-sender loop. Every automatic sender that today calls `reportGroup.sendOrder` or holds its own single sender column calls `senderPolicy.js` instead. On the frontend, one reusable `SenderOrderField` replaces the "Priority 1" dropdowns in the three panels that set senders.

**Tech Stack:** Express + Prisma/MySQL (hand-written migration, `migrate deploy`), `node --test`; Next.js 16 client components, existing `SortableList`, `Dropdown`, `RadioGroupField`, `IconButton`.

**Spec:** this conversation (2026-11-02), summarised:
- Every automatic WhatsApp message has a primary number plus fallbacks, in an order the studio can rearrange.
- Each message has a mode: send from the same number every time, or take turns across the list.
- **If every number in the list fails, the message fails with the reasons. No other employee is tried.** This removes today's behaviour of trying every Allow-WhatsApp employee alphabetically.
- **New Lead Welcome stays as it is**: it always sends from the lead's owner and is untouched.
- **Only automatic messages** change. Manual sends (CRM chat, invites, credentials, shares) are untouched.

## Global Constraints

- Messages in scope, each keyed by a `messageKey`: `ATTENDANCE_REPORT`, `WISHES`, `PHOTO_SELECTION_SUBMITTED`, `SHOOT_CREW_NOTICE`, `PAYMENT_REMINDER` (covers both `PAYMENT_DUE_REMINDER` and `CASH_RECEIPT_INVOICE`, which share one sender setting today), `INTERVIEW_WELCOME`.
- Out of scope: `CRM_LEAD_WELCOME` (`newLeadWelcome.js`), every `mode: "MANUAL"` send, and the Meta Cloud API provider.
- Modes: `SAME` (labelled "Same number") and `ROTATE` (labelled "Take turns"). Default `SAME`.
- At most **10** senders per message. A sender must match `reportGroup.ELIGIBLE_SENDER` (active employee, Allow WhatsApp ticked) at save time **and** at send time.
- Both modes fall back **only within the list**. An empty list means nothing is sent, and the failure says "No sender is chosen…".
- Keep the "maybe sent" rule: when `reportGroup.certainlyNotSent(error)` is false, stop and do not try the next sender.
- No new permissions. Each message keeps the guard its existing `PUT …/senders` route already has (`SETTINGS:Automatic WhatsApp Message`, `Shoot Crew Notice`, `Payment Reminder`, `Wishes`, and the attendance report-group guard).
- DB: `snake_case` names, `@map`/`@@map`, index names ≤ 64 characters. Hand-written migration applied with `migrate deploy` (never `migrate dev`). Rehearse it on a copy of the dev DB.
- Owner rules: no `git commit` (leave everything uncommitted). Write the tests, but run tests and reviewer agents only when the owner says all changes are done. Icons only from `@mui/icons-material`.
- Repo files are LF. Do not script edits through Python that writes CRLF.

## Review Focus

1. **A sender removed from Allow WhatsApp after being saved** must be skipped at send time with a reason, and must not crash the order. Covered by the test in Task 2.
2. **Take turns when the last sender is no longer in the list** (removed, or the list reordered) must restart from position 1, not throw or skip everyone. Covered by the `rotateOrder` test in Task 2.
3. **Take turns when the next sender can't send** must move on to the following one and record *that* sender as last, so the turn after doesn't repeat them. Covered by the test in Task 2.
4. **Two API processes sending at once in Take turns mode** may both pick the same number. This is accepted: it is not a double send, only an uneven turn. `markSent` must not throw on this. Covered by the test in Task 2.
5. **Payment reminder in Take turns mode across a batch of 5**: each reminder goes from the next number, and each number's groups are fetched at most once per run. Covered by the test in Task 4.

---

### Task 1: Schema and migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (new models; remove the replaced sender columns and their `User` back-relations from `HrmSettings` ~L1153–1189, `PaymentReminderSettings` ~L7091, `ShootCrewNoticeSettings` ~L10953–10964)
- Create: `backend/prisma/migrations/20261102120000_whatsapp_sender_policy/migration.sql`

**Interfaces:**
- Produces: Prisma models `WhatsAppSenderPolicy` (`messageKey String @id @db.VarChar(40)`, `mode WhatsAppSenderMode @default(SAME)`, `lastSenderUserId Int?` → `User` with `onDelete: SetNull`, `updatedAt`), `WhatsAppSenderPolicyMember` (`id`, `messageKey` → policy with `onDelete: Cascade`, `userId` → `User` with `onDelete: Cascade`, `position Int`, `@@unique([messageKey, userId])`, `@@index([userId])`), and enum `WhatsAppSenderMode { SAME ROTATE }`. Tables are `whatsapp_sender_policy` and `whatsapp_sender_policy_member`.

- [ ] **Step 1:** Add the two models and the enum, with `///` doc comments in the file's style. Remove `attendanceReportSenderUserId`, `attendanceReportSender2UserId`, `attendanceReportSender3UserId`, `wishesSenderUserId`, `photoSelectionSenderUserId`, `interviewWelcomeSenderUserId`, `paymentReminderSenderUserId`, `senderOneUserId` and `senderTwoUserId`, with their relations and indexes. Keep every `…LastSentByUserId` column.
- [ ] **Step 2:** Write `migration.sql` in this order: CREATE both tables, with FKs and indexes. Then backfill with `INSERT … SELECT … WHERE col IS NOT NULL` into `whatsapp_sender_policy`, mode `SAME`, one row per message whose column is set, and into the member table, position 1 (plus shoot crew `sender_two_user_id` as position 2 when it is set and different). Then drop the old FKs, indexes and columns. Look up the real FK and index names with `SHOW CREATE TABLE` on the dev DB first; don't guess them.
- [ ] **Step 3:** Rehearse it. Dump the dev DB to a copy, run `npx prisma migrate deploy` against the copy, and check that `SELECT * FROM whatsapp_sender_policy_member` holds one row per sender set before. Then deploy to dev and run `npm run prisma:generate` (never plain `npx prisma generate`; see the memory note).

### Task 2: `senderPolicy.js`, the shared core

**Files:**
- Create: `backend/src/modules/settings/automatic-whatsapp/senderPolicy.js`
- Test: `backend/test/whatsapp-sender-policy.test.js`

**Interfaces:**
- Consumes: `reportGroup.ELIGIBLE_SENDER`, `reportGroup.senderCandidates`, `reportGroup.certainlyNotSent`, `sessionManager.sessionState`.
- Produces:
  - `MESSAGE_KEYS`: frozen object with the six keys above.
  - `MAX_SENDERS = 10`
  - `rotateOrder(list, lastSenderUserId) -> list`: pure. In `ROTATE` mode the order starts after the last sender, or at the top when the last sender is null or no longer in the list.
  - `readPolicy(messageKey, { client }) -> Promise<{ mode, senders: [{ priority, id, name, code, connected }], lastSenderUserId }>`: `senders` in saved order. `priority` is the 1-based position. `connected` is read live.
  - `setPolicy(messageKey, { userIds, mode }, { client }) -> Promise<readPolicy result>`: validates and replaces the members in one transaction. Throws `{ status: 400 }` with these exact messages: `"Choose how the senders take turns."` (bad mode), `"Choose at most 10 senders."`, and `"Every sender has to be an active employee with Allow WhatsApp ticked on their login."`. Drops duplicates and nulls, keeping the first occurrence.
  - `orderForSend(messageKey, { client }) -> Promise<senders[]>`: `readPolicy`, then `rotateOrder` in `ROTATE` mode.
  - `markSent(messageKey, userId, { client }) -> Promise<void>`: sets `lastSenderUserId`. Never throws (catches and logs).
  - `trySenders(messageKey, attempt, { client, isChatEnabledForUser, mayStillSend }) -> Promise<{ outcome: "sent"|"failed"|"maybe-sent", userId, who, reasons }>`. Walks `orderForSend`. For each sender it skips, with a reason, anyone who is switched off, no longer `ELIGIBLE_SENDER`, or not connected. Otherwise it calls `await attempt(sender)`. The attempt either returns, which counts as sent, or throws an error whose `.skip === true` means "this sender can't, try the next one" (not in the group, over the hourly cap). A send error goes through `certainlyNotSent`: continue, or stop with `"maybe-sent"`. On `"sent"` it calls `markSent`. An empty list gives `{ outcome: "failed", reasons: ["No sender is chosen for this message."] }`. `who` is `"Priority N (Name)"`, matching `deliverToGroup`.

- [ ] **Step 1: Write the failing tests.** Use a fake `client` and fake `sessions`, as `test/attendance-report-group.test.js` does.
  - `rotateOrder([A,B,C], B)` → `[C,A,B]`. `rotateOrder([A,B,C], null)` → `[A,B,C]`. `rotateOrder([A,B,C], Z)` → `[A,B,C]`. `rotateOrder([], A)` → `[]`.
  - `setPolicy` with `mode: "X"` rejects with status 400 and `"Choose how the senders take turns."`. With 11 ids it rejects with `"Choose at most 10 senders."`. With an ineligible id it rejects with the Allow WhatsApp message. `[3,3,5]` saves positions `3→1`, `5→2`.
  - `trySenders`, SAME mode, list `[A,B]` with A disconnected: B sends, `reasons[0]` mentions "Priority 1", and `markSent(B)` is called.
  - `trySenders`, ROTATE mode, last = A, list `[A,B,C]`, B's attempt throws `{ skip: true }`: C sends and `lastSenderUserId` becomes C.
  - `trySenders`, every sender fails: outcome `"failed"`, and **no user outside the list is attempted**.
  - `trySenders`, A throws a timeout (`certainlyNotSent` is false): outcome `"maybe-sent"` and B is never attempted.
  - `trySenders` with an empty list → `"failed"` with `"No sender is chosen for this message."`.
  - `trySenders` on a sender who is no longer eligible: skipped with a reason, not a crash.
  - `markSent` when the update rejects: resolves and doesn't throw.
- [ ] **Step 2: Implement `senderPolicy.js`** to the interface above. Doc comments match the surrounding files' prose style.
- [ ] **Step 3:** Run `node --test test/whatsapp-sender-policy.test.js` (only when the owner says all changes are done). Expected: all pass.

### Task 3: Group messages — attendance report, wishes, photo selection

**Files:**
- Modify: `backend/src/modules/hrm/attendance/reportGroup.js` (`sendOrder`, `sendOrderFor`, `reportGroupStatus`, `setReportSenders`, `deliverToGroup`, `reportTarget`, `SENDER_COLUMNS`/`RETIRED_SENDER_COLUMNS`, `settingsRow` select)
- Modify: `backend/src/modules/hrm/attendance/controller.js` (`setReportSenders` passes `req.body.mode`)
- Modify: `backend/src/modules/settings/wishes/scheduler.js`, `backend/src/modules/settings/wishes/sender.js`, `backend/src/modules/settings/wishes/controller.js`
- Modify: `backend/src/modules/settings/automatic-whatsapp/photoSelection.js`, `backend/src/modules/settings/automatic-whatsapp/controller.js`
- Test: update `backend/test/attendance-report-group.test.js`, `backend/test/settings-wishes-scheduler.test.js`, `backend/test/settings-wishes-sender.test.js`

**Interfaces:**
- Consumes: Task 2's `trySenders`, `readPolicy`, `setPolicy`, `MESSAGE_KEYS`.
- Produces: `deliverToGroup(target, body, opts)`, where `target` is `{ messageKey, groupName }` (no `priorityOne*`). It is built on `trySenders`, and the attempt resolves the jid with `groupMatching` and throws `{ skip: true }` when the sender has no such group. Return shape unchanged. The status payloads keep `senders` (now only the list) and `sender` (position 1 or null), and add `senderMode: "SAME"|"ROTATE"`. Each `PUT …/senders` body is `{ userIds: number[], mode }`.
- `reportGroup.sendOrder` and `sendOrderFor` are deleted once no caller is left. `senderCandidates` stays: the panel still lists everyone so they can connect their WhatsApp.

- [ ] **Step 1: Update the failing tests.** Add a test that the report, with list `[A]` and A not in the group, comes back `"failed"` and **B, an eligible employee outside the list, is never asked**. Change any existing assertion that relied on the alphabetical fallback so that it expects failure instead.
- [ ] **Step 2:** Rewire `deliverToGroup` and the three callers onto `trySenders`, and swap each `setXSender(s)` onto `setPolicy(MESSAGE_KEYS.X, { userIds, mode })`.
- [ ] **Step 3:** Run the three test files. Expected: pass.

### Task 4: Direct and per-project senders — shoot crew notice, payment reminder, cash receipt, interview welcome

**Files:**
- Modify: `backend/src/modules/settings/shoot-crew-notice/service.js` (drop `SLOTS` and `sendOrderFor`; status and `setSenders` go through the policy), `backend/src/modules/settings/shoot-crew-notice/sender.js` (`pickSender` becomes `trySenders` at send time per person: the attempt is the DM, and `markSent` comes from `trySenders`), `backend/src/modules/settings/shoot-crew-notice/controller.js`
- Modify: `backend/src/modules/settings/payment-reminder/service.js`, `backend/src/modules/settings/payment-reminder/sender.js`, `backend/src/modules/settings/payment-reminder/receivedMessage.js`, `backend/src/modules/settings/payment-reminder/controller.js`
- Modify: `backend/src/modules/settings/automatic-whatsapp/interviewWelcome.js` (the hourly cap becomes a per-sender `{ skip: true }`), and the matching `controller.js` handler (body `{ userIds, mode }`)
- Test: update `backend/test/shoot-crew-notice.test.js`, `backend/test/settings-payment-reminder.test.js`, `backend/test/interview-welcome.test.js`

**Interfaces:**
- Consumes: Task 2. `paymentReminder.sender.groupFor(project, groups)` is unchanged.
- Produces: the same status and `PUT` shapes as Task 3.
- The payment reminder's run-level claim (`updateMany … paymentReminderSenderUserId: senderId`) drops its sender condition and keys on `id` plus `lastAttemptAt` only. Each reminder in the batch calls `trySenders`, with a per-run `Map<userId, groups>` so each sender's groups are fetched at most once. `senderProblem` is replaced by `trySenders`' own checks.

- [ ] **Step 1: Update the failing tests.**
  - Payment reminder, ROTATE, list `[A,B]`, 3 reminders: the senders go A, B, A, and `listGroups` is called once per sender.
  - Payment reminder, list `[A]` with A disconnected: `"failed"`, and the payment's claim is released.
  - Cash receipt with an empty list: a FAILED activity row saying `"No sender is chosen for this message."`.
  - Shoot crew notice, list `[A,B]` with both disconnected: no other employee is tried, and `reasons` names both.
  - Interview welcome, list `[A,B]` with A at the hourly cap: B sends.
- [ ] **Step 2:** Rewire the four senders and three controllers.
- [ ] **Step 3:** Run the three test files. Expected: pass.

### Task 5: `SenderOrderField` and the three panels

**Files:**
- Create: `frontend/src/components/settings/SenderOrderField.js`
- Modify: `frontend/src/components/settings/AttendanceWhatsAppReportPanel.js` (replaces the "Priority 1" `Dropdown` ~L276–294 and its notes; also serves Wishes, Photo Selection and Payment reminder through `api`/`wording`), `frontend/src/components/settings/ShootCrewNoticePanel.js`, `frontend/src/components/settings/InterviewWelcomePanel.js`
- Modify: `frontend/src/services/hrm/attendance.service.js`, `frontend/src/services/settings/wishes.service.js`, `frontend/src/services/settings/automatic-whatsapp.service.js`, `frontend/src/services/settings/paymentReminder.service.js`, `frontend/src/services/settings/shootCrewNotice.service.js`: each `set…Sender(s)` becomes `(userIds, mode)` and sends `{ userIds, mode }`.

**Interfaces:**
- Consumes: status `{ senders, senderMode, canChooseSenders }` and the candidates endpoint.
- Produces: `SenderOrderField({ senders, mode, candidates, canWrite, onChange({ userIds, mode }), saving })`. It renders:
  - A `SortableList` of the chosen senders, each row showing "Priority N", the name, a connected/not-connected `StatusBadge`, and a remove `IconButton` (MUI `Close`).
  - A `Dropdown` labelled "Add a fallback sender" listing the candidates not yet chosen. It is hidden at 10.
  - A `RadioGroupField` labelled "How they send", with options "Same number — Priority 1 sends; the next one only if it can't" and "Take turns — each message goes from the next one in the list".
  - The note: "If nobody in this list can send, the message is not sent and the reason shows here."
  - When `canWrite` is false, the same list is shown read-only: `SortableList disabled`, no remove buttons, no add `Dropdown`, and the mode as text. The controls are absent, not disabled.

- [ ] **Step 1:** Run the **frontend-ui-reviewer** and **ux-heuristics-reviewer** agents on the three panels before editing (only when the owner allows agents).
- [ ] **Step 2:** Build `SenderOrderField` from the existing components. No raw `<button>`, `<select>` or `<input>`.
- [ ] **Step 3:** Swap it into the three panels. Remove the "rest with Allow WhatsApp ticked are tried automatically" wording everywhere it appears. The "connect your WhatsApp" list in `AttendanceWhatsAppReportPanel` stays as it is.
- [ ] **Step 4:** Headless check at ~360, ~768 and ~1280px using the signed-in recipe from memory: reorder by drag and by the move buttons, add, remove, switch mode, reload, and confirm the order and mode stay saved. Sign in as a `READ` role and confirm the controls are absent.

### Task 6: Docs and changelog

**Files:**
- Modify: `backend/README.md` and `frontend/README.md` (only the sections that describe sender order or these panels; find them with `grep -n '^## '` and a grep for "Priority 1")
- Modify: `docs/project-state/PROJECT-STATE.md` (the automatic WhatsApp sections, read by section)
- Modify: `docs/CHANGELOG.md` (one entry at the top of the matching group under `Unreleased`, from `head -40`)

- [ ] **Step 1:** Update every sentence that says the rest of the Allow-WhatsApp employees are tried automatically. Run `grep -rn "tried automatically\|every other Allow-WhatsApp\|name order" backend/src frontend/src docs` and fix each hit, including code comments in the files touched above.
- [ ] **Step 2:** The changelog entry must state: the new ordered list and the Same number / Take turns modes for the six messages; that **the automatic fallback to every Allow-WhatsApp employee is gone, so a message whose listed senders all fail is now Failed**; that New Lead Welcome is unchanged; that the migration carries over each existing sender as Priority 1 (shoot crew keeps its Priority 2); and that no new permission was added.
- [ ] **Step 3:** At the end, when the owner says all changes are done: run `npm test` in `backend`, and `npm run lint` + `npm test` in `frontend`. Then run the **backend-api-reviewer**, **db-schema-reviewer**, **frontend-ui-reviewer** and **ux-heuristics-reviewer** agents. Then read `git diff` end to end. No commit.
