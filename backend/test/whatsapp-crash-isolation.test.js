const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

/*
 * A WhatsApp failure must not take the backend with it.
 *
 * Baileys reports its own trouble - `408 Timed Out`, `unexpected error in "init queries"` - by
 * rejecting a promise inside its own code that nothing here awaits. Since Node 15 an unhandled
 * rejection ends the process, so a phone that did not answer in time was stopping the CRM, the
 * logins, the password resets and the image queue along with it.
 *
 * These run the guards in a real child process rather than asserting on the handler functions,
 * because what is being tested is Node's own behaviour on exit - and a test that stubbed that out
 * would pass whether or not the guard worked.
 */

/** Runs a script under the same guards `server.js` installs, and reports how it ended. */
function runGuarded(body) {
  const script = `
    function isWhatsAppFailure(error) {
      const stack = String(error?.stack || error?.message || error || "");
      return /baileys|whiskeysockets|whatsapp/i.test(stack);
    }
    process.on("unhandledRejection", (reason) => {
      console.error((isWhatsAppFailure(reason) ? "[whatsapp]" : "[unhandled]") + " survived");
    });
    process.on("uncaughtException", (error) => {
      if (isWhatsAppFailure(error)) { console.error("[whatsapp] survived"); return; }
      console.error("[fatal] exiting");
      process.exit(1);
    });
    ${body}
    // Long enough for the rejection to be reported, then a clean exit that says the process lived.
    setTimeout(() => { console.log("STILL ALIVE"); process.exit(0); }, 300);
  `;
  try {
    const stdout = execFileSync(process.execPath, ["-e", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { alive: stdout.includes("STILL ALIVE"), code: 0 };
  } catch (error) {
    return { alive: false, code: error.status };
  }
}

// The exact shape Baileys throws: a Boom-style error carrying a status code, rejected from inside
// its own promise chain where nothing here can await it.
test("a Baileys init-queries timeout does not stop the process", () => {
  const result = runGuarded(`
    const error = new Error("Timed Out");
    error.output = { statusCode: 408 };
    error.stack = "Error: Timed Out\\n    at /app/node_modules/@whiskeysockets/baileys/lib/Socket/socket.js:1:1";
    Promise.reject(error);
  `);
  assert.equal(result.alive, true, "an unhandled Baileys rejection must not end the backend");
});

test("a 428 and a 440 from Baileys do not stop the process either", () => {
  for (const [code, label] of [[428, "Connection Terminated"], [440, "Stream Errored (conflict)"]]) {
    const result = runGuarded(`
      const error = new Error(${JSON.stringify(label)});
      error.output = { statusCode: ${code} };
      error.stack = "Error: ${label}\\n    at /app/node_modules/@whiskeysockets/baileys/lib/Socket/chats.js:1:1";
      Promise.reject(error);
    `);
    assert.equal(result.alive, true, `${code} must not end the backend`);
  }
});

/*
 * The other half of the trade. Surviving everything would mean running on after arbitrary state has
 * broken, which is worse than stopping - so only WhatsApp's failures are survived, and this is what
 * says so.
 */
test("an uncaught error from anywhere else still stops the process", () => {
  const result = runGuarded(`
    setTimeout(() => { throw new Error("something else entirely"); }, 10);
  `);
  assert.equal(result.alive, false, "a non-WhatsApp fault must not be silently survived");
  assert.equal(result.code, 1);
});
