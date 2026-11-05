# Employee Repository and Onboarding Standards

## Repository

Route: `/employees`

Employee Repository includes the approved Data Table standard, compact right-side Employee Info Panel, Add/Edit/Review schema forms, row actions, infinite scroll, export, Manage Columns search, and closable notifications.

Tabs:

- **All** — all employees and active invite rows.
- **Active** — `Active`, `in Training`, `PIP`.
- **Onboard Pending** — `Onboard Pending` employees plus active invite rows represented as `Submission Pending`.
- **InActive** — `Relieved`, `Absconded`, `Long Leave`, `Fired`.

Invite rows show intended designation and invite dates, do not use employee Edit/Review, and can be cancelled. Cancelled/expired invites remain in invite history only.

## Employee Forms and Stable Fields

- Employee ID is a backend-generated immutable business ID: `DBS-1`, `DBS-2`, `DBS-3` — unpadded,
  and carrying neither a vertical nor a branch, because a person belongs to the studio rather than
  to a board. Minted by `backend/src/services/identifiers.js`, the one counter every identifier in
  the application is drawn from.
- Blood Group is a required dropdown: `A+`, `A-`, `B+`, `B-`, `AB+`, `AB-`, `O+`, `O-`.
- Designation and Department are dropdowns; saved legacy values remain displayable. Current designation choices are Founder, Co-Founder, Director Operations, Team Leader, Data Manager, Sr. Business Development Manager, Business Development Associate, Accounts Coordinator, Sr. Creative Specialist, Creative Specialist, Post Production Manager, Post Production Coordinator, Post Production Executive, Pre Production Coordinator, Production Coordinator, Customer Relationship Manager, Office Assistant, Office Assistant + Sales, Technical, Technical - Videographer, Videographer, Photographer, Shoot Assist, Editor, Designer, HR Executive, Admin, and Others.
- Department options: Management, Operations, Human Resource, Pre Production, Production, Post Production, Technical, Sales, Accounts, Data Management, Administration, Non Technical, Temporary, Training, Others. Department comparisons used by CRM remain case-insensitive compatible with `SALES`.
- Skills are searchable multi-select and display/store as comma-separated values where required by existing data compatibility. Current choices are Photography, Videography, Candid Photography, Candid Videography, Drone, Editing, Retouching, Album Designing, Album Printing, Client Handling, Sales, CRM, Pre Production Coordination, Production Coordination, Post Production Coordination, Data Management, Accounts, WhatsApp Coordination, Customer Support, Graphic Design, AI Retouch, Studio Operations, Outdoor Shoot, Indoor Shoot, and Others.
- Work Base Location: Erode TN, Tiruppur TN, Coimbatore TN, Bangalore KA, Hyderabad TL, Visakhapatnam AP, Remote, Work From Home, On Field, Others.
- Vertical: Dum Dum, Qua Qua, Corp, Team 33, General.

Phone inputs use the shared split pattern:

- Editable country code, default `+91`.
- National number stays separate from country code and accepts only its digits; country code is never injected while typing.
- National display formats as `12345-12345` where applicable and remains a maximum 10 digits for current Indian-number validation.
- Existing saved values such as `+91 9876543210` are parsed safely on initial load.

Identity/bank validation:

- Aadhar: 12 numeric digits.
- PAN: 10 uppercase alphanumeric characters.
- IFSC: 11 uppercase alphanumeric characters.
- Bank Account Number: required where existing form rules require it; numeric only, maximum 30 digits.
- Bank Account Status: Active / Inactive.

## Add, Edit, Review, Approval

- Add opens **Employee Registration Details** and defaults to `Onboard Pending` where current rules apply.
- Edit opens **Edit Employee Details**. Review opens **Review Employee Details**.
- Sections: Basic Employee Information; Contact and Address Information; Family Details; Identity and Bank Details; Reference and Nominee Details.
- Onboard Pending rows expose Review and Delete; other employee rows expose Edit and Delete.
- Review Save follows changed-value behavior. Approve & Onboard remains available and changes status to Active.
- **Review Employee Details closes with a question.** Changing anything and then pressing the ×, or
  Escape, asks *Save draft* / *Discard* / *Keep editing* rather than throwing the corrections away.
  Save draft is the same save the footer's own Save Draft button makes — the record is kept and the
  submission stays under review; nobody is approved. Only Review and the Employee Preference page ask
  this; Add Employee and Edit close as they always have.
- After approval, HR can skip credential creation or create login credentials. An Active employee
  with no login keeps a **Create Login Credentials** entry in its row menu, so a skipped offer can
  be taken up later.

