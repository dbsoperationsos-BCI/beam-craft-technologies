# Sales and Project Management Workflow

## Sales Manager

Route: `/sales/manager`

Sales Manager is active for Super Admin and uses the global table standard plus Sales Info Panel. Its current toolbar is W/A Group-Name Generator, Create Quotation (placeholder), Create Project, and Refresh.

### Create Project

- **Two ways in, one form.** Bookings & Converted's own **Create Project** button, and *Create
  Project* on a quotation's row in the Quotations register — which opens this same form, prefilled
  from the quotation, without leaving that page. Both are `ProjectBookingPanel`: the same panel, the
  same payload and the same two-call save (the project, then the advance as a cash entry), so the
  two screens cannot drift into meaning different things by "book a project".
- Enquiry ID is manual and editable (`DBS0001` is an example, not a restrictive format).
- Event ID is backend-generated concurrency-safely and immutable: `DBS-BK-DD-ERD-000001` — the
  booking's vertical and branch, counted per vertical. A Sales Manager booking and a Project
  Management project are the same record, so both screens show this one identifier.
- WhatsApp Group Name can be selected from available saved generator names or entered manually.
- Manual names save only project text; they do not create generator records or mark a generated name used.
- Client Main Number uses the shared editable-country-code phone pattern.
- Source Branch options: Erode TN, Tiruppur TN, Coimbatore TN, Bangalore KA, Hyderabad TL, Visakhapatnam AP.
- Select Quotation lists only the quotations raised for the entered Enquiry ID — with no enquiry it
  offers nothing and says to choose one first — and names each by its version alone (`QUT039-03`).
  The price is not repeated there: picking a version fills **Signed Quotation** in Shedule Payment,
  which shows it in full.
- What the project converts at is **Signed Quotation**, at the head of Shedule Payment rather than
  among the sale's own fields. Picking a quotation fills it with that quotation's amount, and on
  Create Project it is **read-only**: booking a project is recording what the client agreed to, and
  the way to change the figure is to change the quotation. It is editable where a sale is corrected
  — **Edit Sale Details** and **Edit Project** — and every scheduled amount follows it as it is
  typed.
- Main Event Date Known and Main Event Date are editable; date is required only when known is Yes.
- CRM Name is searchable and contains only Sales-department employees matching Employee Repository Active-tab statuses (`Active`, `in Training`, `PIP`).
- Deliverables: As per Quote or Others. Deliverables Details is required only for Others.
- Slot Recommendation is removed from form, payload, validation, table, filters, export, and Manage Columns.
- Create Project carries **Service Creation** (formerly named Event Planning here) and **Shedule
  Payment**, the same two sections Start / Edit Project shows and rendered from the same components.
  Shedule Payment's Signed Quotation follows the Initial Converted Value. Neither form persists the
  schedule rows yet.
- **What the project converts at is asked for in Shedule Payment, not in the sale's own fields.**
  Create Project no longer has an **Initial Converted Value** box among Project Details. The figure
  arrives from the chosen quotation exactly as before, and is shown as **Signed Quotation** at the
  top of Shedule Payment, beside the rows that are shares of it.
  **Where it can be typed over, and where it cannot:**

  | Screen | Signed Quotation |
  | --- | --- |
  | Create Project | Read-only — the chosen quotation's own figure |
  | Edit Sale Details | Editable |
  | Start Project | Read-only — the sale is minutes old |
  | Edit Project | Editable |

  Booking a project is recording what the client agreed to, so typing over the figure while creating
  one would book a project at an amount no quotation says, with nothing afterwards to show the two
  ever differed; changing the quotation is the honest way to change it. Correcting it later is a real
  thing, and it is offered where a sale is corrected — including **Edit Project**, because the person
  scheduling against the figure is the one who finds out it is wrong. What the client was sent still
  stands unchanged on the quotation itself; correcting *that* is a new version of it.
- **On Create Project the shoots follow the quotation.** Picking a different quotation replaces the
  shoots, services and deliverables the last one brought, and clearing the quotation — which is what
  choosing a different enquiry does — takes them away. Nothing on this form is saved yet, so there
  is nothing to protect: a project booked with the first quotation's shoots still sitting above the
  second's is a project that matches neither. Anything added by hand is kept through the switch.
  **Edit Sale Details is additive instead, deliberately**: a live project's shoot carries cash
  entries, payment request expenses and client storage records, and its deliverables go with it
  under `ON DELETE CASCADE`, so a quotation may add shoots there but never replace them.
- **On Create Project the whole quoted plan is read-only.** Picking a quotation brings its shoots,
  services and deliverables in, and from then on the section shows them and offers nothing that
  changes them: no **+ Add Shoot**, no edit or delete on a shoot, no **Choose Services** or **Choose
  Deliverables** picker, no **Clear all**, no row delete, and the cells print their values instead
  of offering an editor. A project is booked against what the client agreed to pay for, and a plan
  retyped at booking is a project that quietly stops matching its quotation. The controls are absent
  rather than disabled.
  - **A quotation with no shoots is the exception.** Where a price was agreed before the days were
    settled there is nothing to plan against, so the section is fully open — **+ Add Shoot**, the
    two pickers and every cell — and whatever is planned by hand stays editable.
  - Start / Edit Project and the quotation generator are unchanged: both plan shoots in full. This
    is a rule about booking against a quotation, not about the section.
