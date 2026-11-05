/**
 * The permission catalogue: every `module / feature` the application can grant, and the named
 * sub-actions under each.
 *
 * Data only - no database, no imports - for two readers rather than one. The seed beside this file
 * writes it into `permission`, and `test/permission-catalogue-sidebar.test.js` reads it to hold it
 * against the sidebar registry in the frontend package, so a screen in the menu and a row in Role
 * Management cannot describe two different applications. That test is why this is a module rather
 * than a literal inside the seed: requiring the seed would open a database connection.
 *
 * Adding a permission here is what makes it grantable. A guard naming a `module / feature` that is
 * not in this list refuses everybody but a Super Admin, and no error says so - see CLAUDE.md
 * Rule 4.
 */

// ============================================
// PERMISSIONS DEFINITION
// ============================================

const PERMISSIONS = [
  // ============================================
  // ASSET MODULE
  // ============================================
  // `Asset Management` is the whole Assets screen for the people who work with equipment: the
  // register, the inspections recorded against it, and raising a request for an asset. They are
  // steps of the same job and were only ever granted together, so three rows asked the studio to
  // answer the same question three times. It is meant to be held widely.
  //
  // Two things are carved out of it because they are not everybody's. `Asset Administration` puts
  // equipment *onto* the register and names who holds and manages it - the studio decides what it
  // owns, and that is not the same act as looking after a camera. `Asset Request Approval` decides
  // somebody else's request. Both are granted to few; the first is not implied by the second.
  {
    module: "ASSET",
    feature: "Asset Management",
    level: "ASSET_MANAGE",
    displayName: "Manage Assets",
    description: "The asset register, inspections, custody, and raising a request for an asset"
  },
  {
    module: "ASSET",
    feature: "Asset Administration",
    level: "ASSET_ADMINISTER",
    displayName: "Administer Assets",
    description: "Add assets to the register, singly or in bulk, and name who holds and manages them"
  },
  {
    module: "ASSET",
    feature: "Asset Request Approval",
    level: "ASSET_REQUEST_APPROVE",
    displayName: "Approve Asset Requests",
    description: "Accept or reject the asset requests other people raise, and read all of them"
  },
  {
    module: "ASSET",
    feature: "Vendor Management",
    level: "VENDOR_MANAGE",
    displayName: "Manage Vendors",
    description: "Create, read, update, delete the vendors assets are serviced by"
  },
  {
    module: "ASSET",
    feature: "Client Storage",
    level: "CLIENT_STORAGE_MANAGE",
    displayName: "Manage Client Storage",
    description: "Track client storage media and their movements"
  },
  // Resource Management -> Project Vault (the feature key keeps its first name, Recycling Bin, which
  // every grant and guard names): deleted projects wait there until restored or deleted permanently.
  // Also in migration 20261029170000_project_recycling_bin, granted to SUPER_ADMIN only; renamed on
  // screen by 20261031140000_project_vault_label.
  {
    module: "ASSET",
    feature: "Recycling Bin",
    level: "RECYCLING_BIN_MANAGE",
    displayName: "Project Vault",
    description: "Deleted projects: see them (Read), and restore them or delete them permanently with their photos (Read / Write)"
  },

  // ============================================
  // HRM MODULE
  // ============================================
  {
    module: "HRM",
    feature: "Employee Management",
    level: "EMPLOYEE_MANAGE",
    displayName: "Manage Employees",
    description: "Create, read, update, delete employee records"
  },
  // Attendance is two permissions because it is two jobs. Marking your own day and asking to be
  // away is something every employee does, so it is granted broadly; answering somebody else's ask
  // is not, and mostly is not a permission at all — the approvers are the three Leave Approval
  // slots on the employee's own record, and this second row is the studio-wide override above them.
  {
    module: "HRM",
    feature: "Employee Attendance",
    level: "ATTENDANCE_MARK",
    displayName: "Employee Attendance",
    description: "Mark your own login and logout, and raise leave, permission and on-duty requests"
  },
  {
    module: "HRM",
    feature: "Attendance Approval",
    level: "ATTENDANCE_APPROVE",
    displayName: "Approve Attendance Requests",
    description: "Decide anyone's leave and permission requests, and set the shift, weekly offs and holiday calendar"
  },
  // HRM → Request: leave, permission and comp-off requests on a screen of their own. Its own row so
  // the screen can be granted apart from Employee Attendance; the request endpoints accept either.
  // Who may *decide* a request is still the approver slots on the requester's record, or the row above.
  {
    module: "HRM",
    feature: "Requests",
    level: "ATTENDANCE_REQUESTS",
    displayName: "Requests",
    description: "HRM → Request: raise and track your own leave, permission and comp-off requests, and answer the ones you are named an approver on"
  },
  // HRM → Events: the studio's events, a photo and a description each. Read is enough to see them
  // and to post one; an event is removed only by whoever posted it, or an administrator. Migration
  // 20260926100000 adds the same row and its first grants.
  {
    module: "HRM",
    feature: "Events",
    level: "EVENTS",
    displayName: "Events",
    description: "HRM → Events: see the studio's events and post your own photo and description; only the poster or an administrator can remove one"
  },
  // HRM → Events → Download: an event's photos saved as a file - the photo, or a ZIP of several.
  // Its own row so the studio decides who may take the photos away apart from who may see them;
  // Read is enough, a download changes nothing. Migration 20261026120000 adds the same row, granted
  // to SUPER_ADMIN only.
  {
    module: "HRM",
    feature: "Event Download",
    level: "EVENT_DOWNLOAD",
    displayName: "Download Events",
    description: "HRM → Events: Download on each event, saving its photos - the photo itself, or a ZIP of several. Needs HRM → Events as well. Without it there is no Download and the photos can only be viewed"
  },
  // Four attendance permissions for what used to be "administrators only" in code, so each can be
  // granted in Role Management. Migration 20260928120000 adds the same rows and grants them to the
  // SUPER_ADMIN role and every administrator role - who held them in effect before. (Attendance
  // Calculator and Attendance Logs were two more; 20260929110000 took them back off Role Management,
  // and what they opened is administrators' alone again.)
  {
    module: "HRM",
    feature: "Attendance Rules",
    level: "ATTENDANCE_RULES",
    displayName: "Attendance Rules",
    description: "Read / Write changes the attendance rules: shift, weekly offs, half-day band and office locations"
  },
  {
    module: "HRM",
    feature: "All Requests",
    level: "ATTENDANCE_ALL_REQUESTS",
    displayName: "All Requests",
    description: "See every leave, permission and other attendance request in the studio on HRM → Request (deciding stays with the named approvers)"
  },
  // Who links the WhatsApp group the Attendance Register's daily report goes into, and sends it from
  // their own WhatsApp. Migration 20260929100000 adds the same row, granted to administrators.
  {
    module: "HRM",
    feature: "Attendance WhatsApp Report",
    level: "ATTENDANCE_WHATSAPP_REPORT",
    displayName: "Attendance WhatsApp Report",
    description: "Link the WhatsApp group the Attendance Register's daily report is sent to at 9:45 am, and send it from your own WhatsApp"
  },
  // Tasks are the one thing in the OS everybody does to everybody: anybody signed in may ask
  // anybody else to do something, so this is meant to be granted to every role rather than held by
  // a few. READ is a screen you can read your own tasks on and nothing more; READ_WRITE is what
  // giving a task, finishing one and sending one back all need - splitting those two apart would
  // have left somebody able to be given work and unable to say they had done it.
  {
    module: "HRM",
    feature: "Task Management",
    level: "TASK_MANAGE",
    displayName: "Manage Tasks",
    description: "The Tasks screen: assign a task to anyone, and complete or revert the tasks assigned to you"
  },
  /*
   * The referral register, and the amount behind it.
   *
   * `HRM` rather than `ACCOUNTS`, which is what guarded the referral routes while the register was
   * a section of a settings panel. It is a screen of its own under HRM now - Employee Referral,
   * beside the repository the referrals are recorded in - and a permission is granted where the
   * screen it opens lives, so somebody may be given the referral register without being given
   * payroll. `READ` reads the register and the amount; `READ_WRITE` changes the amount and marks an
   * instalment paid.
   */
  {
    module: "HRM",
    feature: "Employee Referral",
    level: "REFERRAL_MANAGE",
    displayName: "Employee Referrals",
    description: "The referral register: who the studio owes a referral to, marking an instalment paid, and the amount a referral pays"
  },
  // Reading the whole studio's tasks is a supervisor's question, not the same one as keeping your
  // own list, so it is its own row and its own endpoint. Its screen is the All Tasks tab.
  {
    module: "HRM",
    feature: "All Tasks",
    level: "TASK_VIEW_ALL",
    displayName: "View All Tasks",
    description: "Read every task in the studio, not only the ones you were given or gave"
  },
  /*
   * The Interview screen: HRM's counterpart of Leads & Followups. One permission for the register,
   * every route under `/api/hrm/interview`, and the Settings → Integrations → Interview section that
   * links the Google Sheets feeding it - they are steps of one job, hiring, and were never going to
   * be granted apart. Written into a migration as well (20260918100000), as every row here must be.
   */
  {
    module: "HRM",
    feature: "Interview",
    level: "INTERVIEW_MANAGE",
    displayName: "Interview",
    description: "The Interview screen: the candidates the studio is considering, their stage, their interviewer, and the Google Sheets linked under Settings → Integrations → Interview that feed it. Read reads the register; Read / Write adds, edits and links sheets"
  },
  /*
   * The tick boxes on the Interview table, carved out of `HRM / Interview` Read / Write for the
   * reason `SALES / CRM Lead Select All` was carved out of the board beside it: working the register
   * one candidate at a time and acting on a whole stage at once are different jobs, and the studio
   * wants to say who does the second without withholding the first.
   *
   * The boxes change nothing by themselves; what they lead to is a write over a set the reader never
   * has to look at - a stage moved across every candidate ticked, or a bulk delete that takes the
   * stage with it. Without this the column of boxes is absent and the register is worked a row at a
   * time, which is what the rest of the screen does. Read grants nothing: there is no reading a
   * selection, so it is a Read / Write row or no row at all.
   *
   * Written into a migration as well (20260921100000), as every row here must be.
   */
  {
    module: "HRM",
    feature: "Interview Select All",
    level: "INTERVIEW_SELECT_ALL",
    displayName: "Select Candidates in Bulk",
    description: "Read / Write to tick candidates on the Interview register and act on the whole selection at once - moving every ticked candidate to a stage, and deleting them together. Without it the tick boxes are absent and candidates are worked one at a time"
  },

  /*
   * Speak-up: a confidential line to HR, not anonymous - HR sees who wrote it, so they can follow
   * up, but nobody else in the studio can. Lives inside Employee Attendance's own section dropdown
   * rather than a page of its own, the same way `Rules` does for its approval permission - see
   * `HRM / Speak-up Review` below and `NO_MENU_ENTRY` in permission-catalogue-sidebar.test.js.
   * READ alone only shows someone their own past submissions without letting them write a new one;
   * READ_WRITE is what an ordinary employee role is meant to be granted.
   */
  {
    module: "HRM",
    feature: "Speak-up",
    level: "SPEAK_UP",
    displayName: "Speak-up",
    description: "Write HR something personal, and see your own past Speak-ups"
  },
  // Reads every Speak-up submitted, studio-wide - deliberately not branch-scoped, since narrowing a
  // confidential channel by branch would hide genuine complaints from an HR holder scoped to one
  // branch. Nothing to write: a one-way inbox has no decision to record.
  {
    module: "HRM",
    feature: "Speak-up Review",
    level: "SPEAK_UP_REVIEW",
    displayName: "Speak-up Review",
    description: "Read every Speak-up submitted, across every branch"
  },

  // HRM → Payroll: an empty screen for now. Also in migrations - 20261008200000_hrm_payslip_permission
  // created it as Payslip, granted to SUPER_ADMIN only, and 20261008210000_hrm_payslip_renamed_payroll
  // renamed it.
  {
    module: "HRM",
    feature: "Payroll",
    level: "PAYROLL_VIEW",
    displayName: "Payroll",
    description: "The Payroll screen"
  },

  // HRM → Payslip: the signed-in employee's own payslips. Also in migration
  // 20261012250000_hrm_my_payslip_permission, granted to SUPER_ADMIN only.
  {
    module: "HRM",
    feature: "My Payslip",
    level: "HRM_MY_PAYSLIP",
    displayName: "My Payslip",
    description: "HRM -> Payslip: the signed-in employee's own payslips"
  },

  // HRM → Payroll → Recovery: amounts taken back from salary over months. Also in migration
  // 20261008230000_hrm_payroll_recovery, granted to SUPER_ADMIN only.
  {
    module: "HRM",
    feature: "Payroll Recovery",
    level: "PAYROLL_RECOVERY",
    displayName: "Payroll Recovery",
    description: "Payroll -> Recovery: amounts taken back from salary over months"
  },

  // HRM → Payroll → Policy Breach: fines for a policy breach taken from salary over months. Also in
  // migration 20261024120000_hrm_payroll_policy_breach, granted to SUPER_ADMIN only.
  {
    module: "HRM",
    feature: "Payroll Policy Breach",
    level: "PAYROLL_POLICY_BREACH",
    displayName: "Payroll Policy Breach",
    description: "Payroll -> Policy Breach: fines for a policy breach taken from salary over months"
  },

  // HRM → Payroll → Advance Salary: amounts paid ahead of salary, taken back from one month's payroll.
  // Also in migration 20261009120000_hrm_payroll_advance, granted to SUPER_ADMIN only.
  {
    module: "HRM",
    feature: "Payroll Advance",
    level: "PAYROLL_ADVANCE",
    displayName: "Payroll Advance",
    description: "Payroll -> Advance Salary: amounts paid ahead of salary, taken back from one month's payroll"
  },

  // HRM → Payroll → Main Page: the monthly payroll register, and Settings → Payroll rules. Also in
  // migration 20261009100000_hrm_payroll_register, granted to SUPER_ADMIN only.
  {
    module: "HRM",
    feature: "Payroll Register",
    level: "PAYROLL_REGISTER",
    displayName: "Payroll Register",
    description: "Payroll -> Main Page: the monthly payroll register, and the Payroll rules"
  },
  // Payroll -> Main Page, once a month is past its payable date: changing it at all. Also in migration
  // 20261015120000_payroll_after_payday, granted to SUPER_ADMIN only.
  {
    module: "HRM",
    feature: "Payroll After Payday",
    level: "PAYROLL_AFTER_PAYDAY",
    displayName: "Payroll After Payday",
    description: "Payroll -> Main Page: change a month after its payable date has passed (Read / Write)"
  },

  // ============================================
  // SALES MODULE
  // ============================================
  {
    module: "SALES",
    feature: "Sales Manager",
    level: "SALESPROJECT_MANAGE",
    displayName: "Manage Sales Projects",
    description: "The sale itself - enquiries, and creating, editing and deleting a sales project"
  },
  /*
   * Editing a **booking** - the sale's own record on Bookings & Converted (and on Projects), which
   * `SALES / Sales Manager` READ_WRITE deliberately does not carry.
   *
   * Creating a sale and changing one already made are different acts. Sales Manager READ_WRITE makes
   * the booking, and changing it afterwards answered to the record itself: the people the project is
   * staffed to, a branch administrator, or `PROJECT / Show All Projects` READ_WRITE. So the only
   * grantable way to let a CRM edit bookings they are not staffed on was Show All Projects - which
   * also hands them every project on Projects, Pre Production and Production. This is that one act
   * on its own.
   *
   * It is an **additional** way in, never a narrowing: whoever may edit a booking today still may. It
   * widens no *reading* either - the write looks its project up through the caller's own data scope,
   * so it reaches the bookings they can already see and answers 404 for anything else.
   * Read grants nothing - there is no reading an edit - so it is a Read / Write row or no row at all.
   * Deleting a booking is still its Project Manager's, and the plan is still the plan's own rule.
   */
  {
    module: "SALES",
    feature: "Booking Edit",
    level: "SALESPROJECT_BOOKING_EDIT",
    displayName: "Edit Bookings",
    description: "Read / Write to edit a booking on Bookings & Converted - the sale's own details, its payment schedule and its client login - without being staffed on the project. Only the bookings this person can already see; creating one is Manage Sales Projects, and deleting it stays with the Project Manager"
  },
  {
    module: "SALES",
    feature: "CRM Leads",
    level: "LEAD_MANAGE",
    displayName: "Manage Leads",
    description: "Manage CRM leads"
  },
  {
    module: "SALES",
    feature: "Quotation Management",
    level: "QUOTATION_MANAGE",
    displayName: "Manage Quotations",
    description: "Create and manage quotations"
  },
  /*
   * Deleting a lead, which `SALES / CRM Leads` READ_WRITE deliberately no longer carries.
   *
   * Working a board and destroying its records are different acts. Everybody who runs the CRM needs
   * the first - a status, a follow-up date, a remark - and a delete takes the lead, its remarks, its
   * call logs and its follow-up history with it, with nothing to undo it from. Ticking Read / Write
   * on the board used to hand every CRM out that, and the board offers a select-all over a whole
   * vertical, so one ticked header and one menu item is the whole branch gone.
   *
   * Its own row rather than a role test in the controller: a `req.user.role === "ADMIN"` check would
   * sit below the router's own guard, overrule it silently, and be grantable to nobody - CLAUDE.md
   * Rule 4. As a permission it is a tick in Role Management, a Super Admin passes it without being
   * named, and the studio can move it later without a deploy.
   *
   * Read grants nothing here - there is no reading a deletion - so this is a Read / Write row or no
   * row at all, which is what the description tells whoever is granting it.
   */
  {
    module: "SALES",
    feature: "CRM Lead Deletion",
    level: "LEAD_DELETE",
    displayName: "Delete Leads",
    description: "Read / Write to delete CRM leads, one at a time or a whole selection. Without it the CRM is fully workable and nothing can be destroyed"
  },
  /*
   * Two more acts carved out of `SALES / CRM Leads` READ_WRITE for the same reason deletion was:
   * working a board one lead at a time and acting on a whole board at once are different jobs, and
   * the studio wants to say who does the second without withholding the first.
   *
   * **Select All** is the tick boxes. On their own they change nothing, but everything they lead to
   * is a write over a set the reader never has to look at: Update Details rewrites a status, a
   * follow-up date or the CRM a lead is assigned to across a whole vertical, and a bulk delete for a
   * role that also holds `CRM Lead Deletion` takes the board with it. Without this the column of
   * boxes is absent and the board is worked a lead at a time, which is what most of the CRM does.
   *
   * **Import** is the CSV: a file somebody was handed, taking the vertical's whole template, landing
   * as many leads as the file has rows. Bulk Entry - the few-fields-at-a-sitting dialog beside it -
   * deliberately stays with the board's own Read / Write, because typing five leads is adding five
   * leads and is the job `CRM Leads` is granted for.
   *
   * Read grants nothing on either: there is no reading an import or a selection. Both are a
   * Read / Write row or no row at all, which is what the descriptions tell whoever grants them.
   */
  {
    module: "SALES",
    feature: "CRM Lead Select All",
    level: "LEAD_SELECT_ALL",
    displayName: "Select Leads in Bulk",
    description: "Read / Write to tick leads on the board and act on the whole selection at once - Update Details, and the bulk delete for a role that also holds CRM Lead Deletion. Without it the tick boxes are absent and leads are worked one at a time"
  },
  {
    module: "SALES",
    feature: "CRM Lead Import",
    level: "LEAD_IMPORT",
    displayName: "Import Leads",
    description: "Read / Write to bring a CSV of leads onto a board. Without it the CRM is fully workable and Bulk Entry still types leads in a handful at a time"
  },
  /*
   * Two screens of the Sales & CRM menu that used to answer for `CRM Leads` along with the board.
   *
   * A permission is what the Role Management screen offers, and it offered neither: granting the
   * CRM granted the reports and the directory with it, and there was no way to give a manager the
   * numbers without the leads behind them. Both endpoints are the screen's own, so each can be
   * asked for on its own - which is the only reason these are separate rows and the two production
   * boards' were not. Migration `20260909130000` copies every existing `CRM Leads` grant onto them,
   * so the split takes nothing away from a role that already had it.
   */
  {
    module: "SALES",
    feature: "Contacts",
    level: "CONTACT_DIRECTORY_READ",
    displayName: "Contacts",
    description: "The contact directory: every number the studio holds, each source shown only to somebody who may read that module"
  },
  // Calendar → a day's ⋮ → Block Period: hold a branch's hours on a day. Also in migration
  // 20261014180000_calendar_block, granted to SUPER_ADMIN only.
  {
    module: "SALES",
    feature: "Block Period",
    level: "SALES_BLOCK_PERIOD",
    displayName: "Block Period",
    description: "Calendar: see the branches' blocked hours (Read), and block or free them (Read / Write)"
  },
  // Client Management -> Client Chats: the chats clients start from their app. Also in migration
  // 20261028150000_client_chat, granted to SUPER_ADMIN only; moved from SALES by
  // 20261030100000_client_management_module.
  {
    module: "CLIENT",
    feature: "Client Chats",
    level: "CLIENT_CHAT_MANAGE",
    displayName: "Client Chats",
    description: "The chats clients start from their app: read them (Read), and answer them (Read / Write)"
  },
  // Client Management -> Client Offers: the offers on the Home page of the clients' app. Also in
  // migration 20261028130000_client_offers_permission, granted to SUPER_ADMIN only; moved from SALES
  // by 20261030100000_client_management_module.
  {
    module: "CLIENT",
    feature: "Client Offers",
    level: "CLIENT_OFFER_MANAGE",
    displayName: "Client Offers",
    description: "The offers shown on the Home page of the clients' app: see them (Read), and add, change or remove them (Read / Write)"
  },
  // Client Management -> Client Requests: what clients ask about their services and deliverables.
  // Also in migration 20261031130000_client_service_requests, granted to SUPER_ADMIN only.
  {
    module: "CLIENT",
    feature: "Client Requests",
    level: "CLIENT_REQUEST_MANAGE",
    displayName: "Client Requests",
    description: "Requests clients raise from their app about their services and deliverables: see them (Read), and answer them (Read / Write)"
  },
  // Client Management -> Client Requests -> Raised Requests: pricing and deciding what the studio asks
  // for on a project. Also in migration 20261104150000_project_change_requests, granted to SUPER_ADMIN only.
  {
    module: "CLIENT",
    feature: "Request Approval",
    level: "CLIENT_REQUEST_APPROVE",
    displayName: "Request Approval",
    description: "Requests the studio raises on a project (Client Requests -> Raised Requests): price each item and approve or reject it, and submit the decision that adds the approved items to the project (Read / Write)"
  },
  // Client Management -> Invitation Cards: the designs and songs clients make their invitations from.
  // Also in migration 20261030120000_invitation_cards, granted to SUPER_ADMIN only.
  {
    module: "CLIENT",
    feature: "Invitation Cards",
    level: "INVITATION_CARD_MANAGE",
    displayName: "Invitation Cards",
    description: "The invitation designs and songs clients choose from in their app: see them (Read), and add, change or remove them (Read / Write)"
  },
  {
    module: "SALES",
    feature: "Reports & Analytics",
    level: "CRM_REPORT_READ",
    displayName: "Reports & Analytics",
    description: "The CRM reports and the sales dashboard over them, narrowed to the leads the reader may see"
  },

  // ============================================
  // PROJECT MANAGEMENT MODULE
  // ============================================
  // Its own module, not more SALES features: once a sale becomes a project it is the production
  // pipeline's, and the people who run a shoot are not the people who sold it. Each stage reads the
  // same project register - that read is shared - but only Projects changes what is planned.
  {
    module: "PROJECT",
    feature: "Projects",
    level: "PMPROJECT_MANAGE",
    displayName: "Manage Projects",
    description: "Start a project, and plan its shoots, deliverables and allocations"
  },
  /*
   * Show All Projects: the register without the narrowing, and the way a project gets worked on by
   * somebody it is not staffed to.
   *
   * Changing a project belongs to the people it is staffed to and deleting it to its Project
   * Manager, which is right for a project that has people on it and leaves a gap on one that does
   * not: **a Yet to Start project is staffed to nobody**, because those seats are filled in on the
   * Start Project form rather than the booking form. So a freshly booked project could be started
   * only by a branch administrator, and the studio has people whose job is exactly that and who are
   * not administrators.
   *
   * This is that job, as something Role Management can hand out:
   *
   *   - **Read** shows every project in the studio, and nothing else. No Edit, no Start, no Delete -
   *     the row menu is View alone. It is the permission for somebody who has to *see* the whole
   *     register without being trusted to change it.
   *   - **Read / Write** may edit, start and delete any project, staffed to them or not.
   *
   * A permission rather than a role, so it is granted rather than coded: the two rules it widens
   * (`mayEditProject`, `mayDeleteProject`) name it the same way they name `ADMIN / Branch
   * Administration`, and neither reads `req.user.role`.
   */
  {
    module: "PROJECT",
    feature: "Show All Projects",
    level: "PMPROJECT_SHOW_ALL",
    displayName: "Show All Projects",
    description: "See every project in the studio, not only the ones you are staffed to. Read views the whole register and offers nothing else; Read / Write edits, starts and deletes any project"
  },
  /*
   * `PROJECT`, not `SALES`. The document is raised against a project and its screen sits under
   * Project Management in the menu, so Role Management has to list it there too - a permission is
   * granted where the screen it opens lives, and somebody handing out the project screens was
   * otherwise leaving this one behind without being shown that they had.
   *
   * It keeps its own row rather than folding into `Projects`: sending a client a link and asking
   * them to fill a form is a different act from planning a shoot, done by different people.
   * Migration `20260909130000` moves the existing row, so every grant follows it across.
   */
  {
    module: "PROJECT",
    feature: "CRD Documents",
    level: "CRD_MANAGE",
    displayName: "Manage CRD Documents",
    description: "Issue and review the client requirement documents raised against a project"
  },
  {
    module: "PROJECT",
    feature: "Pre Production",
    level: "PREPRODUCTION_MANAGE",
    displayName: "Pre Production",
    description: "The pre production board, including the per-branch views"
  },
  {
    module: "PROJECT",
    feature: "Production",
    level: "PRODUCTION_MANAGE",
    displayName: "Production",
    description: "The production board"
  },
  /*
   * Production Execution: whether a person runs a shoot's execution steps at all. Being named on
   * the shoot still decides which shoots (`production/access.js` `accessFor`); without this, a named
   * person reads the Execution tab and completes nothing. An action permission - no screen of its own.
   */
  {
    module: "PROJECT",
    feature: "Production Execution",
    level: "PRODUCTION_EXECUTION",
    displayName: "Production Execution",
    description: "Read / Write to run the execution steps of the shoots you are named on in Production. Also needs PROJECT / Production Read / Write"
  },
  {
    module: "PROJECT",
    feature: "Shoot Board",
    level: "SHOOTBOARD_VIEW",
    displayName: "Shoot Board",
    description: "A week of the shoots you and your team are named on, by day, coloured by project"
  },
  {
    module: "PROJECT",
    feature: "Post Production",
    level: "POSTPRODUCTION_MANAGE",
    displayName: "Post Production",
    description: "The post production board"
  },
  {
    module: "PROJECT",
    feature: "Client Gifts",
    level: "CLIENTGIFTS_MANAGE",
    displayName: "Client Gifts",
    description: "The Welcome Gift and Shoot Completed Gift a project owes its client, and moving each one along"
  },
  {
    module: "PROJECT",
    feature: "Feedback",
    level: "FEEDBACK_MANAGE",
    displayName: "Feedback",
    description: "Project Management feedback: reviews of each shoot, and Add Feedback"
  },
  /*
   * View All Feedback: the Feedback list without the narrowing. Without it a person sees only the
   * feedback they gave; with it, everybody's, as far as the branches of the roles granting it reach
   * (`feedback/service.js` `feedbackScope`). An action permission - it opens no screen of its own.
   */
  {
    module: "PROJECT",
    feature: "View All Feedback",
    level: "FEEDBACK_VIEW_ALL",
    displayName: "View All Feedback",
    description: "See everybody's feedback on the Feedback screen, not only your own"
  },
  // `PROJECT / All Projects` used to live here. It widened the project screens on its own, which
  // made two answers to one question - a person named on a single project was shown every project
  // in their branches, and nothing on screen said why. `ADMIN / Branch Administration` is now the
  // only permission that shows a person work their name is not on, for every module at once.
  // Retired by migration 20260906200000_retire_all_projects_permission.

  // ============================================
  // IMAGE SELECTION MODULE
  // ============================================
  // One permission for the whole module: shaping a project, uploading the shoot, and sending the
  // gallery to the client are steps of the same job done by the same people. Splitting them meant
  // two answers to one question, and a role that could arrange folders but not fill them.
  {
    module: "IMAGE_SELECTION",
    feature: "Project Management",
    level: "ISPROJECT_MANAGE",
    displayName: "Manage Image Selection",
    description: "Image Selection projects, their folders and settings, uploads, and publishing a gallery to the client"
  },
  // Album Proofing splits into two grants because it is two jobs done by different people: the
  // admin/designer runs the album (create, import, resolve corrections, publish to the client),
  // while the QC Lead only reviews and decides. A role holding QC alone can read everything it
  // needs and rule — nothing else.
  {
    module: "IMAGE_SELECTION",
    feature: "Album Proofing",
    level: "ISALBUM_PROOFING",
    displayName: "Album Proofing",
    description: "Create and run album proofs: folders, imports, corrections, revisions, client publication and final download"
  },
  {
    module: "IMAGE_SELECTION",
    feature: "Album Proofing QC",
    level: "ISALBUM_PROOFING_QC",
    displayName: "Album Proofing QC",
    description: "Review album proof versions as QC Lead: add corrections, request changes, approve for the client"
  },
  // The AI Feature: event galleries with face recognition, the third screen under Visual Curation
  // and a product of its own - nothing it does touches an Image Selection project or an album. Filed
  // under IMAGE_SELECTION because that is the Visual Curation section's module key, which the drift
  // test holds a screen's permission to; Role Management already titles the module "Visual
  // Curation". Three rows because three different people do three different jobs on it: running
  // events is not the same act as deciding whose face is whose, and neither is setting the
  // studio-wide defaults every new event is copied from. Migration 20260922100000 writes the same
  // three rows for production.
  {
    module: "IMAGE_SELECTION",
    feature: "AI Feature",
    level: "ISAI_FEATURE",
    displayName: "AI Feature",
    description: "AI event galleries: create and run events, their sub-events, media, guests and the guest link"
  },
  {
    module: "IMAGE_SELECTION",
    feature: "AI Face Management",
    level: "ISAI_FACE_MANAGE",
    displayName: "AI Face Management",
    description: "The People and face-match reviews inside an AI event: name, merge, split and hide people, link them to guests, confirm or reject matches, retry failed processing"
  },
  {
    module: "IMAGE_SELECTION",
    feature: "AI Event Default Settings",
    level: "ISAI_SETTINGS",
    displayName: "AI Event Default Settings",
    description: "The studio-wide defaults every new AI event is created from, behind AI Feature → More → Event Default Settings"
  },
  // The Signature Album tab inside an Image Selection project: a premium client album built from
  // the project's existing photos. One row rather than view/edit/publish/share apart: Read opens the
  // tab and the preview, Read / Write edits, publishes and shares - the same people do all of it,
  // and three permissions nobody grants separately are worse than one (IAM.md). Its studio-wide
  // defaults answer to SETTINGS / Organization, the permission of the panel they are edited in.
  // Migration 20260924100000 writes the same row for production.
  {
    module: "IMAGE_SELECTION",
    feature: "Signature Album",
    level: "ISSIGNATURE_ALBUM",
    displayName: "Signature Album",
    description: "The Signature Album tab of an Image Selection project: its cover, chapters and photos, its design, and publishing and sharing the client album"
  },
  // The AI Editing tab inside an Image Selection project, between AI Culling and Photo Selection:
  // the editing bay where photos are enhanced before they go on. One row, as the album: Read opens
  // the tab and sees the edits, Read / Write uploads into it, edits, renders and sends on. Sending
  // INTO Photo Selection or the album still answers to those destinations' own permissions.
  // Migration 20261011090000 writes the same row for production.
  {
    module: "IMAGE_SELECTION",
    feature: "AI Editing",
    level: "ISAI_EDITING",
    displayName: "AI Editing",
    description: "The AI Editing tab of an Image Selection project: upload photos into it, edit them with the AI tools, and send the edited versions on to Photo Selection or the Signature Album"
  },
  // The AI Culling entry under Visual Curation and its dashboard. Only the dashboard answers to it:
  // the AI Culling tab inside a project, and every culling endpoint it calls, stay on Project
  // Management, as they always were. Its own row because the sidebar gives every entry a
  // permission of its own. Migration 20261103120000 writes the same row for production, granted to
  // SUPER_ADMIN alone.
  {
    module: "IMAGE_SELECTION",
    feature: "AI Culling",
    level: "ISAI_CULLING",
    displayName: "AI Culling",
    description: "The AI Culling dashboard under Visual Curation: every project's culling runs, where they stand and what they kept. Running and reviewing a cull inside a project stays with Manage Image Selection"
  },
  {
    // Visual Curation → AI Feature → Photo Selling. Its own grant rather than a part of AI Feature:
    // taking the studio's money and delivering what was bought is a different job from running an
    // event. Also written by migration 20261023130000_photo_selling.
    module: "IMAGE_SELECTION",
    feature: "Photo Selling",
    level: "ISPHOTO_SELLING",
    displayName: "Photo Selling",
    description: "Sell the studio's own photo galleries to guests: galleries and their photos, prices and packages, orders and payments, and delivering the photos bought"
  },

  // ============================================
  // ACCOUNTS MODULE
  // ============================================
  {
    module: "ACCOUNTS",
    feature: "Cash Management",
    level: "CASH_MANAGE",
    displayName: "Manage Cash Entries",
    description: "Record and review cash entries"
  },
  // Money the studio pays out belongs with the people who keep its books, not with the people who
  // keep its employee records. Both of these described HRM until the Employee Repository was left
  // holding permissions about payments it has nothing to do with.
  /*
   * **Two permissions, because raising money and allowing it are two jobs.**
   *
   * `Payment Request` is the screen and your **own** requests: Read to see it, Read / Write
   * to raise one and to withdraw one you raised. Its name is older than the split and is kept so
   * every grant the studio has already made still means what it meant.
   *
   * `Payment Request Approver` is the decision: approve, reject, edit anybody's request, and see the
   * whole queue rather than your own rows. Whoever holds it cannot withdraw - withdrawing is the
   * requester taking their own ask back, and an approver who disagrees with a request rejects it,
   * which leaves a record of who decided and why. Deleting it instead would leave none.
   *
   * An approver needs **both**: this one to decide, and `Payment Request` at Read to open
   * the screen, since a route names one permission and the screen is that one's.
   *
   * Before this, one permission did both, so anybody who could approve could approve **their own**
   * request - raise money and allow it in two clicks - and nothing in the record said that was
   * unusual.
   */
  {
    module: "ACCOUNTS",
    feature: "Payment Request",
    level: "PAYMENT_APPROVE",
    displayName: "Payment Requests",
    description: "See the payment request screen and your own requests; Read / Write raises one and withdraws one you raised"
  },
  {
    module: "ACCOUNTS",
    feature: "Payment Request Approver",
    level: "PAYMENT_APPROVE",
    displayName: "Approve Payment Requests",
    description: "Decide anybody's payment request - approve, reject or correct it - and read the whole queue. Does not withdraw: an approver rejects, which leaves a record. Also needs ACCOUNTS / Payment Request Read to open the screen"
  },

  // ============================================
  // SUBSCRIBE MODULE
  // ============================================
  // Beam Craft's own clients: the companies onboarded for Media Studio Operations and Account Manager.
  {
    module: "SUBSCRIBE",
    feature: "Client Onboarding",
    level: "CLIENT_ONBOARD",
    displayName: "Onboard Subscription Clients",
    description: "Send client onboarding invites and read the companies onboarded for each product"
  },
  // `ACCOUNTS / Payroll Management` used to live here. It guarded the referral register while that
  // was a section of a settings panel; the register became a screen under HRM and took its
  // permission with it (`HRM / Employee Referral`), leaving this row grantable and granting
  // nothing. Retired by migration 20260909130000_permissions_match_the_sidebar.

  // ============================================
  // ADMIN MODULE
  // ============================================
  {
    module: "ADMIN",
    feature: "User Management",
    level: "USER_MANAGE",
    displayName: "Manage Users",
    description: "Create, read, update, delete users"
  },
  /*
   * Administering a branch, as distinct from working in one.
   *
   * Every other permission answers "may you open this screen". This one answers "whose rows", and
   * it is the only thing that widens a person past the work their own name is on: a holder sees
   * every record belonging to the branches their roles reach, assigned to them or not. Without it,
   * reaching a branch lets you file records against it and offers it in a picker - it is not a
   * claim on the work of the people in it.
   *
   * Granted to whoever runs a branch, alongside the modules they run it with. See
   * docs/project-state/DATA-SCOPE.md.
   */
  {
    module: "ADMIN",
    feature: "Branch Administration",
    level: "BRANCH_ADMINISTER",
    displayName: "Administer Branches",
    description: "See every record belonging to the branches this role reaches, not only the work this person is named on"
  },
  {
    module: "ADMIN",
    feature: "Role Management",
    level: "ROLE_MANAGE",
    displayName: "Manage Roles",
    description: "Create and manage roles"
  },
  /*
   * Administration → User Activity Logs: the audit trail `src/middleware/activityLog.js` writes.
   *
   * Read is the whole of it - there is nothing to write on the screen - and the list narrows to the
   * branches of the roles granting this permission (a Super Admin sees every line, including the
   * failed sign-ins that belong to no branch). Written into migration 20261020100000 as well, and
   * granted there to SUPER_ADMIN only.
   */
  {
    module: "ADMIN",
    feature: "User Activity Logs",
    level: "USER_ACTIVITY_LOGS",
    displayName: "User Activity Logs",
    description: "Read the audit trail of what signed-in people did in the application: who, which screen, which action, from where, and the answer"
  },
  /*
   * The tick boxes on every table in the application, and the two acts a selection leads to.
   *
   * One row rather than the twenty-odd `<Module> Select All` rows the same thing per table would
   * need. `SALES / CRM Lead Select All` and `HRM / Interview Select All` stay as they are: each
   * guards a set of bulk routes that predate this and do more than delete - a stage moved, a
   * vertical reassigned - so folding them in here would widen what one tick grants. This is the
   * general case underneath them, and it grants exactly two things: exporting the ticked rows, and
   * deleting them.
   *
   * `ADMIN` rather than a module of its own, because it is the shape every other `ADMIN` row has:
   * a question about the application rather than about one screen's records.
   *
   * It is a second permission on top of the screen's own, never a replacement for it. A holder
   * still only sees the tables their own permissions open, and a bulk delete asks for this **and**
   * the Read / Write that deleting one of those rows already needs - so this cannot become a way
   * around a screen somebody may only read. Read grants nothing: there is no reading a selection,
   * so it is a Read / Write row or no row at all.
   *
   * Written into a migration as well (20260923100000), as every row here must be. The seed writes
   * no grants, so it starts held by a Super Admin alone until the studio ticks it onto a role.
   */
  {
    module: "ADMIN",
    feature: "Table Select All",
    level: "TABLE_SELECT_ALL",
    displayName: "Select Table Rows in Bulk",
    description: "Read / Write to tick rows on any table in the application and act on the whole selection at once - exporting the ticked rows, and deleting them together. Without it the tick boxes are absent and records are worked one at a time"
  },

  // ============================================
  // SETTINGS MODULE
  // ============================================
  /*
   * One permission per entry on the Settings rail, replacing the single `ADMIN / System Settings`
   * that used to open most of it at once.
   *
   * That row was the whole overlay behind one tick: a studio wanting somebody to keep the message
   * templates had to hand them the branding, the branches, the login slide, the quotation brands and
   * the monitoring with it. These are different jobs done by different people, and a rail entry is
   * the unit a studio actually thinks in - so the catalogue matches the rail, one row per title, and
   * Role Management lists them under a **Settings** heading of their own rather than among
   * Administration's user and role screens.
   *
   * Its own module rather than more `ADMIN` features, because the Settings overlay is not
   * Administration: it is reached from the top bar by everybody, and the two Administration screens
   * are a different place with a different audience. Migration `20260915140000` carries every
   * existing `ADMIN / System Settings` grant onto all thirteen, so a role that could open Settings
   * yesterday opens exactly as much of it today, and narrowing one is a decision somebody takes
   * rather than one the upgrade takes for them.
   *
   * **User Preference is deliberately not here.** The sidebar order and the appearance are one
   * person's own, stored against their account and read by nothing else; a role that could be
   * refused the right to arrange its own screen is not a permission anybody wants to be able to
   * grant. It stays outside the gate, as `/api/user/preferences` stays behind `protect` alone.
   *
   * Six of these sit above data another module owns, and their endpoints are that module's - shared
   * with screens outside Settings, so they cannot be narrowed to a Settings row without taking those
   * screens with them (CLAUDE.md Rule 4). For those six the Settings row decides whether the rail
   * lists the section and the owning module's permission still decides whether it saves; both are
   * needed, and the descriptions say so.
   */
  {
    module: "SETTINGS",
    feature: "User Settings",
    level: "SETTINGS_USER",
    displayName: "User Settings",
    description: "Settings → User Settings: which logins are held to linking WhatsApp"
  },
  {
    module: "SETTINGS",
    feature: "Table Settings",
    level: "SETTINGS_TABLE",
    displayName: "Table Settings",
    description: "Settings → Overall → Table: the fields a module's table and forms carry. Also needs SALES / CRM Leads Read / Write, which is what the builder saves through"
  },
  {
    module: "SETTINGS",
    feature: "Field Settings",
    level: "SETTINGS_FIELD",
    displayName: "Field Settings",
    description: "Settings → Overall → Fields: the studio's own lists behind the dropdowns. Also needs HRM / Employee Management Read / Write, which is what the lists save through"
  },
  {
    module: "SETTINGS",
    feature: "Project Settings",
    level: "SETTINGS_PROJECT",
    displayName: "Project Settings",
    description: "Settings → Overall → Project: services, deliverables and the production workflow. Also needs PROJECT / Projects Read / Write"
  },
  {
    module: "SETTINGS",
    feature: "Exclude Phone Numbers",
    level: "SETTINGS_EXCLUDED_NUMBERS",
    displayName: "Exclude Phone Numbers",
    description: "Settings → Exclude Phone Numbers: the numbers that must never become a lead. Also needs SALES / CRM Leads Read / Write"
  },
  {
    module: "SETTINGS",
    feature: "Integrations",
    level: "SETTINGS_INTEGRATIONS",
    displayName: "Integrations",
    description: "Settings → Integrations: the linked Google Sheets, Drive and Meet accounts. The Sales section also needs SALES / CRM Leads Read / Write and the Interview section HRM / Interview Read / Write, which is what linking a sheet answers for"
  },
  {
    module: "SETTINGS",
    feature: "Quotation Settings",
    level: "SETTINGS_QUOTATION",
    displayName: "Quotation Settings",
    description: "Settings → Quotation Settings: the quotation brands, their covers and the figures on them"
  },
  {
    module: "SETTINGS",
    feature: "Employee Referral",
    level: "SETTINGS_REFERRAL",
    displayName: "Employee Referral",
    description: "Settings → Employee Referral: what a referral pays. Also needs HRM / Employee Referral, which owns the register it is paid from"
  },
  {
    module: "SETTINGS",
    feature: "Message Template",
    level: "SETTINGS_MESSAGE_TEMPLATE",
    displayName: "Message Template",
    description: "Settings → Message Template: the wording the studio sends out"
  },
  {
    module: "SETTINGS",
    feature: "Template Settings",
    level: "SETTINGS_TEMPLATE_SETTINGS",
    displayName: "Template Settings",
    description: "Settings → Template Settings: a section of its own, empty for now"
  },
  {
    module: "SETTINGS",
    feature: "Wishes",
    level: "SETTINGS_WISHES",
    displayName: "Wishes",
    description: "Settings → Wishes: the birthday and anniversary wishes the studio sends its people"
  },
  {
    module: "SETTINGS",
    feature: "Organization",
    level: "SETTINGS_ORGANIZATION",
    displayName: "Organization",
    description: "Settings → Organization: the studio's name, its branding logo and its branches. The logo is read by the top bar, the sign-in page, every quotation and the client gallery"
  },
  {
    module: "SETTINGS",
    feature: "Holidays",
    level: "SETTINGS_HOLIDAYS",
    displayName: "Holidays",
    description: "Settings → Holidays: the days the studio is closed, which every employee's calendar and attendance read"
  },
  {
    module: "SETTINGS",
    feature: "Login Slide",
    level: "SETTINGS_LOGIN_SLIDE",
    displayName: "Login Slide",
    description: "Settings → Login Slide: the pictures the sign-in page shows"
  },
  {
    module: "SETTINGS",
    feature: "Client Page Images",
    level: "SETTINGS_CLIENT_PAGE_IMAGES",
    displayName: "Client Page Images",
    description: "Settings → Project Management → Client page images: the pictures the client sign-in page shows"
  },
  {
    module: "SETTINGS",
    feature: "Payment Reminder",
    level: "SETTINGS_PAYMENT_REMINDER",
    displayName: "Payment Reminder",
    description: "Settings → Project Management → Payment reminder: who sends the WhatsApp reminder two days before a payment is due, and when"
  },
  {
    module: "SETTINGS",
    feature: "Shoot Crew Notice",
    level: "SETTINGS_SHOOT_CREW_NOTICE",
    displayName: "Shoot Crew Notice",
    description: "Settings → Project Management → Shoot crew notice: whether each shoot's crew is told about it on WhatsApp, and who sends it"
  },
  {
    module: "SETTINGS",
    feature: "Application Monitoring",
    level: "SETTINGS_MONITORING",
    displayName: "Application Monitoring",
    description: "Settings → Application Monitoring: whether usage is recorded, and the email health check"
  },
  {
    module: "SETTINGS",
    feature: "WhatsApp Activity Log",
    level: "SETTINGS_WHATSAPP_ACTIVITY",
    displayName: "WhatsApp Activity Log",
    description: "Settings → User Settings → WhatsApp Activity Log: every WhatsApp message the app sent or tried to send, and with Read / Write the Resend of a failed one"
  },
  {
    module: "SETTINGS",
    feature: "Automatic WhatsApp Message",
    level: "SETTINGS_AUTOMATIC_WHATSAPP",
    displayName: "Automatic WhatsApp Message",
    description: "Settings → User Settings → Automatic WhatsApp Message → Photo Selection Submitted: whether a client's submitted selection is announced in a WhatsApp group, which group and who sends it. Editing the wording also needs SETTINGS / Message Template Read / Write"
  },
  {
    module: "SETTINGS",
    feature: "Activity Log Purge",
    level: "SETTINGS_ACTIVITY_LOG_PURGE",
    displayName: "Activity Log Purge",
    description: "Settings → Activity Log Purge: delete User Activity Logs lines older than 1, 2, 3 or 6 months"
  }
];