## Create Login Credentials

- A full-screen form of three sections: **Credentials**, **Roles**, **Alternative**.
- The employee the form is acting on — name, employee ID, department, branch — is stated in the
  summary strip above the sections, not asked for as fields. The branch is derived by matching the
  employee's work location against the locations master data; a work location naming no branch
  leaves the account with no branch, which narrows nothing but scopes nothing either.
- Credentials collects the username, the login email and a generated temporary password. The account
  is created with `mustChangePassword`, and the password is emailed.
- **The password is random, one per account, with a Regenerate beside it.** It was a single string
  in the source — shared by every account the studio had ever made, and so a working password for
  every employee who had not changed theirs, which nothing yet forces them to do. It is now drawn
  per account from `lib/temporaryPassword.mjs`: twelve characters in hyphenated groups, from an
  alphabet with no `0`/`O`, `1`/`l`/`I`, `5`/`S` or `2`/`Z` in it, because somebody reads it off a
  dialog and types it into a sign-in box. `crypto.getRandomValues` with rejection sampling, and no
  `Math.random` fallback: a credential drawn from a predictable sequence looks no different
  afterwards. The field is read-only — the point is that nobody picks it — and **Regenerate** is
  the only way it changes. It is generated once when the page opens, so the page can still tell an
  edit from a form that has merely been looked at; regenerating is a real edit, and Save Draft
  keeps it.
- **The login address is issued at the studio's own domain**, from Settings → Global → **Login
  Credential Name**. That field was already the name the credentials email calls this system; it is
  now also the domain half of every login address. Typed as a domain — a scheme, a leading `@`, a
  `www.` or a trailing path are all taken off — and anything that does not look like a domain falls
  back to `beamcraft.com` rather than being guessed at, since turning a studio's *name* into a
  domain would issue its whole staff addresses at one nobody chose. The value reaches the browser
  on the public branding endpoint, so whoever onboards an employee does not need ADMIN / System
  Settings to see the proposal. It is settled alongside the page's other loads: a domain arriving
  after the page had decided what "unchanged" means would change the proposal underneath it and
  open the form offering to save a login nobody typed.
- **A refused email no longer undoes the account.** It used to: creating the login and mailing it
  were one act, so a failed send deleted the account just made and answered "Nothing was created —
  try again". That was right while the email was the only way the details could reach anybody. It is
  not any more — the dialog below shows them with a copy — so the account stands, the employee goes
  **Active**, and the screen says the message did not go: a toast reading "Login credentials could
  not be sent. The account is created — copy the details and pass them on", and the reason named in
  the dialog. `credentialsSentAt` is left unstamped, since it records that they were sent.
- **Creating the account shows what was made**, the way creating an onboarding invite does: a dialog
  with the username, the login email and the temporary password, and a **Copy details** button. It
  is raised by the page rather than the panel, because the panel closes the instant onboarding
  finishes and this has to outlive it. It matters because the server never returns a password — this
  is the only moment all three details are together, and once it is dismissed the temporary one is
  not readable anywhere. That is most useful exactly when the email did not arrive, which is not
  rare: the send is refused outright whenever the studio's mail account has spent its daily quota.
