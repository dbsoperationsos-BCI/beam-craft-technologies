# DBS-Operations-OS Project State

**Last updated:** 2026-08-12

This is the complete master handover/state document for DBS-Operations-OS. If Codex, any AI agent, or a new developer reads only one project file, start here. Read the root [README](../../README.md) next for additional setup notes.

## Product Vision

DBS-Operations-OS is the internal ERP / Operations OS for Don't Blink Studioz.

It is not only a CRM and not only an HRM. It is a web-first operations platform for employees, onboarding, sales, project management, pre-production, production, post-production, technical workflow, image selection, and future modules such as attendance, salary, assets, inventory, accounts, and reporting.

The product direction is an integrated internal operating system where each department works from the same source of truth, with business IDs, workflows, approvals, and module handoffs controlled by the backend.

## Finalized Stack

Frontend:

- Next.js 16
- React 19
- JavaScript
- Tailwind CSS
- TanStack Table
- Custom reusable UI components

Backend:

- Node.js
- Express.js
- REST APIs
- JWT authentication
- bcrypt / bcryptjs
- Prisma ORM
- MySQL 8
- Zod where used
- Nodemailer

Database and tools:

- MySQL Community Server
- MySQL Workbench Community
- Prisma Migrate
- Prisma Client
- Optional Prisma Studio

Deployment:

- Hostinger VPS
- Ubuntu 22.04
- PM2
- Nginx
- Let's Encrypt
- GitHub `main` branch

## Architecture

Runtime flow:

```text
Frontend -> Backend REST API -> Prisma Client -> MySQL
```

The frontend never connects directly to MySQL. All database access must go through the backend API.

The backend owns authentication, authorization foundations, validation, business rules, soft delete behavior, ID generation, and database writes. The frontend may preview or display data, but the backend is the final authority for persisted state.

All database schema changes must go through Prisma migrations. Do not manually edit the MySQL schema and do not use `prisma db pull` as a shortcut for application development.

## Local Development Setup

Default local ports:

| Service | URL |
| --- | --- |
| Frontend | `http://localhost:3000` |
| Backend | `http://localhost:5001` |

Environment files:

- `backend/.env` contains `DATABASE_URL`.
- `frontend/.env.local` contains `NEXT_PUBLIC_API_URL=http://localhost:5001`.
- Never commit `.env` files.

Local development uses a local MySQL database, not the production database.

The current Mac setup may use MySQL at `127.0.0.1:3307` with socket `/tmp/dbs-mysql.sock`. Other developers may use the standard MySQL port `3306` if their `DATABASE_URL` and local server match.

Local Super Admin seed:

- Email: `admin@dontblinkstudio.com`
- Password: `Admin@12345`

## New Developer Quick Start

Install:

- Git
- VS Code
- Node.js 20 LTS
- npm
- MySQL Community Server
- MySQL Workbench Community
- Chrome
- Codex extension if used

Standard flow:

1. Clone the repository.
2. Check out a feature branch from `main`.
3. Copy environment examples into local env files.
4. Create the local MySQL database.
5. Run `npm install` in the backend and frontend as required by the repo scripts.
6. Run `npx prisma generate` from the backend.
7. Run `npx prisma migrate dev` locally from the backend.
8. Run `npm run seed` from the backend.
9. Start the backend on port `5001`.
10. Start the frontend on port `3000`.
11. Log in with the local Super Admin credentials.

On Windows, use `copy` instead of `cp` when copying env example files.

Never commit `.env`, `.env.local`, production secrets, database passwords, JWT secrets, SMTP credentials, or any other private configuration.

## Git Workflow

- `main` is production-safe.
- Developers work in feature branches.
- Do not push directly to `main`.
- Use PR/review before merge.
- New developers must not deploy to the VPS.
- The VPS pulls only from `main`.
- Keep documentation-only changes separate from code/schema/deployment changes when possible.

## Production Deployment

Production infrastructure:

- Frontend URL: document the approved production frontend URL here when confirmed by the owner.
- Backend API URL: document the approved production backend URL here when confirmed by the owner.
- VPS provider: Hostinger VPS.
- OS: Ubuntu 22.04.
- VPS project path: document the exact path here when confirmed by the owner.
- Process manager: PM2.
- Reverse proxy: Nginx.
- TLS: Let's Encrypt.
- Source branch: GitHub `main`.

PM2 apps:

- Frontend PM2 app name: document the exact name here when confirmed by the owner.
- Backend PM2 app name: document the exact name here when confirmed by the owner.

Safe deployment flow on VPS:

```bash
git pull origin main
cd backend
npm install
npx prisma generate
npx prisma migrate deploy
npm run seed
pm2 restart <backend-app-name>
cd ../frontend
npm install
npm run build
pm2 restart <frontend-app-name>
pm2 status
```

Use `npx prisma migrate deploy` on the VPS. Do not use `npx prisma migrate dev` in production.

Do not expose production secrets in this file, in commits, in screenshots, in chat, or in PR descriptions.

## Old WhatsApp Automation Safety

The old WhatsApp automation is separate from DBS-Operations-OS.

Do not touch, delete, rename, move, or clean up old WhatsApp bot folders, WhatsApp session folders, browser session folders, QR/session cache files, or related automation artifacts unless the owner explicitly requests that work.

This safety rule applies even if those folders appear unused or unrelated to the current ERP app.

## Current Module State

Authentication:

- Super Admin login.
- JWT authentication.
- Technical employee login foundation.
- Sign out flow.

HRM:

- Employee Repository. **It shows the people who are yours.** Everybody holding the permission sees
  themselves and everybody reporting to them, at any depth; a holder of `ADMIN / Branch
  Administration` also sees everybody in the branches their roles reach — matched on the branch
  reference **or** Work Base Location **or** Current Work Location, any one of which is enough, so
  somebody based in one branch and posted to another is reached by both. A Super Admin is narrowed
  by nothing. Editing, deleting and reactivating are held to the same rows as the list and answer
  404. Grant Branch Administration to the roles that run HR, or an HR user who manages nobody opens
  it onto their own row alone.
- Add Employee.
- Edit Employee.
- Review Employee. Three actions: **Save Draft** keeps the corrections and leaves the submission
  under review, **Send Back** reopens the candidate's form and emails them their link (offered only
  where there is a submission behind the row) — **in that order**, and the order is the point: the
  invite goes back to the candidate and the employee moves to **Employee Submission Pending** before
  anything is sent, so a refused email costs only that the candidate has not been told. It asks with
  the message already written out — the
  same copyable wording the onboarding invite and the login credentials end on, the candidate's link
  and its expiry in it — so it can be copied before anything is sent; a refused email leaves that
  dialog close and says in a notice that the message did not go, since the message was already
  offered to copy before anything was sent and the submission is reopened either way. A refusal that
  *throws* — which is what a spent daily quota does — is answered the same way as one that reports
  itself, rather than as a server error; that holds for all three of the studio's mails, the
  onboarding invite and the login credentials as well as this one. **Approve & Next** moves on to Employee Preference.
  Only Approve & Next is a primary button. Closing this page or the Employee Preference page with
  unsaved work asks *Save draft* / *Discard* / *Keep editing* rather than discarding it — and on
  Employee Preference, Save Draft keeps the whole half-made account (username, login email, roles,
  branch, alternatives, leave approvers, permission approver, attendance regularization approver)
  until **Create User & Send Email**
  is actually pressed.
- **Edit Employee carries the Employee Preference page too**, on the same two-page rail, so an account
  can be given and looked after on the screen that owns the person. The page decides which job it is
  doing. No account yet → the create form, exactly as onboarding shows it. An account already → the
  sign-in identity is stated rather than offered (username and login email as facts, the password
  never shown), because changing an identity is Admin → User Management's; **Roles**, **Alternative**
  **Leave Approval** and **Permission Approval** stay editable and save together as one write.
  There is no draft behind an
  account that exists: **Save Changes** keeps them or nothing does, and closing with unsaved changes
  offers only *Discard* / *Keep editing*. Both endpoints are behind `ADMIN / User Management`.
  One press saves both pages — the record first, then the account, stopping on the page that
  refuses — so the button reads **Save All Changes** where Employee Details has unsaved work too.
- **Salary reviews and the six-month clock.** A review is due six months after the thing that starts
  the clock, and the same rule fills in every field that asks for one. **Next Review Date** is a
  field beside **Date of Joining** on the second page, filled in six months from it and editable —
  so an employee is onboarded with a review already scheduled. It is derived at three moments, and
  it has to be all three: when a record is **loaded** carrying a joining date and no review date,
  when the joining date is **edited**, and when the **last review row is deleted**. The first was
  missing, and only stopped being invisible when the candidate began supplying the joining date on
  the onboarding form — the date was already stored by the time Review Employee opened, nothing
  changed it, and the field sat empty until somebody touched the joining date beside it. Answering a review's
  own **Review Date** proposes its **Next Review Date** the same way. Every date it produces is a
  suggestion: once somebody has put their own date in, moving the date it was counted from leaves it
  alone rather than overwriting a decision with a default. Month-ends clamp — 31 August plus six
  months is 28 February, never 3 March.
- **Reports To is required of everybody except a Super Admin.** They are the top of the org chart
  and report to nobody, so requiring it made them name somebody who is not their manager — and that
  answer is read: the data scope walks `reports_to_employee_id` to decide whose records a person
  gets, and the org chart drew the Super Admin underneath whoever was picked. The field is still
  shown and may still be answered; it only loses its star and its refusal. Either spelling counts —
  the legacy `user.role` column or the system role named `SUPER_ADMIN` — and ticking that role on
  **Employee Preference** drops the requirement straight away, so an administrator can be created in
  one pass. No other required field is loosened, for them or anybody.
- **Each page asks for its own fields, and the press that writes them checks them.** Employment
  Details — Designation, Department, Reports To, Vertical, the two work locations, Joining Salary,
  Referred By, Date of Joining and Next Review Date — lives on **Employee Preference**, not on the
  review page. So **Approve & Next** validates the record's own fields and no longer refuses over
  ones it is not showing, and **Create User & Send Email** refuses until Employment Details is
  answered. For a while only the first half was true: the asterisks were on the fields and nothing
  read them, so an account could be created for an employee with no designation, department,
  vertical or reporting line — and because the record is only re-saved when something on it changed,
  leaving all ten untouched skipped it entirely. A refusal marks the fields, says which they are, and
  goes to the first one, **changing page if it is on the other one**. Save Draft is unaffected: a
  draft is deliberately unfinished.
- **Designation, Department and Vertical are asked, not pre-answered.** They are the studio's
  decisions and the candidate's form never asks for them, so a submission leaves them empty and
  Review Employee shows its own *Select Department* placeholder on a required field — which HR has
  to answer before the record saves. The submission used to write the words "Not Allocated" into all
  three. That is on none of the three dropdowns, and a stored value a select cannot find among its
  options is added back into the list rather than lost, so it arrived as a chosen answer: the record
  could be approved without anybody picking, and the register then held a designation no dropdown
  offers. It was also written on **resubmission**, so a candidate sent back for corrections reset
  whatever HR had already settled by pressing Submit. Designation alone is seeded once, on the first
  submission, from the invite's **Intended Designation** — which is required to send an invite at
  all — and is not re-applied afterwards.
- **The review list is Edit-only.** Add Employee and Review Employee do not show it: neither is a
  moment at which a person has salary reviews, and an empty list with an Add button invited HR to
  invent history for a hire who had not started. Both still ask for Next Review Date, which is what
  onboarding actually needs. In **Edit**, the list is a schedule and a history: **Upcoming**
  is the one date nobody has acted on — the employee's Next Review Date — with **Record this review**
  opening the dialog with that date filled in, marked when it has gone by; **Past** is the reviews
  entered, newest first, as the application's own `DataTable` — so it filters, sorts, remembers its
  columns and exports itself from the header's ⋮ (**Export CSV**, Export Excel, Freeze Columns,
  Manage Columns, Compact view) the way every other table in the studio does. The **Outcome** column
  is the shared status cell, so Shine reads green and Shadow red beside the word. A row's own ⋮
  edits or deletes it. The ⋮ is offered here where the project form's shoot list withholds it: a
  handful of shoots being built as part of a bigger answer is not a record, and a review history —
  read to answer "what has this person been paid, and when" — is exactly what somebody preparing an
  appraisal wants to export.
  **The section always shows the review just recorded.** It opens on Past whenever there is anything
  in it, and recording one moves to Past as it is added. It used to sit on Upcoming — a scheduled
  date, never a review row — so a review just entered landed behind the other tab with only a count
  to say anything had happened. That read as a dialog that did nothing, and it is why reviews were
  then abandoned unsaved: the panel's own **Update** is what writes them, and nobody presses Update
  on work they believe was thrown away.
  **The dialog records one review.** It used to carry a queue — *Add Review List* built up a list
  inside it and Save committed the lot — which was a second list on a screen whose subject is a list
  of reviews, and asked somebody recording one review to press two buttons, the first of which
  looked like the one that saves. **A review may
  be dated on any day, past or future** — the studio records reviews it has scheduled as well as ones
  it has held, and the restriction to today-or-earlier also refused the very date *Record this
  review* handed over, which is by definition still to come.
- **Shine and Shadow.** Each review carries how it went — **Shine** or **Shadow** — chosen in the
  dialog beside the Review Date, and the list shows it as a named chip *and* as the row's own
  colour: Shine tints the row green with a green edge, Shadow tints it rose with a dark red edge. A
  review nobody marked carries neither, which is why there is no third middle option: unmarked
  already means "nobody said", and an "Average" would have been an opinion the list invented.
- **The client's word sits on the same timeline.** An employee a client **appreciates** in a Production
  Completion Feedback shows on their review timeline as a **Shine**, and one the client was **not
  satisfied** with as a **Shadow** - a dashed card on that side, in date order, marked Client feedback
  with the project and Feedback ID, and counted at the top ("Client feedback: 2 Shine · 1 Shadow").
  Which project and Feedback ID a card came from is shown only to a reader who also holds
  PROJECT / Feedback; anyone else sees the Shine or Shadow and its date.
  Read from the feedback with the employee record (`clientFeedback`), never written into the salary
  reviews, so it cannot be edited or deleted there and never moves the salary.
- **The increment is optional.** Reviews are held without a figure — a confirmation, a year with no
  raises, a conversation minuted before the number is agreed — and requiring one meant typing a `0`,
  which is a real increment of zero and counts as one in the employee's totals for ever. An empty box
  is stored as null and adds nothing to the totals; a typed `0` is still a `0`. The list shows the
  first as `—` and the second as `0`.
- Once an employee has reviews, the latest review's Next Review Date *is* the schedule: the Personal
  Details field follows it and is shown but not editable, and the server derives the same value from
  the rows. With no reviews, the field is the only place the schedule exists and is stored as
  submitted.
- Onboarding invite. The candidate's link is a short code URL (`/onboarding/apply/<code>`),
  rebuilt from the stored code on every read — Copy Link works from the invite list at any time,
  and reading the invite list requires HRM → Employee Management. Links from before short codes
  keep working through their long token. **Send Invite closes the dialog and says so on the page
  behind it**: sending the link is the last thing that card is open for, and it used to stay up with
  a disabled button reading "Invite Sent" and nothing left to do but press Close. A failure still
  stays on the card, where the Copy Link fallback is.
- **A refused onboarding submission goes to the problem.** The candidate's form is eight sections
  long and is filled in on a phone: it marked the offending fields and raised a notice at the top
  ("Please fill in all required fields"), then left the reader standing at the Submit button they had
  just pressed, which restates the complaint rather than answering it. All five refusals — the
  agreement, a missing required field, a bad format, the age rule and an unfinished row in one of the
  repeating lists — now mark, say why, **and scroll to the section holding the first of them**. The
  same move HR's own form makes when it refuses, through the same `data-schema-section` anchor.
- Approve & Onboard.
- Technical credential creation. It has no **Skip for now**: creating the login is the point of the
  page, and a button offering to walk past it sat where the eye goes first. Nothing is trapped by
  its absence — the panel's × closes the page, the employee is already saved by then, and the ⋮ on
  an Active employee with no login opens this same form whenever it is picked up again. The
  **username** is the employee's name in the order it is
  written, joined by dots — `john.smith`, and `dhanush.m.m` for a given name followed by initials,
  which is why it is not surname-first: the trailing word in the studio's own names is an initial,
  and leading with it produced usernames beginning with a bare letter. A one-word name is used as it
  stands. It is not unique by construction — the employee id that used to
  make it so is gone — so two people sharing both names collide, the API refuses the second, and the
  field is edited to something else. The **login email** is **built from the same name**, not asked for:
  `john.smi@dontblinkstudioz.com` — the first name, a dot, and the first three letters of the last
  (`lib/employeeName.mjs`). A last name shorter than three letters gives what it has, a one-word name
  has no last part and no trailing dot, and like the username it is editable and not unique by
  construction, so two people sharing a name collide and the API refuses the second. It used to be
  the employee's **Work Email ID**, typed here and filed back onto the record — which made a studio
  sign-in depend on somebody typing a studio address correctly, and on there being one at all.
  **Work Email ID is no longer asked for anywhere**: not on Add Employee, Review or Edit, not in the
  employee import, and the credential no longer writes one back. The column and the addresses already
  in it are untouched; the meeting dialogs still prefer a recorded work email and fall back to the
  personal one.
- **HRM → Request.** Leave, permission and **comp-off** requests on one screen: **Waiting for me**
  (the requests this login is named an approver on, or all of them for `HRM / Attendance Approval`)
  and **My requests** (one's own, with Raise). A comp-off is a working day off for a **weekly off**
  (Attendance Rules → Weekly off) or a **declared holiday** that attendance shows was worked a **full
  day** - Attendance Rules' Full day, from login to logout less the time logged out; a shorter day, or
  one never logged out of, earns nothing - taken within **Comp-off expires after
  (days)** of the day worked where Attendance Rules → Comp-Off sets one (0: never expires; the picker
  says each one's "Use by" date and drops an expired one), decided by the same three
  Leave Approvers as a leave; approved, the day reads On leave and takes nothing from Casual Leave.
  It is raised as **Leave → Leave Type: Comp-Off** (beside Casual Leave and Loss of Pay), no longer a
  Request Type of its own; it is still stored as `COMP_OFF`. **The day worked has to be approved
  first:** a full day logged on a weekly off or holiday from `compOffApprovalFrom` (the day the rule
  went live) on raises a **Comp-Off Credit** request by itself - to every Leave Approver, all of whom
  must approve, a rejection settling it - showing the day, login, logout, hours worked and where its
  comp-off stands. Only once approved is the day a comp-off (the balance, the picker and the server's
  check all read it), exactly once per day worked; pending or rejected it is never one. Nobody can
  raise, edit, revert, delete or send back a credit. Days worked before the rule went live earn as before.
  **How much a worked day earns is the approvers' to decide**, not a fixed day: the credit's dialog asks
  "How many days does this earn?" - 0, 0.5, 1 and up in half steps to the days the credit covers - and
  the request is granted the **lowest** amount any approver chose, so an approver who thinks a run was
  worth less says so with a number instead of refusing it. `0` grants nothing without being a rejection.
  Because there is no half day off to take, **a day off costs one whole day of credit**: one worked day
  granted a whole day, or **two half days claimed together** (`compOffCredits.claimableUnits`), which is
  what Raise Request offers - days off, not worked days, a pair shown as one choice with both days under
  it. A lone half day is shown as waiting for another half rather than hidden. The day off falls after
  the **later** day worked and expires on the **earlier** one's clock; a credit covering a run shares its
  grant out in half days from its earliest day, so no amount is ever a quarter nothing can spend. A
  credit approved before amounts existed is read as the whole run, the rule it was earned under.
  A **permission** is limited by Attendance Rules → **Permissions**: **Longest permission (minutes)**,
  and **Permissions allowed per month** - or per **pay cycle**, counted by the same choice as Casual
  Leave - where 0 is no limit. Pending, sent back and approved ones count in the period their date falls
  in; a request past the limit is refused, saying the period. The Permission form says "Permissions in
  October 2026: 1 of 2 used" before it is raised. Its own permission, `HRM / Requests`. (The rules
  above are set in Settings → Employee → **Attendance Rules**, whose four sections - Working day,
  Casual Leave, Permissions, Comp-Off - **each save on their own**, with a Save at each section's foot,
  on only while that section has changes: a save sends that section's fields alone, the server reads
  the rest as stored and checks the section against them, and what is being typed in another section
  is kept.)
  - **The lifecycle.** Six statuses - Pending, Send Back, Approved, Rejected, Reverted, Deleted -
    with a **Send Back** tab beside Pending; Reverted, Deleted and the older Cancelled rows are
    found under All alone, so Rejected counts refusals and nothing else. The request's status is
    computed from its approval rows (`outcomeOf`) after every change to one.
  - **The raiser** gets View, Edit, Revert back and Delete, replacing Withdraw, Cancel Leave and
    Apply again. **Edit** reopens the raise form over the same row, runs every rule raising one
    runs, clears every answer and asks whoever the approvers are *now* - so editing an approved
    leave stops those days reading On leave until it is approved again. **Revert back** pulls it out
    of the queues and leaves it with them, editable. **Delete** marks it Deleted and deletes nothing:
    the row stays in their list and counts for nothing, since only Approved ever counted.
  - **The approver** gets Approve, Reject and Send back. A rejection may become an approval; **an
    approval may never become a rejection** - undoing one is the raiser's by editing, or HR's by
    correcting the day. Send back requires a reason, clears every answer and returns the request to
    the raiser. Nobody answers a request they raised, however they came to be on its list.
  - **An approved Checkout Correction or Attendance Regularization freezes**: approving one has
    already written onto the day - the session's checkout, or the day's status - and nothing undoes
    that, so it offers View alone and the way to change the day is a fresh request.
- Employee Attendance. Daily login and logout with selfie, server-stamped time and location; leave
  and on-duty requests decided by any one of the three Leave Approval slots on the employee's
  record, **a permission and an attendance regularization decided by the one person named in
  Permission Approval, and nobody else** — an hour out of a single day, or one day's status, settled
  the same morning it is asked for, so there is nobody to escalate to. A record with no permission
  approver named cannot raise either (the form says to ask HR, and the server refuses it); an
  on-duty or outside-location request still falls back to the three Leave Approval slots; a
  per-request event log; and an
  admin-editable working day — shift, late grace, weekly offs and full-day minutes — that every
  attendance status and hours target is worked out from, and an **Attendance starts on** date
  before which nothing is counted for anybody (no Absent, no Late, no hours owed, no
  regularization or comp-off; each person counts from it or their joining date, whichever is
  later), together with the studio's declared
  holidays, which are kept in **Settings → Holidays** rather than here. Records live in the
  database, not in browser storage. Attendance is kept against an **employee**, so a login has to be
  joined to one before it can mark a day: that is automatic for credentials created from the Employee
  Repository, and is set by hand from Administration → Users (⋮ → **Link employee**) for any account
  raised another way. An unlinked login is told so and pointed there.
  **Where somebody was** is checked, not just recorded: each branch gets a point and a radius under
  Rules → Office locations, every capture is measured against its employee's branch office, and the
  verdict — distance, whether it passed, and why not — is stored on the day and on an append-only
  `attendance_event` row holding the capture exactly as submitted. A branch with no office recorded
  has no check at all. Refusing an outside capture is opt-in and never applies where the studio's own
  configuration is the gap. **Both captures are live and required**: checking in and checking out
  each take a selfie from the live camera (there is no file input, so no gallery) and a fresh GPS
  reading with its accuracy, and each needs a capture token the server issues when the camera opens
  and refuses after two minutes, so a kept photo or a replayed request is not recorded. The
  Attendance Register shows each day's check-in selfie and the full server date-time of both
  captures. Attendance selfies are the one image
  in this application not served from the public bucket: they are stored as object keys and served
  only through a permission-checked endpoint, to the employee they are of or an Attendance Approval
  holder. **A login lasts 18 hours**, from the latest login of the day and exact to the minute — a
  login at 9:30 can be logged out of until 3:29 the next morning, across midnight (logout and breaks
  act on yesterday's session while it is inside them). It was 24, which left a day that ended at six
  in the evening reading as "at work" until nine the next morning, into the following shift. Past them with no logout an owed day reads
  **Absent** - not attended, not paid, counted with the other absences - until a Correction says
  otherwise; on a holiday, a weekly off or a day of leave it reads as the calendar says. The
  employee's attendance screen names the day and why, with Raise a correction beside it. The login is
  nobody's current session, so it never blocks the next login. It is worked out on the server
  whenever attendance is read (no scheduler), and the module never writes a logout for it. Any
  day's status is corrected by an **Attendance Regularization** request (Raise Request's fourth type,
  decided by the one **Attendance Regularization Approver** set on Employee Preference - or the
  Permission Approver where none is set - and named on Raise Request before it is sent;
  once called Correction, stored as
  `INCORRECT_LOGIN`): one date, the day's current status read by the server
  (`GET /requests/correction-day`) and shown read-only — Present, Absent, Half day, Early exit,
  Late, On leave, **Holiday** or **Weekly off** — and the status it should read as (the six working
  readings, without the current one); a day nobody logged out of is corrected from Absent. A holiday
  and a weekly off are raisable because the studio shoots on them: the form says to raise one only if
  the day was actually worked, and the approver sees that the day was off. Neither can be a status a
  day is changed **into** — which days are off is the calendar's to say. A day still logged in, and
  one attendance is not owed for, cannot be corrected. It goes to that one approver; only once the request is approved is
  the day's `attendance_status_override` row written (one per person per day, with or without a
  login, never an invented login; a `STATUS_CORRECTED` event where there is a session), and a day
  that reads differently since the request was raised is refused rather than overwritten. Every
  screen and payroll read the override before the times and the calendar; worked hours stay what
  was actually clocked - a Correction changes the day's status, not the time on record. Rejected or pending, the
  day is unchanged.
  The older logout-time Checkout correction still reads and decides but is no longer raised.
  Requests and outside-location asks are `AttendanceRequest` types rather than tables of their own,
  so they use the approval pipeline, the event log and the Approvals queue already there. Checking
  in shows a short card with the time. The daily quotes it once showed are retired: nothing reads
  or writes `attendance_quote` any more, and the table keeps the rows it holds.
- **Payroll** (`/hrm/payroll`, `HRM / Payroll`) — four sections behind a switch beside the heading,
  kept in `?section=`: **Main Page**, behind its own `HRM / Payroll Register`; **Advance Salary**,
  behind its own `HRM / Payroll Advance`; **Recovery**, behind its own `HRM / Payroll Recovery`; and
  **Policy Breach**, behind its own `HRM / Payroll Policy Breach` (each SUPER_ADMIN only to begin with).
  Advance Salary is a register of money paid ahead of salary, laid out like Recovery: Create Advance
  asks the date given, the employee by name (their Employee ID comes with them), the amount, the
  month it is taken back from ("From Month") and the reason; the server mints `ADV-ID-0001`. The
  whole amount comes off that month's payroll as its **Salary Advance** - the Main Page row takes the
  new total the moment an advance is recorded, corrected or removed, if the row is there and unpaid,
  and an advance cannot be put into, moved out of or removed from a month already Paid. Status follows
  the payroll: Pending until the month it comes off is Paid on the Main Page, Deducted from then (a
  month paid late or held keeps it Pending); All / Pending / Deducted tabs; Edit
  and Remove (with a reason, the row kept) for Read / Write. Narrowed by branch like Recovery.
  **Convert to Recovery**: with Read / Write on both Advance and Recovery, rows can be ticked - once
  one is, only that employee's - and the header offers Convert to Recovery, which asks the start
  month and number of months and makes one recovery for their total. The advances then live on
  Recovery, not here: they leave this list (kept in the database for the audit) and no longer come off
  their own months; unpaid Main Page rows follow at once. On Recovery the recovery lists them under
  From Advances, keeps its employee and total, moves its months only across unpaid ones, and has
  Undo conversion in place of Remove (needs both write permissions), which removes it and brings
  the advances back to Advance Salary. Nothing touches a month already Paid.
  Recovery is the studio's recovery sheet as a register: money an employee owes, taken back from
  salary over months. Create Recovery picks the employee by name (their Employee ID comes with
  them) and asks the total, start month and year, number of months (1-60) and reason; the server
  mints `RECO-ID-0001` and works out on every read the monthly deduction (total ÷ months), start
  date (1st of the start month), end date (start + months) and status from the payroll (Completed once
  every instalment month is Paid on the Main Page, Active until then; a Deducted column counts them,
  "3 of 5"). All / Active / Completed tabs; Edit and Remove (with a reason, the
  row kept) from each row's ⋮ for Read / Write. On both Advance Salary and Recovery one tap on a row
  shows it in the info panel beside the table and two open it full screen, read-only, as every
  register does; Edit is in the panel's header and the row's ⋮. Both show a **Payment History**
  (below the panel's details, and as its own tab full screen): deducted so far, the balance, and
  each month of the run - Deducted once that month's payroll is Paid, with the date and mode; Due
  (Pending, or not generated yet); On Hold; or Skipped. Narrowed by branch: a reader sees and writes only
  recoveries of employees in the branches of the roles granting them `HRM / Payroll Recovery`.
  **Policy Breach** is the same register for fines for breaking a studio policy: Create Policy Breach
  asks the employee, the amount, start month and year, number of months and the reason; the server
  mints `PB-ID-0001`, and the amount comes off each month of the run as the Main Page's **Policy
  Breach Deduction** (with its Policy Breach ID), added to Total Deductions and printed on the payslip
  as **Policy Breach**. It works as Recovery does - tabs, status from the payroll, Skip on the Main
  Page (the run a month longer), Payment History, branch reach through its own permission - but has
  no conversion from advances. It is separate from the Main Page's **Policy Breach Leaves**, the
  loss-of-pay days typed on a row, which still count into Total Leaves and the LOP Deduction.
  **Deduct by** (under Employee Name) chooses **Amount** - the fine above - or **LOP**, where Total
  Amount becomes **Total Days**: that many loss-of-pay days spread over the months in half days, the
  extra halves to the earliest months (10 over 3 is 3.5, 3.5, 3). Each month's share is the Main
  Page's **Policy Breach LOP Days** column, added to Total Leaves and so priced at that month's day
  rate in the LOP Deduction; it takes no amount, and its list row, details and Payment History read
  in days.
- **Payroll → Main Page** (`HRM / Payroll Register`, SUPER_ADMIN only to begin with) — the studio's
  payroll sheet as a register, one employee per month. Under the tabs it states the month's **pay
  cycle** (the days its rows were worked out over) and the day it is
  **payable**, both from Payroll rules. A payroll month is named for the month it is paid in:
  October's is the cycle that ended in September (25 Aug - 24 Sep), payable on 10 Oct. There is no
  Generate or Refresh: **a month brings itself up to date as it is opened** (or the page reloaded), by
  somebody with Read / Write. The **month still being paid** - until its payable date passes, so
  October until 10 Oct and November from the 11th - and every month after it get a row for every
  working employee and have every row not paid or frozen read again; an **earlier month is left as it
  was**, filled in once only where it has no rows. **A month has no payroll until its pay cycle has
  ended**: November (cycle 25 Sep - 24 Oct) shows nothing, and gets no rows, until 25 Oct - the table
  says "November 2026's payroll is made after its pay cycle ends on 24 Oct 2026 - from 25 Oct 2026",
  and rows made for it earlier are not shown before then. The header says which ("Up to date",
  "Earlier month - not updated", "Made from 25 Oct 2026, after the pay cycle ends", or "Not updated -
  showing stored figures" after a failure). A row holds: base salary (the employee's current salary), attendance leaves
  (loss-of-pay days - absences, half days as half - over the pay cycle, the cycle day of the month
  before to the day before it, 25 Apr - 24 May for June), the cycle's working and calendar days, and
  the salary advance from Advance Salary (with the Advance IDs), and the recovery due from Recovery.
  **Attendance Leaves** is every day away in the cycle - absences, half days as half, and approved
  leave - and **Casual Leave Taken** beside it is the leave the Casual Leave balance covered (paid;
  with no Casual Leave set, all of it), brought in and never typed. **Total Leaves** - the loss of pay -
  is Attendance Leaves and Policy Breach Leaves less Casual Leave Taken, never below 0.
  **Before Joining** counts the pay cycle's days before an employee's joining date - working days
  where a day's pay is over working days, calendar days where it is over calendar days or a fixed 30 -
  and Total Leaves adds them, so somebody who joined part-way through a cycle is paid only for the part
  they were employed (30,000 over 25 working days, joined with 13 to go before: 14,400). Nobody gets a
  row for a month whose pay cycle ended before they joined. A **leaver** keeps their last, part month:
  anybody relieved on or after a cycle's first day gets its row, **After Relieving** counts the days
  after their relieving date the same way, attendance stops counting at that date, and they are paid
  up to their last day. **Base Salary** is the employee's **Total Salary** as it stands after their
  reviews, brought in afresh every month; it can be edited on the row, and the edit is that month's
  alone - the next month starts from the Total Salary again. A row
  **removed** on the page is kept and marked, with who and why (a reason is asked), so the month's
  update does not add it back; **Removed rows** lists them with Restore. A paid month is never
  reworked: a late change to a closed month is not carried into a later one (there is no Prior Month
  Adjustment), and Net Salary is Total Earned less Total Deductions.
  **Comp-Off Taken** (approved comp-off days off in the cycle), after Casual Leave Taken, is brought in
  and shown only: a comp-off is never paid for and never taken off - the day worked is a paid weekly
  off or holiday, and the day off is paid like a working day, outside Attendance Leaves.
  **Extra columns** added in Settings → Payroll rules sit in place - an earning after Incentive,
  a deduction after Other Deductions - typed per row and counted in Total Earned or Total
  Deductions; an archived one stays on the months that hold an amount for it. Removing one clears
  its amounts from unpaid months; one a paid month holds can only be archived. Incentive, policy breach leaves (typed for now), other deductions,
  remarks and the payment (status Pending / Paid / On Hold, mode, the account paid
  from, date, remarks) are typed, and **Cost Centre** - after Freeze in the Payment band - books the
  row to one of the organisation's active branches (a link to the branch; empty until chosen,
  editable like the rest of the payment). Total earned, total leaves, LOP (a day's pay × total leaves), total
  deductions, net and rounded salary are worked out under **Settings → Employee → Payroll rules**
  (which also holds the Attendance calculator - the pay cycle and payable date, administrators only) -
  a day's pay is the base salary over the cycle's working days, calendar days or a fixed 30, rounded to
  the nearest ₹10, ₹1 or down to ₹1 (changed only by somebody reaching every branch). A Paid row's
  figures are settled until it is set back to Pending, and it keeps the rules it was paid under. A
  change to the rules - the salary rules or the Attendance calculator's cycle and payable days, each
  saved with its own Save - applies from the payroll month whose cycle is running (on 9 Oct, November's) on; every earlier month - the one being paid now among them, generated
  or not, paid or not - keeps the rules it had. A change to attendance, Attendance Rules or Payroll
  rules reaches the month still being paid and every later month the next time each is opened - their
  unpaid, unfrozen rows read again (salary, attendance leaves over the pay cycle as it is set now,
  advance and recovery) - while an earlier month keeps its figures. A **Base Salary or Attendance
  Leaves typed by hand** on a row stays as typed through every update - its form says so, with **Use
  the calculated figures again** - and an update never writes over a figure typed while it ran, nor
  rewrites a row whose figures did not change; paid and frozen rows stay settled. Rows are made no
  further ahead than the month after the one being paid. A removed row comes back with the month's
  next update while the person is a working employee.
  **Hold salary during notice** (Payroll rules, off by default): a resignation recorded while it is
  on holds the leaver's unpaid months payable from the resignation date on, and the month whose pay
  cycle holds the last working day is their **full and final settlement** - its Final Settlement
  column, Mark Paid total and payslip carry its own salary plus every held month's. Held months
  cannot be paid alone; paying the settlement pays them with it, and setting it back to Pending
  reopens them. Paid months and anybody not held are never touched; a withdrawn notice or a rejoin
  releases the hold (`payroll-register/noticeHold.js`). The Offboarding Confirmed message names the
  settlement date (`{final settlement date}`, `{salary hold}`).
  **Skip** beside a row's Salary Advance or Recovery Deduction (with Read / Write on Advance or
  Recovery too, and not on a paid month) leaves that month's deduction out: the advance comes off the
  next month instead (its From Month moves on), the recovery's instalment is left out and its run ends
  a month later. The cell then reads Skipped, with Undo; Advance Salary and Recovery list the months
  skipped. A paid month a skip would change refuses it.
  **Freeze** (a switch first in the Payment band, before Payment Status, for Read / Write) settles a row before it is
  paid: its figures stay as they are - no edit, no Refresh, no advance, recovery, skip or conversion
  reaching it, and the salary rules of the moment it was frozen - until it is unfrozen; its payment
  can still be recorded, and it cannot be removed while frozen. Until a frozen month's **payable date**
  has passed, it also holds its employee still: no **Attendance Regularization** for a day in that
  row's pay cycle (the form says so as the date is picked, and Change To stays locked), and no new
  **Salary Advance** or **Recovery** for them - nor a Convert to Recovery - said on the Employee field
  as they are picked (marked "payroll frozen" in the list, Create off). Correcting an existing advance
  or recovery is not held, nor is approving a regularization raised before the freeze. From the day
  after the payable date, both work again.
  Tick boxes on unpaid rows (with `ADMIN / Table Select All`) offer Export, and for Read / Write
  **Mark Paid** - the ticked rows paid with one mode, date and account, each checked as one marked
  by hand, a refused one named with why - and Delete.
  Not linked to Accounts: marking a row Paid records nothing there.
- **Attendance Register** (`/hrm/attendance`) — the whole studio's day, opened by
  `HRM / Attendance Approval`. A roster rather than a list of sessions: one row per active employee
  whether or not they marked anything, so it can answer who has not checked in. Its headline cards -
  **Present**, **Available** (working at this moment: logged in and not out, not on a break and not
  inside an approved permission's window - today only), **Leave**, **Permissions** (inside an approved
  permission's window right now) and **Break** (on a break right now; a break
  already over is not counted) - each narrow the table to their people, and the table's
  Permission and Break columns show each person's permission times and break time, with On break
  while one runs. Below Today's Attendance sit two lists, side by side from a tablet up:
  **Irregularities** - whoever is Absent with no approved leave, comp-off or permission (the
  register's `irregularities`), with a leave or comp-off still pending said beside it; somebody
  allowed a flexible shift is only judged once their day is over, so they are listed for the day
  before, never for today - and **Request** - the requests waiting on this login's answer, the same
  list as "Waiting for me" in Leave or Comp-Off Request (`awaitsMe`), with Open going there. Seven counts across
  the top, filters for date, branch, status and a name/ID/department search, and a per-day detail
  showing both captures with their photographs, coordinates, accuracy, distance from the office, the
  device, and any corrections asked about that day.
  Statuses are On time, Late, Permitted, Half day, Early exit, Not logged out, Yet to log in (today,
  before the shift starts, with no login yet - neither absent nor present),
  Absent (no login once the shift has started, or a login nobody logged out of within 18 hours), On leave, Holiday and Weekly off (and Present, for a day a Correction
  corrected) — one field, read in that order of consequence. A closed day worked from **Half day
  from** (Attendance Rules) up to, not including, the **Full day** is a Half day, whether or not it
  was also late or cut early; under Half day from it reads Absent; Late and Early exit are said only
  of a day that reaches the full day. An approved permission that covers every shortfall - the late
  arrival, the early departure, or both - keeps a short day from being a Half day or Absent: it reads
  Permitted. Logging out
  early is warned in the Logout box before it is confirmed - "If you log out now, your attendance will
  be marked as Absent / Half day / Early exit" - and the "You're logged out" box after it says what
  the day was marked as, or "Successfully logged out". **Casual Leave** (Settings → Employee →
  Attendance Rules): every approved Leave is Casual Leave. Each employee is credited the **days per
  month** set there at the start of every month, from their joining month (or the month attendance
  starts being counted, if later); leave on a working day takes from that balance in date order, and
  a day beyond it is still allowed but is **Loss of Pay** - the attendance calculator adds it to the
  loss-of-pay days the payroll register deducts; a leave day the person logged in on anyway takes
  nothing. **Carry unused leave to the next month** on builds it up through the year, and on 1 January
  at most **Days carried into the next year** carry over (0: all lapse); off lapses each month's at its
  end, December's too. **Count Casual Leave by** chooses what a month is: the **calendar month** (the
  1st to its last day; the year turns on 1 January) or the **pay cycle** of Payroll rules (October's
  payroll is 25 Aug - 24 Sep with the cycle on the 25th): each cycle credits the days, a leave day
  counts in the payroll month whose cycle holds it - the one that pays or deducts it - and the leave
  year follows the payroll year, turning with January's payroll (25 Nov). Changing the policy re-counts every
  balance from the start, so the save is confirmed first. 0 days a month is no Casual
  Leave - every approved leave paid, as before. Nothing is stored per employee: the balance is worked
  out from approved leave each time it is read. The Leave form (the quick dialog and HRM → Request)
  shows the balance, any leave waiting for approval, and how many of the chosen working days would be
  Loss of Pay. Every **Leave asks its type** - **Casual Leave (CL)** or **Loss of Pay (LOP)**, nothing
  chosen for the person: CL takes from the balance as above; LOP never touches it and every day of it
  is unpaid (the form says so in place of the balance). Leave raised before the choice existed is CL.
  Request lists show it - "Leave (CL)", "Leave (LOP)". On the form the type is asked under the dates,
  and under it the leave's **days** - working days only: a weekly off or a holiday the studio declared in
  the range is not a day of leave and is named ("Leave days: 2 days - Sun 11 Oct (weekly off) not
  counted") - then **Available CL**, then the Loss of Pay warning or note. Request lists count a leave's
  days the same way. The administrator's **Attendance → Dashboard** carries **Permission** as a headline
  card of its own, beside Absent: somebody with an approved hour or two off is read against Absent on a
  day their session falls short, and the figure alone could not tell the two apart. It counts the days a
  permission was taken over the range, carries an arrow like the rest, and - the cards being filters on
  the Employees table rather than links - pressing it lists exactly those people, most first; the
  Employees table and the Day by Day strip each carry the figure as a column next to Absent. Approved
  time off, so a rise is neither good nor bad. The same Dashboard ends with three cards - **Casual
  Leave**, **Permissions**, **Comp-offs** - listing who used each over the range and filters applied
  (approved only; Casual Leave and comp-offs in working days, permissions with their total time), the
  most first, each with their branch and days; one card to a row on a phone, two on a tablet, three
  on a wide screen. The employee's own **Attendance → Dashboard** opens on **Your attendance** - the
  days the range owed and how each went (Working days, Present, Late, Half day, Early exit, Absent, On
  leave), with "157h 17m worked of 127h 30m expected" beside the title. A Half day counts as **0.5
  present and 0.5 absent** there and on the administrator's Dashboard (cards, day-by-day and
  per-employee figures), while Half day keeps its own count and the day itself still reads "Half
  day" on the calendar and the register (`dayShares` in `attendanceRules.js`); it was headed "How the range
  went", which named nothing in it and read as a verdict on the range rather than the reader's own
  record. Under it is an
  **Available to take** card: the Casual Leave balance (with leave awaiting approval), the permissions
  left this month or pay cycle against the limit, and each **day off** still claimable with the day or
  two days worked that pay for it and its Use by
  date (the first three, soonest first; one within a week says how close; a half day waiting for
  another half is named below them) - Casual Leave and
  Permissions side by side on a phone and a tablet, comp-offs below; one row on a laptop and up. It
  reads what the Raise Request form reads, so the two never disagree. **Ledgers** keep a stored record of each employee's Casual Leave
  (`casual_leave_ledger`, a row per month or pay cycle: opening, credited, taken, Loss of Pay,
  closing), permissions (`permission_ledger`, a row per request with its period, minutes and whether it
  counts toward the limit) and comp-offs (`comp_off_ledger`, a row per weekly off or holiday worked a
  full day: what it **earned** (1, 0.5 or 0, as its approvers granted), hours, expiry,
  Available / Claimed / Used / Expired - and both days a claim spent read Claimed), for history and audit. The rules
  stay the truth; an employee's rows are written again after any change to their requests or a logout,
  and everybody's after Attendance Rules or the holidays change. Where a
  day was worked (Office, Work from home, Field work) sits beside the status rather than inside it.
  **Flexible Shift** is a fifth work mode, a full-width button under the other four, offered only to
  an employee HR has ticked **Allow Flexible Shift** for (Employees → Login Credentials, its own
  section beside Exclude From Attendance; off for everybody until ticked, and the server refuses a
  Flexible Shift login from anybody else). They log in at any hour, and the day is judged on its
  hours from login to logout alone, by the same Half day from / Full day band: under the floor
  Absent, under the full day a Half day, a full day **Present** - never Late or Early exit. With no
  login yet, such an employee reads Yet to log in for the whole of today rather than Absent from the
  shift start; a past day with no login is still Absent. The mode is the day's first login's - a
  login again after a logout keeps it, and the Login box then names that mode rather than offering
  the mode buttons (for every mode, not only Flexible Shift).
  The employee's own screen carries a totals strip with working days and a calendar of the range.
- **Employee Referral** (`/hrm/employee-referrals`) — who the studio owes a referral to, and what
  has been handed over. **Not a sidebar entry**: it is reached from the switch beside the Employee
  Repository heading, alongside Users and Roles, which is where the four screens about the studio's
  people and their access now live. The switch lists only the ones the reader's roles open, and
  where that leaves one it prints that screen's name instead; the sidebar's single
  **Employee Repository** row opens the first of
  them the reader may read, so a role granted the register and not the repository still has a way in. A referral is recorded by naming a **Referred By** on an employee's record —
  an optional field, because most hires are not referred and requiring it meant answering it with
  somebody who had not; leaving it empty records no referral, and clearing it — the **None** row at
  the top of the picker's menu, which every optional dropdown offers once it has been answered —
  removes the referral and its outstanding instalments, unless an instalment against it has already
  been paid, which is refused and said so. The studio pays it in instalments counted from the referred
  employee's joining date — the third and sixth month to begin with, and **however many months the
  studio sets in Settings**. Each referral carries a **Referral ID** of its own — `DBS-REF-000001`, one run for
  the whole studio, minted when the referral is recorded. The screen is one row per referral — that
  code, the referred employee and their ID, who referred them, their joining date, the referral amount, a column for each instalment reading its figure and
  whether it is due, overdue or paid, what is still outstanding, and the referral's own status — with
  the table's usual sorting, filtering, column visibility and CSV export, an info panel beside it,
  and tabs for **All**, **Outstanding** and **Settled** — the chosen tab is remembered per login, so
  a reload comes back to what was being worked through rather than to All. **An instalment is paid
  one of two ways, each settling it once.** By hand, on the row's **⋮ → Mark 3rd month paid / Mark
  6th month paid** (only with Read / Write; only an instalment still Pending, never a stopped one),
  for money handed over outside payroll — cash or a transfer — after which payroll leaves it out,
  since it carries only what is still Pending. This was taken out on 25 Oct 2026 and brought back on
  4 Nov 2026 at the studio's request. The same ⋮ has **Delete** (and ticked rows a bulk Delete), only
  while nothing on the referral has been paid — a paid instalment is a record of money that left the
  studio. Or **through payroll**: it lands on Payroll → Main Page as the referrer's
  **Referral Bonus** (an earning, after Incentive, with the **Referral ID** beside it) in the month it
  falls due, and paying that month is what records it as paid here - against that row, so setting the
  month back to Pending owes the instalment again, and a month can only be paid with the referral
  figure it was worked out with (a referral added or somebody relieved since asks for a Refresh first).
  **An instalment reaches payroll only where both people are still working** — the referrer, because
  the money is theirs and there is nobody to pay once they have gone, and the employee they referred,
  because the bonus is for that person staying.
  **When either of the two leaves**, their statuses alone decide what the register shows, read live
  every time rather than written when somebody is relieved (so a rejoiner is simply due again).
  Either one ends the instalments still to come — the hire, because the bonus is for them staying, and
  the referrer, because the money is theirs and there is nobody to pay once they have gone (a referrer
  deleted from the repository, only their name kept, counts as gone). Then: nothing paid yet and the
  referral is **off the register altogether** — nothing was earned and nothing is owed; one instalment
  paid and it stays under **Settled**, its unpaid instalments reading **stopped · employee left**,
  **· referrer left** or **· both left** so the row says which. What was paid stands either way: money
  that has left the studio is a fact, not something a later resignation rewrites. And while **both are
  still here**, a referral with one instalment paid stays **Outstanding** — it is not settled until the
  last instalment is.
- **Settings → Organization → Branches** is the studio's branch register — the row every other
  module already points at, given somewhere to be kept: the branch's name and code, its address in
  parts, how it is reached, its **External URLs** (Web URL, Location URL and Google Review URL - each added from a dropdown
  with "+ Add external URL", removable, and the button disabled once all three are there) and
  **Social Media Links** (no fixed fields: up to ten links the studio adds with "+ Add social media
  link", each under the label it is given) - each optional, the links given
  https:// when typed without it - what it is registered as, and where it banks. **The registration is not
  required.** GSTIN and PAN were both mandatory and are now optional, because a branch trades before
  its GSTIN comes through and a studio that is not registered still has branches to bill from —
  insisting on them meant such a branch could not be added at all. Either one typed is still held to
  its real shape, so a mistyped GSTIN is refused exactly as before; only a missing one is now
  allowed. What a branch must still carry is unchanged: the code and name, the address, the PIN
  code, the phone, and **at least one bank account**. **A branch is paid into as many accounts as it
  holds** — a list, not four columns, because a studio commonly banks in more than one place: a
  current account per bank, or one kept for a particular kind of work. The form opens on one account
  and gains another each time **+ Add Account** is pressed, each row asking for the holder, the bank
  and branch, the account number and the IFSC — all four, every time, because an account missing one
  cannot be paid into and a client handed such a card would try. A row nobody has started says
  nothing under its own boxes; what the snackbar says is that the branch still needs an account. The
  order is the studio's: the first account is the one the branch leads with, and it is the order the
  client's payment page prints the cards in. An account number another branch already holds is
  refused against the row that holds it, which is the rule the single account was always held to, and
  the same number twice in one list is refused as a pasted row. A branch's row in the register lists
  every account it holds — the bank and the number, one line each — rather than the first of them.
  **A branch may also carry the QR its clients scan to
  pay it** — one optional picture, PNG, JPG or WEBP, picked with the same field the studio's logo and
  an employee's photograph are picked with: compressed in the browser, uploaded by the server to the
  same bucket every other image goes to, and stored as the link it comes back as. Adding and editing
  a branch behave alike — an existing QR shows as itself and can be replaced or taken down, and an
  edit that touches only the phone number sends the link back untouched rather than re-uploading the
  picture. The same QR Code section takes the branch's **UPI IDs** above the picture — **a list**,
  because a branch is commonly paid into more than one handle and the QR encodes only one of them.
  The form opens on **one** box and gains another each time **+ Add UPI ID** is pressed; the first
  box is always there and cannot be removed, every box after it can, and removing one only edits
  the form until the branch is saved. An existing branch opens on exactly the UPI IDs it holds —
  three saved is three boxes, none saved is one empty box — never a spare box under them. Each is
  optional, trimmed, stored as typed and held only to the `address@handle` shape every UPI ID
  shares, so `name@okaxis` and `9876543210@upi` both pass; a box left empty stores nothing, and one
  handle typed twice is said under the second box and never stored twice. The list is shown on the
  register and printed on the client's quotation payment page beside the QR, one row each; no
  invoice or receipt prints it. Reached with
  `SETTINGS / Organization`, the same permission the rest of the studio's settings answer to. A branch is never
  deleted, only disabled.
- **Settings → Holidays** is where the studio declares the days it is closed - for every branch,
  or for the branches chosen. A month grid: a click on a day declares a holiday, a click on an
  existing one renames it, moves it to another day, changes whose it is or removes it, and the
  month beneath the grid lists what it holds with whose each is. The dialog asks **Holiday applies
  to** - All branches, or Specific branches picked from the ones the login's role reaches for this
  permission (`GET /api/settings/holidays/branches`); All branches is offered only to somebody
  reaching every branch, and the server refuses anything else regardless. One list, two readers —
  the day is drawn on the **Calendar** of everybody it applies to and attendance counts it as a
  holiday rather than an absence for them, taking it out of their hours target and nobody else's.
  Whose branch a person is: their employee record's, else their login's, else none - and somebody
  with none observes the studio-wide holidays only, never every branch's. The links live in
  `attendance_holiday_branch`; a holiday with none is every branch's, which is every holiday
  declared before this. Two branches may each have a holiday on one day; the same branch twice, or
  the studio's beside a branch's, is refused rather than overwriting. A reader whose roles reach
  some branches sees those branches' holidays and the studio's, and a **Show holidays for** filter
  reads the month as one branch sees it. Payroll's working-day divisor and Nebula's working-day
  counts, which have no one employee in scope, count the studio-wide holidays only. It answers for
  `SETTINGS / Holidays` — Read to look, Read / Write to change — rather than to HRM, which is where
  it used to be written: a company-declared holiday is a studio setting, not an attendance
  decision about one person (`services/holidayCalendar.js` is the one rule every reader shares).
- **Settings → Employee → Certificate** (administrators only) has three sections: **Experience**,
  **Employment** and **Offer Letter**. Experience holds the HR's **e-signature** (uploaded), the
  **authorised signatory's name and designation** (typed below it) and a **note**, then the experience certificate on an A4 sheet like the Payslip's - the same logo, company
  name and head-office address - with the employee's details as bracketed blanks, the signature
  above the authorised signatory and the note at the end. The sheet follows the edits before Save.
  **Employment** is the same, with the employment certificate's own wording and its own settings;
  Offer Letter is empty for now.
- What a referral **pays**, and **how many months it is settled over**, are both asked in
  **Settings → Employee Referral** — two fields on one form, because an amount without a schedule is
  not a payment and a schedule without an amount is not a figure. **Referral amount** is the total;
  **Number of instalments** is how many payments it is handed over in. One question rather than a
  list of dates, because "how many" is what a studio has an answer to: **one instalment falls due
  every three months** from the referred employee's joining date, so two are their third month and
  their sixth — the pair the register has always paid — and three are 3-6-9. The amount is divided
  **equally** between them, with any rounding remainder on the last instalment so the parts always
  add back up to what the referrer was promised, and **the section states what each month comes to**
  rather than leaving it to be worked out: the split is the figure that reaches a payslip, and an odd
  total does not divide as cleanly as it looks. At most 24 instalments; `0`, `2.5` or an empty box is
  refused in those words while it is still being typed, and Save stays disabled until it reads. The
  schedule was a constant in the referrals service until it was asked for here, so a studio paying
  any other way had to have the application changed. The count is what the form sends and the server
  applies the three-month interval itself, so what lands in the database cannot disagree with what
  was previewed; what is *stored* is still the month offsets, because that is what a payout row
  carries and what the register reads "3rd month" off.
  The setting has moved twice: from the Employee Repository's ⋮, to the register's own ⋮ when the
  register became a screen, and now into the application's Settings with everything else the studio
  configures once — the register is a register, and its header carries no menu at all. It answers to
  `HRM / Employee Referral` as well as its own `SETTINGS / Employee Referral` row, because that is
  what its routes enforce: whoever runs referrals sets both figures without being made an
  administrator, and the section is absent for anybody else. Changing either is **never
  retrospective**: each instalment keeps the amount its referral was made under, and a referral
  already recorded keeps the months it was recorded with — which holds even when that employee's
  record is saved again later, because an existing referral's schedule is read from its own
  instalment rows rather than from the setting. It has moved twice: from the Employee Repository's ⋮, to the register's own ⋮ when the
  register became a screen, and now into the application's Settings with everything else the studio
  configures once — the register is a register, and its header carries no menu at all. It still
  answers to `HRM / Employee Referral` as well as its own `SETTINGS / Employee Referral` row,
  because that is what its routes enforce: whoever runs referrals sets the figure without being made
  an administrator, and the section is absent for anybody else. Each instalment keeps the amount its
  referral was made under, so changing the figure never reprices one already promised.
- **Tasks** (`/hrm/tasks`) — anybody in the studio can give anybody else a task, and follow it to
  the end. The screen opens on the **Dashboard** - ten cards over the reader's own tasks (assigned to
  them, and given by them, plus a first All Tasks row for whoever holds All Tasks) with their change
  over the range picked, filtering a Recent Tasks table -
  and three lists follow it in the dropdown beside the heading: **All Tasks** for whoever holds
  `HRM / All Tasks`, then **My Tasks** and **Tasks Given**. **Each status tab carries its count**,
  and switching between them touches nothing: a view is fetched whole and filtered in the browser.
  It used to be filtered at the server, which is why the counts showed nothing — the browser only
  ever held the status it was displaying, so every other tab had nothing to count. The endpoint does
  not paginate, so All was already fetching the whole view and nothing was being saved by it.
  The tab row under the heading filters
  whichever view is open by **Pending, In Progress, Completed, Reassigned, Cancelled or Finish & Send Back** — every
  status has a tab now. Cancelled was the one held back, on the reading that a cancelled task has
  nothing owing on it, which was true of the task and wrong about the reader: calling a task off is
  the one thing only the person who set it can do, and they are exactly who wants to see what they
  have called off. The
  screen opens on My Tasks whatever the dropdown lists, since most roles do not hold All Tasks.
  The view and the status filter are each remembered across a reload, so refreshing keeps the list
  you were reading rather than dropping back to everything. A
  task carries a receiver, a priority, a type, a department, a branch, an optional due date, a title
  and instructions. Department and Branch are the task's own answer rather than the assignee's -
  work crosses both lines often enough that reading them off the person would file a task under the
  wrong one - and both are required, picked from the studio's own department and location master
  data. Tasks raised before this was asked for read blank.
- **Files can be handed over with a task.** The assign form takes any number of them — images, PDFs,
  Word, Excel and PowerPoint, CSV, text and ZIP, up to 15MB each — and they are uploaded once the
  task exists, so a file that will not upload is reported beside a task that is already assigned
  rather than losing it. On the task itself, pictures read as a grid of thumbnails and everything
  else as rows, each with a **⋮** carrying **Download** and, for whoever attached it or whoever set
  the task, **Remove**. Anybody who may open a task may open its files; only its two people may add
  or remove one, so somebody reading through All Tasks can download every file and change none.
  Attaching and removing each write an activity entry naming the file. The bytes live in the private
  R2 bucket under the task's own code and are streamed through the login — there is no URL to a
  studio file that works without one.
  Whoever holds a task starts it, then **Finish & Send Back**, or **reassigns** it at any point.
  Sending it back moves it to the **Finish & Send Back** tab (after Cancelled) in the assigner's
  Tasks Given - My Tasks has no such tab, and counts work you sent back as Completed - and
  only the person who assigned it can then **Mark as Completed**. The assigner can also **Revoke**
  it at any point while it is open - taking it back and, in the same step, reassigning it to anyone,
  who then follows the same flow. A verb that ends the task closes its panel and returns to the
  list; Start keeps it open. Finish & Send Back appears only once the task has been started. The
  person who gave it can cancel, edit or delete it.
- **A task can be deleted, which is a different statement from cancelling one.** Cancelling says a
  real task was called off: the holder is told, it keeps its row in both lists and it still counts
  under the Cancelled tab. Deleting says the task should never have been raised — a duplicate, a
  test row, one typed against the wrong person — and there was no way to say that, so those rows sat
  in the studio's list for good. **Delete Task** is offered in the row menu and in the task's own
  footer, behind a confirmation naming the task, to **the person who gave it and to a Super Admin**;
  everybody else, the holder included, is not offered it and is refused by the server. It is the one
  verb no status gates: a task that should not exist should not exist whether or not somebody has
  started it, and cancelling remains the right answer for work that was genuinely under way.
  **The record survives.** `deleted_at` is stamped and the row stays with its chain of holders, its
  activity log — including the line saying who deleted it and when — and the files handed over with
  it, so a mistaken delete is a column somebody can clear rather than a restore from a backup. What
  changes is that every read narrows by it: the task leaves My Tasks, Tasks Given and All Tasks
  alike, and its id answers the same 404 to every verb, to its own files and to a link in somebody's
  bell as a task that never existed. Notices about it are cleared with it, since each one is an entry
  that would open onto nothing.
- **A task id reads `DBS-TK-00001`.** Every other business id the studio mints wears the `DBS-`
  prefix, and a task was the one record answering to a shape of its own, `TSK-000001`. Unlike a
  booking or an enquiry it carries no vertical and no branch: a task names its department and branch
  in its own columns and work is regularly handed across both, so either baked into the id would be
  wrong the first time a task moved. The tasks already raised are renamed to match, so the list is
  one format rather than two — `TSK-000010` becomes `DBS-TK-00010`, the same number. What is
  deliberately not rewritten is the text quoting a code inside the activity log and the notices
  already sent: those record what was said at the time.
- **Reassigning replaced rolling back.** Rolling a task back closed it and handed it to nobody: the
  person who set it got an explanation and the work stopped. Reassigning is the same act with a
  destination — the holder names who should do it instead and says why — so the work carries on.
  Both halves are required: without somebody to go to there is nothing to reassign, and the reason
  is the only thing that lets the next person, who has no history of their own, pick the work up.
  Handing it back to whoever set it is still possible; it is now a destination somebody chose rather
  than the only way out. A reassigned task is **Pending** for the person it lands on - it is
  waiting for them like any other - and stays startable; the **Reassigned** tab is the previous
  holder's, listing the tasks they have passed on (a task reassigned before this rule may still say
  `REASSIGNED` on its row and reads as Pending). Only
  **Completed** and **Cancelled** close a task now — a cancellation being the person who set it
  calling it off, needing no reason, and leaving nobody to act.
- **A reassigned task stays in front of everybody who has held it.** A gives it to B, B reassigns to
  C: all three read it and its history, and if C passes it to D then all four do. Every holder is
  recorded, so **My Tasks** lists what you hold *and* what you have passed on, showing who has it
  now, under its **Reassigned** tab rather than Pending — you were asked to do it, so what became
  of it is your business — while the verbs belong to
  whoever holds it. Whoever set the task sees it under **Tasks Given** throughout, and is notified on
  every hop along with the person receiving it. Nobody can do the other's verbs, which is decided per task by
  the server from who is on it, not from the signed-in role. Every change writes an activity entry
  and, where somebody else needs to know, a notification. The task's whole history is on its detail
  panel.
- **Interview** (`/hrm/interview`) — the studio's application pipeline: who has applied, and where
  each of them has got to. Built the way the **Employee Repository** is, because it is the same kind
  of screen — a register of people read by stage. The stages are the header's tab row with a count
  on each: **Yet to Connect** (nobody has spoken to them yet), **Form Submission Pending** (the
screening form has gone out and has not come back), **Form Submitted** (it is back and waiting
  to be read), **Interview Scheduled** (a conversation is in the diary), **Selected** (they have the
  job), **On Hold** (parked) and **Rejected last**, after every stage a candidate can still move on
  from — the two places a candidate stops sit together at the end, so the five before them are the
  tabs somebody works every morning. There is no **Shortlisted, Interviewed or Joined** stage: a
  form that has been read is either worth a conversation, in which case it is scheduled, or it is
  not; "Interviewed" says only that a meeting happened, which the interview date already records,
  where the next thing anybody wants to know is the answer; and somebody who has joined is an
  employee, read from the Employee Repository rather than a hiring queue. Hiring ends here at
  Selected. A stage the list has no name for, including any of those three words off a recruiter's
  spreadsheet, is kept as typed and shows under All — folding **Interviewed** onto Form Submitted
  would move a candidate backwards and onto Selected would answer a question nobody has answered.
  The register is the shared table with the info panel beside it, and it **opens on the studio's own
  hiring sheet, in that sheet's order**: what it replaces is a Meta lead export read in a
  spreadsheet, so the columns read left to right the way that sheet does — Date, Campaign Name,
  Adset Name, Ad Name, Years of Experience, Current Salary, Expected Salary, Languages Known, When
  Can You Join, Name, Phone Number, Gender, City, then the candidate's own **Résumé** and
  **Portfolio Link**, then what the module holds besides: Candidate ID, Status, Position, Employment
  Type, Department, **Interview Scheduled On**, Branch, Source, and the two follow-up dates side by
  side, because what the last conversation was and when the next is due is one answer. Somebody
  moving off the spreadsheet is not relearning their own register. The headers are the studio's
  words where those differ from the module's — Current Salary, When Can You Join — since those are
  the questions their ad form asks. No table has a Sl. No. column, and the sheet's serial column is
  the one heading the importer leaves unread; Manage Columns moves
  anything here out of the way. A résumé and a portfolio are drawn as the file they open rather than
  as the 200 characters of URL that reach it. The action bar is **Add
  Application** as the primary button with a ⋮ after it — the repository's own arrangement — holding
  **Bulk Entry**, **Import** and **View All Invites**. A row's ⋮ carries View, **Edit — or Review**, **one entry
  about the screening form or none**, **Follow Up** where chasing is still the work, **Put On
  Hold**, **Reject** and Delete, the way the Employee Repository's does — its entries appear and disappear with the row's state rather than sitting
  there refusing.
  **Both stopping stages are offered on every tab**, not only while a screening form is out: a
  candidate is turned down after the form is read, after the interview, or off On Hold weeks later,
  and each of those was a row whose menu had no way to say so — the stage had to be changed by hand
  on the record. **On Hold and Rejected are the two places a candidate stops, and only one of them
  could be reached from a row**: somebody the studio wanted to keep but could not place yet had to
  be opened, edited and saved, while turning the same person down was one press — the easier answer
  was the harsher one, which is the wrong way round in a register worked through every morning. So
  the two sit together in both menus, **Put On Hold first** as the gentler of the pair, each moving
  the stage with an **Undo** that restores the stage it came from rather than asking a question
  before anything has happened. They sit just above the destructive entry in either menu (Delete, or
  Cancel Form while waiting), so the stages that can be undone come before the thing that cannot.
  Each is withheld from the row it would be a no-op on — Reject from one already **Rejected**, Put
  On Hold from one already **On Hold**, where either would move the stage to where it already is and
  hand back an Undo to itself. A rejected candidate *is* offered Put On Hold: reconsidering somebody
  is a thing the studio does, and parking them is how it is said. **Yet to Connect offers no Edit.** Nobody has spoken to that candidate yet, so
  the record is still exactly what arrived — a sheet row, a CSV line, or the six fields Add
  Application asks — and there is nothing learned to write into it; a form opened on an untouched
  application invites corrections to somebody's own answers before anybody has asked them a
  question. The record stays readable through **View**, and Edit returns the moment the candidate
  moves on a stage. A candidate
  holding a **live** form is offered **Copy Link**, because where the link is, is what that row gets
  asked. One who has **submitted** is offered nothing about the form: reading it is the answer to a
  form that has arrived, and asking again somebody who has already answered is the one thing nobody
  wants — which is why that row says **Review** rather than Edit. The two words ask different things
  of whoever presses them: *Edit* is "something on this record is wrong", where a candidate at Form
  Submitted is an application waiting to be **read**, and that tab exists because somebody has to
  read it and decide. The same panel opens either way — a submission is read by reading it — but a
  review ends in **four answers** rather than in Save Changes: **Discard** (close and keep none of
  the corrections; named for what it does to the edits, since "Cancel" in front of an application
  reads as cancelling the application), **Resend** (hand the form back on the candidate's own link
  with every answer still in it), **Save** (keep the corrections and decide later) and **Schedule
  Meeting**, which is the primary, because the meeting is the answer a review exists to reach. Like
  the two buttons beside it, Schedule Meeting **saves first** and opens the schedule dialog on what
  was just saved, so the round is booked against the corrections rather than the details last
  written — and it opens as a *next* round rather than a first if somebody else scheduled one while
  the review sat open. Everyone else — never asked, or a form that lapsed or was called off — is offered **Send
  Screening Form**. A live form is one the candidate can still open: raised or opened, and not past
  its expiry. Correcting a form, emailing it again and cancelling one all belong to **View All
  Invites**, which lists every form with those three beside it; they are things somebody does while
  reading the forms rather than while reading the register. Each entry is named plainly, with no
  rules between them and no second lines. **View** opens the record **read-only** — no boxes and no
  Save, the same panel the Employee Repository shows, and the cheapest thing on the menu. A single
  click still opens the info panel beside the table.
- **A double-click opens the screen where a candidate is worked.** It used to open the same read-only
  card as View, on the argument that a double-click is too easy to trigger by accident to be what puts
  a live form on screen — which left the register readable and not workable: correcting the record,
  deciding, scheduling and sending the form were four separate dialogs off the ⋮, and a note about a
  call had nowhere to go unless the recruiter also pretended to change a stage. The popup is the CRM
  lead popup's arrangement asked of a candidate, and the accident it was guarding against is answered
  instead by the unsaved-changes guard: an accidental open closes on one press, one with typing in it
  asks first. The ⋮'s **Edit** — **Review** on a submitted form — opens the same popup, so a candidate
  has one editor rather than two.
  - **The left pane is what the candidate answered**, grouped as the application's own sections, with
    the empty fields one press away: thirty-nine boxes in one scroll is a search through a record
    rather than a reading of one, and a review sometimes does have to fill one in.
  - **The card beside it is Remarks, Activity Logs, Call Logs and WhatsApp.**
    - **Remarks** is the lead's remarks composer itself, not a box resembling it: the collapsible entry
      bubbles, the bullet and numbered lists, Enter to post, the send button in the toolbar. Writing a
      note used to mean leaving the history it was answering, and the control was a second, poorer answer
      to a question the CRM had already settled. Two of its controls are off for a candidate — the
      **pencil**, since `statusNotes` is append-only with no per-entry id and nothing that rewrites one,
      and the **paperclip**, since a candidate's remark has nowhere to put a file — and each bubble
      carries the **stage** the remark was written at, which is what makes the log worth reading.
    - **Activity Logs** is the same `statusNotes` log read as *what happened* — the stage, when it
      moved, who moved it, one line each. Only entries that moved something: a note posted on its own
      carries the stage the candidate was already at, and listing those would fill the record with the
      same word repeated while saying nothing about what was done.
    - **Call Logs** answers whether anybody has actually rung this candidate. The studio's call log is
      one table fed by the handset integration and **keyed by the number dialled**, so a recruiter's
      call lands in it exactly as a salesperson's does; it had only ever been read from the CRM's lead
      popup, where the same tab answers the same question. It is read when the tab is opened, not with
      the record, and a log that cannot be read is an empty tab rather than a message — the call
      history is something extra about a candidate, not a reason the record cannot be worked.
      **What a recruiter is not shown:** a number that is a candidate here can be a client in the CRM,
      and the stored row carries the CRM's reading of that client — the name it filed them under, the
      enquiry, its status, the recording, the note whoever took the call typed. The server strips all
      of it and passes on the call itself: when, which way, how long, and which of the studio's own
      people was on it. `HRM / Interview` is not a grant of `CRM / Leads`.
    - **WhatsApp** is one message to one candidate from the recruiter's own WhatsApp.
  - **The stage is chosen in a Follow-up Details card**, and what the stage needs is asked directly
    under the pills: **Follow Up** asks when, and a decision is answered by the remark, which Update
    requires — so the register can always say why somebody moved. The three stages that are
    *consequences of an act* — Form Submission Pending, Interview Scheduled, Onboarded — offer that
    act instead, and confirming it saves the record and opens the act's own form.
  - **A stage asks for its remark before it is written.** Pressing a pill records the choice and
    nothing else: the card says a remark is needed to move that candidate, the Remarks tab comes
    forward, and Update writes the stage and the reason together or neither. An unsent note in the box
    counts and is posted by the save, so nobody is refused for the words on screen in front of them. The
    refusal itself is said in the **floating notice**, not as a banner in the form: it is not a fault in
    any one field, and a banner above the record pushed the record down the screen — on a phone it was
    the only thing visible.
  - **The forms these open draw over the popup, which stays open underneath.** Schedule Interview and
    Send Screening Form save the record and open their dialog at `dialogOverPanel`; closing that dialog
    closes only it, and the popup is still there for somebody who changed their mind about booking a
    round but not about the record. Only a round **actually booked** or a form **actually sent** closes
    both. Posting a remark or sending a WhatsApp message keeps the popup too — the note is usually the
    reason a stage is about to move.
    **Form Submitted** is refused outright: that stage is the candidate answering, and nobody here can
    answer for them. A refused stage is shown greyed with the reason rather than left out, because a
    candidate can still *be* at it.
  - **Onboarded is only offered to somebody holding `HRM / Employee Management` READ_WRITE**, the same
    permission the row menu's Send Onboarding Invite is gated on — otherwise the pill is refused
    rather than being a press that raises a 403 and leaves the candidate where they were. A viewer with
    READ gets the record, the log and no way to move anybody.
- **Each row is offered only the answers its stage can give.** The ⋮ used to carry every entry the
  module has on every row, so somebody nobody had spoken to could be marked Selected and somebody
  whose form had not come back could have a round booked against answers nobody had read. **Mark
  Selected** appears once a candidate has been seen — from Interview Scheduled onward, and on On
  Hold and Rejected, because reconsidering somebody is a thing the studio does — and **scheduling**
  is off a row still waiting on its screening form. Both return the moment the form arrives.
- **An Onboarded candidate's row is about their invite.** Copy Link, Edit Invite and Cancel Invite —
  the three things there are to do about an invite that is out — then View, Edit, Reject and Delete.
  Nothing about deciding: somebody taken on has no next round to schedule, no stage to be marked at
  and nothing to put on hold. Cancelling asks first, because the link cannot be revived. The invite
  is found by the candidate's email, then their phone — an onboarding invite is the Employee
  Repository's record, raised from here but never owned by here, so the two have no id between them.
- **A Selected candidate is taken on from their row.** That stage's menu is only the five things
  left to do about somebody the studio has decided about — **Send Onboarding Invite**, View, Edit,
  Reject, Delete — with no screening form to send to somebody who has the job and no round to
  schedule after the answer. The invite is the **Employee Repository's own**, opened from here
  already filled in with the candidate's name, email, number and the position they applied for, so
  hiring hands over to onboarding without anybody retyping four answers the register has held since
  the application arrived. Raising it moves the candidate to **Onboarded**, where the tab beside
  Selected collects everybody who has actually been brought in.
- **The three decisions carry their reason, and Onboarded is a stage.** Marking somebody Selected,
  putting them On Hold and turning them down each open a short dialog asking why, and the answer is
  kept as its own entry rather than written over the one before — a candidate held in March and
  rejected in May has two reasons, and the record shows both under **Decisions**, newest first,
  apart from Remarks, which stays the studio's running note on the person. The remark is optional,
  because a required box on a decision already taken is a box that gets "ok" typed into it.
  **Mark Selected** is on the row menu now: the answer the whole register is worked towards was the
  one stage that could only be set by opening the record. **Onboarded** follows Selected, because an
  offer made and an offer taken are different answers and the gap between them was tracked in
  Remarks or nowhere.
- **A candidate can be called for more than one round.** The register used to hold a single
  interview, so scheduling a second overwrote the first and the fact that somebody had already been
  in was simply lost. Every round is kept now, and **which round a candidate is on is a column** on
  the register — "Round 2", beside the date of it, worked out from the rounds themselves rather than
  counted separately, so the two cannot disagree. The row's ⋮ says what the row is asking for:
  **Schedule Interview** for somebody nobody has called, **Schedule Next Round** once they have been
  in, and **Edit Schedule** for moving a date, a Meet link or a mode that became a phone call. A
  next round opens on empty date and time fields — the last round's belong to a conversation that
  already happened, and leaving them in the boxes invites a second round booked for the first one's
  date. The register's table, the linked sheets and the CSV importer still read one interview: it is
  the latest round, which the flat columns follow.
- **The interview's mode is a colour, and a Meet is joined from the row.** In Person, Google Meet
  and Phone each carry their own dot in the Mode column — the mode is what somebody has to *do*
  about the appointment, and three arrangements that different should separate at a glance rather
  than be read word by word. **Meet Link sits beside it**, opening in a new tab, so a call is joined
  from the register instead of by opening the candidate and copying a URL out of their record; on
  the record itself it reads as **Join the meeting**. Both columns are shown by default, because a
  colour nobody has turned on gives no reading, and both are in Manage Columns for a studio that
  interviews in person and wants the width back.
- **Scheduling books the Meet and moves the candidate, as one act.** Saving Schedule Interview
  writes the round, **moves the candidate to Interview Scheduled** with the reason recorded, and —
  for a round whose Mode is **Google Meet** — creates a real Google Calendar event on the
  scheduler's own calendar and saves Google's link onto the round. There is **no Status picker on
  the dialog**: the stage of a candidate with a round in the diary *is* Interview Scheduled, so
  asking somebody to say so after they have booked it asked them to restate what they had just
  done — and every time it was missed, the stage disagreed with the register's own interview date.
  Every stage has the act that sets it now; the three that are decisions rather than consequences —
  Selected, On Hold, Rejected — are taken in their own dialog, which asks *why*. **No Meet Link is asked for, at any mode**: a video round's link is
  Google's answer, and an In Person or Phone round has none to give, so the box that stood empty on
  every round of those two is gone. A link a round already carries — one a linked sheet or an earlier
  booking wrote — is kept rather than blanked by an edit that was only moving a date, and the
  register still shows it as the Meet Link column and as "Join the meeting" on the record. The
  dialog asks who is taking the round, how long it runs and who else is coming: the candidate is seeded as a guest
  from the email on their record, the interviewer's work address joins the list when they are
  chosen, and anyone else is typed in. **Editing patches the event** rather than replacing it, so a
  date moved by an hour moves the entry everybody holds and keeps the link the candidate was sent;
  a round that stops being a Meet has its event cancelled; and editing does not move the stage,
  because moving a date is not a decision about a person. It runs on the **same Google account** the
  Interview sheets connect under, whose consent already carries Calendar — and **one linked account
  serves the whole studio**: your own books it where you have connected one, so the interview lands
  in your diary and the invite carries your name, and the studio's earliest linked account books it
  where you have not, with the confirmation saying whose calendar it went on. Nobody has to connect
  an account of their own to schedule. The event is created
  **before** anything is written — so "connect your account" or "reconnect it" refuses the whole
  schedule rather than filing an interview nobody can join. The guest list is served by its own
  route guarded on `HRM / Interview` **Read / Write**, not on the Read that opens the register: the
  roster with everybody's work email on it is for somebody booking an interview.
- **Scheduling is asked apart from the record.** The interview, the follow-ups and HR's
  own remarks are a **Schedule Interview** dialog off the row's ⋮, where the time is **picked** rather than
  typed as "10:30 am" — a written clock face cannot be sorted on — through the same time control
  every other screen in the application uses; a sheet's own wording is converted when it is read and
  kept untouched when it cannot be rather than the last section of
  the candidate's record. Reading back what somebody submitted and deciding what to do about them
  are different errands done at different moments, and while they shared a screen the stage — the
  one field anybody opens a candidate to change — sat below four sections of the candidate's own
  answers. It is offered on every row, whatever stage the candidate is at, including while a
  screening form is still out.
  It does **not** ask for a **Last Follow-up** date. That asked HR to tell the register something the
  register already knew, and it was a box that had to be *remembered*: the column means "the day
  somebody last worked this candidate", so one nobody updated said the opposite of the truth rather
  than nothing at all. The server writes it from the act itself — **saving a candidate is working
  them** — in `updateCandidate`, which covers the record, this dialog and the row menu's stage moves,
  and it is written **last**, over anything posted, so the day cannot be chosen. Deliberately **not**
  in `prepareValues`: three other things write a candidate through that and none of them is somebody
  following anybody up — the candidate's **own submitted form**, the **CSV import** and a **linked
  sheet** — and stamping there would put today's date on every row in a file and read afterwards as a
  day HR worked them all. It is the same line the CRM board draws for its own Last Followup Date,
  where a posted remark deliberately does not stamp it. The column is still **shown**, on the
  register's table and the info panel, because reading when somebody was last worked is the whole use
  of it. **Next Follow-up stays a box**, and the difference is which way the two point: the last one
  is a fact the application can observe, and the next one is a decision only a person can make.
- **The candidate's record reads back the application they filled in.** It asks
  **fresher-or-experienced** with the form's own dropdown, already answered from what they
  submitted, and hides the four questions that presuppose a job behind it exactly as the form does —
  hidden, never blanked, so a value a linked sheet put in one of them survives the save. The résumé
  and the attachments are **documents to open** rather than addresses to read, with the résumé's own
  link kept underneath it, since this record is also where a row imported with the link in the wrong
  column is put right. The full record a row opens
  asks the same questions, in the same sections and the same order, as the form the candidate
  submitted — The Role, About You, Experience & Expectations, Anything Else — with the studio's own
  columns folded into the section they belong to and **Screening** last, since the stage, the
  interview and the remarks are the studio's answers about a candidate rather than the candidate's
  about themselves. Before this the two were different forms of the same interview, and half of what
  a candidate submitted — their education rows, their work history, their extra links, their
  attachments — was stored and shown on no screen, so nobody could read it or put it right. Two
  controls are deliberately looser than the form's: **Notice Period** and **When Can You Join**
  offer the form's own answers but still take anything, because a record has to survive what a
  linked sheet or a CSV put there, and a closed list would show such a value back as empty and then
  save the blank over it. Attachments are read here rather than edited: HR replaces a file by asking
  for a new form, not by uploading on a candidate's behalf.
- **Chasing a candidate is a stage: `Follow Up`, straight after Yet to Connect.** A candidate nobody
  has spoken to gets one of two things done to them — the screening form, or a call — and only the
  first of those was a stage; the second was a remark, or nothing. So a register worked every
  morning could not tell *"nobody has tried this person"* from *"we have called three times and they
  have not answered"*, which are the two rows that need completely different work. It has its own
  tab with a count and its own dot — a deeper sky than Yet to Connect beside it, so the pair reads
  as one thing progressing rather than as two unrelated stages.
  It is offered on the row ⋮ beside **Send Screening Form**, at **Yet to Connect and at Follow Up
  itself** and nowhere else: further on, something has already happened that the move would undo —
  a form out, a conversation in the diary, an answer given — and a register that let a scheduled
  candidate be dropped back into the chase would lose the appointment. On a row already at Follow Up
  the entry reads **Log Another Follow-up**, because there it is not a stage change but a second
  attempt against the stage they are already on: chasing is the one thing in this menu that
  genuinely happens more than once, unlike Reject and Put On Hold, which are withheld from the rows
  they would be a no-op on.
  It opens the decision dialog with **one extra field the other three never get: a next follow-up
  date**. Follow Up is not a decision about the person but about the work — this is worth another
  try, on this day — and a stage that recorded the trying without the day would leave the register
  unable to say who is due. Selected, On Hold and Rejected ask for a reason alone and never touch
  the date. **Every attempt appends**: the remark lands in the candidate's log rather than over the
  last one, carrying the stage, the day it was written and the day it promised, so three unanswered
  calls read as three with what was agreed each time. A linked sheet's own vocabulary folds onto the
  stage — *follow up*, *callback*, *no response*, *not reachable*, *did not pick*.
- **Every remark written as a stage moved is kept, and the record shows all of them.** The section
  is **Follow-ups & Decisions**, and it is the one place they accumulate: appended, never rewritten,
  newest first, each with the stage it was written at and the day. Read in full both in the info
  panel beside the table and in the panel a double-click opens, since both draw from the same list.
  HR's single **Remarks** note keeps its own section and its own behaviour — that one is written
  over each time it is edited, and a running note and a history are two different things.
- **Add Application is Add Lead's dialog asked of a candidate**, and it asks very little: a compact
  card over the dimmed page with **Candidate Name** and **Contact** as the two required answers, then
  Position Applied For, Email, Experience and Source beside them, and under those the **next
  follow-up date** and the **remarks** — **one panel**, eight controls, the full width of the card.
  **Position Applied For is asked and never refused**, here and on the record: the job somebody is
  after is regularly unknown at the moment an application arrives — a walk-in, a number passed on by a
  friend of the studio, a CV with no covering note — and refusing the row for it bought either a guess
  typed into the field or the candidate not being written down at all. A name and a number are what
  make a candidate findable and reachable, and nothing can be done about somebody the register cannot
  ring. The candidate's **own screening form still requires it**, which is where the real answer comes
  from.
  **It does not ask for a stage.** An arriving application *is* at **Yet to Connect**: nobody has
  spoken to them, which is the whole definition of that stage. The dialog used to offer five —
  Yet to Connect, Form Submission Pending, Form Submitted, Selected, On Hold — and four of them
  cannot be true of an application being written down as it arrives: Form Submission Pending means a
  form has gone out, Form Submitted means it has come back, and Selected and On Hold are decisions
  about somebody nobody has met. A row filed under one by a mis-click on the pills read afterwards
  as a step somebody took, and sat in a tab being worked for something that never happened. Every
  stage is now reached by the act that makes it true — the screening form sent and returned, a round
  scheduled, the decision dialog, the onboarding invite. Taking the pills away also took away the
  only reason for a second panel: **Follow-up Details** was then a heading over a date and a note,
  and two headings said the dialog asked two kinds of question when it asks one. There is no
  **Assign To**: the studio has one HR, so
  there is nobody to assign a candidate to. A linked sheet's assignment rules are the one place a
  name is still chosen, and that value is shown on the record and kept through an edit. It was a four-section full-screen form asking thirty-odd questions, which is the wrong
  form for the moment twice over: an application arrives as a name, a number and the job they are
  after, and everything else is either not known yet or is the candidate's own to type. Confirm
  stays live and marks the empty boxes when pressed, and closing asks before discarding — the same
  three rules Add Lead follows. A candidate is `DBS-INTV-000001`.
- **Which paid ad brought an application in is on the candidate.** A studio running hiring ads on
  Meta exports its leads with the ad hierarchy beside each row, and **Campaign Name**, **Adset Name**
  and **Ad Name** are now columns on the register, on the record and in the CSV. `source` already
  said the application came from Meta Ads; these say which push, which audience and which creative
  brought it, which is what decides what keeps running. Three columns rather than one string,
  because the table is filtered by one of them at a time. Only a linked sheet or a CSV ever fills
  them — nobody types an ad name by hand — and a campaign renamed mid-flight reads as its new name
  after the next sync.
- **Position Applied For offers what the register is actually hiring for** — the studio's own
  **Settings → Fields → Interview → Positions** list first, then every position the candidates
  already carry, merged by the options endpoint without offering a name twice.
  It used to offer the **designation** list, on the argument that most applications are for a role
  the studio actually has. That is a different question, and the register said so: a designation is
  what somebody is *employed* as, a position applied for is what an advert asked for, and nobody
  keeps the two in step. The register held 36 positions while the picker offered 32 designations,
  **34 of the 36 missing** — every one of them written by the linked Google Sheet, which is where
  all but five of those candidates came from. A position that arrives on a sheet is one applications
  keep coming for, so it is one the picker should offer.
  The studio's own list still leads, because somebody chose to maintain it, and it is still kept out
  of `designation` — a designation is also what an employee record, a payslip and the Employee
  Repository's filters read, and nobody is employed as "General". A studio wanting more adds rows
  rather than waiting for a release.
- **Where an application came from is a list the studio maintains**, in Settings → Fields →
  Interview → Sources: Naukri, LinkedIn, Indeed, **Meta Ads**, Google Ads, Social Media, Website,
  Campus, Referral, Walk-in and Other, in that order, each renamable and the order its own. It was
  an array in the backend module and a second copy of the same array in the browser, so a studio
  that started advertising somewhere new could not say so and the two copies could disagree about
  what the picker offered. Add Application, Bulk Entry and the record all read the one list, and
  offer a plain typed box if it is ever empty. The two sources the application writes for *itself* —
  **Application Form** and **Google sheet integration** — stay in the code rather than in the list,
  because they are what the public form and the sheet importer stamp on a candidate and compare
  against: renaming a row must not change what an importer writes.
- **Everything the register can hold is on the record, which a row opens.** The full four-section
  panel — the position, department and employment type applied for, the person, their qualification,
  skills, languages, pay expectations and notice period, their portfolio and résumé, the interview
  date, time, mode and Meet link — is where an application is *read and corrected* rather than
  where it is typed in. That is the CRM's own split between Add Lead and the lead popup, and it is
  what makes a candidate who arrived from a recruiter's spreadsheet with a column in the wrong place
  fixable.
- **Rows arrive five ways, and all five write the same record.** Typed in through Add Application;
  typed in a batch through **Bulk Entry**, which is the CRM's own dialog with the fields a
  candidate needs and no status at all, so every row lands in Yet to Connect; from a **CSV**,
  through the shared import dialog every module's table uses; from the Google Sheets linked under
  **Settings → Integrations → Interview**, which sync every two minutes and announce themselves so
  the page re-reads without a reload; and from the candidate themselves.
- **A candidate can be sent the screening form to fill in themselves.** Send Screening Form
  raises a secure one-time link, hands over the message to send with its own Copy, and emails it —
  the onboarding invite's own design for somebody the studio has not taken on: a hashed token, a
  short code the link carries, an expiry, and the candidate's own email or phone as the gate.
  Sending it moves the candidate to Form Submission Pending, their submitting moves them to Form
  Submitted, and cancelling moves them back; a candidate further along keeps their stage, since
  sending the form to somebody already scheduled is asking for the rest of their details rather
  than starting them over. **View All Invites** lists every form sent, one row per candidate with earlier attempts
  folded under it, and a live form can be corrected without changing its link. Its rows now carry
  **Copy Link** as well: the only way to the link before was to raise a *second* form, whose
  hand-over screen has one, which is the wrong answer when a candidate says the email never
  arrived.
- **A candidate who has already answered is sent their own form back, not a new one.** The record
  panel's footer holds **one** button about the candidate's form, and which one depends on whether
  they have answered: somebody who has not is asked with **Send Screening Form**, and somebody who
  has gets **Resend Form** in its place. It is a replacement rather than an addition, because
  offering a fresh link to a candidate who has already filled the form reads to them as a form that
  swallowed what they typed — and before this the register's only two answers to an application that
  came back with something missing were to ask for the whole thing again on a new link, which throws
  away everything they wrote, or for HR to correct it on their behalf, which puts HR's words in the
  candidate's mouth. Resend Form reopens **their own submission on their own link**, so the form
  comes back to them with every answer still in it to correct and resubmit — the Employee
  Repository's **Send Back** on the onboarding form, said for somebody the studio is still
  considering, down to the confirmation that shows the message to hand them *before* anything is
  sent, with its own Copy. The form goes back to Verified with its `submitted_at` cleared, so the
  next submission is accepted; its expiry is extended to at least a week out and **never shortened**,
  so a form reopened after its deadline is not a link that refuses the candidate the moment they open
  it; and the candidate moves back to Form Submission Pending **only from Form Submitted** — anybody
  since scheduled, put on hold or selected keeps their stage, because the studio has moved past the
  form and reopening it must not undo a decision somebody took. A form raised before short codes is
  refused rather than quietly reopened: its token is stored hashed, so there is no link left to send
  and the honest answer is to send a new screening form. The candidate is emailed a **different
  template** from the invite — "complete your application" a second time reads as a mistake — and a
  refused email does not undo any of it: the form is open either way, so the screen finishes as it
  would on a success and says in a notice that the message did not go, which whoever is sending it by
  hand already holds.
  The candidate's form asks for both their numbers through the **phone control** the rest of the
  application uses — a country picker beside a digits-only field on a numeric keypad — rather than
  the plain text box it had, which is how "9876 500 000 (whatsapp)" became a number nobody could be
  matched by. It asks **Native Place** and **Current Location** in place of a **State** and a postal
  **Address**: a state is too coarse to answer what a studio actually wants to know about somebody it
  is considering — can they be on the floor on Saturday, and would the job mean moving — and a full
  address is more than a studio should hold about a person it has not hired, besides being the kind
  of question that makes a candidate close the tab. Both new answers are ordinary one-line boxes, and
  both are new nullable columns
  ([20260919140000_interview_native_and_current_location](../../backend/prisma/migrations/20260919140000_interview_native_and_current_location/migration.sql)).
  `state` and `address` are **dropped from the form, the schema, the write and the prefill** — all
  four, because the submission is applied partially and a key the form stops asking about but keeps
  sending arrives empty and writes over the record — but the **columns stay**, since a linked sheet
  and the CSV import still fill them, and HR still reads and corrects them on the record. The sheet
  importer's headings moved with it: `Current Location`, `Native Place` and `Hometown` used to fold
  onto **City**, so a sheet naming both a hometown and a current location had one silently overwrite
  the other; each now goes to the field it names. **Skills** and **Languages Known** say *(comma
  separated)* in the label rather than only hinting it in the placeholder — a placeholder is gone the
  moment somebody types, so the one instruction that decides whether the answer is readable
  afterwards disappeared exactly when it started mattering. It does **not** ask which **Department**
  they would be in: that was asked as "where
  you would be working, if you know", which a candidate cannot answer about a studio they have not
  joined, and it is the studio's own answer, set on the record.
  Nor does it ask **Available From** as a bare date. When somebody can start is a conversation, not a
  date typed in before anybody has spoken to them — the honest answers are "immediately", "after my
  notice period" and "once my exams finish", and a picker takes none of them, so what it collected
  was a guess that then sat on the register as though the candidate had committed to it. The question
  underneath it *is* worth asking, and it is a **yes or no**: **"Are you an immediate joiner?"** is
  asked of everybody — a fresher between semesters has that answer as surely as somebody serving
  notice — and only a **No** is then asked for an **Expected Joining Date**, which cannot be in the
  past. Neither is a new column: When Can You Join is free text precisely because the answer is as
  often a word as a day, so a Yes is stored as "Immediate" and a No stores the date, and a link
  opened a second time reads the answer back off that same column. **Notice Period** is now a
  **band** rather than a box — Immediate, Under 15 days, Under 30 days, Under 45 days, 60 days or
  more — asked of somebody who has a job to leave: "1 month", "30 days", "one month notice" and
  "30days" were one answer typed four ways, and nothing could sort or filter them.
  **It asks what the candidate would least accept.** The register held one salary they named, which
  is the opening ask; the number that decides whether a conversation is worth having at all is the
  floor, and HR was learning it on a call. **Least Expected Salary** is asked beside Expected Salary
  — first, because it is the one that gets read — of everybody, freshers included, and is kept in
  its own column rather than as a "3-5 LPA" string, because a studio filters on the floor and
  negotiates against the ask.
  **The form ends with two questions instead of one shapeless box.** "Anything you would like us to
  know" came back empty, holding a covering letter, or repeating a phone number already asked for
  three fields above, and a column of those answers taught nobody anything. **How do you know us?**
  and **Anything about us?** replace it — the second is the cheapest read there is on whether
  somebody is applying to this studio or to forty of them, and it is the one answer on the form that
  cannot be prepared in advance. HR reads both on the record under their own **In Their Words**
  heading, apart from **Remarks**, which stays the studio's own note: the form no longer writes to
  it at all, so a candidate reopening their link cannot overwrite what HR wrote about them. How do
  you know us is **not** the register's Source, which is the studio's own answer to where a row came
  from and is set by a sheet's rules — a candidate writing into that would overwrite the import.
  **A candidate can attach more than their résumé.** The form took exactly one file, so a
  certificate, an experience letter or a scanned portfolio went into the portfolio link as a Drive
  folder or was emailed separately and lost. **Other Attachments** sits beside Résumé and takes up
  to five. They are stored the way every other file the studio holds is — uploaded to Cloudflare R2,
  and kept **as they are** rather than compressed, since re-encoding a PDF or a scanned certificate
  damages the one thing it is being read for; the guard is a 5 MB cap per file. HR reads them on the
  candidate's record and in the panel beside the table, each by the name the candidate's own file
  carried, and a candidate who submits again without attaching anything does not clear what is
  already there.
  **Portfolio is up to three links, not one box.** A photographer or an editor applies with a
  portfolio site, an Instagram and a Drive folder, and with a single box the other two went into
  Remarks or nowhere. It starts as one box with a **plus** beside it and grows a box at a time to
  three. The register's own Portfolio Link column is the **first** of them, which is what lets the
  table, the linked sheets and the CSV importer — none of which has anywhere to put three — go on
  reading the single column they always have.
  **What the candidate studied is asked under About You**, beside their name and their address,
  rather than in a combined Education & Work History section at the foot of the form: education is
  part of who somebody is, and it is the one part of a CV every candidate has an answer to — a
  fresher most of all, for whom it is the whole application. It had been sitting last, below salary
  and notice-period questions that do not apply to them.
  It asks **"Are you a fresher or experienced?"** before the work history, and that answer decides
  the rest: a fresher is shown no Experience Details list to leave empty and sends no rows, while
  somebody experienced has to name at least one company. **The rows are now the next thing on
  screen after the question**, instead of a page further down in a section of their own — the
  question and the only thing it changes were a screen apart, so a candidate could answer
  Experienced, scroll past four salary boxes and reach Submit without ever seeing the list they were
  meant to fill. **A fresher is not asked the four questions that presuppose a job** either —
  Current Company, Current Designation, Current Salary and Notice Period are simply absent until the
  answer is Experienced, where before they were four boxes to read, understand do not apply, and
  leave empty, one of them with "Leave empty if you are not working" as its placeholder admitting
  it. **Expected Salary stays for everybody**: a fresher has no current salary but does have an
  expectation, and it is one of the few answers that decides whether a conversation is worth having.
  Nothing withheld is ever demanded — the required-field check reads the same rule the form draws
  by, so a fresher is never refused for a question that was not on their screen.
  **Total Experience** is then added up from
  those rows and shown back **beside the question itself**, to everybody — for a fresher it reads
  "Fresher", which is exactly what the register records for them, so the question at the head of the
  section always has something beside it and the rows below it stay in step rather than
  falling out of alignment each time an answer hides a field. It is shown rather than asked for — it was a box wanting a number the
  candidate stated again row by row, two answers free to disagree — and the register's Experience
  column gets that sum, or "Fresher". **Highest Qualification** is gone for the same reason: it sat
  beside a Qualifications list that already asks for every qualification with its marks and year.
  It asks what a hiring form asks and **none** of what the onboarding form asks —
  no Aadhaar, no PAN, no bank details, no family, no emergency contact — because none of that is
  anybody's business until an offer is made. What it does share is the two repeating lists, the
  employee record's own Qualification and Experience lists, so a submission becomes a record HR can
  read. Their submission never blanks a screening answer HR has already given.
- **The register can be worked as a set, not only a row at a time.** A column of tick boxes in front
  of the table, header and rows alike, exactly as Leads & Followups has: ticking the header takes in
  every candidate the current tab and filters are showing, and changing tab clears the selection so
  it can never act on rows nobody can see. While anything is ticked the action bar becomes **Delete
  (n)** and **Change Stage (n)** — the destructive one red and first, the primary slot kept for the
  ordinary answer — and goes back to Add Application and its ⋮ the moment it is cleared. **Change
  Stage** offers the three *decisions*: Selected, On Hold and Rejected, with one reason written
  against **each** candidate's own record rather than once against the batch, because a decision is a
  thing about a person and somebody reading that record a year later needs to find it there. The
  other five stages are deliberately not offered — a candidate is at Form Submission Pending because
  a form went out, at Interview Scheduled because a conversation is in the diary, at Onboarded
  because an invite was raised, and writing one of those onto a row in bulk puts a candidate in a tab
  whose whole meaning is that something exists which does not.
  The tick boxes are their own permission, **`HRM / Interview Select All`** Read / Write: a role
  without it has no boxes at all and works the register through the row ⋮ exactly as before, and the
  two bulk routes mount the same guard, so hiding the column is never the only protection. Nothing is
  granted automatically — until the roles that should have it are re-saved in Role Management, only a
  Super Admin sees the boxes.
- **Every table is the one table.** Leads & Followups and the Calendar's Schedule used to draw
  their own `<table>` beside the shared `DataTable` - a second row, header, filter row and
  arrangement hook each - which is how the two came to disagree about the cell clipping and then
  the column filters. Both draw through `DataTable` now, and nothing on any other screen moved:
  what only those two did (the server's own sort, a calendar or a clock under a date or time
  column, columns sized to their contents, a right-click menu, a blue hover) is a prop every
  other table leaves off, defaulting to what it always had. The board keeps its saved column
  arrangements - the key is the one it always wrote - and keeps its own Update Details over a
  selection. The fifteen small lists inside forms, dialogs and panels draw through `SimpleTable`,
  each keeping the look it had. Two things read differently, deliberately: a hidden column on the
  Schedule is now remembered per source against the login rather than forgotten on reload, and
  the loading line on those two tables is the spinner every other table shows. Four things are
  the standard on every `DataTable`, with `SimpleTable` the one exception: columns dragged and
  pulled, the arrangement remembered against the login, cells clipped to one line, and rows
  revealed a page at a time - the Schedule, the project shoot list and the two lists in Service
  Creation used to opt out of the first two, and eleven tables drew every row at once.
- **One person, one row: a candidate already on the register cannot be entered again.** Matched on
  **phone or email**, on the same normalised keys the sheet importer has always used, so a number
  typed three different ways is one person. Names are not matched — two Priya Sharmas are two
  people — and a candidate with neither a number nor an address, which a referral often is, is
  accepted because there is nothing to match on. The check sits in the one creator all three manual
  ways in reach, so **Add Application**, **Bulk Entry** and the **CSV import** are covered together
  and so is any fourth way added later; the sheet importer has always classified its rows before
  writing them, and the screening invite reuses an existing candidate by this very same rule rather
  than a second copy of it. A refusal names the candidate and their ID. **Bulk Entry** answers the
  whole batch before writing any of it, reports every clashing row rather than the first and marks
  them on the grid, and catches two rows of one paste carrying the same number — the case a per-row
  check cannot see. **Editing** is guarded only where the write actually changes the number or the
  address: the register holds duplicates from before the rule, and refusing an unchanged value would
  make exactly those rows uneditable, so nobody could open one and correct it. **Add Application and
  the candidate's own form say so while the number is being typed** — amber, under the field, naming
  the candidate and their ID — the way Add Lead warns about a number the CRM already holds. Asked
  only once the number is whole, debounced, and held against the field as it stands, so a late reply
  warns about nothing rather than about a number nobody is looking at; a check that cannot be made
  is not a clash, since the save is refused by the server regardless.
- **The filter row filters the register, not the page of it in hand, and the menus cascade.** The
  register is read a hundred rows at a time, so filtering it in the browser filtered whatever had
  been scrolled to: a value the menu plainly listed answered "no records found" over a stage holding
  hundreds of them. A filter is part of the query, a menu asks the column what it holds
  (`GET /api/hrm/interview/candidates/column-values`), and **Select all** resolves to the filtered
  set — so a bulk action cannot reach rows the reader had filtered away. Each menu is **opened**
  under every other column's filter, the way Leads & Followups works: with a Source filter on, the
  Position menu offers the positions that Source actually holds, so every value on offer is one that
  finds rows. A column's own filter is left out of the query behind its own menu, or ticking one
  value would narrow that menu to the one value ticked and the filter could never be widened again.
  A menu already open is left alone: these are multi-selects, so the reader is still in the list when
  the filter changes, and re-reading it there emptied it under their hand — it re-narrows on the next
  open instead.
  Switching stage tab clears the filter row with the selection: a stage is its own set of values,
  and a filter carried across is an empty table over a stage that has rows.
- Delete is soft, and a deleted candidate is not brought back by the sheet that imported them. All
  of it answers to **`HRM / Interview`** — the screen, its routes, its screening forms, its
  linked sheets and its Google connection — so an HR role runs hiring without holding the CRM, with
  the one exception of the tick boxes above. The candidate's own form answers by token instead,
  rate-limited and never cached.
- **Notifications** — the top bar's bell is one panel for the whole application rather than the
  meetings-only one it used to be: what is waiting on you, then what you have been told, then the
  day's meetings. Notices are stored per user with a read time, so what somebody has been told does
  not depend on which machine they read it from, and each one opens the work it is about — a task
  notice opens the Tasks page with that task open, a lead notice opens the board with that lead open.
- **A lead put in somebody's name tells them so.** All three ways of doing it raise it: the Add Lead
  form with a CRM chosen, an edit that changes the CRM, and the bulk Update Details over a selection.
  A save that does not move the CRM raises nothing, and nobody is told about their own action, so
  taking a lead for yourself is silent. Until now the lead simply appeared on somebody's board and
  whether they noticed depended on whether they happened to look — which for a handover at five
  o'clock means the next morning.
- **Each kind of notice answers for its own module.** The whole bell used to be gated on
  `HRM / Task Management`, which was right while Tasks was the only thing writing notices; a
  salesperson without that permission would otherwise have been the one person never told a lead was
  theirs, and a task-only reader would have been shown a client's name off a lead they cannot open.
  So a new module tells somebody something by writing a notice type and naming the permission it
  answers for, rather than by adding a bell.
- **An administrator's bell is the studio's, not their own.** How wide it answers is the same rule
  that decides whose rows anybody gets: a reader that rule does not confine — a Super Admin, or
  anybody whose branch reach is not narrowed — sees the whole floor's follow-ups, replies and unread
  calls, each line naming whose work it is. A bell narrower than the boards beneath it would be the
  one place their view stopped.

Sales:

- Sales Manager.
- Create Project. Its rail groups Project Details, Sales Remarks, Service Creation, Shedule Payment
  and Payment Received under **Project**, then **Client Credentials** (for somebody holding User
  Management): every project they make comes with the client's own sign-in - a Username and a
  generated Temporary Password; no email. The Username is the client's mobile number - the ten
  digits of Client Main Number, without the country code - filled in as the number is typed and
  never typed itself; a number that already has a client login (a client booking again) is refused
  for now. Once the project saves, **Client Login Ready** shows the
  message (Settings → Message Templates → Client Login Credentials) with Copy message and Send
  WhatsApp, from the sender's own WhatsApp to the client's number. The client keeps that password -
  they cannot change or reset it. Clients sign in on their own page, **`/client/login`** - the link
  in that message - built for a phone: 16px, 48px-tall fields, no autocapitalising, the browser's
  saved-password fill, safe-area padding, a compact header on a phone held sideways, and the
  studio's slides beside it on a wide screen. It takes client accounts only (a studio account is
  pointed to the studio's sign-in) and offers no reset - "contact the studio" instead. Edit Sale Details has the same rail: Client Credentials shows the
  project's client login (username, status), or - for a project booked without one - makes it
  there with Create Client Login and opens Client Login Ready. A client
  signing in lands on `/client` (the studio's mark with Sign out beside it, then the project tracker), outside the
  studio's shell, and the API refuses a client everything but its own account and its own project
  (`GET /api/client/project`). The tracker shows the five stages Edit Project → Overall Status works out
  (`sales/projects/stage.js`, read on the server), so client and studio see the same stage - a
  vertical timeline on a phone, the first stage called **Project** to the client, whose card states
  the status and the project's basic details. Pre Production shows its people, plans submitted,
  each shoot's plan (Plan submitted <day> / Awaiting plan), and the Welcome Gift from Client Gifts
  for a project giving it; Production shows shoots finished, the Shoot Completed Gift (on Production
  only - not before the shoot, nor repeated on the later cards), and each shoot's production as a timeline -
  Plan pending / Plan ready, Team left the studio, Team reached shoot place, Shoot started, Shoot
  completed, each with when it happened - its chip saying where it stands now (Team on the way while
  the team is out of the studio), and Paused / On hold when the crew has stopped the shoot. The
  Pineapple meeting and File in stay the studio's. Never sent to a client: money,
  who converted or recorded the sale, update remarks, the crew's step names. A project needing a CRD document
  also gets a CRD Document card on the portal - Not started / Waiting for your details (Complete
  opens the form) / Started - not yet submitted / Form submitted. Deleting the project switches the login off.
  The client's own money is also on the API (`GET /api/client/payments`, `/quotation/pdf`, `/receipt`)
  for the Beam Craft client mobile app: what the project is signed for and what the client has paid,
  as Edit Project → Payments adds them up, with the signed quotation and each payment's invoice as
  PDFs (the studio's own invoice, unchanged). Nothing the studio spent, no descriptions or remarks in
  the data. `GET /api/client/reviews` lists what waits for the client - an Image Selection gallery to
  choose from, an album proof ready for review - with the link and PIN already sent on WhatsApp. The web portal (`/client`) does not show
  it yet.
- **Project drafts** — Create Project's **Save Draft** (every way in: New Project, a CRM conversion,
  a quotation) puts the half-filled form aside in **this browser's local storage**, per signed-in
  user, for **five days from its last save**: the sale details, shoots, services, deliverables,
  payment schedule and advance. Picked receipt files are not kept. **Drafts** on Bookings &
  Converted - shown only while a draft exists - lists them to reopen or delete. One draft per
  enquiry - a second save replaces the first. Choosing an enquiry that has a draft, however the form
  was opened, asks **Use draft** (the form reopens on it) or **Create new** (the form carries on, and
  the draft is deleted when the project is saved). Booking the project deletes its draft. Nothing reaches the server until Save
  Project; a draft is not shared with anyone, and is lost with the browser's site data.
- Edit Sale Details — corrects what this screen's own user entered. **Signed Quotation follows the
  quotation, not the screen**: booked against a quotation, the figure is that document's and is shown
  read-only here; booked without one, it is typed in that box, on Create Project and on Edit Sale
  Details alike. Correcting it later is Projects → Start Project's and Edit Project's, behind
  `PROJECT / Projects` `READ_WRITE`; the Payments tab's Initial and Total signed, CRM's Converted
  Amount, the projects table and payment receipts all read that one figure. Not required to book — a project saved without a figure schedules against zero and
  says so.
- **Duplicate Project** — Bookings & Converted's row menu offers it on a project that converted at
  **no quotation**, and on no other: a project sold on one is copied by duplicating that quotation
  and booking from it, so the copy is priced against a quotation of its own rather than naming a
  document raised for another client's enquiry. It opens Create Project already filled in — the
  shoots, services and deliverables come across as the new project's own pending plan, all of it
  editable, along with the vertical, branch, remarks and Signed Quotation. Three answers are asked
  for again: the **Enquiry ID** and **Client Main Number**, which name who it is being sold to, and
  the **WhatsApp group name**, which is a generator row the source project already claimed and
  cannot be claimed twice. **Payment Received opens empty** — the advance is a cash entry, and a
  copy must not credit the studio a second time for one payment.
- W/A Group-Name Generator.
- Quotations — one Quotation Generator, one register and one client-facing PDF across three
  **brands** (Dum Dum, Qua Qua, Corp). The brand is chosen first and decides what the generator
  offers - terms, PDF wording and pictures, configured from Settings → Quotation
  Settings (General for what every brand shares - the notes and trademark cards, Journey &
  Legacy with its map and timeline, Our Infrastructure with its collages, each with a switch that
  leaves the section off the client's copy - and Terms, PDF Content and PDF Image per brand); the brand masters for services, deliverables,
  packages and pricing exist in the API but have no screen, so the generator offers the project
  catalogue at the studio rates, exactly as before. Add Shoot takes several shoots at once - there
  and on Create Project and a project's plan alike - the rest of the form is their common details,
  and together they are **one** shoot named for all of them, "Haldi + Mehandi" (one Main Event; a
  shoot already in the list is not added twice). With two or more names a **Location** choice
  appears: Single keeps one Shoot Place, District and State for all of them; Multiple asks the three
  for each name, and the one shoot keeps each name's place, its Shoot Place reading "Chennai +
  Madurai" beside the name everywhere it is shown. Editing a shoot takes one, and opens that same dialog on
  it everywhere; the shoot list has no inline editing. A shoot's Choose Services lists every active
  service whatever the shoot's type - in the Quotation Generator, Create Project and Edit Sale
  Details alike, one rule in the shared section (only Choose Deliverables narrows to the type) -
  and a service added to a shoot, on any of those screens, starts its Session Timing on the
  shoot's own session where the service offers that one - blank where it does not - which the
  person may then change. The Quotation Summary runs Service Cost → an optional **Performance
  Cost** (a rupee amount added, "Performance Cost +") → **Discount** as two boxes, a percentage (`%`, 0-15) and the rupees it comes to (`₹`,
  up to 15% of service + performance cost), both typed into: the one typed last is kept and the other
  worked out from it, including when the cost changes (0 on a new quotation, taken off service +
  performance cost; `lib/quotationDiscount.mjs` is the one calculation) → up to three
  **Extra Discounts** (a reason and a rupee amount each, never a percentage, "Extra Discount +" /
  the heading's "+", each removed by its own ×) → Total Cost. **The Discount never comes to more than
  15%** of service + performance cost (`MAX_DISCOUNT_PERCENT`, rounded to the whole rupee as a
  percentage discount is): the generator applies no more than that to the total, names the limit
  beside the box, and refuses Save Draft and Generate past it. The extra discounts are not held to
  the 15% - they may sit beside a full 15% - only to what the Discount leaves, so the total never
  goes below nothing; the API
  refuses it again on every write, and the CRM Quotation Calculator offers 0-15%. A quotation saved
  under the old limit is never rewritten - it reads as saved, and an edit of it must come down to 15%. All are kept in the version's payload
  (`discount` - always the percentage, for typed rupees what they came to to two places - with
  `discountInputSource` saying which box was typed, so a quotation typed in rupees reopens on its
  `discountAmount`; absent on an older quotation, which opens as its percentage; `performanceCost`,
  `extraDiscounts`; a quotation saved with the earlier single
  `extraDiscountReason` / `extraDiscountAmount` opens with it as the first). The client's copy
  (and its PDF) lists them on a card between the events and the price - "Discount - ₹1,000", the
  rupees only and never the percentage - under a tag icon, then each extra discount by its reason under a second icon - read from the
  saved quotation and never taken off again, since the price below is the saved total; a quotation
  without a discount has no card. The public API sends no percentage either: the `discount` column and
  payload field, and every `defaultDiscountPercent` in a snapshot, are left out of what the client's
  link is served (`clientFacingQuotation`), with `discountAmount` always present in their place.
  Under the Discount sits the **Hidden/Round Off Discount** - one rupee box, never a percentage, empty as
  nothing - to bring the total to a round number. It is taken off last, after the extra discounts
  (so it never narrows what they may take), once, and no further than nothing: the generator names
  the most it can be and refuses Save Draft and Generate past it, and the API refuses discount +
  extras + round off above the cost. Kept in the payload as `roundOffDiscount` (absent on an older
  quotation, which reads as none), so drafts, edits, versions and duplicates carry it. It is folded
  into the saved total and shown nowhere the client reads: no line on the client's copy or its PDF,
  and `clientFacingQuotation` does not send it. Every version snapshots the brand as it stood
  when it was raised (logo, terms, wording, GST) and stamps the price each line was added at, so a
  later change in Settings never alters a quotation already sent. The register badges and filters
  by brand; the quotation number keeps its existing `DBS-QO-<vertical>-<branch>-000001` form.
  The generator's **Preview** (beside Generate Quotation; an eye alone on a phone) opens the client's
  copy of the form as it stands in a new tab, unsaved edits included and nothing saved - no draft,
  number or version (`POST /api/sales/quotations/preview` builds it exactly as a save would and
  writes nowhere). The tab stays open and brings itself up to date - the same tab, never a second -
  0.8 s after editing stops, or at once on a press, with the footer saying Updating preview / Preview
  up to date (once the tab has drawn it) / Preview not updated + Retry. The same pause auto-saves the
  edits to this browser tab's session storage (`lib/quotationEditingDraft.mjs`, per `edit:<version>` or
  `duplicate:<source>`), so reloading Quotations (`?edit=<version id>`) reopens the generator with them;
  Close and every save clear them, and nothing reaches the server until a save
  (`lib/quotationPreview.mjs`: one preview session
  per opening of the generator, a numbered form per press so the newest always wins, messages taken
  only from the tab's own generator on this origin; a reload keeps the latest, and a closed
  generator leaves the last version shown, marked as no longer updating); the tab shows no Download, no expiry and no Terms / payment links, and Quotation
  ID reads Preview. The client's copy carries Noto Serif Tamil and Noto Sans Tamil with the page,
  so Tamil prints in the PDF as it reads online - it used to depend on a Tamil font installed on the
  machine, which the Linux server printing the PDF does not have. The PDF's photographs are printed
  as JPEG sized for the sheet (`pdfImageCompression.js`), which took a quotation from about 5.9 MB to
  about 1.7 MB; it waits for every picture before printing and leaves out blurred shadows, which
  took a typical quotation from about 1 MB to 650-800 KB.
  The client's copy (`/q/<token>`, and the PDF printed from it as one continuous 1080px sheet) is
  the studio's reference proposal design: cover photograph, brand mark and name, navy proposal
  card, a card per event with services and deliverables, navy pricing card, notes, trademark
  card, Journey & Legacy over the India map, an infrastructure collage per branch, and the Thank
  You photograph with the footer. **A branch's collage is laid out from how many photographs it
  has** - one to eight, each count with a composition of its own, so a branch with six no longer
  prints the eight-picture mosaic with two frames missing. Eight prints that mosaic (two wide
  frames, four small beneath them, two tall down the right, in that order); every count stands the
  same height, so branches line up down the page. The order the studio saves is the order printed,
  arranged by dragging the frames in Settings → Quotation Settings → General, which previews the
  composition with the very component the client's copy uses. One template for every brand: the name is the Global Name (the
  bundled name when blank), the mark the Global Logo (the bundled mark when none is set), the website and phone
  the quotation's branch's (Organization → Branches), the locations every active branch, and the
  pictures, the timeline and every word the brand's own from Settings → Quotation Settings → PDF
  Content - all frozen into the version's snapshot when it is raised. The cover and Thank You
  photographs are chosen by what the quotation is for: PDF Image holds **picture sets**, each
  naming the shoots it answers for and carrying that pair, so a wedding opens on a wedding
  photograph and a naming ceremony on its own. A quotation prints the set its **main event** falls
  in; where the main event is in no set another of its shoots answers, and where nothing matches the
  **first set** prints, which makes it the fallback. Each brand's dropdown offers only the shoots
  that brand quotes for - Dum Dum 14, Qua Qua 13, Corp 2, spelled as Add Shoot spells them - and a
  shoot belongs to one set only. The version freezes the pair it resolved to, so re-pointing a set
  later cannot change a quotation already sent. **The pictures are a tab of their own, PDF Image**,
  beside Terms and PDF Content on each brand, and the category a set belongs to is chosen from a row
  of tabs - one per category the brand's Field Settings → Categories list holds, never written into
  the screen, so a category added there appears as a tab on its own; each category tab shows that
  category's sets alone, and an edit to one category's sets writes the whole list back so the others
  survive it. PDF Content keeps the words and the download answer. Each tab saves only its own part
  of the brand - the brand PATCH applies a field only where it is sent - so saving the pictures
  never rewrites the wording and the other way round. Nothing stored moved: the same
  `pdfAssets.coverSets`, the same files, the same fallback, the same PDF.
- **Settings Remarks start a quotation line's Remarks.** The note a service or deliverable carries in
  Settings → Project (its Remarks box) fills a new quotation line's Remarks the moment the line is
  added - picked by hand, by a package, by the service that brings it, or from the CRM calculator - and
  from then on the line holds its own copy: typed over, cleared, saved, reopened and printed on the
  client's copy under the line exactly as the quotation holds it, never written back to Settings. A
  line reopened from a saved quotation keeps its saved remarks whatever Settings says since. An old
  bare "Yes"/"No" from when the column was a switch is not copied. A new deliverable line's name no
  longer carries the note (it arrives as the Remarks instead, so the client is not shown it twice);
  lines already saved keep the name they were sent with.
- **Sharing a quotation with colleagues.** The Quotation Generator carries a **Share with**
  multi-select, under Quotation Brand, on a new quotation and on an edit. The people chosen may
  read **and** change the quotation although their own work does not reach it: it appears on their
  Quotations register with their own, with every version of it under it, and they can raise the next
  version, edit the draft and delete it as the owner can. The share is of the **chain**
  (`sales_quotation_share.quotation_number`), not a version, so it is one list whichever version is
  open, and a duplicate - another quotation for another enquiry - starts with nobody. On a quotation
  that already exists the picker **saves itself** and raises no version
  (`PUT /quotations/:id/shares`): a version is the document the client receives, and who at the
  studio can open it is not part of that document. On a new quotation, and on a draft, the list is
  saved with the quotation, since there is no chain to write to until then. And a **Save changes
  that changed nothing** in the document raises no version either, saying so instead: the comparison
  is the client's details, the lines and their quantities, the figures and the notes - never the
  form's own working, which an older quotation gains the moment it is reopened: each line's rate
  from the catalogue, the catalogue row behind it, the brand snapshot and which discount box was
  typed. Anyone whose
  own work the quotation is may share it - there is no separate permission - and a **sharee** may
  not: they see the list read-only, so a share cannot be passed on or a colleague dropped from it by
  somebody it was lent to. A share widens *which*
  quotations somebody sees and cannot put them on the screen, which is still
  `SALES / Quotation Management` on the route, so the picker offers **only** the working employees
  whose roles grant it - sharing with anybody else would reach nobody. They were listed marked "no
  access to Quotations" and still choosable until 24 Oct 2026.
- **Quotation drafts.** The Quotation Generator's footer offers **Save Draft** beside **Generate
  Quotation** on a new quotation (blank, from the CRM calculator, or a duplicate) and on a draft. The
  first save numbers it - version 01 of a new chain, kept at `sales_quotation.status = "Draft"` with
  no live link - and asks only for the Assigned Branch, which the number is drawn from; the brand
  locks with it. Every later save rewrites that same row (a save over a newer one from another tab
  is refused), and Generate Quotation on a draft generates it in place under the same number, with
  the usual share dialog and five-day link. Until then nothing reaches a client: the public page,
  its PDF and payment page answer 404, the studio PDF, link renewal, Duplicate and a new version are
  refused, and a project's quotation picker does not offer it. The register's **Draft** tab lists
  drafts of every brand; **All** and the brand tabs list generated quotations only. A draft row
  offers View, Edit and Delete. A generated quotation is never drafted - its Edit still raises the
  next version at once.
- **Finalize Quotation - one finalized version per quotation.** Every version is **Finalized** or
  **Unfinalized**, each on its own; a new version starts unfinalized. The Quotation Generator's
  footer reads Close, Preview, Save as new version and a green **Finalize Quotation**. After a
  confirmation it finalizes the version that is open - newest or older - without raising a version,
  shown as a **Finalized** badge with who and when. A finalized version is kept exactly as it is:
  its client link never expires (an already lapsed link is re-enabled first; finalizing never
  reopens one on its own), the form reads only, Save as new version is disabled with the reason,
  and it cannot be deleted - on the server too. Only one version of a quotation can be finalized at
  a time: while one is, Finalize on any other is disabled naming it, and the server refuses it with
  "Another quotation version is already finalized. Please unfinalize that version before
  finalizing this one." Nothing unfinalizes a version by itself. **Unfinalize** (also confirmed)
  changes only that version: kept exactly as it was, editable again, its link back on a five-day
  clock. Any unfinalized version can be edited and saved as the next version. Finalizing with
  unsaved changes on screen is refused - they are saved as a new version first. The version picker
  and the version history show each version's status. This is separate from the register's
  *Finalized Quotation* column, which is the version a project was booked at.
- **A project is booked only at a finalized quotation.** Create Project's **Select Quotation**
  lists every version of the chosen enquiry's quotations, drafts included, grouped under each
  quotation number (V1 first), each with its status: Finalized (green) or Unfinalized (grey, a
  saved draft included). Only a Finalized version can be chosen; the rest are shown dimmed
  and cannot be picked by mouse or keyboard. With nothing finalized it says "No finalized
  quotations available for this enquiry. Please finalize a quotation before creating a
  project."; a failed load offers Try again. The list is read again when the tab comes back to the
  front, so a quotation finalized or unfinalized in another tab shows its new state, and a picked
  version that has since been unfinalized is taken off the form with a note. The register offers
  **Create Project** only on a finalized version. The server checks the same on save, so a request
  sent by hand is refused too. A project already booked keeps its version: editing it still shows
  and saves that version even if it has since been unfinalized, and only moving it to a different
  version needs that version to be finalized.
- **The client's copy links to where the money goes.** The navy pricing card prints **For Payment**
  under the GST line, set like the terms link, and it opens `/q/<token>/payment` on the same sheet:
  the quotation's **Assigned Branch** as Organization → Branches holds it — **a Bank Transfer card
  per account** (holder, bank and branch, account number, IFSC), every UPI ID it holds and the
  Payment QR — with a copy control on each account number, each IFSC and each UPI ID. Only what the
  branch holds is printed: no UPI ID means no UPI section, several means a row each in the studio's
  own order, no QR means no picture, and a half-filled account prints the rows it has. Several
  accounts means several cards, in the branch's own order and numbered, so a client paid into one
  reads exactly the card they read when a branch could hold only one; an account with no number at
  all is not printed, and a branch left with nothing anybody can pay into offers no payment page. Nothing is
  typed into the Quotation Generator for it; the Assigned Branch is the source — its resolved
  branch, or failing that the branch whose exact name the quotation holds — never the head office,
  the first branch, a branch guessed from a city, or one that has since been closed: the sheet may
  guess a branch for a phone number, but not for money. **Read live, deliberately**, like the download answer and unlike the words and the price:
  where the money goes is the studio's standing fact about the branch, and an account changed after
  a quotation went out has to reach the client still paying it. A quotation whose branch has nothing
  to be paid into prints no link and opens exactly as before; a deep link to its payment page says
  so in one sentence. The public endpoint hands out the seven payment strings and nothing else off
  the branch row, behind the quotation's own token, its 404 and 410, and a rate limit of its own.
- **Whether the client may keep a copy is the brand's decision** — Settings → Quotation Settings →
  *brand* → PDF Content → **Allow Client Download**, a Yes/No, answered **No**
  until somebody says otherwise. Dum Dum, Qua Qua and Corp each hold their own answer and a
  quotation is judged by the brand it was raised under: a Corp proposal may be a file the client is
  meant to forward while a Dum Dum one is read at the link and nowhere else. On **No** the download
  icon is not drawn on the client's copy *and the file itself is refused* — a client who kept the
  address gets a refusal rather than a PDF — so it is a decision about the document rather than a
  hidden button. Read **live** rather than from the version's snapshot, unlike every other thing the
  page prints: switching it off is meant to reach the links already sent, and switching it on lets
  a client who has been waiting simply download. The studio's own **Download PDF** from Sales →
  Quotations is unaffected: it is a signed-in route of its own, so a salesperson can still send the
  proposal on for a brand that hands its clients nothing.
- CRM placeholder.
- Leads & Followups — four boards behind one switch, in the studio's own order: **Dum Dum, Qua Qua,
  Corp, Call Box**. The three verticals are the lead table; the **Call Box** is
  **the callers nobody has added yet** — one row per call, each under a Call
  ID of its own (`DBS-CLID-000012`), and off the board the moment somebody reads the caller and adds
  them to a vertical. What it becomes then is a lead on that vertical's own board, under that
  vertical's enquiry id (`DBS-EID-QQ-CBE-000004`), which is where the studio works it from; a row in
  two places at once is a row two people each think the other has dealt with. So the **Enquiry ID**
  column here is always the call's own code and never a lead's, and what is on the board is what is
  outstanding. A call from a number the CRM does not already hold no longer creates a lead — that is
  what used to put a wrong number or a two-second misdial into the same run of enquiry numbers as a
  real client.
- Nothing of the call is lost when it leaves. Every call from that number follows the caller to their
  lead, where the **Call Logs** tab reads the history back — so a client's calls are read where the
  client is. A caller may be one enquiry in each vertical; their calls stay with the enquiry they
  were first written down as. Calls left pointing at a lead that is not there — one deleted since, or
  an id in a format no lead has carried for a year — are re-pointed at that first lead on the next
  read, which is what used to leave a caller on this board however many times they were added.
- Leads & Followups → Call Box → **five tabs: All, Incoming, Outgoing, Connected, Not Connected.**
  Incoming is every call the client made — answered, missed or rejected. **Not Connected is the calls
  the studio did not answer**: the client rang and nobody picked up. It used to be every call of zero
  length whichever way it went, which put two unrelated things on one list — a number the studio rang
  that did not pick up is the client being unavailable, and only a client who got no answer is work
  anybody has to do something about. Outgoing calls that never connected are read under **Outgoing**
  instead; nothing is hidden, it is filed under the thing it is. The tabs still deliberately overlap —
  a missed call is in Incoming and in Not Connected at once — so the counts on the labels add up to
  more than the board holds. The **Status** column reads *Never Attended* for exactly what Not
  Connected lists, keeping the different word on purpose: the tab says what you are looking at, the
  cell says what happened to that call.
  Double-clicking a call opens the Add Lead form on what the
  call already knows — caller, number, when it came in, who took it, what was said — with the
  Vertical radio above it for whichever of the three they turn out to be; confirming **creates** the
  lead, mints its Enquiry ID for that vertical, and hands every call from that number to it. The call
  stays on the board wearing the new id, and double-clicking it again opens the lead. Turning a
  caller down is done in that same form: **Rejected** is offered in its Lead Status pills when it was
  opened from a call and nowhere else, and the lead it writes lands in its own vertical's Rejected
  tab. Until a caller is added here they are on this board and nowhere else: the Contacts directory
  and Create Project's enquiry picker both list the enquiry a caller *became*, never the call itself.
- **Leads & Followups → a date range on the header, left of the Nebula icon.** Today, Yesterday,
  This Week, This Month or two days picked by hand, over whichever board is on screen — one question
  asked once, where the only way to ask it before was to type into the Date column's filter, which
  matches text and so can say "August" but never "the last seven days". It narrows the rows, the
  total under the table and the counts on the tab labels together, so a tab never promises rows it
  will not show — **each tab is counted the way it is read**: the range is applied inside each tab's
  own count rather than across the whole strip, so a tab that does not carry the range is counted
  without it. **All Time** is where it starts and where it goes back to. On Custom Date the two
  calendars come first and the switch follows them, so the row reads left to right as the answer. It is offered only where
  it means something: on the Call Box that is the **All** tab alone — the other four are queues to
  work through rather than periods to report on, and narrowing "the calls nobody answered" to this
  month hides the ones from last month that are still nobody's enquiry — and on the three verticals
  every tab except **Today New Leads**, **Today Pending Followups** and **Yesterday Pending
  Followups**, which are already a date. A range and one of those is two answers to one question, and
  the honest result of asking it is an empty board.
- Asset Management → **the register is filtered by branch, not by category - several branches at
  once.** The main-category picker beside the heading is gone and a **Branch** picker sits with the
  header's controls, taking as many branches as are ticked; nothing ticked is every branch. The ticks
  are kept in the URL (`?branch=3,7`) beside the status tab, so a link holds them. The branches
  offered are the ones the viewer's roles reach for `ASSET / Asset Management`, answered by
  `/api/assets` rather than by the branch register, so the picker never offers a branch whose assets
  the data scope would hide. The status tabs and their counts narrow with it. Branches in a link the
  viewer does not reach are said and left out rather than left showing an empty table, and an empty
  table names what it was narrowed by. Not on the **Asset Requests** tab, where a branch narrows
  nothing: a request is raised against equipment that does not exist yet. The list goes to
  `/api/assets` as `?branchIds=3,7`; the single `?branchId=` still answers, and `categoryId` and
  `includeChildren` are still accepted though no screen sends them.
- Every module header → **the action row ends the same way: the page's buttons, then Nebula, then
  the ⋮.** Nebula used to open the row; it closes it now, beside the quiet ⋮ rather than apart from
  it, and the primary button keeps the last bordered place where the eye looks for it. The order is
  fixed in `ModulePageHeader` - a page passes what scopes it (`leadingActions`), what it does
  (`actions`) and its ⋮ (`menu`) - so no page decides its own order. A ⋮ passed at the end of
  `actions` still draws, just before Nebula instead of after it.
- Production → **who may work a shoot's service is the Technical department.** The Person and Assist
  pickers, the Shoot Board's free shooters and the save's own refusal all read the employee's
  departments: in **Technical**, they can be put on a service; not in it, they cannot, and the
  pickers leave them out. It was a list of nine shooting skills matched against Settings → Skills,
  which tied a person's place on a shoot to a tick nobody kept up and a list that had to follow the
  services the studio sells. Read through the department link rather than the text copy, matched
  exactly: "Non Technical" is a department of its own. Vendors are external shooters and are not
  asked either way.
- Calendar → Team Attendance → **one chip a day, not one per status.** "Attendance · 5" rather than
  "Absent · 2" beside "On leave · 3"; the pop-up behind it counts each status under the date and
  lists the names under their own heading. A day of one status keeps that status's colour, a mixed
  day takes a neutral grey, and the branch filter rebuilds the counts from whoever is left in it.
- Calendar → My Attendance → **one Attendance column, the day's times in its popup.** The list used
  to carry Status, Login, Logout and Worked; three of those are blank on an absence or a day's
  leave, which is what the list is read for. The column holds what the day was - still filtered by
  the six statuses and still what the board groups by - and the login, logout and hours are read in
  the entry's details popup beside it.
- Calendar → **the branch filter takes several branches at once**, in the row of controls rather than
  beside the heading, and is kept between the calendar and the list. Nothing ticked is every branch;
  holidays and the viewer's own attendance belong to no branch and stay whichever are picked.
- Asset Management → Vendors → **Add Request raises a vendor's bill from the vendors page**, on the
  Payment Requests form opened on the Vendor Payment kind with no kind to choose. It is an ordinary
  payment request once saved - decided in Payment Requests, shown on the Vendor Payments view - and
  the button needs `ACCOUNTS / Payment Request` Read / Write, not Vendor Management's own.
- Asset Management → Vendors → **the screen is two views: the register, and what the studio owes.**
  A picker beside the heading switches between **Vendors** and **Vendor Payments** (`?view=payments`,
  so a link holds it). The payments view is one row per Vendor Payment bill - vendor, bill date,
  amount, status, and what has left the account against it, summed from the cash entries the payment
  wrote - with status tabs and billed / paid / still owed at the foot, counted over everything the
  reader may see rather than over the tab shown. One vendor's ledger is read through the table's own
  Vendor column filter rather than a picker above it. **Read-only:** a bill is raised
  in HRM → Payment Request, approved in Payment Requests, and paid from Accounts Manager → Pending,
  where the payment form says how the money moved. It answers for `ACCOUNTS / Payment Request` rather than Vendor Management, so
  a reader holding only the vendor register is never offered it, and the same visibility rule the
  Payment Requests screen reads by applies underneath. The bill names its vendor by
  `payment_request.vendor_id` now; the vendor name beside it is the copy the request was raised with.
- Asset Management → **what the ⋮ offers is decided per asset, not per person.** The register is
  meant to be held widely, and the equipment in it is not everybody's to dispose of, so the screen
  asks the question once per row instead of once per page. An asset is **yours to manage** if you
  are the employee named as its **Manager**, or the login that **added** it — there you get Edit,
  Start Inspection, every status move the machine allows and the handovers, but never Delete. Every
  other asset you can see gives you **View and Under Repair**: the person holding a broken lens is
  the person who knows it is broken, while deciding it is working again is the manager's call, so
  `UNDER_REPAIR → ACTIVE` is not offered to them. **Import and Delete are a Super Admin's**, and are
  deliberately not permissions — a permission held that widely could not separate disposing of a
  camera from asking for one. **Adding** an asset is no longer on this permission at all: it moved
  to `ASSET / Asset Administration` (**Administer Assets**), held by few, so being able to raise a
  request no longer means being able to register equipment and name its manager. The creator is in the rule on purpose: approving an asset request
  *creates* the asset and records the approver against it, so somebody who approved one and forgot
  to name a manager can go back and set one. Who may *see* which assets is unchanged and is still
  [the data scope rule](IAM.md#whose-records); this sits on top of it. Nothing changed in Role
  Management and no permission was added — see
  [IAM.md](IAM.md#one-asset-at-a-time-who-may-change-it).
- Asset Management → Client Storage → **a storage record is raised by saving the project, and by
  nothing else.** A project answering Storage Needed = Yes gets one when it is started, or when a
  shoot is added to it. There is no read-time creation, so a project that was already under way when
  the feature shipped has no record — which is why the table can read as empty on a studio with
  plenty of projects. `backend/scripts/backfillClientStorage.js` raises the missing ones; it reports
  without writing unless given `--apply`, and never revives a record somebody removed on purpose.
- Leads & Followups → Dum Dum → **Last Followup Date and Next followup Date are columns on the
  table**, beside the Status they qualify. Qua Qua has carried both since it was built and Dum Dum
  carried neither, so on the board the three pending tabs are read from, the date those tabs sort by
  could not be seen on the row. Next Follow-up Date was already editable in the lead panel on every
  vertical; Last Followup Date stays read-only there, for the reason it always has — the activity log
  already records when a lead was last worked, and a date typed by hand only disagreed with it.
  **The Dum Dum CSV template now carries these two columns as well**, because the template is that
  same column list: a Dum Dum file exported before this change is missing them and will be refused
  on import until it is re-exported.
- Leads & Followups → **Bulk Update can move the ticked leads to another vertical**, after a
  warning and a confirmation. The old vertical's own fields and custom fields are cleared (and Qua
  Qua's occasions), a lead whose number is already in the target vertical stays put and is counted,
  Converted & Followup becomes Converted off Qua Qua, and the Enquiry ID is kept. A single lead moves
  the same way from the **Vertical** field in its popup's Client Details (CRM Leads, Read / Write) -
  picked, then moved on Update once the warning is confirmed - refused there when its number is
  already in the target vertical; **Assign To** sits beside it on every vertical and saves with Update.
- Leads & Followups → **the status decides the follow-up date.** CNA, Interested, Followup and
  Converted & Followup need a Next Follow-up Date before the lead popup or Add Lead will save.
  Invalid and Rejected carry none, nor does Converted on Dum Dum and Corp, and the server clears it
  on every write; a Converted Qua Qua lead keeps an optional one. Moving a lead to Converted (popup,
  Bulk Update, project save) sets its Last Follow-up Date to that day. Board
  quick actions and imports are not held to the required date.
- Leads & Followups → **the three pending tabs are cut by the Next Followup Date, whatever the
  status but Converted** - a plain Converted lead is on none of them on any vertical, even a Qua Qua
  one that kept a date (Converted & Followup still shows). Today Pending Followups is every lead whose next follow-up is today, Yesterday
  Pending Followups those dated yesterday, and Overall Pending Followups everything dated today or
  earlier, so Overall overlaps the other two and the strip's counts do not add up to the board.
  They used to ask for status **Followup** as well, which hid a booked call on a lead at any other
  status. A lead with no follow-up date, or one that cannot be read as a date, is on none of the
  three; Invalid and Rejected clear the date when they are set. Cut by the follow-up date, not the
  Enquiry Date: a lead that enquired in July with a call booked for yesterday is owed yesterday.
- Leads & Followups → **Today New Leads is the enquiries dated today**, read off the Enquiry Date
  column rather than off the day the row reached the board. The two are different for anything that
  arrives from a Google Sheet: a sync writes today's date onto every row it takes, so the tab used to
  fill with a month of older enquiries the moment a sheet was pulled in, and leave out the ones whose
  Enquiry Date column actually read today. A lead nobody dated at all still counts as new on the day
  it was entered — that is the only thing left to date it by — and a lead whose date cannot be read
  as a date counts as neither, which is what its own column shows. The header's date range is still
  the day the row arrived, and is not offered on this tab, so the two are never asked together.
- Reports & Analytics → **a person on these reports is somebody in the Employee Repository**, at the
  working statuses (Active, in Training, PIP) and not archived — the same definition the repository's
  Active tab is cut from. That is both the **Employee** filter and the tables under it: Employee
  Analysis, Work Hours and the call half of WhatsApp Usage grouped the call log by whatever each
  handset was labelled in the Callyzer app, so they listed people the dropdown above them refused to
  offer — "Manjula DBS" beside "Manjula Donkena", "Deploy Check" beside both, one row per label
  anybody had ever typed into a phone, with nowhere to correct any of it.
- A handset is matched to its employee by the repository's **contact number** first — the reliable
  key, since renaming a phone does not change its number, so one person on two handsets is one row
  under the studio's own spelling — and by an exact **name** second, for a handset whose number the
  repository does not hold. A handset matching neither is nobody, and its calls are on no person's
  row. `npm run report:employee-match` in `backend/` lists both sides before a deploy: if somebody
  real is in the second list, filling in their contact number on their employee record is the fix.
- The **call** reports — Summary, Lead Analysis, Never Attended, Not Picked Up, Call History — are
  unchanged and still count every call. They are about the work rather than about the people, and
  dropping a call from them because of who was holding the phone would make their totals disagree
  with the CRM's own call history.
- Reports & Analytics → **Work Hours**, the studio's timesheet. A row per person per day: when they
  started, when they finished, the hours, the idle time, the length of the day and how many sittings
  it took.
- **Work Hours is Call Hours + Application Usage**, and it is the one report that joins the two
  halves of the studio. The application half is measured rather than inferred — the browser beats
  while the tab is in front of somebody and they are touching it, so time in another application, or
  in front of a tab nobody is using, was never recorded. That is exactly what made the old column
  wrong: the people this report is read about spend their day on the phone, and a salesperson on a
  forty-minute call is not touching the browser, so forty minutes of work was being counted as idle.
  The call half is what Callyzer reports for that person on that day. Both are shown beside the
  total, because a manager reading a short day needs to know which of the two it was short on.
  It is effort across two systems rather than wall clock and can exceed the length of a day: a call
  taken with the application open counts in both, because both are true and nothing records which
  minutes overlapped. **Day Span** is what stays wall clock, and **Idle** stays the gaps between the
  application's own stretches. The two sides are matched on the person's *name*, which is the only
  key there is between a Callyzer handset and an ERP login — a name on one side with no match on the
  other still gets a row, showing that half and nothing of the other, which is the honest way to be
  wrong about a join with no key. Application Usage beside it is the browser half asked the other
  way: one total per person for the whole range. A stretch that runs through midnight is counted
  against the day it began, so the two tabs always agree. A day is the studio's day - midnight to
  midnight in Asia/Kolkata, read off the stored UTC timestamps by `services/studioDay.js` - and the
  attendance register derives its days through the same helper. Application Usage's **Inactive Time
  Track** is the time signed in less the time used: a day's signed-in time runs from its Login line
  to its Logout line in the User Activity Log, or to the end of the studio day where nobody signed
  out (the browser's Sign out writes no Logout line; the desktop app's does). A day with no Login
  line falls back to the span of its use, first stretch to last (`crm-reports/signedIn.js`). Work
  Hours' Idle column stays the gaps between the application's own stretches.
- Leads & Followups → ⋮ → **Bulk Entry**, which opens the **Bulk Entry** dialog: several clients
  typed at once. Add Lead asks one client everything its vertical knows how to ask, which is right
  for the lead somebody is about to work and wrong for twenty names off an event or a call with a
  planner. This asks the few that make a lead findable and assignable — Enquire Name, Contact,
  Assigned Branch, Assign To, Next Follow-up Date and a Description — plus **Date of Birth (or)
  EDOD** on Qua Qua, which is what that vertical plans a shoot from. A name, a number and a branch
  are required and nothing else is; who takes it, when, and Qua Qua's date are not, because a batch
  is very often typed before anybody has decided or asked. **A batch lands in Yet to connect**: the
  rows carry no status, which is what that queue is — a lead nobody has given a status to — so
  twenty names off an event sit in the list of calls still to be made until whoever works them sets
  one. It is not a stored word and it is not a pill: an empty status column is what reads as Yet to
  connect, on the board, in the tab's SQL and in the Status cell alike. Bulk Entry used to stamp
  **Interested** on every row, which said somebody had spoken to a name that had only just been
  written down, and put a whole batch past the queue it belonged in. Add Lead still stamps
  Interested, and that is the difference between the two: one client being written up as they are
  worked, against a list still to be rung.
- **One vertical for the batch, chosen once at the top, and it opens on the board being read** —
  standing on Qua Qua and importing gives Qua Qua leads without a press, the same behaviour Add Lead
  has. It was asked per client at first, which was answering a question nobody had thirty times: a
  batch typed in one sitting is almost always of one kind, and a batch of two kinds is two imports.
  It also means one set of columns, so the rows line up and a column can be read down.
- **A client is one line, and nothing scrolls sideways.** The fields share the row's width in
  proportion to what each answer needs rather than each claiming a width the row has to find, so the
  line is always exactly as wide as the card — never behind a scrollbar, never with the first column
  cut off. Below a wide screen it folds to two columns instead, because seven fields on one line
  would be seven boxes nobody can read or tap. **Adding a client is typing, not pressing**: a blank
  numbered line sits at the end and filling it grows the next one behind it, so a batch is typed
  straight down; blank lines are dropped rather than written as nameless leads, and that trailing
  line carries no remove button, because it is the one line that cannot be removed — the form puts
  another straight back. Switching the vertical keeps what the two share and drops what only the old one asked. One
  request writes the batch, and the server mints each Enquiry ID from its own vertical and branch.
- **Next Follow-up Date opens on today**, on all three verticals, in Add Lead and in Bulk Entry. A
  lead being written down is one somebody is about to work — that is what Add Lead's Interested
  means — and the next call is almost always the same day it was taken. A Bulk Entry row carries
  that date with no status at all, so it waits in Yet to connect with the day it is to be called
  already on it. Left blank it was a field
  answered by hand on every lead, and the ones nobody answered are the leads that appear on no
  Pending Followups tab and are chased by nobody. Re-read when the form is opened rather than when
  the page was built, so a board left open overnight still offers today; filled only where it is
  blank, so a date somebody typed, or one cleared by marking the lead Rejected, is never replaced.
- Leads & Followups → **Add Lead opens on the board being read.** Standing on Qua Qua and pressing
  Add Lead gives a form whose Vertical is already Qua Qua; the same for Corp and Dum Dum. It used to
  open on Dum Dum whatever board it was opened from, so every lead added from the other two verticals
  needed the radio moved first — and one nobody moved was filed in the wrong vertical, under the
  wrong enquiry id, on a board its owner never looks at. The Call Box is the exception and stays
  Dum Dum: that board is the queue of callers nobody has placed, and which of the three verticals
  they belong to is the one question it exists to ask. The status and the vertical's own Table
  Settings fields follow the vertical, exactly as they do when the radio is moved by hand.
- Leads & Followups → **A column filter narrows the tab being read and no other.** The strip above
  the board is counted in one pass, and the filters used to sit in the part of it every tab shares —
  so typing a name into the Client Name box re-counted the whole strip against that name, and All,
  Converted and Rejected all dropped to what that one person holds. The number beside a tab label
  answers one question, which is how big that tab is, so only the open tab is counted through the
  filter now. Its partner is that **the filter boxes clear when the tab changes**: an unfiltered
  count is a promise about what pressing the tab shows, and a filter that followed the reader across
  would break that promise on every tab at once. Clearing on a tab change is also what every other
  table in the app does — they remount on the tab and lose the filter row with it. The date range is
  unaffected and still spans the tabs that carry it.
- Leads & Followups → **Newborns and Birthdays are the exception, and stay their own calculation.**
  They are read off "Date of Birth (or) EDOD" — the newborn window around the estimated delivery date
  and the run-up to the child's first birthday — and not off the enquiry date, because a lead that
  enquired in June is exactly the lead whose window opens in September. Both tabs were also being
  starved by unreadable dates: `dob_edod_day` is computed from the stored text, so a lead whose date
  was written `09-Sep-26` was in neither tab. Once the dates are normalised they appear.
- Leads & Followups → **a date written the way Excel writes it is a date.** A lead's dates are stored
  as text exactly as their source wrote them, and the application understood two shapes:
  `2026-09-09` and `09/09/2026`. Excel's short date is `09-Sep-26`, so a studio exporting its own
  leads and importing the file back stored dates that nothing could read — and the result was not one
  wrong cell. The Enquiry Date column fell back to the moment the row was written and printed
  **today** on every row of the import, while the lead itself sat in no Today New Leads, no Today or
  Yesterday Pending Followups, and — on Qua Qua — in neither Newborns nor Birthdays, because those
  three tabs filter on stored columns the database computes from the same two shapes. There is one
  list of shapes now, shared by the browser, the server and the SQL: ISO, `DD/MM/YYYY`, `DD-MM-YYYY`,
  `DD.MM.YYYY`, `09-Sep-26` and its full-month and month-first spellings. Day comes before month, as
  `DD/MM/YYYY` had already decided here. Anything that is still not a date is left exactly as its
  author typed it and files under nothing, which is the honest answer rather than a guessed day.
- Leads & Followups → **every date is now stored the same way, whichever door it came through.** Add
  Lead, Import Leads, the CSV import, the Google Sheet sync and the API all write `YYYY-MM-DD`, so
  the shape a source happens to use stops mattering the moment a lead is saved. Leads imported
  *before* that change keep their original text and need one pass to correct —
  `npm run normalise:lead-dates` in `backend`, which reports what it would change and only writes
  with `--apply`. It has to be run once per environment; a reader alone cannot fix those rows,
  because the follow-up and occasion tabs filter on columns the database computes and stores.
- Leads & Followups → **Yet to connect does not expire.** A lead nobody has set a status on reads
  Yet to connect until somebody does, whatever day the enquiry came in, and the tab holds every one
  of them - including the leads an import gave the words to. It used to expire at the end of the
  lead's arrival day into a derived **Inactive**, which emptied the queue overnight while the calls
  in it went unmade. Inactive is now only ever a status a row actually stores.
- Leads & Followups → **a lead is filed under its own Enquiry Date, on every tab that is about a
  date.** Today New Leads and the header's date range read
  one day now: the date the lead's own Date column shows — the enquiry's date, then its source's,
  then the moment the row was written for a lead nothing else dates. The follow-up tabs already read
  the lead's own next follow-up date and are unchanged. Three of those readers used to compare the
  day the *row* was written instead, which is the same day for a lead typed in as it comes in and is
  not the same day for anything imported, synced or typed in a batch: importing a year of old
  enquiries wrote all of them today, so the whole file appeared in Today New Leads and in Yet to
  connect at once and fell inside any range covering today. The tab meant to hold today's calls
  became the import. Now an August enquiry lands on August whenever it is entered, and Today New
  Leads holds today's enquiries and nothing else.
- Leads & Followups → **every way in states the date, and only the file-based ones ask.** Filing by
  the lead's date only works if the lead has one. Add Lead stamps today every time the dialog is
  opened and Import Leads stamps the day the batch is typed; neither asks, because a lead written
  down as it comes in is that day's enquiry and being asked is noise. Stamping on open is also what
  stops a board left running overnight, or a kept draft, filing this morning's lead under yesterday.
  A lead that needs a different date is backdated from the lead popup once it is saved. The CSV
  import and the Google Sheet sync do read the source's own Created Date / Enquiry Date column,
  because a file can carry dates that are not today — the sync used to stamp the day it ran over
  whatever the sheet said, and a column headed "Enquiry Date" was read into a field no table stores
  and thrown away. Both keep the source's date now and fall back to the day of the run only when the
  source states none.
- HRM → Speak-up → **a speak-up is decided once, in Speak-up Review.** Approve, Approve & Assign
  (an HRM task for a person who can answer tasks, created in the same save, which never names who
  raised it) or Reject (with a reason). Statuses: Pending, Approved, Approved & Assigned, Rejected.
  The employee sees only the status; the reviewer, remark and task stay in Speak-up Review. Deciding
  needs HRM → Speak-up Review at Read & Write.
  **Both screens carry the tick boxes** the rest of the application's tables do - `ADMIN / Table
  Select All` ("Select Table Rows in Bulk") decides whether they are drawn at all, so they are a
  Super Admin's until the studio ticks that row onto a role - with **Export** and **Delete** over the
  selection. The two Deletes are different acts: on **Speak-up** it is taking back your own, so it
  reaches only your rows and only while a reviewer has not answered them (`DELETE /mine/bulk`,
  HRM → Speak-up at Read & Write; an answered one is refused with the reason, because the decision is
  the studio's record of what was raised and answered); on **Speak-up Review** it is HR clearing a
  record it has finished with, so it reaches any row whatever its state (`DELETE /bulk`, HRM →
  Speak-up Review at Read & Write). The attachment goes with the row; the HRM task an Approved &
  Assigned one became does not - that is work somebody was given, closed on the Tasks board.
- HRM → **the reporting chart draws the people working here and nobody else.** It excluded archived
  rows alone, so candidates HR had invited but who had not filled in their form, and colleagues who
  had been relieved, fired or had absconded, were all drawn as part of the organisation. It is the
  three working statuses now — Active, in Training, PIP — the same list the repository's Active tab
  groups and every picker offers: somebody in training holds a real place in the structure, and
  people report to them. The count under a card is taken over the same people, so it promises what
  clicking it shows; a chain running up through somebody who has left stops at the last person still
  here, a vacancy rather than a fault; and the chart of somebody it does not draw answers "That
  employee is not on the reporting chart", which is what HR reads when they open the tab on a leaver.
- Sales → Reports & Analytics → **you see your own figures and your team's, not the studio's.** The
  six call tabs were narrowed by the lead each call was against and the three usage tabs — WhatsApp
  Usage, Application Usage, Work Hours — by nothing at all, so anyone who could open the screen read
  every colleague's messages, lead edits and measured hours by name. All nine answer the standard
  rule now: your own name, anybody who reports to you at any depth, a branch administrator's
  branches, a Super Admin unrestricted. The usage tabs narrow by the **login** on the row and read
  the branch off that login, since a message, an activity row and a measured stretch carry none of
  their own; the tabs that attribute a call to a person narrow the attribution the same way, so a row
  is never headed with a name whose figures are withheld. The **Employee filter** lists **Active**
  employees the reader may be shown — narrower than the working-statuses list every other picker
  offers — and a name typed past the dropdown is resolved under the same scope.
- Administration → Roles → **`SUPER_ADMIN` holds every permission at Read / Write, in every branch,
  and holds it as rows.** The role read "full access across every branch" and was granted nothing at
  all. Nobody saw it because the only person carrying it also had `SUPER_ADMIN` on their login, and
  `hasPermission()` answers `true` for that before it reads a permission row — so the empty role was
  invisible until it was given to somebody whose login says `EMPLOYEE`, who then got a role by that
  name that opened no screen and reached no branch. It is a **system role**, which Administration →
  Roles refuses to edit, so there was no way to fix it from the application. The grants are written
  by migration `20260917100000` for databases that exist (production included, where the seed cannot
  run) and by the seed's `grantSuperAdminEverything` for a fresh one, both re-run safe. Every
  permission added from here on is granted to the role in the migration that creates it — see
  [IAM.md](IAM.md) step 10.
- Leads & Followups → **in the popup, CNA is chosen like any other status and counted when the lead
  is saved.** Each CNA is an attempt, the lead carries the tally and the seventh unanswered call
  rejects it outright — so the moment the number goes up is a decision about somebody's lead. The
  pill used to post on the press, which meant six presses took a lead to Rejected with nothing saved
  and no way to un-choose it. It drafts now, and **CNA and Proceed Next** — or picking CNA and
  pressing Update — is what records the attempt. The count follows the *decision*, not the status
  the lead happens to hold, so saving an unrelated edit on a lead that is already CNA no longer
  counts another call against it. The info panel beside the table still counts on the press: that
  pane is the quick pass down a list of leads nobody answered, with no form to save.
- Leads & Followups → **Date of Birth (or) EDOD is required in the lead popup, and nowhere else.**
  *Where* it is asked is the whole rule. Add Lead and Bulk Entry take a Qua Qua lead without one — a
  lead very often arrives before the date does, and demanding it there buys an invented date, which
  is worse than an empty one when the Newborns and Birthdays tabs schedule shoots off it. The popup
  does demand it: by the time somebody opens the lead to work it, that date is what the vertical
  plans from, and a worked lead still missing it is the one nobody can schedule. Only on Qua Qua —
  the other two verticals do not show the field. **Unless nobody got through:** a lead named `CNA`,
  and a lead whose *status* is CNA, are both excused it exactly as they are excused Estimated Value
  — neither is knowable from a call that did not connect, so the two fall away together, and
  insisting buys the invented date the tabs would then schedule from. Those two fields only: a CNA
  lead still has a client, a contact and a branch, and is asked for all three. `Invalid` and
  `Rejected` excuse both as well, along with everything else about the job — those end the
  conversation, so they keep only who the person is.
- HRM → Tasks → **a task can be corrected and duplicated, and it has to say when it is due.**
  Editing belongs to the giver and to a Super Admin, the same rule deleting follows: whoever wrote a
  task down is who can say it was written down wrong. The receiver is not among them — they act
  through Start, Complete and Reassign — and the menu offers Edit only where the server's own
  `canEdit` says so. An edit writes one activity line naming the fields that moved. **Reassigning
  stays its own verb**, so the assignee is not an editable field: handing a task over records the
  hand-over in the holder chain and tells the new holder. It is the holder's, and a **Super Admin's on
  any open task**: the history names the holder it came from and the Super Admin who moved it, and the
  person it was taken off is told. Tasks count both kinds of Super Admin — the account's own
  `SUPER_ADMIN` role column and an active SUPER_ADMIN role from Role Management — for Reassign, Edit
  and Delete alike (`taskRole` in the tasks service). Duplicating starts a new task from an
  existing one, carrying no id and none of the original's attachments. **Due Date is now required**
  on raising and on correcting — a task with no due date is in nobody's "due this week" and is
  chased by nothing.
- Leads & Followups → **converting records the lead at once, in the same tab.** Pressing Converted
  or Converted & Followup writes the lead there and then — it used to write nothing and leave the
  marking to the project's own save in a second tab. The confirmation offers **Convert**, which
  writes it and opens Create Project on it in this tab, and **Update and Close**, which writes it
  and stays put for a lead that is converted but not being booked yet. Both go through the ordinary
  save with the status forced onto it, so a conversion carries its remark, activity entry and Last
  Follow-up Date like any other update. Because it is a write, **the required fields are asked for
  before the confirmation opens**, and a save the server refuses does not navigate — the reader
  stays on the lead rather than reaching Create Project for one that never converted.
- Leads & Followups → **Converted and Converted & Followup both open Create Project.** Converting
  is not a status change: the pill asks, hands the lead to Sales Manager in a second tab, and that
  project's own save is what marks the lead converted. Qua Qua's **Converted & Followup** — a client
  who has bought and is still being worked — was setting a status and stopping, so the one press
  that should have started a project did not. Both now open the tab, from the lead popup and from
  the info panel beside the table, which had only ever known about plain Converted. **The lead is
  left reading the status that was pressed**, not a flattened "Converted": the choice travels in the
  link and is applied by the project's save, so nothing is written until the project exists and a
  tab closed without saving still leaves the lead as it was. The server only honours a status from
  its own converted list, so the link cannot be used to set a lead to anything else.
- Leads & Followups → Convert → **a lead converts whatever shape its event date was stored in.** A
  lead's dates are free text, so the date handed to Create Project could be anything from
  `2026-12-12` to `09-Sep-26` to a note somebody typed. It went to the server raw, where an
  unreadable cell became an Invalid Date and the save was refused with `mainEventDate: Invalid
  input: expected date, received Date` — naming a field **Create Project has no control for**, so
  there was no way to answer it and the lead could not be converted at all. The conversion folds the
  date through `toIsoDay` now, the same reading the board's own tabs and cells use, so the project
  files the event under the day the lead showed; a cell that cannot be placed sends nothing and the
  project is booked **Not decided**, with the date set later in Project Management. The schema
  treats an unreadable date the same way rather than refusing the request, so no other caller can
  hit that message either.
- **A table cell's contents stay inside its column, and one rule says how.** `whitespace-nowrap`
  stops text wrapping; once it cannot wrap it has to be clipped, or it draws over the cell beside it.
  Leads & Followups had the first without the other two, so a long remark crossed the Source column
  and left the table — visible only to whoever had resized a column, since that is what makes the
  board `table-fixed`. `CELL_CLIP`, `HEADER_CLIP` and `FILTER_CLIP` in `data-table/tableLayout.js`
  are that rule, read by both the shared `DataTable` and the leads board, and a test fails if either
  writes the utilities out by hand. Whatever is clipped is on the cell's `title`, so a value cut
  short can still be read. **The leads board remains the one hand-written data grid** — every other
  table in the application is `DataTable` or a wrapper around it — so it is the one place this kind
  of drift can happen, and sharing the styling is what keeps it to behaviour rather than appearance.
- Leads & Followups → **"My Leads", the switch between the date range and the Nebula logo.** On, the
  board is only the leads **whose CRM is the reader** — the assignment and nothing else. Not the
  leads they created: somebody adding a lead on a colleague's behalf, which is most of how leads
  arrive here, is not the person working it, and matching on the creating login put other people's
  work on a board meant to answer "what is on me today". A login with no employee record behind it
  can be named as nobody's CRM, so its My Leads holds no assigned lead at all. A lead with **no
  CRM** is the one exception: it shows on the My Leads of whoever sees the whole studio — the people
  who hand leads out — and on nobody else's, and it leaves that board the moment somebody is named
  on it. Off, it is everything they may
  see — their own leads and their team's, which is what the data scope has always answered, and
  which is the default. Named for what turning it **on** does, because "show me mine" is the thing
  somebody actually reaches for and a control is easiest to aim at when its label is its action.
  Remembered per person, under `crm:my-leads` — a key of its own rather than the old `crm:all-leads`
  read backwards, because that one stored `true` for "showing everything" and inverting its meaning
  would have read every stored answer as "My Leads on", emptying the board of the team's leads for
  everybody at once with nothing to say why. It is a **narrowing and never a widening**: the server ANDs it with the
  data scope rather than replacing it, and the ids come from the signed-in account rather than the
  request, so it cannot be aimed at somebody else. It reaches every read the board makes — rows, tab
  counts, each column filter's menu, and the ids a "select all" resolves into, so a bulk action can
  never run wider than the board it was taken from. **It is drawn only for somebody with people
  reporting to them**, read from the org chart: for everybody else both states are the same board,
  and a switch that changes nothing reads as a broken one. A reader who loses their team sees
  everything again whatever they last chose, so the stored answer cannot strand a narrowed board
  with no control on screen to widen it.
- Leads & Followups → **Table or Board, the view switch beside My Leads.** The Board stands the same
  leads up in columns by status, remembered per person under `crm:view` and defaulting to Table.
  One column per status the vertical offers, led by the leads nobody has rung yet — the status the
  table *displays* for a lead that has none, which is most of this register, so without it the
  columns described almost nothing — and, for somebody who hands work out, the leads **nobody owns**:
  the column the Status cell prints when a lead has no CRM at all. That one is not drawn for an
  individual, whose board is the work named to them and who can neither work nor clear a lane of
  nobody's leads. The heading carries the count, and each column pages itself as it is scrolled
  rather than offering a button. **The columns stand in the pipeline's own order** — Unassigned, Yet
  to connect, Followup, Interested, CNA, Converted & Followup, Converted, Rejected, Invalid — which
  read left to right is the question the board exists to answer, where a lead goes next. That is the
  board's order and not the status pills', which are listed in the order a status is *offered* in
  (`LEAD_STATUS_OPTIONS`, read by somebody choosing one); a status the board's list does not name
  falls in after the named ones rather than losing its column. They were ordered by how many each
  held, largest first and re-sorted as the counts arrived, which told the reader nothing about the
  pipeline and would not keep still — seven columns answer at seven moments, so a column could move
  out from under somebody reading it.
  It is the reader's own board throughout: My Leads, the vertical, the tab, the filters and the date
  range narrow it exactly as they narrow the table, through the same endpoint and the same data
  scope. Not offered on the Calls board, whose rows are calls rather than leads.
- Leads & Followups → **a card is dragged to a column to propose a status, not to set one.** The drop
  opens that lead's popup with the target status already chosen, so the save that follows is the
  ordinary one — still refused without a remark, still written to the activity log with the reason the
  lead moved. The Board writes nothing itself, which keeps one editor and one set of rules about
  remarks. **Converted and Converted & Followup are dropped on like any other column**, and the
  footer decides what follows: the lead opens at that status, the save writes it with the required
  fields and the mandatory remark enforced, and the page then asks whether to open Create Project on
  it — *Not now* leaves a lead that is converted and not yet booked, which the register has always
  allowed and Bookings & Converted picks up later. Asked on the status the save **chose**, never on
  the one the lead happens to hold, so saving a remark against a lead that converted weeks ago does
  not ask again. The order matters. Those two statuses stand for a
  project rather than being written, so the first attempt raised the conversion dialog as the card
  landed: that asked before the reader had seen the lead, and the dialog answering it wrote what it
  could see rather than the details just filled into the popup. Refusing the drop outright, which
  came before that, made the two columns somebody most wants to drag a lead into the two they could
  not. A lead
  with no CRM is dragged **out of Unassigned to give it an owner**: the drop opens Add Lead on the
  lead it already is — its own details and enquiry id, the name at the top, the dropped status chosen
  and Assign To waiting — and Confirm updates that lead rather than adding another, keeping its
  enquiry id, Added Time and Enquiry Date. Name somebody and it moves to the status; leave Assign To
  empty and it stays in Unassigned, which is not a rule of its own but how the board already reads a
  lead with no CRM. Every status is offered there, CNA, Invalid and Rejected included, because the
  card could have been dropped on any column, and the lead is not reported as a duplicate of itself.
  The popup is not used for this: it has no Assign To field, and an owner is the one thing such a
  lead is missing.
  **The columns are a rail wider than the screen, and it scrolls itself while a card is held near
  either edge** — faster the nearer the edge, by the same rule and at the same speed the data table's
  columns and the Sidebar Layout editor's rows scroll at. A browser scrolls nothing for a drag of its
  own accord and this is the one moment a reader cannot scroll for themselves, so the columns past the
  right edge took no drop in practice however eligible they were. **Esc puts the card down**, and so
  does letting go of it anywhere at all: the end of a drag is heard on the window rather than on the
  card it started from, which a column re-reading itself can take out from under the event. Carried
  **out of the browser** the scroll stops rather than running on unseen, and the card carries a
  transfer type no other application accepts, so letting go out there does nothing and the lead comes
  back untouched.
- Leads & Followups → **a card on the Board opens its lead the way a link does.** The table stands
  down while the board is shown, so the rows it holds are empty — and the popup resolves the lead it
  shows out of those rows. A card therefore opened nothing at all on a board reached directly, which
  a remembered view means every morning, while switching to the board from the table in the same
  session left the rows loaded and worked; and where a lead was found its *details* were not, so the
  status pills came up empty on the one screen whose purpose is to open a lead at a status. The card
  now takes the path written for a lead that is not among the rows on screen — fetched with its
  details and handed to the popup as its own, leaving the table's state untouched.
- Leads & Followups → **one press of Update is one write.** The popup refuses an update without a
  remark, so the usual flow is to type a note and press Update with it still in the box. That
  committed the note and then saved, and a committed note posts itself — two writes to the same
  endpoint at once. A remark's write can only see the lead as it was **last saved**, the popup's
  edits being in a draft it cannot see, so whenever it landed second it put the old status, branch,
  value and dates back over the update. A toast said the lead was updated and the change was gone;
  it depended on which request won, which is why it struck only sometimes and read as a button that
  did nothing. A note committed by an Update is now written once, by that update. Update and Close,
  Update and Proceed Next and the duplicate-number dialog's resume all took the same fix; CNA and
  Proceed Next is exempt from the remark rule so it only raced when somebody typed a note first.
- Leads & Followups → **Last Follow-up Date is what the Update buttons write, and nothing else
  writes it.** The column means "the day somebody last worked this lead", so it is stamped by the
  three buttons at the foot of the lead popup — **CNA and Proceed Next**, **Update and Close**,
  **Update and Proceed Next** — each of which is a person saying they have dealt with the lead
  today. It is written on every press, not only where something changed: opening a lead, finding
  nothing to change and pressing Update is still having worked it. **A posted remark does not stamp
  it.** Remarks save themselves as they are written and are very often written while reading a lead
  nobody is working, so stamping there would fill this column and the Pending Followups tabs with
  days nobody actually called anybody — worse than a blank, because it reads as true. The info
  panel's own Update and Next beside the table is deliberately left out of this for now.
- Leads & Followups → **a lead being turned down is not asked when to call it back.** Invalid and
  Rejected end the conversation, so the Next Follow-up Date and Time leave the lead popup as the
  status is chosen, replaced by the same line Bulk Update shows. Add Lead and Bulk Update had
  applied that rule for a while and the popup had not. The visible half was the two fields; the
  costly half was that a lead **already carrying a follow-up kept it** when it was rejected, so it
  appeared in somebody's Pending Followups the next morning under a status saying it was over. The
  press that hides the fields clears them now, an occasion lead's own copies included — those are
  what the Newborns and Birthdays tabs count, so clearing only the ordinary pair would have left the
  date that decides anything. Leads rejected before this keep the date they were stored with.
- Leads & Followups → **a lead written down as `CNA` is asked for less, because less is knowable.**
  `CNA` in **Enquire Name** is the studio's record of a caller nobody reached: the phone rang, the
  call did not connect, and the one thing missing is who they are. Estimated Value is required on
  every other lead and unanswerable on this one, so the form used to demand an invented number or
  get no record of the call at all. It is not asked on a lead by that name, in the popup and in Add
  Lead alike; the name, the contact and the assigned branch still are, since the number is the whole
  point of writing it down. It is the name that
  decides it, matched as typed and on its own — `CNA Traders` and `cna kumar` are people and are
  asked for everything. The CNA **status** is untouched: an unanswered attempt against a client the
  studio knows still has a value and a date to give. It is the same reasoning that already lets a
  lead marked Invalid or Rejected be saved with a name and a number and nothing else.
- Leads & Followups → **a filter dropdown offers what the column holds, not what the studio has.**
  Every dropdown filter on the board used to be a register — the Sales roster under CRM, the branch
  table under Assigned Branch, the shoot-type list, every status the module can produce — so most of
  a menu was values no row in front of the reader held, and picking one emptied the board. They now
  answer a spreadsheet's question: what is in this column, on this tab. The values come from the
  server (`GET /api/sales/crm-leads/column-values`), because the board is paged and a menu built from
  the rows in the browser would change with every scroll; they are narrowed by the board, the tab,
  the date range, the reader's data scope and the other columns' filters — but **never by the
  column's own filter**, or choosing a value would leave a menu of one. Asked when a menu opens, so
  columns nobody opens cost nothing, with the register as the fallback while the answer is in flight.
  The Calls board answers the same way from the call log.
- Leads & Followups → **a lead nobody has been given reads `Unassigned`, and has a tab of its own.**
  `crm` is the person a lead is assigned to, and a lead with nothing in it has been handed to
  nobody — which was invisible on the board, since such a lead wore whatever status it carried, or
  *Yet to connect* when it carried none. The Status column reads **Unassigned** for them now, a tab
  of that name sits beside Yet to connect on all three verticals with its own count, and the Status
  filter offers the label. It wins over the lead's own status: a lead saying Converted with nobody
  on it is a lead nobody owns. Like Yet to connect and Inactive it is **derived, never stored** —
  no pill sets it, nothing writes the word, and putting somebody on the lead brings its own status
  straight back from underneath. **Yet to connect and Unassigned are a clean split** (that tab lists
  exactly what its column says, and theirs no longer says it), while the **pending** tabs are not:
  those are cut by the status a lead holds rather than the label it prints, so an unassigned lead at
  Followup still appears under the call it owes rather than disappearing from the work list.
- Leads & Followups → **Assigned Branch shows the branch a lead is filed under, not the text it was
  written with.** The picker is the branch register, and a picker shows nothing for a value it does
  not hold — so a lead imported as `Erode`, against the branch `Erode TN`, read as unfiled while its
  `branch_id` was right all along. The field reads that reference now: the board's rows carry
  `branchId`, each option carries its `id`, and the branch is named the way the register names it
  however the lead's own text is spelled. A lead filed under no branch — `viza`, `erd`,
  `Out of Branch Location` — shows nothing rather than its text, which reads as the question it is.
  None of it writes: the stored text survives until somebody picks a branch, and a branch just
  picked wins over the reference until the save resolves a new one.
- Leads & Followups → **an imported lead is filed under the studio's own branch, not the file's
  spelling of it.** A CSV's **Nearest Branch** column and a linked sheet's are typed by whoever
  exported them, usually as the place without the state — `Erode` for `Erode TN` — and the reference beside
  the text (`branch_id`) has always been resolved against the branch register, so scoped reads were
  right all along. What was stored as *text* was the file's own wording, and that is what the screens
  show: Assigned Branch in the lead popup and in Add Lead is a picker built from that register, so an
  imported lead matched none of its options and read as unfiled. Both halves now come from one match
  against the register — in the CSV import, in the sheet sync and in every save through the
  application — so the name and the id cannot disagree, and a branch the studio adds or renames is
  followed without a line of code changing. A value naming no branch is kept verbatim rather than
  blanked, since it is the only thing saying the file carried something unexpected. Leads imported
  before this are corrected from the reference they already carry.
- Leads & Followups → **Update Details sets the next follow-up date as well as the last one.** The
  dialog behind the tick boxes offered Lead Status, Last Updated Date and CRM, so the one thing a
  batch of leads usually needs after a round of calls — *when to call them back* — had to be typed
  lead by lead. It now carries **Next Follow-up Date** beside Last Updated Date. Each field is
  independent and a blank one still means "leave this as it is", so a date-only edit does not touch
  the status and a status-only edit does not touch either date; Invalid and Rejected disable both
  dates, exactly as the lead form does, because those statuses end the conversation. On Qua Qua the
  next follow-up date follows the status onto the occasion being worked — a newborn or birthday
  occurrence — which is where the follow-up tabs read it from, while Last Updated Date stays on the
  lead itself as the record of when it was last worked. Still one request for the whole selection.
- Leads & Followups → **deleting a lead is its own permission, and a selection can be deleted in one
  go.** Ticking rows on any of the three verticals now offers a red **Delete** beside Update Details,
  and the header tick reaches every lead the board, tab, filters and date range match — the pages
  never scrolled into view included — so a whole vertical is one confirmation rather than one lead at
  a time. That is exactly why it stopped being part of `SALES / CRM Leads`: running the board and
  destroying its records are different acts, and Read / Write on the board handed out both. It is
  `SALES / CRM Lead Deletion` Read / Write now, granted in Role Management to the roles that should
  have it, and a role without it sees no Delete anywhere on the screen — not on the button, not in
  the row menu, not in the right-click menu, which used to offer it to a read-only reader. The server
  refuses either delete route without it, and still holds every id in the request to the caller's own
  data scope, so a selection deletes exactly the leads that reader could see.
- Leads & Followups → **selecting leads and importing a file are each their own permission too.**
  The column of tick boxes belongs to `SALES / CRM Lead Select All` Read / Write: a role without it
  has no boxes at all — no header tick, no row ticks — so there is no selection to run Update
  Details or a bulk delete over, and the board is worked a lead at a time. Absent rather than
  disabled, because a tick box that cannot be ticked reads as a broken table. ⋮ → **Import**, the
  CSV, belongs to `SALES / CRM Lead Import` Read / Write and is missing from the menu without it,
  since a file lands as many leads as it has rows from a source the studio did not type. ⋮ →
  **Bulk Entry** is deliberately left on the board's own Read / Write — typing a handful of leads is
  adding leads — so a role that may not import a file still has a way to enter a batch. The server
  refuses `bulk-status`, `bulk-assign`, the bulk delete and both import-csv routes without the
  matching permission; the whole-board `ids` route is not gated, because the Quotation Generator's
  Enquire ID picker reads it too and those ids are rows the caller may already see.
- Leads & Followups → **a CRM whose WhatsApp is not linked is told so, every five minutes until it
  is.** The WhatsApp session belongs to the person, not the studio, and a lead's WhatsApp Chat tab
  does nothing until it is linked — so somebody could work a morning of leads with the one channel
  the client is answering on disconnected, and nothing said it. The reminder names the WhatsApp Chat
  tab of any lead rather than offering to pair on the board: the pairing screen belongs beside the
  conversation it is for, and a second one would be two to keep in step. **Skip is remembered**, per
  user, in that browser — so reloading the board or leaving and coming back does not restart the five
  minutes, which are counted from the skip itself. It never appears for somebody who cannot act on
  it: a CRM whose own WhatsApp switch somebody holding `SETTINGS / User Settings` Read / Write has
  turned off in Settings → User Settings → WhatsApp, or anybody at all while the studio-wide switch
  is off. That per-user switch had been
  checked on every write and never reported, so the browser could not tell "not linked" from "not
  allowed to link"; the session endpoint now answers both. It also waits behind whatever the board
  has open — a lead popup, Add Lead, an import — rather than landing on a half-typed follow-up note,
  and appears once that is closed. Linking WhatsApp forgets the skip as well as stopping the
  reminder, so unlinking the device later is spoken about promptly.
- Settings → User Settings → WhatsApp → **the usage limits are the studio's to set.** Three numbers
  decide when a CRM's chat panel warns them they are messaging too hard: different clients an hour
  (25 by default), messages an hour (60), messages a day (300). They were in the code, reachable
  only through an environment variable on the server, so a studio that genuinely works faster than
  that could either ask a developer or learn to read past the banner — and the second is what
  happens, which leaves no warning at all for when the pattern is real. They are now a card under
  the studio switch. **An empty box is the app's own number**, shown as a placeholder, which is the
  only way back once one has been typed; a saved number beats the environment variable, which still
  beats the built-in default. Saving answers to `SETTINGS / User Settings` Read / Write, as the
  switch above it does — everybody else reads the limits in force as a sentence, with no form
  offered. **Nothing is blocked and no session is touched**: the limits decide what a CRM is told,
  and one saved here reaches an open panel on its next poll. The card says which to raise last —
  different clients an hour is the measure WhatsApp bans numbers over, because a broadcast is reach
  rather than volume, so the two message counts are the smaller decision.
- Settings → User Settings → **WhatsApp Activity Log: every WhatsApp message the app sent or tried
  to send, in one table.** Whether a person pressed Send (an onboarding or interview invite, a
  candidate message, login credentials, a CRD link, a gallery invite or album share into a project's
  group, a CRM lead message) or the app sent it on its own (the three production step messages, the
  attendance daily report, the wishes, the Meta template queue), one row says who sent it, from whose
  WhatsApp, to whom (the number masked), about which project, lead or employee, the wording (links
  shown as "[link]"; a password never kept) and what became of it - Queued, Sending, Sent, Delivered,
  Read or Failed - with every try listed. Five tiles count the rows the filters leave; the table is
  paged by the server as it scrolls. **Resend**, for a holder of Read / Write, sends a failed message
  again to the same place from the original sender's WhatsApp, as a new try beside the old failure:
  at most six tries, never two within thirty seconds, and a try WhatsApp never answered asks to be
  confirmed first since it may already have arrived. Credentials, attachments, the scheduled report
  and the wishes are not resendable from here - the dialog says where they are. Behind
  `SETTINGS / WhatsApp Activity Log`, Super Admin only until the studio grants it; studio-wide, not
  narrowed by branch. The log never blocks a send: a log that cannot be written is reported and the
  message still goes.
- **Messages waiting on a WhatsApp group say so, above the log (2026-11-03).** A group is addressed
  either by its **id** or by its **name**, and only the second breaks: a project's message goes to
  the `whatsappGroupJid` stored when somebody linked the group, so a rename does not stop it, while
  the attendance report, the wishes and the photo selection group are looked up by name at send time
  (`groups.find((g) => g.subject.trim().toLowerCase() === wanted)`) and a renamed group stops
  matching. Either way the message silently never went and nothing said so - the studio found out
  when somebody noticed it had not arrived. A bar now sits **under the top bar on every page**
  listing them - not on a settings screen, because a studio that has not sent a client their shoot
  message does not find that out by opening a panel. It is a flex item above the shell's content row,
  so it pushes the page down rather than covering it, and `shrink-0` so the page gives up the room.
  It is read from `GET /api/settings/whatsapp-activity/group-failures`, which carries `protect` and
  **no permission guard at all** - mounted **above** the router's
  `requireModule("SETTINGS", "WhatsApp Activity Log")` so the log's permission is not demanded first.
  It began on the log's permission, because that is the screen the failures were first shown on; once
  the bar moved to every page the two questions came apart - who may read every WhatsApp message the
  studio has ever sent is not who should be told, on every screen, that one never went, and joined,
  the only way to show the bar to a project manager was to hand them the whole log. It was then given
  a permission of its own, and **that was the wrong shape for the question**, which is worth
  recording because it shipped a real bug: a permission answers *may you open this screen*
  ([IAM.md - Whose records](IAM.md)), and this is not a screen anybody opens - it is a strip about the
  reader's **own** work, and whose rows you get is a question with "one answer for everybody, no
  setting, per role or otherwise". In front of that, a tickable gate can only ever hide a project
  manager's own row from them, and it did: a new permission is granted to `SUPER_ADMIN` alone, as
  every new permission must be, so the manager of a project whose client never received their message
  was shown nothing until somebody ticked a box nobody knew existed. **The narrowing is therefore the
  access control**, not a filter applied after one, and it works the way a payment request's list
  does: every project (and the name-addressed failures, which belong to no project) for somebody
  holding `PROJECT / Show All Projects` - a Super Admin or an administrator, who are the ones who fix
  a Settings group nobody owns - and otherwise only the projects the viewer is the **project
  manager** of, narrowed in the query on `projectManagerEmployeeId` against their linked employee. A
  viewer with no linked employee manages nothing and is shown nothing (`?? -1`, so an absent id
  matches no project rather than every project). So **no call can answer with somebody else's row**,
  which is what carries the route in place of a guard - a considered exception to Rule 4, in the shape
  the rule already allows for data scope and that IAM.md keeps for a task, "always readable by the two
  people it is between". Everybody asks, because the answer is already narrowed to the asker: two
  indexed reads that come back empty for an employee with no project of their own, and an empty list
  draws no bar. Retrying is untouched and still answers to the owning module's permissions - sending
  a project's message and linking its group are acts, which is what a permission is for. The list is an **accordion**, in the shape the app already uses for
  one (`FaceMatchingSettings` and the settings panels): the whole summary line is the control, with
  `aria-expanded` and one chevron that rotates. It starts open, and folding is not closing - the line
  saying how many are waiting stays whatever the fold is doing, and there is no control that removes
  it. It is built
  from where the failures already are: a `ProjectProductionMessage` at `FAILED` whose reason is
  "No WhatsApp group linked", and a `FAILED` `WhatsAppActivity` to a group whose failure says the
  group was not found - **narrowed in the query**, not sifted afterwards, because reading the newest
  200 failed group rows of any reason and filtering them in JS let a run of unrelated failures push a
  real one past the cap, and a notice nobody can dismiss saying "nothing is waiting" about work that
  is waiting is the worst thing it can do; the cap remains as a ceiling and `truncated` makes the
  notice say there are more. The two records of one step message are separated by the activity's
  `productionId` column (the step row owns those), not by picking `eventRef` apart, and the rows are
  **grouped by the job**, not the message: one project with six shoots is six messages waiting and
  one thing to fix, which flat read as six problems. **It cannot be dismissed**, which is why it
  holds that one failure and no others - a send that failed because WhatsApp was down would sit in it
  for ever, and it is deliberately not everybody's - the project codes and group names in it are not
  for every employee. **Link group & retry does the two halves of the job in order.** A project's step message is
  addressed by the group's **id** (`whatsappGroupJid`, stored when somebody links it), so every
  production row in the bar is a project with no group linked, and a retry alone links nothing - it
  re-runs a send that checks that column and fails again. Renaming a group on WhatsApp, or creating
  one with the matching name, does not clear such a row by itself. So the button links first, through
  pre production's own `autoLinkProjectGroup` (it links only a group the caller's own WhatsApp
  answered for, and only when exactly one of theirs is named like the project), and sends afterwards.
  **Whoever links becomes the project's sender** - `whatsappGroupLinkedByUserId`, which every later
  production message sends from - so the row says that beside the button rather than leaving it to be
  discovered. A group that could not be linked **sends nothing**: the reason the link attempt gave is
  what the person needs, and seven sends behind it would each be certain to fail. **Sending stays the
  owning module's**: production's `retryMessage` claims the row with a
  conditional update so two people pressing cannot both send (the loser's 409 is reported as "already
  sent by somebody else"), and the messages under one job go **one at a time, 30 seconds apart** -
  this retry's pace and nothing else's. A burst to one group is what risks the paired number being
  flagged, and a 1.2s gap was a token one: five sends still left inside six seconds. Seven messages
  is therefore a three-minute job, so the button reports where it has got to ("2 of 7 sent - next in
  30s") rather than sitting on "Retrying..."; the waiting line is said *before* each wait, so a still
  screen has a reason on it. At two sends a minute the route's limit of **five a minute per person**
  is never reached, though the 429 path remains: the loop stops on the first one rather than
  hammering the limiter, and says "N not tried yet - only 5 retries a minute are allowed. Press Retry
  again in a minute for the rest". **A job also stops at the first message that still cannot find the
  group**: every message under one job goes to the same group, which is what makes it one job, so a
  group the first cannot find is one none of them can - carrying on tried all seven thirty seconds
  apart to learn three minutes later what the first already said. The rest are reported as still
  waiting rather than as failures, because they were never tried. Reporting those as "still waiting on the group" sent people hunting for a
  group problem they had already fixed, so the five answers (sent, already sent by somebody else,
  not tried yet, still waiting, and stopped for a reason fixed elsewhere) are kept apart in
  `lib/whatsappGroupRetry.mjs`, which holds the **whole job** - link, pace, send, report - and is
  pure, so it is tested as behaviour rather than by matching the component's source text. **A
  send that failed answers 200**: `sendStepMessage` catches every send failure on purpose so one
  never blocks the step, recording `FAILED` and its `reason` on the message row and returning
  normally, and the only non-2xx answers that route gives are 400, 403, 409 and the limiter's 429. So
  the job reads the response **body**, not just the status - counting on `catch` alone counted the
  retries the server had accepted rather than the messages that went. The reasons that no retry can
  clear each say where they are fixed instead of being reported as a missing group: chat switched off
  for the studio points at Settings → WhatsApp Chat, and a group that is linked but whose linker no
  longer has a login (the same `reason`, told apart by the link attempt answering "already linked")
  asks to be linked again. The notice calls `retryProductionMessage` - production's own service
  function, not a second copy - with the ids rather than a path the response handed over, and the
  permission is **not** echoed in the response either, since one that named it could disagree with
  the guard that decides. The button is drawn only for somebody holding **both**
  `PROJECT / Production` and `PROJECT / Pre Production` at Read / Write - reading the log entitles
  nobody to send a project's messages or to link its group - and somebody with only the first gets a
  row naming who can link it, since a bar nobody can dismiss may only offer work its reader can do.
  What clears a row is said **on the row**, because the two failures differ: one line for both told
  everybody to rename the group, which for a project's own messages could not have worked. A scheduled message is listed with no button at
  all, saying its scheduler will send it once the name matches, because a button there would race
  the scheduler.
- **Who each automatic WhatsApp message goes from (2026-11-02).** The attendance report, the wishes,
  Photo Selection Submitted, the shoot crew notice, the payment reminder (with the money-received
  message) and Interview Welcome each choose **Sender** - one employee with Allow WhatsApp ticked
  sends every message, and where they cannot, every other one is tried in a fallback order dragged
  in Settings - or **Rotation** - every employee with Allow WhatsApp ticked takes a turn, in an order
  dragged in Settings, one who cannot send passed over for the next. Each keeps its own setting and
  its own order, so switching between them loses neither. Where nobody can send, the message is not
  sent and the reason shows. Until this change every other Allow-WhatsApp
  employee was tried behind the chosen sender in name order, which could not be changed.
  New Lead Welcome is unchanged - it goes from the lead's owner - and manual sends go from whoever
  presses Send.
- Settings → **Templates → Photo Selection Submitted** (notification above its wording) **: a client's
  submitted selection is announced in a WhatsApp group.** Beside Attendance WhatsApp Report, set the
  same way - its own Sender or Rotation, the group by name,
  matched against each sender's own groups when it sends - with an on / off switch; the wording is
  one of the app's templates, under Settings → Templates → Photo Selection Submitted (message
  template `PHOTO_SELECTION_SUBMITTED`: {client name}, {project name}, {event name},
  {category breakdown}, {total selected count}, {submitted at}), previewed as it is typed; the
  notification's own screen holds no editor of it. Told only once the client's
  submission has been saved, never waited for, never resubmitting anything; every submission is
  its own message - an item the studio reopens and the client sends again is announced again -
  while a double press or a retry of one submission never is. Every notification is a row in the WhatsApp Activity Log, retried up
  to three times five minutes apart (a retry asks every sender in turn and counts once), marked
  Failed rather than sent late once it has waited over two hours, and resendable from there
  after. Behind `SETTINGS / Automatic
  WhatsApp Message`, Super Admin only until granted; the wording also needs `SETTINGS / Message
  Template`.
- Settings → **Templates → New Lead Welcome** (notification above its wording) **: each new lead a linked
  Google Sheet brings onto the CRM Leads board gets one WhatsApp message, from the WhatsApp of
  whoever it is assigned to.** Sent after the lead is on the board, into the lead's own thread, so a
  reply lands with the owner - a lead who replies is a real one. Only the sheet sync triggers it;
  Add Lead, Bulk Entry, CSV import and the refill rebuild never do, and neither does a number that is
  not 10–15 digits or a row whose enquiry date is before yesterday. A link's first import is welcomed
  like any other - its old rows are held back by their enquiry date. At most 20 per sync (the rest logged Failed) and 30 an hour per owner's
  WhatsApp (the rest retried later); the lead's name goes in as one short line, links and formatting
  stripped. Off until switched on. An owner whose
  WhatsApp is not linked, a lead with nobody assigned, or chat switched off is retried three times
  five minutes apart within two hours, then shown Failed in the WhatsApp Activity Log with why, and
  resendable there. The wording is the template under Settings → Templates → New Lead Welcome
  (`CRM_LEAD_WELCOME`: {client name}, {sender name}). Behind `SETTINGS / Automatic WhatsApp
  Message`; the wording also needs `SETTINGS / Message Template`.
- Settings → Templates → **Attendance WhatsApp Report has an on /
  off switch**, in the header of the one Notification card that now holds Sends daily at, Today's
  report, Sender and WhatsApp Group. Off, the scheduler sends nothing and takes no claim; the
  time, the senders and the group name stay as they were, so on again resumes with them - a day
  already sent is still never sent twice. Saved on the HR settings row
  (`attendance_report_enabled`, true by default), an administrator's to move.
- Leads & Followups → **one phone number is one enquiry.** The CRM's idea of "the same client" is
  the last ten digits of their number — it is what the Callyzer webhook matches a delivered call on,
  what the Call Logs tab gathers a history by, and what the lead popup counts when it says
  "Enquired : 2 times". So a second lead on a number the studio already holds is the same person
  written down twice, with their calls, remarks and follow-ups split across two records that neither
  knows about. Add Lead checks the number as it is typed and again on Confirm; the lead popup checks
  when a number is *edited* onto one another lead has. Either way the warning names the Enquiry ID
  that already holds it and offers to open that record. Going ahead anyway is possible and
  deliberate — numbers are shared more often than the rule allows for (a groom and a bride on one
  phone, a family, an office line), and refusing outright would make those records unsaveable in a
  form somebody had opened to fix something else.
- Leads & Followups → Qua Qua → **newborns and birthdays are worked from Yet to connect.** A Qua Qua
  lead has two calls that come round on their own: a newborn window around the estimated delivery
  date (30 days before to 5 days after) and a birthday window before the child's **first** birthday
  (0 to 45 days out, the day itself included) — the child born last year turning one, not every
  birthday the client's child ever has. Either one opening lists the lead in Yet to connect as well
  as in its own tab,
  because it is a fresh reason to call rather than a continuation of whatever was sold before.
  Setting a status there takes it out, so the tab empties as the calls are made. That status is kept
  against the occasion, not against the lead: the lead's own status stays as the record of the last
  shoot, and the next occasion opens with nothing against it and comes back to Yet to connect on
  its own — nothing has to be reset, and no job runs. While a window is open the Status column, the
  CNA count and the follow-up date on that lead are the occasion's, which is what Converted, Rejected
  and the Pending Followups tabs count it under; the Newborns and Birthdays tabs still list
  everything in their window whatever its status.
- Employee Attendance → **Daily Attendance**, the studio's register: who was here, per person per
  day, with when they were first and last seen, the hours worked, and why a day reads as it does.
  Nobody signs in or out — an ordinary day is **derived** from what the application measured, the
  same heartbeat the Work Hours report reads, so nothing has to be entered for it. Marking a day
  writes it down and overrides the measurement, which is how approved leave, a public holiday, a
  half day or a shoot with no laptop open get recorded; the Source column says which of the two
  answered. Everybody sees and marks their own days; HRM sees the studio's and may correct anybody's.
  **The same days appear on the calendar** (Meetings → Calendar view) beside the shoots and meetings.
  Present *and* absent, because "who is not in" is asked far more often than "who is" — each chip
  leads with the person's name and is coloured by what it says: red for absent, blue for leave, quiet
  slate for an ordinary day in. Somebody who can only see their own attendance sees their own;
  somebody who can see the studio's sees **everyone else's and not their own** — for them it is a
  monitoring view, and their own row on every day of the month is the one answer they already know.
  Attendance sorts last within a day, so it fills what is left of a cell rather than pushing a shoot
  or a meeting out of the three a cell shows, and the calendar's own switch has an **Employee
  Attendance** entry — picking it reads the month as attendance alone and turns the List view beside
  it into a register. It is left out of the All *table* on purpose: one row per person per day is
  three hundred rows a fortnight, which would bury the bookings the list is read for.
  **Nothing is attendance until the day has happened** — a future day has none, not "absent", so the
  register stops at today whatever range it is asked for.
- Contacts — every phone number the application holds (HR, CRM leads, projects, galleries,
  accounts, vendors), **one row per record**, scoped to the modules the viewer may read. A client who
  enquired for a wedding, enquired again for a shoot and became a project is three rows, each under
  its own id, with its own name, its own vertical and its own module.
- It used to be one row per *person*, with the ids concatenated into one cell:
  `DBS-EID-DD-ERD-000012, DBS-EID-QQ-HYD-000007`. That cannot be filtered to either of them, cannot
  be sorted by either, exports as one string, and gave the row a single name and vertical where the
  two enquiries have their own — and a double click had to pick one, so the second enquiry was
  reachable from nowhere on the screen. The phone number is still what says which rows are one
  person: it is the Contact column, it is what a reader filters by to bring somebody's rows
  together, and the list is ordered by it so a person's records arrive next to each other.
  **The Call Box's callers are not here.** A number that rang the studio once is not a contact of it:
  a misdial, a courier and a wrong number arrive identically, under a Call ID with no name, and there
  were nine thousand of them ahead of the rows anybody wanted. A caller becomes a contact by being
  triaged — added to a vertical on the Calls board, which mints a real enquiry — and it is that
  enquiry, with the name and vertical somebody filled in, that appears here. Until then the number is
  on the Calls board, which is where it is worked. Double-clicking a row opens **that record**
  on this page — the CRM's lead popup, or the project record — rather than navigating to that
  module.
- Meetings — the studio's diary, reached from the calendar button on the topbar rather than from a
  sidebar entry, and **open to everybody in the studio**: signing in is the whole of the guard on
  opening it, because the studio's declared holidays on it are the same fact for every person.
  What is *drawn* is still decided source by source against each module's own Read permission, so
  a viewer who holds no module permission sees the holidays and an otherwise empty month rather
  than a refusal, and scheduling still asks for `SALES / CRM Leads` write — without it there is no
  Add Meet, a day is not clickable, and the List view is not offered to somebody with no source to
  list. Two views of one schedule, and one switch over both. A **source** switch sits
  against the heading in either view — All, Projects, Pre Production, Post Production, Meetings,
  Interviews, My Attendance, and for an administrator Team Attendance — and says what is being shown. **Calendar** draws that source as
  a month: meetings, shoots, projects' main events and the interviews HR has scheduled, coloured by
  kind, each opening where that kind is worked on — plus the
  studio's **holidays** in rose, which lead the day they fall on and are drawn for everybody they
  apply to - the studio's for all, a branch's for that branch's people, each named with whose it
  is - whatever else they hold. **Shoots are drawn for everybody too**, for the holidays' reason:
  where the studio is shooting is its own business rather than one person's record, so the source is
  `always` and narrowed to nobody. Pressing a shoot - in the shoot window or the **Shoots · N**
  pop-up - opens the Projects board on **All**, filtered to its Shoot ID, so the project opens on
  that shoot's row; for anybody without `PROJECT / Projects` the window's card is simply not a button,
  with nothing said, and the pop-up's opens the shoot window. Its ⋮ offers **Navigate to**, each
  board its project is on that the viewer may open, landing on **that shoot** (`shootBoardHref`) -
  Projects as above, Pre Production and Production on the shoot's own form (`?shoot=`), Bookings &
  Converted and Post Production on the project - and **Update** (the project form, the shoot's Pre
  Production and Production forms, Payment). There is also — and, under **My Attendance**, the signed-in person's own days from the
  HRM register that were not simply on time (Absent, On leave, Comp off, Late, Half day, Early
  exit), each status in its own colour. It answers to `HRM / Employee Attendance`, the permission
  their own Attendance page needs, and never shows anybody else's days; the List view and the
  day's panel show those days with login, logout and hours worked.
  On **Month**, a day's shoots are one **Shoots · N** chip: a pop-up of the day's projects with their
  shoot counts, a project's shoots - each card naming its times, its venue and **who is going**: the
  Production Coordinator, the Production Team and each service with its person and assistants, read
  through the Shoot Board's own shaping (`services/productionTeam.js`) - each opening on Projects as
  above; Week and Day keep each shoot.
  **Team Attendance** is the
  administrator's (Super Admin or an Administrator-ticked role, holding `HRM / Employee Attendance`):
  everybody's **Absent** (up to today) and **On leave** days as one count chip per status per day,
  opening to the names in a pop-up; the branch filter narrows each day to that branch's people, and the List view
  lists one row per person per day. The page is
  headed *Calendar* in both views — a list of shoots and main events is no more "Meetings" than the
  month grid is — and the topbar control that opens it is named Calendar too.
  Projects on the grid means a project's shoots as well as its main events, and either production
  stage means the bookings of the projects staffed at that stage. **List** draws the same source as
  a table, with its own columns per source and four tabs under the title choosing when: All, Today,
  Upcoming, Past, each carrying its count. Only the sources the viewer's own permissions reach are
  offered, so a viewer holding `SALES / CRM Leads` alone gets meetings and no switch. **Interviews**
  answers to `HRM / Interview` Read — the same permission the register's own router mounts — and is
  in All as well as on its own, because an interview is one booking on one day rather than a row per
  person per day the way attendance is. It is a **day and an hour**, both kept as text with no
  instant behind them, so the chip leads with "10:30 am" where a shoot leads with its Shoot ID, and
  the Time column sorts on a 24-hour twin the server sends beside it. Add Meet books
  a meeting that belongs to no lead - seen by whoever booked it and its guests, and cancelled only
  by whoever booked it (a lead's meetings are still booked from inside the lead) - and a row can be
  cancelled; a project row is read-only here and links through to Project
  Management, and an interview is read-only here too — its record is worked on in HRM → Interview,
  and clicking one opens the panel beside the grid, with **Join Meet** where the interview is online.

Across every module:

- **A branch is its full name, with or without the state keyword — and nothing shorter.** The
  register writes a branch as its place and its state (`Erode TN`, `Visakhapatnam AP`), while the
  CRM's Nearest Branch column and a quotation's source branch have always been typed as the place
  alone, so both spellings are the branch. `erd`, `viza` and `Tel` are not: they are guesses at a
  branch, and anything filed against one would be filed against a branch nobody named. **One
  nickname is carried, `Vizag` for `Visakhapatnam AP`**, and it is the exception that shows where the
  rule's edge is: `Vizag` is not a shortening of that name, it is what the studio calls the branch
  out loud and in every file it exports, so no rule about dropping words can ever reach it. It was
  removed once on the principle that the matcher should read the register and nothing else, which
  left every lead typed that way filed under no branch at all; it is back by the studio's decision,
  as a named entry in `BRANCH_ALIASES`, checked **after** the register so a branch genuinely called
  `Vizag` would win, and resolved **through** the register so removing `Visakhapatnam AP` leaves an
  alias matching nothing rather than a dangling id. A second nickname is a line somebody adds on
  purpose, and a third is the signal to make it a column on the branch instead — a test fails if the
  list grows. The state keyword is dropped as a *word*, not matched against a list of states, so a
  register writing `Bangalore Karnataka` works without an edit; and a bare name two branches would
  share is ambiguous and matches neither, rather than being handed to whichever loaded first. The
  rule is one function (`services/referenceMatchers.js`) read by every module that stores a branch
  beside a branch id, and by the report the data-scope backfill was approved from.
- **Escape closes the thing on top, and only that.** Every overlay in the application - dialogs,
  full-screen forms, dropdowns, calendars, context menus, the settings overlay, the chat panel -
  registers with one arbiter (`components/shared/useEscapeKey.js`) rather than listening for the key
  itself. Whatever opened most recently is what Escape reaches; close it and the next one down
  becomes the answer, so a dropdown inside a dialog closes the list and leaves the form standing.
  Before this, each overlay listened on its own: nested ones all fired at once and closed everything
  together, and the ones nobody had written a listener for - Add Lead, the lead popup, the bulk
  update dialog - ignored the key entirely. Anything that is mid-save, mid-import or mid-delete is
  off the stack rather than swallowing the key, because that work is not cancellable by looking
  away. An element that wants Escape for itself - an inline cell edit - claims it with
  `preventDefault`. Closing an overlay also puts focus back on whatever opened it. **An overlay that
  forgets to register does not read as "Escape does nothing"** — it reads as Escape closing the
  wrong thing, because the press then reaches whatever is underneath. That is what the Quotation
  Calculator did: raised from the lead popup and never on the stack, so Escape shut the lead behind
  it and left the calculator standing over an empty board. An overlay that is mounted for as long as
  its parent registers on its **open** flag rather than for the whole mount, since a child's effect
  runs before its parent's and registering unconditionally would put it on the stack underneath the
  thing that opens it.
- **The topbar bell is the whole application, not only meetings.** What is waiting on the person
  signed in: follow-ups due or already late, clients who replied on WhatsApp and have not been
  answered, calls they took that are still nobody's enquiry, approvals waiting on their decision -
  and the day's meetings, which is what it used to be alone. Each source is gated against its own
  module's permission on the server, so the bell shows only what the viewer could act on anyway; it
  is offered to every role rather than to CRM roles alone, because an approver with no CRM access
  still has approvals. Everything in it is *theirs* rather than the studio's, and every row goes to
  where the work is done. The badge counts what has not been looked at, and opening the bell is what
  clears it.

- **One shape of identifier, naming where the record belongs.** `DBS-<what it is>-<vertical>-<branch>-<number>`,
  with the middle two present only where they mean something — an employee is `DBS-1`, a vendor
  `DBS-VNMGMT-000001`, a referral `DBS-REF-000001`, an asset `DBS-ASMGMT-ERD-000001`, a Qua Qua lead
  in Erode `DBS-EID-QQ-ERD-000001`. **The branch is shown but not counted by**: each vertical runs one
  sequence across all of its branches, so Dum Dum reads `…-DD-ERD-000001`, `…-DD-ERD-000002`,
  `…-DD-CBE-000003` — a Coimbatore lead carrying on the same run rather than restarting at one, so
  the number says how many enquiries that vertical has taken. Branches are `ERD`, `BLR`, `CBE`,
  `HYD`, `TUP`, `VIZAG` and are recognised however a record spells them; one naming no branch takes
  Erode rather than refusing to save. CRD Documents and Image Selection projects have an identifier for the first
  time. A **Callyzer call** has one too — `DBS-CLID-000001`, with neither a vertical nor a branch,
  because which of the three a caller belongs to is the question the Call Box exists to answer; it
  is minted when the call arrives, and the `EID` only when somebody adds the caller, so the enquiry
  numbers count enquiries rather than wrong numbers. The rules live in one place on each side —
  `backend/src/services/identifiers.js` and `frontend/src/lib/identifiers.mjs` — held together by a
  test that reads both.
  sidebar entry. Two views of one schedule. **Calendar** draws the month: meetings, shoots and
  projects' main events, coloured by kind, each opening where that kind is worked on. **List** is a
  table read through two controls: a switch beside Add Meet choosing what is listed — All,
  Projects, Pre Production, Post Production, Meetings, Interviews, My Attendance, each with
  its own columns — and four tabs
  under the title choosing when: All, Today, Upcoming, Past, each carrying its count. Only the
  sources the viewer's own permissions reach are offered, so a viewer holding `SALES / CRM Leads`
  alone gets the meetings table and no switch. Add Meet books a meeting with no lead and a row can be cancelled;
  a project row is read-only here and links through to Project Management.

Project Management:

- Projects.
- Row View / Tree View.
- Start Project / Edit Project.
- **Every project has an Overall Status tab** (beside Identification, formerly Details) — in Start / Edit Project and in the record a double-click
  opens on the Projects page, after Details and Payments — showing which of five stages the
  project is at — Project Initiation → Pre Production → Production → Post Production → Delivered — as
  a track: done, in progress, upcoming. Each stage can be clicked for its details — Project Initiation
  shows who converted it, when and for how much, the branch, vertical, main event date and project
  manager; Pre Production and Production show their people and each shoot; a stage not reached
  says "Not started yet" beside anything already set up for it. Read from `GET /api/sales/projects/:id/stage`
  under `PROJECT / Projects` (`backend/src/modules/sales/projects/stage.js`). A shoot's Pre
  Production counts as done once its production plan is submitted (its pre production "Completed"
  is worked out on the board, not stored: from its details, and once the shoot is under way in
  Production from the shoot itself - In Progress from Shoot started, Completed when the shoot is
  completed there); Production is done when every shoot's production is
  Done; the "Work in Progress - Post Production" status and Delivered say so outright. Rejected, On
  Hold, Cancelled and the like show as a banner above the stages.
  **Update from the Status tab (Edit Project only; the double-click record stays read-only):**
  a stage the viewer may change carries Update, which opens that stage's own editor on top —
  Project Initiation opens the project's details as a panel of their own over Status ("Update Project
  Details", the same form, with the header's ← back arrow, Back and Update - Update saves and
  returns rather than closing the project); Pre Production opens the
  same shoot cards, General and shoot forms as the Pre Production board
  (`PreProductionProjectEditor`, shared with the board; only the named coordinator, a Super Admin
  or a holder of `PROJECT / Show All Projects` at Read / Write gets rows, anybody else is told so); Production puts Update on each shoot whose production was
  raised and opens its `ProductionShootPanel`. Post Production and Delivered have no editor yet.
  Update shows only with `PROJECT / Pre Production` or `PROJECT / Production` at Read / Write, and
  each editor's own endpoints still decide. Back (← in the header, or Close) returns to Status -
  straight away from Pre Production and Production, and Production also returns once its plan is
  saved or submitted; from Project Initiation, when something was saved, a required remark is asked
  first ("Keep editing" goes back) and kept
  as the stage's **Updates** history in `project_stage_update`, written by
  `POST /api/sales/projects/:id/stage/updates` behind the started-project editor guards
  (`plansAProject` + `editsAStartedProject`) and read back with the stage, newest 50.
- **The Enquiry ID on a project that already exists is shown, not offered.** The field is labelled
  "Enquiry ID" rather than "Select Enquiry ID" — "Select" is an instruction, and it was being given
  on a form where the field cannot be selected — and it is read-only on both Edit Project and Start /
  Edit Project. Which enquiry a booking is against is settled the moment it is created: every figure
  on the form, the quotation it was priced from and the client it is for all hang off it, so
  re-pointing it from an edit screen would move the booking to somebody else's enquiry while the
  rest of the form stayed where it was. On **Create** it is still a picker — that is the one moment
  the answer is being given.
- **The enquiry picker is Leads & Followups, and the Call Box is not on it.** What it offers is what
  that board shows: live leads, narrowed to the ones this reader may open, newest first. Callyzer's
  calls are excluded — the old webhook minted a lead for every delivered call, so wrong numbers and
  misdials were filling the picker's page of fifty with `Unknown` against a bare mobile number and
  pushing real enquiries off it. A call becomes bookable the moment somebody adds its caller to a
  vertical on the Calls board, because that is what mints a real enquiry for it.
- Pre Production with Dum Dum / Qua Qua / Corp — a working board of one row per shoot, raised
  automatically for the named Pre Production Coordinator, where the coordinator records the location,
  the event and reporting times, accommodation and the follow-up dates - an indoor
  (Studio / In-House) shoot is not asked for travel, and is asked which
  branch it is held at (`shoot_branch_id`) in place of its location. Each shoot's
  **pre production status** is **Yet to Start** until a detail is filled in Pre Production (the event
  start and end times arrive with the sale and do not count), **Work in Progress** from then, and
  **Planned** once its **mandatory** answers are filled - each marked with an asterisk on the form,
  though the form never refuses a part-filled save: its Shoot Date, the event's start and end times,
  the reporting time, and where it is - the venue address for an outdoor shoot, the Shoot Branch for
  an indoor one. The **Studio Start Date and Time** (when the crew leaves the studio) are no longer
  asked here, nor on the client portal: they are Production's, on the plan's Travel section.
  The project's **Hard Disk Status** - Not Received / Received / Handed Over, asked on General
  beside Storage Needed where the sale said storage is needed - is pre production's alone and counts
  towards nothing: **Handed Over** moves the project's Client Storage record from Yet to Receive to
  Yet to Start and nothing further, logged on the project, and the disk's id, status and holder sit
  on General read-only, this board having run the whole Client Storage flow until that was removed.
  Each shoot's form also takes an optional **Cover Image** (Project & Shoot), compressed and stored
  in R2 with that shoot (`cover_image_url`); it counts towards nothing, not even the shoot having
  started, and nothing reads it yet. The vertical checklist, the Location Link, the accommodation and the
  concepts are work to do and none is counted - though any of them marks the shoot as started (how much
  of the mandatory set is filled is its tile's bar) - unless set by hand in the Status dropdown at the bottom of its form (saved with it): **WCR** (waiting for the client's reply, asked with a
  Next Followup Date that joins the project's follow-ups), **Hold** or **Rejected** (each with its
  remarks). The board's **Follow-up** tab lists every project with a pending follow-up due today or past
  (one ahead appears on its day), as well as under its own status. A project stands under **every
  status its shoots are at** (`projectTabStatuses`): one with a shoot Planned and another in Work in
  Progress is listed under both tabs - opened there to only the shoots at that status (`shootsInTab`) -
  and has a card in both Board columns. Hold and Rejected set on a shoot put it there; WCR leaves it where
  its details put it; a status set by hand on the whole project keeps it in that one place. Production's
  tabs and Board do the same, with **Execution** for a shoot whose day has begun. A **pending** follow-up in the project's Follow-ups column can be **edited** (its date and
  remarks, in place) or **deleted** (after a confirm) from its ⋮ menu, beside Mark done - `PATCH` / `DELETE
  /projects/:projectId/followups/:followupId`, `PROJECT / Pre Production` Read / Write, each logged on
  the project's Activity; a follow-up already done stays as it was. The **project's** pre production status is whatever was set on the project by hand -
  **Planned**, **Hold** or **Rejected** (the last two with remarks) from its row's ⋮ Update status, and **Yet to Start** as well over
  the ticked projects (`sales_project.pre_production_status`; never a shoot) - else **Hold** when any
  shoot is on Hold, otherwise
  its shoots' - **Yet to Start** when every shoot is, **Planned** when every shoot is, and **Work in
  Progress (n%)** otherwise (the average of the shoots' progress) - the same roll-up Production's
  project status follows (Yet to Start / Planned / Completed when every shoot is, Work in Progress
  otherwise) - shown on the board and in the project's panel; Production's project
  status is Hold the same way, from a held plan or shoot day. A shoot on Hold here, or in Production,
  shows across the project as **On Hold (Pre-Production)** / **(Production)** beside its name in
  every panel and on the Projects list. A **Rejected** shoot shows on that shoot only. Changing the
  project's status never writes a shoot: a **Delivered** project shows no hold badge, and its held
  shoots still say Hold on their own tiles. A status set on the project by hand also shows on that stage of the
  project's Overall Status tab (Planned on Pre Production marks the stage done; Planned on Production
  is shown but does not finish it) - the overall status only, never the shoots. The Overall Status tab is on every screen that opens a project - Projects,
  Bookings & Converted's record, the Pre Production and Production project panels - read under the
  register's readers (`GET /projects/:id/stage`, narrowed by `projectAccessWhere`). **A stage the
  viewer may change carries Update**, by that stage's own permission, on the Pre Production and
  Production project panels as on Projects: Pre Production at Read & Write shows Pre Production's
  Update, Production at Read & Write shows Production's (per shoot, where the shoot has a production
  record), and one without the other shows one and not the other. The editor it opens is still handed
  the permission, so the production plan is editable only for whoever may edit *that* shoot's plan
  (the project's Production Manager, a Super Admin, `PROJECT / Show All Projects` at Read & Write).
  **Project Initiation** carries one too, offered on the server's own `canUpdateStarted` - the
  permission that opens the project's form (`PROJECT / Projects`, or `PROJECT / Show All Projects`, at
  Read & Write) **and**, once the project has started, `mayEditStartedProject`: its Project Manager, a
  branch administrator, or whoever works every project (a Super Admin holds all of it). Its editor is
  the project's own form, which **Projects** owns, so from a board the Update hands the project over -
  `/project-management/projects?project=<Event ID>&edit=1` - and that page opens it through the same
  `openPlan` the row's own ⋮ uses, which decides again and says so when it refuses: a link is not a
  permission, and there is one owner for that form and its autosave rather than a copy of both on two
  more panels. Inside Edit Project the panel around the tab opens it in place, as before. The double-click **record** panel (Projects and
  Bookings & Converted) stays read-only throughout: a record states a project, it does not change it. Its Pre Production stage lists the CRD document only when it is applicable -
  Submitted or Not submitted - with a read-only **View** of the submitted response
  (`GET /projects/:id/crd-response`, the same readers and scope; no share link is issued from it). The levels are
  independent both ways: the project's own status (Projects) never changes or finishes the overall
  Pre Production or Production status, and neither of those ever changes a shoot. How the crew travels is asked on the production plan, not here.
  The project's panel has an **Activity** tab beside its Shoots - the project's whole flow, enquiry to
  feedback, newest first and grouped by day, with a search and Stage / Person filters
  (`services/projectFlow.js`); the same tab is on a project on Projects (after Overall Status, and
  the row ⋮ **View activity**), Production, Post Production and Bookings & Converted. Each stage
  (enquiry, quotation, payments, pre production, production, gallery, feedback, gifts) is listed only
  for a role holding that stage's own permission.
  **Import** (⋮ in the board's header; each vertical's board offers its own template, the all-
  verticals board all three) brings in the studio's old pre production sheet, one row per shoot:
  bookings and shoots are created with the app's own Event and Shoot IDs, the sheet's IDs kept
  beside them (`sheet_event_id`, `sheet_shoot_id`) so a second upload updates rather than
  duplicates, people are named by Employee Code and shown by name, dates are DD-MM-YYYY, and the
  bookings carry no enquiry. A client already typed into the app - the same client number, or the
  same client name as written - is refused rather than copied.
  Offered only with `PROJECT / Pre Production` and `SALES / Sales Manager` at Read / Write.
- Production — one record per shoot, raised once a started project has a Production Manager. That
  seat is named on **Start / Edit Project**, in Project Setup with the other four (Project Manager,
  Pre Production Coordinator, Creative Manager, Post Production Coordinator); it was asked for on
  Pre Production → General until the studio pointed out that staffing a project is one question.
  Naming somebody raises the rows there and then, whenever it happens. Being the Production Manager
  still grants no editing of the project itself - it is an assignment, not a permission. Its
  board lists **projects** (tabs All / Yet to Start / Work in Progress / Planned / Execution - a shoot's day begun, until every
  shoot is Completed - / Follow-up - every
  project with a shoot on WCR whose Next Followup Date is today or past, listed there as well as under its status - / Hold / Rejected / Completed; a
  project's status set by hand - Planned, Hold or Rejected from its row's ⋮ Update status, and Yet to Start and Completed as well over the ticks, from Update
  over the ticked projects (`sales_project.production_status`; never a shoot) - wins; otherwise it is Yet to
  Start, **Work in Progress (n%)** - the average of its shoots' step progress -, Hold when any shoot's plan or
  shoot day is held, Planned when every shoot is planned and none has started, or Completed when every
  shoot is), each opening to its shoots
  as tiles - the main event tagged - and a tile to the shoot. A shoot reads WCR / Hold / Rejected (the plan,
  set by hand at the bottom of the Plan tab, each with remarks - WCR also with its Next Followup Date,
  shown on the tile and row as "WCR · follow up …"; tiles never show remarks), Shoot Hold / Paused / Rejected (the shoot
  day's), Completed, Shoot completed (Footage pending), Shoot completed, Shoot started, Planned (the
  plan submitted and complete - its **mandatory** parts: the coordinator, an outdoor shoot's travel
  mode and Studio Start Date and Time, and a person on every service (a vendor Confirmed) - each marked
  with an asterisk on the form, and tagged **Pending** until answered. The cameras, the mode's detail, the assistants and the remarks
  are part of the plan and none is counted - and nothing done on the day yet; until then its tile says
  what is still owed as Pre Production's tiles do - "4 details pending" (`pendingDetailsText`) -
  then the day's steps), Work in Progress or Yet to Start - automatic, with Planned, Hold and
  Rejected settable on the project by hand, and Yet to Start and Completed over the ticked projects. The
  manager - reading the project and the shoot read-only at the top of the Plan, as Pre Production's
  form shows them - saves or submits a per-shoot plan (coordinator, team, travel, a person and cameras for
  each of the shoot's services - plus two assistants on a candid one - and remarks); the people named on
  the shoot (the Production Coordinator, the Production Team, the service crew's employees, and the
  manager) then work seven steps strictly in order - whoever completes a step first completes it for
  all (started to shoot and reached venue, each with a photo, pineapple meeting with a group
  photo, shoot started with a photo, happening now with at least two photos, happy clients with a
  photo - which **completes the shoot itself**, stamping it Completed and sending the Shoot completed
  message - and file in, answered per service booked on the shoot, or once for a shoot with none:
  footage location - plain text, so a Drive link, a NAS path or "Seagate 3, Reception shelf" all
  answer it - backup done by, no. of files, size, first and last file name (required) and optional
  remarks, kept in `project_production_footage`). An **indoor** shoot (Shoot Type "Studio / In-House")
  has no travel: it skips Started to shoot and Reached venue, and the Pineapple meeting too - four
  steps, Shoot started (which it calls **Ready**) to File in, and only the Shoot completed message; a
  shoot with no type is outdoor and keeps all seven.
  **A shoot in progress can be paused**, which is not a step: Pause the shoot / Start the shoot sits
  in the step's own title bar from Shoot started being done until Happy clients ends the shoot, both
  ways asking why, and a paused shoot reads Paused - with its reason - on the Execution tab, the
  board and the Production Schedule, and completes no step until it starts again. The shoot's status
  through its day is **Travelling** (started to shoot done) → **Setting up** (reached venue) →
  **Shoot in progress** (shoot started) ⇄ **Paused** → **File in pending** (happy clients) → **Shoot
  completed** (file in). **Photo copy is called File in.**
  The retired **Shoot status** step - On hold and Rejected set by hand, with a resume loop - and the
  trip back, Started from venue and Reached studio, are gone (November 2026); a shoot left standing on
  one of them reads as being on File in, and their columns are kept so a finished shoot keeps its
  history. A finished step shows only its tick on the Execution tab;
  who did it and when is on the Activity tab. Every action is logged, and three steps post to the project's WhatsApp group, linked on
  Pre Production → General and sent from the linker's WhatsApp.
  **Import** (⋮ in the board's header, one entry per vertical) brings in the studio's old production
  sheet after its pre production: one row per shoot, linked by the sheet's own Shoot ID, filling
  the coordinator, team, travel, remarks, plan submission, the step the shoot reached, its status
  and the photo copy. A second upload fills only what is empty and never moves a shoot back a step;
  only the project's Production Manager, a Super Admin or Show All Projects at Read / Write may
  import a shoot, as on the board. The steps' own times and photos are not imported.
- Post Production.
- Client Gifts: the Welcome Gift and Shoot Completed Gift a project owes its client. Start / Edit
  Project asks whether each is applicable and who is taking care of it - one tick box names the
  same person for both - and the screen tracks each gift through **Yet To Sent**, Sent and Received
  by Client. The first read "Yet To Receive", which named the wrong end of the journey: a gift in it
  has not been *sent* yet, and "yet to receive" reads as the studio waiting on something rather than
  owing something. Gifts recorded under the old word read as the new one; nothing had to be
  rewritten. Moving a gift along re-reads the screen rather than correcting the one cell it wrote, so
  the project manager, the client's details, who it is assigned to and the footer's "Last updated"
  are all current afterwards - a gift's status is very often changed because something else about
  the project has just moved.
- Customer Issues and Feedback: a **New Project Feedback** for each project. Every project created
  in Bookings & Converted (Create Project) waits on the **Yet to be done** tab until it is given -
  first, with no review - and is offered to everybody who can give feedback, not only their own
  projects. **Every shoot Production completes** (Completed on its board) then waits there too, for
  a **Shoot Completion Feedback** of its own - a row per shoot, with its Shoot ID, so an Event ID with
  three shoots asks three times, each as its shoot completes. Once **all** of a project's shoots are
  Completed (a Rejected one set aside), each has its Shoot Completion Feedback, **and the project is
  Delivered** - listed under **Projects → Completed** - the project waits once more, for its
  **Overall Feedback**.
  A writer's **Give Feedback** in the
  row's menu opens the form for that project or shoot - there is no header Add Feedback and nothing
  to pick; a shoot's form adds the Shoot ID, Shoot and Shoot Date to the project card and asks
  **Appreciation** and **Not Satisfied** - multi-selects of the people who worked on that shoot in
  Sales, Pre Production and Production, never the same person in both, which reach the employee's
  review timeline as Shine and Shadow - and the info
  panel and View read a section per shoot. The form states the project in the card Cash
  Spent uses (Event ID, Project, Client Name, Project Status, Main Event Date, Branch, CRM), then
  asks for a Review (Excellent, Good, Average, Poor) and the feedback; an Average or Poor review asks
  **Assign to** beside it (required), and the person chosen gets it as an **HRM task** - filed under
  Sales for a New Project Feedback, Production for a shoot's and Post Production for the Overall
  Feedback, whatever the assignee's own department - which they
  answer from their Tasks as **Issues sorted** or **Rejected** (a reason required) instead of Mark
  Complete. Each project has one **Feedback ID**, `DBS-FB-00001` and on, given with its first
  feedback, and each feedback is a version of it: **`DBS-FB-00001-01`** is always the New Project
  Feedback (kept for it even when a shoot's is given first), `-02`, `-03` ... the Shoot Completion
  Feedbacks in the order given, and the **Overall Feedback the last** - it opens only once Production
  has completed every shoot, every shoot's feedback is given *and* the project is Delivered (Projects →
  Completed) (a shoot added after it is numbered
  after it; nothing is renumbered). On each tab but Yet to be done, a project's feedbacks are one
  row - its highest version, with a **Versions** count - and the rest open under its chevron,
  newest first, as a quotation's versions do. A saved feedback replaces its
  waiting row. It is filed by its review - Excellent and Good under Completed, Average and Poor under
  Issues - and the status bar moves there, with the client's answer open in the shared message box,
  to copy: **Feedback Thank You** for Completed (the branch's Google review and social media links)
  or **Feedback Issues** for Issues, both worded in Settings → Message Templates. Feedback was once
  asked for in further stages - Production Completion Feedback once Production completed a
  project's shoots, then Project Completed Feedback; those stages were **removed**. Feedback they left is still listed, with its stage in the **Feedback Stage** column. The
  table (with the project's Event Date) lists the reviews the reader gave, newest first - a row's
  click shows it in the info panel, a double-click or View opens it in full, reading the project and
  each of its feedbacks; the **View All Feedback** action permission (Role Management → Project
  Management) shows everybody's, as far as the granting role's branches reach. The status bar - Yet
  to be done, Issues, Issues sorted, Completed, Rejected - has a count on each and remembers the tab
  chosen. Once every issue of a feedback is answered it leaves Issues - for Rejected if any was
  rejected, else Issues sorted. A feedback under Issues with no tasks is moved from its ⋮ menu by a
  writer - Issues sorted or Rejected, after a confirmation that asks for Remarks (required to
  reject); it cannot be moved back.

Settings:

- **Integrations is a group with two entries, Sales and Interview, and they are one screen.** The
  Google Sheets, Drive and Meet cards, the Google account panel, the Link Google Sheet dialog with
  its assignment rules, the linked-sheet list with Sync Now, Preview Import, Edit and Delete — all
  of it is one component drawn twice, from a config that says which module the sheets feed. Sales
  feeds the CRM's leads and answers to `SALES / CRM Leads`; Interview feeds the candidate register
  and answers to `HRM / Interview`. Both need the `SETTINGS / Integrations` row as well, and a reader
  holding that row and neither module sees no group. The Google account is the one connection per
  login and serves both; a consent started from Interview comes back to the Interview screen with
  its own section reopened, rather than to the CRM. The assignment rules read "Assign candidates
  to" and name an interviewer there, and the same rules as leads everywhere else.
- **The message templates**, each its own entry on the Settings rail rather than children of one
  section: **Cash Received Template**, **Employee Invite Template** and **Login Credential
  Template**. They were nested under a single "Message Template" heading, which cost a click to reach
  the one everybody edits and hid the rest behind a title naming a category instead of a message;
  each has its own wording, its own placeholders and its own screen that sends it, so each stands on
  the rail under its own name. A message the CRM learns to send is a fourth entry beside them.
- **All three are the copy-and-send wording, not the emails.** The onboarding invite and the login
  credentials each still send their own email with its own wording, untouched by these. What these
  govern is the message a person copies out of the dialog and pastes into WhatsApp — which is the
  copy that has to work when the studio's mail quota is spent or the mail simply never arrives, and
  which until now was sentences hardcoded in the dialogs where no studio could reach them.
- The facts are `{placeholders}` filled in by whichever screen sends the message, and **the list is
  per message**: the receipt knows an outstanding balance and the invite does not, so each panel
  offers only the placeholders its own sender can answer. The invite fills `{candidate name}`,
  `{onboarding link}` and `{expiry date}`; the credentials fill `{employee name}`, `{username}`,
  `{login email}`, `{temporary password}` and `{login link}`. A placeholder nothing fills is left in
  the message as typed rather than blanked, so the mistake is visible where it will be read. **A
  message the studio has not written falls back to the wording the dialog always printed** — a
  deleted row must not leave somebody handing over an empty box.
- Writing a message is `SETTINGS / Message Template` `READ_WRITE`; reading one is deliberately wider,
  because the screens that send these messages are not the ones that write them — Accounts reads the
  receipt's wording under `ACCOUNTS / Cash Management`, and the employee screens read the invite and
  the credentials under `HRM / Employee Management`.
- **The receipt for a payment.** Recording money received hands back the Cash Received message
  filled in — amount, date, shoot, mode, the project's outstanding balance and the entry's own id.
  It is **sent into the project's WhatsApp group automatically** once the entry is saved - from Add
  Entry, or a scheduled payment's Clear or Part payment - from the
  sender chosen in Settings → Project Management → Payment reminder; no popup opens, and a send that
  cannot go is a FAILED row in WhatsApp Activity Log (Share invoice on the row still sends it by
  hand). The balance is the quotation plus approved extras less everything received, this payment
  included, floored at zero. Money spent gets no message.
- **A payment whose date is not known follows a shoot.** Schedule Payment's "Date not known?" ties a
  row to a shoot (the main event unless another is picked), Before / On / After it by a number of
  days (`project_payment_schedule.due_rule`, `due_shoot_id`, `due_offset_days`). `due_date` is
  worked out from the shoot's studio-time day and rewritten by `services/shootLinkedDueDates.js`
  whenever any shoot is added, moved, made the main event or removed (`syncProjectMainEvent`, Pre
  Production's row, the client's form). No shoot date - or the shoot removed - leaves it with no
  date: "Waiting for shoot date", not Due, not reminded. Worked payments keep their date.
- **Payment reminder.** Two days before a scheduled payment falls due, a reminder (the
  `PAYMENT_DUE_REMINDER` template — `{client name}`, `{event id}`, `{payment}`, `{amount}`,
  `{due date}`) goes into the project's own WhatsApp group from the Sender (or Rotation) chosen in Settings →
  Project Management → Payment reminder, at the time set there (10:00 am unless set). Only a payment
  still to be received is reminded — not Cleared, not On Hold — once for its due date, again if the
  date moves. Where nobody can send, that payment waits for the next try and the section says why.
- **The invoice PDF for a payment received.** Each Cash Received row on a project's Payments tab has
  a download button for that payment's invoice (`GET /api/accounts/cash-entries/:id/receipt`,
  `ACCOUNTS / Cash Management` Read, scoped like the entry itself). "Invoice" heads it with the
  invoice number - the entry's own received number (`DBS-MR-…`) - and the date of issue, the studio's
  logo (Organization → Branding, the app's mark when none) beside them. Below, the studio - its name,
  and the address, phone, email and GSTIN of the branch the money was received at, Head Office when
  it has none - beside **Bill to**: the enquiry's name from the project's CRM lead - a Dum Dum lead's
  groom and bride ("Kavin and Thangamani", or the one given), any other lead's one name - else the
  generator's recorded names, else the WhatsApp group name;
  the project's main number, an email from the CRM lead's Official Email ID or the client's login,
  and the Event ID. Then the payment: what it was towards, mode and reference, who received it, and
  the amount in figures and words, with **Total due** beneath - the project's signed value (converted
  value plus approved extras) less everything received up to and including this payment, floored at
  zero, so an older invoice keeps its own figure - and "Thank you for your business" at the foot. One
  white A4 page with two thin grey parallel lines sweeping down its left side. No due date and no tax lines.

Technical:

- Technical Dashboard foundation.

AI Feature (Visual Curation → AI Feature, `/visual-curation/ai`):

- A second gallery product beside Image Selection, kept entirely apart from it: its own backend
  module (`backend/src/modules/ai-feature/`), frontend folder (`components/ai-feature/`), fifteen
  `ai_event_*` tables, the `ai-feature/event-<id>/` R2 namespace and the `ai-feature-media` queue.
  Nothing in it reads an Image Selection or Album Proofing row, and nothing there reads its rows.
- **Dashboard** (the section menu's first entry, formerly Overview) is the module's dashboard, in the Image Selection dashboard's family and the same
  on the desktop: ten cards (Total, Active, Upcoming and Completed Events, Processing, Total and
  Processed Photos, Failed, People Detected, Archived Events), each a filter on the Recent Events
  table beneath; then AI Processing Progress (the events with photos queued or running) beside
  Detection & Storage. The range picker scopes the period figures (events created, photos
  uploaded and processed) and each card's arrow against where it stood when the range began,
  read from the rows' own dates; the queue and the failures have no past to read and show none.
  One request (`/overview?range=`) feeds both clients; the page re-reads every half minute while
  in front. **Events** lists,
  searches, filters (All / Active / Upcoming / Completed / Archived) and sorts events, with Open,
  Edit, Duplicate, Archive and Delete (confirmed). Status is read off the dates on every read.
- **Create Event** is a five-step wizard: details (with the event types the defaults list), event
  settings, guest configuration, media and AI settings, review. The AI Feature has no sub events
  (removed on web and desktop; old rows are kept, unread, and a guest group's old sub-event list no
  longer narrows its gallery).
  The event takes a **copy** of the studio defaults at creation and overrides them from then on;
  changing the defaults later never touches an existing event. The Media / AI step (and the
  event's own Settings) offers only the four AI switches, photo upload, max file size and the
  allowed photo formats: the face-matching thresholds and their handling, and the compression
  presets, come from the studio defaults in the copy and are not shown. The AI Feature takes
  **photos only** (a video is refused by both clients and the server) and **keeps no original**:
  only the compressed preview and thumbnail reach R2. Video rows and originals stored before this
  are still listed and served.
- **The event workspace** has Project Dashboard (the tab formerly called Overview: photo, guest,
  face, people and review counts - no Videos tile - AI processing progress with the queued /
  processing / completed / failed breakdown and Retry Failed, and the
  event's own Detection & Storage, counted for that event alone by `GET /events/:id/detection`), Media (folder-first: Photo
  Selection's folder panel on the left through the shared `FolderNav` - All Photos as the system
  row plus the studio's folders, no "Unfiled" - with the panel's list
  and the gallery scrolling as two independent panes under a fixed header; open a folder
  and its upload workspace is right there - drop zone, Choose Photos, Choose Folder, progress with
  Pause / Resume / Retry failed uploads / Cancel remaining - photos optimized in the browser to the event's
  Media Upload recipe before they are sent; All Photos is one combined grid of every folder and
  takes no uploads; a card is the photo, with no status badge; a staff upload naming no folder is
  refused; deleting a folder deletes its photos - marked and removed with the folder in one
  transaction, then each discarded as a single delete is, faces and people included - so All
  Photos is only ever the folders' photos seen together plus guests' uploads, and a staff row left
  in no folder by an older deletion is listed nowhere until `scripts/cleanupOrphanAiMedia.js`
  retires it), People (faces clustered into people: rename, link to a guest, merge, split,
  hide), Guests (add, bulk import, groups, RSVP, selfie status, matched
  count), Face Recognition (the review queue: confirm or reject) and Activity. Share
  generates the guest link with a short code, an optional PIN and a QR image, and its **QR
  Template** turns the live link into a printable poster in one of ten designs (web and desktop
  alike, `lib/qrPoster.mjs`, mirrored on the desktop): the real QR drawn from the server's module
  grid, the studio's Global Logo or the app's fallback mark, editable words, PNG or PDF at
  A1 portrait (594 × 841 mm, 7016 × 9933 px at 300 dpi) for every design; no poster for a revoked or expired link; More holds Edit, this
  event's own Settings, Duplicate, Archive and Delete.
- **Processing** never runs in a request: the upload stores the preview and thumbnail the client
  cut from one decode of the original to the event's Media Upload presets (High preview, Standard
  thumbnail by default - the 2048 px JPEG q84 the face engine has always read and a 480 px WebP;
  the shared preset table in `services/imagePresets.js`), keeping both byte for byte when they
  fit the presets and deriving its own only for a photo that arrived whole (a format the browser
  cannot decode, an older client), sends them to R2 and queues the
  row. The worker asks the face engine for every face, stores each with
  its vector (never sent to a browser), joins it to the nearest person above the cluster threshold
  or starts one, and matches it against the guests who have registered a selfie - so a guest is
  matched again, automatically, on every later upload. A rejected match stays rejected and deletes
  nothing. One failed photo fails only itself and can be retried.
- **The face engine** is a Python sidecar (`face-engine/face_engine.py`) on open-source models -
  InsightFace's SCRFD detector and ArcFace recogniser, fetched from the Hugging Face Hub - switched
  on with `AI_FACE_ENGINE_ENABLED=true` after `pip install -r backend/requirements-face.txt`. Off, or
  not installed, photos still upload and their face jobs wait with the reason shown on the
  processing card.
- **Guests** open `/e/<code>`: cover, join (name and phone as the event asks, PIN if set), then
  **My Photos only** - a guest never browses the event: the server lists only the photos that
  guest's own selfie matched (MATCHED or CONFIRMED, this event, not deleted), the old All Photos and
  folder routes answer nothing, and a download address goes out only with a matched photo and only
  with Allow downloads on. Show All Photos and Show People to guests are no longer settings (stored
  values kept, unread); guest uploads sit in My Photos. My Photos holds the selfie search: a guest with no selfie is asked
  for one there (taken with the browser's camera or uploaded from the device - each way its own
  switch under Guest Access, at least one on - matched against that event's faces only), and a guest
  with one sees their matches without a new search. Up to 10 **active** selfies per guest per event
  (enforced by the server; removing one frees a slot): each is searched with and matched against later
  uploads, a photo shows once whichever matched it, and "Your Selfies" on My Photos lists them as
  private thumbnails with remove and Add Selfie. Removing one deletes its face and files and drops only
  the matches no other selfie of theirs supports (`matching.pruneGuestMatches`). Download and share as the event allows, "This is not me" on a wrong match. The guest
  page asks no RSVP and shows no schedule. A guest session
  names the event and the guest and is refused anywhere else.
- **Guest login protection**: a guest with a selfie, a photo shown as theirs or a confirmed number is
  opened on a new device only after a six-digit SMS code to the number stored on them; the code signs
  every other device out. Guest Access → **Confirm phone numbers by SMS** (default off) asks every
  phone join. Without SMS configured, protected guests keep the device they joined on but cannot
  open their photos elsewhere - nobody is let in unverified.
- **Guest WhatsApp photo summary** (built, **not live**: off until the server's
  `AI_FEATURE_WHATSAPP_ENABLED` is "true" and an event's own "WhatsApp guests their photo summary"
  is on - default off, so no existing event changes). A guest ticks "Send me a WhatsApp when my
  photos are found" on the join card, or Turn on in My Photos - **no code** (owner's decision,
  2026-10-29): the tick is the consent, for the number they joined with, and staff changing that
  number withdraws it - and then gets one WhatsApp message (template `photos_ready`: name, new
  photos, event, and a "Visit Your Gallery" button to `e/<code>`) after each round of processing
  settles. With no match yet, a guest who asked is told "Your photos haven't been found yet. We'll
  notify you on WhatsApp when your photos are available." "New" is what the studio's uploads matched to
  them (web or desktop) and what staff confirm from review, never what their own selfie search
  already showed them. Never one per photo, never twice for the same
  photos, never without the guest's own tick, and nothing on a stalled run. Turn off is
  one press. The studio's three processing notification switches are unchanged and still send
  nothing. Real Meta delivery needs an approved template and an explicit rollout decision; see
  backend/README.md "AI Feature guest WhatsApp summary".
- Three permissions under Visual Curation: `IMAGE_SELECTION / AI Feature`, `AI Face Management`,
  `AI Event Default Settings` (see IAM.md). Event visibility is by permission alone, not by branch.
- **Watermark Presets** (managed inside Event Default Settings → Privacy & Access → Watermark): up to 20
  saved logo or text watermarks with position, size, opacity and offsets and a live preview. Event
  Default Settings names the one new events start with; Create Event and an event's Settings choose
  any, or none, and switch it on view and on download separately. An event keeps its own copy of
  the preset it chose, so later edits, a new default or a deleted preset change nothing its guests
  see. With "on view" set, guests see only watermarked previews and thumbnails; with "on download"
  set, they save only the watermarked file; each drawn once per look. The photos themselves are
  never changed.
- **Event Default Settings** (More → Event Default Settings) is a full-size settings workspace on
  the shared form-panel shell: a rail of seven sections - General, Guest Access, AI & Face
  Recognition, Face Matching, Processing, Media Upload (compression: on/off, Preview quality and
  Thumbnail quality as the five shared presets - High, Standard, Compact, Light, Smallest - keep
  camera details (never location), and under Show advanced the photos uploaded and compressed at
  once and the thumbnail format, with Restore recommended defaults; future uploads only; the same
  two presets are drawn and saved by Image Selection's Settings → Processing / Compression → AI
  Feature, one record either way), Privacy &
  Access - one on screen at a
  time, and a fixed
  Cancel / Save Settings bar. An event's own Settings dialog offers Use studio defaults to copy the
  current defaults into that one event, applied on Save. One record, saved whole; Save is offered only while something differs
  from what was last read. Event types and allowed formats are chips; the matching thresholds sit
  under Face Matching → Advanced tuning with their ranges. Face recognition off dims everything that
  depends on it without clearing it. Closing with an unsaved edit asks first. Defaults shape an
  event only when it is created; an existing event keeps its own copy.

Photo Selling (Visual Curation → Photo Selling, `/visual-curation/ai/photo-selling`; guests at `/s/<code>`):

- Visual Curation lists four entries side by side: **AI Feature** (the event workflow above,
  unchanged), **Photo Selling**, **Photo Selection** (Image Selection, renamed in the sidebar only)
  and **Album Proofing**. Each is offered by its own permission; the desktop app shows the same list. Full reference: [PHOTO-SELLING.md](PHOTO-SELLING.md).
- A gallery is Photo Selling's own, independent of every other module. **+ New Gallery** asks for the
  event's details (name required; client and phone, date, venue, welcome note optional), copies the
  rest from Photo Selling's **Settings** (Galleries → ⋮ → Settings, a dialog over the page; its own: gallery defaults, download policy, QR poster
  defaults - never the AI Feature's), saves a draft and opens its three steps: Details (event, client,
  watermark, look, how closely a face must match a guest's selfie), Photos
  (upload straight in - drag-and-drop, files or a folder - with progress, pause, retry; hide, price,
  cover or remove photos) and Prices (one price per photo, tax, packages); Publish is the header's
  button once nothing blocks it (a banner on every step lists the gaps, each linking to its step),
  and the QR poster is Share with guests → QR Template. Steps save as they go; Drafts lists the unfinished ones; a draft with no orders can be
  deleted, and its R2 files are removed durably (recorded in the same transaction, retried until
  gone, only inside its own folder). Nothing is public until published.
- Each photo's **original** is uploaded byte for byte (checked against its SHA-256) to the studio's
  existing R2 bucket, in Photo Selling's own folder `photo-selling/gallery-<id>/originals/<random id>/`
  (or to a private bucket when `R2_PRIVATE_BUCKET_NAME` names one); its key never leaves the server.
  A web-size preview made on the uploader's computer is stored beside it for showing. A re-sent photo
  is the same photo, never a second copy.
- Guests open the branded landing page, enter the PIN if set and find their photos by a selfie
  only: the gallery is never shown whole, and only photos their face matches are shown (watermarked),
  priced or sold - no match says so and never falls back to other photos. They add photos to a cart the server prices (packages applied, tax shown), pay through Cashfree,
  and download the originals they bought from their order page.
- Payment is confirmed only by asking Cashfree from the server; webhooks are signature-checked,
  recorded once and acted on once; a retry never double-charges; a mismatched amount unlocks
  nothing. Sandbox by default; production needs a second switch.
- What a buyer gets is each photo's original, streamed through the server from storage
  only for an item of a server-verified paid order, by a ten-minute ticket that works once. Each
  bought photo can be downloaded 20 times within 365 days of payment (configurable). No original has
  a link, presigned or public.
- Every photo has its faces found in the background as it is uploaded, by the AI Feature's own face
  engine (no other engine, no outside service); the Photos step shows what is still preparing or
  failed (with Retry). A gallery is published only once the engine is running and its photos are
  indexed. The selfie and its face data are never stored; a search keeps only which photos matched, for 24 hours or until the guest deletes it.
- Overview: gross and net sales (net before refunds), paid orders, average order, conversion once
  there are 20 visits, live galleries, photos on sale, searches, payments needing a look, paid
  photos that can't be downloaded (original missing), recent orders.

Visual Curation sidebar (web and desktop, since 3 Nov 2026): seven entries at one level - AI
Feature, Photo Selling, Photo Selection, AI Culling, AI Editing, Signature Album, Album Proofing.
The desktop's heading reads "Visual Curation" too (it said "Modules").

AI Culling, AI Editing and Signature Album (`/image-selection/ai-culling`, `/ai-editing`,
`/signature-album`; desktop the same paths under `#/`) are modules of their own, built the way Photo
Selection is: a **Dashboard** (`…/dashboard`, where the sidebar entry lands) and a **Projects** page
(`…/projects`), one switch apart in the header. They work over the same Image Selection projects -
nothing is copied - and a project opens on that module's own workspace with no tab strip: the
culling workspace, the editing bay or the album. Photo Selection's project now shows Photo
Selection alone. No transfer, job, status or link changed: Send kept to AI Editing, Send to Photo
Selection and Send to Signature Album work as before, and "Open AI Editing" (and the like) after a
send now goes to that module's Projects page on the same project. Each module owns its projects:
AI Culling's, AI Editing's and Signature Album's are records of their own with their own IDs
(DBS-VCAC-, DBS-VCAE-, DBS-VCSA-), names and clients, listed only in their module with its own status
in the sidebar's dot and filter (culling: No run yet / Processing / Ready for review / Failed /
Finalized; editing: Nothing to edit yet / Editing / Render failed / Every photo edited; album: No
album yet / Draft / Ready to publish / Expired / Published); Photo Selection's projects are the photo
workspaces themselves (DBS-VCIS-), and its list holds only those created in Photo Selection.
**Create Project** is one form in every module: name, client, WhatsApp number and **Linked
Modules** - the other modules the person may create projects in, never the form's own - and one
submission creates a project in each, linked by being created together and nothing else, then says
which IDs it made. **Edit** changes that module's project's name and client, and its **Linked
Modules** - the same boxes, ticked where linked, greyed where the viewer may only read. Links are per
pair (`visual_curation_module_link`): unticking unlinks this project from that one only and keeps
the other project whole in its own module; ticking reconnects the same project, or creates one in a
module that has none. An unlink waits while the client holds the other project's link (published
gallery or album), which is unpublished there first. Below the form, Linked Projects lists the
linked ones (only modules the viewer may open). **Delete** removes that module's project and keeps
the photos for the projects it was made with; the photos go only with the last. Photos go on from
one module to another only between linked projects - otherwise the server refuses, and the AI
Culling screen says why. Linked projects still share one set of photos. Each module answers to its own
permission alone, its photo work included: somebody with AI Culling and AI Editing sees only those
two modules, and the form in each offers only the other. A project from Project Management takes its
modules from its allocation, as before. Each
Dashboard is one read-only request
(`GET /api/image-selection/stage-dashboards/<stage>?range=`), every card a position "as of now",
the range scoping only the period line:

- **AI Culling** - the latest run of each shoot (or whole project): Culling Runs, Waiting to Start,
  Processing, Ready for Review, Finalized, Failed (each a filter on the Culling Runs table), and
  Photos Analysed, Kept, Maybe, Rejected. Period: runs started and finalized.
- **AI Editing** - every project with photos in its editing bay, counted by edit state: Photos in
  Editing, Awaiting Edit, Queued, Waiting for Workstation, Rendering, Edited, Render Failed, Sent to
  Photo Selection, Sent to Signature Album, Album Sync Failed. Period: photos started, rendered.
- **Signature Album** - every album with its status read by the tab's own rule (Draft, Ready to
  Publish, Published, Expired) and Link Expiring Soon (ten days), plus photos and chapters; a draft
  row says what still blocks publishing. Period: albums created, published.

A row opens the project in the module's own Projects page (`…/projects?projectId=`). Each module
answers to its own permission: AI Culling (new; granted to every role holding Project Management, at
its level), AI Editing, Signature Album.

Album Proofing (Visual Curation → Album Proofing, `/image-selection/album-proofing`):

- **Dashboard** (`/image-selection/album-proofing/dashboard`, where the sidebar entry lands; Projects
  is one switch away in the header) shows every album proof as it stands, in the Image Selection
  dashboard's family and the same on the desktop: ten cards — Total Albums, Draft, Ready for QC,
  QC Review, Corrections Open, Ready for Revised Version, Ready for Client, Client Review, Link
  Expiring Soon (within ten days), Completed — each a filter on the Recent Albums table (album and
  project, client, version, status, open corrections, a workflow progress bar, the link's state,
  last activity); then QC & Correction Progress (albums in a correction round, resolved over
  raised, whether the revised upload is unlocked) beside Proofing & Link Status (links by state,
  who is in client review and on which version, client approved, corrections by state,
  processing, archived). The range scopes the period figures (albums created, sent to QC, sent to
  clients, completed) and the arrows on Total Albums and Completed, the two whose past a row still
  holds. The dashboard only shows the workflow: every state, correction, version and link is the
  server's, the gate is `revisionGate.js`'s own answer, and no state, transition or expiry rule
  changed for it. Reads with either Album Proofing grant; a row opens the album on the Projects
  page (`?projectId=&albumId=`), New Project opens that page's form (`?new=1`).

Image Selection:

- Dashboard (`/image-selection/dashboard`, where Image Selection opens from the sidebar and the
  first half of the module header's Dashboard | Projects switch; the sidebar lists the module
  alone, not the two screens under it): ten headline cards (Total Projects, Yet to
  Upload, Client Sending Not Done, Client Not Started, Client In Progress, Client Submitted, Yet to
  Download, Link Expiring Soon, Expired Projects, Downloaded — the download cards read a
  stamp written when the originals are copied out or Download Selected finishes; "expiring soon" is
  within 10 days and "expired" is once the link has stopped, both only while the client still has
  picking left to do; each
  card names what it counts beside its figure and carries an up/down arrow against where it stood
  at the start of the range, with the period that arrow compares with under it; Lifetime has
  neither and says "as of now"),
  Client Selection Progress (up to five clients who are 85% to 99% through their selection,
  closest to finishing first; the range does not scope this one, so a client who stopped months ago
  is still shown), Storage & Processing (what the range added to the store, with the
  studio-wide totals beneath and the live processing rows always as of now), and Recent Projects
  in the standard table, with its per-column filter row, fifteen rows tall and scrolled inside the
  panel for the rest. The
  counts are a position — every Image Selection project as it stands, never an Album Proofing one
  — and the range picker at the top right of the page, above the cards, scopes the period figures
  under them: projects created, photos added, photos picked, items submitted. It offers Lifetime,
  This Month, This Week, 3 Months and 6 Months, opening on This Month, while New Project stays in
  the module header. There is no Refresh button on the web: the page keeps itself current with a
  quiet re-read — the figures stay and swap in — when the tab or the network comes back, when an
  upload from that browser lands, and once a minute while in front (the AI Feature every half
  minute); the desktop follows the same policy and keeps a Refresh button as a fallback. Every card, stage and attention row is a filter on the Recent
  Projects table at the foot of the page (press again, or Total Projects, to let go); nothing on
  the dashboard navigates except a double click on a row of that table or a press on a row of the
  progress list, each of which opens the project. While the table shows Yet to Download, a row
  opens the project on the shoot folder that put it there — the first in the tree's order whose
  submitted selection is still to be downloaded — so Download Selected is on screen; every other
  view opens the project at its root as before. A single click on a table row picks it out and
  stays where it is, as a row does in every other table in the application; the table has no Action
  column. The Projects page still accepts the same views as `?status=` / `?attention=` deep links,
  and its sidebar shows one as a chip. Stages are the sidebar's own progress rungs —
  Completed is the archived list — so the two screens cannot disagree. The public gallery now
  records when the client first and last opened the link and when they last acted in it.
- Image Selection → Projects: **Expand.** The sidebar's filter menu opens with **Expand**, then a
  rule, then All / Yet to Start / In Progress / Partially Completed / Completed as before. Expand
  opens the dashboard's ten cards and its projects table in a popup over the Projects page (web and
  desktop), with the period selector in its header. The cards count only the enabled projects; the
  table lists every project, with an **Activity** column (Enabled / Disabled) after Last Activity
  and, in each row's ⋮, an **Enabled** switch for whoever holds Project Management Read / Write. The
  header ⋮ is the usual Table Options (Export CSV, Export Excel greyed, Freeze Columns, Manage
  Columns, Reset Table Layout, Compact view) on web and desktop alike, the layout saved per login
  under `table:expand-projects`. **Disabling is one state for everyone**, on the project itself:
  the sidebar marks it **Disabled** (still listed and found by search); its workspace shows why and
  holds back the upload box, Publish / New PIN / Unpublish, the Selection Settings rail and sending
  the link; the server refuses the same (uploads, original registration, publish, new PIN, link
  prepare and send, app notice, AI Culling's send to Photo Selection); and the client's published
  link is paused ("temporarily unavailable") with its URL, PIN and expiry kept. Folders, AI Culling
  and AI Editing work carry on. Enabling it brings everything back as it was; nothing is published
  or sent by itself. A pressed card narrows
  the table to the enabled projects it counted. The open project, its tab and folder, the filter and
  the search are untouched, and a double-click on a row opens that project. The view is each
  login's own (kept in their preferences, so the same on web and desktop): every project, existing
  or created later, is enabled until that login disables it, and disabling one changes nothing
  about the project, its gallery, selections or status. The Dashboard page is unchanged.
- Image Selection → Dashboard: **submission and download are judged per selection item.** Each
  item (Retouches, Frames, Album) is submitted on its own and carries its own download stamp. Yet to
  Download lists exactly the submitted items not yet copied out since they were sent; downloading
  Retouches leaves Frames there; Downloaded means every submitted item is up to date; a new
  submission of one item puts that item back alone. Client Submitted counts a project once any item
  is submitted (the Status pill still says Selecting until every item is in), and each row lists its
  submitted items with a tick on those already copied out. The browser's Download Selected tells the
  server which folder it took, and the desktop copy which deliverable, so only those items are
  stamped.
- Projects foundation only.
- A production project joins the Projects sidebar automatically once it has been started (any
  status but Yet to Start) **and** its first shoot has reached the workspace — from 00:00 India time on
  that shoot's date, by the same `shootDayReached` that makes the shoot's folder, so an in-progress booking with no
  shoot yet, or only shoots still ahead, is not listed empty. The list sync still creates its
  linked project as soon as it is started - In Progress, Completed, On Hold, Rejected or an older
  status - linked by the Sales project id, once (one per WhatsApp group name, a clash logged; web
  and the desktop app read the same list), and keeps its name in step with the WhatsApp group name
  on every list load; the sidebar only holds it back, touching no folder or photo, the
  dashboard counts only what the sidebar lists, and a manual project and the archived list are
  listed as before. New Project is manual-only; the
  saved-group-name picker is retired.
- **The project's WhatsApp group is linked, and the invite is sent into it from the coordinator's
  own WhatsApp.** Selection Settings → WhatsApp Group → **Link** reads the groups the signed-in
  person's paired WhatsApp is in, offers the one named like the project first, and greys out a group
  another live project holds, naming that project; **Change** and **Unlink** are one press, and
  ⋮ → **Match WhatsApp Groups** links every unlinked project whose name is exactly one of your groups'
  names. The WhatsApp Template panel's **Send to Group** publishes if it must and sends the message
  shown into that group *from the signed-in person's number* — pre-production from theirs,
  post-production from theirs — once per gallery version; **Send to Client** is the wa.me link it
  always was. A group send is one deliberate press per project, paced like a person typing, never a
  broadcast, and the CRM chat still keeps every group out of its lead threads. Pairing, where it is
  needed, is the same code the CRM chat scans, shown inside the dialog.
- It leaves the same way. Deleting the project in Project Management → Projects deletes its Image
  Selection project too, in the same transaction and in both sections — the Projects page and Album
  Proofing — and the published gallery link answers 404 from that moment. A linked project cannot
  be renamed, deleted or re-addressed inside Image Selection (all three belong to Project
  Management), so one left behind by a deleted project was reachable by nothing and could only be
  archived. The delete is soft on both sides, like the project's own: the project moves to Resource
  Management → Recycling Bin and the photographs, folders and the client's selections stay on disk
  and in their rows, so Restore brings the gallery back with it. Only the bin's **Delete
  permanently** purges them (Image Selection's own `purgeData`), and it says it cannot be undone.
- The settings rail's first tab shows Shoots & Selection Items under the Access PIN: one
  collapsible row per shoot, its items inside, each with the product-wide progress status
  (Yet to Start / In Progress / Submitted / Disabled; shoot rows aggregate to Partially
  Completed / Completed). Only a client's submission counts as done.
- The settings rail is Photo Selection's alone. AI Culling and AI Editing share the folder tree
  with it - the same tree, New Folder, dialogs and selected-folder state, the folder being the
  scope a cull or an edit works on - but draw no rail and no publish badge: nothing of the client
  gallery (publish status, Allow Photo Selection, expiry, client URL, PIN, Shoots & Selection Items,
  View Invite, Review & Share) belongs to a processing tab, and the processing workspace takes the
  rail's column rather than leaving it empty. Both tabs are folder-first too: nothing is culled or
  edited until a folder is chosen in the tree, the workspace covers that folder (a shoot folder,
  its subtree) alone, and the project root is never a scope. The same rules hold in the desktop app.
- Review & Submit sends one selection item and enables once at least one photo is picked for it:
  the limit caps how many the client may choose, it does not oblige them to choose that many.
  It sits in the gallery footer - overall completion, Submit All when two items are ready, Review
  & Submit - which the folder cards and every open card share (`SelectionFooter`), the same button
  and the same review either way; once the item is sent the footer says so instead. After a successful send the snackbar names the studio by its Global Name - "Album sent
  to BEAMCRAFT" - and says "your photographer" when no Global Name is set.
- **Submit All** joins the footer, as a secondary button beside the item's Review & Submit, only
  while two or more unsent selection items (across every shoot) hold saved picks. It opens a
  **Review All Selections** popup and sends nothing by itself: each ready item under its shoot
  heading (Wedding, Pre Wedding...), with its count, status and its own Review & Submit - no
  thumbnails - plus already-sent items marked Submitted. The footer's button reads "Review &
  Submit" (the item in the sidebar) and the review page's final button reads "Submit". The popup's own **Submit All** (beside Close, on one row) sends the ready items
  in one request (`deliverableConfigIds` on `submit-selection`): every item is checked first and
  all are stamped in one transaction, so any refusal - one item empty, already sent, or a double
  press - sends none and keeps every pick.
- The client gallery home: the client's name centred over the content pane, with the status badge
  and "N out of LIMIT Images Selected for <item>" on one line under it; the underlined All Photos /
  People β / Selected tabs with "Photo selection will expire on ..." on the right of their row;
  folder cards reading
  "52 photos · 5 selected" with five equal thumbnails, the last a photo carrying "+N" for the rest
  (the folder list returns them as `previews`, thumbnails only). Pressing the strip opens the
  folder like Select Photos and never changes a selection. The footer reads "Overall
  completion: N%" beside "x of y Photos" over the bar.
- The client gallery footer carries Deselect All between the completion bar and Review & Submit
  on the **Selected** tab only, and only once a photo is picked for the item in view (hidden on All
  Photos and People, and at zero picks): it releases every photo picked
  for the selection item on screen, asks first, and is absent once that item is submitted.
- The gallery home is headed with the client's name only, never the project name: the couple (or
  the group's client name) on a linked project, the client typed on the Create New Project form on
  a manual one. With no client it reads "Your gallery".
- A submitted selection item shows a green checkbox in Selection Items; unchecking and
  re-checking it reopens the selection for the client (their earlier picks stay), and their
  next submit locks it green again.
- **Opening a photograph keeps the client's place.** The viewer is drawn *over* the gallery rather
  than instead of it, so the grid is never unmounted and the pane that scrolls - the inner pane in
  a folder, the window on the gallery home - keeps exactly where it was, along with every page
  already loaded. Closing returns the client to the same photograph in the same position with
  nothing to fetch again and no jump, whether they scrolled ten photographs in or a thousand, in
  All Photos or in a People-filtered grid, on a phone or a desktop. The back arrow, Escape and the
  **browser's Back** all do it: opening a photograph adds a history entry of its own, so Back and a
  phone's back gesture close the picture instead of leaving the gallery. It used to return them to
  the first photograph, which was the loudest complaint the client gallery had.
- **On a phone the open photograph is swiped and double-tapped.** Below 640px the arrows over the
  picture are not drawn; swiping left shows the next photo, swiping right the previous, and a double
  tap picks it. A single tap does nothing and a double tap never unpicks - on a photo already picked
  it does nothing; unpicking is the bottom tick's, which still picks and unpicks. Same handlers,
  stops and counts as the bottom bar's Previous / tick / Next, which stay. A swipe is a horizontal
  move of at least 50px, a tap a touch under 10px and half a second, a double tap two taps within
  300ms and 30px; anything else does nothing, a swipe ends a double tap in progress, one pick is in
  flight at a time, and a photo still loading cannot be picked. The browser's double-tap zoom is
  held off on the photo on a phone (`touch-action: manipulation`); pinch still works. A pick - by
  double tap or the bottom tick - answers with a check that swells in with one soft ring while the
  photo dips by a hair, and the tick's unpick with the check contracting away, each played only once
  the selection has really changed; reduced motion keeps only a short fade. Tablets and desktops keep
  the arrows, the keyboard and the bottom bar exactly as before.
- **People filter (Phase 1).** Whenever the AI Feature's face engine is on
  (`AI_FACE_ENGINE_ENABLED=true`; `IMAGE_SELECTION_FACE_RECOGNITION_ENABLED=false` opts the gallery
  out), every photo is handed to a background worker once it is READY: faces
  are found in its existing preview, described as vectors and grouped into **Person 1, Person 2,
  …** for the project, and each person is stored as the set of existing photo ids they appear in.
  The client gallery home's tabs are **All Photos | People | Selected (n)**, and the **People** tab
  is the only place the result is shown: All with the shoot's photo count, then a face circle per
  person found in the shoot with name and photo count beneath, always in one
  sideways-scrolling row with All fixed on the left. It leads with as many as the measured width
  holds - everybody, with no More, when everybody fits - plus everybody currently chosen however far
  down the list they came from - a person picked out of hundreds would otherwise filter the gallery
  from behind More, where the client cannot see them to take them out - and only when some do not
  fit are the rest reached through a **More** item (the next faces stacked with a +N badge counting
  the people behind it, never All), which takes one of the slots. Resizing the window re-measures.
  **More opens the Select People panel**, not a longer row. A header (a people mark, the title and
  *Choose one or more people to filter photos*), and under it **two columns on a desktop or a
  tablet**. On the left a row saying how many people the gallery holds and how many of the ten are chosen, and the faces as a
  grid: two across on a phone, three on a tablet, four where the column is widest. On the right the
  people chosen so far as removable cards, scrolling on their own so they can never push the footer
  down, over the line that states the rule the filter works by — *photos will be shown where **all
  selected people appear together** in the same photo*.
  **A card carries nothing until it is chosen.** An empty tick box on every face turned a set of
  people to recognise into a form to fill in, so an unchosen card is a face, a name and a count and
  nothing else; a chosen one tints pale blue, takes a blue edge and a blue ring round the face, and
  grows a tick in its corner. The whole card is the target — there is no small box to hit, and the
  keyboard works where a press does. There is no search, no sort and no list-or-grid switch: the
  grid is everybody, in the gallery's own order.
  **There are no page numbers anywhere.** The grid is read a page at a time as the reader nears its
  end and appended without moving what they were looking at, so a gallery holding thousands of
  faces is never handed to the browser at once, and choosing somebody moves nothing at all. **Only the grid
  scrolls**, and the gallery behind is locked while the panel is open. There is deliberately **no select-all**: the filter takes ten
  people at most, which is the server's own ceiling on a public query, so such a control could only
  ever refuse the eleventh — the ceiling is stated beside the count instead. On a phone the panel is
  a near full-height sheet with a sticky header and footer and the right column folded into one row
  of faces. Nothing is filtered while it is open: ticking four people is a draft and costs no
  reloads, and only **Apply** filters the gallery and closes the panel, after which those people
  are lit in the rail; **Cancel** and Escape drop the draft, and **Clear all** — beside the people
  it empties rather than under the whole panel, so the footer is Cancel and Apply and nothing else
  — empties it without touching a single picked photo. It used to tip the rest of the people into the rail itself, which
  meant scrolling sideways through all of them to reach one.
  **Beneath the rail is always one photo grid, never a card to open first.** With All - nobody
  chosen - it is every photograph of the shoot in view, gathered from all of its cards. With
  anybody chosen it is the ones all of them are in together (Person 1 and Person 3 in the same
  frame, never either alone), from **every card of that shoot at once**. Either way it is headed
  with what is being looked at and how many frames that is, and grown by scrolling. A client is
  looking for a photograph, or for a person - not for a memory card - so being asked which card to
  look in was asking them to know something only the studio knows.
  **People are numbered by how many photographs they are in**, within the shoot being browsed:
  Person 1 is whoever appears in the most, down to the fewest, with a tie settled by which was
  found first so two reads never disagree. The number is a label for that scope - the same face
  leads the shoot it dominates and sits further down another - and everything that means a
  particular person carries the cluster's own id, never the words on screen. A count is of
  photographs rather than faces, so a frame somebody appears in twice counts once. The client is looking for a person, not for a memory
  card, so being asked which card to look in was asking them to know something only the studio
  knows. Each photo is still the card's own - nothing is copied or moved, and a photo appears once
  however many cards the search crossed - and picking one files it against the same selection item
  the cards would have, which is why the grid is the shoot's cards and not the whole project's: a
  selection item belongs to one shoot. Two people with no frame in common say so plainly and leave
  the rail up to change who. A chosen person carries a blue ring and a tick, two or more show an
  *N selected* badge with Clear, and Clear empties the filter and never a picture. The tick on a
  photo is the photo's own and there is one selection: picked under Person 1, it is picked under
  Person 2, in its folder and on the Selected tab, and the Selected count is the same everywhere.
  All Photos shows the folder cards as before and a folder's own view shows no people; nothing is
  copied, no crop is stored (the circle is cut from the thumbnail in the browser), and no face is
  ever looked for on a click. Before anyone is found the People tab says why - *Organizing
  people...* while the worker still has photos, *No people found in this gallery* once it has none,
  or that People is not available when the filter is off - and every other flow - folders,
  selection, retouch, submit, download, deletion - is exactly as before. A gallery that predates
  the filter is queued in the background the first time a client opens its People tab (or on request with
  `POST …/faces/queue`); later uploads are scanned alone and joined to the people already found. No names are guessed, and there is no rename, merge, hide or selfie search
  yet.
- **Scene filter on the People tab.** Beside the people, on the grid's heading row, one compact
  switch reading **All scenes** opens to a row per scene the AI culling run read in the shoot's
  photos - *Groom portrait · 1*, *Family · 8*, *Details · 12* - in the scene profile's own order
  and words, the same `Dropdown` and rows the studio's culling review uses. Choosing a row narrows
  the same grid to that scene's photos (with people chosen, their photos in that scene, and the
  rows' counts are of those photos; the list is counted again whenever the people or the shoot
  change, and a scene the new count leaves empty comes off); All scenes is every photo, classified
  or not. The reading comes from the per-photo scene cache the culling run leaves behind (one per
  photo, at or above the review's confidence line; the accidental scene is never offered), so no
  AI runs when the menu opens or a row is chosen. A gallery whose photos never went through a
  culling run is read in the background by the same scene engine the first time its People tab
  asks - *Organizing scenes...* meanwhile, the rows growing as they are read, the switch appearing
  with the first of them - exactly as the People filter organises a gallery that predates it; with
  the engine off there is simply no switch. Selections, favourites, retouch and frame counts,
  download, expiry and submission are untouched - the scene is one more condition on the listing,
  as a person is.
- **Media Upload Manager (web) and optimized uploads.** Media → Upload opens an Upload Manager:
  photos are decoded once in a Web Worker and both the preview (the event's Preview quality preset,
  High by default) and the thumbnail (its Thumbnail quality preset) are cut from that one frame
  through the same `lib/imageDerivatives.mjs` every Virtual Curation upload runs, sent four at a
  time with retries, listed per file with Pause / Resume / Retry Failed / Cancel Remaining /
  Minimize (a pill bottom-left while minimised), and the grid fills in as they land. The upload
  route accepts the original's SHA-256 (`sourceFingerprint`, kept as `contentHash`, so web, desktop
  and older whole-file uploads dedupe together), its size, name and relative path,
  `clientOptimized`, which keeps the bytes as the preview byte for byte, and the `thumbnail` part,
  kept when it fits the event's thumbnail preset. Two nullable columns, `source_size_bytes` and
  `relative_path`, hold the source facts. A guest's photo from the event page is optimized the same
  way on the phone. The desktop app runs the same presets natively and shows the same manager over
  its transfer ledger.
- **Visual Curation compression presets.** Image Selection's ⋮ → Settings → Processing /
  Compression holds one card per module - Image Selection, Album Proofing, Signature Album, AI
  Feature - each with a Preview quality and a Thumbnail quality picker over the five shared presets
  (Preview: High 2048 px ~300 KB, Standard 1600 px ~200 KB, Compact 1200 px ~150 KB, Light 1000 px
  ~100 KB, Smallest 800 px ~50 KB; Thumbnail: 640, 480, 360, 240, 160 px WebP) and Restore
  recommended defaults (Image Selection Standard / Standard - its recipe of old; the two albums and
  the AI Feature High / Standard). The three studio modules are one JSON column on the Image
  Selection settings row, read by every uploader through `GET /api/image-selection/compression` and
  saved by the Settings panel; the AI Feature card edits the Event Default Settings `media` group,
  which a new event still copies. Every upload - browser or desktop - decodes the original once and
  cuts both derivatives from that frame; compression is never skipped for a photo the machine can
  decode, and a preset change applies to future uploads only.
- **Photo Culling on the desktop app.** The Image Selection Desktop app's Photo Culling tab is the
  web tab over the same `/ai-culling` routes and the same rules above: the folder selected in its
  tree (or the project root) is the scope, the four modes, progress, the review grid with the
  same keys, filters, bulk bar, compare dialog and zoom preview, finalize with the same
  acknowledgement and reopen. `IMAGE_SELECTION / Project Management` `READ` reviews, `READ_WRITE`
  acts, exactly as on the web. When the server has `DESKTOP_AI_ENABLED`, Start offers **Analyze
  on this computer** (on by default): the desktop reads the originals where they live, computes
  the server's own sharpness, exposure and perceptual-hash numbers in Rust and face quality
  through its local face engine when ready, and posts only numbers; the server fills any photo
  the desktop could not find or open from its preview, then groups and ranks as always. Such a
  run waits unqueued until the desktop hands it over; it resumes from what is still pending after
  a restart, can be paused, and from either app can be handed to the server to finish ("Let the
  server finish"). The server's own InsightFace engine is the culling face provider wherever it
  is switched on (the default `auto`; Rekognition only when it is not), and with Culling V2 it
  measures eyes, head pose, face sharpness and expression itself, on the server and in the
  desktop's own local engine alike - no AWS needed for any of them.
  A run analyzed on the desktop also hands each photo's faces to the project's people index, so
  the subject stage has people to weigh even where no face scan ran; the desktop tab shows the
  same People strip and sets the same roles.
- **Desktop hand-off (Virtual Curation desktop app).** The desktop can run the server's own face
  engine (`buffalo_l`, 512-d ArcFace) locally on the original files and hand the descriptors to the
  server, so the People filter above and the AI Feature's people and matching use them without a
  second AI system or a second read of every preview. Three additive backend routes, all off by
  default and a plain 404 while off: `GET /api/desktop/capabilities` (which extras are on, the model
  the desktop must load, the filter's thresholds; any signed-in user, no data),
  `POST …/projects/:projectId/faces/ingest` (one gallery photo's faces, written exactly as the
  worker writes them - `IMAGE_SELECTION / Project Management` RW) and
  `POST /api/ai-feature/events/:eventId/media/:mediaId/faces` (one event photo's faces with optional
  160×160 crops, written as the AI worker writes them - `AI Face Management` RW). Descriptors from
  another model or width are refused, never stored. The desktop's managed Local AI runtime installs
  from the server itself - `GET /api/desktop/runtime/manifest` (engine and model versions, script
  and model-file digests), `GET /api/desktop/runtime/models/:file` (the two model files, resumable
  by Range, rate-limited per person), `GET /api/desktop/runtime/face-engine.py` and
  `GET /api/desktop/runtime/edit-engine.py` (AI Editing's engine, so a render on the desktop is the
  server's engine at the server's version; the edited master comes back through
  `POST …/ai-editing/photos/:uploadId/output`); any signed-in
  user, no data - and a desktop that will describe its own uploads sends `deferFaceScan` /
  `deferAi` on the existing upload routes so the server's worker leaves those photos to it, with a
  10-minute worker sweep that takes any photo the desktop has not described after 15 minutes.
  Switches: `DESKTOP_VIRTUAL_CURATION_ENABLED`, `DESKTOP_AI_ENABLED`. Nothing on the web changes;
  see the backend README's *Desktop Virtual Curation hand-off*.
- **Signature Album** (the third tab, behind `IMAGE_SELECTION / Signature Album`): a premium
  client album built from the project's existing photos and photos uploaded to it directly. The tab
  has no folder tree - the project's folder sidebar and folder toolbar are not drawn there, and the
  album takes their width; the other tabs keep them. Album — three things, in this order: the upload
  (Photo Selection's own drop zone - drop a folder, Choose Photos, Choose Folder - and its progress
  panel with Pause, Retry failed and Cancel), the **Gallery** it fills (processed count, search, sort,
  Delete); the cover (photo, title, subtitle, event date, alignment, ending
  message, Adjust Cover; the cover photo is one of the album's own uploads, chosen from a picker
  that shows nothing else - an older album whose cover is a project photo keeps it until replaced)
  is edited in a dialog opened by the button on
  the upload's header - **Add Cover** until the album has a cover photo saved, **Edit Cover** after -
  and everything in it, the photo and its placement included, is a draft written in one save by
  Save Cover; Cancel keeps nothing. Each upload is prepared in the browser
  (the project upload's thumbnail and ≤1600px web preview; the original never leaves the computer)
  and only those two are stored, in R2 under `image-selection/signature-album/`, never as a project
  photo, so Photo Selection, the client gallery, People and the project counts do not see them.
  An upload is in the client's album the moment it lands - filed into the album's first chapter,
  "Gallery", made by the first upload of an album that has none - so there is no chapter,
  highlight or placement step on this screen, and nothing to filter the Gallery by. The album has no
  options menu and is not deleted from the tab. An
  album built before this keeps its chapters, highlights and project photos exactly as they were;
  the client page draws them as ever, and new uploads join its first chapter. Design —
  eight themes (Classic / Editorial / Minimal / Cinematic / Romantic / Luxury / Modern / Vintage),
  seven cover styles, eight gallery layouts (Curated - the default for a new album - frames each
  photo by its own orientation: landscape 3:2, portrait 2:3, square 1:1, from the width and height
  stored at upload, rows sized so mixed shapes align; existing albums keep the layout they hold), five spacings, fourteen heading and thirteen body
  fonts with optional pairing presets, colours, a Studio Logo choice (Auto / Dark / Light - Auto
  draws the dark-mode Global Logo on a dark background and the light-mode one on a light
  background, on the ending, the PIN screen, the preview and the client page alike), the preview
  moving as they change - the **Edit Album Preview**, where anyone with write access drags any photo
  inside its frame - the cover, a chapter's cover band, each highlight and chapter photo - (the same
  focal point Adjust Cover / Adjust Photo set, saved on release; the rail's preview and the client
  page only draw it); nothing an album already holds is renamed or restyled. The rail's Review & Share — link, PIN, expiry, Copy
  Link, WhatsApp (client chat or the linked group), QR of the link, Open Album. The rail is the
  album's own: publish switch; Client Access - client URL, the Access PIN (while a PIN is required), expiry; Permissions - Require PIN (off on a new album), Allow Download and Allow
  Social Share; while the tab is open the workspace header shows the album's own Updated time and
  its status (Draft / Ready / Published / Expired) in place of the project's, and a chapter or photo
  write counts as an album write. Publishing is refused with the reasons until cover, title, a chapter, a
  photo and a future expiry exist. The client at `/a/<code>` enters the PIN and scrolls cover →
  Our Favourite Moments → chapters (batches as they scroll) → ending. The photos are the album's
  pages, not links: clicking one opens nothing (there is no photo viewer). Download Album (the
  whole designed album as **one PDF** - `<title>-signature-album.pdf` - printed on the server by
  the quotation PDF's headless browser from the client's own page at `/a/<code>/print`: cover and
  its crop, design, layouts, order and ending as saved, every photo the web preview the album
  shows, never an original; the button reads "Preparing album..." while it is printed in the
  background, then the browser saves the one file) and share appear only where allowed, and the
  download is refused by the server as well as absent from the page when the switch is off. A project photo is a reference to the existing upload row
  (same R2 preview, originals untouched); a photo deleted through Image Selection leaves the album
  by cascade, and deleting the album (the API still offers it; the tab no longer does) deletes only its own rows and its own uploads' files. Settings → Image Selection →
  Signature Album holds the studio-wide defaults a new album starts from; an album already made
  keeps its values. Nothing of this touches Photo Selection, Photo Culling, the gallery
  publication, the project's status or its settings.
- The workspace's tabs are the flow a shoot takes, in this order: **AI Culling**, **AI Editing**,
  **Photo Selection**, **Signature Album**; a project opens on its first tab. "Photo Culling" is
  the deliverable's name in the Deliverables table and matches the AI Culling tab as before. A
  manually named project picks its tabs on the Create New Project form (all four ticked for a new
  project; at least one); a manual project from before a tick existed has AI Culling and AI
  Editing on - only an explicit untick takes either away - and Photo Selection as it always had.
  A linked project always has **AI Culling** and **AI Editing** (the latter behind its own
  permission); has **Photo Selection** once it is allocated at least one deliverable whose master in
  Settings → Deliverables answers Yes for Image Selection - the same deliverables that are its
  Selection Items, by the allocation's definition link (a Yes on a master the project was never
  allocated earns nothing); and has **Signature Album** as before, when that service is allocated
  and its row says Yes (`frontend/src/lib/imageSelectionTabs.mjs`). A Photo Culling or Photo
  Selection allocation still narrows its tab's folder tree to its own shoots. AI Culling and AI
  Editing with no allocation of their own follow Photo Selection's shoots, so a shoot sold no Photo
  Selection (a Haldi added with no deliverables) is on none of the three tabs until Photo Selection is
  allocated to it; with no Photo Selection allocated anywhere, every tab shows every shoot. Selection Items are unchanged: added when a deliverable is allocated, retired
  (never deleted, limits and selections kept) when it is removed or its master turns No.
- **AI Culling begins with the import (desktop).** Dropping a folder on the AI Culling tab asks
  one thing, once per project - the culling mode (Balanced by default; Strict, Assisted, or Target
  count with its number) and whether this computer analyzes the originals - and then everything
  else is automatic: the originals are registered held for culling, the mandatory 1600px preview
  and 480px thumbnail are built and uploaded by the transfer ledger as before, the culling run is
  created at that moment and waits for the photos, and each photo is analyzed on the workstation
  the moment its preview has landed - sharpness, exposure, hashes, faces - while the rest are
  still uploading. One panel shows it all (discovered, compressed, uploaded, analyzed, faces,
  culling-ready, processing now, remaining, overall progress as settled units - never an average -
  and a time left only once a rate is known) with Pause / Resume for both halves, Cancel import
  (what landed and every result posted stays), Retry failed, Change mode and Let the server finish
  now while the run waits, and Stop culling throughout; once the run is handed over the same panel
  carries the server's own pass (its stage in the lead line, the bar counting landed, analyzed and
  ranked per photo, 100 only at the review) - there is no separate AI analysis card. While the
  photos land the server already reads each held photo's scene in the background, so the run's
  scene stage finds them in its cache. The run hands itself over when the last photo lands and opens for review
  exactly as a manual run does; a target the shoot cannot meet is said with both numbers and the
  run waits for a new one. The web shows the same state and counts read-only. Originals never
  leave the machine; a restart resumes from the ledger and the server's pending list.
- **AI Culling's review and AI Editing's bay are continuous galleries**: the next batch loads as the
  reader nears the end (no Previous / Next), filters, sorts and search are the server's over the whole
  set, ticks and decisions survive every batch, and leaving the editor returns the bay to where it was.
- **AI Editing** is the editing bay between AI Culling and Photo Selection, under its own
  `IMAGE_SELECTION / AI Editing` (READ opens the tab and downloads its edits; READ_WRITE edits and
  sends on). Ticked photos can be **edited on their own** (Edit selected: the editor walks only
  those, by id, with a banner and Exit selected editing back to the bay, ticks kept) and their
  **edits downloaded** (Download selected edited, and Download edited in the editor): only photos
  with a saved edit rendered at the recipe last saved are included - one as its full-resolution
  edited JPEG, several as one ZIP - and what is left out (not edited, changed since the last Apply,
  still rendering, failed, file missing) is counted before the download; an original or a preview
  never stands in. The web's browser saves the file; the desktop app saves it into a folder chosen
  there. The tab's header has no expand control. The web
  takes no upload here: photos reach the bay from the desktop app (imported on its AI Editing
  tab, held in the bay, the originals staying on that computer and only compressed previews
  uploaded), from AI Culling's review (tick, Send to AI Editing), or by opening a photo already in
  Photo Selection; the web's empty state says so and names the desktop app; AI Culling's summary also sends every photo the run kept to AI Editing or to
  the album in one step, and the review's bulk bar sends a ticked selection (Select all on page
  ticks the page). One photo is edited at a time, the preview the whole of the screen (Before /
  After, a Split divider, Side by side - the frame sized by the workspace, not the photo: as
  wide as the editor's column, as tall as the room under the toolbar, hugging a portrait or a
  landscape photo at its own ratio, the compare mode kept from photo to photo; the region one fixed
  height in every mode, the "3 of 20" counter between Previous / Next directly under it (no
  key-hint text), Auto Edit and
  the style fixed at the top of the controls while the sections scroll, and a header switch on AI
  tools, Retouching and Basic adjustments that reads on / off / partial off the recipe): Auto Edit (a restrained, scene-aware professional base -
  the engine reads the scene from the culling run's label or the faces and the light, aims
  exposure at the faces, recovers a bright dress and a dark suit, names and corrects the cast, and
  says so under the preview), ten professional styles (Natural Wedding, Warm Wedding, Luxury
  Wedding, Cinematic, Moody, Bright & Airy, Editorial, Film Look, Classic, Golden Hour), the AI
  tools (skin retouch with smoothing, blemishes, under-eyes, skin tone, shine and skin exposure
  and teeth; face enhancement; denoise that keeps detail; sharpen without halos; remove object by
  painting over it or by Suggest, which marks background people; sky with exposure and sunset
  warmth; background brightness, blur and calm; smart crop), the **Retouching** section - ten
  regions, each a switch with one intensity, natural by default: Facial Skin, Body Skin, Eyebrows,
  Eye Sclera, Iris and Pupil, Lips, Teeth, Hair, Facial Hair, Clothes; each works only inside the
  region the engine finds and leaves everything else as shot, colours, shapes and patterns
  included; the eye, brow, lip and teeth regions come from the face landmarks, the skin regions
  from the skin mask and the person's outline, and hair, facial hair and clothes from outlines the
  panel says are approximate on this server (a face-parsing model would make them exact); a region
  not found is said under the preview, never faked - the ten basic sliders (tone and white
  balance can be left to the AI, which reports what it chose), and - folded away - HSL, colour
  balance and detail. A reference photo is measured into an editing profile (what it reads:
  warmer, more contrast, cooler skin) that this photo, and any batch, is moved towards; strength
  decides how far. Changes save themselves; Apply renders on the server from the original when the
  server can open it, else from the uploaded preview, and the screen says which and what the
  engine is doing (Analyzing image, Retouching skin, Generating preview) - except for a photo the
  desktop app added, whose original lives only on that computer: Apply hands the render to the
  desktop app (the photo shows "Waiting for workstation" until it answers) or, where the server
  has no desktop hand-off, asks before rendering from the 1600px web preview - the preview never
  stands in for the original on its own; Apply to selected /
  Apply to all put the same edit on the ticked photos or every photo here, one queue job each, the
  bay's counts the progress, each photo adapting its auto sliders to its own light so one wedding
  keeps one look; Reset returns the untouched photo. The source photo is never written to. With a
  photo open, Left / Right move to the previous / next photo of the bay, Home / End to its first /
  last (a page turned at its edge), the header says "3 of 20" beside two buttons for the same
  moves, Escape returns to the bay, and a key typed into a slider, field, menu or dialog stays
  that control's; leaving a photo saves a change still waiting (or one whose save failed) and
  writes it back, so returning shows what was saved - and a save that fails even then keeps the
  sliders for the photo's next opening, with "Open photo" in the notice. The tab's one send, **Send to Signature Album**, compresses the latest
  successful render to the album's own preset on the server (Settings → Compression, Signature
  Album; High 2048px / ~300 KB by default) and stores it as an album upload in the album's chapter;
  an unedited photo goes as it is; a photo still rendering, waiting for the workstation or whose
  render failed is not sent and the summary says so (as an error, selection kept, when nothing
  went); the button rests while a render is in flight
  or the sliders have moved since the last Apply; and sending the same version twice asks first.
  There is **no Send to Photo Selection** from AI Editing (removed 2026-10-10) - not from the editor,
  the bay's bulk bar or the API - and nothing in the tab moves a photo into Photo Selection on its
  own: a finalized AI Culling run's Keeps are what fill it. Nothing in AI Editing says anything
  about Photo Selection: the line under a tile or under the photo in the editor names the Signature
  Album send and nothing else (the server still answers `inPhotoSelection` - the gallery's own
  listing rule, read from one shared helper - for its own bookkeeping; the tab does not draw it).
  A tool this server cannot run is shown off, with the reason.
  The desktop app has the same tab on the same API - and, where the server offers the hand-off
  (`DESKTOP_AI_ENABLED`), renders the edit **on the studio's computer from the original** it holds
  (storage root + relative trail, a RAW through its embedded JPEG): the server's own editing
  engine, fetched and verified like the face engine's script, runs in the app's managed runtime,
  - the face landmark model (`buffalo_l/1k3d68.onnx`) included: the app fetches any optional model
  the server's manifest offers that it lacks, verified by size and digest, so the eye, under-eye,
  teeth, brow, lip and facial-hair tools run on the workstation exactly as on the server -
  and only the edited master is uploaded, stored exactly as a server render is (Apply, Apply to
  selected and Apply to all; the line under the preview says "rendered on the desktop app from
  the original"). The original is never uploaded; the web shows the result from the shared row.
  Before any local analysis or edit the desktop verifies the file against the size and checksum
  recorded when it was added; one it cannot find, one that differs, or one it cannot decode fails
  with a named state ("Original file is unavailable on this workstation…", "…is not the file that
  was added…", "…could not be decoded…") and an explicit "Render from web preview instead" - never
  a silent fallback. AI Culling marks such a photo the same way (left to the photographer, the
  badge saying why) instead of measuring its preview. Originals are never uploaded to the server
  in any form: the old chunked uploader is retired and the upload root is not served. Both apps'
  AI Culling review also offers Send to AI Editing / Signature Album over a ticked selection, and
  the desktop's Send Photos dialog a finalized run's Keeps to AI Editing, Photo Selection and the
  Signature Album. **Nothing leaves AI Culling before the run is finalized**: every send (the
  dialog, the keeps row, the review's bulk bar) is held with "Finalize the run first - only a
  finalized run's Keeps are sent on." and the server refuses it all the same (409). Each
  destination keeps its own compression: AI Editing takes the photo by reference to its original
  (nothing compressed or uploaded), Photo Selection shows the derivatives made from the original
  with its preset at import, and on the desktop the Signature Album gets its own copies compressed
  from each original with the Signature Album preset - only the thumbnail and preview are
  uploaded, one copy per photo per album, so a retry stores nothing twice; an original the
  workstation cannot open is listed by name, never replaced by a preview. From the web the album
  gets the photos by reference (the browser cannot read originals), and its confirmation says so.
  The dialog shows each destination's title and status only, and sends every photo the run kept -
  there is no count - with a line saying how many and where. Its destinations are AI Editing, Photo
  Selection and **AI Editing + Signature Album**: the Keeps join AI Editing and the album, and from
  then on each edit that saves - one photo, Apply to selected or Apply to all - replaces that photo
  in the album automatically, in the same place (chapter, order, favourite), never as a second
  entry; a photo not edited keeps what the album already shows, and the editor says where each
  stands (updating, in the album, or failed with Retry).
- **AI Culling** (the tab's name; "Photo Culling" in the Deliverables table) is the staff-side AI
  triage before the client sees a gallery, under
  `IMAGE_SELECTION / Project Management`. A run covers the folder selected in the tree (and its
  subtree) or the whole project at the root; each scope keeps its own latest run. The tab draws
  one state per moment, from the server's counts: no photos ("No photos have been imported yet"
  with how to import them in the desktop app - the web offers no upload for culling, by design:
  the desktop app is the only way in, and the browser's derivatives route refuses a culling or
  editing hold), photos arriving or processing, ready (the four
  modes and Start), analyzing (each stage done, in progress, waiting or not used on this run),
  the review (Keep / Maybe / Reject / Pending, the AI's confidence spread, Finalize) and
  finalized (Reopen). Opening a photo shows why the AI decided as it did, from its stored reason
  codes and the mode's fixed score lines only, beside the photographer's own decision; the review
  can take the full width for a while, the folder tree and the project panel returning on the
  way out. The desktop app draws the same states. Modes: Assisted
  (scores and groups, decides nothing), Balanced (recommends Keep / Maybe / Reject), Strict (a
  higher technical bar, burst members culled too) and Target count (exactly N keeps, the
  photographer's own Keeps counted first and their Rejects never picked, spread across every
  shoot and every moment of the story - a run of photos with no gap over three minutes - with
  every key person and every scene the AI is sure of guaranteed its best frame first, and the
  rest spread across visually similar series instead of spent on one pose; a live line on the
  card says how many moments and key people the Keeps cover and names what is missing). Each photographer's own Keep / Reject changes teach
  culling their taste (traits they keep or reject more often than it suggested, judged together
  and against their own habits, from 20 changes on); runs they start use it by a few points,
  badged "You usually keep / reject these", and the tab's **What culling has learned from you**
  panel lists it, switches it off and can forget it. A single decision counts for more than a
  bulk action, a photo nobody touched counts for little, a reject that only lost to its twin in a
  burst never teaches that the trait is bad, a taste can belong to one kind of scene ("Soft focus
  in Candid guests"), and the frame the photographer picks as a burst's best teaches which they
  favour (sharpness, open eyes, expression) by a bounded amount. A run keeps the profile it started with. The engine reads only the preview derivative: whole-frame
  blur, exposure and a perceptual hash, then face signals (eyes open, half closed or closed, head
  turned away, the face's own sharpness - so a blurred frame with a sharp face is not rejected for
  blur - and the expression),
  then a subject stage — who is in the photo, joined to the People clusters, each face weighed by
  how it sits in **this** frame (its size and how central it is), never by who the person is or how
  often they were photographed: the largest, most central face is the main subject, so its blink
  costs far more than a small face's at the edge, and only a prominent face's closed eyes raise
  "Main face's eyes closed". The tab shows no People section (the People filter itself, in the
  client gallery, is unchanged); roles given by an older build stay stored but no run reads them —
  then, when the server's optional scene engine is on, a scene (the studio's words, from a profile
  file), an aesthetic score and — from the face boxes — a composition score, each a gentle nudge
  (a frame is only "accidental" when it is also technically poor; a face cut by the frame edge is
  flagged), filterable by scene and by Accidental / Face cut off in the review,
  then duplicate (≤10 s, near-identical: the hash agrees and neither the layout signature nor the
  people disagree) and burst (≤3 s, related: the hash, or a looser hash with a close layout and
  somebody in common) groups whose members are
  ranked on a balance of sharpness, open eyes, expression and face quality — "#2 of 5" in the
  compare dialog, the manual best becoming #1 and the two frames' calls following it —, and
  series of similar frames (the same set-up within two minutes, from the scene engine's image
  embedding), opened in the same compare dialog, whose alternates are never rejected for being
  alternates; then an explainable score with reason badges and a confidence. The photo's own
  quality is kept apart from its decision score, and the explanation says what moved one from
  the other (the photographer's taste, or its place in its group). The capture time a photo's
  EXIF records now travels with the derivatives from both apps' uploaders, which is what bursts,
  similar series and moments are read from; photos uploaded before that have none, and their
  similar series form only from adjacent, very alike frames. The photographer's decision always wins:
  `effective = yours || AI's || Pending`; "Back to AI" clears an override. A run refuses to start
  while another run still covers any of the same photos; shoots that share none run side by
  side. A run lists its photos once: photos processed after that are reported as not in this
  session, never pulled in by a retry and never hidden by its finalize. A photo culled where it
  already was (a Photo Selection upload) is as visible as a Keep until a run is finalized, and a
  failed or cancelled run hides nothing (the failed state says so and offers a new run). Photos
  imported for culling by the desktop app are held: they stay out of Photo Selection and the
  client gallery until a run is finalized, and **AI Culling is a stage no photo skips** - there is
  no "without culling", no send to Photo Selection from the culling tab and no route for it;
  finalizing moves the Keeps among them into AI Editing (held for editing), the rest stay culled,
  and only a finalized run's Keeps reach Photo Selection, through the review's own send (which
  declines a photo still held for culling or stamped by a cull); the AI Editing tab has no send
  to Photo Selection. Photo Selection says how many are waiting. Finalize needs at least
  one Keep, asks before hiding Maybe or pending photos (in Assisted mode that is every photo not
  marked Keep) or changing a published gallery, then stamps every non-Keep photo it analyzed with
  its session; Photo Selection, the client gallery, the picks and the publish counts skip stamped
  photos, a photo the client already selected is never stamped, nothing is deleted or moved, and
  Reopen gives each photo that run settled back to the newest other finalized run's verdict (hidden
  again if that run did not keep it, visible otherwise). A later finalize over the same photos lifts
  an older run's stamps on them. Review: filter chips (All, Keep, Maybe, Reject, Pending, Low confidence,
  Duplicates, Best of burst, Blur, Closed eyes, Unanalyzed), four sorts, 60 per page, keys ←/→
  1/2/3/0 and Space, always-visible Keep / Maybe / Reject and checkboxes, a bulk bar, a compare
  dialog per duplicate or burst group with "mark as best", and a zoomable preview.
- **Culling can learn the studio's taste - switched off until it has earned it.** Every review
  action on a run is logged with how it was made (a key, a click, the preview panel, a bulk
  action, the compare dialog), a best-of-group change with the group's order before and after,
  and which photos were actually seen (on screen for a second, or opened). That log changes no
  decision. It is one culling intelligence for the web and the desktop app: where the signals are
  computed (the server for web runs, the workstation for a desktop local-analysis run) is only
  the execution environment. Both apps review through the same routes, every event says which
  app it came from, both feed the same dataset under the same label rules, and a model must not
  get worse on either kind of run to be promoted. Under ⋮ → Settings → **AI Culling Training** the studio opts in (off by default,
  confirmed before it turns on, who and when recorded; Settings / Organization Read shows the
  state, Read-Write the switch). Only then can the operator commands in
  `backend/ml/culling/README.md` export the finalized runs as a pseudonymous dataset (no photo,
  path, name or real id, dates kept only to the month), train a model, and register it. A model
  first runs in **shadow**, scoring runs into its own table that nobody sees. It reaches
  photographers only when a shadow report over 200+ finalized runs shows it agrees with them
  more than the formula does without rejecting more good photos, a named person promotes it, and
  the server is switched on (`AI_CULLING_LEARNED_RANKER`). Then it decides through the same
  decision code: same modes, same coverage rules, the photographer's decision still winning. The
  photo's explanation says "Scored N by the culling model trained on this studio's own Keep and
  Reject decisions (version x.y.z)". No real model exists yet; the pipeline has been proven on
  synthetic data only.
- Editing a manual project re-opens that same form pre-filled — name, client details, workspace
  tabs — with Save and Cancel in place of Create Project.
- A manual project's Selection Items are typed under shoot groups that are the project's root
  folders — creating a folder ("Pre Wedding", "Wedding") creates its group in the table; each
  group has its own add row, item names are unique per group, and the client gallery offers and
  submits each group under its root folder. Since 2026-11-03 an item points at its folder **by
  id**: renaming the folder ("wedding" to "wedding 02") renames the shoot - same folder, same items,
  limits, photos and picks - and never makes a second shoot, on the web and the desktop alike.
- A folder's **Delete is permanent** (web and desktop), after one confirmation (Cancel / Delete
  Permanently): the folder and its subfolders, their photos in the client gallery, the client's
  picks on them and - on a manual project - the selection items and limits filed under it are
  deleted; their R2 previews go unless another photo still uses the object. Originals on the
  studio's storage are never touched, and the client link (same URL, PIN and short code) keeps
  serving every other folder. A Project Management shoot folder is renamed and deleted only in
  Project Management.
- A selection item typed with its Limits box left empty is given a limit of **1**, on the web and
  the desktop alike; a typed number is kept, and saved limits are never rewritten. The studio-wide
  default selection limit (50) is only the fallback for an allocated deliverable with no quantity.
- The Selection Settings rail's **Review & Share** saves whatever is pending before it opens the
  WhatsApp template - the limits, checkboxes and expiry Save Changes would save, a limit the desktop
  is still saving, and any item typed into an add row but never added - then publishes if needed.
  A refused limit, a failed save or a refused publish stops there with the error shown and the
  edits still in place; nothing opens until every step has succeeded.
- Every press of Download Selected is its own delivery: the project root folder under the Target
  Download Path is stamped with the download date — `John & Priya Wedding - 02-Sep-2026` — and a
  second download the same day gets ` (1)`, ` (2)` after it, Windows "New folder" style, instead
  of writing over the last run. Only the root is stamped; the
  Project ▸ Selection item ▸ Shoot ▸ Folder tree inside is unchanged. Without a Target Download
  Path the date goes on the ZIP's name and the browser's own numbering supplies the counter.
- A linked project's shoots join the workspace on their own shoot date, India time: the shoot's
  root folder, its photos and its Selection Items appear from 00:00 IST on the date set in Project
  Management, each shoot on its own date — an earlier shoot is never held back by a later one, and a
  shoot with no date stays held until one is set. Production and Pre Production statuses are never
  read. A shoot moved to a later date is only hidden — in the studio's tree and the client gallery
  alike — and its folders, photos, picks and submissions are kept and return on the new date; its
  Selection Items are not retired (`heldSourceKeys`), only a deliverable taken off the project is. The tab opens the
  workspace at once: a project with no album has one made on the first open by a write login
  (idempotent, unique per project, never published by that); there is no Create Signature Album step
  on the web or the desktop.

## Installing as an App

The application installs to a phone's home screen or a desktop dock and opens in its own window
with no browser chrome. It is the same application behind the same sign-in — installing grants
nothing and changes no permission, and every screen reached from an installed window is guarded
exactly as it is from a browser tab.

- **It needs HTTPS.** The production domain has it; a plain-HTTP host offers no Install anywhere.
- **No offline support and no push notifications.** There is no service worker, deliberately. A
  screen with no network shows the browser's own error page, as it did in a tab. Both are later
  work.
- **The command is named differently on each platform**, which is the thing most likely to be
  reported as missing: Android Chrome ⋮ → *Add to Home screen*; Chrome and Edge on the desktop
  ⋮ → *Cast, save and share* → *Install page as app*; iPhone and iPad *Share* → *Add to Home
  Screen*; Safari on macOS *File* → *Add to Dock*. Firefox on the desktop cannot install any site
  and is not a fault in this.
- **The home screen mark is the bundled one**, not a favicon uploaded in Settings: a manifest is
  read once, when the icon is created.

How it is built, and the rules that keep it installable, are in
[frontend/README.md](../../frontend/README.md) — *Installing as an App (PWA)*.

## UI Standards

Global UI standards:

- Use a compact global header/action bar.
- Do not add redundant table-card headers.
- Preserve responsive behavior across desktop, laptop, tablet, and mobile.
- Reuse existing shared UI components instead of creating duplicate one-off controls.
- **Every register offers a Table / Board switch** (`data-table/TableBoardSwitch`, remembered per
  screen). The Board (`data-table/KanbanBoard`) stands the same rows in a column per status - or per
  category where a screen has no status - and a dragged card only ever runs that record's own
  existing action. A new register adds the switch the same way (see `hrm/TasksPage.js`).
- **Every client link that has lapsed shows the one expired page.** A quotation (and its Payment
  and Terms pages), a Photo Selection gallery, a Signature Album, an album proof and an event
  gallery answer an expired link with 410 and an empty `expiredLink`
  (`backend/src/services/expiredLink.js`), and the client page renders
  `components/shared/ExpiredClientLink.js`: the studio's logo, the hourglass, "This link has
  expired", "This link is no longer active." and a line asking them to contact the studio by its
  Global Name - **and nothing about the link**: not its type, not the client, not when it lapsed,
  on the page or in the response. It is checked before any PIN, never shows what is behind the link, never redirects,
  and a Photo Selection link keeps answering expired on a refresh even after its first expired
  visit revoked it. An unknown or mistyped link keeps its page's own "not available".
- **A Photo Selection gallery is published only while the client has a photo to see.** With no
  client-visible photo left anywhere in the project - every folder and subfolder, ready, not culled,
  not waiting in AI Culling or AI Editing, not in a shoot held back until its date - it is revoked
  with `revoked_reason` EMPTY, and published again with the same token, PIN, short URL and expiry
  once one is back (`publication/service.js` `syncAvailability`: on the studio panel's load, the
  client opening the link, a publish, and after uploads finish, folders are deleted and photos are
  sent on from AI Culling or AI Editing). Meanwhile the link says "Your photos are not available yet".
  The studio's own unpublish (MANUAL), a lapsed link (EXPIRED) and a gallery revoked before reasons
  were recorded are never published again by it.
- **Every overlay can be worked through from the keyboard alone.** Opening a dialog or a
  full-screen form panel moves focus into it, Tab and Shift+Tab cycle within it rather than escaping
  to the page behind, and closing it hands focus back to whatever opened it. Both live in
  `components/shared/useFocusTrap.js` and are used by `ui/Dialog` and `schema-form/SchemaFormPanel`,
  so every overlay in the application gets them without asking; an overlay nested inside another —
  a confirmation over a dialog, a dialog over the Settings panel — is answered by the innermost one.
  Before this, focus stayed on the button behind the dialog, so the first Tab walked the page the
  dialog was covering and its own fields were a full lap away. **Dropdowns are typed at as well as
  arrowed through:** a letter jumps to the option starting with it (`y` for Yes), letters typed
  together make a word, and the same letter repeated walks that letter's options — what a native
  `<select>` does, in `lib/dropdownOptions.mjs`. Typing only moves the highlight; Enter is still what
  answers the field. **A control never switches its focus ring off without drawing its own**, so
  where you are is always visible while tabbing.
- **A screen holding staged work never loses it to a click that did not say so.** Where a screen
  stages an edit until a Save is pressed - the Table Settings canvas, a brand's PDF Content and PDF Image, the
  sidebar draft - *every* way out of it asks first, in one wording: **Go Back** keeps the work where
  it is, **Discard & Continue** lets the move through. That means the rail *and* the X *and* the
  pickers and tabs on the screen itself, since a dropdown that reloads the canvas discards the work
  as completely as leaving the section does, and a refresh raises the browser's own warning. The
  question is `components/shared/useUnsavedGuard`, so a new control that can discard staged work
  routes through it rather than writing a second dialog. Screens that save as they are typed - the
  Field Settings option lists, an excluded WhatsApp number, a quotation term - stage nothing and are
  never interrupted; asking about a half-typed word is what stops a warning being read.

- **A table's rows can be ticked, and a selection exported or deleted in one press.** Every table
  in the application draws the same column of tick boxes and offers the same two things, in the
  screen's own title bar where its Add button stands — that button stepping aside while anything is
  ticked: **Export**, which writes the ticked rows through the table's own exporter so it is the
  same columns and the same file the ⋮ menu's Export CSV gives, and **Delete**, on the registers
  that have a delete at all. Each carries the count it would act on, and a ✕ clears the selection.
  The boxes are `ADMIN / Table Select All` Read / Write and nothing else — a role without it has no
  boxes on any table, nothing in the title bar, and works every register a row at a time, which is
  how the application behaved before. Absent rather than disabled: a tick box that cannot be ticked reads as a broken table.
  Deleting a selection asks for that permission **and** the screen's own Read / Write, so on a
  register somebody may only read the boxes appear and offer Export alone. Which *rows* then go is
  unchanged and still decided per row on the server — every bulk route runs the module's own
  single-row delete once per id — so a selection loses exactly the part that was this person's,
  keeps the ticks on the rest, and says how many were left alone. Seven registers offer Export and
  no Delete, because they have no delete to offer: Contacts, Employee Referrals, Client Gifts, CRD
  Documents, the Schedule, the attendance registers and Payment Requests are read from records other
  modules own, or are worked by status rather than by deletion. The Leads & Followups and Interview
  boxes keep their own older permissions, which guard bulk actions these two do not have.

Schema form standards:

- Use the full-screen panel pattern.
- Include a left rail for sections.
- Use a sticky footer for actions.
- Use an X close control.
- Buttons must be validation-aware.
- Keep forms compact, scannable, and consistent across modules.

Table standards:

- Employee Repository is the master table standard.
- Tables should support filters, sorting, manage columns, freeze columns through the 3-dot menu, CSV export, infinite scroll, and an info panel where relevant.
- **Frozen columns are positioned from the width the browser actually drew**, measured off the header
  cells, not from the size the table model holds. The two are the same only where a table turns on
  `columnResize` — that path renders `table-layout: fixed` with a `colgroup`, so the model's size is
  the real width. Every other table renders `w-full` on the browser's `auto` layout, where a column
  is as wide as its content and then stretched to fill, while the model answers a flat 150px for any
  column declaring no `size`. Positioning from that number pinned each frozen column a little to the
  left or right of where it really sat, so it either overlapped the column before it or left a gap
  with the unfrozen rows sliding through. **Freezing "2 columns" also means two columns anybody can
  read**: on a table with sub-rows the 34px expand chevron is a real column in front of them, and it
  is pinned along with the first of them rather than counted as one of them.
- The info panel supports collapsed and expanded states only.
- Use row actions through established row/action menu patterns.
- How a table was arranged belongs to the **person, not the browser**. Column order (dragged in the
  header), hidden columns, frozen columns, column widths, Compact view, and the tab a screen was
  left on are saved against the login through `/api/user/preferences`, so somebody who arranges a
  table at the desk finds it arranged on the laptop. `PreferencesProvider` fetches them once per
  session; the browser keeps only a cache, namespaced by user id. Reset Table Layout in the 3-dot
  menu puts a table back.

## Quotation Shoot Types

- **A service has one Price, and one list of deliverables.** Settings → Project → Services asks
  Service Name, Price, Remarks, Deliverable Added (with the deliverables it brings) and
  Complimentary - no Shoot Type, Session Timing, Duration or Size, and no pricing lines under a
  service. The Quotation Generator stamps that Price on every shoot the service is added to, and the
  CRM Quotation Calculator lists the service as one line at it; a service with no Price quotes ₹0
  and says "Not priced in Settings". The deliverables live in `project_service_definition.deliverables`
  (`serviceDeliverables` reads the old per-line mapping for a service not saved since). The stored
  `pricing` lines, timings, shoot types, durations and size answer are kept untouched and read for
  no price (the line pickers for them are covered below). Supersedes the per-shoot-type pricing lines and per-booking deliverables described in
  the bullets below.
- **Service lines show no Session Timing in the Quotation Generator, Create Project and Edit Sale
  Details** (`sessionTimingColumn={false}` on `ProjectServiceCreationSection`). The line still
  starts on and saves its shoot's session; Start Project in Project Management keeps the column.
- **No service line shows a Size** on any screen using `ProjectServiceCreationSection` (all four
  Service Creation screens). A size a line holds is kept and saved; a deliverable's Size stays.
- **Signed Quotation, with no quotation linked, follows the project's lines** on Create Project and
  Edit Sale Details: priced at Settings prices by `projectLinesAmount` (through `quotationTotals`),
  followed only by a form that opened with no figure (typing stops it, clearing resumes it); a figure
  already held is never replaced, only noted against the lines' sum. A linked quotation's amount
  stays read-only; a converted lead's budget is never used. Start / Edit Project in Project Management is
  unchanged.
- **A deliverable's brands and variants keep their ids when it is edited.** A service's pricing line
  maps the deliverables it brings as deliverable + brand + variant ids and shows each under the
  deliverable's current name; a deliverable save used to replace every brand and variant, so any
  edit - even a rename - left those services reading "This deliverable is no longer offered". The
  dialog sends each row's id back and `saveDeliverableBrands` updates it in place, creates only rows
  with no id of this deliverable's, and deletes only rows the form removed. Mappings saved before
  this whose variant was already replaced still read "no longer offered" and are picked again.
- **Settings → Project writes each row when its dialog is submitted; the footer Save closes Settings.**
  Add and Update in the Service and Deliverable dialogs write to the server at once (a new row is
  the name-only create and then the settings PATCH, which saves a deliverable's brands and variants
  in one transaction); the dialog closes and says "Service added." / "Deliverable updated." only
  once the server has answered, and a refusal keeps it open with what was typed and the reason
  shown in it. Remove writes when its confirmation is pressed. A new row whose settings PATCH failed
  is patched, not re-created, when Add is pressed again. One press is one request
  (`useSubmitOnce`). Saving a row closes only its dialog - Settings stays open. Nothing is held
  unsaved, so the footer's Save has nothing left to write: it finishes the session and closes
  Settings, held shut ("Saving...") while a dialog's write is running. No other section can hold an
  edit at that moment - one section is mounted at a time, and leaving one that holds an edit asks
  first - and every other section keeps its own Save and unsaved-edit guard unchanged.
- **Services and Deliverables are put in order by dragging, in Settings → Project.** A grip in
  front of each row moves it: drag it, focus it and press the arrow keys, or use Move up / Move down
  on a phone. The column headers do not move. The order is saved the moment a row is dropped
  (`PUT /api/sales/service-definitions/order`, `PUT /api/sales/deliverable-definitions/order`,
  behind `PROJECT / Projects` Read / Write) into each row's `sortOrder`. Every list of them reads it
  first, with the name as a tie-break (`services/definitionOrder.js`): the quotation generator, the
  calculator, Create Project, Extra Quotation and the pickers. A new or restored row joins at the
  end, and a deliverable's companies and variants keep the order
  set in its own dialog. The grip waits while a column header sort is on. Migration
  `20261026130000` numbered both tables by name once, so nothing moved until somebody dragged it.
- **Services and Deliverables can be duplicated in Settings → Project.** The row's More menu reads
  Edit / Duplicate / Delete. Duplicate opens the Add Service / Add Deliverable dialog filled with
  everything the row holds - pricing lines and the deliverables each brings, brands and variants,
  answers, remarks, shoot type, timings, duration - and the name empty; Add creates it as its own
  record (new id, new brand and variant rows), and the source is never written to. A taken name - case, spacing and punctuation ignored, the server's own rule - is
  refused in the dialog, and by the server's unique name and code columns, as a 409 even when two
  adds race. A name belonging to a *deleted* row restores that row, as Add always has. A service's
  post-production workflow is configured on its own screen and is not copied.
- **A deliverable line is named by its brand and size everywhere, and keeps them from quotation to
  project.** One formatter (`deliverableRowLabel` / `deliverableVariantLabel` in
  `frontend/src/lib/deliverableBrands.mjs`) names every deliverable line - Deliverable - Brand -
  Size - Frame, or a video's length - in the Quotation Generator, Create Project / booking, the
  project's edit screen, the project table and the info panel. A project line keeps the variant it
  was quoted or picked as in `project_shoot_deliverable.brand_name` / `size` / `frame_inches` /
  `video_length`: a snapshot of what was sold, since a variant can be resized, repriced or removed
  later. The server looks the variant id up against the deliverable as it stands and saves what it
  holds, falling back to the quotation's own words for a variant that no longer exists. A shoot holds
  **one line per variant** (the same variant twice is refused), so two brands or sizes of one
  deliverable quoted on one shoot both reach the project; the project pickers list every variant the
  way the quotation's does. Lines saved before this read by the deliverable's name, as they did.
  Image Selection still groups lines by the deliverable's name.
- **Settings → Fields asks module, then screen, then field** - the same path a person walks in the
  hamburger to reach the page the answers appear on. The first two pickers are the sidebar itself:
  they read `SIDEBAR_MODULES` in `frontend/src/constants/navigation.mjs`, the canonical registry the
  hamburger, Sidebar Layout and Role Management all draw from, so a module or a screen added there
  appears in Settings → Fields with nothing else edited. Every module and screen is offered,
  including the many with no editable answers; those say they have none rather than being hidden,
  so the picker and the hamburger describe the same application. Only the third picker is written
  down, in `frontend/src/constants/moduleFieldLists.js`, where each list names the screens it takes
  effect on - and **a list used on two screens is offered under both**: Relationship and Referred
  From under Leads & Followups and Quotations, the payment schedule's Category under Bookings &
  Converted and Projects, Payment Mode under Accounts Manager and Projects. It is one list either
  way, so editing it from either screen is the same edit. It replaced a single Module picker over
  Table Settings' `OS_MODULES`, a second list of the application's modules that named some the
  sidebar does not have and missed some it does.
- **The Quotation Calculator is a screen of its own** at `/sales/quotation-calculator`, answering to
  `SALES / Quotation Management`. A lead's popup opens it with the **Quotation Calculator** button,
  which navigates there in the same tab carrying `?lead=<enquiry id>`; **Back** returns where it came
  from. It was a dialog over that popup until 2026-10-08 — pricing a quotation is a screen somebody
  sits on, with the catalogue, a date's bookings and a dozen rows, and on a phone a dialog that tall
  was a page with a border round it. Opened with no lead it still prices, and an **Enquiry ID**
  picker appears so the figures can reach a quotation — drawn only for somebody holding `SALES /
  Sales Manager`, whose list it is, since a picker that answers 403 is worse than none.
  **Deliberately not in the sidebar:** two menu screens may not share a permission or Role
  Management could not grant one without the other, so it is a guarded route reached from a lead,
  the shape `/sales/crd-documents` has.
- **The CRM Quotation Calculator picks services and deliverables the way the Quotation Generator
  does, and prints no unit price.** Opened from a lead, it used to list the whole catalogue with a
  price and a stepper against every row. It now opens with nothing chosen and the generator's own
  picker control: **Choose Services** lists every booking a service is priced as - one entry per
  Settings → Project pricing line, named Service Name - Shoot Type - Session Timing - Duration - and
  adds the row with that booking the moment one is picked; the row keeps an Option dropdown for
  changing the booking where the service has more than one; **Choose Deliverables** lists the generator's brand-and-variant
  entries worded the same way. Only what was chosen is listed with its quantity, its No. of Count
  where the deliverable is counted, and Remove - which also takes off a deliverable a service brought
  in when it is not wanted. A service answered Deliverable
  Added brings the variants Settings mapped onto that pricing line in with it and takes them away
  again when it is removed, and the names `serviceDeliverableRules.js` pairs with a service follow
  it in - the same two rules, from the same code, the generator applies. Every row is still priced
  at its Settings figure, No. of Count still multiplies, and the totals - Services & Deliverables,
  Service Cost, Discount, Total Cost - and Apply to Lead are unchanged; the per-item price is simply
  not shown. Apply to Lead now also writes the priced lines the total was built from onto the lead's
  draft, and a draft saved before this reopens as it was: a row keyed by the deliverable alone is
  the flat row it always was. Settings prices, the generator, saved quotations and the PDF are
  untouched (`components/sales/QuotationCalculatorLines.js`, `lib/quotationCalculator.mjs`,
  `quotation-calculator/controller.js`). A chosen service reads as **Service Name - Shoot Type -
  Session Timing - Duration**, from its pricing line's own words.
- **The calculator's Apply to Quotation opens the Quotation Generator on its choices; it no longer
  writes a total onto the lead.** Apply to Lead saved the calculator's total as the lead's quoted
  amount, which conversion read into Signed Quotation. Apply to Quotation instead builds the
  generator's own payload from the choices - one shoot dated from the calculator and booked under
  the shoot types and session timings its lines are priced as, every service and deliverable as the
  row the generator would have made itself with the same ids, definitions, stamped Settings prices,
  No. of Count and auto-added records, the discount, and the lead's enquiry id and vertical - puts
  it in session storage, and sends the person to Sales → Quotations, where the generator opens on
  it as a **new** quotation with everything editable and Generate Quotation still the only thing
  that saves. A base package or extras, which the generator has no line for, are written into
  Additional Notes after a confirmation that says they are not in the total; a choice the generator
  cannot carry stops the handoff and is named. Normal generator use, saved quotations, conversion
  and the lead-quote endpoints are unchanged (`lib/quotationCalculatorHandoff.mjs`,
  `lib/quotationGeneratorDraft.js`, `QuotationPage.js`, `QuotationGeneratorPanel.js`).
- **Sales & CRM → Quotations → Shoot Type maintains the shoots each brand quotes for**,
  one tab per brand — Dum Dum, Qua Qua, Corp. Each list is the brand's own: the studio names what it
  quotes for under each rather than ticking them off one shared vocabulary.
- **One list, three readers.** That screen edits it; the cover and Thank You picture sets in
  Quotation Settings → *brand* → PDF Image are chosen from it; and the Quotation Generator's **Add
  Shoot** offers a quotation only the shoots its brand quotes for.
- **Project Management is untouched** and still offers the studio's whole shoot vocabulary
  (`shootOptions` in `AddShootDialog`). A brand with no shoots set up falls back to that vocabulary
  too, so an unseeded database leaves nobody unable to add a shoot.
- **The brand lists are no longer a subset of the studio's 34.** They were, held there by a test, so
  a quotation could never name a shoot a project could not be given. Naming them per brand ends that
  link: a project takes its shoots from the quotation that sold it so the two still agree, but a
  project raised with no quotation behind it offers the studio's own list.
- **Editing them answers to `SETTINGS / Quotation Settings`**, the permission that owns Quotation Settings
  — changing which shoots a brand quotes for changes what every quotation raised under it may hold.

## Employee Option Lists

- **Shoot Type is one list for Sales & CRM: the brand's shoots, a tab per brand** - Settings →
  Fields → Shoot Types (`SalesQuotationBrandShoot`, edited through `/api/sales/quotation-brands/admin/
  :code/shoots`, offered under Leads & Followups and Quotations as the same list). The Quotation
  Generator's Add Shoot reads it for the quotation's brand through the brand configuration; CRM →
  Add Lead and the lead popup read it for the lead's own vertical through
  `GET /api/sales/quotation-brands/:code/shoots` (names alone, readable with CRM Leads Read) via
  `useLeadSuggestionLists({ vertical })`, with **no fallback**: an entry removed in Settings is gone
  from the form, an empty list says where to add one, a failed load says so under the rows with a
  Try again (`reload` from the hook), a vertical switched on the form reads that vertical's list and
  drops any reply from the previous one, and a row already holding a word the list no longer has
  keeps showing it, so an older lead reads as it was saved. The twenty-one-word array the CRM used
  to hold is gone; and the Offer Type beside Relationship on Add Lead reads the Offer Types list that
  Field Settings had always named for it, rather than that same array.
- **Leads & Followups and Quotations both offer Relationship and Referred From** - the two
  typed-with-suggestions fields on CRM → Add Lead, the lead popup and the Quotation Generator's
  Client Details. Both screens read the one list (`/api/hrm/lead-relationships`,
  `/api/hrm/referral-sources`) through `useLeadSuggestionLists`, so a source added there is
  suggested on the lead and on the quotation alike; the fields stay free text, so an answer not on
  the list can still be typed. Deleting an entry is refused while a lead on the board holds it (a
  lead in the trash does not count) and renaming carries those leads with it.
- **HRM → Employee Repository maintains twelve lists**: designations,
  departments, verticals, skills, work types, genders, marital statuses, emergency contact
  relationships, work locations, employee statuses, blood groups and languages. Each is an HRM
  master-data resource under `/api/hrm/<resource>`, so the screen that edits it and the form that
  offers it are the same list. Blood group and languages were the last two to come across, and were
  in different states: blood group had no table at all, and `language` had one that nothing had ever
  written a row to, so the employee form went on reading the seventeen names compiled into the
  browser. `employee.blood_group` was widened from ten characters to fifty at the same time — it was
  sized for `AB+` when the eight values were fixed, and a maintained list can hold a longer name.
- **Every answer from those lists is also stored as a reference.** Beside `designation`, `work_type`,
  `gender`, `blood_group`, `marital_status`, `emergency_contact_relationship`, `work_base_location`
  and `current_work_location` the employee row carries the list row's id; department, skills and
  languages, which a person holds several of, are rows of `employee_department`, `employee_skill`
  and `employee_language`. Derived on every save by `services/employeeReferences.js` and backfilled
  by migration `20260924120000`; the text stays what the form sends and shows. Two list entries spelt
  the same resolve to no reference rather than a guess. See DATA-SCOPE.md D36.
- **Work Base Location and Current Work Location share one list.** They are the same set of places
  and always have been — the branches, plus the answers no branch can give (Remote, Work From Home,
  On Field). One entry in Field Settings feeds both fields.
- **Three of the lists carry meaning as well as words, and the code reads it off the row.**
  `counts_as_working` on an employee status decides who may be handed an asset, who the CRM offers
  as a salesperson and who may link a WhatsApp session. `requires_spouse_details` on a marital
  status decides whether the employee form, the onboarding form and the public submission endpoint
  ask for a spouse name and a wedding anniversary. The gender list is what that endpoint validates a
  submission against. All three used to be written into the code — the array in eight files, the
  literal `"Married"` in four, a `z.enum` of three genders — which made the lists editable in name
  only: a rename dropped people out of the CRM, or stopped a form asking for a spouse, silently.
- **Nothing ever answers with an empty list.** Every read falls back to what the code used to say
  (`["Active", "in Training", "PIP"]`, `["Married"]`, the three genders), because "nobody counts as
  working" would empty the CRM and refuse every asset handover, and "no gender is valid" would
  refuse every onboarding submission. An unseeded table behaves exactly as the application did
  before these lists existed.
- **The candidate's apply page is served the lists with its invite.** It has no session, so it
  cannot read HR's master data; without this the studio would edit a list the candidate is never
  offered, and the two screens would ask different things about the same person.

- **An entry in use cannot be deleted, and renaming one carries the records with it.** These lists
  are stored on the record as plain text - an employee's department is the word "Accounts", not a
  link to the row - so deleting an entry used to leave records naming something no list offered, and
  renaming one left them on the old word. Both were silent. A permanent delete is now refused while
  anything holds the value, naming it and what uses it; a rename updates every record holding the old
  value in the same transaction and reports how many. An archived employee counts as using a value,
  and the refusal says how many are archived. Where each list's values live is declared beside the
  list in `master-data/definitions.js`, and a test fails if a list reaches Field Settings without it.
  A list whose values are not in a column that can be counted says so in words instead
  (`storedInPayload`) - a payment schedule is kept inside the project's own JSON payload and a tier
  is minted into a WhatsApp group name and kept nowhere afterwards, so there is nothing to query.
  Saying it out loud is what keeps it a decision rather than a `usedBy` somebody forgot.

- **Three more lists came across from the code, each under the module that owns it.**
  **Booking & Converts → Payment Schedule Category**, **Accounts → Payment Mode** and
  **Sales Manager → Tier**. Payment Mode was written out twice - once in `accountsConfig.js` for the
  cash entry form and again in `cash-entries/controller.js`, where the entry is validated - so a
  mode added to one would have been offered by the form and refused by the server; both read the
  same list now, through `services/paymentOptionLists.js`.
- **These lists carry their meaning on the row too, and Field Settings asks for it as a question.**
  `settles_balance` on a payment schedule category is the row pinned to the bottom of a schedule
  that takes no date and that nothing may follow; `repeatable` is a category a schedule may hold
  several of, numbered as they are added (*Partial Payment 1*, *Partial Payment 2*);
  `asks_for_transaction_id`, `asks_for_account` and `asks_for_details` are what each way of moving
  money asks for on a cash entry. Every one of these used to be the *name* - `=== "Final Settlement"`
  in three places, a regular expression written around two more, and three arrays of mode names - so
  a rename stopped the schedule closing or the form asking.

  Asked above the list rather than ticked on each row, and the shape of the question is the shape of
  the rule: "Which category closes a schedule?" takes one answer, because only one ever may, and a
  tick per row said the opposite - it offered that behaviour on all four at once. The rest take a
  set. The rows themselves stay plain names, the same editor every other list uses; a list that
  declares no behaviours looks exactly as it did.
- **The last category that closes a schedule cannot be removed.** The flag is not something the
  screen can hand to another row, and a schedule with no closing row never closes and keeps
  appending a fresh one. Renaming it is the supported move - which is the whole point of the
  meaning being on the row rather than in the word.

- **Ten more dropdowns came across, and the line they stop at is the point.** Asset Conditions,
  Repair Severities and Asset Shipment Types (Assets); Storage Conditions and Storage Shipment
  Types (Client Storage); Vendor Types (Vendors); Bank Account Types (Accounts Manager — the list
  remains, though nothing reads it since the bank-account register it described was retired);
  Settlements (Payment Requests); Offer Types (Leads & Followups, Quotations); Task Types (Tasks).
  Four were written on both sides - the browser offering a word the server would refuse - and all
  read one list now, through `services/optionLists.js`, which caches for a minute and never answers
  with nothing.
- **Workflow states are not lists and must not become them.** Task and payment-request statuses,
  asset statuses, the client-storage transition table, entry type Received/Spent, priorities: the
  application branches on those words, so renaming COMPLETED would strand every completed task and
  deleting Spent would break the cash book. Carrying the meaning on the row does not rescue a state
  machine. `test/vocabulary-option-lists.test.js` holds that line, so a later change cannot quietly
  cross it.
- **Assets and Client Storage keep a list each of Conditions and Shipment Types.** They read the
  same today; the two are separate tables so either can change without the other, because a disc on
  its way to a client is not judged the way a camera on the shelf is. This is the opposite call from
  Work Base Location and Current Work Location above, which share one list - both were the studio's
  own decision rather than a rule.

## Employee Repository Details

Route:

- `/employees`

Tabs:

- All
- Active — working (`Active`, `in Training`, `PIP`), less whoever is serving notice
- **Serving Notice** — a working status with `dateOfRelieving` set (`isServingNotice`). An
  offboarding whose last working day is today or later starts a **notice period** (`servesNotice` in
  `separations/controller.js`, restored 1 Nov 2026 after the 27 Oct relieve-at-once rule): the
  employee keeps their status and login and works as usual, and the server relieves them the day
  after the last working day (`separations/relieve.js`, every five minutes) - the separation's status
  lands, the row moves to InActive and the login closes. A last working day already past, or a hire
  never taken on, relieves at once. Under Settings → Payroll rules → **Hold salary during notice**
  their salary is held through the notice and paid as the full and final settlement (see Payroll). Their row offers **Open Offboarding** and
  **Withdraw Notice** - the Move to Active endpoint with its required reason, which removes the
  offboarding and the last working day and leaves status and login alone.
- Employee Submission Pending
- HR Onboarding Pending
- **Incomplete Profiles** — not a status: a working employee (serving notice included) whose Payslip
  Info lacks something Settings → Payroll rules → Edit Payslip asks for - an item it lists and has on,
  or a detail added there (the PF ones only while the payslip carries them). Overlays the status tabs
  the way Review Pending does, so HR can find who to complete after a new detail is added.
- **Review Pending** — not a status: a working employee (`Active`, `in Training`, `PIP`) whose Next
  Review Date has gone by, computed the same way the employee's own Reviews page marks
  "Upcoming" overdue. Overlays whichever status tab the row already belongs to rather than moving
  it out — an overdue Active employee still shows under Active as well. Its rows carry **Start
  Review** on the ⋮ menu, which opens the employee's Add Review dialog directly, prefilled with the
  overdue date.
- InActive — `Relieved`, `Absconded`, `Fired` and `Long Leave`; every row in it carries **Move to
  Active** on its menu

Rules and behavior:

- Employee ID is backend-generated as `DBS-1`, `DBS-2`, `DBS-3` — unpadded, and carrying neither a
  vertical nor a branch, because a person belongs to the studio rather than to a board.
- Employee ID is read-only in the UI.
- Employee ID must not be required in the frontend create payload.
- Add Employee, Edit, Review, Approve & Onboard, onboarding invites, and Technical credentials are part of the current Employee Repository workflow.
- **A resignation can start as the leaver's own form.** The options menu beside Add Employee carries
  **HR Offboarding**, the register of them, drawn only for a writer. Its **Raise a form** has HR
  pick the employee from a dropdown (working, not already serving notice, no form open) and state the
  notice period in days; a working employee's row ⋮ offers **Resignation Form** with them already
  chosen. The employee gets a tokenised link
  (`/offboarding/apply/<code>`), confirms the email or phone on their record, and answers **from
  when** they are serving notice; the form shows the expected last working day it produces, counting
  the first day of notice as served. Sending it changes nothing about their employment - it reaches
  HR as **Submitted** - and HR's **Approve** is what records the separation, through the same
  `recordSeparation` the offboarding form uses, which is what puts them on the Serving Notice tab
  above. A rejection has to say why and leaves the employment untouched; **Send back** is the move
  between the two - the form reopens on the same link with their own answers on it and HR's remark
  saying what to change, and sits at **Sent Back** until they submit it again. The form itself asks
  the record back (ID, name, designation, team, reporting manager, joining date, official email),
  then the resignation date, the reason from the separation form's own list, any comments, and the
  proposed last working day, which is read-only: the notice period counted from the resignation date,
  computed and stored by the server and never posted by the browser. Every action on a form is on its row's **⋮** in the
  register, as the onboarding invites' are: **View** (any row), **Review** (a Submitted one, where
  Approve starts the notice period, Send back asks for a correction and Reject refuses it), **Edit
  form** while it is still open - the notice period and the note, never the employee, and the link is
  untouched - then Copy link, the confirmation or refusal
  message once it is decided, and Cancel form. Nothing emails the form itself - the studio sends the
  Settings-worded message with the link - and the only automatic email is the one that reopens a form
  sent back. The whole thing is
  `HRM / Employee Management` on both sides, narrowed by the repository's own branch reach, so a
  form about somebody out of reach is neither listed nor actionable. Its four messages - the form,
  a reminder, the confirmation with the dates, and the refusal with HR's remark - are written in
  Settings → Message Template (`EMPLOYEE_OFFBOARDING_FORM`, `_REMINDER`, `_APPROVED`,
  `_NOT_ACCEPTED`); the sent screen is the first of them through `ShareableMessage`, with Close
  beside it and nothing else, and the register's row menu offers the other three, each falling back to the wording the screens shipped with.
- **The onboarding tabs hold two kinds of row.** An **invite** — a candidate who has not submitted
  the form — is a synthetic row with no employee record behind it, showing no Employee ID and
  carrying the invite's own menu: View, Copy Link, Edit Invite, **Start Offboarding** and **Cancel
  Invite**. An **employee record** on one of those statuses is the real thing: created by Add
  Employee, or left there when a submission is sent back. Its menu is the employee one.
- **Nothing is taken off somebody while they serve notice.** Their direct reports and their pending
  work stay with them until the day they are **relieved**, because until then they are still coming
  in, still running their team and still the person doing the work on their own name. At relieving
  (`separations/relieve.js`) the reporting line moves itself up to the nearest manager still working
  - a refusal there is logged and does not block the exit, since the login must close on the right
  day - and the **pending work** is handed over by HR from the InActive row's **Hand Over Pending
  Work** (`POST /api/hrm/separations/pending-work/:employeeId`), which runs the same `handOver` and
  refuses while the person still works here. A separation with **no notice to serve** - an
  absconding, a termination today, a last working day already past - makes them InActive at once, so
  for those both still happen as the separation is recorded, hand-over question included.
- **A leaver's direct reports move up to the nearest manager still working.** Offboarding someone,
  moving them out of a working status or removing them shifts everyone who reported to them up the
  chain — past any manager who has left or been archived — to the first one still working
  (`nearestWorkingManager` in `services/reportingLine.js`). With nobody working above, the change is
  refused and names how many reports need a manager first. The hand-over pop-up suggests that same
  person. Their pending work, waiting approvals and approver slots still go to whoever the hand-over
  names.
- **Offboarding an invite turns it into an employee record.** The two entries on an invite row are
  different decisions. Start Offboarding opens the same offboarding form an employee is relieved
  with, and saving it creates the record — the invite's name, email, phone and intended designation,
  on `Employee Submission Pending`, which the separation then stores as `previousEmploymentStatus` —
  marks the invite Cancelled and points it at that record, and records the separation against it,
  all in one transaction. The row lands in InActive and Move to Active returns it to the wait it was
  in. Cancel Invite is the other case: an invite sent by mistake, which leaves nothing worth keeping
  and no record behind. A record created this way holds only those four answers, so it reads as what
  it is — a hire that never started — rather than as a half-filled employee.
- **Rejoining keeps a work history.** Before Move to Active deletes the separation, it writes an
  `employee_rejoin` row: the last working day, how and why they left, the day they rejoined, the
  reason and who brought them back. The profile's **Work History** lists every stint from those rows,
  for example "Joined 2 Jan 2025 – left 10 Oct 2026 (Resignation · Better Opportunity)" and then
  "Rejoined 31 Oct 2026 – present". The days strictly between leaving and rejoining are days they
  did not work here: the register, the date-range report, leave counting, the employee's own page
  and its totals, and payroll's counted days all leave them out, unless they logged in that day. The
  original joining date is kept. A withdrawn notice, or a Long Leave with no relieving date, writes
  no row.
- **Move to Active asks for a reason, and it is required.** The action deletes the offboarding it
  reverses, so the reason is the only thing that says afterwards why somebody who had left is at
  work again. It is stored on the employee with who did it and when — `reactivation_reason`,
  `reactivated_at`, `reactivated_by_user_id` — and overwritten if it happens twice, since what is
  wanted is why this person is at work now rather than a history of reversals.
- **Start Offboarding is on every employee row**, the two onboarding statuses included. It was
  withheld from them once, on the reasoning that there is nothing to offboard somebody from before
  they have been taken on; a hire that falls through at that point is exactly what the studio has to
  record, so the row offboards like any other and the separation type decides the status as usual.
  Bringing such a row back returns it to the onboarding status it held, not to Active.
- **Offboarding is a status change, not a deletion, and it closes the login.** Recording a
  separation moves the employee to `Relieved`, `Fired` or `Absconded` by separation type, writes
  the departure detail to `employee_separation`, stamps `dateOfRelieving` and `relievingRemarks`,
  and sets the linked user account to `INACTIVE` — all in one transaction. `archivedAt` stays null,
  so nothing is hidden: the record keeps everything and reads under **InActive** and **All**, while
  every picker in the app drops them, because those filter on the statuses marked as working in
  Settings → Field Settings. Deleting an employee is the separate, heavier action: it refuses while
  they still hold or manage an asset, then sets `archivedAt` and closes the account, which takes the
  row out of every screen at once.
- **Generate → Experience Certificate**, on the row's ⋮ in Employee Repository → Administration, for
  somebody **InActive** (Relieved, Absconded, Long Leave, Fired) or **Serving Notice** only. It asks
  for a brief summary of their duties, then shows the certificate on an A4 sheet with Download PDF:
  Mr. or Ms. by their gender (both where none is set), their name, designation, department, date of
  joining and last working date (`date_of_relieving`) from the record, the duties as typed, and the
  heading, e-signature, signatory and note from Settings → Employee → Certificate → Experience.
  **Generate → Employment Certificate**, on the ⋮ of anybody **Active** (working, not serving notice),
  opens straight on the filled employment certificate - nothing is asked - with Download PDF, its
  signatory and note from Settings → Employee → Certificate → Employment.
  Nothing is stored; `HRM / Employee Management` Read / Write, for an employee the caller may change.
- **The way back is Move to Active**, on the row's ⋮ menu for anybody the repository does not count
  as working — the three departure statuses and `Long Leave`, which has no separation behind it at
  all. It removes the offboarding record, restores the status held before it (their own, where that
  counts as working **or** is an onboarding status; otherwise the first working status, so a Long
  Leave that became a Relieved is not "restored" back into the InActive tab, while a candidate
  offboarded before they started returns to the wait they were in rather than being promoted to
  Active), clears the relieving date and remarks, and reopens the login **on a new auto-generated password**
  (a rejoin: same record, username, roles and branch; the old password stops working, every saved
  desktop session is revoked, the account must choose its own password at first sign-in). The new
  password is emailed to the employee's own address, and shown for copying in the Login credentials
  dialog to whoever also holds `ADMIN / User Management` Read / Write - so it can be handed over when
  the email does not land. Withdraw Notice leaves the password alone. The separation is removed rather than kept, which is what lets the employee be offboarded
  again later: a second separation is refused while one is on record. Not offered on the two
  onboarding statuses — there is nothing to come back from before somebody has started — and the
  endpoint refuses those and anybody already working with a 409.
- Phone is split into country code and national number.
- Country code is editable and defaults to `+91`.
- Aadhar, PAN, IFSC, and bank account validations are enforced where implemented.
- Nobody under 18 can be recorded as an employee. The Date of Birth calendar on both the public
  onboarding form and the Add/Edit Employee form stops at the last day that still leaves the person
  eighteen, and both endpoints refuse a younger date — a record that predates the rule is named on
  the field when it is next edited rather than silently accepted.
- **Emergency Contact Relationship is a dropdown**, on both the Employee Registration Details form
  and the public onboarding form the candidate fills in. It was free text, which is the wrong shape
  for the one field that is read on the worst day of an employee's career: "how do you know them"
  has to be legible at a glance rather than deciphered from `Bro`, `frnd` or `dad's`. The list is
  wide — parents, spouse, siblings, in-laws, guardian, friend, colleague, neighbour — because an
  emergency contact is often not immediate family, so `Other` is the escape rather than the common
  case. Both screens read one list, so HR can always choose the answer a candidate gave; a record
  answered before the list existed keeps its answer, which is added to the picker rather than shown
  as unanswered.
- A married employee is asked for their children, a name and a date of birth each. Never required,
  and cleared with the marital status: saying they are no longer married removes the children along
  with the spouse and the wedding anniversary. Stored as rows in `employee_child`.
- Qualification Details and Experience Details are lists on both forms, not free text. A
  qualification is a degree (required), its branch, the college and the passing-out year; a job is
  the company (required), its location, the role, the years, and one experience or relieving letter
  attached to it. Neither list is required — a fresher has none — and a row nobody filled in is
  dropped on save. Stored as rows in `employee_qualification` and `employee_experience`; the letters
  go to document storage under `hrm/onboarding/experience`.
- The repository table and info panel show these two lists folded to one line each, since neither
  surface can draw rows. The forms are where they are read and edited.

## Sales / W/A Generator Details

Sales Project rules:

- `SalesProject` uses backend-generated Event IDs as `DBS-BK-DD-ERD-000001` — the booking's
  vertical and branch, counted per vertical. **A Sales Manager booking and a Project Management
  project are the same record**, so the two screens show this one identifier; there is no separate
  project number, and the studio quotes one code from the sale through to delivery.
- Manual WhatsApp group names do not create generator records.
- Generated WhatsApp group names expire if unused.
- Generated WhatsApp group names disappear from available selections when used.
- Generator metadata travels with projects so the relationship can be tracked after project creation.

## Project Management Details

Projects support statuses, tabs, row actions, soft delete, Row View, and Tree View.

**Project Vault** (called Recycling Bin until 31 Oct 2026; its permission key still is). Deleting a project - the ⋮ menu's Delete on Projects, or ticked rows → Delete on
Projects and Bookings & Converted - only moves it to **Resource Management → Project Vault**
(`ASSET / Recycling Bin`): it leaves every other screen, its galleries are hidden, its client's app
login is switched off and its client storage records leave the register, and nothing is erased.
The bin lists the deleted projects (Event ID, WhatsApp group name, vertical, client main number,
deleted by, deleted on). **Restore** brings back exactly what that delete touched - the project,
the galleries stamped with its deletion time, the client login only if the delete switched it off,
and the storage records removed with the project's reason at that deletion - and refuses with a 409
if a live project now holds its Event ID; it turns the client login back on only if that delete
switched it off (`user.deactivated_with_project_at`) and it is still off. **Delete permanently**
names the Event ID it confirms (`confirmEventId`, refused 400 on a mismatch), claims the project
(`sales_project.purging_at`) so a Restore or a second press meanwhile is refused with a 409, purges
its Image Selection photos - an Album Proofing gallery is only unlinked, never purged - then erases
the project and everything hanging off it (payments and storage discs stay, unlinked). A failed
photo purge releases the claim and leaves the project in the bin (502).
Nothing empties the bin automatically. A project deleted before the bin existed is listed with no
"Deleted by" and restores without its client login, its photos having already been purged then.
The bin's permission lets its holder restore or erase any binned project in their branch reach,
whether or not they could have deleted it. A row opens a read-only view of the project.

While a project is in the bin, nothing of it shows elsewhere: every read of a child row - cash
entries and their summary, payment requests with a line on it, extra quotations, feedback-issue tasks
and the task dashboard, the team's client chats, album proofs of its galleries, the pre production
client form, and every shoot picker - asks for the project to be live (`liveProjectWhere` in
`backend/src/services/projectScope.js`, or `project: { deletedAt: null }`). Rows are never changed,
so Restore brings all of it back. The bank statement import still counts a binned project's entry as
already recorded, without naming it. Its CRM lead reads **Project deleted** (`PROJECT_DELETED_SQL`
in `crmLeadService.js`, first in `statusDisplaySql`; `lead.projectDeleted` on the board) while every
project of the enquiry is in the bin, and its own status again after Restore; deleting the lead is
refused while the project is in the bin.

**Jumping between the five screens a project is worked on.** A row's ⋮ on Bookings & Converted,
Projects, Pre Production, Production and Post Production carries one **Jump to** line with the other
four boards inside it - a submenu off a chevron, like the table's own Freeze Columns, so the menu's
own actions are not buried under four lines beginning with the same two words. A board appears only where the viewer holds
that board's permission *and* the project is on that board - the second read from the row's own
`boards`, which the server fills from the conditions each board lists by
(`services/projectBoards.js`): every live project is on Bookings & Converted and on Projects, a project with a pre production
row on a live shoot is on Pre Production, one with a production row is on Production, and one with
a Post Production Coordinator is on Post Production. Arriving (`?project=<event id>`) **filters that
board's Event ID column to the project** and opens nothing - the project is the row on screen and
the filter box says why; a project on a tab the board is not showing brings it to **All** first
(`useLinkedProject`), and the address is cleared once it has landed.

**Production → Schedule view** (`/project-management/production/schedule`, under the board's own
`PROJECT / Production` prefix - the same endpoints, so the same permission and the same shoots for the
viewer): Production's second view, switched with the Table by the dropdown beside the title
(`ProductionViewSwitch`, as the CRM switches its boards) - the studio's production schedule sheet,
every project's shoots, opening on **All dates** and **on today**: today's shoot, else the next one,
else the latest (`nearestShootTo` - the rows are grouped into runs of a project's shoots, so it is the nearest shoot, not a
place in a run of dates) is scrolled to the top and outlined for a moment, once on load and again on
**Today**, never on a refresh after a change. One row per shoot, a project's
shoots on **continuous days** together - a run, each on the same day as the one before or the next -
and the runs by their first shoot (`scheduleRows`), so a project shooting on the 11th, 11th, 15th, 16th
and 19th is three runs (11 + 11, 15 + 16, 19 alone) with other projects' shoots between them by date; a
heavier line between runs: Event ID and event (client) on a run's first row only, then Shoot ID, date (the shoot's time under it - "6:30 pm – 10:00 pm", or **No time**, `scheduleTimeLabel`) and shoot (its status under it, the name opening its
production panel) - read-only - then its production plan, a block per booked service with the service
on a grey line and who works it below, then the shoot's **Assist** - always shown, **Not assigned**
when nobody is on it. Whoever may change the plan picks the Assist from a multi-select there (mounted
on a click, the shooters and vendors less any employee on another shoot at that time), saved once as
it closes as the plan's `team` (`PATCH /shoots/:shootId/plan`, so the plan's rules hold); it is never
dragged - only a service's own person is. Board rows carry `assistPeople` (`emp:<id>` / `ven:<id>`) for
it. Each person sits in a picker's closed box with their face (`SeatBox` - the real picker is mounted
only on a click): **Not assigned** in grey, a vendor as "EXT-name (business, city)" with where they
stand under it, the whole service tinted amber while **Waiting** and green once **Confirmed**. Whoever may change the
plan changes that there: the word - **Waiting** or **Confirmed** - opens a small menu of the two, and a
choice is saved at once through the seat save, no pop-up; anybody else reads "Waiting" while it is so.
**Use the same team as above** is on a shoot's ⋮ where the viewer may change its plan and the shoot of
the same project nearest above it would change something here (`teamAbove`): every service the two
share takes that shoot's person (`POST /production/shoots/:shootId/copy-team`), the shoot's other
services stay as they are, and the plan's rules hold - a refusal (somebody busy at this time, or
already on another of this shoot's services) is said in the "This action is not possible" dialog. Each shoot's own cells are tinted by
its place in its run (`scheduleRows`): every run's first row one colour, every second row
the next, and on - the Shoot Board's hues, the same across projects - with the number before its
name; a shoot keeps to one line, its text cut with "…". From `md` it is a grid scrolling both
ways under a sticky header; on a phone each shoot is a card. **The person under a service is the one
thing edited here**: a picker of shooters and active vendors where the viewer holds Production at
Read / Write and may change that shoot's plan (`canEditPlan` on the board row - its Production
Manager, a Super Admin or `Show All Projects`), saved at once by `PATCH
/production/shoots/:shootId/seat` (`plan.js` `saveSeat`), which sends every other seat back as held
and saves through `savePlan`'s rules. The picker leaves out an employee out on another shoot at that
shoot's time, as the plan form does - the shoot's `busyCrewEmployeeIds`, asked as the picker opens and
kept until the schedule reloads. **Not assigned** is always offered, on a submitted plan too:
submitting needs a person on every service, but a plan already submitted may have one emptied - a person
put on by mistake - and then reads **Work in Progress** until every service has its person again. **A person is
dragged onto another service** (by the name - only the person is carried, never the service; the drop outlined, the pane scrolling at its edge, a release anywhere ending the drag at
once; the swap drawn on the drop, then confirmed by the server) and the two swap - `POST /production/seat-swap` (`swap.js`), on one shoot or
across two the viewer may both change, both rows locked in shoot-id order before anything is read.
An employee moved to another shoot must be free at its time (a vendor never is held to it - an
external studio sends whoever is free): one on a service or the Assist of another
shoot overlapping it (the seat being left not counting) is refused with a 409 and a dialog naming
that shoot, its project and the service - named only where the viewer may change that shoot too,
otherwise "another shoot". An employee moved across must still be working and a shooter, a vendor
active; a vendor moved to another shoot starts on Waiting; each seat keeps its cameras for an
employee; a person dropped on an empty service leaves theirs empty, on a submitted plan too. Logged on both shoots. **One employee
works one service of a shoot** (`crew.doubledPerson`, held by every crew save - the plan, the seat and
the swap): a save that puts an employee on more of a shoot's services than it already had them on is
refused, named, so a shoot saved with a doubling before the rule still saves; the pickers - here and
on the shoot's own form - leave out an employee on another of its services, and a drop that would
double one is refused before it is drawn. **A vendor is held to neither rule**: the same vendor may
work several services of one shoot, and shoots at the same time. **Nor is a drone service** - any
service with "drone" in its name (`crew.isDrone`, `isDroneService`): it may be flown by an employee
already on another service of the shoot, or by another of the team, and flying it takes nobody off
another service's list. The time clash across shoots still holds for it. Every refused swap is said
in a dialog headed "This action is not possible", never a passing notice. Colours run
teal, orange, pink… (`HUE_ORDER`), the sky blue that read as the page's own background moved back. Filters:
**Quick filters** under the header, one box per column as the tables have (on a phone, a strip above
the cards): Event ID, Event, Shoot ID and Shoot pick any of the values the shoots in range hold, Date
takes a typed or picked day ("2026-11" is the month), and the Production plan's one box picks
**people** - a shoot is kept where any of them is on one of its services or its Assist, so it shows
every project somebody is working (`filterScheduleShoots`); a hidden column's box filters nothing and
Clear empties them all. Above it, Dates (All dates, the default; Upcoming - today on, no last day; or Next 30 days - nothing else) and Projects in
the range; **Zoom** out / in from 80% to 130%,
remembered for the login.

**Shoot Board** (`/project-management/shoot-board`, `PROJECT / Shoot Board`): a timeline —
projects down the left (sticky), days across the top (sticky, a set width each), each project's
shoots as bars along its row in the project's colour, a line between days running to the bottom,
today tinted, no lines between projects. It **scrolls sideways** through the loaded range, and the
project column lists only the projects with a bar in the days on screen, changing as it scrolls;
‹ › scroll a column, Today brings today to the front, and an empty stretch offers "Previous shoot" /
"Next shoot" jumps. **Picking projects - or branches, which narrow the board the same way - scrolls to the selection's
first shoot, and zooms out only where its own span does not fit** (`levelThatFits` over the selection's first shoot to its last, never over the loaded
range - measured against the range, any project at all zoomed the board out, since Next 30 days does
not fit at the full day width however near together its shoots are). The zoom is otherwise the
reader's, and is **given back**: the level they had before the board changed it is kept (`readersZoom`)
and restored when the filter is cleared or the next selection fits without it, so clearing a filter
never leaves the board zoomed out over everything; pressing − or + makes the zoom theirs again. **Only where no level is enough** - a quarter, a long custom range
- does the date axis collapse (`boardColumns`): each shoot keeps its own dates around it, grown
outwards a day at a time until the next would not fit, and the stretches between those islands become
narrow dotted marks saying how many days they stand for. The decision is made from the measured room
(`available`, `dayPx`, `seamPx`), and before anything is measured nothing is collapsed. A mark keeps
its fixed width (`seamTrack`) while the dates share whatever is left (`dayTrack`), so the board fills
its pane with dates rather than with a stretched mark or a bare strip. Today is **not** held out of a
mark - a reader who has named a project is looking at that project's dates - and a single empty day
is never worth one. The bars are untouched (a
run never spans a seam, because no date a bar covers is collapsed); today is never collapsed, since
it is the date the board tints and Today goes to; a single empty day is left alone, a seam being
about as wide as the day it would replace; and with no project picked every date keeps its own column
exactly as before. The window on screen is measured off the header cells rather than as
`scrollLeft ÷ day width`, which only held while every column was the same width, and the seams come
off the width the days must fit in so zooming out still stops in the right place. **Zoom** (− / +) changes how wide a day is, through five steps
(`ZOOM_LEVELS`, factors on the breakpoint's own `--day-base` of 7rem / 11rem, floored at
`ZOOM_FLOOR` 1.5rem): the range filter decides which days are loaded, zoom how many of them are on
screen at once. Only the day columns scale - the project column and the bars are left alone, since
this is the width of a day and not the browser's zoom. Zoomed out, **the whole of Next 30 days is on
one screen, and that is the floor**: a month to six weeks is what the board is for, so a longer range
- Next 3 months, a wide custom one - scrolls at the narrowest level rather than being squeezed in. The
**header gives way** as the day narrows rather than being cut off (`headerDetail`: `full` from 4rem
with the weekday and the circled date, `compact` from 2.5rem with a weekday letter and a plain date,
`minimal` below that with the date alone and the month named on the 1st). `−` is spent on the
measured width and not the level (`isAtFloor`), because on a 7rem phone several levels land on the
floor; and the line above the board names which of the three states it is in - every day on screen,
days as narrow as their dates read, or more days to the side - so a stopped `−` reads as finished
rather than broken. A zoom keeps the first day on screen, and the level stays put when the range
changes: how closely somebody wants to look is theirs, not a property of the dates. A project is a **row only where it has a shoot inside the loaded range** — the
rows are not the filter's list of projects, which is every project loaded; a range holding nothing
has no rows, and says so rather than offering a nearest day it cannot name. Shoots of a project on the same day or on consecutive days join into one bar
("3 days · 4 shoots"); every bar, one shoot or several, opens its shoots as cards by day, and a
card opens the shoot's production panel — for a viewer holding `PROJECT / Production` and a shoot
whose production is raised (otherwise the card is read-only). In the panel, being named decides:
the Production Manager edits the plan, runs the steps and sees Activity; the Production Coordinator,
the Production Team and the service crew run the steps; anyone else — Project Manager and the
project's other coordinators — reads. Filters: Dates (Next 30 days by default, Next 3 months, This week, This month, Next
month, or Custom From / To up to 92 days — used only once valid, the problem said on the field),
Projects (those in the range; one picked earlier and not in the range is set aside, not applied
silently), **Branches** (a multi-select over the branch each shoot's *project* belongs to - a shoot
holds none of its own, and that is the booking's branch, which is what branch-wise means on every
other board; the branches the range holds, one picked earlier and not in it set aside the same way,
and a shoot whose project has no branch linked offered under **No branch**. Projects and Branches
narrow together), and Clear. **Picking a project or a branch takes the board to it**: the range is
usually wider than the screen, and a selection whose shoots sit further along used to answer with the
empty state and a button to go there - so the board now scrolls to the first day the selection has a
shoot on, and only where none of it is on screen already. Scrolling away from a selection afterwards
is the reader's own, and the empty state is left to say so - that message is for an empty stretch
somebody scrolled into, not for a question they just asked. It is also **silent while the board is
moving**: a long scroll crosses whatever gaps the range has, and a wash appearing and going again on
the way past is a wait-for-it over days the reader is only travelling through, so it waits until the
scroll has settled (`IDLE_MS`). **Neither custom box greys a day out** - To was held to From and to the 92nd
day after it, which made most of the calendar unpickable from a From in the past; the rule is said
on the field instead (`customRangeProblem`) and an invalid pair leaves the board on the range it is
showing.
User based: a shoot is on it when the viewer or anybody reporting to them
(`dataScope.identityFor`) is named on it in any role — Project Manager, Pre Production
Coordinator, Creative Manager, Production Manager, Post Production Coordinator on the project;
Production Coordinator, production team or crew on its production. Branch reach does not widen it.
A Super Admin and `PROJECT / Show All Projects` (Read) see every shoot. Only live shoots of
started projects with a date; a shoot with no date is not shown. The shoots of one
project share a colour (ten, given out in order of appearance in the week) with a legend above. A
card opens the shoot's production panel only when it has a production record and the viewer holds
`PROJECT / Production`; otherwise it is not a button. Read from
`GET /api/project-management/shoot-board/shoots?from&to` (at most 31 days).

Start/Edit Project sections:

- Client Details
- Identification
- Sales Remarks
- Service Creation (shoots, services and deliverables)
- Shedule Payment (the payment plan against the signed quotation) - saved to the project's own
  schedule (`project_payment_schedule`) by Create Project and Start / Edit Project. A payment Accounts
  has worked (money received, a hold, a split) comes back read-only with where it stands.

**Branch Transfer** is the third kind on Accounts → Add Entry, beside Cash Received and Cash Spent:
the studio's own money moving from one branch's account to another's, recorded as one entry. It
names the From Branch and the account the money left, and the To Branch and the account it reached
(each account picked from its own branch), with the amount, date, payment mode, reference, who made
the transfer and proof. It is filed in the From Branch's books (numbered `…-MT-…`), shows under its
own **Transfers** tab with a **To Branch** column, and is neither money received nor spent - no
client, project or category to choose. Recording one needs Cash Management on both branches.

Every cash entry carries a **Source** - Manual, CSV Import or PDF Import - shown as a filterable
column and in its details; entries from before it was kept read "—".

**Accounts Manager → ⋮ → Import** (the cash-book CSV) files each payment against its project: the
**Client Name** column is the project's WhatsApp group name written in full, and the **Event ID**
column says which project when two share a group name (and wins whenever it is filled in). A
received payment whose name matches no project, or several, is not imported - the summary names the
row and the Event IDs to choose from. Branch is only needed for money out against no project; a
payment with a project takes the project's branch and client. Entry Date is read day first.
Transaction ID, Received / Paid From Account and Remarks may be left empty in the file, and so may
an expense's Paid To and Handled By; money received still names who took it, except by Other.

**Accounts Manager → ⋮ → Import from PDF** (`ACCOUNTS / Cash Management` Read / Write) takes up to
ten bank statements and payment receipts at once, each with its own password (never stored). They are
read one by one, so a wrong password or a scanned image fails that file alone - it stays in the list
with the reason under its password box, to be tried again. Every payment received **and spent** that the files
show lands in one table, with its Type, under All / Received / Spent tabs and a status bar - Cash
Received and Cash Spent, each with its total and how many were found, recorded, duplicate and left to
record: **New**, **Duplicate** (a cash entry - or a row earlier in the same batch - has the
same transaction ID / UTR, date, amount and details; all four must match, and a row with no transaction ID
is never one), **Recorded** once filed, and a row per file that gave **No
transactions** (a statement with only money out says so) or **Failed**. A file uploaded before -
recognised by its contents, whatever it is now called - is named in a warning with when and by whom.
Nothing is saved by reading: **Record** on a New row opens the Add Entry form with the kind still
choosable - Cash Received, Cash Spent or Branch Transfer, pre-selected from whether the statement
shows a credit or a debit - so the person recording it marks what the payment was. Cash Spent asks its
shoot, category and paid to, Branch Transfer its two branches and accounts. It is filled in with the
amount, date, payment mode, transaction ID and details, and the person importing picks the project,
the category (Advance, Partial Payment, Extras, Final Settlement, Advance Settlement) and the rest
exactly as for Add Entry, with the client's receipt offered after. Closing with New rows left asks
first. Bank-specific formats are not known by name; columns are found by their headings, or - where a
bank draws its headings as pictures, as SBI does - by whether the running balance went up or down
on each row, or - on a payment-app statement with no balance - by each row's +/- or Credit / Debit.
Where a statement prints its Total Credits, the payments found are added up against it: a match is
said under the table, a difference is a red warning to check the PDF before recording. Every row is
checked in the form before it is saved.

**Approving a payment request and paying it are two steps, held by two people** (2026-11-03). They
were one: the approval form asked how the money moved, wrote the cash entries and - for a salary
advance - the payroll row that recovers it, all in the act of saying yes. So nobody could authorise a
spend without also releasing it, and a request only ever reached the cash book once it was too late
to question. Now **Payment Requests** (`ACCOUNTS / Payment Request` Read / Write) is where a
request is approved or rejected, and approving asks for an optional remark and writes the decision
and nothing else. The request then appears under **Accounts Manager → Pending**, last of that
screen's tabs, where ⋮ → **Record Payment** opens the old approval form and releases the money. That
route names its own two permissions and is mounted **above** the router-wide guard: `ACCOUNTS / Cash
Management` **Read / Write**, because what it writes is cash entries, and only **Read** on `Payment
Request Approval`, because the queue it is reached from is that permission's list. Under the
router-wide guard it would have asked Read / Write on Approval as well - the approver's level - and
the separation would have run one way only, with the cash book's keeper locked out of the one step
that is theirs. That is also where a salary advance becomes its Advance Salary row,
since nothing is owed back until the money has actually been handed over; every other kind of request
ends at the cash entries. **Paid is not a fourth status**: it is whether the request has live cash
entries, read on the row as `paid` / `paymentStatus` ("Awaiting Payment" or "Paid", and blank on a
request nobody has approved, since a pending one awaits a decision rather than a payment; a column on
the Payment Requests table) and askable as `?paid=yes|no`, which is how the Pending tab asks for
approved and unpaid. A request already paid cannot be paid again - checked before the transaction for
the message that names the entries, and again behind a `SELECT … FOR UPDATE` on the request row,
which is what stops two people releasing the same request at the same moment. That lock has to stay
the transaction's first statement: under REPEATABLE READ the snapshot is taken by the first
non-locking read, so a plain read placed above it would pin a stale one and bring the double payment
back. The status is re-read behind the lock too, and a salary advance whose entries were deleted -
which makes the request payable again - is refused with a sentence naming its Advance Salary row
rather than with the unique constraint on it. The tab exists only for a reader
who holds `Payment Request` Read, since that is what the list answers for.

**Accounts Manager's Due / Overdue / On Hold tabs** (its own `ACCOUNTS / Cash Management`) list the
saved payments the projects in reach are still owed, after All / Received / Spent. Once the receipts
linked to a payment reach what it comes to (its share of the signed quotation, or the fixed amount a
split left) it leaves the tabs - it is then only its cash entry under Received. A payment is **On Hold** when held with remarks (never Due or Overdue while held); **Overdue** past
its date; **Due** within five days of it, or - the rest of a part payment - from the moment it is
split off; otherwise **Active** (on no tab). The project's Accounts status is Hold, Overdue or Due from
its payments, and Active otherwise. On **Due** and **Overdue** a project owing several payments
there is one row - "N payments", the earliest due date, the amounts summed - opened with its chevron
to show each payment, each with its own ⋮; the project row has no ⋮, and the CSV lists the payments
(`groupPaymentsByProject`). On Hold stays one row per payment. The cash entries under **All**, **Received** and **Spent** are grouped
the same way, by Event ID (`groupCashEntriesByProject`): a project with several entries is one row -
led by its Event ID and the count ("DBS-EVT-0001 · 3 entries"), the
types it holds, its latest date, and the total (the net, received less spent, where they mix) - with
each entry under it keeping its own ⋮ and tick box; the project row's box ticks or clears every entry
under it (part-ticked when some are), "select all" takes every entry in, and an entry on no project
stays its own row (DataTable `selection.subRows`). Transfers is unchanged. A double click reads one in the usual read-only view, as a cash entry is read - its project (Event ID,
client, number, branch) and what is due (category, due date, due amount, remarks, any hold remarks);
the row's ⋮ offers View (the same read) and Record, which opens it to work - a Status: **Clear** opens Cash Received with the project and the whole pending
amount filled in, and the receipt is linked to it; **Partially paid** asks the Paid Amount, shows the
Pending Amount and needs the pending amount's due date, then records the paid amount the same way -
the rest becomes a payment of its own; **On Hold** asks remarks and shows "On Hold (Accounts)" beside
the project's name everywhere. Working a payment needs Cash Management at Read / Write. Every
panel title on the project also reads "Overdue (Accounts)" or "Due (Accounts)" while a payment it is
owed is - Overdue when it has both (`projectPaymentsDue`).

Money received against a project can settle one of these payments wherever it is recorded, not only
from the Due tabs. On **Add Entry**, the project's **Payments** tab and **Import from PDF**, choosing the
project shows **Settles Payment** - its payments still open, oldest first ("Advance · ₹30,000 pending ·
Overdue · due 29 Oct 2026") - and None by default, which records the money as before, settling
nothing. Choosing one asks **Full payment** (the amount is filled in with what is pending and held
there; the payment reads Cleared, as Clear does) or **Partial payment** (**Amount Paid Now** and
**Amount to Pay Later**, which add up to what is pending, and a **Balance Due Date** today or later; the rest becomes a payment of its own, as Partially paid
does). The booking form's Payment Received offers the schedule being booked the same way, with its first
payment already chosen (None can still be picked), so an advance taken at booking clears or
part-pays its payment instead of leaving it to turn Overdue. The
CSV import takes the same answer as two optional columns, **Scheduled Payment** (the category, e.g.
Advance) and **Balance Due Date** (filled: partial). A receipt that settled a payment keeps its amount
and project on edit; deleting it reopens the payment.

Double-clicking a project row opens the read-only record view instead, which has two tabs:

- Details — everything the record holds, section by section.
- Payments — the project's Accounts status (Hold, Overdue, Due or Active), then cash received and cash spent against the project, with
  the payment summary. The
  entries are Accounts' own cash entries; each list has an Add button that opens Accounts' entry
  form with this project already filled in. Shown only to somebody holding both `PROJECT / Projects`
  and `ACCOUNTS / Cash Management`, and the Add buttons only with write on the latter.
  A cash entry has no branch field: its branch is the Source Branch of the project it is filed
  against, so money in must name a project and money out one of that project's shoots. The advance
  taken at booking is recorded on Create Project's own Payment Received section instead.
  **Money received through a mode that carries a remark is not asked who received it** — "Other" out
  of the box, set per mode in Settings → Field Settings → Accounts → Payment Mode. There the remark
  says what the payment actually was and the person filing it is the person it happened to, so the
  Receiver box repeated what the login already says, on the form that books a project; nothing is
  stored in its place, the answer being unknown rather than guessed at. **Every other mode is
  untouched**: money received by cash, UPI or a transfer still names who took it, and money out
  always names who paid it. The column that reads it keeps the name **Received / Paid By**, because
  the entries filed before this carry a receiver and a heading of "Paid By" over one of those would
  say they paid the studio rather than took from it. Two consequences, both limited to an
  "Other"-mode receipt: `handlerEmployeeId` is one of the columns `dataScope` narrows the cash book
  by, so such an entry is reached through whoever created it, and their managers, rather than through
  a receiver it does not name — the same person in practice, since the one who files a receipt is the
  one taking the money — and a report grouped by it shows nothing for them. Branch reach does not
  widen it, this module declaring owner columns. Entries already filed keep their receiver and an
  edit cannot erase it: the save leaves that column untouched rather than writing a blank over it,
  which is also what keeps a receiver when a mode is changed to Other afterwards. An approved payment
  request that returns money to the studio still records who took it: a receiver is not insisted on,
  not discarded. **The payment mode's own box is Remarks**, required for any mode the studio marked as
  asking for one ("Other" out of the box) — the same box that was called Payment Mode Details, since
  that is what it always was: a remark about the *mode*. The entry's **Description** is the separate,
  optional note about the payment as a whole. The import column is headed Remarks and still reads a
  file saved under the old heading.

Shoot rules:

- Shoot ID is backend-generated as `DBS-SID-DD-ERD-000001`: the shoot's project's vertical and
  branch, counted per vertical alongside every other identifier the studio hands out.
- Save to Draft does not change status, and saves whatever has been typed so far — a draft is
  allowed to be half answered, and the panel autosaves into it as the form is filled in.
- A project's status is one of five: Yet to Start, In Progress, Completed, On Hold, Rejected - the
  only ones bulk Update, Start Project and an import may give. Projects saved before 14 Oct 2026 keep
  an older status (Work in Progress - Pre & Production / Post Production, Delivered, Cancelled &
  Refunded, Client not Turned, Duplicated, Date Elapsed), unchanged, and are listed under All only;
  Work in Progress still counts as In Progress and Delivered as Completed for colours, badges,
  Overall Feedback, Image Selection and handover.
- Start Project changes status to `In Progress`, and is the point the
  required answers are held to. Project Setup must carry Welcome Gift, Shoot Completed Gift (each
  with the employee taking care of it where it is applicable), Project Validity (In Months),
  Storage Needed and CRD Document before the project starts; the form marks each outstanding field
  "Required" the way Add Employee does, and `PATCH /projects/:id/start-project` refuses the same
  shapes so the screen is not the only thing enforcing them.
- CRD Document is pre-selected as **Applicable**. CRD Documents lists the projects whose answer is
  set and is not "Not Applicable", each with its own **Send Link** — and that is now the only route
  to a document. The Create CRD Document button is gone: a CRD is asked *of a project*, and a
  document belonging to none had no Event ID, no Enquiry ID and nothing to attach the client's
  answers back to. Documents already raised that way are still listed and still readable.
- **Create Link, then CRD Link Ready.** A row whose link has not gone out offers **Create Link**:
  issuing the link marks the document Sent, so the row moves to **Yet To Receive** at once, and
  **CRD Link Ready** opens with the link written as the message in the studio's **CRD Document
  Link** template (Settings → Message Templates; `{client name}`, `{event id}`, `{crd link}`).
  It offers **Copy message**, **Send WhatsApp** - which posts the message into the project's own
  WhatsApp group from the sender's paired WhatsApp: the group linked on Pre Production → General,
  else Image Selection's for the sale, else the one group in their WhatsApp named like the project
  and held by no other project (archived ones included); the group is named on the button before
  anything is sent, and a name match is not written back - linking stays Pre Production's and
  Image Selection's - and **Done**, which closes. A row already sent offers **Send
  Link**, the same dialog, to send it again. A document raised before its project exists has no
  group, so its Send WhatsApp says so and Copy is the way.
- A document raised by hand is raised against an Enquiry ID rather than a project, so a project with
  no Enquiry ID cannot be given one — the Enquiry ID is what the client's form prefills from, and
  how the document finds its project later. If that project is then started as "Applicable", Send
  Link on its new row adopts the document already raised for its enquiry rather than issuing a
  second: the client keeps the link they are already filling in.
- **The client's form: Event Details is the studio's half, and it is read-only.** The group name, the
  event type, who referred them, the point of contact, and when and where the event is are all
  prefilled from the project and the lead it came from, and the client is shown them to check rather
  than asked them — this document is where somebody identifies *themselves*. What they fill in is
  Groom Details, Bride Details, the reference photos and links, and the terms. Every field there is
  drawn as a value rather than as a control that refuses: one grey, no chevron over a list that
  cannot open, and the values still selectable so a number or a maps link can be copied. Nothing
  above them explains that — the greyed boxes say it, and the section says what they are.
- The event moved with it. Event Start, Event End, Event Address Link and "what else can we help you
  with" were asked of the groom **and** of the bride — two answers to each of four questions about
  one wedding, with nothing on the document to say which was right. They are asked once, under Event
  Details, after the point of contact and with no heading of their own. Documents saved under the old
  shape keep their answers: they are read up onto the common block on the next read.
- **Every shoot is its own event.** The client's CRD form - Dum Dum and Qua Qua alike - asks one event
  per shoot of the project (five shoots, five events), each titled by its shoot with its own Date,
  Start Time and End Time - three fields, as the shoot keeps them - and Event Address Link (`crd-documents/events.js`, stored on `common.events` for Dum Dum and on
  `events` for Qua Qua). The list is rebuilt from the project's live shoots on every read, in date
  order: the shoot's date and start/end times fill in where the client has not answered, the client's
  answers stay with their shoot (`shootRef`), a shoot added later gains an event and a deleted one
  loses it. None is required. A document from before - or one with no shoots behind it - keeps its one
  event on the common block; its end and venue seed the main shoot's event the first time the list is
  built. The studio's read-back (CRD Documents → View, Overall Status → View) lists each event.
- **Nothing in Event Details blocks submission.** A field the form will not let anybody type in
  cannot be one that holds the document up: Point of Contact Name is prefilled from the lead's
  primary decision maker or company name, both routinely blank on a wedding lead, and required and
  unfillable it would have stranded the document with no screen anywhere able to fix it. What the
  client must answer is both sides in full and the terms — which is everything the document exists
  to collect.
- Project/shoot data must remain project-scoped.

### Production

Built for the phone first: the board is the same table on every screen, a shoot opens full-screen on a
phone rather than as a side pane, the active tab's primary action - Submit plan / Save changes on Plan,
the current step's action on Execution - sits in the panel's footer beside Close, and a photo that fails to upload stays on the phone with Retry rather than being lost
to a dropped network.

- **Board columns:** Event ID, Client Name, Shoot ID, Shoot, Shoot Date, Production Manager,
  Production Coordinator, Pending, Actions. The **Pending** pill names what the row is waiting on —
  the plan, or the coordinator's next step — so a manager or coordinator can tell what to do next
  without opening the row.
- The board's tabs say where each shoot stands, with a count: **All**, **Plan pending** (not
  submitted), **Not started** (submitted, no step done), **In progress**, **On hold** and **Paused**
  (the shoot status the coordinator set; a Rejected shoot reads In progress) and **Completed** (every
  step done) - `boardStatus` in `production/steps.js`, one answer per shoot.
- Every step takes remarks: required on Pineapple meeting and File in, optional on Started to shoot,
  Reached venue, Shoot started, Happening now and Happy clients (each kept on its step). Pausing the
  shoot and starting it again ask for theirs too, kept on the shoot rather than on a step.
- On a phone the Execution tab's steps are a row of numbered circles (✓ once done), scrolling
  sideways; from md up they are a list beside the step.
- On the Execution tab, whether a step's WhatsApp message went - and its Retry - is shown only to
  the project's Production Manager and a Super Admin; the coordinator and the team see the steps.
- A shoot opens to three tabs: **Plan** (the Production Manager's per-shoot answers — coordinator,
  travel mode (Bus, Train and Flight also ask a **Ticket Status** - Yet to Take, Taken or On the Fly;
  Taken opens the Tickets upload and needs one for the plan to be complete, On the Fly needs none,
  Yet to Take keeps it short; `project_production.ticket_status`, NULL on plans saved before it was
  asked, which read as before), tickets, the **Studio Start Date and Time** - when the crew leaves
  the studio, outdoor shoots only, mandatory as Travel Mode is: counted in the plan's progress and
  needed to submit it (`project_production.studio_start_date` / `_time`, moved
  from pre production, whose old answers were copied over and are carried once onto a production
  raised later; the Pre Production import still reads the two columns and writes them here) -
  remarks, and **Services**; there is no Production Team field: a shoot's team is
  its coordinator plus whoever works each service, and a team named on an older plan or the imported
  sheet stays on record, still runs the steps, and is no longer edited — — sent with one button, **Submit plan**, and
  afterwards **Save changes**; there is no draft). Services lists each service Edit Project booked on the shoot with who works it: a
  person (needed to submit) with, where that person is an **employee**, **Cameras** - a multi-select
  of Asset Management's Cameras, so a seat may carry several bodies
  (`project_production_service_crew_camera`, one row per camera). A camera goes to one service of the
  shoot, though other shoots can use it - including another shoot on the same day, which is not
  checked. Where the person is a **vendor** the cameras are not asked at all and the seat asks where they
  stand instead: **Waiting** until they confirm the shoot, **Confirmed** once they have
  (`project_production_service_crew.vendor_status`, Waiting on the vendor being chosen). A service
  whose vendor is still Waiting is **not planned**, so the shoot stays Work in Progress until every
  vendor on it has confirmed. An assistant has neither. And, on a service whose
  name contains "Candid", Assistant 1 and Assistant 2 (no cameras). A person is an employee or an
  **any active vendor**, listed after the employees as "EXT-name (business registration name, city)" (only an inactive vendor is
  refused; one already on a service stays, however their record reads now). The vendor's **Can be a
  production team member?** tick is what their record says about them and no longer narrows the list -
  it kept a vendor the studio had just hired out of it until somebody went and ticked them. Kept per service definition in
  `project_production_service_crew`, so Edit Project re-saving the shoot's services does not lose
  it. A service's person and assistant lists offer only shooters - employees holding a shooting skill
  (Candid Photographer, Candid Videographer, Drone, Indoor Shoot, Outdoor Shoot, Photography,
  Traditional Videographer, Traditional Photographer, linked on their profile) - and the vendors, and
  leave out employees already on another shoot's crew
  at an overlapping **time** (never just the same day: a shoot ending at 1:00 am leaves its crew free
  for one at 7:00 pm; back-to-back is free; a shoot without both a start and an end time clashes with
  nothing). **A camera is busy the same way**: one carried on another shoot at an overlapping time is
  left out of the Cameras list, since a camera is one object and cannot be in two places at once.
  Whatever is already chosen stays, and the server refuses a busy person or camera newly named. The
  Coordinator list is not filtered. **Execution** (opens three days before the shoot, once the plan is submitted - before that it says the date it opens on, and the server refuses a step or a step's photo the same way; a shoot with no date opens on its plan, one already begun stays open; the shoot's seven steps, worked strictly in
  order, each logged with who and when), and **Activity** (every action on the shoot, newest first).
- **File in** (the last step) asks for each booked service's footage - link, who backed it up, number
  of files, size, first and last file name, optional remarks. **Complete photo copy** wants every
  service of the shoot, and pressed with gaps it marks them **Required** rather than sitting disabled;
  **Mark as pending**, shown only while something is still missing, keeps the services already filled
  in and leaves the step where it is, so a shoot's cards can be copied in over hours without the
  answers being held on paper. What is saved is the card as it was left - every answer typed written,
  an empty box written as empty (the five answers are nullable, `20261024150000_footage_answers_
  nullable`) - so reopening shows exactly what was there and a box cleared stays cleared; a service
  emptied out altogether has its answer removed. Completing the step is what holds the record to
  being whole, so a part-filled row is held but never read as a finished one. Saved by the step's own
  people, under a lock that refuses a save once the step has moved on, logged as **File in saved**.
- **Travel** is the Production Manager's, on the plan - and asked only of an **outdoor** shoot: a
  Studio / In-House one happens where the crew already is, so the section is left off its plan
  entirely. Bus, Train, Flight, Own, Car, Office
  Vehicle or Other, each asking only its own detail — Bus / Train / Flight take **tickets**, Own /
  Car a **vehicle number plate** (stored upper-case), Office Vehicle a **vehicle picked from Asset
  Management's vehicle categories** (a searchable list showing name and code), Other a line saying
  how. **Only the mode is mandatory** - none of that detail is asked for before the plan is
  submitted, since the crew often knows how they are going before they know whose car. Changing the
  mode clears the detail that no longer applies; tickets already added are never deleted by it —
  they stay under **From the earlier travel mode**, still downloadable, and removable by whoever
  edits the plan, but new tickets are accepted only while the mode is Bus, Train or Flight — picking
  it is enough, without saving the plan first: the ticket upload itself carries the mode and the
  server sets it on the plan. A
  vehicle retired from Asset Management after it was planned stays on the plan. The coordinator and
  every other viewer see the travel read-only on the Plan tab. Pre production's earlier answer
  (mode, "Other" words, office vehicle) is carried over once when the production record is raised.
- **Who may do what:** the Production Manager named on the project
  (`SalesProject.productionManagerEmployeeId`) edits the Plan tab; the Production Coordinator named
  on that plan
  (`ProjectProduction.productionCoordinatorEmployeeId`), the plan's Production Team and the employees
  given one of its services work the Execution tab, and so may the Production Manager - whoever
  completes the current step first completes it for everyone (same photo and remark checks, the
  activity log names who did it). They need `PROJECT / Production` at Read / Write to do it; a Super Admin edits both, and so does whoever holds
  `PROJECT / Show All Projects` at Read / Write (at Read it shows every shoot on the board). The
  Activity tab, like the WhatsApp status, is for those same people only — the coordinator does not
  see it, and its endpoint refuses them. Everyone else with `PROJECT / Production` read reaches the board and a shoot's tabs to look.
  Three steps post to the project's WhatsApp group (linked on Pre Production → General) from
  whoever linked it, on their own WhatsApp — Started to shoot, Reached venue, and Shoot
  status once it is set to Completed; a failed send is recorded and never blocks the step.

## Sale Extras (Edit Sale Details)

After a finalized quotation is pushed into a project, every shoot, service or deliverable added,
removed, or re-scoped (quantity, duration, size, variant, number of photos) is recorded as an Extra in
Edit Sale Details' **EXTRA – ADDITIONAL & REMOVED ITEMS**, above Shedule Payment.

- **Baseline.** The rows the quotation laid down at booking (or the plan as it stood when a quotation
  was linked later; for projects booked before this feature, their plan at that time).
- **Recorded from any screen**, by comparing the project's rows with the baseline and what has been
  published - not by watching each save. Every shoot, service and deliverable is a line of its own
  with its own amount - a new shoot's services and deliverables, and what was removed with a shoot,
  too - so nothing is counted twice. Undoing a change before publishing removes its line. Shoot date,
  time and venue changes are not extras.
- **A Removed line's value.** It says where the item came from and starts at the value it stood at:
  **From the quotation** - the quotation line's unit price x quantity, ₹0 if the line was complimentary,
  before the quotation's overall discount - or **Added as an extra** - the amount it was published at,
  with any corrections. The Amount stays editable until publishing. An extra never published simply
  disappears when removed.
- **Extra Quotation items.** What an approved raised request put on the plan (its shoot, services,
  deliverables) is listed under **Added** in its shoot as "Extra quotation EXT-… · already counted in
  Payments" - read only, its amount the one approved, never priced or counted here - and **Updated
  Total** includes the approved extra quotations so it matches Payments. Removed, such an item is a
  Removed line "From extra quotation EXT-…", starting at its approved amount, with Add back. The
  client's quotation link and PDF list the same items under Added Items (an extra quotation raised by
  hand by its name, category "Extra"), with no prices, and the Updated Total Amount there counts the
  approved extra quotations; pending ones are neither listed nor counted.
- **Each item once.** The section and the client's quotation list a shoot, service or deliverable once,
  at its latest change - under Added while it is on, under Removed while it is off - however often it
  was removed and added back; every change stays recorded and counted in the totals. Unpublished lines
  always show.
- **Remove and Add back, as often as needed.** The newest line about each service or deliverable has a
  ⋮ - **Remove** while the item is on its shoot, **Add back** while it is off; older lines about it have
  none. Add back returns the same row to Service Creation (a quoted service with its post-production
  work and the deliverables it brings). While the removal is unpublished nothing is left: a quoted item
  is back as quoted, an extra at the amount it was added at. After a published removal it comes back as
  an addition ("Added back after its removal was published"), starting at what the removal took off.
  Remove takes the item off as Service Creation does; an addition never published simply goes. Picking a
  removed quoted item again in Service Creation also counts as putting it back, however much later. Both
  ask for PROJECT / Projects (or Show All Projects) Read / Write, as Service Creation's changes do.
- **The section.** Two headings, **Added** (additions and changed lines) then **Removed**, each with
  its count; under each, a card per shoot it happened on, drawn like Service Creation's shoot card
  (blue border, the shoot name, then "Shoot ID | date | place"; "Extra Shoot" / "Removed shoot" beside
  the name) holding a table of only that shoot's lines in that group - nothing that stands as quoted -
  each line with its category, date, amount and remarks in boxes, published or not. A heading with
  nothing under it says "Nothing added / removed since booking". No revisions table. The totals sit first, held under the section title
  while the cards scroll and leaving with the section; Publish is at the end. The
  publish review lists added, removed and changed items apart. On the client's page each shoot's items
  are listed together, the shoot first.
- **Manual prices.** The studio types every amount in the row (required; before GST, no discount;
  ₹0 is an amount, an empty box blocks publishing); additions positive, removals typed as the reduction
  and stored negative. There is no Save Changes: nothing is kept until **Publish Updated Quotation**,
  which is open whenever something changed and sends every box in one all-or-nothing transaction; the
  client's link is unchanged until then, and there is no Draft wording. Closing or saving Edit Sale
  Details, or leaving the page, with typed amounts asks first. While Publish is open, Update Project
  is held - the button and Enter alike - until the changes are published (or undone). A published line is never edited:
  changing its amount publishes a correction line for the difference; its remarks are internal and
  kept on the row.
- **Publish Updated Quotation** freezes an immutable revision (R1, R2 ...); the client's same
  quotation link (and its PDF) then shows the original pricing card unchanged, an Extra section with
  Added Items and Removed Items (item, category, related shoot, the date it happened; every published
  line once, so an extra added then removed is in both; changed lines under Added with what changed)
  and no prices, then an Updated Total Amount card with the total, the GST line where General
  Settings shows it on the quotation, and "Updated <date>" - never the revision number or the net.
  The Event cards are the original quotation's. Nothing is sent to the client.
- **Money.** Published extras count once toward the outstanding balance, receipts and Total Signed;
  the payment schedule, receipts and payments are never changed; the original quotation is never
  written, and a quotation carrying a revision cannot be unfinalized or swapped.
- Projects without a finalized quotation are not tracked. The separate Extra Quotations (EXT-) are
  unchanged. Who prices and publishes: whoever may save Edit Sale Details.

## Raised Requests (Client Management → Client Requests)

Client Requests has two views, chosen by the switch in its header and remembered per person: **From
Client App** (what clients send from their app, unchanged) and **Raised Requests** - what the studio
itself asks for on a booked project. **Raise Request** (Client Requests Read / Write) walks four steps:
the type (**Shoot**, **Services**, **Deliverables** or **Other**), the project (searched by Event ID,
client name or number, only the projects the person reaches), the details, and a last look.

- **Shoot** - a new shoot with Create Project's own Add Shoot dialog and service / deliverable pickers
  (configuration and quantities as there). **Services** / **Deliverables** - one of the project's
  existing shoots and the lines for it; what the shoot already has is listed and cannot be asked again.
  **Other** - a correction: its category (Album, Photo, Video, Client information, Project detail, Other),
  an optional shoot, what to correct, and up to five reference pictures.
- Raising carries **no price** and writes **nothing** to the project: the request is **Waiting**
  (CRQ-000001), one item per thing asked - the shoot itself is an item of a Shoot request.
- Whoever holds **CLIENT / Request Approval** (granted to Super Admin only by the migration) reviews it
  item by item: approve at an amount (₹0 is complimentary) and quantity, or reject with a reason; the
  approved total updates as they type. **Save Progress** keeps the review (**In progress**); **Ask** sends
  the requester a question, which they answer on the request. **Submit Decision** needs every item
  decided, and a rejected shoot takes its services and deliverables with it.
- The decision, once and in one transaction: the approved shoot, services and deliverables are added to
  the project (never a rejected one, never one the shoot already has - that refuses the decision); the
  approved total is recorded as **one approved Extra Quotation**, so it counts on the project's Payments
  once (the rows added are Sale Extras baseline and are not priced there again; the payment schedule is not
  rewritten); an approved correction becomes an **HRM task for the project's Project Manager** (the reviewer,
  where the project has no Project Manager who signs in). The request is **Accepted**, **Partially accepted**
  or **Declined**, and reads only from then on.
- Approvers who reach the project are told when a request is raised; the requester is told of the decision
  and of a question. Every step - raised, each item's decision with what it was before, questions, what
  the decision created - is kept in the request's Activity.

## Database and ID Rules

Business IDs are backend-generated:

| Entity | Business ID format |
| --- | --- |
| Employee | `DBS-1` |
| Booking / Project (one record) | `DBS-BK-DD-ERD-000001` |
| Shoot | `DBS-SID-DD-ERD-000001` |
| Task | `DBS-TK-00001` — no vertical and no branch: a task names both in its own columns, and work crosses either line often enough that an id carrying them would date the first time a task moved |

Every other module's identifier follows the same shape; the whole set is in
[backend/README.md](../../backend/README.md#identifiers-one-shape-one-counter).

Rules:

- Frontend preview is allowed, but the backend is the final authority.
- Do not expose internal database IDs where business IDs exist.
- **An Interview candidate is deleted outright, not hidden.** It was a soft delete, which cost the
  register twice: the table kept a row for every deletion ever made, and a linked sheet went on
  recognising those hidden rows by phone and email and refusing to re-import people nobody could
  see. The row is removed now, with the candidate's screening-form invites, the same way a CRM lead
  is. The consequence is the CRM's own: a deleted candidate is held out by the **sheet ledger
  alone**, so re-sorting a sheet that carries no id column of its own can bring one back.

- **The Interview register is read a page at a time** — 100, the CRM lead board's size, appended on
  scroll, with the stage applied by the server rather than filtered in the browser. Tab counts are
  one grouped query over the whole register, so they describe the stage and not the page. Paging
  orders on `created_at` *and* `id`: a sync writes thousands of rows sharing a timestamp to the
  millisecond, and without the tiebreak a row repeats between pages while another never arrives.

- **A linked sheet only ever adds.** The Google Sheets poller runs every 2 minutes, re-reads the
  whole sheet each pass, and writes **only rows it has never successfully written before**. A row
  whose record is already here is skipped, not refreshed. The sheet is where a lead or a candidate
  *arrives*; once the record exists it is worked on in the app, and the sync used to overwrite that
  from the spreadsheet every two minutes — a status set, an interviewer put on, a number corrected
  and a remark written were all silently undone on the next pass, and the record read as though
  nobody had touched it. The three cases the pass distinguishes:

  | Row | What the sync does | Counted as |
  | --- | --- | --- |
  | No record here, never imported | **Created** | `created` |
  | Record already here | **Left exactly as it is** | `skippedExisting` |
  | Imported before, record since deleted | **Left deleted** | `skippedDeleted` |
  | Rejected (bad name, email, phone or date) or failed to write | Not written, and **retried next pass** | `skippedInvalid` / `failed` |

  Nothing is dropped quietly: every row a pass declined is counted and named in the sync summary,
  so a sheet whose rows are all already here reads as that rather than as a sync that did nothing.
  Because a pass can no longer update, it can no longer back-fill an owner either — only a created
  row spends an assignment-rule share.

- **A sheet does not overrule a deletion**, and there are two locks on it rather than one.
  `sales_google_sheet_row` (and `hrm_interview_google_sheet_row`) remembers every row ever imported
  whether or not its record survives — but it keys a row by its source id, which for a sheet with no
  id column of its own is *its row number*. Insert a row near the top of the spreadsheet and every
  row below shifts onto a key the ledger has never seen, and the deleted record walks back in. So
  the deleted records are asked directly as well, on the same identities the classifier matches live
  ones by — source row id, phone, email — which recognises the person wherever their row has moved
  to. Either lock is enough. If either cannot be read, the pass withholds **every** new row rather
  than risk refilling a board just cleared: adding nothing is recoverable next pass, that is not.
  To bring a deleted record back, delete the link — which takes its ledger with it and re-imports
  the sheet whole — or add it in the app.
- **One number is one enquiry within a vertical, on every path.** A second lead on a number the
  vertical already holds is the same client written down twice: their calls, remarks and follow-ups
  split across two records that neither knows about, and nothing on either screen saying so. Across
  verticals it is allowed and is not a mistake — a wedding client who later books a corporate shoot
  is one number and two enquiries on purpose. The rule was enforced only on the Add Lead form and
  the edit; **Bulk Entry, the CSV import and the Google Sheet sync never asked**, which is how a
  sheet lead and a hand-typed lead ended up sharing a number. Now:

  | Path | What it does with a number the vertical already holds |
  | --- | --- |
  | Add Lead | Refused, 409 `DUPLICATE_PHONE_IN_VERTICAL`, naming the enquiry that holds it |
  | Edit a lead | Refused **only if the write changes the number** — a lead keeps its own without being stopped |
  | Bulk Entry | The batch is refused and **every** offending row named — the number itself, on the row, in the message and in the phone box, cleared as soon as that row is edited; the batch is checked against itself too |
  | CSV Import | Those rows are skipped and counted under *Already on this number*, apart from the blank rows |
  | Sheet sync | Held back, and the summary names how many were matched on number or email. Matched on **both** number columns, so a lead typed in by hand is recognised whether its number sits in `phone` or `contact_number` |

  Editing guards the *change* rather than the number, deliberately: the three unguarded paths have
  already written pairs of leads sharing a number, and refusing an unchanged number would make every
  one of those pairs impossible to open and correct — which is the only action that resolves them.

- **A linked sheet assigns its own leads.** A spreadsheet says who a lead is and almost never says
  whose lead it is, so every imported lead arrived with an empty CRM column and somebody assigned
  them by reading a column the sheet does carry — the page, the form, the city — and picking a name
  per lead. A link now carries an ordered list of rules (`sales_google_sheet_assignment_rule`):
  a **column**, the **value** to look for in it, and the **employee** whose lead it is when the two
  meet. One column matching one value and nothing else — no operators and no catch-all; matching
  ignores case, spacing and punctuation but the value is matched whole, and two values going to one
  person is two rules. Written in the same dialog that
  links the sheet, because creating a link imports the whole sheet immediately — rules added
  afterwards would miss that first batch, which is always the largest. The **first matching rule
  wins** and evaluation stops, so two rules matching one row is a question the studio answers by
  ordering them rather than an error to report.

  Three things about how they interact with everything else, each of which is the behaviour rather
  than an implementation detail:

  - **Rules fill blanks; they do not overrule people.** The owner is the sheet's own CRM column
    first, then the owner the lead already has, then the rules. The poller re-reads every row every
    2 minutes, so a rule allowed ahead of the existing owner would undo a manager's reassignment
    within the minute.
  - **The initial import and the auto-sync assign identically**, because there is one code path:
    the rules are read from the link's id inside `prepareGoogleSheetCrmImport`, not carried on the
    link object that three separate hand-written queries build.
  - **Rules match the sheet's own headings**, not the CRM fields the importer maps them to. The
    columns a studio routes by — Page Name, Form Name, Team — are exactly the ones the importer has
    no field for and which arrive in `unmappedHeaders`.

  A rule naming a column the sheet no longer has is **reported, not silently dropped**: the import
  preview warns, and the sync summary counts `assignedByRule` and `unassignedRows`. Without that, a
  renamed column looks identical to having written no rules at all. Editing a link's rules does not
  re-assign leads already imported — a rule change is not a bulk reassignment.
- Use soft delete for important business records — **except a CRM lead, which is deleted outright.**
  Stamping `deleted_at` and leaving the row is not what the studio reads "delete" as: a dev database
  that had had its imports cleared out was holding 92,452 hidden rows against 20,094 live ones.
  `purgeLeads` takes the lead's own rows with it (activity, occasions, Watchers, meetings),
  **unlinks** its calls and transcripts so they return to the Calls board rather than disappearing,
  and **refuses** any lead carrying a project, quotation or CRD document — those would be left naming
  an enquiry that no longer exists. A refused lead is named in the reply, not quietly skipped.
- Do not manually edit MySQL schema.
- Use Prisma migrations for all schema changes.
- Keep Prisma Client generated after schema changes.
- Preserve existing data and history unless explicit cleanup is requested.

## Troubleshooting

If the frontend opens but no data loads:

- Check the backend terminal.
- Confirm backend is running on `http://localhost:5001`.
- Confirm `frontend/.env.local` has `NEXT_PUBLIC_API_URL=http://localhost:5001`.

If Prisma cannot reach `127.0.0.1:3307`:

- Local MySQL is not running on the configured port.
- Start MySQL or update `backend/.env` to match the local MySQL host, port, database, and credentials.

If login fails:

- Check backend logs.
- Confirm the API URL.
- Confirm the database exists.
- Confirm migrations have run.
- Confirm seed has run.
- Check the `User` table.

If Add Employee fails:

- Check the browser Network response.
- Confirm `employeeId` is not required from the frontend create payload.
- Confirm backend validation and database constraints match the documented backend-generated ID rule.

## Deferred Work

- Full RBAC.
- Complete Image Selection workflow.
- CRM module.
- Quotation module.
- Salary.
- Asset management.
- Inventory.
- Accounts.
- Detailed pre-production execution beyond the coordinator's board (crew scheduling, vendor booking).
- Moving the project's status automatically when production finishes; reusing the Image Selection
  group link for production.
- Detailed post-production execution.
- Drop `project_pre_production.production_coordinator` / `production_coordinator_employee_id`
  (deprecated; carried into the production plan) in a migration of its own once every eligible
  shoot has its production row.
- Desktop app and mobile app.
- Audit logging and security hardening.
- More complete technical workflow.
- More complete reporting and analytics.

## AI Agent Rules

- Read this `PROJECT-STATE.md` first.
- Read [README.md](../../README.md) next.
- Do not change the stack or architecture without approval.
- Do not touch WhatsApp automation unless explicitly instructed.
- Do not commit secrets.
- Work one feature at a time.
- Preserve UI, table, and form standards.
- Preserve backend-generated ID rules.
- Preserve soft delete rules for important business records.
- Do not expose production secrets.
- Do not change app code, database schema, env files, deployment config, or WhatsApp automation during documentation-only tasks.
- Run the relevant checks before saying done.
- Do not deploy to the VPS unless explicitly instructed.