- **Edit Sale Details** (Bookings & Converted → Edit) shows the same flow, minus Payment Received.
  Creating a project holds its shoots pending and sends them with the project; editing one writes
  each change straight to the project through `useProjectPlan`, the shared plan editor Start / Edit
  Project uses — so removing a shoot there goes through the same deletion that clears its Image
  Selection footprint and refuses when the client has submitted selections.
- **Payment Received is create-only.** The advance is recorded once, when the project is created.
  Correcting it afterwards is done in Accounts or on the project's Payments tab; showing the section
  on edit would write a second cash entry on every save.

Projects persist through the SalesProject API and remain after navigation or refresh.

#### Payment Received

A project is usually created once the advance is in hand, so the form records it in the same sitting. **Payment Received** is the form's last section, after Shedule Payment — it is the only one that records money rather than describing the sale, and the advance reads against what the project is signed for and how that was scheduled. It asks for exactly what Accounts asks for when money comes in, from **Category** down to **Description** — amount, received date, payment mode and whatever that mode carries, the account it landed in, who received it, the receipt, and a description, and nothing else above or between them. The field list is derived from Accounts' own (`projectAdvanceFormSections` in `frontend/src/constants/accountsConfig.js`), so a field added to a cash entry is asked for here too.

- **Not asked for: project, shoot, client, branch.** The entry is filed against the project being created, and its client and branch are read off that project on the server.
- **Required in full.** A project is created with its advance against it: every field the section shows must be answered before **Save Project** goes through, and the same validation Accounts applies has to pass. Pressing Save with anything outstanding marks each field **Required** where it sits and says so once at the top; nothing is marked until Save has been pressed. **Save Project is always blue** — it never greys out, so it never reads as restricted, and pressing it always produces either a saved project or a reason. It dims only while a save is in flight. Only the fields the answers so far put on screen are required — cash asks for neither a reference nor an account, UPI asks for a reference, a bank transfer for both. This replaces the earlier rule, under which the section was optional as a whole and required only once begun.
- **Not shown at all without `ACCOUNTS / Cash Management` `READ_WRITE`.** Somebody who may book a project but not touch the books never sees the section and is never held to it — they create the project and Accounts records the money on its Payments tab. That is also the only remaining way to create a project with no advance recorded against it.
- **Two calls, not one.** The project is created through `POST /api/sales/projects`, then the entry through `POST /api/accounts/cash-entries` with the new project's id. They are not all-or-nothing: if the entry is refused the project still stands, the form closes, and the notice says to record the payment on its Payments tab rather than leaving a form open that would create a second project.
- **Permissions.** The section is a cash entry, so it asks for `ACCOUNTS / Cash Management` `READ_WRITE` on top of whatever opened the form. Without it the section and its rail entry are absent, and no options request is made. Editing a sale never shows it: a payment already recorded is corrected in Accounts.

- **The WhatsApp group name switch follows the enquiry.** Choosing an enquiry the generator has
  prepared a name for opens on the **saved** list; choosing one it has not opens on the **manual**
  box. The empty dropdown reading "No group name has been generated for this enquiry" was not a
  state worth showing — which of the two an enquiry needs is exactly what having a name answers.

## Quotation

A quotation is versioned, and **a chain is one quotation's own history rather than the enquiry's**.
The first version of a quotation is `QUT039-01`; every edit after it raises the next version of that
same chain — `QUT039-02`, `QUT039-03` — and the version already sent is never rewritten.

**Only an edit adds a version.** Raising a new quotation starts a chain of its own, and a new row in
the register, whether or not that enquiry has been quoted before — as does duplicating one onto
another enquiry. One enquiry is regularly quoted for **Dum Dum, Qua Qua and Corp** at the same time:
three packages at three prices, none of them a revision of the other two. Folding them into one
chain made the corporate quotation version 2 of the wedding one and left the register showing only
whichever was raised last. A version says *this replaces what I sent you*, which is a claim only an
edit can make.

So one enquiry can hold several quotations, each a row with its own number and its own price
history, and the project form's version picker offers every version of every one of them — a project
converts at a version, and which quotation it came from is the studio's choice to make.

- **The name.** Every version is stamped with one when it is raised:
  `Quotation - Vertical - Branch - Client Name - Venue` —
  *Quotation - Dum Dum - Erode TN - Shanmugam & Parimala - Kongu Mahal*. It is a column on the
  register, beside the Quotation ID: the id says exactly which document, the name says which one you
  are looking at without reading four other columns. **The client is whichever name that vertical
  asks for** — the couple for Dum Dum (`Shanmugam & Parimala`, both halves or neither), the baby or
  mother for Qua Qua, the company for Corp — falling back to the shared **Enquire Name**, which is
  the one field all three require. A part the quotation does not have is dropped
  rather than left as an empty segment, and the word *Quotation* always leads, so no row is nameless.
  **Stored, not composed on read** — a quotation is never rewritten, so what a version was called
  when it was sent stays what it was called; rebuilding it would rename a document already in a
  client's inbox the moment somebody renamed a venue in master data. Versions raised before the
  column existed are named by `scripts/backfillQuotationNames.js`.
