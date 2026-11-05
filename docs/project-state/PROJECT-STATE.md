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
  onboarding invite and the login credentials as well as this one. **Approve & Next** moves on to Login Credentials.
  Only Approve & Next is a primary button. Closing this page or the Login Credentials page with
  unsaved work asks *Save draft* / *Discard* / *Keep editing* rather than discarding it — and on
  Login Credentials, Save Draft keeps the whole half-made account (username, login email, roles,
  branch, alternatives, leave approvers, permission approver) until **Create User & Send Email**
  is actually pressed.
- **Edit Employee carries the Login Credentials page too**, on the same two-page rail, so an account
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
  **Login Credentials** drops the requirement straight away, so an administrator can be created in
  one pass. No other required field is loosened, for them or anybody.
- **Each page asks for its own fields, and the press that writes them checks them.** Employment
  Details — Designation, Department, Reports To, Vertical, the two work locations, Joining Salary,
  Referred By, Date of Joining and Next Review Date — lives on **Login Credentials**, not on the
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
- Employee Attendance. Daily login and logout with selfie, server-stamped time and location; leave
  and on-duty requests decided by any one of the three Leave Approval slots on the employee's
  record, **a permission decided by the one person named in Permission Approval** — an hour out of a
  single day, settled the same morning it is asked for, so there is nobody to escalate to; either
  way an `HRM / Attendance Approval` holder can decide it. A record with no permission approver
  named falls back to the three Leave Approval slots, which is what every record started as; a per-request event log; and an
  admin-editable working day — shift, late grace, weekly offs and full-day minutes — that every
  attendance status and hours target is worked out from, together with the studio's declared
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
  configuration is the gap. Checking out takes its own selfie. Attendance selfies are the one image
  in this application not served from the public bucket: they are stored as object keys and served
  only through a permission-checked endpoint, to the employee they are of or an Attendance Approval
  holder. **A day nobody checked out of** reads as Missed checkout once it has passed and is closed
  only by a correction an approver agreed to — the module never guesses a checkout time. Corrections
  and outside-location asks are two more `AttendanceRequest` types rather than tables of their own,
  so they use the approval pipeline, the event log and the Approvals queue already there. Checking
  in shows a short card with the time and a line for the day, kept in `attendance_quote`, several
  per weekday and chosen from the date so the studio reads the same one.
- **Attendance Register** (`/hrm/attendance`) — the whole studio's day, opened by
  `HRM / Attendance Approval`. A roster rather than a list of sessions: one row per active employee
  whether or not they marked anything, so it can answer who has not checked in. Seven counts across
  the top, filters for date, branch, status and a name/ID/department search, and a per-day detail
  showing both captures with their photographs, coordinates, accuracy, distance from the office, the
  device, and any corrections asked about that day.
  Statuses are On time, Late, Permitted, Half day, Early exit, Not logged out, Missed checkout,
  Absent, On leave, Holiday and Weekly off — one field, read in that order of consequence. Where a
  day was worked (Office, Work from home, Field work) sits beside the status rather than inside it.
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
  a reload comes back to what was being worked through rather than to All. **Mark paid** sits on the row's ⋮ and names
  the instalment it settles; it is offered only for an instalment still pending, and only to
  `READ_WRITE`. Paid is not reversible here — a correction is an Accounts entry, and the server
  refuses the reversal.
- **Settings → Organization → Branches** is the studio's branch register — the row every other
  module already points at, given somewhere to be kept: the branch's name and code, its address in
  parts, how it is reached, what it is registered as, and where it banks. **The registration is not
  required.** GSTIN and PAN were both mandatory and are now optional, because a branch trades before
  its GSTIN comes through and a studio that is not registered still has branches to bill from —
  insisting on them meant such a branch could not be added at all. Either one typed is still held to
  its real shape, so a mistyped GSTIN is refused exactly as before; only a missing one is now
  allowed. What a branch must still carry is unchanged: the code and name, the address, the PIN
  code, the phone, and the four bank fields. **A branch may also carry the QR its clients scan to
  pay it** — one optional picture, PNG, JPG or WEBP, picked with the same field the studio's logo and
  an employee's photograph are picked with: compressed in the browser, uploaded by the server to the
  same bucket every other image goes to, and stored as the link it comes back as. Adding and editing
  a branch behave alike — an existing QR shows as itself and can be replaced or taken down, and an
  edit that touches only the phone number sends the link back untouched rather than re-uploading the
  picture. Reached with `SETTINGS / Organization`, the same permission the rest of the studio's
  settings answer to. A branch is never deleted, only disabled.
