/**
 * Removes the rows a previous test run left behind.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────
 *
 * Nine suites write real rows into a real database - branches, employees, roles, leads, projects -
 * because what they check is a SQL rule and there is no honest way to check one without a database.
 * Each cleans up after itself in an `after()` hook, which works exactly as long as the run finishes.
 * It does not when a test fails hard, when the process is killed, or when a suite is interrupted -
 * and then the fixtures stay, in the developer's own database, forever.
 *
 * That is not a tidiness problem. The rows are indistinguishable from real ones on screen: the
 * studio's Branches list came to show 29 branches, of which 23 were called things like "Accounts
 * Scope Branch 004915"; the Employee Repository listed "Lead Child mgr 161445" beside real staff,
 * and so did the Reports employee filter. And one of the leftovers made `data-scope-backfill`
 * fail on **every** subsequent run, which reads as a broken test rather than as a dirty database.
 *
 * So the cleanup cannot live only at the end of a run that may not reach its end. This runs at the
 * *start* of every run instead - `npm test` calls it through `pretest` - where the previous run's
 * failure has already happened and its debris is certainly dead.
 *
 * ── What it will delete ───────────────────────────────────────────────────────────────────────
 *
 * Only rows whose own identifying column begins with one of the prefixes below. Those prefixes are
 * reserved for test fixtures - see "Test data" in the README - and nothing the studio enters uses
 * them: a branch is `ERODE_TN`, an employee `DBS-1`, an enquiry `DBS-EID-DD-ERD-000260`.
 *
 * It never deletes by date, by "looks like a test", or by anything else. A row without a reserved
 * prefix is not this script's business however much it resembles one.
 *
 * Never fails the run. A database that cannot be reached is the normal state of a machine running
 * the suites that need none, and refusing to run any test because the sweep could not connect would
 * be a worse trade than leaving a few rows behind.
 */

const prisma = require("../src/config/db");

/**
 * The prefixes reserved for test fixtures.
 *
 * `test/test-fixture-prefixes.test.js` reads this list and the suites, and fails if a suite mints a
 * prefix this does not know about - otherwise a new suite starts leaking silently and nobody finds
 * out until its rows turn up on somebody's screen.
 */
const PREFIXES = [
  "BRP-", // branch-reach-per-permission
  "TBA-", // branch-admin-permissions
  "TBV-", // crm-bulk-vertical-move
  "TRF-", // referral-scope
  "TBO-", // branch-options
  "TCC-", // crd-document-code
  "TCL-", // client-login
  "TTR-", // attendance-typed-time-repair
  "TXA-", // attendance-exclude
  "TCP-", // client-portal
  "TCPP-", // client-portal-payments
  "TCPR-", // client-portal-reviews
  "TCPW-", // client-change-password
  "TCLO-", // client-login-otp
  "TCPE-", // client-portal-events
  "TCPU-", // client-push
  "TCSR-", // crm-board-column-search
  "TCOS-", // crm-board-occurring-statuses
  "TOD-", // offboarding-invite-delete
  "TCW-", // crm-board-column-worth
  "TCD-", // client-storage-follows-deleted-project
  "TCS-", // data-scope-client-storage
  "TDA-", // data-scope-accounts-tasks
  "TDC-", // data-scope-crm
  "TDE-", // data-scope-employees
  "TDP-", // data-scope-projects
  "TDS-", // data-scope
  "TEP-", // enquiry-picker
  "TCO-", // client-offers
  "TCPK-", // client-portal-package
  "TCIV-", // client-invitations
  "TCRQ-", // client-requests
  "TRW-", // client-rewards
  "TFB-", // project-feedback
  "TES-", // hrm-employee-branch-scope
  "TLC-", // data-scope-lead-children
  "TLK-", // lead-children-keys
  "TNC-", // name-copies-follow-rename
  "TMR-", // employee-master-data-references
  "TRN-", // resolved-names
  "TOT-", // password-reset-otp
  "TPC-", // data-scope-project-children
  "TQE-", // data-scope-quotations
  "TQD-", // sales-quotation-draft
  "TQF-", // sales-quotation-finalize
  "TQP-", // sales-project-finalized-quotation
  "TQL-", // sales-quotation-lifecycle
  "SAP-", // project-show-all-rows
  "LFU-", // interview-last-follow-up-stamp
  "TSB-", // onboarding-send-back-mail-failure
  "WCS-", // whatsapp-chat-stream
  "TSU-", // speak-up
  "TAL-", // user-activity-log
  "TLP-", // activity-log-purge
  "TSL-", // staff-login-closed
  "TRJ-", // employee-rejoin-password
  "TWP-", // whatsapp-pairing-reach
  "TSA-", // hrm-task-super-admin-role
  "TRH-", // attendance-request-hard-delete
  "TPF-", // project-flow
  "TRB-", // project-recycling-bin
  "TBH-", // project-recycling-bin-hidden
  "TSR-", // sale-extras-reconcile
  "TSK-", // sale-extras-booking
  "TSX-", // sale-extras-api
  "TSM-", // sale-extras-money
  "TEST_", // iam.test.js branches, roles and permission scopes
  "ZZTEST-", // enquiry-picker
  "ZZREP-", // report-employee-options
  "ZZORG-", // hrm-org-chart-statuses
];

