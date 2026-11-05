# Vendor shoot notice — design

**Date:** 2026-11-03
**Status:** approved in conversation, not yet planned or built
**Audience:** the engineer implementing this in DBS-Operations-OS

---

## 1. Intent, and the why

A vendor on a shoot is told nothing by this app. The production manager confirms them on a service
seat and the app stops there: somebody then rings or messages the vendor by hand, and when the shoot
moves, or the venue changes, or the vendor is dropped, that hand-work has to happen again and
sometimes does not. A vendor who travels to a shoot that moved is a cost and an apology.

The studio's own people already get this automatically — the **shoot crew notice**
(`backend/src/modules/settings/shoot-crew-notice/`) tells every employee on a shoot two days before
it, re-tells only the ones whose own part changed, and tells anyone dropped. This change points the
same machine at vendors, and fixes who both kinds of message come from.

**The second half matters as much as the first.** Today both come from one phone picked once in
Settings — the same employee's WhatsApp for every shoot in the studio. The studio wants the sender to
be the person who actually owns the relationship:

| Message | Sent from |
| --- | --- |
| Vendor notices (new) | **that project's Production Manager** |
| Employee shoot crew notices (exists) | **that project's Pre-Production Coordinator** |

So the phone changes from project to project. A vendor who replies "can we shift by an hour?" replies
to the manager who can answer, not to whoever the studio nominated in Settings last year.

---

## 2. Goals

1. A confirmed vendor is told about their shoot, reminded before it, told when it changes, and told
   when they are off it — without anybody doing it by hand.
2. Each of those situations has its **own wording**, editable by the studio under Settings →
   Templates, so the reminder can read like a reminder and a change like a change.
3. Both the vendor notice and the existing employee notice send **from the project's own** manager /
   coordinator.
4. The studio can see when a message is waiting because a sender's WhatsApp is not connected.

## 3. Non-goals

- Vendor **replies**. This is outbound only. A vendor's reply lands in the manager's own WhatsApp;
  nothing is read back into the app, and no vendor chat thread is built.
- A vendor **portal**, confirmation link, or "accept / decline" button. The vendor's status is still
  set inside the app by the production manager.
- Any change to the vendor's own status machine (`WAITING` → `CONFIRMED`), to the production plan, or
  to who may edit a plan.
- Telling a vendor who is still at `WAITING`. Only `CONFIRMED` is messaged.
- SMS or email. WhatsApp only.

## 4. Anti-goals — what would make this a failure even if it worked

1. **The studio's WhatsApp gets flagged.** These are personal numbers on real WhatsApp accounts, and
   a burst from one number is what gets it banned. Every send is one-to-one, paced, and capped per
   sender. No broadcast, no list, no bulk. Breaking this is worse than shipping nothing.
2. **A vendor is messaged twice**, or messaged a dozen times while a manager edits the plan. A vendor
   who mutes the studio is worse off than one nobody messaged.
3. **A vendor is told something that is not true** — the old date after a change, or details from a
   plan that was never submitted.
4. **A message is silently dropped.** If it cannot go, somebody must be able to see that it is
   waiting and why.
5. **The employee notice regresses.** It is live. Changing its sender must not stop it sending.

---

## 5. Constraints

- **WhatsApp:** one-to-one sends only, never bulk or automated blasts. Follow the existing pacing in
  `shoot-crew-notice/sender.js` (`MAX_PER_TRY = 5` a sweep, `GAP_MS`/`JITTER_MS` between sends) and
  the per-sender hourly cap that `automatic-whatsapp/newLeadWelcome.js` uses
  (`MAX_PER_SENDER_HOUR`). This constraint outranks promptness.
- **Rule 4 (RBAC):** every route mounts `protect` and a permission guard, and nothing else decides
  access. New permissions are added to `prisma/seeds/permission-catalogue.js` **and** carried in a
  migration (`INSERT … WHERE NOT EXISTS`), granted to `SUPER_ADMIN` only.
