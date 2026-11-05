# Attendance request lifecycle — design

**Goal.** Give the raiser of a leave, permission or comp-off request the four actions they actually
need — View, Edit, Revert back, Delete — and give an approver a third answer, Send back, so a request
that is nearly right goes back to be fixed instead of being rejected. Decisions stop being final in
one direction only: a rejection may become an approval, an approval may never become a rejection.

**Why now.** The raiser has one way out today (Withdraw, plus a Cancel that means something subtly
different) and no way to correct a request at all — a wrong date is withdrawn and typed again from
nothing. An approver has two answers, so "the dates are wrong" has to be said as a rejection.

## What exists today

- Statuses: `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED` (`attendanceRules.js:55`).
- A request carries **several approvers** (`AttendanceRequestApproval` rows, each `PENDING` /
  `APPROVED` / `REJECTED`). A leave needs every one of them, so one approval usually leaves the
  request `PENDING`.
- **Decisions are final.** `decide()` refuses a second answer from the same approver and refuses any
  answer at all once the request is not `PENDING`. The request row is locked for the transaction, so
  two approvers cannot race.
- **An approval is not a stored fact about a day — it is read live.** `approvedTimeOff()` and the
  register, the reports and the 10:00 WhatsApp report all filter on `status: "APPROVED"`. Nothing is
  written onto the day, which is why reversing an approval rewrites what attendance says about days
  that may already have passed and been reported.
- Own actions: `POST /requests/:id/cancel` (an approved day given back) and
  `DELETE /requests/:id` (an unanswered ask taken back), plus Apply again on the screen.
- The screen's tabs are All · Pending · Approved · Rejected, with **Waiting for me** added for
  anybody named as an approver. A holder of `HRM / All Requests` sees the first four over everybody.
- `requestDisplayStatus()` derives **Upcoming** from an approved request whose first day is still
  ahead — a label, never a stored status.

## The state machine

Six statuses. `status` is `VarChar(20)`, so `SENT_BACK` fits and no column changes.

```
                 ┌──────────── edit ────────────┐
                 │                              │
   (raise) → PENDING ──all approve──→ APPROVED ──┤
                 │ ↑                             │
    any approver │ │ raiser edits                │ raiser edits
      sends back │ │                             │
                 ↓ │                             ↓
            SENT_BACK ───────── edit ────────→ PENDING
                 │
   any rejects   │                    an approver changes
                 ↓                    their rejection to an approval
             REJECTED ──────────────────────────→ (recomputed)

   PENDING | SENT_BACK | REJECTED | APPROVED ──revert back──→ REVERTED ──edit──→ PENDING
   any of the above ──delete──→ DELETED        (terminal)
```

**The request's status is computed from its approval rows, never set directly**, except by the
raiser's own verbs (`SENT_BACK`, `REVERTED`, `DELETED`):

- every row `APPROVED` → `APPROVED`
- any row `REJECTED` → `REJECTED`
- otherwise → `PENDING`

### Rules

1. **An approver owns only their own answer.** Nobody can change another's.
2. **A rejection may become an approval. An approval may not become a rejection.** This is the whole
   of the safety argument: a later approval only ever *grants* leave, where a later rejection would
   take leave away from days the register and the sent reports have already called "On leave".
3. **Send back** is available to any approver while the request is not `APPROVED`. It clears **every**
   approval row to `PENDING`, sets the request `SENT_BACK`, and takes it out of every queue. It
   requires a remark — it is the one answer that is useless without a reason.
4. **Edit** belongs to the raiser, from `PENDING`, `SENT_BACK`, `REJECTED`, `APPROVED` and
   `REVERTED` — not from `DELETED`. Editing **clears every approval row to `PENDING`** and the
   request to `PENDING`, and is recorded in the history. Approvers answered about the old dates.
   *Consequence, accepted:* editing an approved leave stops those days reading "On leave" until it
   is approved again. The raiser can therefore do to attendance what rule 2 stops approvers doing.
5. **Revert back** replaces Withdraw, Cancel and Apply again. It pulls the request out of every queue
   and leaves it with the raiser as `REVERTED`, from where it can be edited (back to `PENDING`) or
   deleted. Available from `PENDING`, `SENT_BACK`, `REJECTED` and `APPROVED`.
6. **Delete never deletes.** `DELETED` is a status: the row stays, leaves every approver's queue, and
   stops counting for attendance and leave because only `APPROVED` ever counted. The raiser keeps
   seeing it marked Deleted. Terminal — not restorable; a fresh request is raised instead.
7. **`CANCELLED` rows are left alone.** Requests already cancelled keep that status and keep reading
   as "Cancelled". Nothing migrates them: it is what happened.

## What each side sees

**The raiser's row menu:** View · Edit · Revert back · Delete. Withdraw, Cancel and Apply again go —
Edit and Revert back cover what they did, and two actions that read the same way is what made the
old pair confusing.

**The approver's queue:** Accept · Reject · Send back. An approver who has already approved still
sees the row while others are pending, showing "You approved" — unchanged. An approver who rejected
sees Accept, because rule 2 lets them change their mind that way.

**Tabs for the raiser:** All · Pending · **Send Back** · Approved · Rejected. `REVERTED` and
`DELETED` are found under All, marked with their own status — they are not queues anybody works
through. **Waiting for me** is unchanged.

**Status labels:** Pending, Send Back, Approved (or **Upcoming**, as now), Rejected, Reverted,
Deleted, and Cancelled for the old rows.

## What this does not change

- Which permissions reach any of it: the existing request guards, unchanged.
- How a request is raised, who it goes to, or how approvers are chosen.
- That only `APPROVED` affects the register, the reports and leave counting — which is what makes
  `SENT_BACK`, `REVERTED` and `DELETED` safe without touching the attendance code at all.
- The row lock in `decide()`, which still settles two approvers acting at once.

## Risks

- **Retroactive attendance.** Rules 2 and 4 together mean attendance for a past day can still change
  — by a late approval, or by the raiser editing an approved request. Accepted deliberately; the
  reversal is recorded in the request's history either way.
- **Five new transitions in a module the register reads.** Every one of them is a status the
  attendance queries already ignore, so the blast radius is the request screens and their tests.
- **`Upcoming` is derived from `APPROVED`.** Nothing else may be derived that way without the same
  care, or a stored status goes stale.

## Open questions

None. Settled with the studio on 2026-10-08: reversal is one-way, status is recomputed from the
rows, editing resets every answer whatever the status, Delete shows as Deleted to the raiser and
leaves the queues, Revert back shows as Reverted, and Send Back is a tab.