/**
 * Where a fixture is identified, in the order it is safe to delete.
 *
 * Children first: a project's shoots before the project, a lead's meetings before the lead. The
 * join rows - `user_role`, `role_permission`, `role_branch` - are not listed because every one of
 * them is `onDelete: Cascade` from the row above it, so deleting the role, user or branch takes
 * them with it.
 */
const TARGETS = [
  // Before its sales project; deleting it cascades to its gallery publication, items and albums.
  ["imageSelectionProject", "projectName"],
  ["projectShoot", "shootId"],
  ["projectExtraQuotation", "requestCode"],
  // A Sale Extras revision restricts deleting its quotation, so it goes first - found by its
  // publisher's name, which the suites stamp with their prefix.
  ["projectSaleExtraRevision", "publishedByName"],
  ["salesQuotation", "quotationNumber"],
  ["salesCallTranscript", "callLogId"],
  ["salesWhatsappGroupName", "generatedName"],
  ["salesCrmMeeting", "enquiryId"],
  // A lead with a booking or a quotation behind it cannot be deleted (20260924150000), so the lead
  // is swept after both of them.
  ["salesProject", "eventId"],
  // A document raised by hand against a lead refuses that lead's deletion, so it goes first too.
  ["salesProjectCrdDocument", "enquiryId"],
  ["salesCrmLead", "enquiryId"],
  ["clientStorage", "storageId"],
  ["cashEntry", "entryId"],
  // Its expense lines go with it (`onDelete: Cascade`).
  ["paymentRequest", "requestCode"],
  ["clientOffer", "title"],
  // After the projects, whose invitations (`onDelete: Cascade`) hold a design by a restricting key.
  ["invitationTemplate", "title"],
  ["invitationSong", "title"],
  ["hrmTask", "taskCode"],
  ["hrmInterviewCandidate", "candidateCode"],
  // Before the employee it names; its link is `onDelete: SetNull`, so this is order, not necessity.
  ["speakUp", "title"],
  // Leave and other requests the suites raise carry their prefix in the reason. They would go with
  // their employee (`onDelete: Cascade`), but a request raised against a real employee would not.
  ["attendanceRequest", "reason"],
  ["asset", "assetCode"],
  // Before the employee it names. The link is `employee_id` held as *text* rather than a foreign
  // key, so nothing at the database level would take an invite with its employee - it would simply
  // be left pointing at a row that no longer exists, and turn up on the Employee Repository as an
  // invite for somebody who is not there.
  ["employeeOnboardingInvite", "candidateName"],
  ["employee", "employeeId"],
  // Before the login it names; its link is `onDelete: SetNull`, so this is order, not necessity.
  ["userActivityLog", "username"],
  ["user", "email"],
  ["role", "name"],
  ["permissionScope", "name"],
  ["branch", "code"],
  ["vertical", "code"],
  ["designation", "code"],
  ["department", "code"],
  ["skill", "code"],
  ["language", "code"],
  ["workLocation", "code"],
];

/**
 * A prefix as a literal for `startsWith`.
 *
 * Prisma hands `startsWith` to MySQL as `LIKE 'prefix%'` without escaping the prefix, and in a LIKE
 * pattern `_` is any one character and `%` any run of them. So `TEST_` - iam.test.js's prefix -
 * swept every row beginning `TEST` and one more character: a hand-made `TEST-EV-001` project, its
 * shoots and its lead were deleted by the next `npm test`. Escaped, it matches `TEST_` and nothing
 * else.
 */
const literalPrefix = (prefix) => prefix.replace(/[\\%_]/g, (character) => `\\${character}`);

async function clearTestFixtures() {
  const removed = [];

  for (const [model, field] of TARGETS) {
    const repository = prisma[model];
    // A model that has been renamed or dropped is skipped rather than throwing: this is a sweep,
    // and one stale entry must not stop the other fourteen from running.
    if (!repository?.deleteMany) continue;
    try {
      const { count } = await repository.deleteMany({
        where: { OR: PREFIXES.map((prefix) => ({ [field]: { startsWith: literalPrefix(prefix) } })) },
      });
      if (count) removed.push(`${model}: ${count}`);
    } catch (error) {
      console.warn(`[test-fixtures] Could not sweep ${model}.${field}: ${error.message}`);
    }
  }

  return removed;
}

module.exports = { clearTestFixtures, literalPrefix, PREFIXES, TARGETS };

if (require.main === module) {
  clearTestFixtures()
    .then((removed) => {
      if (removed.length) console.log(`[test-fixtures] Cleared leftovers from a previous run - ${removed.join(", ")}.`);
    })
    .catch((error) => {
      // Warned, never fatal: see the note at the top.
      console.warn(`[test-fixtures] Skipped the sweep: ${error.message}`);
    })
    .finally(() => prisma.$disconnect().catch(() => {}));
}
