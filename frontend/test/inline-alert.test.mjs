import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ALERT = read("src/components/shared/InlineAlert.js");

/*
 * InlineAlert: a message that belongs beside the thing it is about and stays while it is true -
 * which is a different job from FloatingNotice, that floats over the screen and is dismissed.
 */

test("four tones, each with its own colour, icon and how it announces itself", () => {
  for (const [tone, role] of [["error", "alert"], ["warning", "status"], ["success", "status"], ["info", "status"]]) {
    assert.match(ALERT, new RegExp(`${tone}: \\{ className: "[^"]+", Icon: \\w+, role: "${role}" \\}`), `${tone} is defined`);
  }
  // An error is the one a screen reader interrupts for; the rest are polite.
  assert.match(ALERT, /role=\{role \|\| toneRole\}/);
  assert.match(ALERT, /if \(!children\) return null;/, "nothing to say draws nothing");
});

test("the tints are the plain names the dark appearances repaint", () => {
  const tones = ALERT.slice(ALERT.indexOf("const TONES = {"), ALERT.indexOf("const SIZES = {"));
  for (const name of ["bg-rose-50", "bg-amber-50", "bg-emerald-50", "bg-slate-50"]) assert.ok(tones.includes(name), name);
  assert.doesNotMatch(tones, /bg-(rose|amber|emerald|slate)-50\//, "an opacity modifier is a class globals.css misses");
});

test("it wraps inside the row it sits in, and an action keeps its own colour", () => {
  assert.match(ALERT, /<span className="min-w-0 flex-1 break-words">\{children\}<\/span>/);
  assert.match(ALERT, /\{action && <span className="-my-0\.5 shrink-0">\{action\}<\/span>\}/);
});

test("every WhatsApp group add says what happened to it, and a failed one offers Retry", () => {
  const groups = read("src/components/employees/EmployeeWhatsAppGroups.js");
  // Added needs no explaining; every other outcome says something, with its own tone.
  for (const [status, tone] of [["PENDING", '"info"'], ["ALREADY", '"success"'], ["INVITED", '"warning"'], ["FAILED", '"error"']]) {
    assert.match(groups, new RegExp(`${status}: \\{[^}]*alert: ${tone},[^}]*say: "[^"]+"`), `${status} has a tone and words`);
  }
  assert.match(groups, /ADDED: \{[^}]*alert: null, say: "" \}/, "a plain success is not explained");
  // WhatsApp's own reason where it gave one - it tells a privacy setting from somebody who just left.
  assert.match(groups, /\{row\.detail \|\| status\.say\}/);
  assert.match(groups, /action=\{row\.status === "FAILED" && canWrite\s*\n\s*\? <Button[\s\S]*?>Retry<\/Button>/);
  // A new employee has no record to add to, so the Add is not offered at all.
  assert.match(groups, /if \(!employeeId\) return <InlineAlert tone="info">Save this employee first/);
});
