# Speak-up — design spec

**Date:** 2026-09-29
**Status:** approved in chat, awaiting spec review

## Intent

Employees need a way to write HR something personal — a complaint about an individual, a
suggestion for company growth, a general grievance — without it going through their manager or
being visible to coworkers. HR needs a place to read what comes in. Nothing beyond that: no status
tracking, no reply thread, no case management. A one-way, confidential inbox.

**Confirmed with the user:**
- Confidential to HR, not anonymous — HR sees who wrote each one, so they can follow up if they
  choose to. No one else in the org (manager, coworkers, other HR-adjacent roles that don't hold
  the review permission) can see it.
- One-way inbox: no status, no reply, nothing HR writes back onto a submission.
- Type is a fixed list in code, the user's own wording, exactly: Team / Manager Issue, HR / People,
  Work Environment, Suggestion, App / System Issue, Other.
- An employee can see their own past submissions (read-only, no state to show beyond what they
  wrote).
- Lives inside the existing Employee Attendance page, as one more entry in its section dropdown —
  not a page of its own, not a sidebar entry of its own.
- The exact fields, the user's own labels: **Type*** (required, a searchable dropdown — "the search
  option like we have in Roles page" is `Dropdown`'s own `mode="input"` behaviour, on by default,
  not a bespoke build), **Subject** (a short title), **"What happened?"** (the long description,
  free text), **Attachment** (one file — the brief marked it "Attachment* (optional)"; confirmed
  with the user that it is optional, the asterisk was a slip).

## Why inside Employee Attendance

The user asked for it there directly. The page already mixes sections gated by different
permissions from its own base one — `"Rules"` only appears for whoever holds the separate
`HRM / Attendance Approval` permission at `READ_WRITE` (`isAttendanceAdmin`, `service.js:171`), even
though everyone who can open the page at all sees the same static list otherwise
(`EmployeeAttendancePage.js:1563`). Speak-up follows exactly that shape: its own permission, decides
its own section's presence, inside a page whose *route* is still gated by
`HRM / Employee Attendance`.

**Consequence worth stating plainly:** somebody who holds `HRM / Speak-up` but not
`HRM / Employee Attendance` cannot reach Speak-up at all, because the route itself never opens for
them. In practice every employee role already holds Employee Attendance (it is how anyone raises
their own leave/permission request), so this is not expected to exclude anybody — but it is a real
constraint of putting Speak-up here rather than on a page of its own, and it should be named as a
deliberate trade-off, not discovered later as a bug.

## Data

One new table, following the `PaymentRequest` precedent for an employee-authored record ("kept
beside the link so a decided request still reads correctly after the employee is archived" —
`schema.prisma:4237`):

```prisma
model SpeakUp {
  id           Int      @id @default(autoincrement())
  employeeId   Int?     @map("employee_id")
  /// Rule 5 name copy of `employeeId` — `nameCopies.js` rewrites it on rename, `resolvedNames.js`
  /// resolves the live name back on read, and it is what HR still reads if the employee's record
  /// is ever removed.
  employeeName String   @map("employee_name") @db.VarChar(191)
  /// Team / Manager Issue | HR / People | Work Environment | Suggestion | App / System Issue |
  /// Other — a fixed Zod enum, not a configurable list (confirmed with the user), so it stays a
  /// plain validated string rather than a master-data table the way Designation or Department are.
  type         String   @db.VarChar(30)
  /// Labelled "Subject" on screen.
  title        String   @db.VarChar(191)
  /// Labelled "What happened?" on screen.
  description  String   @db.Text
  /// The R2 object key, private - never a public URL. Null when nothing was attached, which is the
  /// ordinary case: optional, confirmed with the user despite the field first being marked with a
  /// required asterisk in the brief.
  attachmentKey      String? @map("attachment_key") @db.VarChar(500)
  /// The name it was uploaded under, so the review list can show and let HR download it as
  /// something readable rather than the object key.
  attachmentFileName String? @map("attachment_file_name") @db.VarChar(255)
  createdAt    DateTime @default(now()) @map("created_at")

  employee Employee? @relation(fields: [employeeId], references: [id], onDelete: SetNull)

  @@index([employeeId])
  @@index([createdAt])
  @@map("speak_up")
}
```

Add the inverse relation on `Employee` (`speakUps SpeakUp[]`), beside its other one-to-many
employee-authored relations.

**Deliberately not branch-scoped.** Every other business table carries a `branchId` for `dataScope`
to narrow on (CLAUDE.md Rule 4), but Speak-up is not operational, per-branch data — it is a trust
channel, and narrowing HR's view to "your own branch's complaints" would arbitrarily hide genuine
ones from an HR holder whose role happens to be scoped to one branch, defeating the point of a
company-wide confidential inbox. `HRM / Speak-up Review` grants full visibility, unscoped, to
whoever holds it — a deliberate decision, not an oversight, and called out here so a later reviewer
does not "fix" it into a branch filter.