- **Settings → Holidays** is where the studio declares the days it is closed. A month grid: a
  click on a day declares a holiday, a click on an existing one renames it, moves it to another day
  or removes it, and the month beneath the grid lists what it holds. One list, two readers — the
  day is drawn on everybody's **Calendar** and attendance counts it as a holiday rather than an
  absence, taking it out of every employee's hours target. It answers for `SETTINGS / Holidays`
  — Read to look, Read / Write to change — rather than to HRM, which is where it used to be
  written: a company-declared holiday is a studio setting, not an attendance decision about one
  person. One holiday per day; declaring a day that already has one is refused rather than
  overwriting it.
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
  the end. Three views, picked from the dropdown beside the heading: **All Tasks** for whoever holds
  `HRM / All Tasks`, then **My Tasks** and **Tasks Given**. **Each status tab carries its count**,
  and switching between them touches nothing: a view is fetched whole and filtered in the browser.
  It used to be filtered at the server, which is why the counts showed nothing — the browser only
  ever held the status it was displaying, so every other tab had nothing to count. The endpoint does
  not paginate, so All was already fetching the whole view and nothing was being saved by it.
  The tab row under the heading filters
  whichever view is open by **Pending, In Progress, Completed, Reassigned or Cancelled** — every
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
  Whoever holds a task starts it, then completes it, or **reassigns** it at any point. A verb
  that ends the task closes its panel and returns to the list; Start keeps it open, since Mark
  Complete has just appeared in the same footer. Complete
  appears only once the task has been started, so Start and Mark Complete are never offered at the
  same time. The person who gave it can cancel it.
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
  than the only way out. **`Reassigned` is an open status**, unlike the `Reverted` it replaced: the
  task has landed on somebody new and is waiting to be picked up, so it stays startable. Only
  **Completed** and **Cancelled** close a task now — a cancellation being the person who set it
  calling it off, needing no reason, and leaving nobody to act.
