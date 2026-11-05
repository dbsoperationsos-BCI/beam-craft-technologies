import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Settings → Project Management → **Shoot crew notice**, now with a vendor arm beside the crew one.
 *
 * What this pins is the part a reader of the screen could be wrong about, where being wrong costs the
 * studio its WhatsApp number or a vendor a wasted drive:
 *
 *   - the two arms switch **independently**, so vendors can go live without touching what already
 *     works for the studio's own people;
 *   - switching the vendor arm on says, in the notice it shows, that **nobody already confirmed has
 *     been messaged** - "it is on" alone would be read as "and everybody has been told";
 *   - there is no sender to pick any more, and the card that held the picker holds the **waiting
 *     list** instead. A message that cannot go is otherwise invisible, since nothing fails loudly;
 *   - each waiting line says **who fixes it**, because the five reasons are fixed by five different
 *     people and "cannot send" sends nobody anywhere.
 */

const root = path.join(import.meta.dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const PANEL = read("frontend/src/components/settings/ShootCrewNoticePanel.js");
const SERVICE = read("frontend/src/services/settings/shootCrewNotice.service.js");
const OVERLAY = read("frontend/src/components/settings/SettingsOverlay.js");
const TEMPLATES = read("frontend/src/components/settings/MessageTemplatePanel.js");
const ACTIVITY = read("frontend/src/lib/whatsappActivity.mjs");

const VENDOR_KEYS = [
  "VENDOR_SHOOT_CONFIRMED", "VENDOR_SHOOT_REMINDER", "VENDOR_SHOOT_DATE_CHANGED",
  "VENDOR_SHOOT_PLACE_CHANGED", "VENDOR_SHOOT_SERVICE_CHANGED", "VENDOR_SHOOT_REMOVED",
];

test("the two arms are two switches, each with its own last sent and its own trouble", () => {
  assert.match(PANEL, /onSwitch=\{switchCrew\}/);
  assert.match(PANEL, /onSwitch=\{switchVendor\}/);
  assert.match(PANEL, /lastSentAt=\{status\.vendorLastSentAt\}/);
  assert.match(PANEL, /lastError=\{status\.vendorLastError\}/);
  // One card component drawn twice, so neither arm becomes the odd one out as they are changed.
  assert.match(PANEL, /function NoticeArm\(/);
  assert.equal(PANEL.match(/<NoticeArm\b/g)?.length, 2);
  assert.match(SERVICE, /export function setVendorShootNoticeEnabled\(enabled\) \{\n\s*return put\("\/vendor\/enabled", \{ enabled \}\);/);
});

test("switching the vendor arm on says that nobody already confirmed has been messaged", () => {
  assert.match(PANEL, /nobody already confirmed has been messaged/);
});

test("the sender picker is gone, and the card now shows what is waiting and who fixes it", () => {
  for (const gone of ["SenderOrderField", "listShootCrewNoticeSenderCandidates", "setShootCrewNoticeSenders", "candidates", "Rotation"]) {
    assert.doesNotMatch(PANEL, new RegExp(gone), `${gone} decides nothing now, so it is not left on the screen`);
  }
  assert.doesNotMatch(SERVICE, /senders/);
  assert.match(PANEL, /status\.waiting \|\| \[\]/);
  assert.match(PANEL, /const FIXED_BY = \{/);
  for (const why of ["NOBODY_NAMED", "NO_LOGIN", "NOT_ELIGIBLE", "CHAT_OFF", "NOT_CONNECTED", "NO_NUMBER"]) {
    assert.match(PANEL, new RegExp(`${why}:`), `${why} says who fixes it`);
  }
  // An empty list is said out loud both ways round: nothing waiting, or nothing on.
  assert.match(PANEL, /Nothing is waiting\./);
  assert.match(PANEL, /Both arms are off/);
});

test("the panel is built from the components that exist, and types no markup of its own", () => {
  for (const component of ["DashboardCard", "InlineAlert", "Loader", "RecordSummaryCard", "ToggleSwitch"]) {
    assert.match(PANEL, new RegExp(`import ${component} from "@/components/shared/${component}"`), `${component} is reused`);
  }
  // The tinted blocks this panel used to hand-roll are `InlineAlert`'s job.
  assert.doesNotMatch(PANEL, /role="alert" className=/);
  assert.doesNotMatch(PANEL, /border-rose-200 bg-rose-50|border-amber-200 bg-amber-50/);
  assert.doesNotMatch(PANEL, /<button|<input|<select/, "every control is a component");
});

test("the six vendor wordings are offered in Settings, documented, and named in the activity log", () => {
  for (const key of VENDOR_KEYS) {
    assert.match(OVERLAY, new RegExp(`\\["${key}", "`), `${key} has its own section under Templates`);
    assert.match(TEMPLATES, new RegExp(`"${key}"`), `${key}'s placeholders are documented`);
    assert.match(ACTIVITY, new RegExp(`${key}: "`), `${key} reads as words in the WhatsApp Activity Log`);
  }
  /*
   * And documented **once** for all six, not typed out six times: six slightly different lists for
   * one set of facts is how a placeholder ends up documented in five messages and missing from the
   * sixth.
   */
  assert.match(TEMPLATES, /const VENDOR_SHOOT_PLACEHOLDERS = \{/);
  assert.match(TEMPLATES, /\.map\(\(key\) => \[key, VENDOR_SHOOT_PLACEHOLDERS\]\)\)/);
  const body = TEMPLATES.slice(TEMPLATES.indexOf("const VENDOR_SHOOT_PLACEHOLDERS = {"));
  for (const name of ['"vendor name"', '"manager name"', "service", "place", "district"]) {
    assert.ok(body.slice(0, body.indexOf("\n};")).includes(`${name}:`), `the six document ${name}`);
  }
});

test("a failure the panel shows carries no phone number, and a load failure can be tried again", () => {
  // What the WhatsApp library says contains a jid, which is a number; the backend takes it out
  // (`projectSender.plainly`) and this panel renders whatever it is given.
  assert.match(read("backend/src/modules/settings/shoot-crew-notice/projectSender.js"), /function plainly\(error\)/);
  assert.match(PANEL, /action=\{<Button size="sm" onClick=\{\(\) => \{ void load\(\); \}\}>Try again<\/Button>\}/);
  // And a reader who may not switch it is told why there is no switch, rather than left guessing.
  assert.match(PANEL, /Only an administrator can switch this on or off\./);
});

test("what each switch will do is on the card, not only in the tooltip", () => {
  /*
   * A consequence a hover reveals is one a touch or keyboard reader never meets - and the vendor
   * arm's consequence is the one that matters: switching it on messages nobody already confirmed.
   */
  assert.match(PANEL, /summary="Tells each shoot's crew two days before it/);
  assert.match(PANEL, /summary="Tells a vendor half an hour after you confirm them[^"]*Switching it on messages nobody already confirmed\./);
  // `DashboardCard` gained `tip` for exactly this: a visible line, and the long form behind the ⓘ.
  assert.match(read("frontend/src/components/shared/DashboardCard.js"), /tip = ""/);
  assert.match(PANEL, /note=\{summary\}/);
  assert.match(PANEL, /tip=\{note\}/);
  // The card no longer holds a picker, so it no longer claims to.
  assert.match(PANEL, /title="Waiting to be sent"/);
  assert.doesNotMatch(PANEL, /title="Who sends it"/);
});
