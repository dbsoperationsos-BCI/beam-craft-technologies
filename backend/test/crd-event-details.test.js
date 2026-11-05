const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  documentSchema,
  liftSideEvent,
  missingRequired,
  REQUIRED_COMMON,
  REQUIRED_SIDE,
  SIDE_EVENT_TEXT,
} = require("../src/modules/sales/crd-documents/document");

/*
 * The event, on the Dum Dum Customer Identification Document.
 *
 * It was asked of **each side** - the groom and the bride were each given Event Start, Event End,
 * Event Address Link and the "what else can we help with" list - which is two answers to each of
 * four questions about one wedding, with nothing on the document to say which was right.
 *
 * It is asked once now, on the common block, and the whole of Event Details is shown to the client
 * read-only: it is what Sales already knows about the booking, and the client is being asked to
 * identify themselves rather than to tell the studio when its own shoot is.
 *
 * Three things have to hold for that to be safe, and none of them announce themselves:
 *
 *   * nothing read-only may be required, or a document whose prefill came up short is unsubmittable
 *     by everybody;
 *   * a document saved under the old shape must not lose its event;
 *   * the client's form and the server must agree about which fields are required, or the browser
 *     lets somebody submit what the server then refuses.
 */

const FORM = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "components", "sales", "PublicCrdDocumentFormDumDum.js"),
  "utf8",
);

test("the event is one question, asked on the common block", () => {
  // Parsed from a present-but-empty block rather than from `{}`: Zod hands back a `.default({})`
  // without running the inner schema over it, so `documentSchema.parse({})` answers `{ common: {} }`
  // and would say nothing about which fields the common block actually has.
  const common = documentSchema.parse({ common: {} }).common;
  for (const field of [...SIDE_EVENT_TEXT, "helpWith"]) {
    assert.ok(field in common, `the event's ${field} is not on the common block`);
  }
});

test("nothing the client cannot type in is required of them", () => {
  /*
   * The required list is empty - not thinned, empty.
   *
   * It began as the rule that a field the form will not let anybody type in cannot be a field that
   * blocks submission: the whole common block was read-only, so requiring any of it would have
   * stranded the document with no screen anywhere able to fix it. Point of Contact Name is the one
   * that made it urgent, being prefilled from the lead's primary decision maker or company name,
   * both routinely blank on a wedding lead.
   *
   * The point of contact and the address link are typeable now, and the two event dates are where
   * the studio left them blank - and the list stays empty anyway, deliberately. Being *able* to
   * answer is not the same as being made to: a client who does not yet know their venue's map link,
   * or whose wedding has no end time settled, must still be able to submit. What the studio must
   * have is on the two sides, which is where the required fields are.
   */
  assert.deepEqual(REQUIRED_COMMON, []);
  // And the event has left the side list with it, since it is no longer asked there.
  for (const field of SIDE_EVENT_TEXT) {
    assert.equal(REQUIRED_SIDE.includes(field), false, `${field} is still required of each side`);
  }
  // What is left is what the client actually fills in: both sides in full, and the terms.
  const complete = {
    common: { termsAccepted: true },
    groom: Object.fromEntries(REQUIRED_SIDE.map((field) => [field, "x"])),
    bride: Object.fromEntries(REQUIRED_SIDE.map((field) => [field, "x"])),
  };
  assert.deepEqual(missingRequired(complete), [], "a document with both sides and the terms is still not submittable");
  // The terms are still the client's own answer and still block submission without them.
  assert.deepEqual(missingRequired({ ...complete, common: {} }), ["common.termsAccepted"]);
});

test("a document saved before the move keeps its event", () => {
  /*
   * The groom's answers lead, because that side is what the prefill filled in from the booking, and
   * the bride's fill whatever the groom's left blank - so a couple who each answered half the
   * questions between them lose nothing.
   */
  const lifted = liftSideEvent({
    common: {},
    groom: { eventStartAt: "2026-02-01T10:00", helpWith: ["DJ"] },
    bride: { eventEndAt: "2026-02-02T22:00", eventAddressLink: "https://maps.app.goo.gl/x" },
  });
  assert.equal(lifted.common.eventStartAt, "2026-02-01T10:00");
  assert.equal(lifted.common.eventEndAt, "2026-02-02T22:00");
  assert.equal(lifted.common.eventAddressLink, "https://maps.app.goo.gl/x");
  assert.deepEqual(lifted.common.helpWith, ["DJ"]);
});