**Register the name copy:**
- `nameCopies.js`: `exact("speakUp", "employeeName", "speak-up", { idField: "employeeId" })`
- `resolvedNames.js`: `employeeName: ["employee", "employeeName"]` under the `speakUp` model entry

### Attachment storage

Two corrections against the first pass at this section, found while mapping it to real code:

**Reuse `objectStorage.js`, not the CRM remark path.** `services/objectStorage.js` already has a
generic, already-private upload/read pair built for exactly "must not be reachable by link" —
`uploadPrivateObject(buffer, { folder, extension, contentType })` (writes to
`R2_PRIVATE_BUCKET_NAME`, a bucket with no public access, returning only `{ key }`, never a URL) and
`getPrivateObject(key)` (streams it back, or `null` for a missing one). Its own `buildKey(folder,
extension)` already produces a collision-free, date-partitioned key
(`hrm/speak-up/2026/09/<uuid>.<ext>`) — no CRM-specific client/enquiry folder machinery to route
around, and both functions are used exactly as they are, not wrapped in a new module.

**The upload is a data URL in the JSON body, not multipart.** The component this reuses per Rule 1,
`FileUploadField.js`, reads a picked file with `FileReader.readAsDataURL` and hands the form
`{ name, data }` — the same contract the Employee form's own identity-proof fields already send
(`storeIdentityProofs`). There is no existing helper for "decode an arbitrary private file from a
data URL" — every current private-upload helper (`storePrivateImage`) is image-only, built on
`compressImage`, which a screenshot is fine with but a PDF is not. The create controller gets one
small local step of its own: split the data URL (`/^data:([^;]+);base64,(.+)$/`), `Buffer.from(...,
"base64")`, extension from the original file name (`path.extname(name)`, more reliable than
sniffing the mime type) — then `uploadPrivateObject(buffer, { folder: "hrm/speak-up", extension,
contentType })`. This is a few lines inside the one controller that needs them, not a new
`src/services/` file — nothing else in the codebase needs "an arbitrary private file from a data
URL" yet, and a second caller is the moment to lift it out, not before.

Nothing is public: only the key (`attachmentKey`) and the original file name (`attachmentFileName`,
for the download to be named something readable) are stored on the row, and the only way to read
the bytes back is the authenticated, permission-gated endpoint that streams them.

## RBAC

Two new permission rows, both under `HRM` (the module the containing page already sits in):

| module | feature | level | displayName | description |
| --- | --- | --- | --- | --- |
| HRM | Speak-up | (READ/READ_WRITE, standard) | Speak-up | Write HR something personal, and see your own past ones |
| HRM | Speak-up Review | (READ/READ_WRITE, standard) | Speak-up Review | Read every Speak-up submitted, studio-wide |

Both use the ordinary `READ` / `READ_WRITE` scale (`requireModule`), not a custom level — there is
no approve/reject verb here to justify one. `READ` on `HRM / Speak-up` alone would only let someone
see their own past submissions without being able to write a new one, which is an odd but harmless
combination the level system already allows for every other module; `READ_WRITE` is what a normal
employee role is expected to be granted.

