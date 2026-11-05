const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const prisma = require("../src/config/db");
const { definitions } = require("../src/modules/hrm/master-data/definitions");
const {
  paymentModes, modesWithTransactionId, modesWithAccount, modesWithDetails,
  FALLBACK_MODES, FALLBACK_MODES_WITH_TRANSACTION_ID, FALLBACK_MODES_WITH_ACCOUNT, FALLBACK_MODES_WITH_DETAILS,
} = require("../src/services/paymentOptionLists");

/*
 * Three lists the studio maintains rather than three arrays it could not reach - the payment
 * schedule's Category, the Payment Mode on a cash entry, and the Tier a group name is minted with.
 *
 * The flags are the point. Every one of these carried its meaning in the *spelling*: "Final
 * Settlement" was compared against as a literal string in three places, "Partial Payment" and
 * "Extras Services" were matched by a regular expression that numbered them, and which modes ask
 * for a reference or an account were three more arrays - written out twice over, once in the
 * browser and once in the controller that validates the entry, so a studio adding a mode of its own
 * got one the form offered and the server refused.
 *
 * With the meaning on the row the lists can be renamed and the behaviour follows. What these tests
 * hold to is that the meaning is still *somewhere*: exactly one category closes a schedule, the
 * seeds are what the arrays held, and neither list is ever allowed to answer with nothing.
 */

test("the seeded lists are what the arrays held", async () => {
  // Nothing already recorded may stop matching: a cash entry filed under "Net Banking" before this
  // has to still name a mode the list offers.
  assert.deepEqual((await paymentModes()).slice().sort(), FALLBACK_MODES.slice().sort());

  const tiers = await prisma.tier.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  assert.deepEqual(tiers.map((tier) => tier.name), ["1t1", "2t2", "3t3", "4t4", "5t5"]);

  const categories = await prisma.paymentScheduleCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  assert.deepEqual(categories.map((row) => row.name), ["Advance", "Partial Payment", "Extras Services", "Final Settlement"]);
});

test("each payment mode asks for what it used to ask for", async () => {
  const [withTransactionId, withAccount, withDetails] = await Promise.all([
    modesWithTransactionId(), modesWithAccount(), modesWithDetails(),
  ]);
  assert.deepEqual(withTransactionId.slice().sort(), FALLBACK_MODES_WITH_TRANSACTION_ID.slice().sort());
  assert.deepEqual(withAccount.slice().sort(), FALLBACK_MODES_WITH_ACCOUNT.slice().sort());
  assert.deepEqual(withDetails.slice().sort(), FALLBACK_MODES_WITH_DETAILS.slice().sort());

  // Cash is the one that asks for neither, and "Other" is the way out that then says what it
  // actually was. A mode that asked for nothing at all and did not say why would be a mode a studio
  // could file money under with no record of where it went.
  const cash = await prisma.paymentMode.findFirst({ where: { name: "Cash" } });
  assert.ok(cash && !cash.asksForTransactionId && !cash.asksForAccount && !cash.asksForDetails);
});

test("exactly one category closes a schedule", async () => {
  /*
   * The row that settles the balance is pinned to the bottom, takes no date, and nothing may follow
   * it. Two of them would be two rows each claiming to be the last, and none would leave a schedule
   * that never closes - so this is the flag the studio may move but not duplicate.
   */
  const settling = await prisma.paymentScheduleCategory.findMany({ where: { isActive: true, settlesBalance: true } });
  assert.equal(settling.length, 1, "a schedule has no single closing row");
  assert.equal(settling[0].name, "Final Settlement");
});

test("the repeatable categories are the two that were numbered", async () => {
  // A schedule holds several Partial Payments, numbered as they are added. That numbering was a
  // regular expression over the two names, so it is a flag now rather than a spelling.
  const repeatable = await prisma.paymentScheduleCategory.findMany({ where: { isActive: true, repeatable: true }, orderBy: { sortOrder: "asc" } });
  assert.deepEqual(repeatable.map((row) => row.name), ["Partial Payment", "Extras Services"]);
  assert.ok(repeatable.every((row) => !row.settlesBalance), "a category both repeats and closes the schedule");
});

test("a list that cannot be read falls back rather than answering empty", async () => {
  /*
   * Answering "no mode is valid" would refuse every cash entry the studio tried to record, and an
   * empty category list would leave the schedule's menu blank. Every read here falls back to what
   * the code used to say, so an unseeded or unreachable database costs the studio its edits and
   * nothing else.
   */
  for (const fallback of [FALLBACK_MODES, FALLBACK_MODES_WITH_TRANSACTION_ID, FALLBACK_MODES_WITH_ACCOUNT, FALLBACK_MODES_WITH_DETAILS]) {
    assert.ok(Array.isArray(fallback) && fallback.length, "a fallback is empty, so a failed read answers with nothing");
  }
});