test("the lift only ever fills a blank, and never runs twice to any effect", () => {
  // What is on the common block is what somebody has actually said about this event. An old side
  // value must never overwrite it - that is the whole reason this is safe to run on every read.
  const document = {
    common: { eventStartAt: "2026-03-01T09:00", helpWith: ["DJ"] },
    groom: { eventStartAt: "2020-01-01T00:00", helpWith: ["Zimmy Zip Crane"] },
    bride: {},
  };
  const once = liftSideEvent(document);
  assert.equal(once.common.eventStartAt, "2026-03-01T09:00");
  assert.deepEqual(once.common.helpWith, ["DJ"]);
  assert.deepEqual(liftSideEvent(once).common, once.common, "the lift is not idempotent");
  // Pure: the document it was handed is not edited, so a caller holding the stored shape still has it.
  assert.equal(document.common.eventStartAt, "2026-03-01T09:00");
});

test("a document with nothing to lift passes through unchanged", () => {
  const empty = { common: {}, groom: {}, bride: {} };
  assert.deepEqual(liftSideEvent(empty).common, {});
});

test("the client's form and the server agree about what is required", () => {
  /*
   * Two lists, one rule. The server decides; the browser's copy is what moves the progress bar and
   * what decides whether Submit is even attempted, so a browser that thinks less is required lets
   * somebody press Submit and be refused, and one that thinks more is required refuses a document
   * the server would have taken.
   */
  const commonList = FORM.match(/const requiredCommon = \[([^\]]*)\]/);
  assert.ok(commonList, "the form no longer declares its required common fields");
  assert.equal(commonList[1].trim(), "", "the form still requires a field the client cannot type in");

  const sideList = FORM.match(/const requiredSide = \[([^\]]*)\]/);
  assert.ok(sideList, "the form no longer declares its required side fields");
  const formSide = sideList[1].split(",").map((entry) => entry.trim().replace(/^"|"$/g, "")).filter(Boolean);
  assert.deepEqual(formSide, REQUIRED_SIDE);
});