- **A reassigned task stays in front of everybody who has held it.** A gives it to B, B reassigns to
  C: all three read it and its history, and if C passes it to D then all four do. Every holder is
  recorded, so **My Tasks** lists what you hold *and* what you have passed on, showing who has it
  now — you were asked to do it, so what became of it is your business — while the verbs belong to
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
  the questions their ad form asks. **Sl. No.** is the table's own row number, which is why the
  sheet's serial column is the one heading the importer leaves unread, and Manage Columns moves
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
  rules between them and no second lines. **View**, and a **double-click** on the row, open the
  record **read-only** — no boxes and no Save, the same panel the Employee Repository shows. A
  double-click is too easy to trigger by accident for it to be what puts a live form on screen, so
  editing is asked for by name from the ⋮; a single click still opens the info panel beside the
  table. **View is disabled rather than taken out**, because
  reading a candidate is what pressing the row already does and a menu that quietly loses an entry
  reads as a permission problem.
  A double-click opens the form for whoever may write and the record for whoever may only read.
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
  card over the dimmed page with **Candidate Name**, **Contact** and **Position Applied For** as the
  three required answers, then Email, Experience and Source beside them, and under those the **next
  follow-up date** and the **remarks** — **one panel**, eight controls, the full width of the card.
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
- Create Project.
- Edit Sale Details — corrects what this screen's own user entered. **Signed Quotation follows the
  quotation, not the screen**: booked against a quotation, the figure is that document's and is shown
  read-only here; booked without one, it is typed in that box, on Create Project and on Edit Sale
  Details alike. Correcting it later is Projects → Edit Project's, behind `PROJECT / Projects`
  `READ_WRITE`. Not required to book — a project saved without a figure schedules against zero and
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
  catalogue at the studio rates, exactly as before. Every version snapshots the brand as it stood
  when it was raised (logo, terms, wording, GST) and stamps the price each line was added at, so a
  later change in Settings never alters a quotation already sent. The register badges and filters
  by brand; the quotation number keeps its existing `DBS-QO-<vertical>-<branch>-000001` form.
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
- Leads & Followups → **the three pending tabs divide the outstanding follow-ups between them.**
  Today Pending Followups is the calls owed today, Yesterday Pending Followups the ones owed
  yesterday, and Overall Pending Followups everything owed before that — each of them a lead at
  **Followup**, so the three differ only in the date. Overall used to count
  by status alone, which made it the total the other two were slices of: a call owed today was
  counted twice, and one booked for next week was counted as pending before anybody was late on it.
  A lead marked Followup whose follow-up date is blank, or holds something that cannot be read as a
  date, counts as overall pending — it is owed a call on a day the board cannot name, and that is the
  one set that would otherwise fall through all three tabs.
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
  against the day it began, so the two tabs always agree.
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
- Leads & Followups → **the three pending tabs are one question asked at three dates: a lead at
  Followup, dated by the call that is owed.** Today Pending is the leads at **Followup** whose Next
  Followup Date is today, Yesterday Pending the ones at Followup dated yesterday, and Overall Pending
  everything at Followup owed yesterday or earlier — plus the follow-ups whose date was never filled
  in, which are owed on a day the board cannot name and belong with the late work rather than in no
  tab at all. Today Pending read **Yet to connect** rather than Followup for a while, on the
  reasoning that it was the calls still to be *made* today; that made the three tabs two different
  questions under one name and lost the case in between — a lead at Followup with a call booked for
  today was owed a call today, appeared in none of the three, and surfaced in Yesterday Pending the
  next morning as though it had been missed. "Nobody has rung this" is its own tab, **Yet to
  connect**, which is where that queue is read. Overall **deliberately overlaps** Yesterday: a call owed yesterday is
  in both, because Yesterday Pending is that day on its own and Overall is the backlog behind it, so
  the counts on the strip are not meant to add up to the board. The one thing Overall never holds is
  a call booked for **today** — that is not late yet. Today New Leads stays the enquiries dated today,
  which is a different question and its own tab.
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
  hand-over in the holder chain and tells the new holder. Duplicating starts a new task from an
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
  Interviews, Employee Attendance — and says what is being shown. **Calendar** draws that source as
  a month: meetings, shoots, projects' main events and the interviews HR has scheduled, coloured by
  kind, each opening where that kind is worked on — plus the
  studio's **holidays** in rose, which lead the day they fall on and are drawn for everybody
  whatever else they hold; the page is
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
  a meeting and a row can be cancelled; a project row is read-only here and links through to Project
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
  Projects, Pre Production, Post Production, Meetings, Interviews, Employee Attendance, each with
  its own columns — and four tabs
  under the title choosing when: All, Today, Upcoming, Past, each carrying its count. Only the
  sources the viewer's own permissions reach are offered, so a viewer holding `SALES / CRM Leads`
  alone gets the meetings table and no switch. Add Meet books a meeting and a row can be cancelled;
  a project row is read-only here and links through to Project Management.

Project Management:

- Projects.
- Row View / Tree View.
- Start Project / Edit Project.
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
- Pre Production with Dum Dum / Qua Qua / Corp.
- Production.
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
  filled in — amount, date, shoot, mode, the project's outstanding balance and the entry's own id —
  and both Save & Next and Save & Close open it with a Copy button. The balance is the quotation plus
  approved extras less everything received, this payment included, floored at zero. Money spent gets
  no message.

Technical:

- Technical Dashboard foundation.

AI Feature (Visual Curation → AI Feature, `/visual-curation/ai`):

- A second gallery product beside Image Selection, kept entirely apart from it: its own backend
  module (`backend/src/modules/ai-feature/`), frontend folder (`components/ai-feature/`), fifteen
  `ai_event_*` tables, the `ai-feature/event-<id>/` R2 namespace and the `ai-feature-media` queue.
  Nothing in it reads an Image Selection or Album Proofing row, and nothing there reads its rows.
