const test = require("node:test");
const assert = require("node:assert/strict");
const { sendSms, describeSms, gatewayNumber, config, PROVIDERS } = require("../src/services/smsSender");

/*
 * The SMS gateway, and what it does when there is not one.
 *
 * The application had no SMS channel at all when the reset OTP was asked for: SMTP, and a QR-paired
 * personal WhatsApp account whose number gets banned for exactly this kind of automated sending. So
 * a gateway is configuration rather than code, and the studio's choice of provider is not this
 * file's to make - `msg91` is implemented because it is the usual one for Indian numbers, and `http`
 * covers any gateway taking a key, a number and a message.
 *
 * Which means the case that matters most here is **not configured**: a studio that has not bought an
 * account yet must get an honest `{ sent: false, reason }` rather than a crash, exactly as
 * `smtpPool` answers for a server with no SMTP.
 *
 * Reads no network: every case here is decided before a request would be made.
 */

/**
 * Runs `body` with `process.env` replaced, and puts it back either way.
 *
 * An async `body` is waited for before the environment goes back. A plain `try/finally` around
 * `body()` does **not** do that: the body runs only as far as its first `await`, the `finally`
 * fires on the way out, and every assertion after that first `await` is made against the real
 * environment rather than the one the test set up - which is a test that quietly checks nothing.
 * A synchronous body still finishes synchronously here, so the callers that do not await are right.
 */