- **Editing.** *Edit (new version)* opens the generator with a **Version** dropdown listing every
  version and what each was priced at. The next version can be raised from any of them, not only
  from the newest — reopening v1 after v3 exists and saving it makes v4, because what was just
  approved is the newest thing said.
- **Downloading, copying and editing one.** The register row's ⋮ carries them: **Versions** on a
  chain with more than one, **Link** on a chain with one, and both open the same cards —
  one per version, each with **Download**, **Copy link** and **Edit**, plus **Re-enable for 5 days**
  on a lapsed one. It is the only place those live, so a quotation raised once had no way to be
  saved or copied from the register until the entry was offered for it as well.
  **Three actions, and they were four.** *Open* went: it opened the same public page the link points
  at, which is what Copy link hands over and Download saves, so it was a third way to reach one
  document. *Duplicate* went too — copying a package onto another enquiry starts a new quotation
  rather than saying anything about the version being read, and it stays on the register row's own
  menu with the rest of that kind of work. *PDF* is now called **Download**, which is what it does.
  Download and Copy link are both the public link, so both disappear when it lapses; **Edit** is
  offered either way, because the generator opens on what the version was priced at and has nothing
  to do with whether a client can still open it. Edit is a write and is absent without `READ_WRITE`.
- **Links.** Each version carries its own public link at `/q/<token>`, open for **five days**.
  Raising a new version does not shut the links already sent: a client holding v1 keeps reading it
  until its own five days run out, which is what lets two versions be compared. Once lapsed, the
  page tells the client the link has expired rather than showing a not-found error.
- **Re-enabling.** A lapsed link is reopened for five more days from the share dialog or from
  *Version history* — the same URL with a fresh clock, as often as the negotiation needs. A new URL
  would leave two addresses for one document.
- **Duplicating.** *Duplicate*, on a register row, on a version expanded under it, or on any version
  in *Version history*, copies that version into a quotation of its own — shoots, services,
  deliverables and the rates it was priced under all come across. The copy starts at version 1 with
  its own number, link and five-day clock; it is never a revision of anything, which is why the
  enquiry it lands on may be **any** enquiry including the one it already belongs to. Copying within
  an enquiry is the ordinary way to start its second quotation — the Dum Dum package as the
  beginning of the Corp one — and the dialog says which of the two is about to happen. (It was
  refused while an enquiry could hold only one chain, since the copy could then only have become the
  next version of its own.) The version copied from is untouched and its link
  keeps working. The dialog asks one question — which enquiry — and offers the CRM's enquiry ids
  from all three verticals together, since the person duplicating knows the enquiry they mean rather
  than the board it is filed under. The enquiry the quotation already belongs to is not among them. Duplicating onto the enquiry a quotation already belongs to is
  refused — that is what *Edit (new version)* does.
- **Expanding a row.** A chain with more than one version carries a chevron at the start of its
  row. Opening it lists the earlier versions underneath as rows of the register — tinted, indented
  and ruled down the chevron's column, so what the chevron opened is never mistaken for more
  records — each with the same **⋮** menu, so a version can be viewed, edited into the next version,
  duplicated or deleted without leaving the table. A chain with one version has no chevron, because
  there is nothing under it.
- **Booking the project.** *Create Project* is offered on a quotation nothing has been booked from
  yet, and books it **on the register** — the form opens over the Quotations page rather than
  sending anybody to Bookings & Converted to start again. It arrives prefilled from the version it
  was opened on: the quotation and its enquiry, the client's main number, the Source Branch (spelled
  the way a project spells it — the quotation's `Erode` becomes `Erode TN`), the vertical as both
  group type and `WED`/`QQ`/`CORP`, the CRM who followed the quotation up, and the quoted amount as
  **Signed Quotation**. The quoted plan comes with it — the shoots, their services and their
  deliverables, shown and not editable, on the same rule Create Project already applies to a picked
  quotation. The version is read back in full first, so an earlier version expanded out of a chain
  books from its own answers rather than the chain's current ones.
  **Offered on the chain, not the row:** a quotation whose *any* version has already become a
  project is a quotation that has been booked, and offering it again would invite a second project
  against one negotiation. It is the same panel and the same save Bookings & Converted uses
  ([ProjectBookingPanel.js](../../frontend/src/components/sales/ProjectBookingPanel.js)), shared
  rather than repeated, so there is one definition of what booking a project means — and it is
  absent for a role holding Quotation Management without `SALES / Sales Manager` write, since being
  able to quote is not being able to book.
- **The ⋮ menu** is *View*, *Edit* (opens the generator and raises the next version), *Versions* or
  *Link*, *Create Project* (while nothing has been booked from the chain), *Duplicate* and
  *Delete*. Public links are reached from the dialog shown when a quotation is generated or
  duplicated, and from *Versions*.
- **The register** lists one row per chain: the version that stands today, how many versions have
  been raised, and whether the link is live. Deleting removes one version and leaves the chain
  standing on the version below it.

Access is `SALES / Quotation Management`: `READ` to read the register and the history, `READ_WRITE`
to raise a version or re-enable a link. *Create Project* answers to `SALES / Sales Manager`
`READ_WRITE` instead — it creates a project, not a quotation — so it is absent rather than present
and refused for a role that only quotes.

