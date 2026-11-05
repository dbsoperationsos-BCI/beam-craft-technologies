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
  "TRF-", // referral-scope
  "TBO-", // branch-options
  "TCC-", // crd-document-code
  "TCD-", // client-storage-follows-deleted-project
  "TCS-", // data-scope-client-storage
  "TDA-", // data-scope-accounts-tasks
  "TDC-", // data-scope-crm
  "TDE-", // data-scope-employees
  "TDP-", // data-scope-projects
  "TDS-", // data-scope
  "TEP-", // enquiry-picker
  "TES-", // hrm-employee-branch-scope
  "TLC-", // data-scope-lead-children
  "TOT-", // password-reset-otp
  "TPC-", // data-scope-project-children
  "TQE-", // data-scope-quotations
  "SAP-", // project-show-all-rows
  "LFU-", // interview-last-follow-up-stamp
  "TSB-", // onboarding-send-back-mail-failure
  "WCS-", // whatsapp-chat-stream
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
  ["projectShoot", "shootId"],
  ["projectExtraQuotation", "requestCode"],
  ["salesQuotation", "quotationNumber"],
  ["salesCrmMeeting", "enquiryId"],
  ["salesCrmLead", "enquiryId"],
  ["salesProject", "eventId"],
  ["clientStorage", "storageId"],
  ["cashEntry", "entryId"],
  ["hrmTask", "taskCode"],
  ["hrmInterviewCandidate", "candidateCode"],
  ["asset", "assetCode"],
  // Before the employee it names. The link is `employee_id` held as *text* rather than a foreign
  // key, so nothing at the database level would take an invite with its employee - it would simply
  // be left pointing at a row that no longer exists, and turn up on the Employee Repository as an
  // invite for somebody who is not there.
  ["employeeOnboardingInvite", "candidateName"],
  ["employee", "employeeId"],
  ["user", "email"],
  ["role", "name"],
  ["permissionScope", "name"],
  ["branch", "code"],
];

async function clearTestFixtures() {
  const removed = [];

  for (const [model, field] of TARGETS) {
    const repository = prisma[model];
    // A model that has been renamed or dropped is skipped rather than throwing: this is a sweep,
    // and one stale entry must not stop the other fourteen from running.
    if (!repository?.deleteMany) continue;
    try {
      const { count } = await repository.deleteMany({
        where: { OR: PREFIXES.map((prefix) => ({ [field]: { startsWith: prefix } })) },
      });
      if (count) removed.push(`${model}: ${count}`);
    } catch (error) {
      console.warn(`[test-fixtures] Could not sweep ${model}.${field}: ${error.message}`);
    }
  }

  return removed;
}

module.exports = { clearTestFixtures, PREFIXES, TARGETS };

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
