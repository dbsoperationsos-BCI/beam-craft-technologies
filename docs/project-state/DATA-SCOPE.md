# Data Scope

Who gets *whose* rows. [IAM.md](IAM.md) answers "may you open this screen"; this document is the
programme that makes "whose records do you get" answerable everywhere, and the decisions taken on
the way. Started 6 September 2026; each stage below records what it changed.

## Why this work exists

[IAM.md — Who sees which records](IAM.md#who-sees-which-records) is honest about the state it
found: two screens are branch-scoped, four are ownership-scoped, and everything else shows every
record in the studio to anyone who may open it. That is not a permission hole; it is that "whose"
had no answer, for three reasons that all have to be fixed before a filter can be written once:

1. **Branch was free text** almost everywhere. Only `User` and `Asset` carried a `branch_id`, so
   `buildBranchFilter` could narrow nothing else, and "Erode" and "Erode TN" were the same branch
   spelled two ways.
2. **The CRM's `branch` was not a branch.** It held the vertical - Dum Dum, Qua Qua, Corp - which
   is also the CRM's board, so the one word meant three things across the code.
3. **Ownership was split.** Some tables point at `Employee.id`, some at `User.id`, and 37 columns
   hold a bare user id with no key at all. The reporting line lives on
   `Employee.reportsToEmployeeId`, so "my team's records" cannot be answered from a user id.

## Vocabulary, fixed

| Word | Means | Never means |
| --- | --- | --- |
| **branch** | A studio branch - a row of the `branch` table (Erode TN, Tiruppur TN, …), maintained in Settings → Organization → Branches. Column `branch_id`. | A vertical, a bank branch, a client's location, a shoot venue. |
| **vertical** | A business line - a row of the `vertical` table (Dum Dum, Qua Qua, Corp; Team 33 and General on the employee side). Column `vertical_id`. | A branch. |
| **board** | One of the four CRM boards: the three sales verticals plus Calls. A query parameter, never a column. | A vertical (Calls is not one). |
| **owner** | The employee a business record belongs to. Column `owner_employee_id`. | A login. |

One concept, three spellings, all still in use until the readers move to the `vertical` table:

| Where | Dum Dum | Qua Qua | Corp | Source today |
| --- | --- | --- | --- | --- |
| `vertical.code` | `DUM_DUM` | `QUA_QUA` | `CORP` | the table |
| `vertical.document_code` - projects, quotations, CRD documents, group names | `WED` | `QQ` | `CORP` | `salesVertical.js` map, now also the table |
| `vertical.identifier_code` - inside every identifier | `DD` | `QQ` | `CORP` | `identifiers.js` map, now also the table |
| `sales_crm_lead.branch` (text, Prisma `verticalName`) | `Dum Dum` | `Qua Qua` | `Corp` | typed, imported, folded on read |

## Decisions

Dated, so a later reader knows what was known when.

- **D1 (2026-09-06) `location` → `branch`.** The table only ever held the six branches and every
  key into it was already `branch_id`. Done; migration `20260906090000`. No behaviour change.
- **D2 (2026-09-06) The lead's vertical is a reference, not text.** `sales_crm_lead.vertical_id`
  → `vertical.id`, added NULL beside the text with the same discipline as the branch columns:
  report-first backfill, switch reads after approval, drop the text last. Done for the column;
  migration `20260906110000`.
- **D3 (2026-09-06, reversed by D21) The text column keeps its physical name until it is dropped.**
  Deferred to avoid two rebuilds of the lead table. Reversed: the confusion cost more than the
  rebuilds. It is `vertical` in the database, `verticalName` in Prisma and `vertical` in the code.
- **D4 (2026-09-06) `vertical.id`, not `vertical.code`, is the key.** Matches `branch_id` and every
  other reference. Consequence: `board_key` cannot be recomputed from the reference without either
  baking ids into DDL (they differ between environments - the seed upserts by code) or dropping
  `board_key` for a plain index on `vertical_id` once blank non-Callyzer leads are backfilled to
  Dum Dum. **Decided at Stage 7 with production data in hand**, not before.
- **D5 (2026-09-06) The short codes are columns.** `document_code` and `identifier_code` on
  `vertical`, set for the three sales verticals, NULL for Team 33 and General. A lead may reference
  only a vertical with a document code; the write path checks it. The hard-coded maps keep
  answering until Stage 7 moves the readers.
- **D6 (2026-09-06) The other vertical columns join the programme.** `sales_project.vertical`
  (`WED`), `sales_whatsapp_group_name.vertical` (`WED`), `sales_project_crd_document.vertical` and
  `employee.vertical` (`Not Allocated`) get `vertical_id` the same report-first way, in Part C.
- **D7 (from the brief) `Employee` is canonical for ownership.** The reporting line is on
  `Employee`, so TEAM scope is unanswerable from a `User.id` without a join through
  `linkedEmployeeId` on every query. `User` keeps what is genuinely about the login: sessions,
  roles, preferences, notifications, AI conversations.

## The rule

One rule, for everybody. There is no per-role setting, because there is nothing a role could
usefully say that this does not already answer:

> A record is yours if your **name** is on it, or if the name on it belongs to somebody who
> **reports to you**, at any depth.

"Your name" includes the one every record carries: **whoever created it**. So a lead nobody has been
assigned yet is still the work of the person who entered it, and an asset in stock is still the work
of whoever registered it.

An asset in Visakhapatnam assigned to somebody whose roles reach only Erode is theirs to see,
because they are the person holding it — and an asset assigned to a colleague is *not* yours just
because you both reach the branch it sits in. **Reaching a branch is not a claim on the work of the
people in it.** A branch list says where a person may file records and which branches a picker
offers them; that is all it says.

One permission widens a person past their own name, and it is deliberately granted:

| Permission | Gives |
| --- | --- |
| `ADMIN / Branch Administration` | Every record belonging to the branches this role reaches |

One, not one per module. A module that wants its readers to see a colleague's work asks for that
permission; it does not add its own. `resolve()` reads it, so no module can forget it and none can
invent a second way to widen.

A Super Admin holds everything and is narrowed by nothing.

`resolve()` in
[backend/src/services/dataScope.service.js](../../backend/src/services/dataScope.service.js) is the
one implementation. A module declares only its own column names:

```js
const scope = await dataScope.resolve({ userId, module: "ASSET", feature: "Asset Management",
  columns: { branch: "branchId", employee: ["assignedPersonId", "managerId"] } });
prisma.asset.findMany({ where: { isDeleted: false, AND: [scope.where] } });   // the list
if (!scope.allows(asset)) throw notFound();                                    // one record
scope.sql({ branch: "`l`.`branch_id`", employee: "`l`.`owner_employee_id`" }); // hand-written SQL
```

| Key | Means |
| --- | --- |
| `branch` | The branch reference. Counts only for a branch administrator — or for a module with no owner column at all, where a branch-scoped list is the whole idea. |
| `employee` | The columns holding an **employee** id — who is assigned, who manages, who handles. One name or a list. |
| `user` | The columns holding a **login** id — a task's two sides, and **the creator**, which every scoped record now carries. |

Four rules it holds to, each of which has been a bug somewhere:

- **"You" is both identities.** The employee behind the login (`User.linkedEmployeeId`) *and* the
  login itself, so both kinds of column answer. A login with no employee is named on nothing by
  employee id and is left with what names it by login id, and its branches.
- **"Reports to you" is one recursive query** over `Employee.reportsToEmployeeId`, capped at 20
  levels and refusing to revisit an employee already on the path, so a cycle ends where it began.
  It covers the logins of those people too, so a manager sees their team's tasks as well as their
  team's leads. Archived employees are included: a leaver's records are still their manager's.
- **A module that declares nothing usable fails closed** — no rows, and the mismatch is logged. A
  role can be granted a screen before that screen is ready to narrow, and it must never answer with
  more than the rule means.
- **The `where` goes under `AND`, never spread.** It is itself an `OR`, so spreading it beside a
  search that sets its own `OR` replaces the rule with the search. That was a real leak in three
  read services, caught by a test and fixed.
- **A record with no creator on it and nobody named is nobody's**, and only a Super Admin or a
  branch administrator sees it. Rows made before the creator was recorded are in that position;
  they answer to the names already on them.

`allows(record)` reads the same columns as the `where`, so read-one, update, delete, status changes
and the histories hung off a record are held to the same line as the list without a second query.
The screen's controller and the AI tool share the column declaration, so the two can never narrow
differently.

### What each module counts as your name

| Module | Employee columns | Login columns |
| --- | --- | --- |
| Asset Management | assigned person, **manager** | creator |
| CRM Leads | the CRM who owns it | creator |
| Quotations | who followed it up | creator |
| Projects | CRM, project manager, creative manager, both coordinators | creator |
| Cash Management | who handled the money | creator |
| Payment Requests | who raised it | creator |
| All Tasks | the employee behind the assignee | assignee, giver, creator |
| Employees | — | — |
| Saved group names | — | creator |

Every one of them also takes the branch, which counts for a branch administrator. Employees have no
owner column at all — an employee *is* the person — so the branch decides there outright.

Two modules keep a tighter rule of their own on top, and both predate this work: a **payment
request** is the requester's own until somebody who may decide it looks, and a **task** is always
readable by the two people it is between. Neither is widened by the rule; both are narrowed by it
where they were not already.

- **D10 (2026-09-06) A project is yours if you are on it in any role.** CRM, project manager,
  creative manager, either coordinator, or its creator.
- **D11 (2026-09-06) A screen opened by several permissions answers to whichever is held.** The
  project register is read under seven.
- **D12 (2026-09-06) The backfill is one rule written twice, held together by a test.**
  `src/services/referenceMatchers.js` is the rule in JavaScript — read by the match report, by every
  write path that keeps a reference in step with its text, and by
  `test/data-scope-backfill.test.js`, which replays every row of every converted table and fails if
  the SQL migration (20260906160000) answered differently. It judges the studio's rows only: the
  other data-scope suites run beside it on the same database, and some of their fixtures break the
  rule deliberately, so rows stamped with a prefix from `scripts/clear-test-fixtures.js` are skipped.
- **D13 (2026-09-06) Hand-written queries get the same answer as SQL.** `scope.sql(columns)` carries
  the same ids as the Prisma `where`.
- **D14 (2026-09-06) Two CRM reads stay unscoped.** The duplicate check guards a write across every
  vertical and must see every lead to refuse correctly; the Calls board lists calls, which carry no
  branch and no owner.
- **D15 (2026-09-06, superseded by D25) `PROJECT / All Projects` keeps its meaning.** Without it you get the projects
  you are on and your team's; with it, also every project in the branches you reach. Retiring it in
  favour of the rule alone is a separate product decision.
- **D16 (2026-09-06) A CRD document is scoped through its project.** The one it hangs off, or for a
  document raised by hand, the project that answered Not Applicable and shares its enquiry.
- **D17 (2026-09-06) A module rule that is tighter than the rule survives it.** A payment request is
  the requester's own until a decider looks; a task is readable by its two people. The rule narrows
  what those already allowed and never widens it, so "my own work" never disappears.
- **D18 (2026-09-06) An employee and a saved group name are branch-scoped only.** Neither is a
  record with somebody assigned to it — an employee *is* the person.
- **D26 (2026-09-19) The Employee Repository is scoped, and a branch is three columns.** D18 left it
  unscoped on the grounds that an employee *is* the person and branch narrowing was the only
  question; the answer taken now is that the person is exactly what makes it scopable — `employee:
  "id"` resolves "your name is on it, or the name on it reports to you" to the reader and their
  subtree, so everybody holding the repository sees themselves and their reports, and
  `ADMIN / Branch Administration` adds the branches their roles reach. The branch limb reads
  `branch_id`, `work_base_location` **and** `current_work_location`, any one of which is enough:
  `branchId` is derived on write as base-or-else-current and can hold only one of the two, so the
  reference alone hid somebody posted into a branch from that branch's administrator. That is what
  `columns.branchText` on the resolver is for — free-text branch columns matched against the
  reachable branches' names, declared by a module beside or instead of its reference column.
  `hrm/employees/read.service.js` was reading the texts only as a fallback and now reads all three
  the same way, so Nebula and the screen answer with the same people. The writes on an employee row
  are held to the same rows as the list and answer 404.
- **D19 (2026-09-06) The assistant says when its figures are narrowed**, so a partial count is never
  presented as the studio's. It names no permission and no role.
- **D24 (2026-09-06) The branch belongs to a branch administrator, and the creator is a name.**
  D22 had the branch answering for records nobody was named on, which showed everybody in a branch
  its unclaimed work. That is still somebody's work — the person who entered it — so the creator
  became one of the names the rule reads, and the branch stopped granting anything on its own.
  `ADMIN / Branch Administration` is the new permission that gives a person the whole of the
  branches their roles reach; it is checked inside the resolver, so no module can forget it and
  none can invent a second way to widen. `created_by_user_id` was added to the three scoped tables
  that did not record it (leads, quotations, tasks — migration `20260906190000`); the rest already
  did.
- **D25 (2026-09-06) One permission widens, not one per module.** D15 kept `PROJECT / All Projects`
  as a project-only way to lift the name requirement. That made two rules: the project screens
  answered from one permission and every other screen from another, and nothing on screen said
  which. It was reported as a bug twice — *"why is he getting all the projects, nobody under him is
  on them"* — and the report was right both times: the reader was named on one of four projects and shown
  all four, because their role happened to hold it. The permission is retired (migration
  `20260906200000`, which deletes the row and cascades its grants) and `branchGrantsAll` is gone
  from `resolve()`, so a module can no longer widen itself even by accident. A role that needs
  branch-wide sight is granted `ADMIN / Branch Administration`, which widens every module at once.
- **D26 (2026-09-06) A record that hangs off a project is seen exactly when the project is.**
  An attachment, an extra quotation, a client gift and a shoot are not records of their own: there
  is no sensible answer to "whose attachment is this?" other than "whoever the project belongs to".
  They carry no names and no branch, so they are scoped through the parent rather than given columns
  of their own — `readableProject()` in `projectScope.js`, which every child resolves through so a
  child screen cannot answer a different question from the register that lists its parents. Not
  seeing the project is a **404 on the child, never a 403**: a person who may not read a project must
  not learn it exists by being told they may not read it. The project and shoot **pickers** on Cash
  Management, Payment Requests and the extras form are narrowed the same way — a picker that lists
  every project names work that is none of the reader's, and offers a project they could not then
  read the record back against.
- **D27 (2026-09-06) A child screen asks with its own permission, not the register's.**
  `projectAccessWhere()` defaults to the seven register permissions, and a screen holding something
  else — `PROJECT / Client Gifts`, `ACCOUNTS / Cash Management`, the calendar's per-source list —
  passes what its own router guarded with, usually `req.permission`. The permission check inside
  `resolve()` is a backstop for a caller that skipped its guard, not a second guard; demanding the
  register's permissions on a screen that never needed them answered a gift chaser with nothing at
  all, which is how this was found.
- **D28 (2026-09-06) The project scope follows the person choosing, not the write.**
  `recordCashEntry()` serves two callers: a person filling in a form, and the release of money an
  approved payment request already agreed. Only the first is scoped. Whoever releases it files the
  entries against the project *the request* named, and need not be able to read that project
  themselves — scoping the write would have blocked legitimate payments. The distinction is a named `chooser`
  argument rather than a default, so a new caller has to say which it is.
- **D29 (2026-09-06) A hard disc has names *and* a project.** Client Storage is the first table
  scoped by both: the three names it carries — `assignedToId` (who is holding it), `assignedById`
  (who handed it over) and `createdBy` — ORed with the project the footage belongs to, reached
  through the record's own link *and* through its shoot, because a record raised when a project
  starts may not have a shoot yet. The disc is part of running that wedding, so the project's people
  see it whether or not their name is on the record. It has no branch column of its own, so branch
  administration reaches it through the project's branch and a disc with no project stays with the
  people named on it — which is the honest answer, since nothing on the record says where it belongs.
  The tab counts and the "last updated" note are narrowed with the list, so a count cannot report
  rows the table will not show.
- **D30 (2026-09-06) A record hanging off a lead is seen through the lead — by enquiry id, not by a
  foreign key.** A meeting, a WhatsApp conversation and a call log all name their lead by
  `enquiry_id` rather than linking to it, so they cannot be filtered through a relation. Each bounds
  its own rows first — a date window, one conversation — and then asks
  `readableEnquiryIds()` which of the handful of leads they name are readable. `leadScope.js` holds
  that rule, lifted out of the CRM controller so a child cannot answer a different question from the
  board that lists its leads. A meeting is also visible to **whoever booked it**: putting something
  in the diary is putting your name on it. Ids naming a lead that no longer exists are dropped, so a
  deleted lead does not turn its meetings into everybody's.
  For WhatsApp, `leadPhone()` is the single gate — the thread, sending, media, marking read, the
  history and the forward all come through it — plus the SSE stream, which is the one path that
  never asks for the lead's number and so needed its own check: an open line on somebody else's lead
  reports every message as it arrives.
- **D31 (2026-09-06) A read that cannot be scoped by a `where` says who is asking, or gets nothing.**
  `listAllMeetings()` and `searchLeads()` take a `reader` and answer no rows without one, the same
  choice `resolve()` makes for a caller that skipped its guard. Three callers had to be updated —
  the Meetings page, the Schedule calendar and the CRM assistant — which is the point: a fail-open
  default would have left all three unscoped and silent about it.
- **D32 (2026-09-06) A dropdown offers everything; a list shows your own.** D26 narrowed the project
  and shoot pickers along with the lists behind them. That was wrong, and the studio said so: a
  picker exists to link one record to another, and the person doing the linking is usually *not* the
  person the other record belongs to. Somebody booking a cash entry against a wedding, raising an
  extra on a project, registering a hard disc against a shoot or arranging a meeting on a lead is
  doing it precisely because they are not on it — a narrowed picker offers them nothing to file
  against. So every picker is open again, and the **write validation behind each one with it**: a
  form must never offer a choice it will then refuse. What stays narrowed is the list of records,
  which is the question "whose work is this?". Linking is not reading.
  The trade is deliberate: a dropdown names clients and event ids across branches. Nothing is given
  away that the enquiry search did not already offer, and choosing one puts the chooser's name on
  the record they create, so they can read that record back.
- **D34 (2026-09-12) An owner also matches on a login username, mirrored onto `Employee` for it.**
  The Owner rule was employee id or full name only, and the CRM's Google Sheet sync writes whatever
  its `CRM` column holds straight through `referenceMatchers.js` like every other write path here.
  An admin who maintains that column with each Sales employee's login (`dhanush.m`) rather than
  typing their full name out every row - the identifier already unique in the database, so it
  cannot collide the way a name can - had every one of those rows come back unmatched,
  `owner_employee_id` NULL, until this was added. Checked ahead of a name and behind the employee
  id, the same way the employee id already won over a name.

  The username itself lives on `User`, not `Employee` - it is the login, and `User` is where an
  identity is created and changed (`createLoginCredentials`, and the account holder's own
  `PATCH /api/user/profile`) for the same reason password and email are. Matching against it would
  otherwise mean joining to `User` on every sheet row, so `Employee.loginUsername` mirrors it: a
  column written only by those same two places, in the same transaction as the real write, checked
  by `test/employee-login-username-mirror.test.js` from source rather than a live query - a fixture
  elsewhere in this suite creates a `User` row directly, for its own scoping test, with no reason to
  go through either writer, so a live invariant here would fail on somebody else's fixture rather
  than a real drift. Migration `20260912150000` adds the column and backfills every account that
  already existed. Checked against the development database before shipping: zero rows of
  `sales_crm_lead.crm` or `sales_quotation.followedBy` would have changed owner had this rule always
  been in force.
- **D33 (2026-09-06) A quotation belongs to its enquiry, not to whoever typed it.** One enquiry is
  quoted, re-quoted and eventually booked as a project, and the people who touch it along the way
  are rarely the same person. Scoped on `ownerEmployeeId` / `createdByUserId` / `branchId` alone,
  whoever booked the project could not read the quotation it was sold on — which is the whole point
  of having one. The enquiry now counts as a name: a quotation is yours if you may read the lead it
  was raised against, or the project it became. Answered per row rather than as a `where`, because a
  quotation names its enquiry with a string rather than a foreign key (the same reason as D30).
  `GET /api/sales/quotations` serves both screens and tells them apart by the query string: **asked
  for one enquiry it is the project form's version dropdown** and answers with every version raised
  for that enquiry; **asked for nothing it is the register** and answers with the reader's own rows.
  The picker cannot be turned into a way to read the table — it answers one named enquiry at a time,
  and a blank enquiry id is the register, not a wildcard. Reading one version by id is open for the
  same reason (it is the dropdown's companion read); the four handlers that *change* a quotation
  stay scoped.
- **D22 (2026-09-06, superseded by D24) The branch decides only where nobody is named.** The rule first had the branch
  as a third, equal limb, and it showed people their colleagues' work: an asset assigned to one
  person was visible to everyone else who reached its branch. Reaching a branch is not a claim on
  the people in it. It now reaches only records with every owner column empty — which is what
  makes unassigned work assignable — and `PROJECT / All Projects` is the one permission that lifts
  the name requirement inside the branches reached.
- **D23 (2026-09-06) A picker offers only the people working here.** `GET /api/hrm/employees?active=true`
  limits to Active, in Training and PIP — the three the repository's own Active tab groups. The
  asset and client-storage pickers read `GET /api/hrm/employees/directory` (2026-09-16), which
  applies the same limit and answers id, Employee ID and name alone, because those roles do not
  hold HRM and the repository row behind `/employees` now needs it. Somebody still onboarding has been entered but has
  not started; offering them as the person to hand an asset to proposes work for somebody who is not
  there yet, which is how an asset came to be assigned to a candidate mid-onboarding. The repository
  screen still asks for everybody, because it has a tab per status.
- **D20 (2026-09-06) The four-scope setting is withdrawn.** `RolePermission.dataScope` (ALL /
  BRANCH / TEAM / SELF, added at Stage 3) and its Role Management dropdown are gone, replaced by the
  single rule above. It was a setting that could be set wrong — SELF on Assets hid an asset from
  the person managing it, which is how the fault below was found — and there was nothing it could
  usefully say. Migration `20260906170000` drops the column.
- **D21 (2026-09-06) The lead's vertical column is called `vertical` in the database too.** D3
  deferred the rename to avoid two rebuilds of the lead table; it is paid, because a column named
  `branch` holding "Dum Dum" has to be explained to everyone who opens the database, and that cost
  is paid on every reading. Migration `20260906180000`.

## Stage 6: the match report, and what it asks

`npm run report:data-scope` (`backend/scripts/reportDataScopeBackfill.js`) is read-only and prints,
for every free-text branch, vertical and owner column, how many rows match under the proposed rule,
how many are blank, and every distinct value that matches nothing. The rules it proposes, each
pinned by `test/data-scope-report.test.js`:

| Column kind | Rule | Why this and not looser |
| --- | --- | --- |
| Branch | The branch's exact name (case-insensitive), else its name without the state keyword, else a nickname in `BRANCH_ALIASES` — which is `Vizag` for `Visakhapatnam AP` and nothing else | "Erode" is what the CRM and the quotation write for "Erode TN". The nickname is checked last, so the register always wins; a shortening (`viza`, `erd`) and a city that is not a branch both stay unmatched |
| Vertical | The name, the code, the document code or the identifier code, spelling folded the way `VERTICAL_SQL` folds it | The three spellings the studio prints; "Not Allocated" is not a vertical and is answered NULL |
| Owner | The employee id, exactly; else the **login username** of the account linked to them; else the employee's **full** name, exactly; two employees with one name is ambiguous, a first name alone is nothing | "sabari j" and "Sabarish J" are two people. A login's name ("admin") is not an employee. A username is never ambiguous - `User.username` is a unique column - and is checked ahead of a name because it is the identifier an admin-run import is expected to write |

On the development database (6 September 2026) every branch and vertical value matches; the only
non-exact branch match is "Erode" → "Erode TN" on 2 leads and 4 quotations. The owner columns are
blank except `sales_project.crm_name = "admin"`, the Super Admin login, which has no employee.
Production will differ and the report is run there before anything is written.

**Decided 6 September 2026, from the report** (recorded as D10–D13 below):

1. The branch rule above — **approved as proposed.**
2. `hrm_task`'s owner. Tasks are assigned between logins; one active login has no employee behind
   it (the Super Admin) and gave both tasks on record while receiving none. **Approved:**
   `assigned_to_user_id` and `assigned_by_user_id` stay as they are, `owner_employee_id` is derived
   from the assignee's `linkedEmployeeId` on every write, and a task assigned to a login with no
   employee carries NULL — visible under ALL and BRANCH, invisible under TEAM and SELF, shown as
   such on the task. Assignment never refuses.
3. `sales_project`'s owner. Three employee columns existed already. **Decided: a project is yours if
   you are on it in any role** — CRM, project manager, creative manager, pre- or post-production
   coordinator — which is also what `projectScope.js` already means by "named on". No new column;
   the resolver takes the five as one owner.
4. Rows whose owner matches nobody after the backfill: **hidden under TEAM and SELF**, with the
   count reported and the rows listed so they can be assigned. Visible as before under ALL and
   BRANCH.

## Staging

| # | Stage | Status |
| --- | --- | --- |
| 1 | `location` → `branch` | Done, `612a1c3` |
| 2 | Vertical reference on the lead (`8cb121c`); every place that called the vertical "branch" renamed (`02d718d`) | Done |
| 3 | Scope column beside `RolePermission.accessLevel` + Role Management dropdown, everything ALL | Done, then **withdrawn** — see D20 |
| 4 | One scope resolver + recursive subtree walk, proven on Assets — list, record, status, custody, inspections and the assistant's tools | Done |
| 5 | Fix `employees/read.service.js` filtering on a `branchId` Employee does not have — `Employee.branchId` added (NULL, backfilled at 7), id first with the text as fallback, five regression tests | Done |
| 6 | Add `branch_id` / `vertical_id` / `owner_employee_id` columns; **match report; stop** | Done — columns added, report run, the four decisions taken |
| 7 | After approval: backfill, switch reads and writes, scope records and reports as well as lists | 7a `063272e`: backfill applied and proven row for row, matchers shared, resolver extended. 7b `f305ff9`: CRM Leads on the resolver — board, counts, every record endpoint, every bulk action, every lead-joined report; references kept in step on every write path. 7c: projects (register, every record endpoint, the assistant's tools, references on create / update / import), quotations (list, record, write) and CRD documents. 7d `d42b273`: cash entries, payment requests, tasks, WhatsApp group names and the assistant's accounts, HRM and project reads. 7e: the CRM assistant's own context. **Stage 7 done** — every module that reads records reads them through the resolver, screens and AI alike |
| 8 | Drop the text columns once nothing reads them | `sales_crm_lead.branch` renamed to `vertical` (D21). Every Prisma read, the CRM board and the bell now return the linked name with the text as fallback (D39, `services/resolvedNames.js`, `RESOLVED_LEAD_SQL`); a few report groupings still read the text. Until they move, the text is a *copy* that follows its row: a rename rewrites every copy in the same transaction (D35) and the former name stays on the row (D38), and every reference column carries a foreign key and an index (`20260924100000`) |
| 9 | The one rule replaces the four-scope setting; the asset manager counted as an owner | Done |

## Found on the way

Faults this work exposed. Each was real, each is fixed, and each is here because the same shape
will turn up again.


Things the rename exposed but deliberately did not change, because each is a behaviour decision
that belongs with the scope resolver rather than with a rename.

- ~~The AI narrows by the wrong thing in two places.~~ Fixed at 7e: `crmContext.scheduleToday`
  compared vertical names against `sourceBranch` and `vertical`, so it counted zero projects for
  every scoped session; it matches `verticalId` now.
- **`Employee.vertical` held "Not Allocated"**, which is not a row of the `vertical` table, so the
  match report listed it. Nothing writes it any more and
  `20260912090000_clear_not_allocated_employee_placeholders` cleared what had been written: the
  onboarding submission used it to mean "the studio has not chosen yet", and NULL is what that
  already resolved to here. The matcher still answers `unmatched` for the string, because a database
  restored from before that migration can still carry it.
- **`vertical.TEAM_33` and `GENERAL` have no document code**, so a lead cannot reference them; the
  write path enforces it once reads move to `vertical_id` (Stage 7).

### The one that made the case for the rule

**An asset's manager was not counted as its owner.** Dhiveesh P was made the manager of a Pendrive
assigned to somebody else, in a branch his roles reach; his role was set to *Their own*, and the
asset did not appear on his screen. Two separate faults in one: `managerId` was not a column the
scope looked at, and a per-role setting existed that could hide a record from the person
responsible for it. The first is fixed by counting both people on an asset; the second by removing
the setting (D20). Naming somebody the manager of an asset is telling the studio it is theirs to
look after, and an asset that does not appear on their screen is one they cannot look after.

## Screens the rule does not reach yet

Audited 6 September 2026. Each of these is guarded by its permission — anyone who may open it sees
every record in it, which is what the studio had everywhere before this work. None is a leak the
rule introduced; each is a decision waiting to be taken.

| Screen | Who could be named on a record | Note |
| --- | --- | --- |
| Image Selection (every screen) | `createdByUserId`, its sales project | Its own Super Admin checks in places; the whole module is unnarrowed |
| Employee Attendance, Referrals, Separations, Onboarding invites | the employee, the creator | HR records about a person, read by HR |
| Vendors, Asset categories, master data | — | Reference lists, the same for the whole studio |
| Asset Requests | raiser / approver | Its own rule: your own until somebody who may decide looks. The reporting line does not roll up yet |
| Contacts, the AI assistant | — | Read across modules and ask each one's permission per source |

**Reached since that audit:** the Employee Repository (D26 — the reader and their reports, widened
to the branches by `ADMIN / Branch Administration`, on all three branch columns), and
Reports & Analytics — its three usage tabs (WhatsApp Usage,
Application Usage, Work Hours) had no scope at all and named every person in the studio by their
week's work, and its Employee filter offered everybody; all three now narrow by the **login** on the
row (`m.userId`, `a.actor_user_id`, `s.user_id`) with the branch read off that login's own `user` row,
since none of those tables carries a branch, and the reports that attribute a call to a person narrow
`staffIdentity` by the same scope so a row is never headed with a name whose figures are withheld
(D34); project attachments, extra quotations, client gifts, project shoots,
the Schedule calendar's shoot and main-event rows, and the project and shoot pickers on Cash
Management and Payment Requests, all scoped *through* the project (D26 — though the **pickers** were
reopened by D32, which is the rule the studio actually wanted); Client Storage, scoped by its own
three names *and* through the project (D29); the CRM meetings list and every WhatsApp conversation,
scoped through the lead (D30); and the quotation register, scoped through its enquiry (D33).

Two columns that name a person and are *not* counted as owning the record, deliberately, because
recording something is not being assigned it: `CashEntry.createdBy` and `Asset.inspectedById`.
Worth revisiting if somebody asks why an entry they typed is not on their screen.

- **D34 (2026-09-17) Reports & Analytics is scoped, and its filter lists Active employees only.**
  The call tabs were narrowed by the lead a call was against; the usage tabs were narrowed by
  nothing, so anyone who could open the screen read every colleague's messages, lead edits and
  measured hours by name. All nine tabs now answer the standard rule — your own name, anybody
  reporting to you at any depth, a branch administrator's branches, a Super Admin unrestricted.
  Three consequences worth knowing: the **Employee dropdown lists Active employees only**, narrower
  than the three working statuses every other picker offers (D23), because a report is read to judge
  somebody's week; **`staffIdentity` keeps the wider list**, since somebody in training who spent the
  week on the phone made those calls; and an activity row written before its actor was linked to a
  login is named by nobody, so it answers only to a Super Admin or a branch administrator — the same
  position as every other record with no name on it.
- **D35 (2026-09-24) A stored name is a copy of its row, and follows it.** Stage 8 leaves the text
  columns in place until the screens read the references, and until then the text is what the
  screens print and what every write path starts from - the reference is *derived* from it by
  `referenceMatchers`. Renaming a branch in Settings -> Branches, a person in the Employee Repository
  or a login in Administration -> Users changed the register and nothing else: every project, lead,
  task and cash entry went on printing the old name, and the next save of one of those rows looked
  the old text up, found no branch, and wrote `branch_id = NULL` - a rename took rows out of scope one
  save at a time. Field Settings had fixed the same fault for its own lists (`renameUsage`); the rule
  is now one list for all four kinds of name, `services/nameCopies.js`, and one rewrite. A copy with a
  reference beside it is rewritten **by the reference**, whatever spelling it held; a copy with none
  is rewritten by exact text; **people only ever by reference**, because two employees can share a
  name and the row whose owner matched nobody is exactly the ambiguous case. Audit rows (asset status
  log, task activity, album and AI event activity) are not copies: they say who did something at the
  time and keep that name. Branches and verticals now declare these uses in the master-data
  definitions, so Field Settings counts them and refuses to delete a branch or vertical in use.
  Beside it, `20260924100000_reference_foreign_keys` gives the 103 bare reference columns - every
  `created_by`, `*_user_id`, `*_employee_id`, `linked_employee_id` and the unlinked `branch_id`s - a
  foreign key and an index, after clearing the ids that already pointed at nothing. Two readers that
  still matched a person by *name* moved to the reference at the same time: the bell's follow-ups
  (`owner_employee_id` = the employee behind the login, name only for an unowned lead) and the
  lead-assignment notice (`referenceMatchers` -> employee -> linked active login, the login's name
  only when the matcher places nobody).
- **D36 (2026-09-24) An employee's list answers are references too, and the lists held several of
  are rows.** The employee form offers twelve maintained lists and the row stored only the words -
  `designation = "Team Leader"`, `department = "Sales, Accounts"`, `skills = "Photography, Editing"`
  - so nothing could join, count or index a person by department, and Field Settings renamed an
  entry by rewriting every row's text. The same move as D2 and D6: a reference beside the text,
  derived on every write and backfilled once (`20260924120000`), with the text left as what the API
  carries and the screens print. Single-valued answers are `*_id` columns (designation, work type,
  gender, blood group, marital status, emergency-contact relationship, and the two work locations,
  both pointing at `work_location`); department, skills and languages are `employee_department`,
  `employee_skill` and `employee_language`, because a comma-separated column is the one shape a
  database cannot ask a question of. `services/employeeReferences.js` is the one rule - exactly one
  row of the list must fold to the text, two spelt the same resolve to NULL rather than a guess,
  inactive rows still match - and it now also answers the vertical and the branch that
  `referenceColumnsFor` used to. Every employee write goes through it: the repository's create,
  import and update, and the onboarding submission and resubmission. Field Settings' `usedBy` for
  those lists carries the reference (`idField`), so a rename rewrites by it. Not moved: the employee
  status, which eight code paths write on their own and which stays a name until they share one
  writer; the interview candidate's position, department, source and employment type; and the
  readers, which still filter on text (Stage 8).
- **D37 (2026-09-24) The lead's children are keyed to the lead, the CRD document to its project; the
  sheet ledger deliberately is not.** In two steps. `20260924130000` keyed the occasion rows and the
  watch row, which always carry a lead. `20260924150000` keyed the rest with the rules the
  application's own delete (`purgeLeads`) already followed: a project, a quotation or a CRD document
  raised against the lead **refuses** its deletion (RESTRICT - a booking is created with an enquiry,
  always, so its column allows NULL only so a legacy row with a blank or unknown one cannot block the
  key; `npm run report:lead-keys` lists such rows); a meeting, a WhatsApp group name and a call
  transcript **go with** the lead (CASCADE), and the CRD document goes with the project it was
  collected for, which had no key at all - and a document raised by hand for a project that answered Not Applicable is now linked to that project on creation (older ones backfilled where one live project carries the enquiry), the register telling the two kinds apart by the project's answer rather than by the link. "" had meant "no lead" and became NULL; the transcript
  writer stores nothing rather than "", and a quotation, a document, a group name or a transcript may
  still exist with no lead. `purgeLeads` lists group names and transcripts among the owned tables
  now, and unlinks only the runtime call-log table, which has no key. `sales_google_sheet_row` gets
  no key on purpose - it is the memory that survives a deleted lead so the sync does not import it
  again, and a key would delete or blank exactly that memory. D30 and D33 can now answer through the
  relation instead of per row, which is the follow-up this makes possible.
- **D38 (2026-09-24) A row remembers the names it gave up, and the matcher honours them.** D35
  rewrites every copy inside the database; a Google Sheet or CSV still holding the old name is
  outside it, and on the next sync the stale cell matched nothing and was written back as text with
  `branch_id = NULL` - the rename undone one sync at a time. `branch.aliases` and `employee.aliases`
  (JSON lists, `20260924140000`) are written by `renameBranchCopies` / `renameEmployeeCopies` at the
  moment of the rename, and `referenceMatchers` resolves a former name to its row (`kind: "alias"` /
  `"former-name"`) after every current name has had its chance: a former name somebody holds now is
  theirs, one two rows gave up is ambiguous. `refs.branchName` then rewrites the cell's text to the
  current spelling, so a sync *repairs* a stale sheet rather than the reverse. The branch code is
  accepted as well (`kind: "code"`), and the list also takes the studio's own spellings ("Tirupur").
  The hard-coded `BRANCH_ALIASES` map stays as it was, by the tripwire in `branch-alias-vizag.test.js`.
- **D39 (2026-09-24) A read returns the linked name; the stored text is the fallback.** Stage 8's
  reading half, done once rather than ninety times: `services/resolvedNames.js` is a Prisma client
  extension applied in `config/db.js` that, for every model carrying a text copy beside a reference,
  asks for the referenced row on every read and writes its name over the text before the rows are
  handed back - under the same key, so no screen changes - and leaves the text alone where the
  reference is NULL. A relation the caller asked for stays; one the rule asked for is removed again.
  Only the top level of a query is resolved (a lead inside a meeting's `include` is not). The raw SQL
  readers follow the same rule written in SQL - `RESOLVED_LEAD_SQL` in `crmLeadService` behind
  `CRM_LEAD_SELECT_LIST` and the board's page query, the bell's follow-ups, the call report's CRM
  column - as correlated subqueries on the reference, with the text as the fallback. Remaining text
  readers: the reports that group leads by `crm` or `assigned_branch` text, and the sheet sync's
  own compare of a cell against the stored text, which is what keeps the text a copy for now.

## Open questions

- The matching rule for `assigned_branch` "Erode" against `branch.name` "Erode TN" (and each
  other free-text branch column). Nothing is written until the report is approved.
- One of the three active logins has no `linkedEmployeeId`. Moving `HrmTask` assignment to
  `Employee` means that login cannot be given a task; how it is handled is decided, not assumed.
- Rows whose owner matches no employee under TEAM / SELF: invisible (safe, but live leads vanish)
  or visible to all (nothing disappears, but the scope has a gap).
