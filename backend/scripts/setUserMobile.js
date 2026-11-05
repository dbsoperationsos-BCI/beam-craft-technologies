/**
 * Sets the mobile number a password-reset code is sent to, for a login with no employee record.
 *
 *   npm run set:user-mobile -- admin "+91 9876543210"
 *   npm run set:user-mobile -- admin --clear
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────
 *
 * Recovery is by OTP alone, and the number normally comes from the employee's own `contact_number`
 * - the one they gave during onboarding, maintained in the Employee Repository. That covers everyone
 * who works here and not the accounts that are not people: the studio's Super Admin has no employee
 * record, so without a number of its own it could never reset its own password again.
 *
 * A script rather than a screen because no screen creates or edits a login - they are made from the
 * Employee Repository, which sets the employee link and takes the number from there. This is for the
 * one account that has neither, and it is the same shape as `audit:branches` and the other one-off
 * tools beside it: read what is there, say what it will do, do it, say what it did.
 *
 * The number is held to the application's own phone rule, so one saved here is one the SMS gateway
 * will actually take - a number in a shape no gateway accepts is a login that looks recoverable and
 * is not, and nothing would say so until somebody needed it.
 */

const prisma = require("../src/config/db");
const { normalizePhoneNumber } = require("../src/services/phoneNumber");

function usage(message) {
  if (message) console.error(`\n${message}`);
  console.error(`
Usage:
  npm run set:user-mobile -- <username or email> "<mobile>"
  npm run set:user-mobile -- <username or email> --clear

The mobile must carry its country code, as "+91 9876543210". A login whose employee record already
holds a number does not need one here: the employee's number wins.
`);
  process.exit(1);
}

async function main() {
  const [handle, value] = process.argv.slice(2);
  if (!handle || !value) usage("Give the account and the number.");

  const user = await prisma.user.findFirst({
    where: { OR: [{ username: handle }, { email: handle }] },
    select: { id: true, name: true, email: true, username: true, mobile: true, linkedEmployeeId: true },
  });
  if (!user) usage(`No login found for "${handle}".`);

  // Said before anything is written: an account that already takes its number from an employee
  // record does not need one here, and setting one would look like it had changed something.
  if (user.linkedEmployeeId) {
    const employee = await prisma.employee.findUnique({
      where: { id: user.linkedEmployeeId },
      select: { employeeName: true, contactNumber: true },
    });
    if (employee?.contactNumber) {
      console.log(`\n${user.username || user.email} already receives codes on ${employee.contactNumber}, from the employee record for ${employee.employeeName}.`);
      console.log("Change it in the Employee Repository instead - the employee's number wins over this one.\n");
      process.exit(0);
    }
  }

  const clearing = value === "--clear";
  const mobile = clearing ? null : normalizePhoneNumber(value);
  if (!clearing && !mobile) usage(`"${value}" is not a mobile number this application will accept. Include the country code, as "+91 9876543210".`);

  // One number, one account: two logins sharing it match nobody, so setting a duplicate would
  // quietly make *both* unrecoverable rather than making this one work.
  if (mobile) {
    const key = mobile.replace(/\D/g, "").slice(-10);
    const clash = await prisma.$queryRawUnsafe(
      "SELECT `id`, `email` FROM `user`"
      + " WHERE `id` <> ? AND RIGHT(REGEXP_REPLACE(COALESCE(`mobile`, ''), '[^0-9]', ''), 10) = ? LIMIT 1",
      user.id, key,
    );
    if (clash.length) usage(`${clash[0].email} already uses that number. One number reaches one account, or a code could reset either.`);

    const employeeClash = await prisma.$queryRawUnsafe(
      "SELECT `employee_name` AS `name` FROM `employee`"
      + " WHERE RIGHT(REGEXP_REPLACE(COALESCE(`contact_number`, ''), '[^0-9]', ''), 10) = ? LIMIT 1",
      key,
    );
    if (employeeClash.length) usage(`${employeeClash[0].name}'s employee record already uses that number. One number reaches one account.`);
  }

  await prisma.user.update({ where: { id: user.id }, data: { mobile } });
  console.log(`\n${user.username || user.email}: reset codes will ${mobile ? `go to ${mobile}` : "no longer be sent - this login can no longer reset its own password"}.\n`);
}

main()
  .catch((error) => { console.error(`\nCould not set the number: ${error.message}\n`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect().catch(() => {}));