- **The credential email is sent to the employee's personal address, not to the login address it is
  handing out.** The two are different things: the login address is the studio one worked out from
  the person's name (`firstname.abc@<the studio's domain>`), and on the day the account is made it is
  not a mailbox anybody can read. Their personal email is where their onboarding invite reached them,
  and is the only address the studio knows they read. Sending the credentials to the login address
  posted them into a mailbox that did not exist — the account was created, `credentialsSentAt` was
  stamped, and the new employee never learned they had a login. The login address is now **stated in
  the body** beside the username instead, being something they are told rather than something they
  already knew. A record with no personal email falls back to the account's own address.
- **The same rule covers the password reset.** Its link goes to the personal address, and the account
  is found by *either* address — somebody typing the one they know was previously matched against the
  login address alone, so the request found nothing and still answered "if the address is known, a
  link is on its way". An account with no employee behind it, such as an administrator's, keeps its
  own address throughout.
- Roles assigns as many IAM roles as the job needs, chosen several at a time. The account and its
  roles are created together; an account created with none can sign in and do nothing.
- Alternative records the two employees who cover this person's work. It is stored on the employee
  record, not on the account, so it survives the account being removed. Somebody cannot be their own
  alternative, and the two slots must name different people.

### Putting the page down: Save Draft and Discard

- The page footer carries **Discard changes** and **Save Draft** beside **Create User & Send
  Email**, the same pair Review Employee Details ends on. Save Draft is offered only once there is
  an employee to attach an account to, and is enabled only where something has actually changed.
- **Save Draft keeps the whole page** — username, login email, temporary password, roles, branch,
  the two alternatives, the leave approvers and the permission approver — in
  `employee.login_credentials_draft`, and the page
  reopens on it. It is a draft, not an account: no `User` row is created, no email is sent, no
  access is granted, and nothing is validated. Refusing to keep a half-filled page until it was
  correct would defeat the point of keeping it; the full rules still apply when the account is
  created.
- The draft is **cleared the moment the account is created**, in the same transaction. An account
  and a draft of that account are two answers to one question, and a draft left beside a live
  account would be restored over it on the next visit.
- **Discard changes** closes without saving and leaves any previously saved draft alone — it
  discards this sitting's edits, not last week's work.
- Closing with the **×** or **Escape** asks instead: *Save draft*, *Discard*, *Keep editing*. The
  same question is asked from Review Employee Details **and from Edit Employee**, and it names which
  of the pages is unsaved. Edit was the omission that lost work: salary reviews are recorded there
  through a dialog that closes leaving a saved-looking list, while nothing reaches the server until
  the panel's own **Update** — so somebody who recorded three reviews and then pressed × lost all
  three without being asked. On Edit the button reads **Save** rather than *Save draft*, editing an
  employee being a write to the record rather than a draft of anything. Keep editing is also what dismissing the dialog does, so the answer that loses nothing
  needs no decision. The footer's own Discard changes button is not intercepted — it already says
  what it does.
- **Access.** Reading and writing a draft answer to `ADMIN / User Management` `READ_WRITE`, the same
  permission creating the account asks for, rather than the HRM permission the rest of the employee
  record answers to: the draft holds the password the account will start on. The GET carries that
  guard explicitly, because the HRM router lets any signed-in session read — right for departments
  and branches, wrong for a half-made credential. For the same reason the column is stripped from
  every ordinary employee response (`withoutCredentialsDraft`) and travels only through its own
  endpoint.

## Public Onboarding Invite

- Admin creates secure onboarding invite; duplicate active email/phone invites are prevented.
- **An invite's details can be corrected in place** — **Edit Invite**, in the repository row's ⋮ for
  an invite row and beside Cancel in the invite history. The invite keeps its token, short code and
  URL, so the link already sent goes on working and the mail can be sent again afterwards. Offered
  for `Created`, `Verified` and `Expired`; refused for `Submitted` (those details are what the
  candidate filled the form in against — send it back instead) and `Cancelled` (a decision an edit
  must not quietly undo), in the endpoint as well as the menu. Editing the email or phone of a
  `Verified` invite returns it to `Created`, because the proof was about a value the invite no
  longer carries. The duplicate-invite check applies as it does on create, less the invite being
  edited.
- **Copy Link is on any row whose onboarding link would actually open** — an invite not yet
  submitted, and an employee whose submission was sent back, both of which sit on **Employee
  Submission Pending**. A send-back reopens the link the candidate already holds rather than issuing
  a new one, so it is the same URL. A Submitted or expired invite still *has* a link and is
  deliberately not offered: copying it would hand somebody a link that refuses.
- **The public onboarding routes are never cached** — `Cache-Control: no-store, must-revalidate`. An
  invite that cannot be opened answers 410, and a 410 is cacheable by default: with no header on it a
  candidate who opened their link after submitting had "already been submitted" stored by their
  browser, and the link kept saying it after HR sent the submission back. The 200 needs it too, since
  an invite's state changes underneath a link meant to be opened more than once.
- **Every field on the create form is required** — candidate name, email, phone, Intended Designation
  and Expiry Date — and the server requires them too, so the rule is not one the browser alone keeps.
  The designation has no **Not specified** entry: an option whose job is to leave a required field
  empty is a way round the rule. The expiry is prefilled a week out, so required does not mean empty,
  and the server has no seven-day fallback under it any more — a default beneath a required field is
  how that field goes unanswered. **Re-invite** relied on that fallback and posts an expiry of its
  own now; for an invite raised before the designation was asked for, it opens the create form
  carrying the candidate's details rather than inventing an answer.
- Candidate receives a public HTTPS link, verifies email/phone, completes onboarding and required policy acceptance, and submits.
- **The candidate's photograph is required**, on the same footing as the Aadhaar and PAN images. It
  was optional, on the reading that a missing photo should never be the reason somebody cannot
  finish their onboarding; the studio puts a face to every record — the repository, the org chart
  and the top bar all read it — and a photograph is far harder to collect afterwards than during the
  one sitting where somebody is filling in everything else about themselves. Required on the form
  *and* in the submission schema, because that endpoint is public and is posted to by more than the
  form that draws it.
- **Every field on the candidate's own form is required too, bar three.** Date Of Birth, Work Type,
  Blood Group, Skills, Languages Known, Qualification Details, both References and both Nominees were
  optional, so a record could arrive with no date of birth, nobody to vouch for the person and nobody
  to pay out to — and those are the answers hardest to collect once somebody has started work. The
  three exceptions are named in the code rather than left to drift, each because somebody can
  honestly have nothing to put in it: **Experience Details** (a fresher has no job to list),
  **Children Details** (plenty of married people have none) and the *permanent address is the same*
  tick, which is not a question but a control that copies one address onto the other. Required on the
  form *and* in the submission schema, for the reason the photograph is. Bank Location was starred on
  the form and `.optional()` in the schema — the two halves disagreeing rather than a decision — and
  now matches. A list counts as answered only when it holds a row somebody actually filled in: the
  blank row an **Add** click leaves behind is dropped on the way to the server, so counting rows as
  they stand would let an empty list through as answered.
- **The candidate's phone is the application's phone control**, with its country picker, and stores
  the `+91 9876543210` shape the employee record is validated against — so the number a candidate is
  invited on is already the number their record will carry. It was the one number in the studio typed
  as free text, which let the same person be invited as `98765 43210` and again as
  `+91 9876543210`: two numbers to the duplicate check and one number to everybody else.
- **Verifying tolerates a missing country code, in either direction.** HR's number carries `+91` and
  the candidate types the ten digits they would give anybody, so the two are matched on the national
  part — the shorter must be the tail of the longer, and at least seven digits so a short fragment
  cannot open somebody else's invite. The same rule decides whether a second invite is a duplicate.
- Submission creates an Employee with `Onboard Pending`; invite becomes Submitted.
- Send Invite email exists. Copy Link is an immediate-create fallback only; raw tokens are not stored or reconstructed for later history views.
- Invite history popup and cancellation are available. Invite cancellation is safe/cancel behavior rather than a destructive removal.

## Credentials and Access

- Credential creation is protected and currently enabled only for Active Technical employees.
- It creates a linked User with bcrypt-hashed password and can send credentials through SMTP.
- Technical employee users reach `/technical/dashboard`; all non-enabled employee departments remain unavailable pending RBAC.

## Recent Stability Fixes

- Fixed EmployeeFormPanel option normalization so absent/non-array options cannot crash Add/Edit/Review.
- Fixed country-code injection into national-number fields.
- Country code is editable globally where the shared input pattern is used.
- Employee table headers are title case/bold and Freeze Columns was moved into the table 3-dot menu.

## Removing an employee

Deleting an employee **archives** them: `archivedAt` is stamped and the row stays. It is not a
delete, and deliberately so — the record is named from cash entries, assets, separations and reviews,
and destroying it either takes those with it or leaves them pointing at nothing.

`archivedAt` is the column every "active employees" query already filters on, so one write removes
the person from every screen and every picker at once. That includes the repository's **InActive**
tab: those tabs are cut from `employmentStatus`, and a row that never arrives lands in none of them.
Removing somebody is not the same as offboarding them — InActive is where a person the studio parted
with belongs, and somebody deleted is not a person to be read about there.

An archived employee cannot be edited, offboarded, given login credentials, or named as another
employee's alternative. Each reads as not found, which is the same answer every list gives.

Their **login is closed with them**. A user and an employee are separate records joined only by
`User.linkedEmployeeId`, so removing somebody used to leave their account signing in normally with
whatever roles it held. Archiving now sets that account to `INACTIVE` in the same transaction. The
roles stay on the account: closing it is what stops the sign-in, and stripping the grants would mean
rebuilding them by hand if the removal was a mistake.

`employmentStatus` is left as it was. There is no status meaning "removed", and writing `Relieved`
over it would make a deletion indistinguishable from a real separation.

## Giving a new employee a login

Two paths reach the same credential step, and both are offers rather than obligations:

- **Approving** an onboarding submission sets the employee Active and opens it.
- **Adding** an employee manually opens it too, but only when they were added as **Active**.

An employee on any other status is not offered it, because `POST /employees/:id/create-login-credentials`
creates a login only for an Active employee — offering it sooner would be offering a form that can
only be refused. The offer stays on the row's menu until a login actually exists, so "Skip for now"
loses nothing.

Creating the login itself asks for `ADMIN / User Management` `READ_WRITE`, not HRM: making somebody
a user is User Management's business even though the button lives on an employee row.
