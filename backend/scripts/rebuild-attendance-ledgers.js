/*
 * Writes the attendance ledgers - `casual_leave_ledger`, `permission_ledger`, `comp_off_ledger` - for
 * every employee attendance is kept for, from the rules as they stand. Run once after the
 * `20261010300000_attendance_ledgers` migration so the tables hold everybody's record from the start;
 * after that the app keeps them in step by itself.
 *
 * Safe to run on production and to run again: it writes those three tables only, each employee's rows
 * replaced with what the rules come to now - no request, attendance, payroll or setting is touched.
 *
 *   npm run ledgers:rebuild   (node -r dotenv/config scripts/rebuild-attendance-ledgers.js)
 */
const prisma = require("../src/config/db");
const { rebuildAll } = require("../src/modules/hrm/attendance/ledgers");

rebuildAll()
  .then(({ employees, failed }) => {
    console.log(`Attendance ledgers written for ${employees - failed} of ${employees} employees.${failed ? ` ${failed} failed - see above.` : ""}`);
    process.exitCode = failed ? 1 : 0;
  })
  .catch((error) => {
    console.error("Attendance ledgers could not be written:", error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