test("Field Settings offers all three lists, each under the module it belongs to", () => {
  for (const key of ["payment-schedule-categories", "payment-modes", "tiers"]) {
    assert.ok(definitions[key], `${key} is not a master-data resource`);
  }
  // The two that carry behaviour take their flags on create and on update, or the studio could add
  // a mode but never say what it asks for.
  const mode = definitions["payment-modes"].createSchema.shape;
  for (const flag of ["asksForTransactionId", "asksForAccount", "asksForDetails"]) {
    assert.ok(mode[flag], `a payment mode cannot be given its ${flag}`);
  }
  const category = definitions["payment-schedule-categories"].createSchema.shape;
  for (const flag of ["settlesBalance", "repeatable"]) {
    assert.ok(category[flag], `a schedule category cannot be given its ${flag}`);
  }
});

/* ────────────────────────── the readers, off the source ────────────────────────── */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");

test("the schedule decides its closing row by the flag, not the word", () => {
  const section = read("..", "frontend", "src", "components", "project-management", "SchedulePaymentSection.js");
  assert.match(section, /getMasterData\("payment-schedule-categories"/, "the schedule no longer reads the editable list");
  assert.ok(!/=== "Final Settlement"/.test(section), "the schedule still compares against the literal name");
  assert.ok(!/!== "Final Settlement"/.test(section), "the schedule still compares against the literal name");
  // The numbering too: it was a regular expression written around the two names.
  assert.ok(!/\^partial payment/i.test(section), "the numbering is still hardcoded to the old names");
  assert.match(section, /categories\.repeatable/, "the numbering no longer follows the repeatable flag");
});

test("every form that records money, and the server, ask the same list", () => {
  /*
   * Two forms record money against a project - Accounts' Cash Received and the **Payment Received**
   * section of Create Project - and they draw the same fields from the same config. Create Project
   * built its context by hand and left `paymentModes` out of it, so its Payment Mode dropdown
   * opened empty; the advance is required in full, so nobody who could see the section could create
   * a project at all.
   *
   * They read one hook now. This is asked of both, because a second reader is exactly how the first
   * one went wrong, and of the hook, because that is where the list is actually fetched.
   */
  for (const panelPath of [
    ["..", "frontend", "src", "components", "accounts", "CashEntryFormPanel.js"],
    ["..", "frontend", "src", "components", "sales", "CreateProjectFormPanel.js"],
  ]) {
    const panel = read(...panelPath);
    assert.match(panel, /usePaymentModes\(/, `${panelPath.at(-1)} no longer reads the shared payment mode list`);
    assert.doesNotMatch(
      panel,
      /getMasterData\("payment-modes"/,
      `${panelPath.at(-1)} reads the modes itself again, which is how the two came to disagree`,
    );
  }

  const hook = read("..", "frontend", "src", "components", "accounts", "usePaymentModes.js");
  assert.match(hook, /getMasterData\("payment-modes"/, "the hook no longer reads the editable modes");
  // And never left with an empty picker: a failed read must not be the reason a studio cannot
  // record money at all.
  assert.match(hook, /rows\?\.length/, "an empty read leaves the Payment Mode picker blank");
  assert.match(hook, /: PAYMENT_MODES\)/, "there is no last-resort list behind the picker");

  const config = read("..", "frontend", "src", "constants", "accountsConfig.js");
  assert.match(config, /options: "paymentModes"/, "the Payment Mode field is back on a compiled-in list");

  // The server validating against the same list is the half that was missing: the form offered a
  // studio's own mode and the controller's enum refused it.
  const controller = read("src", "modules", "accounts", "cash-entries", "controller.js");
  assert.match(controller, /await paymentModes\(\)/, "the controller no longer validates against the list");
});

test("the group name generator reads the tiers", () => {
  const dialog = read("..", "frontend", "src", "components", "sales", "WhatsappGroupNameDialog.js");
  assert.match(dialog, /getMasterData\("tiers"/, "the generator no longer reads the editable tiers");
  assert.match(dialog, /FALLBACK_TIERS/, "a failed read leaves the Tier field empty, so no name can be generated");
});

test("Field Settings puts each list under the screens it takes effect on", () => {
  /*
   * The screens are `navigation.mjs` ids - the sidebar's own - since Settings -> Fields asks module,
   * then screen, then field. A schedule is filled in when a project is booked on Bookings &
   * Converted and again under Projects; a cash entry is Accounts Manager's and is also raised
   * against a project; the Tier is minted into the W/A group name on Bookings & Converted.
   */
  const lists = read("..", "frontend", "src", "constants", "moduleFieldLists.js");
  const entry = (value) => {
    const start = lists.indexOf(`value: "${value}"`);
    assert.ok(start >= 0, `${value} is no longer offered in Field Settings`);
    const screens = lists.slice(start, lists.indexOf("]", lists.indexOf("screens:", start)) + 1);
    return screens.slice(screens.indexOf("screens:"));
  };
  assert.match(entry("payment-schedule-categories"), /"bookings-converted"[\s\S]*"projects"/, "Category is not under Bookings & Converted and Projects");
  assert.match(entry("payment-modes"), /"accounts-manager"[\s\S]*"projects"/, "Payment Mode is not under Accounts Manager and Projects");
  assert.match(entry("tiers"), /"bookings-converted"/, "Tier is not under Bookings & Converted");
});