## W/A Group-Name Generator

The W/A Group-Name Generator is a separate Sales Manager dialog with validation, green read-only generated preview, backend persistence, and a generated-names list.

- Group Type is the project Vertical; do not introduce a duplicate Group Type table column when Vertical represents the same fact.
- Dum Dum maps to WED; Qua Qua maps to QQ; Corp maps to CORP.
- Branch options: HYD, VSKP, TPR, ERODE, CBE, BLR, MAL.
- Offer Name is optional. Social Media Posting is NSM / SM where applicable, and starts on NSM - a group is marked SM only when somebody chooses it. The generated name has a copy button beside it - the icon alone, turning into a tick once copied - which turns on once every required field is set.
- Qua Qua adds House Type IH / OH and GOU Yes / No; GOU is omitted entirely from its name when No.
- **Main Event Date Known** is asked first, and the Main Event Date is only asked for when it is on. A
  group is often opened before the day is fixed; with the toggle off the name carries no date and
  drops its separator with it, so it never ends in a dangling `|`. The toggle starts off.

Generated name rules (the `| <Date>` segment is present only when Main Event Date Known is on): Dum Dum uses `WED <Tier> <Branch> <Offer optional> <Groom> & <Bride> | <NSM/SM> | <Place> | <Date>`; Qua Qua uses `QQ<Branch> <Offer optional> <Client> | <Event> | <NSM/SM> | <IH/OH> | <GOU when Yes only> | <Place> | <Date>`; Corp uses `CORP <Branch> <Offer optional> <Client> | <Place> | <Date>`. Empty optional offer values must not leave double spaces or empty separators.

Lifecycle:

- On creation, an unused name receives an expiry 10 days after creation.
- Available-name APIs return only unused, unexpired names.
- Selecting a saved generated name in Create Project snapshots its metadata into the project and marks the generator name Used after project save.
- **The saved-name picker lists only the names saved against the enquiry chosen** — a name is generated for a lead, so the studio's whole pool of unused names is not a menu of choices — and re-reads as the enquiry changes. What is typed into it searches that list rather than becoming the value. The **Saved / Manual** switch stays: Manual is how a name is entered for a group the generator did not produce, and how an existing project's name is corrected, since the generator row is deleted once claimed and cannot be re-picked from any list.
  **Saved is offered only when there is something saved to pick.** Choosing an enquiry with no
  generated name already moved the switch to Manual; Saved is now disabled beside it rather than
  left pressable, since pressing it swapped a usable box for a dropdown whose only content was a
  sentence explaining that it was empty. It is disabled rather than hidden — the choice is still
  what the control is for — and it carries the reason as its tooltip. Three cases deliberately keep
  it available: while the list is still loading (or the button would flicker on every enquiry),
  while Saved is already the mode (an existing project whose enquiry has since lost its names must
  not have the button it is standing on greyed out), and before any enquiry is chosen, where the
  dropdown's "Choose an enquiry first" is the only place that guidance appears. The rule is
  `savedGroupNameModeAvailable` in `frontend/src/lib/saleGroupName.mjs`.
- **Enquiry ID is picked, never typed.** The box searches the CRM's leads and the value changes only when a row is chosen, so a project cannot be booked against an enquiry the CRM does not hold. The same control backs the W/A Group-Name Generator's Enquiry ID.
- Changing the enquiry gives up the name that belonged to the previous one, `whatsappGroupNameId` included — that id is the generator row the save claims, so a stale name would claim another enquiry's reservation.
- Used/expired names disappear from available selection but are preserved in generator history and project history.
- Project keeps its WhatsApp Group Name text permanently.

Generator metadata carried with generated-name projects:

- Vertical, Branch, Offer Name, Client Name, Place, Main Event Date.
- GOU, House Type, Social Media Posting.
- Generated WhatsApp Group Name.
- Generator Created At, Generator Expires At, Generator Used Status.

Manual-name projects show name text; unavailable generator metadata displays as blank/dash.

## Project Management Projects

Route: `/project-management/projects`

Tabs and status mapping:

- All — all non-deleted projects.
- Yet to Start — `Yet to Start`.
- In Progress — `Work in Progress - Pre & Production` or `Work in Progress - Post Production`.
- Completed — `Delivered`.
- Other statuses appear in All: Rejected, Cancelled & Refunded, Client not Turned, On Hold, Duplicated, Date Elapsed.

All Project Status values:

`Yet to Start`; `Work in Progress - Pre & Production`; `Work in Progress - Post Production`; `Rejected`; `Cancelled & Refunded`; `Client not Turned`; `On Hold`; `Delivered`; `Duplicated`; `Date Elapsed`.

Row actions:

- Yet to Start: **Start**, Delete.
- Any other status: **Edit**, Delete.
- One entry, not one per permission. Editing the sale and editing the plan were two of them opening
  two forms that each asked for half of the same project; they are one form now — see *Start Project
  and Edit Project* below — and this is the one way in. It reads **Start** until the project has been
  started, because the press that saves it is the press that puts the project in progress; after that
  there is nothing left to start, so it reads **Edit**.