test("Event Details says, one control at a time, which answers are the studio's and which are the client's", () => {
  /*
   * It was wrapped in a `disabled` fieldset, on the reasoning that one wrapper cannot forget a field
   * added later. What a reader saw was the cost of that: controls which style themselves off
   * `:disabled` went grey and the ones that do not - the phone field, whose wrapper hardcodes a
   * white fill around a transparent input - stayed white in a row of grey boxes; and every chevron
   * stayed drawn, pointing at a list that could no longer be opened.
   *
   * `readOnly` is the application's own word for a value being read back, and it means the same
   * thing in `Dropdown`, `MultiSelectField` and `TextField`: one grey tone, no chevron, no refused
   * cursor. So each control says it for itself, and this is what holds them to that.
   *
   * The block is no longer read-only throughout, which is why this names the two lists rather than
   * counting. What the booking settles - which shoot this is, what kind, who sent them - is read
   * back. What the client is the one who actually knows - who to call about the wedding, and where
   * the venue is on a map - is theirs to answer, prefilled where the lead had it. A wrapper cannot
   * express that distinction, and neither can a count; naming both sides is what stops a field
   * quietly changing hands.
   */
  const section = FORM.slice(FORM.indexOf('<SchemaFormSection id="event-details"'), FORM.indexOf('<SchemaFormSection id="groom-details"'));
  assert.doesNotMatch(section, /<ReadOnlyFieldset/, "the section is disabled as a block again, which greys some controls and not others");
  // `DateField` among them since the two event dates stopped being native `datetime-local` boxes
  // and became the application's own calendar, with a time on it.
  const controls = section.match(/<(Field|DateField|ComboBoxField|PhoneField|MultiSelectField)\b[\s\S]*?\/>/g) || [];
  const controlFor = (label) => {
    const found = controls.find((control) => control.includes(`label="${label}"`));
    assert.ok(found, `Event Details no longer draws "${label}"`);
    return found;
  };

  // What the booking already settled. A field added here without `readOnly` is a live box in the
  // half of this block the client is not being asked about.
  for (const label of ["Event ID", "WhatsApp Group Name", "Event Type", "Referred By", "Help us to know what other things we can help you with?"]) {
    assert.match(controlFor(label), /\breadOnly\b/, `"${label}" is the booking's answer and must be read back`);
  }

  // What the client answers. `readOnly` on any of these is the studio asking a question and then
  // refusing the answer.
  for (const label of ["Point of Contact Phone Number", "Point Of Contact Name", "Event Address Link"]) {
    assert.doesNotMatch(controlFor(label), /\breadOnly\b/, `"${label}" is the client's to answer and must not be read-only`);
  }

  /*
   * And the two event dates, which are one or the other depending on the booking: read back where
   * the studio has answered them, the client's where it has not.
   *
   * `readOnly={eventDatesFromStudio.<field>}` and never a plain `readOnly`, and never read off the
   * live value either - asking "is this box empty now" would lock the field under the client on the
   * first character they typed.
   */
  for (const [label, field] of [["Event Start Date & Time", "eventStartAt"], ["Event End Date & Time", "eventEndAt"]]) {
    const control = controlFor(label);
    assert.match(control, new RegExp(`readOnly=\\{eventDatesFromStudio\\.${field}\\}`),
      `"${label}" must be read-back only where the studio already answered it`);
    // The application's own calendar, carrying a time - not the browser's `datetime-local`, which
    // looked different in every browser and took none of the bounds this field can express.
    assert.match(control, /^<DateField\b/, `"${label}" must use the shared DateField`);
    assert.match(control, /\bwithTime\b/, `"${label}" is a date and a time, and must ask for both`);
  }
  /*
   * And it is the *server* that says which of the two the studio answered, not the shape of the
   * value. Once a client types a date and it saves, their answer is on the document and looks
   * exactly like one the studio knew - so a form reading "is this box filled" hands the field over
   * on the way in and takes it back on the next visit, with their own answer locked inside it.
   */
  assert.match(FORM, /const \[eventDatesFromStudio\] = useState\(\(\) => \{[\s\S]*?initialContext\?\.prefilledCommonFields/,
    "the read-back decision must come from the server's prefilledCommonFields, never from the value being non-empty");

  /*
   * And the paragraph above them has gone. The greyed boxes say they are not being asked for, the
   * section they sit under says what they are, and a line repeating that was the only sentence on
   * this document addressed to the reader about the form rather than about their wedding.
   */
  assert.doesNotMatch(section, /These are the details from your booking/, "the explanatory line is back above the fields");

  // The four event fields are here, and in the order they were asked for: after the point of
  // contact, without a heading of their own.
  for (const label of ["Event Start Date & Time", "Event End Date & Time", "Event Address Link", "Help us to know what other things we can help you with?"]) {
    assert.ok(section.includes(label), `Event Details no longer carries "${label}"`);
  }
  assert.equal(section.includes("<SectionHeading"), false, "the event has a heading of its own inside Event Details");

  /*
   * And the order they are drawn in: what the booking settles, then when the event is, then who to
   * call about it, then where it is.
   *
   * The point of contact sits under the dates rather than above them - the pair of them and the
   * address link below are the three things the client is actually being asked here, so they read
   * together instead of being split by the event's own dates.
   */
  const order = ["Event ID", "WhatsApp Group Name", "Event Type", "Referred By", "Event Start Date & Time", "Event End Date & Time", "Point of Contact Phone Number", "Point Of Contact Name", "Event Address Link"];
  const positions = order.map((label) => section.indexOf(label));
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index] > positions[index - 1], `"${order[index]}" is not drawn after "${order[index - 1]}"`);
  }
});

test("neither side asks the event any more", () => {
  const sideFields = FORM.slice(FORM.indexOf("function SideFields("), FORM.indexOf("/** `initialContext`"));
  for (const label of ["Event Start Date & Time", "Event End Date & Time", "Event Address Link"]) {
    assert.equal(sideFields.includes(label), false, `the Groom and Bride tabs still ask "${label}"`);
  }
  assert.equal(sideFields.includes('<SectionHeading title="Event"'), false, "the sides still carry an Event section");
});
