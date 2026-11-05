import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");

/*
 * The client's CRD form asks about every event - one per shoot of the project - on Dum Dum and Qua
 * Qua alike, and the studio's read-back shows each.
 */
test("both client forms draw one event block per shoot through the shared component", () => {
  const shared = read("sales/crdDocumentShared.js");
  assert.match(shared, /export function CrdEventsFields\(\{ events = \[\], onChange \}\)/);
  assert.match(shared, /`Event \$\{index \+ 1\}: \$\{event\.shoot \|\| "Event"\}`/);
  const dumDum = read("sales/PublicCrdDocumentFormDumDum.js");
  assert.match(dumDum, /\{hasEvents && <div className="mt-6"><CrdEventsFields events=\{document\.common\.events\} onChange=\{setCommon\("events"\)\} \/><\/div>\}/);
  // A document with no shoots behind it still asks its one event as before.
  assert.match(dumDum, /\{!hasEvents && <DateField label="Event Start Date & Time"/);
  assert.match(read("sales/PublicCrdDocumentFormQuaQua.js"), /<CrdEventsFields events=\{document\.events\} onChange=\{set\("events"\)\} \/>/);
});

test("the studio's read-back lists every event the client answered", () => {
  const response = read("sales/CrdDocumentResponse.js");
  assert.match(response, /<EventGroups events=\{common\.events\} \/>/);
  assert.match(response, /<EventGroups events=\{document\.events\} \/>/);
});

test("each event asks its date, start time and end time as three fields, times on the 12-hour picker", () => {
  const shared = read("sales/crdDocumentShared.js");
  assert.match(shared, /<DateField label="Date" placeholder="Select date" value=\{event\.eventDate\}/);
  assert.match(shared, /<TimeField label="Start Time" twelveHour value=\{event\.startTime\}/);
  assert.match(shared, /"End Time"\} twelveHour value=\{event\.endTime\}/);
  assert.match(read("sales/CrdDocumentResponse.js"), /<Answer label="Start Time" value=\{clockTime\(event\.startTime\) \|\| ""\} \/>/);
});

test("an end time earlier than the start runs past midnight - every screen says next day", async () => {
  const { endsNextDay, shootTimeLabel } = await import("../src/lib/shootBoard.mjs");
  assert.equal(endsNextDay("21:00", "02:00"), true);
  assert.equal(endsNextDay("09:00", "13:00"), false);
  assert.equal(endsNextDay("21:00", ""), false);
  assert.equal(shootTimeLabel({ startTime: "21:00", endTime: "02:00" }), "9:00 pm – 2:00 am (next day)");
  assert.match(read("sales/crdDocumentShared.js"), /label=\{endsNextDay\(event\.startTime, event\.endTime\) \? "End Time \(next day\)" : "End Time"\}/);
  const config = fs.readFileSync(new URL("../src/constants/formPanelConfig.js", import.meta.url), "utf8");
  assert.match(config, /"Event End Time \(next day\)" : "Event End Time"/);
});

test("a required field left blank turns red and says so, through the field's own error", () => {
  const shared = read("sales/crdDocumentShared.js");
  assert.match(shared, /error=\{invalid \? `\$\{label\} is required\.` : ""\}/);
  assert.doesNotMatch(shared, /inputClassName=\{invalid \?/, "an added border class lost to the field's own");
  const quaQua = read("sales/PublicCrdDocumentFormQuaQua.js");
  assert.match(quaQua, /error=\{invalid\("shootType"\) \? "Choose the Shoot Type\." : ""\}/);
  assert.match(quaQua, /error=\{invalid\("branch"\) \? "Choose the Branch\." : ""\}/);
});

test("a missing answer is marked red and scrolled to, with one short notice - on both forms", () => {
  const shared = read("sales/crdDocumentShared.js");
  assert.match(shared, /export function CrdTermsAgreement\(\{ checked, onChange, invalid = false \}\)/);
  assert.match(shared, /Tick the box to agree to the terms &amp; conditions\./);
  assert.match(shared, /export const FILL_MANDATORY = "Please fill the mandatory fields\.";/);
  assert.match(shared, /querySelector\('\[aria-invalid="true"\], \[role="alert"\]'\)\?\.scrollIntoView\(\{ block: "center"/);
  for (const form of ["sales/PublicCrdDocumentFormQuaQua.js", "sales/PublicCrdDocumentFormDumDum.js"]) {
    const source = read(form);
    assert.match(source, /<CrdTermsAgreement checked=/, form);
    assert.match(source, /showNotice\(FILL_MANDATORY, "error"\);/, form);
    assert.doesNotMatch(source, /still to go/i, form);
    assert.match(source, /scrollToFirstMissing\(/, form);
  }
  // A required photo left out shows red, not only a line of text.
  assert.match(read("shared/ImageUploadField.js"), /\$\{shown \? "border-red-400 bg-red-50 text-red-500" :/);
});