- What it opens still follows permission. `PROJECT / Projects` `READ_WRITE` opens the merged form;
  a role holding only `SALES / Sales Manager` `READ_WRITE` opens Edit Sale Details, the sale on its
  own, exactly as Bookings & Converted does. Delete stays with the sale's permission.
- Delete is soft delete. It does not remove W/A generator history.
- **Deleting a project removes the client storage raised against it**, in the same transaction that
  soft-deletes the project and its Image Selection presence — so a hard disc is never left on the
  Client Storage register filed against a project that appears nowhere else. It has to be named
  there rather than left to the database: the project is soft-deleted, so its row stays and the
  foreign key's `ON DELETE SET NULL` never fires, and the storage register filters on its own
  `is_deleted` alone. The records are marked with the same three columns the register's own
  **Remove** writes and the reason says the project went; a record already removed keeps its own
  reason. The reply says how many went, because a hard disc is a real object and one leaving the
  register is worth saying out loud.

View modes:

- **Row View** is the standard projects table with filters, sorting, Manage Columns, CSV export, infinite scroll, Info Panel, and project tabs.
- **Tree View** shows Project → Shoot Creation → Production Creation and preserves project actions where supported.

Manage Columns makes sales, generator metadata, Identification, Shoot summary, service summary, and deliverable summary data available. No internal IDs may appear in UI; Shoot IDs must be business IDs.

## Start Project and Edit Project

The same project-scoped schema form is used for Start Project and Edit Project. Its sections are
**Sale Details**, **Project Setup** (the four crew assignments plus Welcome Gift, Project Validity,
Storage Needed and CRD Document — named Identification until it was renamed for what it holds),
Sales Remarks, Service Creation and Shedule Payment.

### The sale, read-only at the head of the form

The form holds the whole project: what was sold, and the plan made of it — but it only **makes** the
plan. **Sale Details** is its first section and is never editable on it, in either mode and whatever
the viewer holds. A project converts at a sale before any plan exists, and the shoots, the services
and the payment schedule below are all built on those figures; changing one is a deliberate act on
the sale, done in Sales Manager's own **Edit Sale Details**, not a side effect of planning.

What the section shows: **one card of label-over-value pairs** — Project Status, Event ID, Enquiry
ID, Quotation, Client Main Number, Source Branch, WhatsApp Group Name, Vertical and CRM Name — drawn
by `shared/RecordSummaryCard`, the same card the cash entry form states the project it is filed
against with.

**Not** what the project converts at: that figure heads Shedule Payment further down this same form
as **Signed Quotation**, and stating it twice on one screen is two places for a reader to check
against each other.

It went through two wrong shapes to get here. First a one-line summary strip, which read as a
footnote to the form rather than as the sale the plan is being made against — the figures a
coordinator checks before assigning anybody were the smallest text on the screen. Then read-only
text boxes, which state a value in the shape of a field somebody has closed to you. Neither is what
this is: nothing in the section is a field, it is what the screen already knows, and the plan below
is what is being answered.

- **One permission, one pair of endpoints.** The form is `PROJECT / Projects`, written through
  `PATCH /api/sales/projects/:id/start-project{,-draft}`. It never calls
  `PATCH /api/sales/projects/:id`, and it asks for none of the lists a sale is edited with — the
  generated group names and the SALES employees are Edit Sale Details' own.
- **Sales Remarks stays one section.** It is part of the plan's payload, as it always was.
- **Shedule Payment's Signed Quotation** is the project's stored Initial Converted Value — the
  figure the sale settled. It is read-only on **Start Project** and editable on **Edit Project**,
  and it is the one sale field this form writes. It rides on the start-project endpoints with the
  rest of the plan, which means **whoever may edit a started project may change what it was sold
  for** — the Project Manager, a branch administrator or a Super Admin, a wider set than
  `SALES / Sales Manager`. That is the deliberate cost of putting the figure where it is read: every
  amount in the section is a share of it, so sending somebody to another screen under another
  permission to correct one number was why it went uncorrected. Starting a project does not offer
  it, and the payload omits it when the box is empty, so neither Start Project nor the autosave can
  blank a figure it never asked about.

- **Once a project has started, only its Project Manager or a branch administrator may change it.**
  Planning is `PROJECT / Projects` `READ_WRITE`, and that is the right question up until the project
  starts; after that the plan is being worked to — shoots rostered against it, services allocated,
  money scheduled — and changing it belongs to the person answerable for the work. So a started
  project is editable by the employee named as its **Project Manager**, or by a holder of
  `ADMIN / Branch Administration`; a Super Admin holds that along with everything else and is
  covered by it, with no role check anywhere. Everyone else keeps **View** and loses **Edit** — the
  entry is absent from the row menu rather than refusing, and every endpoint that writes to a
  project's plan refuses it too: the start-project pair, shoots, service and deliverable
  allocations, production deliverables.