- **Overview** is the dashboard across every event: event, photo, face and guest counts, storage,
  the recent events with their AI processing progress, and the recent timeline. **Events** lists,
  searches, filters (All / Active / Upcoming / Completed / Archived) and sorts events, with Open,
  Edit, Duplicate, Archive and Delete (confirmed). Status is read off the dates on every read.
- **Create Event** is a six-step wizard: details (with the event types the defaults list), sub-events
  (add, edit, remove, reorder), event settings, guest configuration, media and AI settings, review.
  The event takes a **copy** of the studio defaults at creation and overrides them from then on;
  changing the defaults later never touches an existing event.
- **The event workspace** has Overview (counts, AI processing progress with the queued / processing
  / completed / failed breakdown and Retry Failed, sub-event summary), Media (folders bound to
  sub-events, drag-and-drop upload three files at a time, per-file Uploading / Uploaded / Processing
  / Processed / Failed), People (faces clustered into people: rename, link to a guest, merge, split,
  hide), Guests (add, bulk import, groups with sub-event access, RSVP, selfie status, matched
  count), Face Recognition (the review queue: confirm or reject), Sub Events and Activity. Share
  generates the guest link with a short code, an optional PIN and a QR image; More holds Edit, this
  event's own Settings, Duplicate, Archive and Delete.
- **Processing** never runs in a request: the upload derives a 2048px preview and a thumbnail, sends
  them to R2 and queues the row. The worker asks the face engine for every face, stores each with
  its vector (never sent to a browser), joins it to the nearest person above the cluster threshold
  or starts one, and matches it against the guests who have registered a selfie - so a guest is
  matched again, automatically, on every later upload. A rejected match stays rejected and deletes
  nothing. One failed photo fails only itself and can be retried.
- **The face engine** is a Python sidecar (`face-engine/face_engine.py`) on open-source models -
  InsightFace's SCRFD detector and ArcFace recogniser, fetched from the Hugging Face Hub - switched
  on with `AI_FACE_ENGINE_ENABLED=true` after `pip install -r backend/requirements-face.txt`. Off, or
  not installed, photos still upload and their face jobs wait with the reason shown on the
  processing card.
- **Guests** open `/e/<code>`: cover, schedule, join (name and phone as the event asks, PIN if set),
  All Photos, Sub Events, My Photos and Find My Photos (a selfie matched against that event's faces
  only), download and share as the event allows, "This is not me" on a wrong match. A guest session
  names the event and the guest and is refused anywhere else.
- Three permissions under Visual Curation: `IMAGE_SELECTION / AI Feature`, `AI Face Management`,
  `AI Event Default Settings` (see IAM.md). Event visibility is by permission alone, not by branch.

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
  This Month, This Week, 3 Months and 6 Months, opening on This Month, while Refresh and New
  Project stay in the module header. Every card, stage and attention row is a filter on the Recent
  Projects table at the foot of the page (press again, or Total Projects, to let go); nothing on
  the dashboard navigates except a double click on a row of that table or a press on a row of the
  progress list, each of which opens the project. A single click on a table row picks it out and
  stays where it is, as a row does in every other table in the application; the table has no Action
  column. The Projects page still accepts the same views as `?status=` / `?attention=` deep links,
  and its sidebar shows one as a chip. Stages are the sidebar's own progress rungs —
  Completed is the archived list — so the two screens cannot disagree. The public gallery now
  records when the client first and last opened the link and when they last acted in it.
- Projects foundation only.
- A production project joins the Projects sidebar automatically once it enters either Work in
  Progress state — the list sync creates its linked project (one per WhatsApp group name; web
  and the desktop app read the same list). New Project is manual-only; the saved-group-name
  picker is retired.
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
  archived. The delete is soft on both sides, like the project's own: the photographs, folders and
  the client's selections stay on disk and in their rows. Purging those is Image Selection's own
  delete of a **manual** project, which first makes somebody confirm the client's submitted
  selections by hand — a project delete is not that confirmation, and never reclaims storage.
- The settings rail's first tab shows Shoots & Selection Items under the Access PIN: one
  collapsible row per shoot, its items inside, each with the product-wide progress status
  (Yet to Start / In Progress / Submitted / Disabled; shoot rows aggregate to Partially
  Completed / Completed). Only a client's submission counts as done.
