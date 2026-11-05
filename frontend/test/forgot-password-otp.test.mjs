import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Forgot Password is a mobile code, and only a mobile code.
 *
 * The studio's people know their own number and do not all read the address their login was created
 * with, so recovery is a six-digit code to the number they gave during onboarding. The email field
 * is gone from this screen - not hidden behind a link, not a fallback tab, gone - and the test that
 * matters most is the one that says so, because "still asks for an email" is exactly what was
 * reported twice.
 *
 * Reads the source, the way the other auth tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const FORM = read("components", "auth", "ForgotPasswordForm.js");
const SERVICE = read("services", "auth", "auth.service.js");

/** The screen with its prose stripped: the comments explain what was removed and why. */
const markup = FORM.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("the screen asks for a mobile number and never for an email", () => {
  assert.match(markup, /<PhoneField/, "the number is not asked for through the application's phone control");
  assert.match(markup, /label="Mobile number"/);

  // The three shapes an email field takes, none of which may be here.
  assert.ok(!markup.includes('type="email"'), "the email input is still on the screen");
  assert.ok(!markup.includes("Email address"), "the screen still has an email label");
  assert.ok(!/requestPasswordReset\b/.test(markup), "the screen still calls the emailed-link route");
  // And no way back to one, which is what a fallback tab or a switch link would be.
  assert.ok(!/Use my email/i.test(markup), "the screen still offers a way to the email route");
});

test("it sends a code and exchanges it, and nothing else", () => {
  assert.match(markup, /requestPasswordResetOtp\(/, "nothing on the screen asks for a code");
  assert.match(markup, /verifyPasswordResetOtp\(/, "nothing on the screen checks a code");
  // A verified code leaves for the screen that sets the password, carrying the token it was given.
  assert.match(markup, /router\.push\(`\/reset-password\?token=\$\{encodeURIComponent\(response\.token\)\}`\)/);
});

test("the code is six digits and worth two minutes", () => {
  assert.match(FORM, /const OTP_SECONDS = 120;/, "the screen's countdown is no longer two minutes");
  assert.match(markup, /maxLength=\{6\}/);
  assert.match(markup, /otp\.length !== 6/, "Verify is offered for something that is not six digits");
  // Digits only, so a pasted "123 456" still lands as six.
  assert.match(markup, /replace\(\/\\D\/g, ""\)\.slice\(0, 6\)/);
});

test("the time left is shown, and Resend waits for it to run out", () => {
  /*
   * A resend that works while a code is live is how somebody ends up holding two and typing the one
   * that no longer counts - the server spends the previous code the moment it issues another.
   */
  assert.match(markup, /Expires in \$\{asClock\(secondsLeft\)\}/);
  assert.match(markup, /This code has expired\./);
  assert.match(markup, /disabled=\{busy \|\| !expired\}/, "Resend is offered while the code is still live");
  // And an expired code cannot be submitted, so the only way on is a new one. A short code can be
  // pressed, and is marked under its box rather than the button refusing in silence.
  assert.match(markup, /disabled=\{busy \|\| \(step === "code" && expired\)\}/);
  assert.match(markup, /fields\.check\(\{ otp: otp\.length !== 6 \? "Enter the six-digit code\." : "" \}\)/);
});

test("the countdown is one interval, and it is cleaned up", () => {
  // A form left open must not keep a timer alive, and a second interval would count down twice as
  // fast - which reads as a code expiring early for no reason anybody could reproduce.
  assert.match(FORM, /const timer = setInterval\(/);
  assert.match(FORM, /return \(\) => clearInterval\(timer\);/);
});

test("the number cannot be changed underneath a live code", () => {
  // Otherwise the screen asks for one phone and checks the code sent to another.
  assert.match(markup, /disabled=\{busy \|\| step === "code"\}/);
  // Changing it is still possible, deliberately: it is the one thing that goes wrong here.
  assert.match(markup, /Use a different mobile number/);
});

test("the service offers both halves of the flow", () => {
  assert.match(SERVICE, /export function requestPasswordResetOtp\(mobile\)/);
  assert.match(SERVICE, /export function verifyPasswordResetOtp\(\{ mobile, otp \}\)/);
  assert.match(SERVICE, /"\/api\/auth\/forgot-password\/otp"/);
  assert.match(SERVICE, /"\/api\/auth\/forgot-password\/otp\/verify"/);
});