- **The record itself — its booking details, and deleting it — belongs to the people working to the
  project, and the two are asked separately.** Editing the sale under a project and deleting the
  project both used to answer to `SALES / Sales Manager` `READ_WRITE`, which is the permission that
  *books* one: so the CRM who typed a booking could go on rewriting it long after the studio had
  begun working to it, and could delete it outright. Making a project and unmaking one are not the
  same act. **Changing** it (`requireProjectEditor`) is now for anybody the project is staffed to —
  its **Project Manager**, **Pre Production Coordinator**, **Creative Manager** or **Post Production
  Coordinator** — because each of them is working to it and each has reason to correct what it says.
  **Deleting** it (`requireProjectDeleter`) is for its **Project Manager** alone: a coordinator runs
  a stage of the work, and removing the project out from under everybody else working to it is not a
  stage of anything. A holder of `ADMIN / Branch Administration` passes either, a Super Admin being
  covered by that. Neither has a **Yet to Start escape**: a project that has not started is staffed
  to nobody, because those fields are asked for on the Start Project form and not on the booking
  form, so until somebody is named the branch administrator is the only answer. **The plan is
  unchanged** — shoots, allocations and the start-project pair stay the Project Manager's, since a
  coordinator works a stage of a plan rather than re-planning it. What this costs is deliberate:
  **the CRM who books a sale can no longer correct it afterwards**, on Project Management's Projects
  or on Sales Manager, since one endpoint serves both screens and both hide the entry rather than
  offering an Edit the server refuses. Booking a **new** project is untouched, and so is
  **Duplicate**, which books a second one. Whoever may plan also gets a separate **Edit Sale
  Details** entry, because the plan form shows the booking read-only — without it the people who may
  now change a booking would have had no way to reach one.
- Start Project is available only while status is Yet to Start. `Start Project` saves data and changes status to `Work in Progress - Pre & Production`.
- Save to Draft persists workflow data without changing project status.
- Edit Project is available after start. Save Project persists changes without forcing/reverting status.
- Closing without draft can discard unsaved local edits. Opening another project clears local state and loads only that project’s data.

Sections:

1. Sale Details (read-only — see above)
2. Identification
3. Shoot Creation and Production Creation (the Service Creation section)
4. Shedule Payment — its **Signed Quotation** is the project's Initial Converted Value, the figure
   Create Project takes from the quotation raised for the enquiry, and the same one the Payments tab
   totals as *Initial signed*. It is **not** derived from the Service Creation rows: adding a service
   to the plan does not reprice a schedule, and neither does a later version of the quotation.

Identification currently includes searchable Active-tab employee selectors for Project Manager, Pre Production Coordinator, Creative Manager, and Post Production Coordinator; Welcome Gift (Applicable/Non Applicable); Project Validity in Months; Storage Needed (Yes/No); and CRD Document status (Not yet received, Groom Side received, Bride Side received, Not Applicable). Project Status is intentionally not shown in Identification.

Sale Details reads the project's vertical as Dum Dum, Qua Qua or Corp. A project is only told its vertical directly when its WhatsApp group name came from the generator; when the name was typed by hand, the vertical of the CRM lead behind the enquiry is used instead, so the field is answered either way.

### CRD Documents

The CRD Documents screen lists one row per project that needs a Customer Identification Document, plus every document created on its own from the screen. A vertical picker beside the heading narrows the table to Dum Dum or Qua Qua - the two verticals that collect this document - and the status tabs count within whichever it is set to. It opens on Dum Dum.

On the client's **Qua Qua** form, Identification opens with **Event ID** and **WhatsApp Group Name** side by side, both read back from the project — the group name used to be typed by the client, which made the project's name depend on a stranger spelling it the way Sales had. Neither is required, for the reason the Dum Dum block gives below: a field nobody can type in cannot be one that blocks submission, and a document raised by hand has no project to take a name from.

On the client's Dum Dum form, **Event Details** is no longer read-only throughout. What the booking settles — Event ID, WhatsApp Group Name, Event Type, Referred By — is read back; **Point Of Contact Name**, **Point of Contact Phone Number** and **Event Address Link** are the client's to answer, prefilled from the lead where it had them, and drawn below the event dates so the three read together. The two dates are one or the other per booking: **Event Start Date & Time** is read back where the booking answers it (the lead's planned date, else the shoot's) and asked for where it does not; **Event End Date & Time** is always the client's, because nothing in the studio's data says when an event ends — it used to be prefilled with the *start* date, which stated an end time nobody had given. Which is which comes from the server (`prefilledCommonFields`), never from the box being empty: the prefilled start date is written back on the first save, so a form reading emptiness would hand a field over on arrival and take it back on the next visit with the client's own answer locked inside it. None of these is required.

A project answering **CRD Document: Applicable** raises its document as it saves — from Start Project and from Edit Sale Details both, since the answer is asked on each and Edit is where a booking saved as Not Applicable gets put right — so its **CRD ID** is on the register from that moment rather than appearing only once `Send Link` is pressed. The document is created marked as never sent, which is what keeps **Link Not sent** meaning what it always did: `Send Link` moves it to **Yet To Receive**. Raising it twice raises one document and spends one number. A project answering **Not Applicable** raises nothing — that is the case the button below exists for.

