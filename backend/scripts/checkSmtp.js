require("dotenv").config();
const { loadSenders, createPool } = require("../src/services/smtpPool");

/**
 * Answers "can this server send mail?" without printing anything that could send it.
 *
 * `npm run check:smtp`
 *
 * Run after adding or changing a sending account, and again on the VPS. It reports every account in
 * the pool and whether Gmail accepts it - never a password, never the reset tokens the mail itself
 * carries. Addresses, hosts and ports are shown because they are what somebody has to check, and
 * none of them is a secret: the address is on every message this server sends.
 *
 * It connects and authenticates only. Nothing is sent, so running it cannot surprise anybody.
 */

/*
 * What Gmail wants, checked before connecting so a wrong port is named rather than timed out on.
 *
 * 587 is STARTTLS and needs `secure` false; 465 is implicit TLS and needs it true. Getting the pair
 * the wrong way round is the usual reason a Gmail connection hangs instead of failing.
 */
function portAdvice(sender) {
  if (sender.port === 587 && sender.secure) return "port 587 needs SMTP_SECURE=false (it upgrades with STARTTLS)";
  if (sender.port === 465 && !sender.secure) return "port 465 needs SMTP_SECURE=true (it is TLS from the start)";
  return null;
}

async function main() {
  const senders = loadSenders();

  if (!senders.length) {
    console.log("No sending accounts are configured.");
    console.log("Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD in backend/.env, then run this again.");
    console.log("Add more accounts as SMTP_2_USER / SMTP_2_PASSWORD, SMTP_3_USER / SMTP_3_PASSWORD, and so on.");
    process.exitCode = 1;
    return;
  }

  console.log(`${senders.length} sending account${senders.length === 1 ? "" : "s"} configured:`);
  for (const sender of senders) {
    const advice = portAdvice(sender);
    console.log(`  ${String(sender.id).padStart(2)}. ${sender.user}`);
    console.log(`      host ${sender.host}:${sender.port} secure=${sender.secure} from ${sender.from}`);
    if (advice) console.log(`      note: ${advice}`);
  }

  const pool = createPool({ senders });
  console.log("\nChecking each account with Gmail...");
  const results = await pool.verifyAll();

  let working = 0;
  for (const result of results) {
    if (result.ok) {
      working += 1;
      console.log(`  OK      ${result.user}`);
    } else {
      // The message only: a thrown SMTP error can carry the credentials it tried.
      console.log(`  REFUSED ${result.user}: ${result.reason}`);
      if (/535|5\.7\.8|badcredentials|not accepted/i.test(result.reason)) {
        console.log("          Gmail rejects normal account passwords. Use a 16-character App Password from");
        console.log("          Google Account > Security > 2-Step Verification > App passwords.");
      }
    }
  }

  console.log(`\n${working} of ${results.length} account${results.length === 1 ? "" : "s"} can send.`);
  if (!working) {
    console.log("No mail will go out until at least one is accepted.");
    process.exitCode = 1;
  } else if (working < results.length) {
    // Not a failure: the pool passes over a refused account and sends through one that works.
    console.log("Mail will still go out - the pool passes over an account Gmail refuses.");
  }
}

main();