// ============================================
// SEED PERMISSION SCOPES
// ============================================
//
// The named sub-actions a permission can be narrowed by, shown as checkboxes beneath it once a role
// grants that permission. A permission with no scopes is just its access-level choice, so a module
// gains scopes by being listed here and by nothing else.
//
// Each entry is [module, feature, [[name, displayName], ...]].

const SCOPES = [
  // Inspections and custody were two permissions of their own once, each with the scopes below.
  // They were merged into Asset Management - the register, its inspections and its handovers are
  // one screen doing one job - and these entries went on naming the permissions that no longer
  // existed, so `seedScopes` skipped all five sub-actions and nobody could tick any of them.
  ["ASSET", "Asset Management", [
    ["CREATE", "Create assets"],
    ["EDIT", "Edit assets"],
    ["DELETE", "Delete assets"],
    ["IMPORT", "Import assets"],
    ["CHANGE_STATUS", "Change asset status"],
    ["RECORD_INSPECTION", "Record inspections"],
    ["FLAG_MAINTENANCE", "Flag for maintenance"],
    ["ASSIGN", "Assign to a person"],
    ["RETURN", "Record a return"],
  ]],
  // Deciding somebody else's request is the one part that stayed a permission of its own, so its
  // sub-action belongs to that permission rather than to the register's.
  ["ASSET", "Asset Request Approval", [
    ["APPROVE_REQUESTS", "Approve asset requests"],
  ]],
  ["HRM", "Employee Management", [
    ["CREATE", "Add employees"],
    ["EDIT", "Edit employees"],
    ["ONBOARD", "Send onboarding invites"],
    ["ISSUE_CREDENTIALS", "Issue login credentials"],
  ]],
  // Approving and rejecting moved with the decision, to `Payment Request Approver`. `Payment Request`
  // is raising one and withdrawing your own, which are not actions anybody is granted separately.
  ["ACCOUNTS", "Payment Request Approver", [
    ["APPROVE", "Approve requests"],
    ["REJECT", "Reject requests"],
  ]],
  ["HRM", "Attendance Approval", [
    ["APPROVE", "Approve leave and permission"],
    ["REJECT", "Reject leave and permission"],
    ["MANAGE_RULES", "Set the shift, weekly offs and holidays"],
  ]],
  ["PROJECT", "Projects", [
    ["CREATE", "Create projects"],
    ["EDIT", "Edit projects"],
    ["ALLOCATE", "Allocate services"],
  ]],
  ["SALES", "CRM Leads", [
    ["CREATE", "Create leads"],
    ["IMPORT", "Import leads"],
    ["EXPORT", "Export leads"],
    ["ASSIGN", "Assign leads"],
  ]],
  ["SALES", "Quotation Management", [
    ["CREATE", "Create quotations"],
    ["SEND", "Send to a client"],
    ["APPROVE", "Approve quotations"],
  ]],
  // Named `Upload & Gallery` until that permission was folded into Project Management; the four
  // sub-actions have been unreachable ever since.
  ["IMAGE_SELECTION", "Project Management", [
    ["UPLOAD", "Upload images"],
    ["PUBLISH", "Publish a gallery"],
    ["SHARE", "Share a gallery link"],
    ["DELETE", "Delete images"],
  ]],
  ["ADMIN", "User Management", [
    ["CREATE", "Create users"],
    ["DELETE", "Delete users"],
    ["MANAGE_GROUPS", "Manage user groups"],
  ]],
  ["ADMIN", "Role Management", [
    ["CREATE", "Create roles"],
    ["EDIT", "Edit roles"],
    ["DELETE", "Delete roles"],
  ]],
];

module.exports = { PERMISSIONS, SCOPES };