`Create CRD Document` issues a document for a client whose project has not been started yet: it asks for the vertical, the client (Groom and Bride names for Dum Dum, Client Name for Qua Qua), a contact number and an optional Enquiry ID, and generates that client's own public link immediately. Every press creates a new document with a new link. `Send Link` on a project row still hands back the same link every time, because the client may already be holding it. The document takes its **CRD ID** as it is created — the same per-vertical run an issued link takes, `DBS-CRD-QQ-000001` — because this call *is* the document being issued and the studio quotes that identifier from the moment the link goes out. It used to be left null and nothing ever filled it in: a document raised here is never adopted by a project (that button exists for projects answered **Not Applicable**, which never adopt), so the CRD ID column stayed blank for good. Most visible on Qua Qua, whose projects are the ones answered Not Applicable and then given a document by hand. `scripts/backfillCrdDocumentCodes.js` names the ones raised before that.

The vertical decides which form the public link renders. Only the Dum Dum form - the wedding document with its Groom and Bride tabs - exists today; a Qua Qua document opens it until the Qua Qua form is built, and the create dialog says so.

### Shoot Creation

- Add Shoot dialog asks **Shoot Date Known** — the same Yes/No toggle the W/A Group-Name Generator uses for Main Event Date Known, opening on Yes — and then Date Created where the answer is Yes (today by default, editable), plus Shoot, Shoot Place, District, State, Event Start Time, and Event End Time. On No the Date is not shown and the shoot saves without one — a wedding is regularly sold before the family fixes the reception date. An undated shoot reads as "—" wherever a shoot date is listed, does not set the project's Main Event Date even when it is the main event, and is treated by Image Selection as a shoot that has not happened, so its folders and selection items stay closed until a date is put on it.
- District is searchable/text-entry capable; State auto-populates for known mappings but remains editable.
- Shoot ID is generated server-side as `DBS-SID-DD-ERD-000001` — the project's vertical and branch,
  counted per vertical; internal Prisma IDs never display.
- Multiple shoots are supported and reload from backend when the form reopens.
- Remove Shoot uses confirmation and soft deletes the shoot plus related production and post-production child rows.
- **Preference** — Groom, Bride or Both — is asked of **Dum Dum shoots only**: a Qua Qua baby shoot
  or a Corp shoot has no sides to follow. It starts on **Both**, the answer that covers the whole
  event, and is required only where it is shown. The dialog reads the vertical from the screen that
  opened it — the Quotation Generator's vertical, or Create Project's group type.

Current shoot options: Haldi; Bride Haldi; Groom Haldi; New Born; Baby Shoot IH; Baby Shoot OH; Baby Shoot_CP; Birthday Shoot; Puberty Function; Puberty Outdoor; Engagement; Pre Wedding; Mehandi; Wedding; Post Wedding; Baby Shower; Maternity IH; Maternity OH; Industrial; Tours; Misc; Maternity CP; Reception; Rituals; Ear Piercing; Couple Shoot IH; Naming ceremony; Family; Bride Making; Groom Making; Others; Sangeeth; Corporate; Collaboration; Wedding + Reception.

### Production Creation

User-facing meaning: **Services, Service Details, and Deliverables**, stored shoot-wise. Each shoot can have multiple service and deliverable rows with row actions.

Services include: Indoor Photo Only; Services; Traditional Photo; Traditional Video; Candid Photo; Candid Video; Drone; Assistant; LED Wall; TV; Mixing Unit; Crane; AI Feature; Support; Semi Candid Photo; Semi Candid Video; Spot Editing; Spot Printing; Spot Framing; 360 Camera Booth; 360 Video Booth; Indoor Photo Shoot + Reels; Outdoor Photo + Reels; Outdoor Photo Only; Pre/ Post Wedding Photography; Pre/ Post Wedding Videography; Pre/ Post Wedding Candid Photography; Pre/ Post Wedding Candid Videography; 360 Video Camera; Youtube Live; Corporate Video; Corporate Photo; Headshots; Product Photography; Product Videography; Product Photo & Video; Details in Old Sheet; Makeup; Makeup & Hairdo; Semi Candid Photo + reel; Candid Photo + Reels; Comp Drone; Added in same day Function; Only Post Production; Live Picture Upload AI Feature.

Deliverables are managed in the same Production Creation area. Quantity defaults to 1 and row actions remove a deliverable.

Deliverables include: Final Files Out; Acrylic Printing; AI Feature; AI Retouch; Album Designing; Album Printing; Album Selection; Bloopers; Calender Designing; Cinematic Full Length; Cinematic Highlights; Cinematic Teaser; Compressed Images; Count Down Poster; Culling Highlights Editing; Custom Gifts; Documentary; E-Invitation; File IN; Frames Printing; Frames Retouching/ Designing; Hard Disc Recieved; Hard disc YTR; HDD Delivery; HDD File Backup; HDD Final Files Copying; HDD Footages Copy; HDD Status; Maxiprint; Photo Culling; Print only; Reels; Retouches; Save The Date; Shots; Signature Album; Slide show; Traditional Full Length; Traditional Highlights; Training; Wedding Documentary; In Another SID.

## Reading a project: the record view

Double-clicking a project row opens the record in full — the same read-only panel every table in the OS opens on a double-click, never the edit form. On Projects it carries two tabs:

- **Details** — the record's own sections, listed on the rail beside them as before.
- **Payments** — below.

### Payments

What the project has actually taken in and paid out, as opposed to the plan the Shedule Payment section of the edit form holds.