- **Rule 5 (links):** the vendor, the service definition, the production and the sender are all ids
  with `@relation` and an index. Names in a message are resolved through the relation at send time,
  never stored as the authority.
- **Rule 1 (reuse):** this is a second arm on an existing module, not a parallel copy of it. Rule 2:
  the Settings panel works at ~360px.
- **Database naming:** `snake_case` tables and columns, `@map`/`@@map`.
- **Migrations:** `prisma migrate dev` locally only, rehearsed against a copy; never on the VPS.
  Note the local shadow-database defect — verify with `migrate diff` / `migrate status` and let the
  user apply. Never run `npx prisma format` in this repo (it rewrites ~1100 unrelated lines);
  `prisma validate` instead.
- **Docs ship with the code:** the two READMEs, `docs/project-state/` where behaviour changed, and one
  `docs/CHANGELOG.md` entry.

---

## 6. What was decided, as it was decided

### 6.1 When a vendor is messaged

Six situations, six wordings. All of them apply only to a vendor whose seat is `CONFIRMED`, on a
**settled** plan (submitted, and not `HOLD` / `REJECTED` / `WCR`), for a shoot whose day has not
passed.

**The vendor sweep looks at every future settled shoot, not only the next two days.** This is where
it parts company with `shoot-crew-notice/due.js`, whose query is deliberately a two-day horizon
(`gte: dayStart(now), lt: horizonEnd(now, 2)`). A vendor is told thirty minutes after they are
confirmed, whenever that is — three weeks out, the message goes three weeks out. That is the point of
the confirm message, and it is also what makes the change messages worth anything: a shoot that moves
a fortnight ahead has to reach a vendor who was told a fortnight ago. Reusing the two-day query would
hold the confirm message back until the shoot was 48 hours away, which is not what was asked for.

The cost of the wider horizon is the sweep's query and the lifetime of a notice row — both the
implementer's to shape (§7), within the pacing constraint in §5.

| Template key | Goes when | Only it can say |
| --- | --- | --- |
| `VENDOR_SHOOT_CONFIRMED` | 30 minutes after the production manager sets the vendor to Confirmed | "You are confirmed for this shoot", with the full details |
| `VENDOR_SHOOT_REMINDER` | two days before the shoot | "Reminder — your shoot is the day after tomorrow" |
| `VENDOR_SHOOT_DATE_CHANGED` | the shoot's date or its times moved | "The date has changed — it is now …" |
| `VENDOR_SHOOT_PLACE_CHANGED` | the shoot's place or district moved | "The place has changed — it is now …" |
| `VENDOR_SHOOT_SERVICE_CHANGED` | the service this vendor is on changed | "Your service has changed — you are now on …" |
| `VENDOR_SHOOT_REMOVED` | the vendor is taken off the seat, moved back from Confirmed to Waiting, **or** the shoot or its plan goes away under them (§6.7) | "You are no longer on this shoot — please do not travel" |

Placeholders, the same set in all six so the studio can move a detail between them:
`{vendor name}`, `{shoot}`, `{shoot id}`, `{project}`, `{event id}`, `{date}`, `{day}`, `{time}`,
`{place}`, `{district}`, `{service}`, `{manager name}`.

**The thirty minutes of quiet is the existing rule, not a new one.** `due.js` already holds a notice
until the latest of the plan's, its seats' and the shoot's `updatedAt` is 30 minutes old, so a plan
edited in passes sends one message rather than one a keystroke. The vendor's confirm message falls out
of that rule: the manager confirms, keeps editing, and thirty quiet minutes later the vendor is told
once. **Do not add a second timer for it.**

The two-day reminder is owed **even to a vendor already sent the confirm message** — the confirm and
the reminder are two different things and both go. A vendor confirmed inside the two days gets the
confirm message only; the reminder is not back-dated.

A change outranks a reminder: if both are owed in the same sweep, the change message goes and the
reminder is marked as covered by it.

### 6.2 Which change happened — and why one digest is not enough

The employee notice stores one `digest` per person and re-tells them when it differs. That cannot pick
between six templates, because it cannot say *what* differed.

