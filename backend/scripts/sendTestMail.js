require("dotenv").config();
const { loadSenders, createPool } = require("../src/services/smtpPool");

/**
 * Sends one real test message through every configured sending account.
 *
 * `npm run send:test-mail -- you@example.com`
 *
 * `check:smtp` proves an account can sign in; this proves it can actually deliver, which is not the
 * same thing - Gmail will accept a login and then refuse to send for an address it does not consider
 * the account's own. Run it once after adding accounts, to a mailbox you can read.
 *
 * One message per account rather than one through the pool, because the point is to see each account
 * work: the pool would send through the first that accepts and never touch the rest.
 *
 * Nothing here prints a password, and nothing is written to the database - this sends mail and
 * reports what happened, and that is all.
 */

async function main() {
  const to = (process.argv[2] || "").trim();
  if (!to) {
    console.log("Usage: npm run send:test-mail -- you@example.com");
    console.log("Sends one test message through each configured sending account.");
    process.exitCode = 1;
    return;
  }

  const senders = loadSenders();
  if (!senders.length) {
    console.log("No sending accounts are configured. Set SMTP_USER and SMTP_PASSWORD in backend/.env.");
    process.exitCode = 1;
    return;
  }

  console.log(`Sending one test message to ${to} through each of ${senders.length} account${senders.length === 1 ? "" : "s"}.\n`);

  let delivered = 0;
  for (const sender of senders) {
    // A pool of exactly one, so this account is the only one that can carry the message - a failover
    // to a working account would hide the very thing being tested.
    const single = createPool({ senders: [sender] });
    try {
      await single.sendMail({
        to,
        subject: `DBS Operations OS test — sender ${sender.id} (${sender.user})`,
        text: `This is a test from DBS Operations OS, sent through ${sender.user}.\n\nIf you can read this, that account can deliver mail and is ready for password resets.`,
        html: `<p>This is a test from <strong>DBS Operations OS</strong>, sent through ${sender.user}.</p><p>If you can read this, that account can deliver mail and is ready for password resets.</p>`,
      });
      delivered += 1;
      console.log(`  SENT     sender ${sender.id}  ${sender.user}`);
    } catch (error) {
      // The message only: a thrown SMTP error can carry the credentials it tried.
      console.log(`  FAILED   sender ${sender.id}  ${sender.user}: ${error.message}`);
    }
  }

  console.log(`\n${delivered} of ${senders.length} account${senders.length === 1 ? "" : "s"} delivered.`);
  console.log(`Check ${to} - you should have one message per account that sent, each naming which one it came from.`);
  if (!delivered) process.exitCode = 1;
}

main();
