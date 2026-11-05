const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { IDENTIFIER_PATTERN, formatIdentifier } = require("../src/services/identifiers");
const { ENQUIRY_ID } = require("../src/modules/sales/whatsapp-chat/security");
const store = require("../src/services/crmMediaStore");

/*
 * Two guards that check an enquiry id before it reaches a query, a socket or an object key - and
 * that were both checking for a format the studio stopped minting.
 *
 * An enquiry id used to be `DBS-DD-EID-4867`: the vertical, then the tag, then a bare number. It
 * carries its vertical *and* its branch now, after the tag - `DBS-EID-DD-HYD-000024` - which is what
 * lets one number count per vertical and still say where the lead came from.
 *
 * Both guards had the old shape written out by hand, so both refused every id the application has
 * minted since. WhatsApp Chat answered "That is not a valid CRM lead id." on every lead in the
 * system, and the media store - which answers "" for a file it cannot place, deliberately, so a
 * message is never lost over its attachment - quietly had nowhere to file a single one.
 *
 * The lesson is the copy, not the format: a pattern written out beside the one that owns it is a
 * second thing to change, and this is twice what forgetting it cost. Both read
 * `IDENTIFIER_PATTERN` now, and this holds them there.
 */

const CURRENT = [
  formatIdentifier("CRM_LEAD", { vertical: "Dum Dum", branch: "Hyderabad" }, 24),
  formatIdentifier("CRM_LEAD", { vertical: "Qua Qua", branch: "Erode" }, 10),
  formatIdentifier("CRM_LEAD", { vertical: "Corp", branch: "Bangalore" }, 5),
];

// The shape before the vertical and the branch moved. Still in the database on older leads, so both
// guards have to keep taking it.
const LEGACY = "DBS-DD-EID-4867";

test("the ids the studio actually mints are the ids these guards accept", () => {
  for (const id of CURRENT) {
    assert.ok(IDENTIFIER_PATTERN.test(id), `${id} is not an identifier by the rule that mints it`);
    assert.ok(ENQUIRY_ID.test(id), `WhatsApp Chat refuses ${id}, which is every lead on that vertical`);
    assert.equal(store.safeEnquiryId(id), id, `the media store cannot file anything for ${id}`);
  }
  // And the shape they were written for, which is still on the older leads.
  assert.ok(ENQUIRY_ID.test(LEGACY));
  assert.equal(store.safeEnquiryId(LEGACY), LEGACY);
});

test("neither guard keeps a format of its own to forget", () => {
  /*
   * The fault was two hand-written copies of `/^DBS-[A-Z]{2}-EID-\d{1,12}$/`. What matters is not
   * that the string is gone but that neither file decides the format any more: both read it from
   * the service that mints identifiers, so the next change to an id's shape reaches them.
   */
  const security = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "whatsapp-chat", "security.js"), "utf8");
  const media = fs.readFileSync(path.join(__dirname, "..", "src", "services", "crmMediaStore.js"), "utf8");
  for (const [name, source] of [["whatsapp-chat/security.js", security], ["services/crmMediaStore.js", media]]) {
    assert.match(source, /IDENTIFIER_PATTERN/, `${name} does not read the format from the service that mints it`);
    // Comments stripped: the note recording what the old pattern was is allowed to quote it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /DBS-\[A-Z\]/, `${name} has a copy of the id format again`);
  }
});

test("they still refuse anything that is not an identifier", () => {
  /*
   * Loosening the pattern must not loosen what it is *for*. These guards exist because the id
   * reaches a database lookup, a file name and a socket: `DBS`, capitals, hyphens and digits, and
   * nothing else. Whether an id names a lead this caller may read is the handler's question, asked
   * against the lead itself.
   */
  const junk = [
    "../../etc/passwd",
    "DBS-EID-DD-HYD-000024/../..",
    "DBS-EID-DD-HYD-000024; DROP TABLE lead",
    "DBS-EID-DD-HYD-000024 OR 1=1",
    "DBS--1",
    "",
    "  ",
  ];
  for (const value of junk) {
    assert.equal(ENQUIRY_ID.test(value), false, `WhatsApp Chat accepts ${JSON.stringify(value)}`);
    assert.equal(store.safeEnquiryId(value), "", `the media store accepts ${JSON.stringify(value)}`);
  }

  /*
   * Case is the one thing the two treat differently, and both are right for what they are.
   *
   * The route guard tests the id exactly as it arrived: a URL names one lead, and an id that has to
   * be corrected before it matches is an id somebody typed rather than one the application handed
   * out. The media store normalises first, because it is deciding a folder name and the same lead
   * must never end up with two of them - the value it returns is the corrected one, and it still
   * has to pass the same pattern to be returned at all.
   */
  assert.equal(ENQUIRY_ID.test("dbs-eid-dd-hyd-000024"), false);
  assert.equal(store.safeEnquiryId("  dbs-eid-dd-hyd-000024  "), "DBS-EID-DD-HYD-000024");
});

test("a file can be filed for a current lead, and only inside that lead's own folder", () => {
  const key = store.buildKey({ root: "crm", enquiryId: CURRENT[0], clientName: "Rakesh Test", folder: "images", fileName: "a.jpg" });
  assert.equal(key, `crm/rakesh-test-${CURRENT[0]}/images/a.jpg`);
  // The separator in a name is stripped rather than escaped, so a file can only ever be named
  // inside the folder the key already decided on.
  const climbed = store.buildKey({ root: "crm", enquiryId: CURRENT[0], clientName: "Rakesh Test", folder: "images", fileName: "../../secrets.env" });
  assert.equal(climbed, `crm/rakesh-test-${CURRENT[0]}/images/secrets.env`);
  // And an id it cannot place is still "" rather than a throw: a message must not be lost over its
  // attachment.
  assert.equal(store.buildKey({ root: "crm", enquiryId: "nonsense", clientName: "X", folder: "images", fileName: "a.jpg" }), "");
});