So the vendor notice stores the digest **in parts**: one for the shoot's day and times, one for its
place and district, one for the vendor's service. Comparing each against what was last sent names the
situation and therefore the template. Where two parts changed at once, send the **one** message that
covers the more disruptive — date before place before service — rather than two messages. A vendor
getting three WhatsApps for one edit is anti-goal 2.

### 6.3 Switching it on, and the vendors already confirmed

**Nothing is back-filled.** On the day the vendor arm is switched on, every vendor already confirmed
on a future shoot is recorded as **already told**, and only vendors confirmed from that moment on get
a confirm message. Their later reminders and change messages work normally.

This is the user's decision, and the reason is anti-goal 1: with a horizon of every future shoot, a
back-filling first sweep would owe a confirm message to every confirmed vendor in the studio at once,
pushed out through the managers' own personal WhatsApp numbers. That is the burst that gets a number
banned. The migration therefore seeds the notice rows for existing confirmed seats, or the sweep
ignores seats confirmed before the switch-on date — the implementer's choice (§7), but the behaviour is
not optional.

### 6.4 Who it sends from

- Vendor notice → `project.productionManagerEmployee` → that employee's `User` → their WhatsApp
  session.
- Employee notice → `project.preProductionCoordinatorEmployee`, the same way.

Both columns already exist on `sales_project` with their relations and indexes
(`production_manager_employee_id`, `pre_production_coordinator_employee_id`).

**There is no fallback sender, for either arm.** If that person's WhatsApp is not connected, if they
are not an eligible sender (no login, inactive, Allow WhatsApp not ticked, chat switch off), **or if
the project names nobody in that role at all**, the message waits — nothing is written, nothing is
sent, and it is tried again on the next sweep. It goes the moment the gap is closed. This is the
user's explicit decision, asked and answered twice: a vendor must not hear about a shoot from a phone
the vendor does not know, and the employee arm follows the same rule rather than keeping a different
one.

**Know what this costs before you ship it.** The employee notice is live today and sends from one
Settings-chosen phone. Under this rule it stops sending on every project whose Pre-Production
Coordinator column is empty, or whose coordinator has no login with Allow WhatsApp — and it stops
quietly. The user chose this over a fallback, so it is not to be softened in code; it is to be made
**visible**:

- **The user states that every project on production has a Pre-Production Coordinator named.** So the
  empty-column case is a dev-data artefact, not a live risk, and the arm is not expected to ship
  inert. Confirm it with the count rather than assuming it: on the **dev** database on 2026-11-03,
  2 of the 8 projects with a submitted plan had no Pre-Production Coordinator, 0 had no Production
  Manager, and 14 confirmed vendor seats were standing.
- The remaining blockers are the ones a named coordinator can still hit: **no login**, an inactive
  login, **Allow WhatsApp not ticked**, their chat switch off, or a WhatsApp not connected at that
  moment. A name in the column is necessary and not sufficient. **The user has undertaken to put all
  five in place** for every Pre-Production Coordinator and every Production Manager before the switch
  is turned on, so the arm is not expected to wait on data.
- Build it as though they will nonetheless lapse: a coordinator who leaves, loses Allow WhatsApp or
  whose phone drops is the normal case over a year, not the exception. The waiting list (§6.9) is what
  makes that recoverable, and it is not optional scope. If most projects are missing
  one, the arm ships inert and they need to know that before the switch, not after.
- Every blocked project appears in the waiting list (§6.9) with the reason.
- The changelog entry says plainly that the employee notice now needs a Pre-Production Coordinator on
  the project.

### 6.5 One message per shoot

A vendor confirmed on five shoots of one wedding gets **five messages**, one per shoot, each with that
shoot's own date, time and place — the user's decision. The notice row is therefore per shoot seat,
the six wordings stay in the singular, and a change to one shoot re-messages that shoot only. The
pacing in §5 is what keeps five messages from arriving as a burst.