- Review & Submit sends one selection item and enables once at least one photo is picked for it:
  the limit caps how many the client may choose, it does not oblige them to choose that many.
- The client gallery footer carries Deselect All between the completion bar and Review & Submit:
  it releases every photo picked for the selection item on screen, asks first, and is absent once
  that item is submitted.
- A submitted selection item shows a green checkbox in Selection Items; unchecking and
  re-checking it reopens the selection for the client (their earlier picks stay), and their
  next submit locks it green again.
- **People filter (Phase 1).** Whenever the AI Feature's face engine is on
  (`AI_FACE_ENGINE_ENABLED=true`; `IMAGE_SELECTION_FACE_RECOGNITION_ENABLED=false` opts the gallery
  out), every photo is handed to a background worker once it is READY: faces
  are found in its existing preview, described as vectors and grouped into **Person 1, Person 2,
  …** for the project, and each person is stored as the set of existing photo ids they appear in.
  Inside a folder the client gallery then shows a **People** section above All Photos / Selected -
  All with the folder's photo count, then a face circle per person found in that folder with name
  and photo count beneath, always in one sideways-scrolling row with All fixed on the left, as many
  shown as the width holds and the rest reached through a **More** item (the next faces stacked with a
  +N badge) that puts them into the same strip, with **Less** at its end to fold it back - and pressing people narrows the
  same grid to the photos any of them are in, in that folder (Reception *and* Person 1 or Person 3);
  a chosen person carries a blue ring and a tick, two or more show an *N selected* badge with Clear. The tick on a
  photo is the photo's own: picked under Person 1, it is picked under Person 2 and under All, and
  the Selected count is unchanged. Photos with no face stay in All Photos; a person with no photo
  in the folder is not offered; nothing is copied, no crop is stored (the circle is cut from the
  thumbnail in the browser), and no face is ever looked for on a click. The row is simply absent
  when the filter is off, has not run or failed, and every other flow - folders, selection,
  retouch, submit, download, deletion - is exactly as before. A gallery that predates the filter is
  queued in the background the first time a client opens one of its folders (or on request with
  `POST …/faces/queue`); later uploads are scanned alone and joined to the people already found. No names are guessed, and there is no rename, merge, hide or selfie search
  yet.
- A manually named project picks its workspace tabs (Photo Selection, Photo Culling, Signature
  Album — at least one) on the Create New Project form; a linked project earns its tabs from the
  Post Production Allocation and the Deliverables table's Image Selection column.
- Editing a manual project re-opens that same form pre-filled — name, client details, workspace
  tabs — with Save and Cancel in place of Create Project.
- A manual project's Selection Items are typed under shoot groups that are the project's root
  folders — creating a folder ("Pre Wedding", "Wedding") creates its group in the table; each
  group has its own add row, item names are unique per group, and the client gallery offers and
  submits each group under the root folder matching its name. The workspace header's Download Selected follows the same
  pairing: standing in a root folder whose shoot group is submitted downloads only that folder's
  selected photos, and a whole-project archive is never offered on a manual project.
- Every press of Download Selected is its own delivery: the project root folder under the Target
  Download Path is stamped with the download date — `John & Priya Wedding - 02-Sep-2026` — and a
  second download the same day gets ` (1)`, ` (2)` after it, Windows "New folder" style, instead
  of writing over the last run. Only the root is stamped; the
  Project ▸ Selection item ▸ Shoot ▸ Folder tree inside is unchanged. Without a Target Download
  Path the date goes on the ZIP's name and the browser's own numbering supplies the counter.
- A linked project's shoots join the workspace only after their shoot date: the shoot's root
  folder and its Selection Items appear from the day after the date set in Project Management,
  each shoot on its own date — an earlier shoot is never held back by a later one, and a shoot
  with no date is not held back at all.

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
  Types (Client Storage); Vendor Types (Vendors); Bank Account Types (Accounts Manager);
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
- Active
- Employee Submission Pending
- HR Onboarding Pending
- InActive — `Relieved`, `Absconded`, `Fired` and `Long Leave`; every row in it carries **Move to
  Active** on its menu

Rules and behavior:

- Employee ID is backend-generated as `DBS-1`, `DBS-2`, `DBS-3` — unpadded, and carrying neither a
  vertical nor a branch, because a person belongs to the studio rather than to a board.