- **Cash Received** lists the entries taken in against the project on a light green row, **Cash Spent** the ones paid out on it on a light red row, newest first. The two are named for the directions a cash entry is filed under, not as income and expense, so the tab and the Accounts Manager say the same thing about the same record. Each row shows what the entry was for, the amount — money in with a `+`, money out with a `-` — and the date it moved, stamped with a calendar so it can be found without reading. Beside the date, a received entry named in its own words carries the category that places it, and a spend carries the shoot it was spent on and nothing else: who was paid is on the entry in Accounts, and here it crowded a row whose question is which shoot cost what.
- **Payment Summary** gives what moved and then what it is measured against: **Total cash received**, **Total cash spent**, **Total quotation** (the project's Initial Converted Value, what the sale was converted at), and **Extra** (whatever has come in above that figure — an add-on shoot agreed after the sale is paid for on top of the quotation, so the money over it is the money for the add-ons; floored at zero, since a project paid less than it was sold for has a balance still to come rather than an extra). Extra is a slice of what came in, not a figure to add to it. Nothing is derived from these four — what a project *made* is a question for Accounts, who know what else it cost. The space below the summary is left empty for what the tab grows into.
- Each list has an **Add** button in its heading, which opens Accounts' own cash entry form in that direction — Cash Received or Cash Spent — with **this project already filled in**: the direction and the project are read back rather than asked for, the branch is filled from the project's source branch, and money out is offered this project's shoots alone. Saving re-reads the lists and the totals in place. Save & Next keeps both the direction and the project for the next entry.
- The rows are Accounts' cash entries (`CashEntry`), read through `GET /api/sales/projects/:id/payments`; recording one writes through `POST /api/accounts/cash-entries`, so there is one record of a payment and not two. Withdrawn entries are excluded.
- The entry form asks for no branch. A cash entry's branch is the Source Branch of the project it is filed against, read on the server, which is why every entry recorded through a form must name one: money in names the project, money out one of its shoots. A spend belonging to no project — an office expense, a salary advance — is raised as a payment request instead, which resolves its own branch and writes the entry when it is approved.
- **Permissions.** Reading the tab asks for `PROJECT / Projects` `READ` **and** `ACCOUNTS / Cash Management` `READ` — the endpoint requires both, and the screen offers the tab only with both. The Add buttons additionally ask for `ACCOUNTS / Cash Management` `READ_WRITE` and are absent without it.
- The tab appears on the Projects screen only. The Pre / Production / Post boards open the same record view, and their viewers hold those features rather than Projects, so it is not offered there and their record view has no tab bar at all.


### Extras

Work agreed on top of what the project was sold for — an extra shoot, an album nobody quoted.

- Raised as an **Extra Quotation** (`EXT-000001`) naming the project, optionally a shoot, a service
  from the studio's own list, an amount, remarks, and an image of what the client agreed to. Two
  entry points, one panel: the **+** on the project's Extras column, and an **Extra Quotation**
  button on Payment Requests.
- It is **not** a payment request and has its own table, `project_extra_quotation`. The four payment
  requests are the studio paying somebody and approving one writes a cash entry; an extra agrees
  work and writes nothing to the books. The client pays for it later as an ordinary receipt.
- It sits at **Approval pending** until decided. Only the manager named on that project — or a super
  admin — may decide it: approving spend and agreeing to sell more work are different authorities,
  so holding `ACCOUNTS / Payment Request Approval` is not enough. Rejecting asks why.
- Only **approved** extras count. They appear in the Extras column and are what the Project Summary's
  **Extra** figure totals. A pending one shows beside them, drawn back and uncounted; a rejected one
  shows nowhere.
- Raising and reading answer to `PROJECT / Projects`.
- Two places read them. The project's **Extras** column shows that project's own, waiting ones drawn
  back above the approved. The **Extra Quotations** tab on Payment Requests is the working list:
  what you raised and what waits on your decision, in one table with the same columns, filters and
  export as every other table. Note that tab sits on a screen guarded by
  `ACCOUNTS / Payment Request Approval` — a project manager holding only `PROJECT / Projects` cannot
  open it, and reaches their decisions through the project instead.

## Project Management Submodules

### Pre Production

- `/project-management/pre-production` shows projects with a saved Pre Production Coordinator.
- `/project-management/pre-production/dum-dum` filters Dum Dum/WED.
- `/project-management/pre-production/qua-qua` filters Qua Qua/QQ.
- `/project-management/pre-production/corp` filters Corp/CORP.

### Production

`/project-management/production` currently shows projects in `Work in Progress - Pre & Production`. Detailed photo/videographer execution workflow is deferred.

### Post Production

`/project-management/post-production` currently shows projects with a saved Post Production Coordinator. Future employee-specific assignments and execution are deferred.

## Important Recent Fixes

- Start Project state and API loading were corrected to be scoped by project and shoot IDs.
- Internal/random shoot IDs were replaced in UI with DBS-SID business IDs.
- Production/Post Production user-facing section meaning was corrected: Production = Services; Post Production = Deliverables.
- Start Project form syntax/runtime issues were fixed.
- Shoot Centre was removed from the Project Management sidebar.