This takes both messages **out of the sender-policy family**
(`settings/automatic-whatsapp/senderPolicy.js`): there is no `SAME` sender, no `ROTATE` rotation, no
dragged fallback order. The precedent is already in that file — *"New Lead Welcome is not one of
these: it always goes from the lead's own owner."* These two now work the same way. Retire the
`SHOOT_CREW_NOTICE` policy row and its UI rather than leaving a setting that no longer decides
anything.

### 6.6 The vendor's number

The vendor's own `whatsapp_number`, falling back to `mobile_number` where no WhatsApp number is saved.
Validate through `services/phoneNumber.js` as the existing sender does. A vendor with no usable number
is not a send that fails repeatedly — record it once as needing a human and move on.

### 6.7 A vendor already told, and then the shoot goes away

`due.js` drops a production out of its result set entirely when the shoot is deleted, when the plan
status becomes `HOLD` / `REJECTED` / `WCR`, when `planSubmittedAt` is cleared, or when the shoot's day
moves out of range. For an employee that silence is tolerable. For a vendor who has already been told
"you are confirmed for 5 Nov" and will get in a car, it is anti-goal 3 and the exact failure this
feature exists to prevent.

**So a vendor who has been told is always chased.** Once a notice row exists, that row is owed a
`VENDOR_SHOOT_REMOVED` the moment the app can no longer see a live, settled, confirmed seat behind it
— whatever the reason. A withdrawn plan, a cancelled shoot and a seat handed to somebody else all
reach the vendor as the same message: do not travel.

Two consequences the implementer must build for, not around:

- The sweep cannot be driven off the plan query alone. It also walks the notice rows, including rows
  whose production that query excludes.
- The notice row therefore carries **a copy of what was last said** — the shoot and project labels,
  the date, the place, the service — so a "do not travel" message can be composed when there is no
  longer a readable plan to compose it from. These copies are copies, in the Rule 5 sense: the
  relation is the authority wherever one is still readable.

### 6.8 A vendor with no usable number

Not a send that fails for ever, and not one that retries for ever either. The notice row carries a
**"needs a number"** marker, separate from "told": the sweep sets it, stops trying, and the vendor
appears in the Settings waiting list (§6.9) beside the blocked senders — because that list is the only
place a stuck message is visible. The moment somebody saves a WhatsApp or mobile number on the vendor,
the marker clears and the message goes on the next sweep. A marker is not "told", so nothing is lost
by the delay.

### 6.9 The Settings panel

Settings → Project Management keeps one panel, now covering both arms:

- The **on/off switch** per arm: the employee notice and the vendor notice are switched
  independently, so the studio can take vendors live without touching what already works.
- The **"Who sends it"** card stops being a picker. It explains the rule in a line — each project's
  own Production Manager, each project's own Pre-Production Coordinator — and then lists **what is
  waiting**, which is the only place a stuck message is visible and therefore goal 4. The list has to
  cover every reason a message cannot go, and say which it is:
  - the project names no Production Manager / no Pre-Production Coordinator at all (both columns are
    nullable);
  - the named employee has no login (`User.linkedEmployee` is nullable), or the login is inactive, or
    Allow WhatsApp is not ticked, or their chat switch is off;
  - the login is all of those things but the WhatsApp is not connected right now;
  - the vendor has no usable number (§6.8).

  The first two are a studio data problem and the third is a phone problem, so the line says which so
  the right person goes and fixes it.
- Last sent, and the last error, stay as they are.

### 6.10 Access control

- The existing `SETTINGS / Shoot Crew Notice` permission covers the panel, both arms — the sender is
  no longer chosen there, so the vendor arm is not more privileged than the employee arm. Do **not**
  mint a second Settings permission for it.
- The six wordings answer to `SETTINGS / Message Template`, like the two that exist.
- No new permission is needed. If the implementer concludes one is, it is `SUPER_ADMIN` only in the
  migration, every other role `DISABLED`, and the changelog says which roles the studio might want to
  grant it.

### 6.11 Tests

