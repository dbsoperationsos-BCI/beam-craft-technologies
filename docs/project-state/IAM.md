# Identity and Access Management

How the studio decides who can see and change what. Administered from **Administration → Users &
Access** (`/admin`).

## The chain

```text
User  →  Role  →  Permission
        (many)   │
        branches ┘  where those permissions apply
```

A user carries as many **roles** as they need, and a role holds its **permissions** directly. There
is no layer in between: the user-group layer was removed once branch reach moved onto the role.

A **permission** is one thing you can do in one module, for example `HRM / Employee Referral`. Each
grant carries an access level: **Disabled**, **Read**, or **Read / Write**. Whose *rows* it gets is
not a setting — see [Whose records](#whose-records).

A role also names the **branches** it reaches. Everything it grants applies in every branch listed,
which is how one person works across several: someone in Chennai carrying a role that names Chennai
and Bangalore has that role's permissions in both.

### Branch reach belongs to the permission, not to the person

**A role's branches apply to the permissions that role grants, and to nothing else.** Somebody may
hold `SALES / CRM Leads` across all six branches through one role and `ASSET / Asset Management` in
Coimbatore through another. Those are two statements about two different jobs: they reach six
branches *for leads* and one *for assets*, and the branch picker on each screen offers accordingly.

This used to be one answer per person — the union of every branch every role named — so the widest
role somebody held silently widened all the others, and the person above got every branch's assets
as well. Every call into the branch API now names the `{ module, feature }` it is asking about:
`reachableBranchIds`, `reachableBranches`, `buildBranchFilter`, `canAccessBranch`, `canUseBranchId`,
`canUseBranchName`, and the `checkBranchAccess` guard, which refuses to be built without one. A
caller that genuinely means "anywhere at all" passes `{ anyRole: true }`, and exactly three do: the
shared branch list at `/api/hrm/branches` and its `/locations` alias, which fills pickers across the
application and so can name no single permission (the **save** is guarded per module instead); the
two unscoped helpers under `/api/user`, which describe the account rather than narrowing a screen;
and the assistant's access context, which describes the person to the model while every read it makes
is narrowed by `dataScope`.

Two rules follow, both deliberate:

- **A role that names no branches contributes none.** It is not read as "all of them". Role
  Management refuses to save a role without at least one branch, so this only arises for rows that
  predate that rule — and a role that has never said where it applies says nothing, not everywhere.
- **A person's own `user.branch_id` is not added.** It used to be, on the argument that losing the
  branch you were put in would take away access you already had. That is what made a restriction
  unenforceable: a role saying "Coimbatore only" still showed an Erode-based person the whole of
  Erode, so "one branch" was never true for the one branch that mattered most to them.

Being narrowed to no branch is **not** being shown nothing. `dataScope` still gives everybody the
work their own name is on and their team's; it is the *widening* past that which the roles control.

And the two questions are answered by two different permissions where a screen asks both. *Where may
you use this screen?* — the screen's own permission. *Whose work may you see that is not your own?* —
`ADMIN / Branch Administration`, and so the branches of the roles granting **that**, since that is the
permission whose whole job is the question. Reading the second off the screen's permission would let a
role that merely grants a screen in six branches hand somebody every colleague's records in all six.


## Admin Permission — the set every Branch Admin carries

A second tick beside Administrator marks a role as a **Branch Admin**, and every role carrying that
tick also carries one shared permission matrix: the **Admin Permission** set, edited once from the
button of that name on the Roles page.

**One set for the studio, not one per role.** A branch administrator in Erode and one in Bangalore
do the same job in two places; what differs between them is the branch list on their own role, which
this does not touch. So the studio decides once what the job may reach, and changing it changes what
every branch administrator may do — at once, without a single role being re-saved. The editor says
so, with the number of roles affected, before it saves.

It is read in `IAMService.getUserPermissions` and merged through the same
`_mergeMostPermissive` every other grant goes through, which means **it can only ever widen**. A role
already granting `SALES / CRM Leads` at `READ_WRITE` keeps `READ_WRITE` when the set names it at
`READ`; the set adds what the role does not hold and never lowers what it does. A deactivated role
grants nothing, the shared set included.

**Ticking it fills the matrix below rather than hiding behind a flag.** A tick that silently granted
eleven permissions with nothing on screen would leave the role editor unable to answer the one
question it exists for. So the set is merged into the modules on screen, exactly as the server
merges it — and because those grants are really there, **editing any module detaches the role from
the set**: the tick clears and what is on screen stays as that role's own permissions. The moment
somebody's access differs from the shared set they are not carrying the shared set any more; they
are a person with their own list.

**The tick carries `ADMIN / Branch Administration` itself**, on top of the set. That permission is
what *makes* a branch administrator one — it is the widening from the work your own name is on to
every record in the branches your roles reach — so being marked Branch Admin and not holding it was
a contradiction the Roles page had no way to show. It used to be an ordinary row in the matrix,
under a name ("Administer Branches") that reads like the right to edit the branch register, which is
`SETTINGS / Organization` and something else entirely; studios ticked the box, watched nothing
change, and could not see why.

So it is granted by the tick and by nothing else. `GET /api/admin/permissions` leaves it out, which
closes the role editor **and** the Admin Permission dialog at once, since one response feeds both,
and `writeRoleMatrix` drops it from anything a payload sends by hand. It is merged most-permissively
like every other grant, at `READ_WRITE`, so it can only widen. A role granted it before the tick
carried it keeps it: the matrix is replaced whole on every save, so `writeRoleMatrix` carries across
the permissions the editor was never offered rather than revoking them silently. See
[Whose records](#whose-records).

Stored in `branch_admin_permission`, one row per permission granted
(`20260919150000_branch_admin_permissions`). Empty on arrival: a new installation grants nobody
anything through it until somebody saves a set, which is the direction it has to fail in.

## Administrator

`Role.isAdmin` — true of a role that grants **every** module at `READ_WRITE`.

**There is no longer a tick for it.** Role Management used to offer one at the top of Action
permissions that settled every module in one move; it was removed once Branch Admin arrived, because
two one-click ways to hand out sweeping access is one more than the screen can explain. A role that
needs everything is now built from the module dropdowns like any other, or given the shared
[Admin Permission](#admin-permission--the-set-every-branch-admin-carries) set.

The flag itself stays, and is still **derived rather than stored beside the permissions**:
`toPayload` computes it from the matrix on every save, so it and the rows cannot disagree. Lower one
module and the role stops reporting itself as an administrator, because it is no longer one.

It is not a kind of access, and nothing grants anything because of it — the `RolePermission` rows do
that. What reads it is the WhatsApp gate, which never holds an administrator at the link screen
(`whatsappStanding`), and Role Management's own Type column. In particular it does **not** cross a
branch: what the role grants applies in the branches selected on the role, and only a `SUPER_ADMIN`
is unbounded by branch.

## Where two grants disagree

The strongest wins. Being reached twice is normal — two roles can name the same permission — so the
levels are ranked `DISABLED < READ < READ_WRITE` and the highest is taken.

A **No access** row means *this grant gives nothing here*. It never takes away what another grant
gave. To remove access, remove the grant that provides it.

Deactivating a **role** withdraws everything it granted, from everyone carrying it.

Implemented in `IAMService._mergeMostPermissive` in
[backend/src/services/iam.service.js](../../backend/src/services/iam.service.js).

## Whose records

A permission answers *may you open this screen*. This answers *whose rows you get*, and there is one
answer for everybody — no setting, per role or otherwise:

> A record is yours if your **name** is on it, or if the name on it belongs to somebody who
> **reports to you**, at any depth.

"Your name" includes the one every record carries: whoever **created** it. An asset in Visakhapatnam
assigned to somebody whose roles reach only Erode is still theirs to see — and an asset assigned to
a colleague is not yours just because you both reach its branch. Reaching a branch is not a claim on
the work of the people in it: it says where you may file records and which branches a picker offers
you.

Two permissions widen a person past their own name, and both are deliberately granted.
**`ADMIN / Branch Administration`** gives every record belonging to the branches the role reaches, in
every module. **`PROJECT / Show All Projects`** gives the same thing for the project register alone:
the projects of the branches the role reaches, named on them or not.

The second one deserves its history. `PROJECT / All Projects` was once a module-level widener, and it
was **retired** because it was a second answer to the same question — a person named on one project
was shown four and nothing said why. `Show All Projects` is that idea brought back deliberately and
narrower, and it is worth being clear about why it is not the same mistake:

- it is **branch-scoped**, not "all". A role naming some branches sees those; naming every branch
  sees them all; naming none sees **nothing** (`in: []`), which is the direction an empty list has to
  fail in, or the weakest grant in the system becomes the widest. A Super Admin reaches no branch
  limit and sees everything. That is the same reading `ADMIN / Branch Administration` uses, through
  the same `reachableBranchIds`, so the two do not disagree about what a branch is;
- it exists because the *alternative* over-grants. Editing a project belongs to the people it is
  staffed to and starting one to the same, and a **Yet to Start project is staffed to nobody** — so
  a freshly booked project could be started only by a branch administrator. Granting somebody
  `ADMIN / Branch Administration` to fix that also hands them assets, leads, cash, payment requests
  and tasks for those branches. This is the projects-only version of that trust.

A Super Admin is narrowed by nothing.

**What reads it:** Asset Management, CRM Leads and its reports and dashboard, the project register
(Sales Manager, Quotations, CRD Documents, the four project boards), Cash Management, Payment
Requests, All Tasks, saved WhatsApp group names — the screens and the assistant's tools alike, on
the same columns, so both answer with the same rows. Employee Repository and the Image Selection
screens do not narrow yet.

Two modules keep a tighter rule of their own, and the rule narrows those rather than widening them:
a **payment request** is the requester's own until somebody who may decide it looks, and a **task**
is always readable by the two people it is between.

Which columns each module counts as your name, and the four rules the resolver holds to, are in
[DATA-SCOPE.md — The rule](DATA-SCOPE.md#the-rule).

## Branches

Every user has a home branch, and it is always reachable.

Where a person can *work*, though, is decided by the roles they carry. `reachableBranchIds(userId)`
is their own branch plus every branch named by a role they carry, and
`buildBranchFilter(userId)` turns that into the `where` fragment a list query needs — a single
`branchId` when there is one, `{ branchId: { in: [...] } }` when there are several.

A **Super Admin** has no branch (`branchId` is null); `reachableBranchIds` returns null for them and
the filter is empty, so they see every branch.

A user's own branch is always reachable, whether or not a role names it — losing it because no role
happened to mention it would take away access they already had.

### Where a branch can be chosen

**Every branch picker offers only the branches the chooser reaches**, and every save that names one
is checked against the same list. `reachableBranches(userId)` is what a picker is drawn from and
`canUseBranchId` / `canUseBranchName` is what a write is judged by — the second is not optional
politeness: narrowing a dropdown is cosmetic while the request can still be sent by hand.

| Where | List narrowed | Write refused |
| --- | --- | --- |
| `GET /api/hrm/branches` (Roles, Users, Assets) | Yes | — |
| Cash entry Branch | Yes | Yes, by name |
| Payment request Branch | Yes | Yes, by name, on the one branch a requester chooses |
| Project Source Branch | Yes | Yes, by name |
| Asset Branch | Yes | Yes, by id |
| A user's home branch, and a role's branch list | Yes | Yes, by id |

A super admin reaches every branch and is narrowed by none of it. Somebody reaching no branch is
offered none, which is the honest answer rather than one to paper over with the full list.

Two of those deserve their reason stated. A **role's branch list** is checked because an
administrator hands out reach and cannot hand out more than they have — a branch manager given the
Users screen was otherwise one request away from granting themselves another branch. A **payment
request's** branch is checked only in the one case the requester picks it: the other two are read
off a project's source branch or an employee's work base, and are the answer whether or not the
requester could have chosen them.

Managing the branch list itself — adding, renaming, deactivating a location — is unnarrowed and
stays with `HRM / Employee Management` `READ_WRITE`.

### What the branch list actually narrows in the *data*

**Only `User`, `Asset` and now `Employee`.** Those are the tables carrying a `branchId` foreign key
that a filter can name, and the Users screen and Asset Management are the two screens that honour a
role's branch list. `Employee.branchId` is NULL for everyone recorded before it existed and stays so
until the match report backfills it; the assistant's HRM tools honour it where set and fall back to
the two work-location texts where not (see below), and no HRM screen narrows on it yet.

Everywhere else the branch is stored as free text (each now with a `branchId` beside it, NULL
until the match report is approved — [DATA-SCOPE.md](DATA-SCOPE.md)) — `SalesCrmLead.assignedBranch`,
`SalesProject.sourceBranch`, `CashEntry.branch`, `PaymentRequest.branch` are all `String` — and the
filter produces `{ branchId: 3 }`, an integer against a foreign key. It cannot be pointed at a text
column, so those queries are not scoped and cannot be until the columns become real branch
references.

So a role naming one branch still grants its CRM, Sales, Accounts and Image Selection permissions
across **every** branch's records. This is not a permission hole: permissions correctly answer "may
you read leads". It is that "whose leads" has no answer outside those two tables. Do not describe a
role's branch list as isolating a new module's data until that module's rows carry a `branchId`.

## Who sees which records

A permission answers *may you open this screen*. It does not answer *whose rows do you get*, and the
two are decided in different places. Three mechanisms narrow a list, and most modules use none of
them — a screen with no entry in the two tables below shows **every record in the studio to everyone
who may open it**, which is usually right for a studio this size and is always worth knowing.

1. **Branch** — `buildBranchFilter(userId)`, which only works on the two tables carrying a `branchId`
   foreign key. See [What the branch list actually narrows in the data](#what-the-branch-list-actually-narrows-in-the-data).
2. **Ownership** — a `where` naming the signed-in user, usually widened to the whole queue by a
   second permission.
3. **Per source** — a screen that reads several modules asks each one's own permission, and shows
   the sources the viewer holds rather than refusing the page.

### Branch-scoped: two screens

| Screen | Filter | Effect |
| --- | --- | --- |
| Asset Management | [The rule](#whose-records) — assigned to you or your team, managed by you or your team, or in a branch you reach | Read-one, update, delete, status and inspections are held to the same rows as the list. Seeing a row is not being allowed to change it: [what you may do to one asset](#one-asset-at-a-time-who-may-change-it) is decided per row on top of this |
| Employee Repository | The branches the role reaches, **without** Branch Administration, plus yourself and your reports, plus everybody being onboarded | [The one exception](#the-one-exception-the-employee-repository) |
| Users (`/admin/users`) | `buildBranchFilter` on `User.branchId` | The accounts in the branches you reach, counted before paging so the footer is honest |

Reachable branches are your own plus every branch named by any active role you carry — plural, not
"your branch". Nothing else is branch-scoped, however a role's branch list reads.

### The one exception: the Employee Repository

`HRM / Employee Management` declares `branchOnReach` on its scope columns, which means **the
branches ticked on a role open this register by themselves** — no `ADMIN / Branch Administration`,
and ticking every branch shows everybody who has one.

It is the only module that does this, and the reason it is allowed to is the reason the rule exists
elsewhere. "Reaching a branch is not a claim on the work of the people in it" is about *work*: a
colleague's leads are not yours because you both file against Erode. A register of **who those
people are** is not work — it is the studio's own shape, which is why the employee *directory*
(`GET /employees/directory`) needs no permission at all. A module reaching for `branchOnReach`
should be sure it is describing people rather than what they have done.

Two consequences worth knowing. A reader reaching **no** branch still gets themselves and everybody
reporting to them, at any depth — the branch limb has nothing to open, and the floor is unchanged.
And `ADMIN / Branch Administration` neither adds nor narrows anything **here**; it still decides
every other module.

**Everybody still being onboarded is visible to every holder of the permission**, whatever branch
they reach. A hire at *HR Onboarding Pending* or *Employee Submission Pending* has no branch yet,
usually no work location and no reporting line — the form that answers those questions is the one
still being filled in. Under the branch rule alone such a row is reachable by no branch and named on
nobody, so it was invisible to everyone but a Super Admin, and the onboarding could not be done by
the people whose job it is. They are a queue of work rather than somebody's record, and the
exception ends the moment the form is completed and they have a branch like everybody else. It is
the **status** that is excepted, not the missing branch: an Active employee with no branch is not
shown, because "no branch yet" must not become a way of being visible to everybody. See
`employeeVisibility` in `backend/src/modules/hrm/employees/controller.js`.

### Ownership-scoped: five screens

Each shows you your own until a second permission opens the rest. The narrow side is the default, so
a role granted nothing extra still sees its own work.

| Screen | You see | Widened to everything by |
| --- | --- | --- |
| Asset Requests | Requests you raised (`requestedBy = you`) | `ASSET / Asset Request Approval` READ, which also carries Accept and Reject |
| Payment Requests | Requests you raised, matched through `User.linkedEmployeeId` | `ACCOUNTS / Payment Request Approval` READ_WRITE — then narrowed by [the rule](#whose-records) |
| Tasks | Tasks given to you, and tasks you gave — always | `HRM / All Tasks` READ, on its own endpoint, narrowed by [the rule](#whose-records) |
| Extra Quotations (`?mine=true`) | What you raised **or** what you are the project manager for | Being Super Admin, or simply not asking for `mine` |
| Employee Referral | Referrals **you made**, and those made by anybody reporting to you — plus whoever entered one on your behalf (`createdByUserId`) | `ADMIN / Branch Administration`, which adds every referral whose **referrer** works in a branch the role reaches |
| Employee Repository | **You** and everybody reporting to you, at any depth — an employee *is* the person, so the name on the record is the row itself (`employee: "id"`) | `ADMIN / Branch Administration`, which adds every employee in a branch the role reaches, matched on `branchId` **or** Work Base Location **or** Current Work Location |

Two details in that table have already caused confusion. Payment Requests resolves ownership through
the **employee** behind the login, so an account with no `linkedEmployeeId` owns nothing and is given
`requestedById: -1` — a filter matching no row, rather than the `undefined` that would have matched
every row. And Tasks decides *who may act* separately from *who may look*: `HRM / All Tasks` widens
reading only, so a supervisor can open a task they are neither side of and is offered none of its
four verbs.

The Employee Repository's branch limb is the one that names **three** columns, and it is why
`columns.branchText` exists on the resolver. `Employee.branchId` is derived on write as Work Base
Location *or else* Current Work Location (`referenceColumnsFor`), so it can only ever hold one of
the two: somebody based in Chennai and posted to Hyderabad carries Chennai alone, and a branch limb
reading the reference hid them from the Hyderabad administrator who actually works with them. The
two texts are therefore matched against the reachable branches' **names**, exactly, beside the
reference — any one of the three is enough. Editing, deleting and reactivating an employee are held
to the same rows as the list and answer 404, for the reason the referral register does.

The referral register's branch limb is the one written through a relation rather than a column.
`EmployeeReferral` has no `branch_id` and deliberately never got one: a referral's branch is the
**referrer's**, so it is read live through `referrer.branchId` and somebody who transfers takes
their referrals with them, instead of leaving a stale copy of where they used to work. The
instalment write is held to the same rows as the list — hiding a row from the register is not
protection while its id can still be sent to the endpoint that marks money paid — and answers 404
rather than 403, so a referral somebody may not read is not one they learn the existence of by
being refused it.

### Per-source: three screens

Contacts, the studio Schedule and the AI assistant each read across modules, and each asks the
viewer's permission **per source** rather than gating the page as a whole. A viewer holding only the
CRM gets the CRM's rows and an honest count; a source that is refused or fails is named rather than
silently missing. Opening one of these is never a way around another module's guard.

### Everything else

**No row scoping at all.** Anyone who may open the screen sees every record in it:

| Module | Screens |
| --- | --- |
| `HRM` | Employee Attendance, master data. **Employee Referral and the Employee Repository are scoped** — see [the rule](#whose-records) |
| `SALES` | — (CRM Leads, Sales Manager, Quotations, Reports & Analytics and `PROJECT / CRD Documents` all read [the rule](#whose-records) now; the duplicate check and the Calls board stay unscoped — DATA-SCOPE.md D14–D16) |
| `PROJECT` | Client Gifts (the project register and its boards read [the rule](#whose-records) composed with the older "named on" rule — DATA-SCOPE.md D15) |
| `IMAGE_SELECTION` | Every screen — projects, folders, uploads, galleries |
| `ACCOUNTS` | — (Cash Management and Payment Requests read [the rule](#whose-records) now) |
| `ASSET` | Vendors, Client Storage |
| `ADMIN` | Roles |

This is a deliberate consequence of the branch columns being free text, not an oversight to be fixed
screen by screen: the permission correctly answers "may you read leads", and "whose leads" has no
answer until `SalesCrmLead.assignedBranch` and its siblings become real branch references. Adding an
ownership filter to one of these is a product decision, not a bug fix.

### The AI tools read on a different path

The assistant does not go through the screens' controllers. Each module has a `read.service.js` that
takes the session's reachable branches and narrows with them, and those **do** attempt branch scoping
where the screens do not — correctly, by matching branch **names** against the free-text column, as
`accounts/cash-entries/read.service.js` does with `branch`. (`hrm/employees/read.service.js` used to
name a `branchId` that `Employee` did not have, and threw for every non-Super-Admin; it reads the
new reference first and the two work-location texts as a fallback, and answers no employees rather
than every employee to somebody reaching no branch.) So the same person can be branch-narrowed
in Nebula and unnarrowed on the screen for the same records. **That inconsistency is now closed.**
Every module's read service — assets, employees, cash, projects, and the CRM's own context — resolves
the same [scope](#scope), on the same columns, as its screen's controller. Nebula and the screen
answer with the same rows for the same person, and the assistant says when its figures are narrowed
rather than presenting a partial count as the studio's.

## Who the Users screen lists

**Administration** (`/employees`) is the whole repository — everyone the studio has taken on,
whatever their employment status. It opens on the **All** tab.

**Users** (`/admin/users`) lists the accounts: `status` `ACTIVE`, whether or not any role has been
given yet. An account is closed by setting `status` to anything else — `INACTIVE` is the value the
app writes — which both drops it off this screen and refuses its sign-in, since login checks for
`ACTIVE` and nothing else.

A user and an employee are **separate records**, joined only by the optional `User.linkedEmployeeId`.
That link is not a nicety: **Employee Attendance**, **Payment Requests**, **Tasks** and the **org
chart** all find the person behind a login through it, and an account without one is refused by all
of them. It is set in two places — automatically, when credentials are created from the Employee
Repository, and by hand from this screen's ⋮ menu (**Link employee**, or **Change employee link**),
which is the only way to link an account that was created any other way, the first Super Admin
included. The picker lists the whole repository and disables anybody already answering for another
login, since one employee answers for one account — a unique index on the column, not just a check.
Clearing the link is allowed, for one made to the wrong person. The rules live in
[backend/src/modules/admin/userEmployeeLink.js](../../backend/src/modules/admin/userEmployeeLink.js);
the picker is served by `GET /api/admin/linkable-employees` under `ADMIN / User Management` rather
than from the Employee Repository's own endpoint, so administering users does not also require
`HRM / Employee Management`.

Removing somebody from the Employee Repository therefore has to close their account as well, and
does: archiving an employee sets any account linked to them to `INACTIVE` in the same transaction.
Their roles are left on the account — closing it is what stops the sign-in, and stripping the grants
too would mean rebuilding them by hand if the removal turns out to have been a mistake. An account carrying none reads `—` in the Roles column and is the one that most needs
listing, because this screen is the only place a role can be assigned — an account created from the
Employee Repository with the Roles section left empty would otherwise be stranded, reachable from
neither screen. A closed account is left out: it cannot sign in, so what it may do is moot.

Applied by `GET /api/admin/users` through its optional `status` query parameter, so
`pagination.total` counts what is actually listed. The endpoint is unfiltered without it.

## One screen's permission is not always enough

`HRM / Employee Attendance` is held by everybody, because everybody marks their own day. That makes
it the wrong guard for anything inside the module that is *not* everybody's business, and two things
in it are guarded a second time in the controller rather than by the router:

| What | Extra check |
| --- | --- |
| Deciding a request, editing the shift and the office locations | Named on the requester's three Leave Approval slots, or `HRM / Attendance Approval` `READ_WRITE` |
| `PATCH /api/hrm/attendance/:sessionId` — HR changing a record directly | `HRM / Attendance Approval`. Appends an `ADMIN_EDIT` audit row; never overwrites a capture |
| `GET /api/hrm/attendance` — the studio-wide register | `HRM / Attendance Approval`. It is also what the **HRM → Attendance Register** menu entry opens |
| `GET /api/hrm/attendance/selfie/:eventId` | The employee the photograph is **of**, or `HRM / Attendance Approval` |

The selfie one is the sharper example. An attendance selfie is a photograph of a named person at a
place at a time, and the router guard alone would have made every one of them readable by every
colleague in the studio. It is asked per capture rather than per day, because that is the unit the
question is actually about. This is also why those selfies are the one kind of image here not served
from the public bucket — they are stored as an object key and streamed through that endpoint, never
handed out as a link. See `R2_PRIVATE_BUCKET_NAME`.

## Roles

| Role | Locked | Notes |
| --- | --- | --- |
| Super Admin | Yes | Full access to every branch. Cannot be edited or deleted — it is the account that restores everyone else's access. Duplicate it to get an editable copy. |
| Branch Manager | No | Runs one branch and administers the people in it. |
| Team Lead | No | Leads a team within a branch. |
| Employee | No | Day-to-day access to their own work. |

Roles are created, edited, deleted and duplicated from **Administration → Roles**. Create role is
one scrolling form, and the permission list opens a level at a time:

1. **Enable a module** — its sub-modules appear.
2. **Tick a sub-module** — its access dropdown appears, starting at Read.

Identification also carries the **branches** multi-select, which decides where everything below it
applies. **At least one is required**, and the server refuses a role that names none rather than
storing it: a role reaching no branch grants nothing anywhere, which reads on screen as its
permissions being broken rather than as a role nobody finished. A role is taken out of use by
deactivating it, not by emptying its branches. Switching a module off withdraws every grant under
it, so the form never holds a grant it has stopped showing. Duplicating copies every grant and every
branch, and the copy is never locked.

Deleting a **role somebody still carries** is refused: it would silently strip access from people
who did not ask for it. Remove it from them first. A Super Admin also cannot delete their own account,
and the last Super Admin cannot be deleted at all.

## Starter roles

The seed ships exactly the four roles above — Super Admin, Branch Manager, Team Lead and
Employee — and no others. Module roles such as "HRM Full" or "Sales Read Only" are made in Role
Management when a studio wants them; nothing seeds them. Only Super Admin is a system role.

Re-running the seed never overwrites a role's grants, so anything edited from the screens stays
edited. See
[backend/prisma/seeds/iam-roles-permissions.js](../../backend/prisma/seeds/iam-roles-permissions.js),
which writes the catalogue in
[permission-catalogue.js](../../backend/prisma/seeds/permission-catalogue.js) beside it.

## Checking permission in code

**Backend** — protect a route with the middleware, which answers 403 with a readable message:

```js
const { checkPermission } = require("../../middleware/permissionMiddleware");
router.get("/", checkPermission("ASSET", "Asset Management", "READ"), handler);
router.post("/", checkPermission("ASSET", "Asset Management", "READ_WRITE"), handler);
```

Scope a list query to the caller's branch:

```js
const branchFilter = await iamService.buildBranchFilter(req.user.id);
const rows = await prisma.asset.findMany({ where: { ...branchFilter, ...otherFilters } });
```

**Frontend** — permissions are fetched once per signed-in session by `PermissionsProvider`, mounted
in the `(app)` layout. A screen almost never has to name its own permission: it asks what it may do
on the page it is on.

```jsx
const { canWrite } = useRouteAccess();          // whichever permission governs this route
const { canWrite } = useModuleAccess("ASSET", "Asset Assignment");  // a second one on the same page

{canWrite && <Button>Add Asset</Button>}
```

Use `useModuleAccess` only where a screen touches a permission that is not its own — Asset
Management reads asset requests, which are a different feature — and `PermissionGuard` where a
section of a page has to disappear wholesale.

A fetch that fails is retried; if the permission set still cannot be loaded, guards close rather
than opening and the page says so. Never treat a failed permission fetch as permission granted.

### Where no module permission applies

Rule 4 says an endpoint anybody signed in can call is an unfinished change, and that is the right
default — but three kinds of route are deliberately outside it, and a reader auditing the code
should recognise them rather than "fix" them:

- **Public tokenised pages** — the client gallery, onboarding apply, the CRD form, password reset.
  They authenticate by token because the person opening them has no account at all.
- **Self-service on one's own account** — everything in
  [backend/src/modules/user/routes.js](../../backend/src/modules/user/routes.js): My Profile, one's
  own photo, one's own password, one's own reporting chart, and `/api/user/preferences`, which keeps
  how this login has arranged the application for itself (column order, hidden and frozen columns,
  column widths, density, remembered tabs). `req.user.id` is the only account any of them touches
  and nothing in a payload may name another, so `protect` alone is the guard.
- **A module belonging to one role outright** — the explicit `req.user.role === "SUPER_ADMIN"`
  checks in the Image Selection controllers.

The test to apply is not "is there a permission on it" but **could a role sensibly be refused
this**. A table layout fails that test: gating it would mean a role could be denied the right to
remember its own screen, and the permission would have to be granted to everybody to be useful,
which is a permission that decides nothing. Anything reading or writing records another person can
also see does not fail that test, and needs its guard.

## The catalogue describes the sidebar

Role Management and the sidebar are drawn from different places. The menu comes from
[`frontend/src/constants/navigation.mjs`](../../frontend/src/constants/navigation.mjs); the role
form comes from the `permission` rows seeded from
[`backend/prisma/seeds/permission-catalogue.js`](../../backend/prisma/seeds/permission-catalogue.js);
and the join between them — which permission each **route** answers to — is
[`modulePermissions.js`](../../frontend/src/constants/modulePermissions.js). Nothing held the three
to each other, and they drifted in all three ways three lists can:

| Drift | What it looked like |
| --- | --- |
| A screen filed under the wrong module | CRD Documents sat under **Project Management** in the menu and under **Sales & CRM** in Role Management, because its permission still said `SALES`. Somebody granting the project screens did not grant it, and nothing said so |
| A screen with no row at all | Contacts and Reports & Analytics both answered for `SALES / CRM Leads`. Role Management offered one row where the menu offered three screens, so the reports could not be given without the lead board behind them |
| A row with no screen | `ACCOUNTS / Payroll Management` guarded nothing at all. Grant it and you have given somebody nothing, and been told nothing |

Three rules close it, and
[`backend/test/permission-catalogue-sidebar.test.js`](../../backend/test/permission-catalogue-sidebar.test.js)
holds all three on every test run — it reads the catalogue and the registry and fails on the change
that introduces the drift, not on the bug report weeks later:

1. **A screen's permission belongs to the module the menu files it under.** If it is under Project
   Management in the sidebar, its permission is a `PROJECT` one. Moving a screen between menu
   sections means moving its permission with it.
2. **One screen, one permission.** No two menu entries may answer for the same row, because a role
   could then never be given one without the other.
3. **A permission that opens no menu entry says why.** Approval verbs, the Administration screens,
   the Settings overlay and `ADMIN / Branch Administration` legitimately have no entry, so each is
   listed in `NO_MENU_ENTRY` in that test with where it is actually used. Anything else fails — a
   grantable permission that leads nowhere is a defect, not a spare.

Two further assertions guard the traps in CLAUDE.md Rule 4: every route in `modulePermissions.js`
names a permission the catalogue has, and every sub-action in `SCOPES` does too. Both had failed
silently — a guard on `IMAGE_SELECTION / Upload & Gallery` (a permission merged away) refused
everybody but a Super Admin, and nine asset and image sub-actions named permissions that no longer
existed and so were seeded to nobody.

### Moving or splitting a permission

The catalogue is upserted on `module + feature + level` and **the seed never writes grants**, so a
permission edited in place there is a *new* row and every grant of the old one is lost. Both kinds
of change therefore need a migration beside the catalogue edit:

- **Moving one to another module** — `UPDATE` the row. Grants point at `permission.id`, so they
  follow it across and nobody notices. `20260909130000` does this for CRD Documents.
- **Splitting one in two** — `INSERT` the new rows and copy the old permission's grants onto them,
  so a role that could open the screen yesterday still can. `20260909130000` does this for Contacts
  and Reports & Analytics. Withholding one of them from a role is now *possible*, which is the
  point, but it is a decision somebody takes rather than one an upgrade takes for them.

## What each access level looks like on screen

### The modules

| Module | Features |
| --- | --- |
| `ASSET` | Asset Management, Asset Administration, Asset Request Approval, Vendor Management, Client Storage |
| `HRM` | Employee Management, Employee Attendance, Attendance Approval, Employee Referral, Task Management, All Tasks, Interview, Interview Select All |
| `SALES` | Sales Manager, CRM Leads, CRM Lead Deletion, CRM Lead Select All, CRM Lead Import, Reports & Analytics, Contacts, Quotation Management |
| `PROJECT` | Projects, CRD Documents, Pre Production, Production, Post Production, Client Gifts |
| `IMAGE_SELECTION` | Project Management, Album Proofing, Album Proofing QC |
| `ACCOUNTS` | Cash Management, Payment Request Approval |
| `ADMIN` | User Management, Role Management, Branch Administration, Table Select All |
| `SETTINGS` | User Settings, Table Settings, Field Settings, Project Settings, Exclude Phone Numbers, Integrations, Quotation Settings, Employee Referral, Message Template, Organization, Holidays, Login Slide, Application Monitoring |

Everything about money the studio pays out is `ACCOUNTS`, including the payment requests whose code
lives under `backend/src/modules/hrm/` for historical reasons. `HRM` is the Employee Repository,
Attendance, Tasks, referrals and the Interview register.

`HRM / Interview` guards the whole of hiring: the **Interview** screen (`/hrm/interview`), every
route under `/api/hrm/interview` — the candidates, their linked Google Sheets and the Google
connection those are read through — and the **Settings → Integrations → Interview** section that
links the sheets. `READ` reads the register; `READ_WRITE` adds, edits and deletes a candidate and
links, syncs and unlinks a sheet. One row rather than several because linking the sheet the
candidates arrive from is a step of the same job, and the two were never going to be granted apart.
The integration routes are the CRM's own handlers mounted a second time behind this permission, so
an HR role links its sheets without holding `SALES / CRM Leads`. Added by migration
`20260918100000`, which also grants it to `SUPER_ADMIN`; every other role that should hold it is a
re-save in Role Management.

`HRM / Employee Referral` guards the whole of referrals: the **Employee Referral** screen
(`/hrm/employee-referrals`), every route under `/api/hrm/referrals`, and the **Settings → Employee
Referral** section, which sets what a referral pays. `READ` reads the register and the
amount; `READ_WRITE` changes the amount and marks an instalment paid.

The screen is no longer a sidebar entry. It is reached from the switch beside the Employee
Repository heading, with Users and Roles — four screens about the studio's people and the access
they hold, under one heading. `frontend/src/constants/rbacSections.js` lists them, and asks the
route map which permission each needs, so a destination a role cannot open is **absent** from the
switch rather than offered and refused a click later. The sidebar keeps one row for all four:
**Employee Repository**, which opens the first of them the reader may read, so granting a role the
referral register alone still leaves it reachable from the menu.

That Settings section is the one place in the overlay gated on something other than the
administrator's own permission, and deliberately: it is offered on `HRM / Employee Referral`
because that is what the routes behind it enforce. A section offered on the wrong `SETTINGS` row
would be a form whose Save the server refuses for the person most likely to be setting it. It was `ACCOUNTS / Payroll
Management` while the register was a section inside that settings panel and had no screen of its
own — the rule that moved it is that a permission is granted where the screen it opens lives, and
that screen is under HRM. **`ACCOUNTS / Payroll Management` now guards nothing**: it remains a row
in the seed, grantable and asked for by no route, as it was before referrals existed. A role that
held it for the referral register must be granted `HRM / Employee Referral` instead — the seed
writes no grants, so this is a re-save in Role Management.

**The Settings overlay is a module, one permission per rail entry.** `ADMIN / System Settings` was
the whole of it behind a single tick — the studio's branding and branches, the message templates,
the quotation brands, the login slide, the holidays and the usage monitoring — so a studio wanting
somebody to keep the message wording had to hand them the branding logo that the top bar, the
sign-in page, every quotation and the client gallery all read. The catalogue now matches the rail:
thirteen `SETTINGS` rows, listed in Role Management under a **Settings** heading of their own rather
than among Administration's user and role screens, because Settings is not Administration — it is
reached from the top bar by everybody. Migration `20260915190000` copies every existing
`ADMIN / System Settings` grant onto all thirteen and deactivates the old row, so a role that could
open Settings before opens exactly as much of it now, and withholding one section is a decision
somebody takes rather than one the upgrade takes for them.

Two things about that split are worth stating, because both are deliberate:

- **User Preference has no row and must not get one.** The sidebar order and the appearance are one
  person's own, stored against their account and read by nothing else. A role that could be refused
  the right to arrange its own screen is not a permission anybody wants to be able to grant, which
  is the same reasoning that keeps `/api/user/preferences` behind `protect` alone.
- **Seven sections need their owning module's permission as well**, and the Settings row can only
  withhold them, never open them: Table Settings and Exclude Phone Numbers and Integrations → Sales
  also need `SALES / CRM Leads`, Integrations → Interview also needs `HRM / Interview`, Field
  Settings also needs `HRM / Employee Management`, Project Settings also needs `PROJECT / Projects`,
  Employee Referral also needs `HRM / Employee Referral`. Their endpoints belong to those modules
  and are shared with screens outside Settings — the CRM board, the Interview register, the
  employee forms, the project register, the referral page — so narrowing them to a Settings row
  would take those screens with them. That is the trap in [The catalogue describes the
  sidebar](#the-catalogue-describes-the-sidebar): a screen may not be given a finer permission than
  an endpoint it shares. The descriptions on those rows say so, so whoever grants one is told. The
  Integrations group itself appears only for a reader holding its row **and** at least one of the
  two modules; each entry under it is offered on its own module's write.

**Retired.** `ACCOUNTS / Payroll Management` is gone (migration
`20260909130000_permissions_match_the_sidebar`). A permission that opens nothing is not harmless: it
is offered in Role Management like every other row, so somebody grants it, believes they have given
somebody payroll, and has given them nothing. The rule that replaced it is the one in
[The catalogue describes the sidebar](#the-catalogue-describes-the-sidebar) below — a permission
either opens a screen the menu lists, or says in one place why it does not.

**Deleting a CRM lead is a second question on top of `SALES / CRM Leads`.** That permission decides
who may work the board — a status, a follow-up date, a remark, an assignment. Who may *destroy* a
lead is `SALES / CRM Lead Deletion`, and Read / Write on it is what grants it; Read grants nothing,
because there is no reading a deletion. It was split out because a delete takes the lead, its
remarks, its call logs and its follow-up history with it and nothing brings them back, while the
board offers a select-all over a whole vertical — one ticked header and one menu item was the branch
gone, for everybody who could edit a lead at all. Both `DELETE /api/sales/crm-leads/bulk` and
`DELETE /api/sales/crm-leads/:id` mount it: gating the selection alone would leave the same act
available a row at a time. Like the started-project guard it is a permission rather than a role test
in the controller — a Super Admin passes because they hold every permission and nothing has to name
them, and a role check below the router's guard would silently overrule it and be grantable to
nobody. **The seed writes no grants**, so after reseeding only a Super Admin can delete a lead until
the roles that should have it are re-saved in Role Management. On screen a role without it is offered
no Delete at all — not the button over a selection, not the row menu's, not the right-click menu's.

**Selecting leads and importing a file are two more questions on top of `SALES / CRM Leads`**, split
out for the same reason and read the same way: Read / Write grants them, Read grants nothing, and
the seed writes no grants — after reseeding only a Super Admin selects or imports until the roles
that should have them are re-saved in Role Management.

- **`SALES / CRM Lead Select All`** is the column of tick boxes on Leads & Followups, header and
  rows alike. The boxes themselves change nothing; everything they lead to is a write over a set
  the reader never has to look at — **Update Details** rewrites a status, the follow-up dates or an
  assignment across a whole vertical, and the bulk delete takes the board with it. So the guard is
  on what a selection *does*: `POST /bulk-status`, `POST /bulk-assign`, and
  `DELETE /bulk`, which mounts this **and** `CRM Lead Deletion` because a delete over a selection is
  both acts at once. It is deliberately **not** on `GET /api/sales/crm-leads/ids`, which resolves a
  whole-board selection into ids: the Quotation Generator reads that same route to fill its Enquire
  ID picker, and a screen may not be given a finer permission than an endpoint it shares — the trap
  in CLAUDE.md Rule 4. Reading ids the caller may already read is not the privileged act; rewriting
  them all at once is. On screen a role without it has no tick boxes at all, so there is no
  selection to offer either button over, and it works the board a lead at a time.
- **`SALES / CRM Lead Import`** is ⋮ → **Import**, the CSV, and `POST /import-csv` with its cancel
  route. A file lands as many leads as it has rows, from a source the studio did not type. ⋮ →
  **Bulk Entry** beside it stays on the board's own Read / Write and is what a role without this
  still has: typing a handful of leads is adding leads, which is the job `CRM Leads` is granted for.
  A role without it sees a ⋮ menu holding Bulk Entry alone.

**Acting on a whole stage of the Interview register at once is a question of its own**, split out
of `HRM / Interview` for the reason the two above were split out of `SALES / CRM Leads`: working a
register one candidate at a time and rewriting a stage of it in one press are different jobs.

- **`HRM / Interview Select All`** is the column of tick boxes on the Interview table, header and
  rows alike. Read grants nothing — there is no reading a selection — so it is a Read / Write row or
  no row at all, and the seed writes no grants, so after reseeding only a Super Admin selects until
  the roles that should have it are re-saved in Role Management. The guard is on what a selection
  *does*: `POST /api/hrm/interview/candidates/bulk-status` and
  `DELETE /api/hrm/interview/candidates/bulk`. The single-candidate routes beside them —
  `PATCH /candidates/:id/status`, `DELETE /candidates/:id` and Bulk Entry's own
  `POST /candidates/bulk` — deliberately keep the screen's own Read / Write, which is what a role
  without this still has: the register worked a row at a time through the ⋮, and a handful of
  candidates typed into Bulk Entry. On screen a role without it has no tick boxes at all, so there is
  no selection to offer either button over and the action bar stays Add Application and its ⋮.

**Ticking rows on every *other* table is one permission, not twenty.** `ADMIN / Table Select All`
Read / Write is the general case the two rows above are the special cases of: it turns the tick
boxes on wherever a table draws them, and guards the two acts a selection then leads to — exporting
the ticked rows, and deleting them together.

- **One row rather than one per table.** The alternative was twenty-odd `<Module> Select All`
  permissions asking the studio the same question twenty-odd times, and a role that should be able
  to tidy up after itself needing every one of them ticked. The existing two stay where they are:
  each guards routes that do more than delete — a stage moved across a set, a vertical reassigned —
  so folding them in would widen what one tick grants.
- **It is a second permission on top of the screen's own, never a replacement.** A holder still
  only sees the tables their other permissions open, and a bulk delete asks for this **and** the
  Read / Write that deleting one of those rows already needs — so it cannot become a way around a
  screen somebody may only read. Read grants nothing: there is no reading a selection, so it is a
  Read / Write row or no row at all.
- **It never widens which rows are yours.** Every `DELETE …/bulk` route runs the module's own
  single-row delete once per id — `deleteAssetRecord`, `removeEmployee`, `deleteProjectRecord` —
  so every rule that refuses one row still refuses it here: an asset outside your branches, an
  employee still holding a camera, a project you do not manage, a system role, your own account,
  the last Super Admin. The refusals are counted rather than thrown: the selection loses exactly the
  part that was yours, the rest stays ticked, and the message says how many were left alone. The
  shared runner is [`services/bulkDelete.js`](../../backend/src/services/bulkDelete.js), which
  mounts this permission itself so a router cannot be wired without it.
- **On screen** a role without it has no tick boxes on any table, no bar, and works every register a
  row at a time exactly as before. A role with it, on a screen it may only *read*, gets the boxes
  and **Export** — and no Delete. The seed writes no grants, so after reseeding only a Super Admin
  selects until the roles that should have it are re-saved in Role Management.
- **Some tables offer Export alone**, because they have no delete to offer: Contacts, Employee
  Referrals, Client Gifts, CRD Documents, Meetings, the attendance registers and Payment Requests
  are read from records other modules own, or are worked by status rather than by deletion. Giving
  them a Delete would be inventing a destructive act on a screen that never had one.

**A project belongs to the people working to it, and that decides who may change or delete the
record itself — two questions, not one.** `PATCH` and `DELETE /api/sales/projects/:id` — the
booking's own details, and deleting the project — are decided per record in `requireProjectEditor`
and `requireProjectDeleter`, which share one lookup and differ in what they then ask:

- **Changing** it is for anybody the project is *staffed to*: its **Project Manager**, its **Pre
  Production Coordinator**, its **Creative Manager**, its **Post Production Coordinator**. Each is
  working to the project and each has reason to correct what it says. The list is
  `PROJECT_STAFF_FIELDS`, written once and read by both rules.
- **Deleting** it is for its **Project Manager** alone — `PROJECT_STAFF_FIELDS.slice(0, 1)`, so the
  two can never disagree about which column names the manager, which makes the *order* of that list
  load-bearing. A coordinator runs a stage of the work; removing the project out from under
  everybody else working to it is not a stage of anything.

A holder of **`ADMIN / Branch Administration`** passes either, which a Super Admin holds along with
everything else. Both used to answer to `SALES / Sales Manager` `READ_WRITE` alone — the permission
that *books* a project — so the CRM who typed a booking could rewrite it long after the studio had
begun working to it, and could delete it outright. Making a project and unmaking one are not the
same act. The permission layer is `checkAnyPermission` over the sale's write **or**
`PROJECT / Projects`' write, because one endpoint feeds two screens — Sales Manager and Project
Management's Projects — and a screen may not be given a finer permission than the endpoint it reads;
a coordinator works the plan and need not hold the sale's permission at all. Unlike
`requireStartedProjectEditor` below, neither has a **Yet to Start escape**: a project that has not
started is staffed to nobody, because every one of those fields is filled in on the Start Project
form rather than the booking form, so until somebody is named the branch administrator is the only
answer to either.

**A started project is a second question on top of `PROJECT / Projects`.** That permission decides
who may plan projects; who may change *one particular* project once it has started is decided per
record, in `requireStartedProjectEditor` — its **Project Manager** (the employee behind the login),
or a holder of **`ADMIN / Branch Administration`**. It is a permission rather than a role test on
purpose: a Super Admin passes because they hold every permission, so nothing has to name them, and
a role check inside a controller would sit below the route's guard and be grantable to nobody. The
guard reads the project through the caller's own data scope, so a project they cannot see answers
404 from the guard itself rather than a 403 that would confirm it exists — and never reaches the
shoot and allocation handlers behind it, which look their rows up by project id alone.

`SETTINGS / Organization` guards the studio's own name, logo and branches, which includes the branch
**register** — `GET`, `POST`, `PATCH` and `DELETE /api/admin/branches`, behind Settings → Organization
→ Branches. Reading the branch *list* is a separate thing and stays open to any signed-in session
through `GET /api/hrm/branches`, because every branch picker in the application fills from it:
Role Management, User Management, Assets, the CRM. Choosing a branch is everybody's; maintaining
the register is an administrator's.

The same permission guards **Settings → Quotation Settings** — the studio's shared quotation content
(General) and each quotation brand's (Dum Dum, Qua Qua, Corp) terms and the pictures and words on
its PDF, behind `/api/sales/quotation-brands/admin/*` (the brand-master routes for services, deliverables,
packages and pricing sit behind the same guard, though the screen no longer offers them). It is an administrator's permission rather than a new
`SALES` feature on purpose: configuring what a quotation may contain is the same job as configuring
the Global Logo or the branch register, and a permission nobody would grant apart from that one
would only be a row in Role Management that decides nothing. *Reading* a brand's configuration is a
different question — the Quotation Generator has to load it for whoever raises quotations — so
`GET /api/sales/quotation-brands` and `GET .../:code/configuration` answer for `SALES / Quotation
Management` READ **or** `SETTINGS / Quotation Settings` READ, and `PUT /api/sales/quotation-settings`
(the studio rates, now edited from Quotation Settings → General) accepts either write. Nothing
here decides whose *quotations* somebody sees: that stays with Quotation Management and the data
scope, and a brand switched off in Settings hides nothing already raised.

`SETTINGS / Organization` guards the studio's own name, logo and branches, which includes the branch
**register** — `GET`, `POST`, `PATCH` and `DELETE /api/admin/branches`, behind Settings → Organization
→ Branches. Reading the branch *list* is a separate thing and stays open to any signed-in session
through `GET /api/hrm/branches`, because every branch picker in the application fills from it:
Role Management, User Management, Assets, the CRM. Choosing a branch is everybody's; maintaining
the register is an administrator's.

`HRM / Task Management` is the Tasks screen, and it is the one permission in the application meant
to be granted to **every** role: the module exists so that anybody in the studio can ask anybody
else to do something. `READ` reads My Tasks and Tasks Given and nothing more; `READ_WRITE` gives a
task, and completes or sends back one you were given. The two are not split further on purpose — a
role that could be given work but could not say it had done the work would be worse than no access,
so `READ_WRITE` is the ordinary grant and `READ` is the rare view-only one.

`HRM / All Tasks` (`READ`) is the third tab, and only that: reading the whole studio's list rather
than your own two. It is a separate permission on a separate endpoint — `GET /api/hrm/tasks/all`,
which asks for both it and Task Management — because a tab over the shared list route would have
served every task in the studio to everybody holding Task Management and left the tab as decoration.
It widens reading alone: a supervisor can open a task they are neither side of and is offered none
of its four verbs, because completing belongs to the person a task was given to and cancelling to
the person who gave it.

Who may act on a task is **ownership, not permission**, and is answered per task by the server
alongside the row. No access level can make somebody the receiver of a task, so no role check
appears in those controllers — a `req.user.role` test there would sit below the route's guard and
overrule it.

**Deleting a task is the one place a role counts, and it counts only to widen.** `DELETE
/api/hrm/tasks/:id` is guarded by `HRM / Task Management` `READ_WRITE` like every other write on the
screen, and the service then narrows it to the task's **giver** — or a **Super Admin**, who may
delete one they are on neither side of. It is not a permission of its own: deleting is for a task
that should never have been raised, which is the giver's own mistake to take back, and a role that
could delete other people's tasks is not something Role Management should be able to hand out. The
role is read in the service beside the task's two people, never in the controller, and it widens
that one verb: a Super Admin may not start, complete, reassign or cancel somebody else's task, and
the tests state that directly. The row carries `canDelete` alongside `canStart`, `canComplete`,
`canReassign` and `canCancel`, so the menu offers exactly what the server would allow. The bell in the top bar answers for `HRM / Task Management` as well, since every notice
the application currently writes is about a task; a role without it keeps the plain bell rather than
one that opens on an empty panel.

`IMAGE_SELECTION / Project Management` is Image Selection itself: the dashboard, projects, folders,
settings, uploads, the gallery and publishing to the client. `READ` browses — the dashboard and its
filtered Projects links included — and reads a published link; `READ_WRITE` changes any of it, and
is the only level offered New Project on the dashboard.

`IMAGE_SELECTION / Album Proofing` is a separate job with its own routes under
`/api/image-selection/album-proofs` and its own screen at `/image-selection/album-proofing`: its
projects, albums, page uploads, corrections and client publication, none of which need Project
Management. `Album Proofing QC` is the QC lead's grant — `READ` opens the albums, `READ_WRITE` rules
on them — and grants nothing else. It opens no sidebar entry of its own, because the QC panel lives
inside the Album Proofing screen; `permission-catalogue-sidebar.test.js` records that as a decision.

`IMAGE_SELECTION / AI Feature` is the third Visual Curation screen, and a product of its own: event
galleries with face recognition, at `/visual-curation/ai` and `/api/ai-feature`, sharing nothing
with Image Selection but the menu heading. It is filed under `IMAGE_SELECTION` because that is the
Visual Curation section's module key, which rule 1 above holds a screen's permission to. `READ`
opens the overview, the events and each event's media, guests, sub-events and timeline;
`READ_WRITE` creates, edits, duplicates, archives and deletes events, uploads, manages guests and
generates the guest link. Two grants sit beside it and open no menu entry of their own:
`AI Face Management` is the People and Face Recognition tabs inside an event - `READ` looks,
`READ_WRITE` renames, merges, splits and hides people, links them to guests, confirms or rejects a
match and retries failed processing - and `AI Event Default Settings` is More → Event Default
Settings, the template every new event is copied from. Migration 20260922100000 writes all three
and grants them to SUPER_ADMIN; nobody else holds them until their roles are re-saved.

`ASSET / Asset Management` is one screen and one job: the register, the inspections recorded against
it, the custody history, and raising a request for an asset. It is meant to be held widely — `READ`
browses and shows somebody their own requests, `READ_WRITE` adds an asset, raises a request, and
makes somebody *eligible* to manage one. What they may then do to any particular asset is
[decided per row](#one-asset-at-a-time-who-may-change-it), not by the grant.

`ASSET / Asset Administration` — **Administer Assets** in Role Management — is what puts equipment
*onto* the register: the **Add Asset** button and `POST /api/assets`, single and bulk, including who
holds and manages the new asset. It is held by few. Deciding what the studio owns is not the same job
as looking after a piece of it, which is why it is not part of the permission above: `READ_WRITE` on
Asset Management used to carry Add Asset too, so anybody who could ask for a lens could register one.
It opens no menu entry of its own — the button lives on the Assets screen — which
`permission-catalogue-sidebar.test.js` records as a decision.

`ASSET / Asset Request Approval` is held by whoever answers those requests: it carries Accept and
Reject, and widens `GET /api/asset-requests` from your own requests to the whole queue. **Accept
creates the asset that was asked for** — through the assets module's own creator, with the whole Add
Asset form behind it — and it does so on this permission **alone**, without Asset Administration.
That is a second way onto the register and a deliberate one: deciding a request is the job, and the
studio did not want to answer the same question twice. Whoever may approve may therefore add, by
approving. Reject writes no asset and needs nothing further.

### One asset at a time: who may change it

Every other screen in the app answers "what may you do here" once, for the whole page. Assets
answers it per row, because the register is held widely and the equipment in it is not everybody's
to dispose of. The permission is the outer gate and the record is the inner one:

| | May do |
| --- | --- |
| `READ` | Look. The ⋮ menu offers **View** and nothing else. |
| `READ_WRITE`, on an asset **you manage** | Edit, Start Inspection, every status move the machine allows from where it is, and the handovers. **Not Delete**, and **not Add** — adding is `Asset Administration`. |
| `READ_WRITE`, on any other asset you can see | **View and Under Repair**, and that is all. |
| Super Admin | All of it, on every asset, plus **Delete** and **Import**. |

An asset is **yours to manage** if either is true:

- `asset.managerId` is your employee id — you are the person named as its Manager; or
- `asset.createdBy` is your user id — you are the login that added it.

Reporting a fault is the one write that is not the manager's: the person holding a broken lens is
the person who knows it is broken. Clearing the fault is not theirs — `UNDER_REPAIR → ACTIVE` is a
manager's move — so `UNDER_REPAIR` is the only status a non-manager is offered, and only from a
status the machine allows it from. An asset already `IN_SERVICE` offers them nothing.

The creator is in the rule deliberately. Approving an asset request creates the asset and records
the approver as its `createdBy`, so somebody who approved a request and forgot to name a manager can
open the asset later and set one, rather than needing a Super Admin. It also means whoever registers
an asset keeps those rights after a manager is named; a Super Admin is the one who can change that.

**The two ids are not interchangeable.** `managerId` and `assignedPersonId` hold an **`Employee.id`**
— real foreign keys to the employee table. `createdBy` holds a **`User.id`** — the login. They are
different tables with different sequences, so one person is two different numbers, and comparing the
wrong pair silently hands out or withholds rights. They cannot be collapsed into one either:
`User.linkedEmployeeId` is nullable, and the studio's Super Admin is precisely the account with no
employee behind it. `capabilitiesOf` in
[assets.read.service.js](../../backend/src/modules/assets/assets.read.service.js) resolves the
caller once into `{ userId, employeeId }` so no call site has to remember which is which; it is the
same `employee:` / `user:` distinction `dataScope` already draws.

Delete and Import are a Super Admin's outright and are deliberately **not** permissions. There is
one asset permission and it is held widely, so no level on it could separate disposing of a camera
from raising a request for one — this is the narrow carve-out the backend README allows for a thing
belonging to one role.

Both sides read one answer. `GET /api/assets` attaches a `capabilities` object to every row — and so
does every response that returns an asset, so a row the table splices in after a write is not left
without one — and the screen draws its ⋮ from that. In particular **the status transition map lives
on the server**. It used to live only in `AssetManagementPage.js`, which made it advice rather than
a rule: the menu hid *Dispose* from somebody who only held the asset, and `PATCH
/api/assets/:id/status` accepted *Dispose* from them regardless, because it checked the target
against the list of statuses that exist and nothing more.

`SALES` covers the sale; `PROJECT` covers what happens once a sale becomes a job. They were one
permission until the two were told apart, which meant a grant of the production boards also carried
the power to delete a sale.

A project's money takes **both** `PROJECT / Projects` and `ACCOUNTS / Cash Management`. The Payments
tab of the record a project row opens on double-click shows the cash entries filed against that
project, and those entries are Accounts' — so being able to open a project is not by itself a reason
to be shown what it earned. `GET /api/sales/projects/:id/payments` asks for `READ` on both, and the
Projects screen offers the tab only to somebody holding both; with one and not the other the record
view opens with no tab bar at all. It is deliberately outside the register read the four `PROJECT`
features and `SALES` share, so listing a project on a production board still shows nothing of this.

Recording a payment from that tab opens Accounts' own cash entry form and writes through
`POST /api/accounts/cash-entries`, so the two Add buttons need `ACCOUNTS / Cash Management`
`READ_WRITE` and are absent without it. Somebody who may read the money but not record it sees the
lists and no buttons — which is what "absent, never disabled" means here.

Create Project's **Payment Received** section is the same rule on the way in. It records the advance
as a cash entry through that same endpoint, so it asks for `ACCOUNTS / Cash Management`
`READ_WRITE` on top of the `SALES / Sales Manager` that opened the form: without it the section,
its entry on the form's rail, and the options request behind its dropdowns are all absent, and a
salesperson who may book a project but not touch the books creates it with no payment against it.
The backend guard is unchanged and is still the authority — the section only decides what is drawn.

A permission removed from the catalogue is **deactivated** by the seed rather than deleted: it stops
being offered in the Roles dialog and stops granting anything, while the grants naming it survive in
case the retirement was a mistake.

| Level | What the viewer gets |
| --- | --- |
| Not granted | The screen is not listed in the nav, and opening its URL gives a refusal naming the permission that is missing. |
| `READ` | The screen opens and lists its records. Every control that changes one is **absent** — no Add, no Edit, no Delete, no row menu where the menu held nothing else. |
| `READ_WRITE` | The screen as it has always been. |

Absent, never disabled — with one deliberate exception. A greyed control usually invites people to
ask why, and a refused one is worse; but where a panel is worth *reading* when it cannot be changed,
and removing its controls would leave something that looks broken, the controls stay and are
genuinely disabled instead. Wrap that region in a `fieldset disabled` — which makes every control
inside inert rather than relying on each one remembering — and put `cursor-restricted` on the
**controls**, not the region: `[&_input:disabled]:cursor-restricted` and the same for `button`,
`select` and `textarea`. That utility, defined in
[globals.css](../../frontend/src/app/globals.css), draws Material UI's `Block` glyph as the pointer
instead of the platform's arrow-plus-badge, so what is under the pointer is the refusal rather than
an arrow wearing one. A whole panel reading as blocked says the screen is unavailable rather than
uneditable. A control that hides its real input behind a label, as `ToggleSwitch` does, needs
`disabled` passed to it as a prop as well, or the part you can see keeps styling itself as live.
Give each a `title` saying why, and leave the save control on screen refusing rather than gone. Image Selection's
Selection Settings rail works this way; everywhere else, absent is right. A
row menu whose every entry needed `READ_WRITE` is dropped along with its column rather than left as
an empty ⋮.

This reaches inside the panels, not only the tables. A screen that opens an editor from a control
already hidden at `READ` needs nothing more, but one reachable another way — a double-click, a deep
link — has to be told itself: pass the panel a `canWrite` prop and let it drop its own save controls.
The CRM lead panel and the Image Selection workspace both work this way. Where a panel is only ever
a read, use `RecordViewPanel` and the question does not arise.

## The route map

[frontend/src/constants/modulePermissions.js](../../frontend/src/constants/modulePermissions.js)
holds one table of route prefix → `{ module, feature }`, and three things read it: the sidebar when
it decides what to list, `RouteGuard` when a page is opened directly, and the landing resolver when
somebody signs in. Adding a screen means adding its row there — a screen with no row is left open to
anyone signed in, which is the right default for one no permission describes yet and the wrong one
for a screen that needed a permission.

Each row names the permission the **API** enforces on the data that screen reads, which is not
always the tidiest name for the screen. Where a screen needs its own permission and another screen
reads some of the same data, the fix is to give that reading its own narrow endpoint rather than to
widen the permission: `GET /api/vendors/picker` returns vendor names for the asset status dialog and
is reachable by Asset Management or Vendor Management, while the vendor records stay behind Vendor
Management alone. The sales project register works the same way: `GET /api/sales/projects` is reachable by Sales
Manager, CRD Documents, Quotation Management and all four `PROJECT` permissions, because every one
of those screens lists projects — while creating a sale, planning a shoot and issuing a document
each sit behind the permission for the screen that does it. That is why a project manager can plan a
shoot without being able to delete the sale it came from.

A few screens still share an endpoint — the sales project
register feeds Sales Manager, `PROJECT / CRD Documents` and all four Project Management screens; the HRM master
data lists are read by Admin, Accounts, Assets and the employee forms — so those screens cannot be
told apart by a permission the server does not distinguish. Giving a route a finer permission than
its endpoint has would show somebody a page the API then refuses the records to, which is the
failure this pass exists to end. Finer control means splitting the endpoint first, then the
permission follows.

Signing in lands on `/employees`. Somebody who cannot open it is forwarded to the first route in
that table they can, and told to ask for a role only when they hold nothing at all. A page reached
by typing its address is refused rather than redirected — it was asked for deliberately.

Guards are for the interface, never for the answer. The API refuses the same request on its own;
hiding a control only stops the app asking for what it would be refused.

## Adding a module or a screen

Work through this in order. Every step has shipped a bug when it was skipped, and the bug is always
the same shape: a screen somebody can open onto refusals, or a guard that refuses everybody.

1. **Add the permission to the catalogue.** A `{ module, feature, level, displayName, description }`
   row in [permission-catalogue.js](../../backend/prisma/seeds/permission-catalogue.js), which the
   seed reads and which the drift test reads without a database. Reuse an existing feature if the
   new screen is the same job — three permissions nobody grants separately are worse than one.
   `level` must be unique, and `module` must be the module whose sidebar section the screen sits in
   (see [The catalogue describes the sidebar](#the-catalogue-describes-the-sidebar)). If the screen
   is not in the sidebar at all, add it to `NO_MENU_ENTRY` in
   [permission-catalogue-sidebar.test.js](../../backend/test/permission-catalogue-sidebar.test.js)
   with where it is used, or that test fails.

2. **Reseed.** `node -r dotenv/config prisma/seeds/iam-roles-permissions.js`. Until this runs, the
   permission exists in the source and nowhere else: it cannot be granted, and any guard naming it
   refuses everybody except a Super Admin — which looks like a working guard, because one account
   still gets through.

3. **Guard the routes.** `protect`, then `requireModule(module, feature)` for a router whose GETs are
   reads and whose writes are writes, or `checkPermission(module, feature, level)` per route where
   that is not true — a report fetched by POST is a read, and asking for `READ_WRITE` would refuse
   the people meant to run it. **Never** add a `req.user.role` check inside the controller: it sits
   below the guard, overrules it, and cannot be granted to anyone.

4. **Check the endpoint is not shared.** If another screen reads the same endpoint, both screens
   answer to the same permission — giving the new one a finer permission shows it to people the API
   then refuses. To separate them, give the incidental reading its own narrow endpoint first, as
   `GET /api/vendors/picker` does for the asset status dialog.

5. **Add the route to the map.** A row in
   [modulePermissions.js](../../frontend/src/constants/modulePermissions.js), longest path first. A
   page with no row is open to anyone signed in. This one row is what makes `RouteGuard` close the
   page, the sidebar stop listing it, and the landing resolver skip it.

6. **Gate the controls.** `const { canWrite } = useRouteAccess();` and every Add, Edit, Delete and
   row menu behind it. Drop a row menu whose every entry needed `READ_WRITE`, and pass no
   `renderActions` so the column goes with it.

7. **Gate the panels the page opens.** A dialog reachable only through a control you just hid needs
   nothing. One reachable another way — a double-click, a deep link, a tab inside another panel —
   takes `canWrite` as a prop and drops its own save controls. Controls that write the moment they
   are pressed, rather than on Save, have to be found separately.

8. **Do not fire the call either.** A request the viewer cannot make should not be made: gate the
   fetch as well as the button, or the page reports its own refusal as an error.

9. **Say who reaches it.** One `docs/CHANGELOG.md` entry naming the permission, and **re-save the
   roles that should now hold it** — the seed creates roles but never writes grants, so nothing is
   granted automatically, including to the seeded roles.

10. **Write the row into a migration too, or it will never exist on production.** The seed **cannot
    be run on the VPS**, so a permission added to `seeds/permission-catalogue.js` alone reaches a
    developer's machine and nowhere else — and the guard naming it then refuses the entire studio
    but a Super Admin, silently, the moment the code ships. The catalogue is what makes a permission
    grantable where the seed *is* run; a migration is what makes it exist everywhere. Write both,
    with the same `module`, `feature` and `level`, since the seed upserts on those three and a
    mismatch quietly makes a second row beside the migration's.

    **If you are repairing production rather than shipping a change**, there is one seed that may be
    run there: `npm run seed:permissions`
    ([production-permissions.seed.js](../../backend/prisma/seeds/production-permissions.seed.js)),
    which creates what the catalogue describes and refreshes display names and descriptions, and
    does nothing else — no retirement, no `isActive`, no roles, no grants. Run it with `-- --dry-run`
    first: it prints exactly what it would create, what it would refresh, and which permissions the
    database holds that the catalogue does not describe, which it deliberately leaves alone. It is
    not a substitute for the migration below, which is what makes a permission arrive **with** the
    code that guards on it.

    The shape is an `INSERT ... SELECT ... WHERE NOT EXISTS` so that re-running writes nothing and a
    seeded database matches rather than duplicates — `20260915200000_crm_lead_select_and_import_permissions`
    for two plain rows, `20260915190000_settings_module_permissions` for thirteen that also carry a
    retired permission's grants across. Keep the literal comparisons column-to-literal rather than
    column-to-column: this database is `utf8mb4_0900_ai_ci` while its tables are
    `utf8mb4_unicode_ci`, and comparing two differently collated *columns* is what makes a migration
    fail with "Illegal mix of collations".

    **And grant it to `SUPER_ADMIN` in that same migration.** That role is described as "full access
    across every branch" and holds every permission there is (20260917100000) — a new one it does not
    hold is a hole in exactly the role that is supposed to have none, and it cannot be filled from
    Administration → Roles, which refuses to edit a system role. Four lines beside the row itself:

    ```sql
    INSERT INTO `role_permission` (`id`, `roleId`, `permissionId`, `access_level`, `created_at`, `updated_at`)
    SELECT UUID(), `role`.`id`, `permission`.`id`, 'READ_WRITE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
      FROM `role` JOIN `permission` ON `permission`.`level` = 'YOUR_NEW_LEVEL'
      LEFT JOIN `role_permission` ON `role_permission`.`roleId` = `role`.`id` AND `role_permission`.`permissionId` = `permission`.`id`
     WHERE `role`.`name` = 'SUPER_ADMIN' AND `role_permission`.`id` IS NULL;
    ```

    The seed does this for every permission at once (`grantSuperAdminEverything`), so a developer's
    machine is covered by reseeding; the migration is what covers production. `test/iam-super-admin-grants.test.js`
    fails when the two have drifted apart.

**Retiring a permission** is the same list backwards: drop the row, repoint every guard and route-map
entry that named it, and deactivate it in a migration as well as reseeding — for the same reason
step 10 gives, a retirement that lives only in the seed never happens on production, where the row
goes on being offered and granting what the code no longer honours. The seed deactivates a row the catalogue no longer describes rather than
deleting it, so it leaves the Roles dialog while the grants naming it survive — those roles then grant
nothing on that screen until they are re-saved, and the dialog will not show you what is missing.

## A caution about Super Admin

`hasPermission()` answers `true` for a Super Admin before it reads a single permission row. That
shortcut means server-side checks cannot catch a malformed permission row — a bug that once let a
Super Admin be refused the admin screens while every API call kept working. Tests that matter should
assert the **rows** `getUserPermissions()` returns, not only the shortcut.

## Tests

[backend/test/iam.test.js](../../backend/test/iam.test.js) — 25 cases covering permission checking,
branch isolation, cross-branch reach, role assignment, and roles that disagree about the same
permission. The suite owns
the roles it tests against rather than asserting on seeded ones, because the studio can now edit
those freely. A `test.after` sweep removes anything a run creates even when setup fails part way.