function withEnv(values, body) {
  const original = {};
  for (const [key, value] of Object.entries(values)) {
    original[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  let result;
  try {
    result = body();
  } catch (error) {
    restore();
    throw error;
  }
  if (result && typeof result.then === "function") {
    return result.then(
      (value) => { restore(); return value; },
      (error) => { restore(); throw error; },
    );
  }
  restore();
  return result;
}

/*
 * `NODE_ENV` is pinned here rather than inherited: unconfigured behaves one way on a developer's
 * machine and another everywhere else, so a test about "no gateway" that leaves it to the shell is
 * a test that passes or fails depending on who runs it.
 */
const UNSET = { NODE_ENV: "test", SMS_PROVIDER: undefined, SMS_API_KEY: undefined, SMS_BASE_URL: undefined, SMS_SENDER_ID: undefined, SMS_TEMPLATE_ID: undefined, SMS_DEV_ECHO: undefined };

/** Runs `body` with `console.warn` collected rather than printed, and returns what it wrote. */
async function captureWarnings(body) {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(" "));
  try {
    await body();
  } finally {
    console.warn = original;
  }
  return lines.join("\n");
}

test("a studio with no gateway is told so, not crashed", async () => {
  await withEnv(UNSET, async () => {
    const printed = await captureWarnings(async () => {
      const result = await sendSms({ to: "+91 9876543210", message: "x", code: "123456" });
      assert.deepEqual(result, { sent: false, reason: "SMS is not configured." });
    });
    assert.equal(printed, "", "an unconfigured server that is not a dev machine printed something");
    assert.deepEqual(describeSms(), { configured: false, provider: null, devEcho: false });
  });
});

test("a deployed server never echoes the code, whatever NODE_ENV says", async () => {
  /*
   * The echo is the one place in the application allowed to print a live OTP, so what it refuses is
   * more important than what it does. `production` is the obvious case; **unset** is the one that
   * matters, because a VPS that forgot the variable has to land on the safe side of this rather
   * than the convenient one.
   */
  // Surrounding whitespace is trimmed, so `"development "` is deliberately not in this list - it is
  // a typo on a dev machine rather than a deployed server, and it means what it says.
  for (const nodeEnv of ["production", "staging", undefined, "", "Development", "dev"]) {
    await withEnv({ ...UNSET, NODE_ENV: nodeEnv }, async () => {
      const printed = await captureWarnings(async () => {
        const result = await sendSms({ to: "+91 9876543210", message: "x", code: "424242" });
        assert.equal(result.sent, false, `NODE_ENV=${JSON.stringify(nodeEnv)} reported a send`);
      });
      assert.ok(!printed.includes("424242"), `NODE_ENV=${JSON.stringify(nodeEnv)} printed a live code`);
    });
  }
});

test("a developer with no gateway gets the code on the console instead of nowhere", async () => {
  /*
   * Nobody buys an SMS account to run the app locally, so without this the code is minted, stored
   * and dropped: the form counts down two minutes against something that was never sent, and no
   * screen past the code box can be reached at all.
   */
  await withEnv({ ...UNSET, NODE_ENV: "development" }, async () => {
    const printed = await captureWarnings(async () => {
      const result = await sendSms({ to: "+91 9876543210", message: "x", code: "424242" });
      assert.deepEqual(result, { sent: true, channel: "console" });
    });
    assert.ok(printed.includes("424242"), "the dev echo did not print the code it exists to print");
    assert.ok(printed.includes("SMS IS NOT CONFIGURED"), "the dev echo did not say nothing was sent");
    assert.equal(describeSms().devEcho, true);
  });
});

test("a developer who would rather it never happened can turn the echo off", async () => {
  await withEnv({ ...UNSET, NODE_ENV: "development", SMS_DEV_ECHO: "false" }, async () => {
    const printed = await captureWarnings(async () => {
      const result = await sendSms({ to: "+91 9876543210", message: "x", code: "424242" });
      assert.deepEqual(result, { sent: false, reason: "SMS is not configured." });
    });
    assert.equal(printed, "");
    assert.equal(describeSms().devEcho, false);
  });
});

test("a configured gateway is never replaced by the echo, even in development", async () => {
  // The echo is what happens when there is *nothing*. A dev machine pointed at a real gateway must
  // still use it, or a gateway can never be tested where it is being set up.
  await withEnv({ ...UNSET, NODE_ENV: "development", SMS_PROVIDER: "carrier-pigeon", SMS_API_KEY: "k" }, async () => {
    const printed = await captureWarnings(async () => {
      const result = await sendSms({ to: "+91 9876543210", message: "x", code: "424242" });
      assert.equal(result.sent, false);
      assert.match(result.reason, /carrier-pigeon/);
    });
    assert.equal(printed, "");
  });
});

test("a provider named with no key is the same as none", async () => {
  // Half-configured is the state that would otherwise fail on every send with a reason that is not
  // the reason - the same trap `loadSenders` avoids by skipping an SMTP account with no password.
  await withEnv({ ...UNSET, SMS_PROVIDER: "msg91" }, async () => {
    assert.equal(config(), null);
    assert.equal((await sendSms({ to: "+91 9876543210", message: "x" })).sent, false);
  });
});

test("a provider nobody implemented is named, rather than failing silently", async () => {
  await withEnv({ ...UNSET, SMS_PROVIDER: "carrier-pigeon", SMS_API_KEY: "k" }, async () => {
    const result = await sendSms({ to: "+91 9876543210", message: "x" });
    assert.equal(result.sent, false);
    assert.match(result.reason, /carrier-pigeon/);
    // And it says what would work, so the fix does not need this file open.
    for (const provider of Object.keys(PROVIDERS)) assert.match(result.reason, new RegExp(provider));
  });
});

test("a number the gateway could not use is refused before it is sent", async () => {
  await withEnv({ ...UNSET, SMS_PROVIDER: "msg91", SMS_API_KEY: "k" }, async () => {
    const result = await sendSms({ to: "12345", message: "x" });
    assert.equal(result.sent, false);
    assert.match(result.reason, /number/i);
  });
});

test("a number is handed over as digits with its country code", () => {
  // `normalizePhoneNumber` answers `+91 9876543210`; a gateway wants `919876543210`.
  assert.equal(gatewayNumber("+91 98765 43210"), "919876543210");
  assert.equal(gatewayNumber("+91 9876543210"), "919876543210");
  assert.equal(gatewayNumber("nonsense"), null);
  assert.equal(gatewayNumber(""), null);
});

test("a number with no country code is refused rather than guessed at", () => {
  /*
   * `normalizePhoneNumber` is the application's own rule and it refuses a bare ten digits - it does
   * not assume India. That rule is not loosened here: guessing a country code would send somebody's
   * reset code to a stranger in whichever country the guess was wrong about.
   *
   * It matters because the number comes from an employee record, so a record saved without its code
   * cannot be texted. That is a reason in the log rather than a silent failure, and the same
   * `PhoneField` that records the number is what stops one being saved that way - every employee
   * number in this database normalises.
   */
  assert.equal(gatewayNumber("9876543210"), null);
});

test("what the health check prints never includes the key", () => {
  withEnv({ ...UNSET, SMS_PROVIDER: "msg91", SMS_API_KEY: "super-secret-key", SMS_SENDER_ID: "DBSOPS", SMS_TEMPLATE_ID: "t1" }, () => {
    const described = describeSms();
    assert.equal(described.configured, true);
    assert.equal(described.provider, "msg91");
    assert.equal(described.senderId, "DBSOPS");
    // The one thing that must never leave this process.
    assert.ok(!JSON.stringify(described).includes("super-secret-key"), "the health check is printing the API key");
  });
});

test("the code is never put into a log line by the sender, outside the dev echo", () => {
  /*
   * A log line carrying a live OTP is a way in for anybody who can read the logs, which on a small
   * VPS is more people than can read the database. The sender takes the code only to pass it to a
   * template variable; nothing in this file writes it anywhere.
   *
   * `echoToConsole` is the one deliberate exception and is cut out before the scan - it is the
   * whole reason the tests above pin `NODE_ENV` and check every value that is not `development`.
   * The scan stays for everything else: this is the invariant that quietly breaks the first time
   * somebody adds a debug line to a provider while chasing a gateway error.
   */
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "services", "smsSender.js"), "utf8");

  const echoStart = source.indexOf("function echoToConsole");
  assert.ok(echoStart > -1, "echoToConsole is gone - this test is now excluding nothing");
  // Top-level functions in this file end at a `}` in the first column.
  const echoEnd = source.indexOf("\n}", echoStart);
  const scanned = source.slice(0, echoStart) + source.slice(echoEnd);

  const logs = scanned.match(/console\.[a-z]+\([^)]*\)/g) || [];
  for (const line of logs) assert.ok(!/\bcode\b/.test(line), `a log line in smsSender.js names the code: ${line}`);
});

test("the controller never logs the code either", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "controllers", "authController.js"), "utf8");
  const logs = source.match(/console\.[a-z]+\(`[^`]*`/g) || [];
  for (const line of logs) {
    assert.ok(!line.includes("${code}"), `a log line in authController.js prints the OTP: ${line}`);
    assert.ok(!line.includes("${token}"), `a log line in authController.js prints a reset token: ${line}`);
  }
});