- The owed-list rules: a Waiting vendor is owed nothing; a confirm inside the quiet window is not yet
  owed and is owed once it is past; the reminder and the confirm are both owed; each of the three
  change kinds picks its own template; two changes at once send one message; Confirmed → Waiting is a
  removal.
- The sender rule: resolves to the project's manager; waits — writes nothing, sends nothing — when
  they are not connected, when they have no eligible login, and when the project names nobody at all;
  two projects in one sweep send from two different phones.
- A vendor confirmed three weeks out is owed the confirm message now, not in nineteen days.
- A vendor already told is owed a removal when the shoot is deleted, when the plan goes back to HOLD
  or has its submission cleared, and when the seat loses the vendor — each composed from the copies on
  the notice row, with no readable plan.
- A vendor with no number is marked rather than retried, and the mark clears when a number is saved.
- Switch-on back-fills nothing: with confirmed seats already in place, the first sweep sends none of
  them a confirm message.
- The claim: two concurrent sweeps send one message, as `project_shoot_crew_notice` is already tested
  for.
- The employee notice's existing tests must still pass with the sender changed — run
  `backend/test/shoot-crew-notice.test.js` first and keep it green.
- Frontend: the panel's two switches, and the waiting list.

---

### 6.12 The WhatsApp Activity Log

`whatsapp_activity` links a message to a project, a lead, an employee or an image-selection project —
there is no vendor column and `RECIPIENT` has no `VENDOR` kind. Left alone, a vendor send logs as a
masked number with no vendor behind it, so the log cannot be filtered or re-sent by vendor. Add the
vendor link and the recipient kind in the migration; a notice the studio cannot audit is half a
feature.

## 7. Left to the implementer

- **The table.** A sibling of `project_shoot_crew_notice` holding, per production and per vendor seat,
  the part-digests of what was last sent and when the confirm and the reminder went. Its shape, its
  unique key, and whether the two timestamps are columns or a small kind-plus-time pair are the
  implementer's call — the behaviour above is what must hold.
- **Where the code sits.** The intent is one module with two arms, sharing the date and time wording,
  the claim-before-send pattern and the plan read, rather than a copied `vendor-shoot-notice/` module.
  Exactly how to factor that out of today's `due.js` / `sender.js` is the implementer's.
- The exact default wording of each of the six templates.
- Whether the waiting list is computed on each panel read or alongside the sweep.
- Pacing numbers beyond the existing ones, within the constraint in §5.

## 8. Calls I made that the user did not

Each of these is mine, not theirs, and any of them can be overruled:

1. Part-digests rather than one digest (§6.2), and date-before-place-before-service when two change
   at once — the user asked for six templates, not for how to tell them apart.
2. One message, not several, when several parts change at once.
3. The confirm and the reminder both go; a vendor confirmed inside the two days gets no back-dated
   reminder.
4. Confirmed → Waiting counts as a removal.
5. The vendor's WhatsApp number before their mobile number.
6. Two independent on/off switches rather than one.
7. Retiring the sender picker and the `SHOOT_CREW_NOTICE` sender policy instead of leaving it inert.
8. No new permission; the existing `SETTINGS / Shoot Crew Notice` covers both arms.
9. The wordings are templates under Settings → Templates — the user confirmed this when they said it
   belongs on the template page.
10. A vendor already told is chased when the shoot or its plan goes away (§6.7), and the notice row
    keeps a copy of what was last said so that message can be composed at all.
11. The "needs a number" marker and its self-clearing (§6.8).
12. The vendor link and `VENDOR` recipient kind on `whatsapp_activity` (§6.12).
13. The wider horizon for the vendor sweep (§6.1) — a consequence of the user asking for the message
    thirty minutes after the confirm, but the two-day-versus-wider reading was mine.

**Decided by the user, not by me** — do not revisit these without asking them: the six templates and
what each is for; the sender being the project's own Production Manager and Pre-Production
Coordinator; no fallback sender for either arm, even where the project names nobody; the wordings
living on the Templates page; no back-fill at switch-on; one message per shoot.