- Employee ID is read-only in the UI.
- Employee ID must not be required in the frontend create payload.
- Add Employee, Edit, Review, Approve & Onboard, onboarding invites, and Technical credentials are part of the current Employee Repository workflow.
- **The onboarding tabs hold two kinds of row.** An **invite** — a candidate who has not submitted
  the form — is a synthetic row with no employee record behind it, showing no Employee ID and
  carrying the invite's own menu: View, Copy Link, Edit Invite, **Start Offboarding** and **Cancel
  Invite**. An **employee record** on one of those statuses is the real thing: created by Add
  Employee, or left there when a submission is sent back. Its menu is the employee one.
- **Offboarding an invite turns it into an employee record.** The two entries on an invite row are
  different decisions. Start Offboarding opens the same offboarding form an employee is relieved
  with, and saving it creates the record — the invite's name, email, phone and intended designation,
  on `Employee Submission Pending`, which the separation then stores as `previousEmploymentStatus` —
  marks the invite Cancelled and points it at that record, and records the separation against it,
  all in one transaction. The row lands in InActive and Move to Active returns it to the wait it was
  in. Cancel Invite is the other case: an invite sent by mistake, which leaves nothing worth keeping
  and no record behind. A record created this way holds only those four answers, so it reads as what
  it is — a hire that never started — rather than as a half-filled employee.
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
- **The way back is Move to Active**, on the row's ⋮ menu for anybody the repository does not count
  as working — the three departure statuses and `Long Leave`, which has no separation behind it at
  all. It removes the offboarding record, restores the status held before it (their own, where that
  counts as working **or** is an onboarding status; otherwise the first working status, so a Long
  Leave that became a Relieved is not "restored" back into the InActive tab, while a candidate
  offboarded before they started returns to the wait they were in rather than being promoted to
  Active), clears the relieving date and remarks, and reopens the login. The separation is removed rather than kept, which is what lets the employee be offboarded
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

Start/Edit Project sections:

- Client Details
- Identification
- Sales Remarks
- Service Creation (shoots, services and deliverables)
- Shedule Payment (the payment plan against the signed quotation)

Double-clicking a project row opens the read-only record view instead, which has two tabs:

- Details — everything the record holds, section by section.
- Payments — cash received and cash spent against the project, with the payment summary. The
  entries are Accounts' own cash entries; each list has an Add button that opens Accounts' entry
  form with this project already filled in. Shown only to somebody holding both `PROJECT / Projects`
  and `ACCOUNTS / Cash Management`, and the Add buttons only with write on the latter.
  A cash entry has no branch field: its branch is the Source Branch of the project it is filed
  against, so money in must name a project and money out one of that project's shoots. The advance
  taken at booking is recorded on Create Project's own Payment Received section instead.

Shoot rules:

- Shoot ID is backend-generated as `DBS-SID-DD-ERD-000001`: the shoot's project's vertical and
  branch, counted per vertical alongside every other identifier the studio hands out.
- Save to Draft does not change status, and saves whatever has been typed so far — a draft is
  allowed to be half answered, and the panel autosaves into it as the form is filled in.
- Start Project changes status to `Work in Progress - Pre & Production`, and is the point the
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
- **Send Link is how the link reaches the client.** The dialog shows the URL, offers Copy Link and
  Open Form — the studio's own check that it works before it goes anywhere — and **Send on
  WhatsApp**, which opens WhatsApp on the client's number with the message already written. The
  person presses send; it is never an automated or unattended send, which is what gets a studio's
  number banned. The button is absent where the project has no number rather than shown and
  refused.
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
- **Nothing in Event Details blocks submission.** A field the form will not let anybody type in
  cannot be one that holds the document up: Point of Contact Name is prefilled from the lead's
  primary decision maker or company name, both routinely blank on a wedding lead, and required and
  unfillable it would have stranded the document with no screen anywhere able to fix it. What the
  client must answer is both sides in full and the terms — which is everything the document exists
  to collect.
- Project/shoot data must remain project-scoped.

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
- Detailed pre-production execution.
- Detailed production execution.
- Detailed post-production execution.
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