Both go through the full 10-step checklist in
[IAM.md § Adding a module or a screen](../../project-state/IAM.md#adding-a-module-or-a-screen):
catalogue row, reseed, route guard, endpoint-sharing check (n/a — new endpoints, nothing existing
reads them), `modulePermissions.js` row, `canWrite` gating on the submit control, gating the panel,
gating the fetch, changelog + re-saving the roles that should hold it, and the migration that
inserts both rows **and grants them to `SUPER_ADMIN`** in the same migration (IAM.md step 10).

**`NO_MENU_ENTRY`:** neither permission opens a sidebar entry of its own — both are sections inside
the Employee Attendance page, asked for by name there, the same way `IMAGE_SELECTION / Signature
Album` is a tab inside a project rather than a screen of its own. Both go into
`permission-catalogue-sidebar.test.js`'s `NO_MENU_ENTRY` map with that said plainly, or the sidebar
drift test fails.

## Backend

New module, `backend/src/modules/hrm/speak-up/` (`routes.js`, `controller.js`), mounted under
`/api/hrm/speak-up` in `server.js` beside the other HRM routers.

```
POST /api/hrm/speak-up                  create (own), a plain JSON body —
                                         requireModule(HRM, Speak-up, READ_WRITE)
GET  /api/hrm/speak-up/mine             own history  — requireModule(HRM, Speak-up) (READ suffices)
GET  /api/hrm/speak-up                  everyone's   — requireModule(HRM, "Speak-up Review")
                                         (READ suffices)
GET  /api/hrm/speak-up/:id/attachment   streams the file — same guard as whichever list the row
                                         came from (own row under Speak-up, any row under Review),
                                         checked per request rather than trusted from the referrer
```

No `PATCH`, no `DELETE`, no per-row action — a one-way inbox has nothing to change once written.
The create route validates `type` against the fixed six-value enum, `title` (required, short) and
`description` (required, longer) with Zod, resolves `employeeId`/`employeeName` from `req.user`
exactly as every other employee-authored write does, and never accepts an `employeeId` from the
request body (Rule 4: never trust an id from the body to be one the caller may touch — here it
would let somebody submit on another employee's behalf). `attachment` is optional in the same body —
`FileUploadField`'s `{ name, data }` shape — decoded and stored (see Attachment storage above)
before the row is written, and cleared up if the write then fails, the same discard-on-failure
discipline `storeIdentityProofs` already follows for employee uploads.

The "everyone's" list resolves the current name via `resolvedNames.js` the way every other list
reads a name copy, sorted newest first, with `type`/date-range filters left for a later change if
HR asks for them — not in this cut, since the brief was "type, title, description" and a one-way
inbox, not a searchable case system.

## Frontend

- `frontend/src/services/hrm/speakUp.service.js` — `createSpeakUp(payload)`, `getMySpeakUps()`,
  `getAllSpeakUps()`, one function per API call, following every other `*.service.js`.
- Two new section constants, `SECTION_SPEAK_UP` and `SECTION_SPEAK_UP_REVIEW`, each appended to the
  `sections` list conditionally — the same way `"Rules"` is appended only `settings?.canManage ?
  [...baseSections, ...] : baseSections`, except read from `usePermissions()`
  (`frontend/src/components/auth/PermissionsProvider.js`, the standard way CLAUDE.md's RBAC section
  describes gating a control) rather than a second backend-computed boolean: `"Rules"` needed a
  server round-trip because `isAttendanceAdmin` checks a *different* permission than the one that
  opened the route, and the frontend has no other way to know it, but `HRM / Speak-up` and
  `HRM / Speak-up Review` are both permissions the page's own `usePermissions()` call already knows
  about, so no extra endpoint is needed here. Neither section is offered to someone lacking its
  permission — Rule 4's "absent, not disabled" applies to the section entry itself, not just the
  submit control inside it.
- New component, `frontend/src/components/hrm/SpeakUpPanel.js` (submit form + own history list) and
  `SpeakUpReviewPanel.js` (HR's read-all list) — two small, single-purpose components rather than
  one that branches internally on which permission the viewer holds, matching "each unit has one
  clear purpose."
- The submit form carries the reassurance copy above the fields, exactly as the user wrote it:
  *"Your complaint will not be exposed to anyone. This is kept personal — say anything you want to
  tell."* Placed as a plain paragraph above `Type`. No dedicated note/banner component exists yet
  in `shared`/`ui` to reuse for this (checked) — one line of copy does not earn a new shared
  component under Rule 1's own "when nothing fits" clause, so it is plain text styled with the
  small, muted-note classes already used this way elsewhere in the codebase (`text-sm
  text-slate-600`), not a new component.
- Fields, the user's own labels: **Type*** (`Dropdown mode="input"`, the fixed six options —
  searchable by default, which is the "search option like in Roles page" asked for; nothing bespoke
  needed), **Subject** (`TextField`, required), **"What happened?"** (`TextAreaField`, required),
  **Attachment** (`frontend/src/components/shared/FileUploadField.js`, already exists for exactly
  this — reused as-is per Rule 1, optional, one file). Every one of `Dropdown`, `TextField`,
  `TextAreaField` and `FileUploadField` already exists; nothing raw, nothing new to build in
  `components/ui`/`shared`.
- Responsive per Rule 2: the panel is one column at every width, since there is nothing here to
  arrange side by side — no fixed pixel widths, no table, no horizontal scroll risk.

## Testing

- Backend: a create test (valid payload with and without an attachment, rejected `type` outside the
  six-value enum, employeeId taken from the caller not the body, permission guard at both levels), a
  "mine" test (only the caller's own rows), a "review" test (every row, permission-gated separately
  from submission), an attachment test (uploaded then streamed back, and refused to someone whose
  row it is not and who holds neither guard).
- Frontend: `SpeakUpPanel` renders the reassurance copy and all four fields (Type searchable,
  Attachment optional), submits and clears; `EmployeeAttendancePage` shows the `Speak-up` section for
  `HRM/Speak-up` and the `Speak-up Review` section only for `HRM/Speak-up Review`, matching the
  existing `Rules`-gating test's shape.
- `permission-catalogue-sidebar.test.js` and `iam-super-admin-grants.test.js` cover the two new
  catalogue rows automatically once they're added correctly — no new test needed there, just correct
  entries.

## Out of scope (confirmed, not deferred by accident)

- Status / in-review / resolved tracking.
- A reply HR can send back.
- Type as a configurable master-data list.
- Any per-branch narrowing of who HR sees.
- Editing or withdrawing a submitted Speak-up, or more than one attachment.
